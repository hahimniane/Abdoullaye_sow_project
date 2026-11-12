import assert from "node:assert/strict";
import test from "node:test";

import {
  emptyMonthTableFilter,
  invoiceTally,
  monthRowDueCents,
  monthRowStatus,
  monthSearchMatches,
  monthTableCounts,
  monthTableNarrowed,
  monthTableRows,
  type MonthTableContext,
} from "./parking-month-table.ts";
import type { ParkingMonthCustomer } from "./parking-month-statement.ts";

type Car = ParkingMonthCustomer["cars"][number];

function car(extra: Partial<Car> = {}): Car {
  return {
    id: "car-1", monthKey: "2026-10", periodFrom: "2026-10-01", periodTo: "2026-10-31", days: 31, dayRateCents: 1200,
    monthCents: 37200, monthPaidCents: 0, monthDiscountCents: 0, monthUnpaidCents: 37200, priorUnpaidCents: 0, dueCents: 37200,
    owes: true, stillParked: true, partialMonth: false, customerName: "", customerPhone: "", customerEmail: "",
    vehicle: "2014 Honda Accord", vinNumber: "1HGCR2F3XEA004821", trackingCode: "PK-AAAAAA", forStaffId: "",
    paymentMethod: "direct", paidVia: [], registeredTo: "", ...extra,
  } as Car;
}

function card(extra: Partial<ParkingMonthCustomer> = {}): ParkingMonthCustomer {
  return {
    key: "phone:2015550142", monthKey: "2026-10", customerName: "Customer A", customerPhone: "+12015550142", customerEmail: "",
    forStaffId: "", cars: [car()], activities: [], olderActivities: [], olderCars: [],
    monthCents: 37200, monthPaidCents: 0, monthDiscountCents: 0, monthUnpaidCents: 37200, priorUnpaidCents: 0, dueCents: 37200,
    owes: true, paid: false, paidVia: [], partialMonth: false, dueBeforeExpensesCents: 37200, expenseCreditCents: 0,
    expenseLines: [], earlierExpenseCents: 0, linkedStaffIds: [], ...extra,
  };
}

const none: MonthTableContext = { lotIdsOf: () => ["biz_main"], invoiceFailed: () => false };

const notPaid = card({ key: "a", customerName: "Moussa Keita", dueCents: 110400, priorUnpaidCents: 36000 });
const partPaid = card({ key: "b", customerName: "Ibrahima Bah", customerPhone: "+12015550199", monthPaidCents: 50000, dueCents: 100000,
  cars: [car({ id: "c1" }), car({ id: "c2", vehicle: "2017 Toyota Camry", vinNumber: "4T1BF1FK7HU300937" })] });
const paid = card({ key: "c", customerName: "Aminata Condé", customerPhone: "+13475550101", dueCents: 0, owes: false, paid: true, monthPaidCents: 31000 });
const teamOwes = card({ key: "staff:u1", customerName: "Sekou Traoré", forStaffId: "u1", statementStaffId: "u1", statementOwesCents: 173000, cashHeldCents: 60000, expenseCreditCents: 31000 });
const teamOwed = card({ key: "staff:u2", customerName: "Cheick Diakité", forStaffId: "u2", statementStaffId: "u2", statementOwesCents: -31800 });
const included = card({ key: "phone:x", customerName: "Sekou's other bill", includedInStatementOf: "Sekou Traoré", dueCents: 9000 });
const cards = [paid, partPaid, teamOwed, notPaid, included, teamOwes];

test("status pill: a team statement speaks for itself, a bill by what is left", () => {
  assert.equal(monthRowStatus(notPaid), "not_paid");
  assert.equal(monthRowStatus(partPaid), "part_paid");
  assert.equal(monthRowStatus(paid), "paid");
  assert.equal(monthRowStatus(teamOwes), "team_owes");
  assert.equal(monthRowStatus(teamOwed), "team_owed");
  assert.equal(monthRowStatus(card({ statementOwesCents: 0 })), "team_settled");
  assert.equal(monthRowStatus(included), "included");
});

test("due: the statement's number for a team member, 0 inside someone's statement", () => {
  assert.equal(monthRowDueCents(teamOwes), 173000);
  assert.equal(monthRowDueCents(teamOwed), -31800);
  assert.equal(monthRowDueCents(included), 0);
  assert.equal(monthRowDueCents(partPaid), 100000);
});

