"use strict";

// Monthly parking invoices on WhatsApp (docs/PARKING_INVOICES.md) end to end
// against the Auth, Firestore and Storage emulators: the 1st prepares the
// month's run and tells the owner, the owner previews and sends, the signed
// /d link serves the PDF, and from the 3rd (New York) the hourly sweep sends
// whatever nobody sent - once. Meta is a fake `fetch`; the clock is frozen
// at the moment each test names (node:test's mock Date).
//
// Run through `npm run test:parking-invoices` (firebase emulators:exec).

/* global globalThis */

const assert = require("node:assert/strict");
const {after, before, beforeEach, describe, it, mock} =
  require("node:test");
const admin = require("firebase-admin");

// This suite writes with ADMIN credentials: never against a real project.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
      "Run this through `npm run test:parking-invoices` (firebase " +
      "emulators:exec). A direct node --test run would write its fixtures " +
      "into the real project.");
}

process.env.FUNCTIONS_EMULATOR = "true";
process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "1475234702329161";
process.env.WHATSAPP_APP_SECRET = "test-app-secret";

// --- Fake Meta ---------------------------------------------------------------
const sent = [];
let failNext = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const href = String(url);
  if (href.includes("graph.facebook.com") && href.endsWith("/messages")) {
    const body = JSON.parse(init.body);
    if (failNext) {
      const code = failNext;
      failNext = 0;
      return new Response(JSON.stringify({error: {code, message: "nope"}}),
          {status: 400});
    }
    sent.push(body);
    return new Response(JSON.stringify(
        {messages: [{id: `wamid.out.${sent.length}`}]}), {status: 200});
  }
  // The platform logo the PDF asks for: never the real network.
  if (href.includes("laawoldigital.com/assets/logo.png")) {
    return new Response("", {status: 404});
  }
  return realFetch(url, init);
};

const functions = require("../index");
const packageProof = require("../package_proof");
const parkingInvoices = require("../parking_invoices");
const {occupancyEndMs} = require("../parking_occupancy");
admin.auth().getUser = async (uid) => ({
  uid, email: `${uid}@example.test`, emailVerified: true});
const db = admin.firestore();
const {Timestamp} = admin.firestore;

const BIZ = "pkinv-lot";
const OTHER_BIZ = "pkinv-other-lot";
const OWNER = "pkinv-owner";
const STAFF = "pkinv-staff";
const OTHER_OWNER = "pkinv-other-owner";
const PLATFORM_ADMIN = "pkinv-admin";
const MONTH = "2026-10";
// New York is on EST from Nov 1: 9 am on the 1st, midnight on the 3rd.
const FIRST = Date.parse("2026-11-01T14:00:00Z");
const SECOND = Date.parse("2026-11-02T15:00:00Z");
const BEFORE_THIRD = Date.parse("2026-11-03T04:59:59Z");
const THIRD_MIDNIGHT = Date.parse("2026-11-03T05:00:00Z");
const THIRD = Date.parse("2026-11-03T15:00:00Z");
const BASE = `https://us-central1-${process.env.GCLOUD_PROJECT}` +
  ".cloudfunctions.net/parkingDocument";

const clock = (ms) => mock.timers.setTime(ms);
const run = (name, uid, data) => functions[name].run({
  auth: {uid, token: {}}, data, rawRequest: {}});
const call = (action, uid = OWNER, extra = {}) =>
  run("updateBusinessParkingEntry", uid,
      {action, businessId: BIZ, ...extra});
const preview = (uid, extra) => call("invoices_preview", uid,
    {monthKey: MONTH, ...extra});
const send = (uid, extra) => call("invoices_send", uid,
    {monthKey: MONTH, ...extra});

const refusal = (code, reason) => (error) => {
  assert.equal(error.code, code, error.message);
  assert.equal(error.details?.reason, reason, error.message);
  return true;
};

const day = (iso) => Timestamp.fromDate(new Date(`${iso}T12:00:00Z`));
const runRef = (businessId = BIZ) => db.collection("parkingInvoiceRuns")
    .doc(`${businessId}_${MONTH}`);
const runDoc = async (businessId) =>
  (await runRef(businessId).get()).data();
const rowsOf = async () =>
  (await db.collection("parkingMessages").get()).docs
      .map((doc) => ({id: doc.id, ...doc.data()}));
const invoiceRows = async () =>
  (await rowsOf()).filter((r) => r.kind === "invoice");
const bucket = () => admin.storage()
    .bucket(`${process.env.GCLOUD_PROJECT}.firebasestorage.app`);

