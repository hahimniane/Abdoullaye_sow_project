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
 * Words a bank puts on a Zelle line that are not part of a name. A key made
 * only of these (or of one word) is never remembered for a driver.
 */
const NAME_STOP_WORDS = Object.freeze(new Set([
  "MONEY", "SENT", "PMT", "XFER", "ZELLE", "VENMO", "CASH", "CASHAPP",
  "PAYPAL", "APPLE", "PAYMENT", "TRANSFER", "RECEIVED", "FROM", "CREDIT",
  "DEPOSIT", "INSTANT", "ONLINE", "MOBILE", "ACH", "WIRE", "BANK", "THE",
  "CONF", "CONFIRMATION", "REF", "ID", "NAME", "UNKNOWN", "CUSTOMER",
]));

/** Words on a bank's Zelle line that are never part of a person's name. */
const BANK_NOISE = new RegExp("^(?:MONEY|SENT|PMT|XFER|ZELLE|PAYMENT|" +
  "TRANSFER|RECEIVED|FROM|CREDIT|DEPOSIT|INSTANT)$", "i");

/**
 * A bank's sender line without what is not a name: reference numbers (any
 * word with a digit in it, "#12", "JPM99abc1234"), and the words MONEY, SENT,
 * PMT and XFER. A transfer from an account is returned as it is (its digits
 * are what marks it an account).
 *
 * @param {string} name The sender as the bank shows it.
 * @return {string} The cleaned name ("" when nothing is left).
 */
function cleanSenderName(name) {
  const text = String(name || "").replace(/\s+/g, " ").trim();
  if (senderIsAccount(text)) return text;
  return text.split(" ").filter((word) => {
    const bare = word.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
    if (!bare) return false;
    if (/\d/.test(word) || word.startsWith("#")) return false;
    return !BANK_NOISE.test(bare);
  }).join(" ");
}

/**
 * The comparison key of a sender: cleaned, then upper case letters and
 * digits only.
 *
 * @param {string} name The sender.
 * @return {string} The key.
 */
function matchKey(name) {
  return senderKey(cleanSenderName(name));
}

/**
 * The words of a name key that can be part of a person's name: letters only
 * (a reference number is not a word of the name).
 *
 * @param {string} key A key from senderKey/matchKey.
 * @return {Array<string>} The words.
 */
function nameWords(key) {
  return String(key || "").split(" ").filter((w) => /^[A-Z]+$/.test(w));
}

/**
 * Whether two names are the same person's: their keys share every word of
 * the shorter one and at least two words ("FATOUMATA BAH" is "Fatoumata B.
 * Bah #12"; "BAH" alone is nobody).
 *
 * @param {string} a A name or key.
 * @param {string} b Another.
 * @return {boolean} Whether they are the same name.
 */
function nameIs(a, b) {
  const x = [...new Set(nameWords(matchKey(a)))];
  const y = [...new Set(nameWords(matchKey(b)))];
  const [short, long] = x.length <= y.length ? [x, new Set(y)] :
    [y, new Set(x)];
  return short.length >= 2 && short.every((w) => long.has(w));
}

/**
 * Whether a deposit's sender may be remembered for a driver, so the next
 * one pays by itself: a person's Zelle only, with at least two words of a
 * name. Never an account, an app's own name, a stop-listed word, a one-word
 * key, a deposit the bank does not call a Zelle (cash, check, card payout),
 * or no name at all.
 *
 * @param {object} credit {senderName, zelle}.
 * @return {boolean} Whether to remember it.
 */
function senderRememberable(credit) {
  const key = matchKey(credit?.senderName);
  if (key === "" || APP_SENDER.test(key) || credit?.zelle === false ||
      senderIsAccount(credit?.senderName)) {
    return false;
  }
  const words = nameWords(key).filter((w) => !NAME_STOP_WORDS.has(w));
  return words.length >= 2;
}