test("Who owes: most owed first; included bills and the owed-to team member are left out", () => {
  const rows = monthTableRows(cards, emptyMonthTableFilter, none);
  assert.deepEqual(rows.map((r) => r.key), ["staff:u1", "a", "b"]);
});

test("Paid and Everyone; sort by name and by cars", () => {
  assert.deepEqual(monthTableRows(cards, { ...emptyMonthTableFilter, view: "paid" }, none).map((r) => r.key), ["c", "staff:u2"]);
  const everyone = monthTableRows(cards, { ...emptyMonthTableFilter, view: "all", sort: "name" }, none).map((r) => r.customerName);
  assert.deepEqual(everyone, ["Aminata Condé", "Cheick Diakité", "Ibrahima Bah", "Moussa Keita", "Sekou Traoré", "Sekou's other bill"]);
  assert.equal(monthTableRows(cards, { ...emptyMonthTableFilter, sort: "cars" }, none)[0].key, "b");
});

test("chips: part paid, team, from before, invoice not delivered, lot", () => {
  const f = emptyMonthTableFilter;
  assert.deepEqual(monthTableRows(cards, { ...f, part: true }, none).map((r) => r.key), ["b"]);
  assert.deepEqual(monthTableRows(cards, { ...f, team: true }, none).map((r) => r.key), ["staff:u1"]);
  assert.deepEqual(monthTableRows(cards, { ...f, view: "all", team: true }, none).map((r) => r.key), ["staff:u1", "staff:u2"]);
  assert.deepEqual(monthTableRows(cards, { ...f, older: true }, none).map((r) => r.key), ["a"]);
  const failedA: MonthTableContext = { ...none, invoiceFailed: (c) => c.key === "a" };
  assert.deepEqual(monthTableRows(cards, { ...f, notDelivered: true }, failedA).map((r) => r.key), ["a"]);
  const lots: MonthTableContext = { ...none, lotIdsOf: (c) => (c.key === "b" ? ["lot2"] : ["biz_main"]) };
  assert.deepEqual(monthTableRows(cards, { ...f, lotId: "lot2" }, lots).map((r) => r.key), ["b"]);
  assert.equal(monthTableNarrowed(f), false);
  assert.equal(monthTableNarrowed({ ...f, lotId: "lot2" }), true);
});

test("search: name without accents, phone in any format, VIN tail, car", () => {
  assert.equal(monthSearchMatches(teamOwes, "sekou traore"), true);
  assert.equal(monthSearchMatches(partPaid, "(201) 555-0199"), true);
  assert.equal(monthSearchMatches(partPaid, "5550199"), true);
  assert.equal(monthSearchMatches(partPaid, "300937"), true);
  assert.equal(monthSearchMatches(partPaid, "camry"), true);
  assert.equal(monthSearchMatches(partPaid, "lexus"), false);
  assert.equal(monthSearchMatches(partPaid, "  "), true);
  assert.deepEqual(monthTableRows(cards, { ...emptyMonthTableFilter, view: "all", query: "honda" }, none).length, 6);
});

test("counts: views across everyone, chips within the view", () => {
  const counts = monthTableCounts(cards, "owing", { ...none, invoiceFailed: (c) => c.key === "a" });
  assert.deepEqual(counts, { owing: 3, paid: 2, all: 6, part: 1, team: 1, older: 1, notDelivered: 1 });
});

test("invoice tally: delivered and read are seen; failed and stopped not delivered; skipped left out", () => {
  assert.deepEqual(invoiceTally([
    { state: "read", tick: "double-read" }, { state: "delivered", tick: "double" }, { state: "sent", tick: "single" },
    { state: "queued", tick: "clock" }, { state: "failed", tick: "cross" }, { state: "stopped", tick: "pause" }, { state: "skipped", tick: "dash" },
  ]), { total: 6, seen: 2, waiting: 2, failed: 2 });
});

test("invoice tally: a statement listed under its number and its member counts once", () => {
  const statement = { id: "invoice_b_2026-10_9175550117", state: "failed", tick: "cross" };
  assert.deepEqual(invoiceTally([statement, statement, { id: "x", state: "read", tick: "double-read" }]), { total: 2, seen: 1, waiting: 0, failed: 1 });
});
