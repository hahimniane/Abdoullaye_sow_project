"use strict";

/**
 * "Check Zelle": staff at the counter ask the business's own bank whether a
 * payment recorded as Zelle really arrived, without calling the owner.
 *
 * The rule (owner-approved): a deposit of EXACTLY the payment's amount, into
 * the connected account, received within the business's window (default 15
 * minutes, 2 to 60) before or after the payment was recorded, that has not
 * already confirmed another payment and that the bank has not removed.
 * Pending deposits count. One such deposit confirms the payment; several are
 * put in front of staff to pick by sender name; none is "not found yet".
 *
 * A deposit whose bank line carries only a date (no time) cannot be held to
 * a minutes window: it is a candidate when its date is one of the window's
 * dates in the business's zone, and it never confirms on its own - staff
 * pick it by sender name ("choose"), even when it is the only one.
 *
 * Pure: the callables in index.js read and write; this decides.
 */

const KINDS = Object.freeze({
  inventory_sale: {collection: "inventorySales", section: "inventory",
    storeScoped: true},
  inventory_credit_payment: {collection: "inventoryCreditPayments",
    section: "inventory", storeScoped: true},
  container_line_payment: {collection: "containerLinePayments",
    section: "containers", storeScoped: false},
});

const DEFAULT_WINDOW_MINUTES = 15;
const MIN_WINDOW_MINUTES = 2;
const MAX_WINDOW_MINUTES = 60;
/**
 * /transactions/refresh is billed per successful call ($0.12): at most once
 * a minute per business...
 */
const REFRESH_THROTTLE_MS = 60 * 1000;
/**
 * ...and at most once per payment record in five minutes, so one press of
 * "Check Zelle" (and the screens' automatic re-checks every 20 s for 3
 * minutes) costs at most one refresh. Re-checks inside it only sync (free).
 */
const RECORD_REFRESH_WINDOW_MS = 5 * 60 * 1000;
/** Same-amount credits read per check; far more than a counter ever sees. */
const MAX_CANDIDATE_READ = 200;
const DEFAULT_TIME_ZONE = "America/New_York";

/** Refusals: [HttpsError kind, English message]. */
const BANK_REFUSALS = Object.freeze({
  bank_owner_required: ["permission-denied",
    "Only the business owner can manage the bank connection."],
  bank_access_denied: ["permission-denied",
    "This account cannot use the bank check for this business."],
  bank_not_connected: ["failed-precondition",
    "No bank is connected for Zelle checks. Ask the owner to connect one."],
  bank_needs_reauth: ["failed-precondition",
    "The bank needs the owner to sign in to it again."],
  not_zelle: ["failed-precondition",
    "That payment was not recorded as Zelle."],
  record_not_found: ["not-found", "That payment could not be found."],
  record_voided: ["failed-precondition",
    "That payment was voided or reverted."],
  kind_invalid: ["invalid-argument", "That kind of payment cannot be checked."],
  window_invalid: ["invalid-argument",
    "The check window must be between 2 and 60 minutes."],
  platform_invalid: ["invalid-argument",
    "Say which app is connecting: ios, android or web."],
  public_token_required: ["invalid-argument",
    "The bank sign-in did not finish. Try connecting again."],
  no_depository_account: ["failed-precondition",
    "That bank login has no checking or savings account."],
  candidate_invalid: ["invalid-argument",
    "That deposit does not match this payment."],
  candidate_taken: ["failed-precondition",
    "That deposit already confirmed another payment."],
  bank_error: ["unavailable", "The bank could not be reached. Try again."],
  // Check bank any time (bank_check.js).
  mode_invalid: ["invalid-argument", "That kind of bank check is not known."],
  check_amount_invalid: ["invalid-argument",
    "Enter the exact amount that was sent."],
  since_invalid: ["invalid-argument",
    "Choose when it was sent: last 15 minutes, last hour or today."],
  limit_invalid: ["invalid-argument",
    "The monthly limit must be a whole number from 0 to 1000."],
  amount_mismatch: ["failed-precondition",
    "That payment is not for the same amount as the deposit."],
});

/**
 * @param {string} code A BANK_REFUSALS code.
 * @return {string} Its HttpsError kind.
 */
function bankRefusalKind(code) {
  return (BANK_REFUSALS[code] || BANK_REFUSALS.bank_error)[0];
}

