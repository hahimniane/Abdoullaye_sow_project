"use strict";

// Fleet phase 1b (docs/FLEET.md §8): bank deposits pay drivers' bills by
// themselves, and the business chooses how often Laawol asks the bank for
// news on pay days (each ask is a paid Plaid refresh, so the business sees
// the monthly cost before saving). Pure: no Firestore, no Plaid.

const NY = "America/New_York";
/** Minutes between pay-day checks; 0 = off (Plaid's own updates only). */
const BANK_REFRESH_EVERY = Object.freeze([0, 15, 30, 60]);
/** What Plaid bills Laawol per successful /transactions/refresh. */
const PLAID_REFRESH_CENTS = 12;
/** Deposits before this are never matched (the feature's go-live day). */
const BANK_MATCH_START_MS = Date.UTC(2026, 10, 12, 5, 0, 0);
/** A month has about this many Mondays (for the monthly estimate). */
const MONDAYS_PER_MONTH = 4;

const DEFAULT_BANK_SCHEDULE = Object.freeze({
  every: 0, fromHour: 7, toHour: 23, monthDays: [1, 2, 3], mondays: false,
});

const wholeIn = (value, min, max, fallback) => {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
};

/**
 * The schedule as saved: every 0/15/30/60 minutes, between two whole hours
 * (New York), on chosen days of the month (1-28) and optionally Mondays.
 *
 * @param {object} input Raw settings.
 * @return {object} {every, fromHour, toHour, monthDays, mondays}.
 */
function cleanBankSchedule(input) {
  const raw = input && typeof input === "object" ? input : {};
  const every = BANK_REFRESH_EVERY.includes(Number(raw.every)) ?
    Number(raw.every) : 0;
  let fromHour = wholeIn(raw.fromHour, 0, 23, DEFAULT_BANK_SCHEDULE.fromHour);
  let toHour = wholeIn(raw.toHour, 1, 24, DEFAULT_BANK_SCHEDULE.toHour);
  if (toHour <= fromHour) {
    fromHour = DEFAULT_BANK_SCHEDULE.fromHour;
    toHour = DEFAULT_BANK_SCHEDULE.toHour;
  }
  const days = Array.isArray(raw.monthDays) ? raw.monthDays : [];
  const monthDays = [...new Set(days.map((d) => Math.trunc(Number(d)))
      .filter((d) => d >= 1 && d <= 28))].sort((a, b) => a - b);
  return {every, fromHour, toHour, monthDays, mondays: raw.mondays === true};
}

/**
 * Checks a month and what they cost, at `centsEach` (the business's
 * price; Plaid's when it has none). An estimate: Mondays are counted as
 * four a month, and a Monday that is also a chosen day counts twice.
 *
 * @param {object} schedule A cleaned schedule.
 * @param {number} centsEach Price of one check.
 * @return {object} {perDay, days, perMonth, centsEach, monthCents}.
 */
function bankScheduleQuote(schedule, centsEach = PLAID_REFRESH_CENTS) {
  const s = cleanBankSchedule(schedule);
  const price = Number.isFinite(Number(centsEach)) && Number(centsEach) >= 0 ?
    Math.round(Number(centsEach)) : PLAID_REFRESH_CENTS;
  const perDay = s.every > 0 ?
    Math.floor(((s.toHour - s.fromHour) * 60) / s.every) : 0;
  const days = s.monthDays.length + (s.mondays ? MONDAYS_PER_MONTH : 0);
  const perMonth = perDay * days;
  return {perDay, days, perMonth, centsEach: price,
    monthCents: perMonth * price};
}

/**
 * New York day of month, weekday (0 = Sunday), hour and minute.
 *
 * @param {number} ms A time.
 * @return {object} {day, weekday, hour, minute}.
 */
function nyParts(ms) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: NY, day: "numeric", weekday: "short", hour: "numeric",
    minute: "numeric", hourCycle: "h23",
  }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const weekdays = {Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6};
  return {day: Number(parts.day), weekday: weekdays[parts.weekday],
    hour: Number(parts.hour) % 24, minute: Number(parts.minute)};
}

