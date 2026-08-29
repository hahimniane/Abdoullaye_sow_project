import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  freightCanConfirmWeight,
  freightCanUpdateStatus,
  freightCustomerPayKind,
  freightIsPayOnArrival,
  freightPaymentReadyForFulfillment,
  freightSettlementReadyForStatus,
  freightSetupIsResumable,
  freightStatusChangeAllowed,
} from "./freight-fulfillment.ts";
import { checkoutResumeTarget } from "./customer-checkout.ts";
import { freightSettlementIsPayable } from "./customer-shipping.ts";
import { translateValue } from "./french-dom.ts";

const payNowUnpaid = {
  payOnArrival: false,
  paymentStatus: "pending",
  priceSettlementStatus: "awaiting_estimate_payment",
  freightPricingVersion: 2,
  status: "pending_payment",
};

const payNowPaidAwaitingWeight = {
  payOnArrival: false,
  paymentStatus: "succeeded",
  priceSettlementStatus: "awaiting_weight",
  freightPricingVersion: 2,
  status: "awaiting_weight_confirmation",
};

const payNowSettled = {
  payOnArrival: false,
  paymentStatus: "succeeded",
  priceSettlementStatus: "settled",
  freightPricingVersion: 2,
  status: "pending",
};

const payOnArrivalCardSaved = {
  payOnArrival: true,
  paymentTiming: "arrival",
  paymentStatus: "card_saved",
  priceSettlementStatus: "awaiting_weight",
  freightPricingVersion: 2,
  status: "awaiting_weight_confirmation",
  trackingCode: "FR-Q56QWK",
};

const payOnArrivalDue = {
  ...payOnArrivalCardSaved,
  priceSettlementStatus: "due_on_arrival",
  status: "pending",
  balanceDueCents: 2500,
};

const payOnArrivalChargeFailed = {
  ...payOnArrivalDue,
  priceSettlementStatus: "balance_due",
  status: "ready_for_pickup",
  balanceDueCents: 2500,
};

test("pay-on-arrival is recognized from either stored flag", () => {
  assert.equal(freightIsPayOnArrival(payOnArrivalCardSaved), true);
  assert.equal(freightIsPayOnArrival({paymentTiming: "arrival"}), true);
  assert.equal(freightIsPayOnArrival(payNowPaidAwaitingWeight), false);
});

test("a saved card unlocks weight confirm; unpaid pay-now does not", () => {
  assert.equal(freightPaymentReadyForFulfillment(payOnArrivalCardSaved), true);
  assert.equal(freightCanConfirmWeight(payOnArrivalCardSaved), true);
  assert.equal(freightPaymentReadyForFulfillment(payNowUnpaid), false);
  assert.equal(freightCanConfirmWeight(payNowUnpaid), false);
  assert.equal(freightPaymentReadyForFulfillment(payNowPaidAwaitingWeight), true);
  assert.equal(freightCanConfirmWeight(payNowPaidAwaitingWeight), true);
});

test("card-saved pay-on-arrival is not treated as an unpaid pay-now", () => {
  // The live deadlock: Payment "Card Saved" plus the pay-now lock banner.
  assert.equal(freightCanConfirmWeight(payOnArrivalCardSaved), true);
  assert.equal(freightSettlementReadyForStatus(payOnArrivalCardSaved), false);
  assert.equal(freightCanUpdateStatus(payOnArrivalCardSaved), false);
  assert.equal(
    freightStatusChangeAllowed(payOnArrivalCardSaved, "in_transit"),
    false,
  );
});

test("after weight confirm, pay-on-arrival can move but not complete", () => {
  assert.equal(freightSettlementReadyForStatus(payOnArrivalDue), true);
  assert.equal(freightCanUpdateStatus(payOnArrivalDue), true);
  assert.equal(freightStatusChangeAllowed(payOnArrivalDue, "in_transit"), true);
  assert.equal(
    freightStatusChangeAllowed(payOnArrivalDue, "ready_for_pickup"),
    true,
  );
  assert.equal(freightStatusChangeAllowed(payOnArrivalDue, "completed"), false);
  assert.equal(freightStatusChangeAllowed(payNowSettled, "completed"), true);
  assert.equal(freightStatusChangeAllowed(payNowSettled, "in_transit"), true);
});

