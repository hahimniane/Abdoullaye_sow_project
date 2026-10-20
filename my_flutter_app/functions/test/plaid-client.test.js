"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");

const {
  ANDROID_PACKAGE_NAME,
  DEFAULT_LINK_CUSTOMIZATION,
  PLAID_IOS_REDIRECT_URI,
  PlaidError,
  bankErrorInfo,
  createPlaidClient,
  linkCustomizationName,
  linkTokenRequest,
  plaidEnvironment,
  plaidWebhookUrl,
  verifyPlaidWebhook,
} = require("../plaid_client");
const {CURRENT_PROJECT_CONFIG, NEW_PROJECT_CONFIG} =
  require("../project_config");

// Both production projects (the old one keeps serving the mobile apps until
// the new app build ships), named through the single-source config.
const OLD_PROJECT = CURRENT_PROJECT_CONFIG.projectId;
const NEW_PROJECT = NEW_PROJECT_CONFIG.projectId;

describe("Plaid errors in words", () => {
  it("maps codes to a status, a reason and a sentence", () => {
    assert.deepEqual(
        pick(bankErrorInfo("ITEM_LOGIN_REQUIRED", "ITEM_ERROR")),
        {httpsCode: "failed-precondition", reason: "login_required",
          needsReauth: true});
    assert.deepEqual(
        pick(bankErrorInfo("INSTITUTION_DOWN", "INSTITUTION_ERROR")),
        {httpsCode: "unavailable", reason: "bank_unavailable",
          needsReauth: false});
    assert.equal(bankErrorInfo("RATE_LIMIT", "RATE_LIMIT_EXCEEDED").httpsCode,
        "resource-exhausted");
    assert.equal(bankErrorInfo("INTERNAL_SERVER_ERROR", "API_ERROR").reason,
        "service_unavailable");
    assert.equal(bankErrorInfo("NETWORK").reason, "service_unavailable");
    assert.equal(bankErrorInfo("PRODUCT_NOT_READY", "ITEM_ERROR").reason,
        "not_ready");
    assert.equal(bankErrorInfo("INVALID_PUBLIC_TOKEN").reason, "link_expired");
    const setup = bankErrorInfo("INVALID_LINK_CUSTOMIZATION");
    assert.equal(setup.reason, "setup");
    // Never Plaid's developer wording.
    assert.doesNotMatch(setup.message, /customization/i);
  });
});

function pick(info) {
  return {httpsCode: info.httpsCode, reason: info.reason,
    needsReauth: info.needsReauth};
}

