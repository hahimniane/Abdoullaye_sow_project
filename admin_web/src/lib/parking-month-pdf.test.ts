// The month-end bill's totals block (docs/STAFF_EXPENSE_CREDIT.md): every
// amount prints on its own label's line - "Total for the month $4,942.00",
// "Less expenses -$448.31", the rule, "Balance due $4,493.69" - and a staff
// member's bill lists its expenses by their line's name, plus the earlier
// months' part, so the lines add up to "Less expenses".

process.env.TZ = "UTC";

import assert from "node:assert/strict";
import test from "node:test";

import {
  billTotalsLayout,
  buildParkingMonthBillPdf,
  drawBillTotals,
  type TotalsDoc,
} from "./parking-month-pdf.ts";
import { parkingMonthSummary, type ParkingMonthStaffCredit } from "./parking-month-statement.ts";

const at = (iso: string) => ({ toDate: () => new Date(`${iso}T12:00:00Z`) });
const NOV1 = new Date("2026-11-01T13:00:00Z");
const SOW = { customerName: "Abdoulaye Sow", customerPhone: "(347) 562-8973" };
const direct = { paymentMethod: "direct", source: "business", status: "reserved", paymentStatus: "awaiting_direct_payment" };
const cars = [
  { id: "camry", ...direct, ...SOW, parkingDate: at("2026-10-01"), dailyRate: 100, carYear: "2018", carMake: "Toyota", carModel: "Camry" },
  { id: "rav4", ...direct, ...SOW, parkingDate: at("2026-10-01"), parkingEndDate: at("2026-10-31"), amountDueCents: 184200, carYear: "2015", carMake: "Toyota", carModel: "RAV4" },
];
// Keren, October 2026: $212.76 of September purchases, $235.55 of October's.
const credit: ParkingMonthStaffCredit = {
  entries: [
    ...[5000, 4500, 4276, 4000, 3500].map((amountCents, i) => ({ id: `s${i}`, paidByStaffId: "abd", amountCents, month: "2026-09", spentAt: at(`2026-09-1${i}`), lineId: "groc" })),
    { id: "o1", paidByStaffId: "abd", amountCents: 8999, month: "2026-10", spentAt: at("2026-10-02"), lineId: "groc", note: "tissu, cups" },
    { id: "o2", paidByStaffId: "abd", amountCents: 6250, month: "2026-10", spentAt: at("2026-10-09"), lineId: "abd-line" },
    { id: "o3", paidByStaffId: "abd", amountCents: 4806, month: "2026-10", spentAt: at("2026-10-16"), lineId: "groc" },
    { id: "o4", paidByStaffId: "abd", amountCents: 3500, month: "2026-10", spentAt: at("2026-10-23") },
  ],
  repayments: [],
  lines: [{ id: "groc", label: "grosseries" }, { id: "abd-line", label: "abdoulaye sow" }],
  links: { abd: { customerKey: "phone:3475628973", customerName: "Abdoulaye Sow" } },
  staffNames: { abd: "Abdoulaye Sow" },
};
const netted = () => parkingMonthSummary(cars, "2026-10", NOV1, [], credit).customers[0];

const rowsOf = (layout: ReturnType<typeof billTotalsLayout>) => layout.rows.map((r) => [r.label, r.value, r.y]);

test("totals with expenses: each amount on its label's line, the rule above the balance", () => {
  const layout = billTotalsLayout(netted(), "en", 400);
  assert.deepEqual(rowsOf(layout), [
    ["Total for the month", "$4,942.00", 400],
    ["Less expenses", "-$448.31", 418],
    ["Balance due", "$4,493.69", 448],
  ]);
  assert.equal(layout.ruleY, 430);
  assert.ok(layout.ruleY > 418 && layout.ruleY < 448, "the rule sits between Less expenses and Balance due");
  assert.equal(layout.rows[2].bold, true);
});

test("totals without expenses: Total, Unpaid from before, Paid, Balance due", () => {
  const plain = parkingMonthSummary([
    { id: "civic", ...direct, ...SOW, parkingDate: at("2026-09-01"), parkingEndDate: at("2026-10-31"), amountDueCents: 61000, amountPaidCents: 10000, carYear: "2012", carMake: "Honda", carModel: "Civic" },
  ], "2026-10", NOV1).customers[0];
  const layout = billTotalsLayout(plain, "en", 100);
  const labels = layout.rows.map((r) => r.label);
  assert.equal(labels[0], "Total for the month");
  assert.equal(labels.at(-1), "Balance due");
  assert.ok(!labels.includes("Less expenses"));
  // Strictly top to bottom, one row each, the balance under the rule.
  const ys = layout.rows.map((r) => r.y);
  assert.deepEqual(ys, [...ys].sort((a, b) => a - b));
  assert.equal(new Set(ys).size, ys.length);
  assert.ok(layout.ruleY < ys.at(-1)! && layout.ruleY > ys.at(-2)!);
  // French copy, same places.
  const fr = billTotalsLayout(plain, "fr", 100);
  assert.deepEqual(fr.rows.map((r) => r.y), ys);
  assert.equal(fr.rows[0].label, "Total du mois");
});

test("totals with unpaid from before and payments: one line each", () => {
  const c = { ...netted(), priorUnpaidCents: 5000, expenseCreditCents: 0, dueCents: 499200 };
  c.cars = c.cars.map((b, i) => (i === 0 ? { ...b, monthPaidCents: 1000 } : b));
  const layout = billTotalsLayout(c, "en", 0);
  assert.deepEqual(rowsOf(layout), [
    ["Total for the month", "$4,942.00", 0],
    ["Unpaid from before", "$50.00", 18],
    [`Paid toward ${c.cars[0].vehicle}`, "-$10.00", 36],
    ["Balance due", "$4,992.00", 66],
  ]);
});

