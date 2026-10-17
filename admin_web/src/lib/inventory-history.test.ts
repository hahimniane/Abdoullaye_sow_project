import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HISTORY_ZONE,
  addDays,
  aggregateHistory,
  bucketLabel,
  canGoNext,
  changePercent,
  changeText,
  customPeriod,
  dayKeyOf,
  emptyBuckets,
  granularityFor,
  historyTimeline,
  historyZone,
  periodBounds,
  periodFor,
  periodTitle,
  previousPeriod,
  shiftPeriod,
  startOfDayMs,
  timelineDayTitle,
  weekdayOf,
} from "./inventory-history.ts";

const NY = HISTORY_ZONE;
const iso = (ms: number) => new Date(ms).toISOString();

test("periods: a day, a Sunday-start week, a month, a year", () => {
  // 2026-10-16 is a Friday.
  assert.equal(weekdayOf("2026-10-16"), 5);
  assert.deepEqual(periodFor("day", "2026-10-16"), { kind: "day", startKey: "2026-10-16", endKey: "2026-10-16" });
  assert.deepEqual(periodFor("week", "2026-10-16"), { kind: "week", startKey: "2026-10-11", endKey: "2026-10-17" });
  // A Sunday starts its own week; a Saturday ends it.
  assert.equal(periodFor("week", "2026-10-11").startKey, "2026-10-11");
  assert.equal(periodFor("week", "2026-10-17").startKey, "2026-10-11");
  // A week across a year end.
  assert.deepEqual(periodFor("week", "2027-01-01"), { kind: "week", startKey: "2026-12-27", endKey: "2027-01-02" });
  assert.deepEqual(periodFor("month", "2028-02-10"), { kind: "month", startKey: "2028-02-01", endKey: "2028-02-29" });
  assert.deepEqual(periodFor("year", "2026-10-16"), { kind: "year", startKey: "2026-01-01", endKey: "2026-12-31" });
});

test("prev / next move by the period, a custom range by its length", () => {
  assert.equal(shiftPeriod(periodFor("day", "2026-03-01"), -1).startKey, "2026-02-28");
  assert.deepEqual(shiftPeriod(periodFor("week", "2026-10-16"), 1), { kind: "week", startKey: "2026-10-18", endKey: "2026-10-24" });
  assert.deepEqual(shiftPeriod(periodFor("month", "2026-01-31"), 1), { kind: "month", startKey: "2026-02-01", endKey: "2026-02-28" });
  assert.deepEqual(previousPeriod(periodFor("month", "2026-03-15")), { kind: "month", startKey: "2026-02-01", endKey: "2026-02-28" });
  assert.deepEqual(shiftPeriod(periodFor("year", "2026-06-01"), -1), { kind: "year", startKey: "2025-01-01", endKey: "2025-12-31" });
  const custom = customPeriod("2026-10-10", "2026-10-01")!;
  assert.deepEqual(custom, { kind: "custom", startKey: "2026-10-01", endKey: "2026-10-10" });
  assert.deepEqual(previousPeriod(custom), { kind: "custom", startKey: "2026-09-21", endKey: "2026-09-30" });
  assert.equal(customPeriod("2026-10-01", "nope"), null);
  // Never more than two years.
  assert.equal(customPeriod("2000-01-01", "2026-10-16")!.startKey, addDays("2026-10-16", -730));
  assert.equal(canGoNext(periodFor("day", "2026-10-15"), "2026-10-16"), true);
  assert.equal(canGoNext(periodFor("week", "2026-10-16"), "2026-10-16"), false);
});

