const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateFreightContents,
  priceFreightContents,
  freightContentsSummary,
} = require("../freight_contents");
const {validateFreightQuoteRequest} = require("../freight_quote");

const TABLE = {
  electronics: {
    items: [
      {id: "iphone", label: "iPhone", pricingMode: "flat",
        flatPrice: 25, includedKg: 1},
      {id: "laptop", label: "Laptop", pricingMode: "flat",
        flatPrice: 40, includedKg: 2},
      {id: "tv", label: "Television", pricingMode: "per_kg"},
    ],
  },
};

const MIXED_BOX = {
  contentsItems: [
    {categoryId: "electronics", itemId: "iphone", label: "iPhone",
      quantity: 2},
    {categoryId: "electronics", itemId: "laptop", label: "Laptop",
      quantity: 1},
  ],
  otherGoodsKg: 4,
  otherCategoryId: "clothing",
  totalWeightKg: 6,
};

test("a mixed box reads as items plus one weighed bucket", () => {
  const result = validateFreightContents(MIXED_BOX);
  assert.equal(result.ok, true);
  assert.equal(result.contents.items.length, 2);
  assert.equal(result.contents.otherGoodsKg, 4);
  assert.equal(result.contents.totalWeightKg, 6);
});

test("absent contents are not an error - prose requests keep working", () => {
  assert.deepEqual(validateFreightContents({}), {ok: true, contents: null});
  const request = validateFreightQuoteRequest({description: "a box"});
  assert.equal(request.ok, true);
  assert.equal("contents" in request.request, false);
});

test("a declared list makes the prose optional", () => {
  const request = validateFreightQuoteRequest({...MIXED_BOX});
  assert.equal(request.ok, true);
  assert.equal(request.request.contents.items.length, 2);
  assert.equal(
      validateFreightQuoteRequest({}).error,
      "description_required",
  );
});

test("junk in a declaration is named, not swallowed", () => {
  const broken = (patch) =>
    validateFreightContents({...MIXED_BOX, ...patch}).error;
  assert.equal(broken({contentsItems: [{categoryId: "weapons",
    label: "x", quantity: 1}]}), "contents_category_invalid");
  assert.equal(broken({contentsItems: [{categoryId: "electronics",
    label: "", quantity: 1}]}), "contents_label_invalid");
  assert.equal(broken({contentsItems: [{categoryId: "electronics",
    label: "iPhone", quantity: 0}]}), "contents_quantity_invalid");
  assert.equal(broken({contentsItems: [{categoryId: "electronics",
    label: "iPhone", quantity: 2.5}]}), "contents_quantity_invalid");
  assert.equal(broken({otherGoodsKg: 999999999}),
      "contents_weight_invalid");
  assert.equal(broken({contentsItems: Array.from({length: 11}, () => (
    {categoryId: "electronics", label: "iPhone", quantity: 1}
  ))}), "contents_too_many_items");
});

test("the box prices as the sum of its lines", () => {
  const {contents} = validateFreightContents(MIXED_BOX);
  const priced = priceFreightContents({
    table: TABLE,
    ratePerKgCents: 400,
    multiplierFor: () => 1,
    contents,
  });
  assert.equal(priced.ok, true);
  assert.equal(priced.flatCents, 2 * 2500 + 4000);
  assert.equal(priced.includedKg, 2 * 1 + 2);
  assert.equal(priced.weighedCents, 4 * 400);
  assert.equal(priced.estimateCents, 9000 + 1600);
});

test("an item this business weighs belongs in the kilos, not the list", () => {
  const {contents} = validateFreightContents({
    contentsItems: [{categoryId: "electronics", itemId: "tv",
      label: "Television", quantity: 1}],
    otherGoodsKg: 0,
  });
  const priced = priceFreightContents({
    table: TABLE,
    ratePerKgCents: 400,
    multiplierFor: () => 1,
    contents,
  });
  assert.equal(priced.ok, false);
  assert.equal(priced.error, "contents_item_weighed");
  assert.equal(priced.itemLabel, "Television");
});

test("an item this business never priced is a request, not a guess", () => {
  const {contents} = validateFreightContents({
    contentsItems: [{categoryId: "fragile", itemId: "dishes",
      label: "Dishes", quantity: 1}],
    otherGoodsKg: 0,
  });
  const priced = priceFreightContents({
    table: TABLE,
    ratePerKgCents: 400,
    multiplierFor: () => 1,
    contents,
  });
  assert.equal(priced.ok, false);
  assert.equal(priced.error, "contents_item_unpriced");
});

test("the weighed bucket carries its category's multiplier", () => {
  const {contents} = validateFreightContents({
    contentsItems: [], otherGoodsKg: 10, otherCategoryId: "fragile",
  });
  const priced = priceFreightContents({
    table: TABLE,
    ratePerKgCents: 400,
    multiplierFor: (id) => (id === "fragile" ? 1.5 : 1),
    contents,
  });
  assert.equal(priced.ok, true);
  assert.equal(priced.weighedCents, Math.round(10 * 400 * 1.5));
  assert.equal(priced.weighedCategoryMultiplier, 1.5);
});

test("settlement math holds for a manifest: scale moves only the bucket",
    () => {
      const {calculateFreightSettlement} = require("../freight_settlement");
      // Booked: 2 iPhone + 1 laptop ($90 flat, 4kg included) + 4kg @ $4.
      // Estimate $106. Scale reads 9kg: bucket is really 5kg -> final
      // $90 + 5x$4 = $110 -> customer owes $4.
      const result = calculateFreightSettlement({
        estimatedTotalCents: 10600,
        verifiedWeightKg: 9,
        pricePerKg: 4,
        flatPriceCents: 9000,
        includedKg: 4,
      });
      assert.equal(result.finalTotalCents, 11000);
      assert.equal(result.adjustmentCents, 400);
    });

test("one line says what is in the box", () => {
  const {contents} = validateFreightContents(MIXED_BOX);
  assert.equal(
      freightContentsSummary(contents),
      "2 x iPhone, 1 x Laptop, 4 kg other goods",
  );
});
