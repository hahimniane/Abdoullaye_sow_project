import assert from "node:assert/strict";
import { test } from "node:test";

import { inventoryCallableFailure, inventorySaleFromRow, readInventorySummary } from "./inventory.ts";
import {
  collectorDraftChanged,
  collectorDraftFrom,
  creditChip,
  creditChipText,
  creditPaymentEntries,
  customerKeyOf,
  dateKeyInZone,
  daysBetween,
  dueDateText,
  emptyCreditPaymentDraft,
  filterOpenCredit,
  groupOpenCredit,
  livePaymentsCents,
  ofWhichOnCreditText,
  openCreditRows,
  openCreditTotals,
  overdueDaysText,
  owesText,
  recordInventoryCreditPaymentRequest,
  revertInventoryCreditPaymentRequest,
  saleMatchesCreditFilter,
  setInventoryCreditCollectorRequest,
  validateCollectorDraft,
  validateCreditPaymentDraft,
  wholeRemainingInput,
} from "./inventory-credit.ts";

const TODAY = "2026-10-16";

function creditSale(extra: Record<string, unknown> = {}) {
  return {
    id: "s1", businessId: "b", totalCents: 6000, paymentMethod: "cash", soldByStaffId: "seller",
    lines: [{ itemId: "i", name: "Boubou", quantity: 1, listPriceCents: 6000, soldPriceCents: 6000 }],
    paidNowCents: 2000, creditCents: 4000, creditPaidCents: 0, creditStatus: "open",
    credit: { customerName: "Fatou Bah", customerPhone: "+12075550100", collectorStaffId: "col", dueDate: "2026-10-20" },
    createdAt: new Date("2026-10-10T15:00:00Z"),
    ...extra,
  };
}

test("an old sale reads as paid in full, received by the seller", () => {
  const sale = inventorySaleFromRow({ id: "old", totalCents: 900, soldByStaffId: "anna", lines: [] });
  assert.equal(sale.receivedByStaffId, "anna");
  assert.equal(sale.paidNowCents, 900);
  assert.equal(sale.creditCents, 0);
  assert.equal(sale.creditStatus, "none");
  assert.equal(sale.credit, null);
  assert.equal(creditChip(sale, TODAY), null);
});

test("a credit sale reads its money, its customer and its collector", () => {
  const sale = inventorySaleFromRow(creditSale({ receivedByStaffId: "other", creditPaidCents: 1500 }));
  assert.equal(sale.receivedByStaffId, "other");
  assert.equal(sale.paidNowCents, 2000);
  assert.equal(sale.creditCents, 4000);
  assert.equal(sale.creditRemainingCents, 2500);
  assert.equal(sale.creditStatus, "open");
  assert.deepEqual(sale.credit, { customerName: "Fatou Bah", customerPhone: "+12075550100", collectorStaffId: "col", dueDate: "2026-10-20" });
  // A malformed due date is no due date.
  assert.equal(inventorySaleFromRow(creditSale({ credit: { customerName: "F", dueDate: "10/20/2026" } })).credit?.dueDate, "");
  // A voided credit sale owes nothing.
  assert.equal(inventorySaleFromRow(creditSale({ voided: true })).creditStatus, "none");
});

test("the chip says open, overdue or paid, with what is owed", () => {
  const open = creditChip(inventorySaleFromRow(creditSale()), TODAY);
  assert.deepEqual(open, { status: "open", remainingCents: 4000, creditCents: 4000 });
  assert.equal(creditChipText(open!, "en"), "Open $40.00");
  assert.equal(creditChipText(open!, "fr"), "Crédit $40.00");
  const late = creditChip(inventorySaleFromRow(creditSale({ credit: { customerName: "F", dueDate: "2026-10-15" } })), TODAY);
  assert.equal(late?.status, "overdue");
  assert.equal(creditChipText(late!, "en"), "Overdue $40.00");
  // Due today is not overdue yet.
  assert.equal(creditChip(inventorySaleFromRow(creditSale({ credit: { customerName: "F", dueDate: TODAY } })), TODAY)?.status, "open");
  const paid = creditChip(inventorySaleFromRow(creditSale({ creditPaidCents: 4000, creditStatus: "paid" })), TODAY);
  assert.equal(paid?.status, "paid");
  assert.equal(creditChipText(paid!, "fr"), "Crédit payé");
  assert.equal(creditChip(inventorySaleFromRow(creditSale({ voided: true })), TODAY), null);
});

test("the credit filter narrows the sales list", () => {
  const normal = inventorySaleFromRow({ id: "n", totalCents: 100, lines: [] });
  const open = inventorySaleFromRow(creditSale());
  const paid = inventorySaleFromRow(creditSale({ id: "p", creditPaidCents: 4000 }));
  const voided = inventorySaleFromRow(creditSale({ id: "v", voided: true }));
  const pick = (filter: Parameters<typeof saleMatchesCreditFilter>[1]) =>
    [normal, open, paid, voided].filter((sale) => saleMatchesCreditFilter(sale, filter)).map((sale) => sale.id);
  assert.deepEqual(pick("all"), ["n", "s1", "p", "v"]);
  assert.deepEqual(pick("credit"), ["s1", "p", "v"]);
  assert.deepEqual(pick("open"), ["s1"]);
  assert.deepEqual(pick("paid"), ["p"]);
});

