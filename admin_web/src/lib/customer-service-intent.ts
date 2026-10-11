export const customerServices = [
  "barrel",
  "freight",
  "car-transport",
  "parking",
  "shared-barrels",
  "cars",
  "tracking",
  // A shop's inventory tag, scanned with a phone camera: /i/<CODE> on the
  // customer host. Shows a plain notice, never anything about the product.
  "item-tag",
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

/** What `https://customer.laawoldigital.com/i/<CODE>` is, whether the host rewrote it to `?service=item-tag` or served it as a path. */
const ITEM_TAG_PATH = /^\/i\/[A-Za-z0-9-]{1,60}\/?$/;

/**
 * The customer service a page address asks for: the `?service=` link, or an
 * inventory tag's own path (`/i/IT-K7M4P2`) when the host did not rewrite it.
 * The code in the path is never read: the page it opens says nothing about
 * any product.
 */
export function customerServiceFromLocation(
  pathname: string,
  search: string,
): CustomerService | null {
  return (
    customerServiceFromSearch(search) ??
    (ITEM_TAG_PATH.test(String(pathname ?? "")) ? "item-tag" : null)
  );
}

export function customerServiceUrl(service: CustomerService) {
  return `https://customer.laawoldigital.com/?service=${service}`;
}

/**
 * What a customer's phone camera sees at an inventory tag's link. Plain on
 * purpose: no product, no price, no shop - the tag is for the shop's staff,
 * who scan it in the Laawol app. French in french-dom.ts.
 */
export const ITEM_TAG_NOTICE =
  "This tag is for the shop's staff. Open it in the Laawol app.";
