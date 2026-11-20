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
    assert.equal(params[5], "$350.00", "the plain amount owed, no cents code");
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
        // Once SENT it is final (a failed one is retried, see M1 below).
        const sentRow = (await rows((r) => r.manual === true))[0];
        await db.collection("fleetMessages").doc(sentRow.id)
            .update({status: "sent"});
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

describe("a late reminder waits while the driver's report is open", () => {
  it("only the late reminder is paused (Q8)", async () => {
    const business = (await db.collection("businesses").doc(BIZ).get())
        .data();
    await act(OWNER, "whatsapp_save", {enabled: true, onlyDriverIds: []});
    await db.collection("fleetClaims").doc("wa-claim").set({businessId: BIZ,
      driverId: "wa-d2", state: "waiting_bank", open: true,
      amountCents: 35000, fromPhone: "+16465550002"});
    sent.length = 0;
    await handlers.remindBusiness(BIZ, business, "2026-12-01");
    assert.deepEqual(sent.map((s) => s.row.driverId).sort(),
        ["wa-d1", "wa-d4"], "wa-d2 is late and has an open report");
    // An office-state report does not pause it.
    await db.collection("fleetClaims").doc("wa-claim").update(
        {state: "office"});
    sent.length = 0;
    await handlers.remindBusiness(BIZ, business, "2026-12-08");
    assert.deepEqual(sent.map((s) => [s.row.driverId, s.row.reminder]),
        [["wa-d2", "late"]], "a report in the office does not pause it");
    await db.collection("fleetClaims").doc("wa-claim").delete();
  });
});

// ---- defects M1 to M7 (fleet-messages) ----------------------------------

const BIZ2 = "fleetwa2-biz";
const BIZ3 = "fleetwa3-biz";
const BIZ4 = "fleetwa4-biz";
const OWNER3 = "fleetwa3-owner";
const STAFF3 = "fleetwa3-staff";
const TODAY = "2026-12-01";
// 10:30 AM New York on TODAY (EST is UTC-5).
const TICK_MS = Date.UTC(2026, 11, 1, 15, 30);

const params = (s) => s.body.template.components[0].parameters
    .map((p) => p.text);

// The 15-minute job sees only the business under test (other test files
// share this emulator): `businesses` is narrowed to one document.
const handlersFor = (businessId, send, logger = silent) => {
  const real = admin.firestore();
  const scoped = new Proxy(real, {get(target, key) {
    if (key === "collection") {
      return (name) => name === "businesses" ?
        ({doc: (id) => real.collection("businesses").doc(id),
          where: () => ({get: async () =>
            ({docs: [await real.collection("businesses").doc(businessId)
                .get()]})})}) :
        target.collection(name);
    }
    const value = target[key];
    return typeof value === "function" ? value.bind(target) : value;
  }});
  return createFleetHandlers({admin: {firestore: () => scoped},
    HttpsError, FieldValue, logger, writeAudit: async () => undefined,
    dayKeyNow: () => TODAY, sendFleetMessage: send});
};

const business = (name, handle, extra = {}) => ({name, phone: "+17185550100",
  status: "approved", ownerUid: "x", enabledServices: ["fleet"],
  fleet: {enabled: true, settings: {whatsapp: {enabled: true},
    ...(handle ? {zelle: {name, handle}} : {})}, ...extra}});
const driver = (businessId, name, extra = {}) => ({businessId, name,
  phone: "+16465550123", status: "active", creditCents: 0,
  rememberedSenders: [], ...extra});
const bill = (businessId, driverId, extra) => ({businessId, driverId,
  kind: "rent", label: "Plate fee", dueDayKey: TODAY, amountCents: 35000,
  paidCents: 0, status: "open", ...extra});
const monthly = (businessId, driverId, extra = {}) => ({businessId, driverId,
  carId: "c", period: "monthly", dueDay: 3, rentCents: 35000,
  startDayKey: "2026-10-01", ...extra});
const paidBill = (businessId, assignmentId, driverId, from) => ({
  businessId, driverId, assignmentId, kind: "rent", status: "paid",
  periodFrom: from, periodTo: from.slice(0, 8) + "28", amountCents: 35000,
  paidCents: 35000, dueDayKey: from.slice(0, 8) + "03"});

