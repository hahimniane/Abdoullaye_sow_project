"use strict";

/**
 * "Check bank": the standalone bank check staff run at the counter when a
 * customer says "I sent it by Zelle" (docs/ZELLE_BANK_CHECK.md, "Check bank
 * any time"). Staff type the exact amount and roughly when it was sent; the
 * server looks for deposits of exactly that amount in that window that have
 * not confirmed anything yet. Nothing is consumed by looking: "Use for a
 * sale" then spends one deposit on one Zelle record.
 *
 * Also the monthly usage of the bank (checks, paid refreshes, estimated
 * cost, per staff member) and the owner's monthly limit of paid refreshes.
 *
 * Pure: index.js reads and writes; this decides.
 */

const {creditConsumed, dateKeyIn, millisOf, safeTimeZone, shownTime,
  paymentOfRecord, checkRecordRefusal, confirmationFromBankCheck} =
  require("./zelle_check");
const {zoneOffsetMs} = require("./inventory");

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** "When was it sent?" - the windows staff pick from. */
const SINCE_OPTIONS = Object.freeze(["15m", "1h", "today"]);
const DEFAULT_SINCE = "15m";
/**
 * A bank's clock and ours differ a little: a deposit stamped up to five
 * minutes "in the future" still counts as now.
 */
const FUTURE_GRACE_MS = 5 * MINUTE_MS;
/** The largest amount one check may ask about ($1,000,000). */
const MAX_CHECK_CENTS = 100000000;

/** Monthly limit of paid refreshes: the owner sets 0..1000, default 100. */
const DEFAULT_REFRESH_LIMIT = 100;
const MIN_REFRESH_LIMIT = 0;
const MAX_REFRESH_LIMIT = 1000;
/** What Plaid bills per successful /transactions/refresh. */
const REFRESH_COST_CENTS = 12;
/** Usage months are counted in New York, like Bills and Volume. */
const USAGE_TIME_ZONE = "America/New_York";
const BANK_USAGE = "businessBankUsage";

/** "Use for a sale": the records offered first, then searched. */
const USE_RECENT_DAYS = 14;
const USE_RECENT_READ = 50;
const USE_RECENT_SHOWN = 8;
const USE_SEARCH_DAYS = 120;
const USE_SEARCH_READ = 300;
const USE_SEARCH_SHOWN = 20;
const MAX_QUERY = 80;
const MAX_LABEL = 80;

/**
 * @param {*} value What staff picked.
 * @return {?string} "15m" | "1h" | "today" ("15m" when absent), or null.
 */
function cleanSince(value) {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_SINCE;
  }
  const since = String(value).trim();
  return SINCE_OPTIONS.includes(since) ? since : null;
}

/**
 * @param {*} value The amount staff typed, in cents.
 * @return {?number} Whole cents 1..MAX_CHECK_CENTS, or null.
 */
function cleanCheckCents(value) {
  // Clients send whole cents as a number; text ("40.00") is refused rather
  // than guessed.
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value >= 1 && value <= MAX_CHECK_CENTS ? value : null;
}

/**
 * Midnight of the day `ms` falls on, in a zone.
 *
 * @param {number} ms A moment.
 * @param {string} timeZone An IANA zone.
 * @return {number} The day's first millisecond.
 */
function zonedDayStartMs(ms, timeZone) {
  const zone = safeTimeZone(timeZone);
  const [y, m, d] = dateKeyIn(ms, zone).split("-").map(Number);
  const midnight = Date.UTC(y, m - 1, d);
  // The zone's offset at that moment, then once more: the offset can
  // differ by then (a daylight-saving change near midnight).
  let start = midnight - zoneOffsetMs(midnight, zone);
  start = midnight - zoneOffsetMs(start, zone);
  return start;
}

/**
 * The moments a standalone check looks at.
 *
 * - "15m": the last 15 minutes; "1h": the last hour; "today": since
 *   midnight in the business's zone. Edges included; up to FUTURE_GRACE_MS
 *   past now also counts (bank clocks).
 * - A deposit whose bank line has only a date is held to the window's
 *   dates in the business's zone.
 *
 * @param {object} input {since, nowMs, timeZone}.
 * @return {object} {since, fromMs, toMs, dateKeys: Set<string>}.
 */
function standaloneWindow(input) {
  const since = cleanSince(input.since) || DEFAULT_SINCE;
  const nowMs = Number(input.nowMs);
  const zone = safeTimeZone(input.timeZone);
  const fromMs = since === "today" ? zonedDayStartMs(nowMs, zone) :
    nowMs - (since === "1h" ? 60 : 15) * MINUTE_MS;
  return {since, fromMs, toMs: nowMs + FUTURE_GRACE_MS,
    dateKeys: new Set([dateKeyIn(fromMs, zone), dateKeyIn(nowMs, zone)])};
}

