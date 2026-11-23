"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");
const {
  PRICE_MODE,
  PRICE_MODES,
  packagePiecePrices,
  priceModeOf,
  validPriceMode,
} = require("../package_price_mode");
const {distributeCents, piecePriceRequiredErrors} =
  require("../line_pieces");
const {cases} = require("./fixtures/package-price-cases.json");

// docs/PACKAGE_ONE_PRICE.md (owner, 2026-11-23): a business can price a
// package with one price for everything in it.
describe("how a business prices a package", () => {
  it("is a price per item unless the business chose one price", () => {
    assert.deepEqual(PRICE_MODES, ["piece", "package"]);
    assert.equal(priceModeOf({}), "piece");
    assert.equal(priceModeOf(null), "piece");
    assert.equal(priceModeOf(undefined), "piece");
    assert.equal(priceModeOf({packagePriceSettings: {}}), "piece");
    assert.equal(priceModeOf({packagePriceSettings: {mode: "package"}}),
        "package");
    assert.equal(priceModeOf({packagePriceSettings: {mode: "piece"}}),
        "piece");
    assert.equal(priceModeOf({packagePriceSettings: {mode: "PACKAGE"}}),
        "piece");
    assert.equal(priceModeOf({packagePriceSettings: {mode: "bogus"}}),
        "piece");
  });

  it("takes only the two modes from a caller", () => {
    assert.equal(validPriceMode("piece"), PRICE_MODE.PIECE);
    assert.equal(validPriceMode("package"), PRICE_MODE.PACKAGE);
    for (const bad of ["", "Package", "all", null, undefined, 1, {}, []]) {
      assert.equal(validPriceMode(bad), "", String(bad));
    }
  });
});

describe("one price shared among the pieces", () => {
  it("gives exactly the shared cases", () => {
    assert.ok(cases.length >= 12);
    for (const c of cases) {
      assert.deepEqual(packagePiecePrices(c.total, c.ids, c.stored),
          c.expected, c.note);
    }
  });

  it("always adds up to the price typed, whatever the count", () => {
    for (const total of [0, 1, 2, 99, 100, 4550, 30000, 123457]) {
      for (let n = 1; n <= 12; n += 1) {
        const ids = Array.from({length: n}, () => "");
        const prices = packagePiecePrices(total, ids, null);
        assert.equal(prices.length, n);
        assert.equal(prices.reduce((sum, cents) => sum + cents, 0), total);
        assert.deepEqual(prices, distributeCents(total, n));
        // Equal shares: no piece more than a cent above another.
        assert.ok(Math.max(...prices) - Math.min(...prices) <= 1);
      }
    }
  });

  it("is what the server's own package rule accepts", () => {
    const pieces = (total, n) => packagePiecePrices(total,
        Array.from({length: n}, () => ""), null)
        .map((priceCents) => ({kind: "box", description: "x", priceCents}));
    // Every piece has a price (zero is one) and they come to more than $0.
    assert.deepEqual(piecePriceRequiredErrors(pieces(30000, 3)), []);
    assert.deepEqual(piecePriceRequiredErrors(pieces(2, 3)), []);
    // $0 for everything, or nothing typed: refused as today.
    assert.deepEqual(piecePriceRequiredErrors(pieces(0, 3)),
        ["package_price_required"]);
    assert.deepEqual(piecePriceRequiredErrors(pieces(null, 3)),
        ["piece_price_required"]);
  });

  it("leaves an old package alone only when nothing about it changed", () => {
    const stored = [{id: "p1", priceCents: 12000},
      {id: "p2", priceCents: 12000}, {id: "p3", priceCents: 6000}];
    const ids = ["p1", "p2", "p3"];
    assert.deepEqual(packagePiecePrices(30000, ids, stored),
        [12000, 12000, 6000]);
    // A cent of difference is a new price.
    assert.deepEqual(packagePiecePrices(30001, ids, stored),
        [10001, 10000, 10000]);
    // The stored list is never changed by the call.
    assert.deepEqual(stored.map((piece) => piece.priceCents),
        [12000, 12000, 6000]);
    // Junk in place of the stored pieces is "no stored pieces".
    for (const junk of [undefined, {}, "p1", [null, null, null]]) {
      assert.deepEqual(packagePiecePrices(30000, ids, junk),
          [10000, 10000, 10000]);
    }
  });
});
