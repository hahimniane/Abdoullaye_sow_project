import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildBusinessVerificationChecklist,
  businessVerificationActionCount,
  requiredBusinessVerificationDocuments,
  resolveBusinessStripeVerification,
  summarizeVerificationItems,
} from "./business-verification.ts";

test("business verification documents only include service-specific requirements", () => {
  assert.deepEqual(
    requiredBusinessVerificationDocuments([]).map((item) => item.id),
    [],
  );

  assert.deepEqual(
    requiredBusinessVerificationDocuments(["barrelShipping", "carTransport"])
      .map((item) => item.id),
    [
      "shippingAuthority",
      "transportInsurance",
    ],
  );
});

test("business verification checklist detects submitted evidence in map fields", () => {
  const checklist = buildBusinessVerificationChecklist({
    id: "biz_a",
    enabledServices: ["carSales"],
    verificationDocuments: {
      dealerLicense: { storagePath: "businesses/biz_a/dealer.pdf" },
    },
    verificationReview: {
      documents: {
        dealerLicense: { status: "submitted" },
      },
    },
  });

  const byId = Object.fromEntries(checklist.items.map((item) => [item.id, item]));
  assert.equal(byId.dealerLicense.status, "submitted");
  assert.equal(byId.dealerLicense.evidence.label, "dealer.pdf");
  assert.equal(checklist.summary.approvalReady, false);
});

test("business verification checklist treats verified and not-applicable items as approvable", () => {
  const checklist = buildBusinessVerificationChecklist({
    id: "biz_a",
    enabledServices: ["barrelShipping", "carParking"],
    verificationReview: {
      documents: {
        shippingAuthority: { status: "verified" },
        parkingFacilityProof: { status: "not_applicable" },
      },
    },
  });

  assert.equal(checklist.summary.verified, 1);
  assert.equal(checklist.summary.notApplicable, 1);
  assert.equal(checklist.summary.approvalReady, true);
});

test("business verification summary allows approval when no platform documents apply", () => {
  const summary = summarizeVerificationItems([]);

  assert.equal(summary.total, 0);
  assert.equal(summary.approvalReady, true);
});

test("stripe verification status separates Stripe-owned KYC from Laawol documents", () => {
  assert.equal(
    resolveBusinessStripeVerification({ id: "missing" }).state,
    "not_started",
  );

  const actionRequired = resolveBusinessStripeVerification({
    id: "due",
    stripeAccountId: "acct_due",
    chargesEnabled: false,
    payoutsEnabled: false,
    stripeRequirements: {
      currentlyDue: ["business_profile.url", "external_account"],
    },
  });
  assert.equal(actionRequired.state, "action_required");
  assert.equal(actionRequired.ready, false);
  assert.deepEqual(actionRequired.currentlyDue, [
    "business_profile.url",
    "external_account",
  ]);

  const pending = resolveBusinessStripeVerification({
    id: "pending",
    stripeAccountId: "acct_pending",
    chargesEnabled: true,
    payoutsEnabled: false,
    stripeRequirements: {
      pendingVerification: ["company.verification.document"],
    },
  });
  assert.equal(pending.state, "pending");

  const ready = resolveBusinessStripeVerification({
    id: "ready",
    stripeAccountId: "acct_ready",
    chargesEnabled: true,
    payoutsEnabled: true,
  });
  assert.equal(ready.state, "ready");
  assert.equal(ready.ready, true);
});

test("business verification action count only flags pending reviewable businesses", () => {
  assert.equal(
    businessVerificationActionCount({
      id: "pending",
      status: "pending",
      enabledServices: ["carParking"],
      stripeAccountId: "acct_ready",
      chargesEnabled: true,
      payoutsEnabled: true,
    }),
    1,
  );
  assert.equal(
    businessVerificationActionCount({
      id: "approved",
      status: "approved",
      enabledServices: ["carParking"],
    }),
    0,
  );
  assert.equal(
    businessVerificationActionCount({
      id: "inferred",
      _inferred: true,
      status: "pending",
      enabledServices: ["carParking"],
    }),
    0,
  );
  assert.equal(
    businessVerificationActionCount({
      id: "stripe_due",
      status: "changes_requested",
      enabledServices: [],
    }),
    1,
  );
});
