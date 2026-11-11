// A team member's statement (docs/PARKING_INVOICES.md §6): the shared fixture
// the server, the console and the app run, plus Month end's cards - the very
// numbers the WhatsApp statement carries.

process.env.TZ = "UTC";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

import { parkingMonthSummary, type ParkingMonthStaffCredit } from "./parking-month-statement.ts";
import { cardOwes, cardPaid, staffStatements, statementCards, type StatementCustomer } from "./staff-statement.ts";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const server = require("../../../my_flutter_app/functions/staff_statement.js");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const serverInvoices = require("../../../my_flutter_app/functions/parking_invoices.js");

const fixtureUrl = new URL("../../../my_flutter_app/functions/test/fixtures/staff-statement-cases.json", import.meta.url);
const fixture = JSON.parse(readFileSync(fixtureUrl, "utf8")) as {
  cases: {
    name: string;
    monthKey: string;
    customers: StatementCustomer[];
    ctx: Record<string, unknown>;
    expected: Record<string, unknown>[];
    customerKeys: Record<string, string>;
  }[];
};

const pick = (s: ReturnType<typeof staffStatements>["statements"][number]) => ({
  staffId: s.staffId,
  name: s.name,
  key: s.key,
  parkingJobsCents: s.parkingJobsCents,
  expenseCents: s.expenseCents,
  expenseLineCount: s.expenseLines.length,
  earlierExpenseCents: s.earlierExpenseCents,
  cashHeldCents: s.cashHeldCents,
  owesCents: s.owesCents,
  stillParked: s.stillParked,
});

for (const c of fixture.cases) {
  test(`statement (shared fixture): ${c.name}`, () => {
    const ctx = { monthKey: c.monthKey, ...c.ctx };
    const mine = staffStatements(c.customers, ctx);
    assert.deepEqual(mine.statements.map(pick), c.expected);
    assert.deepEqual(mine.customerKeys, c.customerKeys);
    // And the server says the same, to the cent.
    const theirs = server.staffStatements(c.customers, ctx);
    assert.deepEqual(mine.statements.map(pick), theirs.statements.map(pick));
    assert.deepEqual(mine.customerKeys, theirs.customerKeys);
  });
}

// Alhoussaine, October 2026: $1,226 of parking and jobs, a $35 expense from
// September not yet credited, $36 held -> owes $1,227. Month end showed
// $1,191 (no cash line); now the card says what the WhatsApp statement says.
const day = (iso: string) => ({ toDate: () => new Date(`${iso}T12:00:00Z`) });
const NOW = new Date("2026-11-04T15:00:00Z");
const mine = { customerName: "Alhoussaine Barry", customerPhone: "+13475550101" };
const direct = { paymentMethod: "direct", source: "business", status: "reserved", paymentStatus: "awaiting_direct_payment" };
const cars = [
  { id: "a1", ...direct, ...mine, carYear: "2015", carMake: "Honda", carModel: "Accord", parkingDate: day("2026-10-02"), parkingEndDate: day("2026-10-20"), amountDueCents: 90000, totalCostCents: 90000 },
  { id: "a2", ...direct, ...mine, carYear: "2012", carMake: "Ford", carModel: "Focus", parkingDate: day("2026-10-05"), parkingEndDate: day("2026-10-25"), amountDueCents: 20000, totalCostCents: 20000 },
  { id: "z1", ...direct, customerName: "Zed Camara", customerPhone: "+12015550099", carYear: "2010", carMake: "Kia", carModel: "Rio", parkingDate: day("2026-10-03"), parkingEndDate: day("2026-10-10"), amountDueCents: 50000, totalCostCents: 50000 },
];
const activities = [
  { id: "j1", ...mine, activityDate: day("2026-10-14"), activityTypeLabel: "Tire change", feeCents: 12600, paymentStatus: "awaiting_direct_payment" },
];
const credit: ParkingMonthStaffCredit = {
  entries: [{ id: "e-sep", paidByStaffId: "alh", amountCents: 3500, month: "2026-09", spentAt: day("2026-09-06"), note: "cups" }],
  repayments: [],
  links: { alh: { customerKey: "phone:3475550101", customerName: "Alhoussaine Barry", customerPhone: "+13475550101" } },
  staffNames: { alh: "Alhoussaine Barry" },
};

function cardsFor(held: Record<string, number>) {
  const summary = parkingMonthSummary(cars, "2026-10", NOW, activities, credit);
  const entries = (credit.entries ?? []).map((e) => ({ ...e, spentAtMs: (e.spentAt as { toDate(): Date }).toDate().getTime() }));
  const out = staffStatements(summary.customers, {
    monthKey: "2026-10", entries, repayments: credit.repayments, lines: [], staffNames: credit.staffNames, held,
  });
  return { summary, ...out, cards: statementCards(summary.customers, out.statements, out.customerKeys) };
}

