import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  INVOICE_MESSAGES,
  INVOICE_PAYMENT_METHODS,
  centsToInput,
  dollarsToCents,
  emptyInvoiceDraft,
  emptyInvoiceLineDraft,
  emptyInvoicePaymentDraft,
  filterInvoices,
  invoiceIsOverdue,
  invoiceKind,
  invoiceLinePayload,
  invoicePaymentPayload,
  invoiceTextSummary,
  invoiceTotals,
  sortInvoices,
  validateInvoiceDraft,
  validateInvoiceLineDraft,
  validateInvoicePaymentDraft,
} from "./invoice-ledger.ts";

// The console never says anything the server would not: the refusal texts
// and the payment vocabulary are read straight out of the backend module.
test("messages and payment methods match the server module", () => {
  const source = readFileSync(new URL("../../../my_flutter_app/functions/invoice_ledger.js", import.meta.url), "utf8");
  for (const [code, message] of Object.entries(INVOICE_MESSAGES)) {
    assert.ok(source.includes(`${code}: ${JSON.stringify(message)}`), `server lacks ${code}`);
  }
  for (const method of INVOICE_PAYMENT_METHODS) {
    assert.ok(source.includes(`"${method}"`), `server lacks method ${method}`);
  }
});

test("an invoice needs a title and a customer, with dates in order", () => {
  assert.deepEqual(validateInvoiceDraft(emptyInvoiceDraft), ["title_required", "customer_name_required"]);
  assert.deepEqual(validateInvoiceDraft({ ...emptyInvoiceDraft, title: "Corolla", customerName: "Amadou" }), []);
  assert.deepEqual(
    validateInvoiceDraft({ ...emptyInvoiceDraft, title: "x", customerName: "y", issuedOn: "2026-09-20", dueOn: "2026-09-01" }),
    ["due_before_issued"],
  );
});

test("a line is typed in dollars and sent in cents, amount worked out", () => {
  assert.equal(dollarsToCents("1,250.50"), 125050);
  assert.equal(dollarsToCents("$120"), 12000);
  assert.equal(centsToInput(12000), "120");
  assert.equal(centsToInput(12050), "120.50");
  assert.deepEqual(validateInvoiceLineDraft(emptyInvoiceLineDraft), ["description_required", "unit_price_invalid"]);
  const payload = invoiceLinePayload({ description: " Barrels ", quantity: "8", unitPrice: "120", vinNumber: "" });
  assert.deepEqual(payload, { description: "Barrels", quantity: 8, unitPriceCents: 12000, vinNumber: "" });
  assert.deepEqual(validateInvoiceLineDraft({ ...emptyInvoiceLineDraft, description: "Corolla", unitPrice: "5500", vinNumber: "ABC" }), ["vin_invalid"]);
});

test("a payment must fit the balance and say how it arrived", () => {
  assert.deepEqual(validateInvoicePaymentDraft(emptyInvoicePaymentDraft, 10000), ["amount_required"]);
  assert.deepEqual(validateInvoicePaymentDraft({ ...emptyInvoicePaymentDraft, amount: "200" }, 10000), ["payment_exceeds_balance"]);
  assert.deepEqual(validateInvoicePaymentDraft({ ...emptyInvoicePaymentDraft, amount: "100", method: "zelle" }, 10000), []);
  assert.deepEqual(invoicePaymentPayload({ amount: "50", method: "cash", paidOn: "2026-09-26", note: "" }),
    { amountCents: 5000, method: "cash", paidOn: "2026-09-26", note: "" });
});

test("totals, status, overdue and the list filters", () => {
  const lines = [{ amountCents: 550000 }, { amountCents: 5000 }];
  const t = invoiceTotals(lines, [{ amountCents: 200000 }, { amountCents: 999, reverted: true }]);
  assert.equal(t.balanceCents, 355000);
  assert.equal(t.status, "open");
  assert.equal(invoiceTotals(lines, [{ amountCents: 555000 }]).status, "paid");
  assert.equal(invoiceTotals([], []).status, "open", "a blank invoice is not paid");
  assert.equal(invoiceKind({ status: "paid" }), "Receipt");
  assert.equal(invoiceIsOverdue({ status: "open", dueOn: "2026-09-20" }, "2026-09-26"), true);
  assert.equal(invoiceIsOverdue({ status: "paid", dueOn: "2026-09-20" }, "2026-09-26"), false);
  const rows = [
    { id: "a", number: "INV-0001", title: "Corolla", customerName: "Amadou Bah", status: "open", dueOn: "2026-09-20", issuedOn: "2026-09-01" },
    { id: "b", number: "INV-0002", title: "Barrels", customerName: "Fatou", status: "paid", issuedOn: "2026-09-10" },
    { id: "c", number: "INV-0003", title: "Tyres", customerName: "Amadou Bah", status: "open", issuedOn: "2026-09-10" },
  ];
  const ids = (list: Record<string, unknown>[]) => list.map((r) => r.id);
  assert.deepEqual(ids(filterInvoices(rows, "open", "", "2026-09-26")), ["a", "c"]);
  assert.deepEqual(ids(filterInvoices(rows, "paid", "", "2026-09-26")), ["b"]);
  assert.deepEqual(ids(filterInvoices(rows, "overdue", "", "2026-09-26")), ["a"]);
  assert.deepEqual(ids(filterInvoices(rows, "", "amadou", "2026-09-26")), ["a", "c"]);
  assert.deepEqual(ids(filterInvoices(rows, "", "0002", "2026-09-26")), ["b"]);
  assert.deepEqual(ids(sortInvoices(rows)), ["c", "b", "a"], "newest day first, then number");
});

test("the WhatsApp text mirrors the server's", () => {
  const txt = invoiceTextSummary({
    businessName: "Keren Auto Sales",
    invoice: { number: "INV-0007", title: "Corolla", customerName: "Amadou Bah", issuedOn: "2026-09-26", dueOn: "2026-10-15" },
    lines: [
      { description: "2014 Toyota Corolla", quantity: 1, unitPriceCents: 550000, amountCents: 550000, vinNumber: "1HGCM82633A004352" },
      { description: "Barrels", quantity: 8, unitPriceCents: 12000, amountCents: 96000 },
    ],
    payments: [{ amountCents: 200000 }],
  });
  assert.equal(txt, [
    "Keren Auto Sales — Invoice INV-0007",
    "Corolla · 2026-09-26",
    "For: Amadou Bah",
    "",
    "2014 Toyota Corolla — $5,500.00\nVIN 1HGCM82633A004352",
    "Barrels (8 × $120.00) — $960.00",
    "",
    "Total: $6,460.00",
    "Paid: -$2,000.00",
    "BALANCE DUE: $4,460.00 (due 2026-10-15)",
  ].join("\n"));
});
