"use strict";

// The transport fulfilment state machine, driven directly.
//
// The emulator suite (test/service-callables.test.js) already covers the
// marketplace path end to end. What was never covered - because the callable
// refused it outright and the web console wrote Firestore directly instead -
// is the LEGACY path: a transport job typed straight into a business console,
// with no quote, no flowVersion and therefore no selectedBusinessId. These
// tests pin down that a legacy record is accepted on the same terms as a
// marketplace one, and refused on the same terms too.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");

const {
  TRANSPORT_FULFILLMENT_DESTINATIONS,
  TRANSPORT_FULFILLMENT_STATUSES,
  TRANSPORT_FULFILLMENT_TRANSITIONS,
  classifyTransportFulfillmentChange,
  isMarketplaceTransportRecord,
  transportFulfillmentCurrentStatus,
  transportFulfillmentNextStatuses,
  transportFulfillmentRequiresContainer,
} = require("../transport_fulfillment");

const BUSINESS_ID = "biz-transport-1";

// What `transport_car_screen.dart` and the business console actually write:
// a businessId, a price, a status, and nothing marketplace-shaped at all.
function legacyRecord(overrides = {}) {
  return {
    businessId: BUSINESS_ID,
    businessName: "Legacy Transport Co",
    customerUid: "customer-1",
    price: 950,
    status: "pending",
    trackingCode: "TR-LEGACY",
    ...overrides,
  };
}

function marketplaceRecord(overrides = {}) {
  return {
    businessId: BUSINESS_ID,
    selectedBusinessId: BUSINESS_ID,
    flowVersion: 2,
    quoteStatus: "selected",
    status: "pending",
    fulfillmentStatus: "pending",
    ...overrides,
  };
}

function move(requestData, nextStatus, extra = {}) {
  return classifyTransportFulfillmentChange({
    requestData,
    businessId: BUSINESS_ID,
    nextStatus,
    // Paid by default: most of this file describes what a business may do
    // with a normal, funded job. The payment gate has its own describe block.
    paymentSecured: true,
    ...extra,
  });
}

describe("classifying a transport record", () => {
  it("treats a missing or v1 flowVersion as legacy", () => {
    assert.equal(isMarketplaceTransportRecord(legacyRecord()), false);
    assert.equal(
        isMarketplaceTransportRecord(legacyRecord({flowVersion: 1})),
        false,
    );
    assert.equal(isMarketplaceTransportRecord(marketplaceRecord()), true);
  });

  it("falls through an empty fulfillmentStatus to status", () => {
    assert.equal(
        transportFulfillmentCurrentStatus({
          fulfillmentStatus: "",
          status: "pending",
        }),
        "pending",
    );
    assert.equal(
        transportFulfillmentCurrentStatus({
          fulfillmentStatus: "scheduled",
          status: "pending",
        }),
        "scheduled",
    );
    assert.equal(transportFulfillmentCurrentStatus({}), "");
  });

  it("keeps pending a legal state but never a legal destination", () => {
    assert.ok(TRANSPORT_FULFILLMENT_STATUSES.includes("pending"));
    assert.ok(
        Object.keys(TRANSPORT_FULFILLMENT_TRANSITIONS).includes("pending"),
    );
    assert.equal(TRANSPORT_FULFILLMENT_DESTINATIONS.includes("pending"), false);
  });

  it("offers nothing from a status the machine never produced", () => {
    for (const status of [
      "active",
      "in_progress",
      "completed",
      "sold",
      "reserved",
      "inactive",
      "Pending",
      "",
    ]) {
      assert.deepEqual(transportFulfillmentNextStatuses(status), []);
    }
    assert.deepEqual(transportFulfillmentNextStatuses("delivered"), []);
    assert.deepEqual(transportFulfillmentNextStatuses("cancelled"), []);
  });

  it("asks for a container number only on the way into transit", () => {
    assert.equal(transportFulfillmentRequiresContainer("in_transit"), true);
    for (const status of ["scheduled", "delivered", "cancelled", "pending"]) {
      assert.equal(transportFulfillmentRequiresContainer(status), false);
    }
  });
});

