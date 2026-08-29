import {
  EMPTY_STRUCTURED_ADDRESS,
  type StructuredAddress,
  composeAddressLine,
} from "./address-fields.ts";

export type MarketplaceDisclosurePayload = {
  accepted: true;
  version: string;
  locale: string;
};

export type PickupDetails = {
  requested: boolean;
  // The composed single line. Quoting, checkout, and the business's copy of
  // the order all read this, so it is kept in sync with the parts below on
  // every edit and always carries the apartment.
  address: string;
  borough: string;
  dateTime?: string;
  // Separate, customer-editable parts (backlog item 1). Optional because a
  // pickup captured before this change has only the composed line.
  streetLine?: string;
  apartment?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
};

/**
 * The named parts behind a pickup address. A pickup saved before addresses
 * were split has only the composed line, so it becomes the street line and
 * the customer can break it apart by hand.
 */
export function pickupStructuredAddress(
  pickup: PickupDetails,
): StructuredAddress {
  return {
    ...EMPTY_STRUCTURED_ADDRESS,
    streetLine: pickup.streetLine ?? pickup.address,
    apartment: pickup.apartment ?? "",
    city: pickup.city ?? "",
    state: pickup.state ?? "",
    postalCode: pickup.postalCode ?? "",
    country: pickup.country ?? "",
  };
}

/**
 * Writes edited parts back onto a pickup, recomposing the single line the
 * callables receive. Recomposing on every edit is what keeps the apartment
 * from being dropped between the form and checkout.
 */
export function applyStructuredAddress(
  pickup: PickupDetails,
  parts: StructuredAddress,
): PickupDetails {
  return {
    ...pickup,
    ...parts,
    address: composeAddressLine(parts),
  };
}

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

export type BarrelPickupQuote = {
  available: true;
  normalizedAddress: string;
  serviceArea: string;
  borough: string;
  model: "flat" | "borough" | "distance";
  distanceMiles: number | null;
  fee: number;
  currency: string;
};

/** What quoteBarrelPickup actually returns: a quote, or a refusal when the
 * business has not configured pickup (pickup belongs to the business now). */
export type BarrelPickupQuoteResult =
  | BarrelPickupQuote
  | { available: false; reason: string };

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
  // Which of the business's office locations to drop off at, when the
  // business has more than one and the customer chose "bring to office".
  officeLocationId?: string;
};

export type BarrelOrderLineFields = {
  destinationCountryId: string;
  businessId: string;
  receiverName: string;
  receiverPhone: string;
  quantity: number;
  pickup?: PickupDetails;
  officeLocationId?: string;
};

export type BarrelOrderFields = {
  senderName: string;
  lines: BarrelOrderLineFields[];
  sharedPickup?: PickupDetails;
  useDifferentPickupDetails: boolean;
};