/**
 * Whether a stored deposit answers a standalone check.
 *
 * @param {object} credit A stored credit.
 * @param {object} ctx {amountCents, accountId, window (standaloneWindow)}.
 * @return {?string} null when it does, else why not.
 */
function standaloneIneligibility(credit, ctx) {
  if (!credit) return "missing";
  if (credit.removed === true) return "removed";
  if (String(credit.accountId || "") !== String(ctx.accountId || "")) {
    return "other_account";
  }
  if (credit.amountCents !== ctx.amountCents) return "amount";
  if (creditConsumed(credit)) return "consumed";
  const w = ctx.window;
  if (Number.isFinite(credit.atMs) && credit.atMs !== null) {
    return credit.atMs >= w.fromMs && credit.atMs <= w.toMs ? null :
      "outside_window";
  }
  return credit.dateKey && w.dateKeys.has(credit.dateKey) ? null :
    "outside_window";
}

/**
 * What staff see of a deposit: amount, time (date only when the bank gave
 * no time), sender, pending. Never the balance or the bank line.
 *
 * @param {object} credit A stored credit with `id`.
 * @return {object} {creditId, amountCents, atMs, timeKnown, senderName,
 *   pending}.
 */
function depositView(credit) {
  return {creditId: String(credit.id), amountCents: credit.amountCents,
    ...shownTime(credit), senderName: String(credit.senderName || ""),
    pending: credit.pending === true};
}

/**
 * The answer to a standalone check: newest first (date-only deposits
 * after the timed ones).
 *
 * @param {object} ctx See standaloneIneligibility.
 * @param {Array<object>} credits Stored credits, each with `id`.
 * @return {object} {result: "received" | "several" | "not_found",
 *   deposits: [depositView]}.
 */
function standaloneOutcome(ctx, credits) {
  // Timed deposits newest first, then those the bank dated only.
  const list = (credits || [])
      .filter((credit) => standaloneIneligibility(credit, ctx) === null)
      .map(depositView)
      .sort((a, b) => Number(b.timeKnown) - Number(a.timeKnown) ||
        (b.atMs ?? 0) - (a.atMs ?? 0) ||
        String(a.creditId).localeCompare(String(b.creditId)));
  if (list.length === 0) return {result: "not_found", deposits: []};
  return {result: list.length === 1 ? "received" : "several",
    deposits: list};
}

// ---- Use for a sale --------------------------------------------------------

/**
 * Whether a deposit may be spent on a record picked by hand ("Use for a
 * sale"). The record may be older than the deposit (a standing credit or
 * package payment), so no minutes window - but the deposit must be one a
 * standalone check can show: received today or yesterday in the business's
 * zone (a check made just before midnight can still be used after it).
 *
 * @param {object} credit A stored credit.
 * @param {object} ctx {amountCents, accountId, nowMs, timeZone,
 *   consumedByMe?: {kind, id}}.
 * @return {?string} null when usable, else why not.
 */
function useIneligibility(credit, ctx) {
  if (!credit) return "missing";
  if (credit.removed === true) return "removed";
  if (String(credit.accountId || "") !== String(ctx.accountId || "")) {
    return "other_account";
  }
  if (credit.amountCents !== ctx.amountCents) return "amount";
  if (creditConsumed(credit)) {
    const mine = ctx.consumedByMe && credit.consumedBy.kind ===
      ctx.consumedByMe.kind && credit.consumedBy.id === ctx.consumedByMe.id;
    if (!mine) return "consumed";
  }
  const zone = safeTimeZone(ctx.timeZone);
  const nowMs = Number(ctx.nowMs);
  const earliest = zonedDayStartMs(zonedDayStartMs(nowMs, zone) - 1, zone);
  if (Number.isFinite(credit.atMs) && credit.atMs !== null) {
    return credit.atMs >= earliest && credit.atMs <= nowMs + FUTURE_GRACE_MS ?
      null : "outside_window";
  }
  const keys = new Set([dateKeyIn(earliest, zone), dateKeyIn(nowMs, zone)]);
  return credit.dateKey && keys.has(credit.dateKey) ? null : "outside_window";
}

/**
 * Why a record cannot take a deposit of `amountCents`, or null.
 *
 * @param {string} kind A zelle_check KINDS key.
 * @param {?object} record The stored record.
 * @param {string} businessId The caller's business.
 * @param {number} amountCents The deposit's amount.
 * @return {?string} A refusal code (record_not_found, record_voided,
 *   not_zelle, amount_mismatch) or null.
 */
function useRecordRefusal(kind, record, businessId, amountCents) {
  const refusal = checkRecordRefusal(kind, record, businessId);
  if (refusal) return refusal;
  return paymentOfRecord(kind, record).amountCents === amountCents ? null :
    "amount_mismatch";
}

