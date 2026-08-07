// Why a deploy can pass every check and still take production down.
//
// Cloud Run charges the project's "Total allowable CPU per project per region"
// quota for CPU that revisions have RESERVED, not CPU they use, and it never
// garbage-collects old revisions. Every deploy leaves another revision behind
// on every function, each still holding its cpu x maxInstances, at zero
// traffic, forever.
//
// On 2026-08-07 this project had accumulated 4,605 revisions across ~178
// functions. A routine deploy pushed past the ceiling: 30 functions were left
// on a revision that could not serve, live calls returned 429 and 503, and
// printing a parking receipt broke. The deploy's own preflight had passed
// 15/15 immediately beforehand, because its dry run never creates a revision
// and so never touches the quota. It reported a locked door as open by not
// pushing on it.
//
// These helpers are pure so the arithmetic can be tested without a project.

/** Cloud Run's default when a revision does not pin maxInstances. */
export const DEFAULT_MAX_INSTANCES = 100;

/**
 * Reserved CPU for one revision: what it holds whether or not it serves.
 *
 * @param {{cpu?: string|number, maxInstances?: string|number}} revision A revision.
 * @return {number} CPU reserved, or 0 when the row is unreadable.
 */
export function revisionReservedCpu(revision) {
  const cpu = Number(revision?.cpu);
  const max = Number(revision?.maxInstances);
  if (!Number.isFinite(cpu) || cpu <= 0) return 0;
  const instances = Number.isFinite(max) && max > 0 ? max : DEFAULT_MAX_INSTANCES;
  return cpu * instances;
}

/**
 * What the region is holding right now, and how much of it is dead weight.
 *
 * "Debt" is the reserved CPU held by revisions that serve no traffic. It is
 * the recoverable part - deleting those revisions frees it immediately and
 * changes nothing a user can see.
 *
 * @param {!Array<Object>} revisions Revisions, each {service, name, cpu, maxInstances, serving}.
 * @return {{reservedCpu: number, debtCpu: number, servingCpu: number,
 *   total: number, idle: number}} The picture.
 */
export function summarizeReservations(revisions) {
  const rows = Array.isArray(revisions) ? revisions : [];
  let reservedCpu = 0;
  let debtCpu = 0;
  let idle = 0;
  for (const row of rows) {
    const cpu = revisionReservedCpu(row);
    reservedCpu += cpu;
    if (!row?.serving) {
      debtCpu += cpu;
      idle += 1;
    }
  }
  return {
    reservedCpu,
    debtCpu,
    servingCpu: reservedCpu - debtCpu,
    total: rows.length,
    idle,
  };
}

/**
 * Whether a deploy of `functionCount` functions can fit.
 *
 * A deploy does not replace revisions in place: it creates a new one per
 * function and holds BOTH until the new one is healthy. So the peak is what
 * is reserved now plus what the deploy is about to add - which is the number
 * this must judge, and the number the old preflight never computed.
 *
 * @param {{reservedCpu: number, debtCpu: number}} summary From summarizeReservations.
 * @param {number} functionCount How many functions the deploy will touch.
 * @param {number} perFunctionCpu Reserved CPU each new revision will hold.
 * @param {number} limitCpu The region's total allowable CPU.
 * @return {{fits: boolean, projected: number, headroom: number,
 *   fitsAfterPrune: boolean, projectedAfterPrune: number, remedy: string}} The verdict.
 */
export function deployCapacity(
    summary,
    functionCount,
    perFunctionCpu,
    limitCpu,
) {
  const reserved = Number(summary?.reservedCpu) || 0;
  const debt = Number(summary?.debtCpu) || 0;
  const incoming = Math.max(0, Number(functionCount) || 0) *
    Math.max(0, Number(perFunctionCpu) || 0);
  const limit = Number(limitCpu) || 0;

  const projected = reserved + incoming;
  const projectedAfterPrune = reserved - debt + incoming;
  const fits = limit > 0 && projected <= limit;
  const fitsAfterPrune = limit > 0 && projectedAfterPrune <= limit;

  let remedy = "";
  if (!fits) {
    remedy = fitsAfterPrune ?
      `prune idle revisions first - that frees ${Math.round(debt)} CPU and ` +
        "brings this deploy inside the limit" :
      "pruning alone is not enough; raise the Cloud Run 'Total allowable CPU' " +
        "quota for this region, or lower maxInstances on more functions";
  }

  return {
    fits,
    projected,
    headroom: limit - projected,
    fitsAfterPrune,
    projectedAfterPrune,
    remedy,
  };
}
