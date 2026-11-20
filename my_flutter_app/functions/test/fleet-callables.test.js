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

describe("the driver profile: license history, notes, friends", () => {
  const file = (driverId, name = "license.jpg") => ({
    path: `fleetDocs/${BIZ}/${driverId}/abc123-${name}`, name,
    contentType: "image/jpeg", size: 1234});

  it("a changed TLC license keeps the old one with its dates", async () => {
    await act(STAFF, "driver_save", {driverId: driverA, driver: {
      name: "Test Driver A", phone: "2125550100", tlcLicense: "5000001"}});
    let a = await doc("fleetDrivers", driverA);
    assert.deepEqual(a.licenseHistory, []);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(a.tlcLicenseSince));
    // Saving the same license again adds nothing.
    await act(STAFF, "driver_save", {driverId: driverA, driver: {
      name: "Test Driver A", phone: "2125550100", tlcLicense: "5000001"}});
    assert.equal((await doc("fleetDrivers", driverA)).licenseHistory.length, 0);
    await act(STAFF, "driver_save", {driverId: driverA, driver: {
      name: "Test Driver A", phone: "2125550100", tlcLicense: "5000002"}});
    a = await doc("fleetDrivers", driverA);
    assert.equal(a.tlcLicense, "5000002");
    assert.equal(a.licenseHistory.length, 1);
    assert.equal(a.licenseHistory[0].license, "5000001");
    assert.ok(a.licenseHistory[0].fromDayKey);
    assert.ok(a.licenseHistory[0].toDayKey);
  });

  it("a plate that moves to another car keeps the car it was on; fixing " +
      "a typo does not", async () => {
    const plate = {plate: "T000009C", company: "Test Base",
      ownership: "driver"};
    const id = (await act(STAFF, "car_save", {car: {...plate,
      vehicleType: "Toyota Camry 2019", vin: "1AAAAAAAAAAAAAAA1"}})).carId;
    const added = await doc("fleetCars", id);
    assert.deepEqual(added.vehicleHistory, []);
    assert.match(added.vehicleSince, /^\d{4}-\d{2}-\d{2}$/);
    // A typo in the VIN: the same car, no history.
    await act(STAFF, "car_save", {carId: id, car: {...plate,
      vehicleType: "Toyota Camry 2019", vin: "1AAAAAAAAAAAAAAA2"}});
    let now = await doc("fleetCars", id);
    assert.deepEqual(now.vehicleHistory, []);
    assert.equal(now.vin, "1AAAAAAAAAAAAAAA2");
    assert.equal(now.vehicleSince, added.vehicleSince);
    // The driver changed cars and kept the plate.
    await act(STAFF, "car_save", {carId: id, car: {...plate,
      vehicleType: "Honda Accord 2022", vin: "2BBBBBBBBBBBBBBB3",
      vehicleChange: {moved: true, sinceDayKey: "2026-12-10"}}});
    now = await doc("fleetCars", id);
    assert.equal(now.plate, "T000009C", "the plate is the same");
    assert.equal(now.vin, "2BBBBBBBBBBBBBBB3");
    assert.equal(now.vehicleSince, "2026-12-10");
    assert.deepEqual(now.vehicleHistory, [{vin: "1AAAAAAAAAAAAAAA2",
      vehicleType: "Toyota Camry 2019", ownership: "driver",
      fromDayKey: added.vehicleSince, toDayKey: "2026-12-10"}]);
    // "Moved" with nothing changed records nothing.
    await act(STAFF, "car_save", {carId: id, car: {...plate,
      vehicleType: "Honda Accord 2022", vin: "2BBBBBBBBBBBBBBB3",
      vehicleChange: {moved: true, sinceDayKey: "2026-12-20"}}});
    assert.equal((await doc("fleetCars", id)).vehicleHistory.length, 1);
  });

  it("staff add a note with a file; an admin removes it (kept, greyed)",
      async () => {
        await assert.rejects(act(PARKING_ONLY, "note_add",
            {driverId: driverA, text: "x"}), denied);
        await assert.rejects(act(STAFF, "note_add", {driverId: driverA}),
            refused("fleet_note_empty"));
        await assert.rejects(act(STAFF, "note_add", {driverId: driverA,
          text: "x", files: [{...file(driverA), contentType: "text/html"}]}),
        refused("fleet_bad_file"));
        await assert.rejects(act(STAFF, "note_add", {driverId: driverA,
          text: "x", files: [{...file("other-driver")}]}),
        refused("fleet_bad_file"));
        await assert.rejects(act(STAFF, "note_add", {driverId: driverA,
          text: "x", files: [{...file(driverA), size: 11 * 1024 * 1024}]}),
        refused("fleet_bad_file"));
        await assert.rejects(act(STAFF, "note_add", {driverId: "nobody",
          text: "x"}), refused("fleet_not_found"));
        const {noteId} = await act(STAFF, "note_add", {driverId: driverA,
          text: "Brought the signed agreement", files: [file(driverA)]});
        const n = await doc("fleetNotes", noteId);
        assert.equal(n.businessId, BIZ);
        assert.equal(n.driverId, driverA);
        assert.equal(n.byUid, STAFF);
        assert.equal(n.files.length, 1);
        assert.ok(n.atMs > 0);
        await assert.rejects(act(STAFF, "note_void", {noteId}),
            refused("fleet_admin_only"));
        await act(OWNER, "note_void", {noteId});
        const after = await doc("fleetNotes", noteId);
        assert.equal(after.voided.byUid, OWNER);
        assert.equal(after.text, "Brought the signed agreement");
        await assert.rejects(act(OWNER, "note_void", {noteId}),
            refused("fleet_note_voided"));
      });

  it("friends who drove: overlap and bad dates are refused", async () => {
    const friend = {name: "Test Friend", phone: "(212) 555-0111",
      tlcLicense: "6000001", address: {line1: "1 Test St", city: "Queens",
        state: "NY", zip: "11101"}};
    await assert.rejects(act(PARKING_ONLY, "substitute_save", {driverId:
      driverA, friend, fromDayKey: "2026-09-10", toDayKey: "2026-09-12"}),
    denied);
    await assert.rejects(act(STAFF, "substitute_save", {driverId: driverA,
      friend, fromDayKey: "2026-09-12", toDayKey: "2026-09-10"}),
    refused("fleet_bad_input"));
    await assert.rejects(act(STAFF, "substitute_save", {driverId: driverA,
      friend: {...friend, name: " "}, fromDayKey: "2026-09-10",
      toDayKey: "2026-09-12"}), refused("fleet_bad_input"));
    const first = await act(STAFF, "substitute_save", {driverId: driverA,
      friend, fromDayKey: "2026-09-10", toDayKey: "2026-09-12"});
    assert.equal(first.carId, car1, "the driver's current car");
    const s = await doc("fleetSubstitutes", first.substituteId);
    assert.equal(s.phone, "+12125550111");
    assert.equal(s.driverId, driverA);
    await assert.rejects(act(STAFF, "substitute_save", {driverId: driverA,
      friend: {...friend, name: "Other Friend"}, fromDayKey: "2026-09-12",
      toDayKey: "2026-09-14"}), refused("fleet_friend_overlap"));
    // Editing the same period does not clash with itself.
    await act(STAFF, "substitute_save", {substituteId: first.substituteId,
      driverId: driverA, friend, fromDayKey: "2026-09-10",
      toDayKey: "2026-09-11"});
    // The next days are free.
    const second = await act(STAFF, "substitute_save", {driverId: driverA,
      friend: {...friend, name: "Other Friend"}, fromDayKey: "2026-09-12",
      toDayKey: "2026-09-14"});
    await assert.rejects(act(STAFF, "substitute_void",
        {substituteId: second.substituteId}), refused("fleet_admin_only"));
    await act(OWNER, "substitute_void", {substituteId: second.substituteId});
    assert.equal((await doc("fleetSubstitutes", second.substituteId)).voided,
        true);
    // A voided period no longer blocks the days.
    await act(STAFF, "substitute_save", {driverId: driverA, friend,
      fromDayKey: "2026-09-12", toDayKey: "2026-09-14"});
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
      // The last column of that month (column index -> "YYYY-MM").
      const col = Math.max(...Object.entries(FLEET_SHEET_MONTHS)
          .filter(([, m]) => m === month).map(([c]) => Number(c)));
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
        // Spreadsheet history cannot be undone (no bill split to take back).
        await assert.rejects(act(OWNER, "payment_undo",
            {paymentId: payments.docs[0].id}), refused("fleet_import_locked"));
        const open = await db.collection("fleetBills")
            .where("businessId", "==", BIZ).where("kind", "==", "rent")
            .where("status", "==", "open").get();
        assert.ok(open.docs.some((d) => d.id.includes("2026-11")));
      });

  // 2026-11-19, Landa: the daily job billed every imported driver for every
  // month since their start (one owed $26,050 on a $400 plate fee), and a
  // second bill for the go-live months the import had already made.
  const goLiveMonths = ["2026-10", "2026-11"];
  const history = [header,
    row("Sheet Driver Three", "2125550202", "T000012C",
        {"2026-01": "400", "2026-10": "400", "2026-11": "0"})];
  const sheetDriver = async (name) => (await db.collection("fleetDrivers")
      .where("businessId", "==", BIZ).where("name", "==", name).get())
      .docs[0];

  it("the daily job never bills the months before go-live, nor a go-live " +
      "month twice", async () => {
    await act(OWNER, "import_sheet", {rows: history, goLiveMonths});
    await functions.fleetDaily.run({});
    await functions.fleetDaily.run({});
    const driver = await sheetDriver("Sheet Driver Three");
    const rent = (await bills(driver.id)).filter((b) => b.kind === "rent");
    assert.deepEqual(rent.filter((b) => b.periodFrom < "2026-10-01"), [],
        "nothing is owed for the spreadsheet's history");
    assert.equal(new Set(rent.map((b) => b.label)).size, rent.length,
        "one bill a month");
    const by = (month) => rent.filter((b) => b.periodFrom.startsWith(month));
    assert.deepEqual(by("2026-10").map((b) => [b.amountCents, b.status]),
        [[40000, "paid"]]);
    assert.deepEqual(by("2026-11").map((b) => [b.amountCents, b.status]),
        [[40000, "open"]]);
    const assignments = await db.collection("fleetAssignments")
        .where("driverId", "==", driver.id).get();
    assert.equal(assignments.docs[0].get("billFromDayKey"), "2026-12-01");
  });

  it("the months the first import billed are kept for the next import",
      async () => {
        const kept = (await doc("businesses", BIZ)).fleet.goLiveMonths;
        assert.equal(kept.length, 2);
        assert.ok(kept.every((m) => /^\d{4}-\d{2}$/.test(m)));
      });

  it("a returned plate leaves the imported months' bills as they were",
      async () => {
        const driver = await sheetDriver("Sheet Driver Three");
        const assignment = (await db.collection("fleetAssignments")
            .where("driverId", "==", driver.id).get()).docs[0];
        await act(OWNER, "assignment_end", {assignmentId: assignment.id,
          endDayKey: "2026-11-30"});
        const rent = (await bills(driver.id)).filter((b) => b.kind === "rent");
        const month = (m) => rent.find((b) => b.periodFrom === `${m}-01`);
        assert.deepEqual([month("2026-10").amountCents,
          month("2026-10").paidCents, month("2026-10").status],
        [40000, 40000, "paid"]);
        assert.deepEqual([month("2026-11").amountCents,
          month("2026-11").status], [40000, "open"]);
        assert.ok(rent.filter((b) => b.periodFrom > "2026-11-30")
            .every((b) => b.status === "void"), "later months are void");
        assert.equal(Number((await doc("fleetDrivers", driver.id))
            .creditCents) || 0, 0, "nothing paid became credit");
      });
});