test("a day is midnight to midnight in New York, 23 or 25 hours on DST days", () => {
  assert.equal(iso(startOfDayMs("2026-10-16", NY)), "2026-10-16T04:00:00.000Z");
  assert.equal(iso(startOfDayMs("2026-01-15", NY)), "2026-01-15T05:00:00.000Z");
  const spring = periodBounds(periodFor("day", "2026-03-08"), NY);
  assert.equal(iso(spring.startMs), "2026-03-08T05:00:00.000Z");
  assert.equal(iso(spring.endMs), "2026-03-09T04:00:00.000Z");
  assert.equal((spring.endMs - spring.startMs) / 3_600_000, 23);
  const fall = periodBounds(periodFor("day", "2026-11-01"), NY);
  assert.equal((fall.endMs - fall.startMs) / 3_600_000, 25);
  // The instant just before midnight belongs to the day before.
  assert.equal(dayKeyOf(Date.parse("2026-10-17T03:59:59Z"), NY), "2026-10-16");
  assert.equal(dayKeyOf(Date.parse("2026-10-17T04:00:00Z"), NY), "2026-10-17");
  // Another zone the business stores.
  assert.equal(iso(startOfDayMs("2026-10-16", "Africa/Conakry")), "2026-10-16T00:00:00.000Z");
});

test("the business's own zone wins when it is a real one", () => {
  assert.equal(historyZone({ timeZone: "Africa/Conakry" }), "Africa/Conakry");
  assert.equal(historyZone({ timeZone: "Mars/Olympus" }), NY);
  assert.equal(historyZone(null), NY);
});

test("chart buckets: hours of a day, days of a week or month, months of a year", () => {
  assert.equal(granularityFor(periodFor("day", "2026-10-16")), "hour");
  assert.equal(emptyBuckets(periodFor("day", "2026-10-16")).length, 24);
  assert.equal(emptyBuckets(periodFor("week", "2026-10-16")).length, 7);
  assert.equal(emptyBuckets(periodFor("month", "2026-02-16")).length, 28);
  assert.deepEqual(emptyBuckets(periodFor("year", "2026-10-16")).map((b) => b.key).slice(0, 2), ["2026-01", "2026-02"]);
  assert.equal(granularityFor(customPeriod("2026-01-01", "2026-06-30")!), "month");
  assert.equal(granularityFor(customPeriod("2026-10-01", "2026-10-20")!), "day");
  assert.equal(granularityFor(customPeriod("2026-10-01", "2026-10-01")!), "hour");
  assert.equal(emptyBuckets(customPeriod("2025-11-15", "2026-02-10")!).map((b) => b.key).join(","), "2025-11,2025-12,2026-01,2026-02");
  const week = periodFor("week", "2026-10-16");
  assert.equal(bucketLabel("13", "hour", week, "en"), "1 PM");
  assert.equal(bucketLabel("00", "hour", week, "en"), "12 AM");
  assert.equal(bucketLabel("13", "hour", week, "fr"), "13 h");
  assert.equal(bucketLabel("2026-10-11", "day", week, "en"), "Sun 11");
  assert.equal(bucketLabel("2026-10-11", "day", week, "fr"), "dim. 11");
  assert.equal(bucketLabel("2026-10-11", "day", periodFor("month", "2026-10-11"), "en"), "11");
  assert.equal(bucketLabel("2026-01", "month", periodFor("year", "2026-01-01"), "en"), "Jan");
});

const line = (itemId: string, quantity: number, sold: number, extra: Record<string, unknown> = {}) => ({
  itemId, name: itemId.toUpperCase(), quantity, listPriceCents: sold, soldPriceCents: sold, costCents: null, ...extra,
});

function sale(id: string, at: string, totalLines: ReturnType<typeof line>[], extra: Record<string, unknown> = {}) {
  const total = totalLines.reduce((sum, l) => sum + l.quantity * l.soldPriceCents, 0);
  return { id, createdAt: new Date(at), totalCents: total, lines: totalLines, paymentMethod: "cash", soldByStaffId: "anna", ...extra };
}