describe("M2 to M7: who is reminded, about what, for how much", () => {
  before(async () => {
    const set = (col, id, data) => db.collection(col).doc(id).set(data);
    await set("businesses", BIZ2, business("Two Fleet", "718-555-0102"));
    const w = [];
    // k1: monthly, Oct and Nov paid, no Dec bill yet (due Dec 3 = in 2 days).
    w.push(set("fleetDrivers", "k1", driver(BIZ2,
        "Amadou Diallo #49 STORAGE 2/14/25")));
    w.push(set("fleetAssignments", "k1-a", monthly(BIZ2, "k1")));
    for (const m of ["2026-10-01", "2026-11-01"]) {
      w.push(set("fleetBills", `k1-a_${m}`, paidBill(BIZ2, "k1-a", "k1", m)));
    }
    // k2: same, but credit covers the coming fee: nothing to ask.
    w.push(set("fleetDrivers", "k2", driver(BIZ2, "Credit Holder",
        {creditCents: 35000})));
    w.push(set("fleetAssignments", "k2-a", monthly(BIZ2, "k2")));
    // k3: monthly + an old late fee + credit, and no open rent bill.
    w.push(set("fleetDrivers", "k3", driver(BIZ2, "Fee Owner",
        {creditCents: 1000})));
    w.push(set("fleetAssignments", "k3-a", monthly(BIZ2, "k3")));
    w.push(set("fleetBills", "k3-fee", bill(BIZ2, "k3", {kind: "late_fee",
      label: "Late fee", dueDayKey: "2026-11-28", amountCents: 5000})));
    // k4: a late fee is the oldest open bill; the rent bill is due today.
    w.push(set("fleetDrivers", "k4", driver(BIZ2, "Rent And Fee")));
    w.push(set("fleetBills", "k4-fee", bill(BIZ2, "k4", {kind: "late_fee",
      label: "Late fee", dueDayKey: "2026-11-28", amountCents: 2500})));
    w.push(set("fleetBills", "k4-rent", bill(BIZ2, "k4")));
    // k5: only a one-off charge (3 days overdue): no automatic reminder.
    w.push(set("fleetDrivers", "k5", driver(BIZ2, "Charge Only")));
    w.push(set("fleetBills", "k5-charge", bill(BIZ2, "k5", {kind: "charge",
      label: "Ticket", dueDayKey: "2026-11-28", amountCents: 6000})));
    // k6: has left, with an overdue rent bill and a still-open assignment.
    w.push(set("fleetDrivers", "k6", driver(BIZ2, "Gone Driver",
        {status: "left"})));
    w.push(set("fleetAssignments", "k6-a", monthly(BIZ2, "k6")));
    w.push(set("fleetBills", "k6-rent", bill(BIZ2, "k6",
        {dueDayKey: "2026-11-28"})));
    // k7: credit held: the stated amount is owed minus credit.
    w.push(set("fleetDrivers", "k7", driver(BIZ2, "Some Credit",
        {creditCents: 10000})));
    w.push(set("fleetBills", "k7-rent", bill(BIZ2, "k7")));
    // k8: credit equals the bill: no reminder.
    w.push(set("fleetDrivers", "k8", driver(BIZ2, "All Credit",
        {creditCents: 35000})));
    w.push(set("fleetBills", "k8-rent", bill(BIZ2, "k8")));
    await Promise.all(w);
  });

  const runPass = async () => {
    const out = [];
    const h = handlersFor(BIZ2, async (args) => {
      out.push(args);
      return "sent";
    });
    const b = (await db.collection("businesses").doc(BIZ2).get()).data();
    const result = await h.remindBusiness(BIZ2, b, TODAY);
    return {out, result,
      by: Object.fromEntries(out.map((s) => [s.row.driverId, s]))};
  };

  it("M2: the 2-days-before reminder is sent for a period with no bill, " +
      "for the coming amount, once", async () => {
    const {by, result} = await runPass();
    const k1 = by.k1;
    assert.ok(k1, "k1 is reminded");
    assert.equal(k1.id, "reminder_k1_soon_k1-a_2026-12-01");
    assert.equal(k1.row.reminder, "soon");
    const v = params(k1);
    assert.equal(v[2], "is due on Dec 3, 2026");
    assert.equal(v[3], "$350.00");
    assert.equal(v[0], "Amadou Diallo", "M6: no office notes in the name");
    assert.equal(k1.row.name, "Amadou Diallo #49 STORAGE 2/14/25",
        "the stored name is untouched");
    assert.equal(result.failed, 0);
    // No bill was created by looking ahead.
    const decBills = (await db.collection("fleetBills")
        .where("assignmentId", "==", "k1-a").get()).docs
        .filter((d) => d.get("periodFrom") === "2026-12-01");
    assert.equal(decBills.length, 0);
  });

  it("M2 and M3: the coming fee plus what is owed, minus credit, never " +
      "below zero", async () => {
    const {by} = await runPass();
    assert.equal(by.k2, undefined, "credit covers it: nothing sent");
    // k3: 350.00 coming + 50.00 late fee - 10.00 credit.
    assert.equal(params(by.k3)[3], "$390.00");
    assert.equal(by.k3.row.reminder, "soon");
    assert.equal(by.k3.id, "reminder_k3_soon_k3-a_2026-12-01");
  });

  it("M3: a reminder states owed minus credit; none when it is zero",
      async () => {
        const {by} = await runPass();
        assert.equal(params(by.k7)[3], "$250.00");
        assert.equal(by.k8, undefined);
      });

  it("M5: a reminder is about the rent bill; a late fee or charge only " +
      "adds to the amount", async () => {
    const {by} = await runPass();
    assert.equal(by.k4.row.billId, "k4-rent");
    assert.equal(by.k4.row.reminder, "today");
    const v = params(by.k4);
    assert.equal(v[2], "is due today");
    assert.equal(v[3], "$375.00");
    assert.equal(by.k5, undefined, "only a charge owed: no reminder");
    assert.equal(by.k3.row.billId, undefined,
        "a late fee is never the bill the reminder is about");
  });

  it("M7: nothing for a driver who has left", async () => {
    const {by} = await runPass();
    assert.equal(by.k6, undefined);
  });

  it("M7: a payment recorded for a driver who left still gets its receipt",
      async () => {
        await db.collection("fleetPayments").doc("k6-pay").set({
          businessId: BIZ2, driverId: "k6", amountCents: 1000,
          paidDayKey: TODAY, method: "cash"});
        const out = [];
        const h = handlersFor(BIZ2, async (args) => {
          out.push(args);
          return "sent";
        });
        assert.equal(await h.sendReceipt(BIZ2, "k6-pay"), "sent");
        assert.equal(out[0].id, "receipt_k6-pay");
        assert.equal(params(out[0])[0], "Gone Driver");
      });

  it("M6: a receipt greets the display name too", async () => {
    await db.collection("fleetPayments").doc("k1-pay").set({
      businessId: BIZ2, driverId: "k1", amountCents: 1000,
      paidDayKey: TODAY, method: "cash"});
    const out = [];
    const h = handlersFor(BIZ2, async (args) => {
      out.push(args);
      return "sent";
    });
    await h.sendReceipt(BIZ2, "k1-pay");
    assert.equal(params(out[0])[0], "Amadou Diallo");
  });
});

