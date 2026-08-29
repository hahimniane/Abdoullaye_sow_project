import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BARREL_IN_TRANSIT_NEEDS_CONTAINER,
  barrelInTransitBlockedReason,
  barrelStatusWriteFields,
} from "./barrel-fulfillment.ts";
import { translateValue } from "./french-dom.ts";

test("ready-for-pickup is never blocked by a missing container", () => {
  assert.equal(barrelInTransitBlockedReason("ready_for_pickup", ""), "");
  assert.equal(barrelInTransitBlockedReason("pending", ""), "");
  assert.deepEqual(barrelStatusWriteFields("ready_for_pickup"), {
    status: "ready_for_pickup",
  });
});

test("in-transit waits for a real container number", () => {
  assert.equal(
    barrelInTransitBlockedReason("in_transit", ""),
    BARREL_IN_TRANSIT_NEEDS_CONTAINER,
  );
  assert.equal(barrelInTransitBlockedReason("in_transit", "MSCU1234567"), "");
});

test("the barrel status select captures the chosen value before confirm", () => {
  // Controlled select + async confirm: reading event.target.value after
  // await wrote "pending" back and toasted a false success. Freight already
  // passes the value into updateStatus immediately.
  const source = readFileSync(
    "src/components/business/operations-panels.tsx",
    "utf8",
  );
  const start = source.indexOf("function updateStatus(row: FirestoreRow, status: string)");
  assert.ok(start > 0);
  const barrelPanel = source.slice(start, source.indexOf("export function FreightPanel"));
  assert.match(barrelPanel, /const nextStatus = event\.target\.value/);
  assert.match(barrelPanel, /updateStatus\(row, nextStatus\)/);
  assert.doesNotMatch(barrelPanel, /updateStatus\(row, event\.target\.value\)/);
  assert.match(barrelPanel, /statusUpdatedAt: serverTimestamp\(\)/);
  assert.match(barrelPanel, /barrelInTransitBlockedReason/);
});

test("Pay now is on the tracking card and the order drawer", () => {
  const tracking = readFileSync("src/components/customer-tracking.tsx", "utf8");
  const consoleSource = readFileSync(
    "src/components/customer-console.tsx",
    "utf8",
  );
  assert.match(tracking, /<ResumeCheckoutButton record=\{record\} \/>/);
  assert.match(consoleSource, /<ResumeCheckoutButton/);
  assert.match(
    consoleSource,
    /collectionName: selected\.collectionName/,
  );
});

test("container-gate copy is localized", () => {
  const french = translateValue(BARREL_IN_TRANSIT_NEEDS_CONTAINER, "fr");
  assert.notEqual(french, BARREL_IN_TRANSIT_NEEDS_CONTAINER);
  assert.ok(french.length > 0);
});
