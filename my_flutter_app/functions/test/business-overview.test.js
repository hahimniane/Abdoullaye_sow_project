"use strict";

// The business Today page's pure half (business_overview.js): which month
// is "this month", what counts as money collected and from where, what is
// owed, and what one viewer may see.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");

const {
  CONTAINER_LIST_LIMIT,
  MONEY_METHODS,
  MONEY_SERVICES,
  SHIPPING_SERVICES,
  activityCompare,
  buildToday,
  containersInProgress,
  invoicePaymentEntries,
  lotPaymentEntries,
  moneyByMonth,
  moneyMethod,
  onlineOrderEntries,
  packagePaymentEntries,
  parkingPaymentEntries,
  shopPaymentEntries,
  todayForViewer,
  todayMonths,
  todayViewer,
} = require("../business_overview");
const {parkingSummaryPartial} = require("../console_summaries");
const {monthWindow} = require("../volume_counts");

const ts = (iso) => {
  const date = new Date(iso);
  return {toDate: () => date, toMillis: () => date.getTime()};
};

const NOW = new Date("2026-10-21T15:00:00Z");

function hasBusinessPermission(user, section) {
  if (user.role === "admin" || user.role === "businessOwner") return true;
  return (user.businessPermissions || []).includes(section);
}

describe("Today: months", () => {
  it("is New York's month, the same window as Volume and Bills", () => {
    const months = todayMonths(NOW);
    assert.equal(months.month, "2026-10");
    assert.equal(months.previousMonth, "2026-09");
    assert.equal(months.timeZone, "America/New_York");
    assert.deepEqual(months.current, monthWindow("2026-10"));
    assert.deepEqual(months.previous, monthWindow("2026-09"));
    assert.equal(months.startMs, monthWindow("2026-09").startMs);
    assert.equal(months.endMs, monthWindow("2026-10").endMs);
    assert.equal(months.firstDay, "2026-09-01");
    assert.equal(months.lastDay, "2026-10-31");
  });

  it("11:30 PM on Oct 31 in New York is still October", () => {
    assert.equal(todayMonths(new Date("2026-11-01T03:30:00Z")).month,
        "2026-10");
    assert.equal(todayMonths(new Date("2026-11-01T04:00:00Z")).month,
        "2026-11");
    // January compares with December of the year before.
    assert.equal(todayMonths(new Date("2027-01-10T12:00:00Z")).previousMonth,
        "2026-12");
  });
});

describe("Today: activity from the Volume rollup", () => {
  it("reads received pieces by kind and the cars on sailed containers", () => {
    const current = {pieces: 60, barrels: 30, packages: 28, cars: 2,
      containersShipped: 2, containerPieces: 45,
      containers: [{id: "a", cars: 3, barrels: 10, packages: 5},
        {id: "b", cars: 1, barrels: 20, packages: 6}]};
    const previous = {pieces: 40, barrels: 20, packages: 20, cars: 0,
      containersShipped: 1, containerPieces: 10,
      containers: [{id: "c", cars: 2, barrels: 8, packages: 0}]};
    const result = activityCompare(current, previous);
    assert.deepEqual(result.current, {pieces: 60, packages: 28, barrels: 30,
      carsReceived: 2, carsShipped: 4, containersShipped: 2,
      piecesShipped: 45});
    assert.equal(result.previous.carsShipped, 2);
    assert.equal(result.change.packages, 40);
    assert.equal(result.change.barrels, 50);
    assert.equal(result.change.carsShipped, 100);
    // Nothing last month: no percentage, never "+Infinity%".
    assert.equal(result.change.carsReceived, null);
  });

  it("a month nobody has counted reads as zeros", () => {
    const result = activityCompare(null, undefined);
    assert.equal(result.current.packages, 0);
    assert.equal(result.change.packages, null);
  });
});

describe("Today: containers in progress", () => {
  const rows = [
    {id: "old", status: "loading", label: "Old box",
      createdAt: ts("2026-09-01T00:00:00Z"), barrelCount: 4, otherCount: 2,
      carCount: 1, lineCount: 5, destinationCountryName: "Guinea"},
    {id: "new", status: "loading", containerNumber: "MSCU1234567",
      createdAt: ts("2026-10-10T00:00:00Z"), barrelCount: 1},
    {id: "sea", status: "shipped", bookingReference: "BK-9",
      sailedAt: ts("2026-10-02T00:00:00Z"), carCount: 2},
    {id: "done", status: "arrived", label: "Landed"},
  ];

  it("lists loading boxes first (newest first), then those at sea", () => {
    const result = containersInProgress(rows);
    assert.equal(result.loading, 2);
    assert.equal(result.atSea, 1);
    assert.deepEqual(result.list.map((c) => c.id), ["new", "old", "sea"]);
    assert.equal(result.list[0].name, "MSCU1234567");
    assert.equal(result.list[1].name, "Old box");
    assert.equal(result.list[1].pieces, 7);
    assert.equal(result.list[2].name, "BK-9");
    assert.equal(result.list[2].sailedAtMs,
        new Date("2026-10-02T00:00:00Z").getTime());
    assert.equal(result.more, false);
  });

  it(`shows at most ${CONTAINER_LIST_LIMIT} and says there are more`, () => {
    const many = Array.from({length: 8}, (_, i) => ({id: `c${i}`,
      status: "loading", createdAt: ts(`2026-10-0${i + 1}T00:00:00Z`)}));
    const result = containersInProgress(many);
    assert.equal(result.list.length, CONTAINER_LIST_LIMIT);
    assert.equal(result.loading, 8);
    assert.equal(result.more, true);
  });
});

