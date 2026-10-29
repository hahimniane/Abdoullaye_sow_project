import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { translateValue } from "./french-dom.ts";
import {
  GET_APP_URL,
  GUEST_CONTAINER_STAGES,
  GUEST_JOURNEY_STAGES,
  GUEST_FLIGHT_FIELDS,
  GUEST_PHOTO_KIND_LABEL,
  GUEST_SHIPPING_COPY,
  GUEST_SHIPPING_FIELDS,
  guestShippingMode,
  parseGuestPhotos,
  parseGuestShipping,
  parseGuestContainerGroup,
  guestPiecesText,
  guestJourneyStages,
  guestServiceLabel,
  guestStageLabel,
  guestTrackingErrorKind,
  parseGuestTrackingResponse,
  shipmentStageLabel,
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

test("a collected package's pickup fee is its own row, once, inside the final price", () => {
  // Barrel $90 · Box $40 · Pickup fee $20 · Total $150 (owner decision 2026-10-18).
  assert.deepEqual(
    parseGuestContainerGroup("container", { payment: { priceCents: 15000, pickupFeeCents: 2000, paidCents: 5000, balanceCents: 10000 } }),
    { payment: { priceCents: 15000, pickupFeeCents: 2000, paidCents: 5000, balanceCents: 10000 } },
  );
  // No fee, or a zero one, adds no row; a fee can never exceed the price.
  assert.deepEqual(
    parseGuestContainerGroup("container", { payment: { priceCents: 15000, pickupFeeCents: 0, paidCents: 0, balanceCents: 15000 } }),
    { payment: { priceCents: 15000, paidCents: 0, balanceCents: 15000 } },
  );
  assert.equal(parseGuestContainerGroup("container", { payment: { priceCents: 1000, pickupFeeCents: 5000 } }).payment?.pickupFeeCents, 1000);
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
  for (const {key} of [...GUEST_SHIPPING_FIELDS, ...GUEST_FLIGHT_FIELDS]) {
    assert.match(server, new RegExp(`\\.\\.\\.\\(${key} \\? \\{${key}\\} : \\{\\}\\)`), key);
  }
  assert.match(server, /mode: "air",/);
});

test("a flight carries its airline and waybill under mode air; stage words are unchanged", () => {
  const parsed = parseGuestTrackingResponse({
    version: 1, found: true,
    record: {
      trackingCode: "CL-K7M4P2", service: "container", stage: "in_transit", updatedAtMs: 1,
      shipping: { mode: "air", airline: " Air France ", airWaybill: "057-12345678", containerNumber: "must be ignored" },
    },
  });
  assert.ok(parsed.found);
  if (parsed.found) {
    assert.deepEqual(parsed.record.shipping, { mode: "air", airline: "Air France", airWaybill: "057-12345678" });
    assert.equal(guestShippingMode(parsed.record.shipping), "air");
    assert.equal(guestStageLabel("container", "in_transit"), "At sea");
  }
  // A flight with nothing known yet still says it is a flight; a sea answer never carries the mode.
  assert.deepEqual(parseGuestShipping("container", { mode: "air" }), { mode: "air" });
  assert.deepEqual(parseGuestShipping("container", { mode: "sea", containerNumber: "MSKU1234565" }), { containerNumber: "MSKU1234565" });
  assert.equal(guestShippingMode(parseGuestShipping("container", { containerNumber: "MSKU1234565" })), "sea");
  assert.equal(guestShippingMode(undefined), "sea");
  assert.deepEqual(GUEST_FLIGHT_FIELDS.map((f) => f.key), ["airline", "airWaybill"]);
});

test("photos come only as https links of a known kind, in order, and never for a guest without them", () => {
  const photos = parseGuestPhotos([
    { url: "https://customer.laawoldigital.com/d?view=photo&t=a&p=b&e=1&s=c", kind: "dropoff" },
    { url: "https://customer.laawoldigital.com/d?view=photo&t=a&p=b2&e=1&s=c", kind: "customer" },
    { url: "https://customer.laawoldigital.com/d?view=photo&t=a&p=b3&e=1&s=c", kind: "delivered" },
    { url: "http://evil.example/x.jpg", kind: "dropoff" },
    { url: "https://customer.laawoldigital.com/d?x", kind: "selfie" },
    "nonsense",
  ]);
  assert.deepEqual(photos?.map((p) => p.kind), ["dropoff", "customer", "delivered"]);
  assert.equal(parseGuestPhotos(undefined), undefined);
  assert.equal(parseGuestPhotos([]), undefined);
  assert.equal(parseGuestPhotos([{ url: "ftp://x", kind: "dropoff" }]), undefined);
  const parsed = parseGuestTrackingResponse({
    version: 1, found: true,
    record: {
      trackingCode: "CL-K7M4P2", service: "container", stage: "arrived", updatedAtMs: 1,
      photos: [{ url: "https://customer.laawoldigital.com/d?view=photo", kind: "dropoff" }],
    },
  });
  assert.ok(parsed.found);
  if (parsed.found) assert.deepEqual(parsed.record.photos, [{ url: "https://customer.laawoldigital.com/d?view=photo", kind: "dropoff" }]);
  const guest = parseGuestTrackingResponse({
    version: 1, found: true,
    record: { trackingCode: "CL-K7M4P2", service: "container", stage: "arrived", updatedAtMs: 1 },
  });
  assert.ok(guest.found);
  if (guest.found) assert.equal("photos" in guest.record, false);
  // Another service never carries photos, whatever the answer says.
  const barrel = parseGuestTrackingResponse({
    version: 1, found: true,
    record: { trackingCode: "BS-K7M4P2", service: "barrel", stage: "booked", updatedAtMs: 1, photos: [{ url: "https://x.example/a", kind: "dropoff" }] },
  });
  assert.ok(barrel.found);
  if (barrel.found) assert.equal("photos" in barrel.record, false);
  assert.deepEqual(Object.keys(GUEST_PHOTO_KIND_LABEL), ["dropoff", "customer", "delivered"]);
  const server = readFileSync(new URL("../../../my_flutter_app/functions/guest_tracking.js", import.meta.url), "utf8");
  for (const kind of ["dropoff", "customer", "delivered"]) assert.match(server, new RegExp(`"${kind}"\\)`), kind);
});

test("every shipping-details string has French", () => {
  const strings = [
    "Shipping details",
    "You can also follow it with these on the shipping line’s website.",
    "Get the Laawol app",
    "For your privacy, only the shipment status and shipping details are shown here.",
    "Last update: received",
    ...GUEST_SHIPPING_FIELDS.map((f) => f.label),
    ...GUEST_FLIGHT_FIELDS.map((f) => f.label),
    ...Object.values(GUEST_SHIPPING_COPY).flatMap((copy) => [copy.title, copy.lede]),
    "Photos of the package",
    "Photos of this package: at drop-off, what was sent on WhatsApp, and at delivery.",
    "Open full size",
    ...Object.values(GUEST_PHOTO_KIND_LABEL),
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

test("the answer's sign-in hints are kept to a role and two digits", () => {
  const parsed = parseGuestTrackingResponse({
    version: 1, found: true,
    record: {
      trackingCode: "CL-K7M4P2", service: "container", stage: "booked", updatedAtMs: 1,
      signIn: [{ role: "sender", lastTwo: "35" }, { role: "receiver", lastTwo: "+224620123456" }],
    },
  });
  assert.ok(parsed.found);
  if (parsed.found) assert.deepEqual(parsed.record.signIn, [{ role: "sender", lastTwo: "35" }]);
  const none = parseGuestTrackingResponse({
    version: 1, found: true,
    record: { trackingCode: "BS-K7M4P2", service: "barrel", stage: "booked", updatedAtMs: 1 },
  });
  assert.ok(none.found);
  if (none.found) assert.equal("signIn" in none.record, false);
});

test("My packages reuses the tracking stage words, plus a package request's own", () => {
  assert.equal(shipmentStageLabel("container", "in_transit"), "At sea");
  assert.equal(shipmentStageLabel("barrel", "in_transit"), "In progress");
  assert.equal(shipmentStageLabel("package_request", "requested"), "Requested");
  assert.equal(shipmentStageLabel("package_request", "booked"), "Booked");
  assert.equal(shipmentStageLabel("barrel", "something_new"), "Booked");
  assert.equal(guestServiceLabel("package_request"), "Package request");
});
