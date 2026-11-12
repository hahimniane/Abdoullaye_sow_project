"use strict";

// Fleet (docs/FLEET.md) end to end against the Firestore emulator: the
// platform switch, settings, drivers and cars, a car given to a driver (rent
// bills), payments (late fee first, overpay to credit), undo, a car returned
// mid-month under both rules, the daily job, the spreadsheet import and who
// may do what. Synthetic data only.
//
// Run through `npm run test:fleet` (firebase emulators:exec).

const assert = require("node:assert/strict");
const {before, describe, it} = require("node:test");
const admin = require("firebase-admin");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
      "Run this through `npm run test:fleet` (firebase emulators:exec). " +
      "A direct node --test run would write into the real project.");
}
process.env.FUNCTIONS_EMULATOR = "true";

const functions = require("../index");
const {FLEET_SHEET_MONTHS} = require("../fleet_import");
admin.auth().getUser = async (uid) => ({
  uid, email: `${uid}@example.test`, emailVerified: true});
const db = admin.firestore();

const BIZ = "fleet-biz";
const OWNER = "fleet-owner";
const STAFF = "fleet-staff";
const PARKING_ONLY = "fleet-parking";
const PLATFORM = "fleet-platform";

const run = (name, uid, data) => functions[name].run({
  auth: {uid, token: {}}, data, rawRequest: {}});
const act = (uid, action, data = {}) =>
  run("fleetAction", uid, {action, businessId: BIZ, ...data});
const refused = (reason) => (error) => error.details?.reason === reason;
const denied = (error) => error.code === "permission-denied";
const bills = async (driverId) => (await db.collection("fleetBills")
    .where("driverId", "==", driverId).get()).docs
    .map((d) => ({id: d.id, ...d.data()}))
    .sort((a, b) => a.dueDayKey.localeCompare(b.dueDayKey) ||
      a.id.localeCompare(b.id));
const doc = async (col, id) => (await db.collection(col).doc(id).get()).data();

before(async () => {
  await Promise.all([
    db.collection("businesses").doc(BIZ).set({
      name: "Test Fleet Co", status: "approved", ownerUid: OWNER,
      enabledServices: ["barrelShipping"],
    }),
    db.collection("users").doc(OWNER).set({role: "businessOwner",
      businessId: BIZ, fullName: "Owner One"}),
    db.collection("users").doc(STAFF).set({role: "staff", businessId: BIZ,
      businessPermissions: ["fleet"], fullName: "Fleet Staff"}),
    db.collection("users").doc(PARKING_ONLY).set({role: "staff",
      businessId: BIZ, businessPermissions: ["parking"],
      fullName: "Parking Staff"}),
    db.collection("users").doc(PLATFORM).set({role: "admin",
      adminRole: "superAdmin", fullName: "Platform"}),
  ]);
});

describe("switching Fleet on", () => {
  it("is a platform admin's, not the business's", async () => {
    await assert.rejects(act(OWNER, "fleet_enable", {enabled: true}), denied);
    await assert.rejects(act(OWNER, "settings_save", {settings: {}}),
        refused("fleet_off"));
    await act(PLATFORM, "fleet_enable", {enabled: true});
    const b = await doc("businesses", BIZ);
    assert.equal(b.fleet.enabled, true);
    assert.ok(b.enabledServices.includes("fleet"));
    assert.ok(b.enabledServices.includes("barrelShipping"));
  });

  it("settings are a Fleet admin's", async () => {
    const settings = {lateFee: {cents: 2500, dayOfMonth: 5,
      firstMonth: "2026-01"}, returnRule: "days",
    zelle: {name: "Test Fleet Co", handle: "pay@example.test"}};
    await assert.rejects(act(STAFF, "settings_save", {settings}),
        refused("fleet_admin_only"));
    await assert.rejects(act(OWNER, "settings_save",
        {settings: {lateFee: {cents: 100, dayOfMonth: 31}}}),
    refused("fleet_bad_input"));
    const saved = await act(OWNER, "settings_save", {settings});
    assert.equal(saved.settings.returnRule, "days");
    assert.equal(saved.settings.lateFee.cents, 2500);
  });
});

let driverA;
let driverB;
let car1;
let assignment;

describe("drivers, cars and a car given to a driver", () => {
  it("staff add drivers (each with personal cents) and cars", async () => {
    await assert.rejects(act(PARKING_ONLY, "driver_save",
        {driver: {name: "X"}}), denied);
    driverA = (await act(STAFF, "driver_save", {driver: {name:
      "Test Driver A", phone: "(212) 555-0100"}})).driverId;
    driverB = (await act(STAFF, "driver_save", {driver: {name:
      "Test Driver B", phone: "2125550101"}})).driverId;
    car1 = (await act(STAFF, "car_save", {car: {plate: "t000001c",
      company: "Test Base", ownership: "driver"}})).carId;
    const a = await doc("fleetDrivers", driverA);
    const b = await doc("fleetDrivers", driverB);
    assert.equal(a.phone, "+12125550100");
    assert.notEqual(a.personalCents, b.personalCents);
    assert.ok(a.personalCents >= 1 && a.personalCents <= 99);
    assert.equal((await doc("fleetCars", car1)).plate, "T000001C");
  });

  it("an admin gives the car (bills from the start), once", async () => {
    await assert.rejects(act(STAFF, "assignment_start", {driverId: driverA,
      carId: car1, startDayKey: "2026-09-01", rentCents: 40000}),
    refused("fleet_admin_only"));
    assignment = (await act(OWNER, "assignment_start", {driverId: driverA,
      carId: car1, startDayKey: "2026-09-01", rentCents: 40000,
      period: "monthly", dueDay: 1})).assignmentId;
    const list = await bills(driverA);
    assert.ok(list.length >= 2, "September onward is billed");
    assert.equal(list[0].periodFrom, "2026-09-01");
    assert.equal(list[0].amountCents, 40000);
    assert.equal(list[0].status, "open");
    await assert.rejects(act(OWNER, "assignment_start", {driverId: driverB,
      carId: car1, startDayKey: "2026-10-01", rentCents: 40000}),
    refused("fleet_car_taken"));
  });
});

