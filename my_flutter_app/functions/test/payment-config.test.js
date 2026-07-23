const assert = require("node:assert/strict");
const {execFileSync} = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");
const {
  buildStripeAccountBusinessUpdate,
  stripeRequirementsUpdate,
} = require("../stripe_connect_status");

const STRIPE_CALLABLES = [
  "createBarrelPool",
  "requestJoinBarrelPool",
  "completeBarrelPoolDepositPayment",
  "cancelPendingBarrelPoolDeposit",
  "createBarrelPoolBalancePaymentIntent",
  "completeBarrelPoolBalancePayment",
  "createBarrelShipmentPaymentIntent",
  "createBarrelOrderPaymentIntent",
  "completeBarrelShipmentPayment",
  "completeBarrelOrderPayment",
  "cancelPendingBarrelShipment",
  "cancelPendingBarrelOrder",
  "createBusinessStripeAccountLink",
  "refreshBusinessStripeAccountStatus",
  "createCarDepositPaymentIntent",
  "createCarPurchasePaymentIntent",
  "completeCarPurchase",
  "cancelPendingCarPurchase",
  "completeCarDepositReservation",
  "createPaidHoldExtensionPaymentIntent",
  "completePaidHoldExtensionPayment",
  "createParkingReservation",
  "completeParkingReservation",
  "createCustomerCheckoutSession",
];