// Customers, all with cars in October 2026:
//   A  Alimou  +12015550001  left Oct 19, $100 unpaid            -> owes
//   B  Binta   +12015550002  parked since Oct 20, paid $120      -> $0, parked
//   C  Cheikh  +12015550003  left Oct 10, paid                   -> none
//   D  Doudou  +12015550004  voided                              -> none
//   E  Mamadou +12015550005  left Oct 15, $150, staff expenses
//                            $60 linked to STAFF                 -> owes $90
//   I  Ibra    620123456     owes, no country code               -> skipped
let seq = 0;
async function seedCar(overrides = {}) {
  seq += 1;
  const id = `pkinv-car-${seq}`;
  const row = {
    businessId: BIZ,
    businessName: "Dala Parking",
    source: "business",
    enteredByBusiness: true,
    trackingCode: `PK-IV${String(seq).padStart(4, "0")}`,
    status: "reserved",
    customerName: "Alimou Barry",
    customerPhone: "+12015550001",
    carMake: "Toyota", carModel: "Corolla", carYear: "2014",
    vinNumber: "1HGCM82633A004352",
    paymentMethod: "direct",
    paymentStatus: "awaiting_direct_payment",
    dailyRate: 10,
    amountDue: 100, amountDueCents: 10000, totalCost: 100,
    totalCostCents: 10000,
    amountPaidCents: 0,
    parkingDate: day("2026-10-10"),
    parkingEndDate: day("2026-10-19"),
    createdAt: Timestamp.now(),
    ...overrides,
  };
  await db.collection("parkedCars").doc(id)
      .set({...row, occupancyEndMs: occupancyEndMs(row)});
  return id;
}

async function seedLot() {
  const a = await seedCar();
  const b = await seedCar({customerName: "Binta Diallo",
    customerPhone: "+12015550002", carMake: "Honda", carModel: "Civic",
    carYear: "2016", parkingDate: day("2026-10-20"),
    parkingEndDate: null, amountDue: 0, amountDueCents: 0, totalCost: 0,
    totalCostCents: 0, amountPaidCents: 12000});
  await seedCar({customerName: "Cheikh Ba", customerPhone: "+12015550003",
    carMake: "Ford", carModel: "Focus", parkingDate: day("2026-10-05"),
    parkingEndDate: day("2026-10-10"), amountDue: 60, amountDueCents: 6000,
    totalCost: 60, totalCostCents: 6000, amountPaidCents: 6000});
  await seedCar({customerName: "Doudou Sy", customerPhone: "+12015550004",
    voided: true});
  const e = await seedCar({customerName: "Mamadou Diallo",
    customerPhone: "+12015550005", carMake: "Kia", carModel: "Rio",
    parkingDate: day("2026-10-01"), parkingEndDate: day("2026-10-15"),
    amountDue: 150, amountDueCents: 15000, totalCost: 150,
    totalCostCents: 15000});
  await seedCar({customerName: "Ibra Ndiaye", customerPhone: "620123456",
    carMake: "Dodge", carModel: "Ram", parkingDate: day("2026-10-02"),
    parkingEndDate: day("2026-10-04"), amountDue: 30, amountDueCents: 3000,
    totalCost: 30, totalCostCents: 3000});
  // STAFF paid $60 for the lot in October and is linked to Mamadou's bill.
  await db.collection("businesses").doc(BIZ).update({
    staffParkingLinks: {[STAFF]: {customerKey: "phone:2015550005",
      customerName: "Mamadou Diallo", customerPhone: "+12015550005",
      linkedAtMs: 1, linkedByUid: OWNER}}});
  await db.collection("lotExpenseEntries").doc("pkinv-exp-1").set({
    businessId: BIZ, paidByStaffId: STAFF, amountCents: 6000,
    month: MONTH, spentAt: day("2026-10-08"), note: "cups", voided: false});
  return {a, b, e};
}

async function turnOn(enabledAtMs = Date.parse("2026-10-01T00:00:00Z")) {
  await db.collection("businesses").doc(BIZ).update({
    parkingWhatsApp: {enabled: true, enabledAtMs, enabledByUid: OWNER}});
}

async function turnOff() {
  await db.collection("businesses").doc(BIZ).update({
    parkingWhatsApp: admin.firestore.FieldValue.delete()});
}

const receiptBody = (body) => body.template.components
    .find((part) => part.type === "body").parameters.map((p) => p.text);
const invoiceLinkOf = (body) =>
  body.template.components[0].parameters[0].document.link;
const sentTo = () => sent.map((body) => body.to).sort();

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

async function clear() {
  for (const name of ["parkingMessages", "parkingInvoiceRuns",
    "whatsappContacts", "whatsappStops", "whatsappTemplateCounts",
    "parkedCars", "lotActivities", "lotExpenseEntries"]) {
    const snap = await db.collection(name).get();
    await Promise.all(snap.docs.map((doc) => doc.ref.delete()));
  }
  for (const uid of [OWNER, STAFF, OTHER_OWNER]) {
    const notes = await db.collection("users").doc(uid)
        .collection("notifications").get();
    await Promise.all(notes.docs.map((doc) => doc.ref.delete()));
  }
  await db.collection("businesses").doc(BIZ).update({
    parkingWhatsApp: admin.firestore.FieldValue.delete(),
    paymentInstructions: admin.firestore.FieldValue.delete(),
    staffParkingLinks: admin.firestore.FieldValue.delete(),
  });
  const [files] = await bucket().getFiles({prefix: "parkingInvoices/"});
  await Promise.all(files.map((file) => file.delete()));
  sent.length = 0;
  failNext = 0;
  parkingInvoices.INVOICES_MAX_PER_CALL = 300;
  clock(THIRD);
}