/**
 * Whether a record belongs in the "Use for a sale" picker: a live Zelle
 * payment of exactly that amount that no deposit confirmed yet.
 *
 * @param {string} kind A KINDS key.
 * @param {object} record The stored record.
 * @param {string} businessId The business.
 * @param {number} amountCents The deposit's amount.
 * @return {boolean} True when it can be picked.
 */
function recordOffered(kind, record, businessId, amountCents) {
  if (useRecordRefusal(kind, record, businessId, amountCents)) return false;
  return !confirmationFromBankCheck(paymentOfRecord(kind, record).bankCheck);
}

/**
 * @param {*} value Text.
 * @return {string} It on one line, at most MAX_LABEL characters.
 */
function label(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_LABEL);
}

/**
 * A sale's items in a few words: "2 x Rice, Oil".
 *
 * @param {Array<object>} lines The sale's lines ({name, quantity}).
 * @return {string} The summary (user data, never translated).
 */
function saleItemsSummary(lines) {
  const parts = (Array.isArray(lines) ? lines : []).map((line) => {
    const name = label(line?.name);
    const quantity = Math.round(Number(line?.quantity) || 0);
    if (!name) return "";
    return quantity > 1 ? `${quantity} x ${name}` : name;
  }).filter(Boolean);
  return label(parts.join(", "));
}

/**
 * What the picker shows of a record. `who` and `what` are the business's
 * own data (customer name, items or tracking code): clients never
 * translate them.
 *
 * @param {object} input {kind, id, record, who, what}.
 * @return {object} {kind, id, amountCents, atMs, who, what}.
 */
function useRecordView(input) {
  const payment = paymentOfRecord(input.kind, input.record);
  return {kind: input.kind, id: String(input.id),
    amountCents: payment.amountCents, atMs: millisOf(input.record?.createdAt),
    who: label(input.who), what: label(input.what)};
}

/**
 * @param {*} value A search typed by staff.
 * @return {string} It trimmed, lower case, at most MAX_QUERY characters.
 */
function cleanQuery(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase()
      .slice(0, MAX_QUERY);
}

/**
 * @param {object} view A useRecordView.
 * @param {string} query A cleanQuery ("" matches everything).
 * @return {boolean} Whether the record matches.
 */
function recordMatches(view, query) {
  if (!query) return true;
  return [view.who, view.what, view.id].some((field) =>
    String(field || "").toLowerCase().includes(query));
}

/**
 * The picker's list: newest first, at most `max`.
 *
 * @param {Array<object>} views useRecordView rows.
 * @param {string} query A cleanQuery.
 * @param {number} max How many to show.
 * @return {Array<object>} The rows.
 */
