"use strict";

/**
 * Phone accounts (docs/PHONE_ACCOUNTS.md).
 *
 * The pure half - which fields of which record hold whose number, the
 * derived fields a record should carry, the private projection, the paging
 * of "My packages", the rate-limit arithmetic - is exported on its own and
 * unit-tested (test/phone-accounts.test.js). `createPhoneAccounts(deps)`
 * builds the Firestore/Auth half; everything Firebase-specific arrives
 * through `deps`, the way volume_rollup.js does, so index.js keeps one short
 * export per function and the emulator suite
 * (test/phone-accounts-callables.test.js) drives the real handlers.
 */

const crypto = require("crypto");
const {HttpsError} = require("firebase-functions/v2/https");
const {
  STATUS: PHONE_STATUS,
  callingCodeOf,
  digitsOf,
  lastTwo,
  loginLanguage,
  regionIsoForCountry,
  sameNumber,
  strictE164,
  toE164,
} = require("./phone_e164");

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

const ROLE = Object.freeze({SENDER: "sender", RECEIVER: "receiver"});

/**
 * Which field of each record holds whose number. `raw` is the field staff
 * and customers write; `e164` the derived field we add (absent for package
 * requests, whose stored numbers are already strict E.164); `name` where the
 * person's name is, for the account's display name.
 */
const PHONE_RECORD_SOURCES = Object.freeze({
  containerLines: Object.freeze([
    {role: ROLE.SENDER, raw: "customerPhone", e164: "customerPhoneE164",
      name: ["customerName"]},
    {role: ROLE.RECEIVER, raw: "receiverPhone", e164: "receiverPhoneE164",
      name: ["receiverName"]},
  ]),
  barrelShipments: Object.freeze([
    {role: ROLE.SENDER, raw: "customerPhone", e164: "customerPhoneE164",
      name: ["senderName", "customerName"]},
    {role: ROLE.RECEIVER, raw: "receiverPhone", e164: "receiverPhoneE164",
      name: ["receiverName"]},
  ]),
  freightShipments: Object.freeze([
    {role: ROLE.SENDER, raw: "customerPhone", e164: "customerPhoneE164",
      name: ["senderName", "customerName"]},
    {role: ROLE.RECEIVER, raw: "receiverPhone", e164: "receiverPhoneE164",
      name: ["receiverName"]},
  ]),
  transportRequests: Object.freeze([
    {role: ROLE.SENDER, raw: "customerPhone", e164: "customerPhoneE164",
      name: ["customerName"]},
  ]),
  parkedCars: Object.freeze([
    {role: ROLE.SENDER, raw: "customerPhone", e164: "customerPhoneE164",
      name: ["customerName", "ownerName"]},
  ]),
  freightQuoteRequests: Object.freeze([
    {role: ROLE.SENDER, raw: "customerPhone", e164: "customerPhoneE164",
      name: ["customerName"]},
  ]),
  packageRequests: Object.freeze([
    {role: ROLE.SENDER, raw: "sender.phoneE164", e164: "",
      query: "sender.phoneE164", name: ["sender.name"]},
    {role: ROLE.RECEIVER, raw: "receiver.phoneE164", e164: "",
      query: "receiver.phoneE164", name: ["receiver.name"]},
  ]),
});

const PHONE_COLLECTIONS = Object.freeze(Object.keys(PHONE_RECORD_SOURCES));
// Collections a client may create directly while their trigger fires on
// update only: the hourly sweep stamps what those creates missed (§3.1).
// (containerLines and parkedCars have write triggers; quote and package
// requests are created by callables only.)
const SWEPT_COLLECTIONS = Object.freeze([
  "barrelShipments", "freightShipments", "transportRequests",
]);

// Derived fields: server-written only.
const DERIVED = Object.freeze({
  MISSING: "phoneCountryCodeMissing",
  REPORTED: "phoneReportedNotMine",
  SYNCED_AT: "phoneSyncedAt",
});

// One phone = one account, under concurrency (docs §4.1). Firebase Auth's
// phone uniqueness is NOT a lock: in production two trigger runs of one
// parked car made two Auth users and two profiles for one number at the
// same moment. `phoneAccountClaims/{e164}` (server only) is: whoever
// creates it makes the account; everyone else waits for its uid.
const CLAIMS_COLLECTION = "phoneAccountClaims";
// A claim still without a uid after this is a run that died: taken over.
const CLAIM_STALE_MS = 60 * 1000;
// How long a run waits for another run's claim (about 5 s in all) before
// leaving the number unstamped for the next write or the sweep.
const CLAIM_WAITS_MS = Object.freeze([150, 300, 500, 800, 1200, 2000]);

/**
 * @param {object} data A record.
 * @param {string} dotted "a.b".
 * @return {*} The value.
 */
function pathValue(data, dotted) {
  return String(dotted).split(".").reduce(
      (value, key) => value && typeof value === "object" ?
        value[key] : undefined, data);
}

const cleanText = (value, max = 120) =>
  String(value ?? "").trim().slice(0, max);

/**
 * @param {object} data A record.
 * @param {object} source A PHONE_RECORD_SOURCES entry.
 * @return {string} The person's name on it, or "".
 */
function nameOn(data, source) {
  for (const path of source.name || []) {
    const value = cleanText(pathValue(data, path));
    if (value) return value;
  }
  return "";
}

/**
 * Whether a record's number needs the business's country to be read.
 *
 * @param {string} collection The collection.
 * @param {object} data The record.
 * @return {boolean} True when some raw number has no country code.
 */
function needsRegion(collection, data) {
  return (PHONE_RECORD_SOURCES[collection] || []).some((source) =>
    source.e164 && toE164(pathValue(data, source.raw)).status ===
      PHONE_STATUS.NEEDS_COUNTRY_CODE);
}

/**
 * What a record's numbers are, role by role.
 *
 * @param {string} collection The collection.
 * @param {object} data The record.
 * @param {string} regionIso The business's country (for local numbers).
 * @return {Array<object>} {role, raw, e164Field, status, e164, name}.
 */
function recordPhones(collection, data, regionIso = "") {
  const row = data && typeof data === "object" ? data : {};
  return (PHONE_RECORD_SOURCES[collection] || []).map((source) => {
    const raw = pathValue(row, source.raw);
    const parsed = source.e164 ? toE164(raw, {regionIso}) :
      {status: strictE164(raw) ? PHONE_STATUS.OK :
        (String(raw ?? "").trim() ? PHONE_STATUS.INVALID :
          PHONE_STATUS.EMPTY), e164: strictE164(raw)};
    return {
      role: source.role,
      raw: source.raw,
      e164Field: source.e164,
      queryField: source.query || source.e164,
      status: parsed.status,
      e164: parsed.e164,
      name: nameOn(row, source),
    };
  });
}

const sameList = (left, right) =>
  JSON.stringify([...(left || [])].sort()) ===
  JSON.stringify([...(right || [])].sort());

/**
 * The derived fields a record should carry, as a minimal change set - empty
 * when the record already carries them (so a stamp re-fired by its own write
 * changes nothing). `null` means "delete the field".
 *
 * @param {string} collection The collection.
 * @param {object} data The record as stored.
 * @param {string} regionIso The business's country.
 * @return {{changes: object, newNumbers: Array<object>}} newNumbers: the
 *   numbers that appeared or changed (they need an account).
 */
function recordPhonePatch(collection, data, regionIso = "") {
  const row = data && typeof data === "object" ? data : {};
  const phones = recordPhones(collection, row, regionIso);
  const changes = {};
  const newNumbers = [];
  const stamped = phones.filter((phone) => phone.e164Field);
  if (!stamped.length) return {changes, newNumbers};
  const missing = [];
  const changedRaw = new Set();
  for (const phone of stamped) {
    const stored = cleanText(row[phone.e164Field], 20);
    if (phone.status === PHONE_STATUS.NEEDS_COUNTRY_CODE) {
      missing.push(phone.raw);
    }
    if (stored !== phone.e164) {
      changes[phone.e164Field] = phone.e164 || null;
      changedRaw.add(phone.raw);
      if (phone.e164) newNumbers.push(phone);
    }
  }
  const storedMissing = Array.isArray(row[DERIVED.MISSING]) ?
    row[DERIVED.MISSING] : [];
  if (!sameList(storedMissing, missing)) {
    changes[DERIVED.MISSING] = missing.length ? missing : null;
  }
  // A report of "this isn't mine" is about the number that was there: a new
  // number starts clean.
  const reported = Array.isArray(row[DERIVED.REPORTED]) ?
    row[DERIVED.REPORTED] : [];
  const keptReports = reported.filter((field) => !changedRaw.has(field));
  if (keptReports.length !== reported.length) {
    changes[DERIVED.REPORTED] = keptReports.length ? keptReports : null;
  }
  return {changes, newNumbers};
}

/**
 * Numbers on a record that should have an account, whatever is stamped.
 *
 * @param {string} collection The collection.
 * @param {object} data The record.
 * @param {string} regionIso The business's country.
 * @return {Array<object>} recordPhones entries with an e164.
 */
function accountNumbers(collection, data, regionIso = "") {
  return recordPhones(collection, data, regionIso)
      .filter((phone) => phone.e164);
}

/**
 * The trigger's free first question: do the record's derived fields already
 * describe its raw numbers? Pure - no read of any kind - so the events that
 * a stamp re-fires, and every write that leaves the numbers alone, stop here.
 *
 * A number without a country code can only be judged with the business's
 * country (a read). It counts as current only when it did not change in
 * this write (`before` given, same raw) and the record carries what that
 * country can give: the NANP form of it, or the "Add the country code" flag.
 * Anything else answers false and goes the full way (recordPhonePatch).
 *
 * @param {string} collection The collection.
 * @param {object} after The record as written.
 * @param {object|null|undefined} before The record before this write (null:
 *   created; undefined: unknown).
 * @return {boolean} True when there is nothing to stamp.
 */
