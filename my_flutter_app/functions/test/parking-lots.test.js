"use strict";

// Several parking lots for one business (docs/PARKING_LOTS.md): where a car
// stands, how full each lot is, and what the business's combined numbers
// are. Owner decisions 2026-11-11 (KEREN AUTO SALES opened a second lot).

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");
const {
  DEFAULT_MAIN_LOT_NAME, LOT_MESSAGES, businessSpaceTotals, carLotFields,
  lotAddress, lotAvailability, lotCloseRefusal, lotIdOfCar, lotIsOpen,
  lotMoveSummary, lotOccupancy, mainLotFromBusiness, mainLotId, normalizeLot,
  openLots, pickBookingLot, resolveEntryLot,
} = require("../parking_lots");

const BIZ = "biz-1";
const MAIN = mainLotId(BIZ);
const day = (n) => new Date(Date.UTC(2026, 10, n, 12));
const car = (id, lotId, extra = {}) => ({id, businessId: BIZ,
  status: "reserved", parkingDate: day(1), ...(lotId ? {parkingLotId: lotId} :
    {}), ...extra});
const lot1 = {id: MAIN, name: "Lot 1", totalSpaces: 3, blockedSpaces: 1,
  isMain: true, sortOrder: 0};
const lot2 = {id: "lot-2", name: "Lot 2", totalSpaces: 2, blockedSpaces: 0,
  sortOrder: 1, addressLine1: "9 Second Street", city: "Bronx", state: "NY"};
const lots = [lot1, lot2];

describe("which lot a car stands in", () => {
  it("reads a car with no lot as standing in the business's first lot",
      () => {
        assert.equal(MAIN, "biz-1_main");
        // Parked before lots existed, or by the old phone app.
        assert.equal(lotIdOfCar(car("a")), MAIN);
        assert.equal(lotIdOfCar({parkingLotId: ""}, BIZ), MAIN);
        assert.equal(lotIdOfCar(car("b", "lot-2")), "lot-2");
      });

  it("counts each lot's own cars, and frees a space when one leaves", () => {
    const rows = [car("a"), car("b", MAIN), car("c", "lot-2"),
      car("gone", "lot-2", {status: "released"}),
      car("void", "lot-2", {voided: true}),
      car("left", "lot-2", {parkingEndDate: day(2)})];
    const at = {businessId: BIZ, reservations: rows, start: day(5), end: null};
    assert.equal(lotOccupancy({...at, lotId: MAIN}), 2);
    assert.equal(lotOccupancy({...at, lotId: "lot-2"}), 1);
    // Lot 1: 3 spaces, 1 blocked, 2 cars. Lot 2: 2 spaces, 1 car.
    assert.equal(lotAvailability({...at, lot: lot1}), 0);
    assert.equal(lotAvailability({...at, lot: lot2}), 1);
    // A car being moved or edited never competes with itself.
    assert.equal(lotAvailability({...at, lot: lot1, exceptCarId: "a"}), 1);
    // A closed lot has no room, whatever its numbers say.
    assert.equal(lotAvailability({...at, lot: {...lot2, active: false}}), 0);
    assert.equal(lotIsOpen({}), true);
    assert.equal(lotIsOpen(null), false);
  });
});

describe("the business's combined spaces", () => {
  it("are the sum over its open lots", () => {
    assert.deepEqual(businessSpaceTotals(lots),
        {parkingTotalSpaces: 5, parkingBlockedSpaces: 1});
    assert.deepEqual(businessSpaceTotals([lot1, {...lot2, active: false}]),
        {parkingTotalSpaces: 3, parkingBlockedSpaces: 1});
    assert.deepEqual(businessSpaceTotals([]),
        {parkingTotalSpaces: 0, parkingBlockedSpaces: 0});
  });

  it("start from the business's own settings: its first lot", () => {
    assert.deepEqual(mainLotFromBusiness(
        {parkingTotalSpaces: 60, parkingBlockedSpaces: 4,
          parkingAddressLine1: "1 Main Street"}), {
      name: DEFAULT_MAIN_LOT_NAME, addressLine1: "", city: "", state: "",
      zipCode: "", totalSpaces: 60, blockedSpaces: 4, active: true,
      isMain: true});
    // Converting changes nothing: the sum is what the business had.
    assert.deepEqual(businessSpaceTotals([mainLotFromBusiness(
        {parkingTotalSpaces: 60, parkingBlockedSpaces: 4})]),
    {parkingTotalSpaces: 60, parkingBlockedSpaces: 4});
    assert.equal(mainLotFromBusiness({}).totalSpaces, 0);
    assert.equal(mainLotFromBusiness(
        {parkingTotalSpaces: 5, parkingBlockedSpaces: 9}).blockedSpaces, 5);
  });
});

