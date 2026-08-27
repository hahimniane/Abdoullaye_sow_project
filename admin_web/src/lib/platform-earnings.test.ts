// What the platform actually earned, as opposed to what customers were charged.
//
// The Finance page used to show only gross ("visible amount $4,356.00"), which
// the owner read as revenue. These tests pin the three rules that make the new
// summary trustworthy: money is earned only once it is collected, direct/Zelle
// records never produce commission, and the two breakdowns always add back up
// to the headline numbers.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  commissionState,
  isNonCommissionable,
  summarizePlatformEarnings,
  type PlatformEarningsBucket,
} from "./platform-earnings.ts";

const BUCKET_FIELDS: Array<keyof PlatformEarningsBucket> = [
  "earnedCents",
  "pendingCents",
  "grossCents",
  "notCommissionableCents",
  "voidCents",
  "records",
];

function sumOf(rows: PlatformEarningsBucket[], field: keyof PlatformEarningsBucket) {
  return rows.reduce((total, row) => total + row[field], 0);
}

function assertBreakdownsSumToTotals(summary: ReturnType<typeof summarizePlatformEarnings>) {
  for (const field of BUCKET_FIELDS) {
    assert.equal(
      sumOf(summary.byBusiness, field),
      summary.totals[field],
      `byBusiness.${String(field)} must sum to totals.${String(field)}`,
    );
    assert.equal(
      sumOf(summary.byService, field),
      summary.totals[field],
      `byService.${String(field)} must sum to totals.${String(field)}`,
    );
  }
}

test("a collected parking becomes earned commission, an unpaid one becomes pending", () => {
  const summary = summarizePlatformEarnings({
    parkedCars: [
      {
        id: "paid",
        businessId: "biz-1",
        paymentMethod: "payment_link",
        paymentStatus: "succeeded",
        totalCostCents: 20000,
        platformFeeCents: 2000,
      },
      {
        id: "unpaid",
        businessId: "biz-1",
        paymentMethod: "payment_link",
        paymentStatus: "pending",
        totalCostCents: 10000,
        platformFeeCents: 1000,
      },
    ],
    businesses: [{ id: "biz-1", name: "Atlantic Lot" }],
  });

  assert.equal(summary.totals.earnedCents, 2000);
  assert.equal(summary.totals.pendingCents, 1000);
  assert.equal(summary.totals.grossCents, 30000);
  assert.equal(summary.totals.records, 2);
  assert.equal(summary.byBusiness[0].name, "Atlantic Lot");
  assert.equal(summary.byBusiness[0].earnedCents, 2000);
  assertBreakdownsSumToTotals(summary);
});

test("a direct/Zelle parking is neither earned nor pending, it is not commissionable", () => {
  const summary = summarizePlatformEarnings({
    parkedCars: [
      {
        id: "direct-awaiting",
        businessId: "biz-1",
        source: "business",
        paymentMethod: "direct",
        platformBilled: false,
        paymentStatus: "awaiting_direct_payment",
        payoutStatus: "not_applicable",
        totalCostCents: 15000,
        platformFeeCents: 0,
      },
      {
        // The lot marked it received. Real money moved, but not through us.
        id: "direct-paid",
        businessId: "biz-1",
        source: "business",
        paymentMethod: "direct",
        platformBilled: false,
        paymentStatus: "paid",
        payoutStatus: "not_applicable",
        totalCostCents: 25000,
        platformFeeCents: 0,
      },
    ],
    businesses: [{ id: "biz-1", name: "Atlantic Lot" }],
  });

  assert.equal(summary.totals.earnedCents, 0);
  assert.equal(summary.totals.pendingCents, 0);
  assert.equal(summary.totals.notCommissionableCents, 40000);
  assert.equal(summary.totals.grossCents, 40000);
  assert.equal(summary.totals.records, 2);
  assertBreakdownsSumToTotals(summary);
});

