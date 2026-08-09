const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  MAX_COVERAGE_RATE_PCT,
  PLATFORM_MAX_DECLARED_VALUE,
  freightCoveragePolicy,
  quoteFreightCoverage,
  validateFreightCoverageSettings,
} = require("../freight_coverage");

const covering = {
  freightCoverageEnabled: true,
  freightCoverageRatePct: 2,
  freightMaxDeclaredValue: 2000,
};

describe("a business's policy", () => {
  it("covers nothing until a business says otherwise", () => {
    // A business that has never opened these settings must behave exactly as
    // freight did before coverage existed.
    const policy = freightCoveragePolicy({});
    assert.equal(policy.coversLoss, false);
    assert.equal(policy.ratePct, 0);
    assert.equal(policy.maxDeclaredValue, 0);
  });

  it("does not claim to cover when the rate is zero", () => {
    // Otherwise a business that ticks the box and never sets a price appears
    // to the customer as though it were standing behind the parcel.
    const policy = freightCoveragePolicy({
      freightCoverageEnabled: true,
      freightCoverageRatePct: 0,
    });
    assert.equal(policy.coversLoss, false);
  });

  it("cannot promise more than the platform allows", () => {
    const policy = freightCoveragePolicy({
      freightCoverageEnabled: true,
      freightCoverageRatePct: 99,
      freightMaxDeclaredValue: 999999,
    });
    assert.equal(policy.ratePct, MAX_COVERAGE_RATE_PCT);
    assert.equal(policy.maxDeclaredValue, PLATFORM_MAX_DECLARED_VALUE);
  });
});

describe("declaring nothing", () => {
  it("costs nothing and promises nothing", () => {
    const quote = quoteFreightCoverage({business: covering, declaredValue: 0});
    assert.equal(quote.ok, true);
    assert.equal(quote.coverageFeeCents, 0);
    assert.equal(quote.covered, false);
    assert.equal(quote.payoutCapCents, 0);
  });

  it("is what an older app sending no value gets", () => {
    // Build 26 knows nothing about declared value. It must still quote.
    for (const value of [undefined, null, "", "abc", -50]) {
      const quote = quoteFreightCoverage({
        business: covering,
        declaredValue: value,
      });
      assert.equal(quote.ok, true, String(value));
      assert.equal(quote.coverageFeeCents, 0);
    }
  });
});

describe("declaring a value", () => {
  it("charges the rate and caps the payout at what was declared", () => {
    // The rule that makes the declaration honest: understate it and you have
    // capped your own compensation.
    const quote = quoteFreightCoverage({
      business: covering,
      declaredValue: 1400,
    });
    assert.equal(quote.ok, true);
    assert.equal(quote.covered, true);
    assert.equal(quote.coverageFeeCents, 2800);
    assert.equal(quote.payoutCapCents, 140000);
  });

  it("prices an old phone far below a new one, as it should", () => {
    // The case categories could never answer: same category, same weight.
    const newPhone = quoteFreightCoverage({
      business: covering,
      declaredValue: 1400,
    });
    const oldPhone = quoteFreightCoverage({
      business: covering,
      declaredValue: 150,
    });
    assert.equal(newPhone.coverageFeeCents, 2800);
    assert.equal(oldPhone.coverageFeeCents, 300);
  });

  it("refuses anything above what the business will carry", () => {
    const quote = quoteFreightCoverage({
      business: covering,
      declaredValue: 5000,
    });
    assert.equal(quote.ok, false);
    assert.equal(quote.error, "above_max_declared_value");
  });

  it("applies the ceiling even to a business that sells no coverage", () => {
    // The ceiling says what it is willing to carry, not what it insures.
    const quote = quoteFreightCoverage({
      business: {freightMaxDeclaredValue: 500},
      declaredValue: 900,
    });
    assert.equal(quote.error, "above_max_declared_value");
  });

  it("records the value but promises nothing when there is no coverage", () => {
    const quote = quoteFreightCoverage({
      business: {},
      declaredValue: 800,
    });
    assert.equal(quote.ok, true);
    assert.equal(quote.declaredValueCents, 80000);
    assert.equal(quote.covered, false);
    assert.equal(quote.coverageFeeCents, 0);
    assert.equal(quote.payoutCapCents, 0);
  });
});

describe("saving a policy", () => {
  it("accepts a sensible one", () => {
    const result = validateFreightCoverageSettings({
      coversLoss: true,
      ratePct: 2,
      maxDeclaredValue: 2000,
    });
    assert.equal(result.ok, true);
    assert.equal(result.freightCoverageRatePct, 2);
  });

  it("refuses to promise cover at no price", () => {
    // How a business ends up owing money it never collected for.
    assert.equal(
        validateFreightCoverageSettings({coversLoss: true, ratePct: 0}).error,
        "rate_required_when_covering",
    );
  });

  it("refuses a rate or ceiling outside the allowed band", () => {
    assert.equal(
        validateFreightCoverageSettings({ratePct: 50}).error,
        "rate_out_of_range",
    );
    assert.equal(
        validateFreightCoverageSettings({maxDeclaredValue: 999999}).error,
        "max_out_of_range",
    );
  });

  it("lets a business carry things without covering them", () => {
    const result = validateFreightCoverageSettings({
      coversLoss: false,
      maxDeclaredValue: 500,
    });
    assert.equal(result.ok, true);
    assert.equal(result.freightCoverageEnabled, false);
    assert.equal(result.freightMaxDeclaredValue, 500);
  });
});
