import { currentWebLanguage } from "./language.ts";

export const MARKETPLACE_DISCLOSURE_VERSION =
  "marketplace-provider-responsibility-v1";
export const LEGAL_ACCEPTANCE_VERSION =
  "terms-privacy-marketplace-v1";

// accepted must come from the real DisclosureCheckbox state a customer
// actually ticked on screen - never hardcode true here. The backend records
// this as proof of genuine consent (marketplaceDisclosureAcceptances), so a
// value that doesn't trace back to a real checked box defeats the point of
// requiring it at all.
export function marketplaceDisclosure(accepted: boolean) {
  if (!accepted) {
    throw new Error("Marketplace responsibility disclosure was not accepted");
  }
  return {
    accepted: true,
    version: MARKETPLACE_DISCLOSURE_VERSION,
    locale: currentWebLanguage(),
  } as const;
}

export function legalAcceptance(accepted: boolean) {
  if (!accepted) {
    throw new Error("Terms and privacy acceptance was not accepted");
  }
  return {
    accepted: true,
    version: LEGAL_ACCEPTANCE_VERSION,
    locale: currentWebLanguage(),
  } as const;
}