// ---- billing defects found by the 2026-11-19 audit -----------------------
// Each test below failed on the code before the fixes.

let counter = 0;
const newDriver = async (name) => (await act(STAFF, "driver_save",
    {driver: {name: `Audit ${name}`, phone: `21255509${10 + counter++}`}}))
    .driverId;
const newCar = async () => (await act(STAFF, "car_save",
    {car: {plate: `A${String(100000 + counter++)}C`}})).carId;
const give = async (driverId, startDayKey, extra = {}) => {
  const carId = extra.carId || await newCar();
  const r = await act(OWNER, "assignment_start", {driverId, carId,
    startDayKey, rentCents: 40000, period: "monthly", dueDay: 1, ...extra});
  return {assignmentId: r.assignmentId, carId};
};
const rentOf = async (driverId) =>
  (await bills(driverId)).filter((b) => b.kind === "rent");
const credit = async (driverId) =>
  Number((await doc("fleetDrivers", driverId)).creditCents) || 0;

describe("billing audit: calendar months (L1)", () => {
  it("a mid-month start pays the full month due that day; then the 1st",
      async () => {
        const d = await newDriver("Mid month");
        await give(d, "2026-10-20");
        const list = await rentOf(d);
        assert.deepEqual([list[0].periodFrom, list[0].periodTo,
          list[0].dueDayKey, list[0].amountCents],
        ["2026-10-20", "2026-10-31", "2026-10-20", 40000]);
        assert.deepEqual([list[1].periodFrom, list[1].periodTo,
          list[1].dueDayKey], ["2026-11-01", "2026-11-30", "2026-11-01"]);
        await functions.fleetDaily.run({});
        await functions.fleetDaily.run({});
        assert.equal((await rentOf(d)).length, list.length,
            "the daily job creates nothing new");
      });

  it("a month billed under the old mid-month periods is not billed again",
      async () => {
        const d = await newDriver("Old periods");
        const carId = await newCar();
        const id = "audit-old-periods";
        await db.collection("fleetAssignments").doc(id).set({businessId: BIZ,
          carId, driverId: d, startDayKey: "2026-09-14", endDayKey: null,
          rentCents: 40000, period: "monthly", dueDay: 1});
        const old = [["2026-09-14", "2026-10-13"], ["2026-10-14", "2026-11-13"],
          ["2026-11-14", "2026-12-13"]];
        for (const [from, to] of old) {
          await db.collection("fleetBills").doc(`${id}_${from}`).set({
            businessId: BIZ, driverId: d, carId, assignmentId: id,
            kind: "rent", periodFrom: from, periodTo: to, dueDayKey: from,
            amountCents: 40000, paidCents: 0, status: "open",
            label: "Plate fee"});
        }
        await functions.fleetDaily.run({});
        await functions.fleetDaily.run({});
        const rent = await rentOf(d);
        assert.ok(!rent.some((b) => ["2026-10-01", "2026-11-01", "2026-12-01"]
            .includes(b.periodFrom)), "no calendar-month bill on top of them");
      });
});

