import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BARREL_FULFILLMENT_WRITE_FAILED,
  BARREL_FULFILLMENT_WRITE_REJECTED,
  BARREL_IN_TRANSIT_NEEDS_CONTAINER,
  barrelFulfillmentWriteErrorMessage,
  barrelInTransitBlockedReason,
  barrelManualContainerWriteFields,
  barrelStatusWriteFields,
  normalizeBarrelContainerNumber,
} from "./barrel-fulfillment.ts";
import { translateValue } from "./french-dom.ts";

test("ready-for-pickup is never blocked by a missing container", () => {
  assert.equal(barrelInTransitBlockedReason("ready_for_pickup", ""), "");
  assert.equal(barrelInTransitBlockedReason("pending", ""), "");
  assert.deepEqual(barrelStatusWriteFields("ready_for_pickup"), {
    status: "ready_for_pickup",
  });
});

test("in-transit waits for a container or BOL, from either source", () => {
  assert.equal(
    barrelInTransitBlockedReason("in_transit", ""),
    BARREL_IN_TRANSIT_NEEDS_CONTAINER,
  );
  assert.equal(barrelInTransitBlockedReason("in_transit", "MSCU1234567"), "");
  assert.equal(
    barrelInTransitBlockedReason("in_transit", "", "  bol-senegal-1 "),
    "",
  );
  assert.equal(barrelInTransitBlockedReason("in_transit", "ab", "xy"), BARREL_IN_TRANSIT_NEEDS_CONTAINER);
});

test("manual container writes normalise and reject short values", () => {
  assert.equal(normalizeBarrelContainerNumber("  msku1234567  "), "MSKU1234567");
  assert.equal(normalizeBarrelContainerNumber("ab"), "");
  assert.deepEqual(barrelManualContainerWriteFields("  bol-42xx "), {
    containerNumber: "BOL-42XX",
  });
  assert.equal(barrelManualContainerWriteFields("ab"), null);
});

test("in-transit write can include a new container number without trackingProvider", () => {
  const fields = barrelStatusWriteFields("in_transit", {
    submittedContainerNumber: "  msku1234567 ",
    existingContainerNumber: "",
  });
  assert.deepEqual(fields, {
    status: "in_transit",
    containerNumber: "MSKU1234567",
  });
  assert.equal("trackingProvider" in fields, false);

  const alreadyOnFile = barrelStatusWriteFields("in_transit", {
    submittedContainerNumber: "",
    existingContainerNumber: "MSKU1234567",
  });
  assert.deepEqual(alreadyOnFile, {status: "in_transit"});
});

test("permission-denied writes surface the real container-gate reason", () => {
  assert.equal(
    barrelFulfillmentWriteErrorMessage({
      code: "permission-denied",
      message: "Missing or insufficient permissions.",
    }),
    BARREL_FULFILLMENT_WRITE_REJECTED,
  );
  assert.equal(
    barrelFulfillmentWriteErrorMessage(new Error(BARREL_IN_TRANSIT_NEEDS_CONTAINER)),
    BARREL_IN_TRANSIT_NEEDS_CONTAINER,
  );
  assert.equal(
    barrelFulfillmentWriteErrorMessage({}),
    BARREL_FULFILLMENT_WRITE_FAILED,
  );
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
  assert.match(barrelPanel, /barrelStatusWriteFields/);
  assert.match(barrelPanel, /barrelFulfillmentWriteErrorMessage/);
  assert.match(barrelPanel, /submittedContainerNumber/);
  assert.doesNotMatch(barrelPanel, /trackingProvider:\s*["']carrier_api["']/);
  assert.match(barrelPanel, /allowManualSave/);
  assert.match(barrelPanel, /role="alert"/);
  const freightPanel = source.slice(source.indexOf("export function FreightPanel"));
  assert.doesNotMatch(freightPanel, /allowManualSave/);
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

test("container-gate and write-error copy is localized", () => {
  for (const english of [
    BARREL_IN_TRANSIT_NEEDS_CONTAINER,
    BARREL_FULFILLMENT_WRITE_REJECTED,
    BARREL_FULFILLMENT_WRITE_FAILED,
  ]) {
    const french = translateValue(english, "fr");
    assert.notEqual(french, english);
    assert.ok(french.length > 0);
  }
});
