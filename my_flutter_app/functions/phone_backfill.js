"use strict";

/**
 * The one-time launch backfill for phone accounts (docs/PHONE_ACCOUNTS.md
 * §11): writes the derived phone fields on existing records and makes the
 * accounts of every sender and receiver number on them.
 *
 * Bounded (a record limit and a deadline per run), resumable (an opaque
 * cursor: collection + last document id), idempotent (the same convergent
 * patch the triggers write, and accounts reused when they exist), and a dry
 * run by default. Run by scripts/backfill-phone-accounts.js.
 */

const {
  PHONE_COLLECTIONS,
  accountNumbers,
  needsRegion,
  recordPhonePatch,
} = require("./phone_accounts");

const PAGE = 200;

/**
 * @param {*} token A cursor from a previous run.
 * @return {{collectionIndex: number, lastId: string}} Where to start.
 */
function decodeCursor(token) {
  if (!token) return {collectionIndex: 0, lastId: ""};
  try {
    const parsed = JSON.parse(Buffer.from(String(token), "base64url")
        .toString("utf8"));
    const index = Number(parsed.c);
    if (!Number.isInteger(index) || index < 0 ||
        index >= PHONE_COLLECTIONS.length) {
      throw new Error("bad index");
    }
    return {collectionIndex: index, lastId: String(parsed.id || "")};
  } catch (_) {
    throw new Error("--cursor is not a cursor this script printed");
  }
}

/**
 * @param {number} collectionIndex Which collection.
 * @param {string} lastId The last id done in it.
 * @return {string} The cursor to print.
 */
function encodeCursor(collectionIndex, lastId) {
  return Buffer.from(JSON.stringify({c: collectionIndex, id: lastId}))
      .toString("base64url");
}

const emptyCounts = () => ({scanned: 0, stamped: 0, flagged: 0, numbers: 0,
  created: 0, reused: 0, optedOut: 0, failed: 0, missingCreatedAt: 0});

/**
 * @param {object} args {db, accounts (createPhoneAccounts instance), auth,
 *   FieldPath, businessId, commit, limit, cursor, deadlineMs, nowMs}.
 * @return {Promise<{report: object, cursor: string, done: boolean}>} What
 *   was (or would be) done, and where the next run starts ("" when done).
 */
async function backfillPhoneAccounts(args) {
  const limit = Math.max(1, Math.min(Number(args.limit) || 500, 5000));
  const now = args.nowMs || (() => Date.now());
  const deadline = Number(args.deadlineMs) || now() + 9 * 60 * 1000;
  const start = decodeCursor(args.cursor);
  const report = {};
  let scanned = 0;
  // A dry run counts each number once, however many records carry it.
  const seen = new Set();
  for (let index = start.collectionIndex; index < PHONE_COLLECTIONS.length;
    index += 1) {
    const collection = PHONE_COLLECTIONS[index];
    const counts = report[collection] = emptyCounts();
    let lastId = index === start.collectionIndex ? start.lastId : "";
    for (;;) {
      if (scanned >= limit || now() > deadline) {
        return {report, cursor: encodeCursor(index, lastId), done: false};
      }
      let query = args.db.collection(collection);
      if (args.businessId) {
        query = query.where("businessId", "==",
            args.businessId);
      }
      query = query.orderBy(args.FieldPath.documentId());
      if (lastId) query = query.startAfter(lastId);
      const size = Math.min(PAGE, limit - scanned);
      const page = await query.limit(size).get();
      if (page.empty) break;
      for (const doc of page.docs) {
        const data = doc.data() || {};
        scanned += 1;
        counts.scanned += 1;
        lastId = doc.id;
        if (!data.createdAt) counts.missingCreatedAt += 1;
        const region = needsRegion(collection, data) ?
          await args.accounts.businessRegion(data.businessId) : "";
        const patch = recordPhonePatch(collection, data, region);
        if (Object.keys(patch.changes).length) counts.stamped += 1;
        const missing = patch.changes.phoneCountryCodeMissing !== undefined ?
          patch.changes.phoneCountryCodeMissing :
          data.phoneCountryCodeMissing;
        if (Array.isArray(missing) && missing.length) counts.flagged += 1;
        const numbers = accountNumbers(collection, data, region);
        counts.numbers += numbers.length;
        if (!args.commit) {
          for (const phone of numbers) {
            if (seen.has(phone.e164)) continue;
            seen.add(phone.e164);
            const exists = await args.auth.getUserByPhoneNumber(phone.e164)
                .then(() => true, () => false);
            if (exists) counts.reused += 1;
            else counts.created += 1;
          }
          continue;
        }
        if (Object.keys(patch.changes).length) {
          await args.accounts.syncRecordPhones(collection, doc.id);
        }
        const results = await args.accounts.ensureRecordAccounts(collection,
            doc.id);
        for (const result of results) {
          if (result.status === "created") counts.created += 1;
          else if (result.status === "reused") counts.reused += 1;
          else if (result.status === "opted_out") counts.optedOut += 1;
          else counts.failed += 1;
        }
      }
      if (page.size < size) break;
    }
  }
  return {report, cursor: "", done: true};
}

module.exports = {
  backfillPhoneAccounts,
  decodeCursor,
  encodeCursor,
};