describe("payment runtime configuration", () => {
  it("declares Stripe secrets on real-payment callables", () => {
    const script = `
      process.env.GCLOUD_PROJECT = "demo-test";
      const functions = require("./index");
      const names = ${JSON.stringify(STRIPE_CALLABLES)};
      const result = Object.fromEntries(names.map((name) => {
        const endpoint = functions[name].__endpoint || {};
        const secrets = endpoint.secretEnvironmentVariables || [];
        return [name, secrets.map((secret) => secret.key)];
      }));
      process.stdout.write(JSON.stringify(result));
    `;
    const output = execFileSync(process.execPath, ["-e", script], {
      cwd: __dirname + "/..",
      env: {
        ...process.env,
        GCLOUD_PROJECT: "demo-test",
        SIMULATE_PAYMENTS: "false",
      },
      encoding: "utf8",
    });
    const secretsByCallable = JSON.parse(output);
    for (const name of STRIPE_CALLABLES) {
      assert.deepEqual(secretsByCallable[name], ["STRIPE_SECRET_KEY"], name);
    }
  });

  it("makes Stripe webhooks authoritative and idempotent", () => {
    const script = `
      process.env.GCLOUD_PROJECT = "demo-test";
      const functions = require("./index");
      const endpoint = functions.handleBusinessProStripeWebhook.__endpoint;
      process.stdout.write(JSON.stringify(
        (endpoint.secretEnvironmentVariables || []).map((secret) => secret.key)
      ));
    `;
    const output = execFileSync(process.execPath, ["-e", script], {
      cwd: __dirname + "/..",
      env: {...process.env, GCLOUD_PROJECT: "demo-test"},
      encoding: "utf8",
    });
    assert.deepEqual(JSON.parse(output), [
      "STRIPE_WEBHOOK_SECRET",
      "STRIPE_SECRET_KEY",
    ]);

    const source = fs.readFileSync(
        path.join(__dirname, "..", "index.js"),
        "utf8",
    );
    assert.match(source, /claimStripeWebhookEvent\(event\)/);
    assert.match(source, /reconcileStripePaymentEvent\(event\)/);
    assert.match(source, /runPaymentCompletion\(target\)/);
    assert.match(source, /Idempotency-Key/);
    assert.match(source, /exports\.reconcileStaleStripePayments/);
    assert.match(
        source,
        new RegExp(
            "exports\\.stripeCheckoutWebhook =\\s*" +
            "exports\\.handleBusinessProStripeWebhook",
        ),
    );
    assert.match(source, /bindCheckoutPaymentIntent\(event\)/);
    assert.match(source, /reconcileCustomerCheckoutFailure\(event\)/);
    assert.match(source, /checkoutOriginalPaymentIntentId/);
    assert.match(source, /outside the allowed window/);
  });

  it("guards unauthenticated barrel order completion recovery", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "..", "index.js"),
        "utf8",
    );
    assert.match(
        source,
        /const callerUid = request\.auth\?\.uid \|\| "";/,
    );
    assert.match(source, /metadataOrderId !== orderId/);
    assert.match(source, /metadataCustomerUid !== order\.customerUid/);
    assert.match(source, /throw new HttpsError\(\s*"unauthenticated"/);
  });

  it("sorts parking options by distance before price when located", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "..", "index.js"),
        "utf8",
    );
    assert.match(source, /function distanceMiles\(latA, lonA, latB, lonB\)/);
    assert.match(source, /customerLatitude,\s*customerLongitude,/);
    assert.match(
        source,
        /if \(a\.distanceMiles !== null && b\.distanceMiles !== null\)/,
    );
    assert.match(source, /Number\(a\.estimatedTotal \|\| 0\)/);
  });

  it("uses configured platform fees for car payment flows", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "..", "index.js"),
        "utf8",
    );
    const serviceFeesReads = source.match(/doc\("serviceFees"\)/g) || [];
    assert.match(source, /DEFAULT_PLATFORM_SERVICE_FEE_PCT = 0\.1/);
    assert.ok(serviceFeesReads.length >= 3);
    assert.match(source, /pricingDoc\.data\(\)/);
    assert.match(source, /"carDepositPlatformFeePct"/);
    assert.match(source, /"carPurchasePlatformFeePct"/);
    assert.match(source, /"holdExtensionPlatformFeePct"/);
  });

  it("uses business-specific platform fees before default pricing", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "..", "index.js"),
        "utf8",
    );
    assert.match(source, /function businessPlatformFeePctFromBusiness/);
    assert.match(source, /business\?\.platformFeePct/);
    assert.match(source, /function servicePlatformFeePctForBusiness/);
    assert.match(
        source,
        /businessPlatformFeePctFromBusiness\(business\) \?\?/,
    );
    assert.match(source, /servicePlatformFeePctForBusiness\(/);
    assert.match(
        source,
        /barrelPlatformFeePctFromPricing\(\s*pricingDoc\.data\(\),\s*business/,
    );
  });

  it("stores Stripe Connect requirement summaries on business profiles", () => {
    const indexSource = fs.readFileSync(
        path.join(__dirname, "..", "index.js"),
        "utf8",
    );
    const helperSource = fs.readFileSync(
        path.join(__dirname, "..", "stripe_connect_status.js"),
        "utf8",
    );
    const currentlyDuePattern =
      /currentlyDue:\s*stripeStringList\(requirements\.currently_due\)/;
    const pastDuePattern =
      /pastDue:\s*stripeStringList\(requirements\.past_due\)/;
    const pendingVerificationPattern =
      /pendingVerification:\s*stripeStringList\(/;
    assert.match(indexSource, /buildStripeAccountBusinessUpdate\(account/);
    assert.match(
        helperSource,
        /stripeRequirements:\s*stripeRequirementsUpdate\(account\)/,
    );
    assert.match(helperSource, currentlyDuePattern);
    assert.match(helperSource, pastDuePattern);
    assert.match(helperSource, pendingVerificationPattern);
  });

  it("builds a ready business update when Stripe approves the account", () => {
    const timestamp = Symbol("serverTimestamp");
    const update = buildStripeAccountBusinessUpdate({
      id: "acct_ready",
      charges_enabled: true,
      payouts_enabled: true,
      requirements: {
        currently_due: [],
        past_due: [],
        pending_verification: [],
        eventually_due: [],
        disabled_reason: null,
        errors: [],
      },
    }, {serverTimestamp: () => timestamp});

    assert.deepEqual(update, {
      stripeAccountId: "acct_ready",
      chargesEnabled: true,
      payoutsEnabled: true,
      stripeRequirements: {
        currentlyDue: [],
        pastDue: [],
        pendingVerification: [],
        eventuallyDue: [],
        disabledReason: "",
        errors: [],
      },
      connectOnboardedAt: timestamp,
      updatedAt: timestamp,
    });
  });

  it("persists Stripe account.updated approval events onto businesses", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "..", "index.js"),
        "utf8",
    );
    const webhookPersistPattern = new RegExp([
      "if \\(event\\.type === \"account\\.updated\"\\) \\{",
      "[\\s\\S]*?await persistStripeAccountStatus",
      "\\(\\{businessId, account: object\\}\\);",
    ].join(""));
    const lookupPattern = new RegExp([
      "object\\.metadata\\?\\.businessId \\|\\|",
      "[\\s\\S]*await businessIdForStripeAccount\\(accountId\\)",
    ].join(""));
    const persistPattern = new RegExp([
      "async function persistStripeAccountStatus",
      "\\(\\{businessId, account\\}\\) \\{",
      "[\\s\\S]*?\\.set\\(stripeAccountBusinessUpdate\\(account\\), ",
      "\\{merge: true\\}\\)",
      "[\\s\\S]*?retryPendingBusinessTransfersForBusiness\\(businessId\\)",
    ].join(""));
    assert.match(source, webhookPersistPattern);
    assert.match(source, lookupPattern);
    assert.match(source, persistPattern);
  });

  it(
      "keeps restricted Stripe accounts pending with visible requirements",
      () => {
        assert.deepEqual(
            stripeRequirementsUpdate({
              requirements: {
                currently_due: ["business_profile.url", ""],
                past_due: ["external_account"],
                pending_verification: ["company.verification.document"],
                eventually_due: ["representative.first_name"],
                disabled_reason: "requirements.past_due",
                errors: [{
                  code: "verification_document_failed",
                  requirement: "company.verification.document",
                  reason: "Document was unreadable",
                }],
              },
            }),
            {
              currentlyDue: ["business_profile.url"],
              pastDue: ["external_account"],
              pendingVerification: ["company.verification.document"],
              eventuallyDue: ["representative.first_name"],
              disabledReason: "requirements.past_due",
              errors: [{
                code: "verification_document_failed",
                requirement: "company.verification.document",
                reason: "Document was unreadable",
              }],
            },
        );
      },
  );

  it("uses configured platform fees for shared barrel payment flows", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "..", "index.js"),
        "utf8",
    );
    assert.match(source, /function sharedBarrelPlatformFeePctFromPricing/);
    assert.match(source, /"sharedBarrelPlatformFeePct"/);
    assert.match(
        source,
        /platformFeePct = sharedBarrelPlatformFeePctFromPricing/,
    );
    assert.doesNotMatch(
        source,
        /platformFeePct:\s*SHARED_BARREL_PLATFORM_COMMISSION_RATE/,
    );
    assert.doesNotMatch(
        source,
        /platformCommissionRate:\s*SHARED_BARREL_PLATFORM_COMMISSION_RATE/,
    );
  });
});
