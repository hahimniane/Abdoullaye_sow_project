"use strict";

// When the stale-payment sweep (reconcileStaleStripePayments) looks at a
// pending record again. Scheduling only: what the sweep DOES with a record
// (ask Stripe, reconcile) is decided elsewhere and untouched here.
//
// Before: the sweep selected `paymentStatus in [pending, processing] &&
// updatedAt <= now - 10 min`, and every check rewrote updatedAt - so an
// abandoned checkout was re-read, re-asked of Stripe and re-written every
// 10 minutes forever, records that hit a `continue` (no session yet, session
// not paid, simulated) were re-selected on every run without ever moving,
// and one scan with a big backlog could use the whole run before the next
// scan got a turn.
//
// Now each record carries, per scan, `reconcileSchedule.<scanId>`:
//   {key, attempts, startedAtMs, nextCheckAt, lastCheckedAtMs,
//    abandonedAtMs?, abandonReason?}
// `nextCheckAt` (the dedicated "reconcileNextCheckAt") backs off
// exponentially, every processed record advances it - including the ones that
// `continue` - and after MAX_RECONCILE_AGE_MS the record is marked abandoned
// and drops out of the due query. A new payment attempt (a different intent or
// session) gets a fresh schedule.

const BASE_RECONCILE_DELAY_MS = 10 * 60 * 1000;
const MAX_RECONCILE_DELAY_MS = 24 * 60 * 60 * 1000;
const MAX_RECONCILE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The handle a schedule belongs to. When it changes the customer started a
 * new attempt, and the backoff starts over.
 *
 * @param {string} intentId The PaymentIntent id, if any.
 * @param {string} sessionId The Checkout Session id, if any.
 * @return {string} "pi:..", "cs:.." or "none".
 */
function reconcileTrackingKey(intentId, sessionId) {
  const intent = String(intentId || "").trim();
  if (intent) return `pi:${intent}`;
  const session = String(sessionId || "").trim();
  if (session) return `cs:${session}`;
  return "none";
}

/**
 * Delay before check number `attempts + 1`: 10 min, 20, 40, ... capped at a
 * day.
 *
 * @param {number} attempts Checks already made (1 after the first).
 * @return {number} Milliseconds.
 */
function reconcileBackoffMs(attempts) {
  const n = Math.max(1, Math.trunc(Number(attempts) || 1));
  // 2^20 x 10 minutes is far past the cap; clamp the exponent so huge
  // attempt counts cannot overflow to Infinity.
  const factor = 2 ** Math.min(20, n - 1);
  return Math.min(MAX_RECONCILE_DELAY_MS, BASE_RECONCILE_DELAY_MS * factor);
}

/**
 * Whether the discovery pass should check a record it found, or leave it to
 * its existing schedule.
 *
 * @param {object|undefined} schedule The stored reconcileSchedule.<scanId>.
 * @param {string} key reconcileTrackingKey for the record as it is now.
 * @return {boolean} True when the record has no schedule for this attempt.
 */
function needsFreshSchedule(schedule, key) {
  return !schedule || typeof schedule !== "object" || schedule.key !== key;
}

/**
 * The schedule to store after checking a record once.
 *
 * @param {object} args
 * @param {object|undefined} args.previous Stored schedule, if any.
 * @param {string} args.key reconcileTrackingKey now.
 * @param {number} args.nowMs The check time.
 * @param {number} [args.recordStartedAtMs] When the payment attempt began
 *   (createdAt), used only for a fresh schedule; falls back to now.
 * @param {string} [args.abandonReason] Abandon immediately (e.g. a simulated
 *   intent that Stripe will never know about).
 * @return {object} {key, attempts, startedAtMs, lastCheckedAtMs,
 *   nextCheckAtMs|null, abandoned, abandonReason?}.
 */
function planNextReconcileCheck({previous, key, nowMs, recordStartedAtMs,
  abandonReason}) {
  const continuing = !needsFreshSchedule(previous, key);
  const attempts = continuing ?
    Math.max(0, Math.trunc(Number(previous.attempts) || 0)) + 1 : 1;
  const started = Number(continuing ? previous.startedAtMs : recordStartedAtMs);
  const startedAtMs = Number.isFinite(started) && started > 0 &&
    started <= nowMs ? started : nowMs;
  const base = {key, attempts, startedAtMs, lastCheckedAtMs: nowMs};
  if (abandonReason) {
    return {...base, nextCheckAtMs: null, abandoned: true, abandonReason};
  }
  if (nowMs - startedAtMs >= MAX_RECONCILE_AGE_MS) {
    return {...base, nextCheckAtMs: null, abandoned: true,
      abandonReason: "max_age"};
  }
  return {...base, nextCheckAtMs: nowMs + reconcileBackoffMs(attempts),
    abandoned: false};
}

/**
 * The order scans take turns in this run. Rotating the start each run means
 * no scan is always last when the deadline cuts a run short.
 *
 * @param {Array} items The scans (or scan streams).
 * @param {number} nowMs The run time.
 * @param {number} [periodMs] The schedule period.
 * @return {Array} The same items, rotated.
 */
function rotateForRun(items, nowMs, periodMs = BASE_RECONCILE_DELAY_MS) {
  const list = Array.isArray(items) ? items.slice() : [];
  if (list.length === 0) return list;
  const offset = Math.floor(Number(nowMs) / periodMs) % list.length;
  return list.slice(offset).concat(list.slice(0, offset));
}

/**
 * Round-robin over independent page sources: each active source gets one
 * page per round, so a source with a huge backlog cannot starve the others.
 *
 * @param {object} args
 * @param {Array<{id: string, nextPage: function(): Promise<boolean>}>}
 *   args.sources nextPage resolves true while the source has more.
 * @param {number} args.deadlineMs Stop starting pages at or after this.
 * @param {function(): number} [args.now] Clock.
 * @return {Promise<object>} {rounds, pagesBySource, deadlineReached}.
 */
async function roundRobinPages({sources, deadlineMs, now = Date.now}) {
  const active = new Set((sources || []).map((source) => source.id));
  const pagesBySource = {};
  let rounds = 0;
  let deadlineReached = false;
  while (active.size > 0) {
    rounds += 1;
    for (const source of sources) {
      if (!active.has(source.id)) continue;
      if (now() >= deadlineMs) {
        deadlineReached = true;
        break;
      }
      pagesBySource[source.id] = (pagesBySource[source.id] || 0) + 1;
      const more = await source.nextPage();
      if (!more) active.delete(source.id);
    }
    if (deadlineReached) break;
  }
  return {rounds, pagesBySource, deadlineReached};
}

module.exports = {
  BASE_RECONCILE_DELAY_MS,
  MAX_RECONCILE_AGE_MS,
  MAX_RECONCILE_DELAY_MS,
  needsFreshSchedule,
  planNextReconcileCheck,
  reconcileBackoffMs,
  reconcileTrackingKey,
  rotateForRun,
  roundRobinPages,
};