before(async () => {
  await Promise.all([
    db.collection("businesses").doc(BIZ).set({
      name: "Dala Parking", status: "approved", ownerUid: OWNER,
      country: "United States", phone: "+13475550100",
      email: "pay@dala.example", addressLine1: "412 Atlantic Ave",
      city: "Brooklyn", state: "NY", postalCode: "11217",
      enabledServices: ["carParking"],
      parkingTotalSpaces: 20, parkingBlockedSpaces: 0, parkingDailyRate: 10,
    }),
    db.collection("businesses").doc(OTHER_BIZ).set({
      name: "Other Lot", status: "approved", ownerUid: OTHER_OWNER,
      country: "United States", enabledServices: ["carParking"],
    }),
    db.collection("users").doc(OWNER).set({role: "businessOwner",
      businessId: BIZ, fullName: "Ousmane Sow"}),
    db.collection("users").doc(STAFF).set({role: "staff", businessId: BIZ,
      businessPermissions: ["parking"], fullName: "Mamadou Diallo"}),
    db.collection("users").doc(OTHER_OWNER).set({role: "businessOwner",
      businessId: OTHER_BIZ, fullName: "Other Owner"}),
    db.collection("users").doc(PLATFORM_ADMIN).set({role: "admin",
      adminRole: "superAdmin", fullName: "Hassimiou Niane"}),
  ]);
  // A frozen clock: every `new Date()` in the functions reads the moment
  // the test sets (timers are untouched).
  mock.timers.enable({apis: ["Date"], now: THIRD});
});

after(() => mock.timers.reset());

beforeEach(clear);

describe("the 1st prepares the month's invoices", () => {
  const notify = async (ms = FIRST) => {
    clock(ms);
    await functions.notifyParkingMonthEnd.run({});
  };
  const notes = async (uid) =>
    (await db.collection("users").doc(uid).collection("notifications")
        .get()).docs.map((doc) => doc.data());

  it("makes a ready run for a lot with the switch on, and tells only the " +
      "owner", async () => {
    await turnOn();
    await seedLot();
    await notify();
    const stored = await runDoc();
    assert.equal(stored.status, "ready");
    assert.equal(stored.businessId, BIZ);
    assert.equal(stored.monthKey, MONTH);
    assert.equal(stored.preparedAtMs, FIRST);
    // Alimou ($100), Binta ($0, still parked) and Mamadou ($90 after his
    // expenses). Cheikh left and paid, Doudou's car is voided, Ibra has no
    // number to reach.
    assert.equal(stored.recipients, 3);
    assert.equal(stored.totalDueCents, 19000);
    assert.equal(stored.sent, 0);
    assert.equal(stored.sentAtMs, 0);
    assert.ok(String(stored.documentToken).length >= 32);

    const [ownerNote] = await notes(OWNER);
    assert.equal(ownerNote.title, "October is over");
    assert.equal(ownerNote.body,
        "3 customers still owe $220.00. Send their bills. " +
        "October's invoices are ready: 3 customers, $190.00. " +
        "Review and send.");
    assert.equal(ownerNote.data.invoices, "3");
    // Staff who work parking hear about the bills, not about the invoices.
    const [staffNote] = await notes(STAFF);
    assert.ok(staffNote.body.startsWith("3 customers still owe"));
    assert.ok(!staffNote.body.includes("invoices"), staffNote.body);
  });

  it("prepares nothing while the switch is off, and the push is as it " +
      "was", async () => {
    await seedLot();
    await notify();
    assert.equal((await runRef().get()).exists, false);
    const [ownerNote] = await notes(OWNER);
    assert.ok(!ownerNote.body.includes("invoices"), ownerNote.body);
    assert.equal((await runRef(OTHER_BIZ).get()).exists, false);
  });

  it("leaves a run it already made alone when it runs again", async () => {
    await turnOn();
    await seedLot();
    await notify();
    const first = await runDoc();
    await send();
    const sentRun = await runDoc();
    assert.equal(sentRun.status, "sent");
    await notify(FIRST + 3600000);
    const again = await runDoc();
    assert.equal(again.status, "sent");
    assert.equal(again.preparedAtMs, first.preparedAtMs);
    assert.equal(again.documentToken, first.documentToken);
  });

  it("tells only the owner when everybody has paid but a car is still " +
      "parked", async () => {
    await turnOn();
    await seedCar({customerName: "Binta Diallo",
      customerPhone: "+12015550002", parkingDate: day("2026-10-20"),
      parkingEndDate: null, amountDue: 0, amountDueCents: 0, totalCost: 0,
      totalCostCents: 0, amountPaidCents: 12000});
    await notify();
    assert.equal((await runDoc()).recipients, 1);
    const [ownerNote] = await notes(OWNER);
    assert.equal(ownerNote.title, "October's invoices are ready");
    assert.equal(ownerNote.body,
        "October's invoices are ready: 1 customer, $0.00. Review and send.");
    assert.deepEqual(await notes(STAFF), []);
  });

  it("makes no run, and no push, when nobody is to be invoiced", async () => {
    await turnOn();
    await seedCar({customerName: "Cheikh Ba", customerPhone: "+12015550003",
      parkingDate: day("2026-10-05"), parkingEndDate: day("2026-10-10"),
      amountDue: 60, amountDueCents: 6000, totalCost: 60,
      totalCostCents: 6000, amountPaidCents: 6000});
    await notify();
    assert.equal((await runRef().get()).exists, false);
    assert.deepEqual(await notes(OWNER), []);
  });
});

