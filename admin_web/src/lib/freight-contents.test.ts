import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  contentsFromRecord,
  contentsPayloadFields,
  contentsProblem,
  contentsSummary,
  priceContentsForBusiness,
  quoteLensForBusiness,
  type FreightContents,
} from "./freight-contents.ts";
import { translateValue } from "./french-dom.ts";

const TABLE = {
  electronics: {
    items: [
      {id: "iphone", label: "iPhone", pricingMode: "flat" as const,
        flatPrice: 25, includedKg: 1},
      {id: "laptop", label: "Laptop", pricingMode: "flat" as const,
        flatPrice: 40, includedKg: 2},
      {id: "tv", label: "Television", pricingMode: "per_kg" as const},
    ],
  },
};

const MIXED: FreightContents = {
  items: [
    {categoryId: "electronics", itemId: "iphone", label: "iPhone",
      quantity: 2},
    {categoryId: "electronics", itemId: "laptop", label: "Laptop",
      quantity: 1},
  ],
  otherGoodsKg: 4,
  otherCategoryId: "clothing",
  totalWeightKg: 6,
};

test("the payload mirrors the server contract exactly", () => {
  const payload = contentsPayloadFields(MIXED) as Record<string, unknown>;
  assert.equal((payload.contentsItems as unknown[]).length, 2);
  assert.equal(payload.otherGoodsKg, 4);
  assert.equal(payload.otherCategoryId, "clothing");
  assert.equal(payload.totalWeightKg, 6);
  assert.equal(contentsProblem(MIXED), null);
});

test("the box prices as the sum of its lines - same figures as the server",
  () => {
    const priced = priceContentsForBusiness({
      table: TABLE,
      ratePerKgCents: 400,
      multiplierFor: () => 1,
      contents: MIXED,
    });
    assert.equal(priced.ok, true);
    if (priced.ok) {
      assert.equal(priced.flatCents, 9000);
      assert.equal(priced.includedKg, 4);
      assert.equal(priced.estimateCents, 10600);
    }
  });

test("the lens is lenient where booking is strict", () => {
  // Booking a per-kg item as a line is refused; the QUOTE lens instead
  // notes "weighed with the rest" - the business is here to put a number
  // on the box, not to be told no.
  const withTv: FreightContents = {
    ...MIXED,
    items: [...MIXED.items,
      {categoryId: "electronics", itemId: "tv", label: "Television",
        quantity: 1}],
  };
  const strict = priceContentsForBusiness({
    table: TABLE, ratePerKgCents: 400, multiplierFor: () => 1,
    contents: withTv,
  });
  assert.equal(strict.ok, false);
  const lens = quoteLensForBusiness({
    table: TABLE, ratePerKgCents: 400, multiplierFor: () => 1,
    contents: withTv,
  });
  assert.equal(lens.lines[2].hint, "weighed with the rest");
  // total 6kg minus 4kg included by the flat lines -> 2kg... but the
  // declared bucket says 4kg; the larger honest figure wins.
  assert.equal(lens.suggestionCents, 9000 + 4 * 400);
});

test("a weigh-everything business sees the whole box in kilos", () => {
  const lens = quoteLensForBusiness({
    table: undefined,
    ratePerKgCents: 500,
    multiplierFor: () => 1,
    contents: MIXED,
  });
  assert.ok(lens.lines.every((line) => line.lineCents === null));
  // No flat coverage, so the whole 6 kg box is the weighed pool.
  assert.equal(lens.suggestionCents, 6 * 500);
});

test("a stored request round-trips through the record reader", () => {
  const record = contentsFromRecord({
    items: MIXED.items,
    otherGoodsKg: 4,
    otherCategoryId: "clothing",
    totalWeightKg: 6,
  });
  assert.ok(record);
  assert.equal(contentsSummary(record!), "2 × iPhone, 1 × Laptop, 4 kg other goods");
  assert.equal(contentsFromRecord(null), null);
  assert.equal(contentsFromRecord({items: []}), null);
});

test("every new box-builder string speaks French", () => {
  for (const english of [
    "What's in the box?",
    "Add an item",
    "What else is in the box?",
    "Add another priced item",
    "Other goods, weighed",
    "Box estimate",
    "weighed with the rest",
    "no price set",
    "Use suggested",
  ]) {
    const french = translateValue(english, "fr");
    assert.notEqual(french, english, english);
  }
});

test("all three mirrors carry the same standard items", () => {
  // functions/freight_payback.js owns the list; the Dart mirror hardcodes
  // it. Drift here means a customer picks an item one client cannot name.
  const serverSource = readFileSync(
    "../my_flutter_app/functions/freight_payback.js",
    "utf8",
  );
  const dartSource = readFileSync(
    "../my_flutter_app/lib/utils/freight_contents.dart",
    "utf8",
  );
  for (const id of [
    "iphone", "samsung-phone", "other-phone", "laptop", "tablet", "tv",
    "game-console", "perfume", "hair-products", "dishes",
  ]) {
    assert.match(serverSource, new RegExp(`id: "${id}"`), `server ${id}`);
    assert.match(dartSource, new RegExp(`id: '${id}'`), `dart ${id}`);
  }
});
