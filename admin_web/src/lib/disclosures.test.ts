import assert from "node:assert/strict";
import test from "node:test";

import {
  LEGAL_ACCEPTANCE_VERSION,
  MARKETPLACE_DISCLOSURE_VERSION,
  legalAcceptance,
  marketplaceDisclosure,
} from "./disclosures.ts";

test("marketplace and legal disclosures refuse to claim acceptance that wasn't given", () => {
  assert.throws(() => marketplaceDisclosure(false));
  assert.throws(() => legalAcceptance(false));
});

test("web disclosure versions match the server contracts", () => {
  assert.equal(
    MARKETPLACE_DISCLOSURE_VERSION,
    "marketplace-provider-responsibility-v1",
  );
  assert.equal(
    LEGAL_ACCEPTANCE_VERSION,
    "terms-privacy-marketplace-v1",
  );
});

test("web disclosures send the language code required by the server", () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  try {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: () => "fr",
        },
      },
    });
    assert.equal(marketplaceDisclosure(true).locale, "fr");
    assert.equal(legalAcceptance(true).locale, "fr");

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: () => "en",
        },
      },
    });
    assert.equal(marketplaceDisclosure(true).locale, "en");
    assert.equal(legalAcceptance(true).locale, "en");
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});
