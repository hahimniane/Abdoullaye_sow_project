import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  BUSINESS_PARKING_ENTRY_MESSAGES,
  BUSINESS_PARKING_RECEIVED_VIA_OPTIONS,
  businessParkingAmountDue,
  businessParkingEntryMessage,
  businessParkingEntryPayload,
  businessParkingEntryResult,
  businessParkingPaymentLabel,
  canMarkBusinessParkingPaid,
  emptyBusinessParkingEntryDraft,
  isBusinessEnteredParking,
  validateBusinessParkingEntryDraft,
  type BusinessParkingEntryDraft,
} from "./business-parking-entry.ts";
import { TEXT_TRANSLATIONS } from "./french-dom.ts";

const validDraft: BusinessParkingEntryDraft = {
  customerName: "Aissatou Diallo",
  customerPhone: "+1 917 555 0102",
  customerEmail: "",
  carMake: "Toyota",
  carModel: "Camry",
  carYear: "2019",
  vinNumber: "1hgcm82633a004352",
  startDate: "2026-08-10",
  endDate: "2026-08-20",
  paymentMethod: "direct",
};

test("a complete walk-up entry has nothing to object to", () => {
  assert.deepEqual(validateBusinessParkingEntryDraft(validDraft, "biz-1"), []);
  assert.equal(businessParkingEntryMessage([]), "");
});

test("an empty draft reports every problem at once, not just the first", () => {
  const errors = validateBusinessParkingEntryDraft(emptyBusinessParkingEntryDraft, "biz-1");
  assert.deepEqual(errors, [
    "customer_name_required",
    "customer_phone_required",
    "car_make_required",
    "car_model_required",
    "car_year_required",
    "start_date_required",
    "end_date_required",
  ]);
});

test("email is optional, but a malformed one is refused", () => {
  assert.deepEqual(
    validateBusinessParkingEntryDraft({ ...validDraft, customerEmail: "" }, "biz-1"),
    [],
  );
  assert.deepEqual(
    validateBusinessParkingEntryDraft({ ...validDraft, customerEmail: "aissatou@" }, "biz-1"),
    ["customer_email_invalid"],
  );
});

test("a payment link with no phone and no email has nowhere to go", () => {
  assert.deepEqual(
    validateBusinessParkingEntryDraft(
      { ...validDraft, paymentMethod: "payment_link", customerPhone: "  ", customerEmail: "" },
      "biz-1",
    ),
    ["customer_phone_required", "payment_link_contact_required"],
  );
  // An email alone still reaches the customer, so only the phone is missing.
  assert.deepEqual(
    validateBusinessParkingEntryDraft(
      { ...validDraft, paymentMethod: "payment_link", customerPhone: "", customerEmail: "a@b.co" },
      "biz-1",
    ),
    ["customer_phone_required"],
  );
});

test("the parking window has to make sense", () => {
  assert.deepEqual(
    validateBusinessParkingEntryDraft({ ...validDraft, endDate: "2026-08-01" }, "biz-1"),
    ["end_date_before_start_date"],
  );
  assert.deepEqual(
    validateBusinessParkingEntryDraft({ ...validDraft, carYear: "1899" }, "biz-1"),
    ["car_year_invalid"],
  );
  assert.deepEqual(
    validateBusinessParkingEntryDraft({ ...validDraft, carYear: "20x9" }, "biz-1"),
    ["car_year_invalid"],
  );
});

test("an unscoped console cannot record a car against nobody", () => {
  assert.deepEqual(validateBusinessParkingEntryDraft(validDraft, ""), ["business_required"]);
});

