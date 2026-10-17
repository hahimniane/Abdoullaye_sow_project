"use strict";

/**
 * Reading the business's connected bank account into
 * `businessBankCredits`: money in only, for the connected account only, with
 * the sender's name as the bank shows it and nothing else from the line.
 *
 * Ported from Wouri (functions/src/services/bankSync.ts) and narrowed to the
 * one question staff have at the counter: did this exact Zelle arrive? It
 * also closes Wouri's gaps: Plaid's `removed` rows are marked removed (never
 * usable again), a pending deposit that posts under a new id keeps the
 * payment it already confirmed, and TRANSACTIONS_SYNC_MUTATION_DURING_
 * PAGINATION restarts the pagination from the saved cursor.
 *
 * Pure functions first; the Firestore glue at the bottom takes its db and
 * Plaid client as arguments so the emulator suite can fake Plaid at fetch.
 */

const {
  MUTATION_DURING_PAGINATION,
  PlaidError,
  bankErrorInfo,
} = require("./plaid_client");

const BANK_LINKS = "businessBankLinks";
const BANK_CREDITS = "businessBankCredits";
/** Plaid pages per sync; the cursor carries on next time past this. */
const MAX_SYNC_PAGES = 20;
/** Restarts after a mutation-during-pagination before giving up. */
const MAX_SYNC_RESTARTS = 3;
/** Firestore allows 500 writes per batch; stay well under. */
const MAX_BATCH_WRITES = 400;
/** getAll reads per round. */
const MAX_GET_ALL = 100;
const MAX_SENDER_NAME = 80;

/**
 * "Sign in again soon" while the feed still works: a sync that succeeds must
 * not clear these; only a new sign-in (or LOGIN_REPAIRED) does.
 */
const STICKY_REAUTH_CODES = new Set([
  "PENDING_EXPIRATION",
  "PENDING_DISCONNECT",
  "USER_PERMISSION_REVOKED",
  "USER_ACCOUNT_REVOKED",
]);

/** ITEM webhook codes after which the owner must sign in again. */
const ITEM_REAUTH_WEBHOOK_CODES = new Set([
  "ERROR",
  "PENDING_EXPIRATION",
  "PENDING_DISCONNECT",
  "USER_PERMISSION_REVOKED",
  "USER_ACCOUNT_REVOKED",
]);

/**
 * @param {string} businessId The business.
 * @param {string} transactionId Plaid's transaction id.
 * @return {string} The credit's document id.
 */
function creditDocId(businessId, transactionId) {
  return `${businessId}_${transactionId}`;
}

/**
 * @param {*} value An ISO 8601 date-time from Plaid, or null.
 * @return {?number} Milliseconds, or null when there is no time.
 */
