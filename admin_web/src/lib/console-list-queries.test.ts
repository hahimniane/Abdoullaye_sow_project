// The lists that moved their filters into the query must still show what
// they showed when they filtered a (capped) download in memory. Each test
// replays the new query over a fixture with Firestore's semantics and
// requires the same rows (or the same summary) as the old in-memory read.

process.env.TZ = "UTC";

import assert from "node:assert/strict";
import test from "node:test";

import { parkingTotalsReloadKey, totalsReloadKey } from "./console-totals.ts";
import { invoiceBoard, invoiceListQuery } from "./invoice-ledger.ts";
import {
  LOT_CUSTOM_ACTIVITY_ID,
  lotActivityListQuery,
  lotActivityMonth,
  lotExpenseEntryMonth,
  lotExpenseEntryQueries,
  lotMonthSpanMs,
} from "./lot-ledger.ts";
import type { QueryFilterSpec } from "./paged-query.ts";
import { parkingMonthBoundsMs, parkingMonthQueryPlan, parkingMonthSummary } from "./parking-month-statement.ts";

type Row = Record<string, unknown> & { id: string };

const at = (iso: string) => {
  const date = new Date(iso);
  return { toDate: () => date, toMillis: () => date.getTime() };
};

/** A stored value as Firestore compares it (timestamps by time). */
function comparable(value: unknown): unknown {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === "object" && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return value;
}

/** One filter, the way Firestore applies it: a missing field never matches. */
function matches(row: Row, [field, op, value]: QueryFilterSpec): boolean {
  if (!(field in row)) return false;
  const a = comparable(row[field]);
  const b = comparable(value);
  switch (op) {
    case "==": return a === b;
    case "!=": return a !== null && a !== b;
    case "in": return (value as unknown[]).map(comparable).includes(a);
    case "<": return typeof a === typeof b && (a as number) < (b as number);
    case "<=": return typeof a === typeof b && (a as number) <= (b as number);
    case ">": return typeof a === typeof b && (a as number) > (b as number);
    case ">=": return typeof a === typeof b && (a as number) >= (b as number);
    default: throw new Error(`unhandled ${op}`);
  }
}
const replay = (rows: readonly Row[], filters: readonly QueryFilterSpec[]) =>
  rows.filter((row) => filters.every((f) => matches(row, f)));
const ids = (rows: readonly { id: string }[]) => rows.map((r) => r.id).sort();

// ---------------------------------------------------------------------------
// Lot ledger: the Activity list.
// ---------------------------------------------------------------------------

const activities: Row[] = [
  { id: "aug-title-paid", activityTypeId: "title", activityDate: at("2026-08-02T10:00:00Z"), paymentStatus: "succeeded" },
  { id: "sep-custom-owed", activityTypeId: LOT_CUSTOM_ACTIVITY_ID, activityDate: at("2026-09-30T23:59:00Z"), paymentStatus: "awaiting_direct_payment" },
  { id: "oct-title-link", activityTypeId: "title", activityDate: at("2026-10-01T00:00:00Z"), paymentStatus: "awaiting_payment_link" },
  { id: "oct-wash-paid-legacy", activityTypeId: "wash", activityDate: at("2026-10-03T00:00:00Z"), paymentStatus: "paid" },
  { id: "jul-title-owed", activityTypeId: "title", activityDate: at("2026-07-31T23:59:59Z"), paymentStatus: "awaiting_direct_payment" },
  { id: "nov-wash", activityTypeId: "wash", activityDate: at("2026-11-01T00:00:00Z"), paymentStatus: "succeeded" },
  { id: "sep-cancelled", activityTypeId: "title", activityDate: at("2026-09-10T00:00:00Z"), paymentStatus: "cancelled" },
];

/** What the panel did before: range by month, then type and payment pickers. */
function oldActivityFilter(rows: readonly Row[], start: string, end: string, typeFilter: string, payFilter: string) {
  return rows.filter((r) => {
    const mk = lotActivityMonth(r);
    if (!(mk >= start && mk <= end)) return false;
    if (typeFilter === "custom" && String(r.activityTypeId) !== LOT_CUSTOM_ACTIVITY_ID) return false;
    if (typeFilter !== "all" && typeFilter !== "custom" && String(r.activityTypeId) !== typeFilter) return false;
    const paid = String(r.paymentStatus) === "succeeded" || String(r.paymentStatus) === "paid";
    const owed = String(r.paymentStatus) === "awaiting_payment_link" || String(r.paymentStatus) === "awaiting_direct_payment";
    if (payFilter === "paid" && !paid) return false;
    if (payFilter === "owed" && !owed) return false;
    return true;
  });
}

