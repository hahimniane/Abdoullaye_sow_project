const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  FREIGHT_QUOTE_STATUS,
  MAX_FREIGHT_QUOTE_CENTS,
  freightQuoteDocumentId,
  validateFreightQuote,
  validateFreightQuoteRequest,
} = require("../freight_quote");

describe("asking for a price", () => {
  it("needs only a description of what is being sent", () => {
    // This path exists for the customer who cannot answer the questions the
    // instant booking asks, so demanding a taxonomy would defeat it.
    const result = validateFreightQuoteRequest({
      description: "  A car battery and two spare belts  ",
    });
    assert.equal(result.ok, true);
    assert.equal(result.request.description,
        "A car battery and two spare belts");
    assert.equal(result.request.weightKg, 0);
  });

  it("keeps a weight when the customer happens to know it", () => {
    const result = validateFreightQuoteRequest({
      description: "Car battery",
      weightKg: 18.4567,
      itemCategoryId: "general",
      itemLabel: "Car battery",
    });
    assert.equal(result.request.weightKg, 18.457);
    assert.equal(result.request.itemLabel, "Car battery");
  });

  it("refuses a request nobody could price", () => {
    assert.equal(
        validateFreightQuoteRequest({description: "   "}).error,
        "description_required",
    );
    assert.equal(
        validateFreightQuoteRequest({description: "x".repeat(2001)}).error,
        "description_too_long",
    );
  });
});

describe("answering with a price", () => {
  it("carries what it costs and whether it is covered", () => {
    // A quote states cover, because the customer is choosing between
    // businesses on that as well as on price - but never a sum.
    const result = validateFreightQuote({
      amountCents: 8500,
      coversLoss: true,
      terms: "  Two weeks by sea  ",
    });
    assert.equal(result.ok, true);
    assert.equal(result.quote.amountCents, 8500);
    assert.equal(result.quote.coversLoss, true);
    assert.equal(result.quote.terms, "Two weeks by sea");
    assert.equal("paybackAmountCents" in result.quote, false);
  });

  it("lets a business quote without standing behind the parcel", () => {
    // Not covering is an answer, not an omission - and the customer sees it
    // beside the price before choosing.
    const result = validateFreightQuote({amountCents: 5000});
    assert.equal(result.quote.coversLoss, false);
  });

  it("refuses a price that is not a price", () => {
    for (const amountCents of [0, -100, 12.5, undefined, "lots"]) {
      assert.equal(
          validateFreightQuote({amountCents}).error,
          "amount_invalid",
          String(amountCents),
      );
    }
    assert.equal(
        validateFreightQuote({
          amountCents: MAX_FREIGHT_QUOTE_CENTS + 1,
        }).error,
        "amount_out_of_range",
    );
    assert.equal(
        validateFreightQuote({
          amountCents: 5000,
          terms: "x".repeat(1001),
        }).error,
        "terms_too_long",
    );
  });
});

describe("one answer per business", () => {
  it("addresses a quote deterministically so a second one revises it", () => {
    // Otherwise a business that corrects its price leaves the customer
    // looking at two numbers from the same company.
    assert.equal(
        freightQuoteDocumentId("req123", "biz456"),
        "req123__biz456",
    );
  });

  it("names the states a request moves through", () => {
    assert.deepEqual(Object.values(FREIGHT_QUOTE_STATUS), [
      "collecting", "selected", "cancelled",
    ]);
  });
});
