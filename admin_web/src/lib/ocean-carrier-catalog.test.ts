import assert from "node:assert/strict";
import test from "node:test";

import {
  OCEAN_CARRIERS,
  OTHER_CARRIER_VALUE,
  isKnownCarrierScac,
  oceanCarrierOptions,
} from "./ocean-carrier-catalog.ts";
import { filterSearchableOptions } from "./searchable-options.ts";

// A mistyped SCAC does not fail loudly - the carrier lookup simply never
// resolves and tracking silently never starts. That is why the code is picked
// rather than typed, and why the catalog's shape has to hold.
test("every SCAC is a well-formed 4-letter code", () => {
  for (const carrier of OCEAN_CARRIERS) {
    assert.match(
        carrier.scac,
        /^[A-Z]{4}$/,
        `${carrier.name} has a malformed SCAC: ${carrier.scac}`,
    );
    assert.ok(carrier.name.trim().length > 0, `${carrier.scac} has no name`);
  }
});

test("no duplicate codes or names", () => {
  const codes = OCEAN_CARRIERS.map((carrier) => carrier.scac);
  const names = OCEAN_CARRIERS.map((carrier) => carrier.name.toLowerCase());
  assert.equal(new Set(codes).size, codes.length, "duplicate SCAC");
  assert.equal(new Set(names).size, names.length, "duplicate carrier name");
});

test("the carriers that move most container traffic are present", () => {
  // Losing one of these to a refactor would push a large share of real
  // shipments onto the free-text path this control exists to avoid.
  for (const scac of ["MAEU", "MSCU", "CMDU", "COSU", "HLCU", "ONEY", "EGLV"]) {
    assert.ok(isKnownCarrierScac(scac), `${scac} missing from the catalog`);
  }
});

test("options end with an escape for carriers outside the catalog", () => {
  const options = oceanCarrierOptions("Another carrier");
  const last = options[options.length - 1];
  assert.equal(last.value, OTHER_CARRIER_VALUE);
  // NMFTA has issued thousands of SCACs; a rare carrier must stay trackable
  // even though it cannot be typo-proof.
  assert.equal(options.length, OCEAN_CARRIERS.length + 1);
});

test("the sentinel cannot collide with a real code", () => {
  assert.equal(isKnownCarrierScac(OTHER_CARRIER_VALUE), false);
  assert.doesNotMatch(OTHER_CARRIER_VALUE, /^[A-Z]{4}$/);
});

test("a carrier is findable by code, name, and former identity", () => {
  const options = oceanCarrierOptions("Another carrier");
  const findsMaersk = (query: string) =>
    filterSearchableOptions(options, query).some((o) => o.value === "MAEU");

  assert.ok(findsMaersk("MAEU"), "not findable by code");
  assert.ok(findsMaersk("maersk"), "not findable by name");
  // Businesses still say "Sealand" for Maersk lanes.
  assert.ok(findsMaersk("sealand"), "not findable by former identity");
  // ONE is the merger of NYK, MOL and K Line - people search the old names.
  assert.ok(
      filterSearchableOptions(options, "ocean network").some(
          (o) => o.value === "ONEY",
      ),
      "ONE not findable by full name",
  );
});

test("the label shows the code, since that is what gets submitted", () => {
  const maersk = oceanCarrierOptions("Another carrier").find(
      (option) => option.value === "MAEU",
  );
  assert.ok(maersk);
  assert.match(maersk.label, /MAEU/);
  assert.match(maersk.label, /Maersk/);
});

test("isKnownCarrierScac tolerates the casing people actually type", () => {
  assert.ok(isKnownCarrierScac("maeu"));
  assert.ok(isKnownCarrierScac("  MAEU  "));
  assert.equal(isKnownCarrierScac("XXXX"), false);
  assert.equal(isKnownCarrierScac(""), false);
});
