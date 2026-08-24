const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  STANDARD_FREIGHT_ITEMS,
  freightItemPricing,
  freightPaybackFor,
  quoteFreightItemCoverage,
  validateFreightPaybackTable,
} = require("../freight_payback");

const TABLE = {
  electronics: {
    items: [
      {id: "iphone", label: "iPhone", paybackAmount: 400},
      {id: "samsung-phone", label: "Samsung phone", paybackAmount: 250},
    ],
    otherPaybackAmount: 100,
  },
  clothing: {items: [], otherPaybackAmount: 0},
};

const POLICY = {coversLoss: true};

describe("what an item pays back", () => {
  it("prices the exact row the business published", () => {
    // The whole redesign in one assertion: the number is the business's, and
    // an iPhone is not a Samsung.
    const iphone = freightPaybackFor({
      table: TABLE, categoryId: "electronics", itemId: "iphone",
    });
    const samsung = freightPaybackFor({
      table: TABLE, categoryId: "electronics", itemId: "samsung-phone",
    });
    assert.equal(iphone.paybackAmount, 400);
    assert.equal(samsung.paybackAmount, 250);
    assert.equal(iphone.source, "item");
  });

  it("falls back to the category's own catch-all, when priced", () => {
    const unknown = freightPaybackFor({
      table: TABLE, categoryId: "electronics", itemId: "walkman",
    });
    assert.equal(unknown.paybackAmount, 100);
    assert.equal(unknown.source, "other");
  });

  it("says unlisted rather than guessing", () => {
    // Unlisted is a routing answer, not an error: it is what sends the
    // booking to the quote-request path.
    for (const query of [
      {table: TABLE, categoryId: "clothing", itemId: "boubou"},
      {table: TABLE, categoryId: "food"},
      {table: undefined, categoryId: "electronics", itemId: "iphone"},
    ]) {
      assert.equal(freightPaybackFor(query).listed, false);
    }
  });
});

describe("what the table promises", () => {
  const business = {freightPaybackTable: TABLE};

  it("promises the business's full published payback, free", () => {
    const quote = quoteFreightItemCoverage({
      business, policy: POLICY, categoryId: "electronics", itemId: "iphone",
    });
    // The whole promise, not a proportion of it - and it costs nothing,
    // because the business already priced this item for what it is worth to
    // carry. The customer never typed a number anywhere.
    assert.equal(quote.payoutCapCents, 40000);
    assert.equal(quote.covered, true);
    assert.equal(quote.coverageFeeCents, 0);
    assert.equal(quote.coverageFee, 0);
  });

  it("never charges for cover, whatever the item is worth", () => {
    // An iPhone and a Samsung differ in what they pay back, never in price.
    for (const itemId of ["iphone", "samsung-phone", "walkman"]) {
      const quote = quoteFreightItemCoverage({
        business, policy: POLICY, categoryId: "electronics", itemId,
      });
      assert.equal(quote.coverageFeeCents, 0, itemId);
    }
  });

  it("carries-but-does-not-cover when the business does not cover", () => {
    const quote = quoteFreightItemCoverage({
      business,
      policy: {coversLoss: false},
      categoryId: "electronics",
      itemId: "iphone",
    });
    assert.equal(quote.ok, true);
    assert.equal(quote.covered, false);
    assert.equal(quote.coverageFeeCents, 0);
    assert.equal(quote.payoutCapCents, 0);
  });

  it("routes unlisted items away instead of pricing them", () => {
    const quote = quoteFreightItemCoverage({
      business, policy: POLICY, categoryId: "clothing", itemId: "boubou",
    });
    assert.equal(quote.ok, false);
    assert.equal(quote.error, "item_not_listed");
  });
});

