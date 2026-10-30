import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { translateValue } from "./french-dom.ts";
import {
  carriedCarItem,
  monthBillPaymentPlan,
  parkingMonthCustomers,
  parkingMonthCustomerText,
  parkingMonthQueryPlan,
  parkingMonthSummary,
} from "./parking-month-statement.ts";

// Unpaid parking carried from cars that left in earlier months
// (docs/PARKING_CARRYOVER.md). The server's parking_month_statement.js is the
// rule; the shared fixture pins the server, this console mirror and the app
// to the same answers.
const fixtureUrl = new URL("../../../my_flutter_app/functions/test/fixtures/parking-carryover-cases.json", import.meta.url);
type FixtureCase = {
  name: string;
  monthKey: string;
  now: string;
  cars: Record<string, unknown>[];
  expect: { carried: unknown[]; customers: unknown[] };
};
const fixture = JSON.parse(readFileSync(fixtureUrl, "utf8")) as { cases: FixtureCase[] };
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("every shared carry-over case gives the server's answer", () => {
  assert.ok(fixture.cases.length >= 10, "the fixture has its cases");
  for (const k of fixture.cases) {
    const s = parkingMonthSummary(k.cars, k.monthKey, new Date(k.now), []);
    assert.deepEqual(
      s.carried.map((c) => ({
        id: c.id, periodFrom: c.periodFrom, periodTo: c.periodTo, days: c.days,
        accruedCents: c.accruedCents, dueCents: c.dueCents,
      })),
      k.expect.carried,
      `${k.name}: carried`,
    );
    assert.deepEqual(
      s.customers.map((c) => ({
        key: c.key, carIds: c.cars.map((b) => b.id), olderCarIds: c.olderCars.map((b) => b.id),
        monthCents: c.monthCents, priorUnpaidCents: c.priorUnpaidCents, dueCents: c.dueCents,
        owes: c.owes, paid: c.paid,
      })),
      k.expect.customers,
      `${k.name}: customers`,
    );
  }
});

const yao = fixture.cases.find((k) => k.name.startsWith("same phone"))!;
const yaoSummary = parkingMonthSummary(yao.cars, yao.monthKey, new Date(yao.now), []);
const customer = yaoSummary.customers[0];

test("a car that never left, or left inside the month, is not carried", () => {
  const now = new Date("2026-11-01T12:00:00Z");
  assert.equal(carriedCarItem({ parkingDate: "2026-09-01", dailyRate: 10 }, "2026-10", now), null);
  assert.equal(carriedCarItem({ parkingDate: "2026-09-01", parkingEndDate: "2026-10-02", amountDueCents: 100 }, "2026-10", now), null);
  assert.equal(carriedCarItem(null as unknown as Record<string, unknown>, "2026-10", now), null);
});

test("a carried car is tagged with the name it was registered under and sorted oldest first", () => {
  assert.ok(customer.olderCars.length > 0);
  for (const c of customer.olderCars) assert.ok(c.registeredTo, "every line names whose it was");
  const froms = customer.olderCars.map((c) => c.periodFrom);
  assert.deepEqual(froms, [...froms].sort());
  assert.equal(
    customer.priorUnpaidCents,
    customer.cars.reduce((s, b) => s + b.priorUnpaidCents, 0) + customer.olderCars.reduce((s, c) => s + c.dueCents, 0),
  );
});

test("the bill text lists the carried car first under Unpaid from before", () => {
  const text = parkingMonthCustomerText(customer, "Dala Parking");
  assert.match(text, /Unpaid from before\nSep 6, 2026 to Sep 7, 2026 · Parking · 2021 Toyota Highlander \(registered to Mariam\) — \$24\.00/);
  assert.match(text, /BALANCE DUE: \$588\.00/);
});

