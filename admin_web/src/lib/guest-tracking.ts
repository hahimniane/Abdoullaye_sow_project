export type GuestTrackingService =
  | "barrel"
  | "freight"
  | "transport"
  | "parking"
  | "shared_barrel"
  | "freight_quote"
  // Goods a business loaded into its own container for a customer (CL- codes).
  | "container";

export type GuestTrackingStage =
  | "awaiting_payment"
  // A container line dropped off and not on a container yet (CL- codes only).
  | "waiting_container"
  | "booked"
  | "in_transit"
  | "arrived"
  | "delivered"
  | "cancelled";

export type GuestTrackingRecord = {
  trackingCode: string;
  service: GuestTrackingService;
  stage: GuestTrackingStage;
  updatedAtMs: number;
  /** Price requests only: how many businesses have answered. A count is
   * public; a price never is - seeing prices takes the claim step. */
  quoteCount?: number;
};

export type GuestTrackingResponse =
  | {version: 1; found: false}
  | {version: 1; found: true; record: GuestTrackingRecord};

const SERVICES = new Set<GuestTrackingService>([
  "barrel",
  "freight",
  "transport",
  "parking",
  "shared_barrel",
  "freight_quote",
  "container",
]);
const STAGES = new Set<GuestTrackingStage>([
  "awaiting_payment",
  "waiting_container",
  "booked",
  "in_transit",
  "arrived",
  "delivered",
  "cancelled",
]);

export function validGuestTrackingIdentifier(value: string) {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return compact.length >= 6 && compact.length <= 40;
}

export function parseGuestTrackingResponse(value: unknown): GuestTrackingResponse {
  if (!value || typeof value !== "object") {
    throw new Error("guest-tracking-response-invalid");
  }
  const payload = value as Record<string, unknown>;
  if (payload.version !== 1 || typeof payload.found !== "boolean") {
    throw new Error("guest-tracking-response-invalid");
  }
  if (!payload.found) return {version: 1, found: false};
  if (!payload.record || typeof payload.record !== "object") {
    throw new Error("guest-tracking-response-invalid");
  }
  const row = payload.record as Record<string, unknown>;
  const trackingCode = String(row.trackingCode ?? "").trim();
  const service = String(row.service ?? "") as GuestTrackingService;
  const stage = String(row.stage ?? "") as GuestTrackingStage;
  const updatedAtMs = Number(row.updatedAtMs ?? 0);
  const quoteCountRaw = Number(row.quoteCount);
  const quoteCount =
    service === "freight_quote" && Number.isFinite(quoteCountRaw)
      ? Math.max(0, Math.trunc(quoteCountRaw))
      : undefined;
  if (
    !trackingCode ||
    !SERVICES.has(service) ||
    !STAGES.has(stage) ||
    !Number.isFinite(updatedAtMs) ||
    updatedAtMs < 0
  ) {
    throw new Error("guest-tracking-response-invalid");
  }
  return {
    version: 1,
    found: true,
    record: {
      trackingCode,
      service,
      stage,
      updatedAtMs,
      ...(quoteCount !== undefined ? {quoteCount} : {}),
    },
  };
}

export type GuestTrackingErrorKind = "rate_limited" | "unavailable";

export function guestTrackingErrorKind(error: unknown): GuestTrackingErrorKind {
  const code = String(
    error && typeof error === "object" && "code" in error
      ? (error as {code?: unknown}).code
      : "",
  );
  return code.includes("resource-exhausted")
    ? "rate_limited"
    : "unavailable";
}

export const GUEST_SERVICE_LABEL: Record<GuestTrackingService, string> = {
  barrel: "Barrel shipment",
  freight: "Freight shipment",
  transport: "Car transport",
  parking: "Car parking",
  shared_barrel: "Shared barrel",
  freight_quote: "Freight quote request",
  container: "Container shipment",
};

/**
 * The service line on the result card. Total over any string, so a record
 * whose service this build does not know yet reads as a plain shipment
 * instead of rendering nothing.
 */
export function guestServiceLabel(service: string): string {
  return GUEST_SERVICE_LABEL[service as GuestTrackingService] ?? "Tracked shipment";
}

export const GUEST_STAGE_LABEL: Record<GuestTrackingStage, string> = {
  awaiting_payment: "Waiting for payment",
  waiting_container: "Waiting for a container",
  booked: "Booked",
  in_transit: "In progress",
  arrived: "Ready",
  delivered: "Complete",
  cancelled: "Cancelled",
};

export type GuestJourneyStage = {
  id: "waiting_container" | "booked" | "in_transit" | "arrived" | "delivered";
  label: string;
  hint: string;
};

/** The generic four-step journey every booking-based service follows. */
export const GUEST_JOURNEY_STAGES: readonly GuestJourneyStage[] = [
  {id: "booked", label: "Booked", hint: "Your booking is confirmed"},
  {id: "in_transit", label: "In progress", hint: "The service is underway"},
  {id: "arrived", label: "Ready", hint: "The service is ready for its final step"},
  {id: "delivered", label: "Complete", hint: "The service is complete"},
];

/**
 * A container line follows its box: waiting for one, loaded, at sea, landed.
 * The server maps a waiting package to waiting_container and the container's
 * state onto booked / in_transit / arrived, so the journey has four steps and
 * its own words.
 */
export const GUEST_CONTAINER_STAGES: readonly GuestJourneyStage[] = [
  {id: "waiting_container", label: "Waiting for a container", hint: "Received, waiting for a container"},
  {id: "booked", label: "In the container", hint: "Received and loaded into the container"},
  {id: "in_transit", label: "At sea", hint: "The container has sailed"},
  {id: "arrived", label: "Arrived", hint: "The container has reached its destination"},
];

export function guestJourneyStages(service: string): readonly GuestJourneyStage[] {
  return service === "container" ? GUEST_CONTAINER_STAGES : GUEST_JOURNEY_STAGES;
}

/** The status pill: the service's own word for the stage when it has one. */
export function guestStageLabel(service: string, stage: GuestTrackingStage): string {
  const own = guestJourneyStages(service).find((item) => item.id === stage);
  return own?.label ?? GUEST_STAGE_LABEL[stage] ?? stage;
}