/**
 * Whether a typed name (the office's "Names this driver pays from", or a
 * driver's answer) may be remembered: same test as a deposit's sender.
 *
 * @param {string} name A name.
 * @return {boolean} Whether it may be remembered.
 */
function nameRememberable(name) {
  return senderRememberable({senderName: name, zelle: true});
}

const DAY_MS = 86400000;
const dayMs = (key) => Date.parse(`${key || ""}T12:00:00Z`);

/**
 * Whether a deposit is not older than the photo's day (one day of slack: the
 * photo's day is the driver's, the deposit's is the bank's). Unknown days
 * pass.
 *
 * @param {string} depositDay The bank's date.
 * @param {string} photoDay The screenshot's day (may be empty).
 * @return {boolean} True when it can be the payment.
 */
function depositNotBefore(depositDay, photoDay) {
  const d = dayMs(depositDay);
  const p = dayMs(photoDay);
  if (!Number.isFinite(d) || !Number.isFinite(p)) return true;
  return d >= p - DAY_MS;
}

/**
 * Which driver a deposit is from, or why it is not known. Wrong is worse
 * than slow: whenever two readings are possible, it waits for the office
 * (docs/FLEET_PAYMENT_PROOF.md, "Matching a deposit").
 * 0. A transfer from an account is nobody's. A deposit the bank does not
 *    call a Zelle (stored `zelle: false`) never pays by itself. Neither
 *    does one without a person's name.
 * 1. A deposit once undone by the office (`fleetUndone` or the waiting
 *    reason "undone"), and the bank's later copy of it, never pays by
 *    itself again.
 * 2. A sender remembered for exactly one active driver pays that driver,
 *    whatever the amount.
 * 3. A sender remembered for more than one active driver waits
 *    ("shared_payer") unless exactly one of those drivers has an open claim
 *    for that amount, who then gets it.
 * 4. A sender remembered only for a driver who left waits ("driver_left").
 * 5. An unknown sender: an open claim takes it when (a) the claim's
 *    payerName (the driver's answer) is that sender, or (b) the claim has
 *    no payerName, the amounts are equal, the sender is the driver's own
 *    name, and no other unused deposit and no other open claim fits the
 *    same way.
 * 6. Otherwise "unknown".
 *
 * @param {object} credit {id, amountCents, senderName, zelle, dateKey,
 *   fleetUndone, fleetWaitingReason}.
 * @param {Array<object>} drivers Every driver of the business {id, name,
 *   status, rememberedSenders}; only active ones are ever paid.
 * @param {object} [context] {claims: open claims that can take a deposit
 *   [{id, driverId, amountCents, payerName, dayKey, createdAtMs}], others:
 *   the business's other unused deposits [{id, amountCents, senderName,
 *   dateKey}]}.
 * @return {object} {driverId, how: "sender"|"claim", claimId?} or {reason,
 *   claimIds?}; reasons: own_transfer, not_zelle, unknown, undone,
 *   shared_payer, driver_left. `claimIds` names claims that tie (flagged
 *   "two_claims").
 */
