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
  originalCardCents = 0,
}) {
  const estimatedCents = positiveMoneyCents(
      estimatedTotalCents,
      "estimatedTotalCents",
  );
  const pickupCents = positiveMoneyCents(pickupFeeCents, "pickupFeeCents");
  const cardCents = positiveMoneyCents(originalCardCents, "originalCardCents");
  const weight = Number(verifiedWeightKg);
  const rate = Number(pricePerKg);
  if (!Number.isFinite(weight) || weight <= 0) {
    throw new Error("verifiedWeightKg must be greater than zero");
  }
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("pricePerKg must be greater than zero");
  }

  const finalShippingFeeCents = Math.round(weight * rate * 100);
  const finalTotalCents = finalShippingFeeCents + pickupCents;
  const adjustmentCents = finalTotalCents - estimatedCents;
  const refundDueCents = Math.max(0, -adjustmentCents);

  // Wallet is applied before card at booking, so the card is the marginal
  // payment source. Return overpayment to card first, then restore any wallet
  // amount that is still owed. This is deterministic and fully auditable.
  const refundCardCents = Math.min(refundDueCents, cardCents);
  const refundWalletCents = refundDueCents - refundCardCents;

  return {
    verifiedWeightKg: Math.round(weight * 1000) / 1000,
    finalShippingFeeCents,
    finalTotalCents,
    adjustmentCents,
    balanceDueCents: Math.max(0, adjustmentCents),
    refundDueCents,
    refundCardCents,
    refundWalletCents,
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
