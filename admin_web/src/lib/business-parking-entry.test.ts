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
  businessParkingDocumentType,
  businessParkingEndLabel,
  businessParkingWithinRange,
  businessParkingPaymentBadge,
  businessParkingPaymentLabel,
  businessParkingPaymentTone,
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

test("payment tone separates paid, still owed, and nothing to collect", () => {
  const paidLink = { source: "business", paymentMethod: "payment_link", paymentStatus: "succeeded" };
  const sentLink = { source: "business", paymentMethod: "payment_link", paymentStatus: "pending" };
  const paidDirect = { source: "business", paymentMethod: "direct", paymentStatus: "paid" };
  const owedDirect = { source: "business", paymentMethod: "direct", paymentStatus: "awaiting_direct_payment" };

  assert.equal(businessParkingPaymentTone(paidLink), "paid");
  assert.equal(businessParkingPaymentTone(sentLink), "awaiting");
  assert.equal(businessParkingPaymentTone(paidDirect), "paid");
  assert.equal(businessParkingPaymentTone(owedDirect), "awaiting");
  assert.equal(businessParkingPaymentTone({ source: "business", paymentStatus: "not_required" }), "none");
  // A cancelled car is not money the lot is still chasing.
  assert.equal(businessParkingPaymentTone({ source: "business", paymentMethod: "direct", status: "cancelled", paymentStatus: "awaiting_direct_payment" }), "none");
  // Customer-booked reservations are settled by the customer flow.
  assert.equal(businessParkingPaymentTone({ paymentStatus: "succeeded" }), "none");

  assert.equal(businessParkingPaymentBadge(paidLink), "Paid");
  assert.equal(businessParkingPaymentBadge(sentLink), "Not paid");
  assert.equal(businessParkingPaymentBadge({ source: "business", paymentStatus: "not_required" }), "");
});

test("a paid card shows a badge and stops offering the used payment link", () => {
  // The badge sits in the card header beside the parking status, so paid and
  // unpaid are distinguishable without reading a text row.
  assert.match(panelSource, /businessParkingPaymentTone\(row\) === "paid" \? "ok" : "warn"/);
  assert.match(panelSource, /\{businessParkingPaymentBadge\(row\)\}/);
  // And a link that has already been used must not be offered for copying.
  const linkBlock = panelSource.slice(panelSource.indexOf('<span>Payment link</span>'), panelSource.indexOf('Check payment status'));
  assert.match(linkBlock, /businessParkingPaymentTone\(row\) === "paid" \?/);
  assert.match(linkBlock, /This link was already used to pay/);
});

