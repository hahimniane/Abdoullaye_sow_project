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

describe("coverage through settlement", () => {
  it("no longer refunds the coverage fee as an overpayment", () => {
    // Booked: 10kg × $2 + $8 cover = $28 paid. Verified at exactly 10kg.
    // The old math computed a $20 final against a $28 estimate and sent $8
    // "back" - the customer ended up covered for free on every accurate
    // estimate.
    const result = calculateFreightSettlement({
      estimatedTotalCents: 2800,
      verifiedWeightKg: 10,
      pricePerKg: 2,
      coverageFeeCents: 800,
    });
    assert.equal(result.finalTotalCents, 2800);
    assert.equal(result.refundDueCents, 0);
    assert.equal(result.priceSettlementStatus, "settled");
  });

  it("keeps the corrected fee when staff corrected the item", () => {
    // Customer said Samsung ($5 fee), staff found an iPhone ($8 fee): the
    // balance owes the weight difference AND the fee difference.
    const result = calculateFreightSettlement({
      estimatedTotalCents: 2500,
      verifiedWeightKg: 10,
      pricePerKg: 2,
      coverageFeeCents: 800,
    });
    assert.equal(result.balanceDueCents, 300);
  });
});
