const assert = require("node:assert/strict");
const test = require("node:test");
const {
  TRACKING_SECTION_BY_COLLECTION,
  validateContainerNumber,
  validateMilestoneSubmission,
  milestoneForContainerStatus,
  carrierEventDocId,
  parseTrackingRequestResponse,
  parseContainersFromIncluded,
  inferRequestType,
} = require("../shipment_tracking");

test(
    "validateMilestoneSubmission accepts a label, trims optional fields",
    () => {
      const result = validateMilestoneSubmission({
        label: "  Departed origin port  ",
        description: "  Left on schedule  ",
        location: "  Conakry, Guinea  ",
      });
      assert.deepEqual(result.missing, []);
      assert.equal(result.label, "Departed origin port");
      assert.equal(result.description, "Left on schedule");
      assert.equal(result.location, "Conakry, Guinea");
    },
);

test("validateMilestoneSubmission requires a non-empty label", () => {
  assert.ok(validateMilestoneSubmission({label: ""}).missing.length > 0);
  assert.ok(validateMilestoneSubmission({label: "   "}).missing.length > 0);
});

test("validateMilestoneSubmission allows omitted description/location", () => {
  const result = validateMilestoneSubmission({label: "Picked up"});
  assert.deepEqual(result.missing, []);
  assert.equal(result.description, "");
  assert.equal(result.location, "");
});

test("validateContainerNumber uppercases and trims", () => {
  assert.equal(validateContainerNumber("  msku1234567  "), "MSKU1234567");
});

test("validateContainerNumber rejects values too short to be real", () => {
  assert.equal(validateContainerNumber("ab"), "");
  assert.equal(validateContainerNumber(""), "");
});

test("TRACKING_SECTION_BY_COLLECTION covers both shipment collections", () => {
  assert.equal(TRACKING_SECTION_BY_COLLECTION.barrelShipments, "barrels");
  assert.equal(TRACKING_SECTION_BY_COLLECTION.freightShipments, "freight");
});

test(
    "milestoneForContainerStatus maps known statuses to a label and " +
    "shipment status",
    () => {
      assert.deepEqual(milestoneForContainerStatus("on_ship"), {
        label: "Loaded on vessel",
        shipmentStatus: "in_transit",
      });
      assert.deepEqual(milestoneForContainerStatus("delivered"), {
        label: "Delivered",
        shipmentStatus: "completed",
      });
    },
);

test(
    "milestoneForContainerStatus leaves shipment status untouched for 'new'",
    () => {
      assert.deepEqual(milestoneForContainerStatus("new"), {
        label: "Tracking request received",
        shipmentStatus: null,
      });
    },
);

test(
    "milestoneForContainerStatus fails closed on an unrecognized status",
    () => {
      assert.equal(milestoneForContainerStatus("some_future_status"), null);
      assert.equal(milestoneForContainerStatus(""), null);
    },
);

test(
    "carrierEventDocId is deterministic and dedupes by container + status",
    () => {
      const first = carrierEventDocId("msku1234567", "on_ship");
      const second = carrierEventDocId("MSKU1234567", "on_ship");
      assert.equal(first, second);
      assert.equal(first, "carrier_MSKU1234567_on_ship");
    },
);

test(
    "carrierEventDocId strips characters unsafe for a Firestore doc id",
    () => {
      const id = carrierEventDocId("msku 1234/567", "on_ship");
      assert.doesNotMatch(id, /[/\s]/);
    },
);

test(
    "parseTrackingRequestResponse extracts id, status, and tracked object",
    () => {
      const parsed = parseTrackingRequestResponse({
        data: {
          id: "478cd7c4-a603-4bdf-84d5-3341c37c43a3",
          attributes: {status: "tracking", failed_reason: null},
          relationships: {
            tracked_object: {data: {id: "shipment-1", type: "shipment"}},
          },
        },
      });
      assert.equal(parsed.id, "478cd7c4-a603-4bdf-84d5-3341c37c43a3");
      assert.equal(parsed.status, "tracking");
      assert.equal(parsed.trackedObjectId, "shipment-1");
      assert.equal(parsed.trackedObjectType, "shipment");
    },
);

test(
    "parseTrackingRequestResponse handles a pending request with no " +
    "tracked object yet",
    () => {
      const parsed = parseTrackingRequestResponse({
        data: {id: "req-1", attributes: {status: "pending"}},
      });
      assert.equal(parsed.trackedObjectId, "");
      assert.equal(parsed.trackedObjectType, "");
    },
);

test(
    "parseTrackingRequestResponse returns null for a malformed payload",
    () => {
      assert.equal(parseTrackingRequestResponse({}), null);
      assert.equal(parseTrackingRequestResponse(null), null);
    },
);

test(
    "parseContainersFromIncluded extracts containers and ignores other " +
    "included types",
    () => {
      const containers = parseContainersFromIncluded({
        included: [
          {
            type: "container",
            id: "c1",
            attributes: {number: "msku1234567", current_status: "on_ship"},
          },
          {type: "terminal", id: "t1", attributes: {name: "Some Terminal"}},
          {
            type: "container",
            id: "c2",
            attributes: {number: "", current_status: "on_ship"},
          },
        ],
      });
      assert.deepEqual(containers, [
        {id: "c1", number: "MSKU1234567", currentStatus: "on_ship"},
      ]);
    },
);

test(
    "parseContainersFromIncluded returns an empty list when nothing is " +
    "included",
    () => {
      assert.deepEqual(parseContainersFromIncluded({}), []);
    },
);

test("inferRequestType recognizes ISO 6346 container numbers", () => {
  assert.equal(inferRequestType("mscu1234567"), "container_number");
  assert.equal(inferRequestType("MSCU1234567"), "container_number");
});

test("inferRequestType falls back to bill_of_lading for anything else", () => {
  assert.equal(inferRequestType("BOOKING123456"), "bill_of_lading");
  assert.equal(inferRequestType("MSCUABC1234"), "bill_of_lading");
});

test("carrier statuses keep the barrel vocabulary for shipments", () => {
  assert.equal(
      milestoneForContainerStatus("available", "barrelShipments")
          .shipmentStatus,
      "ready_for_pickup",
  );
  assert.equal(
      milestoneForContainerStatus("delivered", "freightShipments")
          .shipmentStatus,
      "completed",
  );
});

test("carrier statuses never strand a transport job", () => {
  // "ready_for_pickup" and "completed" are not transport statuses: writing
  // them onto a transportRequests doc leaves the job on a warning badge
  // with no actions. Cars stay in_transit until genuinely handed over.
  assert.equal(
      milestoneForContainerStatus("available", "transportRequests")
          .shipmentStatus,
      "in_transit",
  );
  assert.equal(
      milestoneForContainerStatus("delivered", "transportRequests")
          .shipmentStatus,
      "delivered",
  );
  assert.equal(
      milestoneForContainerStatus("picked_up", "transportRequests")
          .shipmentStatus,
      "delivered",
  );
});

test("carrier statuses default to the shipment vocabulary", () => {
  assert.equal(
      milestoneForContainerStatus("on_ship").shipmentStatus,
      "in_transit",
  );
});
