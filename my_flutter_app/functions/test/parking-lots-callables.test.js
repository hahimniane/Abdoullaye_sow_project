"use strict";

// Several parking lots for one business (docs/PARKING_LOTS.md) end to end
// against the Firestore emulator: the owner sets lots up, staff park a car
// into one, move it, and each lot keeps its own spaces while the business's
// combined numbers stay their sum.
//
// Run through `npm run test:parking-lots` (firebase emulators:exec).

const assert = require("node:assert/strict");
const {before, describe, it} = require("node:test");
const admin = require("firebase-admin");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
      "Run this through `npm run test:parking-lots` (firebase " +
      "emulators:exec). A direct node --test run would write its fixtures " +
      "into the real project.");
}
process.env.FUNCTIONS_EMULATOR = "true";

const functions = require("../index");
admin.auth().getUser = async (uid) => ({
  uid, email: `${uid}@example.test`, emailVerified: true});
const db = admin.firestore();

const BIZ = "pklots-lot";
const MAIN = `${BIZ}_main`;
const OWNER = "pklots-owner";
const STAFF = "pklots-staff";
const PACKAGES_ONLY = "pklots-packages";
const OUTSIDER = "pklots-outsider";

const run = (name, uid, data) => functions[name].run({
  auth: {uid, token: {}}, data, rawRequest: {}});
const lotAction = (uid, action, data) =>
  run("updateBusinessParkingEntry", uid, {action, businessId: BIZ, ...data});
const car = async (id) => (await db.collection("parkedCars").doc(id).get())
    .data();
const business = async () =>
  (await db.collection("businesses").doc(BIZ).get()).data();
const lots = async () => (await db.collection("parkingLots")
    .where("businessId", "==", BIZ).get()).docs
    .map((d) => ({id: d.id, ...d.data()}))
    .sort((a, b) => a.sortOrder - b.sortOrder);
const day = (offset) => new Date(Date.now() + offset * 86400000)
    .toISOString().slice(0, 10);
let n = 0;
const entry = (extra) => ({businessId: BIZ, paymentMethod: "direct",
  customerName: `Customer ${++n}`, customerPhone: `+1201555${1000 + n}`,
  carMake: "Toyota", carModel: "Camry", carYear: "2015",
  startDate: day(0), ...extra});
const park = async (uid, extra) =>
  (await run("createBusinessParkingEntry", uid, entry(extra))).entryId;
const history = async (id) => (await db.collection("lotLedgerAudit")
    .where("entityId", "==", id).get()).docs.map((d) => d.data().summary);
const refused = (reason) => (error) => error.details?.reason === reason;

let before1;
let lot2;

before(async () => {
  await Promise.all([
    db.collection("businesses").doc(BIZ).set({
      name: "Two Lots", status: "approved", ownerUid: OWNER,
      country: "United States", enabledServices: ["carParking"],
      addressLine1: "5 Office Road", city: "Brooklyn", state: "NY",
      postalCode: "11201",
      parkingTotalSpaces: 3, parkingBlockedSpaces: 1, parkingDailyRate: 10,
      parkingAddressLine1: "1 Main Street", parkingCity: "Brooklyn",
      parkingState: "NY",
    }),
    db.collection("users").doc(OWNER).set({role: "businessOwner",
      businessId: BIZ, fullName: "Owner One"}),
    db.collection("users").doc(STAFF).set({role: "staff", businessId: BIZ,
      businessPermissions: ["parking"], fullName: "Lot Staff"}),
    db.collection("users").doc(PACKAGES_ONLY).set({role: "staff",
      businessId: BIZ, businessPermissions: ["barrels"],
      fullName: "Package Staff"}),
    db.collection("users").doc(OUTSIDER).set({role: "businessOwner",
      businessId: "another-lot", fullName: "Someone Else"}),
  ]);
  // A car parked before lots existed: it carries no lot.
  before1 = await park(STAFF);
});

describe("a business with no lots set up", () => {
  it("parks exactly as before: the car carries no lot", async () => {
    const c = await car(before1);
    assert.equal(c.parkingLotId, undefined);
    assert.equal(c.parkingAddress, "1 Main Street");
    assert.deepEqual(await lots(), []);
    // Its one lot can be named by its id; any other lot is unknown.
    assert.equal((await car(await park(STAFF, {parkingLotId: MAIN,
      startDate: day(40), endDate: day(41)}))).parkingLotId, undefined);
    await assert.rejects(park(STAFF, {parkingLotId: "nope",
      startDate: day(40), endDate: day(41)}), refused("lot_not_found"));
  });
});

