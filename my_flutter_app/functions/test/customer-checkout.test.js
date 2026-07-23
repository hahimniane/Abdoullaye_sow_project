const assert = require("node:assert/strict");
const {describe, it} = require("node:test");
const {
  CUSTOMER_CHECKOUT_ACTIONS,
  checkoutRecordId,
  checkoutSessionIdempotencyKey,
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
});
