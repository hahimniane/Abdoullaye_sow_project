const crypto = require("node:crypto");

const {checkoutSessionSecured} = require("./payment_hold");

const CUSTOMER_CHECKOUT_ACTIONS = Object.freeze({
  parking: Object.freeze({
    createFunction: "createParkingReservation",
    recordIdKey: "reservationId",
    productName: "Laawol parking reservation",
    collection: "parkedCars",
  }),
  barrelPoolDeposit: Object.freeze({
    createFunction: "createBarrelPool",
    recordIdKey: "poolId",
    productName: "Laawol shared barrel deposit",
  }),
  barrelPoolJoin: Object.freeze({
    createFunction: "requestJoinBarrelPool",
    recordIdKey: "poolId",
    productName: "Laawol shared barrel deposit",
  }),
  barrelPoolBalance: Object.freeze({
    createFunction: "createBarrelPoolBalancePaymentIntent",
    recordIdKey: "requestId",
    productName: "Laawol shared barrel balance",
    collection: "barrelPoolBalanceRequests",
  }),
  barrelShipment: Object.freeze({
    createFunction: "createBarrelShipmentPaymentIntent",
    recordIdKey: "shipmentId",
    productName: "Laawol barrel shipment",
    collection: "barrelShipments",
  }),
  barrelOrder: Object.freeze({
    createFunction: "createBarrelOrderPaymentIntent",
    recordIdKey: "orderId",
    productName: "Laawol barrel shipment order",
    collection: "barrelOrders",
  }),
  barrelDestinationChange: Object.freeze({
    createFunction: "changeBarrelShipmentDestination",
    recordIdKey: "shipmentId",
    productName: "Laawol barrel destination change",
  }),
  freightShipment: Object.freeze({
    createFunction: "createFreightShipmentPaymentIntent",
    recordIdKey: "shipmentId",
    productName: "Laawol freight shipment",
    collection: "freightShipments",
  }),
  freightSettlement: Object.freeze({
    createFunction: "createFreightSettlementPayment",
    recordIdKey: "settlementId",
    productName: "Laawol freight balance",
    // The settlement's charge routing actually lives on its paymentAttempts
    // sub-doc, not this top-level doc - direct-charge routing isn't
    // resolvable from recordId alone here, so this action stays
    // platform-mode-only for the web checkout-redirect path.
  }),
  carDeposit: Object.freeze({
    createFunction: "createCarDepositPaymentIntent",
    recordIdKey: "purchaseId",
    productName: "Laawol vehicle hold deposit",
    collection: "carPurchases",
  }),
  carPurchase: Object.freeze({
    createFunction: "createCarPurchasePaymentIntent",
    recordIdKey: "purchaseId",
    productName: "Laawol vehicle purchase",
    collection: "carPurchases",
  }),
  holdExtension: Object.freeze({
    createFunction: "createPaidHoldExtensionPaymentIntent",
    recordIdKey: "purchaseId",
    productName: "Laawol vehicle hold extension",
    collection: "carPurchases",
    chargeTypeField: "extensionStripeChargeType",
    connectedAccountField: "extensionStripeConnectedAccountId",
  }),
});

function customerCheckoutAction(orderType) {
  return CUSTOMER_CHECKOUT_ACTIONS[String(orderType || "").trim()] || null;
}

function requireCustomerCheckoutAction(orderType) {
  const action = customerCheckoutAction(orderType);
  if (!action) {
    const error = new Error("Unsupported customer checkout action");
    error.code = "unsupported-checkout-action";
    throw error;
  }
  return action;
}

function checkoutRecordId(action, result) {
  return String(result?.[action.recordIdKey] || "").trim();
}

function paymentIntentIdFromClientSecret(clientSecret) {
  const value = String(clientSecret || "").trim();
  const marker = "_secret_";
  const markerIndex = value.indexOf(marker);
  if (!value.startsWith("pi_") || markerIndex < 4) return "";
  return value.slice(0, markerIndex);
}

