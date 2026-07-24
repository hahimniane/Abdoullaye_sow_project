import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  CUSTOMER_CHECKOUT_ORDER_TYPES,
  buildCheckoutRequest,
  checkoutRedirectUrl,
  paymentReturnState,
  paymentReturnShouldRedirect,
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
  assert.equal(
    paymentReturnState("barrelOrder", {
      paymentStatus: "pending",
      checkoutStatus: "open",
      status: "pending_payment",
    }),
    "pending",
  );
  assert.equal(
    paymentReturnState("barrelOrder", { checkoutStatus: "completed" }),
    "success",
  );
  assert.equal(
    paymentReturnState("barrelOrder", { paymentStatus: "cancelled" }),
    "cancelled",
  );
  assert.equal(paymentReturnShouldRedirect("pending"), false);
  assert.equal(paymentReturnShouldRedirect("failed"), false);
  assert.equal(paymentReturnShouldRedirect("cancelled"), false);
  assert.equal(paymentReturnShouldRedirect("success"), true);
});

test("payment return recovers the Checkout session and automatically returns", () => {
  const component = fs.readFileSync(
    path.join(process.cwd(), "src/components/pay-return.tsx"),
    "utf8",
  );
  assert.match(component, /confirmCustomerCheckoutSession/);
  assert.match(component, /paymentReturnShouldRedirect\(state\)/);
  assert.match(component, /window\.location\.replace\("\/"\)/);
  assert.match(component, /const timeoutId = setTimeout/);
  assert.doesNotMatch(component, /console\.(?:log|warn|error).*sessionId/);
});