test("a direct row keeps its zero commission even when a stale fee field survives on it", () => {
  const summary = summarizePlatformEarnings({
    parkedCars: [
      {
        id: "direct-with-stale-fee",
        businessId: "biz-1",
        paymentMethod: "direct",
        paymentStatus: "paid",
        totalCostCents: 30000,
        // Left over from an edit that switched the row off a payment link.
        platformFeeCents: 3000,
        platformFeePct: 0.1,
      },
    ],
  });

  assert.equal(summary.totals.earnedCents, 0);
  assert.equal(summary.totals.pendingCents, 0);
  assert.equal(summary.totals.notCommissionableCents, 30000);
});

test("isNonCommissionable recognises every off-platform signal the server writes", () => {
  assert.equal(isNonCommissionable({ id: "a", paymentMethod: "direct" }), true);
  assert.equal(isNonCommissionable({ id: "b", platformBilled: false }), true);
  assert.equal(isNonCommissionable({ id: "c", payoutStatus: "not_applicable" }), true);
  assert.equal(
    isNonCommissionable({ id: "d", paymentStatus: "collected_by_business" }),
    true,
  );
  assert.equal(isNonCommissionable({ id: "e", paymentMethod: "  DIRECT  " }), true);
  assert.equal(
    isNonCommissionable({ id: "f", paymentMethod: "payment_link", paymentStatus: "succeeded" }),
    false,
  );
});

test("legacy platformCommissionCents and platformFeePct rows are picked up", () => {
  const summary = summarizePlatformEarnings({
    shipments: [
      {
        id: "legacy-cents",
        businessId: "biz-1",
        paymentStatus: "succeeded",
        totalCents: 40000,
        platformCommissionCents: 4000,
      },
    ],
    transports: [
      {
        id: "rate-only",
        businessId: "biz-2",
        paymentStatus: "succeeded",
        totalCents: 50000,
        platformFeePct: 0.12,
      },
      {
        id: "legacy-rate",
        businessId: "biz-2",
        paymentStatus: "pending",
        totalCents: 10000,
        platformCommissionRate: 0.05,
      },
    ],
  });

  assert.equal(summary.totals.earnedCents, 4000 + 6000);
  assert.equal(summary.totals.pendingCents, 500);
  assertBreakdownsSumToTotals(summary);
});

test("an explicit fee in cents wins over a rate on the same row", () => {
  const summary = summarizePlatformEarnings({
    shipments: [
      {
        id: "both",
        paymentStatus: "succeeded",
        totalCents: 100000,
        platformFeeCents: 700,
        platformFeePct: 0.25,
      },
    ],
  });

  assert.equal(summary.totals.earnedCents, 700);
});

test("cancelled and failed records are void, not pending revenue", () => {
  const summary = summarizePlatformEarnings({
    shipments: [
      { id: "cancelled", paymentStatus: "cancelled", totalCents: 10000, platformFeeCents: 1000 },
      { id: "failed", paymentStatus: "failed", totalCents: 20000, platformFeeCents: 2000 },
      { id: "live", paymentStatus: "pending", totalCents: 30000, platformFeeCents: 3000 },
    ],
  });

  assert.equal(summary.totals.pendingCents, 3000);
  assert.equal(summary.totals.earnedCents, 0);
  assert.equal(summary.totals.voidCents, 30000);
  assert.equal(summary.totals.grossCents, 30000);
  assertBreakdownsSumToTotals(summary);
});

test("records with no paymentStatus fall back to their lifecycle status", () => {
  const summary = summarizePlatformEarnings({
    purchases: [
      {
        id: "old-purchase",
        purchaseStatus: "completed",
        depositAmountCents: 50000,
        platformFeeCents: 5000,
      },
      {
        id: "open-purchase",
        purchaseStatus: "reserved",
        depositAmountCents: 20000,
        platformFeeCents: 2000,
      },
    ],
  });

  assert.equal(summary.totals.earnedCents, 5000);
  assert.equal(summary.totals.pendingCents, 2000);
});

test("a paid hold extension is counted as a second car-sales line", () => {
  const summary = summarizePlatformEarnings({
    purchases: [
      {
        id: "purchase-1",
        businessId: "biz-1",
        paymentStatus: "succeeded",
        depositAmountCents: 50000,
        platformFeeCents: 5000,
        extensionPaymentStatus: "succeeded",
        extensionExtraAmountCents: 10000,
        extensionPlatformFeeCents: 1000,
      },
    ],
  });

  const carSales = summary.byService.find((row) => row.serviceId === "carSales");
  assert.equal(carSales?.earnedCents, 6000);
  assert.equal(carSales?.records, 2);
  assert.equal(summary.totals.earnedCents, 6000);
  assertBreakdownsSumToTotals(summary);
});