describe("setting lots up", () => {
  it("is the owner's: not staff, not another business", async () => {
    const lot = {name: "Lot 2", totalSpaces: 2};
    for (const uid of [STAFF, PACKAGES_ONLY, OUTSIDER]) {
      await assert.rejects(lotAction(uid, "lot_save", {lot}),
          (error) => error.code === "permission-denied", uid);
    }
    assert.deepEqual(await lots(), []);
  });

  it("adding the second lot creates the first from the business's settings",
      async () => {
        await assert.rejects(lotAction(OWNER, "lot_save",
            {lot: {name: "", totalSpaces: 2}}), refused("lot_name_required"));
        await assert.rejects(lotAction(OWNER, "lot_save",
            {lot: {name: "Lot 2", totalSpaces: -1}}),
        refused("lot_spaces_invalid"));
        // The first lot's name is taken the moment it exists.
        await assert.rejects(lotAction(OWNER, "lot_save",
            {lot: {name: "lot 1", totalSpaces: 2}}), refused("lot_name_taken"));
        assert.deepEqual(await lots(), [], "a refusal writes nothing");
        const made = await lotAction(OWNER, "lot_save", {lot: {name: "Lot 2",
          totalSpaces: 2, addressLine1: "9 Second Street", city: "Bronx",
          state: "NY"}});
        assert.equal(made.created, true);
        lot2 = made.lotId;
        const [first, second] = await lots();
        assert.equal(first.id, MAIN);
        assert.equal(first.name, "Lot 1");
        assert.equal(first.isMain, true);
        assert.equal(first.totalSpaces, 3);
        assert.equal(first.blockedSpaces, 1);
        assert.equal(first.addressLine1, "");
        assert.equal(second.id, lot2);
        assert.equal(second.name, "Lot 2");
        assert.equal(second.sortOrder, 1);
        // The business's two numbers are the sum over its open lots.
        const b = await business();
        assert.equal(b.parkingLotsEnabled, true);
        assert.equal(b.parkingTotalSpaces, 5);
        assert.equal(b.parkingBlockedSpaces, 1);
        assert.equal(b.parkingBookingLotId, MAIN);
      });

  it("edits a lot and keeps the business's sum right", async () => {
    // Ten spaces, so the business as a whole keeps room in the tests
    // below: an open-ended stay competes with every later stay.
    await lotAction(OWNER, "lot_save", {lotId: MAIN,
      lot: {name: "Lot 1", totalSpaces: 10, blockedSpaces: 1}});
    const [first] = await lots();
    assert.equal(first.totalSpaces, 10);
    assert.equal(first.isMain, true);
    assert.equal((await business()).parkingTotalSpaces, 12);
    await assert.rejects(lotAction(OWNER, "lot_save", {lotId: "nope",
      lot: {name: "X", totalSpaces: 1}}), refused("lot_not_found"));
    await assert.rejects(lotAction(OWNER, "lot_save", {lotId: lot2,
      lot: {name: "Lot 1", totalSpaces: 1}}), refused("lot_name_taken"));
  });

  it("the old settings form can no longer overwrite the sum", async () => {
    await run("updateBusinessProfile", OWNER, {businessId: BIZ,
      name: "Two Lots", addressLine1: "5 Office Road", city: "Brooklyn",
      state: "NY", postalCode: "11201", country: "United States",
      parkingTotalSpaces: 99, parkingBlockedSpaces: 9});
    const b = await business();
    assert.equal(b.parkingTotalSpaces, 12);
    assert.equal(b.parkingBlockedSpaces, 1);
  });
});

describe("parking a car into a lot", () => {
  it("puts it where staff chose, with that lot's name and address",
      async () => {
        const id = await park(STAFF, {parkingLotId: lot2});
        const c = await car(id);
        assert.equal(c.parkingLotId, lot2);
        assert.equal(c.parkingLotName, "Lot 2");
        assert.equal(c.parkingAddress, "9 Second Street");
        assert.equal(c.parkingCity, "Bronx");
        // A lot with no address of its own stands at the business's.
        const first = await car(await park(STAFF, {parkingLotId: MAIN}));
        assert.equal(first.parkingLotName, "Lot 1");
        assert.equal(first.parkingAddress, "1 Main Street");
      });

  it("puts a car with no lot asked (the old phone app) in the first lot",
      async () => {
        const c = await car(await park(STAFF, {startDate: day(60),
          endDate: day(61)}));
        assert.equal(c.parkingLotId, MAIN);
      });

  it("refuses an unknown lot, and a lot that is full though another has room",
      async () => {
        await assert.rejects(park(STAFF, {parkingLotId: "nope"}),
            refused("lot_not_found"));
        // Lot 2 has 2 spaces and one car: one more fits, the next does not.
        await park(STAFF, {parkingLotId: lot2});
        await assert.rejects(park(STAFF, {parkingLotId: lot2}),
            refused("lot_full"));
        // The business as a whole still has room, in Lot 1.
        assert.ok(await park(STAFF, {parkingLotId: MAIN}));
      });
});

