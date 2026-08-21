const assert = require("node:assert/strict");
const test = require("node:test");

const {
  freightDeliveryPolicy,
  quoteFreightDelivery,
  validateFreightDeliverySettings,
  MAX_DESTINATION_DELIVERY_FEE,
} = require("../freight_delivery");

test("a business offers delivery only once it has priced it", () => {
  assert.deepEqual(freightDeliveryPolicy({}), {
    offered: false, fee: 0, feeCents: 0,
  });
  // Opted in but unpriced is an unfinished setting, not free delivery.
  assert.equal(
      freightDeliveryPolicy({
        freightDestinationDeliveryAvailable: true,
      }).offered,
      false,
  );
  assert.deepEqual(
      freightDeliveryPolicy({
        freightDestinationDeliveryAvailable: true,
        freightDestinationDeliveryFee: 15,
      }),
      {offered: true, fee: 15, feeCents: 1500},
  );
});

test("delivery settings are refused, never silently corrected", () => {
  assert.equal(
      validateFreightDeliverySettings({available: true, fee: 0}).error,
      "fee_required",
  );
  assert.equal(
      validateFreightDeliverySettings({available: true, fee: -5}).error,
      "fee_required",
  );
  assert.equal(
      validateFreightDeliverySettings({
        available: true,
        fee: MAX_DESTINATION_DELIVERY_FEE + 1,
      }).error,
      "fee_out_of_range",
  );
  // Turning it off clears the fee rather than leaving a stale number that
  // would come back the moment the toggle is flipped again.
  assert.deepEqual(
      validateFreightDeliverySettings({available: false, fee: 20}).settings,
      {
        freightDestinationDeliveryAvailable: false,
        freightDestinationDeliveryFee: 0,
      },
  );
  assert.deepEqual(
      validateFreightDeliverySettings({available: true, fee: 12.345}).settings,
      {
        freightDestinationDeliveryAvailable: true,
        freightDestinationDeliveryFee: 12.35,
      },
  );
  // An absent key means "not editing this", not "turn it off".
  assert.deepEqual(
      validateFreightDeliverySettings(undefined),
      {ok: true, changed: false},
  );
});

test("a booking prices delivery from the business, never the client", () => {
  const business = {
    freightDestinationDeliveryAvailable: true,
    freightDestinationDeliveryFee: 15,
  };
  assert.deepEqual(
      quoteFreightDelivery({business, wantsDelivery: false}),
      {ok: true, delivery: false, feeCents: 0, address: ""},
  );
  const quoted = quoteFreightDelivery({
    business,
    wantsDelivery: true,
    receiverAddress: "  Quartier Almamya, Conakry  ",
  });
  assert.equal(quoted.ok, true);
  assert.equal(quoted.feeCents, 1500);
  assert.equal(quoted.address, "Quartier Almamya, Conakry");
});

test("delivery a business does not offer fails loudly", () => {
  // Silently downgrading to office collection would only surface as a
  // parcel that never arrived at the address the customer paid for.
  assert.equal(
      quoteFreightDelivery({
        business: {},
        wantsDelivery: true,
        receiverAddress: "Kaloum, Conakry",
      }).error,
      "delivery_not_offered",
  );
  assert.equal(
      quoteFreightDelivery({
        business: {
          freightDestinationDeliveryAvailable: true,
          freightDestinationDeliveryFee: 15,
        },
        wantsDelivery: true,
        receiverAddress: "   ",
      }).error,
      "receiver_address_required",
  );
});
