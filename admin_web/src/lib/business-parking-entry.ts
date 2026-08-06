/**
 * Business-entered parking, console side (docs/PLAN-2026-08-backlog.md item 5).
 *
 * The rules here are a deliberate mirror of the server's pure module,
 * `my_flutter_app/functions/business_parking_entry.js`. The callable is still
 * the authority — this exists so the form can refuse a bad entry before it
 * costs a round trip, and so the refusal reads as a sentence next to the field
 * rather than a raw error code.
 *
 * Nothing in this file imports Firebase or React: it is validated by
 * `business-parking-entry.test.ts` without a browser.
 */

export const BUSINESS_PARKING_PAYMENT_METHODS = ["direct", "payment_link"] as const;

export type BusinessParkingPaymentMethod =
  (typeof BUSINESS_PARKING_PAYMENT_METHODS)[number];

/**
 * How a business says it was paid off-platform. The server normalizes an
 * unknown value to "other", so these are a picker rather than free text —
 * "Zelle", "zelle " and "ZELLE" must not become three ways a lot was paid.
 */
export const BUSINESS_PARKING_RECEIVED_VIA_OPTIONS = [
  { value: "zelle", label: "Zelle transfer" },
  { value: "cash", label: "Cash payment" },
  { value: "cashapp", label: "Cash App" },
  { value: "venmo", label: "Venmo" },
  { value: "check", label: "Paper check" },
  { value: "card_in_person", label: "Card in person" },
  { value: "other", label: "Another method" },
] as const;

export type BusinessParkingEntryDraft = {
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  carMake: string;
  carModel: string;
  carYear: string;
  vinNumber: string;
  /** `yyyy-mm-dd`, straight from an `<input type="date">`. */
  startDate: string;
  endDate: string;
  paymentMethod: BusinessParkingPaymentMethod;
};

export const emptyBusinessParkingEntryDraft: BusinessParkingEntryDraft = {
  customerName: "",
  customerPhone: "",
  customerEmail: "",
  carMake: "",
  carModel: "",
  carYear: "",
  vinNumber: "",
  startDate: "",
  endDate: "",
  paymentMethod: "direct",
};

/** Error codes, in the server's own vocabulary so the two never drift. */
export type BusinessParkingEntryError =
  | "business_required"
  | "customer_name_required"
  | "customer_phone_required"
  | "customer_email_invalid"
  | "payment_link_contact_required"
  | "payment_method_invalid"
  | "car_make_required"
  | "car_model_required"
  | "car_year_required"
  | "car_year_invalid"
  | "start_date_required"
  | "end_date_required"
  | "end_date_before_start_date";

/**
 * English copy for every refusal. French comes from the runtime DOM pass
 * (`french-dom.ts`), which is why these are plain English sentences and not
 * a second translation table.
 */
export const BUSINESS_PARKING_ENTRY_MESSAGES: Record<BusinessParkingEntryError, string> = {
  business_required: "Choose a business before recording a car.",
  customer_name_required: "Enter the customer's name.",
  customer_phone_required: "Enter the customer's phone number.",
  customer_email_invalid: "Enter a valid email address.",
  payment_link_contact_required:
    "A payment link needs a phone number or an email address.",
  payment_method_invalid: "Choose how this parking gets paid.",
  car_make_required: "Select the car make.",
  car_model_required: "Select the car model.",
  car_year_required: "Select the car year.",
  car_year_invalid: "Select a valid car year.",
  start_date_required: "Choose the day the car arrives.",
  end_date_required: "Choose the day the car leaves.",
  end_date_before_start_date: "The end date cannot be before the start date.",
};

