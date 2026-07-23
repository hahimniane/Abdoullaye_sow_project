export type MarketplaceDisclosurePayload = {
  accepted: true;
  version: string;
  locale: string;
};

export type PickupDetails = {
  requested: boolean;
  address: string;
  borough: string;
  dateTime?: string;
};

export const NYC_PICKUP_BOROUGHS = [
  "Bronx",
  "Manhattan",
  "Queens",
  "Brooklyn",
  "Staten Island",
] as const;

export type NycPickupBorough = (typeof NYC_PICKUP_BOROUGHS)[number];

export type BarrelPickupPricing = {
  officeAddress: string;
  boroughPrices: Record<NycPickupBorough, number>;
};

export const DEFAULT_BARREL_PICKUP_PRICING: BarrelPickupPricing = {
  officeAddress: "Bronx, NY",
  boroughPrices: {
    Bronx: 40,
    Manhattan: 64,
    Queens: 84,
    Brooklyn: 108,
    "Staten Island": 148,
  },
};

export type BarrelShipmentFields = {
  senderName: string;
  receiverName: string;
  receiverPhone: string;
  destinationCountryId: string;
  businessId: string;
  quantity: number;
  pickup: PickupDetails;
  useWalletBalance: boolean;
};

export type FreightShipmentFields = {
  senderName: string;
  receiverName: string;
  receiverPhone: string;
  destinationCountryId: string;
  businessId: string;
  mode: "air" | "sea";
  weightKg: number;
  pickup: PickupDetails;
  useWalletBalance: boolean;
};

export type TransportRequestFields = {
  businessId: string;
  destinationCountryId: string;
  destinationCountryName: string;
  ownerName: string;
  carMake: string;
  carModel: string;
  carYear: string;
  customerPhone: string;
  vinNumber: string;
  pickupAddress: string;
  notes: string;
  preferredDate?: string;
};

export type ShippingPricingCountry = {
  id?: string;
  code?: string;
  name?: string;
  barrelShippingPrice?: unknown;
  freightAirPricePerKg?: unknown;
  freightSeaPricePerKg?: unknown;
  serviceAvailability?: {
    barrelShipping?: boolean;
    freightAir?: boolean;
    freightSea?: boolean;
  };
};

export type FreightMode = "air" | "sea";

const SHIPPING_REGION_NAMES = {
  en: new Intl.DisplayNames(["en"], { type: "region" }),
  fr: new Intl.DisplayNames(["fr"], { type: "region" }),
} as const;

export type ShippingDestinationOption = {
  id: string;
  businessId: string;
  businessName: string;
  country: ShippingPricingCountry & {
    id: string;
    name: string;
  };
};

function trimmed(value: string) {
  return value.trim();
}

