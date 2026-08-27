import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { freightCoverageComparisonLine } from "./freight-categories.ts";
import { freightQuoteCoverageLine } from "./freight-quote.ts";
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
      {id: "iphone", label: "iPhone"},
      {id: "samsung-phone", label: "Samsung phone"},
    ],
    otherPricingMode: "per_kg",
  },
  clothing: {items: []},
};

test("finds the exact row the business listed", () => {
  const phone = freightPaybackFor({
    table: TABLE, categoryId: "electronics", itemId: "iphone",
  });
  assert.deepEqual(phone, {listed: true, source: "item", label: "iPhone"});
  assert.deepEqual(
    freightPaybackFor({
      table: TABLE, categoryId: "electronics", itemId: "samsung-phone",
    }),
    {listed: true, source: "item", label: "Samsung phone"},
  );
});

test("listing answers whether, never how much", () => {
  // The whole return value. Anything that looked like a figure per item is
  // gone: a business covers a parcel or it does not, and that is one flag
  // on the business rather than a number on a row.
  const lookup = freightPaybackFor({
    table: TABLE, categoryId: "electronics", itemId: "iphone",
  });
  assert.deepEqual(Object.keys(lookup).sort(), ["label", "listed", "source"]);
});

test("falls back to the catch-all, and says unlisted otherwise", () => {
  const unknown = freightPaybackFor({
    table: TABLE, categoryId: "electronics", itemId: "walkman",
  });
  assert.equal(unknown.listed, true);
  assert.equal(unknown.source, "other");
  // A category whose catch-all names no pricing has no catch-all at all:
  // having a mode is what makes it a row.
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

test("the promise reaches the customer, and it costs nothing", () => {
  // The estimate says the parcel is covered and that it costs nothing. There
  // is no sum, no ceiling and no per-item figure to disagree with the claim.
  const customer = readFileSync(
    new URL("../components/customer-shipping-services.tsx", import.meta.url),
    "utf8",
  );
  assert.match(customer, /Protection included · paid back if lost/);
  assert.doesNotMatch(customer, /Protection included · up to/);
  assert.match(customer, /value: "Free"/);
  assert.doesNotMatch(customer, /label:\s*"Cover for loss"/);
  // Nothing anywhere in the estimate adds a cover line to the total.
  assert.doesNotMatch(customer, /\+ coverageFee/);
  // And the cover the estimate states is the business's yes/no narrowed to
  // this parcel, not a number read off the row.
  assert.doesNotMatch(customer, /paybackAmount/);
  assert.match(customer, /coversThisParcel/);
});

const businessSettingsSource = readFileSync(
  new URL("../components/business/profile-support-people.tsx", import.meta.url),
  "utf8",
);
const operationsSource = readFileSync(
  new URL("../components/business/operations-panels.tsx", import.meta.url),
  "utf8",
);
const customerSource = readFileSync(
  new URL("../components/customer-shipping-services.tsx", import.meta.url),
  "utf8",
);

/** Anything a reader would take for a sum of money. */
const FIGURE =
  /formatMoney|[$€£]\s*\d|\d[\d,.]*\s*(?:USD|EUR|dollars?)|Cents\b/i;
/** A sentence a customer could read as a statement about cover. */
const COVERAGE_PHRASE =
  /lost parcel|if (?:it|this) is lost|pays? (?:you )?back|paid back|cover(?:s|ed)? (?:this|a|the) parcel|[Pp]rotection/;

/**
 * The body of one top-level function, from its declaration to the closing
 * brace in column one. Crude, and exactly enough: it is how the whole of a
 * component's rendered prose gets checked rather than just its literals.
 */
function functionBody(source: string, declaration: string): string {
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `${declaration} is not in the source`);
  const end = source.indexOf("\n}\n", start);
  assert.notEqual(end, -1, `${declaration} has no closing brace`);
  return source.slice(start, end);
}

test("no customer-facing coverage line can ever carry a figure", () => {
  // This is the fourth attempt at removing the per-item amount, and each of
  // the first three grew one back somewhere near the word "cover". Cover is
  // a yes or a no: a figure beside it is the thing a customer argues over,
  // and there is no longer any field it could honestly be read from.
  for (const line of [
    freightCoverageComparisonLine(null),
    freightCoverageComparisonLine({coversLoss: false}),
    freightCoverageComparisonLine({coversLoss: true}),
    freightQuoteCoverageLine(true),
    freightQuoteCoverageLine(false),
    freightQuoteCoverageLine(undefined),
  ]) {
    assert.doesNotMatch(line, /[$€£]|\d/, `"${line}" states a figure`);
  }

  // Everything either screen SAYS about cover, checked for a currency the
  // same way a reader would notice one: quoted strings (labels, options,
  // aria-labels) and the prose between tags alike, because the amount came
  // back as each of those in turn.
  for (const source of [
    customerSource,
    businessSettingsSource,
    operationsSource,
  ]) {
    const said = [
      ...[...source.matchAll(/"[^"\n]*"|'[^'\n]*'/g)].map(([hit]) => hit),
      ...[...source.matchAll(/>([^<>{}]+)</g)].map(([, text]) =>
        text.replace(/\s+/g, " ").trim(),
      ),
    ];
    for (const sentence of said) {
      if (!COVERAGE_PHRASE.test(sentence)) continue;
      assert.doesNotMatch(sentence, FIGURE, `"${sentence}" states a figure`);
    }
  }

  // And the two blocks that render cover as prose rather than as a string,
  // where a figure would arrive as a formatMoney call instead.
  assert.doesNotMatch(
    functionBody(customerSource, "function FreightProtectionNote("),
    FIGURE,
  );
  const card = customerSource.slice(
    customerSource.indexOf('className={paysBack ? "quote-payback"'),
  );
  assert.doesNotMatch(card.slice(0, card.indexOf("</p>")), FIGURE);

  // Nothing left in the model for a screen to read one from, either.
  assert.doesNotMatch(customerSource, /paybackAmount|payoutCap/i);
  assert.doesNotMatch(businessSettingsSource, /paybackAmount|payoutCap/i);
  assert.doesNotMatch(operationsSource, /paybackAmount|payoutCap/i);
});

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
        items: [
          {
            id: "iphone",
            label: "iPhone",
            pricingMode: "flat",
            flatPrice: 50,
          },
        ],
      },
    },
  };
  const withCatchAll = {
    freightPaybackTable: {
      electronics: {
        items: [],
        otherPricingMode: "per_kg",
      },
    },
  };
  const noTable = {};

  const choices = freightItemChoicesFor(
    [withTable, withCatchAll],
    "electronics",
  );
  assert.deepEqual(
    choices.map((choice) => choice.id),
    ["iphone", "__other"],
  );

  // One provider listing the row is enough for the item to be pickable;
  // matching then filters to who can actually take it, at a price.
  assert.equal(
    providerQualifiesForItem(withTable, "electronics", "iphone"),
    true,
  );
  assert.equal(
    providerQualifiesForItem(withCatchAll, "electronics", "iphone"),
    true, // its catch-all covers and prices unlisted rows
  );
  assert.equal(
    providerQualifiesForItem(withTable, "electronics", "__other"),
    false, // no catch-all: it takes only what it listed
  );
  assert.equal(
    providerQualifiesForItem(noTable, "electronics", "anything"),
    false, // nothing priced, so nothing to book - it answers a request
  );
  // A row this business lists but has never put a number on cannot be
  // booked either: listing is a routing answer, not a price.
  assert.equal(
    providerQualifiesForItem(
      {
        freightPaybackTable: {
          electronics: {
            items: [{id: "iphone", label: "iPhone"}],
          },
        },
      },
      "electronics",
      "iphone",
    ),
    false,
  );
  // "Something else" is always offered, because a parcel nobody listed is
  // exactly what the price-request path answers.
  assert.deepEqual(freightItemChoicesFor([withTable], "clothing"), [
    {id: "__other", label: "Something else"},
  ]);
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

