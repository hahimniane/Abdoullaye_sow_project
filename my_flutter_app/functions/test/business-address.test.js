const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  composeHeadquartersAddress,
  defaultOfficeLocationFromBusiness,
  headquartersAddressError,
  isCompleteHeadquartersAddress,
} = require("../business_address");

describe("headquarters address", () => {
  it("composes a full HQ line with country and requires a street", () => {
    assert.equal(
        composeHeadquartersAddress({
          addressLine1: "12 Kaloum Street",
          city: "Conakry",
          country: "Guinea",
        }),
        "12 Kaloum Street, Conakry, Guinea",
    );
    assert.equal(
        composeHeadquartersAddress({
          addressLine1: "100 Test Avenue",
          city: "Bronx",
          state: "NY",
          postalCode: "10451",
          country: "United States",
        }),
        "100 Test Avenue, Bronx, NY, 10451, United States",
    );
  });

  it("does not emit a city-only address when the street is missing", () => {
    assert.equal(
        composeHeadquartersAddress({
          addressLine1: "",
          city: "Conakry",
          country: "Guinea",
          state: "Guinea",
        }),
        "",
    );
    assert.equal(
        defaultOfficeLocationFromBusiness({
          name: "Conakry Express",
          city: "Conakry",
          country: "Guinea",
        }),
        null,
    );
  });

  it("rejects an empty street and a missing US state", () => {
    assert.match(
        headquartersAddressError({
          addressLine1: "",
          city: "Conakry",
          country: "Guinea",
        }),
        /street address/i,
    );
    assert.match(
        headquartersAddressError({
          addressLine1: "100 Test Avenue",
          city: "Bronx",
          country: "United States",
        }),
        /US state/i,
    );
    assert.equal(
        isCompleteHeadquartersAddress({
          addressLine1: "12 Kaloum Street",
          city: "Conakry",
          country: "Guinea",
        }),
        true,
    );
  });

  it("synthesizes a default office only when HQ has a street", () => {
    const office = defaultOfficeLocationFromBusiness({
      name: "Conakry Express",
      addressLine1: "12 Kaloum Street",
      city: "Conakry",
      country: "Guinea",
    });
    assert.deepEqual(office, {
      id: "default",
      label: "Conakry Express",
      address: "12 Kaloum Street, Conakry, Guinea",
      isActive: true,
    });
  });
});
