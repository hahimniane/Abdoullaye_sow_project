// What is in the parcel, and who stands behind it.
//
// The client is not the authority on any of this - the server prices the
// shipment and the server refuses the ones it will not carry. These tests
// exist because the client still has to *say* the same thing: a customer who
// reads "$34.00" and is charged "$34.01", or who is told a parcel is fine and
// then refused at the payment step, has been lied to by the interface.
//
// So the properties locked in here are agreement with
// functions/freight_categories.js and functions/freight_coverage.js: the same
// default multipliers, the same rounding, and the same one-question coverage
// policy that charges the customer nothing.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { translateValue } from "./french-dom.ts";
import {
  MAX_CUSTOM_FREIGHT_CATEGORIES,
  STANDARD_FREIGHT_CATEGORIES,
  buildFreightSettingsPayload,
  defaultFreightCategoryId,
  emptyFreightCustomCategory,
  formatMultiplier,
  freightCategoryMultiplier,
  freightCategoryOptionsFrom,
  freightCategoryPricing,
  freightCategorySlug,
  freightCoverageComparisonLine,
  freightCoveragePolicyFrom,
  freightSettingsFromRow,
  validateFreightSettings,
  type FreightSettingsDraft,
} from "./freight-categories.ts";

const money = (value: number) => `$${value.toLocaleString("en-US")}`;

function draft(patch: Partial<FreightSettingsDraft> = {}): FreightSettingsDraft {
  return {
    ...freightSettingsFromRow(null),
    ...patch,
  };
}

test("the standard list mirrors the platform's, ids and defaults alike", () => {
  assert.deepEqual(
    STANDARD_FREIGHT_CATEGORIES.map((category) => [
      category.id,
      category.defaultMultiplier,
    ]),
    [
      ["general", 1],
      ["clothing", 1],
      ["food", 1],
      ["documents", 1],
      ["cosmetics", 1.2],
      ["electronics", 2],
      ["fragile", 1.5],
    ],
  );
});

test("category rows from the callable are read defensively", () => {
  const options = freightCategoryOptionsFrom([
    {id: "General", label: "General goods", hint: "Anything", multiplier: 1},
    // A duplicate, a nameless row, and junk: none of them may reach a picker.
    {id: "general", label: "Copy", multiplier: 3},
    {id: "broken", label: "   "},
    "nonsense",
    // Out of band on both sides: clamped, never trusted as sent.
    {id: "cheap", label: "Cheap", multiplier: 0.01, custom: true},
    {id: "silly", label: "Silly", multiplier: 999, custom: true},
    {id: "unreadable", label: "Unreadable", multiplier: "abc"},
  ]);
  assert.deepEqual(
    options.map((option) => [option.id, option.multiplier, option.custom]),
    [
      ["general", 1, false],
      ["cheap", 0.5, true],
      ["silly", 10, true],
      ["unreadable", 1, false],
    ],
  );
  assert.deepEqual(freightCategoryOptionsFrom(undefined), []);
  // An unknown or absent category prices exactly as freight did before
  // categories existed, so a stale screen quotes rather than errors.
  assert.equal(freightCategoryMultiplier(options, "missing"), 1);
  assert.equal(freightCategoryMultiplier(options, ""), 1);
  assert.equal(freightCategoryMultiplier(options, "GENERAL"), 1);
});

test("the picker starts on general, or on whatever is first", () => {
  const options = freightCategoryOptionsFrom([
    {id: "auto-parts", label: "Auto parts", multiplier: 1.4, custom: true},
    {id: "general", label: "General goods", multiplier: 1},
  ]);
  assert.equal(defaultFreightCategoryId(options), "general");
  assert.equal(
    defaultFreightCategoryId(options.filter((row) => row.custom)),
    "auto-parts",
  );
  assert.equal(defaultFreightCategoryId([]), "");
});

test("the coverage policy is one flag, and it never narrows a promise", () => {
  assert.equal(freightCoveragePolicyFrom(null), null);
  // A business that answered yes covers loss, full stop. Numbers left on a
  // stale document must not qualify that: a rate of 0 alongside the flag
  // once meant "not really covered", and reading it here would quietly deny
  // a payout the business is promising today.
  assert.deepEqual(
    freightCoveragePolicyFrom({
      coversLoss: true,
      ratePct: 0,
      maxDeclaredValue: 0,
    }),
    {coversLoss: true},
  );
  assert.deepEqual(
    freightCoveragePolicyFrom({coversLoss: false, ratePct: 40}),
    {coversLoss: false},
  );
  assert.deepEqual(freightCoveragePolicyFrom({}), {coversLoss: false});
});

