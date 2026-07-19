const assert = require("node:assert/strict");
const {describe, it} = require("node:test");
const {
  buildFeaturedBusinessPayload,
  buildFeaturingRequestUpdate,
  featureBusinessValidation,
  normalizeFeaturedServices,
} = require("../featured_business");

const timestamp = Symbol("serverTimestamp");
const deleteValue = Symbol("deleteField");

function validateWebsite(value) {
  return `valid:${value}`;
}

describe("featured business helpers", () => {
  it("deduplicates featured services", () => {
    assert.deepEqual(
        normalizeFeaturedServices([" carSales ", "", "carSales"], []),
        ["carSales"],
    );
    assert.deepEqual(
        normalizeFeaturedServices(undefined, ["barrelShipping"]),
        ["barrelShipping"],
    );
  });

  it("reports all publish gate requirements", () => {
    assert.deepEqual(
        featureBusinessValidation({
          businessId: "",
          business: {status: "pending"},
          displayName: "",
          blurb: "",
          services: [],
          logoUrl: "",
          featureConsent: false,
        }),
        [
          "business",
          "approved business status",
          "display name",
          "logo",
          "short blurb",
          "at least one service",
          "feature consent",
        ],
    );
  });

  it("builds a public featured-business payload", () => {
    const result = buildFeaturedBusinessPayload({
      businessId: "biz_a",
      business: {
        name: "Business A",
        status: "approved",
        website: "example.com",
        city: "New York",
        country: "United States",
      },
      data: {
        blurb: "Trusted shipping and cars.",
        logoUrl: "https://cdn.example.com/logo.png",
        services: ["carSales"],
        featureConsent: true,
        order: 4,
      },
      adminUid: "admin-a",
      timestamp,
      validateWebsite,
    });

    assert.deepEqual(result, {
      payload: {
        businessId: "biz_a",
        displayName: "Business A",
        logoUrl: "https://cdn.example.com/logo.png",
        blurb: "Trusted shipping and cars.",
        services: ["carSales"],
        city: "New York",
        country: "United States",
        order: 4,
        active: true,
        approvedBy: "admin-a",
        approvedAt: timestamp,
        updatedAt: timestamp,
        websiteUrl: "valid:example.com",
      },
    });
  });

  it("rejects public featured-business blurbs over 140 characters", () => {
    const result = buildFeaturedBusinessPayload({
      businessId: "biz_a",
      business: {
        name: "Business A",
        status: "approved",
      },
      data: {
        blurb: "A".repeat(141),
        logoUrl: "https://cdn.example.com/logo.png",
        services: ["carSales"],
        featureConsent: true,
      },
      adminUid: "admin-a",
      timestamp,
      validateWebsite,
    });

    assert.deepEqual(result, {
      missing: ["blurb under 140 characters"],
    });
  });

  it("requires self-serve featuring requests to include a logo", () => {
    assert.deepEqual(
        buildFeaturingRequestUpdate({
          data: {
            marketingBlurb: "Trusted cars.",
            featureConsent: true,
          },
          business: {},
          timestamp,
          updatedBy: "owner-a",
          deleteValue,
        }),
        {missing: ["logo"]},
    );
  });

  it("rejects self-serve featuring request blurbs over 140 characters", () => {
    assert.deepEqual(
        buildFeaturingRequestUpdate({
          data: {
            marketingBlurb: "A".repeat(141),
            logoUrl: "https://cdn.example.com/logo.png",
            featureConsent: true,
          },
          business: {},
          timestamp,
          updatedBy: "owner-a",
          deleteValue,
        }),
        {missing: ["blurb under 140 characters"]},
    );
  });

  it("builds a self-serve featuring request update", () => {
    assert.deepEqual(
        buildFeaturingRequestUpdate({
          data: {
            marketingBlurb: "Trusted cars.",
            featureConsent: true,
          },
          business: {profileImageUrl: "https://cdn.example.com/profile.png"},
          timestamp,
          updatedBy: "owner-a",
          deleteValue,
        }),
        {
          update: {
            marketingBlurb: "Trusted cars.",
            logoUrl: "https://cdn.example.com/profile.png",
            featureConsent: true,
            featureStatus: "requested",
            featureNote: deleteValue,
            updatedAt: timestamp,
            updatedBy: "owner-a",
          },
        },
    );
  });
});
