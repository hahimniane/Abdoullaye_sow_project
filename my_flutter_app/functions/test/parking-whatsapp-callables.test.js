"use strict";

// Parking customers on WhatsApp (docs/PARKING_WHATSAPP.md) end to end against
// the Auth, Firestore and Storage emulators: the switch, the "parked" message
// when a car is created, a receipt with a PDF for every payment, the signed
// /d receipt link, delivery ticks, and the welcome to cars already parked.
// Meta is a fake `fetch`.
//
// Run through `npm run test:parking-whatsapp` (firebase emulators:exec).

/* global globalThis */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {before, beforeEach, describe, it} = require("node:test");
const admin = require("firebase-admin");

// This suite writes with ADMIN credentials: never against a real project.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
      "Run this through `npm run test:parking-whatsapp` (firebase " +
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
  return realFetch(url, init);
};

const functions = require("../index");
const packageProof = require("../package_proof");
const parkingWhatsApp = require("../parking_whatsapp");
const {
  OPEN_ENDED_OCCUPANCY_END_MS,
} = require("../parking_occupancy");
admin.auth().getUser = async (uid) => ({
  uid, email: `${uid}@example.test`, emailVerified: true});
const db = admin.firestore();
const {Timestamp} = admin.firestore;

const BIZ = "pkwa-lot";
const OTHER_BIZ = "pkwa-other-lot";
const OWNER = "pkwa-owner";
const STAFF = "pkwa-staff";
const OTHER_OWNER = "pkwa-other-owner";
const PLATFORM_ADMIN = "pkwa-admin";
const PHONE = "+12015551234";
const DAY = 24 * 60 * 60 * 1000;
const BASE = `https://us-central1-${process.env.GCLOUD_PROJECT}` +
  ".cloudfunctions.net/parkingDocument";

const run = (name, uid, data) => functions[name].run({
  auth: {uid, token: {}}, data, rawRequest: {}});

const refusal = (code, reason) => (error) => {
  assert.equal(error.code, code, error.message);
  assert.equal(error.details?.reason, reason, error.message);
  return true;
};

const carRef = (id) => db.collection("parkedCars").doc(id);
const car = async (id) => (await carRef(id).get()).data();
const row = async (id) =>
  (await db.collection("parkingMessages").doc(id).get()).data();
const rowsOf = async () =>
  (await db.collection("parkingMessages").get()).docs
      .map((doc) => ({id: doc.id, ...doc.data()}));

let seq = 0;
/**
 * Seeds a business-entered car parked since ten days ago, open-ended, $10 a
 * day, and returns its id. No trigger runs for it.
 *
 * @param {object} overrides Fields to change.
 * @return {Promise<string>} Its id.
 */
async function seedCar(overrides = {}) {
  seq += 1;
  const id = `pkwa-car-${Date.now()}-${seq}`;
  const parked = new Date(Date.now() - 9 * DAY);
  const left = overrides.parkingEndDate;
  await carRef(id).set({
    // What the trigger stamps (the welcome finds cars by it).
    occupancyEndMs: left ? left.toMillis() : OPEN_ENDED_OCCUPANCY_END_MS,
    businessId: BIZ,
    businessName: "Dala Parking",
    source: "business",
    enteredByBusiness: true,
    trackingCode: `PK-WA${String(seq).padStart(4, "0")}`,
    status: "reserved",
    customerName: "Alimou Barry",
    customerPhone: PHONE,
    carMake: "Toyota", carModel: "Corolla", carYear: "2014",
    vinNumber: "1HGCM82633A004352",
    paymentMethod: "direct",
    paymentStatus: "awaiting_direct_payment",
    dailyRate: 10,
    dailyRateCents: 1000,
    amountDue: 0, amountDueCents: 0, totalCost: 0, totalCostCents: 0,
    amountPaidCents: 0,
    parkingDate: Timestamp.fromDate(parked),
    createdAt: Timestamp.now(),
    ...overrides,
  });
  return id;
}

/**
 * Runs syncParkedCarOccupancy as Firestore would for one write.
 *
 * @param {string} id The car.
 * @param {?object} previous The car's data before the write (null: created).
 * @param {object} [event] Extra event fields (`time`).
 * @return {Promise<void>}
 */
async function trigger(id, previous, event = {}) {
  const snap = await carRef(id).get();
  await functions.syncParkedCarOccupancy.run({
    params: {parkedCarId: id}, ...event,
    data: {
      before: previous ? {exists: true, data: () => previous} :
        {exists: false, data: () => null},
      after: {exists: true, data: () => snap.data(), ref: snap.ref,
        updateTime: snap.updateTime},
    },
  });
}

/**
 * Applies a change to a car the way a callable would, then runs the trigger
 * with the before and after.
 *
 * @param {string} id The car.
 * @param {object} change Fields to set.
 * @return {Promise<object>} The car as it was before.
 */
async function changeAndTrigger(id, change) {
  const previous = await car(id);
  await carRef(id).update(change);
  await trigger(id, previous);
  return previous;
}

async function turnOn(businessId = BIZ, enabledAtMs = Date.now() - 1000) {
  await db.collection("businesses").doc(businessId).update({
    parkingWhatsApp: {enabled: true, enabledAtMs, enabledByUid: OWNER}});
}

async function turnOff(businessId = BIZ) {
  await db.collection("businesses").doc(businessId).update({
    parkingWhatsApp: admin.firestore.FieldValue.delete()});
}

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

/**
 * Opens a receipt link on the /d endpoint.
 *
 * @param {string} link The link a message carried.
 * @return {Promise<object>} The response.
 */
async function open(link) {
  const query = Object.fromEntries(new URL(link).searchParams);
  const res = fakeRes();
  await functions.parkingDocument({method: "GET", query, headers: {},
    on: () => {}, once: () => {}}, res);
  return res;
}

const receiptLinkOf = (body) =>
  body.template.components[0].parameters[0].document.link;
const bodyTexts = (body) => body.template.components
    .find((part) => part.type === "body").parameters.map((p) => p.text);

