const FreightSettlementStatus = Object.freeze({
  AWAITING_ESTIMATE_PAYMENT: "awaiting_estimate_payment",
  AWAITING_WEIGHT: "awaiting_weight",
  BALANCE_DUE: "balance_due",
  BALANCE_PAYMENT_PENDING: "balance_payment_pending",
  REFUND_PROCESSING: "refund_processing",
  SETTLED: "settled",
  NEEDS_ATTENTION: "needs_attention",
  // A pay-on-arrival booking: the business opted in to being paid after the
  // parcel reaches the destination, so the full verified price is owed but
  // deliberately not collected yet. The saved card is charged when the
  // business marks the shipment arrived (ready_for_pickup).
  DUE_ON_ARRIVAL: "due_on_arrival",
});

function positiveMoneyCents(value, field) {
  const cents = Number(value);
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new Error(`${field} must be a non-negative integer number of cents`);
  }
  return cents;
}

function calculateFreightSettlement({
  estimatedTotalCents,
  verifiedWeightKg,
  pricePerKg,
  pickupFeeCents = 0,
  coverageFeeCents = 0,
  destinationDeliveryFeeCents = 0,
  flatPriceCents = 0,
  includedKg = 0,
}) {
  const estimatedCents = positiveMoneyCents(
      estimatedTotalCents,
      "estimatedTotalCents",
  );
  const pickupCents = positiveMoneyCents(pickupFeeCents, "pickupFeeCents");
  // The estimate the customer paid INCLUDED the coverage fee; a final total
  // computed without it "refunded" that fee at every weight confirmation,
  // leaving the parcel covered for free. Coverage is not weight-priced, so
  // the fee rides through settlement unchanged - or repriced upstream when
  // staff corrected what the item actually is.
  const coverageCents = positiveMoneyCents(
      coverageFeeCents,
      "coverageFeeCents",
  );
  // Delivering to the receiver's own address costs the same whatever the
  // parcel finally weighs, so it rides through settlement exactly like the
  // pickup and coverage fees. Leaving it out would refund the delivery at
  // every weight confirmation - the coverage-fee bug above, verbatim.
  const deliveryCents = positiveMoneyCents(
      destinationDeliveryFeeCents,
      "destinationDeliveryFeeCents",
  );
  const weight = Number(verifiedWeightKg);
  const rate = Number(pricePerKg);
  if (!Number.isFinite(weight) || weight <= 0) {
    throw new Error("verifiedWeightKg must be greater than zero");
  }
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("pricePerKg must be greater than zero");
  }

  // A set-price parcel is not repriced by the scale. Its price is what the
  // business published for that item; the scale only answers whether the
  // parcel outgrew the weight that price covers. Charging the excess at the
  // route's per-kg rate keeps the two things the price is made of separate:
  // the set price is the item's value and handling, the excess is the extra
  // mass and nothing else.
  const flatCents = positiveMoneyCents(flatPriceCents, "flatPriceCents");
  const allowance = Number(includedKg);
  if (!Number.isFinite(allowance) || allowance < 0) {
    throw new Error("includedKg must be zero or greater");
  }
  // No allowance means the set price covers the parcel however heavy it is,
  // so there is no excess to find. Treating a blank allowance as a limit of
  // zero would bill every gram on top of a price the customer was told was
  // final - the exact opposite of what a set price promises.
  const finalShippingFeeCents = flatCents > 0 ?
    flatCents + (allowance > 0 ?
      Math.round(Math.max(0, weight - allowance) * rate * 100) :
      0) :
    Math.round(weight * rate * 100);
  const finalTotalCents =
    finalShippingFeeCents + pickupCents + coverageCents + deliveryCents;
  const adjustmentCents = finalTotalCents - estimatedCents;
  const refundDueCents = Math.max(0, -adjustmentCents);

  // Money goes back the way it came, in one card refund.
  //
  // This used to split: wallet credit was applied before card at booking, so
  // an overpayment larger than the card charge had to restore the wallet part
  // separately. Wallet payment has since been retired - every booking is taken
  // in full by card - which left that second leg crediting a balance the
  // customer could no longer spend, only ask for back.
  //
  // The refund is therefore claimed in full against the card, with no local
  // opinion about how much of it is refundable. Stripe knows what was actually
  // charged; asking it for more than that fails loudly through the existing
  // cardRefundStatus and its retry sweeper, which is the right outcome for a
  // legacy booking that really was part-funded by wallet credit. Deciding here
  // would mean silently refunding the customer less than they are owed.
  const refundCardCents = refundDueCents;

  return {
    verifiedWeightKg: Math.round(weight * 1000) / 1000,
    finalShippingFeeCents,
    finalTotalCents,
    adjustmentCents,
    balanceDueCents: Math.max(0, adjustmentCents),
    refundDueCents,
    refundCardCents,
    priceSettlementStatus: adjustmentCents > 0 ?
      FreightSettlementStatus.BALANCE_DUE :
      adjustmentCents < 0 ?
        FreightSettlementStatus.REFUND_PROCESSING :
        FreightSettlementStatus.SETTLED,
  };
}

function freightMayProgress(status) {
  // due_on_arrival progresses unpaid by design: the business opted in to
  // collecting after the parcel lands, so fulfillment cannot wait on money.
  return status === FreightSettlementStatus.SETTLED ||
    status === FreightSettlementStatus.DUE_ON_ARRIVAL;
}

module.exports = {
  FreightSettlementStatus,
  calculateFreightSettlement,
  freightMayProgress,
};