test("the heading shows when only cars (or only activities) are carried, once", () => {
  const onlyCar = fixture.cases.find((k) => k.name.startsWith("a customer with only"))!;
  const only = parkingMonthSummary(onlyCar.cars, onlyCar.monthKey, new Date(onlyCar.now), []).customers[0];
  const text = parkingMonthCustomerText(only, "Dala Parking");
  assert.equal(text.match(/^Unpaid from before$/gm)?.length, 1, text);
  assert.match(text, /· Parking ·/);
  // And with an older activity too: cars first, heading once.
  const mixed = {
    ...only,
    olderActivities: [{
      id: "a1", kind: "activity" as const, monthKey: only.monthKey, date: "2026-08-05", label: "Title", feeCents: 5000,
      paidCents: 0, dueCents: 5000, prior: true, customerName: "X", customerPhone: "", customerEmail: "", vehicle: "",
      vinNumber: "", trackingCode: "", paidVia: [], registeredTo: "",
    }],
  };
  const lines = parkingMonthCustomerText(mixed, "Dala Parking").split("\n");
  const heading = lines.indexOf("Unpaid from before");
  assert.ok(lines[heading + 1].includes("· Parking ·"), "the carried car comes first");
  assert.ok(lines[heading + 2].startsWith("Aug 5, 2026 · Title"), "then the older activity");
  assert.equal(lines.filter((l) => l === "Unpaid from before").length, 1);
});

test("Mark all paid records the carried car first, for what it still owes", () => {
  const plan = monthBillPaymentPlan(customer);
  assert.deepEqual(plan.items.map((i) => [i.kind, i.id, i.amountCents]), [["car", "highlander", 2400], ["car", "rogue", 56400]]);
  assert.equal(plan.totalCents, 58800);
});

test("a carried car that is not recordable by hand is skipped, like the month's cars", () => {
  const link = parkingMonthCustomers([], [], [{
    ...customer.olderCars[0], id: "linked", paymentMethod: "payment_link", recordable: false,
  }]);
  const plan = monthBillPaymentPlan(link[0]);
  assert.deepEqual(plan.items, []);
  assert.deepEqual(plan.skipped.map((s) => [s.id, s.reason]), [["linked", "payment_link"]]);
});

test("the query plan reads the unpaid cars with one not-in filter", () => {
  const plan = parkingMonthQueryPlan("2026-10")!;
  assert.deepEqual(plan.unpaidCars, { where: [["paymentStatus", "not-in", ["paid", "succeeded"]]] });
  assert.deepEqual(plan.cars.where, [["occupancyEndMs", ">=", Date.UTC(2026, 9, 1)]], "the month's own read is unchanged");
});

test("the month's inputs merge the unpaid-cars read with the month's cars by id", () => {
  const data = read("./business-data.ts");
  assert.match(data, /const unpaidCars = useBusinessCollection\("parkedCars", businessId, active, \{\s*\.\.\.complete,\s*where: plan\?\.unpaidCars\.where \?\? \[\],\s*\}\);/);
  assert.match(data, /mergePages\(\[cars\.rows, unpaidCars\.rows\]\)/);
  // Loading and error cover the new read too, so the view always resolves.
  assert.match(data, /loading: cars\.loading \|\| unpaidCars\.loading \|\|/);
  assert.match(data, /error: cars\.error \|\| unpaidCars\.error \|\|/);
});

test("Month end shows each carried car under Unpaid from before, with its dates", () => {
  const view = read("../components/business/parking-month-end.tsx");
  assert.match(view, /const olderCarLine = \(b: \(typeof customer\.olderCars\)\[number\]\) =>/);
  assert.match(view, /\["unpaid from before", b\.vinNumber, b\.registeredTo \? `registered to \$\{b\.registeredTo\}` : "", "left"\]/);
  assert.match(view, /formatDayKey\(b\.periodFrom\)\} → \{formatDayKey\(b\.periodTo\)/);
  assert.match(view, /moneyText\(b\.dueCents\)\} due/);
  assert.match(view, /\[\.\.\.customer\.olderCars\.map\(olderCarLine\), \.\.\.customer\.cars\.filter/, "carried cars lead the owing lines");
  // Their words read in French.
  for (const english of ["unpaid from before", "registered to", "left", "Open the car to record a payment"]) {
    assert.notEqual(translateValue(english, "fr"), english, `no French for "${english}"`);
  }
});

test("the printable bill lists carried cars under Unpaid from before", () => {
  const pdf = read("./parking-month-pdf.ts");
  assert.match(pdf, /if \(c\.olderCars\.length \|\| c\.olderActivities\.length\) \{\s*section\(t\.olderItems/);
  assert.match(pdf, /for \(const b of c\.olderCars\) \{\s*line\(`\$\{t\.parking\} · \$\{b\.vehicle \|\| t\.car\}`/);
});