function signedStatus(wamid, status) {
  const raw = Buffer.from(JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{id: "992521863149970", changes: [{field: "messages", value: {
      statuses: [{id: wamid, status, recipient_id: PHONE.slice(1),
        timestamp: "1793200000"}]}}]}]}));
  const signature = "sha256=" + crypto.createHmac("sha256",
      process.env.WHATSAPP_APP_SECRET).update(raw).digest("hex");
  return {method: "POST", rawBody: raw, query: {}, body: {}, url: "/",
    headers: {"x-hub-signature-256": signature},
    on: () => {}, once: () => {},
    get: (name) => ({"x-hub-signature-256": signature})[
        String(name).toLowerCase()] || "",
    header: (name) => ({"x-hub-signature-256": signature})[
        String(name).toLowerCase()] || ""};
}

async function clear() {
  for (const name of ["parkingMessages", "whatsappContacts",
    "whatsappStops", "whatsappTemplateCounts", "parkedCars"]) {
    const snap = await db.collection(name).get();
    await Promise.all(snap.docs.map((doc) => doc.ref.delete()));
  }
  await turnOff();
  sent.length = 0;
  failNext = 0;
}

before(async () => {
  await Promise.all([
    db.collection("businesses").doc(BIZ).set({
      name: "Dala Parking", status: "approved", ownerUid: OWNER,
      country: "United States", phone: "+13475550100",
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
});

beforeEach(clear);

describe("the switch (set_parking_whatsapp)", () => {
  it("is off by default, so nothing is sent for a new car", async () => {
    const id = await seedCar();
    await trigger(id, null);
    assert.deepEqual(sent, []);
    assert.deepEqual(await rowsOf(), []);
  });

  it("is turned on by the owner, with when and by whom", async () => {
    const result = await run("updateBusinessParkingEntry", OWNER,
        {action: "set_parking_whatsapp", businessId: BIZ, enabled: true});
    assert.equal(result.success, true);
    assert.equal(result.enabled, true);
    const stored = (await db.collection("businesses").doc(BIZ).get()).data()
        .parkingWhatsApp;
    assert.equal(stored.enabled, true);
    assert.equal(stored.enabledByUid, OWNER);
    assert.ok(Math.abs(stored.enabledAtMs - Date.now()) < 60000);
    // A second "on" keeps the first moment.
    await run("updateBusinessParkingEntry", OWNER,
        {action: "set_parking_whatsapp", businessId: BIZ, enabled: true});
    const again = (await db.collection("businesses").doc(BIZ).get()).data()
        .parkingWhatsApp;
    assert.equal(again.enabledAtMs, stored.enabledAtMs);
    await turnOff();
  });

  it("is turned off again, keeping when it was on", async () => {
    await turnOn();
    await run("updateBusinessParkingEntry", OWNER,
        {action: "set_parking_whatsapp", businessId: BIZ, enabled: false});
    const stored = (await db.collection("businesses").doc(BIZ).get()).data()
        .parkingWhatsApp;
    assert.equal(stored.enabled, false);
    assert.equal(stored.disabledByUid, OWNER);
    assert.ok(stored.enabledAtMs > 0);
    const id = await seedCar();
    await trigger(id, null);
    assert.deepEqual(sent, []);
  });

  it("is the owner's or a platform admin's, not staff's", async () => {
    await assert.rejects(run("updateBusinessParkingEntry", STAFF,
        {action: "set_parking_whatsapp", businessId: BIZ, enabled: true}),
    refusal("permission-denied", "parking_whatsapp_owner_only"));
    await assert.rejects(run("updateBusinessParkingEntry", OTHER_OWNER,
        {action: "set_parking_whatsapp", businessId: BIZ, enabled: true}),
    (error) => error.code === "permission-denied");
    const result = await run("updateBusinessParkingEntry", PLATFORM_ADMIN,
        {action: "set_parking_whatsapp", businessId: BIZ, enabled: true});
    assert.equal(result.enabled, true);
    await turnOff();
    const stored = (await db.collection("businesses").doc(BIZ).get()).data();
    assert.equal(stored.parkingWhatsApp, undefined);
  });

  it("needs a business", async () => {
    await assert.rejects(run("updateBusinessParkingEntry", OWNER,
        {action: "set_parking_whatsapp", enabled: true}),
    refusal("invalid-argument", "business_required"));
  });
});

describe("a car is parked", () => {
  it("welcomes the customer once, however often the event arrives",
      async () => {
        await turnOn();
        const id = await seedCar();
        await trigger(id, null);
        await trigger(id, null);
        assert.equal(sent.length, 1);
        const body = sent[0];
        assert.equal(body.to, "12015551234");
        assert.equal(body.template.name, "parking_parked_2lang");
        assert.deepEqual(body.template.language, {code: "en"});
        const texts = bodyTexts(body);
        assert.equal(texts.length, 11);
        assert.equal(texts[0], "Alimou Barry");
        assert.equal(texts[1], "Dala Parking");
        assert.equal(texts[2], "2014 Toyota Corolla");
        assert.equal(texts[4], "$10.00 a day");
        assert.equal(texts[8], "10,00 $ par jour");
        assert.equal(texts[9], "+13475550100");
        const stored = await car(id);
        assert.equal(texts[10], stored.trackingCode);
        const button = body.template.components[1];
        assert.equal(button.sub_type, "url");
        assert.deepEqual(button.parameters,
            [{type: "text", text: stored.trackingCode}]);

        const message = await row(`${id}_parked`);
        assert.equal(message.status, "sent");
        assert.equal(message.kind, "parked");
        assert.equal(message.businessId, BIZ);
        assert.equal(message.parkedCarId, id);
        assert.equal(message.phone, PHONE);
        assert.equal(message.wamid, "wamid.out.1");
        assert.equal(message.whatsappMessageId, "wamid.out.1");
        assert.equal(message.attempts, 1);
        assert.equal(message.error, "");
        assert.ok(message.sentAt && message.createdAt);
      });

  it("records the customer as this business's contact, for their reply",
      async () => {
        await turnOn();
        const id = await seedCar();
        await trigger(id, null);
        const contact = (await db.collection("whatsappContacts").doc(PHONE)
            .get()).data();
        assert.equal(contact.businesses[BIZ].businessName, "Dala Parking");
        assert.equal(contact.businesses[BIZ].trackingCode,
            (await car(id)).trackingCode);
      });

  it("says nothing about an edit, a later write, or an old car", async () => {
    await turnOn();
    const id = await seedCar();
    const previous = await car(id);
    await carRef(id).update({customerName: "Alimou B."});
    await trigger(id, previous);
    assert.deepEqual(sent, []);
    // A car created before the switch was turned on is not announced.
    const old = await seedCar();
    await trigger(old, null, {time: new Date(Date.now() - 3600000)
        .toISOString()});
    assert.deepEqual(sent, []);
  });

  it("says nothing about a voided car or a customer's own reservation",
      async () => {
        await turnOn();
        const voided = await seedCar({voided: true});
        const online = await seedCar({source: "customer",
          enteredByBusiness: false});
        await trigger(voided, null);
        await trigger(online, null);
        assert.deepEqual(sent, []);
        assert.deepEqual(await rowsOf(), []);
      });

  it("keeps a skipped row when there is no number to reach", async () => {
    await turnOn();
    const none = await seedCar({customerPhone: ""});
    const local = await seedCar({customerPhone: "620123456"});
    await trigger(none, null);
    await trigger(local, null);
    assert.deepEqual(sent, []);
    assert.deepEqual([(await row(`${none}_parked`)),
      (await row(`${local}_parked`))].map((r) => [r.status, r.error]),
    [["skipped", "no_phone"], ["skipped", "needs_country_code"]]);
  });

  it("reads a US lot's 10-digit number as +1", async () => {
    await turnOn();
    const id = await seedCar({customerPhone: "(201) 555-1234"});
    await trigger(id, null);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "12015551234");
  });

  it("keeps a refused message on its row and never retries it", async () => {
    await turnOn();
    const id = await seedCar();
    failNext = 131026;
    await trigger(id, null);
    await trigger(id, null);
    assert.deepEqual(sent, []);
    const message = await row(`${id}_parked`);
    assert.equal(message.status, "failed");
    assert.equal(message.errorCode, 131026);
    assert.match(message.error, /nope/);
    assert.equal(message.wamid, "");
  });

  it("marks a customer who replied STOP, and sends nothing", async () => {
    await turnOn();
    await db.collection("whatsappStops").doc(PHONE)
        .set({stopped: true, phone: PHONE});
    const id = await seedCar();
    await trigger(id, null);
    assert.deepEqual(sent, []);
    assert.equal((await row(`${id}_parked`)).status, "stopped");
  });

  it("never throws, even when the business is gone", async () => {
    const id = await seedCar({businessId: "no-such-lot"});
    await trigger(id, null);
    assert.deepEqual(sent, []);
  });

  it("still does the occupancy work", async () => {
    await turnOn();
    const id = await seedCar();
    await trigger(id, null);
    assert.equal(typeof (await car(id)).occupancyEndMs, "number");
  });
});

describe("a payment is recorded", () => {
  const partial = (id, amountCents, via = "zelle") =>
    run("recordBusinessParkingPartialPayment", STAFF, {
      entryId: id, amountCents, receivedVia: via,
      receivedByStaffId: STAFF});

  it("sends a receipt with the PDF, once per payment", async () => {
    await turnOn();
    const id = await seedCar();
    await trigger(id, null);
    sent.length = 0;

    const previous = await car(id);
    await partial(id, 3000);
    await trigger(id, previous);
    await trigger(id, previous);
    assert.equal(sent.length, 1);
    const body = sent[0];
    assert.equal(body.template.name, "parking_receipt_2lang");
    const header = body.template.components[0];
    assert.equal(header.type, "header");
    assert.equal(header.parameters[0].type, "document");
    const link = header.parameters[0].document.link;
    assert.ok(link.startsWith(`${BASE}?view=receiptPdf&t=`), link);
    const stored = await car(id);
    assert.match(header.parameters[0].document.filename,
        new RegExp(`^Receipt ${stored.trackingCode} [A-Z][a-z]{2} \\d{1,2}` +
          "\\.pdf$"));
    // 10 days at $10 so far, $30 paid.
    assert.deepEqual(bodyTexts(body), [
      "Alimou Barry",
      "Dala Parking", "$30.00", "2014 Toyota Corolla", "$30.00",
      "Balance owed: $70.00",
      "Dala Parking", "30,00 $", "2014 Toyota Corolla", "30,00 $",
      "Solde à payer : 70,00 $",
      stored.trackingCode,
    ]);
    // The document token the link is signed with was minted on the car.
    assert.ok(String(stored.documentToken).length >= 32);
    assert.ok(link.includes(`t=${stored.documentToken}`));

    const rows = (await rowsOf()).filter((r) => r.kind === "receipt");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "sent");
    assert.equal(rows[0].amountCents, 3000);
    assert.equal(rows[0].receiptNumber, 1);
    assert.equal(rows[0].id, `${id}_pay_${rows[0].paymentId}`);
    assert.equal(rows[0].wamid, "wamid.out.1");

    // The next payment is its own receipt, with the corrected totals.
    const second = await car(id);
    await partial(id, 2000, "cash");
    await trigger(id, second);
    assert.equal(sent.length, 2);
    assert.equal(bodyTexts(sent[1])[2], "$20.00");
    assert.equal(bodyTexts(sent[1])[4], "$50.00");
    assert.equal(bodyTexts(sent[1])[5], "Balance owed: $50.00");
    assert.equal((await rowsOf()).filter((r) => r.kind === "receipt").length,
        2);
  });

  it("serves the receipt PDF on the signed link", async () => {
    await turnOn();
    const id = await seedCar();
    await trigger(id, null);
    sent.length = 0;
    const previous = await car(id);
    await partial(id, 3000);
    await trigger(id, previous);
    const link = receiptLinkOf(sent[0]);
    const res = await open(link);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "application/pdf");
    assert.match(res.headers["content-disposition"],
        /^inline; filename="Receipt PK-WA\d{4} [A-Z][a-z]{2} \d{1,2}\.pdf"$/);
    assert.equal(Buffer.from(res.body).subarray(0, 4).toString(), "%PDF");
    assert.ok(Buffer.from(res.body).length > 1000);
  });

  it("refuses an expired, forged, wrong or unknown link, and a voided car",
      async () => {
        await turnOn();
        const id = await seedCar();
        await trigger(id, null);
        sent.length = 0;
        const previous = await car(id);
        await partial(id, 3000);
        await trigger(id, previous);
        const link = receiptLinkOf(sent[0]);
        const url = new URL(link);
        const token = url.searchParams.get("t");
        const paymentId = url.searchParams.get("p");

        const expired = packageProof.receiptLink({base: BASE, token,
          paymentId, expiresMs: Date.now() - 1000});
        assert.equal((await open(expired)).statusCode, 404);

        const forged = new URL(link);
        forged.searchParams.set("s", "0".repeat(24));
        assert.equal((await open(forged.toString())).statusCode, 404);

        const stretched = new URL(link);
        stretched.searchParams.set("e",
            String(Number(url.searchParams.get("e")) + DAY));
        assert.equal((await open(stretched.toString())).statusCode, 404);

        const other = packageProof.receiptLink({base: BASE, token,
          paymentId: "p_notapayment", expiresMs: Date.now() + DAY});
        assert.equal((await open(other)).statusCode, 404);

        const unknownToken = "x".repeat(32);
        const unknown = packageProof.receiptLink({base: BASE,
          token: unknownToken, paymentId, expiresMs: Date.now() + DAY});
        assert.equal((await open(unknown)).statusCode, 404);

        assert.equal((await open(link)).statusCode, 200);
        await carRef(id).update({voided: true});
        assert.equal((await open(link)).statusCode, 404);
      });

  it("keeps the receipt PDF in Storage under parkingReceipts, per payment",
      async () => {
        await turnOn();
        const id = await seedCar();
        await trigger(id, null);
        const previous = await car(id);
        await partial(id, 1000);
        await trigger(id, previous);
        const stored = await car(id);
        const [files] = await admin.storage()
            .bucket(`${process.env.GCLOUD_PROJECT}.firebasestorage.app`)
            .getFiles({prefix: `parkingReceipts/${BIZ}/${id}/`});
        assert.equal(files.length, 1);
        assert.match(files[0].name, /\.pdf$/);
        assert.ok(stored.documentToken);
      });

  it("counts a payment marked paid in full as one receipt", async () => {
    await turnOn();
    const id = await seedCar({parkingEndDate: Timestamp.fromDate(
        new Date(Date.now() - 4 * DAY)),
    amountDue: 60, amountDueCents: 6000, totalCost: 60, totalCostCents: 6000});
    await trigger(id, null);
    sent.length = 0;
    const previous = await car(id);
    const result = await run("markBusinessParkingPaid", STAFF, {
      entryId: id, receivedVia: "cash", receivedByStaffId: STAFF});
    assert.equal(result.amountPaidCents, 6000);
    await trigger(id, previous);
    await trigger(id, previous);
    assert.equal(sent.length, 1);
    assert.equal(bodyTexts(sent[0])[2], "$60.00");
    assert.equal(bodyTexts(sent[0])[5], "Paid in full");
    assert.equal(bodyTexts(sent[0])[10], "Payé en totalité");
    const receipts = (await rowsOf()).filter((r) => r.kind === "receipt");
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0].amountCents, 6000);
  });

  it("sends nothing when a payment is reverted, and a receipt for the " +
      "next one shows corrected totals", async () => {
    await turnOn();
    const id = await seedCar();
    await trigger(id, null);
    const first = await car(id);
    await partial(id, 3000);
    await trigger(id, first);
    sent.length = 0;

    const paid = await car(id);
    await run("revertBusinessParkingPaid", STAFF, {entryId: id});
    await trigger(id, paid);
    assert.deepEqual(sent, []);
    assert.equal((await car(id)).parkingPayments.length, 0);

    const reverted = await car(id);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await partial(id, 1000);
    await trigger(id, reverted);
    assert.equal(sent.length, 1);
    assert.equal(bodyTexts(sent[0])[4], "$10.00");
    assert.equal(bodyTexts(sent[0])[5], "Balance owed: $90.00");
  });

  it("sends nothing for an edit, a voided car or a switched-off lot",
      async () => {
        await turnOn();
        const id = await seedCar();
        await trigger(id, null);
        sent.length = 0;
        await changeAndTrigger(id, {customerName: "Alimou B."});
        assert.deepEqual(sent, []);

        // Voided: the callable refuses the payment, so a payment written
        // some other way still says nothing.
        const voided = await seedCar({voided: true});
        await changeAndTrigger(voided, {parkingPayments: [{amountCents: 500,
          receivedVia: "cash", at: Timestamp.now()}]});
        assert.deepEqual(sent, []);

        await turnOff();
        const quiet = await seedCar();
        await changeAndTrigger(quiet, {parkingPayments: [{amountCents: 500,
          receivedVia: "cash", at: Timestamp.now()}]});
        assert.deepEqual(sent, []);
      });

  it("ticks the row when Meta reports delivery", async () => {
    await turnOn();
    const id = await seedCar();
    await trigger(id, null);
    const res = fakeRes();
    await functions.whatsappWebhook(signedStatus("wamid.out.1", "delivered"),
        res);
    assert.equal(res.statusCode, 200);
    assert.equal((await row(`${id}_parked`)).deliveryStatus, "delivered");
    await functions.whatsappWebhook(signedStatus("wamid.out.1", "read"),
        fakeRes());
    assert.equal((await row(`${id}_parked`)).deliveryStatus, "read");
  });
});