describe("invoices_preview", () => {
  it("lists who would get an invoice, with what they owe", async () => {
    await turnOn();
    const {a, b, e} = await seedLot();
    clock(THIRD);
    const result = await preview();
    assert.equal(result.success, true);
    assert.equal(result.monthKey, MONTH);
    assert.equal(result.run, null);
    assert.equal(result.totalDueCents, 19000);
    assert.deepEqual(result.recipients.map((r) => ({
      phone: r.phone, name: r.name, cars: r.cars,
      totalDueCents: r.totalDueCents, stillParked: r.stillParked,
      alreadySent: r.alreadySent, invoiceNumber: r.invoiceNumber,
      messageStatus: r.messageStatus,
    })), [
      {phone: "+12015550001", name: "Alimou Barry",
        cars: [{id: a, label: "2014 Toyota Corolla"}], totalDueCents: 10000,
        stillParked: false, alreadySent: false,
        invoiceNumber: "INV-202610-0001-1", messageStatus: ""},
      {phone: "+12015550005", name: "Mamadou Diallo",
        cars: [{id: e, label: "2014 Kia Rio"}], totalDueCents: 9000,
        stillParked: false, alreadySent: false,
        invoiceNumber: "INV-202610-0005-1", messageStatus: ""},
      {phone: "+12015550002", name: "Binta Diallo",
        cars: [{id: b, label: "2016 Honda Civic"}], totalDueCents: 0,
        stillParked: true, alreadySent: false,
        invoiceNumber: "INV-202610-0002-1", messageStatus: ""},
    ]);
    assert.deepEqual(result.skipped.map((s) => [s.name, s.reason]),
        [["Ibra Ndiaye", "needs_country_code"]]);
    // A preview sends and writes nothing - not even the run.
    assert.deepEqual(sent, []);
    assert.deepEqual(await rowsOf(), []);
    assert.equal((await runRef().get()).exists, false);
  });

  it("defaults to the month that just ended", async () => {
    await turnOn();
    await seedLot();
    const result = await call("invoices_preview");
    assert.equal(result.monthKey, MONTH);
    assert.equal(result.recipients.length, 3);
  });

  it("shows the run, who sent it and which customers were sent",
      async () => {
        await turnOn();
        await seedLot();
        await send();
        const result = await preview();
        assert.equal(result.run.status, "sent");
        assert.equal(result.run.sentBy, OWNER);
        assert.equal(result.run.sentByName, "Ousmane Sow");
        assert.equal(result.run.sent, 3);
        assert.equal(result.run.sentAtMs, THIRD);
        assert.ok(!("documentToken" in result.run));
        assert.deepEqual(result.recipients.map((r) =>
          [r.alreadySent, r.messageStatus]),
        [[true, "sent"], [true, "sent"], [true, "sent"]]);
      });

  it("is the owner's: staff, another business's owner and the signed-out " +
      "are refused; a platform admin may", async () => {
    await turnOn();
    await assert.rejects(preview(STAFF),
        refusal("permission-denied", "invoices_owner_only"));
    await assert.rejects(preview(OTHER_OWNER),
        (error) => error.code === "permission-denied");
    assert.equal((await preview(PLATFORM_ADMIN)).success, true);
    await assert.rejects(functions.updateBusinessParkingEntry.run({
      auth: null, data: {action: "invoices_preview", businessId: BIZ,
        monthKey: MONTH}, rawRequest: {}}),
    (error) => error.code === "unauthenticated");
  });

  it("is refused while the switch is off", async () => {
    await assert.rejects(preview(),
        refusal("failed-precondition", "parking_whatsapp_off"));
    assert.deepEqual(sent, []);
  });

  it("needs a business and a month that just ended", async () => {
    await turnOn();
    await assert.rejects(run("updateBusinessParkingEntry", OWNER,
        {action: "invoices_preview", monthKey: MONTH}),
    refusal("invalid-argument", "business_required"));
    for (const monthKey of ["2026-09", "2026-11", "2025-10", "2026-13",
      "October", 202610]) {
      await assert.rejects(preview(OWNER, {monthKey}),
          refusal("failed-precondition", "invoice_month_invalid"));
    }
  });
});

