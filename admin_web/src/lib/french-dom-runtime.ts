"use client";

// The console's language runtime: the EN/FR toggle, the document language,
// and - only when the page is in French - the DOM translation engine.
//
// The engine and its dictionary (french-dom.ts, the largest module the entry
// bundle used to carry) are fetched on demand. An English visitor never
// downloads them. A French visitor's page is kept hidden by the pre-paint
// script in app/layout.tsx (LANGUAGE_PENDING_ATTRIBUTE) until the first
// translation pass has run, so nobody sees the English markup flash first.
// Every path reveals the page: success, a failed fetch, and a safety timeout.

import { useEffect } from "react";

import {
  LANGUAGE_PENDING_ATTRIBUTE,
  currentWebLanguage,
  storeLanguage,
} from "./language.ts";

const REVEAL_TIMEOUT_MS = 4_000;

type Engine = typeof import("./french-dom.ts");
let enginePromise: Promise<Engine> | null = null;

function loadEngine(): Promise<Engine> {
  enginePromise ??= import("./french-dom.ts");
  return enginePromise;
}

// Start the fetch as soon as the entry bundle runs, in parallel with
// hydration, rather than after the first effect.
if (typeof window !== "undefined" && currentWebLanguage() === "fr") {
  loadEngine().catch(() => undefined);
}

function revealPage() {
  document.documentElement.removeAttribute(LANGUAGE_PENDING_ATTRIBUTE);
}

function installToggle(lang: "en" | "fr") {
  if (document.querySelector("[data-console-lang-toggle]")) return;
  const button = document.createElement("button");
  const nextLang = lang === "en" ? "fr" : "en";
  button.type = "button";
  button.className = "secondary-button compact console-lang-toggle";
  button.dataset.consoleLangToggle = "true";
  // The toggle names itself in the language it switches away from, so it is
  // never run through the dictionary.
  button.setAttribute("data-no-translate", "");
  button.textContent = nextLang.toUpperCase();
  button.title =
    nextLang === "fr"
      ? "Switch language to French"
      : "Passer la langue en anglais";
  button.setAttribute("aria-label", button.title);
  button.addEventListener("click", () => {
    // With site storage blocked the choice cannot survive a reload, and a
    // reload would only land back on the device language.
    if (storeLanguage(nextLang)) window.location.reload();
  });
  document.body.appendChild(button);
}

export function useFrenchDomTranslation() {
  useEffect(() => {
    const lang = currentWebLanguage();
    document.documentElement.lang = lang;
    installToggle(lang);
    if (lang !== "fr") {
      revealPage();
      return undefined;
    }

    let cancelled = false;
    let stop: (() => void) | null = null;
    const safety = window.setTimeout(revealPage, REVEAL_TIMEOUT_MS);
    loadEngine()
      .then((engine) => {
        if (!cancelled) stop = engine.startDomTranslation();
      })
      .catch(() => {
        // The page stays readable in English rather than staying hidden.
      })
      .finally(() => {
        window.clearTimeout(safety);
        revealPage();
      });
    return () => {
      cancelled = true;
      window.clearTimeout(safety);
      stop?.();
    };
  }, []);
}