describe("billing audit: undo after a return (L2) and the retry (L5)", () => {
  it("undoing a payment takes back the credit the return created",
      async () => {
        const d = await newDriver("Undo after return");
        const {assignmentId} = await give(d, "2026-09-01");
        const owed = (await rentOf(d)).reduce((s, b) => s + b.amountCents, 0);
        const paid = await act(STAFF, "payment_record", {driverId: d,
          amountCents: owed, method: "zelle"});
        const back = await act(OWNER, "assignment_end", {assignmentId,
          endDayKey: "2026-09-15"});
        const cut = Math.round(40000 * 15 / 30);
        assert.equal(back.creditBackCents, owed - cut);
        assert.equal(await credit(d), owed - cut);
        await act(OWNER, "payment_undo", {paymentId: paid.paymentId});
        assert.equal(await credit(d), 0, "the return's credit is taken back");
        const list = await rentOf(d);
        assert.equal(list.reduce((s, b) => s + b.paidCents, 0), 0);
        assert.equal((await doc("fleetPayments", paid.paymentId))
            .returnCreditTakenCents, owed - cut);
      });

  it("a retried transaction credits the return once", async () => {
    const d = await newDriver("Retry");
    const {assignmentId} = await give(d, "2026-09-01");
    const owed = (await rentOf(d)).reduce((s, b) => s + b.amountCents, 0);
    await act(STAFF, "payment_record", {driverId: d, amountCents: owed,
      method: "zelle"});
    const original = db.runTransaction.bind(db);
    let aborted = false;
    db.runTransaction = (fn, options) => original(async (tx) => {
      const result = await fn(tx);
      if (!aborted) {
        aborted = true;
        const error = new Error("aborted");
        error.code = 10;
        throw error;
      }
      return result;
    }, options);
    let back;
    try {
      back = await act(OWNER, "assignment_end", {assignmentId,
        endDayKey: "2026-09-15"});
    } finally {
      db.runTransaction = original;
    }
    assert.ok(aborted, "the first attempt was thrown away");
    const cut = Math.round(40000 * 15 / 30);
    assert.equal(back.creditBackCents, owed - cut);
    assert.equal(await credit(d), owed - cut);
  });
});

