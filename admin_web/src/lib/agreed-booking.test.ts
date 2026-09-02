import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const bookingSource = readFileSync(
  "src/components/customer-shipping-services.tsx",
  "utf8",
);

test("the agreed business is qualified by its acceptance, not the catalogue", () => {
  // A guest accepted this business's price on a quote request and clicked
  // through to booking. The business often has no catalogue row for the
  // item - that is WHY a price was asked - so filtering providers by
  // providerQualifiesForItem alone dropped the one business the customer
  // chose, and the booking page dead-ended with no provider and no price.
  assert.match(
    bookingSource,
    /option\.businessId === bookingQuoteBusinessId\)\s*\|\|\s*providerQualifiesForItem/,
  );
});

test("the public application sends the address the server requires", () => {
  // submitBusinessApplication refuses an application without a street
  // address; the partner page once sent addressLine1: "" (and the country
  // as the state), so every public application failed after submit.
  const partnerSource = readFileSync("../public_site/partner.html", "utf8");
  assert.match(partnerSource, /addressLine1: selectedStreet/);
  assert.match(partnerSource, /state: selectedState/);
  assert.match(partnerSource, /id="businessStreet"/);
  assert.doesNotMatch(partnerSource, /state: selectedCountry/);
});
