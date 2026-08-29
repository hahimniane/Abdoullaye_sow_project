const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {resumableFreightSetup} = require("../resume_freight_setup");

const CUSTOMER = "customer-1";
const stuck = (overrides = {}) => ({
  customerUid: CUSTOMER,
  paymentTiming: "arrival",
  status: "pending_payment",
  paymentStatus: "pending",
  checkoutStatus: "open",
  ...overrides,
});

describe("reopening an abandoned card save", () => {
  it("reopens the one the customer walked away from", () => {
    assert.equal(resumableFreightSetup({
      shipment: stuck(), customerUid: CUSTOMER,
    }).ok, true);
  });

  it("reopens one that never got a session at all", () => {
    assert.equal(resumableFreightSetup({
      shipment: stuck({checkoutStatus: null}), customerUid: CUSTOMER,
    }).ok, true);
  });

  it("is nobody else's to reopen", () => {
    assert.equal(resumableFreightSetup({
      shipment: stuck(), customerUid: "someone-else",
    }).reason, "not_yours");
  });

  it("leaves a settled shipment alone", () => {
    // Reopening would ask for a card the shipment already has.
    for (const shipment of [
      stuck({paymentStatus: "succeeded"}),
      stuck({paymentStatus: "card_saved"}),
      stuck({checkoutStatus: "completed"}),
      stuck({status: "awaiting_weight_confirmation"}),
    ]) {
      assert.equal(resumableFreightSetup({
        shipment, customerUid: CUSTOMER,
      }).ok, false);
    }
  });

  it("does not touch an upfront payment", () => {
    // That one has a PaymentIntent to reuse; a setup session charges
    // nothing and would leave the shipment just as unpaid.
    assert.equal(resumableFreightSetup({
      shipment: stuck({paymentTiming: "upfront"}), customerUid: CUSTOMER,
    }).reason, "not_pay_on_arrival");
  });
});
