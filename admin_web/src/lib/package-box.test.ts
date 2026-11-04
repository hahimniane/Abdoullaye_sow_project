import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import { BOX_PHOTO_LIMIT, BOX_PRICED_IDS, BOX_SIZE_IDS, boxBadge, boxLineProblems, boxLineSize, boxLineText, boxPicture, boxPieceFor, boxPricesOf, boxSizeExample, boxSizeLabel, boxSizeLimit, boxSizeName, lowestBoxPrices, typicalDims, newBoxLine, pickBoxSize, requestBoxOf, requestBoxText, setBoxDims, setBoxQuantity, shortMoney, sizeForDims } from "./package-box.ts";
import { pricePiece } from "./package-price-list.ts";

test("four sizes, three priced, in order", () => {
  assert.deepEqual([...BOX_SIZE_IDS], ["small", "medium", "large", "xl"]);
  assert.deepEqual([...BOX_PRICED_IDS], ["small", "medium", "large"]);
});

test("names, examples and limits in both languages", () => {
  assert.equal(boxSizeName("medium", "en"), "Medium");
  assert.equal(boxSizeName("medium", "fr"), "Moyenne");
  assert.equal(boxSizeName("xl", "fr"), "Très grande");
  assert.equal(boxSizeExample("large", "en"), "About a TV box");
  assert.equal(boxSizeExample("small", "fr"), "Environ une boîte à chaussures");
  assert.equal(boxSizeLimit("medium", "en"), "Up to 24 × 18 × 18 in");
  assert.equal(boxSizeLimit("medium", "fr"), "Jusqu’à 24 × 18 × 18 po");
  assert.equal(boxSizeLimit("xl", "en"), "Bigger than Large");
  assert.equal(boxSizeLabel("large", "en"), "Large box");
  assert.equal(boxSizeLabel("large", "fr"), "Grande boîte");
  assert.equal(boxSizeName("nope", "en"), "");
});

test("every size has its picture in public/box-sizes", () => {
  for (const id of BOX_SIZE_IDS) {
    assert.equal(boxPicture(id), `/box-sizes/${id}.svg`);
    assert.ok(existsSync(new URL(`../../public/box-sizes/${id}.svg`, import.meta.url)), `${id}.svg`);
  }
  assert.equal(boxPicture("nope"), "/box-sizes/medium.svg");
});

test("inches pick the smallest size they fit, turned any way, with an inch of slack", () => {
  assert.equal(sizeForDims({ l: 18, w: 18, h: 18 }), "small");
  assert.equal(sizeForDims({ l: 19, w: 19, h: 19 }), "small", "an inch of slack");
  assert.equal(sizeForDims({ l: 14, w: 25, h: 18 }), "medium", "turned any way");
  assert.equal(sizeForDims({ l: 30, w: 24, h: 24 }), "large");
  assert.equal(sizeForDims({ l: 40, w: 10, h: 10 }), "xl");
  assert.equal(sizeForDims(null), null);
});

test("dollars in the badge: whole dollars drop the cents", () => {
  assert.equal(shortMoney(3500, "en"), "$35");
  assert.equal(shortMoney(3550, "en"), "$35.50");
  assert.match(shortMoney(3500, "fr"), /^35\s?\$$/);
  assert.match(shortMoney(3550, "fr"), /^35,50\s?\$$/);
});

test("the badge: a price at one business, from $X while comparing, quote for Extra large", () => {
  const prices = { small: 2000, medium: 3500, large: 5000 };
  assert.equal(boxBadge({ size: "medium", prices, lang: "en" })?.text, "Medium · $35");
  assert.equal(boxBadge({ size: "medium", prices, lang: "fr" })?.text.startsWith("Moyenne · 35"), true);
  assert.equal(boxBadge({ size: "medium", prices, comparing: true, lang: "en" })?.text, "Medium · from $35");
  assert.equal(boxBadge({ size: "medium", prices, comparing: true, lang: "fr" })?.text.startsWith("Moyenne · dès 35"), true);
  assert.equal(boxBadge({ size: "xl", prices, lang: "en" })?.text, "Extra large · the business will quote");
  assert.equal(boxBadge({ size: "xl", prices, lang: "en" })?.kind, "quote");
  assert.equal(boxBadge({ size: "xl", prices, lang: "fr" })?.text, "Très grande · l’entreprise vous fera un prix");
  assert.equal(boxBadge({ size: "large", prices: { small: 2000 }, lang: "en" })?.text, "Large · the business will quote", "a size this business did not price");
  assert.equal(boxBadge({ size: "small", lang: "en" })?.text, "Small", "no business chosen: just the size");
  assert.equal(boxBadge({ size: null, prices, lang: "en" }), null);
});

test("a route's box prices: positive whole cents for priced sizes only", () => {
  assert.deepEqual(boxPricesOf({ boxPricesCents: { small: 2000, medium: 0, large: 1.5, xl: 9900, nope: 5 } }), { small: 2000 });
  assert.deepEqual(boxPricesOf(null), {});
  assert.deepEqual(boxPricesOf({}), {});
});

test("comparing: the lowest price per size across businesses", () => {
  const lowest = lowestBoxPrices([{ boxPricesCents: { small: 2500, medium: 4000 } }, { boxPricesCents: { small: 2000 } }, null, {}]);
  assert.deepEqual(lowest, { small: 2000, medium: 4000 });
});