function pickRecords(views, query, max) {
  const seen = new Set();
  return (views || [])
      .filter((view) => recordMatches(view, query))
      .filter((view) => {
        const key = `${view.kind}:${view.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => (b.atMs ?? 0) - (a.atMs ?? 0) ||
        `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`))
      .slice(0, max);
}

// ---- Usage and the monthly limit ------------------------------------------

/**
 * How a person is named on the usage card: full name, display name, name,
 * email - never a uid.
 *
 * @param {?object} user A users/{uid} profile.
 * @return {string} The name, or "" (the screens say "Team member").
 */
function personName(user) {
  for (const key of ["fullName", "displayName", "name", "email"]) {
    const value = label(user?.[key]);
    if (value) return value;
  }
  return "";
}

/**
 * @param {number} nowMs A moment.
 * @return {string} Its usage month, "yyyy-mm" in New York.
 */
function usageMonthKey(nowMs) {
  return dateKeyIn(nowMs, USAGE_TIME_ZONE).slice(0, 7);
}

/**
 * @param {string} businessId The business.
 * @param {string} month "yyyy-mm".
 * @return {string} Its businessBankUsage document id.
 */
function usageDocId(businessId, month) {
  return `${String(businessId).replace(/\//g, "_")}_${month}`;
}

/**
 * @param {*} value What the owner chose.
 * @return {?number} Whole 0..1000, or null.
 */
function cleanRefreshLimit(value) {
  const n = typeof value === "string" && value.trim() !== "" ?
    Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n)) return null;
  return n >= MIN_REFRESH_LIMIT && n <= MAX_REFRESH_LIMIT ? n : null;
}

/**
 * @param {?object} link The stored link.
 * @return {number} Its monthly limit of paid refreshes, or the default.
 */
function refreshLimitOf(link) {
  return cleanRefreshLimit(link?.refreshLimit) ?? DEFAULT_REFRESH_LIMIT;
}

/**
 * @param {*} value A stored counter.
 * @return {number} It as a whole count >= 0.
 */
function countOf(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/**
 * Where a check stands against the month's limit, decided in the same
 * transaction that counts the refresh (so concurrent checks cannot
 * overshoot it).
 *
 * @param {object} input {plan (zelle_check.refreshPlan's), usedBefore (the
 *   month's refreshes read in the transaction), limit, noticeSent}.
 * @return {object} {refreshesAfter, limitReached, notify}: notify is true
 *   exactly once a month - the check that finds the limit reached and no
 *   notice sent yet (never for a limit of 0, which the owner chose).
 */
function limitState(input) {
  const used = countOf(input.usedBefore);
  const refreshesAfter = used + (input.plan?.refresh ? 1 : 0);
  const limit = Number.isInteger(input.limit) ? input.limit :
    DEFAULT_REFRESH_LIMIT;
  const limitReached = refreshesAfter >= limit;
  return {refreshesAfter, limitReached,
    notify: limitReached && limit > 0 && !input.noticeSent};
}

/**
 * @param {number} refreshes Paid refreshes.
 * @return {number} What Plaid bills for them, in cents.
 */
function estimatedCostCents(refreshes) {
  return countOf(refreshes) * REFRESH_COST_CENTS;
}

/**
 * The month's usage as the owner (and platform admins) see it.
 *
 * @param {object} input {month, usage (the stored doc or null), limit,
 *   names (Map uid -> display name)}.
 * @return {object} {month, checks, refreshes, refreshesFailed,
 *   estimatedCostCents, refreshLimit, limitReached, byStaff: [{uid, name,
 *   checks, refreshes}]} - staff by checks, most first.
 */
function usageView(input) {
  const usage = input.usage || {};
  const refreshes = countOf(usage.refreshes);
  const limit = Number.isInteger(input.limit) ? input.limit :
    DEFAULT_REFRESH_LIMIT;
  const names = input.names instanceof Map ? input.names : new Map();
  const byUid = usage.byUid && typeof usage.byUid === "object" ?
    usage.byUid : {};
  const byStaff = Object.entries(byUid).map(([uid, row]) => ({uid,
    name: String(names.get(uid) || ""), checks: countOf(row?.checks),
    refreshes: countOf(row?.refreshes)}))
      .filter((row) => row.checks > 0 || row.refreshes > 0)
      .sort((a, b) => b.checks - a.checks || b.refreshes - a.refreshes ||
        a.uid.localeCompare(b.uid));
  return {month: String(input.month || usage.month || ""),
    checks: countOf(usage.checks), refreshes,
    refreshesFailed: countOf(usage.refreshesFailed),
    estimatedCostCents: estimatedCostCents(refreshes), refreshLimit: limit,
    limitReached: refreshes >= limit, byStaff};
}

/**
 * Whether the business had an active bank link at some point in a month
 * (the "Bank connection" bill line): a usage document that saw the link
 * active that month (a check, a sync or a connect wrote `linkActive`), or
 * a link connected before the month ended that was not disconnected before
 * it began.
 *
 * @param {object} input {link (stored or null), usage (stored or null),
 *   window: {startMs, endMs}}.
 * @return {boolean} True when the month counts.
 */
function linkActiveInMonth(input) {
  if (input.usage && input.usage.linkActive === true) return true;
  const link = input.link;
  if (!link || !link.itemId || !link.status) return false;
  const connectedMs = millisOf(link.connectedAt);
  if (connectedMs === null || connectedMs >= input.window.endMs) return false;
  if (link.status !== "disconnected") return true;
  const goneMs = millisOf(link.disconnectedAt);
  return goneMs !== null && goneMs >= input.window.startMs;
}

module.exports = {
  BANK_USAGE,
  DAY_MS,
  DEFAULT_REFRESH_LIMIT,
  DEFAULT_SINCE,
  FUTURE_GRACE_MS,
  MAX_CHECK_CENTS,
  MAX_REFRESH_LIMIT,
  MIN_REFRESH_LIMIT,
  REFRESH_COST_CENTS,
  SINCE_OPTIONS,
  USAGE_TIME_ZONE,
  USE_RECENT_DAYS,
  USE_RECENT_READ,
  USE_RECENT_SHOWN,
  USE_SEARCH_DAYS,
  USE_SEARCH_READ,
  USE_SEARCH_SHOWN,
  cleanCheckCents,
  cleanQuery,
  cleanRefreshLimit,
  cleanSince,
  countOf,
  depositView,
  estimatedCostCents,
  limitState,
  linkActiveInMonth,
  personName,
  pickRecords,
  recordMatches,
  recordOffered,
  refreshLimitOf,
  saleItemsSummary,
  standaloneIneligibility,
  standaloneOutcome,
  standaloneWindow,
  usageDocId,
  usageMonthKey,
  usageView,
  useIneligibility,
  useRecordRefusal,
  useRecordView,
  zonedDayStartMs,
};
