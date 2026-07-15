import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, describe, test} from "node:test";

import {
  appCheckWebConfig,
  deploymentMode,
  paymentModeEvidence,
  simulationEnabled,
  stripeKeyMode,
} from "../preflight-lib.mjs";

const tempDirs = [];
afterEach(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop(), {recursive: true, force: true});
});

describe("deployment mode", () => {
  test("recognizes the production project and rejects a test label", () => {
    assert.equal(deploymentMode({projectId: "car-selling-flutter-app"}).mode, "production");
    assert.equal(deploymentMode({
      projectId: "car-selling-flutter-app",
      deployEnvironment: "test",
    }).ok, false);
  });

  test("requires non-production projects to be explicitly labeled", () => {
    assert.equal(deploymentMode({projectId: "demo-laawol"}).ok, false);
    assert.deepEqual(deploymentMode({
      projectId: "demo-laawol",
      deployEnvironment: "staging",
    }), {
      ok: true,
      mode: "nonproduction",
      detail: "staging project demo-laawol",
    });
  });
});

test("payment simulation accepts only explicit false-like values", () => {
  for (const value of [undefined, "", "false", "0", "no", "off"]) {
    assert.equal(simulationEnabled(value), false, String(value));
  }
  for (const value of ["true", "1", "yes", "on"]) {
    assert.equal(simulationEnabled(value), true, value);
  }
});

test("payment evidence detects simulation without exposing env contents", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "laawol-preflight-"));
  tempDirs.push(dir);
  fs.writeFileSync(path.join(dir, ".env.example"), "SIMULATE_PAYMENTS=true\n");
  fs.writeFileSync(path.join(dir, ".env.production"), "SIMULATE_PAYMENTS='true'\n");
  assert.deepEqual(paymentModeEvidence({functionsDir: dir}), {
    simulationEnabled: true,
    enabledSources: [".env.production"],
  });
});

test("Stripe key mode distinguishes live, test, and invalid values", () => {
  assert.equal(stripeKeyMode("sk_live_example"), "live");
  assert.equal(stripeKeyMode("sk_test_example"), "test");
  assert.equal(stripeKeyMode("rk_live_example"), "invalid");
});

test("production App Check requires a site key and rejects debug tokens", () => {
  assert.equal(appCheckWebConfig({
    siteKey: "site_key_12345",
    production: true,
  }).ok, true);
  assert.equal(appCheckWebConfig({production: true}).ok, false);
  assert.equal(appCheckWebConfig({
    siteKey: "site_key_12345",
    debugToken: "registered_debug_token",
    production: true,
  }).ok, false);
});
