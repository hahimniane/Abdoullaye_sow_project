"use strict";

/**
 * Business-entered parking (docs/PLAN-2026-08-backlog.md item 5).
 *
 * Until now a parking record could only be created by a signed-in CUSTOMER,
 * whose card was charged on the spot. A lot also takes walk-ups, and the
 * owner settled how those are handled:
 *
 * - **No customer account is required.** The entry lives under the business
 *   with its tracking code and deliberately has no `customerUid` - a walk-up
 *   must not be blocked at the door by a sign-up.
 * - **direct** (Zelle, cash, ...): the platform RECORDS what is owed and
 *   never bills it. No Stripe object is created and the platform takes no
 *   cut; the business marks the money received itself.
 * - **payment_link**: the platform bills the customer through a hosted
 *   Stripe Checkout Session, and the platform's cut comes from the existing
 *   commission machinery (`parkingPlatformFeePct` resolved by
 *   `servicePlatformFeePctForBusiness` + `servicePayoutFields`). No new fee
 *   mechanism, no hardcoded percentage.
 *
 * This module is pure: it validates the business's input and decides which
 * statuses, amounts and payout fields each payment method produces, plus the
 * idempotent "mark a direct payment received" transition. Every Firestore,
 * Stripe and pricing call stays with the caller - the price itself is still
 * computed by `parkingEstimateCents` in index.js, exactly as the customer
 * path computes it, and arrives here as `totalCents`.
 */

const BUSINESS_PARKING_PAYMENT_METHODS = Object.freeze([
  "direct",
  "payment_link",
]);

/** Marks the record as entered by the lot rather than by a customer. */
const BUSINESS_PARKING_SOURCE = "business";

/**
 * Payment-method-neutral statuses.
 *
 * `status` must stay inside index.js' ACTIVE_PARKING_STATUSES, because that
 * set is what makes a record occupy a space. A status the availability check
 * does not recognise would let the lot resell the space the car is sitting
 * in, so "awaiting off-platform payment" is carried by `paymentStatus` (and
 * `paymentMethod`), not by dropping the record out of the active set.
 */
const BUSINESS_PARKING_STATUS = Object.freeze({
  RESERVED: "reserved",
  PENDING_PAYMENT: "pending_payment",
  CANCELLED: "cancelled",
});

const BUSINESS_PARKING_PAYMENT_STATUS = Object.freeze({
  AWAITING_DIRECT: "awaiting_direct_payment",
  PENDING: "pending",
  PAID: "paid",
  SUCCEEDED: "succeeded",
  NOT_REQUIRED: "not_required",
});

/** The Stripe metadata paymentType (and PAYMENT_ROUTES key) for the link. */
const BUSINESS_PARKING_PAYMENT_TYPE = "business_parking_entry";

/**
 * How the business says it received an off-platform payment. Free text here
 * would give us "Zelle", "zelle " and "ZELLE" as three ways a lot was paid,
 * the same dirty-data problem the shared catalogs exist to prevent, so an
 * unrecognised value is recorded as "other" rather than stored verbatim.
 */
const BUSINESS_PARKING_DIRECT_METHODS = Object.freeze([
  "zelle",
  "cash",
  "cashapp",
  "venmo",
  "check",
  "card_in_person",
  "other",
]);

const MAX_TEXT = 200;
const MAX_NOTE = 500;
const MAX_VIN = 17;

/**
 * Mirrors index.js dollarsFromCents so records carry both representations.
 *
 * @param {*} cents Integer cents.
 * @return {number} The same amount in dollars.
 */
const dollars = (cents) => Math.round(Number(cents) || 0) / 100;

const text = (value, max = MAX_TEXT) =>
  String(value === undefined || value === null ? "" : value)
      .trim()
      .slice(0, max);

/**
 * Parses a start/end date without inventing one. A missing or unparseable
 * date is an error, never "today" - a defaulted parking window silently
 * changes what the customer is charged.
 *
 * @param {*} value Raw client value (Date or date string).
 * @return {?Date} The date, or null when absent/invalid.
 */
function parseEntryDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const raw = text(value, 60);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isEmailish(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

/**
 * Validates and normalizes what a business typed in for a walk-up car.
 *
 * Returns every problem it finds rather than the first, so the form can show
 * them all at once (same contract as pickup_plan's normalizers).
 *
 * @param {*} raw The callable payload.
 * @return {{input: ?Object, errors: !Array<string>}} Normalized input, or
 *   null plus every error code.
 */
function normalizeBusinessParkingEntry(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const errors = [];

  const businessId = text(source.businessId, 180);
  if (!businessId) errors.push("business_required");

  const paymentMethod = text(source.paymentMethod, 40);
  if (!BUSINESS_PARKING_PAYMENT_METHODS.includes(paymentMethod)) {
    errors.push("payment_method_invalid");
  }

  const customerName = text(source.customerName);
  if (!customerName) errors.push("customer_name_required");

  const customerPhone = text(source.customerPhone, 40);
  if (!customerPhone) errors.push("customer_phone_required");

  const customerEmail = text(source.customerEmail, 180).toLowerCase();
  if (customerEmail && !isEmailish(customerEmail)) {
    errors.push("customer_email_invalid");
  }
  // The link has to reach someone. Phone is always required, so this only
  // bites when a business clears it - but a payment link nobody receives is
  // a charge that never happens and a space that never frees up.
  if (paymentMethod === "payment_link" && !customerPhone && !customerEmail) {
    errors.push("payment_link_contact_required");
  }

  const carMake = text(source.carMake, 80);
  const carModel = text(source.carModel, 80);
  const carYear = text(source.carYear, 8);
  if (!carMake) errors.push("car_make_required");
  if (!carModel) errors.push("car_model_required");
  if (!carYear) {
    errors.push("car_year_required");
  } else if (!/^\d{4}$/.test(carYear) ||
      Number(carYear) < 1900 || Number(carYear) > 2100) {
    errors.push("car_year_invalid");
  }

  // Not validated beyond shape: the customer path does not validate VINs
  // either, and rejecting an odd one would block a car that is physically
  // already in the lot.
  const vinNumber = text(source.vinNumber, MAX_VIN).toUpperCase();

  const startDate = parseEntryDate(source.startDate);
  const endDate = parseEntryDate(source.endDate);
  if (!startDate) errors.push("start_date_required");
  if (!endDate) errors.push("end_date_required");
  if (startDate && endDate && endDate.getTime() < startDate.getTime()) {
    errors.push("end_date_before_start_date");
  }

  if (errors.length) return {input: null, errors};
  return {
    input: {
      businessId,
      paymentMethod,
      customerName,
      customerPhone,
      customerEmail,
      carMake,
      carModel,
      carYear,
      vinNumber,
      startDate,
      endDate,
    },
    errors,
  };
}

/**
 * Decides what a payment method means: what is recorded, what is billed, and
 * whether the platform creates a Stripe object or takes a cut at all.
 *
 * @param {{paymentMethod: string, totalCents: number,
 *   simulatePayments: (boolean|undefined)}} params The validated method, the
 *   price from parkingEstimateCents, and whether the runtime is in payment
 *   simulation (development only).
 * @return {?Object} The plan, or null for an unknown method.
 */
function businessParkingPaymentPlan({
  paymentMethod,
  totalCents,
  simulatePayments = false,
}) {
  const method = text(paymentMethod, 40);
  if (!BUSINESS_PARKING_PAYMENT_METHODS.includes(method)) return null;

  const amountDueCents = Math.max(0, Math.round(Number(totalCents) || 0));
  const billedByPlatform = method === "payment_link";

  // Nothing to collect: neither path has a payment to wait for, so the entry
  // must not sit in a "pending payment" state forever.
  if (amountDueCents === 0) {
    return Object.freeze({
      paymentMethod: method,
      amountDueCents,
      amountDue: dollars(amountDueCents),
      billedByPlatform,
      createsStripeObject: false,
      takesPlatformCut: false,
      status: BUSINESS_PARKING_STATUS.RESERVED,
      paymentStatus: BUSINESS_PARKING_PAYMENT_STATUS.NOT_REQUIRED,
    });
  }

  if (!billedByPlatform) {
    // Direct/Zelle: recorded, never billed. No Stripe object exists, so
    // there is no charge for a platform fee to come out of.
    return Object.freeze({
      paymentMethod: method,
      amountDueCents,
      amountDue: dollars(amountDueCents),
      billedByPlatform: false,
      createsStripeObject: false,
      takesPlatformCut: false,
      status: BUSINESS_PARKING_STATUS.RESERVED,
      paymentStatus: BUSINESS_PARKING_PAYMENT_STATUS.AWAITING_DIRECT,
    });
  }

  return Object.freeze({
    paymentMethod: method,
    amountDueCents,
    amountDue: dollars(amountDueCents),
    billedByPlatform: true,
    // Simulation never touches Stripe, but the commission is still recorded
    // so a simulated run exercises the same payout arithmetic.
    createsStripeObject: !simulatePayments,
    takesPlatformCut: true,
    status: simulatePayments ?
      BUSINESS_PARKING_STATUS.RESERVED :
      BUSINESS_PARKING_STATUS.PENDING_PAYMENT,
    paymentStatus: simulatePayments ?
      BUSINESS_PARKING_PAYMENT_STATUS.SUCCEEDED :
      BUSINESS_PARKING_PAYMENT_STATUS.PENDING,
  });
}

/**
 * The payout fields a non-billed entry records.
 *
 * Deliberately shaped like servicePayoutFields' output so every reader of a
 * parkedCars document sees the same keys - but with a zero platform fee and
 * a payout status that says "the platform is not moving this money", because
 * it never held it.
 *
 * @param {number} amountDueCents What the customer owes the business.
 * @return {!Object} Payout fields for the direct path.
 */
function directPaymentPayoutFields(amountDueCents) {
  const owed = Math.max(0, Math.round(Number(amountDueCents) || 0));
  return {
    platformFeeCents: 0,
    businessPayoutCents: owed,
    payoutStatus: "not_applicable",
    stripeChargeType: "none",
    stripeConnectedAccountId: "",
  };
}

/**
 * The parkedCars document body for a business-entered car.
 *
 * Note what is NOT here: `customerUid`. A walk-up has no account, and
 * writing an empty string would make the record look like it belongs to a
 * user with an empty uid.
 *
 * @param {{trackingCode: string, input: !Object, plan: !Object,
 *   option: !Object, currency: string}} params The tracking code, normalized
 *   input, payment plan, the resolved parking option (business name, address
 *   and rates, from parkingOptionFromBusiness) and the currency.
 * @return {!Object} Document fields, minus timestamps and payout fields.
 */
function buildBusinessParkingEntryRecord({
  trackingCode,
  input,
  plan,
  option,
  currency,
}) {
  const record = {
    trackingCode: text(trackingCode, 60),
    source: BUSINESS_PARKING_SOURCE,
    enteredByBusiness: true,
    paymentMethod: plan.paymentMethod,
    platformBilled: plan.billedByPlatform,
    customerName: input.customerName,
    ownerName: input.customerName,
    customerPhone: input.customerPhone,
    customerEmail: input.customerEmail,
    carMake: input.carMake,
    carModel: input.carModel,
    carYear: input.carYear,
    vinNumber: input.vinNumber,
    businessId: input.businessId,
    businessName: text(option.businessName),
    parkingCity: text(option.city),
    parkingAddress: text(option.address),
    status: plan.status,
    paymentStatus: plan.paymentStatus,
    totalCost: plan.amountDue,
    totalCostCents: plan.amountDueCents,
    amountDue: plan.amountDue,
    amountDueCents: plan.amountDueCents,
    currency: text(currency, 10).toLowerCase(),
    pickupRequested: false,
    pickupFee: Number(option.pickupFee || 0),
    dailyRate: Number(option.dailyRate || 0),
    weeklyRate: Number(option.weeklyRate || 0),
    monthlyRate: Number(option.monthlyRate || 0),
    minimumDays: Math.max(1, Number(option.minimumDays || 1)),
    instructions: text(option.instructions, MAX_NOTE),
  };
  if (plan.createsStripeObject) {
    // Only a record Stripe actually bills carries a paymentType, so the
    // reconciliation match has something to check it against.
    record.paymentType = BUSINESS_PARKING_PAYMENT_TYPE;
  }
  return record;
}

/**
 * Normalizes how the business says it was paid off-platform.
 *
 * @param {*} value Raw client value.
 * @return {string} One of BUSINESS_PARKING_DIRECT_METHODS.
 */
function normalizeDirectPaymentMethod(value) {
  const normalized = text(value, 40).toLowerCase().replace(/[\s-]+/g, "");
  const match = BUSINESS_PARKING_DIRECT_METHODS.find(
      (name) => name.replace(/_/g, "") === normalized.replace(/_/g, ""),
  );
  return match || "other";
}

/**
 * The transition for "the business received the direct payment".
 *
 * Two things it refuses, both deliberately:
 * - a payment_link entry, because Stripe owns that record's payment status;
 *   letting a business hand-mark it paid would make the platform's books and
 *   Stripe's disagree with no way to tell which is right.
 * - anything already paid is a no-op, not a second application - calling
 *   this twice must not double-record a payment.
 *
 * @param {{entry: !Object, receivedVia: *, note: *, markedByUid: *}} params
 *   The stored record and what the business reported.
 * @return {{ok: boolean, alreadyPaid: boolean, update: ?Object,
 *   reason: (string|undefined), amountPaidCents: (number|undefined)}}
 *   The decision.
 */
function businessParkingPaidUpdate({
  entry,
  receivedVia,
  note,
  markedByUid,
}) {
  const data = entry && typeof entry === "object" ? entry : {};

  if (text(data.source, 40) !== BUSINESS_PARKING_SOURCE) {
    return {ok: false, alreadyPaid: false, update: null,
      reason: "not_a_business_entry"};
  }
  if (text(data.paymentMethod, 40) !== "direct") {
    return {ok: false, alreadyPaid: false, update: null,
      reason: "payment_link_is_stripe_owned"};
  }
  if (text(data.status, 40) === BUSINESS_PARKING_STATUS.CANCELLED) {
    return {ok: false, alreadyPaid: false, update: null,
      reason: "entry_cancelled"};
  }

  const paymentStatus = text(data.paymentStatus, 40);
  const amountPaidCents = Math.max(
      0,
      Math.round(Number(data.amountDueCents ?? data.totalCostCents ?? 0) || 0),
  );

  if (paymentStatus === BUSINESS_PARKING_PAYMENT_STATUS.PAID) {
    return {ok: true, alreadyPaid: true, update: null, amountPaidCents};
  }
  if (paymentStatus !== BUSINESS_PARKING_PAYMENT_STATUS.AWAITING_DIRECT) {
    return {ok: false, alreadyPaid: false, update: null,
      reason: "not_awaiting_direct_payment"};
  }

  return {
    ok: true,
    alreadyPaid: false,
    amountPaidCents,
    update: {
      paymentStatus: BUSINESS_PARKING_PAYMENT_STATUS.PAID,
      status: BUSINESS_PARKING_STATUS.RESERVED,
      directPaymentReceived: true,
      directPaymentMethod: normalizeDirectPaymentMethod(receivedVia),
      directPaymentNote: text(note, MAX_NOTE),
      directPaymentMarkedByUid: text(markedByUid, 180),
      amountPaidCents,
      amountPaid: dollars(amountPaidCents),
      // Restated on the transition so a record that is settled off-platform
      // can never be read as owing the platform a cut.
      ...directPaymentPayoutFields(amountPaidCents),
    },
  };
}

module.exports = {
  BUSINESS_PARKING_DIRECT_METHODS,
  BUSINESS_PARKING_PAYMENT_METHODS,
  BUSINESS_PARKING_PAYMENT_STATUS,
  BUSINESS_PARKING_PAYMENT_TYPE,
  BUSINESS_PARKING_SOURCE,
  BUSINESS_PARKING_STATUS,
  buildBusinessParkingEntryRecord,
  businessParkingPaidUpdate,
  businessParkingPaymentPlan,
  directPaymentPayoutFields,
  normalizeBusinessParkingEntry,
  normalizeDirectPaymentMethod,
};