test("Month end's card for a team member carries the statement: $1,226 - $35 + $36 = owes $1,227", () => {
  const { summary, statements, cards } = cardsFor({ alh: 3600 });
  // The old card: after expenses, no cash line.
  assert.equal(summary.customers.find((c) => c.key === "phone:3475550101")!.dueCents, 119100);
  const [st] = statements;
  assert.equal(st.parkingJobsCents, 122600);
  assert.equal(st.expenseCents, 3500);
  assert.equal(st.cashHeldCents, 3600);
  assert.equal(st.owesCents, 122700);
  const card = cards.find((c) => c.key === "phone:3475550101")!;
  assert.equal(card.statementOwesCents, 122700);
  assert.equal(card.cashHeldCents, 3600);
  assert.equal(card.expenseCreditCents, 3500);
  assert.equal(card.earlierExpenseCents, 3500);
  assert.equal(cardOwes(card), true);
  assert.equal(cardPaid(card), false);
  // Zed is a customer: untouched.
  const zed = cards.find((c) => c.key === "phone:2015550099")!;
  assert.equal(zed.statementOwesCents, undefined);
  assert.equal(zed.dueCents, 50000);
  assert.equal(cardOwes(zed), true);
});

test("the console's statement is the server's, from the same bills", () => {
  const { statements } = cardsFor({ alh: 3600 });
  const serverCredit = {
    ...credit,
    entries: (credit.entries ?? []).map((e) => ({ ...e, spentAt: (e.spentAt as { toDate(): Date }).toDate() })),
    lines: [],
  };
  const serverSummary = require("../../../my_flutter_app/functions/parking_month_statement.js").parkingMonthSummary(
    cars.map((c) => ({ ...c, parkingDate: (c.parkingDate as { toDate(): Date }).toDate(), parkingEndDate: (c.parkingEndDate as { toDate(): Date }).toDate() })),
    "2026-10", NOW,
    activities.map((a) => ({ ...a, activityDate: (a.activityDate as { toDate(): Date }).toDate() })),
  );
  const netted = serverInvoices.nettedCustomers(serverSummary.customers, "2026-10", serverCredit);
  const [theirs] = server.staffStatements(netted, {
    monthKey: "2026-10",
    entries: serverCredit.entries.map((e: { spentAt: Date }) => ({ ...e, spentAtMs: e.spentAt.getTime() })),
    repayments: [], lines: [], staffNames: credit.staffNames, held: { alh: 3600 },
  }).statements;
  assert.equal(statements[0].owesCents, theirs.owesCents);
  assert.equal(statements[0].parkingJobsCents, theirs.parkingJobsCents);
  assert.equal(statements[0].expenseCents, theirs.expenseCents);
});

test("when the business owes them the card is settled, not owing", () => {
  const { cards } = cardsFor({ alh: -200000 });
  const card = cards.find((c) => c.key === "phone:3475550101")!;
  assert.equal(card.statementOwesCents, 122600 - 3500 - 200000);
  assert.equal(cardOwes(card), false);
  assert.equal(cardPaid(card), true);
});

test("a member's other bills are marked as in their statement, and are not on the lists", () => {
  const customers = fixture.cases[3].customers as never[];
  const out = staffStatements(customers, { monthKey: "2026-10", entries: [], repayments: [], lines: [], staffNames: { sira: "Sira Doumbia" }, held: { sira: 500 } });
  const cards = statementCards(customers, out.statements as never, out.customerKeys);
  const own = cards.find((c) => c.key === "staff:sira")!;
  const jobs = cards.find((c) => c.key === "phone:3475550103")!;
  const shared = cards.find((c) => c.key === "phone:3475550104")!;
  assert.equal(own.statementOwesCents, 16500);
  assert.equal(jobs.includedInStatementOf, "Sira Doumbia");
  assert.equal(cardOwes(jobs), false);
  assert.equal(cardPaid(jobs), false);
  assert.equal(shared.statementOwesCents, undefined);
  assert.equal(shared.includedInStatementOf, undefined);
});

// ---------------------------------------------------------------------------
// The bill (PDF totals, copied text) and the invoices panel
// ---------------------------------------------------------------------------

import { billTotalsLayout } from "./parking-month-pdf.ts";
import { parkingMonthCustomerText } from "./parking-month-statement.ts";
import { translateValue } from "./french-dom.ts";
import { parseInvoicePreview, skippedMemberReason } from "./parking-invoices.ts";
import { hasTeamBills, staffStatementCashFrom, staffStatementCashRequest } from "./staff-statement.ts";

