const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  PLATFORM_MAX_DECLARED_VALUE,
  freightCoveragePolicy,
  quoteFreightCoverage,
  validateFreightCoverageSettings,
} = require("../freight_coverage");

const covering = {freightCoverageEnabled: true};

describe("a business's policy", () => {
  it("covers nothing until a business says otherwise", () => {
    // A business that has never opened these settings must behave exactly as
    // freight did before coverage existed.
    assert.equal(freightCoveragePolicy({}).coversLoss, false);
    assert.equal(freightCoveragePolicy(null).coversLoss, false);
  });

  it("is one yes-or-no answer with no price attached", () => {
    // A business either makes good on a lost parcel or it does not. There is
    // no rate to qualify that with: the item's own price already carries the
    // risk, so covering costs the customer nothing.
    const policy = freightCoveragePolicy(covering);
    assert.equal(policy.coversLoss, true);
    assert.deepEqual(Object.keys(policy), ["coversLoss"]);
  });

  it("ignores a rate left behind by an older setting", () => {
    // A business that once set 2% must not read as uncovered now, nor carry
    // a number that nothing prices from.
    const policy = freightCoveragePolicy({
      freightCoverageEnabled: true,
      freightCoverageRatePct: 2,
      freightMaxDeclaredValue: 2000,
    });
    assert.equal(policy.coversLoss, true);
    assert.equal(policy.ratePct, undefined);
    assert.equal(policy.maxDeclaredValue, undefined);
  });
});

describe("a legacy client that still declares a value", () => {
  it("is never charged for cover", () => {
    // App builds predating the item picker still send a number. It is
    // recorded, and it buys nothing - the business's published payback is
    // what stands behind the parcel, whichever build booked it.
    const quote = quoteFreightCoverage({
      business: covering,
      declaredValue: 1400,
    });
    assert.equal(quote.ok, true);
    assert.equal(quote.coverageFeeCents, 0);
    assert.equal(quote.coverageFee, 0);
    assert.equal(quote.declaredValueCents, 140000);
  });

  it("quotes for a build that sends nothing at all", () => {
    for (const value of [undefined, null, "", "abc", -50, 0]) {
      const quote = quoteFreightCoverage({
        business: covering,
        declaredValue: value,
      });
      assert.equal(quote.ok, true, String(value));
      assert.equal(quote.coverageFeeCents, 0);
      assert.equal(quote.declaredValueCents, 0);
    }
  });

  it("still refuses a parcel above the platform's ceiling", () => {
    // Worth more than this belongs with a real freight forwarder.
    const quote = quoteFreightCoverage({
      business: covering,
      declaredValue: PLATFORM_MAX_DECLARED_VALUE + 1,
    });
    assert.equal(quote.ok, false);
    assert.equal(quote.error, "above_platform_maximum");
  });
});

describe("saving a policy", () => {
  it("stores the one answer there is to store", () => {
    const result = validateFreightCoverageSettings({coversLoss: true});
    assert.equal(result.ok, true);
    assert.equal(result.freightCoverageEnabled, true);
  });

  it("cannot be refused for a missing price", () => {
    // Covering at no charge is the model now, so the save that used to be
    // rejected for it has to go through.
    const result = validateFreightCoverageSettings({coversLoss: true});
    assert.equal(result.ok, true);
    assert.equal(result.error, undefined);
  });

  it("zeroes a rate a business set under the old settings", () => {
    // Left in place it would be a number the business believes it charges
    // and nothing collects.
    const result = validateFreightCoverageSettings({coversLoss: true});
    assert.equal(result.freightCoverageRatePct, 0);
    assert.equal(result.freightMaxDeclaredValue, 0);
  });

  it("lets a business carry things without covering them", () => {
    const result = validateFreightCoverageSettings({coversLoss: false});
    assert.equal(result.ok, true);
    assert.equal(result.freightCoverageEnabled, false);
  });

  it("defaults to not covering when asked nothing", () => {
    assert.equal(
        validateFreightCoverageSettings().freightCoverageEnabled,
        false,
    );
  });
});