function stampIsCurrent(collection, after, before) {
  const row = after && typeof after === "object" ? after : {};
  const prior = before && typeof before === "object" ? before : null;
  const sources = (PHONE_RECORD_SOURCES[collection] || [])
      .filter((source) => source.e164);
  if (!sources.length) return true;
  const expectedMissing = [];
  for (const source of sources) {
    const raw = pathValue(row, source.raw);
    const stored = cleanText(row[source.e164], 20);
    const parsed = toE164(raw);
    if (parsed.status === PHONE_STATUS.OK) {
      if (stored !== parsed.e164) return false;
      continue;
    }
    if (parsed.status !== PHONE_STATUS.NEEDS_COUNTRY_CODE) {
      if (stored) return false;
      continue;
    }
    if (!prior || pathValue(prior, source.raw) !== raw) return false;
    if (stored) {
      if (toE164(raw, {regionIso: "US"}).e164 !== stored) return false;
    } else {
      expectedMissing.push(source.raw);
    }
  }
  const storedMissing = Array.isArray(row[DERIVED.MISSING]) ?
    row[DERIVED.MISSING] : [];
  return sameList(storedMissing, expectedMissing);
}

// A record younger than this is synced on any write: what a client created
// directly (no create trigger) and numbers whose account failed get another
// try. Older records are synced when a number changes (docs §3.2).
const RECENT_RECORD_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a trigger event should do phone work at all (after
 * stampIsCurrent said the stamp is stale). Pure.
 *
 * Yes for: a new record, a number changed by this write, a record already
 * synced once (its stamp went stale: a failed account, a country fix), a
 * record created in the last RECENT_RECORD_MS, or an event without its
 * `before` (unknown). No for an OLD record never synced whose numbers this
 * write did not touch: a burst of status updates on old parked cars or
 * barrels must not make accounts, users/ profiles and a second write per
 * event (2026-10 incident: the 20-vCPU quota ran out). The backfill (§11)
 * covers those records.
 *
 * @param {string} collection The collection.
 * @param {object} after The record as written.
 * @param {object|null|undefined} before The record before (null: created;
 *   undefined: unknown).
 * @param {number} nowMs Now.
 * @return {boolean} True when the event should sync the record's phones.
 */
function phoneEventNeedsSync(collection, after, before, nowMs) {
  if (before === undefined || before === null) return true;
  const row = after && typeof after === "object" ? after : {};
  const sources = PHONE_RECORD_SOURCES[collection] || [];
  if (sources.some((source) =>
    String(pathValue(row, source.raw) ?? "") !==
      String(pathValue(before, source.raw) ?? ""))) {
    return true;
  }
  const synced = Boolean(row[DERIVED.SYNCED_AT]) ||
    Array.isArray(row[DERIVED.MISSING]) ||
    sources.some((source) => source.e164 && cleanText(row[source.e164]));
  if (synced) return true;
  const createdMs = millisOf(row.createdAt);
  return createdMs > 0 && nowMs - createdMs < RECENT_RECORD_MS;
}

// ---------------------------------------------------------------------------
// Login codes
// ---------------------------------------------------------------------------

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const RESEND_AFTER_MS = 30 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/**
 * Every WhatsApp code costs money, so beyond the per-number, per-address and
 * per-tracking-code limits the whole platform and each calling code have a
 * daily ceiling. Hitting one is logged as an error (an alert): it means
 * abuse, or real growth that needs a higher cap.
 */
const GLOBAL_SENDS_PER_DAY = 3000;
const COUNTRY_SENDS_PER_DAY = 600;
// Limits whose exhaustion is an alert, not one caller being refused.
const ALERT_LIMIT_KINDS = Object.freeze(["global_day", "country_day"]);

/**
 * @param {*} value A tracking code as typed ("cl-k7m 4p2").
 * @return {string} The one key every spelling of it shares ("CLK7M4P2").
 */
function trackingLimitKey(value) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "")
      .slice(0, 40);
}

/**
 * Send limits (docs/PHONE_ACCOUNTS.md §5.1).
 *
 * @param {{phone: string, ip: string, trackingCode: string,
 *   callingCode: string}} keys Who. ip is already a bucket
 *   (request_guard.addressBucket: IPv6 by its /64).
 * @return {Array<{kind, key, limit, windowMs}>} The buckets to consume.
 */
function loginSendLimits({phone, ip, trackingCode, callingCode}) {
  const limits = [
    {kind: "phone_hour", key: phone, limit: 5, windowMs: HOUR_MS},
    {kind: "phone_day", key: phone, limit: 10, windowMs: DAY_MS},
  ];
  if (ip) limits.push({kind: "ip_hour", key: ip, limit: 20, windowMs: HOUR_MS});
  const tracking = trackingLimitKey(trackingCode);
  if (tracking) {
    limits.push({kind: "tracking_hour", key: tracking, limit: 5,
      windowMs: HOUR_MS});
  }
  if (callingCode) {
    limits.push({kind: "country_day", key: callingCode,
      limit: COUNTRY_SENDS_PER_DAY, windowMs: DAY_MS});
  }
  limits.push({kind: "global_day", key: "all", limit: GLOBAL_SENDS_PER_DAY,
    windowMs: DAY_MS});
  return limits;
}

/**
 * @param {string} kind A bucket kind.
 * @param {string} key Its key.
 * @return {string} The bucket's document id (the key is never stored).
 */
function limitDocId(kind, key) {
  return crypto.createHash("sha256").update(`${kind}:${key}`)
      .digest("hex");
}

/**
 * One bucket's verdict.
 *
 * @param {object|null} stored {count, windowStartMs, lastAtMs}.
 * @param {object} limit A loginSendLimits entry.
 * @param {number} nowMs Now.
 * @param {number} resendAfterMs Minimum gap between two sends (0: none).
 * @return {{allowed: boolean, retryAfterMs: number, next: object}} next is
 *   what to store when every bucket allows.
 */
function limitDecision(stored, limit, nowMs, resendAfterMs = 0) {
  const start = Number(stored?.windowStartMs || 0);
  const active = start > 0 && nowMs - start < limit.windowMs;
  const count = active ? Number(stored?.count || 0) : 0;
  const lastAt = Number(stored?.lastAtMs || 0);
  if (resendAfterMs > 0 && lastAt > 0 && nowMs - lastAt < resendAfterMs) {
    return {allowed: false, retryAfterMs: resendAfterMs - (nowMs - lastAt),
      next: null};
  }
  if (count >= limit.limit) {
    return {allowed: false, retryAfterMs: start + limit.windowMs - nowMs,
      next: null};
  }
  return {allowed: true, retryAfterMs: 0, next: {
    count: count + 1,
    windowStartMs: active ? start : nowMs,
    lastAtMs: nowMs,
  }};
}

/**
 * @param {string} challengeId The challenge.
 * @param {string} code The six digits.
 * @return {string} What is stored instead of the code.
 */
function codeHash(challengeId, code) {
  return crypto.createHash("sha256")
      .update(`${challengeId}:${String(code || "").trim()}`).digest("hex");
}

/**
 * @param {string} left A hex hash.
 * @param {string} right A hex hash.
 * @return {boolean} Equal, in constant time.
 */
function hashesEqual(left, right) {
  const a = Buffer.from(String(left || ""), "hex");
  const b = Buffer.from(String(right || ""), "hex");
  return a.length === b.length && a.length > 0 &&
    crypto.timingSafeEqual(a, b);
}

/**
 * What a code attempt does to its challenge.
 *
 * @param {object|null} challenge The stored challenge.
 * @param {string} code What was typed.
 * @param {string} challengeId Its id.
 * @param {number} nowMs Now.
 * @return {{outcome: string, attemptsLeft: number, update: ?Object}}
 *   outcome: ok | code_wrong | code_expired | too_many_attempts |
 *   challenge_not_found.
 */
function codeAttempt(challenge, code, challengeId, nowMs) {
  if (!challenge || challenge.status === "used" ||
      challenge.status === "unsent") {
    return {outcome: "challenge_not_found", attemptsLeft: 0, update: null};
  }
  const attempts = Number(challenge.attempts || 0);
  if (challenge.status === "locked" || attempts >= MAX_CODE_ATTEMPTS) {
    return {outcome: "too_many_attempts", attemptsLeft: 0, update: null};
  }
  if (nowMs > Number(challenge.expiresAtMs || 0)) {
    return {outcome: "code_expired", attemptsLeft: 0, update: null};
  }
  const typed = String(code || "").replace(/\s/g, "");
  if (/^\d{6}$/.test(typed) &&
      hashesEqual(codeHash(challengeId, typed), challenge.codeHash)) {
    return {outcome: "ok", attemptsLeft: MAX_CODE_ATTEMPTS - attempts,
      update: {status: "used", usedAtMs: nowMs}};
  }
  const next = attempts + 1;
  return {
    outcome: next >= MAX_CODE_ATTEMPTS ? "too_many_attempts" : "code_wrong",
    attemptsLeft: Math.max(0, MAX_CODE_ATTEMPTS - next),
    update: {attempts: next,
      ...(next >= MAX_CODE_ATTEMPTS ? {status: "locked"} : {})},
  };
}

/**
 * @return {string} Six random digits.
 */
function newLoginCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

// ---------------------------------------------------------------------------
// My packages
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;

/**
 * Every query "My packages" runs, one per collection and role.
 *
 * @return {Array<{collection, role, field, raw}>} The sources.
 */