describe("invoices_send", () => {
  it("sends one message per customer, with the invoice PDF attached",
      async () => {
        await turnOn();
        await seedLot();
        await db.collection("businesses").doc(BIZ).update({
          paymentInstructions: "Pay at the office, or Zelle 347-559-6214."});
        const result = await send();
        assert.deepEqual(result, {success: true, monthKey: MONTH, sent: 3,
          failed: 0, stopped: 0, alreadySent: 0, remaining: 0, skipped: 1});
        assert.deepEqual(sentTo(),
            ["12015550001", "12015550002", "12015550005"]);

        const alimou = sent.find((body) => body.to === "12015550001");
        assert.equal(alimou.template.name, "parking_invoice_2lang");
        assert.deepEqual(alimou.template.language, {code: "en"});
        const header = alimou.template.components[0];
        assert.equal(header.type, "header");
        assert.equal(header.parameters[0].type, "document");
        assert.equal(header.parameters[0].document.filename,
            "Invoice INV-202610-0001-1.pdf");
        assert.ok(invoiceLinkOf(alimou).startsWith(
            `${BASE}?view=invoicePdf&t=`), invoiceLinkOf(alimou));
        // The variable order the approved template uses.
        assert.deepEqual(receiptBody(alimou), [
          "Alimou Barry",
          "Dala Parking", "October 2026", "$100.00",
          "Dala Parking", "octobre 2026", "100,00 $",
          "Pay at the office, or Zelle 347-559-6214.", "+13475550100",
        ]);
        const trackingCode = (await db.collection("parkedCars")
            .where("customerPhone", "==", "+12015550001").get())
            .docs[0].data().trackingCode;
        assert.deepEqual(alimou.template.components[2], {type: "button",
          sub_type: "url", index: "0",
          parameters: [{type: "text", text: trackingCode}]});
        // Staff expenses are netted: $150 - $60.
        assert.equal(receiptBody(sent.find((b) => b.to === "12015550005"))[3],
            "$90.00");
        // Paid up but still parked: an invoice for $0.00.
        assert.equal(receiptBody(sent.find((b) => b.to === "12015550002"))[3],
            "$0.00");

        const rows = await invoiceRows();
        assert.equal(rows.length, 3);
        const row = rows.find((r) => r.phone === "+12015550001");
        assert.equal(row.id, `invoice_${BIZ}_${MONTH}_12015550001`);
        assert.equal(row.status, "sent");
        assert.equal(row.kind, "invoice");
        assert.equal(row.template, "parking_invoice_2lang");
        assert.equal(row.businessId, BIZ);
        assert.equal(row.monthKey, MONTH);
        assert.equal(row.totalDueCents, 10000);
        assert.equal(row.invoiceNumber, "INV-202610-0001-1");
        assert.equal(row.sentByUid, OWNER);
        assert.equal(row.parkedCarIds.length, 1);
        assert.equal(row.parkedCarId, row.parkedCarIds[0]);
        assert.equal(row.attempts, 1);
        assert.equal(row.error, "");
        assert.ok(row.wamid.startsWith("wamid.out."));
        assert.equal(row.whatsappMessageId, row.wamid);
        assert.ok(row.sentAt && row.createdAt);
        assert.equal(row.pdfPath,
            `parkingInvoices/${BIZ}/${MONTH}/12015550001.pdf`);

        const stored = await runDoc();
        assert.equal(stored.status, "sent");
        assert.equal(stored.sentBy, OWNER);
        assert.equal(stored.sentAtMs, THIRD);
        assert.equal(stored.sent, 3);
        assert.equal(stored.failed, 0);
        assert.equal(stored.skipped, 1);
        assert.equal(stored.recipients, 3);
        assert.equal(stored.totalDueCents, 19000);

        // Each customer is a contact of the business, for their reply.
        const contact = (await db.collection("whatsappContacts")
            .doc("+12015550001").get()).data();
        assert.equal(contact.businesses[BIZ].businessName, "Dala Parking");
      });

  it("keeps each invoice PDF in Storage, and serves it on the signed " +
      "link", async () => {
    await turnOn();
    await seedLot();
    await send();
    const [files] = await bucket().getFiles(
        {prefix: `parkingInvoices/${BIZ}/${MONTH}/`});
    assert.deepEqual(files.map((f) => f.name).sort(), [
      `parkingInvoices/${BIZ}/${MONTH}/12015550001.pdf`,
      `parkingInvoices/${BIZ}/${MONTH}/12015550002.pdf`,
      `parkingInvoices/${BIZ}/${MONTH}/12015550005.pdf`,
    ]);
    const alimou = sent.find((body) => body.to === "12015550001");
    const res = await open(invoiceLinkOf(alimou));
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "application/pdf");
    assert.equal(res.headers["content-disposition"],
        "inline; filename=\"Invoice INV-202610-0001-1.pdf\"");
    const bytes = Buffer.from(res.body);
    assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
    assert.ok(bytes.length > 1000);
    const [stored] = await bucket().file(
        `parkingInvoices/${BIZ}/${MONTH}/12015550001.pdf`).download();
    assert.deepEqual(stored, bytes);
  });

  it("refuses an expired, forged, stretched or another customer's link, " +
      "and an unknown token", async () => {
    await turnOn();
    await seedLot();
    await send();
    const link = invoiceLinkOf(sent.find((b) => b.to === "12015550001"));
    const url = new URL(link);
    const token = url.searchParams.get("t");
    assert.equal((await open(link)).statusCode, 200);

    const expired = packageProof.invoiceLink({base: BASE, token,
      phoneDigits: "12015550001", expiresMs: THIRD - 1000});
    assert.equal((await open(expired)).statusCode, 404);

    const forged = new URL(link);
    forged.searchParams.set("s", "0".repeat(24));
    assert.equal((await open(forged.toString())).statusCode, 404);

    const stretched = new URL(link);
    stretched.searchParams.set("e",
        String(Number(url.searchParams.get("e")) + 86400000));
    assert.equal((await open(stretched.toString())).statusCode, 404);

    // Somebody else's number with this customer's signature.
    const other = new URL(link);
    other.searchParams.set("p", "12015550002");
    assert.equal((await open(other.toString())).statusCode, 404);

    // A number nobody was sent an invoice for, validly signed: no file.
    const nobody = packageProof.invoiceLink({base: BASE, token,
      phoneDigits: "12015559999", expiresMs: THIRD + 86400000});
    assert.equal((await open(nobody)).statusCode, 404);

    const unknown = packageProof.invoiceLink({base: BASE,
      token: "x".repeat(32), phoneDigits: "12015550001",
      expiresMs: THIRD + 86400000});
    assert.equal((await open(unknown)).statusCode, 404);
  });

  it("goes to each customer once, however often it is pressed",
      async () => {
        await turnOn();
        await seedLot();
        await send();
        assert.equal(sent.length, 3);
        const again = await send();
        assert.deepEqual(again, {success: true, monthKey: MONTH, sent: 0,
          failed: 0, stopped: 0, alreadySent: 3, remaining: 0, skipped: 1});
        assert.equal(sent.length, 3);
        assert.equal((await invoiceRows()).length, 3);
      });

  it("goes out once even when pressed twice at the same time", async () => {
    await turnOn();
    await seedLot();
    const results = await Promise.allSettled([send(), send()]);
    assert.ok(results.some((r) => r.status === "fulfilled"));
    for (const r of results) {
      if (r.status === "rejected") {
        assert.equal(r.reason.details?.reason, "invoices_sending");
      }
    }
    assert.equal(sent.length, 3);
    assert.equal((await invoiceRows()).length, 3);
  });

  it("refuses while another send holds the run, and takes over a send " +
      "that died", async () => {
    await turnOn();
    await seedLot();
    await call("invoices_preview");
    // The owner pressed Send once (the run now exists), then it died while
    // sending.
    await send(OWNER, {phones: ["+12015559999"]});
    await runRef().update({status: "sending", sendingAtMs: THIRD - 60000,
      sendingBy: "someone"});
    await assert.rejects(send(),
        refusal("failed-precondition", "invoices_sending"));
    assert.deepEqual(sent, []);
    await runRef().update({sendingAtMs: THIRD - 11 * 60000});
    assert.equal((await send()).sent, 3);
    assert.equal((await runDoc()).status, "sent");
  });

  it("sends only to the numbers asked for, and the rest are not sent by " +
      "themselves", async () => {
    await turnOn();
    await seedLot();
    const result = await send(OWNER, {phones: ["+1 (201) 555-0001"]});
    assert.equal(result.sent, 1);
    assert.deepEqual(sentTo(), ["12015550001"]);
    // The owner chose: the run is closed, whoever was left out stays out.
    assert.equal((await runDoc()).status, "sent");
    clock(THIRD_MIDNIGHT + 3600000);
    await functions.sweepPackageRequests.run({});
    assert.deepEqual(sentTo(), ["12015550001"]);
  });

  it("recomputes at send time: a customer who has paid since the preview " +
      "is not sent one", async () => {
    await turnOn();
    const {a} = await seedLot();
    assert.equal((await preview()).recipients.length, 3);
    await db.collection("parkedCars").doc(a)
        .update({amountPaidCents: 10000, paymentStatus: "succeeded"});
    const result = await send();
    assert.equal(result.sent, 2);
    assert.deepEqual(sentTo(), ["12015550002", "12015550005"]);
  });

  it("tries a failed invoice again, and reports STOP", async () => {
    await turnOn();
    await seedLot();
    failNext = 131026;
    await db.collection("whatsappStops").doc("+12015550005")
        .set({stopped: true, phone: "+12015550005"});
    const first = await send();
    assert.equal(first.failed, 1);
    assert.equal(first.stopped, 1);
    assert.equal(first.sent, 1);
    const failed = (await invoiceRows()).find((r) => r.status === "failed");
    assert.equal(failed.errorCode, 131026);
    assert.match(failed.error, /nope/);
    let stored = await runDoc();
    assert.equal(stored.sent, 1);
    assert.equal(stored.failed, 2);
    const retry = await send();
    assert.equal(retry.sent, 1);
    assert.equal(retry.stopped, 1);
    assert.equal(retry.alreadySent, 1);
    stored = await runDoc();
    assert.equal(stored.sent, 2);
    assert.equal(stored.failed, 1);
    assert.equal((await invoiceRows()).filter((r) => r.status === "sent")
        .length, 2);
  });

  it("is the owner's, needs the switch on, and only the month that " +
      "just ended", async () => {
    await assert.rejects(send(),
        refusal("failed-precondition", "parking_whatsapp_off"));
    await turnOn();
    await assert.rejects(send(STAFF),
        refusal("permission-denied", "invoices_owner_only"));
    await assert.rejects(send(OTHER_OWNER),
        (error) => error.code === "permission-denied");
    for (const monthKey of ["2026-09", "2026-11", "", undefined, "2026-1"]) {
      await assert.rejects(call("invoices_send", OWNER, {monthKey}),
          refusal("failed-precondition", "invoice_month_invalid"));
    }
    assert.deepEqual(sent, []);
    assert.deepEqual(await rowsOf(), []);
    assert.equal((await runRef().get()).exists, false);
  });

  it("goes by New York's calendar: until midnight on the 1st the month " +
      "has not ended", async () => {
    await turnOn();
    await seedLot();
    // 11 pm on Oct 31 in New York is Nov 1 in UTC.
    clock(Date.parse("2026-11-01T03:30:00Z"));
    await assert.rejects(send(),
        refusal("failed-precondition", "invoice_month_invalid"));
    clock(Date.parse("2026-11-01T04:30:00Z"));
    assert.equal((await send()).sent, 3);
  });

  it("keeps going next time when a call's limit cuts it short", async () => {
    await turnOn();
    await seedLot();
    parkingInvoices.INVOICES_MAX_PER_CALL = 2;
    const first = await send();
    assert.equal(first.sent, 2);
    assert.equal(first.remaining, 1);
    // Nobody picked who: the rest is still the automatic send's.
    assert.equal((await runDoc()).status, "ready");
    assert.equal((await runDoc()).remaining, 1);
    const second = await send();
    assert.equal(second.sent, 1);
    assert.equal(second.remaining, 0);
    assert.equal((await runDoc()).status, "sent");
    assert.equal(sent.length, 3);
  });
});