function normalizedConsoleUrl(value) {
  const fallback = "https://customer.laawoldigital.com";
  try {
    const url = new URL(String(value || fallback));
    if (url.protocol !== "https:" && url.hostname !== "localhost" &&
        url.hostname !== "127.0.0.1") {
      return fallback;
    }
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return fallback;
  }
}

function customerCheckoutReturnUrls({consoleUrl, orderType, recordId}) {
  const base = normalizedConsoleUrl(consoleUrl);
  const query = new URLSearchParams({
    type: String(orderType),
    id: String(recordId),
  });
  return {
    successUrl:
      `${base}/pay/return/?${query.toString()}` +
      "&session={CHECKOUT_SESSION_ID}",
    cancelUrl: `${base}/pay/return/?${query.toString()}&status=cancel`,
  };
}

function checkoutSessionIdempotencyKey(paymentIntentId) {
  const digest = crypto.createHash("sha256")
      .update(String(paymentIntentId || ""))
      .digest("hex")
      .slice(0, 32);
  return `laawol-checkout-v1-${digest}`;
}

function customerCheckoutReturnEventId(sessionId) {
  const value = String(sessionId || "").trim();
  if (!/^cs_(?:test_|live_)?[A-Za-z0-9]+$/.test(value)) {
    const error = new Error("Invalid Checkout Session");
    error.code = "invalid-checkout-session";
    throw error;
  }
  const digest = crypto.createHash("sha256")
      .update(value)
      .digest("hex")
      .slice(0, 32);
  return `evt_return_${digest}`;
}

function customerCheckoutReturnVerification({
  session,
  customerUid,
  orderType,
  recordId,
}) {
  const uid = String(customerUid || "").trim();
  const type = String(orderType || "").trim();
  const id = String(recordId || "").trim();
  requireCustomerCheckoutAction(type);
  if (!uid || !id || !session || typeof session !== "object") {
    const error = new Error("Invalid Checkout return");
    error.code = "invalid-checkout-return";
    throw error;
  }

  const sessionId = String(session.id || "").trim();
  const eventId = customerCheckoutReturnEventId(sessionId);
  const metadata = session.metadata || {};
  const mismatches = [
    [String(session.client_reference_id || "").trim(), id],
    [String(metadata.checkoutOrderType || "").trim(), type],
    [String(metadata.checkoutRecordId || "").trim(), id],
    [String(metadata.customerUid || "").trim(), uid],
  ].filter(([actual, expected]) => actual !== expected);
  if (mismatches.length > 0) {
    const error = new Error("Checkout Session does not match this order");
    error.code = "checkout-session-mismatch";
    throw error;
  }

  // "Secured", not "paid": a manual-capture session completes with
  // payment_status "unpaid" while the money sits reserved on the card. Taking
  // Stripe's word at face value here would reject every held payment - see
  // payment_hold.js for the full model.
  if (!checkoutSessionSecured(session)) {
    return {state: "pending", event: null};
  }

  return {
    state: "paid",
    event: {
      id: eventId,
      type: "checkout.session.completed",
      created: Number(session.created || 0),
      data: {object: session},
    },
  };
}

function customerCheckoutPaymentSucceeded(data, paymentStatusField) {
  const paymentStatus = String(data?.[paymentStatusField] || "")
      .trim()
      .toLowerCase();
  return [
    "succeeded",
    "paid",
    "completed",
    "applied",
    "reserved",
  ].includes(paymentStatus) ||
    String(data?.stripeReconciliationState || "").trim() === "succeeded";
}

module.exports = {
  CUSTOMER_CHECKOUT_ACTIONS,
  checkoutRecordId,
  checkoutSessionIdempotencyKey,
  customerCheckoutPaymentSucceeded,
  customerCheckoutReturnEventId,
  customerCheckoutReturnVerification,
  customerCheckoutAction,
  customerCheckoutReturnUrls,
  normalizedConsoleUrl,
  paymentIntentIdFromClientSecret,
  requireCustomerCheckoutAction,
};
