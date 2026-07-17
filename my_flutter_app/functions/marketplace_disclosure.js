const MARKETPLACE_DISCLOSURE_VERSION =
  "marketplace-provider-responsibility-v1";
const ACCOUNT_LEGAL_VERSION = "terms-privacy-marketplace-v1";

function acceptedDisclosure(raw, {
  version,
  field,
  allowMissing = false,
} = {}) {
  if (allowMissing && (raw === undefined || raw === null)) {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${field} acceptance is required`);
  }
  if (raw.accepted !== true || String(raw.version || "") !== version) {
    throw new Error(`${field} acceptance is missing or out of date`);
  }
  const locale = String(raw.locale || "").toLowerCase();
  if (locale !== "en" && locale !== "fr") {
    throw new Error(`${field} locale must be en or fr`);
  }
  return {accepted: true, version, locale};
}

function marketplaceDisclosure(raw, options = {}) {
  return acceptedDisclosure(raw, {
    version: MARKETPLACE_DISCLOSURE_VERSION,
    field: "Marketplace responsibility disclosure",
    ...options,
  });
}

function accountLegalAcceptance(raw, options = {}) {
  return acceptedDisclosure(raw, {
    version: ACCOUNT_LEGAL_VERSION,
    field: "Terms and privacy",
    ...options,
  });
}

module.exports = {
  ACCOUNT_LEGAL_VERSION,
  MARKETPLACE_DISCLOSURE_VERSION,
  accountLegalAcceptance,
  marketplaceDisclosure,
};
