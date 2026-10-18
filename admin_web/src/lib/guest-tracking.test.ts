import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { translateValue } from "./french-dom.ts";
import {
  GET_APP_URL,
  GUEST_CONTAINER_STAGES,
  GUEST_JOURNEY_STAGES,
  GUEST_SHIPPING_FIELDS,
  parseGuestShipping,
  parseGuestContainerGroup,
  guestPiecesText,
  guestJourneyStages,
  guestServiceLabel,
  guestStageLabel,
  guestTrackingErrorKind,
  parseGuestTrackingResponse,
  validGuestTrackingIdentifier,
} from "./guest-tracking.ts";

test("a split container line answers with its parts and the group's money, read defensively", () => {
  const parsed = parseGuestTrackingResponse({
    version: 1,
    found: true,
    record: {
      trackingCode: "CL-K7M4P2-2",
      service: "container",
      stage: "waiting_container",
      updatedAtMs: 1_725_000_000_000,
      pieceCount: 2,
      parts: [
        { trackingCode: "CL-K7M4P2", stage: "in_transit", pieceCount: 2, priceCents: 20000 },
        { trackingCode: "CL-K7M4P2-2", stage: "waiting_container", pieceCount: 2, priceCents: null },
        { trackingCode: "", stage: "booked" },
        { trackingCode: "CL-XXXXXX", stage: "sailing" },
        "junk",
      ],
      payment: { priceCents: 20000, paidCents: 15000, balanceCents: 5000 },
    },
  });
  assert.ok(parsed.found);
  if (!parsed.found) return;
  assert.equal(parsed.record.pieceCount, 2);
  assert.deepEqual(parsed.record.parts, [
    { trackingCode: "CL-K7M4P2", stage: "in_transit", pieceCount: 2, priceCents: 20000 },
    { trackingCode: "CL-K7M4P2-2", stage: "waiting_container", pieceCount: 2, priceCents: null },
  ]);
  assert.deepEqual(parsed.record.payment, { priceCents: 20000, paidCents: 15000, balanceCents: 5000 });
  assert.equal(guestPiecesText(2, "en"), "2 pieces");
  assert.equal(guestPiecesText(1, "en"), "1 piece");
  assert.equal(guestPiecesText(2, "fr"), "2 colis");
});

test("an older answer, an unpriced group or another service carries no parts or payment", () => {
  const older = parseGuestTrackingResponse({
    version: 1, found: true,
    record: { trackingCode: "CL-K7M4P2", service: "container", stage: "booked", updatedAtMs: 1 },
  });
  assert.ok(older.found);
  if (older.found) {
    assert.equal("parts" in older.record, false);
    assert.equal("payment" in older.record, false);
    assert.equal("pieceCount" in older.record, false);
  }
  assert.deepEqual(parseGuestContainerGroup("container", { payment: { priceCents: null, paidCents: 0, balanceCents: 0 } }), {});
  assert.deepEqual(parseGuestContainerGroup("container", { payment: { priceCents: 1000, paidCents: 5000 } }), {
    payment: { priceCents: 1000, paidCents: 1000, balanceCents: 0 },
  });
  assert.deepEqual(parseGuestContainerGroup("barrel", { pieceCount: 3, parts: [{ trackingCode: "BS-K7M4P2", stage: "booked" }] }), {});
});

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
  assert.equal(guestStageLabel("container", "arrived"), "Ready for pickup");
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

test("a sailed container line carries its shipping details, and nothing else", () => {
  const parsed = parseGuestTrackingResponse({
    version: 1,
    found: true,
    record: {
      trackingCode: "CL-K7M4P2",
      service: "container",
      stage: "in_transit",
      updatedAtMs: 1,
      shipping: {
        shippingLine: " Maersk ",
        containerNumber: "MSKU1234565",
        bookingNumber: "",
        receiverName: "must be ignored",
      },
    },
  });
  assert.ok(parsed.found);
  assert.deepEqual(parsed.record.shipping, {
    shippingLine: "Maersk",
    containerNumber: "MSKU1234565",
  });
  // Nothing known, or another service: no block at all.
  assert.equal(parseGuestShipping("container", {bookingNumber: "  "}), undefined);
  assert.equal(parseGuestShipping("container", "MSKU1234565"), undefined);
  assert.equal(parseGuestShipping("barrel", {containerNumber: "MSKU1234565"}), undefined);
  assert.deepEqual(GUEST_SHIPPING_FIELDS.map((f) => f.key),
    ["shippingLine", "containerNumber", "bookingNumber"]);
  assert.equal(GET_APP_URL, "https://laawoldigital.com/get-app.html");
});

test("the server's shipping fields are the ones this parser reads", () => {
  const server = readFileSync(
    new URL("../../../my_flutter_app/functions/guest_tracking.js", import.meta.url),
    "utf8",
  );
  for (const {key} of GUEST_SHIPPING_FIELDS) {
    assert.match(server, new RegExp(`\\.\\.\\.\\(${key} \\? \\{${key}\\} : \\{\\}\\)`), key);
  }
});

test("every shipping-details string has French", () => {
  const strings = [
    "Shipping details",
    "You can also follow it with these on the shipping line’s website.",
    "Get the Laawol app",
    "For your privacy, only the shipment status and shipping details are shown here.",
    "Last update: received",
    ...GUEST_SHIPPING_FIELDS.map((f) => f.label),
  ];
  for (const english of strings) {
    const french = translateValue(english, "fr");
    assert.notEqual(french, english, `no French for "${english}"`);
    assert.equal(translateValue(french, "en"), english, `"${english}" does not round-trip`);
  }
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
