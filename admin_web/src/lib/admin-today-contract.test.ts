import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { translateValue } from "./french-dom.ts";

const source = readFileSync(
  new URL("../components/admin-console.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

const todaySource = source.slice(
  source.indexOf("function Today("),
  source.indexOf("\nfunction ", source.indexOf("function Today(") + 1),
);

describe("admin Today dashboard contract", () => {
  test("keeps the KPI row in normal flow below the sticky header", () => {
    assert.match(
      styles,
      /\.topbar\s*\{[^}]*position:\s*sticky[^}]*top:\s*0[^}]*\}/,
    );
    assert.match(styles, /\.content\s*\{[^}]*padding:\s*(?!0(?:\D|$))[^;}]+/);
    assert.match(
      todaySource,
      /<section className="page-hero">[\s\S]*<section className="kpi-grid">/,
      "the overview heading must precede the KPI row in document flow",
    );
    assert.doesNotMatch(
      styles,
      /\.kpi-grid\s*\{[^}]*(?:position:\s*(?:absolute|fixed)|margin-top:\s*-|transform:\s*translateY\(-)/,
      "the KPI row must not be pulled underneath the sticky header",
    );
  });

  test("preserves every current KPI, operational priority, and action target", () => {
    for (const [label, target] of [
      ["Needs review", "businesses"],
      ["Open shipments", "operations"],
      ["Pending purchases", "operations"],
    ]) {
      assert.match(
        todaySource,
        new RegExp(`label: "${label}"[\\s\\S]{0,260}target: "${target}"`),
      );
    }

    for (const heading of [
      "Needs your attention",
      "Network health",
      "Service load",
    ]) {
      assert.match(todaySource, new RegExp(`title="${heading}"`));
    }

    for (const action of [
      "Review business",
      "Open application",
      "Open purchase",
      "Open shipment",
    ]) {
      assert.match(todaySource, new RegExp(`cta: "${action}"`));
    }

    for (const metric of [
      "Approved partners",
      "Active listings",
      "Missing profiles",
      "Businesses",
      "Accounts by role",
      "Listings",
      "Marketplace",
      "Barrel shipments",
      "Freight shipments",
      "Car purchases",
      "Admins",
      "Owners",
      "Staff",
      "Customers",
    ]) {
      assert.ok(
        todaySource.includes(metric),
        `Today dashboard must retain the "${metric}" metric`,
      );
    }
  });

  test("shows nothing about the retired wallet or its refund queue", () => {
    // The wallet is removed (docs/PLAN-2026-08-backlog.md #3), so the
    // overview no longer opens with a refund queue that can never fill.
    assert.doesNotMatch(todaySource, /refund/i);
    assert.doesNotMatch(todaySource, /wallet/i);
    assert.doesNotMatch(todaySource, /Card returns/);
  });

  test("collapses dashboard grids without horizontal fixed-width columns", () => {
    assert.match(
      styles,
      /@media \(max-width:\s*1080px\)\s*\{[\s\S]*?\.kpi-grid\s*\{\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)[^}]*\}[\s\S]*?\.today-layout\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
    assert.match(
      styles,
      /@media \(max-width:\s*600px\)\s*\{[\s\S]*?\.kpi-grid\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
    assert.match(
      styles,
      /@media \(max-width:\s*600px\)\s*\{[\s\S]*?\.worklist-row\s*\{\s*grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)/,
    );
    assert.match(
      styles,
      /@media \(max-width:\s*1080px\)\s*\{\s*\.chart-grid\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/,
    );
  });

  test("localizes the dashboard's persistent English copy", () => {
    for (const label of [
      "What needs you now",
      "Needs review",
      "Open shipments",
      "Pending purchases",
      "Needs your attention",
      "Network health",
      "Service load",
      "Approved partners",
      "Active listings",
    ]) {
      assert.notEqual(
        translateValue(label, "fr"),
        label,
        `missing French translation for "${label}"`,
      );
    }
  });
});
