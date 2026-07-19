import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const consoleSource = readFileSync(
  "src/components/business-console.tsx",
  "utf8",
);
const operationsSource = readFileSync(
  "src/components/business/operations-panels.tsx",
  "utf8",
);
const stylesSource = readFileSync("src/app/globals.css", "utf8");

test("business preview does not open authenticated Firestore listeners", () => {
  for (const panel of [
    "ListingsPanel",
    "PurchasesPanel",
    "BarrelsPanel",
    "FreightPanel",
    "TransportPanel",
    "ParkingPanel",
    "DestinationsPanel",
  ]) {
    assert.match(
      consoleSource,
      new RegExp(`<${panel}[\\s\\S]{0,220}previewMode=\\{previewMode\\}`),
      `${panel} must receive previewMode`,
    );
  }

  assert.match(
    consoleSource,
    /<SupportCasesPanel[\s\S]{0,400}enabled=\{!previewMode\}/,
  );
  assert.match(
    consoleSource,
    /<GrowthPanel[\s\S]{0,300}previewMode=\{previewMode\}/,
  );
  assert.ok(
    (operationsSource.match(/businessId && !previewMode/g) ?? []).length >= 6,
    "operation listeners must be disabled in preview mode",
  );
  assert.match(
    operationsSource,
    /const enabled = Boolean\(businessId && !previewMode\);[\s\S]{0,500}useBusinessSubcollectionRows\("destinationCountries", businessId, enabled/,
  );
});

test("business content grid can shrink inside the mobile navigation rail", () => {
  assert.match(
    stylesSource,
    /\.content\s*\{[\s\S]{0,120}grid-template-columns:\s*minmax\(0,\s*1fr\)/,
  );
  assert.match(
    stylesSource,
    /\.lst\s*\{[^}]*min-width:\s*0/,
  );
});