test("a paid record stops offering to check a payment that has landed", () => {
  // The cancel button was already gated this way; the check button asked
  // Stripe about money Stripe had already confirmed.
  const check = panelSource.slice(
    panelSource.indexOf("stuck guessing whether a car has been paid for"),
    panelSource.indexOf('title="Check payment status"'),
  );
  assert.ok(check.length > 0, "the check-status button must exist");
  assert.match(check, /businessParkingPaymentTone\(row\) !== "paid" && \(/);
  // And the row action it fires reports through the self-clearing setter, not
  // the panel's sticky one.
  const checkFn = panelSource.slice(
    panelSource.indexOf("async function checkLinkPayment("),
    panelSource.indexOf("async function openParkingDocument("),
  );
  assert.ok(checkFn.length > 0, "checkLinkPayment must exist");
  assert.match(checkFn, /setRowMessage\(/);
  assert.ok(!/\bsetMessage\(/.test(checkFn), "row results must not stick in the header");
});

test("row results expire; the timer is cleared before reuse and on unmount", () => {
  const hook = panelSource.slice(
    panelSource.indexOf("function useTransientMessage("),
    panelSource.indexOf("export function ParkingPanel("),
  );
  assert.ok(hook.length > 0, "the transient-message helper must exist");
  assert.match(hook, /window\.clearTimeout\(timer\.current\)/);
  assert.match(hook, /window\.setTimeout\(/);
  assert.match(hook, /useEffect\(/);
  // Every row action in the parking panel uses it.
  for (const fn of ["markPaid", "cancelPaymentLink", "checkLinkPayment"]) {
    const body = panelSource.slice(panelSource.indexOf(`async function ${fn}(`), panelSource.indexOf(`async function ${fn}(`) + 1600);
    assert.match(body, /setRowMessage\(/, `${fn} must report transiently`);
  }
});

test("the parking filter asks about payment as well as parking status", () => {
  assert.match(panelSource, /<optgroup label="Parking status">/);
  assert.match(panelSource, /<optgroup label="Payment">/);
  assert.match(panelSource, /<option value="payment:paid">Paid<\/option>/);
  assert.match(panelSource, /<option value="payment:unpaid">Not paid<\/option>/);
  // And the values are honoured by the same memo that filters by status.
  const memo = panelSource.slice(
    panelSource.indexOf("const filteredRows = useMemo("),
    panelSource.indexOf("const activeCount = parkedCars.rows"),
  );
  assert.ok(memo.length > 0, "the filter memo must exist");
  assert.match(memo, /filter === "payment:paid"/);
  assert.match(memo, /filter === "payment:unpaid"/);
  assert.match(memo, /businessParkingPaymentTone\(row\) === "paid"/);
  assert.match(memo, /businessParkingPaymentTone\(row\) === "awaiting"/);
  assert.match(memo, /text\(row\.status, ""\) === filter/);
});

test("every business-entered card can print its own paper", () => {
  assert.match(panelSource, /"getParkingDocumentUrl"/);
  const openStart = panelSource.indexOf("async function openParkingDocument(");
  const open = openStart < 0 ? "" : panelSource.slice(openStart, openStart + 1800);
  assert.ok(open.length > 0, "openParkingDocument must exist");
  assert.match(open, /httpsCallable\(\s*functions,\s*"getParkingDocumentUrl",?\s*\)\(\{entryId: row\.id\}\)/);
  assert.match(open, /window\.open\(url, "_blank", "noopener"\)/);
  // A popup blocker returns null; the owner must still be able to reach it.
  assert.match(open, /if \(!opened\)/);
  assert.match(open, /setBlockedDocument\(\{id: row\.id, url\}\)/);
  assert.match(open, /Allow pop-ups for this site/);
  // The label follows the money: receipt once paid, invoice while owed.
  assert.match(panelSource, /\? "Print receipt"\s*\n?\s*: "Print invoice"/);
  assert.match(panelSource, /href=\{blockedDocument\.url\}/);
});

test("every new parked-car string is translated to French", () => {
  for (const value of [
    "Parking status",
    "Payment",
    "Paid",
    "Not paid",
    "Print receipt",
    "Print invoice",
    "Preparing...",
    "Open the document",
    "The document could not be prepared.",
    "The document is not ready yet. Try again in a moment.",
    "Your browser blocked the document window. Allow pop-ups for this site, or use the link on the card.",
  ]) {
    assert.ok(TEXT_TRANSLATIONS[value], `missing French for: ${value}`);
  }
});

test("the browser-write parking form cannot create records or edit paid ones", () => {
  // "New parking" wrote a parkedCars doc straight from the client: it faked a
  // PC-xxxxxx tracking code, set no amountDueCents and no payment plan, and
  // skipped the space check - producing rows the payment system could never
  // settle. Creation must go through createBusinessParkingEntry only.
  // The label only survives inside the comment explaining its removal.
  assert.ok(!/> New parking</.test(panelSource), "the New parking button must not come back");
  assert.ok(!/"New parking"/.test(panelSource.replace(/\/\*[\s\S]*?\*\//g, "")), "no New parking title outside the comment");
  assert.ok(!/function openNew\(\)[\s\S]{0,120}setFormOpen\(true\)/.test(
    panelSource.slice(panelSource.indexOf("const activeCount = parkedCars.rows")),
  ), "the parking panel must not reopen a blank create form");

  // A paid record's money has moved; editing rewrites a completed sale.
  const save = panelSource.slice(panelSource.indexOf("async function saveParking("), panelSource.indexOf("async function saveParking(") + 1400);
  assert.match(save, /businessParkingPaymentTone\(existing\) === "paid"/);
  assert.match(save, /can no longer be edited/);
  // And a link entry's amount is already baked into the customer's session.
  assert.match(save, /payment_link/);
  assert.match(save, /cannot be changed/);
  assert.match(panelSource, /Paid records cannot be edited/);
});

test("the printable document follows the money, not the badge", () => {
  // A parking cancelled after the customer paid: the badge has nothing left
  // to chase, but the money still earns a receipt — and the server
  // (functions/parking_document.js) serves one. Keying the button off the
  // badge would label it "Invoice" over a document headed "Receipt".
  const cancelledButPaid = {
    source: "business",
    status: "cancelled",
    paymentMethod: "payment_link",
    paymentStatus: "succeeded",
  };
  // Both clients read this the same way: money that arrived is a fact the
  // cancellation does not undo.
  assert.equal(businessParkingPaymentTone(cancelledButPaid), "paid");
  assert.equal(businessParkingDocumentType(cancelledButPaid), "receipt");

  assert.equal(businessParkingDocumentType({ paymentStatus: "paid" }), "receipt");
  assert.equal(businessParkingDocumentType({ paymentStatus: "pending" }), "invoice");
  assert.equal(businessParkingDocumentType({}), "invoice");

  // And the button must read from that rule, not from the tone.
  assert.match(panelSource, /businessParkingDocumentType\(row\) === "receipt"\s*\n?\s*\? "Print receipt"/);
});

test("a parking that has not finished says Ends, not Ended", () => {
  const now = new Date("2026-08-06T12:00:00Z");
  // The owner's report: a card showed "Ended Aug 21, 2026" while the car was
  // still sitting in the lot.
  assert.equal(businessParkingEndLabel({ parkingEndDate: "2026-08-21T12:00:00Z" }, now), "Ends");
  assert.equal(businessParkingEndLabel({ parkingEndDate: "2026-08-01T12:00:00Z" }, now), "Ended");
  // The last day still counts as parked.
  assert.equal(businessParkingEndLabel({ parkingEndDate: "2026-08-06T23:00:00Z" }, now), "Ends");
  // Firestore hands back Timestamps, not strings.
  assert.equal(
    businessParkingEndLabel({ parkingEndDate: { toDate: () => new Date("2026-08-21T12:00:00Z") } }, now),
    "Ends",
  );
  assert.equal(businessParkingEndLabel({}, now), "Ends");
  assert.match(panelSource, /businessParkingEndLabel\(row\)/);
});

test("the date window matches cars present during it, not only those inside it", () => {
  const car = (start: string, end: string) => ({ parkingDate: start, parkingEndDate: end });
  // A long stay spanning the whole window is exactly what a lot needs to see.
  assert.equal(businessParkingWithinRange(car("2026-08-01", "2026-08-30"), "2026-08-10", "2026-08-15"), true);
  assert.equal(businessParkingWithinRange(car("2026-08-11", "2026-08-12"), "2026-08-10", "2026-08-15"), true);
  // Touching the boundary counts.
  assert.equal(businessParkingWithinRange(car("2026-08-15", "2026-08-20"), "2026-08-10", "2026-08-15"), true);
  assert.equal(businessParkingWithinRange(car("2026-08-01", "2026-08-10"), "2026-08-10", "2026-08-15"), true);
  // Wholly outside, both sides.
  assert.equal(businessParkingWithinRange(car("2026-07-01", "2026-07-20"), "2026-08-10", "2026-08-15"), false);
  assert.equal(businessParkingWithinRange(car("2026-09-01", "2026-09-20"), "2026-08-10", "2026-08-15"), false);
  // One-sided windows: "from the 10th onwards", "up to the 15th".
  assert.equal(businessParkingWithinRange(car("2026-09-01", "2026-09-05"), "2026-08-10", ""), true);
  assert.equal(businessParkingWithinRange(car("2026-07-01", "2026-07-05"), "2026-08-10", ""), false);
  assert.equal(businessParkingWithinRange(car("2026-07-01", "2026-07-05"), "", "2026-08-15"), true);
  // No window means no narrowing.
  assert.equal(businessParkingWithinRange(car("2026-07-01", "2026-07-05"), "", ""), true);
  // Firestore Timestamps, and a still-parked car with no end date.
  assert.equal(
    businessParkingWithinRange(
      { parkingDate: { toDate: () => new Date("2026-08-12T00:00:00Z") }, parkingEndDate: null },
      "2026-08-10", "2026-08-15",
    ),
    true,
  );
  // A record with no dates cannot honestly be placed in a week.
  assert.equal(businessParkingWithinRange({}, "2026-08-10", "2026-08-15"), false);
  assert.match(panelSource, /businessParkingWithinRange\(row, rangeFrom, rangeTo\)/);
});
