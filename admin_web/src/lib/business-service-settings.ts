import {
  buildFreightSettingsPayload,
  freightSettingsFromRow,
  validateFreightSettings,
  type FreightSettingsDraft,
} from "./freight-categories.ts";
import type { FirestoreRow } from "@/types/admin";

export const BUSINESS_SERVICE_IDS = [
  "barrelShipping",
  "sharedBarrels",
  "freight",
  "carSales",
  "carTransport",
  "carParking",
] as const;

export type BusinessServiceId = (typeof BUSINESS_SERVICE_IDS)[number];

export const PICKUP_PLAN_SERVICES = [
  "barrels",
  "freight",
  "parking",
  "carTransport",
] as const;

export type PickupPlanServiceId = (typeof PICKUP_PLAN_SERVICES)[number];

export const PICKUP_SERVICE_LABELS: Record<PickupPlanServiceId, string> = {
  barrels: "Barrel shipping",
  freight: "Freight",
  parking: "Car parking",
  carTransport: "Car transport",
};

export const PICKUP_SERVICE_BY_BUSINESS_SERVICE: Partial<
  Record<BusinessServiceId, PickupPlanServiceId>
> = {
  barrelShipping: "barrels",
  freight: "freight",
  carParking: "parking",
  carTransport: "carTransport",
};

export type PickupMode = "flat" | "distance" | "borough";

export type PickupConfigDraft = {
  mode: PickupMode;
  flatFee: string;
  baseFee: string;
  perMileFee: string;
  minimumFee: string;
  maxPickupMiles: string;
  originAddress: string;
  boroughPrices: Record<string, string>;
};

export type PickupServiceChoice = "inherit" | "custom" | "off";

/**
 * Whether a service actually takes pickups, and why.
 *
 * Mirrors `resolveServicePickup` in functions/pickup_plan.js exactly,
 * including the part that surprises people: a service with its own settings
 * keeps taking pickups even when the shared plan is switched off, because
 * the server checks the override first and never consults the shared flag.
 * The console has to say what the server will do, not what its own toggle
 * appears to say.
 */
export type PickupServiceState = {
  service: PickupPlanServiceId;
  label: string;
  active: boolean;
  /** Why it is on or off, in the business's own terms. */
  reason: "own-settings" | "shared-plan" | "turned-off" | "shared-plan-off";
};

export function pickupServiceState(
  draft: BusinessServiceSettingsDraft,
  service: PickupPlanServiceId,
): PickupServiceState {
  const label = PICKUP_SERVICE_LABELS[service];
  const choice = draft.pickupServices[service].choice;
  if (choice === "custom") {
    return {service, label, active: true, reason: "own-settings"};
  }
  if (choice === "off") {
    return {service, label, active: false, reason: "turned-off"};
  }
  return draft.pickupEnabled
    ? {service, label, active: true, reason: "shared-plan"}
    : {service, label, active: false, reason: "shared-plan-off"};
}

/**
 * The one-line answer to "so who is actually taking pickups?" - the question
 * a business has to scroll and cross-reference four dropdowns to answer.
 */
export function pickupPlanSummary(
  draft: BusinessServiceSettingsDraft,
  services: readonly PickupPlanServiceId[],
): {taking: string[]; notTaking: string[]} {
  const taking: string[] = [];
  const notTaking: string[] = [];
  for (const service of services) {
    const state = pickupServiceState(draft, service);
    (state.active ? taking : notTaking).push(state.label);
  }
  return {taking, notTaking};
}

export type PickupServiceDraft = {
  choice: PickupServiceChoice;
  config: PickupConfigDraft;
};

