/**
 * Which store button the "Get the Laawol app" banner shows.
 *
 * The tracking page is where a /t/<code> link lands when the app is not
 * installed (public/.htaccess), so it is the moment to offer the app. A phone
 * gets the one store it can install from; anything else gets both.
 *
 * The same rule runs on the public site's get-app.html (its inline script,
 * checked by public_site/verify-cms.mjs). Keep the two in step.
 *
 * Pure: no React, no window. `app-store-links.test.ts` runs it under node.
 */

export const APP_STORE_URL = "https://apps.apple.com/app/laawol/id6791795025";
export const PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.laawoldigital.app";

export type DevicePlatform = "ios" | "android" | "desktop";

export type StoreLink = {
  store: "app-store" | "google-play";
  href: string;
  /** Button text. Console copy: french-dom.ts translates it. */
  label: string;
};

const APP_STORE: StoreLink = {
  store: "app-store",
  href: APP_STORE_URL,
  label: "Download on the App Store",
};
const GOOGLE_PLAY: StoreLink = {
  store: "google-play",
  href: PLAY_STORE_URL,
  label: "Get it on Google Play",
};

/**
 * iPadOS 13+ Safari asks for the desktop site and reports itself as a Mac.
 * The tell is touch: no Mac has a touchscreen, so a "Macintosh" with more
 * than one touch point is an iPad.
 */
export function devicePlatform(device: {
  userAgent?: string | null;
  maxTouchPoints?: number | null;
}): DevicePlatform {
  const ua = String(device.userAgent ?? "");
  const touchPoints = Number(device.maxTouchPoints ?? 0);
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  if (/Macintosh/.test(ua) && touchPoints > 1) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

export function storeLinksFor(platform: DevicePlatform): StoreLink[] {
  if (platform === "ios") return [APP_STORE];
  if (platform === "android") return [GOOGLE_PLAY];
  return [APP_STORE, GOOGLE_PLAY];
}