describe("moving a car", () => {
  it("any parking staff may; History says where it went; nobody else",
      async () => {
        await assert.rejects(lotAction(PACKAGES_ONLY, "lot_move",
            {entryId: before1, parkingLotId: MAIN}),
        (error) => error.code === "permission-denied");
        // Lot 2 is full: the car cannot go there.
        await assert.rejects(lotAction(STAFF, "lot_move",
            {entryId: before1, parkingLotId: lot2}), refused("lot_full"));
        await lotAction(OWNER, "lot_save", {lotId: lot2,
          lot: {name: "Lot 2", totalSpaces: 3,
            addressLine1: "9 Second Street", city: "Bronx", state: "NY"}});
        const moved = await lotAction(STAFF, "lot_move",
            {entryId: before1, parkingLotId: lot2});
        assert.equal(moved.moved, true);
        assert.equal(moved.parkingLotName, "Lot 2");
        const c = await car(before1);
        assert.equal(c.parkingLotId, lot2);
        assert.equal(c.parkingAddress, "9 Second Street");
        assert.equal(c.lotMovedByUid, STAFF);
        // The money did not move with it.
        assert.ok(c.totalCostCents >= 0);
        assert.deepEqual(await history(before1),
            ["Moved from Lot 1 to Lot 2"]);
        // The same lot again changes nothing and writes no History.
        const again = await lotAction(STAFF, "lot_move",
            {entryId: before1, parkingLotId: lot2});
        assert.equal(again.moved, false);
        assert.equal((await history(before1)).length, 1);
        await assert.rejects(lotAction(STAFF, "lot_move",
            {entryId: before1, parkingLotId: "nope"}),
        refused("lot_not_found"));
      });
});

describe("closing a lot and the booking lot", () => {
  it("refuses to close a lot with cars in it, and the last open lot",
      async () => {
        await assert.rejects(lotAction(OWNER, "lot_save", {lotId: lot2,
          lot: {name: "Lot 2", totalSpaces: 3, active: false}}),
        refused("lot_has_cars"));
        const made = await lotAction(OWNER, "lot_save",
            {lot: {name: "Lot 3", totalSpaces: 7}});
        assert.equal((await business()).parkingTotalSpaces, 20);
        // The owner sends online bookings to Lot 3, then closes it.
        await assert.rejects(lotAction(STAFF, "lot_booking",
            {lotId: made.lotId}),
        (error) => error.code === "permission-denied");
        await lotAction(OWNER, "lot_booking", {lotId: made.lotId});
        assert.equal((await business()).parkingBookingLotId, made.lotId);
        await lotAction(OWNER, "lot_save", {lotId: made.lotId,
          lot: {name: "Lot 3", totalSpaces: 7, active: false}});
        const b = await business();
        assert.equal(b.parkingTotalSpaces, 13, "a closed lot's spaces leave");
        assert.equal(b.parkingBookingLotId, MAIN,
            "bookings fall back to an open lot");
        await assert.rejects(lotAction(OWNER, "lot_booking",
            {lotId: made.lotId}), refused("lot_closed"));
        // A closed lot takes no car, by parking or by a move.
        await assert.rejects(park(STAFF, {parkingLotId: made.lotId}),
            refused("lot_closed"));
        await assert.rejects(lotAction(STAFF, "lot_move",
            {entryId: before1, parkingLotId: made.lotId}),
        refused("lot_closed"));
      });
});

describe("the numbers lot by lot", () => {
  it("tells the parking totals for each lot, adding up to the business",
      async () => {
        const answer = await run("getParkingTotals", OWNER,
            {businessId: BIZ, refresh: true});
        const {parking} = answer;
        const told = Object.fromEntries(parking.lots.map((lot) =>
          [lot.name, lot]));
        assert.deepEqual(parking.lots.map((lot) => [lot.name, lot.open]),
            [["Lot 1", true], ["Lot 2", true], ["Lot 3", false]]);
        // Lot 1: 10 spaces, 1 blocked. Lot 2: 3 spaces.
        assert.equal(told["Lot 1"].totals.spacesTotal, 9);
        assert.equal(told["Lot 2"].totals.spacesTotal, 3);
        assert.equal(told["Lot 3"].totals.inLot, 0);
        // Every car is in exactly one lot: the lots add up to the business.
        const sum = (pick) => parking.lots.reduce((n, lot) => n + pick(lot), 0);
        assert.equal(sum((lot) => lot.totals.inLot), parking.totals.inLot);
        assert.equal(sum((lot) => lot.totals.reserved),
            parking.totals.reserved);
        assert.equal(sum((lot) => lot.records), parking.records);
        assert.ok(Math.abs(sum((lot) => lot.totals.owed) -
          parking.totals.owed) < 0.011);
        // Lot 2 holds the two cars parked into it and the one moved there.
        assert.equal(told["Lot 2"].totals.inLot, 3);
        assert.equal(told["Lot 2"].month.arrived, 3);
        assert.equal(told["Lot 2"].month.left, 0);
        assert.match(told["Lot 2"].month.key, /^\d{4}-\d{2}$/);
      });
});
