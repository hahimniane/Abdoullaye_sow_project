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
      {id: "iphone", label: "iPhone"},
      {id: "samsung-phone", label: "Samsung phone"},
    ],
    otherPricingMode: "per_kg",
  },
  clothing: {items: []},
};

const POLICY = {coversLoss: true};

describe("what a business lists", () => {
  it("finds the exact row the business published", () => {
    const iphone = freightPaybackFor({
      table: TABLE, categoryId: "electronics", itemId: "iphone",
    });
    assert.equal(iphone.listed, true);
    assert.equal(iphone.source, "item");
    assert.equal(iphone.label, "iPhone");
  });

  it("falls back to the category's catch-all when it has one", () => {
    const unknown = freightPaybackFor({
      table: TABLE, categoryId: "electronics", itemId: "walkman",
    });
    assert.equal(unknown.listed, true);
    assert.equal(unknown.source, "other");
  });

  it("says unlisted rather than guessing", () => {
    // Unlisted is a routing answer, not an error: it is what sends the
    // booking to the price-request path.
    for (const query of [
      {table: TABLE, categoryId: "clothing", itemId: "boubou"},
      {table: TABLE, categoryId: "food"},
      {table: undefined, categoryId: "electronics", itemId: "iphone"},
    ]) {
      assert.equal(freightPaybackFor(query).listed, false);
    }
  });

  it("attaches no amount to anything", () => {
    // A business does not say what it will pay for a missing parcel. It
    // either covers the parcel or it does not, and a figure per item was
    // an invitation to argue over the number.
    const row = freightPaybackFor({
      table: TABLE, categoryId: "electronics", itemId: "iphone",
    });
    assert.equal("paybackAmount" in row, false);
  });
});

describe("whether a parcel is covered", () => {
  const business = {freightPaybackTable: TABLE};

  it("answers yes or no, and charges nothing either way", () => {
    const quote = quoteFreightItemCoverage({
      business, policy: POLICY, categoryId: "electronics", itemId: "iphone",
    });
    assert.equal(quote.ok, true);
    assert.equal(quote.covered, true);
    assert.equal(quote.coverageFeeCents, 0);
    // No sum anywhere: the answer is the whole answer.
    assert.equal("payoutCapCents" in quote, false);
    assert.equal("paybackAmountCents" in quote, false);
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
  });

  it("routes unlisted items away instead of covering them", () => {
    const quote = quoteFreightItemCoverage({
      business, policy: POLICY, categoryId: "clothing", itemId: "boubou",
    });
    assert.equal(quote.ok, false);
    assert.equal(quote.error, "item_not_listed");
  });
});

describe("saving the catalogue", () => {
  it("cleans and keeps a sensible list", () => {
    const result = validateFreightPaybackTable({
      electronics: {
        items: [{
          id: "IPhone!", label: "  iPhone  ",
          pricingMode: "flat", flatPrice: 50,
        }],
      },
    });
    assert.equal(result.ok, true);
    const row = result.table.electronics.items[0];
    assert.equal(row.id, "iphone-");
    assert.equal(row.label, "iPhone");
    assert.equal(row.flatPrice, 50);
    assert.equal("paybackAmount" in row, false);
  });

  it("refuses duplicates and empty rows", () => {
    assert.equal(validateFreightPaybackTable({
      electronics: {
        items: [
          {id: "iphone", label: "iPhone"},
          {id: "iphone", label: "iPhone again"},
        ],
      },
    }).error, "item_duplicated");
    assert.equal(validateFreightPaybackTable({
      electronics: {items: [{id: "", label: ""}]},
    }).error, "item_invalid");
  });

  it("treats nothing-saved as an empty table", () => {
    assert.deepEqual(validateFreightPaybackTable(undefined),
        {ok: true, table: {}});
  });

  it("suggests items with no numbers attached", () => {
    for (const items of Object.values(STANDARD_FREIGHT_ITEMS)) {
      for (const item of items) {
        assert.equal("paybackAmount" in item, false, item.id);
        assert.equal("flatPrice" in item, false, item.id);
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
          id: "iphone", label: "iPhone 16",
          pricingMode: "flat", flatPrice: 50, includedKg: 2,
        },
        // A set price covering the parcel however heavy it is.
        {
          id: "sim", label: "SIM card",
          pricingMode: "flat", flatPrice: 10,
        },
        // Goods that vary, priced by the scale at the route rate.
        {
          id: "mixed-tech", label: "Assorted tech",
          pricingMode: "per_kg",
        },
        // A row saved before pricing existed.
        {id: "legacy", label: "Legacy row"},
      ],
      otherPricingMode: "per_kg",
    },
    clothing: {items: []},
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
    electronics: {items: [item]},
  });

  it("keeps a set price and its allowance", () => {
    const r = priced({
      id: "iphone", label: "iPhone",
      pricingMode: "flat", flatPrice: 50.005, includedKg: 2.5,
    });
    assert.equal(r.ok, true);
    const row = r.table.electronics.items[0];
    assert.equal(row.flatPrice, 50.01);
    assert.equal(row.includedKg, 2.5);
  });

  it("drops an allowance of zero rather than storing a false limit", () => {
    const r = priced({
      id: "sim", label: "SIM",
      pricingMode: "flat", flatPrice: 10, includedKg: 0,
    });
    assert.equal("includedKg" in r.table.electronics.items[0], false);
  });

  it("refuses a price or allowance outside the band", () => {
    assert.equal(priced({
      id: "a", label: "A",
      pricingMode: "flat", flatPrice: 0,
    }).error, "flat_price_out_of_range");
    assert.equal(priced({
      id: "a", label: "A",
      pricingMode: "flat", flatPrice: 999999,
    }).error, "flat_price_out_of_range");
    assert.equal(priced({
      id: "a", label: "A",
      pricingMode: "flat", flatPrice: 50, includedKg: 5000,
    }).error, "included_kg_out_of_range");
    assert.equal(priced({
      id: "a", label: "A", pricingMode: "sometimes",
    }).error, "pricing_mode_invalid");
  });

  it("leaves a row that states no pricing alone", () => {
    const r = priced({id: "a", label: "A"});
    assert.equal(r.ok, true);
    assert.equal("pricingMode" in r.table.electronics.items[0], false);
  });
});
