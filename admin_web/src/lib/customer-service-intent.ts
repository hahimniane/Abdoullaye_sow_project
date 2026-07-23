export const customerServices = [
  "barrel",
  "freight",
  "car-transport",
  "parking",
  "shared-barrels",
  "cars",
] as const;

export type CustomerService = (typeof customerServices)[number];

export function customerServiceFromSearch(
  search: string,
): CustomerService | null {
  const value = new URLSearchParams(search).get("service");
  return customerServices.includes(value as CustomerService)
    ? (value as CustomerService)
    : null;
}

export function customerServiceUrl(service: CustomerService) {
  return `https://customer.laawoldigital.com/?service=${service}`;
}
