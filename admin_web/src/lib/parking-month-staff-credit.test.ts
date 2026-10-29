// Staff expenses come off their parking bill (docs/STAFF_EXPENSE_CREDIT.md):
// the month-end statement with the netting in, Mark all paid after it, and
// the bill text - byte for byte the server's.

process.env.TZ = "UTC";

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import {
  monthBillPaymentPlan,
  parkingMonthCustomerText,
  parkingMonthSummary,
  type ParkingMonthStaffCredit,
} from "./parking-month-statement.ts";

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const server = require("../../../my_flutter_app/functions/parking_month_statement.js");

const at = (iso: string) => ({ toDate: () => new Date(`${iso}T12:00:00Z`) });
const NOV1 = new Date("2026-11-01T13:00:00Z");
const SOW = { customerName: "Abdoulaye Sow", customerPhone: "(347) 562-8973" };
const direct = { paymentMethod: "direct", source: "business", status: "reserved", paymentStatus: "awaiting_direct_payment" };
// October: $3,100.00 for a car still parked (31 days x $100) and $1,842.00
// for one parked the whole month and gone - $4,942.00 due.
const cars = [
  { id: "camry", ...direct, ...SOW, parkingDate: at("2026-10-01"), dailyRate: 100, carYear: "2018", carMake: "Toyota", carModel: "Camry" },
  { id: "rav4", ...direct, ...SOW, parkingDate: at("2026-10-01"), parkingEndDate: at("2026-10-31"), amountDueCents: 184200, carYear: "2015", carMake: "Toyota", carModel: "RAV4" },
];
// $448.31 of lot expenses he paid: $200.00 in September, $248.31 in October;
// a voided one and November's never count.
const credit: ParkingMonthStaffCredit = {
  entries: [
    { id: "e1", paidByStaffId: "abd", amountCents: 20000, month: "2026-09", spentAt: at("2026-09-20"), note: "Padlocks" },
    { id: "e2", paidByStaffId: "abd", amountCents: 24831, month: "2026-10", spentAt: at("2026-10-12"), note: "Light bulbs" },
    { id: "e3", paidByStaffId: "abd", amountCents: 5000, month: "2026-10", spentAt: at("2026-10-14"), voided: true },
    { id: "e4", paidByStaffId: "abd", amountCents: 9999, month: "2026-11", spentAt: at("2026-11-01") },
  ],
  repayments: [],
  links: { abd: { customerKey: "phone:3475628973", customerName: "Abdoulaye Sow" } },
  staffNames: { abd: "Abdoulaye Sow" },
};

test("without staff credit the month reads exactly as before", () => {
  const plain = parkingMonthSummary(cars, "2026-10", NOV1);
  const empty = parkingMonthSummary(cars, "2026-10", NOV1, [], { entries: [], repayments: [], links: {}, staffNames: {} });
  assert.equal(plain.dueCents, 494200);
  assert.equal(plain.expenseCreditCents, 0);
  assert.deepEqual(plain.businessOwes, []);
  const sow = plain.customers[0];
  assert.equal(sow.dueBeforeExpensesCents, 494200);
  assert.equal(sow.expenseCreditCents, 0);
  assert.deepEqual(sow.expenseLines, []);
  assert.deepEqual(sow.linkedStaffIds, []);
  assert.deepEqual(JSON.parse(JSON.stringify(empty)), JSON.parse(JSON.stringify(plain)));
  // And the bill text and the plan are untouched by the new fields.
  assert.equal(parkingMonthCustomerText(sow, "Keren"), server.parkingMonthCustomerText(sow, "Keren"));
  assert.doesNotMatch(parkingMonthCustomerText(sow, "Keren"), /expenses/i);
  assert.equal(monthBillPaymentPlan(sow).totalCents, 494200);
});

test("Abdoulaye: $4,942.00 due, $448.31 of expenses → $4,493.69", () => {
  const s = parkingMonthSummary(cars, "2026-10", NOV1, [], credit);
  const sow = s.customers[0];
  assert.equal(sow.dueBeforeExpensesCents, 494200);
  assert.equal(sow.expenseCreditCents, 44831);
  assert.equal(sow.dueCents, 449369);
  assert.deepEqual(sow.linkedStaffIds, ["abd"]);
  assert.equal(sow.owes, true);
  assert.equal(sow.paid, false);
  // Only October's own expense is a line; September's still counts in the credit.
  assert.deepEqual(sow.expenseLines, [
    { id: "e2", date: "2026-10-12", label: "Light bulbs", note: "Light bulbs", amountCents: 24831, staffId: "abd", staffName: "Abdoulaye Sow" },
  ]);
  // Still owed is after expenses; Billed and Collected are unchanged.
  assert.equal(s.dueCents, 449369);
  assert.equal(s.billedCents, 494200);
  assert.equal(s.collectedCents, 0);
  assert.equal(s.expenseCreditCents, 44831);
  assert.deepEqual(s.businessOwes, []);
  assert.equal(s.businessOwesCents, 0);
});