function trimmed(value: unknown, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

function isEmailish(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

/**
 * Every problem at once, not the first one — a form that reveals its
 * objections one reload at a time is how a walk-up gets left standing there.
 *
 * @param draft What the staff member typed.
 * @param businessId The console's scoped business, "" when it has none yet.
 * @return Error codes, in a stable order.
 */
export function validateBusinessParkingEntryDraft(
  draft: BusinessParkingEntryDraft,
  businessId = "unscoped",
): BusinessParkingEntryError[] {
  const errors: BusinessParkingEntryError[] = [];

  if (!trimmed(businessId, 180)) errors.push("business_required");

  const paymentMethod = trimmed(draft.paymentMethod, 40);
  if (!(BUSINESS_PARKING_PAYMENT_METHODS as readonly string[]).includes(paymentMethod)) {
    errors.push("payment_method_invalid");
  }

  if (!trimmed(draft.customerName)) errors.push("customer_name_required");

  const phone = trimmed(draft.customerPhone, 40);
  if (!phone) errors.push("customer_phone_required");

  const email = trimmed(draft.customerEmail, 180).toLowerCase();
  if (email && !isEmailish(email)) errors.push("customer_email_invalid");
  // Email is optional — until the money has to reach someone. A payment link
  // nobody receives is a charge that never happens and a space that never
  // frees up.
  if (paymentMethod === "payment_link" && !phone && !email) {
    errors.push("payment_link_contact_required");
  }

  if (!trimmed(draft.carMake, 80)) errors.push("car_make_required");
  if (!trimmed(draft.carModel, 80)) errors.push("car_model_required");
  const year = trimmed(draft.carYear, 8);
  if (!year) {
    errors.push("car_year_required");
  } else if (!/^\d{4}$/.test(year) || Number(year) < 1900 || Number(year) > 2100) {
    errors.push("car_year_invalid");
  }

  const start = trimmed(draft.startDate, 60);
  const end = trimmed(draft.endDate, 60);
  if (!start) errors.push("start_date_required");
  if (!end) errors.push("end_date_required");
  if (start && end && end < start) errors.push("end_date_before_start_date");

  return errors;
}

/**
 * One sentence for a status line, every sentence for the form.
 *
 * @param errors Codes from validateBusinessParkingEntryDraft.
 * @return A human sentence, or "" when there is nothing wrong.
 */
export function businessParkingEntryMessage(errors: readonly BusinessParkingEntryError[]) {
  return errors.map((code) => BUSINESS_PARKING_ENTRY_MESSAGES[code]).join(" ");
}

/**
 * The callable payload. Dates go as `yyyy-mm-dd` plus a midday clock so a
 * timezone west of UTC cannot roll the parking window back a day — the server
 * parses with `new Date(...)` and charges from what it gets.
 *
 * @param draft The validated draft.
 * @param businessId The scoped business.
 * @return The exact object `createBusinessParkingEntry` expects.
 */
export function businessParkingEntryPayload(
  draft: BusinessParkingEntryDraft,
  businessId: string,
) {
  return {
    businessId: trimmed(businessId, 180),
    customerName: trimmed(draft.customerName),
    customerPhone: trimmed(draft.customerPhone, 40),
    customerEmail: trimmed(draft.customerEmail, 180).toLowerCase(),
    carMake: trimmed(draft.carMake, 80),
    carModel: trimmed(draft.carModel, 80),
    carYear: trimmed(draft.carYear, 8),
    vinNumber: trimmed(draft.vinNumber, 17).toUpperCase(),
    startDate: `${trimmed(draft.startDate, 60)}T12:00:00`,
    endDate: `${trimmed(draft.endDate, 60)}T12:00:00`,
    paymentMethod: trimmed(draft.paymentMethod, 40),
  };
}

/** What the callable answers with. */
export type BusinessParkingEntryResult = {
  entryId: string;
  trackingCode: string;
  paymentMethod: string;
  amountDue: number;
  amountDueCents: number;
  platformFeeCents: number;
  paymentStatus: string;
  checkoutUrl: string;
  checkoutSessionId: string;
};

/**
 * Reads the callable's response defensively: a missing checkoutUrl on the
 * payment-link path must surface as "no link" in the UI, never as `undefined`
 * rendered into a copy button.
 *
 * @param data The callable's `.data`.
 * @return A fully-populated result.
 */
export function businessParkingEntryResult(data: unknown): BusinessParkingEntryResult {
  const row = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const cents = Math.max(0, Math.round(Number(row.amountDueCents ?? 0) || 0));
  return {
    entryId: trimmed(row.entryId ?? row.reservationId, 180),
    trackingCode: trimmed(row.trackingCode, 60),
    paymentMethod: trimmed(row.paymentMethod, 40),
    amountDue: Number.isFinite(Number(row.amountDue)) ? Number(row.amountDue) : cents / 100,
    amountDueCents: cents,
    platformFeeCents: Math.max(0, Math.round(Number(row.platformFeeCents ?? 0) || 0)),
    paymentStatus: trimmed(row.paymentStatus, 40),
    checkoutUrl: trimmed(row.checkoutUrl, 2048),
    checkoutSessionId: trimmed(row.checkoutSessionId, 180),
  };
}

type ParkingRowLike = Record<string, unknown>;

/**
 * Is this a walk-up the lot entered itself, rather than a customer booking?
 *
 * @param row A parkedCars document.
 * @return True when the business created it.
 */
export function isBusinessEnteredParking(row: ParkingRowLike) {
  return trimmed(row?.source, 40) === "business" || row?.enteredByBusiness === true;
}

/**
 * Whether "Mark payment received" applies. Mirrors the server's refusals so
 * the button is absent rather than present-and-rejected: a payment_link entry
 * is Stripe's to settle, and a paid entry must not invite a second marking.
 *
 * @param row A parkedCars document.
 * @return True when the action is available.
 */
export function canMarkBusinessParkingPaid(row: ParkingRowLike) {
  if (!isBusinessEnteredParking(row)) return false;
  if (trimmed(row?.paymentMethod, 40) !== "direct") return false;
  if (trimmed(row?.status, 40) === "cancelled") return false;
  return trimmed(row?.paymentStatus, 40) === "awaiting_direct_payment";
}

/**
 * The amount a business-entered row recorded, in dollars. Direct entries are
 * recorded and never billed, so this is what the lot is owed — not what the
 * platform collected.
 *
 * @param row A parkedCars document.
 * @return Dollars.
 */
export function businessParkingAmountDue(row: ParkingRowLike) {
  const cents = Number(row?.amountDueCents ?? row?.totalCostCents);
  if (Number.isFinite(cents) && cents > 0) return Math.round(cents) / 100;
  const dollars = Number(row?.amountDue ?? row?.totalCost);
  return Number.isFinite(dollars) ? dollars : 0;
}

/**
 * Whether a business-entered row has been paid, is still owed, or has
 * nothing to collect. The long label reads the same weight as every other
 * field on the card, so a lot scanning a wall of parked cars could not tell
 * paid from unpaid at a glance - this drives a coloured badge instead.
 *
 * @param row A parkedCars document.
 * @return "paid", "awaiting", or "none".
 */
export function businessParkingPaymentTone(
  row: ParkingRowLike,
): "paid" | "awaiting" | "none" {
  if (!isBusinessEnteredParking(row)) return "none";
  const paymentStatus = trimmed(row?.paymentStatus, 40);
  if (paymentStatus === "succeeded" || paymentStatus === "paid") return "paid";
  if (paymentStatus === "not_required") return "none";
  if (trimmed(row?.status, 40) === "cancelled") return "none";
  return "awaiting";
}

/** Two-word badge text for the payment state: what a lot scans for. */
export function businessParkingPaymentBadge(row: ParkingRowLike) {
  const tone = businessParkingPaymentTone(row);
  if (tone === "paid") return "Paid";
  if (tone === "awaiting") return "Not paid";
  return "";
}

/** English label for a business-entered row's payment state. */
export function businessParkingPaymentLabel(row: ParkingRowLike) {
  if (!isBusinessEnteredParking(row)) return "";
  const method = trimmed(row?.paymentMethod, 40);
  const paymentStatus = trimmed(row?.paymentStatus, 40);
  if (method === "payment_link") {
    if (paymentStatus === "succeeded" || paymentStatus === "paid") return "Payment link paid";
    return "Payment link sent";
  }
  if (paymentStatus === "paid") return "Paid to the business";
  if (paymentStatus === "not_required") return "Nothing to collect";
  return "Awaiting payment to the business";
}