test("every category the funnel offers leads to a price or to a request", () => {
  // The funnel is answered only by an actual item choice - there is no
  // empty-items shortcut - and no category is withheld, because the parcel
  // nobody priced now leads somewhere: the customer asks, and the businesses
  // on the route answer with a number.
  const customer = readFileSync(
    "src/components/customer-shipping-services.tsx",
    "utf8",
  );
  assert.match(
    customer,
    /itemStepSatisfied = Boolean\(activeCategoryId\) && Boolean\(activeItemId\)/,
  );
  assert.doesNotMatch(customer, /funnelItems\.length === 0 \|\|/);
  // No category is filtered out of the picker.
  assert.doesNotMatch(customer, /\[\.\.\.seen\.values\(\)\]\.filter\(/);
  // And the note that used to end the journey is gone.
  assert.doesNotMatch(customer, /more businesses are joining/);
});

test("the freight form reveals itself one answered question at a time", () => {
  // With no category chosen, the customer saw receiver fields, a weight, a
  // pickup choice, an auto-selected provider and a Review button - half a
  // form for a booking that had no number behind it. Each block waits for
  // the answer before it, and for a price.
  const customer = readFileSync(
    "src/components/customer-shipping-services.tsx",
    "utf8",
  );
  // Receiver/weight/pickup live behind the chosen business AND its price.
  assert.match(customer, /\{destination && itemPricing\.priced && \(<>/);
  // The shared footer hides until then too.
  assert.match(
    customer,
    /footerVisible=\{Boolean\(destination\) && itemPricing\.priced\}/,
  );
  // And the single-provider auto-select waits for the funnel.
  assert.match(
    customer,
    /itemStepSatisfied &&\s*\n\s*qualifiedProviderOptions\.length === 1/,
  );
});

// Twin of the pricing half of functions/test/freight-payback.test.js. A row
// says what it costs to carry and nothing else - there is no second number on
// it for the price to disagree with.
const PRICED = {
  electronics: {
    items: [
      {
        id: "iphone-16",
        label: "iPhone 16",
        pricingMode: "flat",
        flatPrice: 50,
        includedKg: 2,
      },
      {
        id: "tv",
        label: "Television",
        pricingMode: "flat",
        flatPrice: 120,
      },
      {
        id: "cables",
        label: "Cables",
        pricingMode: "per_kg",
      },
      // Listed, never priced.
      {id: "laptop", label: "Laptop"},
    ],
    otherPricingMode: "per_kg",
  },
  clothing: {items: []},
};

test("a set price is published, and never asks the customer for a weight", () => {
  const phone = freightItemPricing({
    table: PRICED,
    categoryId: "electronics",
    itemId: "iphone-16",
  });
  assert.equal(phone.priced, true);
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
  });
  assert.equal(tv.includedKg, 0);
  assert.equal(tv.needsWeightAtBooking, false);
  assert.equal(tv.weighsAtDropOff, false);
});

test("a by-weight row is the route's own rate, and nothing on top", () => {
  const cables = freightItemPricing({
    table: PRICED,
    categoryId: "electronics",
    itemId: "cables",
  });
  assert.equal(cables.priced, true);
  assert.equal(cables.mode, "per_kg");
  // The plain route rate. There is no factor left anywhere to multiply by.
  assert.equal(cables.weightFactor, 1);
  assert.equal(cables.needsWeightAtBooking, true);
  assert.equal(cables.weighsAtDropOff, true);
});

test("a row nobody priced is not priced, and never guesses", () => {
  // A listed row with no pricing of its own is an item this business has
  // never quoted, and it takes its own answer rather than the catch-all's -
  // which is for things nobody listed.
  const unpriced = freightItemPricing({
    table: PRICED,
    categoryId: "electronics",
    itemId: "laptop",
  });
  assert.equal(unpriced.priced, false);
  assert.equal(unpriced.mode, null);
  assert.equal(unpriced.flatPrice, 0);
  assert.equal(unpriced.weightFactor, 0);
  assert.equal(unpriced.needsWeightAtBooking, false);
  assert.equal(unpriced.source, null);

  // A whole table that has never been priced answers the same way.
  assert.equal(
    freightItemPricing({
      table: TABLE,
      categoryId: "electronics",
      itemId: "iphone",
    }).priced,
    false,
  );
  // As does no table at all.
  assert.equal(
    freightItemPricing({table: undefined, categoryId: "electronics"}).priced,
    false,
  );
});

test("an unlisted item falls through to the category's own pricing", () => {
  const unlisted = freightItemPricing({
    table: PRICED,
    categoryId: "electronics",
    itemId: "walkman",
  });
  assert.equal(unlisted.priced, true);
  assert.equal(unlisted.source, "other");
  assert.equal(unlisted.mode, "per_kg");
  assert.equal(unlisted.weightFactor, 1);
  // A category whose catch-all names no pricing has no price to give.
  const clothing = freightItemPricing({
    table: PRICED,
    categoryId: "clothing",
  });
  assert.equal(clothing.priced, false);
  assert.equal(clothing.source, null);
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

test("an unpriced item shows the request path and never a price", () => {
  // The whole point of `priced`. A customer who picks something nobody has
  // put a number on must not be shown a number, must not be shown a way to
  // pay one, and must be shown where to get one.
  const customer = readFileSync(
    "src/components/customer-shipping-services.tsx",
    "utf8",
  );
  // The estimate, the review footer and the receiver/weight/pickup block all
  // hang off a resolved price.
  assert.match(customer, /\{destination && itemPricing\.priced && \(<>/);
  assert.match(
    customer,
    /footerVisible=\{Boolean\(destination\) && itemPricing\.priced\}/,
  );
  // And checkout cannot be reached without one.
  assert.match(customer, /itemPricing\.priced &&\s*\n\s*\/\/ A set-price item/);
  // The request replaces the dead end, both when nobody prices the item and
  // when the chosen business does not.
  assert.match(
    customer,
    /qualifiedProviderOptions\.length === 0 \|\|\s*\n\s*\(destination !== null && !itemPricing\.priced\)/,
  );
  assert.match(customer, /<FreightPriceRequest\b/);
  assert.match(customer, /createFreightQuoteRequest/);
});
