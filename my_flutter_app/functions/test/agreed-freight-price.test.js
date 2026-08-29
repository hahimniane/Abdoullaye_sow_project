const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {agreedFreightPrice} = require("../agreed_freight_price");

const CUSTOMER = "customer-1";
const BIZ = "biz-1";
const accepted = (overrides = {}) => ({
  customerUid: CUSTOMER,
  selectedQuoteId: "quote-1",
  selectedBusinessId: BIZ,
  selectedAmountCents: 3000,
  ...overrides,
});

describe("charging the price that was accepted", () => {
  it("uses the amount off the request, not the pricing table", () => {
    const result = agreedFreightPrice({
      request: accepted(), customerUid: CUSTOMER, businessId: BIZ,
    });
    assert.equal(result.ok, true);
    assert.equal(result.amountCents, 3000);
    assert.equal(result.quoteId, "quote-1");
  });

  it("refuses a request belonging to somebody else", () => {
    // The amount is read server-side precisely so it cannot be borrowed.
    const result = agreedFreightPrice({
      request: accepted(), customerUid: "someone-else", businessId: BIZ,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "not_your_request");
  });

  it("refuses to bill one business's price to another", () => {
    const result = agreedFreightPrice({
      request: accepted(), customerUid: CUSTOMER, businessId: "other-biz",
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "different_business");
  });

  it("does not apply before a price has been accepted", () => {
    for (const request of [
      accepted({selectedQuoteId: ""}),
      accepted({selectedAmountCents: 0}),
      accepted({selectedAmountCents: "free"}),
      null,
    ]) {
      assert.equal(agreedFreightPrice({
        request, customerUid: CUSTOMER, businessId: BIZ,
      }).ok, false);
    }
  });

  it("refuses to book the same accepted price twice", () => {
    const result = agreedFreightPrice({
      request: accepted({bookedShipmentId: "shipment-1"}),
      customerUid: CUSTOMER,
      businessId: BIZ,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "already_booked");
  });
});
