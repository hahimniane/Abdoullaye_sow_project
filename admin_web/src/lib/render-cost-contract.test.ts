import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  SHOW_MORE_STEP,
  initialShowMore,
  showMoreLimit,
  showMoreNext,
  showMoreSlice,
} from "./show-more.ts";
import { staffNameFrom, staffNameIndex } from "./staff-names.ts";

test("staff names come from one index, first readable field wins", () => {
  const index = staffNameIndex([
    { id: "a", fullName: "Awa Diallo", email: "awa@example.com" },
    { id: "b", fullName: "", name: "", email: "yard@example.com" },
    { id: "c" },
    { id: "a", fullName: "Duplicate" },
  ]);
  assert.equal(staffNameFrom(index, "a"), "Awa Diallo");
  assert.equal(staffNameFrom(index, "b"), "yard@example.com");
  assert.equal(staffNameFrom(index, "c"), "");
  assert.equal(staffNameFrom(index, "missing"), "");
  assert.equal(staffNameFrom(index, ""), "");
});

test("show more pages 50 at a time and restarts when the filters change", () => {
  const rows = Array.from({ length: 120 }, (_, index) => index);
  let state = initialShowMore("all|");
  let { shown, remaining } = showMoreSlice(rows, showMoreLimit(state, "all|"));
  assert.equal(shown.length, SHOW_MORE_STEP);
  assert.equal(remaining, 70);

  state = showMoreNext(state, "all|");
  ({ shown, remaining } = showMoreSlice(rows, showMoreLimit(state, "all|")));
  assert.equal(shown.length, 100);
  assert.equal(remaining, 20);

  // A new search starts from the first page again.
  assert.equal(showMoreLimit(state, "all|awa"), SHOW_MORE_STEP);
  const short = showMoreSlice(rows.slice(0, 10), SHOW_MORE_STEP);
  assert.equal(short.remaining, 0);
  assert.equal(short.shown.length, 10);
});

// Regression: these panels looked up names with `staff.rows.find(...)` and
// destinations with `options.find(...)` inside every table row - O(rows x
// staff) per render - and rendered every finance/invoice row at once.
test("business panels read staff and destinations from indexes built once", () => {
  for (const file of [
    "src/components/business/containers-panel.tsx",
    "src/components/business/invoices-panel.tsx",
    "src/components/business/operations-panels.tsx",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /const staffName = \(id: string\) => \{\s*if \(!id\) return "";\s*const row = staff\.rows\.find/);
  }
  const containers = readFileSync("src/components/business/containers-panel.tsx", "utf8");
  assert.match(containers, /const destinationLabels = useMemo\(/);
  assert.doesNotMatch(containers, /destinationOptions\.all\.find\(\(option\) => option\.id === id\)/);
});

test("the finance ledger and the invoice list render a page at a time", () => {
  const admin = readFileSync("src/components/admin-console.tsx", "utf8");
  assert.match(admin, /\{ledgerPage\.shown\.map\(\(row\) => \(\s*<FinanceLedgerRecordRow/);
  assert.match(admin, /<ShowMoreButton remaining=\{ledgerPage\.remaining\}/);
  const invoices = readFileSync("src/components/business/invoices-panel.tsx", "utf8");
  assert.match(invoices, /\{invoicePage\.shown\.map\(\(row\) => \{/);
  assert.match(invoices, /<ShowMoreButton remaining=\{invoicePage\.remaining\}/);
});
