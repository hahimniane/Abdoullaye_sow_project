"use strict";

// The driver's own view (docs/FLEET.md section 11) against the Firestore
// emulator: `fleetAction {action: "driver_home"}` answers from the caller's
// verified phone and never with anyone else's records. Synthetic data only.
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
// An account's phone, when the token carries none, is the auth record's.
const authPhones = new Map();
admin.auth().getUser = async (uid) => ({uid, email: `${uid}@example.test`,
  emailVerified: true, phoneNumber: authPhones.get(uid)});
const db = admin.firestore();

const BIZ = "fdrv-biz";
const BIZ2 = "fdrv-biz-two";
const BIZ_OFF = "fdrv-biz-off";
const P_AWA = "+16465558101";
const P_BEN = "+16465558102";
const P_LEFT = "+16465558103";
const P_CREDIT = "+16465558104";
const P_NOBODY = "+16465558199";

const home = (uid, token = {}) => functions.fleetAction.run({
  auth: {uid, token}, data: {action: "driver_home"}, rawRequest: {}});
const asPhone = (phone) => home(`uid-${phone}`, {phone_number: phone});

const fleetBusiness = (id, name, settings = {}, enabled = true) =>
  db.collection("businesses").doc(id).set({name, phone: "+16465550100",
    ownerUid: `${id}-owner`, enabledServices: ["fleet"],
    fleet: {enabled, settings: {zelle: {name: `${name} LLC`,
      handle: `pay@${id}.test`}, ...settings}}});
const driver = (id, businessId, name, phone, extra = {}) =>
  db.collection("fleetDrivers").doc(id).set({businessId, name, phone,
    status: "active", creditCents: 0, notes: "OFFICE-ONLY-NOTE",
    rememberedSenders: ["PAYER-NAME-KEPT"], ...extra});
const bill = (id, businessId, driverId, extra = {}) =>
  db.collection("fleetBills").doc(id).set({businessId, driverId,
    carId: "fdrv-car", assignmentId: "fdrv-a", kind: "rent", label: "Rent",
    periodFrom: "2026-12-01", periodTo: "2026-12-31",
    dueDayKey: "2026-12-01", amountCents: 40000, paidCents: 0,
    status: "open", ...extra});