function matchDeposit(credit, drivers, context = {}) {
  if (senderIsAccount(credit?.senderName)) return {reason: "own_transfer"};
  if (credit?.zelle === false) return {reason: "not_zelle"};
  const sender = matchKey(credit?.senderName);
  if (!sender || APP_SENDER.test(sender)) return {reason: "unknown"};
  if (credit?.fleetUndone === true ||
      credit?.fleetWaitingReason === "undone") {
    return {reason: "undone"};
  }
  const all = (drivers || []).filter(Boolean);
  const active = all.filter((d) => d.status === "active");
  const amount = Math.round(Number(credit?.amountCents));
  const knows = (d) => (d.rememberedSenders || [])
      .some((s) => matchKey(s) === sender);
  const claims = (context.claims || []).filter((c) => c &&
    active.some((d) => d.id === c.driverId) &&
    depositNotBefore(credit?.dateKey, c.dayKey));
  const owners = active.filter(knows);
  if (owners.length === 1) return {driverId: owners[0].id, how: "sender"};
  if (owners.length > 1) {
    const mine = claims.filter((c) => Number(c.amountCents) === amount &&
      owners.some((d) => d.id === c.driverId));
    const people = new Set(mine.map((c) => c.driverId));
    if (people.size === 1) {
      const first = [...mine].sort((a, b) =>
        (Number(a.createdAtMs) || 0) - (Number(b.createdAtMs) || 0))[0];
      return {driverId: first.driverId, how: "claim", claimId: first.id};
    }
    return {reason: "shared_payer"};
  }
  if (all.some((d) => d.status !== "active" && knows(d))) {
    return {reason: "driver_left"};
  }
  // An unknown sender: only an open claim can take it.
  const byName = claims.filter((c) => c.payerName &&
    nameIs(c.payerName, credit.senderName));
  if (byName.length === 1) {
    return {driverId: byName[0].driverId, how: "claim",
      claimId: byName[0].id};
  }
  if (byName.length > 1) {
    return {reason: "unknown", claimIds: byName.map((c) => c.id)};
  }
  const nameOf = (id) => all.find((d) => d.id === id)?.name;
  const fits = (c, who) => !c.payerName &&
    Number(c.amountCents) === who.amount &&
    nameIs(who.sender, nameOf(c.driverId));
  const ownName = claims.filter((c) =>
    fits(c, {amount, sender: credit.senderName}));
  if (ownName.length === 1) {
    const rival = (context.others || []).some((o) => o && o.id !== credit.id &&
      fits(ownName[0], {amount: Math.round(Number(o.amountCents)),
        sender: o.senderName}) &&
      depositNotBefore(o.dateKey, ownName[0].dayKey));
    if (!rival) {
      return {driverId: ownName[0].driverId, how: "claim",
        claimId: ownName[0].id};
    }
    return {reason: "unknown", claimIds: [ownName[0].id]};
  }
  if (ownName.length > 1) {
    return {reason: "unknown", claimIds: ownName.map((c) => c.id)};
  }
  return {reason: "unknown"};
}

/**
 * Where matching starts for a business: go-live, when Fleet was switched
 * on, and the moment a different bank login (or account) was connected (a
 * new bank's old deposits are never matched).
 *
 * @param {object} business The business record.
 * @param {object} link Its bank link record (may be empty).
 * @return {number} The earliest deposit time.
 */
function matchStartMs(business, link) {
  return Math.max(BANK_MATCH_START_MS,
      Number(business?.fleet?.enabledAtMs) || 0,
      Number(link?.matchFromMs) || 0);
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
  const sender = matchKey(credit?.senderName);
  const day = Date.parse(`${credit?.dateKey || ""}T12:00:00Z`);
  if (!sender || !Number.isFinite(day)) return null;
  // A used deposit that was pending or removed, or one the office undid
  // (live or not: the bank's copy of an undone deposit never pays by itself).
  return (others || []).find((o) => o && o.id !== credit.id &&
    ((o.consumedBy && o.consumedBy.kind &&
      (o.removed === true || o.pending === true)) ||
      o.fleetUndone === true) &&
    String(o.accountId || "") === String(credit.accountId || "") &&
    Number(o.amountCents) === Number(credit.amountCents) &&
    matchKey(o.senderName) === sender &&
    Math.abs(Date.parse(`${o.dateKey || ""}T12:00:00Z`) - day) <=
      DUPLICATE_DAYS * 24 * 3600 * 1000) || null;
}

module.exports = {
  DUPLICATE_DAYS,
  possibleDuplicateOf,
  senderIsAccount,
  cleanSenderName,
  matchKey,
  matchStartMs,
  nameIs,
  nameRememberable,
  nameWords,
  NAME_STOP_WORDS,
  depositNotBefore,
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