export type BusinessServiceSettingsDraft = {
  enabledServices: string[];
  carHoldPricingMode: "flat" | "per_day";
  carHoldFlatFee: string;
  carHoldDailyRate: string;
  carHoldMaxDays: string;
  freightPickupAvailable: boolean;
  freightPickupModel: "distance" | "borough";
  freightPickupBaseFee: string;
  freightPickupPerKm: string;
  freightPickupMinFee: string;
  freightPickupMaxKm: string;
  freightPickupOriginAddress: string;
  freightPickupBoroughPrices: Record<string, string>;
  // What each kind of goods costs, and whether the business pays for a parcel
  // it loses. Both are freight-only, so they ride with the rest of the freight
  // settings rather than in a panel of their own.
  freight: FreightSettingsDraft;
  parkingAddressLine1: string;
  parkingCity: string;
  parkingCountry: string;
  parkingState: string;
  parkingTotalSpaces: string;
  parkingBlockedSpaces: string;
  parkingDailyRate: string;
  parkingWeeklyRate: string;
  parkingMonthlyRate: string;
  parkingMinimumDays: string;
  parkingPickupAvailable: boolean;
  parkingPickupFee: string;
  parkingInstructions: string;
  pickupEnabled: boolean;
  pickupShared: PickupConfigDraft;
  pickupServices: Record<PickupPlanServiceId, PickupServiceDraft>;
};

export const NYC_BOROUGHS = [
  "Bronx",
  "Manhattan",
  "Brooklyn",
  "Queens",
  "Staten Island",
] as const;

function emptyPickupConfigDraft(): PickupConfigDraft {
  return {
    mode: "flat",
    flatFee: "",
    baseFee: "",
    perMileFee: "",
    minimumFee: "",
    maxPickupMiles: "",
    originAddress: "",
    boroughPrices: Object.fromEntries(
      NYC_BOROUGHS.map((borough) => [borough, ""]),
    ),
  };
}

function feeText(value: unknown): string {
  const number = Number(value);
  return Number.isFinite(number) && value !== null && value !== ""
    ? String(number)
    : "";
}

function pickupConfigDraftFrom(raw: unknown): PickupConfigDraft {
  const source = recordValue(raw);
  const draft = emptyPickupConfigDraft();
  const mode = source.mode;
  if (mode === "flat" || mode === "distance" || mode === "borough") {
    draft.mode = mode;
  }
  draft.flatFee = feeText(source.flatFee);
  draft.baseFee = feeText(source.baseFee);
  draft.perMileFee = feeText(source.perMileFee);
  draft.minimumFee = feeText(source.minimumFee);
  draft.maxPickupMiles = feeText(source.maxPickupMiles);
  draft.originAddress = stringValue(source.originAddress);
  const prices = recordValue(source.boroughPrices);
  for (const borough of NYC_BOROUGHS) {
    draft.boroughPrices[borough] = feeText(prices[borough]);
  }
  return draft;
}

function pickupServicesFrom(
  raw: unknown,
): Record<PickupPlanServiceId, PickupServiceDraft> {
  const source = recordValue(raw);
  return Object.fromEntries(
    PICKUP_PLAN_SERVICES.map((service) => {
      const entry = recordValue(source[service]);
      let choice: PickupServiceChoice = "inherit";
      if (entry.inherit === false) {
        choice = entry.enabled === true ? "custom" : "off";
      }
      return [
        service,
        {
          choice,
          config:
            choice === "custom"
              ? pickupConfigDraftFrom(entry)
              : emptyPickupConfigDraft(),
        },
      ];
    }),
  ) as Record<PickupPlanServiceId, PickupServiceDraft>;
}

