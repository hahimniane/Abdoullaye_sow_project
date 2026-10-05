const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");

const {
  appCheckTokenFromHeaders,
  clientAddressFromRequest,
  rateLimitIdentity,
  trustedProxyHops,
} = require("../request_guard");

const functionsRoot = path.join(__dirname, "..");
const appRoot = path.join(functionsRoot, "..");
const repoRoot = path.join(appRoot, "..");
const read = (...parts) => fs.readFileSync(path.join(...parts), "utf8");

const indexSource = read(functionsRoot, "index.js");

function exportedSource(name) {
  const start = indexSource.indexOf(`exports.${name} =`);
  assert.ok(start >= 0, `missing export ${name}`);
  const next = indexSource.indexOf("\nexports.", start + 1);
  return indexSource.slice(start, next < 0 ? indexSource.length : next);
}

describe("migrateDefaultBusiness is gone", () => {
  // It reassigned every staff and owner account on the platform to Keren.
  it("is not exported or called by any client", () => {
    assert.doesNotMatch(indexSource, /migrateDefaultBusiness/);
    assert.doesNotMatch(
        read(repoRoot, "admin_web", "src", "components", "admin-console.tsx"),
        /migrateDefaultBusiness|Migrate default business data/,
    );
    assert.doesNotMatch(
        read(appRoot, "lib", "screens", "business_management_screen.dart"),
        /migrateDefaultBusiness|migrateKerenData|_runMigration/,
    );
    for (const arb of ["app_en.arb", "app_fr.arb"]) {
      const keys = Object.keys(JSON.parse(read(appRoot, "lib", "l10n", arb)));
      for (const key of [
        "migrateKerenData",
        "migrationComplete",
        "migrationFailed",
      ]) {
        assert.ok(!keys.includes(key), `${arb} still has ${key}`);
      }
    }
  });
});

