import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { translateValue } from "./french-dom.ts";
import {
  COUNTED_SOURCE_DEFAULTS,
  COUNTED_SOURCE_KEYS,
  COUNTED_SOURCE_LABELS,
  countedSourcesFrom,
  setCountedSourcesRequest,
  staffBalancesFrom,
  staffBalancesRefusalText,
} from "./staff-balances.ts";

// docs/STAFF_BALANCES.md §7: each business chooses what counts.
test("invoices are off by default; every key is filled", () => {
  assert.deepEqual(countedSourcesFrom(undefined), COUNTED_SOURCE_DEFAULTS);
  assert.equal(COUNTED_SOURCE_DEFAULTS.invoice, false);
  assert.deepEqual(countedSourcesFrom({ invoice: true, shop: false, junk: true }),
    { parking: true, activity: true, package: true, shop: false, invoice: true });
  assert.deepEqual(staffBalancesFrom({ counted: { package: false } }).counted.package, false);
});

test("the request sends the whole choice", () => {
  const sources = { ...COUNTED_SOURCE_DEFAULTS, package: false };
  assert.deepEqual(setCountedSourcesRequest("biz", sources),
    { action: "set_counted_sources", businessId: "biz", sources });
});

test("refusals read in words", () => {
  assert.match(staffBalancesRefusalText({ details: { reason: "counted_sources_owner_only" } }), /Only the business owner/);
});

test("the panel shows the choice; only the owner can change it", () => {
  const panel = readFileSync("src/components/business/staff-balances-panel.tsx", "utf8");
  assert.match(panel, /<fieldset className="sb-counted" disabled=\{!viewer\.isOwner/);
  assert.match(panel, /setCountedSourcesRequest\(businessId, sources\)/);
});

test("its words read in French", () => {
  for (const key of COUNTED_SOURCE_KEYS) {
    assert.notEqual(translateValue(COUNTED_SOURCE_LABELS[key], "fr"), COUNTED_SOURCE_LABELS[key], key);
  }
  for (const english of ["What counts as the business's money", "The business owner chooses what counts.",
    "Untick money that belongs to the person who took it, like their own car sales.",
    "Saved. The balances now count only what is ticked.",
    "Only the business owner can choose what counts as the business's money."]) {
    assert.notEqual(translateValue(english, "fr"), english, english);
  }
});
