import { formatDayKey } from "./format.ts";
import { moneyText } from "./invoice-ledger.ts";
import type { ParkingBalance } from "./parking-balance.ts";
import { parseSignInHints, type GuestSignInHint } from "./phone-accounts.ts";

export type GuestTrackingService =
  | "barrel"
  | "freight"
  | "transport"
  | "parking"
  | "shared_barrel"
  | "freight_quote"
  // Goods a business loaded into its own container for a customer (CL- codes).
  | "container"
  // A customer's package request, listed in My packages only (never looked
  // up on the public page): docs/PHONE_ACCOUNTS.md §6.
  | "package_request";

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
  /**
   * Who may sign in from this page (docs/PHONE_ACCOUNTS.md §10): each valid
   * number's role and its LAST TWO digits - never more.
   */
  signIn?: GuestSignInHint[];
  /**
   * Container lines only, and only for a caller signed in as the line's
   * sender or receiver (docs/AIR_PACKAGES.md §4.12): the photos filed on
   * the package, as 30-day links. A guest gets no `photos` key.
   */
  photos?: GuestTrackingPhoto[];
  /**
   * Parked cars only (docs/PARKING_WHATSAPP.md §2): what the stay costs so
   * far, what was paid and the balance owed right now, worked out by the
   * server's `parkingBalanceNow`. Anyone with the code sees it, like the
   * payment on a container line.
   */
  parking?: GuestTrackingParking;
};

/** The parked car's money, exactly as `parkingBalanceNow` answers it. */
export type GuestTrackingParking = ParkingBalance;

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
  /** "air" for a flight (docs/AIR_PACKAGES.md §2); absent or "sea" for a container ship. */
  mode?: "air";
  shippingLine?: string;
  containerNumber?: string;
  bookingNumber?: string;
  airline?: string;
  airWaybill?: string;
};

/** The shipping details in the order the result card lists them (a sea container). */
export const GUEST_SHIPPING_FIELDS: ReadonlyArray<{
  key: "shippingLine" | "containerNumber" | "bookingNumber";
  label: string;
}> = [
  {key: "shippingLine", label: "Shipping line"},
  {key: "containerNumber", label: "Container number"},
  {key: "bookingNumber", label: "Booking number"},
];

/** The flight details in the order the result card lists them (an air shipment). */
export const GUEST_FLIGHT_FIELDS: ReadonlyArray<{
  key: "airline" | "airWaybill";
  label: string;
}> = [
  {key: "airline", label: "Airline"},
  {key: "airWaybill", label: "Air waybill"},
];

/** The shipping block's words for each mode (French in french-dom.ts). */
export const GUEST_SHIPPING_COPY = {
  sea: {
    title: "Shipping details",
    lede: "You can also follow it with these on the shipping line’s website.",
  },
  air: {
    title: "Flight",
    lede: "Your package travels by air. Here is the flight it is on.",
  },
} as const;

/** Which block the card shows for a record's shipping details. */
export function guestShippingMode(shipping: GuestContainerShipping | undefined): "sea" | "air" {
  return shipping?.mode === "air" ? "air" : "sea";
}

/** Where the result card's "Get the Laawol app" link goes. */
export const GET_APP_URL = "https://laawoldigital.com/get-app.html";

/**
 * The shipping details a container line's answer carries: for a sea
 * container the three known fields, for a flight (`mode: "air"`) the
 * airline and the air waybill - only non-empty short text, and nothing at
 * all for any other service or when none is known. An air answer with
 * neither detail still says it is a flight.
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
  const air = row.mode === "air";
  if (air) shipping.mode = "air";
  const fields: ReadonlyArray<{key: "shippingLine" | "containerNumber" | "bookingNumber" | "airline" | "airWaybill"}> =
    air ? GUEST_FLIGHT_FIELDS : GUEST_SHIPPING_FIELDS;
  for (const {key} of fields) {
    const text = typeof row[key] === "string" ? (row[key] as string).trim() : "";
    if (text) shipping[key] = text.slice(0, 60);
  }
  return Object.keys(shipping).length > 0 ? shipping : undefined;
}

// ---------------------------------------------------------------------------
// Photos on a package, for the signed-in sender or receiver (§4.12).
// ---------------------------------------------------------------------------

export type GuestPhotoKind = "dropoff" | "customer" | "delivered";

export type GuestTrackingPhoto = {
  /** A 30-day link served by the /d endpoint (view=photo); https only. */
  url: string;
  kind: GuestPhotoKind;
};

const PHOTO_KINDS = new Set<GuestPhotoKind>(["dropoff", "customer", "delivered"]);
const MAX_GUEST_PHOTOS = 20;

/** The label under each photo (French in french-dom.ts). */
export const GUEST_PHOTO_KIND_LABEL: Record<GuestPhotoKind, string> = {
  dropoff: "Drop-off",
  customer: "Sent by WhatsApp",
  delivered: "At delivery",
};

/**
 * The photos an answer carries, kept in order: a known kind and an https
 * link only, at most 20. Nothing (not an empty list) when the answer has
 * none - a guest who is not signed in never sees a Photos block.
 */
