const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  ACCOUNT_LEGAL_VERSION,
  MARKETPLACE_DISCLOSURE_VERSION,
  accountLegalAcceptance,
  marketplaceDisclosure,
} = require("../marketplace_disclosure");

describe("marketplace disclosure contracts", () => {
  it("rejects invalid marketplace acceptance", () => {
    assert.throws(() => marketplaceDisclosure(), /required/);
    assert.throws(
        () => marketplaceDisclosure({
          accepted: false,
          version: MARKETPLACE_DISCLOSURE_VERSION,
          locale: "en",
        }),
        /missing or out of date/,
    );
    assert.throws(
        () => marketplaceDisclosure({
          accepted: true,
          version: "old-version",
          locale: "en",
        }),
        /missing or out of date/,
    );
    assert.throws(
        () => marketplaceDisclosure({
          accepted: true,
          version: MARKETPLACE_DISCLOSURE_VERSION,
          locale: "es",
        }),
        /locale must be en or fr/,
    );
  });

  it("returns canonical marketplace and account evidence", () => {
    assert.deepEqual(marketplaceDisclosure({
      accepted: true,
      version: MARKETPLACE_DISCLOSURE_VERSION,
      locale: "FR",
    }), {
      accepted: true,
      version: MARKETPLACE_DISCLOSURE_VERSION,
      locale: "fr",
    });
    assert.deepEqual(accountLegalAcceptance({
      accepted: true,
      version: ACCOUNT_LEGAL_VERSION,
      locale: "en",
    }), {
      accepted: true,
      version: ACCOUNT_LEGAL_VERSION,
      locale: "en",
    });
  });
});
