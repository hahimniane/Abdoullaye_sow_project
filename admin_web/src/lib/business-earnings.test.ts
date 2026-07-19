import assert from "node:assert/strict";
import { test } from "node:test";

import { summarizeBusinessEarnings } from "./business-earnings.ts";

test("summarizes paid business earnings by service with platform fees", () => {
  const summary = summarizeBusinessEarnings({
    purchases: [
      {
        id: "purchase-1",
        paymentStatus: "succeeded",
        depositAmountCents: 10000,
        platformFeeCents: 1000,
        businessPayoutCents: 9000,
      },
    ],
    shipments: [
      {
        id: "shipment-1",
        paymentStatus: "succeeded",
        price: 250,
        platformFeePct: 0.1,
      },
    ],
    freightShipments: [
      {
        id: "freight-1",
        paymentStatus: "succeeded",
        totalCents: 8000,
        platformFeeCents: 800,
        businessPayoutCents: 7200,
      },
    ],
    transports: [],
    parkedCars: [],
  });

  assert.equal(summary.totals.grossReceived, 430);
  assert.equal(summary.totals.platformFees, 43);
  assert.equal(summary.totals.businessEarnings, 387);
  assert.equal(summary.totals.paidTransactions, 3);
  assert.equal(summary.services.find((row) => row.serviceId === "barrelShipping")?.businessEarnings, 225);
  assert.equal(summary.services.find((row) => row.serviceId === "freight")?.businessEarnings, 72);
});

test("keeps pending payments separate from received money", () => {
  const summary = summarizeBusinessEarnings({
    purchases: [],
    shipments: [],
    freightShipments: [],
    transports: [],
    parkedCars: [
      {
        id: "parking-1",
        paymentStatus: "pending",
        totalCostCents: 5000,
        platformFeeCents: 500,
        businessPayoutCents: 4500,
      },
    ],
  });

  assert.equal(summary.totals.grossReceived, 0);
  assert.equal(summary.totals.pendingGross, 50);
  assert.equal(summary.totals.pendingTransactions, 1);
});

test("includes paid hold extension earnings as car sales", () => {
  const summary = summarizeBusinessEarnings({
    purchases: [
      {
        id: "purchase-1",
        paymentStatus: "succeeded",
        depositAmount: 50,
        platformFeePct: 0.1,
        extensionPaymentStatus: "succeeded",
        extensionExtraAmountCents: 2500,
        extensionPlatformFeeCents: 250,
        extensionBusinessPayoutCents: 2250,
      },
    ],
    shipments: [],
    freightShipments: [],
    transports: [],
    parkedCars: [],
  });

  const carSales = summary.services.find((row) => row.serviceId === "carSales");
  assert.equal(carSales?.grossReceived, 75);
  assert.equal(carSales?.platformFees, 7.5);
  assert.equal(carSales?.businessEarnings, 67.5);
});

test("counts only the final settled amount for version-two freight", () => {
  const summary = summarizeBusinessEarnings({
    purchases: [],
    shipments: [],
    freightShipments: [
      {
        id: "freight-awaiting-weight",
        freightPricingVersion: 2,
        paymentStatus: "succeeded",
        priceSettlementStatus: "awaiting_weight",
        estimatedTotalCents: 10000,
      },
      {
        id: "freight-settled",
        freightPricingVersion: 2,
        paymentStatus: "succeeded",
        priceSettlementStatus: "settled",
        estimatedTotalCents: 10000,
        finalTotalCents: 12500,
        platformFeeCents: 1250,
        businessPayoutCents: 11250,
      },
    ],
    transports: [],
    parkedCars: [],
  });

  const freight = summary.services.find((row) => row.serviceId === "freight");
  assert.equal(freight?.grossReceived, 125);
  assert.equal(freight?.pendingGross, 100);
  assert.equal(freight?.businessEarnings, 112.5);
});