test("unsettled v2 freight is expected revenue, settled v2 freight is earned", () => {
  const summary = summarizePlatformEarnings({
    freightShipments: [
      {
        id: "awaiting-weight",
        freightPricingVersion: 2,
        paymentStatus: "succeeded",
        priceSettlementStatus: "awaiting_weight",
        estimatedTotalCents: 100000,
        platformFeeCents: 10000,
      },
      {
        id: "settled",
        freightPricingVersion: 2,
        paymentStatus: "succeeded",
        priceSettlementStatus: "settled",
        estimatedTotalCents: 100000,
        finalTotalCents: 125000,
        platformFeeCents: 12500,
      },
    ],
  });

  const freight = summary.byService.find((row) => row.serviceId === "freight");
  assert.equal(freight?.earnedCents, 12500);
  assert.equal(freight?.pendingCents, 10000);
  assert.equal(freight?.grossCents, 225000);
});

test("every service reports separately and the ids match the shared vocabulary", () => {
  const summary = summarizePlatformEarnings({
    parkedCars: [{ id: "p", paymentStatus: "succeeded", totalCostCents: 1000, platformFeeCents: 100 }],
    shipments: [{ id: "b", paymentStatus: "succeeded", totalCents: 2000, platformFeeCents: 200 }],
    freightShipments: [{ id: "f", paymentStatus: "succeeded", totalCents: 3000, platformFeeCents: 300 }],
    transports: [{ id: "t", paymentStatus: "succeeded", totalCents: 4000, platformFeeCents: 400 }],
    purchases: [{ id: "c", paymentStatus: "succeeded", depositAmountCents: 5000, platformFeeCents: 500 }],
  });

  assert.deepEqual(
    summary.byService.map((row) => row.serviceId).sort(),
    ["barrelShipping", "carParking", "carSales", "carTransport", "freight"],
  );
  assert.equal(summary.totals.earnedCents, 1500);
  assertBreakdownsSumToTotals(summary);
});

test("businesses are named from the business list and sorted by what they earned us", () => {
  const summary = summarizePlatformEarnings({
    shipments: [
      { id: "s1", businessId: "biz-small", paymentStatus: "succeeded", totalCents: 10000, platformFeeCents: 500 },
      { id: "s2", businessId: "biz-big", paymentStatus: "succeeded", totalCents: 90000, platformFeeCents: 9000 },
      // Names the business only by name, the way older records do.
      { id: "s3", businessName: "Big Freight Co", paymentStatus: "pending", totalCents: 5000, platformFeeCents: 250 },
      // Names no business at all.
      { id: "s4", paymentStatus: "succeeded", totalCents: 1000, platformFeeCents: 100 },
    ],
    businesses: [
      { id: "biz-big", name: "Big Freight Co" },
      { id: "biz-small", name: "Corner Lot" },
    ],
  });

  assert.equal(summary.byBusiness[0].name, "Big Freight Co");
  assert.equal(summary.byBusiness[0].earnedCents, 9000);
  assert.equal(summary.byBusiness[0].pendingCents, 250, "name-only rows join the same business");
  assert.equal(summary.byBusiness[1].name, "Corner Lot");
  assert.ok(
    summary.byBusiness.some((row) => row.name === "Unassigned business"),
    "records naming no business must still be visible",
  );
  assertBreakdownsSumToTotals(summary);
});