/**
 * Whether the scheduled job should ask the bank now: a chosen day, inside
 * the hours, and `every` minutes since the last scheduled ask (a minute of
 * slack, since the job itself runs every 15 minutes).
 *
 * @param {object} schedule A cleaned schedule.
 * @param {number} nowMs Now.
 * @param {number} lastMs The last scheduled ask (0 = never).
 * @return {boolean} Whether to refresh.
 */
function bankRefreshDue(schedule, nowMs, lastMs) {
  const s = cleanBankSchedule(schedule);
  if (s.every <= 0) return false;
  const now = nyParts(nowMs);
  const dayChosen = s.monthDays.includes(now.day) ||
    (s.mondays && now.weekday === 1);
  if (!dayChosen) return false;
  if (now.hour < s.fromHour || now.hour >= s.toHour) return false;
  const last = Number(lastMs) || 0;
  return nowMs - last >= (s.every - 1) * 60 * 1000;
}

/**
 * A sender's name as it is compared: upper case, letters and digits only.
 *
 * @param {string} name The bank's sender line.
 * @return {string} The key.
 */
function senderKey(name) {
  return String(name || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim().slice(0, 80);
}

/**
 * Which driver a deposit is from, or why it is not known.
 * 1. A sender remembered for exactly one active driver.
 * 2. Else the amount's cents equal exactly one active driver's personal
 *    cents (the amount is the code, decided 2026-11-05).
 *
 * @param {object} credit {amountCents, senderName}.
 * @param {Array<object>} drivers {id, status, personalCents,
 *   rememberedSenders}.
 * @return {object} {driverId, how: "sender"|"cents"} or {reason:
 *   "two_drivers"|"unknown"}.
 */
function matchDeposit(credit, drivers) {
  const active = (drivers || []).filter((d) => d && d.status === "active");
  const sender = senderKey(credit?.senderName);
  if (sender) {
    const owners = active.filter((d) => (d.rememberedSenders || [])
        .some((s) => senderKey(s) === sender));
    if (owners.length === 1) return {driverId: owners[0].id, how: "sender"};
    if (owners.length > 1) return {reason: "two_drivers"};
  }
  const amount = Math.round(Number(credit?.amountCents));
  const tail = Number.isFinite(amount) ? amount % 100 : 0;
  if (tail > 0) {
    const byCents = active.filter((d) => Number(d.personalCents) === tail);
    if (byCents.length === 1) return {driverId: byCents[0].id, how: "cents"};
    if (byCents.length > 1) return {reason: "two_drivers"};
  }
  return {reason: "unknown"};
}

/**
 * Whether a stored deposit can pay a driver: money in from a person (the
 * bank shows a sender), on or after `sinceMs`, not removed, not used.
 *
 * @param {object} credit A businessBankCredits row.
 * @param {number} sinceMs The earliest deposit time.
 * @return {boolean} Whether to try it.
 */
function depositMatchable(credit, sinceMs) {
  if (!credit || credit.removed === true) return false;
  if (credit.consumedBy && credit.consumedBy.kind) return false;
  if (!(Number(credit.amountCents) > 0)) return false;
  if (!senderKey(credit.senderName)) return false;
  const at = Number(credit.atMs);
  if (Number.isFinite(at) && at > 0) return at >= sinceMs;
  const day = String(credit.dateKey || "");
  return day !== "" && Date.parse(`${day}T23:59:59-05:00`) >= sinceMs;
}

module.exports = {
  BANK_MATCH_START_MS,
  BANK_REFRESH_EVERY,
  DEFAULT_BANK_SCHEDULE,
  PLAID_REFRESH_CENTS,
  bankRefreshDue,
  bankScheduleQuote,
  cleanBankSchedule,
  depositMatchable,
  matchDeposit,
  nyParts,
  senderKey,
};