function shipmentQueries() {
  const out = [];
  for (const collection of PHONE_COLLECTIONS) {
    for (const source of PHONE_RECORD_SOURCES[collection]) {
      out.push({collection, role: source.role,
        field: source.query || source.e164, raw: source.raw});
    }
  }
  return out;
}

/**
 * @param {*} value A Firestore Timestamp, Date, millis or nothing.
 * @return {number} Millis, 0 when absent.
 */
function millisOf(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value.seconds === "number") return value.seconds * 1000;
  return 0;
}

/**
 * @param {*} raw The client's cursor.
 * @return {{beforeMs: number, skipKeys: string[]}|null} A clean cursor.
 */
function parseCursor(raw) {
  if (!raw || typeof raw !== "object") return null;
  const beforeMs = Number(raw.beforeMs);
  if (!Number.isFinite(beforeMs) || beforeMs <= 0) return null;
  const skipKeys = Array.isArray(raw.skipKeys) ?
    raw.skipKeys.map((key) => cleanText(key, 300)).filter(Boolean)
        .slice(0, 100) : [];
  return {beforeMs: Math.trunc(beforeMs), skipKeys};
}

/**
 * @param {string} key "<collection>/<id>".
 * @return {{collection: string, id: string}|null} Its parts when the
 *   collection is a phone source.
 */
function parseRecordKey(key) {
  const match = /^([A-Za-z]+)\/([A-Za-z0-9_-]{1,200})$/.exec(
      cleanText(key, 300));
  if (!match || !PHONE_RECORD_SOURCES[match[1]]) return null;
  return {collection: match[1], id: match[2]};
}

/**
 * @param {string} key "<collection>/<id>".
 * @return {string} The id of its hiddenShipments document.
 */
function hiddenDocId(key) {
  return String(key).replace("/", "__");
}

/**
 * Whether a candidate row still belongs to this number and should show.
 *
 * @param {object} candidate {collection, role, raw, data}.
 * @param {string} e164 The account's number.
 * @return {boolean} True when it shows.
 */
function candidateShows(candidate, e164) {
  const data = candidate.data || {};
  const raw = pathValue(data, candidate.raw);
  if (candidate.collection === "packageRequests") {
    // A received request is a container line now; that line stands for it.
    if (String(data.status || "") === "received" || cleanText(data.lineId)) {
      return false;
    }
    return strictE164(raw) === e164;
  }
  return sameNumber(raw, e164);
}

/**
 * Merges the per-source query results into one page, newest first.
 *
 * @param {Array<object>} candidates {key, collection, id, role, raw, data,
 *   createdAtMs} from every source (each source at most `limit` rows).
 * @param {object} options {e164, cursor, hidden: Set<string>, pageSize,
 *   sourceFull: boolean}.
 * @return {{rows: Array<object>, nextCursor: ?Object}} rows carry
 *   `roles`; one row per record.
 */
function mergeShipmentPage(candidates, options) {
  const pageSize = options.pageSize || PAGE_SIZE;
  const skip = new Set(options.cursor?.skipKeys || []);
  const byKey = new Map();
  for (const candidate of candidates) {
    if (skip.has(candidate.key)) continue;
    if (options.hidden?.has(candidate.key)) continue;
    if (!candidateShows(candidate, options.e164)) continue;
    const existing = byKey.get(candidate.key);
    if (existing) {
      if (!existing.roles.includes(candidate.role)) {
        existing.roles.push(candidate.role);
      }
      continue;
    }
    byKey.set(candidate.key, {...candidate, roles: [candidate.role]});
  }
  const sorted = [...byKey.values()].sort((a, b) =>
    (b.createdAtMs - a.createdAtMs) || a.key.localeCompare(b.key));
  const rows = sorted.slice(0, pageSize).map((row) => ({
    ...row,
    // Sender first: a person who sends to themselves sees it as theirs.
    role: row.roles.includes(ROLE.SENDER) ? ROLE.SENDER : ROLE.RECEIVER,
  }));
  const more = sorted.length > pageSize || options.sourceFull === true;
  if (!more || !rows.length) return {rows, nextCursor: null};
  const last = rows[rows.length - 1].createdAtMs;
  const sameMs = rows.filter((row) => row.createdAtMs === last)
      .map((row) => row.key);
  const carried = options.cursor && options.cursor.beforeMs === last ?
    options.cursor.skipKeys : [];
  return {rows, nextCursor: {beforeMs: last,
    skipKeys: [...new Set([...carried, ...sameMs])].slice(0, 100)}};
}

/**
 * What "My packages" shows of a record: the guest-tracking projection (what
 * the WhatsApp link already shows) without any money, plus who it is from.
 *
 * @param {object} publicRecord publicGuestTrackingRecord output.
 * @param {object} row {key, role, roles, collection, data, createdAtMs}.
 * @param {string} businessName The business's name.
 * @return {object} The item.
 */
function privateShipmentItem(publicRecord, row, businessName) {
  const record = {...(publicRecord || {})};
  delete record.payment;
  delete record.signIn;
  if (Array.isArray(record.parts)) {
    record.parts = record.parts.map((part) => ({
      trackingCode: cleanText(part.trackingCode, 60),
      stage: cleanText(part.stage, 40),
      pieceCount: Number(part.pieceCount) || 0,
    }));
  }
  return {
    key: row.key,
    collection: row.collection,
    role: row.role,
    roles: row.roles,
    businessId: cleanText(row.data?.businessId, 128),
    businessName: cleanText(businessName, 120),
    ...record,
    createdAtMs: row.createdAtMs,
  };
}

/**
 * A package request in "My packages" (it is not a guest-tracking record).
 *
 * @param {object} data The request.
 * @param {string} id Its id.
 * @return {object} The guest-style projection: no prices, no pieces' words.
 */
function packageRequestPublicRecord(data, id) {
  const status = cleanText(data?.status, 40);
  const stage = ["declined", "customer_declined", "cancelled", "expired"]
      .includes(status) ? "cancelled" :
    status === "confirmed" ? "booked" : "requested";
  return {
    trackingCode: cleanText(data?.code || id, 60),
    service: "package_request",
    stage,
    requestStatus: status,
    pieceCount: Array.isArray(data?.pieces) ? data.pieces.length : 0,
    updatedAtMs: Math.max(millisOf(data?.updatedAt), millisOf(data?.createdAt)),
  };
}

/**
 * Who may be merged into another account: made from a record and never
 * signed in, with nothing but the phone on its Auth user.
 *
 * @param {object|null} profile users/{uid}.
 * @param {object|null} authUser The Auth user.
 * @return {boolean} True for a placeholder.
 */
function isPlaceholderAccount(profile, authUser) {
  if (!profile || profile.accountOrigin !== "shipment") return false;
  if (profile.firstSignInAt) return false;
  if (!authUser) return true;
  if (cleanText(authUser.email)) return false;
  const providers = (authUser.providerData || [])
      .map((entry) => entry?.providerId).filter(Boolean);
  return providers.every((provider) => provider === "phone");
}

/**
 * Phone-code sign-in and linking are for customers only (the rule
 * syncVerifiedCustomerPhone already applies): anyone with business or
 * platform access signs in with their email and password.
 *
 * @param {object|null} profile users/{uid}, or null when there is none yet
 *   (a new customer).
 * @return {boolean} True when a phone code may sign in to / link this
 *   account.
 */
function phoneSignInAllowed(profile) {
  if (!profile) return true;
  const role = cleanText(profile.role, 40);
  if (role && role !== "customer") return false;
  if (profile.platformAdmin === true || cleanText(profile.adminRole, 40)) {
    return false;
  }
  if (cleanText(profile.businessId, 128)) return false;
  if (Array.isArray(profile.businessPermissions) &&
      profile.businessPermissions.length > 0) {
    return false;
  }
  return true;
}

const PROOF_MAX_AGE_SECONDS = 5 * 60;

/**
 * Whether a placeholder's phone ID token proves the number now (§7).
 *
 * @param {object} decoded verifyIdToken output (revocation checked).
 * @param {{e164: string, holderUid: string, nowMs: number}} expected The
 *   number being merged and who holds it now.
 * @return {boolean} True when the token is a fresh phone sign-in of that
 *   number by its current holder.
 */
function proofAcceptable(decoded, {e164, holderUid, nowMs}) {
  if (!decoded || decoded.firebase?.sign_in_provider !== "phone") {
    return false;
  }
  if (strictE164(decoded.phone_number) !== e164 || !e164) return false;
  if (!holderUid || decoded.uid !== holderUid) return false;
  const authTime = Number(decoded.auth_time);
  if (!Number.isFinite(authTime)) return false;
  const age = nowMs / 1000 - authTime;
  return age >= -60 && age < PROOF_MAX_AGE_SECONDS;
}

/**
 * @param {object|null} profile users/{uid}.
 * @return {boolean} Not signed in yet (admin lists label these).
 */
function notSignedInYet(profile) {
  return Boolean(profile) && profile.accountOrigin === "shipment" &&
    !profile.firstSignInAt;
}

// ---------------------------------------------------------------------------
// Firebase half
// ---------------------------------------------------------------------------

const refusal = (code, reason, message, extra = {}) =>
  new HttpsError(code, message, {reason, ...extra});

/**
 * @param {object} deps {db, auth, FieldValue, Timestamp, logger, nowMs,
 *   countries, sendWhatsApp(body), whatsappConfigured(), loginMessage(args),
 *   notifyBusiness(payload), findTrackingDocument(db, code),
 *   publicRecord(db, {collection, id, data}), clientAddress(request),
 *   defaultNotificationPreferences()}.
 * @return {object} The handlers.
 */