describe("the welcome to cars already parked", () => {
  const call = (action, uid = OWNER, extra = {}) =>
    run("updateBusinessParkingEntry", uid,
        {action, businessId: BIZ, ...extra});

  const seedLot = async () => {
    const a = await seedCar({customerName: "Alimou Barry",
      customerPhone: "+12015551234", carYear: "2014", carMake: "Toyota",
      carModel: "Corolla"});
    const b = await seedCar({customerName: "Alimou Barry",
      customerPhone: "(201) 555-1234", carYear: "2016", carMake: "Toyota",
      carModel: "RAV4",
      parkingDate: Timestamp.fromDate(new Date(Date.now() - 2 * DAY))});
    const c = await seedCar({customerName: "Fatou Diallo",
      customerPhone: "+12015559999", carYear: "2019", carMake: "Honda",
      carModel: "Civic"});
    await seedCar({customerPhone: "+12015550000", voided: true});
    await seedCar({customerPhone: "+12015550001",
      parkingEndDate: Timestamp.fromDate(new Date(Date.now() - 3 * DAY)),
      amountDue: 50, amountDueCents: 5000});
    await seedCar({customerPhone: "+12015550002", status: "cancelled"});
    await seedCar({customerName: "No Country", customerPhone: "620123456"});
    return {a, b, c};
  };

  it("is for the owner, and only with the switch on", async () => {
    await assert.rejects(call("welcome_preview"),
        refusal("failed-precondition", "parking_whatsapp_off"));
    await assert.rejects(call("welcome_send"),
        refusal("failed-precondition", "parking_whatsapp_off"));
    await turnOn();
    await assert.rejects(call("welcome_preview", STAFF),
        refusal("permission-denied", "welcome_owner_only"));
    await assert.rejects(call("welcome_send", STAFF),
        refusal("permission-denied", "welcome_owner_only"));
    await assert.rejects(call("welcome_preview", OTHER_OWNER),
        (error) => error.code === "permission-denied");
    assert.deepEqual(sent, []);
    assert.equal((await call("welcome_preview", PLATFORM_ADMIN)).success,
        true);
  });

  it("previews one recipient per phone, listing its cars", async () => {
    await turnOn();
    const {a, b, c} = await seedLot();
    const {recipients, skipped} = await call("welcome_preview");
    assert.equal(recipients.length, 2);
    const [alimou, fatou] = recipients;
    assert.equal(alimou.phone, "+12015551234");
    assert.equal(alimou.name, "Alimou Barry");
    assert.deepEqual(alimou.cars.map((car2) => [car2.id, car2.label]),
        [[b, "2016 Toyota RAV4"], [a, "2014 Toyota Corolla"]]);
    assert.equal(alimou.cars[0].trackingCode, alimou.trackingCode);
    assert.equal(alimou.alreadyWelcomed, false);
    assert.deepEqual(fatou.cars.map((car2) => car2.id), [c]);
    assert.deepEqual(skipped.map((s) => s.reason), ["needs_country_code"]);
    // A preview sends and writes nothing.
    assert.deepEqual(sent, []);
    assert.deepEqual(await rowsOf(), []);
  });

  it("flags a number already told its car was parked", async () => {
    await turnOn();
    const a = await seedCar({customerPhone: "+12015551234"});
    await seedCar({customerPhone: "+12015559999", customerName: "Fatou"});
    await trigger(a, null);
    sent.length = 0;
    const {recipients} = await call("welcome_preview");
    assert.deepEqual(recipients.map((r) => [r.phone, r.alreadyWelcomed]),
        [["+12015551234", true], ["+12015559999", false]]);
  });

  it("sends one message per phone, once", async () => {
    await turnOn();
    const {b} = await seedLot();
    const result = await call("welcome_send");
    assert.deepEqual(result, {success: true, sent: 2, failed: 0, stopped: 0,
      skipped: 1, alreadyWelcomed: 0, remaining: 0});
    assert.equal(sent.length, 2);
    const first = sent.find((body) => body.to === "12015551234");
    assert.equal(first.template.name, "parking_welcome_2lang");
    const texts = bodyTexts(first);
    assert.deepEqual(texts, [
      "Alimou Barry", "Dala Parking",
      "2016 Toyota RAV4 and 2014 Toyota Corolla",
      "Dala Parking",
      "2016 Toyota RAV4 et 2014 Toyota Corolla",
      "+13475550100",
    ]);
    // The Track button is that number's most recently parked car.
    assert.deepEqual(first.template.components[1].parameters,
        [{type: "text", text: (await car(b)).trackingCode}]);
    const stored = await row("welcome_pkwa-lot_12015551234");
    assert.equal(stored.status, "sent");
    assert.equal(stored.kind, "welcome");
    assert.equal(stored.phone, "+12015551234");
    assert.equal(stored.sentByUid, OWNER);
    assert.equal(stored.wamid.startsWith("wamid.out."), true);
    assert.equal((await rowsOf()).filter((r) => r.kind === "welcome").length,
        2);
    const contact = (await db.collection("whatsappContacts")
        .doc("+12015551234").get()).data();
    assert.equal(contact.businesses[BIZ].businessName, "Dala Parking");

    // Never twice.
    sent.length = 0;
    const again = await call("welcome_send");
    assert.deepEqual(again, {success: true, sent: 0, failed: 0, stopped: 0,
      skipped: 1, alreadyWelcomed: 2, remaining: 0});
    assert.deepEqual(sent, []);
  });

  it("sends only to the numbers asked for", async () => {
    await turnOn();
    await seedLot();
    const result = await call("welcome_send", OWNER,
        {phones: ["+1 (201) 555-9999"]});
    assert.equal(result.sent, 1);
    assert.deepEqual(sent.map((body) => body.to), ["12015559999"]);
  });

  it("tries a failed welcome again, and reports STOP", async () => {
    await turnOn();
    await seedCar({customerPhone: "+12015551234"});
    await seedCar({customerPhone: "+12015559999", customerName: "Fatou"});
    failNext = 131026;
    await db.collection("whatsappStops").doc("+12015559999")
        .set({stopped: true, phone: "+12015559999"});
    const first = await call("welcome_send");
    assert.equal(first.failed, 1);
    assert.equal(first.stopped, 1);
    assert.equal((await row("welcome_pkwa-lot_12015551234")).status,
        "failed");
    const retry = await call("welcome_send");
    assert.equal(retry.sent, 1);
    assert.equal(retry.stopped, 1);
    assert.equal((await row("welcome_pkwa-lot_12015551234")).status, "sent");
  });

  it("never welcomes a number twice across a car parked message and " +
      "the bulk welcome", async () => {
    await turnOn();
    const a = await seedCar({customerPhone: "+12015551234"});
    await trigger(a, null);
    sent.length = 0;
    const result = await call("welcome_send");
    assert.equal(result.sent, 0);
    assert.equal(result.alreadyWelcomed, 1);
    assert.deepEqual(sent, []);
  });
});

