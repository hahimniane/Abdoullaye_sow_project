import assert from "node:assert/strict";
import test from "node:test";

import {
  JOURNEY_STAGES,
  deliveryWindowLabel,
  journeyStageFor,
  relativeTime,
} from "./tracking-journey.ts";

test("staff statuses map onto the four customer stages", () => {
  // A customer reading "awaiting_weight_confirmation" learns nothing about
  // where their parcel is. Billing steps all belong to "Booked".
  for (const status of [
    "pending_payment", "pending", "awaiting_weight_confirmation",
    "awaiting_balance_payment", "settlement_processing",
  ]) {
    assert.equal(journeyStageFor(status)?.id, "booked", status);
  }
  assert.equal(journeyStageFor("in_transit")?.id, "in_transit");
  assert.equal(journeyStageFor("ready_for_pickup")?.id, "arrived");
  assert.equal(journeyStageFor("completed")?.id, "delivered");
});

test("a cancelled shipment has no journey at all", () => {
  // Showing a stalled progress bar on a cancelled order reads as broken.
  assert.equal(journeyStageFor("cancelled"), null);
});

test("an unknown status falls back to the first stage, never to nothing", () => {
  assert.equal(journeyStageFor("some_future_status")?.index, 0);
  assert.equal(journeyStageFor("")?.index, 0);
});

test("stage indexes match the rendered order", () => {
  assert.equal(journeyStageFor("delivered_unknown")?.index, 0);
  assert.equal(journeyStageFor("completed")?.index, JOURNEY_STAGES.length - 1);
});

test("relative time reads the way a person would say it", () => {
  const now = Date.UTC(2026, 0, 20, 12, 0, 0);
  const ago = (ms: number) => relativeTime(now - ms, now);
  assert.equal(ago(30_000), "just now");
  assert.equal(ago(5 * 60_000), "5 min ago");
  assert.equal(ago(60 * 60_000), "1 hour ago");
  assert.equal(ago(26 * 3600_000), "yesterday");
  assert.equal(ago(3 * 86_400_000), "3 days ago");
  assert.equal(ago(9 * 86_400_000), "1 week ago");
});

test("a missing timestamp produces no phrase rather than 'just now'", () => {
  // Firestore writes serverTimestamp() asynchronously, so a freshly created
  // event can genuinely have no timestamp for a moment.
  for (const bad of [null, undefined, "", 0, "not-a-date"]) {
    assert.equal(relativeTime(bad), "", String(bad));
  }
});

test("reads Firestore timestamp shapes", () => {
  const now = Date.UTC(2026, 0, 20, 12, 0, 0);
  assert.equal(relativeTime({seconds: (now - 3600_000) / 1000}, now),
    "1 hour ago");
  assert.equal(relativeTime(new Date(now - 3600_000).toISOString(), now),
    "1 hour ago");
});

test("delivery window prefers the stated label, then the day range", () => {
  assert.equal(deliveryWindowLabel({deliveryEstimateLabel: "2-3 weeks"}),
    "2-3 weeks");
  assert.equal(deliveryWindowLabel(
    {deliveryEstimateMinDays: 10, deliveryEstimateMaxDays: 20}), "10-20 days");
  assert.equal(deliveryWindowLabel({deliveryEstimateMinDays: 10}), "10+ days");
  assert.equal(deliveryWindowLabel({}), "");
});
