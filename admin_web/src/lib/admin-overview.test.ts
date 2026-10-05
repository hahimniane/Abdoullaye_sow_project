// The admin Today figures and the Finance commission summary come from the
// server over every record. These tests pin how an answer becomes the screen:
// pending counts feed the queues and KPIs, empty buckets stay off the charts,
// a missing or malformed answer reads as zeros, and preview mode builds the
// same shapes with the server's own counting rules.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  ADMIN_STATUS_VOCABULARY,
  adminOverviewFromRows,
  adminTodayMetrics,
  emptyPlatformEarnings,
  localPlatformEarnings,
  nonZeroCounts,
  platformEarningsPayload,
  type AdminOverviewResponse,
} from "./admin-overview.ts";
import { summarizePlatformEarnings } from "./platform-earnings.ts";

const overview: AdminOverviewResponse = {
  users: { total: 2010, counts: { admin: 3, businessOwner: 40, staff: 67, customer: 1900 } },
  businesses: { total: 61, counts: { pending: 4, approved: 50, suspended: 0, changes_requested: 2, rejected: 5 } },
  cars: { total: 1500, counts: { active: 1200, inactive: 0, reserved: 100, sold: 200 } },
  barrelShipments: { total: 3000, counts: { pending_payment: 10, pending: 25, in_transit: 0, ready_for_pickup: 5, completed: 2900, cancelled: 60 } },
  freightShipments: { total: 40, counts: { pending: 7, completed: 30, other: 3 } },
  purchases: { total: 300, counts: { pending: 9, completed: 291 } },
  applications: { total: 80, pending: 6 },
  missingProfiles: 2,
  computedAtMs: 1_790_000_000_000,
};

describe("adminTodayMetrics", () => {
  test("reads every Today figure from the server answer", () => {
    const metrics = adminTodayMetrics(overview);
    assert.equal(metrics.pendingBusinesses, 4);
    assert.equal(metrics.approvedBusinesses, 50);
    assert.equal(metrics.businessTotal, 61);
    assert.equal(metrics.missingProfiles, 2);
    assert.equal(metrics.activeListings, 1200);
    assert.equal(metrics.listingTotal, 1500);
    assert.equal(metrics.pendingShipments, 25);
    assert.equal(metrics.shipmentTotal, 3000);
    assert.equal(metrics.pendingFreight, 7);
    assert.equal(metrics.freightTotal, 40);
    assert.equal(metrics.pendingPurchases, 9);
    assert.equal(metrics.purchaseTotal, 300);
    assert.equal(metrics.pendingApplications, 6);
    assert.equal(metrics.applicationTotal, 80);
    assert.deepEqual(metrics.roles, { admin: 3, businessOwner: 40, staff: 67, customer: 1900 });
  });

  test("the queue total is every open item, and Needs review is businesses plus applications", () => {
    const metrics = adminTodayMetrics(overview);
    assert.equal(metrics.needsReview, 4 + 6);
    assert.equal(metrics.totalOpen, 4 + 6 + 9 + 25 + 7);
  });

  test("past the old 1000-row cap the figures are still whole", () => {
    // The capped listeners stopped at 1000 cars and 1000 shipments.
    const metrics = adminTodayMetrics(overview);
    assert.ok(metrics.listingTotal > 1000);
    assert.ok(metrics.shipmentTotal > 1000);
  });

  test("charts leave empty buckets out", () => {
    const metrics = adminTodayMetrics(overview);
    assert.deepEqual(metrics.carStatuses, { active: 1200, reserved: 100, sold: 200 });
    assert.equal("in_transit" in metrics.shipmentStatuses, false);
    assert.equal(metrics.freightTotal, 40);
    assert.deepEqual(nonZeroCounts({ a: 0, b: 2, c: -1, d: Number.NaN }), { b: 2 });
  });

  test("no answer, or a malformed one, reads as zeros - never NaN", () => {
    for (const value of [null, undefined, {} as AdminOverviewResponse]) {
      const metrics = adminTodayMetrics(value);
      assert.equal(metrics.totalOpen, 0);
      assert.equal(metrics.listingTotal, 0);
      assert.deepEqual(metrics.businessStatuses, {});
    }
    const metrics = adminTodayMetrics({
      ...overview,
      cars: { total: "12" as unknown as number, counts: { active: "x" as unknown as number } },
    });
    assert.equal(metrics.listingTotal, 12);
    assert.equal(metrics.activeListings, 0);
  });
});

