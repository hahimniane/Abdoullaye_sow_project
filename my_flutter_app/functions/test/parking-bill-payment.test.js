"use strict";

// Part of a month bill paid at once (docs/PARKING_BILL_PAYMENTS.md): the
// oldest-first split, the cap, the receipt's words and PDF, the signed link,
// and that the car parts of a bill payment never send their own receipts.

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  BILL_PAYMENT_MESSAGES,
  BILL_PAYMENT_REFUSAL,
  billPaymentFor,
  billPaymentPlan,
} = require("../parking_bill_payment");
const parkingWhatsApp = require("../parking_whatsapp");
const {billReceiptModel} = require("../parking_receipt_pdf");
const packageProof = require("../package_proof");
const fixture = require("./fixtures/parking-bill-payment-cases.json");

for (const c of fixture.cases) {
  test(`plan: ${c.name}`, () => {
    const r = billPaymentPlan(c.customer, c.amountCents);
    assert.equal(r.ok, c.expect.ok);
    assert.equal(r.reason, c.expect.reason);
    assert.equal(r.payableCents, c.expect.payableCents);
    assert.equal(r.leftCents, c.expect.leftCents);
    assert.deepEqual(r.parts.map((p) => ({kind: p.kind, id: p.id,
      label: p.label, amountCents: p.amountCents, full: p.full})),
    c.expect.parts);
  });
}

test("the parts always add up to the amount, and never past a charge", () => {
  for (const c of fixture.cases.filter((x) => x.expect.ok)) {
    const r = billPaymentPlan(c.customer, c.amountCents);
    assert.equal(r.parts.reduce((s, p) => s + p.amountCents, 0),
        c.amountCents, c.name);
  }
});

test("labels: two names, then a count, in both languages", () => {
  for (const l of fixture.labels) {
    assert.equal(billPaymentFor(l.parts, "en"), l.en);
    assert.equal(billPaymentFor(l.parts, "fr"), l.fr);
  }
});

test("every refusal has words", () => {
  for (const reason of Object.values(BILL_PAYMENT_REFUSAL)) {
    assert.ok(BILL_PAYMENT_MESSAGES[reason], reason);
  }
});

const payment = {
  id: "abcDEF123", monthKey: "2026-10", customerName: "Fatou Camara",
  customerPhone: "+12015550101", amountCents: 50000, receivedVia: "zelle",
  receivedByStaffId: "business_account", atMs: Date.parse(
      "2026-11-04T15:00:00Z"), leftCents: 434969, billPaidCents: 50000,
  parts: [
    {label: "2014 Toyota Corolla", trackingCode: "PK-OLD001",
      amountCents: 30000, full: true},
    {label: "2016 Honda Civic", trackingCode: "PK-CIV002",
      amountCents: 20000, full: false},
  ],
};

test("WhatsApp receipt words: one message for the whole payment", () => {
  const v = parkingWhatsApp.billReceiptValues(payment, {name: "Dala Parking",
    phone: "+13475550100"});
  assert.equal(v.name, "Fatou Camara");
  assert.equal(v.business, "Dala Parking");
  assert.equal(v.amountEn, "$500.00");
  assert.equal(v.amountFr, "500,00 $");
  assert.equal(v.carEn, "2014 Toyota Corolla and 2016 Honda Civic");
  assert.equal(v.carFr, "2014 Toyota Corolla et 2016 Honda Civic");
  assert.equal(v.balanceEn, "Balance owed: $4,349.69");
  assert.equal(v.balanceFr, "Solde à payer : 4 349,69 $");
  assert.equal(v.trackingCode, "PK-OLD001", "the first car's Track page");
  const paidUp = parkingWhatsApp.billReceiptValues({...payment, leftCents: 0},
      {name: "Dala Parking"});
  assert.equal(paidUp.balanceEn, "Paid in full");
});

