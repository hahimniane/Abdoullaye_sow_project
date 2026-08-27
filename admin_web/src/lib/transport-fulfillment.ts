/**
 * The car-transport fulfilment state machine, for the web console.
 *
 * A deliberate, literal port of `my_flutter_app/lib/services/
 * business_transport_jobs.dart`, which is itself a mirror of the server's own
 * table inside `updateTransportFulfillmentStatus`
 * (`my_flutter_app/functions/transport_fulfillment.js`). The callable is still
 * the authority; this exists so a carrier is refused before it costs a round
 * trip, and so all three clients enforce the same table.
 *
 * The console used to offer a flat list of every status and let the server
 * reject the illegal ones - and for legacy (non-marketplace) jobs it did not
 * even ask the server, it wrote Firestore directly and skipped the table
 * entirely. Both of those are gone; this module is what the console now decides
 * with.
 *
 * Pure by design: no Firestore, no callables, no React. The component holds
 * those.
 */

/** Every status the transport state machine produces. */
export const TRANSPORT_FULFILLMENT_STATUSES = [
  "pending",
  "scheduled",
  "in_transit",
  "delivered",
  "cancelled",
] as const;

/**
 * Where a job may go from where it is.
 *
 * `delivered` and `cancelled` are terminal and map to an empty list rather than
 * being absent, so "this status is known but finished" and "this status is not
 * ours" stay different answers - the first is a delivered job, the second is
 * something an admin path wrote and the state machine cannot reason about.
 */
export const TRANSPORT_FULFILLMENT_TRANSITIONS: Readonly<
  Record<string, readonly string[]>
> = Object.freeze({
  pending: Object.freeze(["scheduled", "in_transit", "cancelled"]),
  scheduled: Object.freeze(["in_transit", "cancelled"]),
  in_transit: Object.freeze(["delivered"]),
  delivered: Object.freeze([]),
  cancelled: Object.freeze([]),
});

/**
 * The statuses the server will accept as a destination.
 *
 * `pending` is a legal place to BE and never a legal destination: the server's
 * own allowed set is scheduled/in_transit/delivered/cancelled.
 */
export const TRANSPORT_FULFILLMENT_DESTINATIONS = [
  "scheduled",
  "in_transit",
  "delivered",
  "cancelled",
] as const;

const NO_STATUSES: readonly string[] = Object.freeze([]);

/**
 * The status the server will compare against its own table.
 *
 * The server reads `String(fulfillmentStatus || status || "")` - JS
 * truthiness, so an EMPTY `fulfillmentStatus` falls through to `status`.
 * Reading only `status`, which the console used to do, shows a stale value on
 * every job the callable has already moved.
 */
export function transportJobCurrentStatus(
  row: Readonly<Record<string, unknown>> | null | undefined,
): string {
  const fulfillment = String(row?.fulfillmentStatus ?? "");
  if (fulfillment) return fulfillment;
  return String(row?.status ?? "");
}

/**
 * Whether the state machine recognises this status.
 *
 * Compared literally, with no trimming or case folding, because the server
 * compares it literally too: a stored `"Pending"` is not `pending` to the
 * callable and would be refused. Being more generous here than the server is
 * only a way to offer a button that cannot work.
 */
export function transportFulfillmentStatusIsKnown(status: string): boolean {
  return Object.prototype.hasOwnProperty.call(
    TRANSPORT_FULFILLMENT_TRANSITIONS,
    status,
  );
}

/**
 * The legal next statuses, in the table's own order.
 *
 * An unrecognised status - `active`, `in_progress`, `completed`, `sold`,
 * `reserved`, `inactive`, anything else the admin record path can write onto a
 * transportRequests document - yields an empty list. The console shows the
 * value and offers nothing, which is the honest answer: the state machine has
 * no opinion about where a job goes from a status it never produced.
 */
export function transportFulfillmentNextStatuses(
  currentStatus: string,
): readonly string[] {
  if (!transportFulfillmentStatusIsKnown(currentStatus)) return NO_STATUSES;
  return TRANSPORT_FULFILLMENT_TRANSITIONS[currentStatus] ?? NO_STATUSES;
}

/**
 * Whether moving to `nextStatus` needs a container number.
 *
 * A car in transit is in a container, and the customer's next question is
 * always "where is it". The server refuses `in_transit` without one; the
 * console asks for it rather than letting that refusal be the way an operator
 * finds out.
 */
export function transportFulfillmentRequiresContainer(
  nextStatus: string,
): boolean {
  return nextStatus === "in_transit";
}

