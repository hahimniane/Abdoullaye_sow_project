import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { translateValue } from "./french-dom.ts";

const source = readFileSync("src/components/admin-console.tsx", "utf8");

test("admin freight is an explicit read-only exception workflow", () => {
  assert.match(
    source,
    /collectionName: "freightShipments"[\s\S]*readOnlyReason:[\s\S]*Freight status and settlement are controlled by the verified business workflow/,
  );
  assert.match(source, /readOnlyReason \? \([\s\S]*status-pill compact warning/);
  assert.match(source, /readOnlyReason \? \([\s\S]*\) : \([\s\S]*commitStatusChange/);
  assert.match(source, /readOnlyReason \? \([\s\S]*\) : \([\s\S]*deleteAdminRecord/);
});

test("admin freight exposes reconciliation and audit fields", () => {
  assert.match(source, /freightRows = previewMode[\s\S]*previewData\.freightShipments/);
  assert.match(source, /freightShipments: \[[\s\S]*trackingCode: "LW-FRT-2084"/);
  for (const field of [
    "Estimated weight",
    "Verified weight",
    "Weight verification",
    "Estimated total",
    "Final total",
    "Balance due",
    "Refund due",
    "Price settlement",
    "Payout",
    "Weight confirmed by",
    "Updated by",
  ]) {
    assert.ok(source.includes(`"${field}"`), `missing ${field}`);
  }
});

test("admin navigation and freight explanation translate to French", () => {
  assert.equal(
    translateValue("Barrels, freight, transport, parking", "fr"),
    "Barils, fret, transport, stationnement",
  );
  assert.notEqual(
    translateValue(
      "Freight status and settlement are controlled by the verified business workflow. Admins can review and escalate exceptions here.",
      "fr",
    ),
    "Freight status and settlement are controlled by the verified business workflow. Admins can review and escalate exceptions here.",
  );
  assert.equal(
    translateValue("Blocked pending settlement", "fr"),
    "Bloqué en attente du règlement",
  );
});
