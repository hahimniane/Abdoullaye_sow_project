export const CUSTOMER_CHECKOUT_ORDER_TYPES = [
  "parking",
  "barrelPoolDeposit",
  "barrelPoolJoin",
  "barrelPoolBalance",
  "barrelShipment",
  "barrelOrder",
  "barrelDestinationChange",
  "freightShipment",
  "freightSettlement",
  "carDeposit",
  "carPurchase",
  "holdExtension",
  "transportJob",
] as const;

export type CustomerCheckoutOrderType =
  (typeof CUSTOMER_CHECKOUT_ORDER_TYPES)[number];

export type CheckoutRequest = {
  orderType: CustomerCheckoutOrderType;
  payload: Record<string, unknown>;
};

export type CheckoutResult = {
  recordId: string;
  sessionId?: string;
  simulatedPayment: boolean;
  url?: string | null;
};

export function buildCheckoutRequest(
  orderType: CustomerCheckoutOrderType,
  payload: Record<string, unknown>,
): CheckoutRequest {
  return { orderType, payload: { ...payload } };
}

export function checkoutRedirectUrl(
  result: CheckoutResult,
  orderType: CustomerCheckoutOrderType,
  currentOrigin: string,
) {
  if (result.simulatedPayment) {
    const local = new URL("/pay/return/", currentOrigin);
    local.searchParams.set("type", orderType);
    local.searchParams.set("id", result.recordId);
    local.searchParams.set("status", "simulated");
    return local.toString();
  }
  const url = new URL(String(result.url || ""));
  if (
    url.protocol !== "https:" ||
    !(url.hostname === "checkout.stripe.com" ||
      url.hostname.endsWith(".stripe.com"))
  ) {
    throw new Error("The secure payment page could not be opened.");
  }
  return url.toString();
}

export type PaymentReturnState =
  | "pending"
  | "success"
  | "failed"
  | "cancelled";

export type CheckoutReturnConfirmation = {
  state: PaymentReturnState;
  /// Returned to the customer the record belongs to, so a guest - who has no
  /// workspace to look it up in - leaves the payment screen holding it.
  trackingCode?: string;
};

const RETURN_STATUS_FIELDS: Record<CustomerCheckoutOrderType, string[]> = {
  parking: ["paymentStatus", "checkoutStatus", "status"],
  barrelPoolDeposit: ["paymentStatus", "checkoutStatus"],
  barrelPoolJoin: ["paymentStatus", "checkoutStatus"],
  barrelPoolBalance: ["paymentStatus", "checkoutStatus", "status"],
  barrelShipment: ["paymentStatus", "checkoutStatus", "status"],
  barrelOrder: ["paymentStatus", "checkoutStatus", "status"],
  barrelDestinationChange: [
    "destinationAdjustmentPaymentStatus",
    "checkoutStatus",
  ],
  freightShipment: ["paymentStatus", "checkoutStatus", "status"],
  freightSettlement: [
    "paymentStatus",
    "checkoutStatus",
    "applicationStatus",
  ],
  carDeposit: ["paymentStatus", "checkoutStatus", "purchaseStatus"],
  carPurchase: ["paymentStatus", "checkoutStatus", "purchaseStatus"],
  holdExtension: [
    "extensionPaymentStatus",
    "checkoutStatus",
    "extensionRequestStatus",
  ],
  transportJob: ["paymentStatus", "checkoutStatus", "status"],
};

export function isCustomerCheckoutOrderType(
  value: string,
): value is CustomerCheckoutOrderType {
  return CUSTOMER_CHECKOUT_ORDER_TYPES.includes(
    value as CustomerCheckoutOrderType,
  );
}

