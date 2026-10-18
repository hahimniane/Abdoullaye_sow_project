"use strict";

/**
 * The business's own bank account, read-only, through Plaid.
 *
 * Ported from Wouri (functions/src/services/plaid.ts). A thin fetch client
 * rather than Plaid's SDK: a handful of endpoints, nothing that can move
 * money, and no large dependency on a cold-starting function. Plaid is only
 * ever asked what already happened.
 *
 * Everything here is pure or takes its fetch as an argument, so the tests and
 * the emulator suite fake Plaid at the fetch boundary.
 */

const crypto = require("crypto");

/** Link shows this name to the owner. Also set in the Plaid dashboard. */
const LINK_CLIENT_NAME = "Laawol";
/**
 * The Link customization (Plaid dashboard -> Link -> Customization) every
 * Link token names: the team is shared with the sister apps, so Laawol's own
 * look is picked by name. PLAID_LINK_CUSTOMIZATION overrides it; an empty
 * value sends none (Plaid's default customization).
 */
const DEFAULT_LINK_CUSTOMIZATION = "laawol";
/**
 * Registered in the Plaid dashboard (Allowed redirect URIs) and covered by the
 * apple-app-site-association file, so a bank's OAuth page hands the owner
 * back to the app. See docs/ZELLE_BANK_CHECK.md (TODO: AASA not set up yet).
 */
const PLAID_IOS_REDIRECT_URI = "https://customer.laawoldigital.com/plaid/oauth";
/** android/app/build.gradle applicationId; Allowed Android package names. */
const ANDROID_PACKAGE_NAME = "com.laawoldigital.app";
const LINK_PLATFORMS = ["ios", "android", "web"];
const PLAID_PRODUCTS = ["transactions"];
/** Days of history asked for at connect: enough, and a small first sync. */
const TRANSACTIONS_DAYS_REQUESTED = 30;
const PLAID_TIMEOUT_MS = 15 * 1000;
const SYNC_PAGE_SIZE = 250;
const PLAID_REGION = "us-central1";

/**
 * True when this process is an emulator or a test run: the Functions
 * emulator, any Firebase emulator host, or a demo-* project (what every
 * emulator suite here runs as).
 *
 * @param {object} env process.env.
 * @return {boolean} Whether this is not a deployed function.
 */
function runsAgainstEmulators(env = process.env) {
  if (String(env.FUNCTIONS_EMULATOR || "").trim() === "true") return true;
  if (env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST ||
      env.FIREBASE_STORAGE_EMULATOR_HOST) {
    return true;
  }
  const projectId = String(env.GCLOUD_PROJECT || env.GCP_PROJECT || "")
      .trim();
  return projectId.startsWith("demo-");
}

/**
 * "sandbox" or "production" (PLAID_ENV, set per project in
 * functions/.env.<project id>). Anything else reads as sandbox, so a typo
 * can only ever reach Plaid's fake banks - and an emulator or a test run is
 * always sandbox, whatever its environment says, so no local run can read a
 * real bank or be billed.
 *
 * @param {object} env process.env.
 * @return {string} The environment.
 */
function plaidEnvironment(env = process.env) {
  if (String(env.PLAID_ENV || "").trim() !== "production") return "sandbox";
  return runsAgainstEmulators(env) ? "sandbox" : "production";
}

/**
 * @param {object} env process.env.
 * @return {string} The Link customization name to send ("" sends none).
 */
function linkCustomizationName(env = process.env) {
  const value = env.PLAID_LINK_CUSTOMIZATION;
  if (value === undefined || value === null) return DEFAULT_LINK_CUSTOMIZATION;
  return String(value).trim();
}

/**
 * @param {string} environment From plaidEnvironment.
 * @return {string} Plaid's API host.
 */
function plaidBaseUrl(environment) {
  return environment === "production" ?
    "https://production.plaid.com" : "https://sandbox.plaid.com";
}

/**
 * Where Plaid sends its webhooks: this project's plaidWebhook function.
 * Derived from the running project, never hardcoded, so a project migration
 * moves the webhook with it. PLAID_WEBHOOK_URL overrides it (a custom domain).
 *
 * @param {object} env process.env.
 * @return {string} The URL, "" when the project id cannot be found.
 */
