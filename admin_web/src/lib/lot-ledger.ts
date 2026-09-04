/**
 * Lot ledger, console side — activity log, expense ledger, and the money
 * formatting the reports lean on.
 *
 * The rules here are a deliberate mirror of the server's pure module,
 * `my_flutter_app/functions/lot_ledger.js`. The callables are the authority;
 * this exists so a form refuses a bad entry before it costs a round trip, and
 * so the refusal reads as a sentence next to the field rather than a raw code.
 *
 * Nothing here imports Firebase or React: `lot-ledger.test.ts` validates it
 * without a browser. Copy that shape from `business-parking-entry.ts`.
 */

import { BUSINESS_PARKING_RECEIVED_VIA_OPTIONS } from "./business-parking-entry.ts";

/** Same vocabulary as parking: a website link, or money taken off-platform. */
export const LOT_ACTIVITY_PAYMENT_METHODS = ["payment_link", "direct"] as const;
export type LotActivityPaymentMethod =
  (typeof LOT_ACTIVITY_PAYMENT_METHODS)[number];

/** Off-platform methods are the parking list, reused so the two never drift. */
export const LOT_RECEIVED_VIA_OPTIONS = BUSINESS_PARKING_RECEIVED_VIA_OPTIONS;

/**
 * Auction houses for a title purchase. Not tied to a hard-coded activity —
 * an activity type carries `needsAuctionHouse`, and only then does the form
 * ask, so a lot can add its own auction-priced job.
 */
export const LOT_AUCTION_HOUSES = [
  "ACV",
  "IAAI",
  "Copart",
  "Adesa",
  "Manheim",
  "Other",
] as const;
export type LotAuctionHouse = (typeof LOT_AUCTION_HOUSES)[number];

/** The literal activity id for a one-off priced on the spot. */
export const LOT_CUSTOM_ACTIVITY_ID = "custom";

/** Two kinds of expense line, plus a one-off month. */
export const LOT_EXPENSE_KINDS = ["fixed", "metered", "one_off"] as const;
export type LotExpenseKind = (typeof LOT_EXPENSE_KINDS)[number];

/** Default proof threshold: a receipt is required at $75.00 and above. */
export const DEFAULT_EXPENSE_PROOF_THRESHOLD_CENTS = 7500;

// ---------------------------------------------------------------------------
// Money — a true minus, the sign outside the symbol: −$9,291, never $-9,291.
// ---------------------------------------------------------------------------