export function businessServiceSettingsFromRow(
  business?: FirestoreRow | null,
): BusinessServiceSettingsDraft {
  const boroughPrices = recordValue(business?.freightPickupBoroughPrices);
  const pickupPlan = recordValue(business?.pickupPlan);
  const pickupShared = recordValue(pickupPlan.shared);
  return {
    enabledServices: normalizedServices(business?.enabledServices),
    carHoldPricingMode:
      business?.carHoldPricingMode === "per_day" ? "per_day" : "flat",
    carHoldFlatFee: numberText(business?.carHoldFlatFee, "500"),
    carHoldDailyRate: numberText(business?.carHoldDailyRate, "100"),
    carHoldMaxDays: numberText(business?.carHoldMaxDays, "14"),
    freightPickupAvailable: business?.freightPickupAvailable === true,
    freightPickupModel:
      business?.freightPickupModel === "borough" ? "borough" : "distance",
    freightPickupBaseFee: numberText(business?.freightPickupBaseFee),
    freightPickupPerKm: numberText(business?.freightPickupPerKm),
    freightPickupMinFee: numberText(business?.freightPickupMinFee),
    freightPickupMaxKm: numberText(business?.freightPickupMaxKm),
    freightPickupOriginAddress: stringValue(
      business?.freightPickupOriginAddress,
    ),
    freightPickupBoroughPrices: Object.fromEntries(
      NYC_BOROUGHS.map((borough) => [
        borough,
        numberText(boroughPrices[borough]),
      ]),
    ),
    freight: freightSettingsFromRow(business),
    parkingAddressLine1: stringValue(
      business?.parkingAddressLine1 ?? business?.addressLine1,
    ),
    parkingCity: stringValue(business?.parkingCity ?? business?.city),
    parkingCountry: stringValue(
      business?.parkingCountry ?? business?.country,
    ),
    parkingState: stringValue(business?.parkingState ?? business?.state),
    parkingTotalSpaces: numberText(business?.parkingTotalSpaces),
    parkingBlockedSpaces: numberText(business?.parkingBlockedSpaces),
    parkingDailyRate: numberText(business?.parkingDailyRate),
    parkingWeeklyRate: numberText(business?.parkingWeeklyRate),
    parkingMonthlyRate: numberText(business?.parkingMonthlyRate),
    parkingMinimumDays: numberText(business?.parkingMinimumDays, "1"),
    parkingPickupAvailable: business?.parkingPickupAvailable === true,
    parkingPickupFee: numberText(business?.parkingPickupFee),
    parkingInstructions: stringValue(business?.parkingInstructions),
    pickupEnabled: pickupShared.enabled === true,
    pickupShared: pickupConfigDraftFrom(pickupShared),
    pickupServices: pickupServicesFrom(pickupPlan.services),
  };
}

function validatePickupConfig(
  config: PickupConfigDraft,
  options: { isNewYorkBusiness: boolean; label: string },
): string | null {
  const {label} = options;
  if (config.mode === "borough") {
    if (!options.isNewYorkBusiness) {
      return `${label}: pickup by borough is only available to New York businesses.`;
    }
    const hasPrice = NYC_BOROUGHS.some(
      (borough) => config.boroughPrices[borough]?.trim() !== "",
    );
    if (!hasPrice) {
      return `${label}: set a pickup fee for at least one borough.`;
    }
    for (const borough of NYC_BOROUGHS) {
      const text = config.boroughPrices[borough]?.trim() ?? "";
      if (text === "") continue;
      const fee = Number(text);
      if (!Number.isFinite(fee) || fee < 0) {
        return `${label}: enter a valid fee for ${borough}.`;
      }
    }
    return null;
  }

  const cap = Number(config.maxPickupMiles);
  if (!config.maxPickupMiles.trim() || !Number.isFinite(cap) || cap <= 0) {
    return `${label}: the maximum pickup distance (miles) is required.`;
  }
  if (config.mode === "flat") {
    const fee = Number(config.flatFee);
    if (!config.flatFee.trim() || !Number.isFinite(fee) || fee < 0) {
      return `${label}: enter the flat pickup fee.`;
    }
    return null;
  }
  for (const [field, name] of [
    ["baseFee", "base fee"],
    ["perMileFee", "per-mile fee"],
    ["minimumFee", "minimum fee"],
  ] as const) {
    const text = config[field].trim();
    const fee = Number(text);
    if (!text || !Number.isFinite(fee) || fee < 0) {
      return `${label}: enter the ${name}.`;
    }
  }
  if (!config.originAddress.trim()) {
    return `${label}: enter the pickup origin address.`;
  }
  return null;
}