export function paymentReturnState(
  orderType: CustomerCheckoutOrderType,
  data: Record<string, unknown>,
): PaymentReturnState {
  const values = RETURN_STATUS_FIELDS[orderType].map((field) =>
    String(data[field] || "").toLowerCase(),
  );
  if (
    values.some((value) =>
      // card_saved: a pay-on-arrival booking's terminal success - the card
      // is verified and saved, and nothing is charged until arrival.
      ["succeeded", "paid", "completed", "applied", "reserved", "card_saved"]
          .includes(value),
    )
  ) {
    return "success";
  }
  if (values.some((value) => ["cancelled", "canceled"].includes(value))) {
    return "cancelled";
  }
  if (values.some((value) => ["failed", "expired"].includes(value))) {
    return "failed";
  }
  return "pending";
}

export function paymentReturnHasCustomerWorkspace(
  user: {isAnonymous?: boolean} | null | undefined,
) {
  return Boolean(user && user.isAnonymous !== true);
}

/**
 * Signed-in customers go back to their workspace after a paid return.
 * Guests have no workspace: bouncing them to `/` is the login screen.
 */
export function paymentReturnShouldRedirect(
  state: string,
  options: {hasCustomerWorkspace?: boolean} = {},
) {
  return state === "success" && options.hasCustomerWorkspace === true;
}

/**
 * A Stripe Checkout Session id in the URL is enough to confirm a guest
 * payment. Do not send them to sign-in just because Firebase Auth is empty
 * after the round-trip.
 */
export function paymentReturnNeedsSignIn(input: {
  sessionId?: string;
  hasUser?: boolean;
}) {
  return !input.hasUser && !String(input.sessionId || "").trim();
}

/**
 * Barrel orders store `trackingCodes`; shipments store `trackingCode`.
 */
export function trackingCodeFromCheckoutRecord(
  data: Record<string, unknown> | undefined,
): string {
  const record = data && typeof data === "object" ? data : {};
  const single = String(record.trackingCode ?? "").trim();
  if (single) return single;
  const listed = Array.isArray(record.trackingCodes) ? record.trackingCodes : [];
  for (const value of listed) {
    const code = String(value ?? "").trim();
    if (code) return code;
  }
  return "";
}

export type CheckoutResumeTarget = {
  orderType: CustomerCheckoutOrderType;
  recordId: string;
};

const SETTLED_PAYMENT = new Set([
  "succeeded",
  "paid",
  "completed",
  "reserved",
  "card_saved",
]);

/**
 * An abandoned pay-now booking the customer can reopen.
 *
 * A barrel with `orderId` must resume the order: siblings share one
 * PaymentIntent, and minting a second barrelOrder is the live bug.
 */
export function checkoutResumeTarget(
  record: Record<string, unknown> | undefined,
): CheckoutResumeTarget | null {
  const data = record && typeof record === "object" ? record : {};
  const status = String(data.status ?? "").toLowerCase();
  const payment = String(data.paymentStatus ?? "").toLowerCase();
  const checkout = String(data.checkoutStatus ?? "").toLowerCase();
  if (SETTLED_PAYMENT.has(payment) || checkout === "completed") return null;
  if (status === "cancelled" || payment === "cancelled") return null;
  if (status !== "pending_payment" && payment !== "pending") return null;
  if (String(data.paymentTiming ?? "") === "arrival") return null;

  const collection = String(
    data.relatedCollection ?? data.collectionName ?? "",
  );
  const id = String(data.id ?? "").trim();
  const orderId = String(data.orderId ?? "").trim();

  if (collection === "barrelShipments" || collection === "barrelOrders") {
    if (orderId) return {orderType: "barrelOrder", recordId: orderId};
    if (collection === "barrelOrders" && id) {
      return {orderType: "barrelOrder", recordId: id};
    }
    if (id) return {orderType: "barrelShipment", recordId: id};
  }
  if (collection === "freightShipments" && id) {
    return {orderType: "freightShipment", recordId: id};
  }
  if (collection === "transportRequests" && id) {
    return {orderType: "transportJob", recordId: id};
  }
  return null;
}

export function checkoutResumePayload(target: CheckoutResumeTarget) {
  if (target.orderType === "transportJob") {
    return {requestId: target.recordId};
  }
  return {resumeRecordId: target.recordId};
}
