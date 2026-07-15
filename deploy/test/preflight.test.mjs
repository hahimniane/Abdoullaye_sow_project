import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, describe, test} from "node:test";

import {
  appCheckWebConfig,
  deploymentJavaEnvironment,
  deploymentMode,
  firebaseDryRunConfig,
  javaMajorVersion,
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

test("deployment commands prefer a compatible Java home on the command path", () => {
  const compatibleHome = path.join("", "opt", "openjdk-21");
  const result = deploymentJavaEnvironment({
    environment: {
      JAVA_HOME: path.join("", "opt", "openjdk-17"),
      PATH: [path.join("", "opt", "openjdk-17", "bin"), "/usr/bin"].join(":"),
    },
    candidateHomes: [compatibleHome],
    existsSync: (candidate) => candidate === path.join(compatibleHome, "bin", "java"),
    delimiter: ":",
  });

  assert.equal(result.JAVA_HOME, compatibleHome);
  assert.equal(result.PATH.split(":")[0], path.join(compatibleHome, "bin"));
});

test("DEPLOY_JAVA_HOME overrides auto-detected Java locations", () => {
  const overrideHome = path.join("", "custom", "jdk-22");
  const result = deploymentJavaEnvironment({
    environment: {DEPLOY_JAVA_HOME: overrideHome, PATH: "/usr/bin"},
    candidateHomes: [path.join("", "opt", "openjdk-21")],
    existsSync: () => true,
    delimiter: ":",
  });

  assert.equal(result.JAVA_HOME, overrideHome);
});

test("Java version parsing handles modern and legacy version output", () => {
  assert.equal(javaMajorVersion('openjdk version "21.0.11" 2026-04-21'), 21);
  assert.equal(javaMajorVersion('java version "1.8.0_402"'), 8);
  assert.equal(javaMajorVersion("unrecognized runtime"), null);
});

test("Firebase dry-run config removes only duplicate predeploy hooks", () => {
  const source = {
    firestore: {rules: "firestore.rules"},
    functions: [{
      source: "functions",
      codebase: "default",
      predeploy: ["npm run lint", "npm test"],
    }],
  };

  assert.deepEqual(firebaseDryRunConfig(source), {
    firestore: {rules: "firestore.rules"},
    functions: [{source: "functions", codebase: "default"}],
  });
  assert.deepEqual(source.functions[0].predeploy, ["npm run lint", "npm test"]);
});
