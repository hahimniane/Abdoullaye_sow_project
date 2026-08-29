const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");
const {
  carPurchaseCanMarkCompleted,
  carPurchasePaymentSucceeded,
  isPaidHold,
  paidHoldActionRefusal,
  paidHoldCanBeFinalized,
} = require("../car_purchase");

const unpaidHold = Object.freeze({
  paymentType: "reservation_deposit",
  paymentStatus: "pending",
  purchaseStatus: "pending",
  depositAmount: 500,
});

const reservedHold = Object.freeze({
  paymentType: "reservation_deposit",
  paymentStatus: "succeeded",
  purchaseStatus: "reserved",
  depositAmount: 500,
});

describe("paid hold settlement", () => {
  it("does not treat an unpaid pending hold as sold-ready", () => {
    assert.equal(isPaidHold(unpaidHold), true);
    assert.equal(carPurchasePaymentSucceeded(unpaidHold), false);
    assert.equal(paidHoldCanBeFinalized(unpaidHold), false);
    assert.equal(paidHoldActionRefusal(unpaidHold), "not_settled");
    assert.equal(carPurchaseCanMarkCompleted(unpaidHold), false);
  });

  it("lets a reserved paid hold be marked sold", () => {
    assert.equal(paidHoldCanBeFinalized(reservedHold), true);
    assert.equal(paidHoldActionRefusal(reservedHold), "");
    assert.equal(carPurchaseCanMarkCompleted(reservedHold), true);
  });

  it("refuses a hold the console already finalized", () => {
    assert.equal(
        paidHoldActionRefusal({
          ...reservedHold,
          purchaseStatus: "completed",
        }),
        "already_finalized",
    );
  });

  it("does not let a pending full purchase complete for $0", () => {
    assert.equal(
        carPurchaseCanMarkCompleted({
          paymentType: "full_purchase",
          paymentStatus: "pending",
          purchaseStatus: "pending",
          depositAmount: 18000,
        }),
        false,
    );
    assert.equal(
        carPurchaseCanMarkCompleted({
          paymentType: "full_purchase",
          paymentStatus: "succeeded",
          purchaseStatus: "pending",
          depositAmount: 18000,
        }),
        true,
    );
  });

  it("the sold/completed callables refuse an unpaid hold", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "..", "index.js"),
        "utf8",
    );
    assert.match(source, /paidHoldActionRefusal\(purchase\)/);
    assert.match(
        source,
        /This hold cannot be marked sold until payment has succeeded/,
    );
    const finalize = source.indexOf("exports.businessFinalizeCarPurchase");
    assert.ok(finalize > 0);
    assert.match(
        source.slice(finalize, finalize + 2500),
        /carPurchaseCanMarkCompleted\(purchase\)/,
    );
  });
});