/**
 * @param {string} code A BANK_REFUSALS code.
 * @return {string} Its English message.
 */
function bankRefusalMessage(code) {
  return (BANK_REFUSALS[code] || BANK_REFUSALS.bank_error)[1];
}

/**
 * @param {*} value What the owner chose.
 * @return {?number} Whole minutes 2..60, or null.
 */
function cleanWindowMinutes(value) {
  const n = typeof value === "string" && value.trim() !== "" ?
    Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n)) return null;
  return n >= MIN_WINDOW_MINUTES && n <= MAX_WINDOW_MINUTES ? n : null;
}

/**
 * @param {?object} link The stored link (or null).
 * @return {number} Its window, or the default.
 */
function windowMinutesOf(link) {
  return cleanWindowMinutes(link?.windowMinutes) ?? DEFAULT_WINDOW_MINUTES;
}

/**
 * Who the caller is to this business's bank.
 *
 * - "owner": a platform admin, or the business's owner (role businessOwner
 *   of this business, or its ownerUid). Connects, disconnects, sees the bank.
 * - "staff": anyone else of this business holding at least one business
 *   permission. Sees only connected/status/window.
 * - "none": everybody else.
 *
 * @param {object} input {uid, user (profile), businessId, business}.
 * @return {string} The role.
 */
function bankRoleOf(input) {
  const user = input.user || {};
  if (user.role === "admin") return "owner";
  const ofBusiness = Boolean(input.businessId) &&
    user.businessId === input.businessId;
  if (!ofBusiness) return "none";
  if (user.role === "businessOwner") return "owner";
  if (input.uid && input.business &&
      String(input.business.ownerUid || "") === input.uid) {
    return "owner";
  }
  const permissions = Array.isArray(user.businessPermissions) ?
    user.businessPermissions.filter((p) => typeof p === "string" && p) : [];
  return user.role === "staff" && permissions.length > 0 ? "staff" : "none";
}

/**
 * How a check of this kind is authorised: the section the caller must hold
 * (the same as viewing the record) and whether inventory store scoping
 * applies.
 *
 * @param {string} kind A KINDS key.
 * @return {?object} {collection, section, storeScoped} or null.
 */
function checkAccessPlan(kind) {
  return Object.prototype.hasOwnProperty.call(KINDS, kind) ?
    {...KINDS[kind]} : null;
}

/**
 * @param {*} value A Firestore Timestamp, Date, millis or ISO string.
 * @return {?number} Milliseconds.
 */
function millisOf(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value._seconds === "number") {
    return value._seconds * 1000 + Math.floor((value._nanoseconds || 0) / 1e6);
  }
  return null;
}

/**
 * The money a record says was paid by Zelle.
 *
 * - inventory_sale: what was taken at the counter (paidNowCents; a sale from
 *   before v4 has none and was paid in full, totalCents), paymentMethod.
 * - inventory_credit_payment / container_line_payment: amountCents, method.
 *
 * @param {string} kind A KINDS key.
 * @param {object} record The stored record.
 * @return {object} {amountCents, method, atMs, voided, bankCheck}.
 */
function paymentOfRecord(kind, record) {
  const r = record || {};
  if (kind === "inventory_sale") {
    const paidNow = Number.isInteger(r.paidNowCents) ? r.paidNowCents :
      Math.round(Number(r.totalCents) || 0);
    return {amountCents: Math.max(0, paidNow),
      method: String(r.paymentMethod || ""),
      atMs: millisOf(r.createdAt), voided: r.voided === true,
      bankCheck: r.bankCheck || null};
  }
  return {amountCents: Math.max(0, Math.round(Number(r.amountCents) || 0)),
    method: String(r.method || ""), atMs: millisOf(r.createdAt),
    voided: r.reverted === true, bankCheck: r.bankCheck || null};
}

/**
 * Why this record cannot be checked, or null.
 *
 * @param {string} kind A KINDS key.
 * @param {?object} record The stored record (null when missing).
 * @param {string} businessId The caller's business.
 * @return {?string} record_not_found, record_voided or not_zelle.
 */
function checkRecordRefusal(kind, record, businessId) {
  if (!record || String(record.businessId || "") !== businessId) {
    return "record_not_found";
  }
  const payment = paymentOfRecord(kind, record);
  if (payment.voided) return "record_voided";
  if (payment.method !== "zelle" || payment.amountCents <= 0) {
    return "not_zelle";
  }
  return null;
}

