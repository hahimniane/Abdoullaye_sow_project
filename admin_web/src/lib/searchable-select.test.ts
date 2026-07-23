import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { translateValue } from "./french-dom.ts";
import { filterSearchableOptions } from "./searchable-options.ts";

const destinations = [
  { value: "ci", label: "Côte d’Ivoire", keywords: "CI Ivory Coast" },
  { value: "gn", label: "Guinée", keywords: "GN Guinea" },
  { value: "sn", label: "Sénégal", keywords: "SN Senegal" },
];

test("searchable destinations match accents, codes, and alternate names", () => {
  assert.deepEqual(
    filterSearchableOptions(destinations, "cote").map(
      (option) => option.value,
    ),
    ["ci"],
  );
  assert.deepEqual(
    filterSearchableOptions(destinations, "GN").map(
      (option) => option.value,
    ),
    ["gn"],
  );
  assert.deepEqual(
    filterSearchableOptions(destinations, "Senegal").map(
      (option) => option.value,
    ),
    ["sn"],
  );
  assert.deepEqual(
    filterSearchableOptions(destinations, "  ivory COAST  ").map(
      (option) => option.value,
    ),
    ["ci"],
  );
  assert.deepEqual(filterSearchableOptions(destinations, "nowhere"), []);
});

test("empty searches preserve every option and never mutate the source", () => {
  const before = structuredClone(destinations);
  assert.deepEqual(filterSearchableOptions(destinations, ""), destinations);
  assert.deepEqual(filterSearchableOptions(destinations, "   "), destinations);
  assert.deepEqual(destinations, before);
});

test("shared country picker is an accessible searchable combobox", () => {
  const source = readFileSync(
    new URL("../components/searchable-select.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /role="combobox"/);
  assert.match(source, /role="listbox"/);
  assert.match(source, /role="option"/);
  assert.match(source, /event\.key === "ArrowDown"/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /event\.key === "Tab"/);
  assert.match(source, /event\.preventDefault\(\)/);
  assert.match(source, /aria-invalid=/);
  assert.match(source, /disabled=\{disabled\}/);
  assert.match(source, /tabIndex=\{-1\}/);
  assert.match(source, /scrollIntoView/);
  assert.match(source, /clearOnSearch = false/);
});

test("every editable web country surface reuses the searchable picker", () => {
  for (const file of [
    "../components/customer-phone-field.tsx",
    "../components/customer-shipping-services.tsx",
    "../components/customer-parking-pools.tsx",
    "../components/business/operations-panels.tsx",
    "../components/admin-console.tsx",
  ]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.match(source, /SearchableSelect/);
  }

  const phone = readFileSync(
    new URL("../components/customer-phone-field.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(phone, /<select/);
  assert.match(phone, /CALLING_CODE_OPTIONS\.map/);
});

test("searchable destination copy is localized", () => {
  assert.equal(
    translateValue("Search or choose a country", "fr"),
    "Recherchez ou choisissez un pays",
  );
  assert.equal(
    translateValue(
      "No destination countries match your search.",
      "fr",
    ),
    "Aucun pays de destination ne correspond à votre recherche.",
  );
  assert.equal(
    translateValue("No countries match your search.", "fr"),
    "Aucun pays ne correspond à votre recherche.",
  );
  assert.equal(
    translateValue("Search destination or provider", "fr"),
    "Recherchez une destination ou un prestataire",
  );
  assert.equal(
    translateValue("Phone country options", "fr"),
    "Options de pays du téléphone",
  );
});
