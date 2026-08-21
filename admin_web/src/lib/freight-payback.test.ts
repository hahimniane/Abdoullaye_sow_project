import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  freightItemChoicesFor,
  freightPaybackFor,
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
  assert.match(customer, /Protection included · up to \$\{formatMoney\(paybackAmount\)\}/);
  assert.match(customer, /value: "Free"/);
  assert.doesNotMatch(customer, /label:\s*"Cover for loss"/);
  // Nothing anywhere in the estimate adds a cover line to the total.
  assert.doesNotMatch(customer, /\+ coverageFee/);
});

test("the form follows its own answer, and never narrates history", () => {
  // A form that ignores the answer it just received reads as broken: the
  // obligation warning belongs to businesses that said yes, and the delivery
  // fee to businesses that said they deliver. And pre-launch copy never
  // frames a feature against a previous version nobody ever saw.
  const business = readFileSync(
    new URL(
      "../components/business/profile-support-people.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    business,
    /\{draft\.coversLoss && \(\s*<div className="customer-inline-note wide">/,
  );
  assert.match(
    business,
    /\{draft\.destinationDelivery && \(\s*<label className="lst-field wide">/,
  );
  assert.doesNotMatch(business, /no longer type/);
  for (const source of [business]) {
    assert.doesNotMatch(source, /no longer|previously|we['’]ve changed/i);
  }
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
