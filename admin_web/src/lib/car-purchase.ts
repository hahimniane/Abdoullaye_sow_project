/**
 * Paid-hold settlement rules for the business console.
 *
 * Mirrors `my_flutter_app/functions/car_purchase.js`. The callables refuse
 * Mark sold / Completed on an unpaid hold; this file hides those buttons
 * so the console never offers an action the server will reject.
 */

const SETTLED_PAYMENTS = [
  "succeeded",
  "paid",
  "reserved",
] as const;

const RESERVED_HOLD_STATUSES = [
  "reserved",
  "hold_review_required",
] as const;

const TERMINAL_PURCHASE_STATUSES = [
  "completed",
  "no_show",
  "cancelled",
  "refunded",
  "forfeited",
] as const;

export type CarPurchaseRecord = {
  paymentType?: unknown;
  paymentStatus?: unknown;
  purchaseStatus?: unknown;
  appointmentStart?: unknown;
  depositAmount?: unknown;
};

export function isPaidHold(purchase: CarPurchaseRecord | undefined) {
  return String(purchase?.paymentType ?? "").trim() === "reservation_deposit";
}

export function purchaseIsViewing(purchase: CarPurchaseRecord | undefined) {
  if (String(purchase?.paymentType ?? "").trim() === "viewing_reservation") {
    return true;
  }
  return Boolean(purchase?.appointmentStart) &&
    Number(purchase?.depositAmount ?? 0) === 0;
}

export function isTerminalPurchaseStatus(status: unknown) {
  return (TERMINAL_PURCHASE_STATUSES as readonly string[]).includes(
    String(status ?? "").trim(),
  );
}

export function carPurchasePaymentSucceeded(
  purchase: CarPurchaseRecord | undefined,
) {
  return (SETTLED_PAYMENTS as readonly string[]).includes(
    String(purchase?.paymentStatus ?? "").trim().toLowerCase(),
  );
}

export function paidHoldIsReserved(purchase: CarPurchaseRecord | undefined) {
  return (RESERVED_HOLD_STATUSES as readonly string[]).includes(
    String(purchase?.purchaseStatus ?? "").trim().toLowerCase(),
  );
}

export function paidHoldCanBeFinalized(purchase: CarPurchaseRecord | undefined) {
  return isPaidHold(purchase) &&
    carPurchasePaymentSucceeded(purchase) &&
    paidHoldIsReserved(purchase);
}

export function carPurchaseCanMarkSold(purchase: CarPurchaseRecord | undefined) {
  return paidHoldCanBeFinalized(purchase);
}

export function carPurchaseCanMarkCompleted(
  purchase: CarPurchaseRecord | undefined,
) {
  const record = purchase && typeof purchase === "object" ? purchase : {};
  if (purchaseIsViewing(record)) return false;
  if (isPaidHold(record)) return paidHoldCanBeFinalized(record);
  if (isTerminalPurchaseStatus(record.purchaseStatus)) return false;
  if (String(record.paymentStatus ?? "").trim().toLowerCase() ===
      "not_required") {
    return true;
  }
  return carPurchasePaymentSucceeded(record);
}

/**
 * What the customer order drawer should show as the total.
 *
 * Car holds store the charge on `depositAmount`. Using price/totalAmount
 * first is why a $500 hold rendered as $0.00.
 */
export function customerOrderAmount(row: Record<string, unknown> | undefined) {
  const record = row && typeof row === "object" ? row : {};
  for (const field of [
    "totalAmount",
    "amount",
    "purchasePrice",
    "price",
    "depositAmount",
  ]) {
    const value = Number(record[field]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}