function positiveFinite(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function shippingCountryDisplayName(
  country: Pick<ShippingPricingCountry, "code" | "name">,
  language: "en" | "fr",
) {
  const code = String(country.code || "").trim().toUpperCase();
  return (
    (code && SHIPPING_REGION_NAMES[language].of(code)) ||
    String(country.name || "").trim()
  );
}

export function shippingProviderRate(
  country: ShippingPricingCountry,
  service: "barrel" | "freight",
  mode: FreightMode = "air",
) {
  if (service === "barrel") {
    if (country.serviceAvailability?.barrelShipping === false) return null;
    return positiveFinite(country.barrelShippingPrice);
  }

  const availability =
    mode === "air"
      ? country.serviceAvailability?.freightAir
      : country.serviceAvailability?.freightSea;
  if (availability === false) return null;
  return positiveFinite(
    mode === "air"
      ? country.freightAirPricePerKg
      : country.freightSeaPricePerKg,
  );
}

export function barrelShippingEstimate(
  country: ShippingPricingCountry,
  quantity: unknown,
) {
  const rate = shippingProviderRate(country, "barrel");
  const units = Number(quantity);
  if (!rate || !Number.isInteger(units) || units <= 0) return null;
  return {
    rate,
    quantity: units,
    subtotal: rate * units,
  };
}

export function barrelDestinationCountries(
  options: readonly ShippingDestinationOption[],
) {
  const countries = new Map<
    string,
    ShippingDestinationOption["country"]
  >();
  for (const option of options.filter(barrelOptionIsEligible)) {
    if (!countries.has(option.country.id)) {
      countries.set(option.country.id, option.country);
    }
  }
  return [...countries.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export function barrelProvidersForCountry(
  options: readonly ShippingDestinationOption[],
  countryId: string,
) {
  return options
    .filter(
      (option) =>
        option.country.id === countryId && barrelOptionIsEligible(option),
    )
    .sort((left, right) =>
      left.businessName.localeCompare(right.businessName),
    );
}

function barrelOptionIsEligible(option: ShippingDestinationOption) {
  return shippingProviderRate(option.country, "barrel") !== null;
}

const NYC_BOROUGHS = new Set(
  NYC_PICKUP_BOROUGHS.map((borough) => borough.toLowerCase()),
);

function zipInRange(value: string, start: number, end: number) {
  for (const match of value.matchAll(/\b\d{5}\b/g)) {
    const zip = Number(match[0]);
    if (zip >= start && zip <= end) return true;
  }
  return false;
}

export function nycBoroughFromAddress(value: string): NycPickupBorough | null {
  const normalized = value.toLowerCase();
  if (normalized.includes("bronx") || zipInRange(normalized, 10400, 10499)) {
    return "Bronx";
  }
  if (
    normalized.includes("manhattan") ||
    normalized.includes("new york, ny") ||
    zipInRange(normalized, 10000, 10299)
  ) {
    return "Manhattan";
  }
  if (
    normalized.includes("brooklyn") ||
    zipInRange(normalized, 11200, 11299)
  ) {
    return "Brooklyn";
  }
  if (
    normalized.includes("queens") ||
    normalized.includes("jamaica") ||
    normalized.includes("flushing") ||
    zipInRange(normalized, 11000, 11199) ||
    zipInRange(normalized, 11300, 11699)
  ) {
    return "Queens";
  }
  if (
    normalized.includes("staten island") ||
    zipInRange(normalized, 10300, 10399)
  ) {
    return "Staten Island";
  }
  return null;
}

export function barrelPickupPricingFromData(
  value: unknown,
): BarrelPickupPricing {
  const data =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const rawPrices =
    data.boroughPrices && typeof data.boroughPrices === "object"
      ? (data.boroughPrices as Record<string, unknown>)
      : {};
  const boroughPrices = { ...DEFAULT_BARREL_PICKUP_PRICING.boroughPrices };
  const rawMiles =
    data.boroughMiles && typeof data.boroughMiles === "object"
      ? (data.boroughMiles as Record<string, unknown>)
      : null;
  if (rawMiles) {
    const baseFee = Number.isFinite(Number(data.basePickupFee))
      ? Number(data.basePickupFee)
      : 20;
    const perMileFee = Number.isFinite(Number(data.perMileFee))
      ? Number(data.perMileFee)
      : 4;
    const minimumFee = Number.isFinite(Number(data.minimumPickupFee))
      ? Number(data.minimumPickupFee)
      : 35;
    for (const borough of NYC_PICKUP_BOROUGHS) {
      const miles = Number(rawMiles[borough]);
      if (Number.isFinite(miles) && miles >= 0) {
        boroughPrices[borough] = Math.max(
          baseFee + miles * perMileFee,
          minimumFee,
        );
      }
    }
  }
  for (const borough of NYC_PICKUP_BOROUGHS) {
    const price = Number(rawPrices[borough]);
    if (Number.isFinite(price) && price > 0) {
      boroughPrices[borough] = price;
    }
  }
  const officeAddress =
    typeof data.officeAddress === "string" && data.officeAddress.trim()
      ? data.officeAddress.trim()
      : DEFAULT_BARREL_PICKUP_PRICING.officeAddress;
  return { boroughPrices, officeAddress };
}

export function barrelPickupFee(
  pricing: BarrelPickupPricing,
  borough: string,
) {
  const canonical = NYC_PICKUP_BOROUGHS.find(
    (option) => option.toLowerCase() === borough.trim().toLowerCase(),
  );
  return canonical ? pricing.boroughPrices[canonical] : null;
}

export function barrelShipmentEstimate({
  country,
  pickupBorough,
  pickupPricing,
  pickupRequested,
  quantity,
}: {
  country: ShippingPricingCountry;
  pickupBorough: string;
  pickupPricing: BarrelPickupPricing | null;
  pickupRequested: boolean;
  quantity: unknown;
}) {
  const shipping = barrelShippingEstimate(country, quantity);
  if (!shipping) return null;
  const pickupFee = pickupRequested
    ? pickupPricing
      ? barrelPickupFee(pickupPricing, pickupBorough)
      : null
    : 0;
  return {
    ...shipping,
    pickupFee,
    total: pickupFee === null ? null : shipping.subtotal + pickupFee,
  };
}

export function pickupDetailsAreComplete(
  pickup: PickupDetails,
  now = Date.now(),
) {
  if (!pickup.requested) return true;
  const detectedBorough = nycBoroughFromAddress(pickup.address);
  const pickupTime = pickup.dateTime
    ? new Date(pickup.dateTime).getTime()
    : Number.NaN;
  return Boolean(
    pickup.address.trim() &&
      detectedBorough &&
      detectedBorough.toLowerCase() === pickup.borough.trim().toLowerCase() &&
      NYC_BOROUGHS.has(pickup.borough.trim().toLowerCase()) &&
      Number.isFinite(pickupTime) &&
      pickupTime > now,
  );
}

export function localDateTimeInputValue(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

export function freightShippingEstimate({
  country,
  mode,
  pickupQuote,
  pickupRequested,
  weightKg,
}: {
  country: ShippingPricingCountry;
  mode: FreightMode;
  pickupQuote?: unknown;
  pickupRequested: boolean;
  weightKg: unknown;
}) {
  const rate = shippingProviderRate(country, "freight", mode);
  const weight = Number(weightKg);
  if (!rate || !Number.isFinite(weight) || weight <= 0) return null;

  const subtotal = rate * weight;
  const normalizedPickupQuote =
    pickupQuote === undefined || pickupQuote === null
      ? null
      : Number(pickupQuote);
  const pickupFee =
    normalizedPickupQuote !== null &&
    Number.isFinite(normalizedPickupQuote) &&
    normalizedPickupQuote >= 0
      ? normalizedPickupQuote
      : null;
  const pickupPending = pickupRequested && pickupFee === null;

  return {
    rate,
    weightKg: weight,
    subtotal,
    pickupFee: pickupRequested ? pickupFee : 0,
    pickupPending,
    total: pickupPending ? null : subtotal + (pickupFee ?? 0),
  };
}

function pickupPayload(pickup: PickupDetails) {
  return {
    pickupRequested: pickup.requested,
    ...(pickup.requested && {
      pickupAddress: trimmed(pickup.address),
      pickupBorough: trimmed(pickup.borough),
      ...(pickup.dateTime && { pickupDateTime: pickup.dateTime }),
    }),
  };
}

export function buildBarrelShipmentPayload(
  fields: BarrelShipmentFields,
  disclosure: MarketplaceDisclosurePayload,
) {
  return {
    senderName: trimmed(fields.senderName),
    receiverName: trimmed(fields.receiverName),
    receiverPhone: trimmed(fields.receiverPhone),
    destinationCountryId: trimmed(fields.destinationCountryId),
    businessId: trimmed(fields.businessId),
    quantity: fields.quantity,
    ...pickupPayload(fields.pickup),
    useWalletBalance: fields.useWalletBalance,
    marketplaceDisclosure: disclosure,
  };
}

export function buildFreightShipmentPayload(
  fields: FreightShipmentFields,
  disclosure: MarketplaceDisclosurePayload,
) {
  return {
    senderName: trimmed(fields.senderName),
    receiverName: trimmed(fields.receiverName),
    receiverPhone: trimmed(fields.receiverPhone),
    destinationCountryId: trimmed(fields.destinationCountryId),
    businessId: trimmed(fields.businessId),
    mode: fields.mode,
    weightKg: fields.weightKg,
    ...pickupPayload(fields.pickup),
    useWalletBalance: fields.useWalletBalance,
    marketplaceDisclosure: disclosure,
  };
}

export function buildFreightSettlementPayload(
  shipmentId: string,
  disclosure: MarketplaceDisclosurePayload,
) {
  return {
    shipmentId: trimmed(shipmentId),
    marketplaceDisclosure: disclosure,
  };
}

export function buildTransportRequestPayload(fields: TransportRequestFields) {
  return {
    businessId: trimmed(fields.businessId),
    destinationCountryId: trimmed(fields.destinationCountryId),
    destinationCountryName: trimmed(fields.destinationCountryName),
    ownerName: trimmed(fields.ownerName),
    carMake: trimmed(fields.carMake),
    carModel: trimmed(fields.carModel),
    carYear: trimmed(fields.carYear),
    customerPhone: trimmed(fields.customerPhone),
    vinNumber: trimmed(fields.vinNumber),
    pickupAddress: trimmed(fields.pickupAddress),
    notes: trimmed(fields.notes),
    ...(fields.preferredDate && { preferredDate: fields.preferredDate }),
  };
}

export function freightSettlementIsPayable(
  shipment: Record<string, unknown>,
) {
  const status = String(shipment.priceSettlementStatus || "").toLowerCase();
  const due = Number(
    shipment.balanceDueCents ??
      (Number(shipment.balanceDue || 0) * 100),
  );
  return (
    Number.isFinite(due) &&
    due > 0 &&
    ["balance_due", "balance_payment_pending"].includes(status)
  );
}