// ---------------------------------------------------------------------------
// The car left, Send on WhatsApp, a corrected number
// (docs/PARKING_LEFT_WHATSAPP.md)
// ---------------------------------------------------------------------------

const daysAgo = (n) => Timestamp.fromMillis(Date.now() - n * DAY);
const dayKeyOfMs = (ms) => new Date(ms).toISOString().slice(0, 10);

describe("the car leaves", () => {
  // Parked 9 days ago at $10 a day (seedCar); leaving 5 days ago is a
  // 5-day stay, $50.
  const leave = (id, when = daysAgo(5)) =>
    changeAndTrigger(id, {parkingEndDate: when});

  it("sends the stay statement once, however often the event arrives",
      async () => {
        await turnOn();
        const id = await seedCar();
        const previous = await leave(id);
        await trigger(id, previous);
        assert.equal(sent.length, 1);
        const body = sent[0];
        assert.equal(body.to, "12015551234");
        assert.equal(body.template.name, "parking_left_2lang");
        const header = body.template.components[0];
        assert.equal(header.type, "header");
        assert.equal(header.parameters[0].type, "document");
        const link = header.parameters[0].document.link;
        assert.ok(link.startsWith(`${BASE}?view=receiptPdf&t=`), link);
        const stored = await car(id);
        assert.equal(header.parameters[0].document.filename,
            `Invoice ${stored.trackingCode} ${
              new Intl.DateTimeFormat("en-US", {timeZone: "America/New_York",
                month: "short", day: "numeric"}).format(new Date())}.pdf`);
        assert.equal(body.template.components.length, 2, "no button");
        const endKey = dayKeyOfMs(stored.parkingEndDate.toMillis());
        assert.deepEqual(bodyTexts(body), [
          "Alimou Barry",
          "Dala Parking", "2014 Toyota Corolla",
          parkingWhatsApp.dayTextShort(endKey, "en"), "5 days", "$50.00",
          "$0.00", "Balance due: $50.00.",
          "Dala Parking", "2014 Toyota Corolla",
          parkingWhatsApp.dayTextShort(endKey, "fr"), "5 jours", "50,00 $",
          "0,00 $", "Solde à payer : 50,00 $.",
          "+13475550100",
        ]);
        const message = await row(`${id}_left_${endKey}`);
        assert.equal(message.status, "sent");
        assert.equal(message.kind, "left");
        assert.equal(message.template, "parking_left_2lang");
        assert.equal(message.parkedCarId, id);
        assert.equal(message.businessId, BIZ);
        assert.equal(message.endDayKey, endKey);
        assert.equal(message.wamid, "wamid.out.1");
        assert.equal((await rowsOf()).length, 1);
      });

  it("serves the statement PDF on the signed link: an invoice while " +
      "money is owed", async () => {
    await turnOn();
    const id = await seedCar();
    await leave(id);
    const res = await open(receiptLinkOf(sent[0]));
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "application/pdf");
    assert.match(res.headers["content-disposition"],
        /^inline; filename="Invoice PK-WA\d{4} [A-Z][a-z]{2} \d{1,2}\.pdf"$/);
    assert.equal(Buffer.from(res.body).subarray(0, 4).toString(), "%PDF");
    // A forged signature opens nothing.
    const forged = receiptLinkOf(sent[0]).replace(/s=[^&]+/, "s=abc");
    assert.equal((await open(forged)).statusCode, 404);
  });

  it("is a receipt, and says paid in full, when nothing is owed",
      async () => {
        await turnOn();
        await db.collection("businesses").doc(BIZ)
            .update({paymentInstructions: "Zelle 347-555-0100"});
        const id = await seedCar({amountPaidCents: 5000,
          paymentStatus: "paid"});
        await leave(id);
        const texts = bodyTexts(sent[0]);
        assert.equal(texts[6], "$50.00");
        assert.equal(texts[7], "Paid in full. Thank you!");
        assert.equal(texts[14], "Payé en totalité. Merci !");
        const res = await open(receiptLinkOf(sent[0]));
        assert.match(res.headers["content-disposition"], /Receipt PK-WA/);
        await db.collection("businesses").doc(BIZ)
            .update({paymentInstructions:
              admin.firestore.FieldValue.delete()});
      });

  it("tells how to pay when the owner wrote it", async () => {
    await turnOn();
    await db.collection("businesses").doc(BIZ)
        .update({paymentInstructions: "Zelle 347-555-0100"});
    const id = await seedCar();
    await leave(id);
    assert.equal(bodyTexts(sent[0])[7],
        "Balance due: $50.00. How to pay: Zelle 347-555-0100");
    assert.equal(bodyTexts(sent[0])[14],
        "Solde à payer : 50,00 $. Comment payer : Zelle 347-555-0100");
    await db.collection("businesses").doc(BIZ)
        .update({paymentInstructions: admin.firestore.FieldValue.delete()});
  });

  it("sends again when the end day is corrected, once per day", async () => {
    await turnOn();
    const id = await seedCar();
    await leave(id, daysAgo(5));
    assert.equal(sent.length, 1);
    await leave(id, daysAgo(4));
    assert.equal(sent.length, 2);
    assert.equal(bodyTexts(sent[1])[4], "6 days");
    assert.equal((await rowsOf()).filter((r) => r.kind === "left").length,
        2);
    // Back to the first day: that day was already sent.
    await leave(id, daysAgo(5));
    assert.equal(sent.length, 2);
  });

  it("sends nothing for an end date in the future, or an edit after it",
      async () => {
        await turnOn();
        const id = await seedCar();
        await leave(id, Timestamp.fromMillis(Date.now() + 3 * DAY));
        assert.deepEqual(sent, []);
        const left = await seedCar({parkingEndDate: daysAgo(5)});
        await changeAndTrigger(left, {customerName: "Alimou B."});
        assert.deepEqual(sent, []);
      });

  it("is silent for a team member's car, a voided car and a booking",
      async () => {
        await turnOn();
        for (const extra of [{forStaffId: "staff-9"}, {voided: true},
          {source: "customer", enteredByBusiness: false}]) {
          const id = await seedCar(extra);
          await leave(id);
        }
        assert.deepEqual(sent, []);
        assert.deepEqual(await rowsOf(), []);
      });

  it("is silent while the switch is off", async () => {
    const id = await seedCar();
    await leave(id);
    assert.deepEqual(sent, []);
    assert.deepEqual(await rowsOf(), []);
  });

  it("keeps a failed send on its row", async () => {
    await turnOn();
    const id = await seedCar();
    failNext = 131026;
    await leave(id);
    const failed = (await rowsOf()).filter((r) => r.kind === "left");
    assert.equal(failed.length, 1);
    assert.equal(failed[0].status, "failed");
  });
});