test("the statement's bill carries the cash line and the same total as the card, in both languages", () => {
  const { cards } = cardsFor({ alh: 3600 });
  const card = cards.find((c) => c.key === "phone:3475550101")!;
  const layout = billTotalsLayout(card, "en", 100);
  assert.deepEqual(layout.rows.map((r) => [r.label, r.value]), [
    ["Total for the month", "$1,226.00"],
    ["Less expenses", "-$35.00"],
    ["Cash you hold for the business", "+$36.00"],
    ["You owe the business", "$1,227.00"],
  ]);
  const fr = billTotalsLayout(card, "fr", 100);
  assert.equal(fr.rows[2].label, "Argent que vous gardez pour l’entreprise");
  assert.equal(fr.rows[3].label, "Vous devez à l’entreprise");
  const text = parkingMonthCustomerText(card, "Keren");
  assert.match(text, /Keren — Statement, October 2026/);
  assert.match(text, /Cash you hold for the business — \+\$36\.00/);
  assert.match(text, /YOU OWE THE BUSINESS: \$1,227\.00$/);
});

test("when the business owes them, the bill says so", () => {
  const { cards } = cardsFor({ alh: -200000 });
  const card = cards.find((c) => c.key === "phone:3475550101")!;
  assert.equal(billTotalsLayout(card, "en", 0).rows.at(-1)!.label, "The business owes you");
  assert.match(parkingMonthCustomerText(card, "Keren"), /THE BUSINESS OWES YOU: \$/);
});

test("a customer's bill is exactly as before (no statement fields)", () => {
  const { cards } = cardsFor({ alh: 3600 });
  const zed = cards.find((c) => c.key === "phone:2015550099")!;
  assert.deepEqual(billTotalsLayout(zed, "en", 0).rows.map((r) => r.label), ["Total for the month", "Balance due"]);
  assert.match(parkingMonthCustomerText(zed, "Keren"), /Monthly bill, October 2026/);
});

test("the cash request and answer", () => {
  assert.deepEqual(staffStatementCashRequest("biz", "2026-10"), { action: "staff_statement_cash", businessId: "biz", monthKey: "2026-10" });
  assert.deepEqual(staffStatementCashFrom({ held: { a: 3600, b: -50, c: "x", "": 5 } }), { a: 3600, b: -50 });
  assert.deepEqual(staffStatementCashFrom(null), {});
  assert.deepEqual(staffStatementCashFrom({ held: "nope" }), {});
  assert.equal(hasTeamBills([{ key: "phone:1" }, { key: "staff:s1" }]), true);
  assert.equal(hasTeamBills([{ key: "phone:1", linkedStaffIds: ["a"] }]), true);
  assert.equal(hasTeamBills([{ key: "phone:1", linkedStaffIds: ["a", "b"] }, { key: "phone:2" }]), false);
});

test("the invoices panel marks statements and lists team members it could not reach", () => {
  const preview = parseInvoicePreview({
    monthKey: "2026-10",
    recipients: [
      { kind: "statement", phone: "+12015550077", name: "Alhoussaine Barry", cars: [], totalDueCents: 122700, stillParked: false, alreadySent: false },
      { phone: "+12015550099", name: "Zed Camara", cars: [], totalDueCents: 46400 },
    ],
    skipped: [
      { kind: "statement", name: "Musa Kante", reason: "no_phone" },
      { kind: "invoice", name: "Ibra", reason: "needs_country_code" },
    ],
  });
  assert.deepEqual(preview.recipients.map((r) => r.kind), ["statement", "invoice"]);
  assert.deepEqual(preview.skippedMembers, [{ name: "Musa Kante", reason: "no_phone" }]);
  assert.equal(skippedMemberReason("no_phone"), "no phone number");
  assert.equal(skippedMemberReason("duplicate_phone"), "same number as another recipient");
});

test("every new string reads in French", () => {
  for (const english of [
    "Statement", "Owes the business", "The business owes them", "Settled", "parking and jobs", "expenses", "cash held",
    "Cash held for the business", "Included in the statement of", "Checking the cash team members hold…",
    "The cash team members hold could not be checked, so their bills show without it.",
    "money they took in for the business by the end of the month and have not handed over since",
    "Not sent: no number to reach", "no phone number", "number needs a country code", "same number as another recipient",
  ]) {
    assert.notEqual(translateValue(english, "fr"), english, `no French for "${english}"`);
  }
});

test("a team member's statement tick is found by the member, not only by their number", async () => {
  const { invoiceMessagesByCustomer } = await import("./parking-invoices.ts");
  const row = { id: "r1", kind: "invoice", monthKey: "2026-10", phone: "+12015550077", status: "sent", documentKind: "statement", staffId: "alh", template: "parking_invoice_2lang", createdAt: { seconds: 1, nanoseconds: 0 } };
  const byCard = invoiceMessagesByCustomer([row], "2026-10");
  assert.ok(byCard.has("phone:2015550077"));
  assert.ok(byCard.has("staff:alh"));
  // A customer's invoice has no member key.
  assert.equal(invoiceMessagesByCustomer([{ ...row, documentKind: "invoice", staffId: "" }], "2026-10").has("staff:alh"), false);
});
