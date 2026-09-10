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
  businessParkingStayDays,
  businessParkingWithinRange,
  businessParkingPaymentBadge,
  businessParkingPaymentLabel,
  businessParkingPaymentTone,
  businessParkingResendMessage,
  businessParkingUpdateChanges,
  businessParkingUpdateResult,
  canMarkBusinessParkingPaid,
  canResendBusinessParkingLink,
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
  ]);
});

test("the leave date is optional: an open-ended stay is not an error", () => {
  // A stay with no end keeps accruing at the daily rate until it is billed
  // or closed, so the entry form must accept it.
  const errors = validateBusinessParkingEntryDraft(
    { ...validDraft, endDate: "" },
    "biz-1",
  );
  assert.deepEqual(errors, []);
  // An end that predates the start is still wrong.
  assert.deepEqual(
    validateBusinessParkingEntryDraft(
      { ...validDraft, startDate: "2026-08-10", endDate: "2026-08-01" },
      "biz-1",
    ),
    ["end_date_before_start_date"],
  );
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
  assert.match(panelSource, /Paid records cannot be edited/);
});

const saveParkingSource = panelSource.slice(
  panelSource.indexOf("async function saveParking("),
  panelSource.indexOf("async function updateParkingStatus("),
);
const editFormSource = panelSource.slice(
  panelSource.indexOf("<h3>Edit parking</h3>"),
  panelSource.indexOf("{entryOpen && ("),
);