before(async () => {
  await fleetBusiness(BIZ, "Driver Fleet Co");
  await fleetBusiness(BIZ2, "Second Fleet Co",
      {driversSeeOnlyThisBusiness: false});
  await fleetBusiness(BIZ_OFF, "Off Fleet Co", {}, false);

  await driver("fdrv-awa", BIZ, "Awa Test #12", P_AWA);
  // Credit sits on a driver with nothing to pay: another test file runs the
  // real daily job over every fleet business, and it spends a driver's
  // credit on their open bills.
  await driver("fdrv-credit", BIZ, "Credit Test", P_CREDIT,
      {creditCents: 1500});
  await driver("fdrv-ben", BIZ, "Ben Test", P_BEN);
  await driver("fdrv-left", BIZ, "Gone Test", P_LEFT, {status: "left"});
  // The same phone drives for a second fleet, and for one that is off.
  await driver("fdrv-awa-2", BIZ2, "Awa Test", P_AWA);
  await driver("fdrv-awa-off", BIZ_OFF, "Awa Test", P_AWA);

  await db.collection("fleetCars").doc("fdrv-car").set({businessId: BIZ,
    plate: "T200000C", vehicleType: "Camry", ownership: "driver",
    registrationExpiry: "2027-03-01", diamondExpiry: "2026-12-20",
    insurer: "Hereford", policyNumber: "P-9", vin: "SECRETVIN"});
  await db.collection("fleetAssignments").doc("fdrv-a").set({
    businessId: BIZ, carId: "fdrv-car", driverId: "fdrv-awa",
    startDayKey: "2026-01-10", endDayKey: null, rentCents: 40000,
    // Nothing is owed before this day, so the daily job (run by another
    // test file over every fleet business) never bills this plate.
    billFromDayKey: "2099-01-01", period: "monthly", dueDay: 1});
  await db.collection("fleetAssignments").doc("fdrv-a-old").set({
    businessId: BIZ, carId: "fdrv-car", driverId: "fdrv-awa",
    startDayKey: "2025-01-10", endDayKey: "2025-06-01", rentCents: 35000,
    period: "monthly", dueDay: 1});

  await bill("fdrv-b-open", BIZ, "fdrv-awa");
  await bill("fdrv-b-paid", BIZ, "fdrv-awa", {status: "paid",
    paidCents: 40000, dueDayKey: "2026-11-01", periodFrom: "2026-11-01"});
  await bill("fdrv-b-void", BIZ, "fdrv-awa", {status: "void",
    voidReason: "billed_by_mistake", dueDayKey: "2026-10-01"});
  await bill("fdrv-b-ben", BIZ, "fdrv-ben", {amountCents: 77700});
  // A stray record of another business under Awa's driver id is not hers.
  await bill("fdrv-b-stray", BIZ2, "fdrv-awa", {amountCents: 99900});

  await db.collection("fleetPayments").doc("fdrv-p1").set({businessId: BIZ,
    driverId: "fdrv-awa", amountCents: 40000, method: "zelle",
    paidDayKey: "2026-11-02", status: "recorded", note: "OFFICE-PAY-NOTE",
    receivedByUid: "staff-uid", bankTxnId: "BANK-TXN"});
  await db.collection("fleetPayments").doc("fdrv-p-undone").set({
    businessId: BIZ, driverId: "fdrv-awa", amountCents: 12300,
    method: "cash", paidDayKey: "2026-11-05", status: "undone"});
  await db.collection("fleetPayments").doc("fdrv-p-ben").set({
    businessId: BIZ, driverId: "fdrv-ben", amountCents: 55500,
    method: "cash", paidDayKey: "2026-11-05", status: "recorded"});
  await db.collection("fleetClaims").doc("fdrv-c1").set({businessId: BIZ,
    driverId: "fdrv-awa", fromPhone: P_AWA, state: "waiting_bank",
    amountCents: 40000, open: true, createdAtMs: 1000,
    mediaPath: "support_cases/x/whatsapp/p.jpg", payerName: "PAYER-X"});
  // The daily job has run: what follows holds after it, not only before.
  await functions.fleetDaily.run({});
});

