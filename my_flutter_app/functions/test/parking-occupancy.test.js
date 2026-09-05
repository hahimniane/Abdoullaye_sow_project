"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  ACTIVE_PARKING_STATUSES,
  isActiveParkingRow,
  parkingRangeOverlaps,
  parkingAvailability,
} = require("../parking_occupancy");

const day = (iso) => new Date(`${iso}T12:00:00Z`);
const BUSINESS = {parkingTotalSpaces: 3, parkingBlockedSpaces: 1};

describe("open-ended stays keep their space", () => {
  it("a car with no leave date still occupies its space weeks later", () => {
    const row = {parkingDate: day("2026-08-01"), status: "reserved"};
    assert.equal(
        parkingRangeOverlaps(row, day("2026-09-01"), day("2026-09-03")),
        true,
    );
  });

  it("an open-ended car does not occupy days before it arrived", () => {
    const row = {parkingDate: day("2026-09-10")};
    assert.equal(
        parkingRangeOverlaps(row, day("2026-09-01"), day("2026-09-03")),
        false,
    );
  });

  it("a closed stay frees the space after the leave date", () => {
    const row = {
      parkingDate: day("2026-08-01"), parkingEndDate: day("2026-08-20"),
    };
    assert.equal(
        parkingRangeOverlaps(row, day("2026-09-01"), day("2026-09-03")),
        false,
    );
    assert.equal(
        parkingRangeOverlaps(row, day("2026-08-15"), day("2026-08-16")),
        true,
    );
  });

  it("reads Firestore timestamps and ISO strings alike", () => {
    const ts = {toDate: () => day("2026-08-01")};
    assert.equal(
        parkingRangeOverlaps(
            {parkingDate: ts}, day("2026-09-01"), day("2026-09-02"),
        ),
        true,
    );
    assert.equal(
        parkingRangeOverlaps(
            {parkingDate: "2026-08-01"}, day("2026-09-01"), day("2026-09-02"),
        ),
        true,
    );
    assert.equal(parkingRangeOverlaps({}, day("2026-09-01"), day("2026-09-02")),
        false);
  });
});

describe("an open-ended window (a walk-up with no leave date)", () => {
  it("does not crash and counts every car still on the lot", () => {
    const rows = [
      {parkingDate: day("2026-08-01")}, // open-ended, still here
      {parkingDate: day("2026-08-01"), parkingEndDate: day("2026-08-10")},
      {parkingDate: day("2026-09-20")}, // arrives after the window opens
    ];
    const from = day("2026-09-05");
    assert.equal(parkingRangeOverlaps(rows[0], from, null), true);
    assert.equal(parkingRangeOverlaps(rows[1], from, null), false);
    assert.equal(parkingRangeOverlaps(rows[2], from, null), true);
    assert.equal(parkingAvailability({
      business: {parkingTotalSpaces: 5},
      reservations: rows,
      start: day("2026-09-05"),
      end: null,
    }), 3);
  });
});

describe("availability counts every active overlapping stay", () => {
  it("subtracts blocked spaces and each active overlapping car", () => {
    const reservations = [
      {parkingDate: day("2026-08-01")}, // open-ended, no status: active
      {parkingDate: day("2026-08-05"), status: "cancelled"},
      {parkingDate: day("2026-08-01"), parkingEndDate: day("2026-08-10")},
    ];
    assert.equal(parkingAvailability({
      business: BUSINESS,
      reservations,
      start: day("2026-09-01"),
      end: day("2026-09-02"),
    }), 1);
  });

  it("never reports fewer than zero spaces", () => {
    const reservations = [
      {parkingDate: day("2026-08-01")},
      {parkingDate: day("2026-08-02")},
      {parkingDate: day("2026-08-03")},
    ];
    assert.equal(parkingAvailability({
      business: BUSINESS,
      reservations,
      start: day("2026-09-01"),
      end: day("2026-09-02"),
    }), 0);
  });

  it("treats a missing status as an active walk-up", () => {
    assert.equal(isActiveParkingRow({}), true);
    assert.equal(isActiveParkingRow({status: "released"}), false);
    for (const status of ACTIVE_PARKING_STATUSES) {
      assert.equal(isActiveParkingRow({status}), true);
    }
  });
});