test("the price shown is the price the server computes", () => {
  // The server rounds weight x rate x multiplier once. Rounding the rate first
  // and multiplying after drifts by a cent, which is exactly the difference a
  // customer notices between the estimate and the card statement.
  assert.deepEqual(
    freightCategoryPricing({baseRatePerKg: 8.33, weightKg: 3, multiplier: 2}),
    {
      baseRatePerKg: 8.33,
      categoryRatePerKg: 16.66,
      multiplier: 2,
      shippingSubtotal: 49.98,
      categorySurcharge: 24.99,
    },
  );
  assert.equal(
    freightCategoryPricing({baseRatePerKg: 0, weightKg: 3, multiplier: 1}),
    null,
  );
  assert.equal(
    freightCategoryPricing({
      baseRatePerKg: 5,
      weightKg: Number.NaN,
      multiplier: 1,
    }),
    null,
  );
});

test("the comparison line says what a customer is choosing between", () => {
  const covers = freightCoveragePolicyFrom({coversLoss: true});
  // A promise, not a ceiling: "up to" reads as a limit the customer will be
  // argued down to, when the business owes this whole amount for this item.
  assert.equal(
    freightCoverageComparisonLine(covers, money, 400),
    "Pays you $400 if it is lost",
  );
  assert.doesNotMatch(
    freightCoverageComparisonLine(covers, money, 400),
    /up to/,
  );
  // No amount to state yet: still a promise, and never a price.
  assert.equal(
    freightCoverageComparisonLine(covers, money, 0),
    "Pays you back if it is lost",
  );
  assert.equal(
    freightCoverageComparisonLine(covers, money),
    "Pays you back if it is lost",
  );
  // The business that stands behind nothing has to say so on the same card,
  // before the choice, not after the parcel is gone.
  assert.equal(
    freightCoverageComparisonLine(
      freightCoveragePolicyFrom({coversLoss: false}),
      money,
      400,
    ),
    "This business does not pay for a lost parcel",
  );
  assert.equal(
    freightCoverageComparisonLine(null, money),
    "This business does not pay for a lost parcel",
  );
  assert.equal(formatMultiplier(2), "2");
  assert.equal(formatMultiplier(1.5), "1.5");
});

test("no line the customer reads ever prices cover", () => {
  const covers = freightCoveragePolicyFrom({coversLoss: true});
  for (const amount of [0, 1, 250, 10000]) {
    const line = freightCoverageComparisonLine(covers, money, amount);
    assert.doesNotMatch(line, /%/);
    assert.doesNotMatch(line, /fee|rate|charge/i);
  }
  // And nothing about the policy can produce a number to charge: the type
  // carries one boolean, so there is nothing for a price to be derived from.
  assert.deepEqual(Object.keys(covers ?? {}), ["coversLoss"]);
});

test("a business's stored settings round-trip into the form", () => {
  const settings = freightSettingsFromRow({
    id: "b",
    freightCategoryRates: {electronics: 2.5},
    freightCustomCategories: [
      {id: "auto-parts", label: "Auto parts", hint: "Brakes", multiplier: 1.4},
    ],
    freightCoverageEnabled: true,
    freightDestinationDeliveryAvailable: true,
    freightDestinationDeliveryFee: 15,
  });
  assert.equal(settings.categoryRates.electronics, "2.5");
  // A row it never touched shows the platform's starting number, not a blank.
  assert.equal(settings.categoryRates.fragile, "1.5");
  assert.deepEqual(settings.customCategories, [
    {id: "auto-parts", label: "Auto parts", hint: "Brakes", multiplier: "1.4"},
  ]);
  assert.equal(settings.coversLoss, true);
  assert.equal(settings.destinationDelivery, true);
  assert.equal(settings.destinationDeliveryFee, "15");
  // Cover is one answer: there is no rate or ceiling left for the form to
  // round-trip, and reading one would put a price back on the screen.
  assert.ok(!("coverageRatePct" in settings));
  assert.ok(!("maxDeclaredValue" in settings));
  // A business that has set nothing covers nothing, holds the parcel for
  // collection, and accepts anything.
  const untouched = freightSettingsFromRow(null);
  assert.equal(untouched.coversLoss, false);
  assert.equal(untouched.destinationDelivery, false);
  assert.deepEqual(untouched.customCategories, []);
  assert.deepEqual(buildFreightSettingsPayload(untouched).freightCategoryRates, {});
});