function createPhoneAccounts(deps) {
  const db = () => deps.db();
  const auth = () => deps.auth();
  const now = () => (deps.nowMs ? deps.nowMs() : Date.now());
  const log = deps.logger || console;
  const FieldValue = deps.FieldValue;
  const regionCache = new Map();

  async function businessRegion(businessId) {
    const id = cleanText(businessId, 128);
    if (!id || id.includes("/")) return "";
    const cached = regionCache.get(id);
    if (cached && cached.atMs > now() - 10 * 60 * 1000) return cached.iso;
    const snap = await db().collection("businesses").doc(id).get();
    const data = snap.exists ? snap.data() || {} : {};
    const iso = regionIsoForCountry(data.country || data.countryCode,
        deps.countries);
    regionCache.set(id, {iso, atMs: now()});
    return iso;
  }

  async function regionFor(collection, data) {
    return needsRegion(collection, data) ?
      businessRegion(data?.businessId) : "";
  }

  async function userByPhone(e164) {
    try {
      return await auth().getUserByPhoneNumber(e164);
    } catch (error) {
      if (error?.code === "auth/user-not-found") return null;
      throw error;
    }
  }

  // ---- accounts ----------------------------------------------------------

  const sleep = deps.sleep ||
    ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const claimRef = (phone) => db().collection(CLAIMS_COLLECTION).doc(phone);
  const alreadyExists = (error) => error?.code === 6 ||
    /already exists/i.test(String(error?.message));
  // The document changed or went since we read it (a precondition failed).
  const preconditionRace = (error) => error?.code === 9 ||
    error?.code === 5 || error?.code === "failed-precondition" ||
    error?.code === "not-found";

  async function userById(uid) {
    try {
      return await auth().getUser(uid);
    } catch (error) {
      if (error?.code === "auth/user-not-found") return null;
      throw error;
    }
  }

  /**
   * Tries to take a number's claim (docs §4.1). `create()` is the lock: of
   * any number of runs at once exactly one creates the document.
   *
   * @param {string} phone The E.164 number.
   * @return {Promise<object>} {state: "mine", token} | {state: "owned",
   *   uid, profileReady} | {state: "busy"}.
   */
  async function takeClaim(phone) {
    const ref = claimRef(phone);
    const token = crypto.randomBytes(12).toString("hex");
    const fresh = {phone, uid: "", token, profileReady: false,
      claimedAtMs: now()};
    try {
      await ref.create(fresh);
      return {state: "mine", token};
    } catch (error) {
      if (!alreadyExists(error)) throw error;
    }
    const snap = await ref.get();
    if (!snap.exists) return {state: "busy"}; // released meanwhile: retry
    const claim = snap.data() || {};
    if (cleanText(claim.uid, 128)) {
      return {state: "owned", uid: claim.uid,
        profileReady: claim.profileReady === true};
    }
    if (now() - Number(claim.claimedAtMs || 0) < CLAIM_STALE_MS) {
      return {state: "busy"};
    }
    // A run that died while making the account: take its place - unless
    // someone else did since we read it.
    try {
      await ref.update(fresh, {lastUpdateTime: snap.updateTime});
      return {state: "mine", token};
    } catch (error) {
      if (preconditionRace(error)) return {state: "busy"};
      throw error;
    }
  }

  /**
   * Records the number's account: later runs read it and stop.
   *
   * @param {string} phone The number.
   * @param {string} uid Its account.
   * @param {boolean} profileReady users/{uid} exists (or is deliberately
   *   absent: an email account's own profile is never written here).
   * @return {Promise<void>}
   */
  async function settleClaim(phone, uid, profileReady) {
    await claimRef(phone).set({phone, uid, token: "", profileReady,
      claimedAtMs: now(), settledAt: FieldValue.serverTimestamp()});
  }

  /**
   * Gives up a claim this run holds (it failed), so the next run makes the
   * account instead of waiting a minute. Never throws.
   *
   * @param {string} phone The number.
   * @param {object} match {token} or {uid}: only that claim is removed.
   * @return {Promise<void>}
   */
  async function dropClaim(phone, match) {
    try {
      const snap = await claimRef(phone).get();
      const claim = snap.exists ? snap.data() || {} : null;
      if (!claim) return;
      if (match.token && claim.token !== match.token) return;
      if (match.uid && claim.uid !== match.uid) return;
      await claimRef(phone).delete({lastUpdateTime: snap.updateTime});
    } catch (error) {
      if (!preconditionRace(error)) {
        log.warn("Phone claim not released", {
          error: error?.message || String(error)});
      }
    }
  }

  /**
   * The one Auth user of a number, made under its claim when there is none.
   *
   * @param {string} phone The E.164 number.
   * @param {{displayName: string, verify: boolean}} options verify: never
   *   trust a claim's uid without reading that Auth user (a sign-in mints a
   *   token for it).
   * @return {Promise<object>} {state: "ready", user, uid, status,
   *   profileReady, token} | {state: "busy"}. user is null when the claim
   *   answered alone (profileReady, not verify).
   */
  async function lockedAuthUser(phone, options = {}) {
    for (let attempt = 0; attempt <= CLAIM_WAITS_MS.length; attempt += 1) {
      let claim;
      try {
        claim = await takeClaim(phone);
      } catch (error) {
        log.warn("Phone claim not taken", {
          error: error?.message || String(error)});
        claim = {state: "busy"};
      }
      if (claim.state === "owned") {
        if (claim.profileReady && !options.verify) {
          return {state: "ready", user: null, uid: claim.uid,
            status: "reused", profileReady: true, token: ""};
        }
        // By uid first: the claim's account is the answer while it still
        // holds the number.
        const owner = await userById(claim.uid);
        if (owner && owner.phoneNumber === phone) {
          return {state: "ready", user: owner, uid: owner.uid,
            status: "reused", profileReady: claim.profileReady, token: ""};
        }
        // The number moved (merged into an email account) or the account
        // was deleted: whoever holds it now, else nobody.
        const holder = await userByPhone(phone);
        if (holder) {
          return {state: "ready", user: holder, uid: holder.uid,
            status: "reused", profileReady: false, token: ""};
        }
        await dropClaim(phone, {uid: claim.uid});
        continue;
      }
      if (claim.state === "mine") {
        try {
          let user = await userByPhone(phone);
          let status = "reused";
          if (!user) {
            try {
              user = await auth().createUser({
                phoneNumber: phone,
                ...(cleanText(options.displayName) ?
                  {displayName: cleanText(options.displayName)} : {}),
              });
              status = "created";
            } catch (error) {
              // Somebody outside the claim (a client's SMS sign-in) made it.
              if (error?.code !== "auth/phone-number-already-exists") {
                throw error;
              }
              user = await userByPhone(phone);
              if (!user) throw error;
            }
          }
          return {state: "ready", user, uid: user.uid, status,
            profileReady: false, token: claim.token};
        } catch (error) {
          await dropClaim(phone, {token: claim.token});
          throw error;
        }
      }
      if (attempt < CLAIM_WAITS_MS.length) {
        await sleep(CLAIM_WAITS_MS[attempt]);
      }
    }
    return {state: "busy"};
  }

  /**
   * The account for a number on a record (docs §4). Never throws.
   *
   * @param {{e164: string, displayName: string, source: object}} args Who.
   * @return {Promise<{status: string, uid: string}>} created | reused |
   *   opted_out | invalid | pending (another run is making it) | failed.
   */
  async function ensurePhoneAccount({e164, displayName = "", source = {}}) {
    const phone = strictE164(e164);
    if (!phone) return {status: "invalid", uid: ""};
    let held = "";
    try {
      // One read for the common case: an opted-out number, or one whose
      // account is already known.
      const [optOut, known] = await db().getAll(
          db().collection("phoneAccountOptOuts").doc(phone), claimRef(phone));
      if (optOut.exists) return {status: "opted_out", uid: ""};
      const claim = known.exists ? known.data() || {} : {};
      if (cleanText(claim.uid, 128) && claim.profileReady === true) {
        return {status: "reused", uid: claim.uid};
      }
      const found = await lockedAuthUser(phone, {displayName});
      if (found.state === "busy") return {status: "pending", uid: ""};
      if (found.profileReady) return {status: found.status, uid: found.uid};
      held = found.token;
      const user = found.user;
      const hasOtherSignIn = cleanText(user.email) ||
        (user.providerData || []).some((entry) =>
          entry?.providerId && entry.providerId !== "phone");
      if (!hasOtherSignIn) {
        const signedInBefore = Boolean(user.metadata?.lastSignInTime) &&
          found.status === "reused";
        const nowTs = FieldValue.serverTimestamp();
        try {
          await db().collection("users").doc(user.uid).create({
            role: "customer",
            fullName: cleanText(displayName),
            email: "",
            phone,
            normalizedPhone: digitsOf(phone),
            phoneVerified: signedInBefore,
            accountOrigin: signedInBefore ? "phone_sign_in" : "shipment",
            firstSignInAt: signedInBefore ? nowTs : null,
            createdFrom: {
              collection: cleanText(source.collection, 60),
              recordId: cleanText(source.recordId, 200),
              field: cleanText(source.field, 60),
            },
            preferredLanguage: loginLanguage(phone),
            notificationPreferences: deps.defaultNotificationPreferences(),
            createdAt: nowTs,
            updatedAt: nowTs,
          });
        } catch (error) {
          // ALREADY_EXISTS: the profile is someone's; never touch it.
          if (!alreadyExists(error)) throw error;
        }
      }
      await settleClaim(phone, user.uid, true);
      return {status: found.status, uid: user.uid};
    } catch (error) {
      if (held) await dropClaim(phone, {token: held});
      log.warn("Phone account not ensured", {
        collection: source.collection || "", recordId: source.recordId || "",
        error: error?.message || String(error),
      });
      return {status: "failed", uid: ""};
    }
  }

  async function ensureAccountsFor(collection, id, phones) {
    const results = [];
    for (const phone of phones) {
      results.push(await ensurePhoneAccount({e164: phone.e164,
        displayName: phone.name,
        source: {collection, recordId: id, field: phone.raw}}));
    }
    return results;
  }

  // A number is stamped only once its account exists, or is deliberately
  // absent (opted out). failed / pending numbers wait for the next sync.
  const SETTLED_STATUSES = new Set(["created", "reused", "opted_out"]);

  /**
   * The derived-field update a change set allows, given which numbers have
   * their account; null when nothing is left to write.
   *
   * @param {string} collection The collection.
   * @param {object} changes recordPhonePatch(...).changes.
   * @param {Set<string>} settled Numbers whose account is settled.
   * @return {object|null} Firestore update (FieldValue.delete for null).
   */
  function stampUpdate(collection, changes, settled) {
    const update = {};
    for (const [field, value] of Object.entries(changes)) {
      const isNumber = (PHONE_RECORD_SOURCES[collection] || [])
          .some((source) => source.e164 === field);
      // A number that changed again since the accounts were made, or whose
      // account is not settled, waits for the next sync.
      if (isNumber && value !== null && !settled.has(value)) continue;
      update[field] = value === null ? FieldValue.delete() : value;
    }
    if (!Object.keys(update).length) return null;
    update[DERIVED.SYNCED_AT] = FieldValue.serverTimestamp();
    return update;
  }

  /**
   * Accounts first, then the update that stamps them (docs §4): what a
   * record's derived fields should become, computed from `data` as given.
   *
   * @param {string} collection The collection.
   * @param {string} id The record.
   * @param {object} data The record.
   * @return {Promise<{update: ?Object, accounts: Array<object>,
   *   region: string}>} update null: nothing to write.
   */
  async function planRecordPhones(collection, id, data) {
    const region = await regionFor(collection, data);
    const planned = recordPhonePatch(collection, data, region);
    if (!Object.keys(planned.changes).length) {
      return {update: null, accounts: [], settled: new Set(), region};
    }
    const accounts = await ensureAccountsFor(collection, id,
        planned.newNumbers);
    const settled = new Set(planned.newNumbers
        .filter((phone, index) =>
          SETTLED_STATUSES.has(accounts[index]?.status))
        .map((phone) => phone.e164));
    return {update: stampUpdate(collection, planned.changes, settled),
      accounts, settled, region};
  }

  /**
   * For a trigger that writes the record itself anyway (parkedCars'
   * occupancy patch): the phone fields to put in THAT write, so one event
   * makes at most one write. The caller writes with its own updateTime
   * guard. Never throws.
   *
   * @param {string} collection The collection.
   * @param {string} id The record.
   * @param {{after: object, before: (object|null|undefined)}} event The
   *   record after the write, and before it (null: created).
   * @return {Promise<{update: ?Object, accounts: Array<object>}>} update
   *   null: nothing to add.
   */
  async function phoneStampForEvent(collection, id, {after, before} = {}) {
    try {
      if (!PHONE_RECORD_SOURCES[collection] || !cleanText(id) || !after ||
          stampIsCurrent(collection, after, before) ||
          !phoneEventNeedsSync(collection, after, before, now())) {
        return {update: null, accounts: []};
      }
      const plan = await planRecordPhones(collection, id, after);
      return {update: plan.update, accounts: plan.accounts};
    } catch (error) {
      log.warn("Record phones not planned", {collection, id,
        error: error?.message || String(error)});
      return {update: null, accounts: []};
    }
  }

  /**
   * Re-derives a record's phone fields and ensures the accounts of numbers
   * that appeared. Never throws: a staff save must not fail.
   *
   * From a trigger (`options.after` given) it first asks, without any read,
   * whether there is anything to do (stampIsCurrent, phoneEventNeedsSync);
   * with the event's `updateTime` it then writes ONE update guarded by it
   * (a newer write's own event redoes the work) instead of re-reading the
   * record in a transaction. Without options (callables, the sweep, the
   * backfill) it re-reads the record and stamps in a transaction, so a
   * stale read never writes an old number over a newer one.
   *
   * @param {string} collection The collection.
   * @param {string} id The record.
   * @param {object} options {after, before, updateTime}: the event's data.
   * @return {Promise<{written: boolean, accounts: Array<object>}>} What
   *   happened.
   */
  async function syncRecordPhones(collection, id, options = {}) {
    if (!PHONE_RECORD_SOURCES[collection] || !cleanText(id)) {
      return {written: false, accounts: []};
    }
    try {
      if (options.after !== undefined) {
        if (!options.after ||
            stampIsCurrent(collection, options.after, options.before) ||
            !phoneEventNeedsSync(collection, options.after, options.before,
                now())) {
          return {written: false, accounts: []};
        }
      }
      const ref = db().collection(collection).doc(id);
      if (options.after !== undefined) {
        if (options.updateTime) {
          const plan = await planRecordPhones(collection, id, options.after);
          if (!plan.update) return {written: false, accounts: plan.accounts};
          try {
            await ref.update(plan.update,
                {lastUpdateTime: options.updateTime});
            return {written: true, accounts: plan.accounts};
          } catch (error) {
            // A newer write landed: its own event stamps the record.
            if (preconditionRace(error)) {
              return {written: false, accounts: plan.accounts};
            }
            throw error;
          }
        }
      }
      const first = await ref.get();
      if (!first.exists) return {written: false, accounts: []};
      const plan = await planRecordPhones(collection, id, first.data() || {});
      if (!plan.update) return {written: false, accounts: plan.accounts};
      const written = await db().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return false;
        const data = snap.data() || {};
        const patch = recordPhonePatch(collection, data,
            needsRegion(collection, data) ? plan.region : "");
        const update = stampUpdate(collection, patch.changes, plan.settled);
        if (!update) return false;
        tx.update(ref, update);
        return true;
      });
      return {written, accounts: plan.accounts};
    } catch (error) {
      log.warn("Record phones not synced", {collection, id,
        error: error?.message || String(error)});
      return {written: false, accounts: []};
    }
  }

  /**
   * Accounts for a record whose numbers are already E.164 (package
   * requests) or right after a callable created it. Never throws.
   *
   * @param {string} collection The collection.
   * @param {string} id The record.
   * @return {Promise<Array<object>>} ensurePhoneAccount results.
   */
  async function ensureRecordAccounts(collection, id) {
    try {
      const snap = await db().collection(collection).doc(id).get();
      if (!snap.exists) return [];
      const data = snap.data() || {};
      const region = await regionFor(collection, data);
      return ensureAccountsFor(collection, id,
          accountNumbers(collection, data, region));
    } catch (error) {
      log.warn("Record accounts not ensured", {collection, id,
        error: error?.message || String(error)});
      return [];
    }
  }

  /**
   * After a callable wrote a record: stamp it (when it carries derived
   * fields) or just ensure the accounts.
   *
   * @param {string} collection The collection.
   * @param {string} id The record.
   * @return {Promise<void>} Never rejects.
   */
  async function afterRecordWrite(collection, id) {
    const sources = PHONE_RECORD_SOURCES[collection] || [];
    if (sources.some((source) => source.e164)) {
      await syncRecordPhones(collection, id);
    } else {
      await ensureRecordAccounts(collection, id);
    }
  }

  // ---- sign-in bookkeeping ----------------------------------------------

  /**
   * What every proven phone sign-in does to the profile (docs §5.3).
   *
   * @param {string} uid The account.
   * @param {string} e164 Its number.
   * @param {{replacePhone: boolean}} options replacePhone: the number was
   *   just proven for this account (linking), so it becomes the profile's
   *   number whatever was saved before.
   * @return {Promise<{profileCreated: boolean, firstSignIn: boolean}>}
   */
  async function signInBookkeeping(uid, e164, options = {}) {
    const userRecord = await auth().getUser(uid);
    const ref = db().collection("users").doc(uid);
    const nowTs = FieldValue.serverTimestamp();
    const result = await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const aliasRef = db().collection("phoneSignInAliases")
          .doc(digitsOf(e164));
      tx.set(aliasRef, {uid, email: cleanText(userRecord.email, 320)
          .toLowerCase(), phone: e164, updatedAt: nowTs}, {merge: true});
      tx.delete(db().collection("phoneAccountOptOuts").doc(e164));
      // The number's account is this one now (a sign-in, a merge): records
      // saved later reuse it without asking Auth (§4.1).
      tx.set(claimRef(e164), {phone: e164, uid, token: "",
        profileReady: true, claimedAtMs: now(), settledAt: nowTs});
      if (!snap.exists) {
        tx.set(ref, {
          role: "customer",
          fullName: cleanText(userRecord.displayName),
          email: cleanText(userRecord.email, 320).toLowerCase(),
          phone: e164,
          normalizedPhone: digitsOf(e164),
          phoneVerified: true,
          phoneVerifiedAt: nowTs,
          accountOrigin: "phone_sign_in",
          firstSignInAt: nowTs,
          preferredLanguage: loginLanguage(e164),
          notificationPreferences: deps.defaultNotificationPreferences(),
          createdAt: nowTs,
          updatedAt: nowTs,
        });
        return {profileCreated: true, firstSignIn: true};
      }
      const current = snap.data() || {};
      const update = {
        phoneVerified: true,
        normalizedPhone: digitsOf(e164),
        updatedAt: nowTs,
      };
      if (!current.phoneVerifiedAt) update.phoneVerifiedAt = nowTs;
      if (options.replacePhone || !cleanText(current.phone) ||
          sameNumber(current.phone, e164)) {
        update.phone = e164;
      }
      const firstSignIn = !current.firstSignInAt;
      if (firstSignIn) update.firstSignInAt = nowTs;
      tx.set(ref, update, {merge: true});
      return {profileCreated: false, firstSignIn};
    });
    return result;
  }

  async function profileOf(uid) {
    const snap = await db().collection("users").doc(uid).get();
    return snap.exists ? snap.data() || {} : null;
  }

  /**
   * Refuses phone-code sign-in / linking for anyone with business or
   * platform access (phoneSignInAllowed), in words that reveal nothing.
   *
   * @param {string} uid The account.
   * @param {{requireProfile: boolean}} options requireProfile: linking needs
   *   an existing customer profile (as syncVerifiedCustomerPhone does).
   * @return {Promise<object|null>} The profile.
   */
  async function requirePhoneSignInAllowed(uid, options = {}) {
    const profile = await profileOf(uid);
    if ((options.requireProfile && !profile) || !phoneSignInAllowed(profile)) {
      throw refusal("permission-denied", "phone_sign_in_unavailable",
          "Use your email and password to sign in to this account");
    }
    return profile;
  }

  /**
   * The account a proven number signs into, made when there is none (a
   * deleted account comes back: signing in again is asking for it).
   *
   * @param {string} e164 The number.
   * @return {Promise<{uid: string, created: boolean}>} The account.
   */
  async function accountForSignIn(e164) {
    const existing = await userByPhone(e164);
    if (existing) {
      await requirePhoneSignInAllowed(existing.uid);
      return {uid: existing.uid, created: false};
    }
    // Made under the number's claim, like a record's account (§4.1), so a
    // shipment saved at this moment cannot make a second one. verify: the
    // token is minted for this uid, so a claim is never trusted unread.
    const found = await lockedAuthUser(e164, {verify: true});
    if (found.state === "ready") {
      try {
        if (found.status === "reused") {
          await requirePhoneSignInAllowed(found.uid);
        }
        // signInBookkeeping, next, settles the claim with the profile.
        return {uid: found.uid, created: found.status === "created"};
      } catch (error) {
        if (found.token) await dropClaim(e164, {token: found.token});
        throw error;
      }
    }
    // Another run held the claim for seconds: fall back to Auth's own
    // phone uniqueness rather than refuse a proven sign-in.
    try {
      const made = await auth().createUser({phoneNumber: e164});
      return {uid: made.uid, created: true};
    } catch (error) {
      if (error?.code !== "auth/phone-number-already-exists") throw error;
      const raced = await userByPhone(e164);
      if (!raced) throw error;
      await requirePhoneSignInAllowed(raced.uid);
      return {uid: raced.uid, created: false};
    }
  }

  /**
   * Gives a signed-in account a number it proved (docs §7), merging a
   * never-signed-in placeholder that holds it.
   *
   * @param {string} uid The account.
   * @param {string} e164 The proven number.
   * @param {{proofHolderUid: (string|undefined)}} options For an SMS proof:
   *   the account that held the number when the proof was checked.
   * @return {Promise<{linked: boolean, merged: boolean}>} What happened.
   */
  async function linkPhoneToAccount(uid, e164, options = {}) {
    await requirePhoneSignInAllowed(uid, {requireProfile: true});
    const caller = await auth().getUser(uid);
    if (caller.phoneNumber === e164) {
      await signInBookkeeping(uid, e164, {replacePhone: true});
      return {linked: true, merged: false};
    }
    const holder = await userByPhone(e164);
    // An SMS proof is a sign-in of the account holding the number when it
    // was checked; if the number has moved since, the proof is stale.
    if (options.proofHolderUid !== undefined &&
        (holder?.uid || "") !== options.proofHolderUid) {
      throw refusal("invalid-argument", "proof_invalid",
          "Verify the number again");
    }
    let merged = false;
    if (holder && holder.uid !== uid) {
      const holderRef = db().collection("users").doc(holder.uid);
      const holderProfile = await holderRef.get();
      if (!isPlaceholderAccount(holderProfile.exists ?
        holderProfile.data() : null, holder)) {
        throw refusal("already-exists", "phone_in_use",
            "Another account already uses this phone number");
      }
      // What the placeholder hid ("This isn't mine") stays hidden.
      const hidden = await holderRef.collection("hiddenShipments")
          .limit(500).get();
      const batch = db().batch();
      for (const doc of hidden.docs) {
        batch.set(db().collection("users").doc(uid)
            .collection("hiddenShipments").doc(doc.id), doc.data());
        batch.delete(doc.ref);
      }
      batch.delete(holderRef);
      await batch.commit();
      await auth().deleteUser(holder.uid).catch((error) => {
        if (error?.code !== "auth/user-not-found") throw error;
      });
      merged = true;
    }
    const previous = strictE164(caller.phoneNumber);
    try {
      await auth().updateUser(uid, {phoneNumber: e164});
    } catch (error) {
      if (error?.code === "auth/phone-number-already-exists") {
        throw refusal("already-exists", "phone_in_use",
            "Another account already uses this phone number");
      }
      throw error;
    }
    if (previous) {
      // The number this account had before is no longer its sign-in.
      const oldAlias = db().collection("phoneSignInAliases")
          .doc(digitsOf(previous));
      const aliasSnap = await oldAlias.get();
      if (aliasSnap.data()?.uid === uid) await oldAlias.delete();
    }
    await signInBookkeeping(uid, e164, {replacePhone: true});
    return {linked: true, merged};
  }

  // ---- callables ---------------------------------------------------------

  const isAnonymous = (request) => {
    const provider = request.auth?.token?.firebase?.sign_in_provider;
    return provider === "anonymous";
  };

  async function consumeSendLimits(limits) {
    const nowMs = now();
    const refs = limits.map((limit) => db().collection("phoneLoginLimits")
        .doc(limitDocId(limit.kind, limit.key)));
    return db().runTransaction(async (tx) => {
      const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
      const decisions = limits.map((limit, index) => limitDecision(
          snaps[index].exists ? snaps[index].data() : null, limit, nowMs,
          limit.kind === "phone_hour" ? RESEND_AFTER_MS : 0));
      const blocked = decisions.filter((decision) => !decision.allowed);
      if (blocked.length) {
        return {allowed: false, retryAfterMs: Math.max(
            ...blocked.map((decision) => decision.retryAfterMs)),
        blockedKinds: limits.filter((limit, index) =>
          !decisions[index].allowed).map((limit) => limit.kind)};
      }
      decisions.forEach((decision, index) => tx.set(refs[index], {
        ...decision.next,
        kind: limits[index].kind,
        expiresAt: deps.Timestamp.fromMillis(nowMs +
          limits[index].windowMs * 2),
      }));
      return {allowed: true, retryAfterMs: 0, blockedKinds: []};
    });
  }

  async function numberFromTracking(trackingCode, role) {
    const found = await deps.findTrackingDocument(db(), trackingCode);
    if (!found) {
      throw refusal("not-found", "tracking_not_found",
          "That tracking code was not found");
    }
    const phones = recordPhones(found.collection, found.data,
        await regionFor(found.collection, found.data));
    const wanted = phones.find((phone) => phone.role === role);
    const stored = wanted?.e164Field ?
      strictE164(found.data?.[wanted.e164Field]) : "";
    const e164 = stored || wanted?.e164 || "";
    if (!e164) {
      throw refusal("failed-precondition", "no_phone_on_record",
          "This package has no number to send a code to");
    }
    return e164;
  }

  /**
   * requestPhoneLoginCode (docs §5.1).
   *
   * @param {object} request The callable request.
   * @return {Promise<object>} {challengeId, channel, lastTwo, expiresAtMs,
   *   resendAfterMs}.
   */
  async function requestPhoneLoginCode(request) {
    const data = request.data || {};
    const purpose = data.purpose === "link" ? "link" : "sign_in";
    if (purpose === "link") {
      if (!request.auth || isAnonymous(request)) {
        throw refusal("unauthenticated", "sign_in_required",
            "Sign in to add a phone number to your account");
      }
      // Customers only, checked before anything is sent.
      await requirePhoneSignInAllowed(request.auth.uid,
          {requireProfile: true});
    }
    let e164 = "";
    let trackingCode = "";
    if (purpose === "sign_in" && cleanText(data.trackingCode)) {
      const role = data.role === ROLE.RECEIVER ? ROLE.RECEIVER : ROLE.SENDER;
      trackingCode = cleanText(data.trackingCode, 60).toUpperCase();
      e164 = await numberFromTracking(trackingCode, role);
    } else {
      const parsed = toE164(data.phone);
      if (parsed.status === PHONE_STATUS.NEEDS_COUNTRY_CODE) {
        throw refusal("invalid-argument", "needs_country_code",
            "Add your country code to the number");
      }
      if (parsed.status !== PHONE_STATUS.OK) {
        throw refusal("invalid-argument", "phone_invalid",
            "Enter a valid phone number");
      }
      e164 = parsed.e164;
    }
    if (!deps.whatsappConfigured()) {
      throw refusal("failed-precondition", "whatsapp_unavailable",
          "WhatsApp codes are not available. Send a text instead.");
    }
    // An address the front end could not determine is everyone's: never a
    // bucket of its own (it would let one caller block every sign-in). IPv6
    // counts by its /64 (addressBucket).
    const limits = loginSendLimits({
      phone: e164,
      ip: deps.addressBucket(deps.clientAddress(request)),
      trackingCode,
      callingCode: callingCodeOf(digitsOf(e164)),
    });
    const limit = await consumeSendLimits(limits);
    if (!limit.allowed) {
      for (const kind of limit.blockedKinds) {
        if (ALERT_LIMIT_KINDS.includes(kind)) {
          // An alert: abuse, or growth that needs a higher cap.
          log.error("Phone login send cap reached", {kind,
            callingCode: kind === "country_day" ?
              callingCodeOf(digitsOf(e164)) : ""});
        }
      }
      throw refusal("resource-exhausted", "rate_limited",
          "Too many codes. Please wait and try again.",
          {retryAfterMs: Math.max(0, Math.round(limit.retryAfterMs))});
    }
    // Who the code would sign in to. A WhatsApp message costs money, so a
    // sign-in code is only really sent to a number that has an account a
    // phone may open, or a record (a deleted account comes back that way).
    // Every other number gets the very same answer and a challenge no code
    // can open - nothing tells a caller whether a number is known.
    const holder = await userByPhone(e164);
    const holderProfile = holder ? await profileOf(holder.uid) : null;
    let send = true;
    if (purpose === "sign_in") {
      send = holder ? phoneSignInAllowed(holderProfile) :
        Boolean(trackingCode) || await numberHasRecord(e164);
    }
    const challengeRef = db().collection("phoneLoginChallenges").doc(
        crypto.randomBytes(16).toString("hex"));
    const code = newLoginCode();
    const nowMs = now();
    const expiresAtMs = nowMs + CODE_TTL_MS;
    await challengeRef.set({
      phoneE164: e164,
      // Unsent: the hash of a code nobody ever sees.
      codeHash: codeHash(challengeRef.id, send ? code : newLoginCode() +
        crypto.randomBytes(8).toString("hex")),
      purpose,
      linkUid: purpose === "link" ? request.auth.uid : "",
      expiresAtMs,
      attempts: 0,
      status: "open",
      delivered: send,
      source: trackingCode ? "tracking" : "phone",
      createdAtMs: nowMs,
      expiresAt: deps.Timestamp.fromMillis(expiresAtMs + DAY_MS),
    });
    if (send) {
      const sent = await deps.sendWhatsApp(deps.loginMessage({phone: e164,
        code, language: loginLanguage(e164,
            cleanText(holderProfile?.preferredLanguage, 5))}));
      if (!sent?.ok) {
        await challengeRef.update({status: "unsent",
          error: cleanText(sent?.error, 300)});
        throw refusal("failed-precondition", "whatsapp_unavailable",
            "The WhatsApp code could not be sent. Send a text instead.");
      }
    }
    return {
      challengeId: challengeRef.id,
      channel: "whatsapp",
      lastTwo: lastTwo(e164),
      expiresAtMs,
      resendAfterMs: RESEND_AFTER_MS,
    };
  }

  /**
   * Whether any record carries this number (one bounded read per source,
   * stopping at the first hit).
   *
   * @param {string} e164 The number.
   * @return {Promise<boolean>} True when some record has it.
   */
  async function numberHasRecord(e164) {
    for (const source of shipmentQueries()) {
      const snap = await db().collection(source.collection)
          .where(source.field, "==", e164).limit(1).get();
      if (!snap.empty) return true;
    }
    return false;
  }

  const ATTEMPT_MESSAGES = Object.freeze({
    code_wrong: "That code is not right",
    code_expired: "That code has expired. Ask for a new one.",
    too_many_attempts: "Too many wrong codes. Ask for a new one.",
    challenge_not_found: "Ask for a new code",
  });

  /**
   * verifyPhoneLoginCode (docs §5.1).
   *
   * @param {object} request The callable request.
   * @return {Promise<object>} sign-in: {customToken, uid, isNewAccount};
   *   link: {linked, merged}.
   */
  async function verifyPhoneLoginCode(request) {
    const challengeId = cleanText(request.data?.challengeId, 64);
    if (!/^[0-9a-f]{32}$/.test(challengeId)) {
      throw refusal("invalid-argument", "challenge_not_found",
          ATTEMPT_MESSAGES.challenge_not_found);
    }
    const ref = db().collection("phoneLoginChallenges").doc(challengeId);
    const attempt = await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const challenge = snap.exists ? snap.data() : null;
      // A link code is the asking account's: anyone else's try neither
      // counts nor uses it.
      if (challenge?.purpose === "link" &&
          request.auth?.uid !== challenge.linkUid) {
        return {outcome: "wrong_account", attemptsLeft: 0, challenge};
      }
      const result = codeAttempt(challenge, request.data?.code, challengeId,
          now());
      if (result.update) tx.update(ref, result.update);
      return {...result, challenge};
    });
    if (attempt.outcome === "wrong_account") {
      throw refusal("permission-denied", "wrong_account",
          "Sign in to the account that asked for this code");
    }
    if (attempt.outcome !== "ok") {
      throw refusal(
          attempt.outcome === "code_wrong" ? "invalid-argument" :
            "failed-precondition",
          attempt.outcome, ATTEMPT_MESSAGES[attempt.outcome],
          {attemptsLeft: attempt.attemptsLeft});
    }
    const {phoneE164: e164, purpose, linkUid} = attempt.challenge;
    if (purpose === "link") return linkPhoneToAccount(linkUid, e164);
    const account = await accountForSignIn(e164);
    const booked = await signInBookkeeping(account.uid, e164);
    const customToken = await auth().createCustomToken(account.uid);
    return {customToken, uid: account.uid,
      isNewAccount: account.created || booked.firstSignIn};
  }

  /**
   * completePhoneSignIn (docs §5.3, §7).
   *
   * @param {object} request The callable request.
   * @return {Promise<object>} {uid, profileCreated} or {linked, merged}.
   */
  async function completePhoneSignIn(request) {
    if (!request.auth || isAnonymous(request)) {
      throw refusal("unauthenticated", "sign_in_required",
          "Sign in first");
    }
    const uid = request.auth.uid;
    const proof = cleanText(request.data?.placeholderIdToken, 4096);
    if (proof) {
      let decoded;
      try {
        // Revocation checked: a token of a deleted or signed-out-everywhere
        // account proves nothing.
        decoded = await auth().verifyIdToken(proof, true);
      } catch (_) {
        throw refusal("invalid-argument", "proof_invalid",
            "Verify the number again");
      }
      const e164 = strictE164(decoded.phone_number);
      const holder = e164 ? await userByPhone(e164) : null;
      // A fresh (< 5 min) phone sign-in, by the account that holds that
      // number right now, of exactly that number (proofAcceptable).
      if (!proofAcceptable(decoded,
          {e164, holderUid: holder?.uid || "", nowMs: now()})) {
        throw refusal("invalid-argument", "proof_invalid",
            "Verify the number again");
      }
      return linkPhoneToAccount(uid, e164, {proofHolderUid: holder.uid});
    }
    const userRecord = await auth().getUser(uid);
    const e164 = strictE164(userRecord.phoneNumber);
    if (!e164) {
      throw refusal("failed-precondition", "no_verified_phone",
          "Sign in with your phone first");
    }
    // A text sign-in to an account with business or platform access is
    // refused like a code would be (the client signs out on this answer).
    await requirePhoneSignInAllowed(uid);
    const booked = await signInBookkeeping(uid, e164);
    return {uid, profileCreated: booked.profileCreated,
      isNewAccount: booked.firstSignIn};
  }

  async function verifiedPhoneOf(request) {
    if (!request.auth || isAnonymous(request)) {
      throw refusal("unauthenticated", "sign_in_required", "Sign in first");
    }
    const fromToken = strictE164(request.auth.token?.phone_number);
    if (fromToken) return fromToken;
    const userRecord = await auth().getUser(request.auth.uid);
    const e164 = strictE164(userRecord.phoneNumber);
    if (!e164) {
      throw refusal("failed-precondition", "no_verified_phone",
          "Add and verify your phone number to see your packages");
    }
    return e164;
  }

  /**
   * getMyShipments (docs §6).
   *
   * @param {object} request The callable request.
   * @return {Promise<{items: Array<object>, nextCursor: ?Object,
   *   phoneLastTwo: string}>} One page.
   */
  async function getMyShipments(request) {
    const e164 = await verifiedPhoneOf(request);
    const uid = request.auth.uid;
    const cursor = parseCursor(request.data?.cursor);
    const perSource = PAGE_SIZE + (cursor?.skipKeys.length || 0);
    const sources = shipmentQueries();
    let sourceFull = false;
    const results = await Promise.all(sources.map(async (source) => {
      let query = db().collection(source.collection)
          .where(source.field, "==", e164);
      if (cursor) {
        query = query.where("createdAt", "<=",
            deps.Timestamp.fromMillis(cursor.beforeMs));
      }
      const snap = await query.orderBy("createdAt", "desc")
          .limit(perSource).get();
      if (snap.size >= perSource) sourceFull = true;
      return snap.docs.map((doc) => ({
        key: `${source.collection}/${doc.id}`,
        collection: source.collection,
        id: doc.id,
        role: source.role,
        raw: source.raw,
        data: doc.data() || {},
        createdAtMs: millisOf(doc.data()?.createdAt),
      }));
    }));
    const candidates = results.flat();
    const keys = [...new Set(candidates.map((row) => row.key))];
    const hiddenRefs = keys.map((key) => db().collection("users").doc(uid)
        .collection("hiddenShipments").doc(hiddenDocId(key)));
    const hiddenSnaps = hiddenRefs.length ?
      await db().getAll(...hiddenRefs) : [];
    const hidden = new Set(hiddenSnaps.filter((snap) => snap.exists)
        .map((snap) => String(snap.data()?.key || "")));
    const page = mergeShipmentPage(candidates, {e164, cursor, hidden,
      pageSize: PAGE_SIZE, sourceFull});
    const businessIds = [...new Set(page.rows.map((row) =>
      cleanText(row.data?.businessId, 128)).filter((id) =>
      id && !id.includes("/")))];
    const businessSnaps = businessIds.length ? await db().getAll(
        ...businessIds.map((id) => db().collection("businesses").doc(id))) :
      [];
    const names = new Map(businessSnaps.map((snap) => [snap.id,
      cleanText(snap.data()?.businessName || snap.data()?.name, 120)]));
    const items = [];
    for (const row of page.rows) {
      const publicRecord = row.collection === "packageRequests" ?
        packageRequestPublicRecord(row.data, row.id) :
        await deps.publicRecord(db(), row);
      items.push(privateShipmentItem(publicRecord, row,
          names.get(cleanText(row.data?.businessId, 128)) ||
            cleanText(row.data?.businessName, 120)));
    }
    return {items, nextCursor: page.nextCursor, phoneLastTwo: lastTwo(e164)};
  }

  /**
   * reportShipmentNotMine (docs §6.1).
   *
   * @param {object} request The callable request.
   * @return {Promise<{hidden: boolean, notified: boolean}>} What happened.
   */
  async function reportShipmentNotMine(request) {
    const e164 = await verifiedPhoneOf(request);
    const uid = request.auth.uid;
    const target = parseRecordKey(request.data?.key);
    if (!target) {
      throw refusal("invalid-argument", "record_invalid",
          "That package could not be found");
    }
    const key = `${target.collection}/${target.id}`;
    const ref = db().collection(target.collection).doc(target.id);
    const hiddenRef = db().collection("users").doc(uid)
        .collection("hiddenShipments").doc(hiddenDocId(key));
    const outcome = await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() || {} : null;
      // Exactly the caller's number: the stored E.164 field (package
      // requests store E.164 in the raw field) equals it, and the raw field
      // still is it - never a match on the last digits alone.
      const fields = (PHONE_RECORD_SOURCES[target.collection] || [])
          .filter((source) => data &&
            (source.e164 ? data[source.e164] === e164 :
              strictE164(pathValue(data, source.raw)) === e164) &&
            candidateShows({collection: target.collection, raw: source.raw,
              data}, e164))
          .map((source) => source.raw);
      if (!data || !fields.length) return null;
      const reported = Array.isArray(data[DERIVED.REPORTED]) ?
        data[DERIVED.REPORTED] : [];
      const fresh = fields.filter((field) => !reported.includes(field));
      tx.set(hiddenRef, {key, fields, reportedAt:
        FieldValue.serverTimestamp()});
      if (fresh.length) {
        tx.update(ref, {[DERIVED.REPORTED]: FieldValue.arrayUnion(...fresh)});
      }
      return {data, fresh};
    });
    if (!outcome) {
      throw refusal("not-found", "record_invalid",
          "That package could not be found");
    }
    let notified = false;
    if (outcome.fresh.length) {
      const code = cleanText(outcome.data.trackingCode ||
        outcome.data.code || target.id, 60);
      await deps.notifyBusiness({
        businessId: cleanText(outcome.data.businessId, 128),
        title: "A customer says a number isn't theirs",
        body: `Someone who signed in with the number on ${code} says it ` +
          "isn't theirs. Check the number.",
        // The owner reads it in their own language (recipientLanguage).
        titleFr: "Un client dit qu'un numéro n'est pas le sien",
        bodyFr: `Une personne connectée avec le numéro de ${code} dit ` +
          "qu'il n'est pas le sien. Vérifiez le numéro.",
        data: {type: "phone_number_reported",
          relatedCollection: target.collection, relatedId: target.id,
          field: outcome.fresh.join(","), trackingCode: code},
      }).then(() => {
        notified = true;
      }, (error) => log.warn("Not-mine notice failed",
          {error: error?.message || String(error)}));
    }
    return {hidden: true, notified};
  }

  /**
   * Records that a deleted account's number must not come back from later
   * shipments (docs §8). Never throws.
   *
   * @param {string} e164 The deleted account's number.
   * @param {string} uid The deleted account.
   * @return {Promise<void>}
   */
  async function recordOptOut(e164, uid) {
    const phone = strictE164(e164);
    if (!phone) return;
    try {
      const batch = db().batch();
      batch.set(db().collection("phoneAccountOptOuts").doc(phone), {
        uid: cleanText(uid, 128),
        deletedAt: FieldValue.serverTimestamp(),
      });
      // The deleted account's claim goes with it (a sign-in makes a new one).
      batch.delete(claimRef(phone));
      await batch.commit();
    } catch (error) {
      log.warn("Phone opt-out not recorded", {
        error: error?.message || String(error)});
    }
  }

  /**
   * syncRecord: a staff app that created a record directly (the legacy
   * transport form) asks for its phone fields and accounts at once. Only
   * someone allowed to manage that record's section may ask
   * (deps.requireRecordAccess throws otherwise).
   *
   * @param {object} request The callable request: data.key.
   * @return {Promise<{synced: boolean}>} Whether anything was written.
   */
  async function syncRecord(request) {
    if (!request.auth || isAnonymous(request)) {
      throw refusal("unauthenticated", "sign_in_required", "Sign in first");
    }
    const target = parseRecordKey(request.data?.key);
    const data = target ? await db().collection(target.collection)
        .doc(target.id).get().then((snap) => snap.exists ? snap.data() :
          null) : null;
    if (!target || !data) {
      throw refusal("not-found", "record_invalid",
          "That record could not be found");
    }
    await deps.requireRecordAccess(request.auth.uid, target.collection,
        data);
    if ((PHONE_RECORD_SOURCES[target.collection] || [])
        .some((source) => source.e164)) {
      const result = await syncRecordPhones(target.collection, target.id);
      return {synced: result.written};
    }
    await ensureRecordAccounts(target.collection, target.id);
    return {synced: false};
  }

  /**
   * Stamps recent records that no trigger saw being created - a staff
   * client writing barrelShipments / freightShipments / transportRequests
   * directly (their triggers fire on update only) - and retries numbers
   * whose account failed. Bounded: the last `windowMs` of each collection,
   * `pageSize` records each, under a deadline. Run by an existing hourly
   * job (sweepPackageRequests), so no new function.
   *
   * @param {{windowMs: number, pageSize: number, deadlineMs: number}} options
   *   Bounds.
   * @return {Promise<object>} Counts per collection.
   */
  async function sweepRecentRecordPhones(options = {}) {
    const windowMs = Number(options.windowMs) || 3 * HOUR_MS;
    const pageSize = Number(options.pageSize) || 200;
    const deadlineMs = Number(options.deadlineMs) || now() + 40 * 1000;
    const since = deps.Timestamp.fromMillis(now() - windowMs);
    const tally = {};
    for (const collection of SWEPT_COLLECTIONS) {
      const counts = tally[collection] = {scanned: 0, synced: 0};
      if (now() >= deadlineMs) break;
      const snap = await db().collection(collection)
          .where("createdAt", ">=", since).orderBy("createdAt", "desc")
          .limit(pageSize).get();
      for (const doc of snap.docs) {
        if (now() >= deadlineMs) break;
        counts.scanned += 1;
        const data = doc.data() || {};
        const region = await regionFor(collection, data);
        if (!Object.keys(recordPhonePatch(collection, data, region).changes)
            .length) {
          continue;
        }
        const result = await syncRecordPhones(collection, doc.id);
        if (result.written) counts.synced += 1;
      }
    }
    return tally;
  }

  const ACTIONS = Object.freeze({
    syncRecord,
    requestPhoneLoginCode,
    verifyPhoneLoginCode,
    completePhoneSignIn,
    getMyShipments,
    reportShipmentNotMine,
  });

  /**
   * The one callable's switch (index.js `phoneAccount`).
   *
   * @param {object} request The callable request; data.action names the
   *   handler.
   * @return {Promise<object>} That handler's answer.
   */
  async function dispatch(request) {
    const action = cleanText(request?.data?.action, 40);
    const handler = Object.prototype.hasOwnProperty.call(ACTIONS, action) ?
      ACTIONS[action] : null;
    if (!handler) {
      throw refusal("invalid-argument", "action_invalid",
          "Unknown phone account action");
    }
    return handler(request);
  }

  return {
    afterRecordWrite,
    businessRegion,
    dispatch,
    sweepRecentRecordPhones,
    completePhoneSignIn,
    ensurePhoneAccount,
    ensureRecordAccounts,
    getMyShipments,
    linkPhoneToAccount,
    phoneStampForEvent,
    recordOptOut,
    reportShipmentNotMine,
    requestPhoneLoginCode,
    signInBookkeeping,
    syncRecordPhones,
    verifyPhoneLoginCode,
  };
}

