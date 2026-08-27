/**
 * Decision logic for what to do with the price difference when a customer
 * moves a barrel shipment to a different destination.
 *
 * A cheaper destination used to credit the difference to the customer's
 * platform wallet. The wallet is retired (docs/PLAN-2026-08-backlog.md #3), so
 * an overpayment now goes back the way it came, on the card - the same
 * decision freight settlement already makes for a parcel that weighs under its
 * quote.
 *
 * This module is pure: it decides, it does not touch Firestore or Stripe.
 */

/**
 * Decide how a destination-change price difference settles.
 *
 * @param {!Object} params Call parameters.
 * @param {number} params.differenceCents New total minus old total. Negative
 *     means the customer overpaid and is owed money back.
 * @param {string=} params.paymentStatus The shipment's payment status.
 * @param {string=} params.stripePaymentIntentId The intent the original charge
 *     was taken on, if any.
 * @return {{action: string, refundCents: number, reason: string,
 *     paymentIntentId: string}} `action` is one of "none" (nothing to return),
 *     "card_refund" (refund `refundCents` against `paymentIntentId`), or
 *     "manual_review" (money is owed but there is no charge to refund it
 *     against, so a human has to settle it).
 */
function planBarrelDestinationRefund({
  differenceCents,
  paymentStatus = "",
  stripePaymentIntentId = "",
}) {
  const difference = Number(differenceCents);
  if (!Number.isFinite(difference) || difference >= 0) {
    return {
      action: "none",
      refundCents: 0,
      reason: "no_overpayment",
      paymentIntentId: "",
    };
  }
  const refundCents = Math.abs(Math.round(difference));
  if (String(paymentStatus || "").trim() !== "succeeded") {
    // Nothing was taken yet, so the lower price simply applies.
    return {
      action: "none",
      refundCents: 0,
      reason: "not_paid",
      paymentIntentId: "",
    };
  }
  const paymentIntentId = String(stripePaymentIntentId || "").trim();
  if (!paymentIntentId) {
    return {
      action: "manual_review",
      refundCents,
      reason: "missing_payment_intent",
      paymentIntentId: "",
    };
  }
  return {
    action: "card_refund",
    refundCents,
    reason: "overpaid_on_card",
    paymentIntentId,
  };
}

module.exports = {planBarrelDestinationRefund};
