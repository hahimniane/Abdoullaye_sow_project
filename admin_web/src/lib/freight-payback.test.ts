import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  FREIGHT_PAYBACK_ERRORS,
  freightItemChoicesFor,
  freightItemPricing,
  freightPaybackFor,
  freightPaybackErrorMessage,
  providerQualifiesForItem,
} from "./freight-payback.ts";

// Twin of functions/test/freight-payback.test.js and
// test/freight_payback_test.dart - three clients, one price.
const TABLE = {
  electronics: {
    items: [
      {id: "iphone", label: "iPhone", paybackAmount: 400},
      {id: "samsung-phone", label: "Samsung phone", paybackAmount: 250},
    ],
    otherPaybackAmount: 100,
  },
  clothing: {items: [], otherPaybackAmount: 0},
};

test("prices the exact row the business published", () => {
  assert.equal(
    freightPaybackFor({table: TABLE, categoryId: "electronics", itemId: "iphone"})
      .paybackAmount,
    400,
  );
  assert.equal(
    freightPaybackFor({
      table: TABLE, categoryId: "electronics", itemId: "samsung-phone",
    }).paybackAmount,
    250,
  );
});

test("falls back to the catch-all, and says unlisted otherwise", () => {
  const unknown = freightPaybackFor({
    table: TABLE, categoryId: "electronics", itemId: "walkman",
  });
  assert.equal(unknown.paybackAmount, 100);
  assert.equal(unknown.source, "other");
  assert.equal(
    freightPaybackFor({table: TABLE, categoryId: "clothing", itemId: "boubou"})
      .listed,
    false,
  );
  assert.equal(
    freightPaybackFor({table: undefined, categoryId: "electronics"}).listed,
    false,
  );
});