describe("Today: money collected", () => {
  it("names every method the counters record, and online", () => {
    assert.equal(moneyMethod("Zelle"), "zelle");
    assert.equal(moneyMethod("cash app"), "cashapp");
    assert.equal(moneyMethod("card_in_person"), "card_in_person");
    assert.equal(moneyMethod("card"), "online");
    assert.equal(moneyMethod("payment_link"), "online");
    assert.equal(moneyMethod(""), "other");
    assert.equal(moneyMethod("bitcoin"), "other");
    for (const method of ["cash", "zelle", "cashapp", "venmo", "check",
      "card_in_person", "other"]) {
      assert.ok(MONEY_METHODS.includes(method), method);
    }
  });

  it("package payments: reverted ones are out, a card order is online", () => {
    const entries = packagePaymentEntries([
      {amountCents: 5000, method: "cash",
        createdAt: ts("2026-10-03T14:00:00Z")},
      {amountCents: 2500, method: "zelle", reverted: true,
        createdAt: ts("2026-10-03T14:00:00Z")},
      {amountCents: 7000, method: "other", source: "card_order",
        createdAt: ts("2026-10-01T03:00:00Z")}, // Sep 30 in New York
    ]);
    assert.deepEqual(entries, [
      {month: "2026-10", cents: 5000, service: "packages", method: "cash"},
      {month: "2026-09", cents: 7000, service: "packages",
        method: "online"},
    ]);
  });

  it("invoice payments count in the month of the day they were paid", () => {
    const entries = invoicePaymentEntries([
      {amountCents: 1000, method: "check", paidOn: "2026-10-31"},
      {amountCents: 900, method: "cash", paidOn: "2026-09-30",
        reverted: true},
    ]);
    assert.deepEqual(entries, [{month: "2026-10", cents: 1000,
      service: "invoices", method: "check"}]);
  });

  it("lot payments: the link is online, the counter keeps its method", () => {
    const entries = lotPaymentEntries([
      {amountCents: 3000, source: "card", paidAtMonth: "2026-10"},
      {amountCents: 4000, source: "cash", receivedVia: "zelle",
        paidAtMonth: "2026-10"},
    ]);
    assert.deepEqual(entries.map((e) => e.method), ["online", "zelle"]);
    assert.ok(entries.every((e) => e.service === "lot"));
  });

  it("the shop: paid-now part of a sale, credit payments, no voided", () => {
    const entries = shopPaymentEntries([
      {paidNowCents: 1500, totalCents: 4000, creditCents: 2500,
        paymentMethod: "cash", createdAt: ts("2026-10-05T12:00:00Z")},
      // Before credit existed: paid in full.
      {totalCents: 800, paymentMethod: "venmo",
        createdAt: ts("2026-10-05T12:00:00Z")},
      {paidNowCents: 9000, voided: true, paymentMethod: "cash",
        createdAt: ts("2026-10-05T12:00:00Z")},
      // All on credit: nothing taken.
      {paidNowCents: 0, creditCents: 3000, paymentMethod: "",
        createdAt: ts("2026-10-05T12:00:00Z")},
    ], [
      {amountCents: 1000, method: "zelle",
        createdAt: ts("2026-10-06T12:00:00Z")},
      {amountCents: 500, method: "cash", reverted: true,
        createdAt: ts("2026-10-06T12:00:00Z")},
    ]);
    const month = moneyByMonth(entries, ["2026-10"])["2026-10"];
    assert.equal(month.totalCents, 3300);
    assert.equal(month.byService.shop, 3300);
    assert.equal(month.byMethod.cash, 1500);
    assert.equal(month.byMethod.venmo, 800);
    assert.equal(month.byMethod.zelle, 1000);
  });

  it("parking follows the Parking page's month attribution exactly", () => {
    const rows = [
      // Two instalments in two months, then settled by hand.
      {status: "reserved", amountPaidCents: 9000, amountDueCents: 9000,
        parkingDate: ts("2026-09-01T12:00:00Z"),
        parkingEndDate: ts("2026-09-30T12:00:00Z"),
        parkingPayments: [
          {amountCents: 3000, receivedVia: "cash",
            at: ts("2026-09-10T12:00:00Z")},
          {amountCents: 2000, receivedVia: "zelle",
            at: ts("2026-10-02T12:00:00Z")},
        ],
        directPaymentReceived: true, directPaymentMethod: "check",
        directPaymentReceivedAt: ts("2026-10-12T12:00:00Z")},
      // Paid online through Stripe.
      {status: "reserved", paymentStatus: "succeeded", amountDueCents: 4500,
        parkingDate: ts("2026-10-01T12:00:00Z"),
        parkingEndDate: ts("2026-10-04T12:00:00Z"),
        paidAt: ts("2026-10-01T13:00:00Z")},
      // Nothing paid yet.
      {status: "reserved", amountDueCents: 1200,
        parkingDate: ts("2026-10-01T12:00:00Z"),
        parkingEndDate: ts("2026-10-02T12:00:00Z")},
    ];
    const entries = parkingPaymentEntries(rows, NOW);
    const months = moneyByMonth(entries, ["2026-09", "2026-10"]);
    assert.equal(months["2026-09"].byMethod.cash, 3000);
    assert.equal(months["2026-10"].byMethod.zelle, 2000);
    assert.equal(months["2026-10"].byMethod.check, 4000);
    assert.equal(months["2026-10"].byMethod.online, 4500);
    // Parity: the same totals per month as parkingSummaryPartial (NY zone).
    const partial = parkingSummaryPartial(rows, {now: NOW,
      months: ["2026-09", "2026-10"], timeZone: "America/New_York"});
    assert.deepEqual(partial.collectedByMonth,
        [months["2026-09"].totalCents, months["2026-10"].totalCents]);
  });

  it("online orders: only what Stripe collected, by the day it was paid",
      () => {
        const entries = onlineOrderEntries({
          shipments: [
            {status: "pending", paymentStatus: "succeeded", totalCents: 12000,
              paidAt: ts("2026-10-04T12:00:00Z")},
            // Paid to the business directly: the counter recorded it.
            {paymentStatus: "succeeded", paymentMethod: "cash",
              totalCents: 5000, paidAt: ts("2026-10-04T12:00:00Z")},
            {paymentStatus: "pending", totalCents: 3000,
              createdAt: ts("2026-10-04T12:00:00Z")},
          ],
          purchases: [{purchaseStatus: "reserved",
            paymentStatus: "succeeded", depositAmountCents: 50000,
            paidAt: ts("2026-09-20T12:00:00Z")}],
        });
        assert.deepEqual(entries.map((e) => [e.month, e.cents]).sort(),
            [["2026-09", 50000], ["2026-10", 12000]]);
        assert.ok(entries.every((e) => e.service === "online" &&
          e.method === "online"));
      });

  it("adds up only this month and last, every service and method present",
      () => {
        const months = moneyByMonth([
          {month: "2026-10", cents: 100, service: "packages", method: "cash"},
          {month: "2026-08", cents: 999, service: "packages", method: "cash"},
          {month: "2026-10", cents: -5, service: "shop", method: "cash"},
          {month: "2026-09", cents: 50, service: "invoices", method: "zelle"},
        ], ["2026-10", "2026-09"]);
        assert.equal(months["2026-10"].totalCents, 100);
        assert.equal(months["2026-10"].payments, 1);
        assert.equal(months["2026-09"].byMethod.zelle, 50);
        assert.deepEqual(Object.keys(months["2026-10"].byService),
            [...MONEY_SERVICES]);
        assert.deepEqual(Object.keys(months["2026-10"].byMethod),
            [...MONEY_METHODS]);
      });
});

