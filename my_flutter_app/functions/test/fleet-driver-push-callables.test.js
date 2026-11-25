"use strict";

// When a Fleet driver gets a push (docs/FLEET.md section 12), against the
// Firestore emulator: beside a receipt and a reminder, once per message,
// and only where the business has WhatsApp on for that driver. WhatsApp and
// the push sender are fakes. Synthetic data only.
//
// Run through `npm run test:fleet` (firebase emulators:exec).

const assert = require("node:assert/strict");
const {before, beforeEach, describe, it} = require("node:test");
const admin = require("firebase-admin");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
      "Run this through `npm run test:fleet` (firebase emulators:exec). " +
      "A direct node --test run would write into the real project.");
}
process.env.FUNCTIONS_EMULATOR = "true";

require("../index");
const {HttpsError} = require("firebase-functions/v2/https");
const {createFleetHandlers} = require("../fleet_handlers");
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const BIZ = "fpush-biz";
// A day no real clock reaches: another test file may run the real reminder
// pass over every fleet business, and its message ids carry the real day.
const TODAY = "2031-03-03";
const P_AWA = "+16465557101";
const P_BEN = "+16465557102";

const sent = [];
const pushes = [];
let pushFails = false;
const silent = {info() {}, warn() {}, error() {}};
const handlers = createFleetHandlers({admin, HttpsError, FieldValue,
  logger: silent, writeAudit: async () => undefined,
  dayKeyNow: () => TODAY,
  sendFleetMessage: async (args) => {
    sent.push(args);
    return "sent";
  },
  pushFleetDriver: async (p) => {
    if (pushFails) throw new Error("push service down");
    pushes.push(p);
    return "pushed";
  }});

const business = (whatsapp) => ({name: "Push Fleet Co",
  phone: "+17185550100", status: "approved", ownerUid: "fpush-owner",
  enabledServices: ["fleet"], fleet: {enabled: true, settings: {
    zelle: {name: "Push Fleet Co", handle: "pay@push.test"}, whatsapp}}});
const setBusiness = (whatsapp) =>
  db.collection("businesses").doc(BIZ).set(business(whatsapp));
const bill = (id, driverId, extra = {}) =>
  db.collection("fleetBills").doc(id).set({businessId: BIZ, driverId,
    carId: "c", assignmentId: `a-${driverId}`, kind: "rent", label: "Rent",
    periodFrom: TODAY, periodTo: "2031-03-31", dueDayKey: TODAY,
    amountCents: 40000, paidCents: 0, status: "open", ...extra});
const payment = (id, driverId, amountCents = 40000) =>
  db.collection("fleetPayments").doc(id).set({businessId: BIZ, driverId,
    amountCents, method: "zelle", paidDayKey: TODAY, status: "recorded"});

before(async () => {
  await setBusiness({enabled: true});
  await db.collection("fleetDrivers").doc("fpush-awa").set({businessId: BIZ,
    name: "Awa Test", phone: P_AWA, status: "active", creditCents: 0});
  await db.collection("fleetDrivers").doc("fpush-ben").set({businessId: BIZ,
    name: "Ben Test", phone: P_BEN, status: "active", creditCents: 0});
  await bill("fpush-bill-awa", "fpush-awa");
  await payment("fpush-pay-1", "fpush-awa", 15000);
  await payment("fpush-pay-2", "fpush-ben");
});

beforeEach(() => {
  sent.length = 0;
  pushes.length = 0;
  pushFails = false;
});

describe("a push beside the receipt", () => {
  it("goes to the driver's phone with what was paid and what is left, " +
      "once", async () => {
    assert.equal(await handlers.sendReceipt(BIZ, "fpush-pay-1"), "sent");
    assert.deepEqual(pushes, [{kind: "receipt", businessId: BIZ,
      businessName: "Push Fleet Co", driverId: "fpush-awa", phone: P_AWA,
      amountCents: 15000, owedCents: 40000, creditCents: 0}]);
    // WhatsApp never sees the push's fields.
    assert.equal(sent[0].push, undefined);
    // The same receipt asked for again: no second push.
    await handlers.sendReceipt(BIZ, "fpush-pay-1");
    assert.equal(pushes.length, 1);
    const row = await db.collection("fleetMessages")
        .doc(sent[0].id).get();
    assert.ok(row.get("pushAtMs") > 0);
  });

  it("never fails the receipt when the push cannot be sent", async () => {
    pushFails = true;
    assert.equal(await handlers.sendReceipt(BIZ, "fpush-pay-2"), "sent");
    assert.deepEqual(pushes, []);
  });

  it("is not sent while the business has driver messages off, or for a " +
      "driver outside its pilot list", async () => {
    await setBusiness({enabled: false});
    assert.equal(await handlers.sendReceipt(BIZ, "fpush-pay-1"), "");
    await setBusiness({enabled: true, onlyDriverIds: ["fpush-ben"]});
    assert.equal(await handlers.sendReceipt(BIZ, "fpush-pay-1"), "");
    assert.deepEqual(pushes, []);
    await setBusiness({enabled: true});
  });
});

describe("a push beside the reminder", () => {
  it("tells the driver whose plate fee is due today, once a day",
      async () => {
        const biz = business({enabled: true});
        await handlers.remindBusiness(BIZ, biz, TODAY);
        const mine = pushes.filter((p) => p.driverId === "fpush-awa");
        assert.deepEqual(mine, [{kind: "reminder", businessId: BIZ,
          businessName: "Push Fleet Co", driverId: "fpush-awa", phone: P_AWA,
          reminder: "today", dueDayKey: TODAY, owedCents: 40000}]);
        // Ben owes nothing: no reminder, no push.
        assert.equal(pushes.some((p) => p.driverId === "fpush-ben"), false);
        assert.equal(sent.every((m) => m.push === undefined), true);
        await handlers.remindBusiness(BIZ, biz, TODAY);
        assert.equal(pushes.filter((p) => p.driverId === "fpush-awa").length,
            1);
      });
});
