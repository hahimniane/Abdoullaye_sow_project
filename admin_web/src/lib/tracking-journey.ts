/**
 * A shipment's journey, as a customer thinks about it.
 *
 * The status vocabulary is written for staff ("pending",
 * "awaiting_weight_confirmation"), and a customer reading "pending" learns
 * nothing about where their barrel is. These four stages are what they
 * actually want to know: is it booked, has it left, is it nearly there, can
 * I collect it.
 *
 * Freight's payment-settlement statuses all sit inside "Booked" on purpose -
 * they are billing steps, not movement, and a customer watching for their
 * parcel does not care which one is in progress.
 */

export type JourneyStageId = "booked" | "in_transit" | "arrived" | "delivered";

export type JourneyStage = {
  id: JourneyStageId;
  label: string;
  /** What the customer should understand this stage to mean. */
  hint: string;
};

export const JOURNEY_STAGES: readonly JourneyStage[] = [
  {id: "booked", label: "Booked", hint: "Your booking is confirmed"},
  {id: "in_transit", label: "On its way", hint: "Shipped and travelling"},
  {id: "arrived", label: "Arrived", hint: "Landed at the destination"},
  {id: "delivered", label: "Delivered", hint: "Handed over"},
];

/**
 * The same four beats, worded for a parcel the business is taking to the
 * receiver's own address.
 *
 * A parcel on its way to someone's door is not waiting at a counter, and a
 * receiver reading "collect it from the business" would go to the wrong
 * place. The stage ids are identical on purpose: how a shipment ends is a
 * property of the booking, not a new position in the journey, and inventing
 * statuses for it would fan out through every hardcoded status list.
 */
export const DELIVERY_JOURNEY_STAGES: readonly JourneyStage[] = [
  {id: "booked", label: "Booked", hint: "Your booking is confirmed"},
  {id: "in_transit", label: "On its way", hint: "Shipped and travelling"},
  {
    id: "arrived",
    label: "Arrived",
    hint: "Landed, and on its way to the receiver's address",
  },
  {
    id: "delivered",
    label: "Delivered",
    hint: "Delivered to the receiver's address",
  },
];

/**
 * The stage wording for one shipment.
 *
 * @param destinationDelivery Whether the business is taking it to the
 *   receiver rather than holding it for collection.
 * @return The four stages, worded for that ending.
 */
export function journeyStagesFor(
  destinationDelivery = false,
): readonly JourneyStage[] {
  return destinationDelivery ? DELIVERY_JOURNEY_STAGES : JOURNEY_STAGES;
}

const STAGE_BY_STATUS: Record<string, JourneyStageId> = {
  pending_payment: "booked",
  awaiting_weight_confirmation: "booked",
  awaiting_balance_payment: "booked",
  settlement_processing: "booked",
  pending: "booked",
  in_transit: "in_transit",
  ready_for_pickup: "arrived",
  completed: "delivered",
};

/**
 * A transported car's journey. Same four-beat shape as a barrel's, but the
 * middle beat is the carrier committing to a date - a car is not "at sea"
 * by default, someone has to come and get it.
 */
export const TRANSPORT_JOURNEY_STAGES: readonly JourneyStage[] = [
  {id: "booked", label: "Booked", hint: "Carrier chosen and paid"},
  {id: "in_transit", label: "Scheduled", hint: "Pickup is arranged"},
  {id: "arrived", label: "On its way", hint: "Your car is travelling"},
  {id: "delivered", label: "Delivered", hint: "Handed over"},
];

const TRANSPORT_STAGE_BY_STATUS: Record<string, JourneyStageId> = {
  quote_requested: "booked",
  pending_payment: "booked",
  pending: "booked",
  scheduled: "in_transit",
  in_transit: "arrived",
  delivered: "delivered",
};

/**
 * Which transport stage a job is in. Cancelled jobs get null, exactly like
 * shipments - a stalled bar reads as broken.
 *
 * @param status The job's stored status (fulfillmentStatus preferred).
 * @return The stage id and index, or null when there is no journey.
 */
export function transportJourneyStageFor(status: string): {
  id: JourneyStageId;
  index: number;
} | null {
  const key = String(status || "").trim();
  if (key === "cancelled") return null;
  const id = TRANSPORT_STAGE_BY_STATUS[key] ?? "booked";
  return {
    id,
    index: TRANSPORT_JOURNEY_STAGES.findIndex((stage) => stage.id === id),
  };
}

/**
 * Which stage a shipment is in, and how far along that is.
 *
 * A cancelled shipment has no stage - it left the journey - so callers get
 * null and show their own cancelled treatment rather than a stalled bar.
 *
 * @param status The shipment's stored status.
 * @return The stage id and its index, or null when there is no journey.
 */
export function journeyStageFor(status: string): {
  id: JourneyStageId;
  index: number;
} | null {
  const key = String(status || "").trim();
  if (key === "cancelled") return null;
  const id = STAGE_BY_STATUS[key] ?? "booked";
  return {id, index: JOURNEY_STAGES.findIndex((stage) => stage.id === id)};
}