export function parseGuestPhotos(value: unknown): GuestTrackingPhoto[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: GuestTrackingPhoto[] = [];
  for (const item of value.slice(0, MAX_GUEST_PHOTOS)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const url = typeof row.url === "string" ? row.url.trim() : "";
    const kind = String(row.kind ?? "") as GuestPhotoKind;
    if (!/^https:\/\//i.test(url) || url.length > 2000 || !PHOTO_KINDS.has(kind)) continue;
    out.push({url, kind});
  }
  return out.length > 0 ? out : undefined;
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

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A parked car's money block as the page shows it. Every figure must be a
 * whole number of cents or days; a record that is missing the parked-since
 * day or any figure carries no block at all (an older server, or a car the
 * server could not price) rather than a half-true one. Nothing for any
 * other service.
 */
export function parseGuestParking(service: string, value: unknown): GuestTrackingParking | undefined {
  if (service !== "parking" || !value || typeof value !== "object") return undefined;
  const row = value as Record<string, unknown>;
  const whole = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 ? n : null;
  };
  const dailyRateCents = whole(row.dailyRateCents);
  const days = whole(row.days);
  const accruedCents = whole(row.accruedCents);
  const paidCents = whole(row.paidCents);
  const balanceCents = whole(row.balanceCents);
  const sinceDayKey = typeof row.sinceDayKey === "string" ? row.sinceDayKey.trim() : "";
  const leftRaw = typeof row.leftDayKey === "string" ? row.leftDayKey.trim() : "";
  if (
    dailyRateCents === null || days === null || accruedCents === null ||
    paidCents === null || balanceCents === null ||
    !DAY_KEY.test(sinceDayKey) || (leftRaw !== "" && !DAY_KEY.test(leftRaw))
  ) {
    return undefined;
  }
  return {
    dailyRateCents,
    sinceDayKey,
    leftDayKey: leftRaw,
    days,
    accruedCents,
    paidCents,
    balanceCents,
    paidInFull: typeof row.paidInFull === "boolean" ? row.paidInFull : balanceCents === 0 && accruedCents > 0,
    stillParked: typeof row.stillParked === "boolean" ? row.stillParked : leftRaw === "",
  };
}

/** The parking block's words (French in french-dom.ts). */
export const GUEST_PARKING_COPY = {
  title: "Parking balance",
  paidInFull: "Paid in full",
  balanceOwed: "Balance owed now",
  dailyRate: "Daily rate",
  parkedSince: "Parked since",
  leftOn: "Left on",
  daysSoFar: "Days so far",
  daysParked: "Days parked",
  amountSoFar: "Amount so far",
  amountTotal: "Total",
  paid: "Paid",
} as const;

export type GuestParkingRow = {
  key: "rate" | "since" | "left" | "days" | "amount" | "paid" | "balance";
  label: string;
  value: string;
  /** The line the eye should land on: the balance owed, or "Paid in full". */
  emphasis?: "owed" | "settled";
};

/**
 * The rows of the money block, in the order a customer reads them: daily
 * rate, parked since, days so far, amount so far, paid, then the balance
 * owed right now - or "Paid in full" when nothing is owed. A car that has
 * left says "Left on", "Days parked" and "Total" instead of "so far".
 * Values are text already in the page's language (dates month-first in
 * English, money as $12.00 / 12,00 $).
 */
export function guestParkingRows(parking: GuestTrackingParking, lang: "en" | "fr" = "en"): GuestParkingRow[] {
  const c = GUEST_PARKING_COPY;
  const rows: GuestParkingRow[] = [
    {key: "rate", label: c.dailyRate, value: moneyText(parking.dailyRateCents, lang)},
    {key: "since", label: c.parkedSince, value: formatDayKey(parking.sinceDayKey, lang)},
  ];
  if (!parking.stillParked && parking.leftDayKey) {
    rows.push({key: "left", label: c.leftOn, value: formatDayKey(parking.leftDayKey, lang)});
  }
  rows.push(
    {key: "days", label: parking.stillParked ? c.daysSoFar : c.daysParked, value: String(parking.days)},
    {key: "amount", label: parking.stillParked ? c.amountSoFar : c.amountTotal, value: moneyText(parking.accruedCents, lang)},
    {key: "paid", label: c.paid, value: moneyText(parking.paidCents, lang)},
  );
  if (parking.balanceCents === 0 && parking.paidInFull) {
    rows.push({key: "balance", label: c.balanceOwed, value: c.paidInFull, emphasis: "settled"});
  } else {
    rows.push({
      key: "balance",
      label: c.balanceOwed,
      value: moneyText(parking.balanceCents, lang),
      emphasis: parking.balanceCents > 0 ? "owed" : "settled",
    });
  }
  return rows;
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
  const signIn = parseSignInHints(row.signIn);
  const photos = service === "container" ? parseGuestPhotos(row.photos) : undefined;
  const parking = parseGuestParking(service, row.parking);
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
      ...(signIn.length ? {signIn} : {}),
      ...(photos ? {photos} : {}),
      ...(parking ? {parking} : {}),
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
  package_request: "Package request",
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

/** A package request not confirmed yet: the one stage only My packages shows. */
export const PACKAGE_REQUEST_REQUESTED_LABEL = "Requested";

/**
 * The stage words on a My packages card (docs/PHONE_ACCOUNTS.md §6): the
 * guest-tracking copy above, plus a package request's "requested". A stage
 * this build does not know reads as the server's default, "booked".
 */
export function shipmentStageLabel(service: string, stage: string): string {
  if (stage === "requested") return PACKAGE_REQUEST_REQUESTED_LABEL;
  const known = STAGES.has(stage as GuestTrackingStage) ? (stage as GuestTrackingStage) : "booked";
  return guestStageLabel(service, known);
}
