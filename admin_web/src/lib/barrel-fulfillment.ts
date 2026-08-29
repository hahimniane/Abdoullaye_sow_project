/**
 * Business-side barrel fulfillment writes.
 *
 * The status <select> is controlled from Firestore. Confirming an update
 * yields to an in-page dialog; reading event.target.value after that await
 * sees the snapped-back "pending" value and writes it back - a false
 * success. Callers must capture the chosen status before confirming.
 */

export const BARREL_IN_TRANSIT_NEEDS_CONTAINER =
  "Subscribe container tracking before marking this barrel in transit.";

export function barrelContainerReadyForTransit(containerNumber: unknown) {
  return String(containerNumber ?? "").trim().length >= 4;
}

export function barrelInTransitBlockedReason(
  status: string,
  containerNumber: unknown,
) {
  if (status !== "in_transit") return "";
  return barrelContainerReadyForTransit(containerNumber)
    ? ""
    : BARREL_IN_TRANSIT_NEEDS_CONTAINER;
}

export function barrelStatusWriteFields(status: string) {
  return {status};
}