describe("Today: the whole page", () => {
  const months = todayMonths(NOW);
  const base = {
    months,
    now: NOW,
    volume: {current: {packages: 12, barrels: 30, cars: 1,
      containersShipped: 1, containers: [{id: "x", cars: 2}]},
    previous: {packages: 10, barrels: 30}},
    containers: [{id: "a", status: "loading", label: "Box A"}],
    packageRequestsOpen: 4,
    waitingPackages: 9,
    linesOwed: {priceCents: 50000, paidCents: 32000},
    invoicesOwed: {count: 2, balanceCents: 7000},
    shopCreditOwed: null,
    packagePayments: [{amountCents: 5000, method: "cash",
      createdAt: ts("2026-10-03T12:00:00Z")},
    {amountCents: 2000, method: "zelle",
      createdAt: ts("2026-09-03T12:00:00Z")}],
    invoicePayments: [{amountCents: 1000, method: "zelle",
      paidOn: "2026-10-09"}],
    lotPayments: null,
    shipments: [{status: "pending", paymentStatus: "succeeded",
      totalCents: 3000, paidAt: ts("2026-10-08T12:00:00Z")},
    {status: "completed"}],
    support: [{status: "open"}, {status: "resolved"}],
    unavailable: ["shopSales"],
  };

  it("brings activity, queues, owed and money together", () => {
    const today = buildToday(base);
    assert.equal(today.month, "2026-10");
    assert.equal(today.activity.current.packages, 12);
    assert.equal(today.activity.current.carsShipped, 2);
    assert.equal(today.activity.change.packages, 20);
    assert.equal(today.containers.loading, 1);
    assert.deepEqual(today.queues, {packageRequests: 4, waitingPackages: 9,
      containersLoading: 1, barrelOrders: 1, freightOrders: null,
      carPurchases: null, transportRequests: null, supportRequests: 1,
      openInvoices: 2});
    assert.deepEqual(today.owed, {packagesCents: 18000, invoicesCents: 7000,
      parkingCents: null, shopCreditCents: null});
    assert.equal(today.money.current.totalCents, 9000);
    assert.equal(today.money.current.byService.packages, 5000);
    assert.equal(today.money.current.byService.invoices, 1000);
    assert.equal(today.money.current.byService.online, 3000);
    assert.equal(today.money.previous.totalCents, 2000);
    assert.equal(today.money.change, 350);
    assert.deepEqual(today.unavailable, ["shopSales"]);
    // A service the business does not run reads null, not 0.
    assert.equal(today.parking, null);
    assert.equal(today.listings, null);
  });

  it("a staff member sees only what their own tabs already show", () => {
    const today = buildToday(base);
    const services = ["barrelShipping", "freight"];
    const containersStaff = todayViewer({role: "staff",
      businessPermissions: ["containers"]}, services, hasBusinessPermission);
    const seen = todayForViewer(today, containersStaff);
    assert.equal(seen.activity.current.packages, 12);
    assert.equal(seen.containers.loading, 1);
    assert.equal(seen.queues.packageRequests, 4);
    assert.equal(seen.queues.supportRequests, null);
    assert.equal(seen.queues.openInvoices, null);
    assert.equal(seen.owed.packagesCents, 18000);
    assert.equal(seen.owed.invoicesCents, null);
    assert.equal(seen.owed.totalCents, null, "the business total is owners'");
    assert.equal(seen.money, null, "money collected is owners'");

    const supportStaff = todayViewer({role: "staff",
      businessPermissions: ["support"]}, services, hasBusinessPermission);
    const support = todayForViewer(today, supportStaff);
    assert.equal(support.activity, null);
    assert.equal(support.containers, null);
    assert.equal(support.queues.supportRequests, 1);
    assert.equal(support.queues.packageRequests, null);
    assert.equal(support.owed.packagesCents, null);
  });

  it("the owner sees the money and the owed total", () => {
    const today = buildToday(base);
    const owner = todayViewer({role: "businessOwner"},
        ["barrelShipping"], hasBusinessPermission);
    assert.equal(owner.finance, true);
    const seen = todayForViewer(today, owner);
    assert.equal(seen.money.current.totalCents, 9000);
    assert.equal(seen.owed.totalCents, 25000);
    assert.equal(seen.queues.openInvoices, 2);
  });

  it("services decide the sections, whatever the permissions", () => {
    const owner = {role: "businessOwner"};
    const shop = todayViewer(owner, ["inventory"], hasBusinessPermission);
    assert.equal(shop.containers, false, "a shop has no containers");
    assert.equal(shop.inventory, true);
    assert.equal(shop.listings, false);
    const lot = todayViewer(owner, ["carParking", "carSales"],
        hasBusinessPermission);
    assert.equal(lot.containers, true, "a lot loads containers");
    assert.equal(lot.parking, true);
    assert.equal(lot.listings, true);
    assert.equal(lot.inventory, false);
    // A shop clerk tied to one store does not see every store's sales.
    const clerk = todayViewer({role: "staff",
      businessPermissions: ["inventory"], inventoryHomeStoreId: "s1"},
    ["inventory"], hasBusinessPermission);
    assert.equal(clerk.inventory, false);
    assert.equal(clerk.finance, false);
  });

  it("the shipping services mirror the console's list", () => {
    const sidebar = fs.readFileSync(path.join(__dirname, "..", "..", "..",
        "admin_web", "src", "lib", "business-sidebar.ts"), "utf8");
    const match = sidebar.match(
        /export const shippingServiceIds = \[([^\]]*)\];/);
    assert.ok(match, "shippingServiceIds moved");
    const ids = [...match[1].matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]);
    assert.deepEqual(ids, [...SHIPPING_SERVICES]);
  });
});
