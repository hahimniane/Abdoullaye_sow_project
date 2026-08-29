"use strict";

/**
 * Headquarters lives on the business document, not in officeLocations.
 * Extra offices stay optional. When none exist, drop-off synthesizes a
 * default office from this HQ address — but only when a real street line
 * is present. City-only / country-as-state leftovers must not become a
 * customer-facing drop-off.
 */

function textPart(value) {
  return typeof value === "string" ? value.trim() : String(value || "").trim();
}

function headquartersParts(data = {}) {
  return {
    addressLine1: textPart(data.addressLine1),
    city: textPart(data.city),
    country: textPart(data.country),
    state: textPart(data.state),
    postalCode: textPart(data.postalCode),
  };
}

function isUnitedStates(country) {
  return textPart(country) === "United States";
}

function headquartersAddressError(data = {}) {
  const parts = headquartersParts(data);
  if (!parts.addressLine1) {
    return "A street address is required for the business headquarters.";
  }
  if (!parts.city) {
    return "A city is required for the business headquarters.";
  }
  if (!parts.country) {
    return "A country is required for the business headquarters.";
  }
  if (isUnitedStates(parts.country) && !parts.state) {
    return "A US state is required for a United States headquarters address.";
  }
  return "";
}

function isCompleteHeadquartersAddress(data = {}) {
  return headquartersAddressError(data) === "";
}

/**
 * Compose the public HQ line. Requires addressLine1 so a city-only or
 * country-only leftover never ships to customers as a drop-off address.
 */
function composeHeadquartersAddress(data = {}) {
  const parts = headquartersParts(data);
  if (!parts.addressLine1) return "";
  return [
    parts.addressLine1,
    parts.city,
    parts.state,
    parts.postalCode,
    parts.country,
  ].filter(Boolean).join(", ");
}

function defaultOfficeLocationFromBusiness(business = {}) {
  const address = composeHeadquartersAddress(business);
  if (!address) return null;
  return {
    id: "default",
    label: textPart(business.name) || "Main office",
    address,
    isActive: true,
  };
}

module.exports = {
  composeHeadquartersAddress,
  defaultOfficeLocationFromBusiness,
  headquartersAddressError,
  headquartersParts,
  isCompleteHeadquartersAddress,
};