test("editing a parking goes through the callable, never a browser write", () => {
  assert.ok(saveParkingSource.length > 0, "saveParking must exist");
  assert.match(saveParkingSource, /"updateBusinessParkingEntry"/);
  assert.match(saveParkingSource, /entryId: draft\.id/);
  assert.match(saveParkingSource, /changes: businessParkingUpdateChanges\(/);
  // The old path wrote parkedCars straight from the browser: it could move the
  // dates a stay is billed on while the amount stayed frozen, so the record's
  // price and the days it covered stopped agreeing. Nothing in this function
  // may write a document again.
  assert.ok(!/setDoc\(/.test(saveParkingSource), "saveParking must not write Firestore directly");
  assert.ok(!/Timestamp\.fromDate\(/.test(saveParkingSource), "no client-built parking timestamps");
  assert.ok(!/trackingCode:/.test(saveParkingSource), "tracking codes are the server's to issue");
  // Status is not the callable's field, so it keeps the path that owned it.
  assert.match(saveParkingSource, /updateParkingStatus\(existing, draft\.status\)/);
  // A reissued link is the outcome staff must not miss.
  assert.match(saveParkingSource, /result\.relinked/);
  assert.match(saveParkingSource, /a new payment link was issued and the customer was notified/);
});

test("the edit form takes contact, both dates and the payment method - and no amount", () => {
  assert.ok(editFormSource.length > 0, "the parking edit modal must exist");
  for (const field of [
    /customerEmail: event\.target\.value/,
    /customerPhone: event\.target\.value/,
    /startDate: event\.target\.value/,
    /endDate: event\.target\.value/,
    /paymentMethod: event\.target\.value === "payment_link" \? "payment_link" : "direct"/,
  ]) {
    assert.match(editFormSource, field);
  }
  assert.match(editFormSource, /<option value="direct">Direct payment \(Zelle or cash\)<\/option>/);
  assert.match(editFormSource, /<option value="payment_link">Payment link<\/option>/);
  // The catalog pickers stay, cascading clears and all.
  assert.match(editFormSource, /getMakes\(\)/);
  assert.match(editFormSource, /getModels\(draft\.carMake\)/);
  assert.match(editFormSource, /getYears\(draft\.carMake, draft\.carModel\)/);
  // The amount belongs to the server, which recomputes it from the business's
  // parking rates. A price box here would either be ignored or believed.
  assert.ok(!/totalCost/.test(editFormSource), "no amount input may exist in the edit form");
  assert.ok(!/Total cost/.test(editFormSource), "no amount label may exist in the edit form");
  assert.ok(!/amount(Due)?:/.test(editFormSource), "the form must not carry an amount field");
  // The edit is validated by the same rules as the walk-up form.
  assert.match(saveParkingSource, /validateBusinessParkingEntryDraft\(entry, businessId\)/);
  assert.match(editFormSource, /BUSINESS_PARKING_ENTRY_MESSAGES\[code\]/);
});

test("the resend button is offered only while the link is still live", () => {
  const resend = panelSource.slice(
    panelSource.indexOf("async function resendPaymentLink("),
    panelSource.indexOf("async function checkLinkPayment("),
  );
  assert.ok(resend.length > 0, "resendPaymentLink must exist");
  assert.match(resend, /"resendBusinessParkingPaymentLink"/);
  assert.match(resend, /entryId: row\.id/);
  // Row results report transiently, like every other action on the card.
  assert.match(resend, /setRowMessage\(\s*businessParkingResendMessage\(/);
  assert.ok(!/\bsetMessage\(/.test(resend), "row results must not stick in the header");

  // Gated exactly like "Cancel payment link": paid has nothing to collect, and
  // a cancelled link must not be brought back to life by a re-send.
  const button = panelSource.slice(
    panelSource.indexOf("Same gate as Cancel below"),
    panelSource.indexOf('title="Cancel payment link"'),
  );
  assert.ok(button.length > 0, "the resend button must exist");
  assert.match(button, /\{canResendBusinessParkingLink\(row\) && \(/);
  assert.match(button, /onClick=\{\(\) => void resendPaymentLink\(row\)\}/);
  assert.match(button, /Resend link/);

  assert.equal(canResendBusinessParkingLink({ source: "business", paymentMethod: "payment_link", paymentStatus: "pending" }), true);
  assert.equal(canResendBusinessParkingLink({ source: "business", paymentMethod: "payment_link", paymentStatus: "succeeded" }), false);
  assert.equal(
    canResendBusinessParkingLink({ source: "business", paymentMethod: "payment_link", paymentStatus: "pending", paymentLinkCancelledAt: "2026-08-05" }),
    false,
  );
});

test("the update payload keeps the midday clock and carries no amount", () => {
  const changes = businessParkingUpdateChanges({
    ...validDraft,
    customerEmail: "Aissatou@Example.COM",
    paymentMethod: "payment_link",
  });
  assert.deepEqual(changes, {
    customerName: "Aissatou Diallo",
    customerPhone: "+1 917 555 0102",
    customerEmail: "aissatou@example.com",
    carMake: "Toyota",
    carModel: "Camry",
    carYear: "2019",
    vinNumber: "1HGCM82633A004352",
    startDate: "2026-08-10T12:00:00",
    endDate: "2026-08-20T12:00:00",
    paymentMethod: "payment_link",
  });
  // No businessId either: the entry already knows whose lot it is.
  assert.ok(!("businessId" in changes));
  // And creation is still the same object plus the business.
  assert.deepEqual(businessParkingEntryPayload(validDraft, "biz-1"), {
    businessId: "biz-1",
    ...businessParkingUpdateChanges(validDraft),
  });
});

test("the update response is read defensively, and relinked is never assumed", () => {
  const empty = businessParkingUpdateResult(undefined);
  assert.equal(empty.relinked, false);
  assert.equal(empty.amountDueCents, 0);
  assert.equal(empty.paymentLinkUrl, "");

  const relinked = businessParkingUpdateResult({
    success: true,
    entryId: "entry-9",
    paymentMethod: "payment_link",
    amountDueCents: 12000,
    relinked: true,
    paymentLinkUrl: "https://laawol.example/pay/abc",
    emailed: true,
    texted: false,
  });
  assert.equal(relinked.relinked, true);
  assert.equal(relinked.amountDueCents, 12000);
  assert.equal(relinked.emailed, true);
  assert.equal(relinked.texted, false);
  // A truthy-but-not-true value must not read as a reissued link.
  assert.equal(businessParkingUpdateResult({ relinked: "yes" }).relinked, false);
});

test("the re-send message names the channels it actually reached", () => {
  assert.equal(businessParkingResendMessage(true, true), "Payment link re-sent by email and text.");
  assert.equal(businessParkingResendMessage(true, false), "Payment link re-sent by email.");
  assert.equal(businessParkingResendMessage(false, true), "Payment link re-sent by text.");
});

test("re-sending to nobody says so instead of claiming success", () => {
  // The failure that matters: staff walk away believing the customer has a
  // link when no message was sent at all.
  const message = businessParkingResendMessage(false, false);
  assert.match(message, /Nobody was contacted/);
  assert.doesNotMatch(
      message,
      /re-sent/,
      "must not read as a success",
  );
});

test("every string the parking edit and re-send add is translated to French", () => {
  for (const value of [
    "Payment method",
    "Direct payment (Zelle or cash)",
    "Payment link",
    "Resend link",
    "Start date",
    "End date",
    "Customer email",
    "Customer phone",
    "Nobody was contacted: this customer has no email address or phone number on file. Add one, then re-send.",
    "Payment link re-sent by email.",
    "Payment link re-sent by text.",
    "Payment link re-sent by email and text.",
    "The payment link could not be re-sent.",
    "The parking record could not be updated.",
    "Open a parking record to edit it.",
    "This parking has been paid for and can no longer be edited.",
    "The amount changed, so a new payment link was issued and the customer was notified of the new amount.",
    "The amount is recalculated from your parking rates when you save. If it changes on a payment-link parking, we issue a new link and tell the customer.",
  ]) {
    assert.ok(TEXT_TRANSLATIONS[value], `missing French for: ${value}`);
  }
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
  // A null / missing end is now a deliberate open-ended stay.
  assert.equal(businessParkingEndLabel({}, now), "Open-ended");
  assert.equal(businessParkingEndLabel({ parkingEndDate: null }, now), "Open-ended");
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
  // No end recorded means the car never left, so it is still in the lot for
  // every window after it arrived - not parked for a single day.
  assert.equal(businessParkingWithinRange({ parkingDate: "2026-08-01" }, "2026-08-10", "2026-08-15"), true);
  assert.equal(businessParkingWithinRange({ parkingDate: "2026-09-01" }, "2026-08-10", "2026-08-15"), false);
  // And an end with no start is bounded only by its end.
  assert.equal(businessParkingWithinRange({ parkingEndDate: "2026-08-20" }, "2026-08-10", "2026-08-15"), true);
  assert.equal(businessParkingWithinRange({ parkingEndDate: "2026-07-01" }, "2026-08-10", "2026-08-15"), false);
  // A record with no dates cannot honestly be placed in a week.
  assert.equal(businessParkingWithinRange({}, "2026-08-10", "2026-08-15"), false);
  assert.match(panelSource, /businessParkingWithinRange\(row, rangeFrom, rangeTo\)/);
});

// Staff at the desk are usually taking a car from someone the lot already
// knows - createBusinessParkingEntry remembers every walk-up customer. So the
// walk-up form offers them back instead of asking for the same name twice.
test("the walk-up form offers the customers the lot already remembers", () => {
  // The panel reads the memory, scoped to this business like every other row
  // source in it.
  assert.match(panelSource, /useBusinessRows\("lotCustomers", businessId/);
  assert.match(panelSource, /matchLotCustomers\(entryKnownCustomers, typed\)/);

  // An empty field opens on the people most recently seen. A picker that only
  // answers after two characters is a search box, and reads as broken to
  // someone who clicked expecting a list.
  assert.match(panelSource, /if \(typed\.length < 2\) return entryKnownCustomers\.slice\(0, 6\)/);
  assert.match(panelSource, /\.sort\(\(a, b\) => b\.lastSeenMs - a\.lastSeenMs\)/);

  // The lot's own people are offered too - a colleague parking here should
  // not have to be filed as a customer first - and they are labelled so the
  // person at the desk can tell which is which.
  assert.match(panelSource, /lotCustomerSources\(/);
  assert.match(panelSource, /lotCustomerFromStaffRow\(/);
  assert.match(panelSource, /customer\.staff \? " · Staff" : ""/);

  // The suggestion list closes once someone is picked, so it cannot sit over
  // the fields it just filled.
  assert.match(panelSource, /entryCustomerMenuOpen \|\| entryCustomerPick/);

  // Picking fills the contact details the lot knows, and never blanks what is
  // already typed.
  const pick = panelSource.slice(panelSource.indexOf("function pickEntryCustomer"));
  const body = pick.slice(0, pick.indexOf("\n  }"));
  assert.match(body, /customerName: customer\.name \|\| value\.customerName/);
  assert.match(body, /customerPhone: customer\.phone \|\| value\.customerPhone/);
  assert.match(body, /customerEmail: customer\.email \|\| value\.customerEmail/);
  // One car fills itself; more than one is offered rather than guessed at.
  assert.match(body, /if \(customer\.cars\.length === 1\) applyEntryCustomerCar/);
  assert.match(panelSource, /entryCustomerPick\.cars\.length > 1/);

  // The picker belongs to the walk-up entry form, not the manual record form
  // beside it, and it is a suggestion over a plain input - typing a name
  // nobody recognises is still how a new customer is added.
  assert.match(panelSource, /value=\{entryDraft\.customerName\}/);
  assert.ok(
    panelSource.indexOf("pickEntryCustomer") < panelSource.indexOf("function PurchasesPanel"),
    "the walk-up picker must live inside ParkingPanel",
  );
});

// A stay with a leave date is priced for its whole window when it is
// recorded; only an open-ended stay accrues day by day. The accrual figures
// are therefore pinned at "Nothing yet" and "0 days · $0.00" on a fixed-term
// stay - which, sitting directly under an amount that IS owed and a payment
// link that HAS been sent, reads as "nothing is owed".
test("a stay priced for its leave date does not show accrual figures", () => {
  const actions = panelSource.slice(panelSource.indexOf("function ParkingBillingActions"));
  const body = actions.slice(0, actions.indexOf("\n}\n"));

  // The accrual is computed only for an open-ended stay...
  assert.match(body, /const openEnded = !r\.parkingEndDate/);
  assert.match(body, /const days = openEnded && fromMs \?/);

  // ...and the two tiles that report it are rendered only for one.
  const grid = body.slice(body.indexOf("<dt>Leaves</dt>"));
  const tiles = grid.slice(0, grid.indexOf("</dl>"));
  assert.match(tiles, /\{openEnded && \(/, "the accrual tiles must be gated on openEnded");
  const billedAt = tiles.indexOf("Billed through");
  const gateAt = tiles.indexOf("{openEnded && (");
  assert.ok(gateAt !== -1 && gateAt < billedAt, "the gate must come before the tiles it hides");
  assert.ok(tiles.indexOf("Unbilled") > gateAt, "Unbilled sits inside the same gate");

  // The leave date itself is always worth showing.
  assert.match(body, /openEnded \? "Open-ended" : formatDate\(r\.parkingEndDate\)/);
});

// "Customer pays us directly" answers HOW, not WHETHER. A lot takes the cash
// at the desk as often as it waits for it, and recording both the same way
// left money already in the till showing as outstanding.
test("cash at the desk can be recorded as already paid", () => {
  // The follow-up question only exists under the direct method.
  assert.match(panelSource, /entryDraft\.paymentMethod === "direct" && \(/);
  assert.match(panelSource, /They have not paid yet/);
  assert.match(panelSource, /They have already paid/);
  assert.match(panelSource, /How did they pay\?/);
  // And it offers the same methods the "payment received" button does, so a
  // walk-up settled at the desk is reconciled the same way as one settled an
  // hour later.
  assert.match(panelSource, /entryReceivedVia/);

  // Settling reuses the shared callable rather than inventing a second path.
  const submit = panelSource.slice(panelSource.indexOf("async function submitEntry"));
  const body = submit.slice(0, submit.indexOf("\n  }"));
  assert.match(body, /entryDraft\.paymentMethod === "direct" && entryAlreadyPaid/);
  assert.match(body, /"markBusinessParkingPaid"/);
  // A failed settle must leave the car recorded and still owed, never
  // silently paid.
  assert.match(body, /marking it paid failed/);
  assert.ok(
    body.indexOf("createBusinessParkingEntry") < body.indexOf("markBusinessParkingPaid"),
    "the car is recorded before it can be settled",
  );

  // The next car is a different car: the flag must not carry over.
  const close = panelSource.slice(panelSource.indexOf("function closeEntry"));
  assert.match(close.slice(0, close.indexOf("\n  }")), /setEntryAlreadyPaid\(false\)/);
});

// The card's own tiles stack their label above their value like every other
// row-detail-grid; as a span/b pair they rendered as "LEAVESOpen-ended".
test("the parking card tiles use the shared label/value markup", () => {
  const actions = panelSource.slice(panelSource.indexOf("function ParkingBillingActions"));
  const body = actions.slice(0, actions.indexOf("\n}\n"));
  assert.match(body, /<dl className="row-detail-grid"/);
  assert.match(body, /<dt>Leaves<\/dt>/);
  assert.ok(!/<span>Leaves<\/span>/.test(body), "span/b never picks up the stacking");
});

// A lot with thirty cars in it wants to read thirty cars at once, the way its
// own spreadsheet does — not scroll thirty cards.
test("parking has a dense list view, and a row opens that car", () => {
  assert.match(panelSource, /useState<"list" \| "cards">\("list"\)/, "the list is the working view");
  // The columns a lot actually tracks, in the order its own sheet uses.
  for (const column of ["Vehicle", "Depositor", "In", "Out", "Days", "Rate", "Total", "Status"]) {
    assert.match(panelSource, new RegExp(`<span[^>]*>${column}</span>`), `missing the ${column} column`);
  }
  // A row is a button that opens the card for that car, so nothing the cards
  // can do is lost by preferring the list.
  assert.match(panelSource, /setParkingView\("cards"\); setOpenRowId\(String\(row\.id\)\)/);
  assert.match(panelSource, /\(focusRecordId \|\| openRowId\) === row\.id/);
  // A record arriving from a notification must not be swallowed by the list.
  assert.match(panelSource, /if \(focusRecordId\) setParkingView\("cards"\)/);
});

test("a stay counts the days the lot would count", () => {
  const day = (d: string) => new Date(`${d}T12:00:00Z`);
  // A fixed stay counts its whole window.
  assert.equal(
    businessParkingStayDays({ parkingDate: day("2026-09-01"), parkingEndDate: day("2026-09-11") }),
    10,
  );
  // An open-ended stay counts up to today, and keeps counting.
  assert.equal(
    businessParkingStayDays({ parkingDate: day("2026-09-01") }, day("2026-09-06")),
    5,
  );
  // A car parked today is one day, never zero — the lot's minimum.
  assert.equal(
    businessParkingStayDays({ parkingDate: day("2026-09-10") }, day("2026-09-10")),
    1,
  );
  // And a record with no start cannot be counted at all.
  assert.equal(businessParkingStayDays({}), 0);
});

// A list you cannot act on just makes you open the card anyway.
test("each list row carries the actions the card offers", () => {
  const list = panelSource.slice(panelSource.indexOf('className="pk-list"'));
  const body = list.slice(0, list.indexOf("<div className=\"pur-grid\""));
  // Print, copy the link, edit — the three a desk reaches for all day.
  assert.match(body, /openParkingDocument\(row\)/);
  assert.match(body, /copyCheckoutUrl\(linkUrl\)/);
  assert.match(body, /editParking\(row\)/);
  // The copy button only exists where there is a link and money still owed.
  assert.match(body, /\{linkUrl && tone !== "paid" &&/);
  // A row is a div, not a button: a button inside a button is invalid, and
  // the row would swallow every action click.
  assert.match(body, /<div className="pk-row" key=\{String\(row\.id\)\} role="row">/);
  assert.ok(!/<button[^>]*className="pk-row"/.test(body), "the row must not be a button");
});
