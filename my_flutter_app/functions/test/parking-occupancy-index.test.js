"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  NO_OCCUPANCY_END_MS,
  OPEN_ENDED_OCCUPANCY_END_MS,
  occupancyEndMs,
  occupancyPatch,
  occupancyQueryRows,
  occupancyWindowStartMs,
  parkingAvailability,
  parkingRangeOverlaps,
} = require("../parking_occupancy");

const DAY = 24 * 60 * 60 * 1000;
const day = (iso) => new Date(`${iso}T12:00:00Z`);
const ts = (date) => ({toDate: () => new Date(date.getTime())});

// What a stored row looks like after its write site / trigger stamped it.
const stored = (row) => ({...row, occupancyEndMs: occupancyEndMs(row)});

// The read availability used before this fix: the newest 1000 rows of the
// lot by arrival date.
function legacyRead(rows) {
  return rows.slice()
      .sort((a, b) => b.parkingDate.toDate() - a.parkingDate.toDate())
      .slice(0, 1000);
}

describe("occupancyEndMs", () => {
  it("is the leave date for a closed stay", () => {
    const end = day("2026-09-20");
    assert.equal(
        occupancyEndMs({parkingDate: day("2026-09-01"), parkingEndDate: end}),
        end.getTime(),
    );
  });

  it("is the far-future sentinel for an open-ended stay", () => {
    assert.equal(occupancyEndMs({parkingDate: day("2019-01-01")}),
        OPEN_ENDED_OCCUPANCY_END_MS);
    assert.equal(occupancyEndMs({parkingDate: day("2019-01-01"),
      parkingEndDate: null}), OPEN_ENDED_OCCUPANCY_END_MS);
    // A real JS Date can still be built from it (it is the max Date).
    assert.equal(new Date(OPEN_ENDED_OCCUPANCY_END_MS).getTime(),
        OPEN_ENDED_OCCUPANCY_END_MS);
  });

  it("is 0 for a row with no arrival date (never holds a space)", () => {
    assert.equal(occupancyEndMs({}), NO_OCCUPANCY_END_MS);
    assert.equal(occupancyEndMs({parkingEndDate: day("2026-09-01")}),
        NO_OCCUPANCY_END_MS);
  });

  it("reads Timestamps, Dates and strings with millisecond precision", () => {
    const end = new Date("2026-09-20T10:11:12.345Z");
    const start = day("2026-09-01");
    assert.equal(occupancyEndMs({parkingDate: ts(start),
      parkingEndDate: ts(end)}), end.getTime());
    assert.equal(occupancyEndMs({parkingDate: start, parkingEndDate: end}),
        end.getTime());
    assert.equal(occupancyEndMs({parkingDate: "2026-09-01",
      parkingEndDate: "2026-09-20T10:11:12.345Z"}), end.getTime());
  });

  it("occupancyPatch is idempotent", () => {
    const row = {parkingDate: day("2026-09-01")};
    const patch = occupancyPatch(row);
    assert.deepEqual(patch, {occupancyEndMs: OPEN_ENDED_OCCUPANCY_END_MS});
    assert.equal(occupancyPatch({...row, ...patch}), null);
    // A date change makes it stale again.
    assert.deepEqual(
        occupancyPatch({...row, ...patch,
          parkingEndDate: day("2026-09-03")}),
        {occupancyEndMs: day("2026-09-03").getTime()},
    );
  });
});

describe("the occupancy query never misses a stay that overlaps", () => {
  it("is a superset of parkingRangeOverlaps for random rows and windows",
      () => {
        // Deterministic pseudo-random so a failure is reproducible.
        let seed = 42;
        const rand = () => {
          seed = (seed * 1103515245 + 12345) % 2147483648;
          return seed / 2147483648;
        };
        const base = day("2026-01-01").getTime();
        const at = () => new Date(base + Math.floor(rand() * 400) * DAY +
          Math.floor(rand() * DAY));
        for (let i = 0; i < 2000; i += 1) {
          const start = at();
          const row = stored({
            parkingDate: ts(start),
            parkingEndDate: rand() < 0.3 ? null :
              ts(new Date(start.getTime() + Math.floor(rand() * 60) * DAY)),
          });
          const wStart = at();
          const wEnd = rand() < 0.2 ? null :
            new Date(wStart.getTime() + Math.floor(rand() * 30) * DAY);
          const overlaps = parkingRangeOverlaps(row, wStart, wEnd);
          const read = occupancyQueryRows([row], wStart, wEnd).length === 1;
          if (overlaps) {
            assert.equal(read, true,
                `missed an overlapping stay at iteration ${i}`);
          }
        }
      });

  it("uses the same window start as the overlap check", () => {
    const start = day("2026-09-01");
    const end = day("2026-09-05");
    assert.equal(occupancyWindowStartMs(start, end), start.getTime());
    // Open-ended window ("from today onward") with only a start.
    assert.equal(occupancyWindowStartMs(start, null), start.getTime());
    // No start: the overlap check falls back to the end.
    assert.equal(occupancyWindowStartMs(null, end), end.getTime());
    const now = day("2026-10-05");
    assert.equal(occupancyWindowStartMs(null, null, now), now.getTime());
  });

  it("does not read stays that ended before the window", () => {
    const rows = [
      stored({parkingDate: day("2026-01-01"),
        parkingEndDate: day("2026-01-10")}),
      stored({parkingDate: day("2026-08-01"),
        parkingEndDate: day("2026-08-31")}),
    ];
    assert.equal(
        occupancyQueryRows(rows, day("2026-09-01"), day("2026-09-03")).length,
        0,
    );
  });
});

describe("regression: an open-ended stay from long ago still counts", () => {
  // A one-space lot. One car parked in 2019 and never left. Since then 1200
  // short stays came and went - enough to push the 2019 car out of "the
  // newest 1000 rows", which is how the old read stopped counting it.
  const business = {parkingTotalSpaces: 1, parkingBlockedSpaces: 0};
  const longStay = stored({
    parkingDate: ts(day("2019-03-01")), status: "parked",
  });
  const history = Array.from({length: 1200}, (_, i) => {
    const start = new Date(day("2023-01-01").getTime() + i * DAY);
    return stored({
      parkingDate: ts(start),
      parkingEndDate: ts(new Date(start.getTime() + DAY / 2)),
      status: "reserved",
    });
  });
  const rows = [longStay, ...history];
  const wStart = day("2026-10-10");
  const wEnd = day("2026-10-12");

  it("the old newest-1000 read lost it and over-booked", () => {
    const legacy = legacyRead(rows);
    assert.equal(legacy.includes(longStay), false);
    assert.equal(parkingAvailability({business, reservations: legacy,
      start: wStart, end: wEnd}), 1);
  });

  it("the occupancy read keeps it, and the lot is full", () => {
    const read = occupancyQueryRows(rows, wStart, wEnd);
    assert.equal(read.includes(longStay), true);
    assert.equal(parkingAvailability({business, reservations: read,
      start: wStart, end: wEnd}), 0);
  });

  it("and reads only what can overlap, not the lot's history", () => {
    assert.equal(occupancyQueryRows(rows, wStart, wEnd).length, 1);
  });
});
