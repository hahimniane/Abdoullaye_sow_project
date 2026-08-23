import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildBusinessServiceSettingsPayload,
  businessServiceSettingsFromRow,
  buildPickupPlanPayload,
  pickupPlanFieldErrors,
  pickupPlanSummary,
  pickupServiceState,
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

  it("sends the freight coverage answer, and no delivery fee at all", () => {
    const draft = businessServiceSettingsFromRow({
      id: "business-9",
      enabledServices: ["freight"],
      freightCoverageEnabled: true,
      // Numbers a business set under a priced-coverage policy. They must not
      // survive into the payload: cover is free, and re-sending a rate would
      // put a charge back on a customer's bill.
      freightCoverageRatePct: 2,
      freightMaxDeclaredValue: 2000,
    });
    const payload = buildBusinessServiceSettingsPayload(draft) as Record<
      string,
      unknown
    >;
    assert.deepEqual(payload.freightCoverage, {coversLoss: true});
    assert.doesNotMatch(JSON.stringify(payload), /ratePct|maxDeclaredValue/);
    // Delivering to the receiver is priced per route, so this payload must
    // carry nothing that could outrank what a destination country says.
    assert.doesNotMatch(
      JSON.stringify(payload),
      /freightDestinationDelivery|destinationDeliveryFee/,
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
      "Use shared plan",
      "Custom settings",
      "No pickup",
      "Maximum pickup distance (miles) — required",
      "Use one shared plan",
      "Follow the shared plan",
      "Set its own pickup fees",
      "No pickup for this service",
      "Each service, one at a time",
      "Taking pickups:",
      "No pickup: the shared plan above is off. Turn it on, or give this service its own fees.",
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

describe("who is actually taking pickups", () => {
  function draftWith(plan: unknown) {
    return businessServiceSettingsFromRow({
      id: "pickup-business",
      enabledServices: ["barrelShipping", "freight", "carTransport"],
      pickupPlan: plan,
    });
  }

  // Shaped the way the server stores it: normalizePickupPlan always stamps
  // inherit:false onto an override, and that flag is what marks it as this
  // service's own settings rather than a copy of the shared plan.
  const barrelOnly = {
    shared: {enabled: false},
    services: {
      barrels: {
        inherit: false,
        enabled: true,
        mode: "distance",
        maxPickupMiles: 30,
        baseFee: 10,
        perMileFee: 2,
        minimumFee: 15,
        originAddress: "100 Test Avenue, Bronx, NY",
      },
    },
  };

  it("keeps a service's own settings live when the shared plan is off", () => {
    // The server checks the override first and never reads the shared flag,
    // so a console that called this "off" would be describing a business
    // that is, in fact, still taking barrel pickups.
    const draft = draftWith(barrelOnly);
    assert.equal(draft.pickupEnabled, false);
    const barrels = pickupServiceState(draft, "barrels");
    assert.equal(barrels.active, true);
    assert.equal(barrels.reason, "own-settings");
  });

  it("says a service following a disabled plan takes no pickups", () => {
    // The silent dead end: the dropdown reads "follow the shared plan" and
    // means nothing at all when that plan is switched off.
    const state = pickupServiceState(draftWith(barrelOnly), "freight");
    assert.equal(state.active, false);
    assert.equal(state.reason, "shared-plan-off");
  });

  it("summarises both sides so nobody cross-references four dropdowns", () => {
    const summary = pickupPlanSummary(draftWith(barrelOnly), [
      "barrels",
      "freight",
      "carTransport",
    ]);
    assert.deepEqual(summary.taking, ["Barrel shipping"]);
    assert.deepEqual(summary.notTaking, ["Freight", "Car transport"]);
  });

  it("distinguishes turned-off from following a disabled plan", () => {
    const draft = draftWith({
      shared: {enabled: false},
      services: {freight: {inherit: false, enabled: false}},
    });
    assert.equal(pickupServiceState(draft, "freight").reason, "turned-off");
  });

  it("reports every problem against the block that owns it", () => {
    // One message at the top of a long page left the business hunting for
    // which of four service blocks it meant.
    const draft = draftWith({
      shared: {enabled: false},
      services: {
        barrels: {
          inherit: false,
          enabled: true,
          mode: "distance",
          maxPickupMiles: 0,
        },
      },
    });
    const errors = pickupPlanFieldErrors(draft, {isNewYorkBusiness: false});
    assert.equal(errors.shared, null);
    assert.match(
      String(errors.services.barrels),
      /Barrel shipping: the maximum pickup distance/,
    );
  });

  it("does not fault a shared plan nobody is being asked to use", () => {
    const errors = pickupPlanFieldErrors(draftWith(barrelOnly), {
      isNewYorkBusiness: false,
    });
    assert.equal(errors.shared, null);
    assert.deepEqual(errors.services, {});
  });
});

describe("the pickup card says what it controls", () => {
  const source = fs.readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "components",
      "business",
      "profile-support-people.tsx",
    ),
    "utf8",
  );

  it("never labels the shared switch as if it governed every service", () => {
    // "Pickup off" over live per-service settings was the whole confusion.
    assert.ok(!source.includes('"Pickup on" : "Pickup off"'));
    assert.ok(source.includes("Use one shared plan"));
  });

  it("shows the effective state and the dead-end warning", () => {
    assert.ok(source.includes("pickupSummary.taking"));
    assert.ok(source.includes('state.reason === "shared-plan-off"'));
  });

  it("nests a service's own fees under that service", () => {
    assert.ok(source.includes("pickup-service-block"));
  });

  it("renders each pickup error where it happened", () => {
    assert.ok(source.includes("pickupErrors.services[service]"));
    assert.ok(source.includes("pickupErrors.shared"));
  });
});
