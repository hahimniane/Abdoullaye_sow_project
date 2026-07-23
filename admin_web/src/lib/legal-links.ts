import {
  currentWebLanguage,
  type SupportedLanguage,
} from "./language.ts";

export const PUBLIC_SITE_ORIGIN = "https://laawoldigital.com";
export const SUPPORT_URL = `${PUBLIC_SITE_ORIGIN}/contact.html`;

export type LegalPage = "terms" | "privacy";

export function legalUrlForLanguage(
  page: LegalPage,
  language: SupportedLanguage,
) {
  const suffix = language === "fr" ? "" : "-en";
  return `${PUBLIC_SITE_ORIGIN}/${page}${suffix}.html`;
}

export function currentLegalUrl(page: LegalPage) {
  return legalUrlForLanguage(page, currentWebLanguage());
}
