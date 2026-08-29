/**
 * Business-side barrel fulfillment writes.
 *
 * The status <select> is controlled from Firestore. Confirming an update
 * yields to an in-page dialog; reading event.target.value after that await
 * sees the snapped-back "pending" value and writes it back - a false
 * success. Callers must capture the chosen status before confirming.
 *
 * `in_transit` needs a container / booking / BOL number so the customer
 * can be told where the load is. That number can be saved by the business
 * (manual) or by subscribeToContainerTracking after Terminal49 accepts it.
 * Automated tracking is optional — do not require trackingProvider:
 * carrier_api for a manual in-transit move.
 */

export const BARREL_IN_TRANSIT_NEEDS_CONTAINER =
  "Enter a container, booking, or bill of lading number (at least 4 characters) before marking this barrel in transit.";

export const BARREL_FULFILLMENT_WRITE_REJECTED =
  "This update was rejected. If you are marking the barrel in transit, save a container or bill of lading number first.";

export const BARREL_FULFILLMENT_WRITE_FAILED =
  "The shipment could not be updated. Try again.";

/** Mirror of `validateContainerNumber` in functions/shipment_tracking.js. */
export function normalizeBarrelContainerNumber(value: unknown) {
  const cleaned = String(value ?? "")
    .trim()
    .slice(0, 40)
    .toUpperCase();
  return cleaned.length >= 4 ? cleaned : "";
}

export function barrelContainerReadyForTransit(containerNumber: unknown) {
  return normalizeBarrelContainerNumber(containerNumber).length >= 4;
}

/**
 * Why `in_transit` cannot be written yet.
 *
 * `existingContainerNumber` is already on the shipment; `submittedContainerNumber`
 * is what the operator just typed. Either is enough. Tracking subscription
 * is not required.
 */
export function barrelInTransitBlockedReason(
  status: string,
  existingContainerNumber: unknown,
  submittedContainerNumber: unknown = "",
) {
  if (status !== "in_transit") return "";
  return barrelContainerReadyForTransit(existingContainerNumber) ||
    barrelContainerReadyForTransit(submittedContainerNumber)
    ? ""
    : BARREL_IN_TRANSIT_NEEDS_CONTAINER;
}

export function barrelManualContainerWriteFields(containerNumber: unknown) {
  const container = normalizeBarrelContainerNumber(containerNumber);
  if (!container) return null;
  return {containerNumber: container};
}

/**
 * Fields the console may merge onto barrelShipments for a status change.
 *
 * Includes a newly typed container number so one write can satisfy the
 * in-transit gate. Never writes trackingProvider — automated Terminal49
 * tracking stays a separate, optional subscribe.
 */
export function barrelStatusWriteFields(
  status: string,
  options: {
    submittedContainerNumber?: unknown;
    existingContainerNumber?: unknown;
  } = {},
) {
  const submitted = normalizeBarrelContainerNumber(
    options.submittedContainerNumber,
  );
  const existing = normalizeBarrelContainerNumber(
    options.existingContainerNumber,
  );
  const fields: {status: string; containerNumber?: string} = {status};
  if (submitted && submitted !== existing) {
    fields.containerNumber = submitted;
  }
  return fields;
}

type WriteLikeError = {
  code?: unknown;
  message?: unknown;
};

/**
 * Surface the real reason a barrel write failed.
 *
 * Firestore persistence can acknowledge a local write and then revert when
 * rules reject it — the console must not treat that as silence. Permission
 * denied on this path is almost always the in-transit container gate.
 */
export function barrelFulfillmentWriteErrorMessage(error: unknown) {
  const candidate = (error || {}) as WriteLikeError;
  const code = String(candidate.code || "").replace(/^firestore\//, "");
  const message = String(candidate.message || "").trim();

  if (
    code === "permission-denied" ||
    /insufficient permissions/i.test(message)
  ) {
    return BARREL_FULFILLMENT_WRITE_REJECTED;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message
      .replace(/^Firebase(?:Error)?:\s*/i, "")
      .replace(/\s*\((?:firestore|permission-denied)\/[^)]+\)\.?$/i, "")
      .trim();
  }
  if (message) {
    return message.replace(/^Firebase(?:Error)?:\s*/i, "").trim();
  }
  return BARREL_FULFILLMENT_WRITE_FAILED;
}
