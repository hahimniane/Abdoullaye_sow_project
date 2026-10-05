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

/**
 * Set on <html> while a French page waits for its translation engine; the
 * stylesheet hides the body while it is present (see french-dom-runtime.ts).
 */
export const LANGUAGE_PENDING_ATTRIBUTE = "data-lang-pending";
const LANGUAGE_BOOT_REVEAL_MS = 5_000;

/**
 * Runs inline in <head>, before the first paint and before any bundle loads.
 * It mirrors resolveLang() (saved choice, then the primary device language)
 * so a French visitor's page stays hidden until it is French instead of
 * painting the English markup first. It reveals the page itself after a few
 * seconds whatever happens, so a failed bundle can never leave it blank.
 */
export const LANGUAGE_BOOT_SCRIPT = [
  "(function(){try{",
  "var d=document.documentElement,s=null;",
  `try{s=window.localStorage.getItem(${JSON.stringify(LANGUAGE_STORAGE_KEY)})}catch(e){}`,
  's=String(s==null?"":s).trim().toLowerCase();',
  'var l=s==="en"||s==="fr"?s:"";',
  "if(!l){var n=navigator,a=n.languages&&n.languages.length?n.languages:[n.language],p=\"\";",
  'for(var i=0;i<a.length;i++){var v=String(a[i]==null?"":a[i]).trim().toLowerCase();if(v){p=v;break}}',
  'l=p.indexOf("fr")===0?"fr":"en"}',
  "d.lang=l;",
  `if(l==="fr"){d.setAttribute(${JSON.stringify(LANGUAGE_PENDING_ATTRIBUTE)},"");`,
  `setTimeout(function(){d.removeAttribute(${JSON.stringify(LANGUAGE_PENDING_ATTRIBUTE)})},${LANGUAGE_BOOT_REVEAL_MS})}`,
  "}catch(e){}})();",
].join("");
