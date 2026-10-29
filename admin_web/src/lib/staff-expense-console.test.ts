// The console's side of staff expenses off their parking bill
// (docs/STAFF_EXPENSE_CREDIT.md): the link picker's customers and
// suggestions, Paid back's checks and request, the refusals, Today's titles,
// the History sentences, and the French for every new word.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { translateAuditSummary } from "./audit-summaries.ts";
import { translateValue } from "./french-dom.ts";
import {
  defaultRepaymentDay,
  dollarsToCents,
  ledgerEventTitle,
  monthStaffRepayments,
  parkingLinkChoices,
  parkingLinkCustomers,
  parkingLinkScore,
  repaymentDayKey,
  STAFF_CREDIT_REFUSAL_COPY,
  STAFF_REPAYMENT_METHODS,
  staffCreditRefusalText,
  staffParkingLinkRequest,
  staffRepaymentProblem,
  staffRepaymentRequest,
} from "./staff-expense-console.ts";

const cars = [
  { id: "c1", customerName: "Abd Sow", customerPhone: "+1 (347) 562-8973" },
  { id: "c2", customerName: "abd sow", customerPhone: "347-562-8973" },
  { id: "c3", customerName: "Mariama Diallo", customerPhone: "9175550100" },
  { id: "c4", customerName: "Ousmane Bah", customerPhone: "" },
  { id: "c5", customerName: "Cancelled", customerPhone: "1112223333", status: "cancelled" },
];

test("parking customers are grouped the way month-end bills are", () => {
  const list = parkingLinkCustomers(cars);
  assert.deepEqual(list, [
    { key: "phone:3475628973", name: "Abd Sow", phone: "+1 (347) 562-8973", cars: 2 },
    { key: "phone:9175550100", name: "Mariama Diallo", phone: "9175550100", cars: 1 },
    { key: "name:ousmane bah", name: "Ousmane Bah", phone: "", cars: 1 },
  ].sort((a, b) => a.name.localeCompare(b.name)));
});

test("suggestions: same phone first, then names sharing a word (\"Abdoulaye Sow\" ~ \"Abd Sow\")", () => {
  const list = parkingLinkCustomers(cars);
  const sowByName = { name: "Abdoulaye Sow", phone: "" };
  assert.ok(parkingLinkScore(sowByName, list.find((c) => c.name === "Abd Sow")!) > 0);
  assert.equal(parkingLinkScore(sowByName, list.find((c) => c.name === "Mariama Diallo")!), 0);
  const choices = parkingLinkChoices(sowByName, list);
  assert.deepEqual(choices.map((c) => [c.name, c.suggested]), [["Abd Sow", true], ["Mariama Diallo", false], ["Ousmane Bah", false]]);
  // The phone beats a name.
  const byPhone = parkingLinkChoices({ name: "Someone Else", phone: "917-555-0100" }, list);
  assert.equal(byPhone[0].name, "Mariama Diallo");
  assert.equal(byPhone[0].suggested, true);
  // Search by name or phone digits.
  assert.deepEqual(parkingLinkChoices(sowByName, list, "diallo").map((c) => c.name), ["Mariama Diallo"]);
  assert.deepEqual(parkingLinkChoices(sowByName, list, "8973").map((c) => c.name), ["Abd Sow"]);
});

test("the link request carries the month-end key; unlinking sends an empty one", () => {
  const sow = parkingLinkCustomers(cars)[0];
  assert.deepEqual(staffParkingLinkRequest("biz", "abd", sow), {
    action: "link_staff_parking", businessId: "biz", staffId: "abd",
    customerKey: "phone:3475628973", customerName: "Abd Sow", customerPhone: "+1 (347) 562-8973",
  });
  assert.equal(staffParkingLinkRequest("biz", "abd", null).customerKey, "");
});

