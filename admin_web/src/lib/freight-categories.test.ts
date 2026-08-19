// What is in the parcel, what it is worth, and who stands behind it.
//
// The client is not the authority on any of this - the server prices the
// shipment and the server refuses the ones it will not carry. These tests
// exist because the client still has to *say* the same thing: a customer who
// reads "$34.00" and is charged "$34.01", or who is told a parcel is fine and
// then refused at the payment step, has been lied to by the interface.
//
// So the properties locked in here are agreement with
// functions/freight_categories.js and functions/freight_coverage.js: the same
// default multipliers, the same rounding, the same ceilings, and the same
// refusal sentences word for word.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { translateValue } from "./french-dom.ts";
import {
  DECLARATION_THRESHOLD,
  MAX_CUSTOM_FREIGHT_CATEGORIES,
  PLATFORM_MAX_DECLARED_VALUE,
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
  quoteFreightCoverage,
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

test("ticking cover without a rate is not cover, on the client either", () => {
  assert.equal(freightCoveragePolicyFrom(null), null);
  assert.deepEqual(
    freightCoveragePolicyFrom({
      coversLoss: true,
      ratePct: 0,
      maxDeclaredValue: 0,
      declarationThreshold: 200,
    }),
    {
      coversLoss: false,
      ratePct: 0,
      maxDeclaredValue: 0,
      declarationThreshold: 200,
    },
  );
  // Whatever a stale document says, neither number may exceed the platform's.
  assert.deepEqual(
    freightCoveragePolicyFrom({
      coversLoss: true,
      ratePct: 40,
      maxDeclaredValue: 999999,
    }),
    {
      coversLoss: true,
      ratePct: 10,
      maxDeclaredValue: PLATFORM_MAX_DECLARED_VALUE,
      declarationThreshold: DECLARATION_THRESHOLD,
    },
  );
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

test("a declared value buys a capped payout, and the cap is the declaration", () => {
  const policy = freightCoveragePolicyFrom({
    coversLoss: true,
    ratePct: 2,
    maxDeclaredValue: 2000,
  });
  assert.deepEqual(quoteFreightCoverage({policy, declaredValue: 1000}), {
    ok: true,
    declaredValue: 1000,
    coverageFee: 20,
    covered: true,
    payoutCap: 1000,
  });
  // Nothing declared costs nothing and promises nothing.
  assert.deepEqual(quoteFreightCoverage({policy, declaredValue: 0}), {
    ok: true,
    declaredValue: 0,
    coverageFee: 0,
    covered: false,
    payoutCap: 0,
  });
});

test("the client refuses only what the server refuses, in the server's words", () => {
  const capped = freightCoveragePolicyFrom({
    coversLoss: true,
    ratePct: 2,
    maxDeclaredValue: 2000,
  });
  assert.deepEqual(quoteFreightCoverage({policy: capped, declaredValue: 2500}), {
    ok: false,
    message: "This business does not carry parcels worth that much",
  });
  const uncapped = freightCoveragePolicyFrom({
    coversLoss: true,
    ratePct: 2,
    maxDeclaredValue: 0,
  });
  assert.deepEqual(
    quoteFreightCoverage({policy: uncapped, declaredValue: 25000}),
    {ok: false, message: "That declared value is too high to ship"},
  );
  // The ceiling is about what a business will carry, not about what it
  // insures: a business that covers nothing still refuses the parcel.
  const noCover = freightCoveragePolicyFrom({
    coversLoss: false,
    ratePct: 0,
    maxDeclaredValue: 500,
  });
  assert.deepEqual(quoteFreightCoverage({policy: noCover, declaredValue: 900}), {
    ok: false,
    message: "This business does not carry parcels worth that much",
  });
  // Under the ceiling it is recorded but nothing is charged or promised.
  assert.deepEqual(quoteFreightCoverage({policy: noCover, declaredValue: 300}), {
    ok: true,
    declaredValue: 300,
    coverageFee: 0,
    covered: false,
    payoutCap: 0,
  });
});

test("the comparison line says what a customer is choosing between", () => {
  assert.equal(
    freightCoverageComparisonLine(
      freightCoveragePolicyFrom({
        coversLoss: true,
        ratePct: 2,
        maxDeclaredValue: 2000,
      }),
      money,
    ),
    "Covers up to $2,000 · 2%",
  );
  assert.equal(
    freightCoverageComparisonLine(
      freightCoveragePolicyFrom({
        coversLoss: true,
        ratePct: 1.5,
        maxDeclaredValue: 0,
      }),
      money,
    ),
    "Covers what you declare · 1.5%",
  );
  // The business that stands behind nothing has to say so on the same card,
  // before the choice, not after the parcel is gone.
  assert.equal(
    freightCoverageComparisonLine(
      freightCoveragePolicyFrom({coversLoss: false, ratePct: 0}),
      money,
    ),
    "No coverage",
  );
  assert.equal(freightCoverageComparisonLine(null, money), "No coverage");
  assert.equal(formatMultiplier(2), "2");
  assert.equal(formatMultiplier(1.5), "1.5");
});

test("a business's stored settings round-trip into the form", () => {
  const settings = freightSettingsFromRow({
    id: "b",
    freightCategoryRates: {electronics: 2.5},
    freightCustomCategories: [
      {id: "auto-parts", label: "Auto parts", hint: "Brakes", multiplier: 1.4},
    ],
    freightCoverageEnabled: true,
    freightCoverageRatePct: 2,
    freightMaxDeclaredValue: 2000,
  });
  assert.equal(settings.categoryRates.electronics, "2.5");
  // A row it never touched shows the platform's starting number, not a blank.
  assert.equal(settings.categoryRates.fragile, "1.5");
  assert.deepEqual(settings.customCategories, [
    {id: "auto-parts", label: "Auto parts", hint: "Brakes", multiplier: "1.4"},
  ]);
  assert.equal(settings.coversLoss, true);
  assert.equal(settings.coverageRatePct, "2");
  assert.equal(settings.maxDeclaredValue, "2000");
  // A business that has set nothing covers nothing and accepts anything -
  // exactly how freight behaved before any of this existed.
  const untouched = freightSettingsFromRow(null);
  assert.equal(untouched.coversLoss, false);
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
      coverageRatePct: "2",
      maxDeclaredValue: "2000",
    }),
  );
  // Storing a row that equals today's default would pin this business to it
  // forever; "set nothing, change nothing" is what made categories safe.
  assert.deepEqual(payload.freightCategoryRates, {electronics: 2.5});
  assert.deepEqual(payload.freightCustomCategories, [
    {id: "auto-parts", label: "Auto Parts", hint: "Brakes", multiplier: 1.4},
  ]);
  assert.deepEqual(payload.freightCoverage, {
    coversLoss: true,
    ratePct: 2,
    maxDeclaredValue: 2000,
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
  assert.equal(
    validateFreightSettings(draft({coverageRatePct: "25"})),
    "The coverage rate must be between 0% and 10%.",
  );
  assert.equal(
    validateFreightSettings(draft({maxDeclaredValue: "50000"})),
    "The most you will carry must be between $0 and $10,000.",
  );
  // The one refusal that is not about a number being out of range: a promise
  // to pay, with nothing collected for it.
  assert.equal(
    validateFreightSettings(draft({coversLoss: true, coverageRatePct: "0"})),
    "Set a coverage rate above 0%, or turn off cover for lost parcels. Cover at no price is money you never collected for.",
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
  // The comparison line, which is the whole point of showing cover early.
  assert.equal(translateValue("No coverage", "fr"), "Aucune couverture");
  assert.equal(translateValue("Covers up to", "fr"), "Couvre jusqu’à");
  assert.equal(
    translateValue("If your parcel is lost", "fr"),
    "Si votre colis est perdu",
  );
  // Refusals the server throws are shown word for word, so they need French
  // or a French customer gets an English refusal at the payment step.
  assert.equal(
    translateValue("This business does not carry parcels worth that much", "fr"),
    "Cette entreprise ne transporte pas de colis d’une telle valeur",
  );
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
      "Set a coverage rate above 0%, or turn off cover for lost parcels. Cover at no price is money you never collected for.",
      "fr",
    ),
    "Fixez un taux de couverture supérieur à 0 %, ou désactivez la couverture des colis perdus. Une couverture gratuite est de l’argent que vous n’avez jamais encaissé.",
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
  // payload sends the answer that fits the chosen one: the item row when it
  // has a payback table, the typed value only for businesses without one.
  assert.match(customer, /What are you sending\?/);
  assert.match(customer, /funnelItems\.map/);
  assert.match(customer, /itemStepSatisfied && qualifiedProviderOptions/);
  assert.match(customer, /<FreightValueField/);
  assert.match(customer, /usesItemPricing\s*\n?\s*\? \{itemId: itemId === OTHER_ITEM_ID \? "" : itemId\}/);
  // The comparison surface: coverage on the card, before a business is picked.
  assert.match(customer, /freightCoverageComparisonLine\(/);
  assert.match(customer, /customer-destination-coverage/);
  // The cap is on the screen, not behind an "i": UI convention 1 forbids
  // hiding anything the reader needs to avoid a mistake, and a payout cap is
  // exactly that.
  assert.match(customer, /We pay up to/);
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
  assert.match(business, /You pay the customer back, not Laawol\./);

  // Both halves ride on the one callable that already carries them.
  const settings = readFileSync(
    new URL("./business-service-settings.ts", import.meta.url),
    "utf8",
  );
  assert.match(settings, /buildFreightSettingsPayload/);
  assert.match(settings, /validateFreightSettings/);
});
