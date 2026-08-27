"use client";

import { useEffect } from "react";

/**
 * Every console ships from the same static export, served on
 * admin/business/customer subdomains, and picks which console to render from
 * the signed-in user's role rather than the hostname. That means the static
 * `metadata.title` in layout.tsx is the only title any of them ever got, so
 * every tab on every subdomain read "Administration Laawol Digital" and there
 * was no way to tell three open tabs apart.
 *
 * Titles are therefore set at runtime, once the console (and where available
 * the active section) is known.
 */
export const CONSOLE_TITLES = {
  admin: "Laawol Admin",
  business: "Laawol Business",
  customer: "Laawol",
} as const;

export type ConsoleName = keyof typeof CONSOLE_TITLES;

/** "Shipments · Laawol Admin", or just "Laawol Admin" with no section. */
export function consoleDocumentTitle(
  consoleName: ConsoleName,
  section?: string,
): string {
  const base = CONSOLE_TITLES[consoleName];
  const trimmed = (section ?? "").trim();
  return trimmed ? `${trimmed} · ${base}` : base;
}

export function useConsoleDocumentTitle(
  consoleName: ConsoleName,
  section?: string,
): void {
  useEffect(() => {
    const apply = () => {
      document.title = consoleDocumentTitle(consoleName, section);
    };
    // Applied twice on purpose. The App Router renders layout.tsx's static
    // metadata title into <head>, and React writes that element during
    // hydration - which lands after this effect's first run and reverts it.
    // Re-applying on the next frame puts our title in after React has settled.
    apply();
    const frame = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(frame);
  }, [consoleName, section]);
}