test("pay-now still waits for a succeeded charge and a settled weight", () => {
  assert.equal(freightCanUpdateStatus(payNowUnpaid), false);
  assert.equal(freightCanUpdateStatus(payNowPaidAwaitingWeight), false);
  assert.equal(
    freightStatusChangeAllowed(payNowPaidAwaitingWeight, "in_transit"),
    false,
  );
  assert.equal(freightCanUpdateStatus(payNowSettled), true);
});

test("the customer is not offered Pay now while the card is only saved", () => {
  assert.equal(freightCustomerPayKind(payOnArrivalCardSaved), null);
  assert.equal(freightCustomerPayKind(payOnArrivalDue), null);
  assert.equal(freightSetupIsResumable(payOnArrivalCardSaved), false);
  assert.equal(freightSettlementIsPayable(payOnArrivalCardSaved), false);
  assert.equal(freightSettlementIsPayable(payOnArrivalDue), false);
  assert.equal(
    checkoutResumeTarget({
      ...payOnArrivalCardSaved,
      id: "fr_q56qwk",
      relatedCollection: "freightShipments",
    }),
    null,
  );
});

test("abandoned card-save and failed arrival charge each get a button", () => {
  assert.equal(
    freightCustomerPayKind({
      payOnArrival: true,
      paymentTiming: "arrival",
      status: "pending_payment",
      paymentStatus: "pending",
    }),
    "setup",
  );
  assert.equal(freightCustomerPayKind(payOnArrivalChargeFailed), "settlement");
  assert.equal(freightSettlementIsPayable(payOnArrivalChargeFailed), true);
  // Pay-now abandoned bookings stay on the existing resume path, not setup.
  assert.equal(
    freightCustomerPayKind({
      paymentTiming: "now",
      status: "pending_payment",
      paymentStatus: "pending",
    }),
    null,
  );
  assert.deepEqual(
    checkoutResumeTarget({
      id: "fr_paynow",
      relatedCollection: "freightShipments",
      status: "pending_payment",
      paymentStatus: "pending",
    }),
    {orderType: "freightShipment", recordId: "fr_paynow"},
  );
});

test("the business freight panel uses the fulfillment helper", () => {
  const source = readFileSync(
    "src/components/business/operations-panels.tsx",
    "utf8",
  );
  assert.match(source, /freightPaymentReadyForFulfillment/);
  assert.match(source, /freightCanConfirmWeight/);
  assert.match(source, /freightCanUpdateStatus/);
  assert.match(source, /freightStatusChangeAllowed/);
  assert.doesNotMatch(
    source,
    /const paymentReady = \["paid", "succeeded", "completed"\]/,
  );
});

test("customer tracking and the order drawer offer the fallback pay action", () => {
  const tracking = readFileSync("src/components/customer-tracking.tsx", "utf8");
  const consoleSource = readFileSync(
    "src/components/customer-console.tsx",
    "utf8",
  );
  assert.match(tracking, /<FreightCustomerPay record=\{record\}/);
  assert.match(consoleSource, /<FreightCustomerPay/);
  const pay = readFileSync("src/components/freight-customer-pay.tsx", "utf8");
  assert.match(pay, /freightCustomerPayKind/);
  assert.match(pay, /"Finish payment"/);
  assert.match(pay, /"Pay now"/);
  assert.match(pay, /startCheckout\(\s*"freightSettlement"/);
});

test("pay-on-arrival fulfillment copy is localized in French", () => {
  for (const english of [
    "Fulfillment is locked until payment succeeds.",
    "The customer's saved card is charged when you mark this shipment arrived.",
    "Mark it arrived first - the customer's saved card is charged on arrival, and completion unlocks once it settles.",
    "Finish payment",
    "Card saved",
    "Due on arrival",
  ]) {
    const french = translateValue(english, "fr");
    assert.notEqual(french, english, english);
    assert.ok(french.length > 0, english);
  }
});