function plaidWebhookUrl(env = process.env) {
  const override = String(env.PLAID_WEBHOOK_URL || "").trim();
  if (override) return override;
  let projectId = String(env.GCLOUD_PROJECT || env.GCP_PROJECT || "").trim();
  if (!projectId && env.FIREBASE_CONFIG) {
    try {
      projectId = String(JSON.parse(env.FIREBASE_CONFIG).projectId || "");
    } catch (_) {
      projectId = "";
    }
  }
  if (!projectId) return "";
  return `https://${PLAID_REGION}-${projectId}.cloudfunctions.net/plaidWebhook`;
}

/**
 * An error Plaid answered with. Its message is written for a developer and
 * can name the bank: it goes to the log, never to a screen.
 */
class PlaidError extends Error {
  /**
   * @param {string} code Plaid's error_code.
   * @param {string} message Plaid's error_message.
   * @param {string} type Plaid's error_type.
   * @param {string} requestId Plaid's request_id.
   */
  constructor(code, message, type, requestId) {
    super(message);
    this.name = "PlaidError";
    this.code = code;
    this.type = type || "";
    this.requestId = requestId || "";
  }
}

/** Plaid codes that mean the owner must sign in to the bank again. */
const REAUTH_CODES = new Set([
  "ITEM_LOGIN_REQUIRED",
  "PENDING_EXPIRATION",
  "PENDING_DISCONNECT",
  "ITEM_LOCKED",
  "INVALID_CREDENTIALS",
  "INVALID_MFA",
  "INVALID_UPDATED_USERNAME",
  "USER_SETUP_REQUIRED",
  "USER_PERMISSION_REVOKED",
  "USER_ACCOUNT_REVOKED",
  "ACCESS_NOT_GRANTED",
  "NO_ACCOUNTS",
  "ITEM_NOT_SUPPORTED",
  "MFA_NOT_SUPPORTED",
]);

/** Plaid's "the feed changed while you were paging it: start again". */
const MUTATION_DURING_PAGINATION =
  "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION";

/**
 * What a Plaid error means for the person holding the phone. Pure.
 *
 * @param {string} code Plaid's error_code ("NETWORK" when fetch failed).
 * @param {string} type Plaid's error_type.
 * @return {object} {httpsCode, reason, message, needsReauth}.
 */
function bankErrorInfo(code, type) {
  const c = String(code || "").toUpperCase();
  const t = String(type || "").toUpperCase();
  if (REAUTH_CODES.has(c)) {
    return {httpsCode: "failed-precondition", reason: "login_required",
      message: "The bank needs the owner to sign in to it again.",
      needsReauth: true};
  }
  if (c === "INVALID_PUBLIC_TOKEN" || c === "INVALID_LINK_TOKEN") {
    return {httpsCode: "failed-precondition", reason: "link_expired",
      message: "That bank sign-in expired. Connect the bank again.",
      needsReauth: false};
  }
  if (c === "PRODUCT_NOT_READY") {
    return {httpsCode: "unavailable", reason: "not_ready",
      message: "The bank is still preparing the account history. " +
        "Try again in a few minutes.",
      needsReauth: false};
  }
  if (t === "RATE_LIMIT_EXCEEDED" || c.includes("RATE_LIMIT") ||
      c.endsWith("_LIMIT")) {
    return {httpsCode: "resource-exhausted", reason: "rate_limited",
      message: "The bank has been asked too often. " +
        "Try again in a little while.",
      needsReauth: false};
  }
  if (t === "INSTITUTION_ERROR" || c.startsWith("INSTITUTION_")) {
    return {httpsCode: "unavailable", reason: "bank_unavailable",
      message: "The bank is not answering right now. Try again later.",
      needsReauth: false};
  }
  if (t === "API_ERROR" || c === "INTERNAL_SERVER_ERROR" ||
      c === "PLANNED_MAINTENANCE" || c === "NETWORK") {
    return {httpsCode: "unavailable", reason: "service_unavailable",
      message: "The bank connection service is not answering right now. " +
        "Try again later.",
      needsReauth: false};
  }
  return {httpsCode: "failed-precondition", reason: "setup",
    message: "Bank connections are not working right now. Try again later.",
    needsReauth: false};
}

/**
 * The /link/token/create body. Pure.
 *
 * Big banks sign in through OAuth, which only comes back to the app if Plaid
 * knows how: the universal link on iOS, the package name on Android, and a
 * popup on the web (neither field). Plaid says never to send both. Update
 * mode (an expired login) passes the access token and no products.
 *
 * The customization is `input.linkCustomizationName` when given ("" sends
 * none), else DEFAULT_LINK_CUSTOMIZATION.
 *
 * @param {object} input {uid, platform, webhookUrl, accessToken?, language?,
 *   linkCustomizationName?}.
 * @return {object} The request body, without client id and secret.
 */