test("Paid back: at most what is owed, a method, who gave it, a day not after today", () => {
  const ok = { amount: "448.31", method: "cash", givenByStaffId: "owner", note: "", paidAt: "2026-10-31" };
  assert.equal(staffRepaymentProblem(ok, 44831, "2026-11-01"), "");
  assert.equal(staffRepaymentProblem({ ...ok, amount: "448.32" }, 44831, "2026-11-01"), STAFF_CREDIT_REFUSAL_COPY.repayment_exceeds_credit);
  assert.equal(staffRepaymentProblem({ ...ok, amount: "0" }, 44831, "2026-11-01"), STAFF_CREDIT_REFUSAL_COPY.repayment_amount_invalid);
  assert.equal(staffRepaymentProblem({ ...ok, amount: "abc" }, 44831, "2026-11-01"), STAFF_CREDIT_REFUSAL_COPY.repayment_amount_invalid);
  assert.equal(staffRepaymentProblem({ ...ok, method: "bitcoin" }, 44831, "2026-11-01"), STAFF_CREDIT_REFUSAL_COPY.repayment_method_invalid);
  assert.equal(staffRepaymentProblem({ ...ok, paidAt: "2026-11-02" }, 44831, "2026-11-01"), STAFF_CREDIT_REFUSAL_COPY.repayment_date_invalid);
  assert.equal(staffRepaymentProblem({ ...ok, givenByStaffId: "" }, 44831, "2026-11-01"), "Say who gave the money.");
  assert.equal(dollarsToCents("$1,234.5"), 123450);
  assert.deepEqual(staffRepaymentRequest("biz", "abd", ok), {
    action: "record_staff_repayment", businessId: "biz", staffId: "abd", amountCents: 44831,
    method: "cash", givenByStaffId: "owner", note: "", paidAt: "2026-10-31",
  });
  assert.deepEqual(STAFF_REPAYMENT_METHODS.map((m) => m.value), ["cash", "zelle", "check", "other"]);
});

test("a past month's Paid back is dated its last day, so it settles that month's report", () => {
  assert.equal(defaultRepaymentDay("2026-10", "2026-11-01"), "2026-10-31");
  assert.equal(defaultRepaymentDay("2026-02", "2026-11-01"), "2026-02-28");
  assert.equal(defaultRepaymentDay("2026-11", "2026-11-01"), "2026-11-01");
});

test("the month's paid-back history: not voided, that month, newest first", () => {
  const ts = (iso: string) => ({ toMillis: () => new Date(`${iso}T12:00:00Z`).getTime() });
  const rows = [
    { id: "a", month: "2026-10", paidAt: ts("2026-10-03"), voided: false },
    { id: "b", month: "2026-10", paidAt: ts("2026-10-20") },
    { id: "c", month: "2026-10", paidAt: ts("2026-10-25"), voided: true },
    { id: "d", month: "2026-09", paidAt: ts("2026-09-25") },
  ];
  assert.deepEqual(monthStaffRepayments(rows, "2026-10").map((r) => r.id), ["b", "a"]);
  assert.equal(repaymentDayKey(rows[0]), "2026-10-03");
  assert.equal(repaymentDayKey({}), "");
});

test("the server's refusals read in the console's words, never raw", () => {
  const codes = ["staff_not_member", "repayment_amount_invalid", "repayment_exceeds_credit", "repayment_not_found",
    "repayment_voided", "repayment_method_invalid", "repayment_date_invalid", "link_owner_only",
    "link_customer_invalid", "staff_action_invalid"] as const;
  for (const code of codes) {
    assert.equal(staffCreditRefusalText({ code: "functions/failed-precondition", message: "x", details: { reason: code } }), STAFF_CREDIT_REFUSAL_COPY[code]);
  }
  assert.equal(staffCreditRefusalText({ details: { reasons: ["repayment_voided"] } }), STAFF_CREDIT_REFUSAL_COPY.repayment_voided);
  assert.equal(staffCreditRefusalText({ code: "functions/permission-denied", message: "Missing permission" }), STAFF_CREDIT_REFUSAL_COPY.permission_denied);
  assert.equal(staffCreditRefusalText(new Error("network")), STAFF_CREDIT_REFUSAL_COPY.unknown);
});

test("Today names the staff-expense changes", () => {
  assert.equal(ledgerEventTitle({ entityType: "staff_parking_link", action: "linked" }), "Parking bill linked");
  assert.equal(ledgerEventTitle({ entityType: "staff_parking_link", action: "unlinked" }), "Parking bill unlinked");
  assert.equal(ledgerEventTitle({ entityType: "staff_repayment", action: "recorded" }), "Staff paid back for expenses");
  assert.equal(ledgerEventTitle({ entityType: "staff_repayment", action: "voided" }), "Staff payback voided");
  assert.equal(ledgerEventTitle({ entityType: "lot_expense_entry", action: "voided" }), "Ledger entry voided");
  assert.equal(ledgerEventTitle({ action: "paid" }), "Ledger payment received");
  assert.equal(ledgerEventTitle({ action: "edited" }), "Ledger entry edited");
});

