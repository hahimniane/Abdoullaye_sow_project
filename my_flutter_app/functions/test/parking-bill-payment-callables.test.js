"use strict";

// Month bill payments (docs/PARKING_BILL_PAYMENTS.md) end to end against the
// Auth, Firestore and Storage emulators: one amount pays the bill oldest
// first, each part lands on its car or activity like a hand-recorded part
// payment, one WhatsApp receipt goes out with its PDF, and the whole payment
// is undone as one. Meta is a fake `fetch`; the clock is frozen.
//
// Run through `npm run test:parking-bill-payments` (firebase emulators:exec).

/* global globalThis */

const assert = require("node:assert/strict");
const {after, before, beforeEach, describe, it, mock} =
  require("node:test");
const admin = require("firebase-admin");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
      "Run this through `npm run test:parking-bill-payments` (firebase " +
      "emulators:exec). A direct node --test run would write its fixtures " +
      "into the real project.");
}

process.env.FUNCTIONS_EMULATOR = "true";
process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "1475234702329161";
process.env.WHATSAPP_APP_SECRET = "test-app-secret";

const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const href = String(url);
  if (href.includes("graph.facebook.com") && href.endsWith("/messages")) {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify(
        {messages: [{id: `wamid.out.${sent.length}`}]}), {status: 200});
  }
  if (href.includes("laawoldigital.com/assets/logo.png")) {
    return new Response("", {status: 404});
  }
  return realFetch(url, init);
};

const functions = require("../index");
const {occupancyEndMs} = require("../parking_occupancy");
const {billPaymentPlan} = require("../parking_bill_payment");
admin.auth().getUser = async (uid) => ({
  uid, email: `${uid}@example.test`, emailVerified: true});
const db = admin.firestore();
const {Timestamp} = admin.firestore;

const BIZ = "pkbill-lot";
const OWNER = "pkbill-owner";
const PARKING_STAFF = "pkbill-staff";
const LEDGER_STAFF = "pkbill-ledger";
const OUTSIDER = "pkbill-outsider";
const MONTH = "2026-10";
const KEY = "phone:2015550101";
const NOW = Date.parse("2026-11-04T15:00:00Z");

const run = (name, uid, data) => functions[name].run({
  auth: {uid, token: {}}, data, rawRequest: {}});
const call = (action, uid, extra) => run("updateBusinessParkingEntry", uid,
    {action, businessId: BIZ, ...extra});
const pay = (amountCents, uid = OWNER, extra = {}) =>
  call("bill_payment_record", uid, {monthKey: MONTH, customerKey: KEY,
    amountCents, receivedVia: "zelle", receivedByStaffId: PARKING_STAFF,
    ...extra});
const undo = (billPaymentId, uid = OWNER) =>
  call("bill_payment_undo", uid, {billPaymentId});
const refusal = (code, reason) => (error) => {
  assert.equal(error.code, code, error.message);
  assert.equal(error.details?.reason, reason, error.message);
  return true;
};
const day = (iso) => Timestamp.fromDate(new Date(`${iso}T12:00:00Z`));
const carDoc = async (id) => (await db.collection("parkedCars").doc(id)
    .get()).data();
const actDoc = async (id) => (await db.collection("lotActivities").doc(id)
    .get()).data();
const billDoc = async (id) => (await db.collection("parkingBillPayments")
    .doc(id).get()).data();

function fakeRes() {
  const res = {statusCode: 0, body: "", headers: {}, headersSent: false,
    on: () => res, once: () => res, emit: () => true,
    set: (k, v) => {
      res.headers[String(k).toLowerCase()] = v;
      return res;
    },
    setHeader: (k, v) => {
      res.headers[String(k).toLowerCase()] = v;
    },
    getHeader: (k) => res.headers[String(k).toLowerCase()],
    end: (value) => {
      if (value !== undefined) res.body = value;
      res.headersSent = true;
      return res;
    }};
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.send = (value) => {
    res.body = value;
    return res;
  };
  return res;
}

async function open(link) {
  const query = Object.fromEntries(new URL(link).searchParams);
  const res = fakeRes();
  await functions.parkingDocument({method: "GET", query, headers: {},
    on: () => {}, once: () => {}}, res);
  return res;
}