describe("billing audit: late fees of bills that are gone (L3)", () => {
  it("a returned plate voids the unpaid late fees of its voided bills",
      async () => {
        const d = await newDriver("Fees void");
        const {assignmentId} = await give(d, "2026-09-01");
        await functions.fleetDaily.run({});
        assert.ok((await bills(d)).some((b) => b.kind === "late_fee"));
        await act(OWNER, "assignment_end", {assignmentId,
          endDayKey: "2026-09-01"});
        const all = await bills(d);
        const gone = all.filter((b) => b.kind === "rent" &&
          b.status === "void");
        assert.ok(gone.length >= 2);
        for (const rent of gone) {
          const fee = all.find((b) => b.id === `${rent.id}_late`);
          if (!fee) continue;
          assert.equal(fee.status, "void");
          assert.equal(fee.voidReason, "rent_bill_gone");
        }
        assert.equal(all.filter((b) => b.kind === "late_fee" &&
          b.status === "open").length, 1, "only the kept bill's fee is open");
      });

  it("a late fee with money on it goes back to the driver's credit",
      async () => {
        const d = await newDriver("Fees paid");
        const {assignmentId} = await give(d, "2026-09-01");
        await functions.fleetDaily.run({});
        const fees = (await bills(d)).filter((b) => b.kind === "late_fee");
        await act(STAFF, "payment_record", {driverId: d,
          amountCents: fees.length * 2500, method: "cash"});
        await act(OWNER, "assignment_end", {assignmentId,
          endDayKey: "2026-09-01"});
        const all = await bills(d);
        const voided = all.filter((b) => b.kind === "late_fee" &&
          b.status === "void");
        assert.ok(voided.length >= 2);
        assert.ok(voided.every((f) => f.paidCents === 0));
        assert.equal(await credit(d), voided.length * 2500);
      });

  it("a waived rent bill voids its late fee", async () => {
    const d = await newDriver("Fees waive");
    await give(d, "2026-10-01");
    await functions.fleetDaily.run({});
    const all = await bills(d);
    const rent = all.find((b) => b.kind === "rent" &&
      b.periodFrom === "2026-10-01");
    assert.ok(all.some((b) => b.id === `${rent.id}_late` &&
      b.status === "open"));
    await act(OWNER, "bill_waive", {billId: rent.id, reason: "Office"});
    const fee = await doc("fleetBills", `${rent.id}_late`);
    assert.equal(fee.status, "void");
    assert.equal(fee.voidReason, "rent_bill_gone");
  });
});

