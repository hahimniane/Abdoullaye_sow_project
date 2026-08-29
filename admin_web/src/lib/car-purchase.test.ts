import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  carPurchaseCanMarkCompleted,
  carPurchaseCanMarkSold,
  customerOrderAmount,
  paidHoldCanBeFinalized,
} from "./car-purchase.ts";
import { translateValue } from "./french-dom.ts";

const unpaidHold = {
  paymentType: "reservation_deposit",
  paymentStatus: "pending",
  purchaseStatus: "pending",
  depositAmount: 500,
};

test("an unpaid hold cannot be marked sold or completed", () => {
  assert.equal(paidHoldCanBeFinalized(unpaidHold), false);
  assert.equal(carPurchaseCanMarkSold(unpaidHold), false);
  assert.equal(carPurchaseCanMarkCompleted(unpaidHold), false);
});

test("a reserved paid hold can be marked sold", () => {
  const hold = {
    paymentType: "reservation_deposit",
    paymentStatus: "succeeded",
    purchaseStatus: "reserved",
    depositAmount: 500,
  };
  assert.equal(carPurchaseCanMarkSold(hold), true);
  assert.equal(carPurchaseCanMarkCompleted(hold), true);
});

test("a hold in review can still be marked sold after payment", () => {
  assert.equal(
    carPurchaseCanMarkSold({
      paymentType: "reservation_deposit",
      paymentStatus: "succeeded",
      purchaseStatus: "hold_review_required",
      depositAmount: 500,
    }),
    true,
  );
});

test("customer order amount reads a car hold deposit", () => {
  assert.equal(customerOrderAmount({ depositAmount: 500 }), 500);
  assert.equal(
    customerOrderAmount({ price: 18000, depositAmount: 500 }),
    18000,
  );
  assert.equal(customerOrderAmount({}), 0);
});

test("the business console hides Mark sold on an unpaid hold", () => {
  const panel = readFileSync(
    "src/components/business/operations-panels.tsx",
    "utf8",
  );
  assert.match(panel, /carPurchaseCanMarkSold\(row\)/);
  assert.match(panel, /carPurchaseCanMarkCompleted\(row\)/);
  assert.match(panel, /canCompletePurchase && \(/);
  assert.doesNotMatch(
    panel,
    /const holdActive = kind === "hold" && \(status === "reserved"/,
  );
});

test("unpaid-hold refusal copy is localized in French", () => {
  for (const english of [
    "This hold cannot be marked sold until payment has succeeded.",
    "This purchase cannot be marked sold until payment has succeeded.",
  ]) {
    const french = translateValue(english, "fr");
    assert.notEqual(french, english, english);
    assert.ok(french.length > 0, english);
  }
});
