"use strict";

// Fleet alerts to admins (docs/FLEET.md section 18) end to end against the
// Firestore emulator: the real fleetAction writes the inbox entries. Who
// hears (owners + fleet_admin, never the one who did it, never plain Fleet
// staff or other areas), new vs edit, the 10-minute grouping and the
// person's own setting. Synthetic data only.
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
admin.auth().getUser = async (uid) => ({
  uid, email: `${uid}@example.test`, emailVerified: true});

const db = admin.firestore();
const BIZ = "fa-biz";
const OWNER = "fa-owner";
const ADMIN = "fa-admin";
const STAFF = "fa-staff";
const PARKING = "fa-parking";
const PLATFORM = "fa-platform";

const run = (name, uid, data) => functions[name].run({
  auth: {uid, token: {}}, data, rawRequest: {}});
const act = (uid, action, data = {}) =>
  run("fleetAction", uid, {action, businessId: BIZ, ...data});

/** The Fleet alerts in a person's inbox, oldest first. */
async function inbox(uid) {
  const snap = await db.collection("users").doc(uid)
      .collection("notifications").get();
  return snap.docs.map((d) => d.data())
      .filter((n) => n.data?.type === "fleet_alert")
      .sort((a, b) => (a.createdAt?.toMillis?.() || 0) -
        (b.createdAt?.toMillis?.() || 0));
}
const kinds = async (uid) => (await inbox(uid)).map((n) => n.data.fleetKind);

before(async () => {
  await Promise.all([
    db.collection("businesses").doc(BIZ).set({
      name: "Alert Test Fleet", status: "approved", ownerUid: OWNER,
      enabledServices: ["barrelShipping"],
    }),
    db.collection("users").doc(OWNER).set({role: "businessOwner",
      businessId: BIZ, fullName: "Owner Person", language: "en"}),
    db.collection("users").doc(ADMIN).set({role: "staff", businessId: BIZ,
      businessPermissions: ["fleet_admin"], fullName: "Admin Person",
      language: "fr"}),
    db.collection("users").doc(STAFF).set({role: "staff", businessId: BIZ,
      businessPermissions: ["fleet"], fullName: "Staff Person"}),
    db.collection("users").doc(PARKING).set({role: "staff", businessId: BIZ,
      businessPermissions: ["parking"], fullName: "Parking Person"}),
    db.collection("users").doc(PLATFORM).set({role: "admin",
      adminRole: "superAdmin", fullName: "Platform"}),
  ]);
  await act(PLATFORM, "fleet_enable", {enabled: true});
});

describe("Fleet alerts to admins", () => {
  let carId = "";

  it("a new plate tells the owner and Fleet admins, never the one who saved it", async () => {
    carId = (await act(STAFF, "car_save", {car: {plate: "t900001c",
      company: "Alert Base"}})).carId;
    assert.deepEqual(await kinds(OWNER), ["plate_added"]);
    assert.deepEqual(await kinds(ADMIN), ["plate_added"]);
    assert.deepEqual(await kinds(STAFF), [], "plain Fleet staff: not an admin");
    assert.deepEqual(await kinds(PARKING), [], "another area hears nothing");
    const [toOwner] = await inbox(OWNER);
    assert.equal(toOwner.data.fleetTab, "plates");
    assert.equal(toOwner.data.carId, carId);
    assert.match(toOwner.body, /T900001C/);
    const [toAdmin] = await inbox(ADMIN);
    assert.match(toAdmin.title, /Plaque/, "each person in their own language");
  });

  it("an edit says nothing", async () => {
    await act(STAFF, "car_save", {carId, car: {plate: "T900001C",
      company: "Alert Base LLC"}});
    assert.deepEqual(await kinds(OWNER), ["plate_added"]);
  });

  it("the owner adding a driver tells the admin, not the owner", async () => {
    await act(OWNER, "driver_save", {driver: {name: "Alert Driver One",
      phone: "2125550199"}});
    assert.deepEqual(await kinds(OWNER), ["plate_added"]);
    assert.deepEqual(await kinds(ADMIN), ["plate_added", "driver_added"]);
  });

  it("a second plate within 10 minutes waits for the summary", async () => {
    await act(STAFF, "car_save", {car: {plate: "t900002c",
      company: "Alert Base"}});
    assert.deepEqual(await kinds(OWNER), ["plate_added"],
        "grouped: no second push at once");
  });

  it("Off silences everything for that person only", async () => {
    await db.collection("users").doc(ADMIN).set(
        {notificationPreferences: {fleetAlerts: "off"}}, {merge: true});
    await act(OWNER, "driver_save", {driver: {name: "Alert Driver Two",
      phone: "2125550198"}});
    assert.deepEqual(await kinds(ADMIN), ["plate_added", "driver_added"],
        "nothing new while Off");
  });

  it("Only what needs me drops routine alerts", async () => {
    await db.collection("users").doc(OWNER).set(
        {notificationPreferences: {fleetAlerts: "needs"}}, {merge: true});
    await act(ADMIN, "driver_save", {driver: {name: "Alert Driver Three",
      phone: "2125550197"}});
    assert.deepEqual(await kinds(OWNER), ["plate_added"]);
  });
});