describe("legacy transport records", () => {
  it("accepts a legal move from the record's own business", () => {
    const decision = move(legacyRecord(), "scheduled");

    assert.equal(decision.error, null);
    assert.equal(decision.previousStatus, "pending");
    assert.equal(decision.alreadyUpdated, false);
  });

  it("refuses a business that does not own the record", () => {
    const decision = classifyTransportFulfillmentChange({
      requestData: legacyRecord(),
      businessId: "biz-transport-2",
      nextStatus: "scheduled",
    });

    assert.equal(decision.error.code, "permission-denied");
    assert.match(decision.error.message, /assigned transport business/i);
  });

  it("refuses a legacy record with no businessId at all", () => {
    const decision = move(legacyRecord({businessId: ""}), "scheduled");

    assert.equal(decision.error.code, "permission-denied");
  });

  it("refuses an illegal transition", () => {
    // pending -> delivered skips the whole middle of the job.
    const skipped = move(legacyRecord(), "delivered");
    assert.equal(skipped.error.code, "failed-precondition");
    assert.match(
        skipped.error.message,
        /cannot move from pending to delivered/,
    );

    // delivered and cancelled are terminal.
    for (const terminal of ["delivered", "cancelled"]) {
      const decision = move(
          legacyRecord({status: terminal, fulfillmentStatus: terminal}),
          "scheduled",
      );
      assert.equal(decision.error.code, "failed-precondition");
      assert.match(decision.error.message, new RegExp(`from ${terminal}`));
    }

    // A status the machine never produced has no row to move along.
    const unknown = move(
        legacyRecord({status: "completed", fulfillmentStatus: "completed"}),
        "scheduled",
    );
    assert.equal(unknown.error.code, "failed-precondition");
    assert.match(unknown.error.message, /from completed to scheduled/);

    // pending is not a destination even from pending.
    const backwards = move(legacyRecord({status: "scheduled"}), "pending");
    assert.equal(backwards.error.code, "invalid-argument");
  });

  it("refuses in_transit without a container number", () => {
    const decision = move(legacyRecord(), "in_transit");

    assert.equal(decision.error.code, "failed-precondition");
    assert.equal(decision.error.details.reason, "container_number_required");
    assert.match(decision.error.message, /container number/i);
  });

  it("refuses in_transit when the container number is too short", () => {
    const decision = move(legacyRecord(), "in_transit", {
      submittedContainerNumber: "AB",
    });

    assert.equal(decision.error.code, "failed-precondition");
    assert.equal(decision.error.details.reason, "container_number_required");
  });

  it("accepts in_transit with a submitted container number, normalised", () => {
    const decision = move(legacyRecord(), "in_transit", {
      submittedContainerNumber: "  msku1234567 ",
    });

    assert.equal(decision.error, null);
    assert.equal(decision.containerNumber, "MSKU1234567");
    assert.equal(decision.containerChanged, true);
  });

  it("accepts in_transit on the container number already on file", () => {
    const decision = move(
        legacyRecord({containerNumber: "MSKU1234567"}),
        "in_transit",
    );

    assert.equal(decision.error, null);
    assert.equal(decision.containerNumber, "MSKU1234567");
    // Nothing to write: the record already carries this number.
    assert.equal(decision.containerChanged, false);
  });

  it("reports a repeated status as already updated, not as a refusal", () => {
    const decision = move(
        legacyRecord({status: "scheduled", fulfillmentStatus: "scheduled"}),
        "scheduled",
    );

    assert.equal(decision.error, null);
    assert.equal(decision.alreadyUpdated, true);
    assert.equal(decision.previousStatus, "scheduled");
  });

  it("walks the full legacy job to delivered", () => {
    let record = legacyRecord();
    for (const [next, container] of [
      ["scheduled", ""],
      ["in_transit", "MSKU1234567"],
      ["delivered", ""],
    ]) {
      const decision = move(record, next, {
        submittedContainerNumber: container,
      });
      assert.equal(decision.error, null, `refused ${next}`);
      record = {
        ...record,
        status: next,
        fulfillmentStatus: next,
        containerNumber: decision.containerNumber || record.containerNumber,
      };
    }
    assert.equal(record.fulfillmentStatus, "delivered");
  });
});

