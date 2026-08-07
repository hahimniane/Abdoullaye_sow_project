// What actually limits a deploy of this project, measured rather than guessed.
//
// On 2026-08-07 two full deploys exhausted a Cloud Run quota, stranded first 30
// and then 157 functions on revisions that could not serve, and took parking
// receipts and payment links down with them. The first diagnosis here was
// wrong: it summed cpu x maxInstances across revisions and compared that to an
// assumed 4,000 limit. That number is not a quota Cloud Run enforces. The real
// figures, read off the project's quota page in us-central1:
//
//   Total CPU allocation, in MILLI vCPU, per project per region : 20,000
//   Active Revisions per region                                 :  4,000
//   Services per region                                         :  1,000
//
// So the ceiling is 20 vCPU of concurrently allocated CPU, not thousands. Day
// to day the project uses about 3 vCPU and nothing is close to a limit. A
// deploy is what breaks it: each function being rolled out starts a container
// to pass its health check, and starting ~175 of them at once asks for ~175
// vCPU against a 20 vCPU ceiling. That is why deploying two functions worked
// perfectly, batches of 45 half-failed, and the full deploy failed en masse.
//
// The Active Revisions limit is the other one, and is almost certainly what
// caused the original outage: Cloud Run never garbage-collects revisions, and
// this project had accumulated 4,605 of them against a 4,000 limit. Pruning to
// 410 restored service immediately.
//
// Neither is adjustable - the console reports the project is not eligible for
// an increase - so the fix is to deploy within them, not to raise them.

/** Milli vCPU a starting Cloud Run container is allocated, per function. */
export const DEFAULT_FUNCTION_CPU_MILLI = 1000;

/** Total CPU allocation, in milli vCPU, per project per region. */
export const DEFAULT_CPU_LIMIT_MILLI = 20000;

/** Active Revisions per region. */
export const DEFAULT_ACTIVE_REVISION_LIMIT = 4000;

/**
 * Leaves room for the traffic already being served while a deploy runs.
 * A deploy that consumes the entire ceiling starves live requests.
 */
export const DEFAULT_CPU_SAFETY_FRACTION = 0.6;

/**
 * How many functions may roll out at once.
 *
 * Each one starts a container to pass its health check, so the batch size is
 * governed by concurrent CPU, not by anything about the code being deployed.
 *
 * @param {{cpuLimitMilli?: number, perFunctionMilli?: number,
 *   safetyFraction?: number}} options Overrides for the measured defaults.
 * @return {number} Functions per batch, never less than 1.
 */
export function safeDeployBatchSize(options = {}) {
  const limit = Number(options.cpuLimitMilli) > 0 ?
    Number(options.cpuLimitMilli) : DEFAULT_CPU_LIMIT_MILLI;
  const perFunction = Number(options.perFunctionMilli) > 0 ?
    Number(options.perFunctionMilli) : DEFAULT_FUNCTION_CPU_MILLI;
  const fraction = Number(options.safetyFraction) > 0 &&
    Number(options.safetyFraction) <= 1 ?
    Number(options.safetyFraction) : DEFAULT_CPU_SAFETY_FRACTION;
  return Math.max(1, Math.floor((limit * fraction) / perFunction));
}

/**
 * Splits a list of function names into batches that will fit.
 *
 * @param {!Array<string>} names Every function the deploy will touch.
 * @param {number} batchSize From safeDeployBatchSize.
 * @return {!Array<!Array<string>>} Batches, in order.
 */
export function batchFunctionNames(names, batchSize) {
  const list = Array.isArray(names) ? names.filter(Boolean) : [];
  const size = Math.max(1, Math.floor(Number(batchSize) || 1));
  const batches = [];
  for (let index = 0; index < list.length; index += size) {
    batches.push(list.slice(index, index + size));
  }
  return batches;
}

/**
 * Whether the revisions a deploy is about to create still fit.
 *
 * A deploy adds one revision per function and does not remove the old ones -
 * Cloud Run keeps them until something deletes them - so the count only ever
 * climbs without a prune.
 *
 * @param {{activeRevisions: number, functionCount: number,
 *   limit?: number}} input Current count, incoming count, and the ceiling.
 * @return {{fits: boolean, projected: number, limit: number,
 *   headroom: number, remedy: string}} The verdict.
 */
export function revisionCapacity(input) {
  const limit = Number(input?.limit) > 0 ?
    Number(input.limit) : DEFAULT_ACTIVE_REVISION_LIMIT;
  const current = Math.max(0, Number(input?.activeRevisions) || 0);
  const incoming = Math.max(0, Number(input?.functionCount) || 0);
  const projected = current + incoming;
  const fits = projected <= limit;
  return {
    fits,
    projected,
    limit,
    headroom: limit - projected,
    remedy: fits ?
      "" :
      "prune idle Cloud Run revisions before deploying; Cloud Run never " +
        "removes them and the count only climbs",
  };
}
