const assert = require("node:assert/strict");
const {describe, it} = require("node:test");
const {
  FreightSettlementStatus,
  calculateFreightSettlement,
  freightMayProgress,
} = require("../freight_settlement");

describe("freight settlement arithmetic", () => {
  it("settles an unchanged verified weight", () => {
    const result = calculateFreightSettlement({
      estimatedTotalCents: 14000,
      verifiedWeightKg: 10,
      pricePerKg: 12,
      pickupFeeCents: 2000,
      originalCardCents: 11500,
    });
    assert.equal(result.finalShippingFeeCents, 12000);
    assert.equal(result.finalTotalCents, 14000);
    assert.equal(result.adjustmentCents, 0);
    assert.equal(result.priceSettlementStatus, FreightSettlementStatus.SETTLED);
  });

  it("requires an explicit balance when verified weight is higher", () => {
    const result = calculateFreightSettlement({
      estimatedTotalCents: 10000,
      verifiedWeightKg: 12,
      pricePerKg: 10,
      originalCardCents: 7500,
    });
    assert.equal(result.balanceDueCents, 2000);
    assert.equal(
        result.priceSettlementStatus,
        FreightSettlementStatus.BALANCE_DUE,
    );
    assert.equal(freightMayProgress(result.priceSettlementStatus), false);
  });

  it("refunds card before restoring the booking wallet contribution", () => {
    const cardOnly = calculateFreightSettlement({
      estimatedTotalCents: 10000,
      verifiedWeightKg: 8,
      pricePerKg: 10,
      originalCardCents: 7500,
    });
    assert.equal(cardOnly.refundCardCents, 2000);
    assert.equal(cardOnly.refundWalletCents, 0);

    const split = calculateFreightSettlement({
      estimatedTotalCents: 10000,
      verifiedWeightKg: 1,
      pricePerKg: 10,
      originalCardCents: 7500,
    });
    assert.equal(split.refundCardCents, 7500);
    assert.equal(split.refundWalletCents, 1500);
    assert.equal(
        split.priceSettlementStatus,
        FreightSettlementStatus.REFUND_PROCESSING,
    );
  });

  it("rejects invalid weights, rates, and non-integer cents", () => {
    assert.throws(() => calculateFreightSettlement({
      estimatedTotalCents: 1000,
      verifiedWeightKg: 0,
      pricePerKg: 10,
    }), /greater than zero/);
    assert.throws(() => calculateFreightSettlement({
      estimatedTotalCents: 10.5,
      verifiedWeightKg: 1,
      pricePerKg: 10,
    }), /integer number of cents/);
  });
});
