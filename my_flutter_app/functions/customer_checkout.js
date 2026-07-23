const crypto = require("node:crypto");

const CUSTOMER_CHECKOUT_ACTIONS = Object.freeze({
  parking: Object.freeze({
    createFunction: "createParkingReservation",
    recordIdKey: "reservationId",
    productName: "Laawol parking reservation",
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
  }),
  barrelShipment: Object.freeze({
    createFunction: "createBarrelShipmentPaymentIntent",
    recordIdKey: "shipmentId",
    productName: "Laawol barrel shipment",
  }),
  barrelOrder: Object.freeze({
    createFunction: "createBarrelOrderPaymentIntent",
    recordIdKey: "orderId",
    productName: "Laawol barrel shipment order",
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
  }),
  freightSettlement: Object.freeze({
    createFunction: "createFreightSettlementPayment",
    recordIdKey: "settlementId",
    productName: "Laawol freight balance",
  }),
  carDeposit: Object.freeze({
    createFunction: "createCarDepositPaymentIntent",
    recordIdKey: "purchaseId",
    productName: "Laawol vehicle hold deposit",
  }),
  carPurchase: Object.freeze({
    createFunction: "createCarPurchasePaymentIntent",
    recordIdKey: "purchaseId",
    productName: "Laawol vehicle purchase",
  }),
  holdExtension: Object.freeze({
    createFunction: "createPaidHoldExtensionPaymentIntent",
    recordIdKey: "purchaseId",
    productName: "Laawol vehicle hold extension",
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

module.exports = {
  CUSTOMER_CHECKOUT_ACTIONS,
  checkoutRecordId,
  checkoutSessionIdempotencyKey,
  customerCheckoutAction,
  customerCheckoutReturnUrls,
  normalizedConsoleUrl,
  paymentIntentIdFromClientSecret,
  requireCustomerCheckoutAction,
};