test("receipt PDF lists each charge it paid, and the bill after", () => {
  const m = billReceiptModel({business: {name: "Dala Parking"}, payment});
  const rows = Object.fromEntries(m.rows.map((r) => [r.label, r.value]));
  assert.equal(rows["2014 Toyota Corolla · PK-OLD001"],
      "$300.00 · paid / payé");
  assert.equal(rows["2016 Honda Civic · PK-CIV002"], "$200.00");
  assert.equal(rows["Bill / Facture"], "Oct 2026");
  assert.equal(rows["Received by / Reçu par"],
      "Business account / Compte de l'entreprise");
  assert.equal(m.amount.value, "$500.00");
  assert.deepEqual(m.totals.map((t) => t.value), ["$4,849.69", "$4,349.69"]);
  assert.equal(m.status.paidInFull, false);
});

test("receipt PDF folds a long list into 'and N more'", () => {
  const parts = Array.from({length: 23}, (_, i) => ({label: `Car ${i + 1}`,
    trackingCode: "", amountCents: 100, full: true}));
  const m = billReceiptModel({payment: {...payment, parts}});
  const listed = m.rows.filter((r) => /^Car \d+$/.test(r.label));
  assert.equal(listed.length, 11);
  const more = m.rows.find((r) => r.label.startsWith("And 12 more"));
  assert.equal(more.value, "$12.00");
});

test("the bill receipt link opens only its own payment", () => {
  const nowMs = Date.parse("2026-11-04T15:00:00Z");
  const link = packageProof.billReceiptLink({base: "https://x/d",
    token: "t".repeat(32), paymentId: "abcDEF123", expiresMs: nowMs + 1000});
  const q = Object.fromEntries(new URL(link).searchParams);
  assert.equal(q.view, "billReceiptPdf");
  assert.ok(packageProof.billReceiptLinkValid(q, "t".repeat(32), nowMs));
  assert.ok(!packageProof.billReceiptLinkValid(q, "u".repeat(32), nowMs));
  assert.ok(!packageProof.billReceiptLinkValid({...q, p: "other"},
      "t".repeat(32), nowMs));
  assert.ok(!packageProof.billReceiptLinkValid(q, "t".repeat(32),
      nowMs + 2000), "expired");
  // A car receipt's signature never opens a bill receipt.
  const carLink = packageProof.receiptLink({base: "https://x/d",
    token: "t".repeat(32), paymentId: "abcDEF123", expiresMs: nowMs + 1000});
  const cq = Object.fromEntries(new URL(carLink).searchParams);
  assert.ok(!packageProof.billReceiptLinkValid(cq, "t".repeat(32), nowMs));
});

test("a bill payment's car part sends no per-car receipt", () => {
  const before = {businessId: "b", paymentStatus: "awaiting_direct_payment",
    paymentMethod: "direct", source: "business", amountPaidCents: 0,
    parkingEndDate: "2026-10-10", amountDueCents: 3000, parkingPayments: []};
  const part = {amountCents: 3000, at: Date.parse("2026-11-04T15:00:00Z"),
    receivedVia: "cash", billPaymentId: "abcDEF123"};
  // Even when the part settles the car (no "car just paid" receipt either).
  const after = {...before, paymentStatus: "paid", amountPaidCents: 3000,
    parkingPayments: [part]};
  assert.deepEqual(parkingWhatsApp.newPayments({businessId: "b",
    carId: "c", before, after, eventMs: 0, now: new Date()}), []);
  // A plain part payment still gets its receipt.
  const plain = {...after, parkingPayments: [{...part, billPaymentId: ""}]};
  assert.equal(parkingWhatsApp.newPayments({businessId: "b", carId: "c",
    before, after: plain, eventMs: 0, now: new Date()}).length, 1);
  assert.equal(parkingWhatsApp.messageRowId(
      parkingWhatsApp.KIND.BILL_RECEIPT, {paymentId: "abcDEF123"}),
  "bill_abcDEF123");
});
