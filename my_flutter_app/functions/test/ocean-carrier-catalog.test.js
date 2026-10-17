"use strict";

const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  OCEAN_CARRIERS,
  oceanCarrierName,
} = require("../ocean_carrier_catalog");

test("the functions' carrier list is the console's, pair for pair", () => {
  const source = readFileSync(path.join(__dirname, "..", "..", "..",
      "admin_web", "src", "lib", "ocean-carrier-catalog.ts"), "utf8");
  const console = [...source.matchAll(
      /\{scac: "([A-Z0-9]+)", name: "([^"]+)"/g)]
      .map((m) => ({scac: m[1], name: m[2]}));
  assert.ok(console.length > 20);
  assert.deepEqual(OCEAN_CARRIERS.map((c) => ({...c})), console);
});

test("names a carrier by its SCAC, the code itself when unknown", () => {
  assert.equal(oceanCarrierName("MAEU"), "Maersk");
  assert.equal(oceanCarrierName(" mscu "), "MSC");
  assert.equal(oceanCarrierName("XYZQ"), "XYZQ");
  assert.equal(oceanCarrierName(""), "");
  assert.equal(oceanCarrierName(null), "");
});
