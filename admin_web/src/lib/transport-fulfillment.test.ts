// The console's copy of the transport fulfilment state machine.
//
// These tests exist because the console used to offer a flat list of every
// status - so it presented moves the server would reject - and, for legacy
// jobs, wrote Firestore directly and skipped the table altogether. The
// behaviour pinned here is the Dart module's
// (`my_flutter_app/lib/services/business_transport_jobs.dart`), which is in
// turn the server's (`my_flutter_app/functions/transport_fulfillment.js`).

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  TRANSPORT_FULFILLMENT_DESTINATIONS,
  TRANSPORT_FULFILLMENT_STATUSES,
  TRANSPORT_FULFILLMENT_TRANSITIONS,
  normalizeTransportContainerNumber,
  transportFulfillmentErrorMessage,
  transportFulfillmentNextStatuses,
  transportFulfillmentRequiresContainer,
  transportFulfillmentStatusIsKnown,
  transportFulfillmentPayload,
  transportJobCurrentStatus,
  validateTransportFulfillmentChange,
} from "./transport-fulfillment.ts";

test("the table matches the server's, edge for edge", () => {
  assert.deepEqual(TRANSPORT_FULFILLMENT_TRANSITIONS, {
    pending: ["scheduled", "in_transit", "cancelled"],
    scheduled: ["in_transit", "cancelled"],
    in_transit: ["delivered"],
    delivered: [],
    cancelled: [],
  });
});

test("pending is a legal state but never a legal destination", () => {
  assert.ok(TRANSPORT_FULFILLMENT_STATUSES.includes("pending"));
  assert.ok(transportFulfillmentStatusIsKnown("pending"));
  assert.deepEqual(transportFulfillmentNextStatuses("pending"), [
    "scheduled",
    "in_transit",
    "cancelled",
  ]);
  assert.equal(
    (TRANSPORT_FULFILLMENT_DESTINATIONS as readonly string[]).includes("pending"),
    false,
  );
  assert.deepEqual(
    validateTransportFulfillmentChange({
      currentStatus: "scheduled",
      nextStatus: "pending",
    }),
    ["nextStatusUnknown"],
  );
});

test("delivered and cancelled are terminal, and known", () => {
  for (const terminal of ["delivered", "cancelled"]) {
    assert.ok(transportFulfillmentStatusIsKnown(terminal));
    assert.deepEqual(transportFulfillmentNextStatuses(terminal), []);
    assert.deepEqual(
      validateTransportFulfillmentChange({
        currentStatus: terminal,
        nextStatus: "scheduled",
      }),
      ["transitionNotAllowed"],
    );
  }
});

test("a status the machine does not recognise offers no transitions", () => {
  // Everything the admin record path can write onto this same document.
  for (const status of [
    "active",
    "in_progress",
    "completed",
    "sold",
    "reserved",
    "inactive",
  ]) {
    assert.equal(transportFulfillmentStatusIsKnown(status), false);
    assert.deepEqual(transportFulfillmentNextStatuses(status), []);
    assert.deepEqual(
      validateTransportFulfillmentChange({
        currentStatus: status,
        nextStatus: "scheduled",
      }),
      ["currentStatusUnknown", "transitionNotAllowed"],
    );
  }
});

test("status comparison is literal, so a stored 'Pending' is not pending", () => {
  assert.equal(transportFulfillmentStatusIsKnown("Pending"), false);
  assert.equal(transportFulfillmentStatusIsKnown(" pending"), false);
  assert.deepEqual(transportFulfillmentNextStatuses("Pending"), []);
});

test("prototype keys are not mistaken for statuses", () => {
  for (const key of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
    assert.equal(transportFulfillmentStatusIsKnown(key), false);
    assert.deepEqual(transportFulfillmentNextStatuses(key), []);
  }
});

test("an empty fulfillmentStatus falls through to status", () => {
  assert.equal(
    transportJobCurrentStatus({ fulfillmentStatus: "", status: "pending" }),
    "pending",
  );
  assert.equal(
    transportJobCurrentStatus({ fulfillmentStatus: "in_transit", status: "pending" }),
    "in_transit",
  );
  assert.equal(transportJobCurrentStatus({ status: "scheduled" }), "scheduled");
  assert.equal(transportJobCurrentStatus({}), "");
  assert.equal(
    transportJobCurrentStatus({ fulfillmentStatus: null, status: null }),
    "",
  );
});

