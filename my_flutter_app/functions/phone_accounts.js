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

// Derived fields: server-written only.
const DERIVED = Object.freeze({
  MISSING: "phoneCountryCodeMissing",
  REPORTED: "phoneReportedNotMine",
  SYNCED_AT: "phoneSyncedAt",
});

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

// ---------------------------------------------------------------------------
// Login codes
// ---------------------------------------------------------------------------

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const RESEND_AFTER_MS = 30 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Send limits (docs/PHONE_ACCOUNTS.md §5.1).
 *
 * @param {{phone: string, ip: string, trackingCode: string}} keys Who.
 * @return {Array<{kind, key, limit, windowMs}>} The buckets to consume.
 */
function loginSendLimits({phone, ip, trackingCode}) {
  const limits = [
    {kind: "phone_hour", key: phone, limit: 5, windowMs: HOUR_MS},
    {kind: "phone_day", key: phone, limit: 10, windowMs: DAY_MS},
  ];
  if (ip) limits.push({kind: "ip_hour", key: ip, limit: 20, windowMs: HOUR_MS});
  if (trackingCode) {
    limits.push({kind: "tracking_hour", key: trackingCode, limit: 5,
      windowMs: HOUR_MS});
  }
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

  /**
   * The account for a number on a record (docs §4). Never throws.
   *
   * @param {{e164: string, displayName: string, source: object}} args Who.
   * @return {Promise<{status: string, uid: string}>} created | reused |
   *   opted_out | invalid | failed.
   */
  async function ensurePhoneAccount({e164, displayName = "", source = {}}) {
    const phone = strictE164(e164);
    if (!phone) return {status: "invalid", uid: ""};
    try {
      const optOut = await db().collection("phoneAccountOptOuts").doc(phone)
          .get();
      if (optOut.exists) return {status: "opted_out", uid: ""};
      let user = await userByPhone(phone);
      let status = "reused";
      if (!user) {
        try {
          user = await auth().createUser({
            phoneNumber: phone,
            ...(cleanText(displayName) ?
              {displayName: cleanText(displayName)} : {}),
          });
          status = "created";
        } catch (error) {
          // A concurrent save made it first: Auth's phone uniqueness is the
          // lock, so both saves end on one account.
          if (error?.code !== "auth/phone-number-already-exists") throw error;
          user = await userByPhone(phone);
          if (!user) throw error;
        }
      }
      const hasOtherSignIn = cleanText(user.email) ||
        (user.providerData || []).some((entry) =>
          entry?.providerId && entry.providerId !== "phone");
      const profileRef = db().collection("users").doc(user.uid);
      if (!hasOtherSignIn) {
        const signedInBefore = Boolean(user.metadata?.lastSignInTime) &&
          status === "reused";
        const nowTs = FieldValue.serverTimestamp();
        try {
          await profileRef.create({
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
          if (error?.code !== 6 && !/already exists/i.test(
              String(error?.message))) {
            throw error;
          }
        }
      }
      return {status, uid: user.uid};
    } catch (error) {
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

  /**
   * Re-derives a record's phone fields in a transaction (so a stale event
   * never writes an old number over a newer one) and ensures the accounts
   * of numbers that appeared. Never throws: a staff save must not fail.
   *
   * @param {string} collection The collection.
   * @param {string} id The record.
   * @param {object} options {after: event data, for the cheap pre-check}.
   * @return {Promise<{written: boolean, accounts: Array<object>}>} What
   *   happened.
   */
  async function syncRecordPhones(collection, id, options = {}) {
    if (!PHONE_RECORD_SOURCES[collection] || !cleanText(id)) {
      return {written: false, accounts: []};
    }
    try {
      if (options.after !== undefined) {
        if (!options.after) return {written: false, accounts: []};
        const region = await regionFor(collection, options.after);
        const quick = recordPhonePatch(collection, options.after, region);
        if (!Object.keys(quick.changes).length) {
          return {written: false, accounts: []};
        }
      }
      const ref = db().collection(collection).doc(id);
      const first = await ref.get();
      if (!first.exists) return {written: false, accounts: []};
      const region = await regionFor(collection, first.data());
      let newNumbers = [];
      const written = await db().runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return false;
        const data = snap.data() || {};
        const patch = recordPhonePatch(collection, data,
            needsRegion(collection, data) ? region : "");
        newNumbers = patch.newNumbers;
        if (!Object.keys(patch.changes).length) return false;
        const update = {[DERIVED.SYNCED_AT]: FieldValue.serverTimestamp()};
        for (const [field, value] of Object.entries(patch.changes)) {
          update[field] = value === null ? FieldValue.delete() : value;
        }
        tx.update(ref, update);
        return true;
      });
      const accounts = await ensureAccountsFor(collection, id, newNumbers);
      return {written, accounts};
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
   * @return {Promise<{profileCreated: boolean, firstSignIn: boolean}>}
   */
  async function signInBookkeeping(uid, e164) {
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
      if (!cleanText(current.phone) || sameNumber(current.phone, e164)) {
        update.phone = e164;
      }
      const firstSignIn = !current.firstSignInAt;
      if (firstSignIn) update.firstSignInAt = nowTs;
      tx.set(ref, update, {merge: true});
      return {profileCreated: false, firstSignIn};
    });
    return result;
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
    if (existing) return {uid: existing.uid, created: false};
    try {
      const made = await auth().createUser({phoneNumber: e164});
      return {uid: made.uid, created: true};
    } catch (error) {
      if (error?.code !== "auth/phone-number-already-exists") throw error;
      const raced = await userByPhone(e164);
      if (!raced) throw error;
      return {uid: raced.uid, created: false};
    }
  }

  /**
   * Gives a signed-in account a number it proved (docs §7), merging a
   * never-signed-in placeholder that holds it.
   *
   * @param {string} uid The account.
   * @param {string} e164 The proven number.
   * @return {Promise<{linked: boolean, merged: boolean}>} What happened.
   */
  async function linkPhoneToAccount(uid, e164) {
    const caller = await auth().getUser(uid);
    if (caller.phoneNumber === e164) {
      await signInBookkeeping(uid, e164);
      return {linked: true, merged: false};
    }
    const holder = await userByPhone(e164);
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
    await signInBookkeeping(uid, e164);
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
            ...blocked.map((decision) => decision.retryAfterMs))};
      }
      decisions.forEach((decision, index) => tx.set(refs[index], {
        ...decision.next,
        kind: limits[index].kind,
        expiresAt: deps.Timestamp.fromMillis(nowMs +
          limits[index].windowMs * 2),
      }));
      return {allowed: true, retryAfterMs: 0};
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
    if (purpose === "link" && (!request.auth || isAnonymous(request))) {
      throw refusal("unauthenticated", "sign_in_required",
          "Sign in to add a phone number to your account");
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
    // An address the front end could not determine is everyone's: never
    // a bucket of its own (it would let one caller block every sign-in).
    const address = cleanText(deps.clientAddress(request), 80);
    const limit = await consumeSendLimits(loginSendLimits({
      phone: e164, ip: address && address !== "unknown" ? address : "",
      trackingCode}));
    if (!limit.allowed) {
      throw refusal("resource-exhausted", "rate_limited",
          "Too many codes. Please wait and try again.",
          {retryAfterMs: Math.max(0, Math.round(limit.retryAfterMs))});
    }
    const holder = await userByPhone(e164);
    let preferredLanguage = "";
    if (holder) {
      const profile = await db().collection("users").doc(holder.uid).get();
      preferredLanguage = cleanText(profile.data()?.preferredLanguage, 5);
    }
    const challengeRef = db().collection("phoneLoginChallenges").doc(
        crypto.randomBytes(16).toString("hex"));
    const code = newLoginCode();
    const nowMs = now();
    const expiresAtMs = nowMs + CODE_TTL_MS;
    await challengeRef.set({
      phoneE164: e164,
      codeHash: codeHash(challengeRef.id, code),
      purpose,
      linkUid: purpose === "link" ? request.auth.uid : "",
      expiresAtMs,
      attempts: 0,
      status: "open",
      source: trackingCode ? "tracking" : "phone",
      createdAtMs: nowMs,
      expiresAt: deps.Timestamp.fromMillis(expiresAtMs + DAY_MS),
    });
    const sent = await deps.sendWhatsApp(deps.loginMessage({phone: e164, code,
      language: loginLanguage(e164, preferredLanguage)}));
    if (!sent?.ok) {
      await challengeRef.update({status: "unsent",
        error: cleanText(sent?.error, 300)});
      throw refusal("failed-precondition", "whatsapp_unavailable",
          "The WhatsApp code could not be sent. Send a text instead.");
    }
    return {
      challengeId: challengeRef.id,
      channel: "whatsapp",
      lastTwo: lastTwo(e164),
      expiresAtMs,
      resendAfterMs: RESEND_AFTER_MS,
    };
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
        decoded = await auth().verifyIdToken(proof);
      } catch (_) {
        throw refusal("invalid-argument", "proof_invalid",
            "Verify the number again");
      }
      const e164 = strictE164(decoded.phone_number);
      if (!e164 || decoded.firebase?.sign_in_provider !== "phone") {
        throw refusal("invalid-argument", "proof_invalid",
            "Verify the number again");
      }
      return linkPhoneToAccount(uid, e164);
    }
    const userRecord = await auth().getUser(uid);
    const e164 = strictE164(userRecord.phoneNumber);
    if (!e164) {
      throw refusal("failed-precondition", "no_verified_phone",
          "Sign in with your phone first");
    }
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
      const fields = (PHONE_RECORD_SOURCES[target.collection] || [])
          .filter((source) => data && candidateShows({
            collection: target.collection, raw: source.raw, data}, e164))
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
      await db().collection("phoneAccountOptOuts").doc(phone).set({
        uid: cleanText(uid, 128),
        deletedAt: FieldValue.serverTimestamp(),
      });
    } catch (error) {
      log.warn("Phone opt-out not recorded", {
        error: error?.message || String(error)});
    }
  }

  const ACTIONS = Object.freeze({
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
    completePhoneSignIn,
    ensurePhoneAccount,
    ensureRecordAccounts,
    getMyShipments,
    linkPhoneToAccount,
    recordOptOut,
    reportShipmentNotMine,
    requestPhoneLoginCode,
    signInBookkeeping,
    syncRecordPhones,
    verifyPhoneLoginCode,
  };
}

module.exports = {
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
  privateShipmentItem,
  recordPhonePatch,
  recordPhones,
  shipmentQueries,
};
