import assert from "node:assert/strict";
import test from "node:test";

import {
  JOURNEY_STAGES,
  TRANSPORT_JOURNEY_STAGES,
  deliveryWindowLabel,
  eventDetail,
  journeyStageFor,
  journeyStagesFor,
  relativeTime,
  statusBucket,
  statusLabel,
  transportJourneyStageFor,
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

test("a carrier event with no location does not read as 'Unknown'", () => {
  // This is exactly what the Terminal49 poller writes: a status, a container
  // in the description, and location: "". Passing that through the generic
  // text() helper stamps "Unknown · " on the front of every single carrier
  // milestone - the whole reason the integration exists.
  assert.equal(eventDetail({
    label: "Loaded on vessel",
    description: "Container MSCU4837261",
    location: "",
    source: "carrier_api",
  }), "Container MSCU4837261");
});

test("a staff event joins where it happened to what happened", () => {
  assert.equal(eventDetail({
    location: "Newark, NJ",
    description: "Consolidated into container MSCU4837261.",
  }), "Newark, NJ · Consolidated into container MSCU4837261.");
});

test("an event with nothing to add says nothing", () => {
  for (const event of [{}, {location: "", description: ""},
    {location: "   ", description: null}, {description: 42}]) {
    assert.equal(eventDetail(event as Record<string, unknown>), "",
      JSON.stringify(event));
  }
});

test("the status pill speaks to the customer, not to staff", () => {
  // "in_transit" sat next to a progress bar reading "On its way" in the same
  // card. The stored value is a database enum; the pill is customer-facing.
  assert.equal(statusLabel("in_transit"), "On its way");
  assert.equal(statusLabel("pending_payment"), "Payment pending");
  assert.equal(statusLabel("awaiting_balance_payment"), "Balance due");
  assert.equal(statusLabel("completed"), "Delivered");
  assert.equal(statusLabel("cancelled"), "Cancelled");
});

test("a parcel being delivered is never told to go and collect it", () => {
  // Same stored statuses, different ending. "Ready for pickup" on a parcel
  // a driver is bringing to the door sends the receiver to a counter that
  // is not expecting them - and inventing a status for it would have to be
  // added to every hardcoded status list in both consoles.
  assert.equal(statusLabel("ready_for_pickup", true), "Out for delivery");
  assert.equal(statusLabel("ready_for_pickup"), "Ready for pickup");
  assert.equal(statusLabel("ready_for_pickup", false), "Ready for pickup");
  // Everything else reads the same either way.
  for (const status of ["in_transit", "completed", "cancelled", ""]) {
    assert.equal(statusLabel(status, true), statusLabel(status), status);
  }
  // The stage ids are shared, so every caller that maps a status keeps
  // working; only the wording the customer reads changes.
  const collect = journeyStagesFor();
  const deliver = journeyStagesFor(true);
  assert.deepEqual(
    deliver.map((stage) => stage.id),
    collect.map((stage) => stage.id),
  );
  assert.deepEqual(collect, JOURNEY_STAGES);
  assert.match(deliver[3].hint, /receiver/);
  assert.doesNotMatch(deliver[2].hint, /pickup|collect/i);
});

test("an unmapped status degrades to something readable", () => {
  // A status added to the backend later must not render as an empty pill or
  // leak an underscore.
  assert.equal(statusLabel("held_at_customs"), "held at customs");
  assert.equal(statusLabel(""), "Booked");
});

test("statuses file into four customer buckets", () => {
  // The orders page filters by these chips. "Needs payment" is the bucket
  // where the next action is the customer's - it must catch both the
  // accepted-unpaid transport job and a freight balance.
  assert.equal(statusBucket("pending_payment"), "payment");
  assert.equal(statusBucket("awaiting_balance_payment"), "payment");
  assert.equal(statusBucket("in_transit"), "active");
  assert.equal(statusBucket("quote_requested"), "active");
  assert.equal(statusBucket("scheduled"), "active");
  assert.equal(statusBucket("completed"), "completed");
  assert.equal(statusBucket("delivered"), "completed");
  assert.equal(statusBucket("sold"), "completed");
  assert.equal(statusBucket("cancelled"), "cancelled");
  assert.equal(statusBucket("refunded"), "cancelled");
  // Anything the backend invents later stays visible under In progress
  // rather than vanishing from every chip.
  assert.equal(statusBucket("held_at_customs"), "active");
});

test("a transported car walks its own four stages", () => {
  // Mirrored by my_flutter_app/test/transport_journey_stages_test.dart -
  // web and app must place the same job on the same stage.
  assert.equal(transportJourneyStageFor("quote_requested")?.index, 0);
  assert.equal(transportJourneyStageFor("pending_payment")?.index, 0);
  assert.equal(transportJourneyStageFor("scheduled")?.index, 1);
  assert.equal(transportJourneyStageFor("in_transit")?.index, 2);
  assert.equal(transportJourneyStageFor("delivered")?.index, 3);
  assert.equal(transportJourneyStageFor("cancelled"), null);
  assert.equal(TRANSPORT_JOURNEY_STAGES.length, 4);
});
