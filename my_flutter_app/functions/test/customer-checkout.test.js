const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");
const {
  CUSTOMER_CHECKOUT_ACTIONS,
  checkoutRecordId,
  checkoutResumeAmountCents,
  checkoutResumeMetadata,
  checkoutSessionIdempotencyKey,
  checkoutSessionReusable,
  checkoutTrackingCodeFromRecord,
  customerCheckoutPaymentSucceeded,
  customerCheckoutReturnEventId,
  customerCheckoutReturnVerification,
  customerCheckoutReturnUrls,
  paymentIntentIdFromClientSecret,
  requireCustomerCheckoutAction,
  resolveCheckoutReturnCustomerUid,
  resumableCheckoutRecord,
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
      "transportJob",
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

  it("lets a guest resume the same Checkout Session without Auth", () => {
    const session = {
      metadata: {customerUid: "anon_guest_1"},
    };
    assert.equal(
        resolveCheckoutReturnCustomerUid({session, callerUid: ""}),
        "anon_guest_1",
    );
    assert.equal(
        resolveCheckoutReturnCustomerUid({
          session,
          callerUid: "anon_guest_1",
        }),
        "anon_guest_1",
    );
    assert.throws(
        () => resolveCheckoutReturnCustomerUid({
          session,
          callerUid: "someone_else",
        }),
        (error) => error.code === "checkout-session-mismatch",
    );
    assert.throws(
        () => resolveCheckoutReturnCustomerUid({
          session: {metadata: {}},
          callerUid: "",
        }),
        (error) => error.code === "invalid-checkout-return",
    );
  });

  it("reads a barrel order's tracking code off the line list", () => {
    assert.equal(
        checkoutTrackingCodeFromRecord({trackingCode: "BS-QHR2Q4"}),
        "BS-QHR2Q4",
    );
    assert.equal(
        checkoutTrackingCodeFromRecord({
          trackingCodes: ["BS-QHR2Q4", "BS-OTHER1"],
        }),
        "BS-QHR2Q4",
    );
    assert.equal(checkoutTrackingCodeFromRecord({}), "");
  });

  it("confirms a Checkout return without requireAuth", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "..", "index.js"),
        "utf8",
    );
    const start = source.indexOf("exports.confirmCustomerCheckoutSession");
    assert.ok(start > 0);
    const body = source.slice(start, start + 4500);
    assert.match(body, /resolveCheckoutReturnCustomerUid/);
    assert.match(body, /const callerUid = String\(request\.auth\?\.uid/);
    assert.doesNotMatch(body, /requireAuth\(request\)/);
    const trackingHelperStart = source.indexOf(
        "async function checkoutTrackingCode(",
    );
    assert.match(
        source.slice(trackingHelperStart, trackingHelperStart + 700),
        /checkoutTrackingCodeFromRecord/,
    );
  });
});

describe("resuming an abandoned pay-now checkout", () => {
  const pendingBarrel = {
    customerUid: "user_1",
    status: "pending_payment",
    paymentStatus: "pending",
    cardChargeAmountCents: 11000,
    businessId: "biz_1",
    trackingCode: "BS-ZX7RVG",
  };

  it("reopens the same unpaid barrel shipment", () => {
    assert.deepEqual(
        resumableCheckoutRecord({
          orderType: "barrelShipment",
          record: pendingBarrel,
          customerUid: "user_1",
        }),
        {ok: true},
    );
  });

  it("reopens the same unpaid barrel order", () => {
    assert.equal(
        resumableCheckoutRecord({
          orderType: "barrelOrder",
          record: pendingBarrel,
          customerUid: "user_1",
        }).ok,
        true,
    );
  });

  it("is nobody else's to reopen", () => {
    assert.equal(
        resumableCheckoutRecord({
          orderType: "barrelShipment",
          record: pendingBarrel,
          customerUid: "someone_else",
        }).reason,
        "not_yours",
    );
  });

  it("leaves a paid or cancelled booking alone", () => {
    assert.equal(
        resumableCheckoutRecord({
          orderType: "barrelShipment",
          record: {...pendingBarrel, paymentStatus: "succeeded"},
          customerUid: "user_1",
        }).reason,
        "already_settled",
    );
    assert.equal(
        resumableCheckoutRecord({
          orderType: "barrelShipment",
          record: {...pendingBarrel, status: "cancelled"},
          customerUid: "user_1",
        }).reason,
        "cancelled",
    );
  });

  it("does not steal the freight card-save resume", () => {
    assert.equal(
        resumableCheckoutRecord({
          orderType: "freightShipment",
          record: {...pendingBarrel, paymentTiming: "arrival"},
          customerUid: "user_1",
        }).reason,
        "use_setup_resume",
    );
  });

  it("reads the stored charge without inventing a new price", () => {
    assert.equal(checkoutResumeAmountCents(pendingBarrel), 11000);
    assert.equal(checkoutResumeAmountCents({price: 110}), 11000);
    assert.equal(checkoutResumeAmountCents({}), 0);
  });

  it("builds Stripe metadata that routes back to the same record", () => {
    assert.deepEqual(
        checkoutResumeMetadata({
          orderType: "barrelOrder",
          recordId: "order_1",
          record: pendingBarrel,
          customerUid: "user_1",
        }),
        {
          paymentType: "barrel_order",
          orderId: "order_1",
          customerUid: "user_1",
          businessId: "biz_1",
          trackingCode: "BS-ZX7RVG",
        },
    );
  });

  it("reuses an open Checkout Session and rejects a spent one", () => {
    const nowMs = 1720000000000;
    assert.equal(
        checkoutSessionReusable({
          status: "open",
          payment_status: "unpaid",
          url: "https://checkout.stripe.com/c/pay/cs_test_1",
          expires_at: Math.floor(nowMs / 1000) + 1800,
        }, nowMs),
        true,
    );
    assert.equal(
        checkoutSessionReusable({
          status: "expired",
          payment_status: "unpaid",
          url: "https://checkout.stripe.com/c/pay/cs_test_1",
          expires_at: Math.floor(nowMs / 1000) + 1800,
        }, nowMs),
        false,
    );
  });

  it("createCustomerCheckoutSession resumes before minting a record", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "..", "index.js"),
        "utf8",
    );
    const start = source.indexOf("exports.createCustomerCheckoutSession");
    assert.ok(start > 0);
    const body = source.slice(start, start + 2500);
    assert.match(body, /payload\.resumeRecordId/);
    assert.match(body, /resumeExistingCustomerCheckout/);
    const resumeBeforeCreate =
      body.indexOf("resumeExistingCustomerCheckout") <
      body.indexOf("action.createFunction");
    assert.equal(resumeBeforeCreate, true);
    const resumeFn = source.indexOf(
        "async function resumeExistingCustomerCheckout",
    );
    assert.ok(resumeFn > 0);
    const resumeBody = source.slice(resumeFn, resumeFn + 2200);
    assert.doesNotMatch(resumeBody, /createBarrelOrderPaymentIntent/);
    assert.doesNotMatch(resumeBody, /createBarrelShipmentPaymentIntent/);
    assert.match(resumeBody, /resumableCheckoutRecord/);
  });
});
