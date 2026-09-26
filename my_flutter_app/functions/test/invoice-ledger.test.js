"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  validateInvoice,
  invoiceRecord,
  validateInvoiceLine,
  invoiceLineRecord,
  validateInvoicePayment,
  invoicePaymentRecord,
  invoiceTotals,
  invoiceIsOverdue,
  invoiceNumber,
  invoiceKind,
  invoiceTextSummary,
  dayKey,
} = require("../invoice_ledger");

describe("an invoice", () => {
  it("needs a title and a customer; dates must be real and in order", () => {
    assert.deepEqual(validateInvoice({}),
        ["title_required", "customer_name_required"]);
    assert.deepEqual(
        validateInvoice({title: "Corolla", customerName: "Amadou"}), []);
    assert.deepEqual(validateInvoice({title: "x", customerName: "y",
      issuedOn: "2026-02-30"}), ["issued_on_invalid"]);
    assert.deepEqual(validateInvoice({title: "x", customerName: "y",
      issuedOn: "2026-09-20", dueOn: "2026-09-01"}), ["due_before_issued"]);
  });

  it("stores calendar days, defaulting the invoice date to today", () => {
    const rec = invoiceRecord({title: " Corolla ", customerName: "Amadou Bah",
      customerPhone: "+1 646", dueOn: "2026-10-15T12:00:00"}, "2026-09-26");
    assert.equal(rec.title, "Corolla");
    assert.equal(rec.issuedOn, "2026-09-26");
    assert.equal(rec.dueOn, "2026-10-15");
    assert.equal(dayKey({toDate: () => new Date("2026-09-01T23:00:00Z")}),
        "2026-09-01");
  });

  it("numbers per business, four digits, never reused", () => {
    assert.equal(invoiceNumber(1), "INV-0001");
    assert.equal(invoiceNumber(12345), "INV-12345");
  });
});

describe("a line", () => {
  it("is a description, a count and a price for one; amount derived", () => {
    assert.deepEqual(validateInvoiceLine({}),
        ["description_required", "quantity_required", "unit_price_invalid"]);
    assert.deepEqual(validateInvoiceLine({description: "Barrels", quantity: 8,
      unitPriceCents: 12000}), []);
    const line = invoiceLineRecord({description: " Barrels to Conakry ",
      quantity: "8", unitPriceCents: 12000, vinNumber: ""});
    assert.equal(line.amountCents, 96000);
    assert.equal(line.quantity, 8);
  });

  // A car line carries the VIN on the paper; a half-typed one is refused
  // rather than printed wrong.
  it("keeps a VIN only when it is a whole one", () => {
    assert.deepEqual(validateInvoiceLine({description: "Corolla", quantity: 1,
      unitPriceCents: 550000, vinNumber: "1hgcm82633a004352"}), []);
    assert.deepEqual(validateInvoiceLine({description: "Corolla", quantity: 1,
      unitPriceCents: 550000, vinNumber: "ABC123"}), ["vin_invalid"]);
    assert.equal(invoiceLineRecord({description: "Corolla", quantity: 1,
      unitPriceCents: 1, vinNumber: " 1hgcm82633a004352 "}).vinNumber,
    "1HGCM82633A004352");
  });

  it("refuses a typo-sized amount", () => {
    assert.deepEqual(validateInvoiceLine({description: "x", quantity: 10000,
      unitPriceCents: 10001}), ["amount_too_large"]);
  });
});

describe("a payment", () => {
  it("must be positive, within the balance, and say how it arrived", () => {
    assert.deepEqual(validateInvoicePayment({}, 10000),
        ["amount_required", "payment_method_invalid"]);
    assert.deepEqual(validateInvoicePayment(
        {amountCents: 20000, method: "cash"}, 10000),
    ["payment_exceeds_balance"]);
    assert.deepEqual(validateInvoicePayment(
        {amountCents: 10000, method: "cash"}, 10000), []);
    assert.deepEqual(validateInvoicePayment({amountCents: 100, method: "wire"},
        10000), ["payment_method_invalid"]);
    const rec = invoicePaymentRecord({amountCents: 5000, method: "zelle"},
        "2026-09-26");
    assert.equal(rec.paidOn, "2026-09-26");
    assert.equal(rec.reverted, false);
  });
});

describe("what the invoice adds up to", () => {
  const lines = [{amountCents: 550000}, {amountCents: 5000}];
  it("is total minus the payments that still stand", () => {
    const t = invoiceTotals(lines, [
      {amountCents: 200000}, {amountCents: 100000, reverted: true}]);
    assert.equal(t.totalCents, 555000);
    assert.equal(t.paidCents, 200000);
    assert.equal(t.balanceCents, 355000);
    assert.equal(t.paymentCount, 1);
    assert.equal(t.status, "open");
  });

  it("is paid when nothing is owed; a blank invoice is never paid", () => {
    assert.equal(invoiceTotals(lines, [{amountCents: 555000}]).status, "paid");
    assert.equal(invoiceTotals([], []).status, "open");
    assert.equal(invoiceKind({status: "paid"}), "Receipt");
    assert.equal(invoiceKind({status: "open"}), "Invoice");
  });

  it("is overdue only while open and past its due day", () => {
    assert.equal(invoiceIsOverdue({status: "open", dueOn: "2026-09-20"},
        "2026-09-26"), true);
    assert.equal(invoiceIsOverdue({status: "open", dueOn: "2026-09-26"},
        "2026-09-26"), false);
    assert.equal(invoiceIsOverdue({status: "paid", dueOn: "2026-09-20"},
        "2026-09-26"), false);
    assert.equal(invoiceIsOverdue({status: "open"}, "2026-09-26"), false);
  });
});

describe("the WhatsApp text", () => {
  it("reads the lines, the total, what was paid and what is owed", () => {
    const txt = invoiceTextSummary({
      businessName: "Keren Auto Sales",
      invoice: {number: "INV-0007", title: "Corolla",
        customerName: "Amadou Bah", issuedOn: "2026-09-26",
        dueOn: "2026-10-15"},
      lines: [
        {description: "2014 Toyota Corolla", quantity: 1,
          unitPriceCents: 550000, amountCents: 550000,
          vinNumber: "1HGCM82633A004352"},
        {description: "Barrels", quantity: 8, unitPriceCents: 12000,
          amountCents: 96000},
      ],
      payments: [{amountCents: 200000}],
    });
    assert.match(txt, /^Keren Auto Sales — Invoice INV-0007\n/);
    assert.match(txt,
        /2014 Toyota Corolla — \$5,500\.00\nVIN 1HGCM82633A004352/);
    assert.match(txt, /Barrels \(8 × \$120\.00\) — \$960\.00/);
    assert.match(txt, /Total: \$6,460\.00\nPaid: -\$2,000\.00\n/);
    assert.match(txt, /BALANCE DUE: \$4,460\.00 \(due 2026-10-15\)$/);
    const paid = invoiceTextSummary({businessName: "K", invoice: {title: "t",
      customerName: "c"}, lines: [{amountCents: 100}],
    payments: [{amountCents: 100}]});
    assert.match(paid, /— Receipt\n/);
    assert.match(paid, /PAID IN FULL$/);
  });
});
