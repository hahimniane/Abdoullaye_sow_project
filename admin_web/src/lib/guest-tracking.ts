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
  /** Container lines only, once the box has sailed: what the shipping line
   * calls it, each field only when known. The box's details, never the
   * person's. */
  shipping?: GuestContainerShipping;
  /** Container lines only: the pieces this code covers. */
  pieceCount?: number;
  /**
   * Container lines only: every part of the package, in part order, when it
   * was split across containers (at least the line itself; the page lists
   * them only when there is more than one).
   */
  parts?: GuestTrackingPart[];
  /** Container lines only, once priced: the whole group's money (payments live on the root). */
  payment?: GuestTrackingPayment;
};

export type GuestTrackingPart = {
  trackingCode: string;
  stage: GuestTrackingStage;
  pieceCount: number;
  priceCents: number | null;
};

export type GuestTrackingPayment = {
  priceCents: number;
  /** A collected package's pickup fee, inside priceCents (present only when above zero). */
  pickupFeeCents?: number;
  paidCents: number;
  balanceCents: number;
};

export type GuestContainerShipping = {
  shippingLine?: string;
  containerNumber?: string;
  bookingNumber?: string;
};

/** The shipping details in the order the result card lists them. */
export const GUEST_SHIPPING_FIELDS: ReadonlyArray<{
  key: keyof GuestContainerShipping;
  label: string;
}> = [
  {key: "shippingLine", label: "Shipping line"},
  {key: "containerNumber", label: "Container number"},
  {key: "bookingNumber", label: "Booking number"},
];

/** Where the result card's "Get the Laawol app" link goes. */
export const GET_APP_URL = "https://laawoldigital.com/get-app.html";

/**
 * The shipping details a container line's answer carries: only the three
 * known fields, only non-empty short text, and nothing at all for any other
 * service or when none is known.
 */
export function parseGuestShipping(
  service: string,
  value: unknown,
): GuestContainerShipping | undefined {
  if (service !== "container" || !value || typeof value !== "object") {
    return undefined;
  }
  const row = value as Record<string, unknown>;
  const shipping: GuestContainerShipping = {};
  for (const {key} of GUEST_SHIPPING_FIELDS) {
    const text = typeof row[key] === "string" ? (row[key] as string).trim() : "";
    if (text) shipping[key] = text.slice(0, 60);
  }
  return Object.keys(shipping).length > 0 ? shipping : undefined;
}

const wholeCount = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
};
const centsOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
};

/**
 * A container line's group as the page shows it: its pieces, its parts and
 * its money. Each field is read on its own and dropped when malformed, so an
 * older server's answer (none of them) reads as before.
 */
export function parseGuestContainerGroup(
  service: string,
  row: Record<string, unknown>,
): Pick<GuestTrackingRecord, "pieceCount" | "parts" | "payment"> {
  if (service !== "container") return {};
  const out: Pick<GuestTrackingRecord, "pieceCount" | "parts" | "payment"> = {};
  const pieceCount = wholeCount(row.pieceCount);
  if (pieceCount > 0) out.pieceCount = pieceCount;
  if (Array.isArray(row.parts)) {
    const parts: GuestTrackingPart[] = [];
    for (const item of row.parts.slice(0, 100)) {
      if (!item || typeof item !== "object") continue;
      const part = item as Record<string, unknown>;
      const trackingCode = typeof part.trackingCode === "string" ? part.trackingCode.trim().slice(0, 60) : "";
      const stage = String(part.stage ?? "") as GuestTrackingStage;
      if (!trackingCode || !STAGES.has(stage)) continue;
      parts.push({trackingCode, stage, pieceCount: wholeCount(part.pieceCount), priceCents: centsOrNull(part.priceCents)});
    }
    if (parts.length > 0) out.parts = parts;
  }
  if (row.payment && typeof row.payment === "object") {
    const payment = row.payment as Record<string, unknown>;
    const priceCents = centsOrNull(payment.priceCents);
    if (priceCents !== null && priceCents > 0) {
      const paidCents = Math.min(centsOrNull(payment.paidCents) ?? 0, priceCents);
      const balance = centsOrNull(payment.balanceCents);
      const fee = Math.min(centsOrNull(payment.pickupFeeCents) ?? 0, priceCents);
      out.payment = {
        priceCents,
        ...(fee > 0 ? { pickupFeeCents: fee } : {}),
        paidCents,
        balanceCents: balance === null ? Math.max(0, priceCents - paidCents) : Math.min(balance, priceCents),
      };
    }
  }
  return out;
}

/** "3 pieces" / "3 colis" on the result card. */
export function guestPiecesText(count: number, lang: "en" | "fr" = "en"): string {
  if (lang === "fr") return `${count} colis`;
  return `${count} ${count === 1 ? "piece" : "pieces"}`;
}

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
  const shipping = parseGuestShipping(service, row.shipping);
  return {
    version: 1,
    found: true,
    record: {
      trackingCode,
      service,
      stage,
      updatedAtMs,
      ...(quoteCount !== undefined ? {quoteCount} : {}),
      ...(shipping ? {shipping} : {}),
      ...parseGuestContainerGroup(service, row),
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
  // Staff mark it when the goods can be collected; the carrier landing the
  // box at the port does not move a container here.
  {id: "arrived", label: "Ready for pickup", hint: "Ready to collect at the destination"},
];

export function guestJourneyStages(service: string): readonly GuestJourneyStage[] {
  return service === "container" ? GUEST_CONTAINER_STAGES : GUEST_JOURNEY_STAGES;
}

/** The status pill: the service's own word for the stage when it has one. */
export function guestStageLabel(service: string, stage: GuestTrackingStage): string {
  const own = guestJourneyStages(service).find((item) => item.id === stage);
  return own?.label ?? GUEST_STAGE_LABEL[stage] ?? stage;
}