test("every legal move is allowed and every illegal one is named", () => {
  assert.deepEqual(
    validateTransportFulfillmentChange({
      currentStatus: "pending",
      nextStatus: "scheduled",
    }),
    [],
  );
  assert.deepEqual(
    validateTransportFulfillmentChange({
      currentStatus: "scheduled",
      nextStatus: "cancelled",
    }),
    [],
  );
  // pending -> delivered skips the whole middle of the job.
  assert.deepEqual(
    validateTransportFulfillmentChange({
      currentStatus: "pending",
      nextStatus: "delivered",
    }),
    ["transitionNotAllowed"],
  );
  // A destination the server does not accept at all.
  assert.deepEqual(
    validateTransportFulfillmentChange({
      currentStatus: "pending",
      nextStatus: "refunded",
    }),
    ["nextStatusUnknown"],
  );
});

test("in_transit needs a container number, from either source", () => {
  assert.deepEqual(
    validateTransportFulfillmentChange({
      currentStatus: "scheduled",
      nextStatus: "in_transit",
    }),
    ["containerNumberRequired"],
  );
  assert.deepEqual(
    validateTransportFulfillmentChange({
      currentStatus: "scheduled",
      nextStatus: "in_transit",
      submittedContainerNumber: "MSKU1234567",
    }),
    [],
  );
  assert.deepEqual(
    validateTransportFulfillmentChange({
      currentStatus: "scheduled",
      nextStatus: "in_transit",
      existingContainerNumber: "MSKU1234567",
    }),
    [],
  );
  // Too short to be a number at all - refused here, not by the server.
  assert.deepEqual(
    validateTransportFulfillmentChange({
      currentStatus: "scheduled",
      nextStatus: "in_transit",
      submittedContainerNumber: "AB",
    }),
    ["containerNumberRequired"],
  );
  // No other move asks for one.
  for (const nextStatus of ["scheduled", "delivered", "cancelled"]) {
    assert.equal(transportFulfillmentRequiresContainer(nextStatus), false);
  }
});

test("container numbers are normalised the way the server stores them", () => {
  assert.equal(normalizeTransportContainerNumber("  msku1234567 "), "MSKU1234567");
  assert.equal(normalizeTransportContainerNumber("abc"), "");
  assert.equal(normalizeTransportContainerNumber(""), "");
  assert.equal(normalizeTransportContainerNumber(null), "");
  assert.equal(normalizeTransportContainerNumber(undefined), "");
  assert.equal(normalizeTransportContainerNumber("a".repeat(60)).length, 40);
});

test("the payload carries only what the server should act on", () => {
  assert.deepEqual(
    transportFulfillmentPayload({ requestId: "req-1", status: "scheduled" }),
    { requestId: "req-1", status: "scheduled" },
  );
  assert.deepEqual(
    transportFulfillmentPayload({
      requestId: "req-1",
      status: "in_transit",
      containerNumber: " msku1234567 ",
      businessId: " biz-1 ",
    }),
    {
      requestId: "req-1",
      status: "in_transit",
      businessId: "biz-1",
      containerNumber: "MSKU1234567",
    },
  );
  // An unusable container number is left out rather than sent as "", which
  // would read like an attempt to clear the one on file.
  assert.deepEqual(
    transportFulfillmentPayload({
      requestId: "req-1",
      status: "delivered",
      containerNumber: "AB",
    }),
    { requestId: "req-1", status: "delivered" },
  );
});

test("each refusal has a sentence, and no refusal has none", () => {
  assert.equal(transportFulfillmentErrorMessage([]), "");
  for (const nextStatus of ["pending", "refunded"]) {
    const errors = validateTransportFulfillmentChange({
      currentStatus: "scheduled",
      nextStatus,
    });
    assert.ok(transportFulfillmentErrorMessage(errors).length > 0);
  }
  assert.match(
    transportFulfillmentErrorMessage(
      validateTransportFulfillmentChange({
        currentStatus: "scheduled",
        nextStatus: "in_transit",
      }),
    ),
    /container number/i,
  );
});