/** Parse a dollar string ("50", "50.5", "$1,200.00") to whole cents, or null. */
export function dollarsToCents(value: unknown): number | null {
  const raw = String(value ?? "").trim().replace(/[$,\s]/g, "");
  if (raw === "") return null;
  if (!/^-?\d*(\.\d{0,2})?$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** `$1,234.00`. Negative renders as `−$1,234.00` (true minus, sign outside). */
export function formatCents(cents: number): string {
  const n = Number(cents) || 0;
  const abs = Math.abs(n) / 100;
  const body = `$${abs.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  return n < 0 ? `−${body}` : body;
}

/** `12%` / `−4%`, same true minus as money. */
export function formatPercent(fraction: number, digits = 0): string {
  const n = Number.isFinite(fraction) ? fraction : 0;
  const abs = Math.abs(n) * 100;
  const body = `${abs.toFixed(digits)}%`;
  return n < 0 ? `−${body}` : body;
}

// ---------------------------------------------------------------------------
// Activity types — the business's own catalogue of what it charges for.
// ---------------------------------------------------------------------------

export type LotActivityTypeDraft = {
  label: string;
  /** Dollars as typed; "0" means staff price every job. */
  defaultFee: string;
  needsAuctionHouse: boolean;
};

export const emptyLotActivityTypeDraft: LotActivityTypeDraft = {
  label: "",
  defaultFee: "",
  needsAuctionHouse: false,
};

export type LotActivityTypeError =
  | "activity_type_label_required"
  | "activity_type_fee_invalid";

export const LOT_ACTIVITY_TYPE_MESSAGES: Record<LotActivityTypeError, string> = {
  activity_type_label_required: "Name the activity.",
  activity_type_fee_invalid: "Give it a fee. Use 0 if you price it job by job.",
};

function trimmed(value: unknown, max = 200): string {
  return String(value ?? "").trim().slice(0, max);
}

function isEmailish(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

export function validateLotActivityTypeDraft(
  draft: LotActivityTypeDraft,
): LotActivityTypeError[] {
  const errors: LotActivityTypeError[] = [];
  if (!trimmed(draft.label, 120)) errors.push("activity_type_label_required");
  // A fee is required, but 0 is a real, meaningful value (price per job).
  const cents = dollarsToCents(draft.defaultFee);
  if (cents === null || cents < 0) errors.push("activity_type_fee_invalid");
  return errors;
}

export function lotActivityTypePayload(
  draft: LotActivityTypeDraft,
  extra: { typeId?: string; active?: boolean; sortOrder?: number } = {},
) {
  return {
    ...(extra.typeId ? { typeId: extra.typeId } : {}),
    label: trimmed(draft.label, 120),
    defaultFeeCents: dollarsToCents(draft.defaultFee) ?? 0,
    needsAuctionHouse: draft.needsAuctionHouse === true,
    active: extra.active !== false,
    ...(typeof extra.sortOrder === "number" ? { sortOrder: extra.sortOrder } : {}),
  };
}

// ---------------------------------------------------------------------------
// A recorded activity (one job the lot billed for).
// ---------------------------------------------------------------------------

export type LotActivityDraft = {
  /** A `lotActivityTypes` doc id, or LOT_CUSTOM_ACTIVITY_ID. */
  activityTypeId: string;
  /** Required when activityTypeId is custom. */
  customLabel: string;
  /** Dollars as typed; prefilled from the type but editable. */
  fee: string;
  /** `yyyy-mm-dd` from an <input type="date">. */
  activityDate: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  carMake: string;
  carModel: string;
  carYear: string;
  vinNumber: string;
  /** Only asked when the chosen type needs it. */
  auctionHouse: string;
  paymentMethod: LotActivityPaymentMethod;
  /** direct only. */
  receivedVia: string;
  receivedByStaffId: string;
};

export const emptyLotActivityDraft: LotActivityDraft = {
  activityTypeId: "",
  customLabel: "",
  fee: "",
  activityDate: "",
  customerName: "",
  customerPhone: "",
  customerEmail: "",
  carMake: "",
  carModel: "",
  carYear: "",
  vinNumber: "",
  auctionHouse: "",
  paymentMethod: "payment_link",
  receivedVia: "cash",
  receivedByStaffId: "",
};

export type LotActivityError =
  | "activity_type_invalid"
  | "custom_label_required"
  | "fee_required"
  | "activity_date_required"
  | "customer_name_required"
  | "vin_required"
  | "payment_method_invalid"
  | "payment_link_contact_required"
  | "received_by_required";

export const LOT_ACTIVITY_MESSAGES: Record<LotActivityError, string> = {
  activity_type_invalid: "Choose what was done.",
  custom_label_required: "Say what was done.",
  fee_required: "Enter the fee charged.",
  activity_date_required: "Choose the date.",
  customer_name_required: "Enter the customer's name.",
  vin_required: "Enter the VIN.",
  payment_method_invalid: "Choose how this gets paid.",
  payment_link_contact_required:
    "A payment link needs a phone number or an email address.",
  received_by_required: "Say which staff member took the payment.",
};

/**
 * Every problem at once. `knownTypeIds` is the business's own activity-type
 * ids so a stale picker value is caught here, not at the server.
 */
export function validateLotActivityDraft(
  draft: LotActivityDraft,
  knownTypeIds: readonly string[] = [],
): LotActivityError[] {
  const errors: LotActivityError[] = [];

  const typeId = trimmed(draft.activityTypeId, 120);
  const isCustom = typeId === LOT_CUSTOM_ACTIVITY_ID;
  if (!typeId || (!isCustom && !knownTypeIds.includes(typeId))) {
    errors.push("activity_type_invalid");
  }
  if (isCustom && !trimmed(draft.customLabel, 120)) {
    errors.push("custom_label_required");
  }

  if (dollarsToCents(draft.fee) === null) errors.push("fee_required");
  if (!trimmed(draft.activityDate, 60)) errors.push("activity_date_required");
  if (!trimmed(draft.customerName)) errors.push("customer_name_required");
  if (!trimmed(draft.vinNumber, 17)) errors.push("vin_required");

  const method = trimmed(draft.paymentMethod, 40);
  if (!(LOT_ACTIVITY_PAYMENT_METHODS as readonly string[]).includes(method)) {
    errors.push("payment_method_invalid");
  }

  const phone = trimmed(draft.customerPhone, 40);
  const email = trimmed(draft.customerEmail, 180).toLowerCase();
  if (method === "payment_link" && !phone && !email) {
    errors.push("payment_link_contact_required");
  }
  // A link settles itself and never names a staff member; money taken off the
  // platform must say who held it.
  if (method === "direct" && !trimmed(draft.receivedByStaffId, 120)) {
    errors.push("received_by_required");
  }

  return errors;
}

export function lotActivityMessage(
  errors: readonly LotActivityError[],
): string {
  return errors.map((code) => LOT_ACTIVITY_MESSAGES[code]).join(" ");
}

/**
 * The callable payload. The fee is sent, but the server recomputes it from
 * the activity type's rate unless staff overrode it — the client can never
 * silently price a job (same reasoning as businessParkingUpdateChanges).
 */
export function lotActivityPayload(
  draft: LotActivityDraft,
  businessId: string,
) {
  const method = trimmed(draft.paymentMethod, 40);
  return {
    businessId: trimmed(businessId, 180),
    activityTypeId: trimmed(draft.activityTypeId, 120),
    customLabel: trimmed(draft.customLabel, 120),
    feeCents: dollarsToCents(draft.fee) ?? 0,
    activityDate: `${trimmed(draft.activityDate, 60)}T12:00:00`,
    customerName: trimmed(draft.customerName),
    customerPhone: trimmed(draft.customerPhone, 40),
    customerEmail: trimmed(draft.customerEmail, 180).toLowerCase(),
    carMake: trimmed(draft.carMake, 80),
    carModel: trimmed(draft.carModel, 80),
    carYear: trimmed(draft.carYear, 8),
    vinNumber: trimmed(draft.vinNumber, 17).toUpperCase(),
    auctionHouse: trimmed(draft.auctionHouse, 40),
    paymentMethod: method,
    receivedVia: method === "direct" ? trimmed(draft.receivedVia, 40) : "",
    receivedByStaffId:
      method === "direct" ? trimmed(draft.receivedByStaffId, 120) : "",
  };
}

// ---------------------------------------------------------------------------
// Expense entries.
// ---------------------------------------------------------------------------

export type LotExpenseEntryDraft = {
  /** Dollars as typed. */
  amount: string;
  /** `yyyy-mm-dd`. */
  spentAt: string;
  paidByStaffId: string;
  note: string;
  /** Whether a proof file is attached (the file itself is uploaded separately). */
  hasProof: boolean;
};

export const emptyLotExpenseEntryDraft: LotExpenseEntryDraft = {
  amount: "",
  spentAt: "",
  paidByStaffId: "",
  note: "",
  hasProof: false,
};

export type LotExpenseEntryError =
  | "expense_amount_required"
  | "expense_date_required"
  | "expense_paid_by_required"
  | "expense_proof_required";

export const LOT_EXPENSE_MESSAGES: Record<LotExpenseEntryError, string> = {
  expense_amount_required: "Enter what was spent.",
  expense_date_required: "Choose the date of the purchase.",
  expense_paid_by_required: "Say who paid for it.",
  // The threshold is interpolated by expenseProofMessage below.
  expense_proof_required:
    "Attach a receipt: this business asks for proof at a set amount and above.",
};

/** Proof is required at or above the threshold; 0 means never require it. */
export function expenseProofRequired(
  amountCents: number,
  thresholdCents: number,
): boolean {
  const threshold = Number(thresholdCents) || 0;
  if (threshold <= 0) return false;
  return (Number(amountCents) || 0) >= threshold;
}

export function expenseProofMessage(thresholdCents: number): string {
  return `Attach a receipt: this business asks for proof at ${formatCents(
    thresholdCents,
  )} and above.`;
}

export function validateLotExpenseEntryDraft(
  draft: LotExpenseEntryDraft,
  thresholdCents = DEFAULT_EXPENSE_PROOF_THRESHOLD_CENTS,
): LotExpenseEntryError[] {
  const errors: LotExpenseEntryError[] = [];
  const cents = dollarsToCents(draft.amount);
  if (cents === null || cents <= 0) errors.push("expense_amount_required");
  if (!trimmed(draft.spentAt, 60)) errors.push("expense_date_required");
  if (!trimmed(draft.paidByStaffId, 120)) errors.push("expense_paid_by_required");
  // The client refuses too, but this is a server rule, not a form nicety.
  if (cents !== null && expenseProofRequired(cents, thresholdCents) && !draft.hasProof) {
    errors.push("expense_proof_required");
  }
  return errors;
}

export function lotExpenseEntryMessage(
  errors: readonly LotExpenseEntryError[],
  thresholdCents = DEFAULT_EXPENSE_PROOF_THRESHOLD_CENTS,
): string {
  return errors
    .map((code) =>
      code === "expense_proof_required"
        ? expenseProofMessage(thresholdCents)
        : LOT_EXPENSE_MESSAGES[code],
    )
    .join(" ");
}

export function lotExpenseEntryPayload(
  draft: LotExpenseEntryDraft,
  extra: { businessId: string; lineId: string; month: string },
) {
  return {
    businessId: trimmed(extra.businessId, 180),
    lineId: trimmed(extra.lineId, 120),
    month: trimmed(extra.month, 7),
    amountCents: dollarsToCents(draft.amount) ?? 0,
    spentAt: `${trimmed(draft.spentAt, 60)}T12:00:00`,
    paidByStaffId: trimmed(draft.paidByStaffId, 120),
    note: trimmed(draft.note, 500),
  };
}

// ---------------------------------------------------------------------------
// Reading money off a recorded row — the badge reads the money, not a colour.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

export function lotActivityPaid(row: Row): boolean {
  return String(row?.paymentStatus ?? "") === "succeeded";
}

export function lotActivityAwaitingLink(row: Row): boolean {
  return String(row?.paymentStatus ?? "") === "awaiting_payment_link";
}

/** Chase is offered only on an unpaid link — never on a settled or direct row. */
export function canChaseLotActivity(row: Row): boolean {
  return (
    String(row?.paymentMethod ?? "") === "payment_link" &&
    String(row?.paymentStatus ?? "") === "awaiting_payment_link"
  );
}

/** How the money reads, from the money itself. */
export function lotActivityPaymentLabel(row: Row): string {
  const status = String(row?.paymentStatus ?? "");
  const method = String(row?.paymentMethod ?? "");
  if (status === "cancelled") return "Cancelled";
  if (method === "payment_link") {
    return status === "succeeded" ? "Paid on the platform" : "Awaiting payment";
  }
  // direct
  const via = String(row?.receivedVia ?? "");
  const option = LOT_RECEIVED_VIA_OPTIONS.find((o) => o.value === via);
  return option ? option.label : "Paid outside the platform";
}