/**
 * A container number as the server would store it, or "" when it is not one.
 *
 * A deliberate mirror of `validateContainerNumber` in
 * `functions/shipment_tracking.js`: trimmed, capped at 40 characters,
 * upper-cased, and anything shorter than four characters is not a number at
 * all. Mirroring the length rule matters - an operator who types `AB` must be
 * told here, not by a `failed-precondition` after the click.
 */
export function normalizeTransportContainerNumber(value: unknown): string {
  const cleaned = String(value ?? "")
    .trim()
    .slice(0, 40)
    .toUpperCase();
  return cleaned.length >= 4 ? cleaned : "";
}

/** Why a status change cannot be made. */
export type TransportFulfillmentError =
  /** The job sits on a status the machine never produced: no row to move. */
  | "currentStatusUnknown"
  /** A status the server would not accept as a destination at all. */
  | "nextStatusUnknown"
  /** Known statuses, but not an edge in the table. */
  | "transitionNotAllowed"
  /** `in_transit` with nothing to track the car by. */
  | "containerNumberRequired";

export type TransportFulfillmentChange = {
  currentStatus: string;
  nextStatus: string;
  existingContainerNumber?: unknown;
  submittedContainerNumber?: unknown;
};

/**
 * Whether this job may move to this status, and why not.
 *
 * Every refusal the server can give for a transition, given in front of the
 * operator instead. `existingContainerNumber` is what the request already holds
 * and `submittedContainerNumber` is what was just typed; the server accepts
 * either, taking the submitted one first, so a job that already carries a
 * container number does not have to be given it again.
 */
export function validateTransportFulfillmentChange({
  currentStatus,
  nextStatus,
  existingContainerNumber = "",
  submittedContainerNumber = "",
}: TransportFulfillmentChange): TransportFulfillmentError[] {
  const errors: TransportFulfillmentError[] = [];
  if (!transportFulfillmentStatusIsKnown(currentStatus)) {
    errors.push("currentStatusUnknown");
  }
  if (
    !TRANSPORT_FULFILLMENT_STATUSES.includes(
      nextStatus as (typeof TRANSPORT_FULFILLMENT_STATUSES)[number],
    ) ||
    nextStatus === "pending"
  ) {
    errors.push("nextStatusUnknown");
  } else if (!transportFulfillmentNextStatuses(currentStatus).includes(nextStatus)) {
    errors.push("transitionNotAllowed");
  }
  if (
    transportFulfillmentRequiresContainer(nextStatus) &&
    !normalizeTransportContainerNumber(submittedContainerNumber) &&
    !normalizeTransportContainerNumber(existingContainerNumber)
  ) {
    errors.push("containerNumberRequired");
  }
  return errors;
}

export type TransportFulfillmentPayload = {
  requestId: string;
  status: string;
  businessId?: string;
  containerNumber?: string;
};

/**
 * The exact payload `updateTransportFulfillmentStatus` expects.
 *
 * The container number is sent only when one was typed: the server keeps
 * whatever the request already holds, and sending an empty string would be
 * indistinguishable from not sending it - except that it reads, at a glance,
 * like an attempt to clear it.
 */
export function transportFulfillmentPayload({
  requestId,
  status,
  containerNumber = "",
  businessId = "",
}: {
  requestId: string;
  status: string;
  containerNumber?: unknown;
  businessId?: string;
}): TransportFulfillmentPayload {
  const container = normalizeTransportContainerNumber(containerNumber);
  return {
    requestId,
    status,
    ...(businessId.trim() ? { businessId: businessId.trim() } : {}),
    ...(container ? { containerNumber: container } : {}),
  };
}

/**
 * The English sentence for one refused status change.
 *
 * Deliberately fixed sentences with nothing interpolated: the console is
 * translated by substring replacement over the rendered DOM
 * (`lib/french-dom.ts`), and a sentence built around a status label would only
 * ever be half-translated. The status itself is on the badge beside the
 * message.
 */
export const TRANSPORT_FULFILLMENT_ERROR_MESSAGES: Readonly<
  Record<TransportFulfillmentError, string>
> = Object.freeze({
  currentStatusUnknown:
    "This job is on a status the transport workflow did not set, so no transport action applies here.",
  nextStatusUnknown: "That is not a status a transport job can be moved to.",
  transitionNotAllowed: "A transport job cannot move between those two statuses.",
  containerNumberRequired:
    "Add the container number before marking this transport in transit.",
});

/** The sentence for the first refusal, or "" when there is none. */
export function transportFulfillmentErrorMessage(
  errors: readonly TransportFulfillmentError[],
): string {
  const first = errors[0];
  return first ? TRANSPORT_FULFILLMENT_ERROR_MESSAGES[first] : "";
}