test("a box line: the card picked, then inches that win, then the card again", () => {
  let line = newBoxLine("k1");
  assert.equal(boxLineSize(line), "medium");
  line = pickBoxSize(line, "large");
  assert.equal(boxLineSize(line), "large");
  line = setBoxDims(line, { l: 10, w: 10, h: 10 });
  assert.equal(boxLineSize(line), "small", "the size follows the inches");
  assert.equal(line.boxSize, "small");
  line = setBoxDims(line, { l: 60, w: 30, h: 30 });
  assert.equal(boxLineSize(line), "xl");
  line = pickBoxSize(line, "medium");
  assert.equal(line.dims, null, "picking a card forgets the inches");
  assert.equal(boxLineSize(line), "medium");
  line = setBoxDims(line, null);
  assert.equal(line.dims, null);
  assert.equal(setBoxQuantity(line, 0).quantity, 1);
  assert.equal(setBoxQuantity(line, 500).quantity, 50);
  assert.equal(setBoxQuantity(line, 3.9).quantity, 3);
});

test("a box line's problems use the server's codes", () => {
  const line = newBoxLine("k");
  assert.deepEqual(boxLineProblems(line), []);
  assert.deepEqual(boxLineProblems({ ...line, quantity: 0 }), ["quantity_invalid"]);
  assert.deepEqual(boxLineProblems({ ...line, quantity: 51 }), ["quantity_invalid"]);
  const photo = (n: number, status: "ready" | "error" = "ready") => ({ key: `p${n}`, path: `x/${n}`, previewUrl: "", status });
  assert.equal(BOX_PHOTO_LIMIT, 3);
  assert.deepEqual(boxLineProblems({ ...line, photos: [photo(1), photo(2), photo(3), photo(4)] }), ["too_many_photos"]);
  assert.deepEqual(boxLineProblems({ ...line, photos: [photo(1, "error")] }), ["photo_invalid"]);
});

test("the piece sent: {kind: box, boxSize, dimsIn?, quantity, photoPaths?}", () => {
  const line = newBoxLine("k");
  assert.deepEqual(boxPieceFor(line), { kind: "box", boxSize: "medium", quantity: 1 });
  const typed = setBoxDims({ ...line, quantity: 2 }, { l: 20, w: 16, h: 14 });
  assert.deepEqual(boxPieceFor(typed), { kind: "box", boxSize: "medium", dimsIn: { l: 20, w: 16, h: 14 }, quantity: 2 });
  const withPhotos = {
    ...line,
    photos: [
      { key: "a", path: "p/a", previewUrl: "", status: "ready" as const },
      { key: "b", path: "", previewUrl: "", status: "uploading" as const },
    ],
  };
  assert.deepEqual(boxPieceFor(withPhotos).photoPaths, ["p/a"]);
});

test("the piece prices like the server: by size, quantity counted, Extra large quoted", () => {
  const route = { items: [], perLbCents: {}, boxPricesCents: { small: 2000, medium: 3500 }, departure: null };
  const line = { ...newBoxLine("k"), quantity: 2 };
  const priced = pricePiece(route, boxPieceFor(line));
  assert.equal(priced.estimateCents, 7000);
  assert.equal(priced.price?.source, "box_size");
  assert.equal(pricePiece(route, boxPieceFor(pickBoxSize(line, "xl"))).estimateCents, null);
  assert.equal(pricePiece(route, boxPieceFor(pickBoxSize(line, "large"))).estimateCents, null, "a size the business did not price");
  const byInches = pricePiece(route, boxPieceFor(setBoxDims(line, { l: 10, w: 10, h: 10 })));
  assert.equal(byInches.estimateCents, 4000, "inches win: Small x 2");
  assert.equal(boxLineText(line, "en"), "2 × Medium box");
  assert.equal(boxLineText({ ...line, quantity: 1 }, "fr"), "Boîte moyenne");
});

test("a request's box piece is read back", () => {
  const piece = { kind: "box", boxSize: "large", dimsIn: { l: 28, w: 22, h: 20 }, description: "2 × Large box", price: { source: "box_size", boxSize: "large", quantity: 2 } };
  const box = requestBoxOf(piece, "en");
  assert.deepEqual(box, { size: "large", label: "Large box", dims: { l: 28, w: 22, h: 20 }, quantity: 2 });
  assert.equal(requestBoxText(box!, "en"), "2 × Large box · 28 × 22 × 20 in");
  assert.equal(requestBoxText({ ...box!, dims: null, quantity: 1 }, "fr"), "Grande boîte");
  assert.deepEqual(requestBoxOf({ kind: "box", boxSize: "xl", description: "3 × Extra large box" }, "en"), { size: "xl", label: "Extra large box", dims: null, quantity: 3 });
  assert.equal(requestBoxOf({ kind: "box", description: "a box" }, "en"), null, "an old box piece has no size");
  assert.equal(requestBoxOf(null, "en"), null);
});

test("the designer opens at inches that really are the size it was opened from", () => {
  for (const id of BOX_SIZE_IDS) assert.equal(sizeForDims(typicalDims(id)), id, id);
  typicalDims("small").l = 99;
  assert.equal(typicalDims("small").l, 14, "a copy, never the shared object");
});
