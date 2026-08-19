const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  STANDARD_FREIGHT_ITEMS,
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

const POLICY = {coversLoss: true, ratePct: 2};

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

describe("pricing coverage from the table", () => {
  const business = {freightPaybackTable: TABLE};

  it("derives the fee from the business's payback, never a claim", () => {
    const quote = quoteFreightItemCoverage({
      business, policy: POLICY, categoryId: "electronics", itemId: "iphone",
    });
    // 2% of $400 = $8. The customer never typed a number anywhere.
    assert.equal(quote.coverageFeeCents, 800);
    assert.equal(quote.payoutCapCents, 40000);
    assert.equal(quote.covered, true);
  });

  it("carries-but-does-not-cover when the business does not cover", () => {
    const quote = quoteFreightItemCoverage({
      business,
      policy: {coversLoss: false, ratePct: 0},
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