async function seedCar(id, overrides) {
  const row = {
    businessId: BIZ, businessName: "Dala Parking", source: "business",
    enteredByBusiness: true, trackingCode: `PK-${id.toUpperCase()}`,
    status: "reserved", customerName: "Fatou Camara",
    customerPhone: "+12015550101", carMake: "Toyota", carModel: "Corolla",
    carYear: "2014", paymentMethod: "direct",
    paymentStatus: "awaiting_direct_payment", dailyRate: 10,
    amountPaidCents: 0, createdAt: Timestamp.now(), ...overrides,
  };
  await db.collection("parkedCars").doc(id)
      .set({...row, occupancyEndMs: occupancyEndMs(row)});
}

// Fatou owes, oldest first:
//   old   Corolla, Sep 20-22, left before October   $30  (unpaid from before)
//   civic Civic, Oct 10-19                           $100
//   tow   Towing, Oct 15 (a lot activity)            $40
//   total $170
async function seedFatou() {
  await seedCar("old", {parkingDate: day("2026-09-20"),
    parkingEndDate: day("2026-09-22"), amountDue: 30, amountDueCents: 3000,
    totalCost: 30, totalCostCents: 3000});
  await seedCar("civic", {carMake: "Honda", carModel: "Civic",
    carYear: "2016", parkingDate: day("2026-10-10"),
    parkingEndDate: day("2026-10-19"), amountDue: 100,
    amountDueCents: 10000, totalCost: 100, totalCostCents: 10000});
  await db.collection("lotActivities").doc("tow").set({
    businessId: BIZ, activityTypeLabel: "towing", feeCents: 4000,
    paymentStatus: "awaiting_direct_payment", paymentMethod: "direct",
    amountPaidCents: 0, activityDate: day("2026-10-15"),
    customerName: "Fatou Camara", customerPhone: "+12015550101",
    createdAt: Timestamp.now()});
}

async function clear() {
  for (const name of ["parkingMessages", "parkingBillPayments", "parkedCars",
    "lotActivities", "lotActivityPayments", "lotLedgerAudit",
    "whatsappContacts", "whatsappTemplateCounts"]) {
    const snap = await db.collection(name).get();
    await Promise.all(snap.docs.map((doc) => doc.ref.delete()));
  }
  await db.collection("businesses").doc(BIZ).update({
    parkingWhatsApp: admin.firestore.FieldValue.delete()});
  sent.length = 0;
}

before(async () => {
  await Promise.all([
    db.collection("businesses").doc(BIZ).set({
      name: "Dala Parking", status: "approved", ownerUid: OWNER,
      country: "United States", phone: "+13475550100",
      enabledServices: ["carParking"], parkingDailyRate: 10,
    }),
    db.collection("users").doc(OWNER).set({role: "businessOwner",
      businessId: BIZ, fullName: "Ousmane Sow"}),
    db.collection("users").doc(PARKING_STAFF).set({role: "staff",
      businessId: BIZ, businessPermissions: ["parking"],
      fullName: "Yao Kouassi"}),
    db.collection("users").doc(LEDGER_STAFF).set({role: "staff",
      businessId: BIZ, businessPermissions: ["parking", "ledger"],
      fullName: "Awa Diop"}),
    db.collection("users").doc(OUTSIDER).set({role: "staff",
      businessId: BIZ, businessPermissions: ["inventory"],
      fullName: "Sekou Toure"}),
  ]);
  mock.timers.enable({apis: ["Date"], now: NOW});
});

after(() => mock.timers.reset());

beforeEach(async () => {
  await clear();
  await seedFatou();
});

