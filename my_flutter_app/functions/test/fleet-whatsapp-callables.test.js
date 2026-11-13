"use strict";

// Fleet drivers on WhatsApp (docs/FLEET.md §9) against the Firestore
// emulator: off by default, a Fleet admin switches it on and sends a test,
// a recorded payment gets one receipt, reminders go to the drivers whose
// oldest bill is due and never twice a day. WhatsApp itself is not
// connected here, so a send is recorded as failed: the rows prove who
// would get what. Synthetic data only.
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
const {HttpsError} = require("firebase-functions/v2/https");
const {createFleetHandlers} = require("../fleet_handlers");
admin.auth().getUser = async (uid) => ({
  uid, email: `${uid}@example.test`, emailVerified: true});
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const BIZ = "fleetwa-biz";
const OWNER = "fleetwa-owner";
const STAFF = "fleetwa-staff";

const run = (name, uid, data) => functions[name].run({
  auth: {uid, token: {}}, data, rawRequest: {}});
const act = (uid, action, data = {}) =>
  run("fleetAction", uid, {action, businessId: BIZ, ...data});
const refused = (reason) => (error) => error.details?.reason === reason;
const rows = async (where) => (await db.collection("fleetMessages")
    .where("businessId", "==", BIZ).get()).docs
    .map((d) => ({id: d.id, ...d.data()})).filter(where || (() => true));

// remindBusiness with a recording sender (the real one is in index.js).
const sent = [];
const silent = {info() {}, warn() {}, error() {}};
const handlers = createFleetHandlers({admin, HttpsError, FieldValue,
  logger: silent, writeAudit: async () => undefined,
  dayKeyNow: () => "2026-12-01",
  sendFleetMessage: async (args) => {
    sent.push(args);
    return "sent";
  }});

before(async () => {
  await Promise.all([
    db.collection("businesses").doc(BIZ).set({name: "WA Fleet Co",
      phone: "+17185550100", status: "approved", ownerUid: OWNER,
      enabledServices: ["fleet"], fleet: {enabled: true, settings: {
        zelle: {name: "WA Fleet Co", handle: "718-555-0100"}}}}),
    db.collection("users").doc(OWNER).set({role: "businessOwner",
      businessId: BIZ, fullName: "Owner"}),
    db.collection("users").doc(STAFF).set({role: "staff", businessId: BIZ,
      businessPermissions: ["fleet"], fullName: "Fleet Staff"}),
    db.collection("fleetDrivers").doc("wa-d1").set({businessId: BIZ,
      name: "Due Today", phone: "+16465550001", status: "active",
      personalCents: 17, creditCents: 0, rememberedSenders: []}),
    db.collection("fleetDrivers").doc("wa-d2").set({businessId: BIZ,
      name: "Late Driver", phone: "+16465550002", status: "active",
      personalCents: 42, creditCents: 0, rememberedSenders: []}),
    db.collection("fleetDrivers").doc("wa-d3").set({businessId: BIZ,
      name: "Paid Up", phone: "+16465550003", status: "active",
      personalCents: 5, creditCents: 0, rememberedSenders: []}),
    db.collection("fleetDrivers").doc("wa-d4").set({businessId: BIZ,
      name: "No Phone", phone: "", status: "active",
      personalCents: 6, creditCents: 0, rememberedSenders: []}),
    db.collection("fleetBills").doc("wa-b1").set({businessId: BIZ,
      driverId: "wa-d1", kind: "rent", label: "Rent", dueDayKey: "2026-12-01",
      amountCents: 35000, paidCents: 0, status: "open"}),
    db.collection("fleetBills").doc("wa-b2").set({businessId: BIZ,
      driverId: "wa-d2", kind: "rent", label: "Rent", dueDayKey: "2026-11-28",
      amountCents: 35000, paidCents: 0, status: "open"}),
    db.collection("fleetBills").doc("wa-b4").set({businessId: BIZ,
      driverId: "wa-d4", kind: "rent", label: "Rent", dueDayKey: "2026-12-01",
      amountCents: 35000, paidCents: 0, status: "open"}),
  ]);
});