/**
 * Every pickup problem at once, keyed to the block that owns it.
 *
 * The save-blocking check below returns only the first message and shows it
 * at the top of a long page, which leaves the business hunting for which of
 * four collapsible service blocks it meant. These render in place.
 */
export function pickupPlanFieldErrors(
  draft: BusinessServiceSettingsDraft,
  options: { isNewYorkBusiness: boolean },
): {
  shared: string | null;
  services: Partial<Record<PickupPlanServiceId, string>>;
} {
  const shared = draft.pickupEnabled
    ? validatePickupConfig(draft.pickupShared, {
        isNewYorkBusiness: options.isNewYorkBusiness,
        label: "Shared plan",
      })
    : null;
  const services: Partial<Record<PickupPlanServiceId, string>> = {};
  for (const service of PICKUP_PLAN_SERVICES) {
    const entry = draft.pickupServices[service];
    if (entry.choice !== "custom") continue;
    const error = validatePickupConfig(entry.config, {
      isNewYorkBusiness: options.isNewYorkBusiness,
      label: PICKUP_SERVICE_LABELS[service],
    });
    if (error) services[service] = error;
  }
  return {shared, services};
}

export function validatePickupPlanDraft(
  draft: BusinessServiceSettingsDraft,
  options: { isNewYorkBusiness: boolean },
): string | null {
  if (draft.pickupEnabled) {
    const sharedError = validatePickupConfig(draft.pickupShared, {
      isNewYorkBusiness: options.isNewYorkBusiness,
      label: "Shared pickup plan",
    });
    if (sharedError) return sharedError;
  }
  for (const service of PICKUP_PLAN_SERVICES) {
    const entry = draft.pickupServices[service];
    if (entry.choice !== "custom") continue;
    const error = validatePickupConfig(entry.config, {
      isNewYorkBusiness: options.isNewYorkBusiness,
      label: `${PICKUP_SERVICE_LABELS[service]} pickup`,
    });
    if (error) return error;
  }
  return null;
}

function pickupConfigPayload(config: PickupConfigDraft) {
  const payload: Record<string, unknown> = {
    enabled: true,
    mode: config.mode,
  };
  if (config.mode === "borough") {
    payload.boroughPrices = Object.fromEntries(
      NYC_BOROUGHS.flatMap((borough) => {
        const text = config.boroughPrices[borough]?.trim() ?? "";
        return text === "" ? [] : [[borough, Number(text)]];
      }),
    );
    return payload;
  }
  payload.maxPickupMiles = Number(config.maxPickupMiles);
  if (config.mode === "flat") {
    payload.flatFee = Number(config.flatFee);
  } else {
    payload.baseFee = Number(config.baseFee);
    payload.perMileFee = Number(config.perMileFee);
    payload.minimumFee = Number(config.minimumFee);
    payload.originAddress = config.originAddress.trim();
  }
  if (config.mode === "flat" && config.originAddress.trim()) {
    payload.originAddress = config.originAddress.trim();
  }
  return payload;
}