describe("M1: a failed send is not final, the day is done only when sent",
    () => {
      before(async () => {
        await db.collection("businesses").doc(BIZ4)
            .set(business("Four Fleet", "718-555-0104"));
        await db.collection("fleetDrivers").doc("t1")
            .set(driver(BIZ4, "Tick Driver"));
        await db.collection("fleetBills").doc("t1-rent")
            .set(bill(BIZ4, "t1"));
      });
      const doneKey = async () => (await db.collection("businesses")
          .doc(BIZ4).get()).get("fleet.remindersSentDayKey");

      it("the day is marked only after the pass; failed passes are looked " +
          "at again on later ticks; a clean pass is not repeated",
      async () => {
        let calls = 0;
        const failing = handlersFor(BIZ4, async () => {
          calls += 1;
          return "failed";
        });
        await failing.fleetBankTick(TICK_MS);
        assert.equal(calls, 1);
        assert.equal(await doneKey(), undefined, "failed: not done");
        const throwing = handlersFor(BIZ4, async () => {
          calls += 1;
          throw new Error("network");
        });
        await throwing.fleetBankTick(TICK_MS + 15 * 60000);
        assert.equal(calls, 2, "looked at again on the next tick");
        assert.equal(await doneKey(), undefined);
        const working = handlersFor(BIZ4, async () => {
          calls += 1;
          return "sent";
        });
        await working.fleetBankTick(TICK_MS + 30 * 60000);
        assert.equal(calls, 3);
        assert.equal(await doneKey(), TODAY);
        await working.fleetBankTick(TICK_MS + 45 * 60000);
        assert.equal(calls, 3, "a fully successful pass is not repeated");
      });

      it("a failed manual reminder is retried on a later call with the " +
          "same id, 3 attempts in all; a sent one never again", async () => {
        const manualRows = () => rows((r) => r.manual === true &&
          r.driverId === "wa-d2");
        const first = await manualRows();
        // The earlier test left one sent row: use a fresh driver.
        assert.equal(first.length, 1);
        await db.collection("fleetDrivers").doc("wa-d9").set({
          businessId: BIZ, name: "Retry Driver", phone: "+16465550009",
          status: "active", creditCents: 0, rememberedSenders: []});
        await db.collection("fleetBills").doc("wa-b9").set({businessId: BIZ,
          driverId: "wa-d9", kind: "rent", label: "Rent",
          dueDayKey: "2026-11-01", amountCents: 35000, paidCents: 0,
          status: "open"});
        await act(OWNER, "whatsapp_save", {enabled: true, onlyDriverIds: []});
        const mine = () => rows((r) => r.driverId === "wa-d9" && r.manual);
        const call = () => act(STAFF, "whatsapp_remind_driver",
            {driverId: "wa-d9"});
        assert.equal((await call()).status, "failed");
        let row = (await mine())[0];
        assert.equal(row.attempts, 1);
        assert.equal(row.status, "failed");
        assert.equal((await call()).status, "failed", "retried");
        assert.equal((await call()).status, "failed", "third attempt");
        row = (await mine())[0];
        assert.equal(row.attempts, 3);
        assert.equal((await call()).status, "", "no fourth attempt");
        assert.equal((await mine())[0].attempts, 3);
        assert.equal((await mine()).length, 1, "same id throughout");

        const ref = db.collection("fleetMessages").doc(row.id);
        for (const status of ["sent", "stopped", "skipped"]) {
          await ref.update({status, attempts: 1});
          assert.equal((await call()).status, "", `${status} is final`);
        }
        const nowMs = Date.now();
        await ref.update({status: "queued", attempts: 1, queuedAtMs: nowMs});
        assert.equal((await call()).status, "", "still in flight");
        await ref.update({status: "queued", attempts: 1,
          queuedAtMs: nowMs - 11 * 60000});
        assert.equal((await call()).status, "failed",
            "queued for over 10 minutes: tried again");
        assert.equal((await mine())[0].attempts, 2);
      });
    });

