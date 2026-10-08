import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  APP_STORE_URL,
  PLAY_STORE_URL,
  devicePlatform,
  storeLinksFor,
} from "./app-store-links.ts";
import { translateValue } from "./french-dom.ts";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
const MAC_DESKTOP =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const WHATSAPP_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/24.12";

test("an iPhone gets only the App Store", () => {
  assert.equal(devicePlatform({ userAgent: IPHONE, maxTouchPoints: 5 }), "ios");
  assert.equal(devicePlatform({ userAgent: WHATSAPP_IPHONE, maxTouchPoints: 5 }), "ios");
  assert.deepEqual(storeLinksFor("ios").map((link) => link.href), [APP_STORE_URL]);
});

test("an iPad reporting as a Mac is told apart by touch", () => {
  assert.equal(devicePlatform({ userAgent: IPAD_AS_MAC, maxTouchPoints: 5 }), "ios");
  // The same user agent with no touchscreen is a real Mac.
  assert.equal(devicePlatform({ userAgent: IPAD_AS_MAC, maxTouchPoints: 0 }), "desktop");
});

test("Android gets only Google Play", () => {
  assert.equal(devicePlatform({ userAgent: ANDROID, maxTouchPoints: 5 }), "android");
  assert.deepEqual(storeLinksFor("android").map((link) => link.href), [PLAY_STORE_URL]);
});

test("a desktop gets both stores, App Store first", () => {
  assert.equal(devicePlatform({ userAgent: MAC_DESKTOP, maxTouchPoints: 0 }), "desktop");
  // A touchscreen Windows laptop is still a desktop.
  assert.equal(devicePlatform({ userAgent: WINDOWS, maxTouchPoints: 10 }), "desktop");
  assert.equal(devicePlatform({}), "desktop");
  assert.equal(devicePlatform({ userAgent: null, maxTouchPoints: null }), "desktop");
  assert.deepEqual(
    storeLinksFor("desktop").map((link) => link.store),
    ["app-store", "google-play"],
  );
});

test("the store links are the live listings the public site uses", () => {
  const getApp = readFileSync(
    new URL("../../../public_site/get-app.html", import.meta.url),
    "utf8",
  );
  assert.ok(getApp.includes(`href="${APP_STORE_URL}"`));
  assert.ok(getApp.includes(`href="${PLAY_STORE_URL}"`));
});

test("the banner's copy is translated to French", () => {
  const source = readFileSync(
    new URL("../components/get-app-banner.tsx", import.meta.url),
    "utf8",
  );
  const copy = [
    "Follow every shipment in the Laawol app",
    "Get a notification at each step and keep all your orders in one place.",
    ...storeLinksFor("desktop").map((link) => link.label),
  ];
  for (const english of copy.slice(0, 2)) {
    assert.ok(source.includes(english), `banner renders ${english}`);
  }
  for (const english of copy) {
    const french = translateValue(english, "fr");
    assert.notEqual(french, english, `${english} has a French entry`);
    // Convergent: translating the French again leaves it alone.
    assert.equal(translateValue(french, "fr"), french);
  }
});