test("a day's figures: totals, average, paid now vs credit, profit from known costs, voids apart", () => {
  const day = periodFor("day", "2026-10-16");
  const rows = [
    sale("a", "2026-10-16T13:05:00Z", [line("cap", 2, 1000, { costCents: 400, brand: "Nike", brandId: "nike", categoryId: "hats", category: "Hats" })]),
    sale("b", "2026-10-16T22:30:00Z", [line("boubou", 1, 6000)], { paymentMethod: "zelle", soldByStaffId: "moussa",
      creditCents: 4000, creditPaidCents: 0, creditStatus: "open", credit: { customerName: "Fatou" } }),
    sale("v", "2026-10-16T15:00:00Z", [line("cap", 1, 1000)], { voided: true }),
    // Outside the day (New York): just after midnight of the 17th.
    sale("late", "2026-10-17T04:10:00Z", [line("cap", 9, 1000)]),
  ];
  const out = aggregateHistory({ rows, period: day, zone: NY });
  assert.deepEqual(out.kpis, {
    totalCents: 8000, count: 2, items: 3, averageCents: 4000, paidNowCents: 4000, creditCents: 4000,
    profitCents: 2000 - 800, linesWithoutCost: 1, profitKnown: true, voidedCount: 1, voidedCents: 1000,
  });
  assert.equal(out.granularity, "hour");
  // 13:05Z is 9 AM in New York, 22:30Z is 6 PM.
  assert.equal(out.buckets[9].totalCents, 2000);
  assert.equal(out.buckets[18].totalCents, 6000);
  assert.equal(out.buckets[18].creditCents, 4000);
  assert.deepEqual(out.bySeller.map((s) => [s.key, s.totalCents, s.count]), [["moussa", 6000, 1], ["anna", 2000, 1]]);
  assert.deepEqual(out.byMethod.map((m) => [m.method, m.cents]), [["credit", 4000], ["cash", 2000], ["zelle", 2000]]);
  assert.equal(out.byMethod.find((m) => m.method === "credit")?.label, "On credit");
  assert.deepEqual(out.topProducts.map((p) => [p.key, p.quantity, p.totalCents, p.name]), [["cap", 2, 2000, "Nike CAP"], ["boubou", 1, 6000, "BOUBOU"]]);
  assert.deepEqual(out.topBrands.map((b) => [b.key, b.name, b.totalCents]), [["__none__", "", 6000], ["nike", "Nike", 2000]]);
  assert.deepEqual(out.topCategories.map((c) => [c.key, c.name]), [["__none__", ""], ["hats", "Hats"]]);
});

test("an empty period is all zeros, with every bucket", () => {
  const out = aggregateHistory({ rows: [], period: periodFor("week", "2026-10-16"), zone: NY });
  assert.equal(out.kpis.count, 0);
  assert.equal(out.kpis.averageCents, 0);
  assert.equal(out.kpis.profitKnown, false);
  assert.equal(out.buckets.length, 7);
  assert.ok(out.buckets.every((b) => b.totalCents === 0));
  assert.deepEqual(out.byStore, []);
});

test("a sale on the fall-back night lands on the right day and hour", () => {
  // 2026-11-01 05:30Z is 1:30 AM EST (the second 1 AM); 05:30Z on Nov 1 is still Nov 1.
  const out = aggregateHistory({ rows: [sale("x", "2026-11-01T05:30:00Z", [line("a", 1, 100)])], period: periodFor("week", "2026-11-01"), zone: NY });
  assert.equal(out.buckets.find((b) => b.key === "2026-11-01")?.totalCents, 100);
  const day = aggregateHistory({ rows: [sale("x", "2026-11-01T05:30:00Z", [line("a", 1, 100)])], period: periodFor("day", "2026-11-01"), zone: NY });
  assert.equal(day.buckets[1].totalCents, 100);
});

test("by store: old sales count under the Main store", () => {
  const stores = [
    { id: "main", name: "Main store", address: "", phone: "", archived: false, isMain: true, createdAt: new Date("2026-01-01") },
    { id: "annex", name: "Annex", address: "", phone: "", archived: false, isMain: false, createdAt: new Date("2026-02-01") },
  ];
  const out = aggregateHistory({ rows: [
    sale("a", "2026-10-16T15:00:00Z", [line("a", 1, 500)], { storeId: "annex", storeName: "Annex" }),
    sale("b", "2026-10-16T16:00:00Z", [line("a", 1, 900)]),
  ], period: periodFor("day", "2026-10-16"), zone: NY, stores });
  assert.deepEqual(out.byStore.map((s) => [s.key, s.name, s.totalCents]), [["main", "Main store", 900], ["annex", "Annex", 500]]);
});

test("comparison with the period before", () => {
  assert.equal(changePercent(1200, 1000), 20);
  assert.equal(changePercent(800, 1000), -20);
  assert.equal(changePercent(500, 0), null);
  assert.equal(changeText(20, "en"), "+20%");
  assert.equal(changeText(-20, "fr"), "−20 %");
  assert.equal(changeText(null), "—");
});

