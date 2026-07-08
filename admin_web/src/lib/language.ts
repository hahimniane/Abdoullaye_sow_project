export type SupportedLanguage = "en" | "fr";

export const LANGUAGE_STORAGE_KEY = "laawol:lang";

export function resolveLang(
  stored: string | null,
  deviceLanguages: readonly string[],
): SupportedLanguage {
  const saved = String(stored ?? "").trim().toLowerCase();
  if (saved === "en" || saved === "fr") return saved;

  const primary = deviceLanguages
    .map((lang) => String(lang ?? "").trim().toLowerCase())
    .find(Boolean);
  return primary?.startsWith("fr") ? "fr" : "en";
}

export function currentDeviceLanguages(): string[] {
  if (typeof navigator === "undefined") return [];
  if (Array.isArray(navigator.languages) && navigator.languages.length > 0) {
    return navigator.languages.filter(Boolean);
  }
  return navigator.language ? [navigator.language] : [];
}

export function currentWebLanguage(): SupportedLanguage {
  const stored = typeof window !== "undefined"
    ? window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
    : null;
  return resolveLang(stored, currentDeviceLanguages());
}

export function currentWebLocale() {
  return currentWebLanguage() === "fr" ? "fr-FR" : "en-US";
}