/**
 * @param {*} timeZone An IANA zone.
 * @return {string} It when the runtime knows it, else America/New_York.
 */
function safeTimeZone(timeZone) {
  const zone = String(timeZone || "").trim();
  if (!zone) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", {timeZone: zone}).format(0);
    return zone;
  } catch (_) {
    return DEFAULT_TIME_ZONE;
  }
}

/**
 * @param {number} ms A moment.
 * @param {string} timeZone An IANA zone.
 * @return {string} Its YYYY-MM-DD in that zone.
 */
function dateKeyIn(ms, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {timeZone: safeTimeZone(
      timeZone), year: "numeric", month: "2-digit", day: "2-digit"})
      .formatToParts(new Date(ms));
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * The dates a window touches: one, or two across midnight.
 *
 * @param {number} atMs The payment's time.
 * @param {number} windowMinutes The window.
 * @param {string} timeZone The business's zone.
 * @return {Set<string>} YYYY-MM-DD keys.
 */
function windowDateKeys(atMs, windowMinutes, timeZone) {
  const span = windowMinutes * 60 * 1000;
  return new Set([dateKeyIn(atMs - span, timeZone), dateKeyIn(atMs, timeZone),
    dateKeyIn(atMs + span, timeZone)]);
}

/**
 * @param {object} credit A stored credit.
 * @return {boolean} True once it confirmed something.
 */
function creditConsumed(credit) {
  const by = credit?.consumedBy;
  return Boolean(by && typeof by === "object" && by.id);
}

/**
 * Whether a stored credit can be this payment.
 *
 * @param {object} credit A stored credit.
 * @param {object} ctx {amountCents, atMs, windowMinutes, accountId,
 *   timeZone, consumedByMe?: {kind, id}}.
 * @return {?string} null when eligible, else why not.
 */
function creditIneligibility(credit, ctx) {
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
  if (!Number.isFinite(ctx.atMs)) return "no_payment_time";
  const span = ctx.windowMinutes * 60 * 1000;
  if (Number.isFinite(credit.atMs) && credit.atMs !== null) {
    return Math.abs(credit.atMs - ctx.atMs) <= span ? null : "outside_window";
  }
  if (credit.dateKey &&
      windowDateKeys(ctx.atMs, ctx.windowMinutes, ctx.timeZone)
          .has(credit.dateKey)) {
    return null;
  }
  return "outside_window";
}

/**
 * @param {object} credit A stored credit.
 * @return {boolean} True when the bank gave a time, not just a date.
 */
function creditTimed(credit) {
  return Number.isFinite(credit?.atMs) && credit.atMs !== null;
}

/**
 * The deposits that could be this payment, closest in time first.
 *
 * @param {object} ctx See creditIneligibility.
 * @param {Array<object>} credits Stored credits, each with `id` (doc id).
 * @return {Array<object>} The eligible ones.
 */
function zelleCandidates(ctx, credits) {
  const gap = (c) => creditTimed(c) ? Math.abs(c.atMs - ctx.atMs) :
    Number.MAX_SAFE_INTEGER;
  return (credits || [])
      .filter((credit) => creditIneligibility(credit, ctx) === null)
      .sort((a, b) => gap(a) - gap(b) || String(a.id).localeCompare(b.id));
}

/**
 * @param {Array<object>} candidates From zelleCandidates.
 * @return {object} {result: "confirmed", credit} | {result: "choose",
 *   candidates} | {result: "not_found"}.
 */
function zelleOutcome(candidates) {
  const list = candidates || [];
  if (list.length === 0) return {result: "not_found"};
  if (list.length === 1 && creditTimed(list[0])) {
    return {result: "confirmed", credit: list[0]};
  }
  return {result: "choose", candidates: list};
}

/**
 * The best time to show for a credit: its bank time, or (date only) noon of
 * its date in UTC, flagged with timeKnown false so screens show the date.
 *
 * @param {object} credit A stored credit.
 * @return {object} {atMs, timeKnown}.
 */
function shownTime(credit) {
  if (creditTimed(credit)) return {atMs: credit.atMs, timeKnown: true};
  const ms = credit?.dateKey ? Date.parse(`${credit.dateKey}T12:00:00Z`) : NaN;
  return {atMs: Number.isFinite(ms) ? ms : null, timeKnown: false};
}

