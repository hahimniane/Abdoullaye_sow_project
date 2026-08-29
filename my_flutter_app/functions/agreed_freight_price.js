/**
 * Booking the price a business actually quoted.
 *
 * A price request ends with the customer accepting one business's number.
 * The shipment that follows has to charge that number and not the one the
 * pricing table would have computed - the whole point of asking was that the
 * table had no price for this parcel.
 *
 * The amount is read from the request document the customer accepted, never
 * from the client. A client-sent price is a client-chosen price.
 */

/**
 * @param {object} input the request document, caller and business
 * @return {object} the agreed carriage, or why it does not apply
 */
function agreedFreightPrice({request, customerUid, businessId}) {
  if (!request) return {ok: false, reason: "no_request"};
  if (request.customerUid !== customerUid) {
    return {ok: false, reason: "not_your_request"};
  }
  const quoteId = String(request.selectedQuoteId || "").trim();
  if (!quoteId) return {ok: false, reason: "no_accepted_price"};

  // Booking a different business than the one whose price was accepted is
  // not a booking of that price.
  if (String(request.selectedBusinessId || "") !== String(businessId || "")) {
    return {ok: false, reason: "different_business"};
  }
  const cents = Number(request.selectedAmountCents);
  if (!Number.isFinite(cents) || cents <= 0) {
    return {ok: false, reason: "no_accepted_price"};
  }
  // A request that already became a shipment must not become a second one.
  if (String(request.bookedShipmentId || "").trim()) {
    return {ok: false, reason: "already_booked"};
  }
  return {ok: true, quoteId, amountCents: Math.round(cents)};
}

module.exports = {agreedFreightPrice};
