/**
 * Whether a shipment's card save can be reopened.
 *
 * A pay-on-arrival booking is confirmed by saving a card, not by a charge.
 * If the customer closes that page the shipment sits at pending_payment
 * until they come back and finish the save. Reopening the setup session
 * against the same shipment is that way back.
 */

/**
 * @param {object} input the shipment, and who is asking
 * @return {object} whether it may be reopened, and why not when it may not
 */
function resumableFreightSetup({shipment, customerUid}) {
  if (!shipment) return {ok: false, reason: "not_found"};
  if (shipment.customerUid !== customerUid) {
    return {ok: false, reason: "not_yours"};
  }
  // Only the card-save flow. An upfront payment that failed is a different
  // repair: its PaymentIntent already exists and must be reused, not
  // replaced by a setup session that charges nothing.
  if (shipment.paymentTiming !== "arrival") {
    return {ok: false, reason: "not_pay_on_arrival"};
  }
  if (String(shipment.status || "") !== "pending_payment") {
    return {ok: false, reason: "not_pending"};
  }
  // Already saved: reopening would ask for a card the shipment has.
  if (["succeeded", "paid", "completed", "card_saved"].includes(
      String(shipment.paymentStatus || ""))) {
    return {ok: false, reason: "already_settled"};
  }
  if (String(shipment.checkoutStatus || "") === "completed") {
    return {ok: false, reason: "already_settled"};
  }
  return {ok: true};
}

module.exports = {resumableFreightSetup};
