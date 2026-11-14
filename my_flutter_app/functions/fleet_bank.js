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
// How many days apart a pending deposit and its posted copy may be dated.
const DUPLICATE_DAYS = 5;
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
 * Whether the bank's "sender" is an account and not a person: a transfer
 * from another account ("360 Checking XXXXXXX2820"). It is never a driver's
 * Zelle, whatever its cents are, and it is never remembered as a sender
 * (2026-11-14: a $1.01 transfer between the business's own accounts paid the
 * driver whose cents are .01).
 *
 * @param {string} name The sender as the bank shows it.
 * @return {boolean} Whether it names an account.
 */
function senderIsAccount(name) {
  const text = String(name || "");
  return /(?:x|\*|\u2022|\u00b7){2,}\s*\d{2,}/i.test(text) ||
    /\b(?:checking|savings|money market)\b/i.test(text);
}

/** Apps a payment goes through: a name like this is not a person. */
const APP_SENDER = /^(?:ZELLE|VENMO|CASH ?APP|PAYPAL|APPLE CASH)$/;

/**
 * Whether a deposit's sender may be remembered for a driver, so the next
 * one pays by itself: a person's Zelle only. Never an account, an app's own
 * name, a deposit the bank does not call a Zelle (cash, check, card payout),
 * or no name at all.
 *
 * @param {object} credit {senderName, zelle}.
 * @return {boolean} Whether to remember it.
 */
function senderRememberable(credit) {
  const key = senderKey(credit?.senderName);
  return key !== "" && !APP_SENDER.test(key) && credit?.zelle !== false &&
    !senderIsAccount(credit?.senderName);
}

/**
 * Which driver a deposit is from, or why it is not known. Wrong is worse
 * than slow: whenever two readings are possible, it waits for the office.
 * 0. A transfer from an account is nobody's. A deposit the bank does not
 *    call a Zelle (stored `zelle: false`) never pays by itself. Neither
 *    does one without a person's name.
 * 1. A sender remembered for exactly one active driver - unless the cents
 *    are another active driver's code (two people can share a name, and a
 *    friend can pay for a friend).
 * 2. A sender remembered only for a driver who left: never by cents (their
 *    old cents may be someone else's now).
 * 3. Else the amount's cents equal exactly one active driver's personal
 *    cents (the amount is the code, decided 2026-11-05).
 *
 * @param {object} credit {amountCents, senderName, zelle}.
 * @param {Array<object>} drivers Every driver of the business {id, status,
 *   personalCents, rememberedSenders}; only active ones are ever paid.
 * @return {object} {driverId, how: "sender"|"cents"} or {reason:
 *   "two_drivers"|"unknown"|"own_transfer"|"not_zelle"|"driver_left"}.
 */
function matchDeposit(credit, drivers) {
  if (senderIsAccount(credit?.senderName)) return {reason: "own_transfer"};
  if (credit?.zelle === false) return {reason: "not_zelle"};
  const sender = senderKey(credit?.senderName);
  if (!sender || APP_SENDER.test(sender)) return {reason: "unknown"};
  const all = (drivers || []).filter(Boolean);
  const active = all.filter((d) => d.status === "active");
  const knows = (d) => (d.rememberedSenders || [])
      .some((s) => senderKey(s) === sender);
  const amount = Math.round(Number(credit?.amountCents));
  const tail = Number.isFinite(amount) ? amount % 100 : 0;
  const byCents = tail > 0 ?
    active.filter((d) => Number(d.personalCents) === tail) : [];
  const owners = active.filter(knows);
  if (owners.length > 1) return {reason: "two_drivers"};
  if (owners.length === 1) {
    if (byCents.some((d) => d.id !== owners[0].id)) {
      return {reason: "two_drivers"};
    }
    return {driverId: owners[0].id, how: "sender"};
  }
  if (all.some((d) => d.status !== "active" && knows(d))) {
    return {reason: "driver_left"};
  }
  if (byCents.length === 1) return {driverId: byCents[0].id, how: "cents"};
  if (byCents.length > 1) return {reason: "two_drivers"};
  return {reason: "unknown"};
}

/**
 * Whether Fleet looks at a stored deposit at all: money in, on or after
 * `sinceMs`, not removed, not used. One without a sender's name still
 * counts: it waits for the office (a driver can pay cash at the bank).
 *
 * @param {object} credit A businessBankCredits row.
 * @param {number} sinceMs The earliest deposit time.
 * @return {boolean} Whether to try it.
 */
function depositMatchable(credit, sinceMs) {
  if (!credit || credit.removed === true) return false;
  if (credit.consumedBy && credit.consumedBy.kind) return false;
  if (!(Number(credit.amountCents) > 0)) return false;
  const at = Number(credit.atMs);
  if (Number.isFinite(at) && at > 0) return at >= sinceMs;
  const day = String(credit.dateKey || "");
  return day !== "" && Date.parse(`${day}T23:59:59-05:00`) >= sinceMs;
}

/**
 * Whether a new deposit may be one already used, sent again by the bank:
 * same account, amount and sender as a used deposit that was pending or was
 * removed by the bank, within DUPLICATE_DAYS. Some banks post a pending
 * deposit under a new id without linking the two; paying it by itself
 * would pay the driver twice, so it waits for the office instead.
 *
 * @param {object} credit The new deposit ({id, accountId, amountCents,
 *   senderName, dateKey}).
 * @param {Array<object>} others Stored deposits with the same amount.
 * @return {?object} The used deposit it may repeat, or null.
 */
function possibleDuplicateOf(credit, others) {
  const sender = senderKey(credit?.senderName);
  const day = Date.parse(`${credit?.dateKey || ""}T12:00:00Z`);
  if (!sender || !Number.isFinite(day)) return null;
  return (others || []).find((o) => o && o.id !== credit.id &&
    o.consumedBy && o.consumedBy.kind &&
    (o.removed === true || o.pending === true) &&
    String(o.accountId || "") === String(credit.accountId || "") &&
    Number(o.amountCents) === Number(credit.amountCents) &&
    senderKey(o.senderName) === sender &&
    Math.abs(Date.parse(`${o.dateKey || ""}T12:00:00Z`) - day) <=
      DUPLICATE_DAYS * 24 * 3600 * 1000) || null;
}

module.exports = {
  DUPLICATE_DAYS,
  possibleDuplicateOf,
  senderIsAccount,
  senderRememberable,
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