export function buildPickupPlanPayload(
  draft: BusinessServiceSettingsDraft,
  business?: FirestoreRow | null,
): Record<string, unknown> | undefined {
  const hasStoredPlan =
    business?.pickupPlan && typeof business.pickupPlan === "object";
  const hasExplicitService = PICKUP_PLAN_SERVICES.some(
    (service) => draft.pickupServices[service].choice !== "inherit",
  );
  // A business that has never configured pickup keeps no plan at all -
  // sending a disabled plan would be a pointless write.
  if (!hasStoredPlan && !draft.pickupEnabled && !hasExplicitService) {
    return undefined;
  }
  const services: Record<string, unknown> = {};
  for (const service of PICKUP_PLAN_SERVICES) {
    const entry = draft.pickupServices[service];
    if (entry.choice === "inherit") {
      // An absent key already inherits; only record the explicit choices.
      const stored = recordValue(recordValue(business?.pickupPlan).services);
      if (recordValue(stored[service]).inherit === true) {
        services[service] = {inherit: true};
      }
      continue;
    }
    if (entry.choice === "off") {
      services[service] = {enabled: false};
      continue;
    }
    services[service] = pickupConfigPayload(entry.config);
  }
  return {
    shared: draft.pickupEnabled
      ? pickupConfigPayload(draft.pickupShared)
      : {enabled: false},
    services,
  };
}

export function validateBusinessServiceSettings(
  draft: BusinessServiceSettingsDraft,
  options: { isNewYorkBusiness: boolean },
): string | null {
  if (draft.enabledServices.length === 0) {
    return "Select at least one service.";
  }

  if (draft.enabledServices.includes("carSales")) {
    const holdFlatFee = numberValue(draft.carHoldFlatFee);
    const holdDailyRate = numberValue(draft.carHoldDailyRate);
    const holdMaxDays = numberValue(draft.carHoldMaxDays);
    if (
      (draft.carHoldPricingMode === "flat" && holdFlatFee <= 0) ||
      (draft.carHoldPricingMode === "per_day" && holdDailyRate <= 0) ||
      !Number.isInteger(holdMaxDays) ||
      holdMaxDays < 1 ||
      holdMaxDays > 30
    ) {
      return "Enter valid paid hold pricing.";
    }
  }

  const pickupError = validatePickupPlanDraft(draft, options);
  if (pickupError) return pickupError;

  if (draft.enabledServices.includes("freight")) {
    const freightError = validateFreightSettings(draft.freight);
    if (freightError) return freightError;
  }

  if (draft.enabledServices.includes("carParking")) {
    const totalSpaces = numberValue(draft.parkingTotalSpaces);
    const blockedSpaces = numberValue(draft.parkingBlockedSpaces);
    const dailyRate = numberValue(draft.parkingDailyRate);
    const minimumDays = numberValue(draft.parkingMinimumDays);
    const weeklyRate = numberValue(draft.parkingWeeklyRate);
    const monthlyRate = numberValue(draft.parkingMonthlyRate);
    const pickupFee = numberValue(draft.parkingPickupFee);
    const needsState =
      draft.parkingCountry.trim() === "United States" &&
      !draft.parkingState.trim();
    if (
      !draft.parkingAddressLine1.trim() ||
      !draft.parkingCountry.trim() ||
      needsState ||
      !draft.parkingCity.trim() ||
      !Number.isInteger(totalSpaces) ||
      totalSpaces < 1 ||
      !Number.isInteger(blockedSpaces) ||
      blockedSpaces < 0 ||
      blockedSpaces > totalSpaces ||
      dailyRate <= 0 ||
      weeklyRate < 0 ||
      monthlyRate < 0 ||
      !Number.isInteger(minimumDays) ||
      minimumDays < 1 ||
      (draft.parkingPickupAvailable && pickupFee < 0)
    ) {
      return "Complete the parking location, capacity, and pricing.";
    }
  }

  return null;
}

