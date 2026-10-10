import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { translateValue } from "./french-dom.ts";
import {
  GUEST_CONTAINER_STAGES,
  GUEST_JOURNEY_STAGES,
  guestJourneyStages,
  guestServiceLabel,
  guestStageLabel,
  guestTrackingErrorKind,
  parseGuestTrackingResponse,
  validGuestTrackingIdentifier,
} from "./guest-tracking.ts";

test("guest tracking validates human-formatted booking codes", () => {
  assert.equal(validGuestTrackingIdentifier("bs k7m4p2"), true);
  assert.equal(validGuestTrackingIdentifier("123"), false);
  assert.equal(validGuestTrackingIdentifier("x".repeat(90)), false);
});

test("guest tracking parses only the allowlisted public result", () => {
  assert.deepEqual(
    parseGuestTrackingResponse({
      version: 1,
      found: true,
      record: {
        trackingCode: "BS-K7M4P2",
        service: "barrel",
        stage: "arrived",
        updatedAtMs: 1_725_000_000_000,
        receiverName: "must be ignored",
        paymentStatus: "must be ignored",
      },
    }),
    {
      version: 1,
      found: true,
      record: {
        trackingCode: "BS-K7M4P2",
        service: "barrel",
        stage: "arrived",
        updatedAtMs: 1_725_000_000_000,
      },
    },
  );
  assert.deepEqual(
    parseGuestTrackingResponse({version: 1, found: false}),
    {version: 1, found: false},
  );
});

test("guest tracking rejects unknown services, stages, and malformed payloads", () => {
  assert.throws(() => parseGuestTrackingResponse(null));
  assert.throws(() =>
    parseGuestTrackingResponse({
      version: 1,
      found: true,
      record: {
        trackingCode: "BS-K7M4P2",
        service: "private_record",
        stage: "arrived",
        updatedAtMs: 1,
      },
    }),
  );
});

test("guest tracking distinguishes throttling without exposing raw errors", () => {
  assert.equal(
    guestTrackingErrorKind({code: "functions/resource-exhausted"}),
    "rate_limited",
  );
  assert.equal(
    guestTrackingErrorKind({code: "functions/internal"}),
    "unavailable",
  );
});

test("a CL- code is a container shipment with its own four-step journey", () => {
  const parsed = parseGuestTrackingResponse({
    version: 1,
    found: true,
    record: {
      trackingCode: "CL-K7M4P2",
      service: "container",
      stage: "in_transit",
      updatedAtMs: 1_725_000_000_000,
      customerPhone: "must be ignored",
    },
  });
  assert.deepEqual(parsed, {
    version: 1,
    found: true,
    record: {
      trackingCode: "CL-K7M4P2",
      service: "container",
      stage: "in_transit",
      updatedAtMs: 1_725_000_000_000,
    },
  });
  assert.equal(guestServiceLabel("container"), "Container shipment");
  // The server maps a container to booked / in_transit / arrived only.
  assert.deepEqual(GUEST_CONTAINER_STAGES.map((item) => item.id), ["waiting_container", "booked", "in_transit", "arrived"]);
  assert.equal(guestJourneyStages("container"), GUEST_CONTAINER_STAGES);
  assert.equal(guestStageLabel("container", "waiting_container"), "Waiting for a container");
  assert.equal(guestStageLabel("container", "booked"), "In the container");
  assert.equal(guestStageLabel("container", "in_transit"), "At sea");
  assert.equal(guestStageLabel("container", "arrived"), "Arrived");
  // Every other service keeps the generic journey and pill words.
  assert.equal(guestJourneyStages("barrel"), GUEST_JOURNEY_STAGES);
  assert.equal(guestStageLabel("barrel", "in_transit"), "In progress");
  assert.equal(guestStageLabel("barrel", "awaiting_payment"), "Waiting for payment");
});

test("the result card never renders an empty service line", () => {
  assert.equal(guestServiceLabel("barrel"), "Barrel shipment");
  assert.equal(guestServiceLabel("something_new"), "Tracked shipment");
  assert.equal(guestJourneyStages("something_new"), GUEST_JOURNEY_STAGES);
  assert.equal(guestStageLabel("something_new", "booked"), "Booked");
});

test("the server's container service and stage map are the ones this parser knows", () => {
  const server = readFileSync(
    new URL("../../../my_flutter_app/functions/guest_tracking.js", import.meta.url),
    "utf8",
  );
  assert.match(server, /\{name: "containerLines", prefix: "CL", service: "container"\}/);
  assert.match(server, /loading: "booked",\s*shipped: "in_transit",\s*arrived: "arrived",/);
  // A package dropped off before any container is its own stage, in the server's words.
  assert.match(server, /const WAITING_STAGE = "waiting_container";/);
  assert.match(server, /const WAITING_STAGE_LABEL = "Received, waiting for a container";/);
  const waiting = parseGuestTrackingResponse({
    version: 1,
    found: true,
    record: {trackingCode: "CL-K7M4P2", service: "container", stage: "waiting_container", updatedAtMs: 1},
  });
  assert.equal(waiting.found && waiting.record.stage, "waiting_container");
});

test("every container tracking string has French", () => {
  const strings = [
    "Container shipment",
    "Tracked shipment",
    ...GUEST_CONTAINER_STAGES.flatMap((item) => [item.label, item.hint]),
  ];
  for (const english of strings) {
    const french = translateValue(english, "fr");
    assert.notEqual(french, english, `no French for "${english}"`);
    assert.equal(translateValue(french, "en"), english, `"${english}" does not round-trip`);
  }
});