describe("client address behind Google's front end", () => {
  const req = (xff, extra = {}) => ({
    headers: xff === undefined ? {} : {"x-forwarded-for": xff},
    ...extra,
  });

  it("takes the entry Google appended, not the caller's", () => {
    // A caller can send any X-Forwarded-For it likes; GFE appends the real
    // address last. Reading entry [0] gave a fresh bucket per request.
    assert.equal(
        clientAddressFromRequest(req("1.1.1.1, 203.0.113.7"), {trustedHops: 1}),
        "203.0.113.7",
    );
    assert.equal(
        clientAddressFromRequest(req("203.0.113.7"), {trustedHops: 1}),
        "203.0.113.7",
    );
    assert.equal(
        clientAddressFromRequest(
            req("9.9.9.9,8.8.8.8, 2001:DB8::5"), {trustedHops: 1}),
        "2001:db8::5",
    );
  });

  it("skips one more Google hop when a load balancer sits in front", () => {
    assert.equal(
        clientAddressFromRequest(
            req("6.6.6.6, 203.0.113.7, 34.120.0.1"), {trustedHops: 2}),
        "203.0.113.7",
    );
    assert.equal(trustedProxyHops({TRUSTED_PROXY_HOPS: "2"}), 2);
    assert.equal(trustedProxyHops({}), 1);
    assert.equal(trustedProxyHops({TRUSTED_PROXY_HOPS: "nope"}), 1);
    assert.equal(trustedProxyHops({TRUSTED_PROXY_HOPS: "0"}), 1);
  });

  it("falls back to the socket, never to a spoofable request.ip", () => {
    assert.equal(
        clientAddressFromRequest(req(undefined, {
          socket: {remoteAddress: "::ffff:198.51.100.4"},
          ip: "1.2.3.4",
        }), {trustedHops: 1}),
        "198.51.100.4",
    );
    assert.equal(
        clientAddressFromRequest(req("not-an-ip"), {trustedHops: 1}),
        "unknown",
    );
    assert.equal(clientAddressFromRequest(undefined), "unknown");
  });

  it("keys anonymous sessions on the address, accounts on the uid", () => {
    assert.equal(rateLimitIdentity({uid: "u1"}, false, "203.0.113.7"), "u1");
    assert.equal(
        rateLimitIdentity({uid: "anon-1"}, true, "203.0.113.7"),
        "203.0.113.7",
    );
    assert.equal(
        rateLimitIdentity({uid: "anon-2"}, true, "203.0.113.7"),
        rateLimitIdentity({uid: "anon-3"}, true, "203.0.113.7"),
    );
    assert.equal(rateLimitIdentity(null, false, "203.0.113.7"), "203.0.113.7");
  });

  it("is what the callable rate limiter uses", () => {
    assert.doesNotMatch(
        indexSource,
        /x-forwarded-for"\]\s*\|\|\s*""\)\s*\n?\s*\.split\(","\)\[0\]/,
    );
    assert.match(
        indexSource,
        // eslint-disable-next-line max-len
        /function callableClientAddress\(request\) \{\s*return clientAddressFromRequest\(request\.rawRequest\);/,
    );
    const limiter = indexSource.slice(
        indexSource.indexOf("async function enforceCallableRateLimit"),
        indexSource.indexOf("async function enforceGuestBookingRateLimit"),
    );
    assert.match(limiter, /rateLimitIdentity\(/);
    assert.match(limiter, /isAnonymousCaller\(request\.auth\)/);
    assert.doesNotMatch(limiter, /request\.auth\?\.uid \|\|/);
  });
});

describe("assistantChat requires App Check and is rate limited", () => {
  const source = exportedSource("assistantChat");

  it("verifies the X-Firebase-AppCheck token under ENFORCE_APP_CHECK", () => {
    assert.match(source, /if \(ENFORCE_APP_CHECK\)/);
    assert.match(source, /appCheckTokenFromHeaders\(req\.headers\)/);
    assert.match(source, /admin\.appCheck\(\)\.verifyToken\(appCheckToken\)/);
    assert.match(source, /status\(401\)/);
    // eslint-disable-next-line max-len
    assert.match(source, /Access-Control-Allow-Headers",\s*"Content-Type, X-Firebase-AppCheck"/);
    // Verification must happen before any paid model call.
    assert.ok(
        source.indexOf("verifyToken") < source.indexOf("api.deepseek.com"),
    );
  });

  it("limits each client address before calling a model", () => {
    assert.match(
        source,
        /enforceRateLimitForIdentity\(clientAddressFromRequest\(req\)/,
    );
    assert.match(source, /status\(429\)/);
    assert.ok(
        source.indexOf("enforceRateLimitForIdentity") <
          source.indexOf("api.deepseek.com"),
    );
  });

  it("reads the token header case-insensitively and bounds it", () => {
    assert.equal(appCheckTokenFromHeaders({"x-firebase-appcheck": " t.k.n "}),
        "t.k.n");
    assert.equal(appCheckTokenFromHeaders({}), "");
    assert.equal(
        appCheckTokenFromHeaders({"x-firebase-appcheck": "x".repeat(5000)}),
        "",
    );
  });

  it("is called by the marketing widget with an App Check token", () => {
    const chat = read(repoRoot, "public_site", "assets", "chat.js");
    const partner = read(repoRoot, "public_site", "partner.html");
    assert.match(chat, /cloudfunctions\.net\/assistantChat/);
    assert.match(chat, /"X-Firebase-AppCheck"/);
    assert.match(chat, /ReCaptchaEnterpriseProvider\(APP_CHECK_SITE_KEY\)/);
    const siteKey = chat.match(/APP_CHECK_SITE_KEY = "([^"]+)"/)[1];
    assert.ok(partner.includes(`ReCaptchaEnterpriseProvider("${siteKey}")`),
        "chat.js must use the site key already registered for this domain");
    // Same SDK version as partner.html, so both share one App Check instance.
    const sdk = chat.match(/firebasejs\/([0-9.]+)\//)[1];
    assert.ok(partner.includes(`firebasejs/${sdk}/firebase-app-check.js`));
  });
});

describe("flagged review moderation query has its index", () => {
  it("declares a COLLECTION_GROUP override for reviews.moderationStatus",
      () => {
        const consoleSource = read(
            repoRoot, "admin_web", "src", "components", "admin-console.tsx");
        // The admin reads flagged reviews through the paged hook: the
        // reviews collection group, filtered to flagged, newest first.
        assert.match(consoleSource,
            /\["moderationStatus", "==", "flagged"\]/);
        assert.match(consoleSource,
            // eslint-disable-next-line max-len
            /source: \{ group: "reviews" \},\s*filters: FLAGGED_REVIEW_FILTERS,\s*orderBy: \{ field: "createdAt", direction: "desc" \}/);
        const indexes = JSON.parse(read(appRoot, "firestore.indexes.json"));
        // Ordered and paged, it needs the composite group index too.
        assert.ok(indexes.indexes.some((index) =>
          index.collectionGroup === "reviews" &&
          index.queryScope === "COLLECTION_GROUP" &&
          index.fields.length === 2 &&
          index.fields[0].fieldPath === "moderationStatus" &&
          index.fields[1].fieldPath === "createdAt" &&
          index.fields[1].order === "DESCENDING"),
        "missing reviews (moderationStatus, createdAt desc) group index");
        const override = indexes.fieldOverrides.find((entry) =>
          entry.collectionGroup === "reviews" &&
          entry.fieldPath === "moderationStatus");
        assert.ok(override, "missing reviews.moderationStatus override");
        assert.ok(override.indexes.some((index) =>
          index.queryScope === "COLLECTION_GROUP" &&
          index.order === "ASCENDING"));
        // Overriding a field replaces its automatic indexes; keep the
        // collection-scoped ones so existing per-business queries still work.
        assert.ok(override.indexes.some((index) =>
          index.queryScope === "COLLECTION" && index.order === "ASCENDING"));
      });
});

describe("the app finalizes purchases through the callable", () => {
  it("never writes purchaseStatus directly", () => {
    const screen = read(
        appRoot, "lib", "screens", "staff_purchase_management_screen.dart");
    assert.doesNotMatch(screen, /'purchaseStatus':/);
    assert.match(screen, /'businessFinalizeCarPurchase'/);
    assert.doesNotMatch(screen, /onStatus\('refunded'\)/);
  });
});