describe("recording a payment on a month bill", () => {
  it("pays oldest first: the car from September, then October", async () => {
    const r = await pay(6000);
    assert.equal(r.success, true);
    assert.equal(r.leftCents, 11000);
    assert.deepEqual(r.parts.map((p) => [p.id, p.amountCents, p.full]),
        [["old", 3000, true], ["civic", 3000, false]]);

    const old = await carDoc("old");
    assert.equal(old.amountPaidCents, 3000);
    assert.equal(old.paymentStatus, "paid", "the old car is settled");
    assert.equal(old.parkingPayments.length, 1);
    assert.equal(old.parkingPayments[0].billPaymentId, r.billPaymentId);
    assert.equal(old.parkingPayments[0].receivedByStaffId, PARKING_STAFF);
    assert.equal(old.parkingPayments[0].receivedVia, "zelle");
    const civic = await carDoc("civic");
    assert.equal(civic.amountPaidCents, 3000);
    assert.equal(civic.paymentStatus, "awaiting_direct_payment");
    assert.equal((await actDoc("tow")).amountPaidCents, 0, "not reached");

    const bill = await billDoc(r.billPaymentId);
    assert.equal(bill.status, "recorded");
    assert.equal(bill.amountCents, 6000);
    assert.equal(bill.dueBeforeCents, 17000);
    assert.equal(bill.leftCents, 11000);
    assert.equal(bill.customerKey, KEY);
    assert.equal(bill.recordedByUid, OWNER);
  });

  it("reaches the activity with ledger permission, as one instalment",
      async () => {
        const r = await pay(15000, LEDGER_STAFF);
        assert.deepEqual(r.parts.map((p) => [p.id, p.amountCents]),
            [["old", 3000], ["civic", 10000], ["tow", 2000]]);
        const tow = await actDoc("tow");
        assert.equal(tow.amountPaidCents, 2000);
        const inst = (await db.collection("lotActivityPayments")
            .where("activityId", "==", "tow").get()).docs.map((d) => d.data());
        assert.equal(inst.length, 1);
        assert.equal(inst[0].billPaymentId, r.billPaymentId);
        assert.equal(inst[0].amountCents, 2000);
        assert.equal((await carDoc("civic")).paymentStatus, "paid");
      });

  it("refuses an activity part without the ledger permission", async () => {
    await assert.rejects(pay(15000, PARKING_STAFF),
        refusal("permission-denied", "bill_payment_ledger_required"));
    assert.equal((await carDoc("old")).amountPaidCents, 0, "nothing written");
  });

  it("never takes more than the bill owes", async () => {
    await assert.rejects(pay(17001),
        refusal("failed-precondition", "bill_payment_more_than_owed"));
    await assert.rejects(pay(0),
        refusal("failed-precondition", "bill_payment_no_amount"));
    const all = await pay(17000);
    assert.equal(all.leftCents, 0);
    await assert.rejects(pay(1),
        refusal("failed-precondition", "bill_payment_nothing_to_pay"));
  });

  it("refuses when the bill changed since the preview", async () => {
    await assert.rejects(pay(1000, OWNER, {expectedPayableCents: 16000}),
        refusal("failed-precondition", "bill_payment_bill_changed"));
    const ok = await pay(1000, OWNER, {expectedPayableCents: 17000});
    assert.equal(ok.success, true);
  });

  it("needs who took the money, and the parking permission", async () => {
    await assert.rejects(pay(1000, OWNER, {receivedByStaffId: ""}),
        refusal("invalid-argument", "bill_payment_receiver_required"));
    await assert.rejects(pay(1000, OUTSIDER),
        (error) => error.code === "permission-denied");
    await assert.rejects(pay(1000, OWNER, {customerKey: "phone:9999999999"}),
        refusal("failed-precondition", "bill_payment_customer_not_found"));
  });

  it("agrees with the shared plan the clients preview with", async () => {
    // The server's customer, rebuilt the way Month end shows it.
    const r = await pay(4500);
    const plan = billPaymentPlan({
      dueCents: 17000, expenseCreditCents: 0,
      olderCars: [{id: "old", recordable: true, dueCents: 3000,
        periodFrom: "2026-09-20", vehicle: "2014 Toyota Corolla"}],
      cars: [{id: "civic", recordable: true, dueCents: 10000,
        priorUnpaidCents: 0, periodFrom: "2026-10-10",
        vehicle: "2016 Honda Civic"}],
      activities: [{id: "tow", dueCents: 4000, date: "2026-10-15",
        label: "Towing"}], olderActivities: []}, 4500);
    assert.deepEqual(r.parts.map((p) => [p.id, p.amountCents]),
        plan.parts.map((p) => [p.id, p.amountCents]));
  });
});

