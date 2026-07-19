export type DestinationRates = {
  barrelShippingPrice: number;
  freightAirPricePerKg: number;
  freightSeaPricePerKg: number;
};

export function destinationRateError(
  enabledServices: readonly string[],
  rates: DestinationRates,
) {
  if (
    enabledServices.includes("barrelShipping") &&
    !(rates.barrelShippingPrice > 0)
  ) {
    return "Enter a barrel shipping price greater than zero.";
  }
  if (
    enabledServices.includes("freight") &&
    !(rates.freightAirPricePerKg > 0) &&
    !(rates.freightSeaPricePerKg > 0)
  ) {
    return "Enter an air or sea freight price per kilogram greater than zero.";
  }
  return "";
}

export function destinationCanActivate(
  enabledServices: readonly string[],
  rates: DestinationRates,
) {
  return destinationRateError(enabledServices, rates) === "";
}
