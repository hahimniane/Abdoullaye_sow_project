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

const NYC_BOROUGHS = new Set([
  "bronx",
  "brooklyn",
  "manhattan",
  "queens",
  "staten island",
]);

export function pickupDetailsAreComplete(
  pickup: PickupDetails,
  now = Date.now(),
) {
  if (!pickup.requested) return true;
  const pickupTime = pickup.dateTime
    ? new Date(pickup.dateTime).getTime()
    : Number.NaN;
  return Boolean(
    pickup.address.trim() &&
      NYC_BOROUGHS.has(pickup.borough.trim().toLowerCase()) &&
      Number.isFinite(pickupTime) &&
      pickupTime > now,
  );
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