describe("one WhatsApp receipt for the whole payment", () => {
  const turnOn = () => db.collection("businesses").doc(BIZ).update({
    parkingWhatsApp: {enabled: true,
      enabledAtMs: Date.parse("2026-10-01T00:00:00Z"), enabledByUid: OWNER}});

  it("sends one receipt with the PDF, and its link opens", async () => {
    await turnOn();
    const r = await pay(6000);
    assert.equal(r.receipt, "sent");
    assert.equal(sent.length, 1, "one message, not one per car");
    const body = sent[0];
    assert.equal(body.to, "12015550101");
    assert.equal(body.template.name, "parking_receipt_2lang");
    const values = body.template.components
        .find((c) => c.type === "body").parameters.map((p) => p.text);
    assert.equal(values[0], "Fatou Camara");
    assert.equal(values[2], "$60.00");
    assert.equal(values[3], "2014 Toyota Corolla and 2016 Honda Civic");
    assert.equal(values[5], "Balance owed: $110.00");
    const row = (await db.collection("parkingMessages")
        .doc(`bill_${r.billPaymentId}`).get()).data();
    assert.equal(row.status, "sent");
    assert.equal(row.kind, "bill_receipt");

    const link = body.template.components[0].parameters[0].document.link;
    const res = await open(link);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "application/pdf");
    assert.ok(Buffer.from(res.body).subarray(0, 5).toString() === "%PDF-");

    await undo(r.billPaymentId);
    assert.equal((await open(link)).statusCode, 404, "an undone receipt");
  });

  it("sends nothing while the switch is off", async () => {
    const r = await pay(6000);
    assert.equal(r.receipt, "");
    assert.equal(sent.length, 0);
  });
});

describe("undoing a payment", () => {
  it("takes every part off at once and keeps the payment, undone",
      async () => {
        const r = await pay(15000, LEDGER_STAFF);
        const u = await undo(r.billPaymentId, LEDGER_STAFF);
        assert.equal(u.success, true);

        const old = await carDoc("old");
        assert.equal(old.amountPaidCents, 0);
        assert.equal(old.paymentStatus, "awaiting_direct_payment");
        assert.equal(old.parkingPayments.length, 0);
        assert.equal(old.revertedParkingPayments.length, 1);
        assert.equal(old.revertedParkingPayments[0].billPaymentId,
            r.billPaymentId);
        const civic = await carDoc("civic");
        assert.equal(civic.amountPaidCents, 0);
        assert.equal(civic.paymentStatus, "awaiting_direct_payment");
        const tow = await actDoc("tow");
        assert.equal(tow.amountPaidCents, 0);
        const inst = (await db.collection("lotActivityPayments")
            .where("activityId", "==", "tow").get()).docs[0].data();
        assert.equal(inst.reverted, true);

        const bill = await billDoc(r.billPaymentId);
        assert.equal(bill.status, "undone");
        assert.equal(bill.undoneByUid, LEDGER_STAFF);
        await assert.rejects(undo(r.billPaymentId),
            refusal("failed-precondition", "bill_payment_already_undone"));
      });

  it("keeps a later payment on the same car", async () => {
    const first = await pay(5000);
    await pay(2000);
    await undo(first.billPaymentId);
    const civic = await carDoc("civic");
    // First: old $30 + civic $20; second: civic $20. Only the second stays.
    assert.equal(civic.amountPaidCents, 2000);
    assert.equal(civic.parkingPayments.length, 1);
    assert.equal((await carDoc("old")).amountPaidCents, 0);
  });

  it("refuses when a car was marked paid in full afterwards", async () => {
    const r = await pay(5000);
    // Mark paid in full writes the total with no entry of its own.
    await db.collection("parkedCars").doc("civic").update({
      paymentStatus: "paid", amountPaidCents: 10000});
    await assert.rejects(undo(r.billPaymentId),
        refusal("failed-precondition", "bill_payment_settled_since"));
    assert.equal((await carDoc("old")).amountPaidCents, 3000, "untouched");
  });

  it("refuses another lot's payment and needs the permission", async () => {
    const r = await pay(1000);
    await assert.rejects(undo(r.billPaymentId, OUTSIDER),
        (error) => error.code === "permission-denied");
    await assert.rejects(undo("nope"),
        refusal("not-found", "bill_payment_not_found"));
  });
});