describe("drivers on WhatsApp", () => {
  it("is off by default: a payment sends nothing", async () => {
    await act(STAFF, "payment_record", {driverId: "wa-d3",
      amountCents: 10000, method: "cash"});
    assert.deepEqual(await rows(), []);
  });

  it("a Fleet admin switches it on and sends a test; staff cannot",
      async () => {
        await assert.rejects(act(STAFF, "whatsapp_save", {enabled: true}),
            refused("fleet_admin_only"));
        await assert.rejects(act(OWNER, "whatsapp_test", {phone: "123"}),
            refused("fleet_bad_phone"));
        const test = await act(OWNER, "whatsapp_test",
            {phone: "+1 (646) 555-0999"});
        assert.ok(["sent", "failed"].includes(test.receipt));
        const tests = await rows((r) => r.kind === "test");
        assert.deepEqual(tests.map((r) => r.test).sort(),
            ["receipt", "reminder"]);
        assert.equal(tests[0].phone, "+1 (646) 555-0999");
        await act(OWNER, "whatsapp_save", {enabled: true});
        const b = (await db.collection("businesses").doc(BIZ).get()).data();
        assert.equal(b.fleet.settings.whatsapp.enabled, true);
      });

  it("then each recorded payment gets one receipt", async () => {
    const paid = await act(STAFF, "payment_record", {driverId: "wa-d3",
      amountCents: 5000, method: "cash"});
    const receipts = await rows((r) => r.kind === "receipt");
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].id, `receipt_${paid.paymentId}`);
    assert.equal(receipts[0].driverId, "wa-d3");
    assert.equal(receipts[0].template, "fleet_receipt_2lang");
  });

  it("reminders: due today and 3 days late get one, paid up and no phone " +
      "do not get a message", async () => {
    const business = (await db.collection("businesses").doc(BIZ).get())
        .data();
    sent.length = 0;
    await handlers.remindBusiness(BIZ, business, "2026-12-01");
    const byDriver = Object.fromEntries(sent.map((s) =>
      [s.row.driverId, s]));
    assert.deepEqual(Object.keys(byDriver).sort(),
        ["wa-d1", "wa-d2", "wa-d4"]);
    assert.equal(byDriver["wa-d1"].row.reminder, "today");
    assert.equal(byDriver["wa-d2"].row.reminder, "late");
    assert.equal(byDriver["wa-d4"].reachable, false, "no phone: skipped");
    const params = byDriver["wa-d1"].body.template.components[0].parameters
        .map((p) => p.text);
    assert.equal(params[2], "is due today");
    assert.equal(params[5], "$350.17", "send exactly, with the cents");
    assert.equal(params[4], "WA Fleet Co (718-555-0100)");
    assert.equal(byDriver["wa-d1"].id,
        "reminder_wa-d1_wa-b1_2026-12-01");
  });

  it("only these drivers: a test or a pilot reaches nobody else",
      async () => {
        await assert.rejects(act(OWNER, "whatsapp_save",
            {enabled: true, onlyDriverIds: ["not-a-driver"]}),
        refused("fleet_not_found"));
        await assert.rejects(act(OWNER, "whatsapp_save",
            {enabled: true, onlyDriverIds: "wa-d1"}),
        refused("fleet_bad_input"));
        const saved = await act(OWNER, "whatsapp_save",
            {enabled: true, onlyDriverIds: ["wa-d1", "wa-d1"]});
        assert.deepEqual(saved.onlyDriverIds, ["wa-d1"]);

        let business = (await db.collection("businesses").doc(BIZ).get())
            .data();
        sent.length = 0;
        await handlers.remindBusiness(BIZ, business, "2026-12-01");
        assert.deepEqual(sent.map((s) => s.row.driverId), ["wa-d1"]);

        // A payment by a driver who is not on the list: no receipt.
        const before = (await rows((r) => r.kind === "receipt")).length;
        await act(STAFF, "payment_record", {driverId: "wa-d3",
          amountCents: 1000, method: "cash"});
        assert.equal((await rows((r) => r.kind === "receipt")).length,
            before);

        // Saving without the list keeps it; an empty list means everyone.
        await act(OWNER, "whatsapp_save", {enabled: true});
        business = (await db.collection("businesses").doc(BIZ).get()).data();
        assert.deepEqual(business.fleet.settings.whatsapp.onlyDriverIds,
            ["wa-d1"]);
        await act(OWNER, "whatsapp_save", {enabled: true, onlyDriverIds: []});
        business = (await db.collection("businesses").doc(BIZ).get()).data();
        sent.length = 0;
        await handlers.remindBusiness(BIZ, business, "2026-12-01");
        assert.deepEqual(sent.map((s) => s.row.driverId).sort(),
            ["wa-d1", "wa-d2", "wa-d4"]);
      });

  it("a reminder from the driver's page: once a day, only when owed",
      async () => {
        // Through the real callable: WhatsApp is not connected here, so the
        // row is written and marked failed, which proves it was tried.
        const first = await act(STAFF, "whatsapp_remind_driver",
            {driverId: "wa-d2"});
        assert.ok(["sent", "failed"].includes(first.status));
        const again = await act(STAFF, "whatsapp_remind_driver",
            {driverId: "wa-d2"});
        assert.equal(again.status, "", "not twice on the same day");
        const manual = await rows((r) => r.manual === true);
        assert.equal(manual.length, 1);
        assert.equal(manual[0].driverId, "wa-d2");
        // The callable uses the real clock: wa-b2 is due 2026-11-28.
        const today = new Intl.DateTimeFormat("en-CA",
            {timeZone: "America/New_York"}).format(new Date());
        assert.equal(manual[0].reminder, today < "2026-11-28" ? "soon" :
          today === "2026-11-28" ? "today" : "late");
        assert.equal(manual[0].byUid, STAFF);
        assert.match(manual[0].id, /^reminder_manual_wa-d2_wa-b2_/);

        await assert.rejects(act(STAFF, "whatsapp_remind_driver",
            {driverId: "wa-d3"}), refused("fleet_nothing_owed"));
        await assert.rejects(act(STAFF, "whatsapp_remind_driver",
            {driverId: "wa-d4"}), refused("fleet_no_phone"));
        await act(OWNER, "whatsapp_save",
            {enabled: true, onlyDriverIds: ["wa-d1"]});
        await assert.rejects(act(STAFF, "whatsapp_remind_driver",
            {driverId: "wa-d2"}), refused("fleet_whatsapp_off"));
        await act(OWNER, "whatsapp_save", {enabled: false, onlyDriverIds: []});
        await assert.rejects(act(STAFF, "whatsapp_remind_driver",
            {driverId: "wa-d1"}), refused("fleet_whatsapp_off"));
      });
});
