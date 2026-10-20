import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { TEXT_TRANSLATIONS, translateValue } from "./french-dom.ts";
import { INVENTORY_MESSAGES, inventoryCallableFailure, inventorySaleFromRow } from "./inventory.ts";
import {
  canSwitchToCredit,
  canSwitchToPaid,
  creditPhoneOf,
  emptySwitchToCreditDraft,
  neverCreditText,
  saleSwitchLineText,
  switchDraftKey,
  switchSplit,
  switchToCreditConfirmText,
  switchToCreditRequest,
  switchToPaidConfirmText,
  switchToPaidDraftFrom,
  switchToPaidRequest,
  switchedText,
  validateSwitchToCreditDraft,
  validateSwitchToPaidDraft,
} from "./inventory-credit.ts";

// Switching a recorded sale between paid and credit (docs/INVENTORY.md v6),
// console side: who is offered what, the forms checked before the call, the
// requests, the history line, and the French of every new sentence.

const TODAY = "2026-10-20";
const line = { itemId: "i", name: "Boubou", quantity: 1, listPriceCents: 6000, soldPriceCents: 6000 };

function paidSale(extra: Record<string, unknown> = {}) {
  return inventorySaleFromRow({
    id: "s1", businessId: "b", totalCents: 6000, paymentMethod: "zelle", soldByStaffId: "seller",
    receivedByStaffId: "taker", paidNowCents: 6000, creditCents: 0, creditStatus: "none", lines: [line], ...extra,
  });
}

function creditSale(extra: Record<string, unknown> = {}) {
  return inventorySaleFromRow({
    id: "s2", businessId: "b", totalCents: 6000, paymentMethod: "cash", soldByStaffId: "seller",
    receivedByStaffId: "taker", paidNowCents: 2000, creditCents: 4000, creditPaidCents: 0, creditStatus: "open",
    credit: { customerName: "Fatou Bah", customerPhone: "", collectorStaffId: "col", dueDate: "" }, lines: [line], ...extra,
  });
}

const entry = (to: "credit" | "paid", extra: Record<string, unknown> = {}) => ({
  requestId: "web-1", from: to === "credit" ? "paid" : "credit", to, byStaffId: "u1", at: null,
  totalCents: 6000, fromPaidNowCents: 6000, fromCreditCents: 0, toPaidNowCents: to === "credit" ? 2000 : 6000,
  toCreditCents: to === "credit" ? 4000 : 0, fromPaymentMethod: "zelle", toPaymentMethod: to === "credit" ? "zelle" : "cash",
  customerName: "Fatou Bah", ...extra,
});

test("a paid sale is offered credit; a credit sale nothing was collected on is offered paid", () => {
  assert.equal(canSwitchToCredit(paidSale()), true);
  assert.equal(canSwitchToPaid(paidSale()), false);
  assert.equal(canSwitchToCredit(paidSale({ voided: true })), false);
  assert.equal(canSwitchToCredit(paidSale({ totalCents: 0, lines: [] })), false);
  assert.equal(canSwitchToPaid(creditSale()), true);
  assert.equal(canSwitchToCredit(creditSale()), false);
  assert.equal(canSwitchToPaid(creditSale({ creditPaidCents: 100 })), false);
  assert.equal(canSwitchToPaid(creditSale({ voided: true })), false);
});

test("the stored switches are read safely, oldest first", () => {
  const sale = paidSale({ paymentSwitches: [entry("credit"), null, "x", { to: "odd", toCreditCents: -4 }] });
  assert.equal(sale.paymentSwitches.length, 2);
  assert.equal(sale.paymentSwitches[0].to, "credit");
  assert.equal(sale.paymentSwitches[0].toCreditCents, 4000);
  assert.deepEqual([sale.paymentSwitches[1].to, sale.paymentSwitches[1].toCreditCents], ["paid", 0]);
  assert.deepEqual(paidSale().paymentSwitches, []);
});

test("Switch to credit checks what a credit sale checks, against the total", () => {
  const ok = { paidNow: "20", customerName: "Fatou Bah", customerPhone: "+1", collectorStaffId: "col", dueDate: "" };
  assert.deepEqual(validateSwitchToCreditDraft(ok, 6000, TODAY), []);
  assert.deepEqual(validateSwitchToCreditDraft(emptySwitchToCreditDraft(), 6000, TODAY), ["credit_customer_required", "collector_invalid"]);
  assert.deepEqual(validateSwitchToCreditDraft({ ...ok, paidNow: "60" }, 6000, TODAY), ["paid_now_invalid"]);
  assert.deepEqual(validateSwitchToCreditDraft({ ...ok, paidNow: "abc" }, 6000, TODAY), ["paid_now_invalid"]);
  assert.deepEqual(validateSwitchToCreditDraft({ ...ok, customerPhone: "+1 207 55" }, 6000, TODAY), ["customer_phone_invalid"]);
  assert.deepEqual(validateSwitchToCreditDraft({ ...ok, dueDate: "2026-10-19" }, 6000, TODAY), ["due_date_invalid"]);
  assert.deepEqual(validateSwitchToCreditDraft({ ...ok, dueDate: TODAY }, 6000, TODAY), []);
  assert.deepEqual(switchSplit({ paidNow: "12,50" }, 6000), { paidNowCents: 1250, creditCents: 4750 });
  assert.deepEqual(switchSplit({ paidNow: "" }, 6000), { paidNowCents: 0, creditCents: 6000 });
  // The bare country code the phone field starts with is no phone.
  assert.equal(creditPhoneOf("+1"), "");
  assert.equal(creditPhoneOf("+1 (207) 555-0100"), "+12075550100");
  assert.deepEqual(switchToCreditRequest(" b ", " s1 ", "web-1", { ...ok, customerPhone: "+1 207 555 0100", dueDate: "2099-01-01" }), {
    businessId: "b", saleId: "s1", clientRequestId: "web-1", to: "credit",
    credit: { paidNowCents: 2000, customerName: "Fatou Bah", customerPhone: "+12075550100", collectorStaffId: "col", dueDate: "2099-01-01" },
  });
});

