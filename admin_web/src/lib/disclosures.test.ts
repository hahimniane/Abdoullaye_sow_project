import assert from "node:assert/strict";
import test from "node:test";

import {
  LEGAL_ACCEPTANCE_VERSION,
  MARKETPLACE_DISCLOSURE_VERSION,
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
