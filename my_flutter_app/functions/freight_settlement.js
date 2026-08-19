const FreightSettlementStatus = Object.freeze({
  AWAITING_ESTIMATE_PAYMENT: "awaiting_estimate_payment",
  AWAITING_WEIGHT: "awaiting_weight",
  BALANCE_DUE: "balance_due",
  BALANCE_PAYMENT_PENDING: "balance_payment_pending",
  REFUND_PROCESSING: "refund_processing",
  SETTLED: "settled",
  NEEDS_ATTENTION: "needs_attention",
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
  const weight = Number(verifiedWeightKg);
  const rate = Number(pricePerKg);
  if (!Number.isFinite(weight) || weight <= 0) {
    throw new Error("verifiedWeightKg must be greater than zero");
  }
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("pricePerKg must be greater than zero");
  }

  const finalShippingFeeCents = Math.round(weight * rate * 100);
  const finalTotalCents = finalShippingFeeCents + pickupCents + coverageCents;
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
  return status === FreightSettlementStatus.SETTLED;
}

module.exports = {
  FreightSettlementStatus,
  calculateFreightSettlement,
  freightMayProgress,
};
