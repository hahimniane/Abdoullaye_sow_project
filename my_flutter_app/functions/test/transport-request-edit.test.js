"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  CONTACT_FIELDS,
  QUOTED_FIELDS,
  classifyTransportEdit,
} = require("../transport_request_edit");

const REQUEST = Object.freeze({
  customerPhone: "+15551234567",
  notes: "Call before pickup",
  pickupAddress: "12 Main St",
  pickupArea: "Bronx",
  carMake: "Toyota",
  carModel: "Camry",
  carYear: 2019,
  vehicleOperable: true,
  requestedTransportMethod: "open",
  destinationCountryId: "guinea",
  flexibleDates: true,
  price: 1800,
  status: "quote_requested",
  businessId: "biz-1",
});

describe("classifying a customer transport edit", () => {
  it("lets contact details through without touching quotes", () => {
    const result = classifyTransportEdit(REQUEST, {
      customerPhone: "+15559998888",
      notes: "Gate code 4432",
    });
    assert.deepEqual(result.changes, {
      customerPhone: "+15559998888",
      notes: "Gate code 4432",
    });
    assert.equal(result.requoteRequired, false);
    assert.equal(result.destinationChanged, false);
  });

  it("flags a pickup address change as requiring fresh quotes", () => {
    // Each business prices pickup from the exact address, so moving it
    // reprices the job - quotes in hand were for a different collection.
    const result = classifyTransportEdit(REQUEST, {
      pickupAddress: "980 Far Away Rd",
    });
    assert.equal(result.requoteRequired, true);
    assert.deepEqual(result.changedQuotedFields, ["pickupAddress"]);
    assert.equal(result.destinationChanged, false);
  });

  it("flags a vehicle change as requiring fresh quotes", () => {
    const result = classifyTransportEdit(REQUEST, {carModel: "Corolla"});
    assert.equal(result.requoteRequired, true);
    assert.deepEqual(result.changedQuotedFields, ["carModel"]);
    assert.equal(result.destinationChanged, false);
  });

  it("flags a destination change so the request can be re-matched", () => {
    const result = classifyTransportEdit(REQUEST, {
      destinationCountryId: "senegal",
    });
    assert.equal(result.destinationChanged, true);
    assert.equal(result.requoteRequired, true);
  });

  it("ignores the callable envelope rather than rejecting it", () => {
    // Clients send {requestId, ...patch}; treating requestId as an edit made
    // every save fail with "These fields cannot be edited: requestId".
    const result = classifyTransportEdit(REQUEST, {
      requestId: "abc123",
      notes: "Gate code 4432",
    });
    assert.deepEqual(result.rejected, []);
    assert.deepEqual(result.changes, {notes: "Gate code 4432"});
  });

  it("rejects fields a customer must never write", () => {
    const result = classifyTransportEdit(REQUEST, {
      price: 1,
      status: "completed",
      businessId: "biz-2",
      selectedQuoteId: "q1",
      notes: "fine",
    });
    assert.deepEqual(result.rejected.sort(),
        ["businessId", "price", "selectedQuoteId", "status"]);
    // The legitimate field in the same patch still applies.
    assert.deepEqual(result.changes, {notes: "fine"});
  });

  it("treats an unchanged resubmission as no edit at all", () => {
    // Clients commonly post the whole form back; that must not void quotes.
    const result = classifyTransportEdit(REQUEST, {
      carMake: "Toyota",
      carYear: "2019",
      vehicleOperable: true,
      destinationCountryId: "guinea",
      pickupAddress: "  12 Main St  ",
    });
    assert.deepEqual(result.changes, {});
    assert.equal(result.requoteRequired, false);
  });

  it("ignores absent values instead of blanking stored data", () => {
    const result = classifyTransportEdit(REQUEST, {
      notes: undefined,
      customerPhone: null,
    });
    assert.deepEqual(result.changes, {});
  });

  it("still records an explicit blanking of a contact field", () => {
    const result = classifyTransportEdit(REQUEST, {notes: ""});
    assert.deepEqual(result.changes, {notes: ""});
    assert.equal(result.requoteRequired, false);
  });

  it("keeps the two field classes disjoint", () => {
    const overlap = CONTACT_FIELDS.filter((f) => QUOTED_FIELDS.includes(f));
    assert.deepEqual(overlap, []);
    // Destination must be quote-affecting - eligibility derives from it.
    assert.equal(QUOTED_FIELDS.includes("destinationCountryId"), true);
  });
});
