export type DestinationRates = {
  barrelShippingPrice: number;
  freightAirPricePerKg: number;
  freightSeaPricePerKg: number;
};

export type DestinationServiceAvailability = {
  barrelShipping: boolean;
  freightAir: boolean;
  freightSea: boolean;
  carTransport: boolean;
};

export const DESTINATION_DEPARTURE_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

export type DestinationDepartureDay =
  (typeof DESTINATION_DEPARTURE_DAYS)[number];

export const DESTINATION_DEPARTURE_DAY_LABELS: Record<
  DestinationDepartureDay,
  string
> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

export function destinationDepartureDays(value: unknown) {
  if (!Array.isArray(value)) return [] as DestinationDepartureDay[];
  const requested = new Set(
    value.filter(
      (day): day is DestinationDepartureDay =>
        typeof day === "string" &&
        DESTINATION_DEPARTURE_DAYS.includes(day as DestinationDepartureDay),
    ),
  );
  return DESTINATION_DEPARTURE_DAYS.filter((day) => requested.has(day));
}

export const EMPTY_DESTINATION_SERVICE_AVAILABILITY: DestinationServiceAvailability =
  {
    barrelShipping: false,
    freightAir: false,
    freightSea: false,
    carTransport: false,
  };

export function destinationServiceAvailability(
  row: Record<string, unknown>,
): DestinationServiceAvailability {
  const raw = row.serviceAvailability;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const map = raw as Record<string, unknown>;
    return {
      barrelShipping: map.barrelShipping === true,
      freightAir: map.freightAir === true,
      freightSea: map.freightSea === true,
      carTransport: map.carTransport === true,
    };
  }

  const active = row.isActive === true;
  return {
    barrelShipping:
      active && Number(row.barrelShippingPrice ?? 0) > 0,
    freightAir:
      active && Number(row.freightAirPricePerKg ?? 0) > 0,
    freightSea:
      active && Number(row.freightSeaPricePerKg ?? 0) > 0,
    carTransport:
      active && row.carTransportAvailable === true,
  };
}

export function globallyAvailableDestinationServices(
  enabledServices: readonly string[],
): DestinationServiceAvailability {
  return {
    barrelShipping: enabledServices.includes("barrelShipping"),
    freightAir: enabledServices.includes("freight"),
    freightSea: enabledServices.includes("freight"),
    carTransport: enabledServices.includes("carTransport"),
  };
}

export function canonicalDestinationServiceAvailability(
  enabledServices: readonly string[],
  requested: DestinationServiceAvailability,
): DestinationServiceAvailability {
  const globallyAvailable =
    globallyAvailableDestinationServices(enabledServices);
  return {
    barrelShipping:
      globallyAvailable.barrelShipping && requested.barrelShipping,
    freightAir: globallyAvailable.freightAir && requested.freightAir,
    freightSea: globallyAvailable.freightSea && requested.freightSea,
    carTransport:
      globallyAvailable.carTransport && requested.carTransport,
  };
}

export function destinationRateError(
  enabledServices: readonly string[],
  availability: DestinationServiceAvailability,
  rates: DestinationRates,
) {
  const canonical = canonicalDestinationServiceAvailability(
    enabledServices,
    availability,
  );
  if (!Object.values(canonical).some(Boolean)) {
    return "Choose at least one service for this country.";
  }
  if (
    canonical.barrelShipping &&
    !(rates.barrelShippingPrice > 0)
  ) {
    return "Enter a barrel shipping price greater than zero.";
  }
  if (
    canonical.freightAir &&
    !(rates.freightAirPricePerKg > 0)
  ) {
    return "Enter an air freight price per kilogram greater than zero.";
  }
  if (
    canonical.freightSea &&
    !(rates.freightSeaPricePerKg > 0)
  ) {
    return "Enter a sea freight price per kilogram greater than zero.";
  }
  return "";
}

export function destinationCanActivate(
  enabledServices: readonly string[],
  availability: DestinationServiceAvailability,
  rates: DestinationRates,
) {
  return destinationRateError(enabledServices, availability, rates) === "";
}