test("the series buckets by day over a short range and by month over a long one", () => {
  const daily = summarizePlatformEarnings({
    shipments: [
      { id: "a", paymentStatus: "succeeded", paidAt: "2026-08-01T10:00:00Z", totalCents: 10000, platformFeeCents: 1000 },
      { id: "b", paymentStatus: "succeeded", paidAt: "2026-08-03T10:00:00Z", totalCents: 10000, platformFeeCents: 1500 },
      { id: "c", paymentStatus: "pending", createdAt: "2026-08-03T12:00:00Z", totalCents: 10000, platformFeeCents: 400 },
    ],
  });

  assert.equal(daily.series.granularity, "day");
  assert.deepEqual(
    daily.series.points.map((point) => point.key),
    ["2026-08-01", "2026-08-02", "2026-08-03"],
    "the empty middle day must stay in the range instead of closing up",
  );
  assert.equal(daily.series.points[0].earnedCents, 1000);
  assert.equal(daily.series.points[1].earnedCents, 0);
  assert.equal(daily.series.points[2].earnedCents, 1500);
  assert.equal(daily.series.points[2].pendingCents, 400);
  assert.equal(
    daily.series.points.reduce((sum, point) => sum + point.earnedCents, 0),
    daily.totals.earnedCents,
  );

  const monthly = summarizePlatformEarnings({
    shipments: [
      { id: "a", paymentStatus: "succeeded", paidAt: "2026-01-15T10:00:00Z", totalCents: 10000, platformFeeCents: 1000 },
      { id: "b", paymentStatus: "succeeded", paidAt: "2026-08-15T10:00:00Z", totalCents: 10000, platformFeeCents: 2000 },
    ],
  });
  assert.equal(monthly.series.granularity, "month");
  assert.equal(monthly.series.points.length, 8);
  assert.equal(monthly.series.points[0].key, "2026-01");
  assert.equal(monthly.series.points[7].key, "2026-08");
});

test("the series prefers the paid date over the created date", () => {
  const summary = summarizePlatformEarnings({
    shipments: [
      {
        id: "a",
        paymentStatus: "succeeded",
        createdAt: "2026-08-01T10:00:00Z",
        paidAt: "2026-08-04T10:00:00Z",
        totalCents: 10000,
        platformFeeCents: 1000,
      },
    ],
  });

  assert.equal(summary.series.points.length, 1);
  assert.equal(summary.series.points[0].key, "2026-08-04");
});

test("undated records stay in the totals and are reported as absent from the chart", () => {
  const summary = summarizePlatformEarnings({
    shipments: [
      { id: "dated", paymentStatus: "succeeded", paidAt: "2026-08-01T10:00:00Z", totalCents: 10000, platformFeeCents: 1000 },
      { id: "undated", paymentStatus: "succeeded", totalCents: 20000, platformFeeCents: 2000 },
    ],
  });

  assert.equal(summary.totals.earnedCents, 3000);
  assert.equal(summary.series.undatedRecords, 1);
  assert.equal(summary.series.points.reduce((sum, point) => sum + point.earnedCents, 0), 1000);
});

test("Firestore timestamps and Date objects are both understood", () => {
  const summary = summarizePlatformEarnings({
    shipments: [
      {
        id: "timestamp",
        paymentStatus: "succeeded",
        paidAt: { toDate: () => new Date("2026-08-02T00:00:00Z") },
        totalCents: 10000,
        platformFeeCents: 1000,
      },
      {
        id: "date",
        paymentStatus: "succeeded",
        paidAt: new Date("2026-08-02T00:00:00Z"),
        totalCents: 10000,
        platformFeeCents: 500,
      },
    ],
  });

  assert.equal(summary.series.points.length, 1);
  assert.equal(summary.series.points[0].earnedCents, 1500);
});

test("string amounts and string rates are read, not dropped", () => {
  const summary = summarizePlatformEarnings({
    shipments: [
      { id: "strings", paymentStatus: "succeeded", total: "250", platformFeePct: "0.1" },
    ],
  });

  assert.equal(summary.totals.grossCents, 25000);
  assert.equal(summary.totals.earnedCents, 2500);
});