/**
 * A short, human sentence for how long ago something happened.
 *
 * "2 days ago" tells a customer whether their shipment is moving; a raw date
 * makes them do the arithmetic themselves.
 *
 * @param value A Firestore timestamp, Date, or ISO string.
 * @param nowMs Current time, injectable so this is testable.
 * @return A relative phrase, or "" when there is no usable date.
 */
export function relativeTime(value: unknown, nowMs = Date.now()): string {
  const ms = toMillis(value);
  if (!ms) return "";
  const diff = nowMs - ms;
  if (diff < 0) return "just now";
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return days === 1 ? "yesterday" : `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
  const months = Math.floor(days / 30);
  return months <= 1 ? "1 month ago" : `${months} months ago`;
}

function toMillis(value: unknown): number {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const record = value as {seconds?: number; toDate?: () => Date};
  if (typeof record.toDate === "function") {
    const date = record.toDate();
    return date instanceof Date ? date.getTime() : 0;
  }
  if (typeof record.seconds === "number") return record.seconds * 1000;
  return 0;
}

const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Payment pending",
  awaiting_weight_confirmation: "Awaiting weight check",
  awaiting_balance_payment: "Balance due",
  settlement_processing: "Payment processing",
  pending: "Booked",
  quote_requested: "Collecting quotes",
  scheduled: "Pickup scheduled",
  in_transit: "On its way",
  ready_for_pickup: "Ready for pickup",
  completed: "Delivered",
  cancelled: "Cancelled",
};

/**
 * How the same statuses read on a shipment the business is delivering.
 *
 * Only the arrival beat differs: nobody is picking this parcel up, so the
 * pill has to say what is actually happening to it instead of sending the
 * receiver to a counter.
 */
const DELIVERY_STATUS_LABEL: Record<string, string> = {
  ready_for_pickup: "Out for delivery",
};

/**
 * The status pill's wording, for a customer rather than for staff.
 *
 * The stored value is a database enum - "in_transit", "pending_payment" - and
 * printing it raw puts "in_transit" beside a progress bar that says "On its
 * way" in the same card. Anything unrecognised falls back to the underscored
 * value made readable, so a status added later degrades instead of vanishing.
 *
 * @param status The shipment's stored status.
 * @param destinationDelivery Whether the business is taking it to the
 *   receiver rather than holding it for collection.
 * @return Wording safe to show a customer.
 */
export function statusLabel(
  status: string,
  destinationDelivery = false,
): string {
  const key = String(status || "").trim();
  if (!key) return "Booked";
  if (destinationDelivery && DELIVERY_STATUS_LABEL[key]) {
    return DELIVERY_STATUS_LABEL[key];
  }
  return STATUS_LABEL[key] ?? key.replace(/_/g, " ");
}

export type StatusBucket = "payment" | "active" | "completed" | "cancelled";

export const STATUS_BUCKETS: ReadonlyArray<{
  id: StatusBucket;
  label: string;
}> = [
  {id: "payment", label: "Needs payment"},
  {id: "active", label: "In progress"},
  {id: "completed", label: "Completed"},
  {id: "cancelled", label: "Cancelled"},
];

/**
 * Which filter bucket a record belongs to, across every service.
 *
 * Four buckets, not one per status: a customer filtering their orders wants
 * "which ones need me", "which are moving", "which are done" - not a chip
 * for every word the backend can write. "Needs payment" is first because it
 * is the only bucket where the next action is the customer's.
 *
 * @param status The record's stored status.
 * @return The bucket the record files under.
 */
export function statusBucket(status: string): StatusBucket {
  const key = String(status || "").trim().toLowerCase();
  if (key === "pending_payment" || key === "awaiting_balance_payment") {
    return "payment";
  }
  if (key === "cancelled" || key === "refunded") return "cancelled";
  if (["completed", "delivered", "sold", "picked_up"].includes(key)) {
    return "completed";
  }
  return "active";
}

/**
 * The secondary line under a milestone: where it happened and what happened.
 *
 * Carrier events always arrive with an empty location - Terminal49 reports a
 * status, not a place - so this must drop blanks rather than let a "Unknown"
 * placeholder through. Every carrier milestone would carry one otherwise.
 *
 * @param event One trackingEvents document.
 * @return "Newark, NJ · Loaded", "Container MSCU1234567", or "".
 */
export function eventDetail(event: Record<string, unknown>): string {
  return [event.location, event.description]
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean)
      .join(" · ");
}

/**
 * The delivery window a customer was quoted, as one readable phrase.
 *
 * @param row A shipment row.
 * @return e.g. "10-20 days", or "" when the business never stated one.
 */
export function deliveryWindowLabel(
    row: Record<string, unknown>,
): string {
  const label = String(row.deliveryEstimateLabel || "").trim();
  if (label) return label;
  const min = Number(row.deliveryEstimateMinDays);
  const max = Number(row.deliveryEstimateMaxDays);
  if (Number.isFinite(min) && min > 0 && Number.isFinite(max) && max >= min) {
    return `${min}-${max} days`;
  }
  if (Number.isFinite(min) && min > 0) return `${min}+ days`;
  return "";
}
