/**
 * Business-side freight fulfillment gates.
 *
 * Pay-now shipments wait for a succeeded card charge before weight confirm
 * or status changes. Pay-on-arrival is the opposite deal: the customer saves
 * a card at booking (paymentStatus card_saved) and the business fulfills
 * unpaid. The saved card is charged when the shipment is marked arrived
 * (ready_for_pickup). Treating card_saved like an unpaid pay-now locks
 * fulfillment forever — the customer has nothing left to pay until arrival.
 */

export function freightIsPayOnArrival(
  row: Readonly<Record<string, unknown>> | null | undefined,
): boolean {
  if (!row) return false;
  return row.payOnArrival === true ||
    String(row.paymentTiming ?? "").toLowerCase() === "arrival";
}

function paymentStatusOf(
  row: Readonly<Record<string, unknown>> | null | undefined,
): string {
  return String(row?.paymentStatus ?? "").toLowerCase();
}

function settlementStatusOf(
  row: Readonly<Record<string, unknown>> | null | undefined,
): string {
  return String(row?.priceSettlementStatus ?? "").toLowerCase();
}

export function freightPricingVersion(
  row: Readonly<Record<string, unknown>> | null | undefined,
): number {
  return Number(row?.freightPricingVersion ?? 0);
}

const PAID_PAYMENT = new Set(["paid", "succeeded", "completed"]);

/**
 * Whether the business may confirm weight (and otherwise treat the booking
 * as secured).
 *
 * A saved card on a pay-on-arrival booking is the terminal booking success.
 * Pay-now still requires a real charge.
 */
export function freightPaymentReadyForFulfillment(
  row: Readonly<Record<string, unknown>> | null | undefined,
): boolean {
  const payment = paymentStatusOf(row);
  if (PAID_PAYMENT.has(payment)) return true;
  return freightIsPayOnArrival(row) && payment === "card_saved";
}

/**
 * Whether the status <select> may be used at all.
 *
 * Weight confirmation still has to happen first on v2 weighable parcels
 * (settlement stays awaiting_weight). After that, due_on_arrival is enough
 * to move the parcel — completion still waits for settled, which is
 * enforced per destination status, not by disabling the whole control.
 */
export function freightSettlementReadyForStatus(
  row: Readonly<Record<string, unknown>> | null | undefined,
): boolean {
  if (freightPricingVersion(row) < 2) return true;
  const settlement = settlementStatusOf(row);
  if (settlement === "settled") return true;
  return freightIsPayOnArrival(row) && settlement === "due_on_arrival";
}

export function freightCanConfirmWeight(
  row: Readonly<Record<string, unknown>> | null | undefined,
): boolean {
  return freightPaymentReadyForFulfillment(row);
}

export function freightCanUpdateStatus(
  row: Readonly<Record<string, unknown>> | null | undefined,
): boolean {
  return freightPaymentReadyForFulfillment(row) &&
    freightSettlementReadyForStatus(row);
}

const ARRIVAL_PROGRESS_STATUSES = new Set(["in_transit", "ready_for_pickup"]);
const SETTLEMENT_GATED_STATUSES = new Set([
  "in_transit",
  "ready_for_pickup",
  "completed",
]);

/**
 * Whether writing this status is allowed given the current settlement.
 *
 * due_on_arrival may go in_transit / ready_for_pickup (arrival is what
 * charges the saved card). completed still requires settled so the
 * business cannot hand the parcel over before the money lands.
 */
export function freightStatusChangeAllowed(
  row: Readonly<Record<string, unknown>> | null | undefined,
  nextStatus: string,
): boolean {
  if (freightPricingVersion(row) < 2) return true;
  if (!SETTLEMENT_GATED_STATUSES.has(nextStatus)) return true;
  const settlement = settlementStatusOf(row);
  if (settlement === "settled") return true;
  return freightIsPayOnArrival(row) &&
    settlement === "due_on_arrival" &&
    ARRIVAL_PROGRESS_STATUSES.has(nextStatus);
}

export function freightSetupIsResumable(
  row: Readonly<Record<string, unknown>> | null | undefined,
): boolean {
  if (!row) return false;
  if (!freightIsPayOnArrival(row)) return false;
  if (String(row.status ?? "").toLowerCase() !== "pending_payment") {
    return false;
  }
  const payment = paymentStatusOf(row);
  if (PAID_PAYMENT.has(payment) || payment === "card_saved") return false;
  if (String(row.checkoutStatus ?? "").toLowerCase() === "completed") {
    return false;
  }
  return true;
}

export type FreightCustomerPayKind = "setup" | "settlement" | null;

/**
 * What, if anything, the customer should be offered to pay.
 *
 * Card-saved + awaiting weight: nothing — the business fulfills, then the
 * saved card is charged. Abandoned setup: Finish payment (save the card).
 * Arrival charge failed (balance_due): Pay now against the settlement.
 */
export function freightCustomerPayKind(
  row: Readonly<Record<string, unknown>> | null | undefined,
): FreightCustomerPayKind {
  if (!row) return null;
  const settlement = settlementStatusOf(row);
  const due = Number(
    row.balanceDueCents ?? (Number(row.balanceDue || 0) * 100),
  );
  if (
    Number.isFinite(due) &&
    due > 0 &&
    ["balance_due", "balance_payment_pending"].includes(settlement)
  ) {
    return "settlement";
  }
  if (freightSetupIsResumable(row)) return "setup";
  return null;
}
