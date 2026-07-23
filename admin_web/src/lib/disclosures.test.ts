import assert from "node:assert/strict";
import test from "node:test";

import {
  LEGAL_ACCEPTANCE_VERSION,
  MARKETPLACE_DISCLOSURE_VERSION,
  legalAcceptance,
  marketplaceDisclosure,
} from "./disclosures.ts";

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
    assert.equal(marketplaceDisclosure().locale, "fr");
    assert.equal(legalAcceptance().locale, "fr");

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: () => "en",
        },
      },
    });
    assert.equal(marketplaceDisclosure().locale, "en");
    assert.equal(legalAcceptance().locale, "en");
  } finally {
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", originalWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});