describe("driver_home", () => {
  it("answers a driver with their own bills, payments, plate and where " +
      "to pay", async () => {
    const out = await asPhone(P_AWA);
    assert.equal(out.success, true);
    assert.match(out.todayKey, /^\d{4}-\d\d-\d\d$/);
    assert.match(out.proofWhatsApp, /^\+\d{8,15}$/);
    const mine = out.fleets.find((f) => f.businessId === BIZ);
    assert.equal(mine.businessName, "Driver Fleet Co");
    assert.deepEqual(mine.zelle, {name: "Driver Fleet Co LLC",
      handle: `pay@${BIZ}.test`});
    // This fleet business does not ship packages.
    assert.deepEqual(mine.shipping, {enabled: false, sendSlug: ""});
    assert.equal(mine.driver.name, "Awa Test");
    assert.equal(mine.driver.creditCents, 0);
    assert.deepEqual(mine.bills.map((b) => b.id),
        ["fdrv-b-open", "fdrv-b-paid"]);
    assert.equal(mine.balance.owedCents, 40000);
    assert.deepEqual(mine.payments.map((p) => p.id), ["fdrv-p1"]);
    assert.deepEqual(mine.plates.map((p) => [p.plate, p.rentCents,
      p.diamondExpiry]), [["T200000C", 40000, "2026-12-20"]]);
    assert.deepEqual(mine.claims, [{id: "fdrv-c1", amountCents: 40000,
      state: "checking", createdAtMs: 1000}]);
  });

  it("says the credit a driver holds", async () => {
    const out = await asPhone(P_CREDIT);
    assert.equal(out.fleets.length, 1);
    assert.equal(out.fleets[0].driver.creditCents, 1500);
    assert.equal(out.fleets[0].balance.owedCents, 0);
    assert.deepEqual(out.fleets[0].bills, []);
  });

  it("never carries another driver's records or the office's own notes",
      async () => {
        const flat = JSON.stringify(await asPhone(P_AWA));
        for (const secret of ["fdrv-b-ben", "fdrv-p-ben", "77700", "55500",
          "Ben Test", P_BEN, "OFFICE-ONLY-NOTE", "PAYER-NAME-KEPT",
          "OFFICE-PAY-NOTE", "staff-uid", "BANK-TXN", "SECRETVIN",
          "support_cases", "PAYER-X", "P-9", "policyNumber", "fdrv-b-void",
          "fdrv-b-stray",
          "99900", "fdrv-p-undone"]) {
          assert.equal(flat.includes(secret), false, secret);
        }
      });

  it("lists every fleet the phone drives for, never one that is switched " +
      "off, and says when one of them is Fleet-only", async () => {
    const out = await asPhone(P_AWA);
    assert.deepEqual(out.fleets.map((f) => [f.businessId, f.onlyFleet]),
        [[BIZ, true], [BIZ2, false]]);
    assert.equal(out.onlyFleet, true);
  });

  it("offers the fleet business's own shipping when it has one", async () => {
    await db.collection("businesses").doc(BIZ2).set({status: "approved",
      enabledServices: ["fleet", "barrelShipping"],
      requestSlug: "second-fleet", packageRequestSettings:
        {acceptRequests: true}}, {merge: true});
    const out = await asPhone(P_AWA);
    assert.deepEqual(out.fleets.find((f) => f.businessId === BIZ2).shipping,
        {enabled: true, sendSlug: "second-fleet"});
  });

  it("reads the phone from the account when the token has none",
      async () => {
        authPhones.set("fdrv-uid-ben", P_BEN);
        const out = await home("fdrv-uid-ben");
        assert.deepEqual(out.fleets.map((f) => f.driver.name), ["Ben Test"]);
        assert.equal(out.fleets[0].balance.owedCents, 77700);
      });

  it("answers an empty list, never a refusal, to anyone who is not a " +
      "driver", async () => {
    const empty = {fleets: [], onlyFleet: false};
    const pick = (o) => ({fleets: o.fleets, onlyFleet: o.onlyFleet});
    // A phone on no driver.
    assert.deepEqual(pick(await asPhone(P_NOBODY)), empty);
    // An account with no verified phone at all.
    assert.deepEqual(pick(await home("fdrv-uid-email-only")), empty);
    // A visitor who has not signed in properly.
    assert.deepEqual(pick(await home("fdrv-uid-anon",
        {firebase: {sign_in_provider: "anonymous"}})), empty);
    // A driver who left, owes nothing and holds no plate.
    assert.deepEqual(pick(await asPhone(P_LEFT)), empty);
  });

  it("keeps showing a driver who left while they still owe", async () => {
    await bill("fdrv-b-left", BIZ, "fdrv-left", {amountCents: 12500});
    const out = await asPhone(P_LEFT);
    assert.equal(out.fleets.length, 1);
    assert.equal(out.fleets[0].driver.status, "left");
    assert.equal(out.fleets[0].balance.owedCents, 12500);
    await db.collection("fleetBills").doc("fdrv-b-left").delete();
  });

  it("refuses a caller who is not signed in at all", async () => {
    await assert.rejects(functions.fleetAction.run({auth: null,
      data: {action: "driver_home"}, rawRequest: {}}),
    (error) => error.code === "unauthenticated");
  });
});
