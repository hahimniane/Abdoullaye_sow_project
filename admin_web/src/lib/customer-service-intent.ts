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
  // A package request (docs/PACKAGE_REQUESTS.md §8.8): the form, opened on
  // one business by /r/<slug>, and the estimate page /e/<token>.
  "package-request",
  "package-estimate",
  // A staff invitation sent on WhatsApp (docs/STAFF_PHONE_INVITES.md §6):
  // the Accept button's /j/<token>.
  "staff-invite",
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
/** `/r/<slug>`: a business's request link. */
const REQUEST_PATH = /^\/r\/[A-Za-z0-9-]{3,40}\/?$/;
/** `/e/<token>`: the WhatsApp estimate button. */
const ESTIMATE_PATH = /^\/e\/[A-Za-z0-9_-]{43}\/?$/;
/** `/j/<token>`: the WhatsApp staff invitation's Accept button. */
const JOIN_PATH = /^\/j\/[A-Za-z0-9_-]{43}\/?$/;

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
  const path = String(pathname ?? "");
  return (
    customerServiceFromSearch(search) ??
    (ITEM_TAG_PATH.test(path) ? "item-tag" :
      REQUEST_PATH.test(path) ? "package-request" :
        ESTIMATE_PATH.test(path) ? "package-estimate" :
          JOIN_PATH.test(path) ? "staff-invite" : null)
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