test("the timeline: newest day first, sales with void markers, credit payments, stock changes", () => {
  const day = periodFor("week", "2026-10-16");
  const days = historyTimeline({
    period: day,
    zone: NY,
    sales: [
      sale("s1", "2026-10-12T15:00:00Z", [line("cap", 1, 1000), line("hat", 1, 500), line("sock", 2, 100)]),
      sale("s2", "2026-10-13T15:00:00Z", [line("cap", 1, 1000)], { voided: true, voidedAt: new Date("2026-10-14T15:00:00Z"), voidedByStaffId: "boss" }),
      sale("s3", "2026-10-13T16:00:00Z", [line("boubou", 1, 6000)], { creditCents: 6000, credit: { customerName: "Fatou" } }),
    ],
    payments: [
      { id: "p1", saleId: "s3", amountCents: 2000, method: "cash", receivedByStaffId: "anna", createdAt: new Date("2026-10-15T15:00:00Z"),
        reverted: true, revertedAt: new Date("2026-10-15T18:00:00Z"), revertedByStaffId: "boss" },
      { id: "p2", saleId: "old", amountCents: 1000, createdAt: new Date("2026-10-15T14:00:00Z") },
    ],
    movements: [
      { id: "m1", itemId: "cap", type: "add", delta: 5, byStaffId: "anna", createdAt: new Date("2026-10-15T13:00:00Z") },
      { id: "m2", itemId: "cap", type: "sale", delta: -1, createdAt: new Date("2026-10-12T15:00:00Z") },
      { id: "m3", itemId: "cap", type: "add", delta: 5, createdAt: new Date("2026-10-20T13:00:00Z") },
    ],
    itemName: (id) => (id === "cap" ? "Nike Cap" : ""),
    saleCustomer: (id) => (id === "old" ? "Awa" : ""),
  });
  assert.deepEqual(days.map((d) => d.dateKey), ["2026-10-15", "2026-10-14", "2026-10-13", "2026-10-12"]);
  assert.deepEqual(days[0].events.map((e) => e.kind), ["credit_reverted", "credit_payment", "credit_payment", "stock"]);
  assert.equal(days[0].events[1].customerName, "Fatou");
  assert.equal(days[0].events[1].voided, true);
  assert.equal(days[0].events[2].customerName, "Awa");
  assert.equal(days[0].events[3].title, "Nike Cap");
  assert.equal(days[0].events[3].delta, 5);
  assert.deepEqual(days[1].events.map((e) => [e.kind, e.saleId, e.staffId]), [["void", "s2", "boss"]]);
  assert.deepEqual(days[2].events.map((e) => [e.kind, e.saleId, e.voided]), [["sale", "s3", false], ["sale", "s2", true]]);
  assert.equal(days[2].events[0].creditCents, 6000);
  // A sale's own stock movement is the sale row, not a second row.
  assert.deepEqual(days[3].events.map((e) => [e.kind, e.title]), [["sale", "CAP, HAT +1"]]);
});

test("titles in both languages", () => {
  assert.equal(periodTitle(periodFor("day", "2026-10-16"), "en"), "Fri, Oct 16, 2026");
  assert.equal(periodTitle(periodFor("week", "2026-10-16"), "en"), "Oct 11 – Oct 17, 2026");
  assert.equal(periodTitle(periodFor("month", "2026-10-16"), "en"), "October 2026");
  assert.equal(periodTitle(periodFor("month", "2026-10-16"), "fr"), "octobre 2026");
  assert.equal(periodTitle(periodFor("year", "2026-10-16"), "fr"), "2026");
  assert.equal(periodTitle(customPeriod("2025-12-20", "2026-01-05")!, "en"), "Dec 20, 2025 – Jan 5, 2026");
  assert.equal(timelineDayTitle("2026-10-16", "2026-10-16", "fr"), "Aujourd’hui");
  assert.equal(timelineDayTitle("2026-10-15", "2026-10-16", "en"), "Yesterday");
  assert.equal(timelineDayTitle("2026-10-12", "2026-10-16", "en"), "Monday, Oct 12");
});