export type FreightShipmentFields = {
  /// Set when this booking settles an accepted price. Carries no amount.
  quoteRequestId?: string;
  senderName: string;
  receiverName: string;
  receiverPhone: string;
  destinationCountryId: string;
  businessId: string;
  mode: "air" | "sea";
  weightKg: number;
  pickup: PickupDetails;
  officeLocationId?: string;
  // What is in the parcel. Both optional: a client that sends neither is
  // priced exactly as freight was without categories, which is what makes
  // them safe to add here.
  itemCategoryId?: string;
  itemId?: string;
  // "arrival" only when the chosen business opted in to being paid after
  // the parcel lands; the server refuses it from anyone else.
  paymentTiming?: "now" | "arrival";
  // How the parcel ends its journey. The server re-prices delivery from the
  // business document and refuses it from a business that does not offer it,
  // so these carry the customer's choice, never a fee.
  destinationDelivery?: boolean;
  receiverAddress?: string;
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
  isActive?: boolean;
  barrelShippingPrice?: unknown;
  freightAirPricePerKg?: unknown;
  freightSeaPricePerKg?: unknown;
  // Each service has its own real-world transit time, so the country carries
  // an independent estimate per service instead of one shared value.
  barrelShippingDeliveryEstimateMinDays?: unknown;
  barrelShippingDeliveryEstimateMaxDays?: unknown;
  freightAirDeliveryEstimateMinDays?: unknown;
  freightAirDeliveryEstimateMaxDays?: unknown;
  freightSeaDeliveryEstimateMinDays?: unknown;
  freightSeaDeliveryEstimateMaxDays?: unknown;
  freightAirDepartureDays?: unknown;
  freightSeaDepartureDays?: unknown;
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
  enabledServices?: readonly string[];
  businessStatus?: string;
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

function shippingBusinessOffersService(
  option: ShippingDestinationOption,
  service: "barrel" | "freight",
) {
  if (option.businessStatus !== "approved") return false;
  if (!Array.isArray(option.enabledServices)) {
    // The callable always supplies normalized service capabilities, including
    // for legacy businesses. Missing metadata is therefore malformed and must
    // not expose a provider the create callable could reject.
    return false;
  }
  return option.enabledServices.includes(
    service === "barrel" ? "barrelShipping" : "freight",
  );
}

export function shippingOptionIsEligible(
  option: ShippingDestinationOption,
  service: "barrel" | "freight",
  mode: FreightMode = "air",
) {
  return (
    shippingBusinessOffersService(option, service) &&
    option.country.isActive === true &&
    shippingProviderRate(option.country, service, mode) !== null
  );
}

export function freightProvidersForMode<T extends ShippingDestinationOption>(
  options: readonly T[],
  mode: FreightMode,
) {
  return options.filter((option) =>
    shippingOptionIsEligible(option, "freight", mode),
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
  return shippingOptionIsEligible(option, "barrel");
}

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
  pickupQuote,
  pickupRequested,
  quantity,
}: {
  country: ShippingPricingCountry;
  pickupBorough: string;
  pickupPricing: BarrelPickupPricing | null;
  pickupQuote?: unknown;
  pickupRequested: boolean;
  quantity: unknown;
}) {
  const shipping = barrelShippingEstimate(country, quantity);
  if (!shipping) return null;
  const quotedPickupFee = positiveFinite(pickupQuote);
  const pickupFee = pickupRequested
    ? quotedPickupFee ??
      (pickupPricing ? barrelPickupFee(pickupPricing, pickupBorough) : null)
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
  const pickupTime = pickup.dateTime
    ? new Date(pickup.dateTime).getTime()
    : Number.NaN;
  return Boolean(
    pickup.address.trim() &&
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

function barrelOrderLinePayload(
  line: BarrelOrderLineFields,
  includePickup: boolean,
) {
  return {
    destinationCountryId: trimmed(line.destinationCountryId),
    businessId: trimmed(line.businessId),
    receiverName: trimmed(line.receiverName),
    receiverPhone: trimmed(line.receiverPhone),
    quantity: line.quantity,
    // Office location is always resolved per line (it depends on that
    // line's own business), even when every line otherwise shares one
    // pickup/drop-off choice.
    ...(line.officeLocationId && { officeLocationId: line.officeLocationId }),
    ...(includePickup &&
      line.pickup && {
        pickupRequested: line.pickup.requested,
        pickupAddress: trimmed(line.pickup.address),
        pickupBorough: trimmed(line.pickup.borough),
        ...(line.pickup.dateTime && {
          pickupDateTime: line.pickup.dateTime,
        }),
      }),
  };
}

export function buildBarrelOrderPayload(
  fields: BarrelOrderFields,
  disclosure: MarketplaceDisclosurePayload,
) {
  return {
    senderName: trimmed(fields.senderName),
    lines: fields.lines.map((line) =>
      barrelOrderLinePayload(line, fields.useDifferentPickupDetails),
    ),
    ...(!fields.useDifferentPickupDetails &&
      fields.sharedPickup &&
      pickupPayload(fields.sharedPickup)),
    marketplaceDisclosure: disclosure,
  };
}

export function barrelOrderTotals({
  lines,
  sharedPickupFee,
  useDifferentPickupDetails,
}: {
  lines: Array<{
    unitShippingFee: number;
    quantity: number;
    pickupFee: number;
  }>;
  sharedPickupFee: number;
  useDifferentPickupDetails: boolean;
}) {
  const shippingFee = lines.reduce(
    (total, line) => total + line.unitShippingFee * line.quantity,
    0,
  );
  const pickupFee = useDifferentPickupDetails
    ? lines.reduce((total, line) => total + line.pickupFee, 0)
    : sharedPickupFee * lines.length;
  return {
    shippingFee,
    pickupFee,
    total: shippingFee + pickupFee,
    totalBarrels: lines.reduce((total, line) => total + line.quantity, 0),
    lineCount: lines.length,
  };
}

export function barrelOrderAllowsDifferentPickupDetails(
  lines: ReadonlyArray<{ quantity: number }>,
) {
  return (
    lines.length > 1 &&
    lines.reduce((total, line) => total + Number(line.quantity || 0), 0) > 1
  );
}

export function barrelOrderPickupDetailsAreComplete({
  lines,
  now = Date.now(),
  sharedPickup,
  useDifferentPickupDetails,
}: {
  lines: ReadonlyArray<{ pickup?: PickupDetails }>;
  now?: number;
  sharedPickup?: PickupDetails;
  useDifferentPickupDetails: boolean;
}) {
  if (!useDifferentPickupDetails) {
    return Boolean(sharedPickup && pickupDetailsAreComplete(sharedPickup, now));
  }
  return (
    lines.length > 0 &&
    lines.every(
      (line) =>
        line.pickup !== undefined &&
        pickupDetailsAreComplete(line.pickup, now),
    )
  );
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
    ...(!fields.pickup.requested &&
      fields.officeLocationId && { officeLocationId: fields.officeLocationId }),
    marketplaceDisclosure: disclosure,
  };
}

export function buildFreightShipmentPayload(
  fields: FreightShipmentFields,
  disclosure: MarketplaceDisclosurePayload,
) {
  return {
    // The price request this booking settles, when the customer accepted a
    // business's quote for a parcel the pricing table had no number for. The
    // server reads the agreed amount off that request; an amount sent from
    // here would be an amount chosen from here.
    ...(fields.quoteRequestId?.trim() && {
      quoteRequestId: trimmed(fields.quoteRequestId),
    }),
    senderName: trimmed(fields.senderName),
    receiverName: trimmed(fields.receiverName),
    receiverPhone: trimmed(fields.receiverPhone),
    destinationCountryId: trimmed(fields.destinationCountryId),
    businessId: trimmed(fields.businessId),
    mode: fields.mode,
    weightKg: fields.weightKg,
    ...(fields.itemCategoryId?.trim() && {
      itemCategoryId: trimmed(fields.itemCategoryId),
    }),
    // The business's payback row, when one was picked - the server prices
    // protection from its own table and refuses to trust anything else.
    ...(fields.itemId?.trim() && {itemId: trimmed(fields.itemId)}),
    // Sent only when the customer asked for delivery to the receiver, so
    // "the receiver collects it" stays what the server assumes from silence.
    // The address rides with it because a delivery without one is refused.
    ...(fields.destinationDelivery === true && {
      destinationDelivery: true,
      receiverAddress: trimmed(fields.receiverAddress ?? ""),
    }),
    // Sent only when the customer chose to pay after arrival - "pay now"
    // is the default the server assumes from silence, same as every client
    // built before this choice existed.
    ...(fields.paymentTiming === "arrival" && {paymentTiming: "arrival"}),
    ...pickupPayload(fields.pickup),
    ...(!fields.pickup.requested &&
      fields.officeLocationId && { officeLocationId: fields.officeLocationId }),
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
