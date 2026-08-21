import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildBusinessServiceSettingsPayload,
  businessServiceSettingsFromRow,
  buildPickupPlanPayload,
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

  it("round-trips a stored pickup plan without changing it", () => {
    const business = {
      id: "business-pickup",
      state: "NY",
      enabledServices: ["barrelShipping", "freight"],
      pickupPlan: {
        version: 1,
        shared: {
          enabled: true,
          mode: "borough",
          boroughPrices: {Bronx: 40, Brooklyn: 108},
        },
        services: {
          freight: {inherit: true},
          parking: {
            inherit: false,
            enabled: true,
            mode: "flat",
            flatFee: 25,
            maxPickupMiles: 15,
          },
          carTransport: {inherit: false, enabled: false},
        },
      },
    };
    const draft = businessServiceSettingsFromRow(business);
    assert.equal(draft.pickupEnabled, true);
    assert.equal(draft.pickupShared.mode, "borough");
    assert.equal(draft.pickupShared.boroughPrices.Bronx, "40");
    assert.equal(draft.pickupServices.freight.choice, "inherit");
    assert.equal(draft.pickupServices.parking.choice, "custom");
    assert.equal(draft.pickupServices.carTransport.choice, "off");

    const plan = buildPickupPlanPayload(draft, business);
    assert.deepEqual(plan, {
      shared: {
        enabled: true,
        mode: "borough",
        boroughPrices: {Bronx: 40, Brooklyn: 108},
      },
      services: {
        freight: {inherit: true},
        parking: {
          enabled: true,
          mode: "flat",
          flatFee: 25,
          maxPickupMiles: 15,
        },
        carTransport: {enabled: false},
      },
    });
    assert.equal(
      validateBusinessServiceSettings(draft, {isNewYorkBusiness: true}),
      null,
    );
  });

  it("omits the pickup plan for a business that never configured one", () => {
    const draft = businessServiceSettingsFromRow({
      id: "business-no-plan",
      enabledServices: ["barrelShipping"],
    });
    assert.equal(buildPickupPlanPayload(draft, {id: "b"}), undefined);
    const payload = buildBusinessServiceSettingsPayload(draft, {id: "b"});
    assert.equal("pickupPlan" in payload, false);
  });

  it("requires the travel cap and complete fees before saving a plan", () => {
    const base = businessServiceSettingsFromRow({
      id: "business-3",
      enabledServices: ["barrelShipping"],
    });
    const missingCap = {
      ...base,
      pickupEnabled: true,
      pickupShared: {...base.pickupShared, mode: "flat" as const, flatFee: "30"},
    };
    assert.equal(
      validateBusinessServiceSettings(missingCap, {isNewYorkBusiness: false}),
      "Shared pickup plan: the maximum pickup distance (miles) is required.",
    );

    const boroughOutsideNy = {
      ...base,
      pickupEnabled: true,
      pickupShared: {...base.pickupShared, mode: "borough" as const},
    };
    assert.equal(
      validateBusinessServiceSettings(boroughOutsideNy, {
        isNewYorkBusiness: false,
      }),
      "Shared pickup plan: pickup by borough is only available to New York businesses.",
    );

    const customServiceIncomplete = {
      ...base,
      pickupServices: {
        ...base.pickupServices,
        barrels: {
          choice: "custom" as const,
          config: {
            ...base.pickupServices.barrels.config,
            mode: "distance" as const,
            maxPickupMiles: "20",
            baseFee: "10",
            perMileFee: "2",
            minimumFee: "15",
          },
        },
      },
    };
    assert.equal(
      validateBusinessServiceSettings(customServiceIncomplete, {
        isNewYorkBusiness: false,
      }),
      "Barrel shipping pickup: enter the pickup origin address.",
    );
  });

  it("sends the freight coverage answer and the delivery offer, nothing else", () => {
    const draft = businessServiceSettingsFromRow({
      id: "business-9",
      enabledServices: ["freight"],
      freightCoverageEnabled: true,
      // Numbers a business set under a priced-coverage policy. They must not
      // survive into the payload: cover is free, and re-sending a rate would
      // put a charge back on a customer's bill.
      freightCoverageRatePct: 2,
      freightMaxDeclaredValue: 2000,
      freightDestinationDeliveryAvailable: true,
      freightDestinationDeliveryFee: 15,
    });
    const payload = buildBusinessServiceSettingsPayload(draft) as Record<
      string,
      unknown
    >;
    assert.deepEqual(payload.freightCoverage, {coversLoss: true});
    assert.deepEqual(payload.freightDestinationDelivery, {
      available: true,
      fee: 15,
    });
    assert.doesNotMatch(JSON.stringify(payload), /ratePct|maxDeclaredValue/);

    // An opted-in business with no fee is an unfinished setting, and the
    // console refuses it here rather than letting the callable do it.
    assert.equal(
      validateBusinessServiceSettings(
        {
          ...draft,
          freight: {...draft.freight, destinationDeliveryFee: ""},
        },
        {isNewYorkBusiness: false},
      ),
      "Set a delivery fee, or turn destination delivery off.",
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
      "Home pickup · all services",
      "One pickup plan applies to every service you offer. Any service can use its own settings below.",
      "Use shared plan",
      "Custom settings",
      "No pickup",
      "Maximum pickup distance (miles) — required",
      "Shared pickup plan: the maximum pickup distance (miles) is required.",
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
