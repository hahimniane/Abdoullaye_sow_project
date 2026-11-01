"use strict";

// A team member's own car (docs/PARKING_TEAM_CARS.md) end to end against the
// Firestore emulator: picked from the team, tied by a linked number, untied
// and re-tied by an edit, every change in the car's History; never someone
// outside the team.
//
// Run through `npm run test:parking-team` (firebase emulators:exec).

const assert = require("node:assert/strict");
const {before, describe, it} = require("node:test");
const admin = require("firebase-admin");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
      "Run this through `npm run test:parking-team` (firebase " +
      "emulators:exec). A direct node --test run would write its fixtures " +
      "into the real project.");
}
process.env.FUNCTIONS_EMULATOR = "true";

const functions = require("../index");
admin.auth().getUser = async (uid) => ({
  uid, email: `${uid}@example.test`, emailVerified: true});
const db = admin.firestore();

const BIZ = "pkteam-lot";
const OWNER = "pkteam-owner";
const ABD = "pkteam-abd";
const MUSA = "pkteam-musa";
const PACKAGES_ONLY = "pkteam-packages";
const OUTSIDER = "pkteam-outsider";

const run = (name, uid, data) => functions[name].run({
  auth: {uid, token: {}}, data, rawRequest: {}});
const car = async (id) => (await db.collection("parkedCars").doc(id).get())
    .data();
const day = (offset) => new Date(Date.now() + offset * 86400000)
    .toISOString().slice(0, 10);
const entry = (extra) => ({businessId: BIZ, paymentMethod: "direct",
  carMake: "Toyota", carModel: "Camry", carYear: "2015",
  startDate: day(1), endDate: day(3), ...extra});
const history = async (id) => (await db.collection("lotLedgerAudit")
    .where("entityId", "==", id).get()).docs.map((d) => d.data().summary);

before(async () => {
  await Promise.all([
    db.collection("businesses").doc(BIZ).set({
      name: "Team Lot", status: "approved", ownerUid: OWNER,
      country: "United States", enabledServices: ["carParking"],
      parkingTotalSpaces: 20, parkingDailyRate: 10,
      staffParkingLinks: {[ABD]: {customerKey: "phone:3475628973",
        customerName: "Abdoulaye Sow", customerPhone: "+13475628973"}},
    }),
    db.collection("users").doc(OWNER).set({role: "businessOwner",
      businessId: BIZ, fullName: "Alhoussaine Barry"}),
    db.collection("users").doc(ABD).set({role: "staff", businessId: BIZ,
      businessPermissions: ["parking"], fullName: "Abdoulaye Sow"}),
    db.collection("users").doc(MUSA).set({role: "staff", businessId: BIZ,
      businessPermissions: ["parking"], fullName: "Musa Kante"}),
    db.collection("users").doc(PACKAGES_ONLY).set({role: "staff",
      businessId: BIZ, businessPermissions: ["barrels"],
      fullName: "Fanta Camara"}),
    db.collection("users").doc(OUTSIDER).set({role: "staff",
      businessId: "another-lot", businessPermissions: ["parking"],
      fullName: "Someone Else"}),
  ]);
});

describe("whose car: a team member", () => {
  it("a picked member with a link: named and numbered from the link",
      async () => {
        const made = await run("createBusinessParkingEntry", MUSA,
            entry({forStaffId: ABD}));
        const c = await car(made.entryId || made.id);
        assert.equal(c.forStaffId, ABD);
        assert.equal(c.forStaffName, "Abdoulaye Sow");
        assert.equal(c.customerName, "Abdoulaye Sow");
        assert.equal(c.customerPhone, "+13475628973");
      });

  it("a picked member with no link and no phone: their name, no number",
      async () => {
        const made = await run("createBusinessParkingEntry", ABD,
            entry({forStaffId: MUSA}));
        const c = await car(made.entryId || made.id);
        assert.equal(c.forStaffId, MUSA);
        assert.equal(c.customerName, "Musa Kante");
        assert.equal(c.customerPhone, "");
      });

  it("anyone on the team can be picked, the owner and package-only staff too",
      async () => {
        for (const who of [OWNER, PACKAGES_ONLY]) {
          const made = await run("createBusinessParkingEntry", ABD,
              entry({forStaffId: who}));
          assert.equal((await car(made.entryId || made.id)).forStaffId, who);
        }
      });

  it("never someone outside the team", async () => {
    await assert.rejects(run("createBusinessParkingEntry", ABD,
        entry({forStaffId: OUTSIDER})), (error) =>
      error.details?.reason === "team_member_invalid");
    await assert.rejects(run("createBusinessParkingEntry", ABD,
        entry({forStaffId: "nobody"})), (error) =>
      error.details?.reason === "team_member_invalid");
  });

  it("a number the owner linked ties the car, however it was typed",
      async () => {
        const made = await run("createBusinessParkingEntry", MUSA,
            entry({customerName: "Abdoulaye", customerPhone: "347 562 8973"}));
        const c = await car(made.entryId || made.id);
        assert.equal(c.forStaffId, ABD);
        assert.equal(c.customerPhone, "347 562 8973", "what was typed stays");
        const other = await run("createBusinessParkingEntry", MUSA,
            entry({customerName: "Fatou", customerPhone: "+12015550101"}));
        assert.equal((await car(other.entryId || other.id)).forStaffId,
            undefined);
      });
});

describe("changing whose car it is", () => {
  it("untie, re-tie and switch member; each change in History", async () => {
    const made = await run("createBusinessParkingEntry", MUSA,
        entry({customerName: "Fatou Ba", customerPhone: "+12015550102"}));
    const id = made.entryId || made.id;
    await run("updateBusinessParkingEntry", MUSA,
        {entryId: id, changes: {forStaffId: MUSA}});
    let c = await car(id);
    assert.equal(c.forStaffId, MUSA);
    assert.equal(c.customerName, "Musa Kante");
    await run("updateBusinessParkingEntry", MUSA, {entryId: id,
      changes: {forStaffId: "", customerName: "Fatou Ba",
        customerPhone: "+12015550102"}});
    c = await car(id);
    assert.equal(c.forStaffId, undefined);
    assert.equal(c.customerName, "Fatou Ba");
    const lines = await history(id);
    assert.ok(lines.some((l) => /Team member: — → Musa Kante/.test(l)),
        JSON.stringify(lines));
    assert.ok(lines.some((l) => /Team member: Musa Kante → —/.test(l)),
        JSON.stringify(lines));
  });

  it("an untied customer car needs its name and number back", async () => {
    const made = await run("createBusinessParkingEntry", ABD,
        entry({forStaffId: MUSA}));
    await assert.rejects(run("updateBusinessParkingEntry", ABD,
        {entryId: made.entryId || made.id, changes: {forStaffId: ""}}),
    (error) => error.code === "invalid-argument");
  });
});
