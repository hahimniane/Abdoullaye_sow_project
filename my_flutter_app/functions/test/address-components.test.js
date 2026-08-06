"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  addressComponentsFromPlace,
  addressLineIsComplete,
  cleanPart,
  composeAddressLine,
  findComponent,
} = require("../address_components");

/**
 * Builds a Google address component.
 *
 * @param {string} longName Long form.
 * @param {string} shortName Short form.
 * @param {!Array<string>} types Component types.
 * @return {!Object} Component.
 */
function component(longName, shortName, types) {
  return {long_name: longName, short_name: shortName, types};
}

const BROOKLYN_PLACE = {
  place_id: "place-brooklyn",
  formatted_address: "123 Court St, Brooklyn, NY 11201, USA",
  address_components: [
    component("123", "123", ["street_number"]),
    component("Court Street", "Court St", ["route"]),
    component("Brooklyn", "Brooklyn", ["political", "sublocality_level_1"]),
    component("Kings County", "Kings County", ["administrative_area_level_2"]),
    component("New York", "NY", ["administrative_area_level_1", "political"]),
    component("United States", "US", ["country", "political"]),
    component("11201", "11201", ["postal_code"]),
  ],
};

describe("cleanPart", () => {
  it("returns an empty string for anything absent", () => {
    for (const value of [undefined, null, "", "   ", "\n\t"]) {
      assert.equal(cleanPart(value), "");
    }
  });

  it("trims and collapses whitespace from form input", () => {
    assert.equal(cleanPart("  Apt   4B \n"), "Apt 4B");
  });

  it("stringifies non-string values rather than throwing", () => {
    assert.equal(cleanPart(11201), "11201");
  });
});

describe("findComponent", () => {
  it("honours the type order, not the array order", () => {
    const components = [
      component("Springfield", "Springfield", ["postal_town"]),
      component("Shelbyville", "Shelbyville", ["locality"]),
    ];
    assert.equal(
        findComponent(components, ["locality", "postal_town"]).long_name,
        "Shelbyville",
    );
    assert.equal(
        findComponent(components, ["postal_town", "locality"]).long_name,
        "Springfield",
    );
  });

  it("returns null when nothing matches or the input is not an array", () => {
    assert.equal(findComponent([], ["locality"]), null);
    assert.equal(findComponent(undefined, ["locality"]), null);
    assert.equal(findComponent(null, ["locality"]), null);
    assert.equal(
        findComponent([{long_name: "x", short_name: "x"}], ["locality"]),
        null,
    );
  });
});

describe("addressComponentsFromPlace", () => {
  it("splits a US address into named parts", () => {
    assert.deepEqual(addressComponentsFromPlace(BROOKLYN_PLACE), {
      streetNumber: "123",
      route: "Court Street",
      streetLine: "123 Court Street",
      apartment: "",
      city: "Brooklyn",
      state: "New York",
      stateCode: "NY",
      postalCode: "11201",
      country: "United States",
      countryCode: "US",
    });
  });

  it("leaves the apartment empty when Google omits a subpremise", () => {
    // This is the normal case and the whole reason the customer needs their
    // own optional apartment field.
    assert.equal(addressComponentsFromPlace(BROOKLYN_PLACE).apartment, "");
  });

  it("uses the subpremise as the apartment when Google supplies one", () => {
    const place = {
      address_components: [
        ...BROOKLYN_PLACE.address_components,
        component("4B", "4B", ["subpremise"]),
      ],
    };
    assert.equal(addressComponentsFromPlace(place).apartment, "4B");
  });

  it("prefers locality over the sublocality fallbacks", () => {
    const place = {
      address_components: [
        component("Astoria", "Astoria", ["sublocality_level_1"]),
        component("Queens", "Queens", ["locality"]),
      ],
    };
    assert.equal(addressComponentsFromPlace(place).city, "Queens");
  });

  it("falls back to postal_town for UK-style addresses", () => {
    const place = {
      address_components: [
        component("10", "10", ["street_number"]),
        component("Downing Street", "Downing St", ["route"]),
        component("London", "London", ["postal_town"]),
        component("England", "England", ["administrative_area_level_1"]),
        component("United Kingdom", "GB", ["country"]),
        component("SW1A 2AA", "SW1A 2AA", ["postal_code"]),
      ],
    };
    assert.deepEqual(addressComponentsFromPlace(place), {
      streetNumber: "10",
      route: "Downing Street",
      streetLine: "10 Downing Street",
      apartment: "",
      city: "London",
      state: "England",
      stateCode: "England",
      postalCode: "SW1A 2AA",
      country: "United Kingdom",
      countryCode: "GB",
    });
  });

  it("falls back to the neighborhood when nothing else names it", () => {
    const place = {
      address_components: [
        component("Kalorama", "Kalorama", ["neighborhood"]),
      ],
    };
    assert.equal(addressComponentsFromPlace(place).city, "Kalorama");
  });

  it("prefers the 5-digit short postal code over a ZIP+4 long name", () => {
    const place = {
      address_components: [
        component("11201-1234", "11201", ["postal_code"]),
      ],
    };
    assert.equal(addressComponentsFromPlace(place).postalCode, "11201");
  });

  it("falls back to the long postal code when there is no short form", () => {
    const place = {
      address_components: [
        component("11201", "", ["postal_code"]),
      ],
    };
    assert.equal(addressComponentsFromPlace(place).postalCode, "11201");
  });

  it("returns every field as a string for a place with no components", () => {
    for (const place of [undefined, null, {}, {address_components: null}]) {
      const parsed = addressComponentsFromPlace(place);
      assert.deepEqual(parsed, {
        streetNumber: "",
        route: "",
        streetLine: "",
        apartment: "",
        city: "",
        state: "",
        stateCode: "",
        postalCode: "",
        country: "",
        countryCode: "",
      });
      for (const value of Object.values(parsed)) {
        assert.equal(typeof value, "string");
      }
    }
  });

  it("keeps a route with no street number usable", () => {
    const place = {
      address_components: [component("Court Street", "Court St", ["route"])],
    };
    assert.equal(addressComponentsFromPlace(place).streetLine, "Court Street");
  });
});

