"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  GUEST_TRACKING_COLLECTIONS,
  CONTAINER_STAGE_BY_STATUS,
  WAITING_STAGE,
  WAITING_STAGE_LABEL,
  guestTrackingCandidates,
  publicGuestTrackingRecord,
} = require("../guest_tracking");

test(
    "guest tracking searches every customer tracking collection",
    () => {
      assert.deepEqual(
          GUEST_TRACKING_COLLECTIONS.map((item) => item.name),
          [
            "barrelShipments",
            "freightShipments",
            "transportRequests",
            "parkedCars",
            "barrelPools",
            "freightQuoteRequests",
            "containerLines",
          ],
      );
    });

test(
    "guest tracking accepts short codes typed with human formatting",
    () => {
      const candidates = guestTrackingCandidates("  bs k7m4p2  ");
      assert.ok(candidates.includes("BS-K7M4P2"));
      assert.ok(candidates.includes("BSK7M4P2"));
    });

test("guest tracking reconstructs the old printed server code", () => {
  const candidates = guestTrackingCandidates("bsms9ttes1omvytl");
  assert.ok(candidates.includes("BS-MS9TTES1-OMVYTL"));
});

test("guest tracking rejects empty, short, or unbounded references", () => {
  assert.deepEqual(guestTrackingCandidates(""), []);
  assert.deepEqual(guestTrackingCandidates("123"), []);
  assert.deepEqual(guestTrackingCandidates("x".repeat(90)), []);
});

test("public barrel result is a strict PII-free projection", () => {
  const result = publicGuestTrackingRecord({
    id: "private-document-id",
    service: "barrel",
    data: {
      trackingCode: "BS-K7M4P2",
      status: "ready_for_pickup",
      updatedAt: {toMillis: () => 1725000000000},
      receiverName: "Private Receiver",
      senderName: "Private Sender",
      customerEmail: "private@example.com",
      receiverPhone: "+12015550123",
      pickupAddress: "Private address",
      price: 200,
      paymentStatus: "succeeded",
      containerNumber: "MSCU1234567",
      businessName: "Private provider relationship",
    },
  });

  assert.deepEqual(result, {
    trackingCode: "BS-K7M4P2",
    service: "barrel",
    stage: "arrived",
    updatedAtMs: 1725000000000,
  });
  for (const privateField of [
    "id",
    "receiverName",
    "senderName",
    "customerEmail",
    "receiverPhone",
    "pickupAddress",
    "price",
    "paymentStatus",
    "containerNumber",
    "businessName",
  ]) {
    assert.equal(Object.hasOwn(result, privateField), false, privateField);
  }
});

test(
    "transport uses fulfillment status and exposes only a public stage",
    () => {
      const result = publicGuestTrackingRecord({
        id: "transport-1",
        service: "transport",
        data: {
          trackingCode: "TR-Q7M4P2",
          status: "pending",
          fulfillmentStatus: "delivered",
          createdAt: {seconds: 1700000000},
          ownerName: "Private owner",
          vinNumber: "PRIVATEVIN123456",
        },
      });
      assert.equal(result.stage, "delivered");
      assert.equal(result.updatedAtMs, 1700000000000);
      assert.equal(Object.hasOwn(result, "ownerName"), false);
      assert.equal(Object.hasOwn(result, "vinNumber"), false);
    });

test("cancelled records never look like a stalled active journey", () => {
  const result = publicGuestTrackingRecord({
    id: "freight-1",
    service: "freight",
    data: {trackingCode: "FR-Q7M4P2", status: "cancelled"},
  });
  assert.equal(result.stage, "cancelled");
});

test("a container line follows its box, and shows nothing personal", () => {
  const record = (containerStatus) => publicGuestTrackingRecord({
    id: "line1",
    service: "container",
    data: {
      trackingCode: "CL-K7M4P2", containerStatus,
      customerName: "Fatou Diallo", customerPhone: "+16465550100",
      receiverPhone: "+224620000000",
    },
  });
  assert.equal(record("loading").stage, "booked");
  assert.equal(record("shipped").stage, "in_transit");
  assert.equal(record("arrived").stage, "arrived");
  assert.deepEqual(Object.keys(record("shipped")).sort(),
      ["service", "stage", "trackingCode", "updatedAtMs"]);
});

test("a package waiting for a container has a public stage of its own", () => {
  const result = publicGuestTrackingRecord({
    id: "line2",
    service: "container",
    data: {
      trackingCode: "CL-W4X5Y6", containerStatus: "waiting", containerId: "",
      customerName: "Fatou Diallo", customerPhone: "+16465550100",
      destinationCountryName: "Guinea", priceCents: 15000,
    },
  });
  // Not "booked": nothing is on a box yet. Still nothing personal.
  assert.equal(result.stage, WAITING_STAGE);
  assert.equal(result.stage, "waiting_container");
  assert.equal(WAITING_STAGE_LABEL, "Received, waiting for a container");
  assert.deepEqual(Object.keys(result).sort(),
      ["service", "stage", "trackingCode", "updatedAtMs"]);
  assert.equal(CONTAINER_STAGE_BY_STATUS.waiting, WAITING_STAGE);
});
