"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  PICKUP_FIELDS,
  PICKUP_LIMITS,
  PICKUP_MESSAGES,
  e164Phone,
  validateDestinationPickup,
  pickupPlace,
  pickupDetails,
} = require("../destination_pickup");

describe("the pickup details an owner types", () => {
  it("are the city, the address and the phone", () => {
    assert.deepEqual([...PICKUP_FIELDS],
        ["pickupCity", "pickupAddress", "pickupPhone"]);
  });

  it("are all optional; blanks clear the stored value", () => {
    assert.deepEqual(validateDestinationPickup({}), {
      value: {pickupCity: "", pickupAddress: "", pickupPhone: ""},
      errors: [],
    });
    assert.deepEqual(validateDestinationPickup(null).errors, []);
  });

  it("keep each one on one line, without formatting in the phone", () => {
    const {value, errors} = validateDestinationPickup({
      pickupCity: "  Conakry ",
      pickupAddress: "Madina\n  near the market",
      pickupPhone: "+224 620-00 00 00",
    });
    assert.deepEqual(errors, []);
    assert.deepEqual(value, {
      pickupCity: "Conakry",
      pickupAddress: "Madina near the market",
      pickupPhone: "+224620000000",
    });
  });

  // WhatsApp can only reach, and the shared phone pickers only store, a
  // number with its country code.
  it("refuse a phone without its country code", () => {
    for (const phone of ["620000000", "00224620000000", "+0224620000",
      "+224 abc", "+1234"]) {
      assert.deepEqual(validateDestinationPickup({pickupPhone: phone}).errors,
          ["pickup_phone_invalid"], phone);
    }
    assert.equal(e164Phone("+1 (646) 555-0199"), "+16465550199");
    assert.equal(e164Phone("6465550199"), "");
  });

  it("refuse a city or an address that is too long", () => {
    const {errors} = validateDestinationPickup({
      pickupCity: "x".repeat(PICKUP_LIMITS.pickupCity + 1),
      pickupAddress: "y".repeat(PICKUP_LIMITS.pickupAddress + 1),
    });
    assert.deepEqual(errors,
        ["pickup_city_too_long", "pickup_address_too_long"]);
    assert.deepEqual(validateDestinationPickup({
      pickupCity: "x".repeat(PICKUP_LIMITS.pickupCity),
      pickupAddress: "y".repeat(PICKUP_LIMITS.pickupAddress),
    }).errors, []);
  });

  it("refuse anything that is not text", () => {
    assert.deepEqual(validateDestinationPickup({pickupCity: 12}).errors,
        ["pickup_field_invalid"]);
    assert.deepEqual(validateDestinationPickup({pickupPhone: {}}).errors,
        ["pickup_field_invalid"]);
  });

  it("have a message for every refusal", () => {
    for (const code of ["pickup_city_too_long", "pickup_address_too_long",
      "pickup_phone_invalid", "pickup_field_invalid"]) {
      assert.ok(PICKUP_MESSAGES[code], code);
    }
  });
});

describe("the pickup place in the message", () => {
  it("is the city then the country, or whichever is known", () => {
    assert.equal(pickupPlace("Conakry", "Guinea"), "Conakry, Guinea");
    assert.equal(pickupPlace("Conakry", "Guinée"), "Conakry, Guinée");
    assert.equal(pickupPlace("", "Guinea"), "Guinea");
    assert.equal(pickupPlace("Conakry", ""), "Conakry");
    assert.equal(pickupPlace("", ""), "");
    // A city named like its country is said once.
    assert.equal(pickupPlace("Djibouti", "Djibouti"), "Djibouti");
  });
});

describe("the pickup address and phone in the message", () => {
  const business = {
    addressLine1: "12 Main St", city: "Bronx", state: "NY",
    postalCode: "10451", country: "United States", phone: "+16465550199",
  };

  it("are the destination's own when the owner set them", () => {
    assert.deepEqual(pickupDetails({pickupCity: "Conakry",
      pickupAddress: "Madina, near the market",
      pickupPhone: "+224620000000"}, business), {
      city: "Conakry",
      address: "Madina, near the market",
      phone: "+224620000000",
    });
  });

  it("fall back to the business's address and phone", () => {
    assert.deepEqual(pickupDetails({}, business), {
      city: "",
      address: "12 Main St, Bronx, NY, 10451, United States",
      phone: "+16465550199",
    });
    assert.deepEqual(pickupDetails(null, {address: "Kaloum, Conakry"}), {
      city: "", address: "Kaloum, Conakry", phone: "",
    });
    assert.deepEqual(pickupDetails(null, null),
        {city: "", address: "", phone: ""});
  });

  // A value that reached the record without the callable is checked again.
  it("never send a stored phone that is not international", () => {
    assert.equal(pickupDetails({pickupPhone: "620000000"}, business).phone,
        "+16465550199");
    assert.equal(pickupDetails({pickupAddress: "\n\t"}, business).address,
        "12 Main St, Bronx, NY, 10451, United States");
  });
});
