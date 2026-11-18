"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");

const {MAIN_WORKS, mainWorkChange} = require("../business_main_work");

describe("a business's main work on a profile save", () => {
  it("keeps the stored choice when the client sends nothing", () => {
    assert.deepEqual(mainWorkChange(undefined), {kind: "keep"});
    assert.deepEqual(mainWorkChange(null), {kind: "keep"});
  });

  it("takes each of the five works", () => {
    assert.deepEqual(MAIN_WORKS,
        ["parking", "shipping", "shop", "carSales", "transport"]);
    for (const work of MAIN_WORKS) {
      assert.deepEqual(mainWorkChange(work), {kind: "set", value: work});
    }
    assert.deepEqual(mainWorkChange("  parking "),
        {kind: "set", value: "parking"});
  });

  it("clears on an empty string", () => {
    assert.deepEqual(mainWorkChange(""), {kind: "clear"});
    assert.deepEqual(mainWorkChange("   "), {kind: "clear"});
  });

  it("refuses anything else rather than storing it", () => {
    for (const bad of ["Parking", "cars", "inventory", 3, true, {}, []]) {
      assert.deepEqual(mainWorkChange(bad), {kind: "invalid"});
    }
  });

  // The helper is worthless if the save never asks it.
  it("is what updateBusinessProfile stores", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "..", "index.js"), "utf8");
    const start = source.indexOf("exports.updateBusinessProfile");
    const fn = source.slice(start, start + 12000);
    assert.match(fn, /businessMainWork\.mainWorkChange\(mainWork\)/);
    assert.match(fn, /mainWork: mainWorkChange\.value/);
    assert.match(fn, /mainWork: FirestoreFieldValue\.delete\(\)/);
  });
});
