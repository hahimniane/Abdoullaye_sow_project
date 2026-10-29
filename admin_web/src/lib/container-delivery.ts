/**
 * A package (one container line, all of its pieces) handed over at the
 * destination and marked DELIVERED - the console's half of
 * my_flutter_app/functions/container_delivery.js (docs/WAITING_PACKAGES.md
 * "Delivered at destination").
 *
 * The server is the authority: it refuses a package whose container is not
 * ready for pickup, asks for a second confirmation when the package still
 * owes money, and decides who may undo. This module only mirrors what the
 * screens need to offer the right buttons and say the right thing:
 *
 *   - who may mark delivered (owners, admins, `containers` or `deliveries`),
 *     undo (owners, admins, `containers`) and see money (owners, admins,
 *     `containers` or `ledger`);
 *   - the request bodies for the `updateContainerLine` actions;
 *   - every refusal reason as a sentence (from `details.reason`, never the
 *     server's message);
 *   - the delivered state of a line and "X of Y delivered" on a container.
 *
 * Nothing here imports Firebase or React: `container-delivery.test.ts` runs
 * it without a browser.
 */

import { containerRowCounts, containerStatus, containerTitle, lineCustomerName } from "./container-manifest.ts";
import { moneyText } from "./invoice-ledger.ts";
import { packageCodeFrom } from "./package-staff.ts";
import type { LineGroupSummary } from "./line-pieces.ts";
import { groupPayment } from "./waiting-packages.ts";

type Row = Record<string, unknown>;
type Lang = "en" | "fr";

function asRow(value: unknown): Row {
  return value && typeof value === "object" ? (value as Row) : {};
}

function text(value: unknown, max = 200): string {
  return String(value ?? "").trim().slice(0, max);
}