describe("billing audit: changing the plate fee (L6)", () => {
  it("applies from the next period without a bill; history is kept",
      async () => {
        const d = await newDriver("Fee change");
        const {assignmentId} = await give(d, "2026-09-01");
        // The November bill does not exist yet (and none after it).
        for (const b of await rentOf(d)) {
          if (b.periodFrom >= "2026-11-01") {
            await db.collection("fleetBills").doc(b.id).delete();
          }
        }
        await assert.rejects(act(STAFF, "assignment_update",
            {assignmentId, rentCents: 45000}), refused("fleet_admin_only"));
        await assert.rejects(act(OWNER, "assignment_update", {assignmentId}),
            refused("fleet_bad_input"));
        await assert.rejects(act(OWNER, "assignment_update",
            {assignmentId, rentCents: 0}), refused("fleet_bad_input"));
        const r = await act(OWNER, "assignment_update",
            {assignmentId, rentCents: 45000, dueDay: 5});
        assert.deepEqual(r, {success: true, effectiveDayKey: "2026-11-01"});
        const a = await doc("fleetAssignments", assignmentId);
        assert.equal(a.rentCents, 45000);
        assert.equal(a.dueDay, 5);
        assert.deepEqual(a.rentHistory, [{rentCents: 40000, dueDay: 1,
          fromDayKey: "2026-09-01", toDayKey: "2026-10-31"}]);
        await functions.fleetDaily.run({});
        const list = await rentOf(d);
        const by = (from) => list.find((b) => b.periodFrom === from);
        assert.equal(by("2026-09-01").amountCents, 40000);
        assert.equal(by("2026-10-01").amountCents, 40000);
        assert.equal(by("2026-11-01").amountCents, 45000);
        assert.equal(by("2026-11-01").dueDayKey, "2026-11-05");
        await act(OWNER, "assignment_end", {assignmentId,
          endDayKey: "2026-11-30"});
        await assert.rejects(act(OWNER, "assignment_update",
            {assignmentId, rentCents: 50000}),
        refused("fleet_already_returned"));
      });
});