test("the Activity list query returns exactly what the in-memory filter kept", () => {
  for (const [start, end] of [["2026-08", "2026-10"], ["2026-09", "2026-09"], ["2026-10", "2026-08"]]) {
    for (const typeFilter of ["all", "custom", "title", "wash"]) {
      for (const payFilter of ["all", "owed", "paid"] as const) {
        const query = lotActivityListQuery({ rangeStart: start, rangeEnd: end, typeFilter, payFilter });
        const [s, e] = start <= end ? [start, end] : [end, start];
        assert.deepEqual(
          ids(replay(activities, query.where)),
          ids(oldActivityFilter(activities, s, e, typeFilter, payFilter)),
          `${start}..${end} ${typeFilter} ${payFilter}`,
        );
        assert.equal(query.orderBy, "activityDate");
        assert.equal(query.direction, "desc");
        assert.ok(query.pageSize > 0, "paged, with Load more");
      }
    }
  }
});

test("a month span is UTC months, end exclusive, either way round", () => {
  assert.deepEqual(lotMonthSpanMs("2026-09", "2026-09"), { startMs: Date.UTC(2026, 8, 1), endMs: Date.UTC(2026, 9, 1) });
  assert.deepEqual(lotMonthSpanMs("2026-12", "2026-11"), { startMs: Date.UTC(2026, 10, 1), endMs: Date.UTC(2027, 0, 1) });
  assert.equal(lotMonthSpanMs("2026-13", "2026-01"), null);
});

test("the year's expense entries are every entry the year's months can count", () => {
  const entries: Row[] = [
    { id: "jan", month: "2026-01" },
    { id: "dec", month: "2026-12" },
    { id: "prev-year", month: "2025-12" },
    { id: "next-year", month: "2027-01" },
    { id: "undated-in-year", month: "", spentAt: "2026-05-04" },
  ];
  const plan = lotExpenseEntryQueries(2026);
  const read = [...replay(entries, plan.inYear), ...replay(entries, plan.undated)];
  const year = entries.filter((e) => lotExpenseEntryMonth(e).startsWith("2026"));
  assert.deepEqual(ids(read.filter((e) => lotExpenseEntryMonth(e).startsWith("2026"))), ids(year));
});

// ---------------------------------------------------------------------------
// Month-end parking bills: four narrow reads instead of the lot's history.
// ---------------------------------------------------------------------------

test("the month-end reads give exactly the whole-history summary", () => {
  const NOW = new Date("2026-10-01T13:00:00Z");
  // occupancyEndMs as the server stamps it: the leave date, or "never".
  const end = (finish?: string) => (finish ? Date.parse(finish) : Number.MAX_SAFE_INTEGER);
  const car = (id: string, parkingDate: string, parkingEndDate?: string, extra: Record<string, unknown> = {}): Row => ({
    id, customerPhone: `555${id.length}`, customerName: id, dailyRate: 10, status: "parked",
    parkingDate: at(parkingDate), ...(parkingEndDate ? { parkingEndDate: at(parkingEndDate) } : {}),
    occupancyEndMs: end(parkingEndDate), ...extra,
  });
  const cars = [
    car("old-closed", "2025-01-01T12:00:00Z", "2025-02-01T12:00:00Z", { paymentStatus: "succeeded", amountPaidCents: 31000 }),
    car("old-open", "2024-05-01T12:00:00Z"),
    car("ends-in-month", "2026-08-20T12:00:00Z", "2026-09-05T12:00:00Z"),
    car("ended-before", "2026-08-01T12:00:00Z", "2026-08-31T12:00:00Z"),
    car("in-month", "2026-09-10T12:00:00Z", "2026-09-12T12:00:00Z"),
    car("after-month", "2026-10-03T12:00:00Z"),
  ];
  const act = (id: string, fields: Record<string, unknown>): Row => ({ id, feeCents: 5000, customerPhone: "5559", customerName: "A", paymentStatus: "awaiting_direct_payment", ...fields });
  const acts = [
    act("old-paid", { activityDate: at("2025-03-01T12:00:00Z"), paymentStatus: "succeeded" }),
    act("old-unpaid", { activityDate: at("2026-06-15T12:00:00Z") }),
    act("in-month-paid", { activityDate: at("2026-09-03T12:00:00Z"), paymentStatus: "succeeded" }),
    act("in-month-unpaid", { activityDate: at("2026-09-30T12:00:00Z") }),
    act("future", { activityDate: at("2026-10-02T12:00:00Z") }),
    act("undated", { activityDate: null, createdAt: at("2026-09-08T12:00:00Z") }),
  ];
  const plan = parkingMonthQueryPlan("2026-09")!;
  const narrowCars = replay(cars, plan.cars.where);
  const seen = new Set<string>();
  const narrowActs = [...replay(acts, plan.inMonth.where), ...replay(acts, plan.unsettled.where), ...replay(acts, plan.undated.where)]
    .filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true)));
  const full = parkingMonthSummary(cars, "2026-09", NOW, acts);
  assert.deepEqual(parkingMonthSummary(narrowCars, "2026-09", NOW, narrowActs), full);
  assert.ok(full.customersOwing.length > 0, "the fixture exercises something");
  assert.ok(!ids(narrowCars).includes("old-closed") && !ids(narrowCars).includes("ended-before"), "and reads less than the history");
  assert.ok(!ids(narrowActs).includes("old-paid"));
  assert.deepEqual(parkingMonthBoundsMs("2026-09"), { startMs: Date.UTC(2026, 8, 1), endMs: Date.UTC(2026, 9, 1) });
  assert.equal(parkingMonthQueryPlan("nope"), null);
});

