const assert = require("node:assert/strict");
const {execFileSync} = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");

const {
  VALID_BUSINESS_VERIFICATION_DOCUMENT_IDS,
  buildBusinessVerificationBypassUpdate,
  buildBusinessVerificationDocumentSubmissionUpdate,
  buildBusinessVerificationStoragePath,
  buildBusinessVerificationReviewUpdate,
  businessServicesForVerification,
  businessVerificationApprovalReadiness,
  cleanBusinessVerificationUploadPayload,
  cleanVerificationDocumentUpdates,
  requiredBusinessVerificationDocuments,
} = require("../business_verification");
const {
  coerceReviewWebsite,
  isValidWebsite,
  normalizeWebsite,
} = require("../business_profile_validation");

describe("business verification review helpers", () => {
  it("exports the review and submission callables", () => {
    const names = [
      "updateBusinessVerificationReview",
      "submitBusinessVerificationDocument",
      "uploadBusinessVerificationDocument",
    ];
    const script = `
      process.env.GCLOUD_PROJECT = "demo-test";
      const functions = require("./index");
      const names = ${JSON.stringify(names)};
      process.stdout.write(JSON.stringify(
        Object.fromEntries(names.map((name) => [
          name,
          Boolean(functions[name] && functions[name].__endpoint),
        ])),
      ));
    `;
    const output = execFileSync(process.execPath, ["-e", script], {
      cwd: __dirname + "/..",
      env: {...process.env, GCLOUD_PROJECT: "demo-test"},
      encoding: "utf8",
    });
    const exported = JSON.parse(output);
    for (const name of names) {
      assert.equal(exported[name], true, name);
    }
  });

  it("guards approval callables with server-side verification readiness",
      () => {
        const source = fs.readFileSync(
            path.join(__dirname, "..", "index.js"),
            "utf8",
        );
        assert.match(source, /function assertBusinessApprovalReady/);
        assert.match(
            source,
            /collectionName === "businesses" && nextStatus === "approved"/,
        );
        assert.match(source, /if \(nextStatus === "approved"\)/);
      });

  it("keeps business location fields when reviewing an application", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "..", "index.js"),
        "utf8",
    );
    assert.match(source, /addressLine1:\s*current\.addressLine1/);
    assert.match(source, /city:\s*current\.city/);
    assert.match(source, /country:\s*current\.country/);
    assert.match(source, /state:\s*current\.state/);
    assert.match(source, /postalCode:\s*current\.postalCode/);
  });

  it("does not block business review on a legacy invalid website", () => {
    assert.equal(normalizeWebsite("example.com"), "https://example.com");
    assert.equal(isValidWebsite("example.com"), true);
    assert.equal(coerceReviewWebsite("example.com"), "https://example.com");
    assert.equal(coerceReviewWebsite("not available"), "");

    const source = fs.readFileSync(
        path.join(__dirname, "..", "index.js"),
        "utf8",
    );
    assert.match(
        source,
        /website:\s*coerceReviewWebsite\(website \?\? current\.website\)/,
    );
  });

  it("does not requeue already approved business applications", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "..", "index.js"),
        "utf8",
    );
    assert.match(
        source,
        /const status = currentStatus === "approved" \? "approved" : "pending"/,
    );
    assert.match(source, /let responseStatus = "pending"/);
    assert.match(source, /if \(status !== "approved"\) \{/);
    assert.match(source, /status: responseStatus/);
  });

  it("builds a nested Firestore update for document review state", () => {
    const timestamp = Symbol("timestamp");
    assert.deepEqual(
        buildBusinessVerificationReviewUpdate({
          documents: [
            {id: "dealerLicense", status: "needs_changes", note: "Expired"},
          ],
          note: "  Request updated license. ",
          adminUid: "admin-a",
          timestamp,
        }),
        {
          "verificationReview.documents.dealerLicense": {
            status: "needs_changes",
            note: "Expired",
            updatedAt: timestamp,
            updatedBy: "admin-a",
          },
          "verificationReview.note": "Request updated license.",
          "verificationReview.updatedAt": timestamp,
          "verificationReview.updatedBy": "admin-a",
          updatedAt: timestamp,
          updatedBy: "admin-a",
        },
    );
  });

  it("allows saving a Stripe-only review note without platform docs", () => {
    const timestamp = Symbol("timestamp");
    assert.deepEqual(
        buildBusinessVerificationReviewUpdate({
          documents: [],
          note: "Complete Stripe onboarding.",
          adminUid: "admin-a",
          timestamp,
        }),
        {
          "verificationReview.note": "Complete Stripe onboarding.",
          "verificationReview.updatedAt": timestamp,
          "verificationReview.updatedBy": "admin-a",
          updatedAt: timestamp,
          updatedBy: "admin-a",
        },
    );
  });

  it("rejects invalid document IDs and statuses", () => {
    assert.throws(
        () => cleanVerificationDocumentUpdates([
          {id: "dealerLicense", status: "done"},
        ]),
        /Invalid verification document status/,
    );
    assert.throws(
        () => cleanVerificationDocumentUpdates([
          {id: "bad.path", status: "verified"},
        ]),
        /Invalid verification document ID/,
    );
    assert.throws(
        () => cleanVerificationDocumentUpdates([
          {id: "businessRegistration", status: "submitted"},
        ]),
        /Invalid verification document ID/,
    );
    assert.deepEqual(VALID_BUSINESS_VERIFICATION_DOCUMENT_IDS, [
      "shippingAuthority",
      "dealerLicense",
      "parkingFacilityProof",
      "transportInsurance",
    ]);
  });

  it("builds document submission metadata and resets review status", () => {
    const timestamp = Symbol("timestamp");
    const storagePath =
      "businessDocuments/biz_a/shippingAuthority/123-authority.pdf";
    assert.deepEqual(
        buildBusinessVerificationDocumentSubmissionUpdate({
          businessId: "biz_a",
          documentId: "shippingAuthority",
          fileName: "authority.pdf",
          path: storagePath,
          url: "https://storage.example.com/authority.pdf",
          contentType: "application/pdf",
          size: 12000,
          uid: "owner-a",
          timestamp,
        }),
        {
          "verificationDocuments.shippingAuthority": {
            id: "shippingAuthority",
            fileName: "authority.pdf",
            path: storagePath,
            url: "https://storage.example.com/authority.pdf",
            contentType: "application/pdf",
            size: 12000,
            status: "submitted",
            uploadedAt: timestamp,
            uploadedBy: "owner-a",
            updatedAt: timestamp,
          },
          "verificationReview.documents.shippingAuthority": {
            status: "submitted",
            note: "",
            updatedAt: timestamp,
            updatedBy: "owner-a",
          },
          "verificationReview.updatedAt": timestamp,
          "verificationReview.updatedBy": "owner-a",
          updatedAt: timestamp,
          updatedBy: "owner-a",
        },
    );
  });

  it("cleans callable document upload payloads for server-side storage", () => {
    const buffer = Buffer.from("test document");
    const upload = cleanBusinessVerificationUploadPayload({
      businessId: "biz_a",
      documentId: "shippingAuthority",
      fileName: "Authority Proof.pdf",
      contentType: "application/pdf",
      size: buffer.length,
      base64: buffer.toString("base64"),
      nowMs: 123,
    });
    assert.equal(upload.businessId, "biz_a");
    assert.equal(upload.documentId, "shippingAuthority");
    assert.equal(upload.fileName, "Authority Proof.pdf");
    assert.equal(upload.contentType, "application/pdf");
    assert.equal(upload.size, buffer.length);
    assert.equal(
        upload.path,
        "businessDocuments/biz_a/shippingAuthority/123-authority-proof.pdf",
    );
    assert.deepEqual(upload.buffer, buffer);
  });

  it("rejects invalid callable document upload payloads", () => {
    const buffer = Buffer.from("test document");
    assert.throws(
        () => cleanBusinessVerificationUploadPayload({
          businessId: "biz_a",
          documentId: "stripeIdentity",
          fileName: "passport.pdf",
          contentType: "application/pdf",
          size: buffer.length,
          base64: buffer.toString("base64"),
        }),
        /Invalid verification document ID/,
    );
    assert.throws(
        () => cleanBusinessVerificationUploadPayload({
          businessId: "biz_a",
          documentId: "shippingAuthority",
          fileName: "script.js",
          contentType: "application/javascript",
          size: buffer.length,
          base64: buffer.toString("base64"),
        }),
        /Documents must be PDF, Word, or image files/,
    );
    assert.throws(
        () => cleanBusinessVerificationUploadPayload({
          businessId: "biz_a",
          documentId: "shippingAuthority",
          fileName: "authority.pdf",
          contentType: "application/pdf",
          size: buffer.length + 1,
          base64: buffer.toString("base64"),
        }),
        /Document file size does not match upload payload/,
    );
  });

  it("builds stable server-side storage paths with sanitized names", () => {
    assert.equal(
        buildBusinessVerificationStoragePath({
          businessId: "biz_1",
          documentId: "parkingFacilityProof",
          fileName: "Lease Agreement 2026.DOCX",
          nowMs: 456,
        }),
        "businessDocuments/biz_1/parkingFacilityProof/" +
          "456-lease-agreement-2026.docx",
    );
  });

  it("rejects submission metadata for the wrong storage path", () => {
    assert.throws(
        () => buildBusinessVerificationDocumentSubmissionUpdate({
          businessId: "biz_a",
          documentId: "shippingAuthority",
          fileName: "authority.pdf",
          path: "businessDocuments/biz_b/shippingAuthority/file.pdf",
          url: "https://storage.example.com/authority.pdf",
          size: 12000,
          uid: "owner-a",
          timestamp: Symbol("timestamp"),
        }),
        /Document storage path does not match the business/,
    );
  });

  it("requires only service-specific documents before approval", () => {
    assert.deepEqual(
        requiredBusinessVerificationDocuments([
          "barrelShipping",
          "carTransport",
        ]).map((document) => document.id),
        ["shippingAuthority", "transportInsurance"],
    );
  });

  it("reads services from legacy business service fields", () => {
    assert.deepEqual(
        businessServicesForVerification({
          businessServices: ["carSales", "carParking"],
          enabledServices: [],
        }),
        ["carSales", "carParking"],
    );

    const readiness = businessVerificationApprovalReadiness({
      businessServices: ["carSales"],
      stripeAccountId: "acct_ready",
      chargesEnabled: true,
      payoutsEnabled: true,
      verificationReview: {
        documents: {
          dealerLicense: {status: "verified"},
        },
      },
    });

    assert.equal(readiness.ready, true);
    assert.deepEqual(readiness.requiredDocumentIds, ["dealerLicense"]);
  });

  it("allows approval only after Stripe and platform documents are ready",
      () => {
        const ready = businessVerificationApprovalReadiness({
          enabledServices: ["barrelShipping", "carParking"],
          stripeAccountId: "acct_ready",
          chargesEnabled: true,
          payoutsEnabled: true,
          verificationReview: {
            documents: {
              shippingAuthority: {status: "verified"},
              parkingFacilityProof: {status: "not_applicable"},
            },
          },
        });

        assert.equal(ready.ready, true);
        assert.deepEqual(ready.blockers, []);

        const missingStripe = businessVerificationApprovalReadiness({
          enabledServices: [],
          verificationReview: {documents: {}},
        });
        assert.equal(missingStripe.ready, false);
        assert.deepEqual(missingStripe.blockers, ["Stripe verification"]);

        const submittedOnly = businessVerificationApprovalReadiness({
          enabledServices: ["carSales"],
          stripeAccountId: "acct_ready",
          chargesEnabled: true,
          payoutsEnabled: true,
          verificationDocuments: {
            dealerLicense: {path: "businessDocuments/biz/dealer/file.pdf"},
          },
        });
        assert.equal(submittedOnly.ready, false);
        assert.deepEqual(
            submittedOnly.blockers,
            ["Dealer license or sales authorization"],
        );
      });

  it("allows platform document bypass only after Stripe is ready", () => {
    const blocked = businessVerificationApprovalReadiness({
      enabledServices: ["carSales"],
      stripeAccountId: "acct_ready",
      chargesEnabled: true,
      payoutsEnabled: true,
      verificationDocuments: {
        dealerLicense: {status: "submitted", path: "docs/dealer.pdf"},
      },
    });
    assert.equal(blocked.ready, false);

    const bypassed = businessVerificationApprovalReadiness({
      enabledServices: ["carSales"],
      stripeAccountId: "acct_ready",
      chargesEnabled: true,
      payoutsEnabled: true,
      verificationDocuments: {
        dealerLicense: {status: "submitted", path: "docs/dealer.pdf"},
      },
    }, {allowPlatformDocumentBypass: true});
    assert.equal(bypassed.ready, true);
    assert.equal(bypassed.platformDocumentsBypassed, true);
    assert.deepEqual(bypassed.blockers, []);

    const missingStripe = businessVerificationApprovalReadiness({
      enabledServices: ["carSales"],
      verificationDocuments: {
        dealerLicense: {status: "submitted", path: "docs/dealer.pdf"},
      },
    }, {allowPlatformDocumentBypass: true});
    assert.equal(missingStripe.ready, false);
    assert.deepEqual(missingStripe.blockers, [
      "Stripe verification",
      "Dealer license or sales authorization",
    ]);
  });

  it("builds an audited platform document bypass update", () => {
    const timestamp = Symbol("timestamp");
    assert.deepEqual(
        buildBusinessVerificationBypassUpdate({
          business: {
            enabledServices: ["carSales"],
            stripeAccountId: "acct_ready",
            chargesEnabled: true,
            payoutsEnabled: true,
          },
          note: "Approved based on prior offline review.",
          adminUid: "admin-a",
          timestamp,
        }),
        {
          "verificationReview.documents.dealerLicense": {
            status: "not_applicable",
            note: "Approved based on prior offline review.",
            updatedAt: timestamp,
            updatedBy: "admin-a",
            bypassed: true,
          },
          "verificationReview.note": "Approved based on prior offline review.",
          "verificationReview.platformDocumentsBypassed": true,
          "verificationReview.platformDocumentsBypassedAt": timestamp,
          "verificationReview.platformDocumentsBypassedBy": "admin-a",
          "verificationReview.updatedAt": timestamp,
          "verificationReview.updatedBy": "admin-a",
          updatedAt: timestamp,
          updatedBy: "admin-a",
        },
    );

    assert.throws(
        () => buildBusinessVerificationBypassUpdate({
          business: {enabledServices: ["carSales"]},
          adminUid: "admin-a",
          timestamp,
        }),
        /Stripe verification must be complete/,
    );
  });
});
