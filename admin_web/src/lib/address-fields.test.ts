import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  EMPTY_STRUCTURED_ADDRESS,
  cleanAddressPart,
  composeAddressLine,
  structuredAddressFromLine,
  structuredAddressFromSuggestion,
  structuredAddressIsComplete,
} from "./address-fields.ts";

const BROOKLYN_SUGGESTION = {
  description: "123 Court St, Brooklyn, NY 11201, USA",
  formattedAddress: "123 Court St, Brooklyn, NY 11201, USA",
  streetLine: "123 Court Street",
  apartment: "",
  city: "Brooklyn",
  state: "New York",
  stateCode: "NY",
  postalCode: "11201",
  country: "United States",
  borough: "Brooklyn",
};

test("cleans padded and missing address parts", () => {
  assert.equal(cleanAddressPart(undefined), "");
  assert.equal(cleanAddressPart(null), "");
  assert.equal(cleanAddressPart("   "), "");
  assert.equal(cleanAddressPart("  Apt   4B \n"), "Apt 4B");
  assert.equal(cleanAddressPart(11201), "11201");
});

test("composes named parts into one courier-readable line", () => {
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

test("keeps the apartment even when every other part is blank", () => {
  // The apartment must never be the thing that gets dropped.
  assert.equal(
    composeAddressLine({ streetLine: "123 Court Street", apartment: "4B" }),
    "123 Court Street, 4B",
  );
});

test("skips missing parts instead of leaving empty separators", () => {
  assert.equal(
    composeAddressLine({ streetLine: "123 Court Street", city: "Brooklyn" }),
    "123 Court Street, Brooklyn",
  );
  assert.equal(composeAddressLine({ state: "NY", postalCode: "11201" }), "NY 11201");
  assert.equal(composeAddressLine({}), "");
  assert.equal(composeAddressLine(null), "");
  assert.equal(composeAddressLine(undefined), "");
});

test("passes free-typed text through untouched", () => {
  // The customer is never forced to accept a suggestion.
  assert.equal(
    composeAddressLine({ streetLine: "Behind the blue gate, Conakry" }),
    "Behind the blue gate, Conakry",
  );
});

test("composition converges when its own output is fed back in", () => {
  // PickupFields recomposes on every keystroke; composing must reach a
  // fixpoint rather than growing.
  const once = composeAddressLine(
    structuredAddressFromSuggestion(BROOKLYN_SUGGESTION),
  );
  assert.equal(once, "123 Court Street, Brooklyn, NY 11201, United States");
  assert.equal(composeAddressLine({ streetLine: once }), once);
  assert.equal(
    composeAddressLine({ streetLine: composeAddressLine({ streetLine: once }) }),
    once,
  );
});

test("populates every separate field from a suggestion", () => {
  assert.deepEqual(structuredAddressFromSuggestion(BROOKLYN_SUGGESTION), {
    streetLine: "123 Court Street",
    apartment: "",
    city: "Brooklyn",
    state: "NY",
    postalCode: "11201",
    country: "United States",
  });
});

test("a suggestion never erases an apartment the customer already typed", () => {
  // Google's subpremise is almost always empty, so letting it win would wipe
  // the unit number the customer entered - the reported bug.
  const populated = structuredAddressFromSuggestion(BROOKLYN_SUGGESTION, {
    apartment: "Apt 4B",
  });
  assert.equal(populated.apartment, "Apt 4B");
  assert.equal(
    composeAddressLine(populated),
    "123 Court Street, Apt 4B, Brooklyn, NY 11201, United States",
  );
});

test("uses Google's subpremise when there is no typed apartment", () => {
  assert.equal(
    structuredAddressFromSuggestion(
      { ...BROOKLYN_SUGGESTION, apartment: "4B" },
      { apartment: "" },
    ).apartment,
    "4B",
  );
});

test("falls back to the whole line when the server sends no components", () => {
  // A client on a newer build must still work against an older callable.
  assert.deepEqual(
    structuredAddressFromSuggestion({
      description: "123 Court St, Brooklyn, NY 11201, USA",
      placeId: "abc",
    } as never),
    {
      ...EMPTY_STRUCTURED_ADDRESS,
      streetLine: "123 Court St, Brooklyn, NY 11201, USA",
    },
  );
  assert.deepEqual(
    structuredAddressFromSuggestion(null),
    EMPTY_STRUCTURED_ADDRESS,
  );
});

test("falls back to the borough when Google names no city", () => {
  assert.equal(
    structuredAddressFromSuggestion({
      streetLine: "1 Main St",
      borough: "Queens",
    }).city,
    "Queens",
  );
});

test("free typing keeps the other fields the customer already filled", () => {
  assert.deepEqual(
    structuredAddressFromLine("456 Grand ", {
      apartment: "2R",
      city: "Brooklyn",
      state: "NY",
      postalCode: "11211",
      country: "United States",
    }),
    {
      streetLine: "456 Grand ",
      apartment: "2R",
      city: "Brooklyn",
      state: "NY",
      postalCode: "11211",
      country: "United States",
    },
  );
});

test("an address is complete without an apartment, never without a street", () => {
  assert.equal(
    structuredAddressIsComplete({ streetLine: "1 Main St", city: "Brooklyn" }),
    true,
  );
  assert.equal(
    structuredAddressIsComplete({ streetLine: "1 Main St", postalCode: "11201" }),
    true,
  );
  assert.equal(
    structuredAddressIsComplete({ streetLine: "1 Main St", state: "NY" }),
    true,
  );
  assert.equal(structuredAddressIsComplete({ streetLine: "1 Main St" }), false);
  assert.equal(
    structuredAddressIsComplete({ apartment: "4B", city: "Brooklyn" }),
    false,
  );
  assert.equal(structuredAddressIsComplete(undefined), false);
});

test("the checkout form offers a separate, optional apartment field", () => {
  const source = readFileSync(
    new URL("../components/customer-shipping-services.tsx", import.meta.url),
    "utf8",
  );
  const fields = readFileSync(
    new URL("../components/address-autocomplete.tsx", import.meta.url),
    "utf8",
  );
  // The suggestion must feed named inputs, not one opaque string.
  assert.match(fields, /export function StructuredAddressFields/);
  assert.match(fields, /Apartment, suite, or unit \(optional\)/);
  assert.match(fields, /id=\{`\$\{idPrefix\}-apartment`\}/);
  assert.match(fields, /id=\{`\$\{idPrefix\}-city`\}/);
  assert.match(fields, /id=\{`\$\{idPrefix\}-state`\}/);
  assert.match(fields, /id=\{`\$\{idPrefix\}-postal-code`\}/);
  assert.match(fields, /id=\{`\$\{idPrefix\}-country`\}/);
  // The apartment input is never marked required.
  assert.doesNotMatch(
    fields.slice(fields.indexOf("-apartment`}"), fields.indexOf("-city`}")),
    /required/,
  );
  assert.match(source, /<StructuredAddressFields/);
  assert.match(source, /composeAddressLine/);
});

test("every new address label is translated for French users", () => {
  const dictionary = readFileSync(
    new URL("./french-dom.ts", import.meta.url),
    "utf8",
  );
  [
    "Street address",
    "Apartment, suite, or unit (optional)",
    "City",
    "State or region",
    "ZIP or postal code",
    "Country",
    "Apartment numbers are rarely in the suggestion — add yours here.",
  ].forEach((label) => {
    assert.ok(
      dictionary.includes(`"${label}":`) ||
        dictionary.includes(`"${label}":\n`) ||
        new RegExp(`(^|[{,\\s])${label}:`, "m").test(dictionary),
      `missing French translation for: ${label}`,
    );
  });
});