// ---------------------------------------------------------------------------
// Invoices: the state picker is in the query.
// ---------------------------------------------------------------------------

test("each invoice filter's query returns what the old filter kept", () => {
  const today = "2026-10-05";
  const invoices: Row[] = [
    { id: "open-due-past", status: "open", dueOn: "2026-09-01", issuedOn: "2026-08-01" },
    { id: "open-due-future", status: "open", dueOn: "2026-11-01", issuedOn: "2026-10-01" },
    { id: "open-no-due", status: "open", dueOn: "", issuedOn: "2026-10-02" },
    { id: "paid", status: "paid", dueOn: "2026-09-01", issuedOn: "2026-07-01" },
  ];
  assert.deepEqual(ids(replay(invoices, invoiceListQuery("overdue", today).where)), ["open-due-past"]);
  assert.deepEqual(ids(replay(invoices, invoiceListQuery("open", today).where)), ["open-due-future", "open-due-past", "open-no-due"]);
  assert.deepEqual(ids(replay(invoices, invoiceListQuery("paid", today).where)), ["paid"]);
  assert.deepEqual(ids(replay(invoices, invoiceListQuery("", today).where)), ids(invoices));
  assert.equal(invoiceListQuery("overdue", today).direction, "asc", "oldest due first: the ones to chase");
  assert.equal(invoiceListQuery("", today).orderBy, "issuedOn");
  // And the board the server counts is the definition over every invoice.
  assert.deepEqual(invoiceBoard(invoices.map((i) => ({ ...i, balanceCents: 100, paidCents: 50 })), today), {
    open: 3, overdue: 1, owedCents: 300, collectedCents: 200, count: 4,
  });
});

// ---------------------------------------------------------------------------
// When a server total is asked for again.
// ---------------------------------------------------------------------------

test("a totals reload key moves with money and state, and not with order or noise", () => {
  const a = { id: "a", status: "open", balanceCents: 100, updatedAt: at("2026-10-01T00:00:00Z"), note: "x" };
  const b = { id: "b", status: "paid", balanceCents: 0 };
  const key = totalsReloadKey([a, b]);
  assert.equal(totalsReloadKey([b, a]), key, "row order does not matter");
  assert.equal(totalsReloadKey([{ ...a, note: "y" }, b]), key, "a field that moves no money does not matter");
  assert.notEqual(totalsReloadKey([{ ...a, balanceCents: 50 }, b]), key);
  assert.notEqual(totalsReloadKey([{ ...a, updatedAt: at("2026-10-02T00:00:00Z") }, b]), key);
  assert.notEqual(totalsReloadKey([a]), key, "a record leaving the list");
  const stay = { id: "s", status: "parked", amountPaidCents: 0 };
  assert.notEqual(parkingTotalsReloadKey([{ ...stay, amountPaidCents: 500 }]), parkingTotalsReloadKey([stay]));
});
