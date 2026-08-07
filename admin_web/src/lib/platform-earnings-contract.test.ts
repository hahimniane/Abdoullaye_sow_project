// The Finance page's commission summary must stay where the owner looks.
//
// The complaint that produced it was not "the numbers are wrong" but "I opened
// Finance and could not tell what we had earned" — a placement problem as much
// as a data one. These checks pin the wiring: the summary sits above the
// transaction list, it is fed from the arrays the view already loads (no new
// Firestore reads), and its charts stay dependency-free inline SVG.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const consoleSource = readFileSync(
  new URL("../components/admin-console.tsx", import.meta.url),
  "utf8",
);
const stylesSource = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { dependencies: Record<string, string> };

const financeStart = consoleSource.indexOf("function FinanceView(");
const financeSource = consoleSource.slice(
  financeStart,
  consoleSource.indexOf("\nfunction ", financeStart + 10),
);

test("the commission summary renders above the transaction list", () => {
  const summaryIndex = financeSource.indexOf("<PlatformCommissionSummary");
  const ledgerIndex = financeSource.indexOf('title="All business transactions"');
  assert.ok(summaryIndex > 0, "FinanceView must render the commission summary");
  assert.ok(ledgerIndex > 0, "the existing transaction list must stay");
  assert.ok(
    summaryIndex < ledgerIndex,
    "the headline commission numbers must come before the gross-amount row list",
  );
});

test("the summary is aggregated client-side from records the view already holds", () => {
  assert.match(financeSource, /summarizePlatformEarnings\(\{/);
  for (const collection of [
    "shipments",
    "freightShipments",
    "transports",
    "parkedCars",
    "purchases",
    "businesses",
  ]) {
    assert.match(
      financeSource,
      new RegExp(`\\n\\s+${collection},`),
      `${collection} must be fed into the platform earnings summary`,
    );
  }
  assert.doesNotMatch(
    financeSource,
    /onSnapshot\(|collectionGroup\(|getDoc\(/,
    "the Finance view must not add Firestore reads for the summary",
  );
});

test("the charts are inline SVG, with no charting dependency added", () => {
  const summaryStart = consoleSource.indexOf("function CommissionTrendChart(");
  const summaryEnd = consoleSource.indexOf("function FinanceView(");
  const chartSource = consoleSource.slice(summaryStart, summaryEnd);
  assert.ok(summaryStart > 0, "the trend chart component must exist");
  assert.match(chartSource, /<svg/, "the trend chart must be inline SVG");
  assert.match(chartSource, /<rect/);

  const deps = Object.keys(packageJson.dependencies).sort();
  assert.deepEqual(deps, [
    "firebase",
    "heic2any",
    "lucide-react",
    "next",
    "react",
    "react-dom",
  ], "no charting library may be added");
});

test("every chart carries the same numbers in text, and survives empty data", () => {
  const summaryStart = consoleSource.indexOf("function CommissionTrendChart(");
  const summaryEnd = consoleSource.indexOf("function FinanceView(");
  const chartSource = consoleSource.slice(summaryStart, summaryEnd);

  // A decorative SVG with an adjacent table beats a labelled SVG with none:
  // the table is the only form a screen reader can read figure by figure.
  const svgTags = chartSource.match(/<svg[\s\S]*?>/g) ?? [];
  assert.ok(svgTags.length >= 2, "expected a trend chart and a breakdown bar");
  for (const tag of svgTags) {
    assert.match(tag, /aria-hidden="true"/, "chart SVG must not be announced twice");
  }
  assert.equal(
    (chartSource.match(/<table/g) ?? []).length,
    2,
    "each chart needs its numbers in a table",
  );
  assert.match(chartSource, /<EmptyState text=/, "charts must degrade to an empty state");
  assert.match(
    chartSource,
    /No commission has been recorded yet\./,
    "the section must read sensibly before any money exists",
  );
});

test("the commission styles use the console's own custom properties", () => {
  const start = stylesSource.indexOf(".commission-summary");
  assert.ok(start > 0, "commission styles must exist");
  const commissionStyles = stylesSource.slice(start, start + 4000);
  for (const token of ["--paper", "--ink", "--rule", "--muted"]) {
    assert.ok(
      commissionStyles.includes(`var(${token})`),
      `commission styles should reuse var(${token})`,
    );
  }
  assert.match(
    stylesSource,
    /@media \(max-width: 1080px\) \{\s*\.commission-breakdown-grid \{\s*grid-template-columns: minmax\(0, 1fr\);/,
    "the two breakdowns must stack instead of overflowing on a narrow console",
  );
});