test("a payment is checked before it is sent", () => {
  const draft = { ...emptyCreditPaymentDraft("me"), amount: "25" };
  assert.deepEqual(validateCreditPaymentDraft(draft, 4000), []);
  assert.deepEqual(validateCreditPaymentDraft({ ...draft, amount: "40.01" }, 4000), ["payment_exceeds_balance"]);
  assert.deepEqual(validateCreditPaymentDraft({ ...draft, amount: "0" }, 4000), ["amount_invalid"]);
  assert.deepEqual(validateCreditPaymentDraft({ ...draft, amount: "abc" }, 4000), ["amount_invalid"]);
  assert.deepEqual(validateCreditPaymentDraft({ ...draft, receivedByStaffId: "" }, 4000), ["received_by_invalid"]);
  // "12,50" is twelve fifty, as everywhere else in the console.
  assert.equal(recordInventoryCreditPaymentRequest("b", "s1", { ...draft, amount: "12,50" }).amountCents, 1250);
  assert.deepEqual(recordInventoryCreditPaymentRequest(" b ", " s1 ", { ...draft, method: "zelle", note: " later " }),
    { businessId: "b", saleId: "s1", amountCents: 2500, method: "zelle", receivedByStaffId: "me", note: "later" });
  assert.deepEqual(recordInventoryCreditPaymentRequest("b", "s1", draft),
    { businessId: "b", saleId: "s1", amountCents: 2500, method: "cash", receivedByStaffId: "me" });
  assert.deepEqual(revertInventoryCreditPaymentRequest("b", " p1 "), { businessId: "b", paymentId: "p1" });
  assert.equal(wholeRemainingInput(2550), "25.50");
  assert.equal(wholeRemainingInput(0), "");
});

test("payment history reads like package payments, newest first", () => {
  const entries = creditPaymentEntries([
    { id: "a", amountCents: 1000, method: "cash", receivedByStaffId: "r", recordedByStaffId: "u", createdAt: new Date("2026-10-11") },
    { id: "b", amountCents: 500, method: "zelle", reverted: true, revertedByStaffId: "x", createdAt: new Date("2026-10-12") },
  ]);
  assert.deepEqual(entries.map((e) => e.id), ["b", "a"]);
  assert.equal(entries[1].receivedByStaffId, "r");
  assert.equal(entries[1].recordedByStaffId, "u");
  assert.equal(livePaymentsCents(entries), 1000);
});

test("the collector form", () => {
  const sale = inventorySaleFromRow(creditSale());
  const draft = collectorDraftFrom(sale);
  assert.deepEqual(draft, { collectorStaffId: "col", dueDate: "2026-10-20" });
  assert.equal(collectorDraftChanged(sale, draft), false);
  assert.equal(collectorDraftChanged(sale, { ...draft, dueDate: "" }), true);
  assert.deepEqual(validateCollectorDraft(draft, TODAY), []);
  assert.deepEqual(validateCollectorDraft({ collectorStaffId: "", dueDate: "2026-10-01" }, TODAY), ["collector_invalid", "due_date_invalid"]);
  assert.deepEqual(validateCollectorDraft({ collectorStaffId: "c", dueDate: "2026-02-30" }, TODAY), ["due_date_invalid"]);
  assert.deepEqual(setInventoryCreditCollectorRequest("b", "s1", { collectorStaffId: " c ", dueDate: "" }),
    { businessId: "b", saleId: "s1", collectorStaffId: "c", dueDate: "" });
});

test("open credit: oldest due first, overdue flagged, voided and paid left out", () => {
  const rows = openCreditRows([
    creditSale({ id: "later", credit: { customerName: "Awa", customerPhone: "+224620000000", collectorStaffId: "c2", dueDate: "2026-11-01" } }),
    creditSale({ id: "none-old", createdAt: new Date("2026-09-01"), credit: { customerName: "Binta", customerPhone: "", collectorStaffId: "col", dueDate: "" } }),
    creditSale({ id: "none-new", createdAt: new Date("2026-10-01"), credit: { customerName: "Binta", customerPhone: "", collectorStaffId: "col", dueDate: "" } }),
    creditSale({ id: "late", creditPaidCents: 1000, credit: { customerName: "Fatou Bah", customerPhone: "+1 207 555 0100", collectorStaffId: "col", dueDate: "2026-10-13" } }),
    creditSale({ id: "paid", creditPaidCents: 4000, creditStatus: "paid" }),
    creditSale({ id: "void", voided: true }),
  ], { todayKey: TODAY });
  assert.deepEqual(rows.map((r) => r.saleId), ["late", "later", "none-old", "none-new"]);
  assert.equal(rows[0].overdue, true);
  assert.equal(rows[0].daysOverdue, 3);
  assert.equal(rows[0].remainingCents, 3000);
  assert.equal(rows[1].overdue, false);
  const totals = openCreditTotals(rows);
  assert.deepEqual(totals, { count: 4, remainingCents: 3000 + 4000 * 3, overdueCount: 1, overdueCents: 3000, customers: 3 });

  assert.deepEqual(filterOpenCredit(rows, { overdueOnly: true }).map((r) => r.saleId), ["late"]);
  assert.deepEqual(filterOpenCredit(rows, { collectorStaffId: "c2" }).map((r) => r.saleId), ["later"]);
  assert.deepEqual(filterOpenCredit(rows, { search: "binta" }).map((r) => r.saleId), ["none-old", "none-new"]);
  assert.deepEqual(filterOpenCredit(rows, { search: "555 0100" }).map((r) => r.saleId), ["late"]);

  const byCustomer = groupOpenCredit(rows, "customer");
  assert.deepEqual(byCustomer.map((g) => [g.label, g.rows.length, g.totals.remainingCents]),
    [["Fatou Bah", 1, 3000], ["Awa", 1, 4000], ["Binta", 2, 8000]]);
  const byCollector = groupOpenCredit(rows, "collector", (id) => (id === "col" ? "Mamadou" : "Aissatou"));
  assert.deepEqual(byCollector.map((g) => [g.label, g.rows.map((r) => r.saleId)]),
    [["Mamadou", ["late", "none-old", "none-new"]], ["Aissatou", ["later"]]]);
  assert.equal(groupOpenCredit(rows, "none")[0].rows.length, 4);
});

