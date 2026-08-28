import assert from "node:assert/strict";
import test from "node:test";

import {
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
