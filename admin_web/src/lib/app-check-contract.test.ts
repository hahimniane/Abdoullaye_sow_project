import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync("src/lib/firebase.ts", "utf8");

describe("Firebase App Check provider contract", () => {
  it("uses reCAPTCHA Enterprise for production web attestation", () => {
    assert.match(
      source,
      /import\s*\{[\s\S]*ReCaptchaEnterpriseProvider[\s\S]*\}\s*from "firebase\/app-check"/,
    );
    assert.match(
      source,
      /provider:\s*new ReCaptchaEnterpriseProvider\([\s\S]*appCheckSiteKey/,
    );
    assert.doesNotMatch(source, /ReCaptchaV3Provider/);
  });

  it("keeps release configuration fail-closed", () => {
    assert.match(source, /if \(production && !appCheckSiteKey\)/);
    assert.match(
      source,
      /if \(production && appCheckDebugToken\)[\s\S]*must not be set in production/,
    );
    assert.match(source, /isTokenAutoRefreshEnabled:\s*true/);
  });

  it("preserves the opt-in local debug-token behavior", () => {
    assert.match(source, /if \(production \|\| appCheckDebugToken\)/);
    assert.match(
      source,
      /if \(!production\)\s*\{[\s\S]*FIREBASE_APPCHECK_DEBUG_TOKEN\s*=[\s\S]*appCheckDebugToken === "true"\s*\?\s*true\s*:\s*appCheckDebugToken/,
    );
    assert.match(source, /appCheckSiteKey \|\| "debug-provider-not-used"/);
  });
});