describe("payments", () => {
  it("pay oldest first, overpay goes to credit, undo puts it back",
      async () => {
        const before = await bills(driverA);
        const owed = before.reduce((s, b) => s + b.amountCents, 0);
        const paid = await act(STAFF, "payment_record", {driverId: driverA,
          amountCents: owed + 1500, method: "zelle"});
        assert.equal(paid.creditAddedCents, 1500);
        assert.ok((await bills(driverA)).every((b) => b.status === "paid"));
        assert.equal((await doc("fleetDrivers", driverA)).creditCents, 1500);
        await assert.rejects(act(STAFF, "payment_undo",
            {paymentId: paid.paymentId}), refused("fleet_admin_only"));
        await act(OWNER, "payment_undo", {paymentId: paid.paymentId});
        assert.ok((await bills(driverA)).every((b) => b.status === "open"));
        assert.equal((await doc("fleetDrivers", driverA)).creditCents, 0);
        await assert.rejects(act(OWNER, "payment_undo",
            {paymentId: paid.paymentId}), refused("fleet_already_undone"));
      });

  it("a one-off charge, and an admin waives it with a reason", async () => {
    const {billId} = await act(STAFF, "charge_add", {driverId: driverA,
      amountCents: 6500, label: "Tow fee"});
    await assert.rejects(act(OWNER, "bill_waive", {billId, reason: " "}),
        refused("fleet_reason_required"));
    await act(OWNER, "bill_waive", {billId, reason: "Office mistake"});
    assert.equal((await doc("fleetBills", billId)).status, "waived");
  });
});

describe("the car comes back mid-month", () => {
  it("days rule: the cut month is charged for its days only", async () => {
    await act(OWNER, "assignment_end", {assignmentId: assignment,
      endDayKey: "2026-10-15"});
    const list = (await bills(driverA)).filter((b) => b.kind === "rent");
    const oct = list.find((b) => b.periodFrom === "2026-10-01");
    assert.equal(oct.amountCents, Math.round(40000 * 15 / 31));
    assert.ok(list.filter((b) => b.periodFrom > "2026-10-01")
        .every((b) => b.status === "void"));
    assert.equal((await doc("fleetCars", car1)).status, "inactive");
  });
});

describe("the daily job", () => {
  it("bills what is due and adds late fees, once", async () => {
    const car2 = (await act(STAFF, "car_save",
        {car: {plate: "T000002C"}})).carId;
    await act(OWNER, "assignment_start", {driverId: driverB, carId: car2,
      startDayKey: "2026-08-01", rentCents: 30000});
    await functions.fleetDaily.run({});
    await functions.fleetDaily.run({});
    const list = await bills(driverB);
    const fees = list.filter((b) => b.kind === "late_fee");
    assert.ok(fees.length >= 2, "late months got a fee");
    assert.equal(new Set(fees.map((f) => f.lateFeeForBillId)).size,
        fees.length, "one fee per late bill");
    assert.ok(fees.every((f) => f.amountCents === 2500));
  });
});

describe("the spreadsheet import", () => {
  const header = Array.from({length: 98}, (_, i) => `col${i}`);
  const row = (name, phone, plate, months) => {
    const r = Array.from({length: 98}, () => "");
    r[1] = "1/1/2026"; r[3] = name; r[4] = phone; r[8] = plate; r[20] = "400";
    for (const [month, value] of Object.entries(months)) {
      const col = FLEET_SHEET_MONTHS.indexOf(month);
      if (col >= 0) r[col] = value;
    }
    return r;
  };
  const rows = [header,
    row("Sheet Driver One", "2125550200", "T000010C",
        {"2026-01": "400", "2026-10": "400", "2026-11": "0"}),
    row("Sheet Driver Two", "2125550201", "T000011C",
        {"2026-10": "0"})];

  it("is a Fleet admin's; a dry run writes nothing", async () => {
    await assert.rejects(act(STAFF, "import_sheet", {rows}),
        refused("fleet_admin_only"));
    const dry = await act(OWNER, "import_sheet", {rows, dryRun: true});
    assert.equal(dry.counts.drivers, 2);
    assert.equal((await db.collection("fleetDrivers")
        .where("name", "==", "Sheet Driver One").get()).size, 0);
  });

  it("writes drivers, cars, payments and owed bills; twice is the same",
      async () => {
        await act(OWNER, "import_sheet", {rows});
        await act(OWNER, "import_sheet", {rows});
        const drivers = await db.collection("fleetDrivers")
            .where("businessId", "==", BIZ)
            .where("name", "in", ["Sheet Driver One", "Sheet Driver Two"])
            .get();
        assert.equal(drivers.size, 2);
        const payments = await db.collection("fleetPayments")
            .where("businessId", "==", BIZ).where("imported", "==", true)
            .get();
        assert.equal(payments.size, 2);
        const open = await db.collection("fleetBills")
            .where("businessId", "==", BIZ).where("kind", "==", "rent")
            .where("status", "==", "open").get();
        assert.ok(open.docs.some((d) => d.id.includes("2026-11")));
      });
});
