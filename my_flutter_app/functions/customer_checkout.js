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
  transportJob: Object.freeze({
    createFunction: "createTransportJobPaymentIntent",
    recordIdKey: "requestId",
    productName: "Laawol car transport",
    collection: "transportRequests",
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
    [checkoutOwnerUid(metadata), uid],
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

/**
 * Owner of a Checkout Session, used on the return page.
 *
 * A signed-in caller must be that owner. A guest who lost their anonymous
 * Firebase session after Stripe still holds the unguessable Session id in
 * the URL; that is enough to resume the same record without minting a new
 * uid (which would look like a different customer and duplicate nothing,
 * but would also fail the owner check).
 *
 * @param {object} input session plus optional Firebase uid
 * @return {string} the customer uid stored on the Session
 */
/**
 * Who owns a Checkout Session.
 *
 * Barrel/freight metadata uses `customerUid`. Car deposits and purchases
 * stamp `buyerUid` on the PaymentIntent and used to copy that alone onto
 * the Session — confirm then treated the owner as missing and left a paid
 * hold stuck on "Confirming your payment".
 *
 * @param {object} [metadata] Stripe Session or PaymentIntent metadata
 * @return {string}
 */
function checkoutOwnerUid(metadata) {
  const source = metadata && typeof metadata === "object" ? metadata : {};
  return String(source.customerUid || source.buyerUid || "").trim();
}

function resolveCheckoutReturnCustomerUid({session, callerUid}) {
  const ownerUid = checkoutOwnerUid(session?.metadata);
  const caller = String(callerUid || "").trim();
  if (!ownerUid) {
    const error = new Error("Invalid Checkout return");
    error.code = "invalid-checkout-return";
    throw error;
  }
  if (caller && caller !== ownerUid) {
    const error = new Error("Checkout Session does not match this order");
    error.code = "checkout-session-mismatch";
    throw error;
  }
  return ownerUid;
}

/**
 * Tracking code a guest can leave the return page holding.
 *
 * Barrel orders store `trackingCodes` (one per line). Individual shipments
 * store `trackingCode`. Either shape has to work: returning undefined here
 * is what sent a paid guest to the sign-in screen with no booking code.
 *
 * @param {object} record Firestore payment record
 * @return {string} the first tracking code, or ""
 */
function checkoutTrackingCodeFromRecord(record) {
  const data = record && typeof record === "object" ? record : {};
  const single = String(data.trackingCode || "").trim();
  if (single) return single;
  const listed = Array.isArray(data.trackingCodes) ? data.trackingCodes : [];
  for (const value of listed) {
    const code = String(value || "").trim();
    if (code) return code;
  }
  return "";
}

const CHECKOUT_RESUME_IDENTITY = Object.freeze({
  barrelShipment: Object.freeze({
    paymentType: "barrel_shipment",
    idKey: "shipmentId",
  }),
  barrelOrder: Object.freeze({
    paymentType: "barrel_order",
    idKey: "orderId",
  }),
  freightShipment: Object.freeze({
    paymentType: "freight_shipment",
    idKey: "shipmentId",
  }),
});

/**
 * Whether an open Checkout Session can still be handed back.
 *
 * A held session completes with payment_status "unpaid", so "unpaid" is not
 * the spent signal - status "open" plus an unexpired clock is.
 *
 * @param {object} session Stripe Checkout Session
 * @param {number} [nowMs]
 * @return {boolean}
 */
function checkoutSessionReusable(session, nowMs = Date.now()) {
  const record = session && typeof session === "object" ? session : {};
  if (String(record.status || "") !== "open") return false;
  if (String(record.payment_status || "") === "paid") return false;
  if (!String(record.url || "").trim()) return false;
  const expiresAt = Number(record.expires_at || 0);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) return false;
  return expiresAt * 1000 > Number(nowMs || 0) + 60000;
}

/**
 * An abandoned pay-now booking can reopen the same record.
 *
 * createBarrel* always mints a new shipment/order. Resume must never call
 * those: the customer already has BS- / FR- sitting at pending_payment.
 *
 * @param {object} input
 * @return {object} `{ok: true}` or `{ok: false, reason}`
 */
function resumableCheckoutRecord({orderType, record, customerUid}) {
  if (!record || typeof record !== "object") {
    return {ok: false, reason: "not_found"};
  }
  if (!CHECKOUT_RESUME_IDENTITY[String(orderType || "")]) {
    return {ok: false, reason: "unsupported"};
  }
  const owner = String(record.customerUid || "").trim();
  const caller = String(customerUid || "").trim();
  if (owner !== caller) {
    return {ok: false, reason: "not_yours"};
  }
  if (customerCheckoutPaymentSucceeded(record, "paymentStatus")) {
    return {ok: false, reason: "already_settled"};
  }
  const status = String(record.status || "").toLowerCase();
  const payment = String(record.paymentStatus || "").toLowerCase();
  const checkout = String(record.checkoutStatus || "").toLowerCase();
  if (status === "cancelled" || payment === "cancelled") {
    return {ok: false, reason: "cancelled"};
  }
  if (checkout === "completed") {
    return {ok: false, reason: "already_settled"};
  }
  if (status !== "pending_payment" && payment !== "pending") {
    return {ok: false, reason: "not_pending"};
  }
  // Pay-on-arrival freight saves a card; that path has its own callable.
  if (orderType === "freightShipment" &&
      String(record.paymentTiming || "") === "arrival") {
    return {ok: false, reason: "use_setup_resume"};
  }
  return {ok: true};
}

function checkoutResumeAmountCents(record) {
  const data = record && typeof record === "object" ? record : {};
  const cents = Number(data.cardChargeAmountCents);
  if (Number.isSafeInteger(cents) && cents > 0) return cents;
  const dollars = Number(
      data.price ?? data.total ?? data.cardChargeAmount ?? 0,
  );
  if (Number.isFinite(dollars) && dollars > 0) {
    return Math.round(dollars * 100);
  }
  return 0;
}

function checkoutResumeMetadata({orderType, recordId, record, customerUid}) {
  const spec = CHECKOUT_RESUME_IDENTITY[String(orderType || "")];
  if (!spec) {
    const error = new Error("Unsupported customer checkout action");
    error.code = "unsupported-checkout-action";
    throw error;
  }
  const data = record && typeof record === "object" ? record : {};
  return {
    paymentType: spec.paymentType,
    [spec.idKey]: String(recordId || "").trim(),
    customerUid: String(customerUid || "").trim(),
    businessId: String(data.businessId || ""),
    trackingCode: checkoutTrackingCodeFromRecord(data),
  };
}

module.exports = {
  CUSTOMER_CHECKOUT_ACTIONS,
  checkoutOwnerUid,
  checkoutRecordId,
  checkoutResumeAmountCents,
  checkoutResumeMetadata,
  checkoutSessionIdempotencyKey,
  checkoutSessionReusable,
  checkoutTrackingCodeFromRecord,
  customerCheckoutPaymentSucceeded,
  customerCheckoutReturnEventId,
  customerCheckoutReturnVerification,
  customerCheckoutAction,
  customerCheckoutReturnUrls,
  normalizedConsoleUrl,
  paymentIntentIdFromClientSecret,
  requireCustomerCheckoutAction,
  resolveCheckoutReturnCustomerUid,
  resumableCheckoutRecord,
};