test("Switch to paid starts on the sale and needs a method and a receiver", () => {
  assert.deepEqual(switchToPaidDraftFrom(creditSale()), { method: "cash", receivedByStaffId: "taker" });
  // Put on credit with nothing paid (method ""): the one it had before.
  const none = creditSale({ paymentMethod: "", paidNowCents: 0, creditCents: 6000, paymentSwitches: [entry("credit", { fromPaymentMethod: "venmo" })] });
  assert.equal(switchToPaidDraftFrom(none).method, "venmo");
  assert.equal(switchToPaidDraftFrom(creditSale({ paymentMethod: "" })).method, "cash");
  assert.deepEqual(validateSwitchToPaidDraft({ method: "gold", receivedByStaffId: "" }), ["payment_method_invalid", "received_by_invalid"]);
  assert.deepEqual(switchToPaidRequest("b", "s2", "web-2", { method: "zelle", receivedByStaffId: " u1 " }), {
    businessId: "b", saleId: "s2", clientRequestId: "web-2", to: "paid", paymentMethod: "zelle", receivedByStaffId: "u1",
  });
  // The same answers are the same attempt (a retry reuses its request id).
  assert.equal(switchDraftKey("paid", { method: "cash", receivedByStaffId: "u" }), switchDraftKey("paid", { method: "cash", receivedByStaffId: "u" }));
  assert.notEqual(switchDraftKey("paid", { method: "cash", receivedByStaffId: "u" }), switchDraftKey("paid", { method: "zelle", receivedByStaffId: "u" }));
});

test("the history line and the sentences read in both languages", () => {
  const credit = inventorySaleFromRow({ paymentSwitches: [entry("credit")] }).paymentSwitches[0];
  assert.deepEqual(saleSwitchLineText(credit, "Ama", "10/20/2026, 3:15 PM"), {
    text: "Switched to credit by Ama · 10/20/2026, 3:15 PM · $20.00 paid, $40.00 owed", methodLabel: "",
  });
  assert.equal(saleSwitchLineText(credit, "", "", "fr").text, "Passée à crédit par Un membre de l’équipe · $20.00 payés, $40.00 dus");
  const paid = inventorySaleFromRow({ paymentSwitches: [entry("paid")] }).paymentSwitches[0];
  assert.deepEqual(saleSwitchLineText(paid, "Ama", ""), { text: "Switched to paid by Ama · $60.00 paid", methodLabel: "Cash" });
  assert.equal(saleSwitchLineText(paid, "Ama", "", "fr").text, "Passée en payée par Ama · $60.00 payés");
  // The method is translated by the dictionary.
  assert.equal(translateValue("Cash", "fr"), "Espèces");
  assert.equal(switchToCreditConfirmText("Fatou", { paidNowCents: 2000, creditCents: 4000 }),
    "Put this sale on credit? Fatou will owe $40.00. $20.00 stays paid at the time. The collector is told.");
  assert.match(switchToCreditConfirmText("Fatou", { paidNowCents: 0, creditCents: 6000 }, "fr"), /^Passer cette vente à crédit\s\? Fatou devra \$60\.00\./);
  assert.match(switchToPaidConfirmText(6000), /The whole \$60\.00 was paid/);
  assert.match(switchToPaidConfirmText(6000, "fr"), /^Marquer cette vente comme payée\s\?/);
  assert.equal(neverCreditText(6000), "It was never credit: the whole $60.00 was paid at the time of the sale.");
  assert.match(neverCreditText(6000, "fr"), /^Ce n’était pas un crédit/);
  assert.equal(switchedText("credit", 4000), "Switched to credit: $40.00 owed.");
  assert.equal(switchedText("paid", 0, "fr"), "Passée en payée.");
});

test("each new refusal reads as a sentence, in French too", () => {
  for (const code of ["switch_target_invalid", "sale_already_credit", "sale_already_paid", "credit_payments_recorded", "too_many_switches"] as const) {
    const failure = inventoryCallableFailure({ code: "functions/failed-precondition", message: "x", details: { reason: code } });
    assert.equal(failure.reason, code);
    assert.equal(failure.message, INVENTORY_MESSAGES[code]);
    assert.ok(INVENTORY_MESSAGES[code] in TEXT_TRANSLATIONS, code);
  }
  assert.match(INVENTORY_MESSAGES.credit_payments_recorded, /Record a payment/);
  // The phone is optional on a credit sale: the name alone is asked for.
  assert.equal(INVENTORY_MESSAGES.credit_customer_required, "Enter the customer's name.");
});

test("the sales list offers the switch and shows every switch on the sale", () => {
  const list = readFileSync(new URL("../components/business/inventory-sales-list.tsx", import.meta.url), "utf8");
  assert.match(list, /canSwitchToCredit\(sale\) \|\| canSwitchToPaid\(sale\)/);
  assert.match(list, /<InventorySaleSwitchDialog/);
  assert.match(list, /sale\.paymentSwitches\.map/);
  const dialog = readFileSync(new URL("../components/business/inventory-sale-switch-dialog.tsx", import.meta.url), "utf8");
  assert.match(dialog, /httpsCallable\(functions, "switchInventorySalePayment"\)/);
  assert.match(dialog, /confirmImportantAction\(/);
  assert.match(dialog, /<CustomerPhoneField/);
  assert.match(dialog, /requestIdFor\(/);
});
