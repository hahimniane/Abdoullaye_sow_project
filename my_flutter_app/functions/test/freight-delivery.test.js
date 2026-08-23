const assert = require("node:assert/strict");
const test = require("node:test");

const {
  freightDeliveryAreas,
  freightDeliveryPolicy,
  quoteFreightDelivery,
  validateFreightDeliverySettings,
  MAX_DESTINATION_DELIVERY_FEE,
} = require("../freight_delivery");

test("delivery is set per destination, not per business", () => {
  // Crossing Dakar and crossing Conakry are different jobs at different
  // costs, and a business may do one and not the other.
  const business = {
    freightDestinationDeliveryAvailable: true,
    freightDestinationDeliveryFee: 15,
  };
  const senegal = {
    freightDestinationDeliveryAvailable: true,
    freightDestinationDeliveryFee: 20,
  };
  const guinea = {freightDestinationDeliveryAvailable: false};
  assert.equal(freightDeliveryPolicy(senegal, business).fee, 20);
  // The destination's own answer wins, including a refusal.
  assert.equal(freightDeliveryPolicy(guinea, business).offered, false);
});

test("a destination that says nothing keeps the business's setting", () => {
  // A business that priced this before it moved onto the route keeps
  // offering delivery until it edits that route.
  const business = {
    freightDestinationDeliveryAvailable: true,
    freightDestinationDeliveryFee: 15,
  };
  assert.equal(freightDeliveryPolicy({}, business).fee, 15);
  assert.equal(freightDeliveryPolicy(undefined, business).offered, true);
  assert.equal(freightDeliveryPolicy({}, {}).offered, false);
});

test("a booking prices delivery from the destination it is going to", () => {
  const quoted = quoteFreightDelivery({
    business: {},
    country: {
      freightDestinationDeliveryAvailable: true,
      freightDestinationDeliveryFee: 20,
    },
    wantsDelivery: true,
    receiverAddress: "Quartier Almamya, Conakry",
  });
  assert.equal(quoted.ok, true);
  assert.equal(quoted.feeCents, 2000);
});

test("a business offers delivery only once it has priced it", () => {
  assert.deepEqual(freightDeliveryPolicy({}), {
    offered: false, areas: [], fee: 0, feeCents: 0,
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
      {offered: true, areas: [], fee: 15, feeCents: 1500},
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
        freightDestinationDeliveryAreas: [],
      },
  );
  assert.deepEqual(
      validateFreightDeliverySettings({available: true, fee: 12.345}).settings,
      {
        freightDestinationDeliveryAvailable: true,
        freightDestinationDeliveryFee: 12.35,
        freightDestinationDeliveryAreas: [],
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
      {
        ok: true, delivery: false, feeCents: 0, address: "",
        areaId: "", areaName: "",
      },
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


test("a business prices the places it delivers to, one by one", () => {
  // How this trade actually quotes it: Cosa is $20, Koloma is $10. One fee
  // for a whole country either overcharges the quartier next to the office
  // or loses money on the one an hour away.
  const conakry = {
    freightDestinationDeliveryAvailable: true,
    freightDestinationDeliveryAreas: [
      {id: "cosa", name: "Cosa", fee: 20},
      {id: "koloma", name: "Koloma", fee: 10},
    ],
  };
  const policy = freightDeliveryPolicy(conakry);
  assert.equal(policy.offered, true);
  assert.deepEqual(policy.areas.map((a) => [a.name, a.feeCents]), [
    ["Cosa", 2000], ["Koloma", 1000],
  ]);

  const cosa = quoteFreightDelivery({
    country: conakry, wantsDelivery: true,
    receiverAddress: "Rue KA-020", deliveryAreaId: "cosa",
  });
  assert.equal(cosa.feeCents, 2000);
  assert.equal(cosa.areaName, "Cosa");

  const koloma = quoteFreightDelivery({
    country: conakry, wantsDelivery: true,
    receiverAddress: "Rue KA-020", deliveryAreaId: "koloma",
  });
  assert.equal(koloma.feeCents, 1000);
});

test("refuses a delivery with nowhere named to take it", () => {
  // Guessing a fee for an unlisted quartier is how a business ends up
  // driving somewhere it never priced.
  const conakry = {
    freightDestinationDeliveryAvailable: true,
    freightDestinationDeliveryAreas: [{id: "cosa", name: "Cosa", fee: 20}],
  };
  for (const areaId of ["", "ratoma", undefined]) {
    assert.equal(quoteFreightDelivery({
      country: conakry, wantsDelivery: true,
      receiverAddress: "Rue KA-020", deliveryAreaId: areaId,
    }).error, "delivery_area_required");
  }
});

test("one price for the whole country is still an answer", () => {
  const dakar = {
    freightDestinationDeliveryAvailable: true,
    freightDestinationDeliveryFee: 15,
  };
  const policy = freightDeliveryPolicy(dakar);
  assert.deepEqual(policy.areas, []);
  const quoted = quoteFreightDelivery({
    country: dakar, wantsDelivery: true, receiverAddress: "Medina",
  });
  assert.equal(quoted.feeCents, 1500);
});

test("saving a price list cleans and refuses it like any other", () => {
  const ok = validateFreightDeliverySettings({
    available: true,
    areas: [
      {name: "  Cosa  ", fee: 20.005},
      {name: "Koloma", fee: 10},
    ],
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.settings.freightDestinationDeliveryAreas, [
    {id: "cosa", name: "Cosa", fee: 20.01},
    {id: "koloma", name: "Koloma", fee: 10},
  ]);

  assert.equal(validateFreightDeliverySettings({
    available: true, areas: [{name: "", fee: 10}],
  }).error, "area_name_required");
  assert.equal(validateFreightDeliverySettings({
    available: true,
    areas: [{name: "Cosa", fee: 10}, {name: "cosa", fee: 20}],
  }).error, "area_duplicated");
  assert.equal(validateFreightDeliverySettings({
    available: true, areas: [{name: "Cosa", fee: 0}],
  }).error, "fee_out_of_range");
  // Turned on with nowhere to deliver is an unfinished setting.
  assert.equal(validateFreightDeliverySettings({
    available: true, areas: [],
  }).error, "fee_required");
  // Turning it off clears the list rather than leaving it to come back.
  assert.deepEqual(
      validateFreightDeliverySettings({available: false})
          .settings.freightDestinationDeliveryAreas,
      [],
  );
});

test("ignores a stored area nobody could be charged for", () => {
  const areas = freightDeliveryAreas({
    freightDestinationDeliveryAreas: [
      {id: "cosa", name: "Cosa", fee: 20},
      {id: "blank", name: "", fee: 10},
      {id: "free", name: "Free", fee: 0},
      {id: "cosa", name: "Cosa again", fee: 30},
    ],
  });
  assert.deepEqual(areas.map((a) => a.id), ["cosa"]);
});