test("malformed and hostile records never throw and never invent money", () => {
  const summary = summarizePlatformEarnings({
    shipments: [
      {} as never,
      null as never,
      undefined as never,
      { id: "nan", paymentStatus: "succeeded", totalCents: Number.NaN, platformFeeCents: Number.NaN },
      { id: "negative", paymentStatus: "succeeded", totalCents: -5000, platformFeeCents: -500 },
      { id: "infinite", paymentStatus: "succeeded", totalCents: Number.POSITIVE_INFINITY },
      { id: "bad-date", paymentStatus: "succeeded", paidAt: "not a date", totalCents: 10000, platformFeeCents: 1000 },
      { id: "fee-over-gross", paymentStatus: "succeeded", totalCents: 1000, platformFeeCents: 999999 },
      { id: "junk-status", paymentStatus: 42, totalCents: 2000, platformFeeCents: 200 },
    ],
    parkedCars: "not an array" as never,
    businesses: [null as never, { id: "x" }, { name: "y" } as never],
  });

  assert.ok(Number.isFinite(summary.totals.earnedCents));
  assert.ok(Number.isInteger(summary.totals.earnedCents));
  assert.ok(Number.isInteger(summary.totals.pendingCents));
  assert.ok(Number.isInteger(summary.totals.grossCents));
  assert.equal(
    summary.totals.earnedCents,
    1000 + 1000,
    "the undated-but-paid row earns, and a fee larger than the gross is clamped to the gross",
  );
  assert.equal(
    summary.totals.pendingCents,
    200,
    "a paymentStatus that is not a string is unrecognised, so its money is expected, not collected",
  );
  assert.equal(summary.series.undatedRecords >= 1, true);
  assertBreakdownsSumToTotals(summary);
});

test("no records at all produces an honest set of zeroes", () => {
  const summary = summarizePlatformEarnings();

  assert.equal(summary.totals.earnedCents, 0);
  assert.equal(summary.totals.pendingCents, 0);
  assert.equal(summary.totals.grossCents, 0);
  assert.equal(summary.totals.records, 0);
  assert.deepEqual(summary.byBusiness, []);
  assert.deepEqual(summary.byService, []);
  assert.deepEqual(summary.series.points, []);
});

test("commissionState reads paymentStatus before any lifecycle status", () => {
  assert.equal(commissionState({ id: "a", paymentStatus: "pending", status: "completed" }), "pending");
  assert.equal(commissionState({ id: "b", paymentStatus: "succeeded", status: "cancelled" }), "earned");
  assert.equal(commissionState({ id: "c", status: "completed" }), "earned");
  assert.equal(commissionState({ id: "d", status: "reserved" }), "pending");
  // "not_required" means there was never anything to collect, so it is not
  // expected revenue either.
  assert.equal(commissionState({ id: "e", paymentStatus: "not_required" }), "void");
});

test("the mixed real-world shape a Finance page actually loads still balances", () => {
  const summary = summarizePlatformEarnings({
    purchases: [
      { id: "pu1", businessId: "biz-a", paymentStatus: "succeeded", depositAmountCents: 120000, platformFeeCents: 12000 },
      { id: "pu2", businessId: "biz-b", purchaseStatus: "reserved", depositAmount: 400, platformFeePct: 0.08 },
    ],
    shipments: [
      { id: "sh1", businessId: "biz-a", paymentStatus: "succeeded", total: 320, platformCommissionCents: 2400 },
      { id: "sh2", businessName: "Bravo Cargo", paymentStatus: "failed", totalCents: 90000, platformFeeCents: 9000 },
    ],
    freightShipments: [
      { id: "fr1", businessId: "biz-b", freightPricingVersion: 2, priceSettlementStatus: "settled", paymentStatus: "succeeded", finalTotalCents: 210000, platformFeeCents: 21000 },
    ],
    transports: [
      { id: "tr1", businessId: "biz-a", paymentStatus: "pending", quoteAmount: 750, platformFeePct: 0.1 },
    ],
    parkedCars: [
      { id: "pk1", businessId: "biz-b", paymentMethod: "direct", platformBilled: false, paymentStatus: "paid", totalCostCents: 60000 },
      { id: "pk2", businessId: "biz-b", paymentMethod: "payment_link", paymentStatus: "succeeded", totalCostCents: 30000, platformFeeCents: 3000 },
    ],
    businesses: [
      { id: "biz-a", name: "Alpha Motors" },
      { id: "biz-b", name: "Bravo Cargo" },
    ],
  });

  assert.equal(summary.totals.earnedCents, 12000 + 2400 + 21000 + 3000);
  assert.equal(summary.totals.pendingCents, 3200 + 7500);
  assert.equal(summary.totals.notCommissionableCents, 60000);
  assert.equal(summary.totals.voidCents, 90000);
  assert.equal(summary.totals.records, 8);
  assertBreakdownsSumToTotals(summary);
});