test("drawn: every amount's y is its label's y", () => {
  const calls: { text: string; x: number; y: number; right: boolean }[] = [];
  const lines: number[] = [];
  const fake: TotalsDoc = {
    setFont: () => fake,
    setFontSize: () => fake,
    setTextColor: () => fake,
    setDrawColor: () => fake,
    setLineWidth: () => fake,
    line: (_x1, y1) => { lines.push(y1); return fake; },
    text: (text, x, y, options) => { calls.push({ text, x, y, right: options?.align === "right" }); return fake; },
  };
  const layout = billTotalsLayout(netted(), "en", 400);
  drawBillTotals(fake, layout);
  const labels = calls.filter((c) => !c.right);
  const amounts = calls.filter((c) => c.right);
  assert.deepEqual(labels.map((c) => [c.text, c.y]), [["Total for the month", 400], ["Less expenses", 418], ["Balance due", 448]]);
  assert.deepEqual(amounts.map((c) => [c.text, c.y]), [["$4,942.00", 400], ["-$448.31", 418], ["$4,493.69", 448]]);
  assert.deepEqual(lines, [430]);
});

/** jsPDF's standard fonts write WinAnsi bytes: read them as Latin-1. */
const pdfText = async (blob: Blob) => Buffer.from(await blob.arrayBuffer()).toString("latin1");

/** The text a jsPDF document draws, with the y (from the top) of each. */
function drawnText(pdf: string): { text: string; y: number }[] {
  const out: { text: string; y: number }[] = [];
  for (const m of pdf.matchAll(/([\d.-]+) ([\d.-]+) Td\s*\n\(((?:\\.|[^\\)])*)\) Tj/g)) {
    out.push({ text: m[3].replace(/\\(.)/g, "$1"), y: Math.round((792 - Number(m[2])) * 100) / 100 });
  }
  return out;
}

test("the real PDF: amounts on their labels' lines, the expense lines and earlier months listed", async () => {
  const blob = await buildParkingMonthBillPdf({ business: { name: "Keren Auto Sales" }, customer: netted(), language: "en" });
  const drawn = drawnText(await pdfText(blob));
  const yOf = (text: string) => {
    const hits = drawn.filter((d) => d.text === text);
    assert.equal(hits.length, 1, `${text} drawn once (${JSON.stringify(drawn.map((d) => d.text))})`);
    return hits[0].y;
  };
  assert.equal(yOf("$4,942.00"), yOf("Total for the month"));
  assert.equal(yOf("-$448.31"), yOf("Less expenses"));
  assert.equal(yOf("$4,493.69"), yOf("Balance due"));
  assert.ok(yOf("Total for the month") < yOf("Less expenses") && yOf("Less expenses") < yOf("Balance due"));
  // Each expense by its line's name (note second); no note and no line: "Expense".
  for (const label of ["grosseries · tissu, cups", "abdoulaye sow", "grosseries", "Expense"]) yOf(label);
  assert.equal(yOf("-$212.76"), yOf("Expenses from earlier months"));
  // The listed lines add up to Less expenses.
  const listed = ["-$89.99", "-$62.50", "-$48.06", "-$35.00", "-$212.76"].map((v) => (yOf(v), Number(v.replace(/[^\d.]/g, ""))));
  assert.equal(Math.round(listed.reduce((s, v) => s + v, 0) * 100), 44831);
});

test("the real PDF in French lists the earlier months too", async () => {
  const blob = await buildParkingMonthBillPdf({ business: { name: "Keren" }, customer: netted(), language: "fr" });
  const drawn = drawnText(await pdfText(blob)).map((d) => d.text);
  assert.ok(drawn.includes("Dépenses des mois précédents"), JSON.stringify(drawn));
  assert.ok(drawn.includes("Moins les dépenses"));
});

// A car that left before the month and still owes (docs/PARKING_CARRYOVER.md)
// is listed under "Unpaid from before" on the printed bill, before the month's
// own total.
const carriedCustomer = () =>
  parkingMonthSummary([
    { id: "highlander", ...direct, customerName: "Mariam", customerPhone: "+12015550101", parkingDate: at("2026-09-06"), parkingEndDate: at("2026-09-07"), amountDueCents: 2400, carYear: "2021", carMake: "Toyota", carModel: "Highlander", vinNumber: "1abc" },
  ], "2026-10", NOV1, []).customers[0];

test("the real PDF lists a carried car under Unpaid from before", async () => {
  const drawn = drawnText(await pdfText(await buildParkingMonthBillPdf({ business: { name: "Dala Parking" }, customer: carriedCustomer(), language: "en" }))).map((d) => d.text);
  assert.ok(drawn.includes("Unpaid from before"), JSON.stringify(drawn));
  assert.ok(drawn.includes("Parking · 2021 Toyota Highlander"), JSON.stringify(drawn));
  assert.ok(drawn.includes("Sep 6, 2026 to Sep 7, 2026"), JSON.stringify(drawn));
  assert.ok(drawn.some((t) => t.startsWith("VIN 1ABC")), JSON.stringify(drawn));
  assert.ok(drawn.includes("$24.00"));
});

test("the real PDF lists a carried car in French too", async () => {
  const drawn = drawnText(await pdfText(await buildParkingMonthBillPdf({ business: { name: "Dala Parking" }, customer: carriedCustomer(), language: "fr" }))).map((d) => d.text);
  assert.ok(drawn.includes("Impayé des mois précédents"), JSON.stringify(drawn));
  assert.ok(drawn.includes("Parking · 2021 Toyota Highlander"), JSON.stringify(drawn));
});