describe("adminOverviewFromRows (preview mode)", () => {
  test("counts exact statuses and puts anything else under other, like the server", () => {
    const answer = adminOverviewFromRows({
      users: [{ id: "a", role: "admin" }, { id: "b", role: "customer" }, { id: "c", role: "" }],
      businesses: [
        { id: "b1", status: "pending" },
        { id: "b2", status: "approved" },
        { id: "b3", status: "missing_profile", _inferred: true },
      ],
      cars: [{ id: "c1", status: "active" }, { id: "c2" }],
      barrelShipments: [{ id: "s1", status: "pending" }],
      freightShipments: [],
      purchases: [{ id: "p1", purchaseStatus: "pending" }, { id: "p2", status: "pending" }],
      applications: [{ id: "x", status: "pending" }, { id: "y", status: "approved" }],
    });
    assert.equal(answer.users.total, 3);
    assert.equal(answer.users.counts.other, 1);
    assert.equal(answer.businesses.total, 2, "a directory-inferred business is not a business document");
    assert.equal(answer.missingProfiles, 1);
    assert.equal(answer.cars.counts.active, 1);
    assert.equal(answer.cars.counts.other, 1, "a car without a status is not counted as pending");
    assert.equal(answer.purchases.counts.pending, 1, "purchases count purchaseStatus, not status");
    assert.deepEqual(answer.applications, { total: 2, pending: 1 });
    const metrics = adminTodayMetrics(answer);
    assert.equal(metrics.totalOpen, 1 + 1 + 1 + 1);
  });

  test("buckets always add back up to the total", () => {
    const answer = adminOverviewFromRows({
      barrelShipments: [{ id: "1", status: "pending" }, { id: "2", status: "weird" }, { id: "3" }],
    });
    const sum = Object.values(answer.barrelShipments.counts).reduce((a, b) => a + b, 0);
    assert.equal(sum, answer.barrelShipments.total);
  });

  test("mirrors the server's status vocabulary", () => {
    const server = readFileSync(
      new URL("../../../my_flutter_app/functions/console_totals.js", import.meta.url),
      "utf8",
    );
    const start = server.indexOf("const ADMIN_STATUS_VOCABULARY");
    const block = server.slice(start, server.indexOf("});", start));
    assert.ok(start >= 0, "console_totals.js must define ADMIN_STATUS_VOCABULARY");
    for (const [key, values] of Object.entries(ADMIN_STATUS_VOCABULARY)) {
      const entry = new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`).exec(block);
      assert.ok(entry, `server vocabulary is missing ${key}`);
      const serverValues = Array.from(entry[1].matchAll(/"([^"]+)"/g), (match) => match[1]);
      assert.deepEqual(serverValues, [...values], `${key} differs from the server`);
    }
  });
});

describe("platform earnings for the Finance tab", () => {
  const records = {
    parkedCars: [
      { id: "paid", businessId: "b1", paymentMethod: "payment_link", paymentStatus: "succeeded", totalCostCents: 20000, platformFeeCents: 2000 },
      { id: "unpaid", businessId: "b2", paymentMethod: "payment_link", paymentStatus: "pending", totalCostCents: 10000, platformFeeCents: 1000 },
    ],
    businesses: [{ id: "b1", name: "Alpha" }, { id: "b2", name: "Beta" }],
  };

  test("the payload always names both focus axes, trimmed", () => {
    assert.deepEqual(platformEarningsPayload({}), { focus: { businessKey: "", serviceId: "" } });
    assert.deepEqual(platformEarningsPayload({ businessKey: " b1 ", serviceId: "carSales" }), {
      focus: { businessKey: "b1", serviceId: "carSales" },
    });
  });

  test("locally, without a focus, every view is the whole summary", () => {
    const answer = localPlatformEarnings(records, {});
    const whole = summarizePlatformEarnings(records);
    assert.deepEqual(answer.summary, whole);
    assert.deepEqual(answer.focused, whole);
    assert.deepEqual(answer.businessRows, whole.byBusiness);
    assert.deepEqual(answer.serviceRows, whole.byService);
  });

  test("locally, a focus cross-filters the other axis, as the callable does", () => {
    const whole = summarizePlatformEarnings(records);
    assert.equal(whole.byBusiness.length, 2);
    const businessKey = whole.byBusiness[0].key;
    const answer = localPlatformEarnings(records, { businessKey });
    assert.deepEqual(answer.summary, whole, "the headline list stays complete");
    assert.deepEqual(answer.focused, summarizePlatformEarnings({ ...records, focus: { businessKey } }));
    assert.deepEqual(answer.businessRows, whole.byBusiness, "picking a business keeps every business to pick from");
    assert.deepEqual(
      answer.serviceRows,
      summarizePlatformEarnings({ ...records, focus: { businessKey } }).byService,
    );
  });

  test("an empty answer has zero totals and no rows", () => {
    const empty = emptyPlatformEarnings();
    assert.equal(empty.summary.totals.records, 0);
    assert.deepEqual(empty.businessRows, []);
    assert.deepEqual(empty.serviceRows, []);
  });
});