describe("Link token request", () => {
  it("is named Laawol, asks for transactions and sends the webhook", () => {
    const body = linkTokenRequest({uid: "u1", platform: "web",
      webhookUrl: "https://hook"});
    assert.equal(body.client_name, "Laawol");
    assert.deepEqual(body.products, ["transactions"]);
    assert.deepEqual(body.country_codes, ["US"]);
    assert.equal(body.webhook, "https://hook");
    assert.deepEqual(body.user, {client_user_id: "u1"});
    assert.equal(body.redirect_uri, undefined);
    assert.equal(body.android_package_name, undefined);
    assert.equal(body.access_token, undefined);
  });

  it("sends the iOS redirect or the Android package, never both", () => {
    const ios = linkTokenRequest({uid: "u1", platform: "ios"});
    assert.equal(ios.redirect_uri, PLAID_IOS_REDIRECT_URI);
    assert.equal(ios.android_package_name, undefined);
    const android = linkTokenRequest({uid: "u1", platform: "android"});
    assert.equal(android.android_package_name, ANDROID_PACKAGE_NAME);
    assert.equal(android.redirect_uri, undefined);
  });

  it("uses the app's real Android application id", () => {
    const gradle = fs.readFileSync(path.join(__dirname, "..", "..", "android",
        "app", "build.gradle"), "utf8");
    assert.match(gradle, new RegExp(
        `applicationId "${ANDROID_PACKAGE_NAME.replace(/\./g, "\\.")}"`));
  });

  it("sends no Link customization unless one is named", () => {
    // Production refused "laawol" (INVALID_LINK_CUSTOMIZATION) and a named
    // customization must match the language, so none is the safe default.
    assert.equal(DEFAULT_LINK_CUSTOMIZATION, "");
    const plain = linkTokenRequest({uid: "u1", platform: "web"});
    assert.equal("link_customization_name" in plain, false);
    assert.equal(plain.client_name, "Laawol");
    const french = linkTokenRequest({uid: "u1", platform: "web",
      language: "fr"});
    assert.equal("link_customization_name" in french, false);
    assert.equal(linkTokenRequest({uid: "u1", platform: "ios",
      linkCustomizationName: " dala "}).link_customization_name, "dala");
    // "" (PLAID_LINK_CUSTOMIZATION= in the env) sends none at all.
    const none = linkTokenRequest({uid: "u1", platform: "web",
      linkCustomizationName: ""});
    assert.equal("link_customization_name" in none, false);
    assert.equal(none.client_name, "Laawol");
    // Update mode sends none either.
    assert.equal("link_customization_name" in linkTokenRequest({uid: "u1",
      platform: "android", accessToken: "access-x"}), false);
  });

  it("reads the customization from PLAID_LINK_CUSTOMIZATION", () => {
    assert.equal(linkCustomizationName({}), "");
    assert.equal(linkCustomizationName({PLAID_LINK_CUSTOMIZATION: "x"}), "x");
    assert.equal(linkCustomizationName({PLAID_LINK_CUSTOMIZATION: " "}), "");
    assert.equal(linkCustomizationName({PLAID_LINK_CUSTOMIZATION: ""}), "");
  });

  it("repairs an expired login in update mode, without products", () => {
    const body = linkTokenRequest({uid: "u1", platform: "web",
      accessToken: "access-x"});
    assert.equal(body.access_token, "access-x");
    assert.equal(body.products, undefined);
  });
});