test("every error code has a sentence, and the sentence is what the form shows", () => {
  const errors = validateBusinessParkingEntryDraft(emptyBusinessParkingEntryDraft, "biz-1");
  for (const code of errors) {
    assert.ok(BUSINESS_PARKING_ENTRY_MESSAGES[code], `${code} needs copy`);
  }
  assert.match(businessParkingEntryMessage(errors), /Enter the customer's name\./);
});

test("the payload matches what the callable declares", () => {
  const payload = businessParkingEntryPayload(validDraft, " biz-1 ");
  assert.deepEqual(payload, {
    businessId: "biz-1",
    customerName: "Aissatou Diallo",
    customerPhone: "+1 917 555 0102",
    customerEmail: "",
    carMake: "Toyota",
    carModel: "Camry",
    carYear: "2019",
    vinNumber: "1HGCM82633A004352",
    // Midday, so a timezone west of UTC cannot roll the billed window back a
    // whole day on the server's `new Date(...)`.
    startDate: "2026-08-10T12:00:00",
    endDate: "2026-08-20T12:00:00",
    paymentMethod: "direct",
  });
});

test("the response is read defensively so no undefined reaches a copy button", () => {
  const empty = businessParkingEntryResult(undefined);
  assert.equal(empty.checkoutUrl, "");
  assert.equal(empty.trackingCode, "");
  assert.equal(empty.amountDueCents, 0);

  const linked = businessParkingEntryResult({
    entryId: "entry-1",
    trackingCode: "PK-4T2K9M",
    paymentMethod: "payment_link",
    amountDue: 84.5,
    amountDueCents: 8450,
    platformFeeCents: 845,
    paymentStatus: "pending",
    checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_1",
    checkoutSessionId: "cs_test_1",
  });
  assert.equal(linked.trackingCode, "PK-4T2K9M");
  assert.equal(linked.amountDue, 84.5);
  assert.equal(linked.checkoutUrl, "https://checkout.stripe.com/c/pay/cs_test_1");
});

test("mark-paid is offered exactly where the server would accept it", () => {
  const direct = {
    source: "business",
    paymentMethod: "direct",
    status: "reserved",
    paymentStatus: "awaiting_direct_payment",
  };
  assert.equal(canMarkBusinessParkingPaid(direct), true);
  // Stripe owns a payment-link record's payment status.
  assert.equal(canMarkBusinessParkingPaid({ ...direct, paymentMethod: "payment_link" }), false);
  // Already paid must not invite a second marking.
  assert.equal(canMarkBusinessParkingPaid({ ...direct, paymentStatus: "paid" }), false);
  assert.equal(canMarkBusinessParkingPaid({ ...direct, status: "cancelled" }), false);
  // A customer's own booking is not a business entry at all.
  assert.equal(canMarkBusinessParkingPaid({ ...direct, source: "customer" }), false);
  assert.equal(isBusinessEnteredParking({ enteredByBusiness: true }), true);
  assert.equal(isBusinessEnteredParking({}), false);
});

test("the recorded amount prefers cents and never renders NaN", () => {
  assert.equal(businessParkingAmountDue({ amountDueCents: 8450 }), 84.5);
  assert.equal(businessParkingAmountDue({ totalCostCents: 1200 }), 12);
  assert.equal(businessParkingAmountDue({ totalCost: 40 }), 40);
  assert.equal(businessParkingAmountDue({}), 0);
});

test("the payment label says who is collecting, and whether they have", () => {
  assert.equal(
    businessParkingPaymentLabel({ source: "business", paymentMethod: "direct", paymentStatus: "awaiting_direct_payment" }),
    "Awaiting payment to the business",
  );
  assert.equal(
    businessParkingPaymentLabel({ source: "business", paymentMethod: "direct", paymentStatus: "paid" }),
    "Paid to the business",
  );
  assert.equal(
    businessParkingPaymentLabel({ source: "business", paymentMethod: "payment_link", paymentStatus: "succeeded" }),
    "Payment link paid",
  );
  assert.equal(businessParkingPaymentLabel({ source: "customer" }), "");
});

test("every string this module renders is translated to French", () => {
  const strings = [
    ...Object.values(BUSINESS_PARKING_ENTRY_MESSAGES),
    ...BUSINESS_PARKING_RECEIVED_VIA_OPTIONS.map((option) => option.label),
    "Awaiting payment to the business",
    "Paid to the business",
    "Payment link sent",
    "Payment link paid",
    "Nothing to collect",
  ];
  for (const value of strings) {
    // Proper nouns that are identical in both languages are deliberately
    // absent from the dictionary — adding an identity entry would break the
    // convergence guarantee french-dom.test.ts enforces.
    if (value === "Cash App" || value === "Venmo") continue;
    assert.ok(TEXT_TRANSLATIONS[value], `missing French for: ${value}`);
  }
});

const panelSource = readFileSync("src/components/business/operations-panels.tsx", "utf8");

test("the parking panel records walk-ups through the callable, not a raw write", () => {
  assert.match(panelSource, /"createBusinessParkingEntry"/);
  assert.match(panelSource, /"markBusinessParkingPaid"/);
  assert.match(panelSource, /entryId: row\.id/);
  assert.match(panelSource, /Record a parked car/);
  assert.match(panelSource, /Customer pays us directly \(Zelle\/cash\)/);
  assert.match(panelSource, /Send the customer a payment link/);
});

test("marking money received goes through the shared confirmation, awaited", () => {
  const start = panelSource.indexOf("async function markPaid(");
  assert.ok(start >= 0, "markPaid must exist");
  const markPaid = panelSource.slice(start, start + 1400);
  assert.match(markPaid, /const confirmed = await confirmImportantAction\(/);
  assert.match(markPaid, /if \(!confirmed\) return;/);
});

test("the walk-up form uses catalog pickers for make, model and year", () => {
  const entryForm = panelSource.slice(
    panelSource.indexOf("{entryOpen && ("),
    panelSource.indexOf("// What kind of record this is"),
  );
  assert.ok(entryForm.length > 0, "the entry modal must exist");
  for (const pattern of [/getMakes\(\)/, /getModels\(entryDraft\.carMake\)/, /getYears\(entryDraft\.carMake, entryDraft\.carModel\)/]) {
    assert.match(entryForm, pattern);
  }
  // Cascading pickers must clear their dependents or the form keeps an
  // impossible make/model/year combination.
  assert.match(entryForm, /carMake: event\.target\.value, carModel: "", carYear: ""/);
  assert.match(entryForm, /carModel: event\.target\.value, carYear: ""/);
  // No free-text car input may exist in this form.
  assert.ok(!/carMake: event\.target\.value\s*\}\)\)\}\s*placeholder/.test(entryForm));
});