describe("marketplace transport records", () => {
  it("still requires the selected business, not merely businessId", () => {
    const decision = move(
        marketplaceRecord({selectedBusinessId: "biz-transport-2"}),
        "scheduled",
    );

    assert.equal(decision.error.code, "permission-denied");
    assert.match(decision.error.message, /selected transport business/i);
  });

  it("still refuses a request that is not at the selected stage", () => {
    const decision = move(
        marketplaceRecord({quoteStatus: "collecting"}),
        "scheduled",
    );

    assert.equal(decision.error.code, "failed-precondition");
    assert.match(decision.error.message, /selected marketplace/i);
  });

  it("applies the same transition table and container gate as legacy", () => {
    assert.equal(move(marketplaceRecord(), "delivered").error.code,
        "failed-precondition");
    assert.equal(
        move(marketplaceRecord(), "in_transit").error.details.reason,
        "container_number_required",
    );
    assert.equal(move(marketplaceRecord(), "scheduled").error, null);
  });
});

describe("the state machine has exactly one implementation", () => {
  const functionsDir = path.join(__dirname, "..");
  const indexSource = fs.readFileSync(
      path.join(functionsDir, "index.js"),
      "utf8",
  );
  const consoleSource = fs.readFileSync(
      path.join(
          functionsDir,
          "..",
          "..",
          "admin_web",
          "src",
          "components",
          "business",
          "operations-panels.tsx",
      ),
      "utf8",
  );

  it("keeps the transition table out of index.js", () => {
    assert.doesNotMatch(indexSource, /const transitions = \{/);
    assert.match(indexSource, /classifyTransportFulfillmentChange\(\{/);
  });

  it("leaves the web console no way around the callable", () => {
    // The direct `transportRequests` write the console used for legacy jobs
    // skipped both the transition table and the container gate. If it comes
    // back, so does the bug.
    assert.doesNotMatch(consoleSource, /doc\(db, "transportRequests"/);
    const callable = new RegExp(
        "httpsCallable\\(\\s*functions,\\s*" +
        "\"updateTransportFulfillmentStatus\",?\\s*\\)",
    );
    assert.match(consoleSource, callable);
  });
});

describe("the payment gate", () => {
  it("refuses to start a marketplace job the customer has not paid", () => {
    // The entire reason acceptance now charges: before this gate a carrier
    // could haul the car to delivered on a job the platform never collected
    // a cent for.
    for (const destination of ["scheduled", "in_transit"]) {
      const decision = move(marketplaceRecord(), destination, {
        paymentSecured: false,
        submittedContainerNumber: "MSCU1234567",
      });
      assert.equal(decision.error?.code, "failed-precondition", destination);
      assert.equal(
          decision.error?.details?.reason,
          "awaiting_customer_payment",
          destination,
      );
    }
  });

  it("still lets a business walk away from an unpaid job", () => {
    const decision = move(marketplaceRecord(), "cancelled", {
      paymentSecured: false,
    });
    assert.equal(decision.error, null);
  });

  it("opens the job once the payment is secured", () => {
    const decision = move(marketplaceRecord(), "scheduled", {
      paymentSecured: true,
    });
    assert.equal(decision.error, null);
  });

  it("never applies to legacy records, which predate the model", () => {
    const decision = move(legacyRecord(), "scheduled", {
      paymentSecured: false,
    });
    assert.equal(decision.error, null);
  });
});
