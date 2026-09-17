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
  /**
   * Whether this kind of job is done to a car. Absent means yes, exactly as
   * the server reads it (`lotActivityTypeRecord`), so every type written
   * before the flag existed keeps asking for a VIN. Only a type that opts out
   * — lending an auction account, say — records work with no vehicle.
   */
  needsVehicle?: boolean;
};

export const emptyLotActivityTypeDraft: LotActivityTypeDraft = {
  label: "",
  defaultFee: "",
  needsAuctionHouse: false,
  needsVehicle: true,
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
    // Sent explicitly rather than omitted: the server reads absent as true,
    // so a type that records no vehicle has to say so out loud.
    needsVehicle: draft.needsVehicle !== false,
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
  /** Direct only: whether the money is already in hand. When false the
   *  activity is logged as owed and no one is named as having received it. */
  paymentReceived: boolean;
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
  paymentReceived: true,
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
 * What the chosen activity type demands of the form. `needsVehicle` absent
 * means yes — the same absent-means-yes the server applies — so a caller that
 * has not resolved the type still gets the VIN guard.
 */
export type LotActivityDraftOptions = { needsVehicle?: boolean };

/**
 * Every problem at once. `knownTypeIds` is the business's own activity-type
 * ids so a stale picker value is caught here, not at the server.
 */
export function validateLotActivityDraft(
  draft: LotActivityDraft,
  knownTypeIds: readonly string[] = [],
  options: LotActivityDraftOptions = {},
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
  // A VIN identifies the car the job was done to. Work with no car has none,
  // and typing a placeholder to clear this check is how the ledger fills up
  // with fictional vehicles. The type decides; absent means yes.
  if (options.needsVehicle !== false && !trimmed(draft.vinNumber, 17)) {
    errors.push("vin_required");
  }

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
  // platform must say who held it - but only once it has actually been
  // received. An activity logged before the money arrives names no one yet.
  if (
    method === "direct" &&
    draft.paymentReceived &&
    !trimmed(draft.receivedByStaffId, 120)
  ) {
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
  options: LotActivityDraftOptions = {},
) {
  const method = trimmed(draft.paymentMethod, 40);
  // A type that records no vehicle sends no vehicle. The form hides those
  // fields, but a draft that had them filled before the type was changed
  // would otherwise carry a car into a job that never had one.
  const vehicle = options.needsVehicle !== false;
  return {
    businessId: trimmed(businessId, 180),
    activityTypeId: trimmed(draft.activityTypeId, 120),
    customLabel: trimmed(draft.customLabel, 120),
    feeCents: dollarsToCents(draft.fee) ?? 0,
    activityDate: `${trimmed(draft.activityDate, 60)}T12:00:00`,
    customerName: trimmed(draft.customerName),
    customerPhone: trimmed(draft.customerPhone, 40),
    customerEmail: trimmed(draft.customerEmail, 180).toLowerCase(),
    carMake: vehicle ? trimmed(draft.carMake, 80) : "",
    carModel: vehicle ? trimmed(draft.carModel, 80) : "",
    carYear: vehicle ? trimmed(draft.carYear, 8) : "",
    vinNumber: vehicle ? trimmed(draft.vinNumber, 17).toUpperCase() : "",
    auctionHouse: trimmed(draft.auctionHouse, 40),
    paymentMethod: method,
    // Absent-means-received on the server, so send it explicitly; a direct
    // activity that has not been paid yet carries no received fields.
    paymentReceived: method === "direct" ? draft.paymentReceived : true,
    receivedVia:
      method === "direct" && draft.paymentReceived
        ? trimmed(draft.receivedVia, 40)
        : "",
    receivedByStaffId:
      method === "direct" && draft.paymentReceived
        ? trimmed(draft.receivedByStaffId, 120)
        : "",
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

function rowDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function") {
    return (value as { toDate: () => Date }).toDate();
  }
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/**
 * `yyyy-mm-dd` for an <input type="date"> from a stored date (Timestamp,
 * Date, or ISO string), in the viewer's local calendar. Empty when unset.
 * The edit form used to rebuild this as the 1st of the month, silently
 * moving every edited entry's date.
 */
export function dateInputValue(value: unknown): string {
  const date = rowDate(value);
  if (!date) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * The one month an expense entry counts in: the bill month it was logged
 * against, else the month it was bought. Never both — matching either used
 * to count a September purchase logged against August's bill twice.
 */
export function lotExpenseEntryMonth(entry: Row): string {
  const explicit = String(entry?.month ?? "").trim().slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(explicit)) return explicit;
  return dateInputValue(entry?.spentAt).slice(0, 7);
}

export function lotActivityPaid(row: Row): boolean {
  return String(row?.paymentStatus ?? "") === "succeeded";
}

export function lotActivityAwaitingLink(row: Row): boolean {
  return String(row?.paymentStatus ?? "") === "awaiting_payment_link";
}

/**
 * Whether a row still has money to collect: an unpaid link, or a direct
 * activity logged before its cash came in. Both are chased/settled from the
 * same control (a link can be re-sent or marked received; a direct one is
 * just marked received) — never a settled or cancelled row.
 */
export function canChaseLotActivity(row: Row): boolean {
  const status = String(row?.paymentStatus ?? "");
  const method = String(row?.paymentMethod ?? "");
  return (
    (method === "payment_link" && status === "awaiting_payment_link") ||
    (method === "direct" && status === "awaiting_direct_payment")
  );
}

/** A row awaiting an off-platform payment can only be marked received - there
 *  is no link to re-send. Splits the two so the chase UI shows the right one. */
export function lotActivityAwaitsDirect(row: Row): boolean {
  return (
    String(row?.paymentMethod ?? "") === "direct" &&
    String(row?.paymentStatus ?? "") === "awaiting_direct_payment"
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
  // direct: logged before the cash arrived reads as awaiting, not paid.
  if (status === "awaiting_direct_payment") return "Awaiting payment";
  const via = String(row?.receivedVia ?? "");
  const option = LOT_RECEIVED_VIA_OPTIONS.find((o) => o.value === via);
  return option ? option.label : "Paid outside the platform";
}

// ---------------------------------------------------------------------------
// What a month cost, and which line cost it.
//
// A line that charges the same every month is owed for the months it has
// actually existed for — not for months before it was set up, and not for
// months that have not happened. Without that window, creating a $2,000 rent
// line in September billed the whole of 2026 the moment it was saved: one
// month of rent read as twelve, and the year's margin came out at -13989%.
// ---------------------------------------------------------------------------

/** `yyyy-mm` of the month a line was created, or "" when unknown. */
export function lotLineFirstMonth(line: Row): string {
  return dateInputValue(line?.createdAt).slice(0, 7);
}

/** Whether a standing monthly charge is owed for `month`. */
export function fixedLineAppliesTo(
  line: Row,
  month: string,
  nowMonth: string,
): boolean {
  if (String(line?.kind ?? "") !== "fixed") return false;
  if (line?.active === false) return false;
  if (month > nowMonth) return false;
  const from = lotLineFirstMonth(line);
  if (from && month < from) return false;
  return true;
}

function liveLotEntries(entries: readonly Row[]): Row[] {
  return entries.filter((e) => e?.voided !== true);
}

function loggedAgainst(entries: readonly Row[], lineId: string, month: string) {
  return entries.some(
    (e) => String(e?.lineId ?? "") === lineId && lotExpenseEntryMonth(e) === month,
  );
}

/**
 * What one month cost: every purchase logged into it, plus the standing
 * amount of each fixed line that month did not already have a purchase
 * against. A voided purchase neither counts nor suppresses the standing
 * amount.
 */
export function lotMonthExpenseCents(
  lines: readonly Row[],
  entries: readonly Row[],
  month: string,
  nowMonth: string,
): number {
  const live = liveLotEntries(entries);
  let sum = 0;
  for (const entry of live) {
    if (lotExpenseEntryMonth(entry) === month) {
      sum += Number(entry?.amountCents) || 0;
    }
  }
  for (const line of lines) {
    if (!fixedLineAppliesTo(line, month, nowMonth)) continue;
    if (loggedAgainst(live, String(line?.id ?? ""), month)) continue;
    sum += Number(line?.recurringCents) || 0;
  }
  return sum;
}

export type LotLineSpend = { lineId: string; label: string; cents: number };

/**
 * What each line cost across `months`, largest first — built from the same
 * per-month rules as `lotMonthExpenseCents`, so the parts always add up to
 * the total they are shown beneath.
 */
export function lotExpenseByLine(
  lines: readonly Row[],
  entries: readonly Row[],
  months: readonly string[],
  nowMonth: string,
): LotLineSpend[] {
  const live = liveLotEntries(entries);
  const totals = new Map<string, number>();
  const add = (lineId: string, cents: number) => {
    if (!cents) return;
    totals.set(lineId, (totals.get(lineId) ?? 0) + cents);
  };

  for (const month of months) {
    for (const entry of live) {
      if (lotExpenseEntryMonth(entry) === month) {
        add(String(entry?.lineId ?? ""), Number(entry?.amountCents) || 0);
      }
    }
    for (const line of lines) {
      if (!fixedLineAppliesTo(line, month, nowMonth)) continue;
      const id = String(line?.id ?? "");
      if (loggedAgainst(live, id, month)) continue;
      add(id, Number(line?.recurringCents) || 0);
    }
  }

  const labelFor = (id: string) => {
    const line = lines.find((l) => String(l?.id ?? "") === id);
    return line ? String(line.label ?? "") : "";
  };

  return [...totals.entries()]
    .map(([lineId, cents]) => ({ lineId, label: labelFor(lineId), cents }))
    .sort((a, b) => b.cents - a.cents);
}

// ---------------------------------------------------------------------------
// Instalments — what has arrived against what was agreed.
//
// A deliberate mirror of the instalment block in
// `my_flutter_app/functions/lot_ledger.js`. `feeCents` is the agreed total;
// `amountPaidCents` is what has actually come in, across any number of
// payments on either rail — cash taken at the lot, or card taken on the
// customer's link — in any order. Each instalment is its own document in
// `lotActivityPayments`, carrying the rail it arrived on and the month it
// arrived in.
//
// `paymentStatus` deliberately gains no "part paid" member: it still means
// settled or not, and part-paid is DERIVED from the two numbers. A status
// enum that grows a middle value silently changes what every existing reader
// of `succeeded` believes.
// ---------------------------------------------------------------------------

/**
 * Card fees are a percentage plus a fixed 30 cents, so tiny card payments
 * lose a large share of themselves. Cash has no floor: staff record whatever
 * they were handed.
 */
export const LOT_ACTIVITY_MIN_CARD_PAYMENT_CENTS = 2000;

export const LOT_ACTIVITY_PAYMENT_SOURCES = ["cash", "card"] as const;
export type LotActivityPaymentSource =
  (typeof LOT_ACTIVITY_PAYMENT_SOURCES)[number];

/** Whole non-negative cents from anything a Firestore row might hold. */
function rowCents(value: unknown): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function rowStatus(row: Row): string {
  return String(row?.paymentStatus ?? "").trim();
}

/**
 * What has actually been collected against an activity. Absent means nothing,
 * so a record written before instalments existed reads as unpaid unless its
 * status says otherwise.
 */
export function lotActivityPaidCents(row: Row): number {
  const stored = rowCents(row?.amountPaidCents);
  if (stored > 0) return stored;
  // Settled before instalments existed: the whole fee was collected in one go
  // and no running total was ever written.
  if (rowStatus(row) === "succeeded") return rowCents(row?.feeCents);
  return 0;
}

/** Cents still owed, never below zero. */
export function lotActivityRemainingCents(row: Row): number {
  return Math.max(0, rowCents(row?.feeCents) - lotActivityPaidCents(row));
}

/**
 * Money has arrived but the job is not settled. A voided job is never part
 * paid for display purposes — it is dead, and its balance is not chased.
 */
export function lotActivityPartlyPaid(row: Row): boolean {
  if (row?.voided === true) return false;
  const paid = lotActivityPaidCents(row);
  return paid > 0 && paid < rowCents(row?.feeCents);
}

/**
 * The two-word badge, in the exact vocabulary `businessParkingPaymentBadge`
 * uses — "Paid" / "Part paid" / "Not paid". The parking ledger and the
 * activity ledger sit in the same panel and must not describe the same state
 * in two different ways. Empty for a voided or cancelled row, which is not a
 * balance anyone chases.
 */
export function lotActivityPaymentBadge(row: Row): string {
  if (row?.voided === true) return "";
  const status = rowStatus(row);
  if (status === "cancelled") return "";
  const fee = rowCents(row?.feeCents);
  const paid = lotActivityPaidCents(row);
  // Covered counts as paid even if the status has not caught up yet (a card
  // instalment settles the row a moment after Stripe reports it).
  if (status === "succeeded" || (fee > 0 && paid >= fee)) return "Paid";
  return paid > 0 ? "Part paid" : "Not paid";
}

/**
 * "$350.00 of $1,000.00" — what has arrived, against what was agreed. Empty
 * when there is no fee to read it against.
 */
export function lotActivityBalanceText(row: Row): string {
  const fee = rowCents(row?.feeCents);
  if (fee <= 0) return "";
  return `${formatCents(lotActivityPaidCents(row))} of ${formatCents(fee)}`;
}

/** Why a payment cannot be applied, in the server's own vocabulary. */
export type LotPaymentRefusal =
  | "activity_voided"
  | "activity_cancelled"
  | "nothing_to_pay"
  | "already_paid"
  | "no_amount"
  | "below_card_minimum";

export type LotPaymentPlan = {
  ok: boolean;
  reason?: LotPaymentRefusal;
  appliedCents: number;
  overpaidCents: number;
  newPaidCents: number;
  remainingCents: number;
  fullyCovered: boolean;
};

function lotPaymentRefusal(reason: LotPaymentRefusal): LotPaymentPlan {
  return {
    ok: false,
    reason,
    appliedCents: 0,
    overpaidCents: 0,
    newPaidCents: 0,
    remainingCents: 0,
    fullyCovered: false,
  };
}

/**
 * Plan one instalment against an activity — the same arithmetic the callable
 * runs, so the form agrees with the server before the round trip.
 *
 * Cash is clamped to the balance: staff typing more than is owed is a typo,
 * not a tip. Card is never clamped, because by the time this runs Stripe has
 * already taken the money; an overspill is reported as `overpaidCents`.
 */
export function lotActivityPaymentPlan(input: {
  activity: Row;
  amountCents: unknown;
  source: string;
}): LotPaymentPlan {
  const activity = input.activity ?? {};
  const rail: LotActivityPaymentSource =
    (LOT_ACTIVITY_PAYMENT_SOURCES as readonly string[]).includes(
      String(input.source ?? ""),
    )
      ? (String(input.source) as LotActivityPaymentSource)
      : "cash";

  if (activity.voided === true) return lotPaymentRefusal("activity_voided");
  if (rowStatus(activity) === "cancelled") {
    return lotPaymentRefusal("activity_cancelled");
  }

  const fee = rowCents(activity.feeCents);
  if (fee <= 0) return lotPaymentRefusal("nothing_to_pay");

  const alreadyPaid = lotActivityPaidCents(activity);
  const remaining = Math.max(0, fee - alreadyPaid);
  if (remaining <= 0) return lotPaymentRefusal("already_paid");

  let applied = Math.round(Number(input.amountCents));
  if (!Number.isFinite(applied) || applied <= 0) {
    return lotPaymentRefusal("no_amount");
  }
  if (rail === "card" && applied < LOT_ACTIVITY_MIN_CARD_PAYMENT_CENTS) {
    return lotPaymentRefusal("below_card_minimum");
  }

  const overpaid = rail === "card" ? Math.max(0, applied - remaining) : 0;
  applied = Math.min(applied, remaining);

  const newPaidCents = alreadyPaid + applied;
  return {
    ok: true,
    appliedCents: applied,
    overpaidCents: overpaid,
    newPaidCents,
    remainingCents: Math.max(0, fee - newPaidCents),
    fullyCovered: newPaidCents >= fee,
  };
}

// ---------------------------------------------------------------------------
// Recording an instalment from the console (the cash rail).
//
// The console only ever records CASH: a card instalment arrives on the
// customer's own payment link, which is why there is no card minimum to
// enforce here. The rail is still carried explicitly so the payload says what
// it means rather than relying on a server default.
// ---------------------------------------------------------------------------

export type LotInstalmentDraft = {
  /** Dollars as typed. */
  amount: string;
  receivedVia: string;
  receivedByStaffId: string;
  note: string;
};

export const emptyLotInstalmentDraft: LotInstalmentDraft = {
  amount: "",
  receivedVia: "cash",
  receivedByStaffId: "",
  note: "",
};

export type LotInstalmentError =
  | "instalment_amount_required"
  | "instalment_received_by_required"
  | LotPaymentRefusal;

export const LOT_INSTALMENT_MESSAGES: Record<LotInstalmentError, string> = {
  instalment_amount_required: "Enter how much came in.",
  instalment_received_by_required:
    "Say which staff member took the payment.",
  no_amount: "Enter how much came in.",
  activity_voided: "This entry was voided. Record a new one instead.",
  activity_cancelled: "This entry was cancelled, so there is nothing to collect.",
  nothing_to_pay: "This entry has no fee to collect.",
  already_paid: "This entry is already paid in full.",
  below_card_minimum: "A card payment has to be at least $20.00.",
};

export function lotInstalmentMessage(
  errors: readonly LotInstalmentError[],
): string {
  // De-duplicated: an empty amount reports as both a form problem and a plan
  // refusal, and the same sentence twice reads like a stutter.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const code of errors) {
    const message = LOT_INSTALMENT_MESSAGES[code];
    if (!message || seen.has(message)) continue;
    seen.add(message);
    out.push(message);
  }
  return out.join(" ");
}

/**
 * Every problem at once: the form's own rules, plus whatever the server's
 * payment plan would refuse.
 */
export function validateLotInstalmentDraft(
  draft: LotInstalmentDraft,
  activity: Row,
  source: LotActivityPaymentSource = "cash",
): LotInstalmentError[] {
  const errors: LotInstalmentError[] = [];
  const cents = dollarsToCents(draft.amount);
  if (cents === null || cents <= 0) errors.push("instalment_amount_required");
  // Money taken off-platform must say who held it — the same rule the rest of
  // the ledger applies to a direct payment.
  if (source === "cash" && !trimmed(draft.receivedByStaffId, 120)) {
    errors.push("instalment_received_by_required");
  }
  const plan = lotActivityPaymentPlan({
    activity,
    amountCents: cents ?? 0,
    source,
  });
  if (!plan.ok && plan.reason && plan.reason !== "no_amount") {
    errors.push(plan.reason);
  }
  return errors;
}

/** The `recordLotActivityInstalment` payload, clamped to the balance. */
export function lotInstalmentPayload(
  draft: LotInstalmentDraft,
  extra: { businessId: string; activityId: string; activity: Row },
) {
  const plan = lotActivityPaymentPlan({
    activity: extra.activity,
    amountCents: dollarsToCents(draft.amount) ?? 0,
    source: "cash",
  });
  return {
    businessId: trimmed(extra.businessId, 180),
    activityId: trimmed(extra.activityId, 120),
    amountCents: plan.appliedCents,
    receivedVia: trimmed(draft.receivedVia, 40),
    receivedByStaffId: trimmed(draft.receivedByStaffId, 120),
    note: trimmed(draft.note, 300),
  };
}

// ---------------------------------------------------------------------------
// The scoreboard — Generated, Collected, Owed, for a span of months.
//
// The three figures answer three different questions and are NOT three slices
// of one number:
//
// - Generated is what the jobs in the span billed. It belongs to the job's own
//   month (`activityDate`).
// - Owed is what those same jobs still have outstanding — a property of the
//   job, so it also belongs to the job's month.
// - Collected is money that ARRIVED in the span, which the owner decided is
//   the month of the PAYMENT, not the month of the job. A September job paid
//   in November is November's income. So it is read from `lotActivityPayments`
//   (each payment carries its own `paidAtMonth`), never derived from the
//   activity rows.
//
// The consequence is deliberate: in a single month Collected + Owed need not
// equal Generated, because a payment that landed this month may belong to a
// job billed in another one.
//
// One wrinkle has to be handled or history disappears. Rows settled before
// instalments existed — and rows settled by the older whole-balance paths that
// write `paymentStatus` without a payment document — have money on them that
// no `lotActivityPayments` row explains. For each job in the span we therefore
// add the part of `lotActivityPaidCents` that its own payment documents do NOT
// account for, attributed to the job's month (the only date such money has).
// That is exact: a job whose collection is fully documented contributes
// nothing here, so nothing is ever counted twice.
// ---------------------------------------------------------------------------

/** The month an instalment counts in: the one it arrived in. */
export function lotPaymentMonth(payment: Row): string {
  const explicit = String(payment?.paidAtMonth ?? "").trim().slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(explicit)) return explicit;
  return dateInputValue(payment?.createdAt).slice(0, 7);
}

/** A voided or cancelled job neither bills nor collects. */
function lotActivityCounts(row: Row): boolean {
  return row?.voided !== true && rowStatus(row) !== "cancelled";
}

/**
 * What a job has been paid, for the purpose of a board that has to balance.
 *
 * `lotActivityPaidCents` mirrors the server exactly, and the server prefers a
 * stored running total over the status. That is right for the row's own
 * arithmetic and wrong for a board: a job settled by a whole-balance action
 * (`recordLotActivityDirectPayment`, or a Stripe settlement) updates the
 * status without rewriting `amountPaidCents`, so a job that had taken $350 and
 * was then settled still reports $650 outstanding. The parking ledger shipped
 * that exact bug — "Collected $528 / Owed $108" with the $108 sitting on a row
 * badged PAID — and fixed it the same way.
 *
 * Settled means paid for everything it ran up. Reading it that way is what
 * keeps Collected + Owed equal to Generated.
 */
function lotSettledPaidCents(row: Row): number {
  const paid = lotActivityPaidCents(row);
  if (rowStatus(row) !== "succeeded") return paid;
  return Math.max(paid, rowCents(row?.feeCents));
}

export type LotActivityScoreboard = {
  generatedCents: number;
  collectedCents: number;
  owedCents: number;
  jobs: number;
};

export function lotActivityScoreboard(input: {
  /** Every activity the panel holds — not only those in the span: a payment
   *  in the span may belong to a job billed outside it. */
  activities: readonly Row[];
  /** Every `lotActivityPayments` document the panel holds. */
  payments: readonly Row[];
  /** The job's own month, injected because the panel derives it from
   *  `activityDate`/`activityDateMonth`. */
  activityMonth: (row: Row) => string;
  /** Whether a "yyyy-mm" falls inside the scoreboard's span. */
  inRange: (month: string) => boolean;
}): LotActivityScoreboard {
  const { activities, payments, activityMonth, inRange } = input;

  const byId = new Map<string, Row>();
  for (const row of activities) byId.set(String(row?.id ?? ""), row);

  // What each job's collection is explained by an actual payment document.
  const documented = new Map<string, number>();
  let collectedCents = 0;
  for (const payment of payments) {
    const activityId = String(payment?.activityId ?? "");
    const activity = byId.get(activityId);
    // A payment whose job is not on screen (older than the panel's activity
    // window) is left out: money on the board that no visible row explains is
    // worse than money the span is missing, and the job's own row is where
    // anyone goes to check it.
    if (!activity || !lotActivityCounts(activity)) continue;
    // A reverted instalment is money the business said never arrived. It is
    // flagged rather than deleted so the claim survives, but it must not be
    // counted as collected.
    if (payment?.reverted === true) continue;
    const cents = rowCents(payment?.amountCents);
    documented.set(activityId, (documented.get(activityId) ?? 0) + cents);
    if (inRange(lotPaymentMonth(payment))) collectedCents += cents;
  }

  let generatedCents = 0;
  let owedCents = 0;
  let jobs = 0;
  for (const row of activities) {
    if (!lotActivityCounts(row)) continue;
    if (!inRange(activityMonth(row))) continue;
    const fee = rowCents(row?.feeCents);
    const paid = lotSettledPaidCents(row);
    generatedCents += fee;
    owedCents += Math.max(0, fee - paid);
    jobs += 1;
    const undocumented = paid - (documented.get(String(row?.id ?? "")) ?? 0);
    if (undocumented > 0) collectedCents += undocumented;
  }

  return { generatedCents, collectedCents, owedCents, jobs };
}
