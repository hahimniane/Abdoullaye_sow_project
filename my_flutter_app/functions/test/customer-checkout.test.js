const assert = require("node:assert/strict");
const {describe, it} = require("node:test");
const {
  CUSTOMER_CHECKOUT_ACTIONS,
  checkoutRecordId,
  checkoutSessionIdempotencyKey,
  customerCheckoutPaymentSucceeded,
  customerCheckoutReturnEventId,
  customerCheckoutReturnVerification,
  customerCheckoutReturnUrls,
  paymentIntentIdFromClientSecret,
  requireCustomerCheckoutAction,
} = require("../customer_checkout");

describe("customer Checkout routing", () => {
  it("covers every paid action in the customer web parity plan", () => {
    assert.deepEqual(Object.keys(CUSTOMER_CHECKOUT_ACTIONS).sort(), [
      "barrelDestinationChange",
      "barrelOrder",
      "barrelPoolBalance",
      "barrelPoolDeposit",
      "barrelPoolJoin",
      "barrelShipment",
      "carDeposit",
      "carPurchase",
      "freightSettlement",
      "freightShipment",
      "holdExtension",
      "parking",
    ]);
  });

  it("maps results to stable record IDs", () => {
    const action = requireCustomerCheckoutAction("carPurchase");
    assert.equal(
        checkoutRecordId(action, {purchaseId: "purchase_1"}),
        "purchase_1",
    );
    assert.equal(checkoutRecordId(action, {}), "");
    assert.throws(
        () => requireCustomerCheckoutAction("not-real"),
        /Unsupported customer checkout action/,
    );
  });

  it("extracts the PaymentIntent ID without exposing its client secret", () => {
    assert.equal(
        paymentIntentIdFromClientSecret("pi_123_secret_private"),
        "pi_123",
    );
    assert.equal(
        paymentIntentIdFromClientSecret("seti_123_secret_private"),
        "",
    );
    assert.equal(paymentIntentIdFromClientSecret(""), "");
  });

  it("builds fixed-origin success and cancellation return URLs", () => {
    const urls = customerCheckoutReturnUrls({
      consoleUrl: "https://customer.laawoldigital.com/path?unsafe=1",
      orderType: "carPurchase",
      recordId: "purchase / 1",
    });
    assert.equal(
        urls.successUrl,
        "https://customer.laawoldigital.com/pay/return/?" +
        "type=carPurchase&id=purchase+%2F+1&session={CHECKOUT_SESSION_ID}",
    );
    assert.equal(
        urls.cancelUrl,
        "https://customer.laawoldigital.com/pay/return/?" +
        "type=carPurchase&id=purchase+%2F+1&status=cancel",
    );
  });

  it("uses a deterministic Stripe idempotency key per pending intent", () => {
    const first = checkoutSessionIdempotencyKey("pi_123");
    assert.equal(first, checkoutSessionIdempotencyKey("pi_123"));
    assert.notEqual(first, checkoutSessionIdempotencyKey("pi_456"));
    assert.match(first, /^laawol-checkout-v1-[a-f0-9]{32}$/);
  });

  it("authorizes a paid return and creates a deterministic event", () => {
    const session = {
      id: "cs_test_paid123",
      status: "complete",
      payment_status: "paid",
      payment_intent: "pi_paid123",
      created: 1720000000,
      client_reference_id: "order_1",
      metadata: {
        paymentType: "barrel_order",
        customerUid: "user_1",
        orderId: "order_1",
        checkoutOrderType: "barrelOrder",
        checkoutRecordId: "order_1",
      },
    };
    const result = customerCheckoutReturnVerification({
      session,
      customerUid: "user_1",
      orderType: "barrelOrder",
      recordId: "order_1",
    });
    assert.equal(result.state, "paid");
    assert.equal(result.event.type, "checkout.session.completed");
    assert.equal(result.event.data.object, session);
    assert.equal(
        result.event.id,
        customerCheckoutReturnEventId(session.id),
    );
    assert.match(result.event.id, /^evt_return_[a-f0-9]{32}$/);
  });

  it("keeps an unpaid Checkout return pending", () => {
    const result = customerCheckoutReturnVerification({
      session: {
        id: "cs_test_pending123",
        status: "open",
        payment_status: "unpaid",
        payment_intent: null,
        client_reference_id: "order_1",
        metadata: {
          customerUid: "user_1",
          checkoutOrderType: "barrelOrder",
          checkoutRecordId: "order_1",
        },
      },
      customerUid: "user_1",
      orderType: "barrelOrder",
      recordId: "order_1",
    });
    assert.deepEqual(result, {state: "pending", event: null});
  });

  it("rejects Checkout returns for another user, type, or record", () => {
    const base = {
      id: "cs_test_mismatch123",
      status: "complete",
      payment_status: "paid",
      payment_intent: "pi_paid123",
      client_reference_id: "order_1",
      metadata: {
        customerUid: "user_1",
        checkoutOrderType: "barrelOrder",
        checkoutRecordId: "order_1",
      },
    };
    for (const input of [
      {customerUid: "user_2", orderType: "barrelOrder", recordId: "order_1"},
      {
        customerUid: "user_1",
        orderType: "freightShipment",
        recordId: "order_1",
      },
      {customerUid: "user_1", orderType: "barrelOrder", recordId: "order_2"},
    ]) {
      assert.throws(
          () => customerCheckoutReturnVerification({session: base, ...input}),
          (error) => error.code === "checkout-session-mismatch",
      );
    }
  });

  it("returns success only from an authoritative saved payment state", () => {
    assert.equal(
        customerCheckoutPaymentSucceeded(
            {paymentStatus: "pending", checkoutStatus: "completed"},
            "paymentStatus",
        ),
        false,
    );
    assert.equal(
        customerCheckoutPaymentSucceeded(
            {paymentStatus: "succeeded"},
            "paymentStatus",
        ),
        true,
    );
    assert.equal(
        customerCheckoutPaymentSucceeded(
            {stripeReconciliationState: "succeeded"},
            "paymentStatus",
        ),
        true,
    );
  });
});
