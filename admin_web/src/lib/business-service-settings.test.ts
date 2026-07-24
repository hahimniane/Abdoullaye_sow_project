import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildBusinessServiceSettingsPayload,
  businessServiceSettingsFromRow,
  validateBusinessServiceSettings,
} from "./business-service-settings.ts";
import {COUNTRY_CATALOG} from "./country-catalog.ts";
import {TEXT_TRANSLATIONS} from "./french-dom.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("business service settings workspace", () => {
  it("preserves every service-specific setting in one payload", () => {
    const business = {
      id: "business-1",
      addressLine1: "10 Main Street",
      city: "Bronx",
      country: "United States",
      state: "NY",
      enabledServices: ["carSales", "freight", "carParking"],
      carHoldPricingMode: "per_day",
      carHoldFlatFee: 500,
      carHoldDailyRate: 75,
      carHoldMaxDays: 10,
      freightPickupAvailable: true,
      freightPickupModel: "borough",
      freightPickupBoroughPrices: {Bronx: 35, Queens: 45},
      parkingAddressLine1: "20 Lot Avenue",
      parkingCity: "Bronx",
      parkingCountry: "United States",
      parkingState: "NY",
      parkingTotalSpaces: 40,
      parkingBlockedSpaces: 3,
      parkingDailyRate: 25,
      parkingWeeklyRate: 140,
      parkingMonthlyRate: 500,
      parkingMinimumDays: 2,
      parkingPickupAvailable: true,
      parkingPickupFee: 50,
      parkingInstructions: "Use the south gate.",
      parkingLatitude: 40.8,
      parkingLongitude: -73.9,
    };

    const draft = businessServiceSettingsFromRow(business);
    const payload = buildBusinessServiceSettingsPayload(draft, business);

    assert.deepEqual(payload.enabledServices, [
      "carSales",
      "freight",
      "carParking",
    ]);
    assert.equal(payload.carHoldPricingMode, "per_day");
    assert.equal(payload.carHoldDailyRate, 75);
    assert.equal(payload.freightPickupAvailable, true);
    assert.equal(payload.freightPickupModel, "borough");
    assert.deepEqual(payload.freightPickupBoroughPrices, {
      Bronx: 35,
      Queens: 45,
    });
    assert.equal(payload.parkingTotalSpaces, 40);
    assert.equal(payload.parkingPickupAvailable, true);
    assert.equal(payload.parkingPickupFee, 50);
    assert.equal(payload.parkingLatitude, 40.8);
    assert.equal(payload.parkingLongitude, -73.9);
    assert.equal(
      validateBusinessServiceSettings(draft, {isNewYorkBusiness: true}),
      null,
    );
  });

  it("validates only the configuration required by active services", () => {
    const inactiveParking = businessServiceSettingsFromRow({
      id: "business-2",
      enabledServices: ["barrelShipping"],
    });
    assert.equal(
      validateBusinessServiceSettings(inactiveParking, {
        isNewYorkBusiness: false,
      }),
      null,
    );

    const activeParking = {
      ...inactiveParking,
      enabledServices: ["carParking"],
    };
    assert.equal(
      validateBusinessServiceSettings(activeParking, {
        isNewYorkBusiness: false,
      }),
      "Complete the parking location, capacity, and pricing.",
    );
  });

  it("keeps profile details separate and renders settings with coverage", () => {
    const profile = fs.readFileSync(
      path.join(root, "components/business/profile-support-people.tsx"),
      "utf8",
    );
    const consoleSource = fs.readFileSync(
      path.join(root, "components/business-console.tsx"),
      "utf8",
    );
    const profilePanel = profile.slice(
      profile.indexOf("export function BusinessProfilePanel"),
      profile.indexOf("export function BusinessServicesPanel"),
    );

    assert.doesNotMatch(profilePanel, />Services you offer</);
    assert.doesNotMatch(profilePanel, />Freight pickup</);
    assert.match(consoleSource, /<BusinessServicesPanel/);
    assert.match(consoleSource, /<DestinationsPanel/);
    assert.ok(
      consoleSource.indexOf("<BusinessServicesPanel") <
        consoleSource.indexOf("<DestinationsPanel", consoleSource.indexOf("activeTab === \"destinations\"")),
    );
  });

  it("uses the complete shared country catalog and localizes the new workspace", () => {
    const profile = fs.readFileSync(
      path.join(root, "components/business/profile-support-people.tsx"),
      "utf8",
    );
    assert.ok(COUNTRY_CATALOG.length >= 249);
    assert.match(profile, /COUNTRY_CATALOG\.map/);
    assert.match(profile, /options=\{parkingCountryOptions\}/);

    for (const text of [
      "Services & coverage",
      "Select a service to reveal only the settings it needs.",
      "Service rules",
      "Freight · customer pickup",
      "Car parking · facility",
      "Search or choose a country",
      "Save service settings",
      "Country coverage & route pricing",
    ]) {
      assert.ok(TEXT_TRANSLATIONS[text], `Missing French translation: ${text}`);
      assert.notEqual(TEXT_TRANSLATIONS[text], text);
    }
  });
});
