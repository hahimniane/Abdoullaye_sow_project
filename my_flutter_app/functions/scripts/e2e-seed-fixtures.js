const {
  FreightSettlementStatus,
  calculateFreightSettlement,
} = require("../freight_settlement");

function buildFreightBalanceFixture({now, businessId}) {
  const shipmentId = "freight-e2e-balance";
  const settlementId = `${shipmentId}_v1`;
  const calculation = calculateFreightSettlement({
    estimatedTotalCents: 12500,
    verifiedWeightKg: 12,
    pricePerKg: 12.5,
    pickupFeeCents: 0,
    originalCardCents: 12500,
  });

  return {
    settlementPath: `freightSettlements/${settlementId}`,
    shipmentUpdate: {
      settlementId,
      verifiedWeightKg: calculation.verifiedWeightKg,
      finalShippingFeeCents: calculation.finalShippingFeeCents,
      finalShippingFee: calculation.finalShippingFeeCents / 100,
      finalTotalCents: calculation.finalTotalCents,
      finalTotal: calculation.finalTotalCents / 100,
      settlementDifferenceCents: calculation.adjustmentCents,
      balanceDueCents: calculation.balanceDueCents,
      balanceDue: calculation.balanceDueCents / 100,
      refundDueCents: calculation.refundDueCents,
      refundDue: calculation.refundDueCents / 100,
      refundCardCents: calculation.refundCardCents,
      refundWalletCents: calculation.refundWalletCents,
      priceSettlementStatus: calculation.priceSettlementStatus,
      weightVerificationStatus: "confirmed",
      weightConfirmedByUid: "e2e-business-owner",
      weightConfirmedAt: now,
      payoutStatus: "awaiting_balance",
      status: "awaiting_balance_payment",
    },
    settlement: {
      settlementId,
      settlementVersion: 1,
      shipmentId,
      trackingCode: "FR-E2E-BALANCE",
      customerUid: "e2e-customer",
      businessId,
      businessName: "E2E Atlantic Logistics",
      currency: "usd",
      platformFeePct: 0.1,
      estimatedWeightKg: 10,
      estimatedTotalCents: 12500,
      ...calculation,
      initialWalletAppliedCents: 0,
      initialCardChargeCents: 12500,
      weightConfirmedByUid: "e2e-business-owner",
      weightConfirmedAt: now,
      cardRefundStatus: "not_required",
      walletRefundStatus: "not_required",
      refundStatus: "not_required",
      createdAt: now,
      updatedAt: now,
    },
  };
}

function buildE2EPlatformAdminProfile() {
  return {
    role: "admin",
    platformAdmin: true,
    adminRole: "superAdmin",
    fullName: "E2E Platform Admin",
    email: "e2e.admin@laawol.test",
  };
}

module.exports = {
  buildE2EPlatformAdminProfile,
  buildFreightBalanceFixture,
  FreightSettlementStatus,
};
