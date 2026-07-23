import assert from "node:assert/strict";
import test from "node:test";

import {
  CUSTOMER_CHECKOUT_ORDER_TYPES,
  buildCheckoutRequest,
  checkoutRedirectUrl,
  paymentReturnState,
} from "./customer-checkout.ts";

test("customer checkout covers all 12 server-paid rails", () => {
  assert.equal(CUSTOMER_CHECKOUT_ORDER_TYPES.length, 12);
  assert.ok(CUSTOMER_CHECKOUT_ORDER_TYPES.includes("barrelPoolJoin"));
  assert.ok(CUSTOMER_CHECKOUT_ORDER_TYPES.includes("holdExtension"));
});

test("checkout request preserves the exact server payload without prices", () => {
  const request = buildCheckoutRequest("carPurchase", {
    carId: "car_1",
    buyerName: "Awa",
  });
  assert.deepEqual(request, {
    orderType: "carPurchase",
    payload: { carId: "car_1", buyerName: "Awa" },
  });
  assert.equal("amount" in request, false);
});

test("redirect validation allows Stripe and local simulated returns", () => {
  assert.equal(
    checkoutRedirectUrl(
      {
        recordId: "purchase_1",
        simulatedPayment: false,
        url: "https://checkout.stripe.com/c/pay/cs_test_123",
      },
      "carPurchase",
      "http://localhost:3000",
    ),
    "https://checkout.stripe.com/c/pay/cs_test_123",
  );
  assert.equal(
    checkoutRedirectUrl(
      { recordId: "purchase_1", simulatedPayment: true },
      "carPurchase",
      "http://localhost:3000",
    ),
    "http://localhost:3000/pay/return/?type=carPurchase&id=purchase_1&status=simulated",
  );
  assert.throws(
    () =>
      checkoutRedirectUrl(
        {
          recordId: "purchase_1",
          simulatedPayment: false,
          url: "https://example.com/not-stripe",
        },
        "carPurchase",
        "http://localhost:3000",
      ),
    /secure payment page/,
  );
});

test("payment return only reports success from authoritative record state", () => {
  assert.equal(paymentReturnState("carPurchase", {}), "pending");
  assert.equal(
    paymentReturnState("carPurchase", { paymentStatus: "succeeded" }),
    "success",
  );
  assert.equal(
    paymentReturnState("barrelDestinationChange", {
      destinationAdjustmentPaymentStatus: "failed",
    }),
    "failed",
  );
  assert.equal(
    paymentReturnState("freightShipment", { checkoutStatus: "expired" }),
    "failed",
  );
});
