import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  CUSTOMER_CHECKOUT_ORDER_TYPES,
  buildCheckoutRequest,
  checkoutRedirectUrl,
  checkoutResumePayload,
  checkoutResumeTarget,
  paymentReturnHasCustomerWorkspace,
  paymentReturnNeedsSignIn,
  paymentReturnState,
  paymentReturnShouldRedirect,
  trackingCodeFromCheckoutRecord,
} from "./customer-checkout.ts";
import { translateValue } from "./french-dom.ts";

test("customer checkout covers all 13 server-paid rails", () => {
  assert.equal(CUSTOMER_CHECKOUT_ORDER_TYPES.length, 13);
  assert.ok(CUSTOMER_CHECKOUT_ORDER_TYPES.includes("barrelPoolJoin"));
  assert.ok(CUSTOMER_CHECKOUT_ORDER_TYPES.includes("holdExtension"));
  // Transport joined when accepting a quote started charging - the last
  // service whose money moved outside the platform.
  assert.ok(CUSTOMER_CHECKOUT_ORDER_TYPES.includes("transportJob"));
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
  assert.equal(paymentReturnState("carDeposit", {}), "pending");
  assert.equal(
    paymentReturnState("carDeposit", {
      paymentStatus: "pending",
      checkoutStatus: "open",
      purchaseStatus: "pending",
    }),
    "pending",
  );
  assert.equal(
    paymentReturnState("carDeposit", {
      paymentStatus: "succeeded",
      checkoutStatus: "completed",
      purchaseStatus: "reserved",
    }),
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
  assert.equal(paymentReturnShouldRedirect("success"), false);
  assert.equal(
    paymentReturnShouldRedirect("success", { hasCustomerWorkspace: true }),
    true,
  );
  assert.equal(
    paymentReturnShouldRedirect("success", { hasCustomerWorkspace: false }),
    false,
  );
});

test("a guest payment return does not require a Firebase session", () => {
  assert.equal(paymentReturnHasCustomerWorkspace(null), false);
  assert.equal(paymentReturnHasCustomerWorkspace({ isAnonymous: true }), false);
  assert.equal(paymentReturnHasCustomerWorkspace({ isAnonymous: false }), true);
  assert.equal(
    paymentReturnNeedsSignIn({ sessionId: "cs_test_abc", hasUser: false }),
    false,
  );
  assert.equal(
    paymentReturnNeedsSignIn({ sessionId: "", hasUser: false }),
    true,
  );
  assert.equal(
    paymentReturnNeedsSignIn({ sessionId: "", hasUser: true }),
    false,
  );
});

test("barrel orders expose a tracking code from the line list", () => {
  assert.equal(
    trackingCodeFromCheckoutRecord({ trackingCode: "BS-QHR2Q4" }),
    "BS-QHR2Q4",
  );
  assert.equal(
    trackingCodeFromCheckoutRecord({ trackingCodes: ["BS-QHR2Q4", "BS-OTHER"] }),
    "BS-QHR2Q4",
  );
  assert.equal(trackingCodeFromCheckoutRecord({}), "");
});

test("payment return recovers the Checkout session and automatically returns", () => {
  const component = fs.readFileSync(
    path.join(process.cwd(), "src/components/pay-return.tsx"),
    "utf8",
  );
  assert.match(component, /confirmCustomerCheckoutSession/);
  assert.match(
    component,
    /paymentReturnShouldRedirect\(state, \{ hasCustomerWorkspace \}\)/,
  );
  assert.match(component, /window\.location\.replace\("\/"\)/);
  assert.match(component, /const timeoutId = setTimeout/);
  assert.doesNotMatch(component, /console\.(?:log|warn|error).*sessionId/);
  // A guest who just paid must confirm from the Session id without waiting
  // for Firebase Auth, and must not be labelled signed-out when that id is
  // present. The anonymous-session-lost Stripe round-trip is the live bug.
  assert.match(component, /if \(!isCardSetup\) confirmPayment\(\)/);
  assert.match(component, /paymentReturnNeedsSignIn/);
  assert.match(component, /useFrenchDomTranslation/);
  assert.doesNotMatch(
    component,
    /const path = user\.isAnonymous\s*\?\s*null/,
  );
});

test("guest payment confirmation copy is localized in French", () => {
  for (const english of ["Your tracking number", "Track this shipment"]) {
    const french = translateValue(english, "fr");
    assert.notEqual(french, english, english);
    assert.ok(french.length > 0, english);
  }
});

test("an unpaid barrel offers Pay now on the same shipment or order", () => {
  assert.deepEqual(
    checkoutResumeTarget({
      id: "ship_1",
      relatedCollection: "barrelShipments",
      status: "pending_payment",
      paymentStatus: "pending",
    }),
    {orderType: "barrelShipment", recordId: "ship_1"},
  );
  // A multi-destination line shares one payment. Resume the order, never
  // mint a second barrelOrder for one abandoned sibling.
  assert.deepEqual(
    checkoutResumeTarget({
      id: "ship_1",
      relatedCollection: "barrelShipments",
      orderId: "order_1",
      status: "pending_payment",
      paymentStatus: "pending",
    }),
    {orderType: "barrelOrder", recordId: "order_1"},
  );
  assert.deepEqual(
    checkoutResumePayload({orderType: "barrelOrder", recordId: "order_1"}),
    {resumeRecordId: "order_1"},
  );
  assert.equal(
    checkoutResumeTarget({
      id: "ship_1",
      relatedCollection: "barrelShipments",
      status: "pending",
      paymentStatus: "succeeded",
    }),
    null,
  );
  assert.equal(
    checkoutResumeTarget({
      id: "fr_1",
      relatedCollection: "freightShipments",
      status: "pending_payment",
      paymentTiming: "arrival",
    }),
    null,
  );
});

test("a transport job's return state reads the request's own fields", () => {
  assert.equal(
    paymentReturnState("transportJob", { paymentStatus: "succeeded" }),
    "success",
  );
  // pending_payment is the between state - neither success nor failure.
  assert.equal(
    paymentReturnState("transportJob", {
      paymentStatus: "pending",
      status: "pending_payment",
    }),
    "pending",
  );
  assert.equal(
    paymentReturnState("transportJob", { paymentStatus: "cancelled" }),
    "cancelled",
  );
});