describe("billing audit: returns, overlaps and leaving (L7)", () => {
  it("a plate cannot be returned twice", async () => {
    const d = await newDriver("Twice");
    const {assignmentId} = await give(d, "2026-10-01");
    await act(OWNER, "assignment_end", {assignmentId,
      endDayKey: "2026-10-10"});
    await assert.rejects(act(OWNER, "assignment_end", {assignmentId,
      endDayKey: "2026-10-12"}), refused("fleet_already_returned"));
    assert.equal((await doc("fleetAssignments", assignmentId)).endDayKey,
        "2026-10-10");
  });

  it("a plate cannot start on or before the last driver's end day",
      async () => {
        const d1 = await newDriver("First owner");
        const d2 = await newDriver("Second owner");
        const {assignmentId, carId} = await give(d1, "2026-10-01");
        await act(OWNER, "assignment_end", {assignmentId,
          endDayKey: "2026-10-10"});
        await assert.rejects(give(d2, "2026-10-10", {carId}),
            refused("fleet_car_overlap"));
        await assert.rejects(give(d2, "2026-10-05", {carId}),
            refused("fleet_car_overlap"));
        await give(d2, "2026-10-11", {carId});
        await assert.rejects(give(d1, "2026-11-01", {carId}),
            refused("fleet_car_taken"));
      });

  it("a driver who leaves gives every plate back; left needs no plate",
      async () => {
        const d = await newDriver("Leaver");
        await give(d, "2026-10-01");
        await give(d, "2026-10-01");
        await assert.rejects(act(STAFF, "driver_save", {driverId: d,
          driver: {name: "Audit Leaver", status: "left"}}),
        refused("fleet_driver_has_plate"));
        assert.equal((await doc("fleetDrivers", d)).status, "active");
        const r = await act(STAFF, "driver_leave",
            {driverId: d, endDayKey: "2026-10-20"});
        assert.deepEqual(r, {success: true, ended: 2});
        assert.equal((await doc("fleetDrivers", d)).status, "left");
        const open = await db.collection("fleetAssignments")
            .where("driverId", "==", d).where("endDayKey", "==", null).get();
        assert.equal(open.size, 0);
        assert.deepEqual(await act(STAFF, "driver_leave",
            {driverId: d, endDayKey: "2026-10-20"}),
        {success: true, ended: 0});
        await assert.rejects(act(STAFF, "driver_leave",
            {driverId: d, endDayKey: "nonsense"}), refused("fleet_bad_input"));
      });

  it("the daily job bills nothing for a driver who left", async () => {
    const d = await newDriver("Left but open");
    const carId = await newCar();
    const id = "audit-left-open";
    await db.collection("fleetAssignments").doc(id).set({businessId: BIZ,
      carId, driverId: d, startDayKey: "2026-09-01", endDayKey: null,
      rentCents: 40000, period: "monthly", dueDay: 1});
    await db.collection("fleetDrivers").doc(d).update({status: "left"});
    await functions.fleetDaily.run({});
    assert.equal((await bills(d)).length, 0);
  });
});