/**
 * What staff see of a candidate: no balance, no other line text.
 *
 * @param {object} credit A stored credit with `id`.
 * @return {object} {creditId, atMs, timeKnown, senderName, pending}.
 */
function candidateView(credit) {
  return {creditId: String(credit.id), ...shownTime(credit),
    senderName: String(credit.senderName || ""),
    pending: credit.pending === true};
}

/**
 * @param {object} credit A stored credit.
 * @param {string} institutionName The connected bank's name.
 * @return {object} {amountCents, atMs, timeKnown, senderName,
 *   institutionName, pending}.
 */
function confirmationOf(credit, institutionName) {
  return {amountCents: credit.amountCents, ...shownTime(credit),
    senderName: String(credit.senderName || ""),
    institutionName: String(institutionName || ""),
    pending: credit.pending === true};
}

/**
 * The `bankCheck` a confirmed record carries (checkedAt added by the
 * caller as a server timestamp).
 *
 * @param {object} input {credit (with id), institutionName, uid}.
 * @return {object} The block.
 */
function confirmedBankCheck(input) {
  const shown = shownTime(input.credit);
  return {status: "confirmed", creditId: String(input.credit.id),
    amountCents: input.credit.amountCents, atMs: shown.atMs,
    timeKnown: shown.timeKnown,
    senderName: String(input.credit.senderName || ""),
    institutionName: String(input.institutionName || ""),
    checkedByUid: input.uid};
}

/**
 * @param {?object} bankCheck A record's bankCheck.
 * @return {?object} Its confirmation view, or null when not confirmed.
 */
function confirmationFromBankCheck(bankCheck) {
  if (!bankCheck || bankCheck.status !== "confirmed") return null;
  return {amountCents: bankCheck.amountCents, atMs: bankCheck.atMs ?? null,
    timeKnown: bankCheck.timeKnown !== false,
    senderName: String(bankCheck.senderName || ""),
    institutionName: String(bankCheck.institutionName || "")};
}

/**
 * Why a check cannot use the bank right now, or null.
 *
 * @param {?object} link The stored link.
 * @return {?string} bank_not_connected or bank_needs_reauth.
 */
function linkRefusal(link) {
  if (!link || !link.itemId || !link.accessTokenEnc ||
      link.status === "disconnected" || !link.status) {
    return "bank_not_connected";
  }
  if (link.status === "needs_reauth") return "bank_needs_reauth";
  return null;
}

/**
 * What getBusinessBankStatus answers. Staff never see the bank's name or
 * the account; nobody ever sees the token, the cursor or a balance.
 *
 * @param {?object} link The stored link.
 * @param {string} role From bankRoleOf ("owner" or "staff").
 * @return {object} The view.
 */
function bankStatusView(link, role) {
  const connected = Boolean(link && link.itemId && link.status &&
    link.status !== "disconnected");
  const status = connected ? String(link.status) : "disconnected";
  const view = {connected, status, windowMinutes: windowMinutesOf(link)};
  if (role !== "owner") return view;
  return {...view,
    institutionName: connected ? String(link.institutionName || "") : "",
    accountMask: connected ? String(link.accountMask || "") : "",
    accountName: connected ? String(link.accountName || "") : "",
    lastSyncAt: connected ? millisOf(link.lastSyncAt) : null,
    lastErrorCode: connected && link.lastErrorCode ?
      String(link.lastErrorCode) : null};
}

/**
 * @param {*} lastRefreshAt The link's lastRefreshAt.
 * @param {number} nowMs Now.
 * @return {boolean} True when Plaid may be asked to refresh again.
 */
function refreshDue(lastRefreshAt, nowMs) {
  const last = millisOf(lastRefreshAt);
  return last === null || nowMs - last >= REFRESH_THROTTLE_MS;
}

/**
 * @param {string} kind A KINDS key.
 * @param {string} id The record's id.
 * @return {string} The record's key in the link's lastRefreshAtByRecord.
 */
function refreshRecordKey(kind, id) {
  return `${kind}:${id}`;
}

