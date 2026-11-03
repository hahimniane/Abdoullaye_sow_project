// The business console's price list (docs/PACKAGE_PRICE_LIST.md §6): the page
// is wired to the server's callables, every sentence it shows has its French,
// and the Laawol admin console mounts the same editor.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { businessTargetForNotification } from "./notification-routing.ts";
import { ATTRIBUTE_TRANSLATIONS, TEXT_TRANSLATIONS, translateValue } from "./french-dom.ts";
import { PRICE_LIST_MESSAGES } from "./package-price-list.ts";
import { PRICE_LIST_GENERIC_ERROR, PRICE_LIST_NETWORK_ERROR } from "./business-price-list.ts";
import { screenStrings } from "./screen-strings.ts";
import { shippingStepForTab, shippingSteps } from "./business-sidebar.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function hasFrench(english: string): boolean {
  return english in TEXT_TRANSLATIONS || english in ATTRIBUTE_TRANSLATIONS;
}

test("every sentence on the price list page has its French, and round-trips", () => {
  const strings = screenStrings(read("components/business/price-list-panel.tsx"), "price-list-panel.tsx");
  assert.ok(strings.includes("Price list"), "the scan reads the page");
  assert.ok(strings.includes("Looks right"), "the scan reads the banner");
  const missing = strings.filter((s) => !hasFrench(s));
  assert.deepEqual(missing, []);
  for (const english of strings) {
    const french = translateValue(english, "fr");
    assert.notEqual(french, english, english);
    assert.equal(translateValue(french, "en"), english, `"${english}" does not round-trip`);
  }
});

test("every refusal the server can give has French, and so do our own", () => {
  const sentences = [...Object.values(PRICE_LIST_MESSAGES), PRICE_LIST_GENERIC_ERROR, PRICE_LIST_NETWORK_ERROR, "Only the business owner can change the price list."];
  // The generic ones are shared with the request screens, which translate them whole.
  assert.deepEqual(sentences.filter((s) => !hasFrench(s) && translateValue(s, "fr") === s), []);
  assert.deepEqual(Object.values(PRICE_LIST_MESSAGES).filter((s) => !hasFrench(s)), []);
});

test("the page saves the whole map and says Looks right through the settings callable", () => {
  const source = read("components/business/price-list-panel.tsx");
  assert.match(source, /"setPackageRequestSettings"/);
  assert.match(source, /action: "price_list", \.\.\.listPayload\(draft\)/);
  assert.match(source, /action: "price_list_checked"/);
  // The server keeps a Laawol admin from saying "Looks right" for a business.
  assert.match(source, /!byLaawol && canEdit/);
});

test("Price list is a Shipping step behind the Containers permission; the notification opens it", () => {
  const step = shippingSteps.find((entry) => entry.id === "priceList");
  assert.ok(step);
  assert.equal(step.permission, "containers");
  assert.equal(step.flow, false);
  assert.equal(shippingStepForTab("containers", "priceList"), "priceList");
  assert.deepEqual(businessTargetForNotification({ type: "package_price_list" } as never), {
    tab: "containers",
    panelView: "priceList",
  });
  const console = read("components/business-console.tsx");
  assert.match(console, /activeShippingStep === "priceList"/);
});

test("the Laawol admin console mounts the same editor, saving for the business", () => {
  const admin = read("components/admin-console.tsx");
  assert.match(admin, /<PriceListPanel businessId=\{business\.id\} canEdit byLaawol \/>/);
});

test("Coming today, the weigh-in, the planned departure and Found on Laawol are wired in", () => {
  const requests = read("components/business/package-requests-panel.tsx");
  assert.match(requests, /comingToday\(expected, todayKey\)/);
  assert.match(requests, /weighedPriceInput\(price, typed, l\)/);
  assert.match(requests, /useState<PackageShipMode>\(requestMode\)/);
  const containers = read("components/business/containers-panel.tsx");
  assert.match(containers, /plannedDepartureDate: e\.target\.value/);
  assert.match(containers, /plannedDepartureText\(row\.plannedDepartureDate, lang\)/);
  const volume = read("components/volume-views.tsx");
  assert.match(volume, /laawolLinesOf\(row\)/);
});