test("open credit by store names each store; old sales count under Main", () => {
  const stores = [
    { id: "main", name: "Main store", address: "", phone: "", archived: false, isMain: true, createdAt: new Date("2026-01-01") },
    { id: "annex", name: "Annex", address: "", phone: "", archived: false, isMain: false, createdAt: new Date("2026-02-01") },
  ];
  const rows = openCreditRows([
    creditSale({ id: "a", storeId: "annex" }),
    creditSale({ id: "legacy" }),
  ], { stores, todayKey: TODAY });
  assert.deepEqual(groupOpenCredit(rows, "store").map((g) => [g.key, g.label]), [["annex", "Annex"], ["main", "Main store"]]);
  assert.deepEqual(filterOpenCredit(rows, { storeId: "main" }).map((r) => r.saleId), ["legacy"]);
});

test("a customer is the same customer by phone, else by name", () => {
  assert.equal(customerKeyOf("Fatou", "+1 (207) 555-0100"), customerKeyOf("FATOU B", "+12075550100"));
  assert.equal(customerKeyOf(" Binta  Diallo ", ""), customerKeyOf("binta diallo", ""));
});

test("dates are read in New York", () => {
  assert.equal(dateKeyInZone(Date.parse("2026-10-17T03:30:00Z")), "2026-10-16");
  assert.equal(dateKeyInZone(Date.parse("2026-10-17T04:30:00Z")), "2026-10-17");
  assert.equal(dateKeyInZone(Date.parse("2026-10-17T03:30:00Z"), "Not/AZone"), "2026-10-16");
  assert.equal(daysBetween("2026-10-13", TODAY), 3);
  assert.equal(daysBetween("2026-12-31", "2027-01-01"), 1);
});

test("sentences in both languages", () => {
  assert.equal(owesText("Fatou", 4000, "en"), "Fatou owes $40.00");
  assert.equal(owesText("Fatou", 4000, "fr"), "Fatou doit $40.00");
  assert.equal(dueDateText("2026-10-14", "en"), "Due Oct 14, 2026");
  assert.equal(dueDateText("2026-10-14", "fr"), "Échéance le 14 oct. 2026");
  assert.equal(dueDateText("", "fr"), "Sans échéance");
  assert.equal(overdueDaysText(1, "en"), "1 day overdue");
  assert.equal(overdueDaysText(3, "fr"), "En retard de 3 jours");
  assert.equal(ofWhichOnCreditText(4000, "en"), "of which $40.00 on credit");
  assert.equal(ofWhichOnCreditText(4000, "fr"), "dont $40.00 à crédit");
});

test("the server's credit refusals read as sentences", () => {
  for (const reason of ["credit_has_payments", "payment_exceeds_balance", "collector_invalid", "received_by_invalid",
    "due_date_invalid", "no_credit", "payment_already_reverted", "payment_not_found", "paid_now_invalid",
    "credit_customer_required", "customer_phone_invalid", "amount_invalid", "credit_invalid"]) {
    const failure = inventoryCallableFailure({ code: "functions/invalid-argument", message: "x", details: { reason } });
    assert.equal(failure.reason, reason);
    assert.notEqual(failure.message, "x", reason);
  }
});

test("the summary splits revenue into paid now and on credit", () => {
  const summary = readInventorySummary({ revenueCents: 10000, paidNowCents: 7000, creditCents: 3000, creditOutstandingCents: 2000 });
  assert.equal(summary?.paidNowCents, 7000);
  assert.equal(summary?.creditCents, 3000);
  assert.equal(summary?.creditOutstandingCents, 2000);
  // A server from before v4: everything was paid at the counter.
  const old = readInventorySummary({ revenueCents: 10000 });
  assert.equal(old?.paidNowCents, 10000);
  assert.equal(old?.creditCents, 0);
});