function linkTokenRequest(input) {
  const body = {
    user: {client_user_id: String(input.uid || "")},
    client_name: LINK_CLIENT_NAME,
    language: input.language === "fr" ? "fr" : "en",
    country_codes: ["US"],
  };
  const customization = input.linkCustomizationName === undefined ||
    input.linkCustomizationName === null ? DEFAULT_LINK_CUSTOMIZATION :
    String(input.linkCustomizationName).trim();
  if (customization) body.link_customization_name = customization;
  if (input.webhookUrl) body.webhook = input.webhookUrl;
  if (input.platform === "ios") body.redirect_uri = PLAID_IOS_REDIRECT_URI;
  if (input.platform === "android") {
    body.android_package_name = ANDROID_PACKAGE_NAME;
  }
  if (input.accessToken) {
    body.access_token = input.accessToken;
  } else {
    body.products = [...PLAID_PRODUCTS];
    body.transactions = {days_requested: TRANSACTIONS_DAYS_REQUESTED};
  }
  return body;
}

/**
 * A Plaid client bound to one set of credentials.
 *
 * @param {object} options {clientId, secret, environment, fetchImpl,
 *   timeoutMs}.
 * @return {object} The endpoints this feature uses.
 */
function createPlaidClient(options) {
  const clientId = String(options.clientId || "").trim();
  const secret = String(options.secret || "").trim();
  const base = plaidBaseUrl(options.environment || "sandbox");
  const fetchImpl = options.fetchImpl || ((...args) => fetch(...args));
  const timeoutMs = options.timeoutMs || PLAID_TIMEOUT_MS;

  const call = async (endpoint, body) => {
    if (!clientId || !secret || clientId === "unset" || secret === "unset") {
      throw new PlaidError("NOT_CONFIGURED", "Plaid is not configured",
          "SETUP");
    }
    let response;
    try {
      response = await fetchImpl(`${base}${endpoint}`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({client_id: clientId, secret, ...body}),
        signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ?
          AbortSignal.timeout(timeoutMs) : undefined,
      });
    } catch (error) {
      throw new PlaidError("NETWORK", String(error?.message || error),
          "NETWORK");
    }
    let json = {};
    try {
      json = await response.json();
    } catch (_) {
      json = {};
    }
    if (!response.ok) {
      throw new PlaidError(String(json.error_code || "PLAID_ERROR"),
          String(json.error_message || "Plaid request failed"),
          json.error_type ? String(json.error_type) : "",
          json.request_id ? String(json.request_id) : "");
    }
    return json;
  };

  const keyCache = new Map();

  return {
    call,
    createLinkToken: (input) =>
      call("/link/token/create", linkTokenRequest(input)),
    exchangePublicToken: (publicToken) =>
      call("/item/public_token/exchange", {public_token: publicToken}),
    getAccounts: (accessToken) =>
      call("/accounts/get", {access_token: accessToken}),
    getInstitution: (institutionId) =>
      call("/institutions/get_by_id", {institution_id: institutionId,
        country_codes: ["US"]}),
    syncTransactions: (accessToken, cursor) =>
      call("/transactions/sync", {access_token: accessToken,
        ...(cursor ? {cursor} : {}), count: SYNC_PAGE_SIZE}),
    // Billed per call: only ever when a person presses "Check Zelle".
    refreshTransactions: (accessToken) =>
      call("/transactions/refresh", {access_token: accessToken}),
    removeItem: (accessToken) =>
      call("/item/remove", {access_token: accessToken}),
    /**
     * Plaid's public key for a webhook `kid`, cached per instance. A cached
     * key Plaid has since retired is fetched again so the expiry is seen.
     *
     * @param {string} kid The key id from the JWT header.
     * @return {Promise<?object>} The JWK, or null when Plaid has none.
     */
    getWebhookVerificationKey: async (kid) => {
      const cached = keyCache.get(kid);
      if (cached && !cached.expired_at) return cached;
      try {
        const {key} = await call("/webhook_verification_key/get",
            {key_id: kid});
        if (!key) return null;
        keyCache.set(kid, key);
        return key;
      } catch (error) {
        if (error instanceof PlaidError) return null;
        throw error;
      }
    },
  };
}