describe("the number is corrected", () => {
  const NEW_PHONE = "+12015559999";

  it("resends the parked message to the new number, once", async () => {
    await turnOn();
    const id = await seedCar();
    await trigger(id, null);
    sent.length = 0;
    await changeAndTrigger(id, {customerPhone: NEW_PHONE});
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "12015559999");
    assert.equal(sent[0].template.name, "parking_parked_2lang");
    const message = await row(`${id}_phone_12015559999`);
    assert.equal(message.status, "sent");
    assert.equal(message.kind, "parked");
    assert.equal(message.phone, NEW_PHONE);
    assert.equal(message.phoneFix, true);
    assert.equal(message.parkedCarId, id);
    // The same number saved again, or only written another way: nothing.
    await changeAndTrigger(id, {customerPhone: "+1 (201) 555-9999"});
    await changeAndTrigger(id, {customerName: "Alimou B."});
    assert.equal(sent.length, 1);
  });

  it("resends the left statement when the car has already left",
      async () => {
        await turnOn();
        const id = await seedCar({parkingEndDate: daysAgo(5)});
        await changeAndTrigger(id, {customerPhone: NEW_PHONE});
        assert.equal(sent.length, 1);
        assert.equal(sent[0].template.name, "parking_left_2lang");
        assert.equal(sent[0].to, "12015559999");
        assert.equal((await row(`${id}_phone_12015559999`)).kind, "left");
      });

  it("sends nothing for an unreachable number, a team car, or when the " +
      "switch is off", async () => {
    const id = await seedCar();
    await changeAndTrigger(id, {customerPhone: NEW_PHONE});
    assert.deepEqual(sent, []);
    await turnOn();
    await changeAndTrigger(id, {customerPhone: "620123456"});
    const team = await seedCar({forStaffId: "staff-9"});
    await changeAndTrigger(team, {customerPhone: "+12015558888"});
    assert.deepEqual(sent, []);
  });

  it("does not add a second message when the end day moved in the same " +
      "write", async () => {
    await turnOn();
    const id = await seedCar();
    await changeAndTrigger(id,
        {customerPhone: NEW_PHONE, parkingEndDate: daysAgo(5)});
    assert.equal(sent.length, 1);
    assert.equal(sent[0].template.name, "parking_left_2lang");
    assert.equal(sent[0].to, "12015559999");
  });
});

