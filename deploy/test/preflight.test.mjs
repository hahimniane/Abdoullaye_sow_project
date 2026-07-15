import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, describe, test} from "node:test";

import {
  PRODUCTION_STATIC_HOSTS,
  assessStaticDnsHost,
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

test("static DNS accepts only the documented Hostinger IPv4 without IPv6", () => {
  assert.deepEqual(assessStaticDnsHost({
    hostname: "laawoldigital.com",
    ipv4Result: {
      status: "ok",
      addresses: ["46.202.183.189", "46.202.183.189"],
    },
    ipv6Result: {status: "absent", addresses: [], errorCode: "ENODATA"},
  }), {
    ok: true,
    detail: "A=46.202.183.189; no unexpected AAAA record",
  });
});

test("static DNS rejects a wrong address and an IPv6 blackhole", () => {
  const result = assessStaticDnsHost({
    hostname: "admin.laawoldigital.com",
    ipv4Result: {status: "ok", addresses: ["18.204.152.241"]},
    ipv6Result: {status: "ok", addresses: ["::"]},
  });

  assert.equal(result.ok, false);
  assert.match(result.detail, /A=18\.204\.152\.241; expected 46\.202\.183\.189/);
  assert.match(result.detail, /unexpected AAAA=::/);
});

test("static DNS rejects mixed A records and resolver errors", () => {
  const mixed = assessStaticDnsHost({
    hostname: "business.laawoldigital.com",
    ipv4Result: {
      status: "ok",
      addresses: ["46.202.183.189", "18.204.152.241"],
    },
    ipv6Result: {status: "absent", addresses: [], errorCode: "ENODATA"},
  });
  assert.equal(mixed.ok, false);

  const timedOut = assessStaticDnsHost({
    hostname: "business.laawoldigital.com",
    ipv4Result: {status: "error", addresses: [], errorCode: "ETIMEOUT"},
    ipv6Result: {status: "error", addresses: [], errorCode: "SERVFAIL"},
  });
  assert.equal(timedOut.ok, false);
  assert.match(timedOut.detail, /A lookup failed \(ETIMEOUT\)/);
  assert.match(timedOut.detail, /AAAA lookup failed \(SERVFAIL\)/);
});

test("static DNS rejects missing A and invalid expected addresses", () => {
  assert.equal(assessStaticDnsHost({
    hostname: "business.laawoldigital.com",
    ipv4Result: {status: "absent", addresses: [], errorCode: "ENOTFOUND"},
    ipv6Result: {status: "absent", addresses: [], errorCode: "ENOTFOUND"},
  }).ok, false);
  assert.match(assessStaticDnsHost({
    hostname: "business.laawoldigital.com",
    expectedIPv4: "hostinger.example",
  }).detail, /expected static IPv4 must be valid/);
});

test("static DNS gate covers every production hostname", () => {
  assert.deepEqual(PRODUCTION_STATIC_HOSTS, [
    "laawoldigital.com",
    "admin.laawoldigital.com",
    "business.laawoldigital.com",
  ]);
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