test("the payback is what the customer is promised, and it costs nothing", () => {
  // The business's published amount reaches the screen in full, beside a
  // price column that says outright there is no charge for it.
  const customer = readFileSync(
    new URL("../components/customer-shipping-services.tsx", import.meta.url),
    "utf8",
  );
  assert.match(customer, /Protection included · paid back if lost/);
  // Never a ceiling, and never a sum: the estimate says the parcel is
  // covered and that it costs nothing, and leaves the amount to the claim.
  assert.doesNotMatch(customer, /Protection included · up to/);
  assert.doesNotMatch(customer, /Paid back if lost"\n?\s*value=\{formatMoney/);
  assert.match(customer, /value: "Free"/);
  assert.doesNotMatch(customer, /label:\s*"Cover for loss"/);
  // Nothing anywhere in the estimate adds a cover line to the total.
  assert.doesNotMatch(customer, /\+ coverageFee/);
});

const businessSettingsSource = readFileSync(
  new URL("../components/business/profile-support-people.tsx", import.meta.url),
  "utf8",
);
const operationsSource = readFileSync(
  new URL("../components/business/operations-panels.tsx", import.meta.url),
  "utf8",
);

test("the form follows its own answer, and never narrates history", () => {
  // A form that ignores the answer it just received reads as broken: the
  // obligation warning belongs to businesses that said yes, and the delivery
  // fee to routes whose owner said they deliver there. And pre-launch copy
  // never frames a feature against a previous version nobody ever saw.
  assert.match(
    businessSettingsSource,
    /\{draft\.coversLoss && \(\s*<div className="customer-inline-note wide">/,
  );
  assert.match(
    operationsSource,
    /\{draft\.destinationDelivery && \(\s*<div className="lst-field wide">/,
  );
  assert.doesNotMatch(businessSettingsSource, /no longer type/);
  assert.doesNotMatch(
    businessSettingsSource,
    /no longer|previously|we['’]ve changed/i,
  );
});

test("nothing anywhere asks a business to type a weight factor", () => {
  // By weight is this business's own per-kg rate for the route, full stop.
  // A factor was the category multiplier wearing a different hat: a number
  // with no unit, which an owner had to reason about rather than price.
  for (const source of [businessSettingsSource, operationsSource]) {
    assert.doesNotMatch(source, /weightFactor|[Ww]eight factor/);
  }
  // The by-weight branch of the row editor holds no field at all now.
  assert.match(businessSettingsSource, /\) : null\}\s*<\/div>/);
});

test("the funnel unions items across providers and matches honestly", () => {
  const withTable = {
    freightPaybackTable: {
      electronics: {
        items: [{id: "iphone", label: "iPhone", paybackAmount: 400}],
        otherPaybackAmount: 0,
      },
    },
  };
  const withCatchAll = {
    freightPaybackTable: {
      electronics: {items: [], otherPaybackAmount: 50},
    },
  };
  const legacy = {};

  const choices = freightItemChoicesFor(
    [withTable, withCatchAll],
    "electronics",
  );
  assert.deepEqual(
    choices.map((choice) => choice.id),
    ["iphone", "__other"],
  );

  // One provider listing the row is enough for the item to be pickable;
  // matching then filters to who can actually take it.
  assert.equal(
    providerQualifiesForItem(withTable, "electronics", "iphone"),
    true,
  );
  assert.equal(
    providerQualifiesForItem(withCatchAll, "electronics", "iphone"),
    true, // its catch-all covers unlisted rows
  );
  assert.equal(
    providerQualifiesForItem(withTable, "electronics", "__other"),
    false, // no catch-all: it takes only what it listed
  );
  assert.equal(
    providerQualifiesForItem(legacy, "electronics", "anything"),
    true, // no table means it carries anything
  );
  // "Something else" disappears when nobody would take it.
  assert.deepEqual(
    freightItemChoicesFor([withTable], "clothing"),
    [],
  );
});

test("nothing snaps the funnel's category back to a default", () => {
  // Picking a category resets the provider, which empties the provider's
  // own category list - and an old effect keyed on that list fired on
  // exactly this reset, stomping every choice back to "general". The
  // customer picked Electronics and watched it revert.
  const customer = readFileSync(
    "src/components/customer-shipping-services.tsx",
    "utf8",
  );
  assert.doesNotMatch(customer, /defaultFreightCategoryId/);
  assert.match(customer, /The funnel owns the category now/);
});

test("the funnel never offers a category nobody would take", () => {
  // Canada offered "Clothes and fabric" because a provider PRICES that
  // category - but every provider on the route had a payback table and none
  // listed anything under it. The customer picked it and was told "no
  // business takes this" without ever being asked what the item was, over a
  // search box with nothing to search. A category with no item choices
  // anywhere (no rows, no catch-all, no legacy business) is a guaranteed
  // dead end and must never appear; and the funnel is answered only by an
  // actual item choice - there is no empty-items shortcut.
  const customer = readFileSync(
    "src/components/customer-shipping-services.tsx",
    "utf8",
  );
  assert.match(
    customer,
    /\[\.\.\.seen\.values\(\)\]\.filter\(/,
  );
  assert.match(
    customer,
    /itemStepSatisfied = Boolean\(activeCategoryId\) && Boolean\(activeItemId\)/,
  );
  assert.doesNotMatch(customer, /funnelItems\.length === 0 \|\|/);
});

test("the freight form reveals itself one answered question at a time", () => {
  // With no category chosen, the customer saw receiver fields, a weight, a
  // pickup choice, an auto-selected provider and a Review button - half a
  // form for a booking that could still dead-end at "no business takes
  // this". Each block now waits for the answer before it.
  const customer = readFileSync(
    "src/components/customer-shipping-services.tsx",
    "utf8",
  );
  // Receiver/weight/pickup live behind the chosen business.
  assert.match(customer, /\{destination && \(<>/);
  // The shared footer hides until then too.
  assert.match(customer, /footerVisible=\{Boolean\(destination\)\}/);
  // And the single-provider auto-select waits for the funnel.
  assert.match(
    customer,
    /itemStepSatisfied &&\s*\n\s*qualifiedProviderOptions\.length === 1/,
  );
});

// Twin of the pricing half of functions/test/freight-payback.test.js. Each row
// answers two questions at once - what it costs to carry, and what it pays
// back if lost - so both come from the same place and can never disagree.
const PRICED = {
  electronics: {
    items: [
      {
        id: "iphone-16",
        label: "iPhone 16",
        paybackAmount: 400,
        pricingMode: "flat",
        flatPrice: 50,
        includedKg: 2,
      },
      {
        id: "tv",
        label: "Television",
        paybackAmount: 300,
        pricingMode: "flat",
        flatPrice: 120,
      },
      {
        id: "cables",
        label: "Cables",
        paybackAmount: 20,
        pricingMode: "per_kg",
      },
      // Saved before pricing moved onto the row.
      {id: "laptop", label: "Laptop", paybackAmount: 800},
    ],
    otherPaybackAmount: 100,
    otherPricingMode: "per_kg",
  },
  clothing: {items: [], otherPaybackAmount: 40},
};

test("a set price is published, and never asks the customer for a weight", () => {
  const phone = freightItemPricing({
    table: PRICED,
    categoryId: "electronics",
    itemId: "iphone-16",
    categoryMultiplier: 2,
  });
  assert.equal(phone.mode, "flat");
  assert.equal(phone.flatPrice, 50);
  assert.equal(phone.includedKg, 2);
  assert.equal(phone.needsWeightAtBooking, false);
  // An allowance is the only reason a set-price parcel meets a scale: the
  // business checks whether the parcel outgrew what the price covers.
  assert.equal(phone.weighsAtDropOff, true);
  assert.equal(phone.source, "item");

  // No allowance means the price covers it however heavy it is, so nothing
  // is weighed at all and there is nothing left to settle.
  const tv = freightItemPricing({
    table: PRICED,
    categoryId: "electronics",
    itemId: "tv",
    categoryMultiplier: 2,
  });
  assert.equal(tv.includedKg, 0);
  assert.equal(tv.needsWeightAtBooking, false);
  assert.equal(tv.weighsAtDropOff, false);
});

test("a by-weight row is the route's own rate, and legacy rows are not", () => {
  // By weight means this business's per-kg rate for the route, full stop.
  assert.equal(
    freightItemPricing({
      table: PRICED,
      categoryId: "electronics",
      itemId: "cables",
      categoryMultiplier: 2,
    }).weightFactor,
    1,
  );
  // The migration promise: a row saved before per-row pricing existed keeps
  // being charged at its category's factor, so saving it unchanged cannot
  // move what anyone is charged.
  const legacy = freightItemPricing({
    table: PRICED,
    categoryId: "electronics",
    itemId: "laptop",
    categoryMultiplier: 2,
  });
  assert.equal(legacy.mode, "per_kg");
  assert.equal(legacy.weightFactor, 2);
  assert.equal(legacy.needsWeightAtBooking, true);
  assert.equal(legacy.weighsAtDropOff, true);
  // Its own row, never the catch-all: reading the catch-all here would
  // reprice every legacy row the day a business prices "anything else".
  assert.equal(legacy.source, "item");
  // And a whole table that has never been priced behaves exactly the same.
  const untouched = freightItemPricing({
    table: TABLE,
    categoryId: "electronics",
    itemId: "iphone",
    categoryMultiplier: 2,
  });
  assert.equal(untouched.weightFactor, 2);
  assert.equal(untouched.mode, "per_kg");
  // Unknown category, no table at all: the price freight had before any of
  // this existed.
  assert.equal(
    freightItemPricing({
      table: undefined,
      categoryId: "electronics",
      categoryMultiplier: 1.5,
    }).weightFactor,
    1.5,
  );
});

test("an unlisted item falls through to the category's own pricing", () => {
  const unlisted = freightItemPricing({
    table: PRICED,
    categoryId: "electronics",
    itemId: "walkman",
    categoryMultiplier: 2,
  });
  assert.equal(unlisted.source, "other");
  assert.equal(unlisted.mode, "per_kg");
  // A catch-all that states by-weight pricing states the route rate.
  assert.equal(unlisted.weightFactor, 1);
  // A category whose catch-all names no pricing prices like it always did.
  assert.equal(
    freightItemPricing({
      table: PRICED,
      categoryId: "clothing",
      categoryMultiplier: 1,
    }).source,
    null,
  );
});

test("a refusal from the callable reads as a sentence, not a code", () => {
  assert.equal(
    FREIGHT_PAYBACK_ERRORS.flat_price_out_of_range,
    "A set price must be between $0.01 and $10,000",
  );
  assert.equal(
    freightPaybackErrorMessage("included_kg_out_of_range"),
    "An included weight must be between 0 and 200 kg",
  );
  assert.equal(
    freightPaybackErrorMessage("pricing_mode_invalid"),
    "Say whether an item has a set price or is priced by weight",
  );
  // Anything the server invents later still says something readable.
  assert.equal(
    freightPaybackErrorMessage("something_new"),
    "Those payback settings are not valid",
  );
});

test("a set-price booking asks for no weight and sends none", () => {
  const customer = readFileSync(
    "src/components/customer-shipping-services.tsx",
    "utf8",
  );
  // The price of a known object does not depend on the customer's guess at
  // what it weighs, so the field is not on the screen at all.
  assert.match(
    customer,
    /\{itemPricing\.needsWeightAtBooking \? \(\s*\n\s*<label>\s*\n\s*Estimated weight \(kg\)/,
  );
  assert.match(
    customer,
    /weightKg: itemPricing\.needsWeightAtBooking \? weightKg : 0,/,
  );
  // And the form cannot be held open waiting for a weight that is never
  // asked for.
  assert.match(customer, /!itemPricing\.needsWeightAtBooking \|\|/);
  // The allowance and what excess costs both reach the estimate, because
  // they are the whole of what the customer might still be charged.
  assert.match(customer, /label: "Covers up to"/);
  assert.match(customer, /label: "Over that, per kg"/);
  assert.match(customer, /label: "Set price"/);
  // The client prices with the same function the server does.
  assert.match(customer, /freightItemPricing\(\{/);
});

test("a shipment nobody weighs is never offered a weigh action", () => {
  const operations = readFileSync(
    "src/components/business/operations-panels.tsx",
    "utf8",
  );
  assert.match(
    operations,
    /const weighs = row\.weightVerificationRequired !== false;/,
  );
  assert.match(operations, /versionTwo && weighs && verifiedWeight <= 0/);
});