describe("update_contact", () => {
  const contact = (uid, data) => run("updateBusinessParkingEntry", uid,
      {action: "update_contact", ...data});

  it("fixes the phone of a paid, left car and nothing else", async () => {
    await turnOn();
    const id = await seedCar({parkingEndDate: daysAgo(5),
      amountPaidCents: 5000, paymentStatus: "paid", amountDueCents: 5000,
      totalCostCents: 5000});
    const before = await car(id);
    const previous = before;
    const result = await contact(STAFF,
        {businessId: BIZ, carId: id, customerPhone: "+12015559999"});
    assert.equal(result.success, true);
    assert.deepEqual(result.changed, ["customerPhone"]);
    const after = await car(id);
    assert.equal(after.customerPhone, "+12015559999");
    for (const field of ["amountDueCents", "amountPaidCents",
      "paymentStatus", "paymentMethod", "dailyRate", "customerName"]) {
      assert.deepEqual(after[field], before[field], field);
    }
    assert.equal(after.parkingEndDate.toMillis(),
        before.parkingEndDate.toMillis());
    // The write the trigger then sees resends the left statement.
    await trigger(id, previous);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "12015559999");
    assert.equal(sent[0].template.name, "parking_left_2lang");
  });

  it("moves the owner name with the customer name and takes the plain " +
      "request shape or a `changes` object", async () => {
    const id = await seedCar({paymentStatus: "paid"});
    await contact(STAFF, {entryId: id, changes: {customerName: "Fatou D."}});
    const after = await car(id);
    assert.equal(after.customerName, "Fatou D.");
    assert.equal(after.ownerName, "Fatou D.");
  });

  it("refuses nothing-to-change, an empty phone, a team car, a voided car " +
      "and a car of another business", async () => {
    const id = await seedCar();
    await assert.rejects(contact(STAFF, {carId: id, customerPhone: PHONE}),
        refusal("failed-precondition", "nothing_to_change"));
    await assert.rejects(contact(STAFF, {carId: id, customerPhone: " "}),
        refusal("invalid-argument", "customer_phone_required"));
    const team = await seedCar({forStaffId: "staff-9"});
    await assert.rejects(contact(STAFF, {carId: team,
      customerPhone: "+12015550000"}),
    refusal("invalid-argument", "team_car"));
    const voided = await seedCar({voided: true});
    await assert.rejects(contact(STAFF, {carId: voided,
      customerPhone: "+12015550000"}),
    refusal("failed-precondition", "car_voided"));
    await assert.rejects(contact(OTHER_OWNER, {carId: id,
      customerPhone: "+12015550000"}),
    (error) => error.code === "permission-denied");
    await assert.rejects(contact(STAFF, {customerPhone: "+1"}),
        refusal("invalid-argument", "car_required"));
  });

  it("still refuses a full edit of a paid car, as before", async () => {
    const id = await seedCar({paymentStatus: "paid"});
    await assert.rejects(run("updateBusinessParkingEntry", STAFF, {
      entryId: id, customerPhone: "+12015550000"}),
    (error) => /paid for/.test(error.message));
  });
});

