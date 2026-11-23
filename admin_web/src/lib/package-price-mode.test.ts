import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PRICE_MODE, packagePiecePrices, packagePriceModeOf, type StoredPiecePrice } from "./package-price-mode.ts";

// The mirror discipline (docs/PACKAGE_ONE_PRICE.md): the server's
// `functions/package_price_mode.js` is the authority; the shared cases run
// here exactly as they run on the server and in the app.
const fixtureUrl = new URL("../../../my_flutter_app/functions/test/fixtures/package-price-cases.json", import.meta.url);
const { cases } = JSON.parse(readFileSync(fixtureUrl, "utf8")) as {
  cases: Array<{ note: string; total: number | null; ids: string[]; stored: StoredPiecePrice[] | null; expected: Array<number | null> }>;
};

test("the shared fixture is the full one", () => {
  assert.ok(cases.length >= 10);
});

for (const c of cases) {
  test(`shared case: ${c.note}`, () => {
    assert.deepEqual(packagePiecePrices(c.total, c.ids, c.stored), c.expected);
  });
}

test("the mode reads packagePriceSettings.mode and defaults to piece", () => {
  assert.equal(packagePriceModeOf(null), PRICE_MODE.PIECE);
  assert.equal(packagePriceModeOf(undefined), PRICE_MODE.PIECE);
  assert.equal(packagePriceModeOf({}), PRICE_MODE.PIECE);
  assert.equal(packagePriceModeOf({ packagePriceSettings: {} }), PRICE_MODE.PIECE);
  assert.equal(packagePriceModeOf({ packagePriceSettings: { mode: "piece" } }), PRICE_MODE.PIECE);
  assert.equal(packagePriceModeOf({ packagePriceSettings: { mode: "bogus" } }), PRICE_MODE.PIECE);
  assert.equal(packagePriceModeOf({ packagePriceSettings: "package" }), PRICE_MODE.PIECE);
  assert.equal(packagePriceModeOf({ packagePriceSettings: { mode: "package" } }), PRICE_MODE.PACKAGE);
});