test("the bill text lists the expenses and takes them off, the same as the server's", () => {
  const sow = parkingMonthSummary(cars, "2026-10", NOV1, [], credit).customers[0];
  const textConsole = parkingMonthCustomerText(sow, "Keren Auto Sales");
  assert.equal(textConsole, server.parkingMonthCustomerText(JSON.parse(JSON.stringify(sow)), "Keren Auto Sales"));
  assert.equal(textConsole, [
    "Keren Auto Sales — Monthly bill, October 2026",
    "For: Abdoulaye Sow · (347) 562-8973",
    "",
    "Parking",
    "2015 Toyota RAV4 (registered to Abdoulaye Sow)",
    "  Oct 1, 2026 to Oct 31, 2026: 31 days × $59.42 — $1,842.00",
    "2018 Toyota Camry (registered to Abdoulaye Sow)",
    "  Oct 1, 2026 to Oct 31, 2026: 31 days × $100.00 — $3,100.00",
    "",
    "Expenses you paid for the lot",
    "Oct 12, 2026 · Light bulbs — -$248.31",
    "",
    "Total for October — $4,942.00",
    "Less expenses — -$448.31",
    "BALANCE DUE: $4,493.69",
  ].join("\n"));
});

test("Mark all paid records only what is left after the credit", () => {
  const sow = parkingMonthSummary(cars, "2026-10", NOV1, [], credit).customers[0];
  const plan = monthBillPaymentPlan(sow);
  assert.deepEqual(plan.items.map((x) => [x.id, x.amountCents]), [["rav4", 184200 - 44831], ["camry", 310000]]);
  assert.equal(plan.totalCents, 449369);
  // The server's plan agrees.
  const serverPlan = server.monthBillPaymentPlan(JSON.parse(JSON.stringify(sow)));
  assert.deepEqual(serverPlan.items.map((x: { id: string; amountCents: number }) => [x.id, x.amountCents]), plan.items.map((x) => [x.id, x.amountCents]));
  // A credit as big as the bill leaves nothing to record.
  const big = parkingMonthSummary(cars, "2026-10", NOV1, [], {
    ...credit,
    entries: [{ id: "x", paidByStaffId: "abd", amountCents: 600000, month: "2026-10", spentAt: at("2026-10-02") }],
  });
  assert.equal(monthBillPaymentPlan(big.customers[0]).items.length, 0);
});

test("credit bigger than the bill: paid in full, and the rest is what the business owes", () => {
  const owner = [{ id: "c1", ...direct, customerName: "Alhoussaine Barry", customerPhone: "347-237-8209", parkingDate: at("2026-10-01"), parkingEndDate: at("2026-10-02"), amountDueCents: 2000 }];
  const s = parkingMonthSummary(owner, "2026-10", NOV1, [], {
    entries: [{ id: "e1", paidByStaffId: "owner", amountCents: 3500, month: "2026-10", spentAt: at("2026-10-05") }],
    repayments: [],
    links: { owner: { customerKey: "phone:3472378209" } },
    staffNames: { owner: "Alhoussaine Barry" },
  });
  const barry = s.customers[0];
  assert.equal(barry.expenseCreditCents, 2000);
  assert.equal(barry.dueCents, 0);
  assert.equal(barry.owes, false);
  assert.equal(barry.paid, true);
  assert.deepEqual(s.customersPaid.map((c) => c.key), ["phone:3472378209"]);
  assert.deepEqual(s.customersOwing, []);
  assert.equal(s.dueCents, 0);
  assert.deepEqual(s.businessOwes, [{ staffId: "owner", staffName: "Alhoussaine Barry", customerKey: "phone:3472378209", owedCents: 1500 }]);
  assert.equal(s.businessOwesCents, 1500);
  const text = parkingMonthCustomerText(barry, "Keren");
  assert.match(text, /Less expenses — -\$20\.00\nPAID IN FULL$/);
  assert.equal(text, server.parkingMonthCustomerText(JSON.parse(JSON.stringify(barry)), "Keren"));
  // A paid-back record lowers what is owed; a voided one does not.
  const repaid = parkingMonthSummary(owner, "2026-10", NOV1, [], {
    entries: [{ id: "e1", paidByStaffId: "owner", amountCents: 3500, month: "2026-10" }],
    repayments: [{ staffId: "owner", amountCents: 1000, month: "2026-10" }, { staffId: "owner", amountCents: 500, month: "2026-10", voided: true }],
    links: { owner: { customerKey: "phone:3472378209" } },
    staffNames: { owner: "Alhoussaine Barry" },
  });
  assert.equal(repaid.businessOwesCents, 500);
});

test("staff with credit and no link are owed it all; the bills are untouched", () => {
  const s = parkingMonthSummary(cars, "2026-10", NOV1, [], { ...credit, links: {} });
  assert.equal(s.customers[0].dueCents, 494200);
  assert.deepEqual(s.businessOwes, [{ staffId: "abd", staffName: "Abdoulaye Sow", customerKey: "", owedCents: 44831 }]);
});