describe("payment instructions", () => {
  const setText = (text, uid = OWNER) =>
    call("set_payment_instructions", uid, {text});

  it("are saved on the business, trimmed", async () => {
    const result = await setText("  Pay at the office, or Zelle 347-559-6214 ");
    assert.deepEqual(result, {success: true,
      paymentInstructions: "Pay at the office, or Zelle 347-559-6214"});
    const business = (await db.collection("businesses").doc(BIZ).get())
        .data();
    assert.equal(business.paymentInstructions,
        "Pay at the office, or Zelle 347-559-6214");
  });

  it("need no switch, can be cleared, and ride in the next message",
      async () => {
        await setText("Zelle 347-559-6214");
        await turnOn();
        await seedLot();
        await send(OWNER, {phones: ["+12015550001"]});
        assert.equal(receiptBody(sent[0])[7], "Zelle 347-559-6214");
        await setText("");
        await send(OWNER, {phones: ["+12015550005"]});
        // No text: a dash in the message.
        assert.equal(receiptBody(sent[1])[7], "—");
        assert.equal((await db.collection("businesses").doc(BIZ).get())
            .data().paymentInstructions, "");
      });

  it("are the owner's (or a platform admin's), not staff's", async () => {
    await assert.rejects(setText("Zelle", STAFF),
        refusal("permission-denied", "invoices_owner_only"));
    await assert.rejects(setText("Zelle", OTHER_OWNER),
        (error) => error.code === "permission-denied");
    assert.equal((await setText("Zelle", PLATFORM_ADMIN)).success, true);
  });

  it("are plain text of at most 300 characters", async () => {
    assert.equal((await setText("x".repeat(300))).success, true);
    for (const bad of ["x".repeat(301), 5, {a: 1}, ["x"]]) {
      await assert.rejects(setText(bad),
          refusal("invalid-argument", "payment_instructions_invalid"));
    }
    assert.equal((await db.collection("businesses").doc(BIZ).get())
        .data().paymentInstructions.length, 300);
  });
});

