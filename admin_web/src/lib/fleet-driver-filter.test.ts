import assert from "node:assert/strict";
import test from "node:test";

import { driverFilterCounts, driverFilterNarrowed, emptyDriverFilter, filterDriverRows, type DriverRow } from "./fleet.ts";
import { translateValue } from "./french-dom.ts";

const row = (extra: Partial<DriverRow>): DriverRow => ({
  id: "x", name: "Driver", phone: "", status: "active", plate: "T1C", carId: "car", owedCents: 0, lateCents: 0,
  creditCents: 0, personalCents: 10, rentCents: 40000, search: "", ...extra,
});

const rows: DriverRow[] = [
  row({ id: "a", name: "Abdoul #46", owedCents: 40000, lateCents: 40000, personalCents: 18, search: "abdoul 646 t794504c" }),
  row({ id: "b", name: "Alpha #40", owedCents: 20000, personalCents: 20, search: "alpha" }),
  row({ id: "c", name: "Amadu #35", rentCents: 0, personalCents: 8, search: "amadu" }),
  row({ id: "d", name: "Bailey #36", carId: "", plate: "", personalCents: 54, search: "bailey" }),
  row({ id: "e", name: "Bangaly #21", creditCents: 4200, personalCents: 45, search: "bangaly" }),
  row({ id: "f", name: "Old driver", status: "left", carId: "", plate: "", rentCents: 0, owedCents: 5000, personalCents: null, search: "old" }),
];

test("Active by default, name order with numbers read as numbers", () => {
  assert.deepEqual(filterDriverRows(rows, emptyDriverFilter).map((r) => r.id), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(filterDriverRows(rows, { ...emptyDriverFilter, view: "left" }).map((r) => r.id), ["f"]);
  assert.equal(filterDriverRows(rows, { ...emptyDriverFilter, view: "all" }).length, 6);
});

test("chips: owes, late, no plate fee, no car, credit; they add up", () => {
  const f = emptyDriverFilter;
  assert.deepEqual(filterDriverRows(rows, { ...f, owes: true }).map((r) => r.id), ["a", "b"]);
  assert.deepEqual(filterDriverRows(rows, { ...f, late: true }).map((r) => r.id), ["a"]);
  assert.deepEqual(filterDriverRows(rows, { ...f, noFee: true }).map((r) => r.id), ["c"], "a car with no plate fee");
  assert.deepEqual(filterDriverRows(rows, { ...f, noCar: true }).map((r) => r.id), ["d"]);
  assert.deepEqual(filterDriverRows(rows, { ...f, credit: true }).map((r) => r.id), ["e"]);
  assert.deepEqual(filterDriverRows(rows, { ...f, owes: true, late: true }).map((r) => r.id), ["a"]);
  assert.deepEqual(filterDriverRows(rows, { ...f, view: "all", owes: true }).map((r) => r.id), ["a", "b", "f"]);
  assert.equal(driverFilterNarrowed(f), false);
  assert.equal(driverFilterNarrowed({ ...f, noFee: true }), true);
});

test("search and sorts", () => {
  assert.deepEqual(filterDriverRows(rows, { ...emptyDriverFilter, query: "t794504c" }).map((r) => r.id), ["a"]);
  assert.deepEqual(filterDriverRows(rows, { ...emptyDriverFilter, sort: "owed" }).map((r) => r.id).slice(0, 2), ["a", "b"]);
  assert.deepEqual(filterDriverRows(rows, { ...emptyDriverFilter, sort: "cents" }).map((r) => r.id), ["c", "a", "b", "e", "d"]);
});

test("counts: views over everyone, chips within the view", () => {
  assert.deepEqual(driverFilterCounts(rows, "active"), { active: 5, left: 1, all: 6, owes: 2, late: 1, credit: 1, noCar: 1, noFee: 1 });
  assert.equal(driverFilterCounts(rows, "all").owes, 3);
});

test("the filter words read in French", () => {
  for (const english of ["Owes money", "Late", "No plate fee", "No car", "Has credit", "Drivers shown:", "Owed by these drivers:", "No driver matches. Change the search or the filters."]) {
    assert.notEqual(translateValue(english, "fr"), english, `no French for "${english}"`);
  }
});
