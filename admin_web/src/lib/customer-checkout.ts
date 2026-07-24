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
      ["succeeded", "paid", "completed", "applied", "reserved"].includes(
        value,
      ),
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

export function paymentReturnShouldRedirect(state: string) {
  return state === "success";
}