describe("Plaid environment and webhook URL", () => {
  it("is sandbox unless production is spelled out", () => {
    assert.equal(plaidEnvironment({}), "sandbox");
    assert.equal(plaidEnvironment({PLAID_ENV: "production"}), "production");
    assert.equal(plaidEnvironment({PLAID_ENV: "production",
      GCLOUD_PROJECT: OLD_PROJECT}), "production");
    assert.equal(plaidEnvironment({PLAID_ENV: "prod"}), "sandbox");
  });

  it("is always sandbox in an emulator or a test run", () => {
    const prod = {PLAID_ENV: "production",
      GCLOUD_PROJECT: OLD_PROJECT};
    assert.equal(plaidEnvironment({...prod, FUNCTIONS_EMULATOR: "true"}),
        "sandbox");
    assert.equal(plaidEnvironment({...prod,
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080"}), "sandbox");
    assert.equal(plaidEnvironment({...prod,
      FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099"}), "sandbox");
    assert.equal(plaidEnvironment({PLAID_ENV: "production",
      GCLOUD_PROJECT: "demo-laawol-bank"}), "sandbox");
  });

  it("production is configured for the production project only", () => {
    const dir = path.join(__dirname, "..");
    const read = (name) => {
      const out = {};
      for (const line of fs.readFileSync(path.join(dir, name), "utf8")
          .split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (m) out[m[1]] = m[2];
      }
      return out;
    };
    // Both production projects: a project without its env file would
    // silently fall back to sandbox and fail every Check bank.
    for (const projectId of [OLD_PROJECT, NEW_PROJECT]) {
      const prod = read(`.env.${projectId}`);
      assert.equal(prod.PLAID_ENV, "production", projectId);
      // No customization in production (see DEFAULT_LINK_CUSTOMIZATION).
      assert.equal("PLAID_LINK_CUSTOMIZATION" in prod, false, projectId);
      // Secrets stay in Secret Manager, never in a committed file.
      for (const key of ["PLAID_CLIENT_ID", "PLAID_SECRET", "BANK_TOKEN_KEY"]) {
        assert.equal(key in prod, false, `${key} is not in .env.${projectId}`);
      }
    }
    // No env file every project (and the emulators) would load says
    // production.
    for (const name of [".env", ".env.local", ".env.example"]) {
      if (!fs.existsSync(path.join(dir, name))) continue;
      assert.notEqual(read(name).PLAID_ENV, "production", name);
    }
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith(".env.demo-")) continue;
      assert.notEqual(read(name).PLAID_ENV, "production", name);
    }
  });

  it("derives the webhook from the running project", () => {
    assert.equal(plaidWebhookUrl({GCLOUD_PROJECT: NEW_PROJECT}),
        `https://us-central1-${NEW_PROJECT}.cloudfunctions.net/plaidWebhook`);
    assert.equal(plaidWebhookUrl({FIREBASE_CONFIG:
      JSON.stringify({projectId: OLD_PROJECT})}),
    `https://us-central1-${OLD_PROJECT}.cloudfunctions.net/plaidWebhook`);
    assert.equal(plaidWebhookUrl({PLAID_WEBHOOK_URL: "https://x/y",
      GCLOUD_PROJECT: "p"}), "https://x/y");
    assert.equal(plaidWebhookUrl({}), "");
  });

  it("is never hardcoded in the callables", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "index.js"),
        "utf8");
    assert.doesNotMatch(source, /cloudfunctions\.net\/plaidWebhook/);
  });
});

describe("Plaid fetch client", () => {
  it("posts credentials with the body and returns the JSON", async () => {
    const calls = [];
    const plaid = createPlaidClient({clientId: "cid", secret: "sec",
      environment: "sandbox", fetchImpl: async (url, init) => {
        calls.push({url, body: JSON.parse(init.body)});
        return new Response(JSON.stringify({removed: true}), {status: 200});
      }});
    assert.deepEqual(await plaid.removeItem("access-1"), {removed: true});
    assert.equal(calls[0].url, "https://sandbox.plaid.com/item/remove");
    assert.deepEqual(calls[0].body, {client_id: "cid", secret: "sec",
      access_token: "access-1"});
  });

  it("turns a Plaid refusal into a PlaidError with its code", async () => {
    const plaid = createPlaidClient({clientId: "cid", secret: "sec",
      environment: "production", fetchImpl: async () => new Response(
          JSON.stringify({error_code: "ITEM_LOGIN_REQUIRED",
            error_type: "ITEM_ERROR", error_message: "login",
            request_id: "r1"}), {status: 400})});
    await assert.rejects(plaid.refreshTransactions("a"), (error) =>
      error instanceof PlaidError && error.code === "ITEM_LOGIN_REQUIRED" &&
      error.type === "ITEM_ERROR" && error.requestId === "r1");
  });

  it("reports a network failure and missing credentials", async () => {
    const down = createPlaidClient({clientId: "cid", secret: "sec",
      fetchImpl: async () => {
        throw new Error("ECONNRESET");
      }});
    await assert.rejects(down.removeItem("a"),
        (error) => error.code === "NETWORK");
    const unset = createPlaidClient({clientId: "unset", secret: "unset",
      fetchImpl: async () => assert.fail("must not call Plaid")});
    await assert.rejects(unset.removeItem("a"),
        (error) => error.code === "NOT_CONFIGURED");
  });

  it("asks for at most 250 rows a page from the saved cursor", async () => {
    let body;
    const plaid = createPlaidClient({clientId: "c", secret: "s",
      fetchImpl: async (url, init) => {
        body = JSON.parse(init.body);
        return new Response("{}", {status: 200});
      }});
    await plaid.syncTransactions("a", "cur-1");
    assert.equal(body.count, 250);
    assert.equal(body.cursor, "cur-1");
    await plaid.syncTransactions("a", "");
    assert.equal(body.cursor, undefined);
  });
});

// Ported from Wouri's associationsBank.test.ts ("Plaid webhook verification").
describe("Plaid webhook verification", () => {
  const {privateKey, publicKey} = crypto.generateKeyPairSync("ec",
      {namedCurve: "P-256"});
  const jwk = publicKey.export({format: "jwk"});
  const key = {...jwk, kid: "kid-1", alg: "ES256", use: "sig",
    expired_at: null};
  const fetchKey = async (kid) => kid === "kid-1" ? key : null;
  const now = Date.parse("2026-10-03T12:00:00Z");
  const body = "{\n  \"webhook_type\": \"TRANSACTIONS\",\n" +
    "  \"item_id\": \"abc\"\n}";
  const b64 = (value) => Buffer.from(JSON.stringify(value))
      .toString("base64url");
  const makeJwt = (over = {}) => {
    const header = b64({alg: over.alg || "ES256", kid: over.kid || "kid-1",
      typ: "JWT"});
    const payload = b64({
      iat: over.iat ?? Math.floor(now / 1000) - 10,
      request_body_sha256: over.bodyHash ||
        crypto.createHash("sha256").update(body).digest("hex"),
    });
    const signature = crypto.sign("sha256",
        Buffer.from(`${header}.${payload}`),
        {key: privateKey, dsaEncoding: "ieee-p1363"});
    if (over.tamper) signature[0] ^= 0xff;
    return `${header}.${payload}.${signature.toString("base64url")}`;
  };

  it("accepts a webhook Plaid signed", async () => {
    assert.deepEqual(await verifyPlaidWebhook({jwt: makeJwt(),
      rawBody: Buffer.from(body), fetchKey, nowMs: now}),
    {ok: true, kid: "kid-1"});
  });

  it("rejects a bad signature", async () => {
    assert.deepEqual(await verifyPlaidWebhook({jwt: makeJwt({tamper: true}),
      rawBody: body, fetchKey, nowMs: now}),
    {ok: false, reason: "bad signature"});
  });

  it("rejects a webhook older than five minutes, or from the future",
      async () => {
        assert.deepEqual(await verifyPlaidWebhook({
          jwt: makeJwt({iat: Math.floor(now / 1000) - 301}), rawBody: body,
          fetchKey, nowMs: now}), {ok: false, reason: "JWT too old"});
        assert.deepEqual(await verifyPlaidWebhook({
          jwt: makeJwt({iat: Math.floor(now / 1000) + 301}), rawBody: body,
          fetchKey, nowMs: now}),
        {ok: false, reason: "JWT issued in the future"});
      });

  it("rejects a body that is not the one signed", async () => {
    assert.deepEqual(await verifyPlaidWebhook({jwt: makeJwt(),
      rawBody: body.replace("abc", "xyz"), fetchKey, nowMs: now}),
    {ok: false, reason: "body hash mismatch"});
  });

  it("rejects any algorithm but ES256, before fetching a key", async () => {
    let fetched = 0;
    const verdict = await verifyPlaidWebhook({jwt: makeJwt({alg: "HS256"}),
      rawBody: body, fetchKey: async (kid) => {
        fetched += 1;
        return fetchKey(kid);
      }, nowMs: now});
    assert.equal(verdict.ok, false);
    assert.equal(fetched, 0);
  });

  it("rejects an unknown or retired key and a missing header", async () => {
    assert.equal((await verifyPlaidWebhook({jwt: makeJwt({kid: "other"}),
      rawBody: body, fetchKey, nowMs: now})).ok, false);
    assert.equal((await verifyPlaidWebhook({jwt: makeJwt(), rawBody: body,
      fetchKey: async () => ({...key, expired_at: 1}), nowMs: now})).ok,
    false);
    assert.equal((await verifyPlaidWebhook({jwt: undefined, rawBody: body,
      fetchKey, nowMs: now})).ok, false);
    assert.equal((await verifyPlaidWebhook({jwt: "a.b", rawBody: body,
      fetchKey, nowMs: now})).ok, false);
  });

  it("caches a key Plaid gave, and refetches a retired one", async () => {
    let calls = 0;
    const plaid = createPlaidClient({clientId: "c", secret: "s",
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify({key}), {status: 200});
      }});
    assert.deepEqual(await plaid.getWebhookVerificationKey("kid-1"), key);
    await plaid.getWebhookVerificationKey("kid-1");
    assert.equal(calls, 1);
    const unknown = createPlaidClient({clientId: "c", secret: "s",
      fetchImpl: async () => new Response(JSON.stringify(
          {error_code: "INVALID_INPUT"}), {status: 400})});
    assert.equal(await unknown.getWebhookVerificationKey("nope"), null);
  });
});