test("only the rows a business actually moved are saved", () => {
  const payload = buildFreightSettingsPayload(
    draft({
      categoryRates: {
        ...freightSettingsFromRow(null).categoryRates,
        electronics: "2.5",
      },
      customCategories: [
        {id: "", label: " Auto Parts ", hint: " Brakes ", multiplier: "1.4"},
      ],
      coversLoss: true,
      destinationDelivery: true,
      destinationDeliveryFee: "15",
    }),
  );
  // Storing a row that equals today's default would pin this business to it
  // forever; "set nothing, change nothing" is what made categories safe.
  assert.deepEqual(payload.freightCategoryRates, {electronics: 2.5});
  assert.deepEqual(payload.freightCustomCategories, [
    {id: "auto-parts", label: "Auto Parts", hint: "Brakes", multiplier: 1.4},
  ]);
  // One key, because there is one question. A rate or a ceiling reaching the
  // callable would be a fee the customer never agreed to.
  assert.deepEqual(payload.freightCoverage, {coversLoss: true});
  assert.deepEqual(payload.freightDestinationDelivery, {
    available: true,
    fee: 15,
  });
  assert.equal(freightCategorySlug("Building materials!"), "building-materials");
  assert.equal(freightCategorySlug("   "), "");
  assert.deepEqual(emptyFreightCustomCategory(), {
    id: "",
    label: "",
    hint: "",
    multiplier: "1",
  });
});

test("the settings form refuses what the server would refuse", () => {
  assert.equal(validateFreightSettings(draft()), null);

  assert.equal(
    validateFreightSettings(
      draft({
        categoryRates: {
          ...freightSettingsFromRow(null).categoryRates,
          electronics: "40",
        },
      }),
    ),
    "Electronics: enter a price multiplier between 0.5 and 10.",
  );
  assert.equal(
    validateFreightSettings(
      draft({customCategories: [{id: "", label: "  ", hint: "", multiplier: "1"}]}),
    ),
    "Give every item category you add a name.",
  );
  assert.equal(
    validateFreightSettings(
      draft({
        customCategories: [
          {id: "", label: "Electronics", hint: "", multiplier: "1"},
        ],
      }),
    ),
    "A category you add cannot reuse the name of a standard category.",
  );
  assert.equal(
    validateFreightSettings(
      draft({
        customCategories: [
          {id: "", label: "Auto parts", hint: "", multiplier: "1"},
          {id: "", label: "Auto Parts", hint: "", multiplier: "1"},
        ],
      }),
    ),
    "Two of the categories you added have the same name. Give each one its own.",
  );
  assert.equal(
    validateFreightSettings(
      draft({
        customCategories: Array.from(
          {length: MAX_CUSTOM_FREIGHT_CATEGORIES + 1},
          (_, index) => ({
            id: "",
            label: `Extra ${index}`,
            hint: "",
            multiplier: "1",
          }),
        ),
      }),
    ),
    "You can add up to 6 categories of your own.",
  );
  // Cover is savable on its own answer: it is free, so there is no number to
  // be out of range and no reason to refuse a business that says yes.
  assert.equal(validateFreightSettings(draft({coversLoss: true})), null);
  // Delivery, unlike cover, does cost money - and an opted-in business with
  // no fee is an unfinished setting rather than free delivery.
  assert.equal(
    validateFreightSettings(
      draft({destinationDelivery: true, destinationDeliveryFee: ""}),
    ),
    "Set a delivery fee, or turn destination delivery off.",
  );
  assert.equal(
    validateFreightSettings(
      draft({destinationDelivery: true, destinationDeliveryFee: "900"}),
    ),
    "The delivery fee must be between $0 and $500.",
  );
  assert.equal(
    validateFreightSettings(
      draft({destinationDelivery: true, destinationDeliveryFee: "15"}),
    ),
    null,
  );
});