// Focusing the summary. The owner's question is "how much am I getting from
// this business" - so a selection has to narrow every figure on the page at
// once, not just re-sort one list.

const FOCUS_FIXTURE = {
  parkedCars: [
    { id: "pk1", businessId: "biz-a", paidAt: "2026-08-03T10:00:00Z", paymentStatus: "succeeded", totalCostCents: 10000, platformFeeCents: 1000 },
    { id: "pk2", businessId: "biz-b", paidAt: "2026-08-03T10:00:00Z", paymentStatus: "succeeded", totalCostCents: 20000, platformFeeCents: 2000 },
  ],
  shipments: [
    { id: "sh1", businessId: "biz-a", paidAt: "2026-08-04T10:00:00Z", paymentStatus: "succeeded", totalCents: 40000, platformFeeCents: 4000 },
  ],
  businesses: [
    { id: "biz-a", name: "Alpha Motors" },
    { id: "biz-b", name: "Bravo Cargo" },
  ],
};

test("focusing a business narrows the totals, the services and the chart", () => {
  const all = summarizePlatformEarnings(FOCUS_FIXTURE);
  assert.equal(all.totals.earnedCents, 7000);
  assert.equal(all.byService.length, 2);

  const focused = summarizePlatformEarnings({
    ...FOCUS_FIXTURE,
    focus: { businessKey: "biz-a" },
  });
  assert.equal(focused.totals.earnedCents, 5000);
  assert.equal(focused.totals.records, 2);
  assert.equal(focused.byBusiness.length, 1);
  assert.equal(focused.byBusiness[0].name, "Alpha Motors");
  assert.equal(
    focused.series.points.reduce((total, point) => total + point.earnedCents, 0),
    5000,
    "the chart follows the selection too",
  );
  assertBreakdownsSumToTotals(focused);
});

test("focusing a service narrows to that service across businesses", () => {
  const focused = summarizePlatformEarnings({
    ...FOCUS_FIXTURE,
    focus: { serviceId: "carParking" },
  });
  assert.equal(focused.totals.earnedCents, 3000);
  assert.equal(focused.byService.length, 1);
  assert.equal(focused.byBusiness.length, 2);
  assertBreakdownsSumToTotals(focused);
});

test("a business and a service together intersect rather than widen", () => {
  const focused = summarizePlatformEarnings({
    ...FOCUS_FIXTURE,
    focus: { businessKey: "biz-a", serviceId: "carParking" },
  });
  assert.equal(focused.totals.earnedCents, 1000);
  assert.equal(focused.totals.records, 1);
});

test("an empty focus is the same as no focus at all", () => {
  const all = summarizePlatformEarnings(FOCUS_FIXTURE);
  const blank = summarizePlatformEarnings({
    ...FOCUS_FIXTURE,
    focus: { businessKey: "", serviceId: "" },
  });
  assert.deepEqual(blank.totals, all.totals);
});

test("a focus that matches nothing yields zeros, not everything", () => {
  const focused = summarizePlatformEarnings({
    ...FOCUS_FIXTURE,
    focus: { businessKey: "biz-missing" },
  });
  assert.equal(focused.totals.records, 0);
  assert.equal(focused.totals.earnedCents, 0);
  assert.equal(focused.byBusiness.length, 0);
});

test("a record with no business is still selectable by its row key", () => {
  const summary = summarizePlatformEarnings({
    parkedCars: [
      { id: "pk1", paymentStatus: "succeeded", totalCostCents: 10000, platformFeeCents: 1000 },
    ],
  });
  const row = summary.byBusiness[0];
  assert.ok(row.key, "an unassigned row still carries a key");

  const focused = summarizePlatformEarnings({
    parkedCars: [
      { id: "pk1", paymentStatus: "succeeded", totalCostCents: 10000, platformFeeCents: 1000 },
    ],
    focus: { businessKey: row.key },
  });
  assert.equal(focused.totals.earnedCents, 1000);
});