describe("the automatic send from the 3rd", () => {
  const prepare = async () => {
    clock(FIRST);
    await functions.notifyParkingMonthEnd.run({});
  };
  const sweep = async (ms) => {
    clock(ms);
    await functions.sweepPackageRequests.run({});
  };

  it("sends a month nobody sent, on the 3rd New York time and not " +
      "before", async () => {
    await turnOn();
    await seedLot();
    await prepare();
    assert.equal((await runDoc()).status, "ready");
    await sweep(FIRST + 3600000);
    await sweep(SECOND);
    // 11:59:59 pm on the 2nd in New York.
    await sweep(BEFORE_THIRD);
    assert.deepEqual(sent, []);
    assert.equal((await runDoc()).status, "ready");

    await sweep(THIRD_MIDNIGHT);
    assert.deepEqual(sentTo(),
        ["12015550001", "12015550002", "12015550005"]);
    const stored = await runDoc();
    assert.equal(stored.status, "sent");
    assert.equal(stored.sentBy, "auto");
    assert.equal(stored.sentAtMs, THIRD_MIDNIGHT);
    assert.equal(stored.sent, 3);
    const rows = await invoiceRows();
    assert.deepEqual([...new Set(rows.map((r) => r.sentByUid))], ["auto"]);
    assert.ok(invoiceLinkOf(sent[0]).includes("view=invoicePdf"));
    assert.equal((await open(invoiceLinkOf(sent[0]))).statusCode, 200);
  });

  it("never sends twice: not on the next sweep, nor on two at once",
      async () => {
        await turnOn();
        await seedLot();
        await prepare();
        clock(THIRD_MIDNIGHT);
        await Promise.all([functions.sweepPackageRequests.run({}),
          functions.sweepPackageRequests.run({})]);
        assert.equal(sent.length, 3);
        await sweep(THIRD_MIDNIGHT + 3600000);
        await sweep(THIRD);
        await sweep(THIRD + 20 * 86400000);
        assert.equal(sent.length, 3);
        assert.equal((await invoiceRows()).length, 3);
        assert.equal((await runDoc()).status, "sent");
      });

  it("leaves a month the owner already sent alone", async () => {
    await turnOn();
    await seedLot();
    await prepare();
    clock(SECOND);
    await send();
    assert.equal(sent.length, 3);
    await sweep(THIRD_MIDNIGHT);
    assert.equal(sent.length, 3);
    const stored = await runDoc();
    assert.equal(stored.sentBy, OWNER);
    assert.equal(stored.sentAtMs, SECOND);
  });

  it("sends nothing by itself once the switch is off again", async () => {
    await turnOn();
    await seedLot();
    await prepare();
    await turnOff();
    await sweep(THIRD_MIDNIGHT);
    assert.deepEqual(sent, []);
    assert.equal((await runDoc()).status, "ready");
  });

  it("has nothing to send for a lot that was never prepared", async () => {
    await seedLot();
    await prepare();
    await turnOn();
    await sweep(THIRD_MIDNIGHT);
    assert.deepEqual(sent, []);
    assert.equal((await runRef().get()).exists, false);
  });

  it("does not send an old month's run: only the month that just ended",
      async () => {
        await turnOn();
        await seedLot();
        await prepare();
        // Dec 3: the month that just ended is November.
        await sweep(Date.parse("2026-12-03T15:00:00Z"));
        assert.deepEqual(sent, []);
        assert.equal((await runDoc()).status, "ready");
      });

  it("carries on with what a limit left over, on the next sweep",
      async () => {
        await turnOn();
        await seedLot();
        await prepare();
        parkingInvoices.INVOICES_MAX_PER_CALL = 2;
        await sweep(THIRD_MIDNIGHT);
        assert.equal(sent.length, 2);
        assert.equal((await runDoc()).status, "ready");
        await sweep(THIRD_MIDNIGHT + 3600000);
        assert.equal(sent.length, 3);
        assert.equal((await runDoc()).status, "sent");
        await sweep(THIRD_MIDNIGHT + 2 * 3600000);
        assert.equal(sent.length, 3);
      });

  it("takes over a run whose sender died, after ten minutes", async () => {
    await turnOn();
    await seedLot();
    await prepare();
    await runRef().update({status: "sending",
      sendingAtMs: THIRD_MIDNIGHT - 5 * 60000, sendingBy: "auto"});
    await sweep(THIRD_MIDNIGHT);
    assert.deepEqual(sent, []);
    await sweep(THIRD_MIDNIGHT + 6 * 60000);
    assert.equal(sent.length, 3);
    assert.equal((await runDoc()).status, "sent");
  });

  it("is isolated per lot: another lot's run does not stop this one's",
      async () => {
        await turnOn();
        await seedLot();
        await prepare();
        // A run for a lot that no longer exists.
        await db.collection("parkingInvoiceRuns").doc(`ghost_${MONTH}`).set({
          businessId: "ghost", monthKey: MONTH, status: "ready",
          documentToken: "g".repeat(32), recipients: 1, totalDueCents: 1});
        await sweep(THIRD_MIDNIGHT);
        assert.equal(sent.length, 3);
        assert.equal((await db.collection("parkingInvoiceRuns")
            .doc(`ghost_${MONTH}`).get()).data().status, "ready");
      });
});