describe("saving the table", () => {
  it("cleans and keeps a sensible table", () => {
    const result = validateFreightPaybackTable({
      electronics: {
        items: [{id: "IPhone!", label: "  iPhone  ", paybackAmount: 400.005}],
        otherPaybackAmount: 50,
      },
    });
    assert.equal(result.ok, true);
    const row = result.table.electronics.items[0];
    assert.equal(row.id, "iphone-");
    assert.equal(row.label, "iPhone");
    assert.equal(row.paybackAmount, 400.01);
  });

  it("refuses paybacks past the platform ceiling instead of clamping", () => {
    // A business that types $50,000 must be told the ceiling, not saved at
    // $10,000 and left believing it promised more.
    const result = validateFreightPaybackTable({
      electronics: {
        items: [{id: "tv", label: "TV", paybackAmount: 50000}],
        otherPaybackAmount: 0,
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "payback_out_of_range");
  });

  it("refuses duplicates and empty rows", () => {
    assert.equal(validateFreightPaybackTable({
      electronics: {
        items: [
          {id: "iphone", label: "iPhone", paybackAmount: 1},
          {id: "iphone", label: "iPhone again", paybackAmount: 2},
        ],
      },
    }).error, "item_duplicated");
    assert.equal(validateFreightPaybackTable({
      electronics: {items: [{id: "", label: "", paybackAmount: 1}]},
    }).error, "item_invalid");
  });

  it("treats nothing-saved as an empty table", () => {
    assert.deepEqual(validateFreightPaybackTable(undefined),
        {ok: true, table: {}});
  });

  it("suggests items with no prices attached", () => {
    // Suggestions seed the editor; only the business's own numbers count.
    for (const items of Object.values(STANDARD_FREIGHT_ITEMS)) {
      for (const item of items) {
        assert.equal("paybackAmount" in item, false, item.id);
      }
    }
  });
});

describe("how a business prices what it carries", () => {
  const TABLE_PRICED = {
    electronics: {
      items: [
        // A known object: one price, and an allowance so the retail box and
        // charger do not come out of the business's pocket.
        {
          id: "iphone", label: "iPhone 16", paybackAmount: 400,
          pricingMode: "flat", flatPrice: 50, includedKg: 2,
        },
        // A set price covering the parcel however heavy it is.
        {
          id: "sim", label: "SIM card", paybackAmount: 5,
          pricingMode: "flat", flatPrice: 10,
        },
        // Goods that vary, priced by the scale at the route rate.
        {
          id: "mixed-tech", label: "Assorted tech", paybackAmount: 100,
          pricingMode: "per_kg",
        },
        // A row saved before pricing existed.
        {id: "legacy", label: "Legacy row", paybackAmount: 90},
      ],
      otherPaybackAmount: 60,
      otherPricingMode: "per_kg",
    },
    clothing: {items: [], otherPaybackAmount: 40},
  };

  it("prices a known object once, and never weighs it at booking", () => {
    const p = freightItemPricing({
      table: TABLE_PRICED, categoryId: "electronics", itemId: "iphone",
      categoryMultiplier: 2,
    });
    assert.equal(p.mode, "flat");
    assert.equal(p.flatPrice, 50);
    assert.equal(p.includedKg, 2);
    // The customer picks the item and sees the price - nobody guesses the
    // weight of an iPhone at their kitchen table.
    assert.equal(p.needsWeightAtBooking, false);
    // The counter still weighs it, because the price covers only 2kg.
    assert.equal(p.weighsAtDropOff, true);
  });

  it("never weighs a set price that covers any weight", () => {
    const p = freightItemPricing({
      table: TABLE_PRICED, categoryId: "electronics", itemId: "sim",
      categoryMultiplier: 2,
    });
    assert.equal(p.flatPrice, 10);
    assert.equal(p.includedKg, 0);
    assert.equal(p.needsWeightAtBooking, false);
    assert.equal(p.weighsAtDropOff, false);
  });

  it("weighs goods that vary, at the business's own route rate", () => {
    const p = freightItemPricing({
      table: TABLE_PRICED, categoryId: "electronics", itemId: "mixed-tech",
    });
    assert.equal(p.priced, true);
    assert.equal(p.mode, "per_kg");
    assert.equal(p.needsWeightAtBooking, true);
    assert.equal(p.weighsAtDropOff, true);
  });

  it("sends a row nobody priced to a request, never to a guess", () => {
    // A business that has never quoted this item has no number to charge.
    // Inheriting one from its category was the platform inventing a price
    // on the business's behalf - electronics at 2x, chosen by nobody.
    const p = freightItemPricing({
      table: TABLE_PRICED, categoryId: "electronics", itemId: "legacy",
    });
    assert.equal(p.priced, false);
    assert.equal(p.mode, null);
    assert.equal(p.flatPrice, 0);
    assert.equal(p.weightFactor, 0);
  });

  it("falls through to the category's catch-all pricing", () => {
    const p = freightItemPricing({
      table: TABLE_PRICED, categoryId: "electronics", itemId: "not-a-row",
    });
    assert.equal(p.priced, true);
    assert.equal(p.source, "other");
    assert.equal(p.mode, "per_kg");
  });

  it("sends everything to a request when there is no table at all", () => {
    for (const query of [
      {table: undefined, categoryId: "electronics", itemId: "iphone"},
      {table: TABLE_PRICED, categoryId: "clothing", itemId: "boubou"},
    ]) {
      assert.equal(freightItemPricing(query).priced, false);
    }
  });
});

describe("saving a priced row", () => {
  const priced = (item) => validateFreightPaybackTable({
    electronics: {items: [item], otherPaybackAmount: 0},
  });

  it("keeps a set price and its allowance", () => {
    const r = priced({
      id: "iphone", label: "iPhone", paybackAmount: 400,
      pricingMode: "flat", flatPrice: 50.005, includedKg: 2.5,
    });
    assert.equal(r.ok, true);
    const row = r.table.electronics.items[0];
    assert.equal(row.flatPrice, 50.01);
    assert.equal(row.includedKg, 2.5);
  });

  it("drops an allowance of zero rather than storing a false limit", () => {
    const r = priced({
      id: "sim", label: "SIM", paybackAmount: 5,
      pricingMode: "flat", flatPrice: 10, includedKg: 0,
    });
    assert.equal("includedKg" in r.table.electronics.items[0], false);
  });

  it("refuses a price or allowance outside the band", () => {
    assert.equal(priced({
      id: "a", label: "A", paybackAmount: 1,
      pricingMode: "flat", flatPrice: 0,
    }).error, "flat_price_out_of_range");
    assert.equal(priced({
      id: "a", label: "A", paybackAmount: 1,
      pricingMode: "flat", flatPrice: 999999,
    }).error, "flat_price_out_of_range");
    assert.equal(priced({
      id: "a", label: "A", paybackAmount: 1,
      pricingMode: "flat", flatPrice: 50, includedKg: 5000,
    }).error, "included_kg_out_of_range");
    assert.equal(priced({
      id: "a", label: "A", paybackAmount: 1, pricingMode: "sometimes",
    }).error, "pricing_mode_invalid");
  });

  it("leaves a row that states no pricing alone", () => {
    const r = priced({id: "a", label: "A", paybackAmount: 1});
    assert.equal(r.ok, true);
    assert.equal("pricingMode" in r.table.electronics.items[0], false);
  });
});
