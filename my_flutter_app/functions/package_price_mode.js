"use strict";

/**
 * How a business prices a package (docs/PACKAGE_ONE_PRICE.md).
 *
 * `piece` (the default): staff type a price on each row of pieces.
 * `package`: staff type ONE price for the whole package, and it is shared
 * equally among the package's pieces (odd cents on the first ones), so every
 * reader of piece prices - a split across containers, the receipt, the
 * business's bill - keeps working on the same numbers.
 *
 * Pure: no Firestore, no clock. The console's `package-price-mode.ts` and the
 * app's `package_price_mode.dart` are mirrors;
 * `test/fixtures/package-price-cases.json` is run by all three suites.
 */

const {distributeCents} = require("./line_pieces");

const PRICE_MODE = Object.freeze({PIECE: "piece", PACKAGE: "package"});
const PRICE_MODES = Object.freeze(Object.values(PRICE_MODE));

/**
 * @param {object} business The businesses record.
 * @return {"piece"|"package"} How it prices a package; `piece` when unset.
 */
function priceModeOf(business) {
  return business?.packagePriceSettings?.mode === PRICE_MODE.PACKAGE ?
    PRICE_MODE.PACKAGE : PRICE_MODE.PIECE;
}

/**
 * @param {*} value A mode a caller asked for.
 * @return {string} The mode, or "" when it is neither piece nor package.
 */
function validPriceMode(value) {
  return typeof value === "string" && PRICE_MODES.includes(value) ?
    value : "";
}

const wholeCents = (value) =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/**
 * Each piece's price when one price was typed for the whole package.
 *
 * The total is shared equally among the pieces, in order. One exception
 * keeps old packages as they were: when the package is saved with the very
 * same pieces (same ids, same order) and the very same total as stored, the
 * stored piece prices stay untouched - opening a package priced item by item
 * and saving it without touching the price or the pieces changes nothing.
 * A piece added, removed or moved, or a different total, shares the total
 * again among all the pieces.
 *
 * @param {number|null} totalCents The price typed for the whole package
 *   (the pickup fee is never part of it); null for none typed.
 * @param {string[]} ids The pieces' ids in order ("" for a new piece).
 * @param {Array<object>|null} [stored] The package's pieces as saved
 *   ({id, priceCents} each), when it is an edit.
 * @return {Array<number|null>} One price per piece.
 */
function packagePiecePrices(totalCents, ids, stored = null) {
  const list = Array.isArray(ids) ? ids.map((id) => String(id ?? "")) : [];
  if (list.length === 0) return [];
  if (!wholeCents(totalCents)) return list.map(() => null);
  const saved = Array.isArray(stored) ? stored : [];
  const same = saved.length === list.length &&
    saved.every((piece, i) => list[i] !== "" &&
      String(piece?.id ?? "") === list[i] && wholeCents(piece?.priceCents));
  if (same && saved.reduce((sum, piece) => sum + piece.priceCents, 0) ===
      totalCents) {
    return saved.map((piece) => piece.priceCents);
  }
  return distributeCents(totalCents, list.length);
}

module.exports = {
  PRICE_MODE,
  PRICE_MODES,
  priceModeOf,
  validPriceMode,
  packagePiecePrices,
};
