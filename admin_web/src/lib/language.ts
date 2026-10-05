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

/** The saved language choice, or null when there is none - or when storage
 * is blocked (Safari private mode, a "block all site data" setting, a
 * sandboxed iframe), where touching `localStorage` throws. A throw here used
 * to escape into render and blank the whole console. */
export function readStoredLanguage(): string | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Save the language choice; false when storage is blocked. */
export function storeLanguage(lang: SupportedLanguage): boolean {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
    return true;
  } catch {
    return false;
  }
}

export function currentWebLanguage(): SupportedLanguage {
  return resolveLang(readStoredLanguage(), currentDeviceLanguages());
}

export function currentWebLocale() {
  return currentWebLanguage() === "fr" ? "fr-FR" : "en-US";
}