module.exports = {
  ALERT_LIMIT_KINDS,
  COUNTRY_SENDS_PER_DAY,
  GLOBAL_SENDS_PER_DAY,
  PROOF_MAX_AGE_SECONDS,
  SWEPT_COLLECTIONS,
  phoneSignInAllowed,
  proofAcceptable,
  trackingLimitKey,
  CODE_TTL_MS,
  DERIVED,
  MAX_CODE_ATTEMPTS,
  PAGE_SIZE,
  PHONE_COLLECTIONS,
  PHONE_RECORD_SOURCES,
  RESEND_AFTER_MS,
  ROLE,
  accountNumbers,
  candidateShows,
  codeAttempt,
  codeHash,
  createPhoneAccounts,
  hiddenDocId,
  isPlaceholderAccount,
  limitDecision,
  limitDocId,
  loginSendLimits,
  mergeShipmentPage,
  millisOf,
  needsRegion,
  newLoginCode,
  notSignedInYet,
  packageRequestPublicRecord,
  parseCursor,
  parseRecordKey,
  pathValue,
  phoneEventNeedsSync,
  privateShipmentItem,
  recordPhonePatch,
  recordPhones,
  shipmentQueries,
  stampIsCurrent,
  CLAIM_STALE_MS,
  CLAIMS_COLLECTION,
  RECENT_RECORD_MS,
};
