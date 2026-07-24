export type PublicCarListing = {
  status?: unknown;
  businessStatus?: unknown;
  enabledServices?: unknown;
};

export function customerCarListingIsEligible(value: unknown) {
  const listing =
    value && typeof value === "object" ? (value as PublicCarListing) : {};
  if (String(listing.status || "") !== "active") return false;
  if (
    listing.businessStatus !== undefined &&
    String(listing.businessStatus) !== "approved"
  ) {
    return false;
  }
  if (!Array.isArray(listing.enabledServices)) {
    // Match Flutter's legacy normalization for records that predate explicit
    // service capabilities.
    return true;
  }
  return listing.enabledServices.includes("carSales");
}
