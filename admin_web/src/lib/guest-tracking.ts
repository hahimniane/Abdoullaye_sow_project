export type GuestTrackingService =
  | "barrel"
  | "freight"
  | "transport"
  | "parking"
  | "shared_barrel"
  | "freight_quote";

export type GuestTrackingStage =
  | "awaiting_payment"
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
]);
const STAGES = new Set<GuestTrackingStage>([
  "awaiting_payment",
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
    record: {trackingCode, service, stage, updatedAtMs},
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
};

export const GUEST_STAGE_LABEL: Record<GuestTrackingStage, string> = {
  awaiting_payment: "Waiting for payment",
  booked: "Booked",
  in_transit: "In progress",
  arrived: "Ready",
  delivered: "Complete",
  cancelled: "Cancelled",
};