describe("M4: no Zelle address, no reminders", () => {
  before(async () => {
    await Promise.all([
      db.collection("businesses").doc(BIZ3).set({name: "Three Fleet",
        phone: "+17185550100", status: "approved", ownerUid: OWNER3,
        enabledServices: ["fleet"], fleet: {enabled: true, settings: {
          whatsapp: {enabled: true}}}}),
      db.collection("users").doc(OWNER3).set({role: "businessOwner",
        businessId: BIZ3, fullName: "Owner 3"}),
      db.collection("users").doc(STAFF3).set({role: "staff",
        businessId: BIZ3, businessPermissions: ["fleet"],
        fullName: "Staff 3"}),
      db.collection("fleetDrivers").doc("z1").set(driver(BIZ3, "Zed One")),
      db.collection("fleetBills").doc("z1-rent").set(bill(BIZ3, "z1")),
    ]);
  });
  const act3 = (uid, action, data = {}) => run("fleetAction", uid,
      {action, businessId: BIZ3, ...data});

  it("switching WhatsApp on is refused without a Zelle address; off is " +
      "allowed; then it works", async () => {
    await assert.rejects(act3(OWNER3, "whatsapp_save", {enabled: true}),
        (error) => error.details?.reason === "fleet_zelle_missing" &&
          /Add the Zelle email or phone in Fleet settings first\./
              .test(error.message + JSON.stringify(error.details)));
    await act3(OWNER3, "whatsapp_save", {enabled: false});
    await assert.rejects(act3(STAFF3, "whatsapp_remind_driver",
        {driverId: "z1"}), refused("fleet_whatsapp_off"));
    await db.collection("businesses").doc(BIZ3)
        .update({"fleet.settings.whatsapp.enabled": true});
    await assert.rejects(act3(STAFF3, "whatsapp_remind_driver",
        {driverId: "z1"}), refused("fleet_zelle_missing"));
  });

  it("the daily pass sends nothing and says so once a day", async () => {
    await db.collection("businesses").doc(BIZ3)
        .update({"fleet.settings.whatsapp.enabled": true});
    let sentCount = 0;
    const warns = [];
    const h = handlersFor(BIZ3, async () => {
      sentCount += 1;
      return "sent";
    }, {info() {}, error() {}, warn: (message) => warns.push(message)});
    await h.fleetBankTick(TICK_MS);
    await h.fleetBankTick(TICK_MS + 15 * 60000);
    assert.equal(sentCount, 0);
    assert.equal(warns.filter((m) => /no Zelle/.test(m)).length, 1);
    const b = (await db.collection("businesses").doc(BIZ3).get()).data();
    assert.equal(b.fleet.remindersSentDayKey, undefined);
    // remindBusiness itself also refuses to send.
    assert.deepEqual(await h.remindBusiness(BIZ3, b, TODAY),
        {tried: 0, failed: 0});
  });
});