test("the server's History sentences read in French, names kept as typed", () => {
  const cases: [string, string][] = [
    ["Abdoulaye Sow's expenses come off Abd Sow's parking bill", "Les dépenses de Abdoulaye Sow sont déduites de la facture de parking de Abd Sow"],
    ["Abdoulaye Sow unlinked from Abd Sow", "Abdoulaye Sow n’est plus lié(e) à Abd Sow"],
    ["Abdoulaye Sow unlinked from their parking bill", "Abdoulaye Sow n’est plus lié(e) à sa facture de parking"],
    ["Paid back $448.31 for expenses (cash)", "Remboursé $448.31 de dépenses (espèces)"],
    ["Paid back $15.00 for expenses (zelle) — Saturday", "Remboursé $15.00 de dépenses (Zelle) — Saturday"],
    ["Voided a $15.00 payback", "Remboursement de $15.00 invalidé"],
    ["Voided a $15.00 payback — wrong person", "Remboursement de $15.00 invalidé — wrong person"],
  ];
  for (const [english, french] of cases) assert.equal(translateAuditSummary(english), french, english);
  // The server writes exactly these shapes.
  const server = readFileSync(new URL("../../../my_flutter_app/functions/index.js", import.meta.url), "utf8");
  assert.match(server, /`\$\{staffName\}'s expenses come off \$\{to\}'s parking bill`/);
  assert.match(server, /`\$\{staffName\} unlinked from \$\{from \|\| "their parking bill"\}`/);
  assert.match(server, /summary: `Paid back \$\{lotMoney\(record\.amountCents\)\} for expenses ` \+\s*`\(\$\{record\.method\}\)/);
  assert.match(server, /summary: `Voided a \$\{lotMoney\(current\.amountCents\)\} payback` \+/);
});

test("every new word reads in French", () => {
  const words = [
    // Month end.
    "Staff expenses are not taken off these bills: your account cannot see the lot's expenses.",
    "Less staff expenses", "off staff parking bills", "Less expenses", "paid for the lot", "paid for the lot in earlier months",
    "expenses this month", "expense this month", "before expenses",
    "Less expenses — covered by the staff member's lot expenses, not recorded",
    // Business owes and Paid back.
    "Business owes", "Lot expenses staff paid out of their own pocket, still owed after their parking bill.",
    "The business owes its staff nothing for this month.", "Parking bill", "No parking bill", "no parking bill this month",
    "credit bigger than the bill", "owed", "Paid back", "Paid back in", "Paid back on", "Record paid back", "given by", "Given by",
    "Who gave the money?", "How it was given", "Amount ($)",
    "Record the money the business gave back for lot expenses. It lowers what the business owes; a mistake is voided, never deleted.",
    "At most", "what the business owes on this report.", "Void this paid-back record?",
    "The business will owe this amount again. The record stays in the history, marked void.", "Paid-back record voided.",
    "Say who gave the money.", "Void", "Cancel", "Saving…",
    // People: the parking bill link.
    "Not linked", "Lot expenses this person pays come off this bill at month end.", "Link", "Change", "Unlink",
    "Link a parking bill",
    "Choose the parking customer whose monthly bill this person pays. Their lot expenses come off that bill; whatever is left, the business owes them.",
    "Find a customer", "The parked cars could not be loaded.", "No parking customer matches.",
    "No car was parked in the last twelve months.", "Suggested", "Everyone else", "parked car", "parked cars", "Linked", "Likely match",
    "Parking bill linked", "Parking bill unlinked",
    // Today.
    "Staff paid back for expenses", "Staff payback voided",
    // Attributes.
    "Void this paid-back record", "Amount paid back", "Find a parking customer", "Name or phone", "Close",
    // Refusals and the methods.
    ...Object.values(STAFF_CREDIT_REFUSAL_COPY),
    ...STAFF_REPAYMENT_METHODS.map((m) => m.label),
  ];
  for (const english of words) {
    assert.notEqual(translateValue(english, "fr"), english, `no French for "${english}"`);
  }
  // Pieces of sentences built around amounts and names.
  assert.equal(translateValue("Paid back in", "fr"), "Remboursé en");
  assert.match(translateValue("$4,942.00 before expenses", "fr"), /^\$4,942\.00 avant les dépenses$/);
  assert.match(translateValue("2 expenses this month", "fr"), /^2 dépenses ce mois-ci$/);
  assert.match(translateValue("3 parked cars", "fr"), /^3 voitures garées$/);
  assert.match(translateValue("$15.00 owed", "fr"), /^\$15\.00 dû$/);
});
