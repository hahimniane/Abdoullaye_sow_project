"use strict";

function cleanText(value, maxLength = 1000) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeFeaturedServices(raw, fallback) {
  const incoming = Array.isArray(raw) ?
    raw :
    Array.isArray(fallback) ? fallback : [];
  const services = incoming
      .map((value) => cleanText(value, 80))
      .filter(Boolean);
  return Array.from(new Set(services));
}

function featureBusinessValidation({
  businessId,
  business,
  displayName,
  blurb,
  services,
  logoUrl,
  featureConsent,
}) {
  const missing = [];
  if (!businessId) missing.push("business");
  if (cleanText(business?.status, 40) !== "approved") {
    missing.push("approved business status");
  }
  if (!cleanText(displayName, 160)) missing.push("display name");
  if (!cleanText(logoUrl, 1000)) missing.push("logo");
  if (!cleanText(blurb, 200)) missing.push("short blurb");
  if (cleanText(blurb, 1000).length > 140) {
    missing.push("blurb under 140 characters");
  }
  if (!Array.isArray(services) || services.length === 0) {
    missing.push("at least one service");
  }
  if (featureConsent !== true) missing.push("feature consent");
  return missing;
}

function buildFeaturedBusinessPayload({
  businessId,
  business,
  data,
  adminUid,
  timestamp,
  validateWebsite,
}) {
  const displayName = cleanText(
      data.displayName || business.name || business.businessName,
      160,
  );
  const blurb = cleanText(data.blurb || business.marketingBlurb, 200);
  const services = normalizeFeaturedServices(
      data.services,
      business.enabledServices || business.services,
  );
  const logoUrl = cleanText(
      data.logoUrl || business.logoUrl || business.profileImageUrl,
      1000,
  );
  const websiteUrl = cleanText(data.websiteUrl || business.website, 1000);
  const featureConsent =
    data.featureConsent === true || business.featureConsent === true;
  const missing = featureBusinessValidation({
    businessId,
    business,
    displayName,
    blurb,
    services,
    logoUrl,
    featureConsent,
  });
  if (missing.length > 0) {
    return {missing};
  }
  const payload = {
    businessId,
    displayName,
    logoUrl,
    blurb,
    services,
    city: cleanText(data.city || business.city, 120),
    country: cleanText(data.country || business.country, 120),
    order: Math.max(0, Number(data.order ?? business.featureOrder ?? 0) || 0),
    active: data.active !== false,
    approvedBy: adminUid,
    approvedAt: timestamp,
    updatedAt: timestamp,
  };
  if (websiteUrl) {
    payload.websiteUrl = validateWebsite(websiteUrl);
  }
  return {payload};
}

function buildFeaturingRequestUpdate({
  data,
  business,
  timestamp,
  updatedBy,
  deleteValue,
}) {
  const marketingBlurb = cleanText(data.marketingBlurb || data.blurb, 200);
  const logoUrl = cleanText(
      data.logoUrl || business.logoUrl || business.profileImageUrl,
      1000,
  );
  const missing = [];
  if (!marketingBlurb) missing.push("short blurb");
  if (marketingBlurb.length > 140) {
    missing.push("blurb under 140 characters");
  }
  if (!logoUrl) missing.push("logo");
  if (data.featureConsent !== true) missing.push("feature consent");
  if (missing.length > 0) {
    return {missing};
  }
  return {
    update: {
      marketingBlurb,
      logoUrl,
      featureConsent: true,
      featureStatus: "requested",
      featureNote: deleteValue,
      updatedAt: timestamp,
      updatedBy,
    },
  };
}

module.exports = {
  buildFeaturedBusinessPayload,
  buildFeaturingRequestUpdate,
  cleanText,
  featureBusinessValidation,
  normalizeFeaturedServices,
};
