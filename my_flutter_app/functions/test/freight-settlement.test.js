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
    });
    assert.equal(result.balanceDueCents, 2000);
    assert.equal(
        result.priceSettlementStatus,
        FreightSettlementStatus.BALANCE_DUE,
    );
    assert.equal(freightMayProgress(result.priceSettlementStatus), false);
  });

  it("returns the whole overpayment to the card", () => {
    const result = calculateFreightSettlement({
      estimatedTotalCents: 10000,
      verifiedWeightKg: 8,
      pricePerKg: 10,
    });
    assert.equal(result.refundCardCents, 2000);
    assert.equal(
        result.priceSettlementStatus,
        FreightSettlementStatus.REFUND_PROCESSING,
    );
  });

  it("claims the full refund on the card, never a partial one", () => {
    // Wallet payment is retired, so the card carries the whole booking and the
    // whole refund. Nothing here may quietly hold money back: an amount larger
    // than the original charge is Stripe's to refuse, and refusing loudly is
    // the point - the alternative is short-refunding a customer in silence.
    const result = calculateFreightSettlement({
      estimatedTotalCents: 10000,
      verifiedWeightKg: 1,
      pricePerKg: 10,
    });
    assert.equal(result.refundDueCents, 9000);
    assert.equal(result.refundCardCents, 9000);
    assert.equal(
        result.refundCardCents,
        result.refundDueCents,
        "the card refund must always equal the refund due",
    );
    assert.equal(
        result.refundWalletCents,
        undefined,
        "no wallet leg is produced any more",
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
