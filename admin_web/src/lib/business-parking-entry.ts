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
    ...businessParkingUpdateChanges(draft),
  };
}

/**
 * The `changes` object for `updateBusinessParkingEntry`.
 *
 * Deliberately the same field shapes and the same midday clock as creation —
 * one convention, one place, so an edit cannot roll a parking window back a
 * day that creation would have kept. The amount is deliberately absent: the
 * server recomputes it from the business's parking rates, and a client that
 * could send one could rewrite the price of a stay it had already quoted.
 *
 * @param draft The validated draft.
 * @return The `changes` object `updateBusinessParkingEntry` expects.
 */
export function businessParkingUpdateChanges(draft: BusinessParkingEntryDraft) {
  return {
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

/** What `updateBusinessParkingEntry` answers with. */
export type BusinessParkingUpdateResult = {
  entryId: string;
  paymentMethod: string;
  amountDueCents: number;
  /** The link was reissued at a new amount and re-sent to the customer. */
  relinked: boolean;
  paymentLinkUrl: string;
  emailed: boolean;
  texted: boolean;
};

/**
 * Reads the update callable's response defensively. `relinked` is the one
 * flag staff must never miss: it means the customer is now holding a link for
 * a different amount than the one they were quoted.
 *
 * @param data The callable's `.data`.
 * @return A fully-populated result.
 */
export function businessParkingUpdateResult(data: unknown): BusinessParkingUpdateResult {
  const row = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  return {
    entryId: trimmed(row.entryId, 180),
    paymentMethod: trimmed(row.paymentMethod, 40),
    amountDueCents: Math.max(0, Math.round(Number(row.amountDueCents ?? 0) || 0)),
    relinked: row.relinked === true,
    paymentLinkUrl: trimmed(row.paymentLinkUrl, 2048),
    emailed: row.emailed === true,
    texted: row.texted === true,
  };
}

/**
 * What to tell the staff member after a re-send. The channels matter: a lot
 * that reads "re-sent" and assumes a text went out will stop chasing a
 * customer who only has an email on file — and the callable reports exactly
 * which ones it reached.
 *
 * @param emailed Whether the link went out by email.
 * @param texted Whether the link went out by SMS.
 * @return A sentence for the row message.
 */
export function businessParkingResendMessage(emailed: boolean, texted: boolean) {
  if (emailed && texted) return "Payment link re-sent by email and text.";
  if (emailed) return "Payment link re-sent by email.";
  if (texted) return "Payment link re-sent by text.";
  // Neither channel went out. This used to report "Payment link re-sent.",
  // which sent staff away believing the customer was holding a link nobody had
  // sent them - the one case where saying nothing would have been safer than
  // what it said. A customer with no email and no phone on file lands here.
  return "Nobody was contacted: this customer has no email address or phone " +
    "number on file. Add one, then re-send.";
}

/**
 * Whether a record may still have its link re-sent or cancelled. Paid money
 * has nothing left to collect, and a cancelled link must not quietly come
 * back to life through a re-send.
 *
 * @param row A parkedCars document.
 * @return True when the link is still live.
 */
export function canResendBusinessParkingLink(row: ParkingRowLike) {
  if (businessParkingPaymentTone(row) === "paid") return false;
  return !row?.paymentLinkCancelledAt;
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

/**
 * Which printable document a record produces. Mirrors the server rule in
 * functions/parking_document.js: the document follows the MONEY, not the
 * badge. The badge tone reports "none" for a cancelled record even when it
 * was paid, so keying the label off the tone would print "Invoice" on a card
 * whose served document is headed "Receipt".
 *
 * @param row A parkedCars document.
 * @return "receipt" when the money arrived, otherwise "invoice".
 */
export function businessParkingDocumentType(row: ParkingRowLike): "receipt" | "invoice" {
  const paymentStatus = trimmed(row?.paymentStatus, 40);
  return paymentStatus === "succeeded" || paymentStatus === "paid" ? "receipt" : "invoice";
}

/**
 * "Ends" while the car is still due to sit there, "Ended" once the date has
 * passed. A future date labelled "Ended" reads as though the parking is over
 * when the car is still in the lot.
 *
 * @param row A parkedCars document.
 * @param now Injected so the boundary is testable.
 * @return The label for the end-date field.
 */
export function businessParkingEndLabel(row: ParkingRowLike, now: Date = new Date()) {
  const raw = (row as { parkingEndDate?: unknown })?.parkingEndDate;
  const end = toDateOrNull(raw);
  if (!end) return "Ends";
  // Compare whole days: a parking that ends today has not ended yet.
  const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return endDay < today ? "Ended" : "Ends";
}

function toDateOrNull(value: unknown): Date | null {
  if (!value) return null;
  const candidate = value as { toDate?: () => Date; seconds?: number };
  if (typeof candidate.toDate === "function") {
    try {
      return candidate.toDate();
    } catch {
      return null;
    }
  }
  if (value instanceof Date) return value;
  if (typeof candidate.seconds === "number") return new Date(candidate.seconds * 1000);
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/**
 * Whether a parking OVERLAPS a date window.
 *
 * "Cars parked between the 10th and the 15th" means every car sitting in the
 * lot during that window - including one that arrived on the 5th and leaves
 * on the 20th. Matching only parkings fully contained in the range would hide
 * exactly the long stays a lot most needs to see.
 *
 * An open-ended bound is treated as "no bound on that side", so a business can
 * ask "everything from the 10th onwards" by filling one field.
 *
 * @param row A parkedCars document.
 * @param from Inclusive start, "yyyy-mm-dd" or "" for none.
 * @param to Inclusive end, "yyyy-mm-dd" or "" for none.
 * @return True when the parking is present at any point in the window.
 */
export function businessParkingWithinRange(
  row: ParkingRowLike,
  from: string,
  to: string,
): boolean {
  const fromDay = trimmed(from, 10);
  const toDay = trimmed(to, 10);
  if (!fromDay && !toDay) return true;

  const start = toDayString(toDateOrNull((row as { parkingDate?: unknown })?.parkingDate));
  const end = toDayString(toDateOrNull((row as { parkingEndDate?: unknown })?.parkingEndDate));
  // A record with no dates at all cannot be placed in time; excluding it is
  // the honest answer to "what was parked that week".
  if (!start && !end) return false;

  // A missing bound is genuinely unbounded on that side. No end recorded
  // means the car has not left, so it is still in the lot today and must
  // show up in a window after its arrival - collapsing it onto its start day
  // would hide exactly the car a lot is most likely to be looking for.
  if (toDay && start && start > toDay) return false;
  if (fromDay && end && end < fromDay) return false;
  return true;
}

function toDayString(date: Date | null): string {
  if (!date) return "";
  return date.toISOString().slice(0, 10);
}
