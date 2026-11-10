"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");

// Freight folded into Send a package (docs/PACKAGE_PRICE_LIST.md decision 12).
// The website assistant must not tell a visitor about a Freight service that
// no longer exists, nor send them to ?service=freight.
const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
const start = source.indexOf("const ASSISTANT_SYSTEM_PROMPT = `");
const prompt = source.slice(start, source.indexOf("`;", start));

describe("the website assistant's prompt", () => {
  it("is found", () => {
    assert.ok(start > 0 && prompt.length > 500);
  });

  it("no longer lists Freight as a service or links to it", () => {
    assert.doesNotMatch(prompt, /freight/i);
  });

  it("describes Send a package: kinds, sea or air, pricing, payment", () => {
    assert.match(prompt, /Send a package/);
    for (const thing of ["barrels", "boxes", "suitcases", "parcels"]) {
      assert.match(prompt, new RegExp(thing));
    }
    assert.match(prompt, /sea/);
    assert.match(prompt, /air/);
    assert.match(prompt, /per item/);
    assert.match(prompt, /Small, Medium, Large/);
    assert.match(prompt, /XL is quoted/);
    // A business prices by weight in its own unit
    // (docs/SHIPPING_SIMPLE_HOME.md K1).
    assert.match(prompt, /per pound or per kilo/);
    assert.match(prompt, /total right away/);
    assert.match(prompt, /drop-off time/);
    assert.match(prompt, /pickup/);
    assert.match(
        prompt,
        /at the counter, or by card if the business offers it/,
    );
  });

  it("links the service pages that exist", () => {
    assert.match(prompt, /\?service=barrel\|cars\|car-transport\|parking/);
  });

  it("keeps the rules (Laawol only, reply language, short)", () => {
    assert.match(prompt, /Answer ONLY about Laawol/);
    assert.match(prompt, /Maximum ~110 words/);
  });
});