/** One line of text: a name is never several lines (the server's `oneLine`). */
function oneLine(value: unknown): string {
  return String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

function dateOf(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const v = value as { toDate?: () => Date; seconds?: number };
  if (typeof v.toDate === "function") return v.toDate();
  if (typeof v.seconds === "number") return new Date(v.seconds * 1000);
  if (typeof value === "number" && value > 0) return new Date(value);
  return null;
}

// ---------------------------------------------------------------------------
// Who may do what (container_delivery.js DELIVERY_SECTIONS and friends).
// ---------------------------------------------------------------------------

/** The staff permission that opens Deliveries and nothing else. */
export const DELIVERIES_PERMISSION = "deliveries";

export type DeliveryAccess = {
  /** Mark a package delivered: owners, admins, `containers` or `deliveries`. */
  canDeliver: boolean;
  /** Undo a delivery: owners, admins and `containers` (a manager). */
  canUndo: boolean;
  /** See prices, payments and what is owed: owners, admins, `containers` or `ledger`. */
  canSeeMoney: boolean;
};

export const NO_DELIVERY_ACCESS: DeliveryAccess = { canDeliver: false, canUndo: false, canSeeMoney: false };

/**
 * The server's `hasBusinessPermission` for each delivery rule: owners and
 * admins hold every section; staff hold the ones listed on their profile
 * (exactly - no implied permissions, as on the server).
 */
export function deliveryAccess(profile: { role?: unknown; businessPermissions?: unknown } | null | undefined): DeliveryAccess {
  const row = asRow(profile);
  const role = text(row.role, 40);
  if (role === "businessOwner" || role === "admin") {
    return { canDeliver: true, canUndo: true, canSeeMoney: true };
  }
  if (role !== "staff") return NO_DELIVERY_ACCESS;
  const held = new Set(
    (Array.isArray(row.businessPermissions) ? row.businessPermissions : []).map((item) => text(item, 40)),
  );
  return {
    canDeliver: held.has("containers") || held.has(DELIVERIES_PERMISSION),
    canUndo: held.has("containers"),
    canSeeMoney: held.has("containers") || held.has("ledger"),
  };
}

// ---------------------------------------------------------------------------
// The requests (`updateContainerLine` with an `action`).
// ---------------------------------------------------------------------------

export const DELIVERY_ACTION = Object.freeze({ DELIVER: "deliver", UNDO: "undo_delivery" } as const);

/** The longest "collected by" the server takes (MAX_COLLECTED_BY). */
export const MAX_COLLECTED_BY = 120;

export type DeliverRequest = {
  businessId: string;
  lineId: string;
  action: "deliver";
  collectedBy: string;
  acknowledgeBalance?: true;
  /** The 4-digit pickup code the receiver read out (docs/AIR_PACKAGES.md §4.7). */
  pickupCode?: string;
  /** Delivering without the code: who collected and the agent's photo of them. */
  override?: { collectedBy: string; photoPath: string };
  /** USD collected at handover, in cents; absent when nothing was. */
  collectedCents?: number;
};

/**
 * Mark delivered. `collectedBy` is sent as typed on one line; blank lets the
 * server name the receiver. `acknowledgeBalance` only once the person has
 * seen the unpaid-balance warning and confirmed. `pickupCode` when the
 * agent typed one; `override` instead when the receiver has no code (the
 * server then records "delivered without code"); `collectedCents` for the
 * money collected now (the one money action the deliveries permission has).
 */
export function deliverRequest(input: {
  businessId: string;
  lineId: string;
  collectedBy?: unknown;
  acknowledgeBalance?: boolean;
  pickupCode?: unknown;
  override?: { collectedBy?: unknown; photoPath?: unknown } | null;
  collectedCents?: number | null;
}): DeliverRequest {
  const request: DeliverRequest = {
    businessId: text(input.businessId),
    lineId: text(input.lineId),
    action: DELIVERY_ACTION.DELIVER,
    collectedBy: oneLine(input.collectedBy),
  };
  if (input.acknowledgeBalance === true) request.acknowledgeBalance = true;
  const code = pickupCodeDigits(input.pickupCode);
  if (code) request.pickupCode = code;
  if (input.override) {
    request.override = {
      collectedBy: oneLine(input.override.collectedBy).slice(0, MAX_COLLECTED_BY),
      photoPath: text(input.override.photoPath, 300),
    };
  }
  const cents = Math.round(Number(input.collectedCents));
  if (Number.isFinite(cents) && cents > 0) request.collectedCents = cents;
  return request;
}

/** The digits of a typed pickup code (spaces and dashes dropped), at most four. */
export function pickupCodeDigits(raw: unknown): string {
  return String(raw ?? "").replace(/\D/g, "").slice(0, 4);
}

/** A code the server could match: exactly four digits (package_proof.pickupCodeMatches). */
export function pickupCodeComplete(raw: unknown): boolean {
  return pickupCodeDigits(raw).length === 4;
}

/**
 * Whether the Mark delivered dialog asks for a pickup code: the business
 * switch is on and this line was minted one (the server's `handoverCheck`
 * delivers normally otherwise). The code itself is never shown.
 */
export function pickupCodeAsked(proofSettings: { pickupCode?: unknown } | null | undefined, line: unknown): boolean {
  return asRow(proofSettings).pickupCode === true && pickupCodeDigits(asRow(line).pickupCode).length === 4;
}

/** The business's switch, read from its document (`packageProofSettings.pickupCode`). */
export function proofPickupCodeOn(business: unknown): boolean {
  return asRow(asRow(business).packageProofSettings).pickupCode === true;
}

/**
 * "Collected now" typed in whole dollars → cents, or null for blank, or NaN
 * for anything that is not a whole amount of zero or more.
 */
export function collectedDollarsToCents(typed: unknown): number | null {
  const raw = String(typed ?? "").trim().replace(/^\$/, "").replace(/,/g, "");
  if (!raw) return null;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(raw)) return NaN;
  return Math.round(Number(raw) * 100);
}

/** What the override needs before asking the server (package_proof.handoverCheck). */
export function overrideError(override: { collectedBy: unknown; photoPath: unknown }): "override_incomplete" | null {
  const name = oneLine(override.collectedBy);
  const photo = text(override.photoPath, 300);
  return name.length >= 2 && photo ? null : "override_incomplete";
}

export function undoDeliveryRequest(businessId: string, lineId: string) {
  return { businessId: text(businessId), lineId: text(lineId), action: DELIVERY_ACTION.UNDO } as const;
}

