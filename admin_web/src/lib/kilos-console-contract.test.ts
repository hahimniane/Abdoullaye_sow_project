// Kilos on the consoles and the customer form (docs/SHIPPING_SIMPLE_HOME.md K):
// the remembered lb/kg choice, the French for every new string, and the
// source contracts that keep the unit travelling with the weight.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { translateValue } from "./french-dom.ts";
import { WEIGHT_UNIT_KEY, readRememberedWeightUnit, writeRememberedWeightUnit } from "./weight-unit-memory.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function withStorage(storage: unknown, run: () => void) {
  const g = globalThis as unknown as { window?: unknown };
  const before = g.window;
  g.window = { localStorage: storage };
  try {
    run();
  } finally {
    g.window = before;
  }
}

test("the remembered unit: kg or lb, nothing else, and never throws", () => {
  const data = new Map<string, string>();
  const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  withStorage(store, () => {
    assert.equal(readRememberedWeightUnit(), null);
    writeRememberedWeightUnit("kg");
    assert.equal(data.get(WEIGHT_UNIT_KEY), "kg");
    assert.equal(readRememberedWeightUnit(), "kg");
    writeRememberedWeightUnit("lb");
    assert.equal(readRememberedWeightUnit(), "lb");
    data.set(WEIGHT_UNIT_KEY, "stone");
    assert.equal(readRememberedWeightUnit(), null);
  });
  // A blocked store (private window): reads say "none", writes are quiet.
  const blocked = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  withStorage(blocked, () => {
    assert.equal(readRememberedWeightUnit(), null);
    assert.doesNotThrow(() => writeRememberedWeightUnit("kg"));
  });
  // No window at all (a render on the server).
  assert.equal(readRememberedWeightUnit(), null);
});

test("every new kilo string has a French translation", () => {
  const strings = [
    "Price list unit",
    "Price per kilo",
    "Covers up to (kg)",
    "Your prices are now per kg. The amounts did not change. Check them.",
    "Your prices are now per lb. The amounts did not change. Check them.",
    "Enter the weight in kilos (0.1 to 900).",
    "Choose pounds or kilos.",
    "The weight a price covers must be 0 to 500 kg.",
    "Enter a price per kilo between $0.01 and $1,000.",
    "Enter a weight between 0.1 and 900 kg.",
    "Weight (kg)",
    "Weight unit",
    "No price per kilo for the extra weight. Type the price.",
    "Priced by the kilo",
    "Weight in kilos",
    "Pounds (lb)",
    "$ per kg",
    "Weigh in pounds",
    "Weigh in kilos",
    "A fixed price for each item. “Covers up to” is optional: leave it empty when the price is the same at any weight. The extra kilos are charged at the item's category rate per kilo below, else the General goods rate. With neither, you type the price at the counter.",
  ];
  for (const english of strings) {
    const french = translateValue(english, "fr");
    assert.notEqual(french, english, english);
    assert.doesNotMatch(french, /\bkilos?\b.*\b(pounds?|lb)\b.*\bkilos?\b/);
  }
  assert.equal(translateValue("Weight (kg)", "fr"), "Poids (kg)");
  assert.equal(translateValue("Poids (kg)", "en"), "Weight (kg)");
  // An aria-label is a category name, a comma and the unit.
  assert.equal(translateValue("Nourriture, $ per kilo", "fr"), "Nourriture, $ par kilo");
  assert.equal(translateValue("Nourriture, $ per pound", "fr"), "Nourriture, $ par livre");
});

test("the price list editor sends its unit with the routes, and says so once", () => {
  const panel = read("components/business/price-list-panel.tsx");
  assert.match(panel, /action: "price_list", \.\.\.listPayload\(draft\), weightUnit: unit/);
  assert.match(panel, /unitChangedNotice\(unit\)/);
  // The choice is a radio group, beside the by-weight rates.
  assert.match(panel, /role="radiogroup"/);
  assert.match(panel, /setUnitEdit\(choice === stored\.weightUnit \? null : choice\)/);
  // A discard drops the unit change too.
  assert.match(panel, /setEdits\(null\); setUnitEdit\(null\); setError\(""\);/);
});

test("the weight field is in the business's unit, with a choice only without a price list", () => {
  const fields = read("components/business/proof-fields.tsx");
  assert.match(fields, /useBusinessWeightUnit\(businessId\)/);
  // The choice waits for the list's answer, and so does the field: a weight
  // typed sooner would keep a unit the list is about to change.
  assert.match(fields, /\{businessUnit\.settled && !businessUnit\.fromList && \(/);
  assert.match(fields, /disabled=\{disabled \|\| !businessUnit\.settled\}/);
  assert.match(fields, /patch\(\{ weightLb: e\.target\.value, weightUnit: unit \}\)/);
  const hook = read("components/business/use-business-weight-unit.ts");
  assert.match(hook, /useLiveDocRead\("packagePriceLists", businessId, enabled\)/);
  assert.match(hook, /readRememberedWeightUnit/);
  // A list that never answers still lets staff type.
  assert.match(hook, /settled: !enabled \|\| !businessId \|\| list\.settled \|\| timedOut/);
});

test("the customer form asks in the business's unit and sends the unit with the number", () => {
  const form = read("components/package-request-form.tsx");
  assert.match(form, /catalogWeightUnit\(modeOpts, viaBusiness \? onlyBusinessId : ""\)/);
  assert.match(form, /addWeightLine\(lines, categoryId, weightUnit\)/);
  assert.match(form, /setWeightUnit\(row, unit\)/);
  const compare = read("lib/package-compare.ts");
  assert.match(compare, /weightLb, weightUnit: line\.weightUnit/);
});

test("the counter weighs in the price's unit", () => {
  const requests = read("components/business/package-requests-panel.tsx");
  assert.match(requests, /readWeight\(typed, unitOf\(price\)\)/);
  assert.match(requests, /weighedPriceInput\(price, typed, l\)/);
});