describe("what the owner types for a lot", () => {
  it("keeps a name, an address and whole numbers of spaces", () => {
    const {value, errors} = normalizeLot({name: "  Lot   2 ",
      addressLine1: " 9 Second Street ", city: "Bronx", state: "NY",
      totalSpaces: "40", blockedSpaces: ""});
    assert.deepEqual(errors, []);
    assert.deepEqual(value, {name: "Lot 2", addressLine1: "9 Second Street",
      city: "Bronx", state: "NY", zipCode: "", totalSpaces: 40,
      blockedSpaces: 0, active: true});
  });

  it("refuses a missing or repeated name and bad numbers", () => {
    assert.deepEqual(normalizeLot({totalSpaces: 1}).errors,
        ["lot_name_required"]);
    assert.deepEqual(normalizeLot({name: "lot 1", totalSpaces: 1},
        {lots, lotId: "lot-2"}).errors, ["lot_name_taken"]);
    // Renaming a lot to its own name is not a clash.
    assert.deepEqual(normalizeLot({name: "Lot 1", totalSpaces: 1},
        {lots, lotId: MAIN}).errors, []);
    for (const totalSpaces of ["", -1, 1.5, "many", 1000000]) {
      assert.ok(normalizeLot({name: "A", totalSpaces}).errors
          .includes("lot_spaces_invalid"), String(totalSpaces));
    }
    assert.deepEqual(normalizeLot({name: "A", totalSpaces: 2,
      blockedSpaces: 3}).errors, ["lot_blocked_invalid"]);
    for (const code of ["lot_name_required", "lot_name_taken",
      "lot_spaces_invalid", "lot_blocked_invalid", "lot_not_found",
      "lot_closed", "lot_full", "lot_has_cars", "lot_last_open",
      "lot_limit"]) {
      assert.ok(LOT_MESSAGES[code], code);
    }
  });
});

describe("which lot a new car goes into", () => {
  it("is the lot staff chose, else their last one, else the first", () => {
    assert.equal(resolveEntryLot({lots, requestedLotId: "lot-2"}).lot, lot2);
    // The old phone app sends no lot.
    assert.equal(resolveEntryLot({lots, lastLotId: "lot-2"}).lot, lot2);
    assert.equal(resolveEntryLot({lots}).lot, lot1);
    assert.equal(resolveEntryLot({lots, lastLotId: "gone"}).lot, lot1);
    // A last lot that has since closed is not used.
    const closed = [lot1, {...lot2, active: false}];
    assert.equal(resolveEntryLot({lots: closed, lastLotId: "lot-2"}).lot,
        lot1);
  });

  it("never swaps a chosen lot that is unknown or closed", () => {
    assert.deepEqual(resolveEntryLot({lots, requestedLotId: "nope"}),
        {lot: null, refusal: "lot_not_found"});
    assert.deepEqual(resolveEntryLot({lots: [lot1, {...lot2, active: false}],
      requestedLotId: "lot-2"}), {lot: null, refusal: "lot_closed"});
    assert.deepEqual(resolveEntryLot({lots: []}),
        {lot: null, refusal: "lot_not_found"});
  });

  it("sends an online booking to the owner's lot, then the next with room",
      () => {
        const at = {lots, businessId: BIZ, start: day(5), end: day(6)};
        assert.equal(pickBookingLot({...at, bookingLotId: "lot-2",
          reservations: []}), lot2);
        // No choice made: the first lot.
        assert.equal(pickBookingLot({...at, reservations: []}), lot1);
        // Lot 2 full: the next lot with room.
        const full = [car("a", "lot-2"), car("b", "lot-2")];
        assert.equal(pickBookingLot({...at, bookingLotId: "lot-2",
          reservations: full}), lot1);
        // Everything full.
        assert.equal(pickBookingLot({...at, bookingLotId: "lot-2",
          reservations: [...full, car("c"), car("d")]}), null);
      });

  it("lists open lots first lot first", () => {
    assert.deepEqual(openLots([lot2, {...lot1}, {id: "x", active: false}])
        .map((lot) => lot.id), [MAIN, "lot-2"]);
  });
});

describe("closing a lot", () => {
  it("is refused while cars stand in it, or when it is the last one", () => {
    const now = day(5);
    assert.equal(lotCloseRefusal({lot: lot2, lots, businessId: BIZ,
      reservations: [car("a", "lot-2")], now}), "lot_has_cars");
    assert.equal(lotCloseRefusal({lot: lot2, lots, businessId: BIZ,
      reservations: [car("a"), car("left", "lot-2",
          {parkingEndDate: day(2)})], now}), "");
    assert.equal(lotCloseRefusal({lot: lot1, lots: [lot1], businessId: BIZ,
      reservations: [], now}), "lot_last_open");
    assert.equal(lotCloseRefusal({lot: lot1,
      lots: [lot1, {...lot2, active: false}], businessId: BIZ,
      reservations: [], now}), "lot_last_open");
  });
});

describe("what a car record carries about its lot", () => {
  const business = {parkingAddressLine1: "1 Main Street",
    parkingCity: "Brooklyn", parkingState: "NY", addressLine1: "Office"};

  it("uses the lot's own address, else the business's parking address",
      () => {
        assert.deepEqual(lotAddress(lot2, business), {
          parkingAddress: "9 Second Street", parkingCity: "Bronx",
          parkingState: "NY"});
        assert.deepEqual(lotAddress(lot1, business), {
          parkingAddress: "1 Main Street", parkingCity: "Brooklyn",
          parkingState: "NY"});
        assert.equal(lotAddress(lot1, {addressLine1: "Office", city: "Q"})
            .parkingAddress, "Office");
        assert.deepEqual(carLotFields(lot2, business), {
          parkingLotId: "lot-2", parkingLotName: "Lot 2",
          parkingAddress: "9 Second Street", parkingCity: "Bronx",
          parkingState: "NY"});
      });

  it("says where a moved car went", () => {
    assert.equal(lotMoveSummary("Lot 1", "Lot 2"),
        "Moved from Lot 1 to Lot 2");
  });
});
