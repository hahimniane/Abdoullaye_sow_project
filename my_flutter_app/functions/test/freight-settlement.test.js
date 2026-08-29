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

  it("lets pay-on-arrival progress unpaid after weight confirm", () => {
    assert.equal(
        freightMayProgress(FreightSettlementStatus.DUE_ON_ARRIVAL),
        true,
    );
    assert.equal(
        freightMayProgress(FreightSettlementStatus.SETTLED),
        true,
    );
    assert.equal(
        freightMayProgress(FreightSettlementStatus.AWAITING_WEIGHT),
        false,
    );
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

describe("destination delivery through settlement", () => {
  it("never refunds the delivery fee as an overpayment", () => {
    // The coverage-fee bug's twin: booked 10kg × $2 + $15 delivery = $35.
    // Leaving delivery out of the final total would send $15 "back" and
    // deliver the parcel to the door for free.
    const result = calculateFreightSettlement({
      estimatedTotalCents: 3500,
      verifiedWeightKg: 10,
      pricePerKg: 2,
      destinationDeliveryFeeCents: 1500,
    });
    assert.equal(result.finalTotalCents, 3500);
    assert.equal(result.refundDueCents, 0);
    assert.equal(result.priceSettlementStatus, "settled");
  });

  it("charges the weight difference only, not the delivery again", () => {
    // Delivering to an address costs the same whatever the parcel weighs,
    // so a heavier parcel owes exactly the extra kilos.
    const result = calculateFreightSettlement({
      estimatedTotalCents: 3500,
      verifiedWeightKg: 12,
      pricePerKg: 2,
      destinationDeliveryFeeCents: 1500,
    });
    assert.equal(result.finalTotalCents, 3900);
    assert.equal(result.balanceDueCents, 400);
  });

  it("stacks with pickup and coverage without double counting", () => {
    const result = calculateFreightSettlement({
      estimatedTotalCents: 5300,
      verifiedWeightKg: 10,
      pricePerKg: 2,
      pickupFeeCents: 1000,
      coverageFeeCents: 800,
      destinationDeliveryFeeCents: 1500,
    });
    assert.equal(result.finalTotalCents, 5300);
    assert.equal(result.adjustmentCents, 0);
  });

  it("settles a shipment booked before delivery existed at zero", () => {
    const result = calculateFreightSettlement({
      estimatedTotalCents: 2000,
      verifiedWeightKg: 10,
      pricePerKg: 2,
    });
    assert.equal(result.finalTotalCents, 2000);
  });
});

describe("a set price through settlement", () => {
  it("charges nothing extra when the parcel is inside its allowance", () => {
    // iPhone at $50 covering 2kg. It arrives at 1.4kg - a phone in its box
    // with a charger - and the price is the price.
    const result = calculateFreightSettlement({
      estimatedTotalCents: 5000,
      verifiedWeightKg: 1.4,
      pricePerKg: 8,
      flatPriceCents: 5000,
      includedKg: 2,
    });
    assert.equal(result.finalTotalCents, 5000);
    assert.equal(result.balanceDueCents, 0);
    assert.equal(result.priceSettlementStatus, "settled");
  });

  it("charges the route rate for the weight over the allowance", () => {
    // The box case: the phone arrives packed inside a carton at 6kg. The
    // business is owed the 4kg it never priced for, and nothing more - the
    // set price is not recalculated, only added to.
    const result = calculateFreightSettlement({
      estimatedTotalCents: 5000,
      verifiedWeightKg: 6,
      pricePerKg: 8,
      flatPriceCents: 5000,
      includedKg: 2,
    });
    assert.equal(result.finalShippingFeeCents, 5000 + 3200);
    assert.equal(result.balanceDueCents, 3200);
  });

  it("never charges excess on a set price that covers any weight", () => {
    // No allowance means the price covers the parcel however heavy it is.
    const result = calculateFreightSettlement({
      estimatedTotalCents: 1000,
      verifiedWeightKg: 40,
      pricePerKg: 8,
      flatPriceCents: 1000,
      includedKg: 0,
    });
    assert.equal(result.finalTotalCents, 1000);
    assert.equal(result.balanceDueCents, 0);
  });

  it("adds the flat base to every pass-through fee", () => {
    const result = calculateFreightSettlement({
      estimatedTotalCents: 8000,
      verifiedWeightKg: 2,
      pricePerKg: 8,
      flatPriceCents: 5000,
      includedKg: 2,
      pickupFeeCents: 1500,
      destinationDeliveryFeeCents: 1500,
    });
    assert.equal(result.finalTotalCents, 8000);
    assert.equal(result.adjustmentCents, 0);
  });

  it("refunds when a set-price parcel came in under its estimate", () => {
    // Staff corrected the item to a cheaper row after the customer paid.
    const result = calculateFreightSettlement({
      estimatedTotalCents: 5000,
      verifiedWeightKg: 1,
      pricePerKg: 8,
      flatPriceCents: 3000,
      includedKg: 2,
    });
    assert.equal(result.refundDueCents, 2000);
    assert.equal(result.priceSettlementStatus, "refund_processing");
  });

  it("prices by the scale when there is no flat base", () => {
    // The by-weight path is untouched: zero flat cents means weight x rate,
    // exactly as freight has always settled.
    const result = calculateFreightSettlement({
      estimatedTotalCents: 2000,
      verifiedWeightKg: 10,
      pricePerKg: 2,
      flatPriceCents: 0,
      includedKg: 0,
    });
    assert.equal(result.finalTotalCents, 2000);
  });

  it("rejects a negative allowance rather than pricing from it", () => {
    assert.throws(() => calculateFreightSettlement({
      estimatedTotalCents: 5000,
      verifiedWeightKg: 2,
      pricePerKg: 8,
      flatPriceCents: 5000,
      includedKg: -1,
    }), /includedKg/);
  });
});