/** Too long for the server, before asking it (`collectedByErrors`). */
export function collectedByError(input: unknown): "collected_by_too_long" | null {
  return oneLine(input).length > MAX_COLLECTED_BY ? "collected_by_too_long" : null;
}

/**
 * What the "collected by" field opens with: the receiver's name, else the
 * line's customer (a line from before receivers were required). Staff change
 * it when someone collects for the receiver.
 */
export function defaultCollectedBy(line: unknown): string {
  const row = asRow(line);
  return (oneLine(row.receiverName) || oneLine(lineCustomerName(row))).slice(0, MAX_COLLECTED_BY);
}

/**
 * The package code in what was typed: the code itself in any spacing or
 * case (`packageCodeFrom`), or the code inside the label's link - a barcode
 * scanner types the whole QR, https://customer.laawoldigital.com/t/CL-K7M4P2
 * (or `?code=CL-K7M4P2`). "" when there is none.
 */
export function deliveryCodeFrom(raw: unknown): string {
  const direct = packageCodeFrom(raw);
  if (direct) return direct;
  const value = String(raw ?? "").trim().slice(0, 300);
  const match = /(?:^|[/=\s])(CL-?[A-Za-z0-9]{6}(?:-?[1-9]\d?)?)(?:$|[/?#&\s])/i.exec(value);
  return match ? packageCodeFrom(match[1]) : "";
}

// ---------------------------------------------------------------------------
// What the server answered.
// ---------------------------------------------------------------------------

/**
 * The proof refusals (the server's package_proof.REFUSAL), spread into
 * DELIVERY_MESSAGES on the server and raised by the deliver action and the
 * line forms alike (docs/AIR_PACKAGES.md §4).
 */
export const PROOF_REFUSAL_COPY = {
  photo_invalid: "One of the photos could not be used. Add it again.",
  photo_required: "Add at least one photo of the package.",
  contents_invalid: "Check the item list: a name up to 60 characters, a quantity from 1 to 99, and an optional serial number.",
  weight_invalid: "Enter a weight between 0.1 and 2000 lb.",
  declared_value_invalid: "Enter a declared value of $0 or more.",
  pickup_code_invalid: "The pickup code does not match. Ask the receiver for the code in their message, or deliver without a code.",
  override_incomplete: "Delivering without a code needs the name of the person collecting and a photo.",
} as const;

/** Every `details.reason` the delivery action raises (container_delivery.js DELIVERY_MESSAGES). */
export const DELIVERY_SERVER_REASONS = [
  "delivery_action_invalid",
  "collected_cents_invalid",
  ...(Object.keys(PROOF_REFUSAL_COPY) as (keyof typeof PROOF_REFUSAL_COPY)[]),
  "delivery_not_arrived",
  "delivery_balance_due",
  "collected_by_too_long",
  "line_not_found",
  // The money collected now is judged as a payment (container_payments.js).
  "payment_exceeds_balance",
  "price_required",
] as const;

export type DeliveryRefusalReason =
  | (typeof DELIVERY_SERVER_REASONS)[number]
  | "permission_denied"
  | "unknown";

/** The sentence for each refusal, as the console shows it (French in french-dom.ts). */
export const DELIVERY_REFUSAL_COPY: Record<DeliveryRefusalReason, string> = {
  delivery_action_invalid: "That is not something a package delivery can do.",
  collected_cents_invalid: "Enter the amount collected in dollars, zero or more.",
  ...PROOF_REFUSAL_COPY,
  delivery_not_arrived: "A package can be marked delivered once its container is ready for pickup.",
  delivery_balance_due: "This package still has an unpaid balance. Confirm to mark it delivered anyway.",
  collected_by_too_long: "Keep the name of who collected it to 120 characters.",
  line_not_found: "That package no longer exists.",
  payment_exceeds_balance: "That is more than what is still owed.",
  price_required: "Set a price before recording a payment.",
  permission_denied: "Your account is not allowed to do this. Ask the business owner.",
  unknown: "The delivery did not save. Check your connection and try again.",
};

export type DeliveryRefusal = {
  reason: DeliveryRefusalReason;
  /** `delivery_balance_due`: the package still owes money. */
  hasBalance: boolean;
  /** `delivery_balance_due`: the amount, only for people who may see money (else null). */
  balanceCents: number | null;
};

/**
 * A callable's rejection read for its `details.reason` (and the balance a
 * `delivery_balance_due` carries). A permission refusal has no reason of its
 * own, only the code; anything else is "unknown", never the raw message.
 */
export function deliveryRefusalFrom(error: unknown): DeliveryRefusal {
  const e = asRow(error);
  const details = asRow(e.details);
  const raw = text(details.reason, 60);
  const code = text(e.code, 80);
  const reason: DeliveryRefusalReason = (DELIVERY_SERVER_REASONS as readonly string[]).includes(raw)
    ? (raw as DeliveryRefusalReason)
    : /permission-denied$/.test(code)
      ? "permission_denied"
      : "unknown";
  const cents = Number(details.balanceCents);
  return {
    reason,
    hasBalance: reason === "delivery_balance_due" || details.hasBalance === true,
    balanceCents:
      details.balanceCents !== null && details.balanceCents !== undefined && Number.isFinite(cents) && cents > 0
        ? Math.round(cents)
        : null,
  };
}

export function deliveryRefusalText(refusal: Pick<DeliveryRefusal, "reason">): string {
  return DELIVERY_REFUSAL_COPY[refusal.reason] ?? DELIVERY_REFUSAL_COPY.unknown;
}

export type DeliverAnswer = {
  alreadyDelivered: boolean;
  collectedBy: string;
  hasBalance: boolean;
  balanceCents: number | null;
  /** The override was used: no pickup code, a name and a photo instead. */
  deliveredWithoutCode: boolean;
  /** USD collected at handover, in cents (0 for none). */
  collectedCents: number;
  /** The payment row the collected money wrote, or "". */
  paymentId: string;
};

export function deliverAnswerFrom(data: unknown): DeliverAnswer {
  const row = asRow(data);
  const cents = Number(row.balanceCents);
  const collected = Math.round(Number(row.collectedCents));
  return {
    alreadyDelivered: row.alreadyDelivered === true,
    collectedBy: oneLine(row.collectedBy),
    hasBalance: row.hasBalance === true,
    balanceCents: row.balanceCents !== null && row.balanceCents !== undefined && Number.isFinite(cents) ? Math.round(cents) : null,
    deliveredWithoutCode: row.deliveredWithoutCode === true,
    collectedCents: Number.isFinite(collected) && collected > 0 ? collected : 0,
    paymentId: text(row.paymentId, 128),
  };
}

/** What a finished action says (French in french-dom.ts). */
export const DELIVERY_RESULT_COPY = {
  delivered: "Marked delivered.",
  alreadyDelivered: "This package was already marked delivered.",
  undone: "Delivery undone.",
  notDelivered: "This package was not marked delivered.",
} as const;

/** What a button says while its action runs. */
export const DELIVERY_PROGRESS_COPY = {
  deliver: "Marking delivered…",
  undo: "Undoing…",
} as const;

/**
 * "Marked delivered." or, when money was collected at handover,
 * "Delivered · $40 collected" (built in the reader's language, rendered
 * `data-no-translate` by the caller when it carries an amount).
 */
export function deliverResultText(answer: Pick<DeliverAnswer, "alreadyDelivered"> & Partial<Pick<DeliverAnswer, "collectedCents">>, lang: Lang = "en"): string {
  if (answer.alreadyDelivered) return DELIVERY_RESULT_COPY.alreadyDelivered;
  const collected = Math.round(Number(answer.collectedCents));
  if (Number.isFinite(collected) && collected > 0) {
    return lang === "fr" ? `Livré · ${moneyText(collected, "fr")} encaissés` : `Delivered · ${moneyText(collected, "en")} collected`;
  }
  return DELIVERY_RESULT_COPY.delivered;
}

export function undoResultText(data: unknown): string {
  return asRow(data).undone === true ? DELIVERY_RESULT_COPY.undone : DELIVERY_RESULT_COPY.notDelivered;
}

// ---------------------------------------------------------------------------
// Money: a warning, never a block.
// ---------------------------------------------------------------------------

/**
 * What the package still owes, in cents: its whole group's balance (a part of
 * a split package owes what the group owes - payments live on the root), or
 * 0 when there is no price or nothing left.
 */
export function deliveryBalanceCents(group: LineGroupSummary): number {
  const balance = groupPayment(group).balanceCents;
  return balance !== null && balance > 0 ? balance : 0;
}

/**
 * The unpaid-balance warning. The amount only for people who may see money;
 * a deliveries-only person is told there is a balance and who to ask, never
 * how much. Built in the reader's language (rendered `data-no-translate`).
 */
export function deliveryBalanceWarning(balanceCents: number | null, canSeeMoney: boolean, lang: Lang = "en"): string {
  const cents = Math.round(Number(balanceCents));
  if (canSeeMoney && Number.isFinite(cents) && cents > 0) {
    return lang === "fr"
      ? `Ce colis doit encore ${moneyText(cents, "fr")}.`
      : `This package still owes ${moneyText(cents, "en")}.`;
  }
  return lang === "fr"
    ? "Ce colis a encore un solde impayé : vérifiez auprès du bureau."
    : "This package still has an unpaid balance — check with the office.";
}

// ---------------------------------------------------------------------------
// The delivered state of a line.
// ---------------------------------------------------------------------------

export type LineDelivery = {
  delivered: boolean;
  deliveredAt: Date | null;
  /** Who handed it over (the server records the staff member's name). */
  deliveredByName: string;
  deliveredByStaffId: string;
  /** Who collected it: the receiver unless someone collected for them. */
  collectedBy: string;
  /** Handed over without the pickup code (docs/AIR_PACKAGES.md §4.7). */
  withoutCode: boolean;
  /** The override photo's Storage path, or "" (the file is deleted a year after delivery). */
  photoPath: string;
  /** USD collected at handover, in cents (0 for none). */
  collectedCents: number;
};

export function lineDelivery(line: unknown): LineDelivery {
  const row = asRow(line);
  const delivered = Boolean(row.deliveredAt);
  const collected = Math.round(Number(row.collectedAtDeliveryCents));
  return {
    delivered,
    deliveredAt: delivered ? dateOf(row.deliveredAt) : null,
    deliveredByName: delivered ? oneLine(row.deliveredByName).slice(0, 120) : "",
    deliveredByStaffId: delivered ? text(row.deliveredByStaffId, 128) : "",
    collectedBy: delivered ? oneLine(row.collectedBy).slice(0, MAX_COLLECTED_BY) : "",
    withoutCode: delivered && row.deliveredWithoutCode === true,
    photoPath: delivered ? text(row.deliveredPhotoPath, 300) : "",
    collectedCents: delivered && Number.isFinite(collected) && collected > 0 ? collected : 0,
  };
}

/** "Delivered without code" beside the chip (French in french-dom.ts). */
export const DELIVERED_WITHOUT_CODE_LABEL = "Delivered without code";

// ---------------------------------------------------------------------------
// The Deliveries page: what arrived and is still to hand over.
// ---------------------------------------------------------------------------

export type ArrivedContainerRow = {
  id: string;
  /** "Shipment" for a flight, else the container's title (number or working name). */
  title: string;
  air: boolean;
  lines: ArrivedLineRow[];
};

export type ArrivedLineRow = {
  id: string;
  trackingCode: string;
  receiverName: string;
  receiverPhone: string;
  pieceCount: number;
  line: Row;
};

/**
 * The arrived containers (air and sea) with their undelivered lines, for
 * the Deliveries page's "Arrived · to hand over" list. Precomputed once
 * from two business-scoped queries (`containers` and `containerLines` where
 * `containerStatus == "arrived"`): a container with nothing left to hand
 * over is left out; containers come newest arrival first, lines by code.
 */
export function arrivedContainerRows(containers: readonly unknown[], lines: readonly unknown[]): ArrivedContainerRow[] {
  const byContainer = new Map<string, ArrivedLineRow[]>();
  for (const raw of lines) {
    const line = asRow(raw);
    if (line.deliveredAt) continue;
    const containerId = text(line.containerId, 128);
    if (!containerId) continue;
    const pieces = Array.isArray(line.pieces) ? line.pieces.length : 0;
    const row: ArrivedLineRow = {
      id: text(line.id, 128),
      trackingCode: text(line.trackingCode, 40),
      receiverName: oneLine(line.receiverName).slice(0, 120) || oneLine(lineCustomerName(line)).slice(0, 120),
      receiverPhone: text(line.receiverPhone || line.customerPhone, 40),
      pieceCount: pieces > 0 ? pieces : Math.max(1, Math.round(Number(line.quantity)) || 1),
      line,
    };
    const list = byContainer.get(containerId);
    if (list) list.push(row);
    else byContainer.set(containerId, [row]);
  }
  const out: ArrivedContainerRow[] = [];
  for (const raw of containers) {
    const box = asRow(raw);
    if (containerStatus(box) !== "arrived") continue;
    const list = byContainer.get(text(box.id, 128));
    if (!list || list.length === 0) continue;
    list.sort((a, b) => a.trackingCode.localeCompare(b.trackingCode));
    const air = text(box.shipMode, 10) === "air";
    out.push({ id: text(box.id, 128), title: air ? text(box.label, 80) || text(box.airWaybill, 20) : containerTitle(box), air, lines: list });
  }
  const arrivedMs = (raw: unknown) => dateOf(asRow(raw).arrivedAt)?.getTime() ?? dateOf(asRow(raw).updatedAt)?.getTime() ?? 0;
  const order = new Map(containers.map((raw) => [text(asRow(raw).id, 128), arrivedMs(raw)] as const));
  out.sort((a, b) => (order.get(b.id) ?? 0) - (order.get(a.id) ?? 0) || a.title.localeCompare(b.title));
  return out;
}

/**
 * Where a line stands for delivery:
 *   - "delivered": done (undo is for managers);
 *   - "ready": on a container marked ready for pickup - Mark delivered;
 *   - "not_arrived": waiting for a container, or on one still loading or at
 *     sea (the server refuses `delivery_not_arrived`).
 * `container` is the line's own container, or null when unknown.
 */
export type DeliveryStage = "delivered" | "ready" | "not_arrived";

export function deliveryStage(line: unknown, container: unknown): DeliveryStage {
  const row = asRow(line);
  if (row.deliveredAt) return "delivered";
  const containerId = text(row.containerId);
  const box = asRow(container);
  if (!containerId || text(box.id) !== containerId) return "not_arrived";
  return containerStatus(box) === "arrived" ? "ready" : "not_arrived";
}

/** Why Mark delivered is not offered yet (French in french-dom.ts). */
export const DELIVERY_NOT_ARRIVED_HINT =
  "It can be marked delivered once its container is ready for pickup.";

// ---------------------------------------------------------------------------
// "X of Y delivered" on a container.
// ---------------------------------------------------------------------------

export type ContainerDeliveryProgress = { delivered: number; total: number };

/**
 * From the container's stored tallies (`deliveredCount` beside `lineCount`,
 * kept by the server; absent reads 0), the line count falling back to the
 * lines on screen for a container from before the tallies. Never above total.
 */
export function containerDeliveryProgress(container: unknown, lines: readonly unknown[] = []): ContainerDeliveryProgress {
  const row = asRow(container);
  const total = containerRowCounts(row, lines).lineCount;
  const raw = Math.round(Number(row.deliveredCount));
  const delivered = Number.isFinite(raw) && raw > 0 ? Math.min(raw, total) : 0;
  return { delivered, total };
}

/** Shown on a container ready for pickup, or on any that has a delivery. */
export function showsDeliveryProgress(container: unknown, progress: ContainerDeliveryProgress): boolean {
  return progress.total > 0 && (containerStatus(container) === "arrived" || progress.delivered > 0);
}

/** "2 of 5 delivered" / "2 sur 5 livrés" (rendered `data-no-translate`). */
export function deliveredOfText(progress: ContainerDeliveryProgress, lang: Lang = "en"): string {
  const { delivered, total } = progress;
  if (lang === "fr") return `${delivered} sur ${total} ${delivered > 1 ? "livrés" : "livré"}`;
  return `${delivered} of ${total} delivered`;
}