function parseTimeMs(value) {
  if (typeof value !== "string" || !/T\d{2}:\d{2}/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * @param {*} value A YYYY-MM-DD date from Plaid.
 * @return {string} It, or "".
 */
function dateKeyOf(value) {
  const text = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

/** Words banks put around a Zelle sender's name. */
const SENDER_NOISE = new RegExp([
  "\\bZELLE\\b", "\\bPAYMENT\\b", "\\bTRANSFER\\b", "\\bRECEIVED\\b",
  "\\bFROM\\b", "\\bCREDIT\\b", "\\bDEPOSIT\\b", "\\bINSTANT\\b",
  "\\bCONF(?:IRMATION)?\\s*#?\\s*[A-Z0-9]+", "\\bREF\\s*#?\\s*[A-Z0-9]+",
  "\\bID\\s*#?\\s*[A-Z0-9]*\\d[A-Z0-9]*",
].join("|"), "gi");

/**
 * @param {*} value A name-ish string.
 * @return {string} Trimmed to one line and the stored length.
 */
function tidy(value) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ")
      .trim().slice(0, MAX_SENDER_NAME);
}

/**
 * Who sent the money, as the bank shows it - and only that: the rest of the
 * line (memo, reference numbers) is never stored. Counterparty first, then
 * the words after "from" on the line, then the merchant, then the line with
 * the Zelle noise taken out.
 *
 * @param {object} tx A Plaid transaction.
 * @return {string} The sender's name, "" when the bank gives none.
 */
function senderNameOf(tx) {
  const parties = Array.isArray(tx?.counterparties) ? tx.counterparties : [];
  for (const party of parties) {
    const name = tidy(party?.name);
    if (name) return name;
  }
  const line = String(tx?.name || "");
  const from = line.match(
      /\bfrom\s+(.+?)(?:\s+(?:on|conf|ref|id|memo)\b.*)?$/i);
  if (from) {
    const name = tidy(from[1].replace(SENDER_NOISE, " ")
        .replace(/[;:#]+/g, " "));
    if (name) return name;
  }
  const merchant = tidy(tx?.merchant_name);
  if (merchant) return merchant;
  return tidy(line.replace(SENDER_NOISE, " ").replace(/[;:#*]+/g, " "));
}

/**
 * One Plaid transaction as a stored credit, or null when it is not money
 * that reached the connected account. Plaid signs amounts from the account's
 * side: money in is negative, flipped here exactly once. Pending deposits are
 * kept (staff are told about money the bank already shows).
 *
 * @param {object} tx A Plaid transaction.
 * @param {object} scope {businessId, accountId}.
 * @return {?object} The credit's feed fields.
 */
function creditFromTransaction(tx, scope) {
  if (!tx || typeof tx !== "object") return null;
  const transactionId = String(tx.transaction_id || "");
  if (!transactionId || transactionId.includes("/")) return null;
  if (String(tx.account_id || "") !== scope.accountId) return null;
  const currency = tx.iso_currency_code ?? "USD";
  if (currency !== "USD") return null;
  const amount = Number(tx.amount);
  if (!Number.isFinite(amount)) return null;
  const amountCents = Math.round(-amount * 100);
  if (amountCents <= 0) return null;
  const authorizedAtMs = parseTimeMs(tx.authorized_datetime);
  const postedAtMs = parseTimeMs(tx.datetime);
  const atMs = authorizedAtMs ?? postedAtMs;
  return {
    businessId: scope.businessId,
    transactionId,
    accountId: scope.accountId,
    amountCents,
    pending: tx.pending === true,
    authorizedAtMs,
    postedAtMs,
    atMs,
    timeKnown: atMs !== null,
    dateKey: dateKeyOf(tx.authorized_date) || dateKeyOf(tx.date),
    senderName: senderNameOf(tx),
    pendingTransactionId: tx.pending_transaction_id ?
      String(tx.pending_transaction_id) : "",
  };
}

/**
 * Pages through /transactions/sync from `cursor`.
 *
 * On TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION Plaid says to throw away
 * what this run collected and start again from the cursor it began with.
 * Stops after MAX_SYNC_PAGES with `complete: false`: everything collected so
 * far is consistent up to `nextCursor`, so it is applied and the next sync
 * carries on from there.
 *
 * @param {object} input {fetchPage(cursor), cursor, maxPages, maxRestarts}.
 * @return {Promise<object>} {added, modified, removed, nextCursor, complete,
 *   restarts}.
 */
async function collectSyncPages(input) {
  const maxPages = input.maxPages || MAX_SYNC_PAGES;
  const maxRestarts = input.maxRestarts ?? MAX_SYNC_RESTARTS;
  const start = input.cursor || "";
  let restarts = 0;
  for (;;) {
    const added = [];
    const modified = [];
    const removed = [];
    let cursor = start;
    let complete = false;
    try {
      for (let page = 0; page < maxPages; page += 1) {
        const result = await input.fetchPage(cursor || null);
        added.push(...(result.added || []));
        modified.push(...(result.modified || []));
        removed.push(...(result.removed || []));
        cursor = String(result.next_cursor || cursor || "");
        if (!result.has_more) {
          complete = true;
          break;
        }
      }
      return {added, modified, removed, nextCursor: cursor, complete,
        restarts};
    } catch (error) {
      const code = error instanceof PlaidError ? error.code : "";
      if (code !== MUTATION_DURING_PAGINATION || restarts >= maxRestarts) {
        throw error;
      }
      restarts += 1;
    }
  }
}

/**
 * What one sync writes. Pure.
 *
 * - upserts: new and modified credits (feed fields only - a sync never
 *   touches `consumedBy` or `removed`, so it cannot undo a confirmation).
 * - replacements: a posted deposit that replaces a pending one
 *   (`pending_transaction_id`): written in a transaction that carries the
 *   pending one's confirmation over, so one deposit never confirms twice.
 * - removals: transaction ids Plaid removed; marked removed, never usable.
 *
 * @param {object} input {businessId, accountId, added, modified, removed}.
 * @return {object} {upserts, replacements, removals}.
 */
function planSyncWrites(input) {
  const scope = {businessId: input.businessId, accountId: input.accountId};
  const removedIds = [];
  const removedSet = new Set();
  for (const row of input.removed || []) {
    const id = String(row?.transaction_id || "");
    if (!id || id.includes("/") || removedSet.has(id)) continue;
    removedSet.add(id);
    removedIds.push(id);
  }
  const byId = new Map();
  for (const tx of [...(input.added || []), ...(input.modified || [])]) {
    const credit = creditFromTransaction(tx, scope);
    // Removed later in the same run: the removal wins.
    if (credit && !removedSet.has(credit.transactionId)) {
      byId.set(credit.transactionId, credit);
    }
  }
  const upserts = [];
  const replacements = [];
  const replaced = new Set();
  for (const credit of byId.values()) {
    if (credit.pendingTransactionId &&
        credit.pendingTransactionId !== credit.transactionId) {
      replacements.push(credit);
      replaced.add(credit.pendingTransactionId);
    } else {
      upserts.push(credit);
    }
  }
  // A replaced pending deposit is marked removed by its replacement's
  // transaction, together with the carry-over.
  const removals = removedIds.filter((id) => !replaced.has(id));
  return {upserts, replacements, removals};
}

/**
 * What an ITEM webhook does to the link. Pure.
 *
 * @param {string} webhookCode Plaid's webhook_code.
 * @param {object} error The webhook's error, if any.
 * @return {?object} {status, lastErrorCode} or null when it changes nothing.
 */
function itemWebhookChange(webhookCode, error) {
  const code = String(webhookCode || "");
  if (code === "LOGIN_REPAIRED") {
    return {status: "active", lastErrorCode: null};
  }
  if (!ITEM_REAUTH_WEBHOOK_CODES.has(code)) return null;
  if (code === "ERROR") {
    const errorCode = String(error?.error_code || "ITEM_LOGIN_REQUIRED");
    // An ITEM error that is not about the login (a bank outage) does not
    // need the owner: the next check simply tries again.
    if (!bankErrorInfo(errorCode, error?.error_type).needsReauth) {
      return {status: null, lastErrorCode: errorCode};
    }
    return {status: "needs_reauth", lastErrorCode: errorCode};
  }
  return {status: "needs_reauth", lastErrorCode: code};
}

/**
 * The link fields after a sync that worked. Pure.
 *
 * @param {object} link The stored link.
 * @param {string} cursor The cursor reached.
 * @return {object} The patch (without the timestamp).
 */
function syncSuccessPatch(link, cursor) {
  const sticky = link.status === "needs_reauth" &&
    STICKY_REAUTH_CODES.has(String(link.lastErrorCode || ""));
  return {
    cursor,
    ...(sticky ? {} : {lastErrorCode: null}),
    ...(link.status === "needs_reauth" && !sticky ? {status: "active"} : {}),
  };
}

/**
 * The link fields after a sync that failed. Pure.
 *
 * @param {*} error What the Plaid call threw.
 * @return {object} {patch, info}.
 */
function syncFailurePatch(error) {
  const code = error instanceof PlaidError ? error.code : "NETWORK";
  const info = bankErrorInfo(code, error instanceof PlaidError ?
    error.type : "");
  return {
    patch: {lastErrorCode: code, ...(info.needsReauth ?
      {status: "needs_reauth"} : {})},
    info,
  };
}

/**
 * @param {Array} items Anything.
 * @param {number} size Run length.
 * @return {Array<Array>} Runs of at most `size`.
 */
function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * @param {object} credit From creditFromTransaction.
 * @return {object} The fields a sync writes (no pendingTransactionId).
 */
function feedFields(credit) {
  const fields = {...credit};
  delete fields.pendingTransactionId;
  return fields;
}

/**
 * Writes one sync's plan. Upserts and removals in batches; each replacement
 * in its own transaction.
 *
 * @param {object} ctx {db, FieldValue, businessId}.
 * @param {object} plan From planSyncWrites.
 * @return {Promise<object>} {upserted, replaced, removed}.
 */
async function applySyncPlan(ctx, plan) {
  const {db, FieldValue, businessId} = ctx;
  const credits = db.collection(BANK_CREDITS);
  const now = FieldValue.serverTimestamp();
  const existing = new Set();
  const ids = [...plan.upserts.map((c) => c.transactionId), ...plan.removals];
  for (const part of chunk(ids, MAX_GET_ALL)) {
    const docs = await db.getAll(...part.map((id) =>
      credits.doc(creditDocId(businessId, id))));
    for (const doc of docs) if (doc.exists) existing.add(doc.id);
  }
  const writes = [];
  for (const credit of plan.upserts) {
    const ref = credits.doc(creditDocId(businessId, credit.transactionId));
    writes.push([ref, {...feedFields(credit), syncedAt: now,
      ...(existing.has(ref.id) ? {} : {createdAt: now})}]);
  }
  let removed = 0;
  for (const id of plan.removals) {
    const ref = credits.doc(creditDocId(businessId, id));
    // Only what was stored: an outgoing payment Plaid removed was never ours.
    if (!existing.has(ref.id)) continue;
    writes.push([ref, {removed: true, removedAt: now, syncedAt: now}]);
    removed += 1;
  }
  for (const part of chunk(writes, MAX_BATCH_WRITES)) {
    const batch = db.batch();
    for (const [ref, data] of part) batch.set(ref, data, {merge: true});
    await batch.commit();
  }
  for (const credit of plan.replacements) {
    const newRef = credits.doc(creditDocId(businessId, credit.transactionId));
    const oldRef = credits.doc(
        creditDocId(businessId, credit.pendingTransactionId));
    await db.runTransaction(async (tx) => {
      const [oldDoc, newDoc] = await tx.getAll(oldRef, newRef);
      const old = oldDoc.exists ? oldDoc.data() || {} : null;
      const current = newDoc.exists ? newDoc.data() || {} : null;
      const carry = old && old.consumedBy && !(current && current.consumedBy);
      tx.set(newRef, {
        ...feedFields(credit),
        replacesTransactionId: credit.pendingTransactionId,
        syncedAt: now,
        ...(current ? {} : {createdAt: now}),
        ...(carry ? {consumedBy: old.consumedBy,
          consumedAt: old.consumedAt || now,
          consumedByUid: old.consumedByUid || ""} : {}),
      }, {merge: true});
      if (old) {
        tx.set(oldRef, {removed: true, removedAt: now,
          replacedByTransactionId: credit.transactionId, syncedAt: now},
        {merge: true});
      }
    });
  }
  return {upserted: plan.upserts.length, replaced: plan.replacements.length,
    removed};
}

/**
 * Pulls whatever is new in the connected account and stores the credits.
 * The cursor moves only after everything it covers is written, so a failure
 * part-way reads the same pages again (every write is idempotent).
 *
 * @param {object} ctx {db, FieldValue, businessId, plaid, accessToken,
 *   link (the stored link), logger}.
 * @return {Promise<object>} {ok: true, ...counts} or {ok: false, info, code}.
 */
async function syncBusinessBank(ctx) {
  const {db, FieldValue, businessId, plaid, accessToken, link} = ctx;
  const linkRef = db.collection(BANK_LINKS).doc(businessId);
  let pages;
  try {
    pages = await collectSyncPages({
      cursor: link.cursor || "",
      fetchPage: (cursor) => plaid.syncTransactions(accessToken, cursor),
    });
  } catch (error) {
    const {patch, info} = syncFailurePatch(error);
    await updateLinkIfCurrent(db, linkRef, link.itemId, patch);
    if (ctx.logger) {
      ctx.logger.warn("bank sync failed", {businessId,
        plaidCode: error instanceof PlaidError ? error.code : "NETWORK",
        reason: info.reason});
    }
    return {ok: false, info, code: patch.lastErrorCode};
  }
  const plan = planSyncWrites({businessId, accountId: link.accountId,
    added: pages.added, modified: pages.modified, removed: pages.removed});
  const counts = await applySyncPlan({db, FieldValue, businessId}, plan);
  await updateLinkIfCurrent(db, linkRef, link.itemId, {
    ...syncSuccessPatch(link, pages.nextCursor),
    lastSyncAt: FieldValue.serverTimestamp(),
  });
  return {ok: true, complete: pages.complete, restarts: pages.restarts,
    ...counts};
}

/**
 * Updates the link only if it is still the same bank login and still
 * connected: a sync that finishes after the owner disconnected or connected
 * another bank must not write over it.
 *
 * @param {object} db Firestore.
 * @param {object} linkRef The link document.
 * @param {string} itemId The login the sync read.
 * @param {object} patch The fields.
 * @return {Promise<boolean>} Whether it was written.
 */
async function updateLinkIfCurrent(db, linkRef, itemId, patch) {
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(linkRef);
    const link = doc.exists ? doc.data() || {} : null;
    if (!link || link.itemId !== itemId || link.status === "disconnected") {
      return false;
    }
    tx.update(linkRef, patch);
    return true;
  });
}

module.exports = {
  BANK_CREDITS,
  BANK_LINKS,
  ITEM_REAUTH_WEBHOOK_CODES,
  MAX_BATCH_WRITES,
  MAX_SYNC_PAGES,
  STICKY_REAUTH_CODES,
  applySyncPlan,
  chunk,
  collectSyncPages,
  creditDocId,
  creditFromTransaction,
  itemWebhookChange,
  planSyncWrites,
  senderNameOf,
  syncBusinessBank,
  syncFailurePatch,
  syncSuccessPatch,
  updateLinkIfCurrent,
};