export function buildBusinessServiceSettingsPayload(
  draft: BusinessServiceSettingsDraft,
  business?: FirestoreRow | null,
) {
  const businessIsNewYork = isNewYorkState(business?.state);
  const freightPickupModel =
    draft.freightPickupModel === "borough" && businessIsNewYork
      ? "borough"
      : "distance";
  const freightPickupBoroughPrices = Object.fromEntries(
    NYC_BOROUGHS.flatMap((borough) => {
      const fee = numberValue(draft.freightPickupBoroughPrices[borough]);
      return fee > 0 ? [[borough, fee]] : [];
    }),
  );
  const parkingLocationFields: Array<[unknown, string]> = [
    [business?.parkingAddressLine1 ?? business?.addressLine1, draft.parkingAddressLine1],
    [business?.parkingCountry ?? business?.country, draft.parkingCountry],
    [business?.parkingState ?? business?.state, draft.parkingState],
    [business?.parkingCity ?? business?.city, draft.parkingCity],
  ];
  const parkingLocationChanged = parkingLocationFields.some(
    ([current, next]) => stringValue(current) !== next.trim(),
  );
  const pickupPlan = buildPickupPlanPayload(draft, business);
  // Category prices and the loss policy belong to freight. A business that
  // does not offer it sends neither, so turning freight off for a season keeps
  // the prices it spent time setting rather than resetting them to nothing.
  const freight = draft.enabledServices.includes("freight")
    ? buildFreightSettingsPayload(draft.freight)
    : undefined;

  return {
    ...(pickupPlan === undefined ? {} : {pickupPlan}),
    ...(freight === undefined ? {} : freight),
    enabledServices: normalizedServices(draft.enabledServices),
    carHoldPricingMode: draft.carHoldPricingMode,
    carHoldFlatFee: numberValue(draft.carHoldFlatFee),
    carHoldDailyRate: numberValue(draft.carHoldDailyRate),
    carHoldMaxDays: numberValue(draft.carHoldMaxDays),
    freightPickupAvailable:
      draft.enabledServices.includes("freight") &&
      draft.freightPickupAvailable,
    freightPickupModel,
    freightPickupBaseFee: nonNegative(draft.freightPickupBaseFee),
    freightPickupPerKm: nonNegative(draft.freightPickupPerKm),
    freightPickupMinFee: nonNegative(draft.freightPickupMinFee),
    freightPickupMaxKm: nonNegative(draft.freightPickupMaxKm),
    freightPickupOriginAddress: draft.freightPickupOriginAddress.trim(),
    freightPickupBoroughPrices,
    parkingAddressLine1: draft.parkingAddressLine1.trim(),
    parkingCity: draft.parkingCity.trim(),
    parkingCountry: draft.parkingCountry.trim(),
    parkingState: draft.parkingState.trim(),
    parkingTotalSpaces: Math.max(
      0,
      Math.trunc(numberValue(draft.parkingTotalSpaces)),
    ),
    parkingBlockedSpaces: Math.max(
      0,
      Math.trunc(numberValue(draft.parkingBlockedSpaces)),
    ),
    parkingDailyRate: nonNegative(draft.parkingDailyRate),
    parkingWeeklyRate: nonNegative(draft.parkingWeeklyRate),
    parkingMonthlyRate: nonNegative(draft.parkingMonthlyRate),
    parkingMinimumDays: Math.max(
      1,
      Math.trunc(numberValue(draft.parkingMinimumDays) || 1),
    ),
    parkingPickupAvailable:
      draft.enabledServices.includes("carParking") &&
      draft.parkingPickupAvailable,
    parkingPickupFee: nonNegative(draft.parkingPickupFee),
    parkingInstructions: draft.parkingInstructions.trim(),
    parkingLatitude: parkingLocationChanged
      ? null
      : nullableNumber(business?.parkingLatitude),
    parkingLongitude: parkingLocationChanged
      ? null
      : nullableNumber(business?.parkingLongitude),
  };
}

export function isNewYorkState(value: unknown): boolean {
  const normalized = stringValue(value).toUpperCase();
  return normalized === "NY" || normalized === "NEW YORK";
}

function normalizedServices(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (item): item is BusinessServiceId =>
          typeof item === "string" &&
          BUSINESS_SERVICE_IDS.includes(item as BusinessServiceId),
      ),
    ),
  ];
}

function numberText(value: unknown, fallback = "0"): string {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : fallback;
}

function numberValue(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function nonNegative(value: unknown): number {
  return Math.max(0, numberValue(value));
}

function nullableNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