describe("billing audit: one failure does not stop the day (L8)", () => {
  it("the other assignments and the late fees still run", async () => {
    const d = await newDriver("After the bad one");
    const carId = await newCar();
    // Sorts first; its driver id is not a string, so billing it throws.
    await db.collection("fleetAssignments").doc("aaa-audit-bad").set({
      businessId: BIZ, carId, driverId: 12345, startDayKey: "2026-09-01",
      endDayKey: null, rentCents: 40000, period: "monthly", dueDay: 1});
    await db.collection("fleetAssignments").doc("zzz-audit-good").set({
      businessId: BIZ, carId: await newCar(), driverId: d,
      startDayKey: "2026-09-01", endDayKey: null, rentCents: 40000,
      period: "monthly", dueDay: 1});
    await functions.fleetDaily.run({});
    const all = await bills(d);
    assert.ok(all.some((b) => b.kind === "rent" &&
      b.periodFrom === "2026-09-01"), "the good assignment was billed");
    assert.ok(all.some((b) => b.kind === "late_fee"), "late fees ran");
  });
});

describe("billing audit: credit pays every new bill (L9)", () => {
  it("a one-off charge is paid from credit, oldest bill first", async () => {
    const d = await newDriver("Credit charge");
    const first = await act(STAFF, "charge_add", {driverId: d,
      amountCents: 5000, label: "Old", dueDayKey: "2026-10-01"});
    await db.collection("fleetDrivers").doc(d).update({creditCents: 8000});
    const second = await act(STAFF, "charge_add", {driverId: d,
      amountCents: 1000, label: "New", dueDayKey: "2026-11-01"});
    assert.equal((await doc("fleetBills", first.billId)).status, "paid");
    assert.equal((await doc("fleetBills", second.billId)).paidCents, 1000);
    assert.equal(await credit(d), 2000);
  });

  it("a new assignment's first bill is paid from credit", async () => {
    const d = await newDriver("Credit start");
    await db.collection("fleetDrivers").doc(d).update({creditCents: 5000});
    await give(d, "2026-11-01");
    const nov = (await rentOf(d)).find((b) => b.periodFrom === "2026-11-01");
    assert.equal(nov.paidCents, 5000);
    assert.equal(await credit(d), 0);
  });

  it("a late fee is paid from credit before the rent bills", async () => {
    const d = await newDriver("Credit fee");
    await give(d, "2026-10-01");
    await db.collection("fleetDrivers").doc(d).update({creditCents: 3000});
    await functions.fleetDaily.run({});
    const all = await bills(d);
    const fee = all.find((b) => b.kind === "late_fee" &&
      b.lateFeeForBillId.endsWith("_2026-10-01"));
    assert.equal(fee.paidCents, 2500);
    assert.equal(all.reduce((s, b) => s + b.paidCents, 0), 3000);
    assert.equal(await credit(d), 0);
  });
});
