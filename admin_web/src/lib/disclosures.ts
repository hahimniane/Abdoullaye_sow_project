import { currentWebLanguage } from "./language.ts";

export const MARKETPLACE_DISCLOSURE_VERSION =
  "marketplace-provider-responsibility-v1";
export const LEGAL_ACCEPTANCE_VERSION =
  "terms-privacy-marketplace-v1";

export function marketplaceDisclosure() {
  return {
    accepted: true,
    version: MARKETPLACE_DISCLOSURE_VERSION,
    locale: currentWebLanguage(),
  } as const;
}

export function legalAcceptance() {
  return {
    accepted: true,
    version: LEGAL_ACCEPTANCE_VERSION,
    locale: currentWebLanguage(),
  } as const;
}
