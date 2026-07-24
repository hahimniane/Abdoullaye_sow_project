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
};

export const NYC_BOROUGHS = [
  "Bronx",
  "Manhattan",
  "Brooklyn",
  "Queens",
  "Staten Island",
] as const;

export function businessServiceSettingsFromRow(
  business?: FirestoreRow | null,
): BusinessServiceSettingsDraft {
  const boroughPrices = recordValue(business?.freightPickupBoroughPrices);
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

  if (
    draft.enabledServices.includes("freight") &&
    draft.freightPickupAvailable &&
    draft.freightPickupModel === "borough" &&
    options.isNewYorkBusiness &&
    !NYC_BOROUGHS.some(
      (borough) =>
        numberValue(draft.freightPickupBoroughPrices[borough]) > 0,
    )
  ) {
    return "Set a pickup fee for at least one borough, or turn off freight pickup.";
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

  return {
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
