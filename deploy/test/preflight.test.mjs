import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {afterEach, describe, test} from "node:test";

import {
  HOSTINGER_PRODUCTION_IPV6,
  PRODUCTION_STATIC_HOSTS,
  assessStorageRulesFirestoreIam,
  assessStaticDnsHost,
  appCheckWebConfig,
  deploymentJavaEnvironment,
  deploymentMode,
  firebaseDryRunConfig,
  javaMajorVersion,
  paymentModeEvidence,
  resolveDnsOverHttps,
  simulationEnabled,
  stripeKeyMode,
  trustedDnsConsensus,
} from "../preflight-lib.mjs";

const tempDirs = [];
afterEach(() => {
  while (tempDirs.length) fs.rmSync(tempDirs.pop(), {recursive: true, force: true});
});

describe("deployment mode", () => {
  const beforeDevelopmentCutoff = new Date("2026-09-01T03:59:59.999Z");
  const atDevelopmentCutoff = new Date("2026-09-01T04:00:00.000Z");

  test("keeps the production project production by default", () => {
    assert.deepEqual(deploymentMode({
      projectId: "car-selling-flutter-app",
      now: beforeDevelopmentCutoff,
    }), {
      ok: true,
      mode: "production",
      allowsTestPayments: false,
      detail: "production project car-selling-flutter-app",
    });
  });

  test("temporarily permits explicit development test payments in production", () => {
    assert.deepEqual(deploymentMode({
      projectId: "car-selling-flutter-app",
      deployEnvironment: "development",
      now: beforeDevelopmentCutoff,
    }), {
      ok: true,
      mode: "production",
      allowsTestPayments: true,
      detail:
        "production project car-selling-flutter-app; " +
        "test payments authorized through August 31, 2026",
    });
  });

  test("fails closed at the development cutoff", () => {
    assert.deepEqual(deploymentMode({
      projectId: "car-selling-flutter-app",
      deployEnvironment: "development",
      now: atDevelopmentCutoff,
    }), {
      ok: false,
      mode: "production",
      allowsTestPayments: false,
      detail: "the authorized development payment window ended August 31, 2026",
    });
  });

  test("rejects other non-production labels for the production project", () => {
    for (const deployEnvironment of ["test", "staging", "nonproduction"]) {
      const result = deploymentMode({
        projectId: "car-selling-flutter-app",
        deployEnvironment,
        now: beforeDevelopmentCutoff,
      });
      assert.equal(result.ok, false, deployEnvironment);
      assert.equal(result.mode, "production", deployEnvironment);
      assert.equal(result.allowsTestPayments, false, deployEnvironment);
    }
  });

  test("accepts an explicit production label without test payments", () => {
    assert.deepEqual(deploymentMode({
      projectId: "car-selling-flutter-app",
      deployEnvironment: "production",
      now: beforeDevelopmentCutoff,
    }), {
      ok: true,
      mode: "production",
      allowsTestPayments: false,
      detail: "production project car-selling-flutter-app",
    });
  });

  test("preserves explicit labeling for non-production projects", () => {
    assert.equal(deploymentMode({
      projectId: "demo-laawol",
      now: atDevelopmentCutoff,
    }).ok, false);
    assert.deepEqual(deploymentMode({
      projectId: "demo-laawol",
      deployEnvironment: "staging",
      now: atDevelopmentCutoff,
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

test("static DNS accepts only the documented Hostinger IPv4 and IPv6", () => {
  assert.deepEqual(assessStaticDnsHost({
    hostname: "laawoldigital.com",
    ipv4Result: {
      status: "ok",
      addresses: ["46.202.183.189", "46.202.183.189"],
    },
    ipv6Result: {status: "ok", addresses: [HOSTINGER_PRODUCTION_IPV6]},
  }), {
    ok: true,
    detail: `A=46.202.183.189; AAAA=${HOSTINGER_PRODUCTION_IPV6}`,
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
  assert.match(result.detail, /AAAA=::; expected 2a02:4780:2b:1948:0:998:df10:5/);
});

test("static DNS rejects mixed A records and resolver errors", () => {
  const mixed = assessStaticDnsHost({
    hostname: "business.laawoldigital.com",
    ipv4Result: {
      status: "ok",
      addresses: ["46.202.183.189", "18.204.152.241"],
    },
    ipv6Result: {status: "ok", addresses: [HOSTINGER_PRODUCTION_IPV6]},
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
  assert.match(assessStaticDnsHost({
    hostname: "business.laawoldigital.com",
    expectedIPv6: "not-an-ipv6-address",
  }).detail, /expected static IPv6 must be valid/);
});

test("DNS-over-HTTPS ignores intercepted local DNS answers", async () => {
  const result = await resolveDnsOverHttps({
    provider: {name: "Trusted", endpoint: "https://resolver.example/dns-query"},
    hostname: "laawoldigital.com",
    recordType: "A",
    fetchImpl: async (url, options) => {
      assert.equal(url.searchParams.get("name"), "laawoldigital.com");
      assert.equal(url.searchParams.get("type"), "A");
      assert.equal(options.headers.accept, "application/dns-json");
      return {
        ok: true,
        json: async () => ({
          Status: 0,
          Answer: [
            {type: 5, data: "ignored.example."},
            {type: 1, data: "46.202.183.189"},
          ],
        }),
      };
    },
  });

  assert.deepEqual(result, {
    provider: "Trusted",
    providerKey: "https://resolver.example/dns-query",
    status: "ok",
    addresses: ["46.202.183.189"],
    errorCode: undefined,
  });
});

test("trusted DNS consensus fails closed on interception or resolver errors", () => {
  assert.deepEqual(trustedDnsConsensus([
    {provider: "Google", status: "ok", addresses: ["46.202.183.189"]},
    {provider: "Cloudflare", status: "ok", addresses: ["46.202.183.189"]},
  ]), {status: "ok", addresses: ["46.202.183.189"]});

  assert.match(trustedDnsConsensus([
    {provider: "Google", status: "ok", addresses: ["46.202.183.189"]},
    {provider: "Cloudflare", status: "ok", addresses: ["18.204.152.241"]},
  ]).errorCode, /TRUSTED_RESOLVER_ADDRESS_MISMATCH/);

  assert.match(trustedDnsConsensus([
    {provider: "Google", status: "ok", addresses: ["46.202.183.189"]},
    {provider: "Cloudflare", status: "error", addresses: [], errorCode: "TimeoutError"},
  ]).errorCode, /Cloudflare:TimeoutError/);

  assert.match(trustedDnsConsensus([
    {provider: "Google", providerKey: "https://dns.google/resolve", status: "ok",
      addresses: ["46.202.183.189"]},
    {provider: "Google duplicate", providerKey: "https://dns.google/resolve", status: "ok",
      addresses: ["46.202.183.189"]},
  ]).errorCode, /INSUFFICIENT_DISTINCT_TRUSTED_RESOLVERS/);
});

test("DNS-over-HTTPS fails closed on invalid and incomplete responses", async () => {
  const provider = {name: "Trusted", endpoint: "https://resolver.example/dns-query"};
  const lookup = (response, recordType = "A") => resolveDnsOverHttps({
    provider,
    hostname: "laawoldigital.com",
    recordType,
    fetchImpl: async () => response,
  });

  assert.equal((await lookup({ok: false, status: 503})).errorCode, "HTTP_503");
  assert.equal((await lookup({ok: true, json: async () => ({Status: 2})}))
      .errorCode, "DNS_STATUS_2");
  assert.equal((await lookup({ok: true, json: async () => ({Status: 3})}))
      .status, "absent");
  assert.equal((await lookup({ok: true, json: async () => ({Status: 0})}))
      .status, "absent");
  assert.equal((await lookup({
    ok: true,
    json: async () => ({Status: 0, Answer: [{type: 1, data: "not-an-ip"}]}),
  })).status, "absent");
  assert.match((await lookup({ok: true, json: async () => {
    throw new SyntaxError("bad JSON");
  }})).errorCode, /SyntaxError/);
  assert.match((await lookup({ok: true}, "TXT")).errorCode, /UNSUPPORTED_TXT/);
});

test("static DNS gate covers every production hostname", () => {
  assert.deepEqual(PRODUCTION_STATIC_HOSTS, [
    "laawoldigital.com",
    "admin.laawoldigital.com",
    "business.laawoldigital.com",
    "customer.laawoldigital.com",
  ]);
});

test("Storage rules Firestore IAM gate requires the cross-service role", () => {
  const rulesSource = `
    service firebase.storage {
      match /b/{bucket}/o {
        allow read: if firestore.exists(
          /databases/(default)/documents/users/$(request.auth.uid)
        );
      }
    }
  `;
  const projectNumber = "577373430777";
  const expectedMember =
    "serviceAccount:service-577373430777" +
    "@gcp-sa-firebasestorage.iam.gserviceaccount.com";

  assert.equal(assessStorageRulesFirestoreIam({
    rulesSource,
    projectNumber,
    iamPolicy: {bindings: []},
  }).ok, false);
  assert.deepEqual(assessStorageRulesFirestoreIam({
    rulesSource,
    projectNumber,
    iamPolicy: {
      bindings: [{
        role: "roles/firebaserules.firestoreServiceAgent",
        members: [expectedMember],
      }],
    },
  }), {
    ok: true,
    detail: "Firebase Storage can evaluate Firestore-backed rules",
  });
});

test("Storage rules IAM gate is not required without Firestore lookups", () => {
  assert.deepEqual(assessStorageRulesFirestoreIam({
    rulesSource: "allow read: if request.auth != null;",
  }), {
    ok: true,
    detail: "Storage rules do not call Firestore",
  });
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
