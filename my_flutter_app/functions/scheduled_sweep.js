"use strict";

// Shared shape for scheduled jobs and fan-out reads that must stay bounded:
// a deadline derived from the function's own timeout, cursor paging that
// stops at that deadline, and a concurrency cap for parallel work. Pure (the
// caller supplies the page fetcher and the clock) so it is unit-tested
// without Firestore.

/**
 * The wall-clock moment a job must stop starting new work.
 *
 * @param {object} args
 * @param {number} args.startMs When the job began.
 * @param {number} args.timeoutSeconds The function's timeoutSeconds.
 * @param {number} [args.fraction] Share of the timeout this work may use.
 * @param {number} [args.reserveMs] Kept back for logging and the last write.
 * @return {number} Milliseconds since the epoch.
 */
function sweepDeadline({startMs, timeoutSeconds, fraction = 1,
  reserveMs = 30 * 1000}) {
  const budgetMs = Math.max(0, Number(timeoutSeconds) * 1000 - reserveMs);
  const share = Math.min(1, Math.max(0, Number(fraction)));
  return Number(startMs) + Math.floor(budgetMs * share);
}

/**
 * Runs `fn` over `items` with at most `limit` in flight. Never rejects: each
 * result is {status, value|reason} like Promise.allSettled, in input order,
 * so one failing lot or record cannot take down the rest.
 *
 * @param {Array} items The work.
 * @param {number} limit Most concurrent calls (at least 1).
 * @param {function(*, number): Promise<*>} fn The worker.
 * @return {Promise<Array<object>>} Settled results.
 */
async function mapWithConcurrency(items, limit, fn) {
  const list = Array.isArray(items) ? items : [];
  const results = new Array(list.length);
  const width = Math.max(1, Math.min(Number(limit) || 1, list.length || 1));
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const index = next;
      next += 1;
      try {
        results[index] = {status: "fulfilled",
          value: await fn(list[index], index)};
      } catch (error) {
        results[index] = {status: "rejected", reason: error};
      }
    }
  }
  await Promise.all(Array.from({length: width}, worker));
  return results;
}

/**
 * Pages through a query with a cursor until it runs dry or the deadline
 * passes. The deadline is checked before each page, so a page that started
 * is always finished (its records are never half-processed).
 *
 * @param {object} args
 * @param {function(*): Promise<Array>} args.fetchPage Given the cursor (null
 *   first), resolves one page of documents.
 * @param {function(Array): Promise<void>} args.processPage Handles a page.
 * @param {number} args.pageSize The page limit used by fetchPage.
 * @param {number} args.deadlineMs Stop starting pages at or after this.
 * @param {function(): number} [args.now] Clock (tests pass a fake).
 * @param {number} [args.maxPages] Hard stop, as a guard against a cursor
 *   that never advances.
 * @return {Promise<object>} {pages, processed, exhausted, deadlineReached}.
 */
async function drainPages({fetchPage, processPage, pageSize, deadlineMs,
  now = Date.now, maxPages = 1000}) {
  let cursor = null;
  let pages = 0;
  let processed = 0;
  let exhausted = false;
  while (pages < maxPages) {
    if (now() >= deadlineMs) break;
    const docs = await fetchPage(cursor);
    pages += 1;
    if (docs.length > 0) {
      await processPage(docs);
      processed += docs.length;
      cursor = docs[docs.length - 1];
    }
    if (docs.length < pageSize) {
      exhausted = true;
      break;
    }
  }
  return {pages, processed, exhausted,
    deadlineReached: !exhausted && now() >= deadlineMs};
}

module.exports = {
  drainPages,
  mapWithConcurrency,
  sweepDeadline,
};