/**
 * Whether this check may ask Plaid to refresh (billed). Pure.
 *
 * A record refreshed less than RECORD_REFRESH_WINDOW_MS ago is not
 * refreshed again; otherwise the business-wide throttle (refreshDue)
 * decides; then the owner's monthly limit of paid refreshes (when given):
 * once the month's refreshes reach it, checks only sync. `marks` comes back
 * without the expired entries (and with this record's mark when it
 * refreshes), so the stored map stays a handful of keys: write it back only
 * when `refresh` is true.
 *
 * @param {object} input {lastRefreshAt (the link's), marks (the link's
 *   lastRefreshAtByRecord), recordKey, nowMs, monthRefreshes? (this
 *   month's paid refreshes), monthlyLimit? (the owner's limit; absent: no
 *   limit)}.
 * @return {object} {refresh, reason: "due" | "record_recent" |
 *   "business_throttle" | "monthly_limit", marks}.
 */
function refreshPlan(input) {
  const nowMs = Number(input.nowMs);
  const stored = input.marks && typeof input.marks === "object" &&
    !Array.isArray(input.marks) ? input.marks : {};
  const marks = {};
  for (const [key, value] of Object.entries(stored)) {
    const ms = millisOf(value);
    if (ms !== null && nowMs - ms < RECORD_REFRESH_WINDOW_MS) marks[key] = ms;
  }
  const key = String(input.recordKey || "");
  if (Object.prototype.hasOwnProperty.call(marks, key)) {
    return {refresh: false, reason: "record_recent", marks};
  }
  if (!refreshDue(input.lastRefreshAt, nowMs)) {
    return {refresh: false, reason: "business_throttle", marks};
  }
  if (Number.isInteger(input.monthlyLimit) &&
      Math.max(0, Number(input.monthRefreshes) || 0) >= input.monthlyLimit) {
    return {refresh: false, reason: "monthly_limit", marks};
  }
  marks[key] = nowMs;
  return {refresh: true, reason: "due", marks};
}

/**
 * The account Zelle checks read: the one the owner picked when it is a
 * depository account, else the login's first depository account.
 *
 * @param {Array<object>} accounts Plaid's /accounts/get accounts.
 * @param {string} accountId What the owner picked in Link, if anything.
 * @return {?object} The account, or null when there is none.
 */
function pickDepositoryAccount(accounts, accountId) {
  const list = (Array.isArray(accounts) ? accounts : [])
      .filter((a) => a && a.type === "depository" && a.account_id);
  const wanted = String(accountId || "").trim();
  return (wanted && list.find((a) => a.account_id === wanted)) ||
    list[0] || null;
}

/**
 * @param {*} value A client's platform.
 * @return {?string} "ios" | "android" | "web", or null.
 */
function cleanPlatform(value) {
  const p = String(value || "").trim().toLowerCase();
  return ["ios", "android", "web"].includes(p) ? p : null;
}

/**
 * @param {*} value A client's kind.
 * @return {?string} A KINDS key, or null.
 */
function cleanKind(value) {
  const kind = String(value || "").trim();
  return Object.prototype.hasOwnProperty.call(KINDS, kind) ? kind : null;
}

/**
 * @param {*} value A record or credit id from a client.
 * @return {string} It trimmed, "" when empty or holding a slash.
 */
function cleanDocId(value) {
  const id = String(value ?? "").trim();
  return !id || id.includes("/") || id.length > 300 ? "" : id;
}

module.exports = {
  BANK_REFUSALS,
  DEFAULT_TIME_ZONE,
  DEFAULT_WINDOW_MINUTES,
  KINDS,
  MAX_CANDIDATE_READ,
  MAX_WINDOW_MINUTES,
  MIN_WINDOW_MINUTES,
  RECORD_REFRESH_WINDOW_MS,
  REFRESH_THROTTLE_MS,
  bankRefusalKind,
  bankRefusalMessage,
  bankRoleOf,
  bankStatusView,
  candidateView,
  checkAccessPlan,
  checkRecordRefusal,
  cleanDocId,
  cleanKind,
  cleanPlatform,
  cleanWindowMinutes,
  confirmationFromBankCheck,
  confirmationOf,
  confirmedBankCheck,
  creditConsumed,
  creditIneligibility,
  dateKeyIn,
  linkRefusal,
  millisOf,
  paymentOfRecord,
  pickDepositoryAccount,
  refreshDue,
  refreshPlan,
  refreshRecordKey,
  safeTimeZone,
  shownTime,
  windowDateKeys,
  windowMinutesOf,
  zelleCandidates,
  zelleOutcome,
};