describe("send_whatsapp (the button)", () => {
  const press = (uid, carId, extra = {}) => run("updateBusinessParkingEntry",
      uid, {action: "send_whatsapp", businessId: BIZ, carId, ...extra});

  it("sends the parked message of a car on the lot, for any parking " +
      "staff", async () => {
    await turnOn();
    const id = await seedCar();
    const result = await press(STAFF, id);
    assert.deepEqual(result, {success: true, kind: "parked",
      status: "sent", error: ""});
    assert.equal(sent.length, 1);
    assert.equal(sent[0].template.name, "parking_parked_2lang");
    assert.equal(sent[0].to, "12015551234");
    const manual = (await rowsOf()).filter((r) => r.manual === true);
    assert.equal(manual.length, 1);
    assert.match(manual[0].id, new RegExp(`^${id}_manual_\\d{13}$`));
    assert.equal(manual[0].sentByUid, STAFF);
    assert.equal(manual[0].kind, "parked");
    assert.equal(manual[0].parkedCarId, id);
    assert.equal(manual[0].status, "sent");
    // The owner can too, and it is a row of its own each time.
    await press(OWNER, id);
    assert.equal((await rowsOf()).filter((r) => r.manual).length, 2);
  });

  it("sends the left statement of a car that has left", async () => {
    await turnOn();
    const id = await seedCar({parkingEndDate: daysAgo(5)});
    const result = await press(STAFF, id);
    assert.equal(result.kind, "left");
    assert.equal(result.status, "sent");
    assert.equal(sent[0].template.name, "parking_left_2lang");
    const link = receiptLinkOf(sent[0]);
    assert.equal((await open(link)).statusCode, 200);
    const manual = (await rowsOf()).find((r) => r.manual === true);
    assert.equal(manual.kind, "left");
  });

  it("answers a Meta failure instead of throwing, and a STOP", async () => {
    await turnOn();
    const id = await seedCar();
    failNext = 131026;
    const failed = await press(STAFF, id);
    assert.equal(failed.success, true);
    assert.equal(failed.status, "failed");
    assert.match(failed.error, /nope/);
    await db.collection("whatsappStops").doc(PHONE)
        .set({stopped: true, phone: PHONE});
    assert.equal((await press(STAFF, id)).status, "stopped");
  });

  it("takes five presses a car a day, then says so", async () => {
    await turnOn();
    const id = await seedCar();
    for (let n = 0; n < 5; n += 1) {
      assert.equal((await press(STAFF, id)).status, "sent");
    }
    await assert.rejects(press(STAFF, id),
        refusal("failed-precondition", "send_limit"));
    assert.equal(sent.length, 5);
    // Another car has its own five.
    assert.equal((await press(STAFF, await seedCar())).status, "sent");
  });

  it("is refused when the switch is off", async () => {
    const id = await seedCar();
    await assert.rejects(press(STAFF, id),
        refusal("failed-precondition", "parking_whatsapp_off"));
    assert.deepEqual(sent, []);
  });

  it("is refused for cars the lot does not message", async () => {
    await turnOn();
    for (const extra of [{forStaffId: "staff-9"}, {voided: true},
      {source: "customer", enteredByBusiness: false}]) {
      await assert.rejects(press(STAFF, await seedCar(extra)),
          refusal("failed-precondition", "car_not_messageable"));
    }
  });

  it("is refused without a usable number", async () => {
    await turnOn();
    await assert.rejects(press(STAFF, await seedCar({customerPhone: ""})),
        refusal("failed-precondition", "no_phone"));
    await assert.rejects(press(STAFF,
        await seedCar({customerPhone: "620123456"})),
    refusal("failed-precondition", "needs_country_code"));
    assert.deepEqual(await rowsOf(), []);
  });

  it("is for the parking permission of this business only", async () => {
    await turnOn();
    const id = await seedCar();
    await db.collection("users").doc("pkwa-staff-ledger").set({
      role: "staff", businessId: BIZ, businessPermissions: ["ledger"]});
    await assert.rejects(press("pkwa-staff-ledger", id),
        (error) => error.code === "permission-denied");
    await assert.rejects(press(OTHER_OWNER, id),
        (error) => error.code === "permission-denied");
    await assert.rejects(press(STAFF, id, {businessId: OTHER_BIZ}),
        refusal("not-found", "car_not_found"));
    await assert.rejects(press(STAFF, "no-such-car"),
        refusal("not-found", "car_not_found"));
    assert.deepEqual(sent, []);
  });
});

describe("whatsapp_status", () => {
  const status = (uid, carId) => run("updateBusinessParkingEntry", uid,
      {action: "whatsapp_status", businessId: BIZ, carId});

  it("answers the car's latest message row, found by parkedCarId",
      async () => {
        await turnOn();
        const id = await seedCar();
        const none = await status(STAFF, id);
        assert.equal(none.last, null);
        assert.equal(none.enabled, true);
        await trigger(id, null);
        const first = await status(STAFF, id);
        assert.equal(first.last.kind, "parked");
        assert.equal(first.last.status, "sent");
        await db.collection("whatsappStops").doc(PHONE)
            .set({stopped: true, phone: PHONE});
        await run("updateBusinessParkingEntry", STAFF,
            {action: "send_whatsapp", businessId: BIZ, carId: id});
        const second = await status(STAFF, id);
        assert.equal(second.last.manual, true);
        assert.equal(second.last.status, "stopped");
        assert.ok(second.last.atMs >= first.last.atMs);
        // Another car's rows are not this car's.
        assert.equal((await status(STAFF, await seedCar())).last, null);
        await assert.rejects(status(OTHER_OWNER, id),
            (error) => error.code === "permission-denied");
      });
});