/** How old a webhook may be before it is treated as a replay. */
const WEBHOOK_MAX_AGE_SECONDS = 5 * 60;

/**
 * @param {string} part A base64url JWT segment.
 * @return {?object} Its JSON, or null.
 */
function base64UrlJson(part) {
  try {
    const parsed = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (_) {
    return null;
  }
}

/**
 * Checks the Plaid-Verification header on a webhook (Plaid's recipe, ported
 * from Wouri): the JWT must be ES256, signed by the key its `kid` names,
 * issued within the last five minutes, and carry the SHA-256 of the exact
 * body that arrived. Pure apart from the key fetcher it is handed.
 *
 * @param {object} input {jwt, rawBody, fetchKey(kid), nowMs}.
 * @return {Promise<object>} {ok: true, kid} or {ok: false, reason}.
 */
async function verifyPlaidWebhook(input) {
  const jwt = String(input.jwt || "").trim();
  if (!jwt) return {ok: false, reason: "missing Plaid-Verification header"};
  const parts = jwt.split(".");
  if (parts.length !== 3) return {ok: false, reason: "malformed JWT"};
  const [headerPart, payloadPart, signaturePart] = parts;

  const header = base64UrlJson(headerPart);
  if (!header) return {ok: false, reason: "unreadable JWT header"};
  // Checked before anything else: "none" or an HMAC algorithm is an attack.
  if (header.alg !== "ES256") {
    return {ok: false, reason: `unexpected alg ${String(header.alg)}`};
  }
  const kid = typeof header.kid === "string" ? header.kid : "";
  if (!kid) return {ok: false, reason: "JWT has no kid"};

  let key;
  try {
    key = await input.fetchKey(kid);
  } catch (error) {
    return {ok: false, reason: `key fetch failed: ${error?.message}`};
  }
  if (!key) return {ok: false, reason: "unknown key"};
  if (key.expired_at) return {ok: false, reason: "key expired"};

  let valid = false;
  try {
    const publicKey = crypto.createPublicKey({
      key: {kty: key.kty, crv: key.crv, x: key.x, y: key.y},
      format: "jwk",
    });
    valid = crypto.verify("sha256",
        Buffer.from(`${headerPart}.${payloadPart}`),
        {key: publicKey, dsaEncoding: "ieee-p1363"},
        Buffer.from(signaturePart, "base64url"));
  } catch (_) {
    valid = false;
  }
  if (!valid) return {ok: false, reason: "bad signature"};

  const payload = base64UrlJson(payloadPart);
  if (!payload) return {ok: false, reason: "unreadable JWT payload"};
  const iat = Number(payload.iat);
  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (!Number.isFinite(iat)) return {ok: false, reason: "JWT has no iat"};
  if (nowSeconds - iat > WEBHOOK_MAX_AGE_SECONDS) {
    return {ok: false, reason: "JWT too old"};
  }
  if (iat - nowSeconds > WEBHOOK_MAX_AGE_SECONDS) {
    return {ok: false, reason: "JWT issued in the future"};
  }

  const claimed = typeof payload.request_body_sha256 === "string" ?
    payload.request_body_sha256 : "";
  const body = input.rawBody ?? "";
  const actual = crypto.createHash("sha256")
      .update(typeof body === "string" ? Buffer.from(body, "utf8") : body)
      .digest("hex");
  const left = Buffer.from(actual, "utf8");
  const right = Buffer.from(claimed.toLowerCase(), "utf8");
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    return {ok: false, reason: "body hash mismatch"};
  }
  return {ok: true, kid};
}

module.exports = {
  ANDROID_PACKAGE_NAME,
  DEFAULT_LINK_CUSTOMIZATION,
  LINK_CLIENT_NAME,
  LINK_PLATFORMS,
  MUTATION_DURING_PAGINATION,
  PLAID_IOS_REDIRECT_URI,
  PLAID_PRODUCTS,
  PlaidError,
  REAUTH_CODES,
  SYNC_PAGE_SIZE,
  WEBHOOK_MAX_AGE_SECONDS,
  bankErrorInfo,
  createPlaidClient,
  linkCustomizationName,
  linkTokenRequest,
  plaidBaseUrl,
  plaidEnvironment,
  plaidWebhookUrl,
  runsAgainstEmulators,
  verifyPlaidWebhook,
};
