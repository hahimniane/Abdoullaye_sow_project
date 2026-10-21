// Pure: which Cloud Run revisions are safe to delete.
//
// Keeps, per service, its latest ready revision AND every revision the
// traffic block names (so a pinned or split rollout is never cut). A service
// whose serving revision is unknown is skipped entirely - guessing could take
// the site down.

const SERVICE_LABEL = "serving.knative.dev/service";

/**
 * @param {object[]} services `gcloud run services list --format json` rows.
 * @param {object[]} revisions `gcloud run revisions list --format json` rows.
 * @return {{delete: string[], skippedServices: string[], kept: number}}
 */
export function revisionsToPrune(services, revisions) {
  const keep = new Map();
  const skippedServices = [];
  for (const service of Array.isArray(services) ? services : []) {
    const name = service?.metadata?.name;
    if (!name) continue;
    const serving = service?.status?.latestReadyRevisionName;
    if (!serving) {
      skippedServices.push(name);
      continue;
    }
    const names = new Set([serving]);
    for (const target of service?.status?.traffic || []) {
      if (target?.revisionName) names.add(target.revisionName);
    }
    for (const target of service?.spec?.traffic || []) {
      if (target?.revisionName) names.add(target.revisionName);
    }
    keep.set(name, names);
  }
  const toDelete = [];
  let kept = 0;
  for (const revision of Array.isArray(revisions) ? revisions : []) {
    const name = revision?.metadata?.name;
    const service = revision?.metadata?.labels?.[SERVICE_LABEL];
    if (!name || !service) continue;
    const names = keep.get(service);
    // Unknown or skipped service: never delete its revisions.
    if (!names) continue;
    if (names.has(name)) kept += 1;
    else toDelete.push(name);
  }
  return {delete: toDelete, skippedServices, kept};
}