describe("composeAddressLine", () => {
  it("round-trips a parsed place into a courier-readable line", () => {
    assert.equal(
        composeAddressLine(addressComponentsFromPlace(BROOKLYN_PLACE)),
        "123 Court Street, Brooklyn, NY 11201, United States",
    );
  });

  it("puts the apartment right after the street line", () => {
    assert.equal(
        composeAddressLine({
          streetLine: "123 Court Street",
          apartment: "Apt 4B",
          city: "Brooklyn",
          state: "NY",
          postalCode: "11201",
          country: "United States",
        }),
        "123 Court Street, Apt 4B, Brooklyn, NY 11201, United States",
    );
  });

  it("keeps the apartment even when every other part is blank", () => {
    // The apartment must never be the thing that gets dropped.
    assert.equal(
        composeAddressLine({streetLine: "123 Court Street", apartment: "4B"}),
        "123 Court Street, 4B",
    );
  });

  it("skips missing parts instead of leaving empty separators", () => {
    assert.equal(
        composeAddressLine({streetLine: "123 Court Street", city: "Brooklyn"}),
        "123 Court Street, Brooklyn",
    );
    assert.equal(
        composeAddressLine({
          streetLine: "123 Court Street",
          postalCode: "11201",
        }),
        "123 Court Street, 11201",
    );
  });

  it("joins state and postal code into one segment", () => {
    assert.equal(
        composeAddressLine({state: "NY", postalCode: "11201"}),
        "NY 11201",
    );
  });

  it("prefers the state abbreviation over the spelled-out state", () => {
    assert.equal(
        composeAddressLine({stateCode: "NJ", state: "New Jersey"}),
        "NJ",
    );
    assert.equal(
        composeAddressLine({streetLine: "1 Main St", state: "New Jersey"}),
        "1 Main St, New Jersey",
    );
  });

  it("returns free-typed street text untouched on its own", () => {
    // A customer who ignores every suggestion must still get their address
    // through unchanged.
    assert.equal(
        composeAddressLine({streetLine: "Behind the blue gate, Conakry"}),
        "Behind the blue gate, Conakry",
    );
  });

  it("returns an empty string for empty or missing parts", () => {
    for (const parts of [undefined, null, {}, {streetLine: "  "}]) {
      assert.equal(composeAddressLine(parts), "");
    }
  });

  it("is stable when its own output is fed back as the street line", () => {
    // Clients recompose on every keystroke; composing must converge.
    const parts = addressComponentsFromPlace(BROOKLYN_PLACE);
    const once = composeAddressLine(parts);
    assert.equal(composeAddressLine({streetLine: once}), once);
    assert.equal(
        composeAddressLine({
          streetLine: composeAddressLine({streetLine: once}),
        }),
        once,
    );
  });

  it("trims padded form values", () => {
    assert.equal(
        composeAddressLine({
          streetLine: "  123 Court Street ",
          apartment: " Apt  4B ",
          city: " Brooklyn ",
        }),
        "123 Court Street, Apt 4B, Brooklyn",
    );
  });
});

describe("addressLineIsComplete", () => {
  it("accepts a street line plus any locating part", () => {
    assert.equal(
        addressLineIsComplete({streetLine: "1 Main St", city: "Brooklyn"}),
        true,
    );
    assert.equal(
        addressLineIsComplete({streetLine: "1 Main St", postalCode: "11201"}),
        true,
    );
    assert.equal(
        addressLineIsComplete({streetLine: "1 Main St", stateCode: "NY"}),
        true,
    );
  });

  it("never requires an apartment", () => {
    const complete = {streetLine: "1 Main St", city: "Brooklyn"};
    assert.equal(addressLineIsComplete(complete), true);
    assert.equal(
        addressLineIsComplete({...complete, apartment: ""}),
        true,
    );
  });

  it("rejects a street line on its own or an apartment on its own", () => {
    assert.equal(addressLineIsComplete({streetLine: "1 Main St"}), false);
    assert.equal(
        addressLineIsComplete({apartment: "4B", city: "Brooklyn"}),
        false,
    );
    assert.equal(addressLineIsComplete(undefined), false);
    assert.equal(addressLineIsComplete({}), false);
  });
});
