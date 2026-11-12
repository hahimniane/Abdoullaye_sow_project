import assert from "node:assert/strict";
import test from "node:test";

import {
  billInView,
  carCompanies,
  carFilterCounts,
  emptyCarFilter,
  emptyPaymentsFilter,
  filterCarRows,
  filterGridRows,
  gridFilterCounts,
  paymentInView,
  type CarRow,
  type DriverRow,
  type GridRow,
} from "./fleet.ts";
import { translateValue } from "./french-dom.ts";

const cell = (state: "full" | "part" | "owed" | "none") => ({ month: "2026-11", paidCents: 0, dueCents: 0, state });
const grid = (driverId: string, name: string, last: "full" | "part" | "owed" | "none", totalCents: number): GridRow => ({
  driverId, name, search: name.toLowerCase(), cells: [cell("full"), cell(last)], totalCents,
});
const driver = (id: string, extra: Partial<DriverRow> = {}): DriverRow => ({
  id, name: id, phone: "", status: "active", plate: "", carId: "c", owedCents: 0, lateCents: 0, creditCents: 0,
  personalCents: 10, rentCents: 40000, search: "", ...extra,
});

test("Payments grid: view, this month's state, late, search, sort", () => {
  const rows = [grid("a", "Abdoul #46", "owed", 200000), grid("b", "Alpha #40", "part", 300000), grid("c", "Amadu #35", "full", 100000), grid("d", "Gone", "none", 5000)];
  const drivers = new Map([
    ["a", driver("a", { owedCents: 40000, lateCents: 40000 })],
    ["b", driver("b", { owedCents: 20000 })],
    ["c", driver("c")],
    ["d", driver("d", { status: "left" })],
  ]);
  const f = emptyPaymentsFilter;
  assert.deepEqual(filterGridRows(rows, drivers, f).map((r) => r.driverId), ["a", "b", "c"]);
  assert.deepEqual(filterGridRows(rows, drivers, { ...f, month: "owed" }).map((r) => r.driverId), ["a"]);
  assert.deepEqual(filterGridRows(rows, drivers, { ...f, month: "part" }).map((r) => r.driverId), ["b"]);
  assert.deepEqual(filterGridRows(rows, drivers, { ...f, month: "paid" }).map((r) => r.driverId), ["c"]);
  assert.deepEqual(filterGridRows(rows, drivers, { ...f, late: true }).map((r) => r.driverId), ["a"]);
  assert.deepEqual(filterGridRows(rows, drivers, { ...f, view: "left" }).map((r) => r.driverId), ["d"]);
  assert.deepEqual(filterGridRows(rows, drivers, { ...f, query: "alpha" }).map((r) => r.driverId), ["b"]);
  assert.deepEqual(filterGridRows(rows, drivers, { ...f, sort: "owed" }).map((r) => r.driverId), ["a", "b", "c"]);
  assert.deepEqual(filterGridRows(rows, drivers, { ...f, sort: "total" }).map((r) => r.driverId), ["b", "a", "c"]);
  assert.deepEqual(gridFilterCounts(rows, drivers, "active"), { active: 3, left: 1, all: 4, owed: 1, part: 1, paid: 1, late: 1 });
});

const car = (id: string, extra: Partial<CarRow>): CarRow => ({
  id, plate: id, company: "New Ride", status: "active", driverId: "d", driverName: "D", registrationExpiry: "2027-06-01",
  diamondExpiry: "2027-06-01", registration: "ok", diamond: "ok", search: id.toLowerCase(), ...extra,
});

test("Cars: with a driver or free, paperwork state, company, search, sort", () => {
  const rows = [
    car("T794504C", {}),
    car("T144619C", { driverId: "", driverName: "", company: "Fox" }),
    car("T117742C", { registration: "expired", registrationExpiry: "2026-10-01" }),
    car("T759003C", { diamond: "soon", diamondExpiry: "2026-12-01", company: "Fox" }),
    car("ASB04", { registration: "missing", registrationExpiry: "", driverId: "" }),
  ];
  const f = emptyCarFilter;
  assert.equal(filterCarRows(rows, f).length, 5);
  assert.deepEqual(filterCarRows(rows, f).map((r) => r.id), ["ASB04", "T117742C", "T144619C", "T759003C", "T794504C"]);
  assert.deepEqual(filterCarRows(rows, { ...f, view: "free" }).map((r) => r.id), ["ASB04", "T144619C"]);
  assert.deepEqual(filterCarRows(rows, { ...f, paper: "expired" }).map((r) => r.id), ["T117742C"]);
  assert.deepEqual(filterCarRows(rows, { ...f, paper: "soon" }).map((r) => r.id), ["T759003C"]);
  assert.deepEqual(filterCarRows(rows, { ...f, company: "Fox" }).map((r) => r.id), ["T144619C", "T759003C"]);
  assert.deepEqual(filterCarRows(rows, { ...f, query: "t7945" }).map((r) => r.id), ["T794504C"]);
  assert.equal(filterCarRows(rows, { ...f, sort: "expiry" })[0].id, "T117742C", "the soonest date first");
  assert.deepEqual(carFilterCounts(rows), { all: 5, driver: 3, free: 2, expired: 1, soon: 1, missing: 1 });
  assert.deepEqual(carCompanies(rows), ["Fox", "New Ride"]);
});

test("a driver's bills and payments by kind", () => {
  assert.equal(billInView({ status: "open" }, "open"), true);
  assert.equal(billInView({ status: "void" }, "waived"), true);
  assert.equal(billInView({ status: "paid" }, "open"), false);
  assert.equal(billInView({ status: "paid" }, "all"), true);
  assert.equal(paymentInView({ method: "zelle" }, "zelle"), true);
  assert.equal(paymentInView({ method: "import", imported: true }, "import"), true);
  assert.equal(paymentInView({ method: "zelle", imported: true }, "zelle"), false, "imported history is its own kind");
  assert.equal(paymentInView({ method: "other" }, "other"), true);
});

test("the new filter words read in French", () => {
  for (const english of ["Most paid first", "This month:", "All companies", "Paperwork due first", "Paperwork:", "No bill in this list.", "No payment in this list.", "No car matches. Change the search or the filters."]) {
    assert.notEqual(translateValue(english, "fr"), english, `no French for "${english}"`);
  }
});