test("everything the two screens say has French", () => {
  // Category names come back from the server and are rendered verbatim, so a
  // French customer would otherwise pick from an English list.
  assert.equal(translateValue("General goods", "fr"), "Marchandises générales");
  assert.equal(translateValue("Electronics", "fr"), "Électronique");
  assert.equal(
    translateValue("Phones, laptops, tablets, chargers", "fr"),
    "Téléphones, ordinateurs portables, tablettes, chargeurs",
  );
  // The comparison line, which is the whole point of showing cover early -
  // including the half of it a French customer most needs to understand.
  assert.equal(
    translateValue("This business does not pay for a lost parcel", "fr"),
    "Cette entreprise ne rembourse pas un colis perdu",
  );
  assert.equal(translateValue("Protection", "fr"), "Protection");
  assert.equal(
    translateValue("Protection included", "fr"),
    "Protection incluse",
  );
  assert.equal(
    translateValue("Pays you back if it is lost", "fr"),
    "Vous rembourse en cas de perte",
  );
  // What protection costs, said in the price column of the estimate.
  assert.equal(translateValue("Free", "fr"), "Offert");
  // Refusals the settings form raises itself.
  assert.equal(
    translateValue(
      "Electronics: enter a price multiplier between 0.5 and 10.",
      "fr",
    ),
    "Électronique : saisissez un multiplicateur de prix entre 0,5 et 10.",
  );
  assert.equal(
    translateValue(
      "Set a delivery fee, or turn destination delivery off.",
      "fr",
    ),
    "Fixez des frais de livraison, ou désactivez la livraison à l’arrivée.",
  );
  // A category a business invented is left alone; the sentence around it is
  // still translated, so the refusal is readable either way.
  assert.match(
    translateValue("Auto parts: enter a price multiplier between 0.5 and 10.", "fr"),
    /saisissez un multiplicateur de prix entre 0,5 et 10\.$/,
  );
});

test("both consoles are wired to the freight category and coverage contract", () => {
  const customer = readFileSync(
    new URL("../components/customer-shipping-services.tsx", import.meta.url),
    "utf8",
  );
  // The funnel asks what is being sent BEFORE showing businesses, and the
  // payload sends the business's own item row - the only thing that decides
  // what a lost parcel pays back.
  assert.match(customer, /What are you sending\?/);
  assert.match(customer, /funnelItems\.map/);
  assert.match(customer, /itemStepSatisfied && qualifiedProviderOptions/);
  assert.match(
    customer,
    /usesItemPricing && \{\s*itemId: activeItemId === OTHER_ITEM_ID \? "" : activeItemId,/,
  );
  // The comparison surface: coverage on the card, before a business is picked.
  assert.match(customer, /freightCoverageComparisonLine\(/);
  assert.match(customer, /customer-destination-coverage/);
  // The amount is on the screen, not behind an "i": UI convention 1 forbids
  // hiding anything the reader needs to avoid a mistake, and what a business
  // owes on a lost parcel is exactly that.
  assert.match(customer, /pays you<\/span> \{formatMoney\(paybackAmount\)\}/);
  assert.doesNotMatch(customer, /<FieldInfo[\s\S]{0,400}We pay up to/);

  const business = readFileSync(
    new URL("../components/business/profile-support-people.tsx", import.meta.url),
    "utf8",
  );
  assert.match(business, /<FreightGoodsEditor/);
  // Explained with an "i" rather than a permanent amber banner.
  assert.match(business, /FieldInfo label="how item categories change your price"/);
  assert.match(business, /FieldInfo label="how cover for a lost parcel works"/);
  // What a business owes on a lost parcel is money moving, so it stays on the
  // screen whether or not anyone presses the "i".
  assert.match(business, /You pay the customer back, not Laawol/);

  // Both halves ride on the one callable that already carries them.
  const settings = readFileSync(
    new URL("./business-service-settings.ts", import.meta.url),
    "utf8",
  );
  assert.match(settings, /buildFreightSettingsPayload/);
  assert.match(settings, /validateFreightSettings/);
});

test("nothing on either screen asks the customer what the parcel is worth", () => {
  const customer = readFileSync(
    new URL("../components/customer-shipping-services.tsx", import.meta.url),
    "utf8",
  );
  const business = readFileSync(
    new URL("../components/business/profile-support-people.tsx", import.meta.url),
    "utf8",
  );
  // A sender's own valuation was either a guess or an incentive, and pricing
  // off it made the honest customer subsidise the optimistic one. There is
  // no input for it, no state behind one, and no ceiling to compare it to.
  for (const source of [customer, business]) {
    assert.doesNotMatch(source, /declaredValue|declaresValue|maxDeclaredValue/);
    assert.doesNotMatch(source, /coverageRatePct|coverageFee|ratePct/);
  }
  assert.doesNotMatch(customer, /What would it cost to replace/);
  assert.doesNotMatch(business, /Most you will carry/);
  // And the payload cannot carry one even if a caller tried.
  const shipping = readFileSync(
    new URL("./customer-shipping.ts", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(shipping, /declaredValue/);
});
