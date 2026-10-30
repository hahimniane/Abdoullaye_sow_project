"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {afterEach, before, describe, it} = require("node:test");
const admin = require("firebase-admin");
const {EventEmitter} = require("node:events");

// The container callables and triggers, run directly against the Firestore
// emulator: what the source-contract tests in container-manifest.test.js and
// container-updates.test.js can only pin by reading the code - that two
// quick adds of one VIN really cannot both land, that a half-applied ship
// really is finished by asking again, that a WhatsApp row is claimed once,
// retried on a 5xx and never sent twice - is exercised here.
//
// Writes with ADMIN credentials, so it refuses to run outside the emulator.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
      "Run this through `npm run test:containers` (firebase emulators:exec). " +
      "A direct node --test run would write its fixtures into the " +
      "real project.");
}

process.env.FUNCTIONS_EMULATOR = "true";
// WhatsApp starts disconnected; tests that send connect it.
process.env.WHATSAPP_ACCESS_TOKEN = "unset";
process.env.WHATSAPP_PHONE_NUMBER_ID = "unset";

const functions = require("../index");
const {CONTAINER_MESSAGES} = require("../container_manifest");
const db = admin.firestore();

const BIZ = "container-test-biz";
const OWNER = "container-test-owner";
const NO_CONTAINERS = "container-test-ledger-only";
// Who holds the cash at the counter; the owner types it in.
const RECEIVER = "container-test-cashier";
const OTHER_BIZ_STAFF = "container-test-other-business-staff";
const VIN = "1HGCM82633A004352";

const call = (name, data, uid = OWNER) =>
  functions[name].run({auth: {uid, token: {}}, data: {businessId: BIZ,
    ...data}});

// A package payment says who took the money, as a parking one does.
const pay = (data, uid = OWNER) =>
  call("recordContainerLinePayment", {receivedByStaffId: RECEIVER, ...data},
      uid);

let boxes = 0;
async function newContainer(extra = {}) {
  boxes += 1;
  const {containerId} = await call("createContainer", {
    label: `Test box ${boxes}`, destinationCountryId: "gn",
    destinationCountryName: "Guinea", ...extra,
  });
  return containerId;
}

const carLine = (vin = VIN) => ({kind: "car", vinNumber: vin,
  carMake: "Honda", carModel: "Accord", carYear: "2003",
  ownerKind: "customer", customerName: "Fatou Diallo",
  customerPhone: "+16465550100", receiverName: "Mariama Bah",
  receiverPhone: "+224620000000"});
const barrelLine = (quantity = 3) => ({kind: "barrels", quantity,
  ownerKind: "customer", customerName: "Fatou Diallo",
  customerPhone: "+16465550100", receiverName: "Mariama Bah",
  receiverPhone: "+224620000000"});

async function linesOf(containerId) {
  const snap = await db.collection("containerLines")
      .where("containerId", "==", containerId).get();
  return snap.docs;
}

let vinSerial = 0;
const freshVin = () => `TESTVIN${String(++vinSerial).padStart(10, "0")}`;

// WhatsApp, faked at the fetch boundary.
const realFetch = global.fetch;
let whatsappCalls = [];
function fakeWhatsApp(...answers) {
  whatsappCalls = [];
  global.fetch = async (url, init) => {
    if (!String(url).includes("graph.facebook.com")) {
      return realFetch(url, init);
    }
    whatsappCalls.push(JSON.parse(init.body));
    const answer = answers.length > 1 ? answers.shift() : answers[0];
    if (answer instanceof Error) throw answer;
    return new Response(JSON.stringify(answer.body || {}),
        {status: answer.status});
  };
}
const OK = {status: 200, body: {messages: [{id: "wamid.TEST"}]}};
function connectWhatsApp() {
  process.env.WHATSAPP_ACCESS_TOKEN = "EAAG-test-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "109876543210";
}
function disconnectWhatsApp() {
  process.env.WHATSAPP_ACCESS_TOKEN = "unset";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "unset";
}

async function recordMoments(containerId) {
  const events = await db.collection("containers").doc(containerId)
      .collection("trackingEvents").get();
  for (const doc of events.docs) {
    await functions.sendContainerCustomerUpdates.run({
      data: doc, params: {containerId, eventId: doc.id},
    });
  }
}

// What the platform hands the sender when a row becomes queued.
async function deliver(rowId, {before = null, ageMs = 0} = {}) {
  const snap = await db.collection("containerUpdates").doc(rowId).get();
  return functions.deliverContainerCustomerUpdate.run({
    data: {
      before: {data: () => before},
      after: {data: () => ({...snap.data(), status: "queued"}),
        ref: snap.ref},
    },
    params: {messageId: rowId},
    time: new Date(Date.now() - ageMs).toISOString(),
  });
}

before(async () => {
  await Promise.all([
    db.collection("businesses").doc(BIZ).set({
      name: "Dala Shipping", status: "approved",
    }),
    db.collection("users").doc(OWNER).set({
      role: "businessOwner", businessId: BIZ, email: "owner@example.test",
      fullName: "Dala Owner",
    }),
    db.collection("users").doc(RECEIVER).set({
      role: "staff", businessId: BIZ, businessPermissions: ["containers"],
      fullName: "Awa Cashier", email: "cashier@example.test",
    }),
    db.collection("users").doc(OTHER_BIZ_STAFF).set({
      role: "staff", businessId: "some-other-business",
      fullName: "Stranger Danger", email: "stranger@example.test",
    }),
    db.collection("users").doc(NO_CONTAINERS).set({
      role: "staff", businessId: BIZ, businessPermissions: ["ledger"],
      email: "ledger@example.test",
    }),
  ]);
});

afterEach(() => {
  global.fetch = realFetch;
  disconnectWhatsApp();
  delete process.env.WHATSAPP_TEMPLATE_SET;
});

describe("one car, one open container", () => {
  // Regression: both adds passed the "already loaded?" query and both wrote.
  it("lets exactly one of two simultaneous adds of a VIN through", async () => {
    const first = await newContainer();
    const second = await newContainer();
    const vin = freshVin();
    const results = await Promise.allSettled([
      call("addContainerLine", {containerId: first, line: carLine(vin)}),
      call("addContainerLine", {containerId: second, line: carLine(vin)}),
      call("addContainerLine", {containerId: first, line: carLine(vin)}),
    ]);
    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");
    assert.equal(won.length, 1, JSON.stringify(results.map((r) =>
      r.reason?.message || r.value)));
    for (const {reason} of lost) {
      assert.equal(reason.code, "failed-precondition");
      assert.equal(reason.details?.reason, "vin_already_loaded");
      assert.equal(reason.details?.conflictContainerId,
          won[0].value.containerId);
    }
    const sameVin = await db.collection("containerLines")
        .where("businessId", "==", BIZ).where("vinNumber", "==", vin).get();
    assert.equal(sameVin.size, 1);
    const lock = await db.collection("containerVinLocks")
        .doc(`${BIZ}_${vin}`).get();
    assert.equal(lock.get("lineId"), won[0].value.lineId);
  });

  it("still refuses a car loaded before locks existed", async () => {
    const legacyBox = await newContainer();
    const vin = freshVin();
    await db.collection("containerLines").doc().set({
      businessId: BIZ, containerId: legacyBox, containerStatus: "loading",
      kind: "car", vinNumber: vin, trackingCode: "CL-LEGACY",
    });
    const other = await newContainer();
    await assert.rejects(
        call("addContainerLine", {containerId: other, line: carLine(vin)}),
        (error) => error.details?.conflictContainerId === legacyBox);
  });

  it("frees the car when its line is removed, or its lock went stale",
      async () => {
        const box = await newContainer();
        const vin = freshVin();
        const {lineId} = await call("addContainerLine",
            {containerId: box, line: carLine(vin)});
        await call("removeContainerLine", {containerId: box, lineId});
        const lockRef = db.collection("containerVinLocks").doc(`${BIZ}_${vin}`);
        assert.equal((await lockRef.get()).exists, false);
        await call("addContainerLine", {containerId: box, line: carLine(vin)});
        // A lock whose line is gone (a crash, a delete by hand) is taken
        // over rather than blocking the car for good.
        const staleVin = freshVin();
        await db.collection("containerVinLocks").doc(`${BIZ}_${staleVin}`)
            .set({businessId: BIZ, vinNumber: staleVin, containerId: box,
              lineId: "no-such-line"});
        const taken = await call("addContainerLine",
            {containerId: box, line: carLine(staleVin)});
        const lock = await db.collection("containerVinLocks")
            .doc(`${BIZ}_${staleVin}`).get();
        assert.equal(lock.get("lineId"), taken.lineId);
      });

  it("moves the lock with the line, and lets go when the box arrives",
      async () => {
        const from = await newContainer();
        const to = await newContainer();
        const vin = freshVin();
        const {lineId} = await call("addContainerLine",
            {containerId: from, line: carLine(vin)});
        await call("moveContainerLine", {lineId, toContainerId: to});
        const lockRef = db.collection("containerVinLocks").doc(`${BIZ}_${vin}`);
        assert.equal((await lockRef.get()).get("containerId"), to);
        await call("setContainerStatus", {containerId: to, status: "shipped"});
        const elsewhere = await newContainer();
        await assert.rejects(call("addContainerLine",
            {containerId: elsewhere, line: carLine(vin)}),
        /already on another container/);
        await call("setContainerStatus", {containerId: to, status: "arrived"});
        assert.equal((await lockRef.get()).exists, false);
        await call("addContainerLine",
            {containerId: elsewhere, line: carLine(vin)});
      });
});

describe("the container's tallies", () => {
  it("match a full recount after adds, a move and a remove", async () => {
    const box = await newContainer();
    const other = await newContainer();
    await call("addContainerLine", {containerId: box, line: barrelLine(3)});
    const {lineId: moving} = await call("addContainerLine",
        {containerId: box, line: barrelLine(5)});
    const {lineId: removing} = await call("addContainerLine",
        {containerId: box, line: {kind: "other", quantity: 2,
          description: "Boxes", ownerKind: "stock"}});
    await call("addContainerLine",
        {containerId: box, line: carLine(freshVin())});
    await call("moveContainerLine", {lineId: moving, toContainerId: other});
    await call("removeContainerLine", {containerId: box, lineId: removing});
    const stored = (await db.collection("containers").doc(box).get()).data();
    assert.deepEqual(
        {lineCount: stored.lineCount, carCount: stored.carCount,
          barrelCount: stored.barrelCount, otherCount: stored.otherCount},
        {lineCount: 2, carCount: 1, barrelCount: 3, otherCount: 0});
    const moved = (await db.collection("containers").doc(other).get()).data();
    assert.equal(moved.lineCount, 1);
    assert.equal(moved.barrelCount, 5);
  });

  it("never leaves a line on a box deleted as it was added", async () => {
    const box = await newContainer();
    const [deleted, added] = await Promise.allSettled([
      call("deleteContainer", {containerId: box}),
      call("addContainerLine", {containerId: box, line: barrelLine(1)}),
    ]);
    const exists = (await db.collection("containers").doc(box).get()).exists;
    const lines = await linesOf(box);
    // Either the box went and nothing landed on it, or the line landed and
    // the box stayed.
    if (deleted.status === "fulfilled") {
      assert.equal(exists, false);
      assert.equal(lines.length, 0);
      assert.equal(added.status, "rejected");
    } else {
      assert.equal(exists, true);
      assert.equal(lines.length, 1);
    }
  });
});

describe("editing a line", () => {
  const lineRef = (id) => db.collection("containerLines").doc(id);
  const lockRef = (vin) =>
    db.collection("containerVinLocks").doc(`${BIZ}_${vin}`);
  const tallies = async (box) => {
    const row = (await db.collection("containers").doc(box).get()).data();
    return {lineCount: row.lineCount, carCount: row.carCount,
      barrelCount: row.barrelCount, otherCount: row.otherCount};
  };
  const recount = async (box) => {
    const out = {lineCount: 0, carCount: 0, barrelCount: 0, otherCount: 0};
    for (const doc of await linesOf(box)) {
      const line = doc.data();
      out.lineCount += 1;
      if (line.kind === "car") out.carCount += 1;
      else if (line.kind === "barrels") out.barrelCount += line.quantity;
      else out.otherCount += line.quantity;
    }
    return out;
  };
  async function audits(box, action) {
    const snap = await db.collection("lotLedgerAudit")
        .where("entityId", "==", box).where("action", "==", action).get();
    return snap.docs.map((d) => d.get("summary"));
  }

  it("changes what the line is, keeps its code, and moves the tallies",
      async () => {
        const box = await newContainer();
        const {lineId} = await call("addContainerLine",
            {containerId: box, line: barrelLine(3)});
        await call("addContainerLine",
            {containerId: box, line: carLine(freshVin())});
        const code = (await lineRef(lineId).get()).get("trackingCode");
        const result = await call("updateContainerLine", {lineId,
          containerId: box, line: {...barrelLine(5),
            customerName: "Fatou"}});
        assert.deepEqual(result.changed, ["quantity", "customerName"]);
        const line = (await lineRef(lineId).get()).data();
        assert.equal(line.quantity, 5);
        assert.equal(line.customerName, "Fatou");
        assert.equal(line.trackingCode, code);
        assert.equal(line.containerId, box);
        assert.equal(line.editedByStaffId, OWNER);
        assert.deepEqual(await tallies(box), await recount(box));
        assert.equal((await tallies(box)).barrelCount, 5);
        assert.deepEqual(await audits(box, "line_edited"),
            ["Edited 5 barrels (was 3 barrels): quantity, customer's name " +
              "for Fatou"]);
        // A kind change moves a line's share between the counts.
        await call("updateContainerLine", {lineId, line: {kind: "other",
          quantity: 2, description: "Tires", ownerKind: "stock"}});
        assert.deepEqual(await tallies(box), await recount(box));
        assert.deepEqual(await tallies(box),
            {lineCount: 2, carCount: 1, barrelCount: 0, otherCount: 2});
        const stock = (await lineRef(lineId).get()).data();
        assert.equal(stock.customerName, "");
        assert.equal(stock.trackingCode, code);
        // Asking for what is already there writes nothing.
        const again = await call("updateContainerLine", {lineId,
          line: {kind: "other", quantity: 2, description: "Tires",
            ownerKind: "stock", receiverName: "Mariama Bah",
            receiverPhone: "+224620000000"}});
        assert.deepEqual(again.changed, []);
      });

  it("keeps the contacts-only path, open in every state", async () => {
    const box = await newContainer();
    const {lineId} = await call("addContainerLine",
        {containerId: box, line: barrelLine(2)});
    await call("setContainerStatus", {containerId: box, status: "shipped"});
    const result = await call("updateContainerLineContacts", {lineId,
      contacts: {customerName: "Fatou Diallo",
        customerPhone: "+16465550100", receiverName: "Mariama Bah",
        receiverPhone: "+224 621 00 00 00", quantity: 40, kind: "car"}});
    assert.deepEqual(result.changed, ["receiverPhone"]);
    const line = (await lineRef(lineId).get()).data();
    assert.equal(line.receiverPhone, "+224621000000");
    // Whatever else the contacts carried is never taken.
    assert.equal(line.quantity, 2);
    assert.equal(line.kind, "barrels");
    assert.deepEqual(await audits(box, "line_contacts_edited"),
        ["Changed receiver's phone for Fatou Diallo"]);
    assert.deepEqual(await audits(box, "line_edited"), []);
    // The whole-line callable takes a contacts-only change on a shipped box
    // too, and writes the same sentence.
    await call("updateContainerLine", {lineId, line: {...barrelLine(2),
      receiverName: "Awa Ba", receiverPhone: "+224621000000"}});
    assert.equal((await lineRef(lineId).get()).get("receiverName"), "Awa Ba");
    assert.equal((await audits(box, "line_contacts_edited")).length, 2);
    // The sender is optional now (owner, 2026-10-21); the receiver is not.
    await call("updateContainerLineContacts", {lineId,
      contacts: {customerName: " "}});
    assert.equal((await lineRef(lineId).get()).get("customerName"), "");
    await assert.rejects(
        call("updateContainerLineContacts", {lineId,
          contacts: {receiverName: " "}}),
        (error) => error.code === "invalid-argument" &&
          error.details?.reasons?.includes("receiver_name_required") &&
          error.message === "Enter the receiver's name.");
  });

  // Owner, 2026-10-21: the sender is optional, the receiver required, and
  // "Sender is the receiver" stores one person on both sides.
  it("takes a line with no sender and refuses one with no receiver",
      async () => {
        const box = await newContainer();
        const {lineId} = await call("addContainerLine", {containerId: box,
          line: {...barrelLine(1), customerName: "", customerPhone: "",
            receiverName: "Awa Receiver", receiverPhone: "+224620000077"}});
        const line = (await lineRef(lineId).get()).data();
        assert.equal(line.customerName, "");
        assert.equal(line.senderIsReceiver, false);
        // The receiver is the customer the lot remembers and History names.
        const known = await db.collection("lotCustomers")
            .where("businessId", "==", BIZ)
            .where("name", "==", "Awa Receiver").get();
        assert.equal(known.size, 1);
        assert.equal(known.docs[0].get("phone"), "+224620000077");
        assert.ok((await audits(box, "line_added")).some((summary) =>
          summary.includes("for Awa Receiver")));
        // An old app: a sender and no receiver. Refused in plain English,
        // which is what it shows.
        await assert.rejects(
            call("addContainerLine", {containerId: box, line: {
              ...barrelLine(1), receiverName: "", receiverPhone: ""}}),
            (error) => error.code === "invalid-argument" &&
              error.message === "Enter the receiver's name." &&
              error.details?.reasons?.includes("receiver_name_required"));
        // Stock still names nobody.
        await call("addContainerLine", {containerId: box, line: {
          ...barrelLine(1), ownerKind: "stock", receiverName: ""}});
      });

  it("stores sender is the receiver as copies and the flag", async () => {
    const box = await newContainer();
    const {lineId} = await call("addContainerLine", {containerId: box,
      line: {...barrelLine(2), customerName: "", customerPhone: "",
        receiverName: "Mariama Bah", receiverPhone: "+224 620 00 00 00",
        senderIsReceiver: true}});
    let line = (await lineRef(lineId).get()).data();
    assert.equal(line.senderIsReceiver, true);
    assert.equal(line.customerName, "Mariama Bah");
    assert.equal(line.customerPhone, "+224620000000");
    // Unticked on an edit: the sender fields empty, the flag off.
    await call("updateContainerLine", {lineId, line: {...barrelLine(2),
      customerName: "", customerPhone: "", senderIsReceiver: false}});
    line = (await lineRef(lineId).get()).data();
    assert.equal(line.senderIsReceiver, false);
    assert.equal(line.customerName, "");
    assert.equal(line.customerPhone, "");
    // Ticked again through the contacts-only callable.
    const again = await call("updateContainerLineContacts", {lineId,
      contacts: {senderIsReceiver: true}});
    assert.ok(again.changed.includes("senderIsReceiver"));
    assert.equal((await lineRef(lineId).get()).get("customerName"),
        "Mariama Bah");
  });

  // A line saved before the receiver's name was required keeps working.
  it("lets an old line with no receiver take price, payment and move edits",
      async () => {
        const box = await newContainer();
        const other = await newContainer();
        const {lineId} = await call("addContainerLine",
            {containerId: box, line: barrelLine(2)});
        // As an older version stored it: a sender, no receiver.
        await lineRef(lineId).update({receiverName: "", receiverPhone: "",
          notifyReceiver: false});
        await call("setContainerLinePrice", {lineId, priceCents: 20000});
        await pay({lineId, amountCents: 5000, method: "cash"});
        await call("moveContainerLine", {lineId, toContainerId: other});
        // The whole line sent back as it is (an edit of something else).
        const stored = (await lineRef(lineId).get()).data();
        await call("updateContainerLine", {lineId, line: {
          kind: stored.kind, quantity: stored.quantity,
          ownerKind: "customer", customerName: stored.customerName,
          customerPhone: stored.customerPhone, receiverName: "",
          receiverPhone: "", notifyCustomer: true, notifyReceiver: true,
          payOnArrival: true}});
        assert.equal((await lineRef(lineId).get()).get("payOnArrival"), true);
        // Its people edited: now it has to name the receiver.
        await assert.rejects(
            call("updateContainerLineContacts", {lineId,
              contacts: {customerPhone: "+16465550111"}}),
            (error) => error.details?.reasons?.includes(
                "receiver_name_required"));
      });

  it("refuses to change what went once the box has shipped", async () => {
    const box = await newContainer();
    const {lineId} = await call("addContainerLine",
        {containerId: box, line: barrelLine(3)});
    await call("setContainerStatus", {containerId: box, status: "shipped"});
    const before = await tallies(box);
    for (const line of [barrelLine(4), {...barrelLine(3), ownerKind: "stock"},
      carLine(freshVin())]) {
      await assert.rejects(
          call("updateContainerLine", {lineId, line}),
          (error) => error.code === "failed-precondition" &&
            error.details?.reason === "container_locked");
    }
    assert.equal((await lineRef(lineId).get()).get("quantity"), 3);
    assert.deepEqual(await tallies(box), before);
    // A line on another container is not found through this one.
    const other = await newContainer();
    await assert.rejects(
        call("updateContainerLine", {lineId, containerId: other,
          line: barrelLine(3)}),
        (error) => error.code === "not-found");
  });

  it("hands the VIN lock over when the car changes", async () => {
    const box = await newContainer();
    const oldVin = freshVin();
    const newVin = freshVin();
    const {lineId} = await call("addContainerLine",
        {containerId: box, line: carLine(oldVin)});
    // Changing the car's details keeps its lock: the line holds its own VIN.
    await call("updateContainerLine", {lineId,
      line: {...carLine(oldVin), carMake: "Toyota", carModel: "Camry"}});
    assert.equal((await lockRef(oldVin).get()).get("lineId"), lineId);
    await call("updateContainerLine", {lineId, line: carLine(newVin)});
    assert.equal((await lockRef(oldVin).get()).exists, false);
    const lock = (await lockRef(newVin).get()).data();
    assert.equal(lock.lineId, lineId);
    assert.equal(lock.containerId, box);
    assert.equal((await lineRef(lineId).get()).get("vinNumber"), newVin);
    // The car it no longer is may go on another box; the one it is may not.
    const elsewhere = await newContainer();
    await call("addContainerLine", {containerId: elsewhere,
      line: carLine(oldVin)});
    await assert.rejects(
        call("addContainerLine", {containerId: elsewhere,
          line: carLine(newVin)}),
        (error) => error.details?.conflictContainerId === box);
    // Becoming barrels lets the car go entirely.
    await call("updateContainerLine", {lineId, line: barrelLine(2)});
    assert.equal((await lockRef(newVin).get()).exists, false);
    assert.deepEqual(await tallies(box), await recount(box));
  });

  it("refuses a VIN already on an open container, naming it", async () => {
    const box = await newContainer();
    const holder = await newContainer();
    const taken = freshVin();
    await call("addContainerLine", {containerId: holder, line: carLine(taken)});
    const {lineId} = await call("addContainerLine",
        {containerId: box, line: carLine(freshVin())});
    await assert.rejects(
        call("updateContainerLine", {lineId, line: carLine(taken)}),
        (error) => error.code === "failed-precondition" &&
          error.details?.reason === "vin_already_loaded" &&
          error.details?.conflictContainerId === holder);
    // A car loaded before locks existed holds its VIN too.
    const legacyVin = freshVin();
    await db.collection("containerLines").doc().set({
      businessId: BIZ, containerId: holder, containerStatus: "loading",
      kind: "car", vinNumber: legacyVin, trackingCode: "CL-LEGACY2",
    });
    const {lineId: barrelsId} = await call("addContainerLine",
        {containerId: box, line: barrelLine(1)});
    await assert.rejects(
        call("updateContainerLine", {lineId: barrelsId,
          line: carLine(legacyVin)}),
        (error) => error.details?.conflictContainerId === holder);
    const unchanged = (await lineRef(barrelsId).get()).data();
    assert.equal(unchanged.kind, "barrels");
    assert.equal((await lockRef(legacyVin).get()).exists, false);
  });

  it("lets exactly one of an edit and an add take the same car", async () => {
    const box = await newContainer();
    const other = await newContainer();
    const vin = freshVin();
    const {lineId} = await call("addContainerLine",
        {containerId: box, line: barrelLine(1)});
    const results = await Promise.allSettled([
      call("updateContainerLine", {lineId, line: carLine(vin)}),
      call("addContainerLine", {containerId: other, line: carLine(vin)}),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1,
        JSON.stringify(results.map((r) => r.reason?.message || "ok")));
    const holders = (await db.collection("containerLines")
        .where("businessId", "==", BIZ).where("vinNumber", "==", vin).get())
        .size;
    assert.equal(holders, 1);
  });

  it("is refused to staff without the containers section", async () => {
    const box = await newContainer();
    const {lineId} = await call("addContainerLine",
        {containerId: box, line: barrelLine(1)});
    for (const [name, data] of [
      ["updateContainerLine", {lineId, line: barrelLine(9)}],
      ["updateContainerLineContacts", {lineId,
        contacts: {receiverName: "Someone"}}],
    ]) {
      await assert.rejects(call(name, data, NO_CONTAINERS),
          (error) => error.code === "permission-denied", name);
    }
    const line = (await lineRef(lineId).get()).data();
    assert.equal(line.quantity, 1);
    assert.equal(line.receiverName, "Mariama Bah");
  });
});

describe("a status change that only half landed", () => {
  // Regression: the container was written "shipped" before its lines; when
  // the line batch failed, the lines stayed "loading" and asking again was
  // refused as an invalid transition.
  it("is finished by asking for the same status again", async () => {
    const box = await newContainer();
    await call("addContainerLine", {containerId: box, line: barrelLine(2)});
    const {lineId} = await call("addContainerLine",
        {containerId: box, line: barrelLine(1)});
    // The state the old order could leave behind.
    await db.collection("containers").doc(box).set(
        {status: "shipped"}, {merge: true});
    await db.collection("containerLines").doc(lineId).update(
        {trackingCode: ""});
    const result = await call("setContainerStatus",
        {containerId: box, status: "shipped"});
    assert.equal(result.repaired, true);
    for (const line of await linesOf(box)) {
      assert.equal(line.get("containerStatus"), "shipped");
      assert.match(line.get("trackingCode"), /^CL-/);
    }
    const moment = await db.collection("containers").doc(box)
        .collection("trackingEvents").doc("staff_shipped").get();
    assert.equal(moment.get("customerUpdate"), "shipped");
  });

  // Lines are now written before the container; a line added in between
  // must not be left "loading" on a shipped box.
  it("never leaves a line added during the ship behind", async () => {
    for (let round = 0; round < 4; round++) {
      const box = await newContainer();
      await call("addContainerLine", {containerId: box, line: barrelLine(1)});
      await Promise.allSettled([
        call("setContainerStatus", {containerId: box, status: "shipped"}),
        call("addContainerLine", {containerId: box, line: barrelLine(2)}),
        call("addContainerLine", {containerId: box, line: barrelLine(3)}),
      ]);
      const container = await db.collection("containers").doc(box).get();
      assert.equal(container.get("status"), "shipped");
      const lines = await linesOf(box);
      for (const line of lines) {
        assert.equal(line.get("containerStatus"), "shipped",
            `round ${round}: a line was left behind`);
      }
      assert.equal(container.get("lineCount"), lines.length);
    }
  });

  it("still refuses going backwards", async () => {
    const box = await newContainer();
    await call("addContainerLine", {containerId: box, line: barrelLine(1)});
    await call("setContainerStatus", {containerId: box, status: "shipped"});
    await assert.rejects(
        call("setContainerStatus", {containerId: box, status: "loading"}),
        (error) => error.code === "failed-precondition");
  });
});

describe("codes and tokens are minted once", () => {
  it("gives a line one code when labels print as the box ships", async () => {
    const box = await newContainer();
    const {lineId} = await call("addContainerLine",
        {containerId: box, line: barrelLine(2)});
    await db.collection("containerLines").doc(lineId).update(
        {trackingCode: ""});
    const [labels, again] = await Promise.all([
      call("getContainerDocumentUrl", {containerId: box, view: "labels",
        lineId}),
      call("getContainerDocumentUrl", {containerId: box, view: "labels",
        lineId}),
      call("setContainerStatus", {containerId: box, status: "shipped"}),
    ]);
    const stored = (await db.collection("containerLines").doc(lineId).get())
        .get("trackingCode");
    assert.match(stored, /^CL-/);
    for (const {url} of [labels, again]) {
      assert.equal(new URL(url).searchParams.get("code"), stored);
    }
    // Same token for both first opens.
    const token = (url) => new URL(url).searchParams.get("t");
    assert.equal(token(labels.url), token(again.url));
    const container = await db.collection("containers").doc(box).get();
    assert.equal(container.get("documentToken"), token(labels.url));
  });
});

describe("WhatsApp updates", () => {
  async function shippedBox() {
    const box = await newContainer();
    const {lineId} = await call("addContainerLine",
        {containerId: box, line: barrelLine(3)});
    await call("setContainerStatus", {containerId: box, status: "shipped"});
    return {box, lineId};
  }
  const row = (lineId, role, update = "shipped") =>
    db.collection("containerUpdates").doc(`${lineId}_${role}_${update}`);

  it("is wired to retry and to read the WhatsApp secrets", () => {
    const endpoint = functions.deliverContainerCustomerUpdate.__endpoint;
    assert.equal(endpoint.eventTrigger.retry, true);
    assert.deepEqual(endpoint.secretEnvironmentVariables.map((s) => s.key)
        .sort(), ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID"]);
  });

  it("records who would hear while WhatsApp is not connected", async () => {
    const {box, lineId} = await shippedBox();
    await recordMoments(box);
    await recordMoments(box); // a second report of the same moment
    for (const role of ["sender", "receiver"]) {
      assert.equal((await row(lineId, role).get()).get("status"),
          "waiting_for_whatsapp");
    }
    const line = await db.collection("containerLines").doc(lineId).get();
    assert.deepEqual(line.get("lastCustomerUpdate.results")
        .map((entry) => entry.status), ["waiting_for_whatsapp",
      "waiting_for_whatsapp"]);
    await assert.rejects(
        call("sendContainerCurrentStatus", {containerId: box}),
        (error) => error.details?.reason === "whatsapp_not_configured");
  });

  it("sends the current status by hand once connected, never twice",
      async () => {
        const {box, lineId} = await shippedBox();
        await recordMoments(box);
        connectWhatsApp();
        await assert.rejects(
            call("sendContainerCurrentStatus", {containerId: box},
                NO_CONTAINERS),
            (error) => error.code === "permission-denied");
        const first = await call("sendContainerCurrentStatus",
            {containerId: box});
        assert.equal(first.update, "shipped");
        assert.equal(first.queued, 2);
        fakeWhatsApp(OK);
        for (const role of ["sender", "receiver"]) {
          assert.equal((await row(lineId, role).get()).get("status"),
              "queued");
          await deliver(row(lineId, role).id,
              {before: {status: "waiting_for_whatsapp"}});
          const sent = await row(lineId, role).get();
          assert.equal(sent.get("status"), "sent");
          assert.equal(sent.get("whatsappMessageId"), "wamid.TEST");
        }
        assert.equal(whatsappCalls.length, 2);
        assert.equal(whatsappCalls[0].template.name,
            "shipment_departed_2lang");
        // name, then what, business, destination (the box's) in English and
        // in French, then the code - one "en" message for everyone.
        const receiverCall = whatsappCalls.find((c) => c.to === "224620000000");
        assert.equal(receiverCall.template.language.code, "en");
        assert.deepEqual(receiverCall.template.components[0].parameters
            .map((p) => p.text).slice(0, 7),
        ["Mariama Bah", "3 barrels", "Dala Shipping", "Guinea",
          "3 barils", "Dala Shipping", "Guinée"]);
        const line = await db.collection("containerLines").doc(lineId).get();
        assert.deepEqual(line.get("lastCustomerUpdate.results")
            .map((entry) => entry.status), ["sent", "sent"]);
        const second = await call("sendContainerCurrentStatus",
            {containerId: box});
        assert.equal(second.queued, 0);
        assert.equal(second.alreadySent, 2);
      });

  it("retries a 5xx, and sends on the next delivery", async () => {
    connectWhatsApp();
    const {box, lineId} = await shippedBox();
    await recordMoments(box);
    const ref = row(lineId, "receiver");
    assert.equal((await ref.get()).get("status"), "queued");
    fakeWhatsApp({status: 503, body: {error: {message: "Overloaded"}}}, OK);
    await assert.rejects(deliver(ref.id), /will be retried/);
    let current = await ref.get();
    assert.equal(current.get("status"), "retrying");
    assert.equal(current.get("attempts"), 1);
    assert.equal(current.get("leaseUntilMs"), 0);
    await deliver(ref.id); // the platform delivers the same event again
    current = await ref.get();
    assert.equal(current.get("status"), "sent");
    assert.equal(current.get("attempts"), 2);
  });

  it("does not retry what Meta refused", async () => {
    connectWhatsApp();
    const {box, lineId} = await shippedBox();
    await recordMoments(box);
    const ref = row(lineId, "sender");
    fakeWhatsApp({status: 400, body: {error: {message: "Template missing"}}});
    await deliver(ref.id);
    const current = await ref.get();
    assert.equal(current.get("status"), "failed");
    assert.equal(current.get("error"), "Template missing");
  });

  // Regression: a crash after create() left the row "sending" for good.
  it("takes over a dead sender's row, but never a live one's", async () => {
    connectWhatsApp();
    const {box, lineId} = await shippedBox();
    await recordMoments(box);
    const ref = row(lineId, "sender");
    fakeWhatsApp(OK);
    await ref.update({status: "sending", attempts: 1,
      leaseUntilMs: Date.now() + 60000});
    await assert.rejects(deliver(ref.id), /being sent by another attempt/);
    assert.equal(whatsappCalls.length, 0);
    await ref.update({leaseUntilMs: Date.now() - 1});
    await deliver(ref.id);
    assert.equal((await ref.get()).get("status"), "sent");
    assert.equal(whatsappCalls.length, 1);
  });

  it("gives up after the attempt bound without sending again", async () => {
    connectWhatsApp();
    const {box, lineId} = await shippedBox();
    await recordMoments(box);
    const ref = row(lineId, "receiver");
    fakeWhatsApp(OK);
    await ref.update({status: "retrying", attempts: 5, error: "HTTP 503"});
    await deliver(ref.id);
    const current = await ref.get();
    assert.equal(current.get("status"), "failed");
    assert.equal(current.get("error"), "HTTP 503");
    assert.equal(whatsappCalls.length, 0);
  });

  // One person on both sides hears once, as the receiver.
  it("sends one message to a sender who is the receiver", async () => {
    connectWhatsApp();
    const box = await newContainer();
    const {lineId} = await call("addContainerLine", {containerId: box,
      line: {...barrelLine(2), customerName: "", customerPhone: "",
        senderIsReceiver: true}});
    const rows = await db.collection("containerUpdates")
        .where("lineId", "==", lineId).get();
    assert.deepEqual(rows.docs.map((d) => d.get("role")), ["receiver"]);
    fakeWhatsApp(OK);
    await deliver(rows.docs[0].id);
    assert.equal(whatsappCalls.length, 1);
    assert.equal(whatsappCalls[0].to, "224620000000");
  });

  it("records package_received when a line is added to a box", async () => {
    const box = await newContainer();
    const {lineId} = await call("addContainerLine",
        {containerId: box, line: barrelLine(2)});
    for (const role of ["sender", "receiver"]) {
      const received = await row(lineId, role, "received").get();
      assert.equal(received.get("status"), "waiting_for_whatsapp");
      assert.equal(received.get("containerId"), box);
    }
    // Registering again never happens for one line; asking the queue again
    // finds the rows and writes nothing new.
    const before = (await db.collection("containerUpdates")
        .where("lineId", "==", lineId).get()).size;
    assert.equal(before, 2);
  });

  it("sends package_received with the destination and the code", async () => {
    connectWhatsApp();
    const box = await newContainer();
    const {lineId} = await call("addContainerLine",
        {containerId: box, line: barrelLine(2)});
    const ref = row(lineId, "sender", "received");
    assert.equal((await ref.get()).get("status"), "queued");
    fakeWhatsApp(OK);
    await deliver(ref.id);
    assert.equal((await ref.get()).get("status"), "sent");
    const [sent] = whatsappCalls;
    assert.equal(sent.to, "16465550100");
    assert.equal(sent.template.name, "shipment_received_2lang");
    assert.equal(sent.template.language.code, "en");
    const code = (await db.collection("containerLines").doc(lineId).get())
        .get("trackingCode");
    assert.deepEqual(sent.template.components[0].parameters
        .map((p) => p.text),
    ["Fatou Diallo", "Dala Shipping", "2 barrels", "Guinea",
      "Dala Shipping", "2 barils", "Guinée", code]);
    assert.deepEqual(sent.template.components[1].parameters
        .map((p) => p.text), [code]);
  });

  // "Arrived" is ready for pickup: the carrier's "at the port" alone tells
  // nobody anything, and staff marking it sends one message.
  it("sends ready for pickup only when staff mark it", async () => {
    const {box, lineId} = await shippedBox();
    await db.collection("containers").doc(box).collection("trackingEvents")
        .doc("carrier_test_grounded").set({
          label: "Discharged", source: "carrier_api",
          customerUpdate: "at_port", timestamp: new Date(),
        });
    await recordMoments(box);
    let rows = await db.collection("containerUpdates")
        .where("lineId", "==", lineId).get();
    assert.ok(!rows.docs.some((d) => d.get("update") === "arrived"));
    assert.equal((await db.collection("containers").doc(box).get())
        .get("status"), "shipped");
    connectWhatsApp();
    assert.equal((await call("sendContainerCurrentStatus",
        {containerId: box})).update, "shipped");
    await call("setContainerStatus", {containerId: box, status: "arrived"});
    await recordMoments(box);
    rows = await db.collection("containerUpdates")
        .where("lineId", "==", lineId).get();
    assert.equal(rows.docs.filter((d) => d.get("update") === "arrived")
        .length, 2);
    const moment = await db.collection("containers").doc(box)
        .collection("trackingEvents").doc("staff_arrived").get();
    assert.equal(moment.get("label"), "Ready for pickup");
  });

  // Legacy set: the carrier's "at the port" and staff's mark are one
  // message.
  it("sends the legacy arrival once, whichever source reports it first",
      async () => {
        process.env.WHATSAPP_TEMPLATE_SET = "legacy";
        const {box, lineId} = await shippedBox();
        const events = db.collection("containers").doc(box)
            .collection("trackingEvents");
        await events.doc("carrier_test_grounded").set({
          label: "Discharged", source: "carrier_api",
          customerUpdate: "at_port", timestamp: new Date(),
        });
        await call("setContainerStatus", {containerId: box,
          status: "arrived"});
        await recordMoments(box);
        await recordMoments(box);
        const rows = await db.collection("containerUpdates")
            .where("lineId", "==", lineId).get();
        assert.deepEqual(rows.docs.map((d) => d.get("update")).sort(), [
          "arrived", "arrived", "received", "received", "shipped",
          "shipped"]);
        assert.ok(!rows.docs.some((d) => d.id.endsWith("_at_port")));
        const line = await db.collection("containerLines").doc(lineId).get();
        assert.equal(line.get("lastCustomerUpdate.update"), "arrived");
        connectWhatsApp();
        const current = await call("sendContainerCurrentStatus",
            {containerId: box});
        assert.equal(current.update, "arrived");
      });

  it("sends ready for pickup with the destination's pickup details",
      async () => {
        connectWhatsApp();
        const destination = db.collection("businesses").doc(BIZ)
            .collection("destinationCountries").doc("gn");
        await destination.set({businessId: BIZ, name: "Guinea"},
            {merge: true});
        const {box, lineId} = await shippedBox();
        await call("setContainerStatus",
            {containerId: box, status: "arrived"});
        await recordMoments(box);
        const ref = row(lineId, "receiver", "arrived");
        fakeWhatsApp(OK, OK);
        const params = (i) => whatsappCalls[i].template.components[0]
            .parameters.map((p) => p.text);
        try {
          // Nothing set yet, and no business phone or address: the country
          // and dashes.
          await deliver(ref.id);
          assert.equal(whatsappCalls[0].template.name,
              "shipment_ready_pickup_2lang");
          assert.equal(whatsappCalls[0].template.language.code, "en");
          assert.equal(params(0).length, 10);
          assert.deepEqual(params(0).slice(1, 9), ["3 barrels",
            "Dala Shipping", "Guinea", "3 barils", "Dala Shipping", "Guinée",
            "—", "—"]);
          await call("setDestinationPickup", {countryId: "gn",
            pickupCity: "Conakry", pickupAddress: "Madina, near the market",
            pickupPhone: "+224 620 11 22 33"});
          await ref.update({status: "queued", attempts: 0});
          await deliver(ref.id);
          assert.deepEqual(params(1).slice(1, 9), ["3 barrels",
            "Dala Shipping", "Conakry, Guinea", "3 barils", "Dala Shipping",
            "Conakry, Guinée", "Madina, near the market", "+224620112233"]);
          const code = (await db.collection("containerLines").doc(lineId)
              .get()).get("trackingCode");
          assert.equal(params(1)[9], code);
          assert.deepEqual(whatsappCalls[1].template.components[1]
              .parameters.map((p) => p.text), [code]);
        } finally {
          await destination.delete();
        }
      });

  it("sends container_arrived with the business's phone (legacy set)",
      async () => {
        process.env.WHATSAPP_TEMPLATE_SET = "legacy";
        await legacyArrivedSendsBusinessPhone();
      });

  async function legacyArrivedSendsBusinessPhone() {
    connectWhatsApp();
    const {box, lineId} = await shippedBox();
    await call("setContainerStatus", {containerId: box, status: "arrived"});
    await recordMoments(box);
    const ref = row(lineId, "sender", "arrived");
    fakeWhatsApp(OK, OK);
    // No phone on the business yet: words that still read in the sentence.
    await deliver(ref.id);
    let params = whatsappCalls[0].template.components[0].parameters
        .map((p) => p.text);
    assert.equal(whatsappCalls[0].template.name, "container_arrived");
    assert.equal(params.length, 6);
    assert.equal(params[4], "the number on your receipt");
    const business = db.collection("businesses").doc(BIZ);
    await business.update({phone: "+16465550199"});
    try {
      await ref.update({status: "queued", attempts: 0});
      await deliver(ref.id);
      params = whatsappCalls[1].template.components[0].parameters
          .map((p) => p.text);
      assert.deepEqual(params.slice(1, 5),
          ["3 barrels", "Dala Shipping", "Guinea", "+16465550199"]);
    } finally {
      await business.update({phone: admin.firestore.FieldValue.delete()});
    }
  }

  it("ignores its own writes", async () => {
    connectWhatsApp();
    const {box, lineId} = await shippedBox();
    await recordMoments(box);
    const ref = row(lineId, "sender");
    fakeWhatsApp(OK);
    const snap = await ref.get();
    await functions.deliverContainerCustomerUpdate.run({
      data: {before: {data: () => ({status: "queued"})},
        after: {data: () => ({...snap.data(), status: "sending"}),
          ref}},
      params: {messageId: ref.id}, time: new Date().toISOString(),
    });
    assert.equal(whatsappCalls.length, 0);
    assert.equal((await ref.get()).get("status"), "queued");
  });
});

// -------------------------------------------------------------------------
// Waiting packages: dropped off first, a container chosen later.
// -------------------------------------------------------------------------
describe("waiting packages", () => {
  const lineRef = (id) => db.collection("containerLines").doc(id);
  const lockRef = (vin) =>
    db.collection("containerVinLocks").doc(`${BIZ}_${vin}`);
  const boxData = async (id) =>
    (await db.collection("containers").doc(id).get()).data();
  const tallies = async (id) => {
    const row = await boxData(id);
    return {lineCount: row.lineCount, carCount: row.carCount,
      barrelCount: row.barrelCount, otherCount: row.otherCount};
  };
  const recount = async (id) => {
    const out = {lineCount: 0, carCount: 0, barrelCount: 0, otherCount: 0};
    for (const doc of await linesOf(id)) {
      const line = doc.data();
      out.lineCount += 1;
      if (line.kind === "car") out.carCount += 1;
      else if (line.kind === "barrels") out.barrelCount += line.quantity;
      else out.otherCount += line.quantity;
    }
    return out;
  };
  const GUINEA = {destinationCountryId: "gn",
    destinationCountryName: "Guinea"};
  const SENEGAL = {destinationCountryId: "sn",
    destinationCountryName: "Senegal"};
  const waitingPackage = (extra = {}) => ({kind: "barrels", quantity: 2,
    ownerKind: "customer", customerName: "Fatou Diallo",
    customerPhone: "+16465550100", receiverName: "Mariama Bah",
    receiverPhone: "+224620000000", ...GUINEA, ...extra});
  const waitingCar = (vin) => waitingPackage({kind: "car", vinNumber: vin,
    carMake: "Honda", carModel: "Accord", carYear: "2003", quantity: 1});
  const audits = async (entityId, action) => {
    const snap = await db.collection("lotLedgerAudit")
        .where("entityId", "==", entityId).where("action", "==", action).get();
    return snap.docs.map((d) => d.data());
  };
  const eventsOf = async (box) => (await db.collection("containers").doc(box)
      .collection("trackingEvents").get()).size;
  const updatesOf = async () =>
    (await db.collection("containerUpdates").get()).size;

  describe("dropping one off", () => {
    it("creates a waiting line with a code and no container", async () => {
      const {lineId, trackingCode} = await call("addWaitingPackage",
          waitingPackage({lengthIn: 30, widthIn: 20, heightIn: 12.5,
            priceCents: 15000, payOnArrival: true, paidCents: 99999}));
      assert.match(trackingCode, /^CL-/);
      const line = (await lineRef(lineId).get()).data();
      assert.equal(line.businessId, BIZ);
      assert.equal(line.containerId, "");
      assert.equal(line.containerStatus, "waiting");
      assert.equal(line.trackingCode, trackingCode);
      assert.equal(line.destinationCountryId, "gn");
      assert.equal(line.destinationCountryName, "Guinea");
      assert.deepEqual([line.lengthIn, line.widthIn, line.heightIn],
          [30, 20, 12.5]);
      assert.equal(line.priceCents, 15000);
      assert.equal(line.payOnArrival, true);
      // What was paid is the server's to keep; the request cannot set it.
      assert.equal(line.paidCents, 0);
      assert.equal(line.addedByStaffId, OWNER);
      const [entry] = await audits(lineId, "line_added");
      assert.equal(entry.byStaffId, OWNER);
      assert.equal(entry.entityType, "container_line");
      assert.match(entry.summary, /waiting for a container/);
    });

    it("refuses what the validator refuses, naming every reason", async () => {
      await assert.rejects(call("addWaitingPackage",
          waitingPackage({destinationCountryId: "", lengthIn: 5})),
      (error) => error.code === "invalid-argument" &&
          error.details?.reasons?.includes("package_destination_required") &&
          error.details?.reasons?.includes("size_invalid"));
      await assert.rejects(call("addWaitingPackage",
          waitingPackage({ownerKind: "stock"})),
      (error) => error.details?.reasons?.includes("owner_kind_invalid"));
    });

    it("is refused to staff without the containers section", async () => {
      await assert.rejects(
          call("addWaitingPackage", waitingPackage(), NO_CONTAINERS),
          (error) => error.code === "permission-denied");
    });

    // Registration tells each person once that the business has it; being
    // put on a box tells nobody, and nothing lands on a box's timeline.
    it("queues package_received at drop-off, and nothing on assigning",
        async () => {
          const before = await updatesOf();
          connectWhatsApp();
          fakeWhatsApp(OK);
          const box = await newContainer();
          const {lineId} = await call("addWaitingPackage", waitingPackage());
          const rows = await db.collection("containerUpdates")
              .where("lineId", "==", lineId).get();
          assert.deepEqual(rows.docs.map((d) => d.id).sort(),
              [`${lineId}_receiver_received`, `${lineId}_sender_received`]);
          for (const doc of rows.docs) {
            assert.equal(doc.get("status"), "queued");
            assert.equal(doc.get("update"), "received");
            assert.equal(doc.get("containerId"), "");
            assert.equal(doc.get("businessName"), "Dala Shipping");
          }
          const line = (await lineRef(lineId).get()).data();
          assert.equal(line.lastCustomerUpdate.update, "received");
          await call("assignContainerLines", {containerId: box,
            lineIds: [lineId]});
          await recordMoments(box);
          assert.equal(await eventsOf(box), 0);
          assert.equal(await updatesOf(), before + 2);
          // Only queued: the platform's trigger sends, not the callable.
          assert.equal(whatsappCalls.length, 0);
        });

    it("lets exactly one of two waiting cars of a VIN through", async () => {
      const vin = freshVin();
      const results = await Promise.allSettled([
        call("addWaitingPackage", waitingCar(vin)),
        call("addWaitingPackage", waitingCar(vin)),
        call("addWaitingPackage", waitingCar(vin)),
      ]);
      const won = results.filter((r) => r.status === "fulfilled");
      assert.equal(won.length, 1, JSON.stringify(results.map((r) =>
        r.reason?.message || "ok")));
      for (const {reason} of results.filter((r) => r.status === "rejected")) {
        // A loser either sees the winner's lock (the clean refusal) or loses
        // the transaction race itself; the emulator reports that as
        // contention. Exactly one winner is the guarantee, not the wording.
        if (reason.details?.reason) {
          assert.equal(reason.details.reason, "vin_already_loaded");
          assert.equal(reason.details.conflictWaiting, true);
        } else {
          assert.match(`${reason.code} ${reason.message}`,
              /abort|contention|invalid or closed/i);
        }
      }
      const lock = await lockRef(vin).get();
      assert.equal(lock.get("lineId"), won[0].value.lineId);
      assert.equal(lock.get("containerId"), "");
    });

    // The race the plan names: a waiting car and a loaded one of the same VIN.
    it("blocks the same VIN on a container, and the other way round",
        async () => {
          const vin = freshVin();
          const box = await newContainer();
          const {lineId} = await call("addWaitingPackage", waitingCar(vin));
          await assert.rejects(
              call("addContainerLine", {containerId: box, line: carLine(vin)}),
              (error) => error.details?.reason === "vin_already_loaded" &&
                error.details?.conflictWaiting === true &&
                /waiting for a container/.test(error.message));
          const otherVin = freshVin();
          await call("addContainerLine",
              {containerId: box, line: carLine(otherVin)});
          await assert.rejects(
              call("addWaitingPackage", waitingCar(otherVin)),
              (error) => error.details?.conflictContainerId === box &&
                error.details?.conflictWaiting === false);
          // Racing the two kinds of add: one wins.
          const raceVin = freshVin();
          const results = await Promise.allSettled([
            call("addWaitingPackage", waitingCar(raceVin)),
            call("addContainerLine", {containerId: box,
              line: carLine(raceVin)}),
          ]);
          assert.equal(results.filter((r) => r.status === "fulfilled").length,
              1);
          assert.equal((await db.collection("containerLines")
              .where("businessId", "==", BIZ)
              .where("vinNumber", "==", raceVin).get()).size, 1);
          // Removing the waiting car frees it.
          await call("removeContainerLine", {lineId});
          assert.equal((await lockRef(vin).get()).exists, false);
          await call("addContainerLine", {containerId: box,
            line: carLine(vin)});
        });
  });

  describe("adding them to a container", () => {
    it("assigns all of them, keeping codes, lock and tallies", async () => {
      const box = await newContainer();
      const vin = freshVin();
      const a = await call("addWaitingPackage", waitingPackage({quantity: 3}));
      const b = await call("addWaitingPackage", waitingCar(vin));
      const c = await call("addWaitingPackage", waitingPackage({kind: "other",
        quantity: 2, description: "Boxes"}));
      const result = await call("assignContainerLines", {containerId: box,
        lineIds: [a.lineId, b.lineId, c.lineId, a.lineId]});
      assert.equal(result.assigned, 3);
      for (const {lineId, trackingCode} of [a, b, c]) {
        const line = (await lineRef(lineId).get()).data();
        assert.equal(line.containerId, box);
        assert.equal(line.containerStatus, "loading");
        // Its code never changes: the label printed at drop-off still reads.
        assert.equal(line.trackingCode, trackingCode);
      }
      assert.equal((await lockRef(vin).get()).get("containerId"), box);
      assert.deepEqual(await tallies(box),
          {lineCount: 3, carCount: 1, barrelCount: 3, otherCount: 2});
      assert.deepEqual(await tallies(box), await recount(box));
      const [onBox] = await audits(box, "lines_assigned");
      assert.match(onBox.summary, /^Added 3 waiting packages/);
      assert.equal((await audits(a.lineId, "line_assigned")).length, 1);
    });

    it("then ships like any other line, with its own code", async () => {
      const box = await newContainer();
      const {lineId, trackingCode} = await call("addWaitingPackage",
          waitingPackage());
      await call("assignContainerLines", {containerId: box,
        lineIds: [lineId]});
      await call("setContainerStatus", {containerId: box, status: "shipped"});
      const line = (await lineRef(lineId).get()).data();
      assert.equal(line.containerStatus, "shipped");
      assert.equal(line.trackingCode, trackingCode);
      const moment = await db.collection("containers").doc(box)
          .collection("trackingEvents").doc("staff_shipped").get();
      assert.equal(moment.get("customerUpdate"), "shipped");
    });

    it("is all or nothing: one package that does not fit stops them all",
        async () => {
          const box = await newContainer();
          const fits = await call("addWaitingPackage", waitingPackage());
          const wrong = await call("addWaitingPackage",
              waitingPackage(SENEGAL));
          const wrongToo = await call("addWaitingPackage",
              waitingPackage(SENEGAL));
          await assert.rejects(
              call("assignContainerLines", {containerId: box,
                lineIds: [fits.lineId, wrong.lineId, wrongToo.lineId]}),
              (error) => error.code === "failed-precondition" &&
                error.details?.reason === "destination_mismatch" &&
                JSON.stringify(error.details?.lineIds) ===
                  JSON.stringify([wrong.lineId, wrongToo.lineId]));
          // Nothing moved, nothing counted.
          for (const {lineId} of [fits, wrong, wrongToo]) {
            const line = (await lineRef(lineId).get()).data();
            assert.equal(line.containerId, "");
            assert.equal(line.containerStatus, "waiting");
          }
          assert.deepEqual(await tallies(box),
              {lineCount: 0, carCount: 0, barrelCount: 0, otherCount: 0});
          assert.deepEqual(await linesOf(box), []);
        });

    it("never loses a car's lock to a refused batch", async () => {
      const box = await newContainer();
      const vin = freshVin();
      const car = await call("addWaitingPackage", waitingCar(vin));
      const wrong = await call("addWaitingPackage", waitingPackage(SENEGAL));
      await assert.rejects(call("assignContainerLines", {containerId: box,
        lineIds: [car.lineId, wrong.lineId]}));
      assert.equal((await lockRef(vin).get()).get("containerId"), "");
      assert.equal((await lockRef(vin).get()).get("lineId"), car.lineId);
    });

    it("refuses a container that has not chosen where it goes", async () => {
      const {containerId} = await call("createContainer",
          {label: "Undecided box"});
      const {lineId} = await call("addWaitingPackage", waitingPackage());
      await assert.rejects(
          call("assignContainerLines", {containerId, lineIds: [lineId]}),
          (error) => error.details?.reason ===
            "container_destination_required");
      assert.equal((await lineRef(lineId).get()).get("containerId"), "");
    });

    it("refuses a shipped box, a line already loaded, and a stranger's",
        async () => {
          const shipped = await newContainer();
          await call("addContainerLine", {containerId: shipped,
            line: barrelLine(1)});
          await call("setContainerStatus",
              {containerId: shipped, status: "shipped"});
          const open = await newContainer();
          const mine = await call("addWaitingPackage", waitingPackage());
          await assert.rejects(
              call("assignContainerLines", {containerId: shipped,
                lineIds: [mine.lineId]}),
              (error) => error.details?.reason === "container_locked");
          await call("assignContainerLines", {containerId: open,
            lineIds: [mine.lineId]});
          const second = await newContainer();
          await assert.rejects(
              call("assignContainerLines", {containerId: second,
                lineIds: [mine.lineId]}),
              (error) => error.details?.reason === "line_not_waiting" &&
                error.details?.lineIds?.[0] === mine.lineId);
          await assert.rejects(
              call("assignContainerLines", {containerId: second,
                lineIds: ["no-such-line"]}),
              (error) => error.code === "not-found");
          // A line from another business is not found, never leaked.
          const foreign = db.collection("containerLines").doc();
          await foreign.set({businessId: "someone-else", containerId: "",
            containerStatus: "waiting", kind: "barrels", quantity: 1,
            destinationCountryId: "gn"});
          await assert.rejects(
              call("assignContainerLines", {containerId: second,
                lineIds: [foreign.id]}),
              (error) => error.code === "not-found");
          assert.equal((await foreign.get()).get("containerId"), "");
        });

    it("takes one to a hundred ids, for staff with the section", async () => {
      const box = await newContainer();
      for (const lineIds of [[], undefined, ["x".repeat(0)],
        Array.from({length: 101}, (_, i) => `l${i}`)]) {
        await assert.rejects(call("assignContainerLines",
            {containerId: box, lineIds}),
        (error) => error.code === "invalid-argument" &&
            error.details?.reasons?.includes("line_ids_invalid"));
      }
      await assert.rejects(call("assignContainerLines",
          {containerId: box, lineIds: ["a"]}, NO_CONTAINERS),
      (error) => error.code === "permission-denied");
    });

    it("lets one of two boxes take a package, never both", async () => {
      const first = await newContainer();
      const second = await newContainer();
      const {lineId} = await call("addWaitingPackage", waitingPackage());
      const results = await Promise.allSettled([
        call("assignContainerLines", {containerId: first, lineIds: [lineId]}),
        call("assignContainerLines", {containerId: second,
          lineIds: [lineId]}),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      const home = (await lineRef(lineId).get()).get("containerId");
      assert.ok([first, second].includes(home));
      const total = (await tallies(first)).lineCount +
        (await tallies(second)).lineCount;
      assert.equal(total, 1);
    });

    it("keeps a package where the box is going when either changes",
        async () => {
          const box = await newContainer();
          const {lineId} = await call("addWaitingPackage", waitingPackage());
          await call("assignContainerLines", {containerId: box,
            lineIds: [lineId]});
          await assert.rejects(
              call("updateContainer", {containerId: box,
                changes: SENEGAL}),
              (error) => error.details?.reason === "destination_mismatch" &&
                error.details?.lineIds?.[0] === lineId);
          await assert.rejects(
              call("updateContainerLine", {lineId, containerId: box,
                line: {...waitingPackage(), ...SENEGAL}}),
              (error) => error.details?.reason === "destination_mismatch");
          // Moving it to a box going elsewhere is refused the same way.
          const elsewhere = await newContainer(SENEGAL);
          await assert.rejects(
              call("moveContainerLine", {lineId, toContainerId: elsewhere}),
              (error) => error.details?.reason === "destination_mismatch");
          const alsoGuinea = await newContainer();
          await call("moveContainerLine", {lineId, toContainerId: alsoGuinea});
          assert.equal((await lineRef(lineId).get()).get("containerId"),
              alsoGuinea);
          // And a direct add that names another destination.
          await assert.rejects(
              call("addContainerLine", {containerId: box,
                line: {...barrelLine(1), ...SENEGAL}}),
              (error) => error.details?.reason === "destination_mismatch");
        });
  });

  describe("sending one back to waiting", () => {
    it("puts it back with its lock and takes it off the tallies", async () => {
      const box = await newContainer();
      const vin = freshVin();
      const car = await call("addWaitingPackage", waitingCar(vin));
      const barrels = await call("addWaitingPackage",
          waitingPackage({quantity: 4}));
      await call("assignContainerLines", {containerId: box,
        lineIds: [car.lineId, barrels.lineId]});
      assert.deepEqual(await tallies(box),
          {lineCount: 2, carCount: 1, barrelCount: 4, otherCount: 0});
      await call("unassignContainerLine", {lineId: car.lineId});
      await call("unassignContainerLine", {lineId: barrels.lineId});
      for (const {lineId} of [car, barrels]) {
        const line = (await lineRef(lineId).get()).data();
        assert.equal(line.containerId, "");
        assert.equal(line.containerStatus, "waiting");
      }
      assert.deepEqual(await tallies(box),
          {lineCount: 0, carCount: 0, barrelCount: 0, otherCount: 0});
      // The car is still held: by the waiting list, no longer by the box.
      const lock = await lockRef(vin).get();
      assert.equal(lock.get("lineId"), car.lineId);
      assert.equal(lock.get("containerId"), "");
      await assert.rejects(
          call("addContainerLine", {containerId: box, line: carLine(vin)}),
          (error) => error.details?.conflictWaiting === true);
      assert.equal((await audits(box, "line_unassigned")).length, 2);
      // And the box can be deleted again.
      await call("deleteContainer", {containerId: box});
    });

    it("is refused once the box has shipped, or when nothing is on a box",
        async () => {
          const box = await newContainer();
          const {lineId} = await call("addWaitingPackage", waitingPackage());
          await assert.rejects(call("unassignContainerLine", {lineId}),
              (error) => error.details?.reason === "line_not_in_container");
          await call("assignContainerLines", {containerId: box,
            lineIds: [lineId]});
          await call("setContainerStatus", {containerId: box,
            status: "shipped"});
          await assert.rejects(call("unassignContainerLine", {lineId}),
              (error) => error.details?.reason === "container_locked");
          assert.equal((await lineRef(lineId).get()).get("containerId"), box);
          await assert.rejects(call("unassignContainerLine",
              {lineId: "no-such-line"}), (error) => error.code === "not-found");
          await assert.rejects(call("unassignContainerLine", {lineId},
              NO_CONTAINERS), (error) => error.code === "permission-denied");
        });
  });

  describe("editing and removing a waiting package", () => {
    it("changes what it is, and the history says who and what", async () => {
      const {lineId, trackingCode} = await call("addWaitingPackage",
          waitingPackage({quantity: 2}));
      const result = await call("updateContainerLine", {lineId,
        line: {...waitingPackage({quantity: 5, lengthIn: 40, widthIn: 30,
          heightIn: 20}), ...SENEGAL}});
      assert.deepEqual(result.changed, ["quantity", "destinationCountryId",
        "destinationCountryName", "lengthIn", "widthIn", "heightIn"]);
      const line = (await lineRef(lineId).get()).data();
      assert.equal(line.quantity, 5);
      assert.equal(line.destinationCountryId, "sn");
      assert.equal(line.containerId, "");
      assert.equal(line.trackingCode, trackingCode);
      assert.equal(line.editedByStaffId, OWNER);
      const [entry] = await audits(lineId, "line_edited");
      assert.equal(entry.byStaffId, OWNER);
      assert.match(entry.summary, /^Edited 5 barrels \(was 2 barrels\)/);
      // Its contacts too, with no container to ask.
      const contacts = await call("updateContainerLineContacts", {lineId,
        contacts: {customerName: "Fatou Diallo",
          customerPhone: "+16465550100", receiverName: "Awa Ba",
          receiverPhone: "+224620000000"}});
      assert.deepEqual(contacts.changed, ["receiverName"]);
      assert.equal((await audits(lineId, "line_contacts_edited")).length, 1);
      // Its car can change, and the lock goes with it.
      const car = await call("addWaitingPackage", waitingCar(freshVin()));
      const newVin = freshVin();
      await call("updateContainerLine", {lineId: car.lineId,
        line: {...waitingCar(newVin)}});
      assert.equal((await lockRef(newVin).get()).get("lineId"), car.lineId);
    });

    it("keeps the size all-or-nothing, and the price above what was paid",
        async () => {
          const {lineId} = await call("addWaitingPackage",
              waitingPackage({priceCents: 15000}));
          await assert.rejects(call("updateContainerLine", {lineId,
            line: {lengthIn: 10}}),
          (error) => error.details?.reasons?.includes("size_invalid"));
          await pay( {lineId,
            amountCents: 5000, method: "cash"});
          await assert.rejects(call("updateContainerLine", {lineId,
            line: {priceCents: 4000}}),
          (error) => error.details?.reasons?.includes("price_below_paid"));
          // The price may be edited on the whole line while it is above.
          const result = await call("updateContainerLine", {lineId,
            line: {priceCents: 20000, paidCents: 0}});
          assert.deepEqual(result.changed, ["priceCents"]);
          const line = (await lineRef(lineId).get()).data();
          assert.equal(line.priceCents, 20000);
          assert.equal(line.paidCents, 5000);
        });

    it("locks what it is once its box has shipped, not the price",
        async () => {
          const box = await newContainer();
          const {lineId} = await call("addWaitingPackage",
              waitingPackage({quantity: 2}));
          await call("assignContainerLines", {containerId: box,
            lineIds: [lineId]});
          await call("updateContainerLine", {lineId, containerId: box,
            line: {quantity: 3}});
          await call("setContainerStatus", {containerId: box,
            status: "shipped"});
          await assert.rejects(call("updateContainerLine", {lineId,
            line: {quantity: 4}}),
          (error) => error.details?.reason === "container_locked");
          await assert.rejects(call("updateContainerLine", {lineId,
            line: {lengthIn: 1, widthIn: 1, heightIn: 1}}),
          (error) => error.details?.reason === "container_locked");
          const priced = await call("updateContainerLine", {lineId,
            line: {priceCents: 8000, payOnArrival: true}});
          assert.deepEqual(priced.changed, ["priceCents", "payOnArrival"]);
        });

    it("cannot be moved: it is added to a box instead", async () => {
      const box = await newContainer();
      const {lineId} = await call("addWaitingPackage", waitingPackage());
      await assert.rejects(call("moveContainerLine",
          {lineId, toContainerId: box}),
      (error) => error.code === "failed-precondition" &&
          error.details?.reason === "line_is_waiting");
    });

    it("is removed with its lock, but not while payments stand",
        async () => {
          const vin = freshVin();
          const {lineId} = await call("addWaitingPackage", {...waitingCar(vin),
            priceCents: 10000});
          await pay( {lineId,
            amountCents: 2000, method: "cash"});
          await assert.rejects(call("removeContainerLine", {lineId}),
              (error) => error.details?.reason === "line_has_payments");
          assert.equal((await lineRef(lineId).get()).exists, true);
          const {paymentId} = (await db.collection("containerLinePayments")
              .where("lineId", "==", lineId).get()).docs
              .map((d) => ({paymentId: d.id}))[0];
          await call("revertContainerLinePayment", {paymentId});
          await call("removeContainerLine", {lineId});
          assert.equal((await lineRef(lineId).get()).exists, false);
          assert.equal((await lockRef(vin).get()).exists, false);
          assert.equal((await audits(lineId, "line_removed")).length, 1);
          // Gone is gone, and a package on a box is not "waiting".
          await assert.rejects(call("removeContainerLine", {lineId}),
              (error) => error.code === "not-found");
          const box = await newContainer();
          const placed = await call("addWaitingPackage", waitingPackage());
          await call("assignContainerLines", {containerId: box,
            lineIds: [placed.lineId]});
          await assert.rejects(call("removeContainerLine",
              {lineId: placed.lineId}),
          (error) => error.code === "not-found");
          await call("removeContainerLine",
              {containerId: box, lineId: placed.lineId});
          assert.deepEqual(await tallies(box), await recount(box));
        });
  });

  describe("price and payments", () => {
    const payments = async (lineId) => (await db
        .collection("containerLinePayments").where("lineId", "==", lineId)
        .get()).docs.map((d) => ({id: d.id, ...d.data()}));

    it("sets the price any time, never below what was paid", async () => {
      const {lineId} = await call("addWaitingPackage", waitingPackage());
      const set = await call("setContainerLinePrice", {lineId,
        priceCents: 15000, payOnArrival: true});
      assert.equal(set.priceCents, 15000);
      let line = (await lineRef(lineId).get()).data();
      assert.equal(line.priceCents, 15000);
      assert.equal(line.payOnArrival, true);
      await pay( {lineId, amountCents: 6000,
        method: "zelle"});
      await assert.rejects(call("setContainerLinePrice", {lineId,
        priceCents: 5999, payOnArrival: true}),
      (error) => error.details?.reasons?.includes("price_below_paid"));
      await assert.rejects(call("setContainerLinePrice", {lineId,
        priceCents: null, payOnArrival: false}),
      (error) => error.details?.reasons?.includes("price_below_paid"));
      await assert.rejects(call("setContainerLinePrice", {lineId,
        priceCents: 0, payOnArrival: false}),
      (error) => error.details?.reasons?.includes("price_invalid"));
      await call("setContainerLinePrice", {lineId, priceCents: 6000,
        payOnArrival: false});
      line = (await lineRef(lineId).get()).data();
      assert.equal(line.priceCents, 6000);
      assert.equal(line.payOnArrival, false);
      const history = await audits(lineId, "price_set");
      assert.equal(history.length, 2);
      assert.match(history[0].summary.concat(history[1].summary),
          /price \$150\.00 → \$60\.00/);
      await assert.rejects(call("setContainerLinePrice", {lineId,
        priceCents: 100, payOnArrival: false}, NO_CONTAINERS),
      (error) => error.code === "permission-denied");
      await assert.rejects(call("setContainerLinePrice", {lineId: "nope",
        priceCents: 100, payOnArrival: false}),
      (error) => error.code === "not-found");
    });

    it("records partial payments up to the price, who and when", async () => {
      const {lineId} = await call("addWaitingPackage",
          waitingPackage({priceCents: 15000}));
      const first = await pay( {lineId,
        amountCents: 5000, method: "cash", note: "at the counter"});
      assert.equal(first.paidCents, 5000);
      const second = await pay( {lineId,
        amountCents: 10000, method: "zelle"});
      assert.equal(second.paidCents, 15000);
      const rows = await payments(lineId);
      assert.equal(rows.length, 2);
      const row = rows.find((r) => r.id === first.paymentId);
      assert.equal(row.businessId, BIZ);
      assert.equal(row.amountCents, 5000);
      assert.equal(row.method, "cash");
      assert.equal(row.note, "at the counter");
      // The cashier held the money; the owner typed it in.
      assert.equal(row.receivedByStaffId, RECEIVER);
      assert.equal(row.recordedByStaffId, OWNER);
      assert.equal(row.reverted, false);
      assert.ok(row.createdAt);
      assert.equal((await lineRef(lineId).get()).get("paidCents"), 15000);
      assert.equal((await audits(lineId, "payment")).length, 2);
      const full = (await audits(lineId, "payment"))
          .map((e) => e.summary).filter((t) => /paid in full/.test(t));
      assert.equal(full.length, 1);
    });

    it("refuses a payment that does not say who took the money", async () => {
      const {lineId} = await call("addWaitingPackage",
          waitingPackage({priceCents: 10000}));
      for (const blank of [undefined, "", "   "]) {
        await assert.rejects(call("recordContainerLinePayment",
            {lineId, amountCents: 100, method: "cash",
              receivedByStaffId: blank}),
        (error) => error.code === "invalid-argument" &&
            error.details?.reasons?.includes("received_by_required") &&
            error.message === "Say which staff member took the payment.",
        String(blank));
      }
      assert.equal((await payments(lineId)).length, 0);
      assert.equal((await lineRef(lineId).get()).get("paidCents"), 0);
    });

    it("names who took it and who typed it in, when they differ",
        async () => {
          const {lineId} = await call("addWaitingPackage",
              waitingPackage({priceCents: 10000}));
          await pay({lineId, amountCents: 2000, method: "cash"});
          // Typing in one's own receipt names the person once.
          await pay({lineId, amountCents: 1000, method: "zelle",
            receivedByStaffId: OWNER});
          const summaries = (await audits(lineId, "payment"))
              .map((e) => e.summary);
          const both = new RegExp("^Received \\$20\\.00 \\(cash\\) by " +
            "Awa Cashier \\(entered by Dala Owner\\) for ");
          assert.ok(summaries.some((t) => both.test(t)), summaries.join("|"));
          assert.ok(summaries.some((t) =>
            /^Received \$10\.00 \(zelle\) by Dala Owner for /.test(t) &&
            !/entered by/.test(t)), summaries.join(" | "));
        });

    // Regression: a person of another business used to be stored as the
    // one who held the money (only left unnamed in the history), so the
    // cash count credited a stranger.
    it("refuses a receiver who is not one of the business's people",
        async () => {
          const {lineId} = await call("addWaitingPackage",
              waitingPackage({priceCents: 10000}));
          for (const stranger of [OTHER_BIZ_STAFF, "no-such-person"]) {
            await assert.rejects(pay({lineId, amountCents: 500,
              method: "cash", receivedByStaffId: stranger}),
            (error) => error.code === "invalid-argument" &&
                error.details?.reasons?.[0] === "received_by_invalid" &&
                error.message === CONTAINER_MESSAGES.received_by_invalid,
            stranger);
          }
          // The payment's own checks still answer first.
          await assert.rejects(pay({lineId, amountCents: 999999,
            method: "cash", receivedByStaffId: OTHER_BIZ_STAFF}),
          (error) => error.details?.reasons?.includes(
              "payment_exceeds_balance"));
          assert.equal((await payments(lineId)).length, 0);
          assert.equal((await lineRef(lineId).get()).get("paidCents"), 0);
        });

    it("refuses an overpayment, no price, and a bad payment", async () => {
      const unpriced = await call("addWaitingPackage", waitingPackage());
      await assert.rejects(pay(
          {lineId: unpriced.lineId, amountCents: 100, method: "cash"}),
      (error) => error.details?.reasons?.includes("price_required"));
      const {lineId} = await call("addWaitingPackage",
          waitingPackage({priceCents: 10000}));
      await pay( {lineId, amountCents: 7000,
        method: "cash"});
      await assert.rejects(pay(
          {lineId, amountCents: 3001, method: "cash"}),
      (error) => error.code === "invalid-argument" &&
          error.details?.reasons?.includes("payment_exceeds_balance"));
      await assert.rejects(pay(
          {lineId, amountCents: 0, method: "barter"}),
      (error) => error.details?.reasons?.includes("amount_required") &&
          error.details?.reasons?.includes("payment_method_invalid"));
      await assert.rejects(pay(
          {lineId, amountCents: 100, method: "cash"}, NO_CONTAINERS),
      (error) => error.code === "permission-denied");
      assert.equal((await lineRef(lineId).get()).get("paidCents"), 7000);
      assert.equal((await payments(lineId)).length, 1);
    });

    it("never overpays when two are recorded at once", async () => {
      const {lineId} = await call("addWaitingPackage",
          waitingPackage({priceCents: 10000}));
      const results = await Promise.allSettled([1, 2, 3, 4].map(() =>
        pay(
            {lineId, amountCents: 4000, method: "cash"})));
      const paid = (await lineRef(lineId).get()).get("paidCents");
      const live = (await payments(lineId)).reduce(
          (sum, p) => sum + p.amountCents, 0);
      assert.ok(paid <= 10000, `paid ${paid}`);
      assert.equal(paid, live);
      assert.equal(results.filter((r) => r.status === "fulfilled").length,
          paid / 4000);
    });

    it("reverts a payment softly, and works the total out again", async () => {
      const {lineId} = await call("addWaitingPackage",
          waitingPackage({priceCents: 10000}));
      const a = await pay( {lineId,
        amountCents: 4000, method: "cash"});
      await pay( {lineId, amountCents: 3000,
        method: "venmo"});
      const reverted = await call("revertContainerLinePayment",
          {paymentId: a.paymentId});
      assert.equal(reverted.paidCents, 3000);
      assert.equal((await lineRef(lineId).get()).get("paidCents"), 3000);
      const row = (await db.collection("containerLinePayments")
          .doc(a.paymentId).get()).data();
      // Struck through, not erased: it still says who took it, and who and
      // when it was undone.
      assert.equal(row.reverted, true);
      assert.equal(row.revertedByStaffId, OWNER);
      assert.ok(row.revertedAt);
      assert.equal(row.receivedByStaffId, RECEIVER);
      assert.equal(row.recordedByStaffId, OWNER);
      assert.equal(row.amountCents, 4000);
      await assert.rejects(call("revertContainerLinePayment",
          {paymentId: a.paymentId}),
      (error) => error.details?.reason === "payment_already_reverted");
      await assert.rejects(call("revertContainerLinePayment",
          {paymentId: "no-such-payment"}), (error) => error.code ===
          "not-found");
      await assert.rejects(call("revertContainerLinePayment",
          {paymentId: a.paymentId}, NO_CONTAINERS),
      (error) => error.code === "permission-denied");
      // The room it made is usable again.
      await pay( {lineId, amountCents: 7000,
        method: "cash"});
      assert.equal((await lineRef(lineId).get()).get("paidCents"), 10000);
      assert.equal((await audits(lineId, "payment_reverted")).length, 1);
    });

    it("works on a line in a shipped box, and tells the box's history",
        async () => {
          const box = await newContainer();
          const {lineId} = await call("addWaitingPackage",
              waitingPackage({priceCents: 10000}));
          await call("assignContainerLines", {containerId: box,
            lineIds: [lineId]});
          await call("setContainerStatus", {containerId: box,
            status: "shipped"});
          const result = await pay(
              {lineId, amountCents: 10000, method: "cash"});
          assert.equal(result.paidCents, 10000);
          assert.equal((await audits(box, "payment")).length, 1);
          assert.equal((await audits(lineId, "payment")).length, 1);
        });
  });

  describe("money received as it is dropped off", () => {
    const paymentsOf = async (lineId) => (await db
        .collection("containerLinePayments").where("lineId", "==", lineId)
        .get()).docs.map((d) => ({id: d.id, ...d.data()}));
    const linesFor = async (customerName) => (await db
        .collection("containerLines").where("businessId", "==", BIZ)
        .where("customerName", "==", customerName).get()).size;
    const cash = (extra = {}) => ({amountCents: 6000, method: "cash",
      receivedByStaffId: RECEIVER, note: "at the counter", ...extra});

    it("writes the package and its payment together", async () => {
      const out = await call("addWaitingPackage", waitingPackage({
        priceCents: 15000, payOnArrival: true, payment: cash()}));
      assert.equal(out.paidCents, 6000);
      assert.ok(out.paymentId);
      assert.match(out.trackingCode, /^CL-/);
      const line = (await lineRef(out.lineId).get()).data();
      assert.equal(line.paidCents, 6000);
      assert.equal(line.priceCents, 15000);
      assert.equal(line.containerStatus, "waiting");
      const [row, ...more] = await paymentsOf(out.lineId);
      assert.equal(more.length, 0);
      assert.equal(row.id, out.paymentId);
      assert.equal(row.businessId, BIZ);
      assert.equal(row.amountCents, 6000);
      assert.equal(row.method, "cash");
      assert.equal(row.note, "at the counter");
      assert.equal(row.receivedByStaffId, RECEIVER);
      assert.equal(row.recordedByStaffId, OWNER);
      assert.equal(row.reverted, false);
      assert.ok(row.createdAt);
      const [entry] = await audits(out.lineId, "payment");
      assert.match(entry.summary, new RegExp("^Received \\$60\\.00 " +
        "\\(cash\\) by Awa Cashier \\(entered by Dala Owner\\) for "));
      assert.doesNotMatch(entry.summary, /paid in full/);
      assert.equal(entry.entityType, "container_line");
      // The rest is taken like any later payment.
      const rest = await pay({lineId: out.lineId, amountCents: 9000,
        method: "zelle"});
      assert.equal(rest.paidCents, 15000);
    });

    it("says paid in full when it covers the price", async () => {
      const out = await call("addWaitingPackage", waitingPackage({
        priceCents: 6000, payment: cash({receivedByStaffId: OWNER})}));
      const [entry] = await audits(out.lineId, "payment");
      assert.match(entry.summary,
          /^Received \$60\.00 \(cash\) by Dala Owner for .* — paid in full$/);
    });

    it("refuses before creating anything", async () => {
      const cases = [
        [{priceCents: 5000, payment: cash()}, "payment_exceeds_balance"],
        [{payment: cash()}, "price_required"],
        [{priceCents: 10000, payment: cash({receivedByStaffId: ""})},
          "received_by_required"],
        [{priceCents: 10000, payment: cash({receivedByStaffId: undefined})},
          "received_by_required"],
        [{priceCents: 10000, payment: cash({method: "barter"})},
          "payment_method_invalid"],
        [{priceCents: 10000, payment: cash({amountCents: 0})},
          "amount_required"],
        [{priceCents: 10000, payment: cash({
          receivedByStaffId: OTHER_BIZ_STAFF})}, "received_by_invalid"],
        [{priceCents: 10000, payment: cash({
          receivedByStaffId: "no-such-person"})}, "received_by_invalid"],
      ];
      for (const [extra, reason] of cases) {
        const customerName = `Refused ${reason} ${Math.random()}`;
        await assert.rejects(call("addWaitingPackage",
            waitingPackage({customerName, ...extra})),
        (error) => error.code === "invalid-argument" &&
            error.details?.reasons?.includes(reason), reason);
        assert.equal(await linesFor(customerName), 0, reason);
      }
      // The package's own problems and the payment's, named together.
      await assert.rejects(call("addWaitingPackage", waitingPackage({
        destinationCountryId: "", payment: cash()})),
      (error) => error.details?.reasons?.includes(
          "package_destination_required") &&
          error.details?.reasons?.includes("price_required"));
    });

    it("never leaves a car's lock behind when the money is refused",
        async () => {
          const vin = freshVin();
          await assert.rejects(call("addWaitingPackage", {
            ...waitingCar(vin), priceCents: 100, payment: cash()}));
          assert.equal((await lockRef(vin).get()).exists, false);
          const out = await call("addWaitingPackage", {...waitingCar(vin),
            priceCents: 6000, payment: cash()});
          assert.equal(out.paidCents, 6000);
          assert.equal((await lockRef(vin).get()).get("lineId"), out.lineId);
        });

    it("is unchanged without a payment", async () => {
      for (const payment of [undefined, null]) {
        const out = await call("addWaitingPackage",
            waitingPackage({priceCents: 15000, payment}));
        assert.equal(out.paidCents, 0);
        assert.equal(out.paymentId, "");
        assert.equal((await lineRef(out.lineId).get()).get("paidCents"), 0);
        assert.equal((await paymentsOf(out.lineId)).length, 0);
        assert.equal((await audits(out.lineId, "payment")).length, 0);
      }
    });
  });

  describe("their labels", () => {
    it("links straight to the labels of the lines asked for", async () => {
      const a = await call("addWaitingPackage", waitingPackage());
      const b = await call("addWaitingPackage", waitingPackage());
      const one = await call("getContainerDocumentUrl",
          {lineIds: [a.lineId]});
      const url = new URL(one.url);
      assert.equal(url.searchParams.get("view"), "labels");
      assert.equal(url.searchParams.get("code"),
          (await lineRef(a.lineId).get()).get("trackingCode"));
      const token = url.searchParams.get("t");
      assert.equal((await lineRef(a.lineId).get()).get("documentToken"),
          token);
      // Asking again hands back the same link, not a new secret.
      const again = await call("getContainerDocumentUrl",
          {lineIds: [a.lineId]});
      assert.equal(new URL(again.url).searchParams.get("t"), token);
      // Several lines: every token, one link, no single code.
      const both = await call("getContainerDocumentUrl",
          {lineIds: [a.lineId, b.lineId], format: "thermal", copies: 1});
      const query = new URL(both.url).searchParams;
      const bToken = (await lineRef(b.lineId).get()).get("documentToken");
      assert.equal(query.get("t"), `${token}.${bToken}`);
      assert.equal(query.get("code"), null);
      assert.equal(query.get("labels"), "thermal");
      assert.equal(query.get("copies"), "1");
      assert.notEqual(token, bToken);
    });

    it("is gated, scoped to the business, and bounded", async () => {
      const a = await call("addWaitingPackage", waitingPackage());
      await assert.rejects(call("getContainerDocumentUrl",
          {lineIds: [a.lineId]}, NO_CONTAINERS),
      (error) => error.code === "permission-denied");
      await assert.rejects(call("getContainerDocumentUrl",
          {lineIds: [a.lineId, "no-such-line"]}),
      (error) => error.code === "not-found" &&
          error.details?.lineIds?.includes("no-such-line"));
      await assert.rejects(call("getContainerDocumentUrl", {lineIds: []}),
          (error) => error.code === "invalid-argument");
      await assert.rejects(call("getContainerDocumentUrl",
          {lineIds: Array.from({length: 101}, (_, i) => `l${i}`)}),
      (error) => error.code === "invalid-argument");
    });

    // The /d page itself, answered as the platform would answer it.
    it("opens as a printable page through the document handler", async () => {
      const a = await call("addWaitingPackage",
          waitingPackage({lengthIn: 30, widthIn: 20, heightIn: 12.5,
            priceCents: 15000}));
      const b = await call("addWaitingPackage", waitingPackage({
        receiverName: "Awa Ba"}));
      const {url} = await call("getContainerDocumentUrl",
          {lineIds: [a.lineId, b.lineId]});
      const query = Object.fromEntries(new URL(url).searchParams);
      const sent = {};
      const res = Object.assign(new EventEmitter(), {
        set() {}, setHeader() {}, getHeader() {}, removeHeader() {},
        status(code) {
          sent.status = code;
          return this;
        }, send(body) {
          sent.body = body;
          return this;
        },
      });
      const open = (q) => functions.parkingDocument(
          {method: "GET", query: q, headers: {}}, res);
      await open(query);
      assert.equal(sent.status, 200);
      assert.match(sent.body, /\+224620000000/);
      assert.match(sent.body, /\+16465550100/);
      assert.match(sent.body, /30 × 20 × 12\.5 in/);
      assert.match(sent.body, /Awa Ba/);
      assert.doesNotMatch(sent.body, /150\.00|15000/);
      // One token alone opens just that line.
      const alone = Object.fromEntries(new URL((await call(
          "getContainerDocumentUrl", {lineIds: [b.lineId]})).url)
          .searchParams);
      sent.body = "";
      await open(alone);
      assert.match(sent.body, /Awa Ba/);
      assert.doesNotMatch(sent.body, /30 × 20 × 12\.5 in/);
      // A made-up token opens nothing.
      await open({t: "x".repeat(32), view: "labels"});
      assert.equal(sent.status, 404);
    });

    describe("as data for the phone to print", () => {
      it("gives waiting packages' labels, codes and all, no price",
          async () => {
            const a = await call("addWaitingPackage", waitingPackage({
              quantity: 2, lengthIn: 30, widthIn: 20, heightIn: 12.5,
              priceCents: 15000}));
            const b = await call("addWaitingPackage", waitingPackage({
              kind: "other", quantity: 1, description: "Generator",
              receiverName: "Awa Ba"}));
            const out = await call("getPackageLabels",
                {containerId: "", lineIds: [a.lineId, b.lineId]});
            assert.deepEqual(Object.keys(out).sort(), ["businessName",
              "businessPhone", "hasContainer", "labels", "reference"]);
            assert.equal(out.hasContainer, false);
            assert.equal(out.reference, "");
            assert.equal(out.businessName, "Dala Shipping");
            // Two copies a package by default: 2 barrels + 1 generator.
            assert.equal(out.labels.length, 6);
            const first = out.labels[0];
            assert.equal(first.code, a.trackingCode);
            assert.match(first.link, new RegExp(`/t/${a.trackingCode}$`));
            assert.equal(first.what, "Barrel");
            assert.equal(first.packageCount, 2);
            assert.equal(first.receiver, "Mariama Bah");
            assert.equal(first.receiverPhone, "+224620000000");
            assert.equal(first.sender, "Fatou Diallo");
            assert.equal(first.senderPhone, "+16465550100");
            assert.equal(first.destination, "Guinea");
            assert.equal(first.size, "30 × 20 × 12.5 in");
            assert.equal(first.place, "Guinea · 30 × 20 × 12.5 in");
            assert.equal(out.labels[5].what, "Generator");
            assert.equal(out.labels[5].receiver, "Awa Ba");
            assert.doesNotMatch(JSON.stringify(out), /15000|150\.00|logo/i);
            // One package, one copy each: a reprint.
            const one = await call("getPackageLabels",
                {lineId: b.lineId, copies: 1});
            assert.equal(one.labels.length, 1);
            assert.equal(one.labels[0].code, b.trackingCode);
          });

      it("gives a container's labels, the whole box or the lines asked",
          async () => {
            const box = await newContainer({containerNumber: "MSKU1234567"});
            const {lineId} = await call("addContainerLine",
                {containerId: box, line: barrelLine(3)});
            await call("addContainerLine",
                {containerId: box, line: carLine(freshVin())});
            const all = await call("getPackageLabels", {containerId: box});
            assert.equal(all.hasContainer, true);
            assert.equal(all.reference, "MSKU1234567");
            assert.equal(all.labels.length, (3 + 1) * 2);
            // Every line got its code as the labels were asked for.
            const code = (await lineRef(lineId).get()).get("trackingCode");
            assert.match(code, /^CL-/);
            assert.equal(all.labels[0].code, code);
            const just = await call("getPackageLabels",
                {containerId: box, lineId, copies: 1});
            assert.deepEqual(just.labels.map((l) => l.packageNumber),
                [1, 2, 3]);
            await assert.rejects(call("getPackageLabels",
                {containerId: box, lineIds: [lineId, "not-on-it"]}),
            (error) => error.code === "not-found" &&
                error.details?.lineIds?.includes("not-on-it"));
          });

      it("is gated, scoped to the business, and bounded", async () => {
        const a = await call("addWaitingPackage", waitingPackage());
        const box = await newContainer();
        await assert.rejects(call("getPackageLabels",
            {lineIds: [a.lineId]}, NO_CONTAINERS),
        (error) => error.code === "permission-denied");
        await assert.rejects(call("getPackageLabels",
            {containerId: box}, NO_CONTAINERS),
        (error) => error.code === "permission-denied");
        await assert.rejects(call("getPackageLabels",
            {lineIds: [a.lineId]}, OTHER_BIZ_STAFF),
        (error) => error.code === "permission-denied");
        await assert.rejects(call("getPackageLabels",
            {lineIds: [a.lineId, "no-such-line"]}),
        (error) => error.code === "not-found" &&
            error.details?.lineIds?.includes("no-such-line"));
        await assert.rejects(call("getPackageLabels", {lineIds: []}),
            (error) => error.code === "invalid-argument");
        await assert.rejects(call("getPackageLabels", {}),
            (error) => error.code === "invalid-argument");
        await assert.rejects(call("getPackageLabels",
            {lineIds: Array.from({length: 101}, (_, i) => `l${i}`)}),
        (error) => error.code === "invalid-argument" &&
            error.details?.reasons?.includes("line_ids_invalid"));
        await assert.rejects(call("getPackageLabels",
            {containerId: "no-such-box"}),
        (error) => error.code === "not-found");
      });
    });
  });
});

// node:test runs the suites above when this file is executed directly.

describe("setDestinationPickup", () => {
  const col = () => db.collection("businesses").doc(BIZ)
      .collection("destinationCountries");

  it("stores the pickup city, address and E.164 phone, and clears blanks",
      async () => {
        await col().doc("sn").set({businessId: BIZ, name: "Senegal"},
            {merge: true});
        const saved = await call("setDestinationPickup", {countryId: "sn",
          pickupCity: " Dakar ", pickupAddress: "Plateau\n rue 10",
          pickupPhone: "+221 77 123 45 67"});
        assert.deepEqual(saved, {countryId: "sn", pickupCity: "Dakar",
          pickupAddress: "Plateau rue 10", pickupPhone: "+221771234567"});
        let doc = (await col().doc("sn").get()).data();
        assert.equal(doc.pickupCity, "Dakar");
        assert.equal(doc.pickupAddress, "Plateau rue 10");
        assert.equal(doc.pickupPhone, "+221771234567");
        assert.equal(doc.name, "Senegal");
        await call("setDestinationPickup", {countryId: "sn",
          pickupCity: "Thiès", pickupAddress: "", pickupPhone: ""});
        doc = (await col().doc("sn").get()).data();
        assert.equal(doc.pickupCity, "Thiès");
        assert.ok(!("pickupAddress" in doc));
        assert.ok(!("pickupPhone" in doc));
      });

  it("refuses a phone without its country code, or text that is too long",
      async () => {
        await col().doc("sn").set({businessId: BIZ, name: "Senegal"},
            {merge: true});
        await assert.rejects(
            call("setDestinationPickup", {countryId: "sn",
              pickupPhone: "771234567"}),
            (error) => error.code === "invalid-argument" &&
              error.details?.reason === "pickup_phone_invalid");
        await assert.rejects(
            call("setDestinationPickup", {countryId: "sn",
              pickupAddress: "x".repeat(201)}),
            (error) => error.details?.reason === "pickup_address_too_long");
        await assert.rejects(
            call("setDestinationPickup", {countryId: "sn",
              pickupCity: 7}),
            (error) => error.details?.reason === "pickup_field_invalid");
        // Nothing was written by a refused call.
        assert.notEqual((await col().doc("sn").get()).get("pickupPhone"),
            "771234567");
      });

  it("refuses a destination the business does not have", async () => {
    await assert.rejects(
        call("setDestinationPickup", {countryId: "nowhere",
          pickupCity: "X"}),
        (error) => error.code === "not-found");
    await assert.rejects(
        call("setDestinationPickup", {countryId: "", pickupCity: "X"}),
        (error) => error.details?.reason === "destination_required");
  });

  it("is for staff with the destinations section only", async () => {
    await assert.rejects(
        call("setDestinationPickup", {countryId: "sn", pickupCity: "X"},
            NO_CONTAINERS),
        (error) => error.code === "permission-denied");
    await assert.rejects(
        call("setDestinationPickup", {countryId: "sn", pickupCity: "X"},
            OTHER_BIZ_STAFF));
  });
});

describe("setMainDestination", () => {
  it("keeps one main destination, moves it, and clears it", async () => {
    const col = db.collection("businesses").doc(BIZ)
        .collection("destinationCountries");
    await col.doc("gn").set({businessId: BIZ, name: "Guinea"});
    await col.doc("sn").set({businessId: BIZ, name: "Senegal"});
    await call("setMainDestination", {countryId: "gn"});
    assert.equal((await col.doc("gn").get()).data().isMain, true);
    await call("setMainDestination", {countryId: "sn"});
    assert.equal((await col.doc("gn").get()).data().isMain, false);
    assert.equal((await col.doc("sn").get()).data().isMain, true);
    await call("setMainDestination", {countryId: ""});
    assert.equal((await col.doc("sn").get()).data().isMain, false);
    await assert.rejects(call("setMainDestination", {countryId: "nowhere"}),
        /not-found|Destination not found/);
  });
  it("is for staff with the destinations section only", async () => {
    await assert.rejects(
        call("setMainDestination", {countryId: "gn"}, "container-test-nobody"));
  });
});


// Pieces on lines and packages split across containers
// (docs/PACKAGE_REQUESTS.md §1, §4 and §7; docs/WAITING_PACKAGES.md
// "Pieces" and "Split across containers").
describe("pieces on lines", () => {
  const lineRef = (id) => db.collection("containerLines").doc(id);
  const lineOf = async (id) => (await lineRef(id).get()).data();
  const GUINEA = {destinationCountryId: "gn",
    destinationCountryName: "Guinea"};
  const people = {ownerKind: "customer", customerName: "Fatou Diallo",
    customerPhone: "+16465550100", receiverName: "Mariama Bah",
    receiverPhone: "+224620000000", ...GUINEA};
  // Two barrels at $100, a box of clothes at $50, a TV not priced yet.
  const fourPieces = () => [
    {kind: "barrel", priceCents: 10000},
    {kind: "barrel", priceCents: 10000},
    {kind: "box", description: "Clothes", priceCents: 5000,
      sizeIn: {l: 20, w: 20, h: 20}},
    {kind: "other", description: "TV", priceCents: null},
  ];
  const counter = (extra = {}) => ({...people, pieces: fourPieces(),
    ...extra});
  const tallies = async (id) => {
    const row = (await db.collection("containers").doc(id).get()).data();
    return {lineCount: row.lineCount, carCount: row.carCount,
      barrelCount: row.barrelCount, otherCount: row.otherCount};
  };
  const groupOf = async (rootId) => (await db.collection("containerLines")
      .where("businessId", "==", BIZ).where("rootLineId", "==", rootId)
      .get()).docs;
  const audits = async (entityId, action) => {
    const snap = await db.collection("lotLedgerAudit")
        .where("entityId", "==", entityId).where("action", "==", action).get();
    return snap.docs.map((d) => d.data());
  };
  const track = (identifier) =>
    functions.lookupGuestTracking.run({data: {identifier}});

  it("registers a package piece by piece at the counter", async () => {
    const result = await call("addWaitingPackage", counter({
      // What an old form would send beside the pieces is not what counts.
      kind: "barrels", quantity: 9, priceCents: 1,
      payment: {amountCents: 20000, method: "cash",
        receivedByStaffId: RECEIVER},
    }));
    assert.equal(result.pieceCount, 4);
    assert.equal(result.paidCents, 20000);
    const line = await lineOf(result.lineId);
    assert.deepEqual(line.pieces.map((p) => [p.id, p.kind, p.priceCents]), [
      ["p1", "barrel", 10000], ["p2", "barrel", 10000], ["p3", "box", 5000],
      ["p4", "other", null]]);
    assert.deepEqual(line.pieces[2].sizeIn, {l: 20, w: 20, h: 20});
    assert.equal(line.priceCents, 25000);
    assert.equal(line.kind, "other");
    assert.equal(line.quantity, 4);
    assert.equal(line.description, "Barrel, Clothes, TV");
    assert.deepEqual([line.pieceCount, line.barrelPieces, line.packagePieces,
      line.carPieces], [4, 2, 2, 0]);
    assert.equal(line.source, "counter");
    assert.equal(line.requestId, "");
    assert.ok(line.receivedAt && typeof line.receivedAt.toMillis ===
      "function", "receivedAt is a server timestamp");
    assert.equal(line.rootLineId, result.lineId);
    assert.equal(line.partIndex, 1);
    const [received] = await audits(result.lineId, "line_added");
    assert.match(received.summary,
        /^Received 2 barrels, 1 box, TV for Fatou Diallo/);
  });

  it("refuses bad pieces, every problem at once, before writing", async () => {
    const before = (await db.collection("containerLines").get()).size;
    await assert.rejects(call("addWaitingPackage", counter({pieces: [
      {kind: "box"}, {kind: "crate", description: "x"},
      {kind: "barrel", priceCents: -5},
      {kind: "other", description: "y".repeat(121)},
    ]})), (error) => error.code === "invalid-argument" &&
      ["piece_description_required", "piece_kind_invalid",
        "piece_price_invalid", "piece_description_too_long"]
          .every((code) => error.details.reasons.includes(code)));
    await assert.rejects(call("addWaitingPackage", counter({pieces: []})),
        (error) => error.details?.reasons?.includes("pieces_required"));
    await assert.rejects(call("addWaitingPackage", counter({
      pieces: Array.from({length: 61}, () => ({kind: "barrel"}))})),
    (error) => error.details?.reasons?.includes("pieces_too_many"));
    // Money is judged against the total of the pieces.
    await assert.rejects(call("addWaitingPackage", counter({payment: {
      amountCents: 25001, method: "cash", receivedByStaffId: RECEIVER}})),
    (error) => error.details?.reasons?.includes("payment_exceeds_balance"));
    assert.equal((await db.collection("containerLines").get()).size, before);
  });

  it("adds pieces straight onto a container, and counts them", async () => {
    const box = await newContainer();
    const {lineId, pieceCount} = await call("addContainerLine",
        {containerId: box, line: {...people, pieces: fourPieces()}});
    assert.equal(pieceCount, 4);
    assert.deepEqual(await tallies(box),
        {lineCount: 1, carCount: 0, barrelCount: 2, otherCount: 2});
    const line = await lineOf(lineId);
    assert.equal(line.rootLineId, lineId);
    assert.equal(line.source, "counter");
  });

  it("prints one label per piece, naming each", async () => {
    const {lineId} = await call("addWaitingPackage", counter());
    const {labels} = await call("getPackageLabels",
        {lineIds: [lineId], copies: 1});
    assert.deepEqual(labels.map((l) => [l.packageNumber, l.packageCount,
      l.what, l.size]), [
      [1, 4, "Barrel", ""], [2, 4, "Barrel", ""],
      [3, 4, "Clothes", "20 × 20 × 20 in"], [4, 4, "TV", ""]]);
    // A legacy line still prints its quantity.
    const legacy = await call("addWaitingPackage",
        {...people, kind: "barrels", quantity: 2});
    const old = await call("getPackageLabels",
        {lineIds: [legacy.lineId], copies: 1});
    assert.deepEqual(old.labels.map((l) => [l.packageNumber, l.what]),
        [[1, "Barrel"], [2, "Barrel"]]);
  });

  it("edits pieces after receipt: counts follow, History says so",
      async () => {
        const box = await newContainer();
        const {lineId} = await call("addContainerLine",
            {containerId: box, line: {...people, pieces: fourPieces()}});
        const stored = await lineOf(lineId);
        await call("updateContainerLine", {containerId: box, lineId,
          line: {...people, pieces: [...stored.pieces,
            {kind: "barrel", priceCents: 10000}]}});
        const line = await lineOf(lineId);
        assert.equal(line.pieceCount, 5);
        assert.equal(line.barrelPieces, 3);
        assert.equal(line.priceCents, 35000);
        assert.deepEqual(line.pieces.map((p) => p.id),
            ["p1", "p2", "p3", "p4", "p5"]);
        assert.deepEqual(await tallies(box),
            {lineCount: 1, carCount: 0, barrelCount: 3, otherCount: 2});
        const [edited] = await audits(box, "line_edited");
        assert.equal(edited.summary, "Edited 3 barrels, 1 box, TV (was 2 " +
          "barrels, 1 box, TV): pieces, price for Fatou Diallo");
        // After sailing only the prices may change.
        await call("setContainerStatus", {containerId: box,
          status: "shipped"});
        await assert.rejects(call("updateContainerLine", {containerId: box,
          lineId, line: {...people, pieces: line.pieces.slice(0, 4)}}),
        (error) => error.details?.reason === "container_locked");
        await call("updateContainerLine", {containerId: box, lineId,
          line: {...people, pieces: line.pieces.map((p) =>
            p.id === "p4" ? {...p, priceCents: 7000} : p)}});
        assert.equal((await lineOf(lineId)).priceCents, 42000);
      });

  it("spreads a total typed by an older app over the pieces", async () => {
    const {lineId} = await call("addWaitingPackage", counter());
    await call("setContainerLinePrice", {lineId, priceCents: 40000,
      payOnArrival: false});
    const line = await lineOf(lineId);
    assert.deepEqual(line.pieces.map((p) => p.priceCents),
        [10000, 10000, 10000, 10000]);
    assert.equal(line.priceCents, 40000);
    // The same total only toggles pay on arrival.
    await call("setContainerLinePrice", {lineId, priceCents: 40000,
      payOnArrival: true});
    const after = await lineOf(lineId);
    assert.equal(after.payOnArrival, true);
    assert.deepEqual(after.pieces, line.pieces);
  });

  describe("split across containers", () => {
    // Drop off 4 pieces, $200 paid; 2 go in, 2 stay waiting.
    async function splitOne(extra = {}) {
      const box = await newContainer();
      const root = await call("addWaitingPackage", counter({payment: {
        amountCents: 20000, method: "cash", receivedByStaffId: RECEIVER},
      ...extra}));
      const result = await call("assignContainerLines", {containerId: box,
        lineIds: [root.lineId], pieceCounts: {[root.lineId]: 2}});
      return {box, root, result, part: result.parts[0]};
    }

    it("moves the chosen pieces and leaves the rest as a part", async () => {
      const {box, root, result, part} = await splitOne();
      assert.equal(result.assigned, 1);
      assert.equal(result.alreadyAssigned, 0);
      assert.equal(part.lineId, root.lineId);
      assert.equal(part.trackingCode, `${root.trackingCode}-2`);
      assert.equal(part.pieceCount, 2);
      const going = await lineOf(root.lineId);
      assert.equal(going.containerId, box);
      assert.equal(going.trackingCode, root.trackingCode);
      assert.deepEqual(going.pieces.map((p) => p.id), ["p1", "p2"]);
      assert.equal(going.priceCents, 20000);
      assert.equal(going.paidCents, 20000);
      assert.equal(going.pieceCount, 2);
      assert.equal(going.lastPartIndex, 2);
      const staying = await lineOf(part.partLineId);
      assert.equal(staying.containerId, "");
      assert.equal(staying.containerStatus, "waiting");
      assert.equal(staying.trackingCode, part.trackingCode);
      assert.deepEqual(staying.pieces.map((p) => [p.id, p.priceCents]),
          [["p3", 5000], ["p4", null]]);
      assert.equal(staying.priceCents, 5000);
      assert.equal(staying.paidCents, 0);
      assert.equal(staying.rootLineId, root.lineId);
      assert.equal(staying.partIndex, 2);
      assert.equal(staying.splitFromLineId, root.lineId);
      for (const key of ["customerName", "customerPhone", "receiverName",
        "receiverPhone", "destinationCountryId", "notifyCustomer",
        "notifyReceiver", "source", "ownerKind"]) {
        assert.equal(staying[key], going[key], key);
      }
      assert.deepEqual([staying.barrelPieces, staying.packagePieces],
          [0, 2]);
      // Counted once, in the box only for what went in.
      assert.deepEqual(await tallies(box),
          {lineCount: 1, carCount: 0, barrelCount: 2, otherCount: 0});
      const [split] = await audits(root.lineId, "line_split");
      assert.match(split.summary, new RegExp(`^Split ${root.trackingCode}: ` +
        `2 of 4 pieces to Test box \\d+, 2 stay waiting as ` +
        `${part.trackingCode}$`));
      const [from] = await audits(part.partLineId, "line_split");
      assert.equal(from.summary, `Split from ${root.trackingCode}: 2 pieces ` +
        "waiting for a container");
      // No message for a split.
      const queued = await db.collection("containerUpdates")
          .doc(`${part.partLineId}_sender_received`).get();
      assert.equal(queued.exists, false);
    });

    it("gives the part the root's receivedAt", async () => {
      const {root, part} = await splitOne();
      const rootLine = await lineOf(root.lineId);
      const partLine = await lineOf(part.partLineId);
      assert.ok(rootLine.receivedAt);
      assert.equal(partLine.receivedAt.toMillis(),
          rootLine.receivedAt.toMillis());
    });

    it("is idempotent when the same request is sent again", async () => {
      const {box, root} = await splitOne();
      const again = await call("assignContainerLines", {containerId: box,
        lineIds: [root.lineId], pieceCounts: {[root.lineId]: 2}});
      assert.deepEqual(again, {success: true, assigned: 0,
        alreadyAssigned: 1, parts: []});
      assert.equal((await groupOf(root.lineId)).length, 2);
      assert.deepEqual(await tallies(box),
          {lineCount: 1, carCount: 0, barrelCount: 2, otherCount: 0});
    });

    it("refuses a count that is not one of the pieces, and never splits " +
      "a car", async () => {
      const box = await newContainer();
      const {lineId} = await call("addWaitingPackage", counter());
      for (const count of [0, 5, 1.5, "two"]) {
        await assert.rejects(call("assignContainerLines", {containerId: box,
          lineIds: [lineId], pieceCounts: {[lineId]: count}}),
        (error) => error.code === "invalid-argument" &&
          error.details?.reason === "piece_count_invalid" &&
          error.details?.lineIds?.[0] === lineId);
      }
      assert.equal((await lineOf(lineId)).containerId, "");
      const car = await call("addWaitingPackage", {...people, kind: "car",
        vinNumber: freshVin(), carMake: "Honda", carModel: "Accord",
        carYear: "2003"});
      await assert.rejects(call("assignContainerLines", {containerId: box,
        lineIds: [car.lineId], pieceCounts: {[car.lineId]: 2}}),
      (error) => error.details?.reason === "piece_count_invalid");
      // All of them is no split.
      const whole = await call("assignContainerLines", {containerId: box,
        lineIds: [lineId], pieceCounts: {[lineId]: 4}});
      assert.deepEqual(whole.parts, []);
      assert.equal((await lineOf(lineId)).pieceCount, 4);
    });

    it("splits a legacy line as pieces, its price spread", async () => {
      const box = await newContainer();
      const {lineId, trackingCode} = await call("addWaitingPackage",
          {...people, kind: "barrels", quantity: 3, priceCents: 30000});
      const {parts: [part]} = await call("assignContainerLines",
          {containerId: box, lineIds: [lineId], pieceCounts: {[lineId]: 1}});
      const going = await lineOf(lineId);
      const staying = await lineOf(part.partLineId);
      assert.equal(going.priceCents, 10000);
      assert.equal(going.pieceCount, 1);
      assert.equal(going.kind, "barrels");
      assert.equal(staying.priceCents, 20000);
      assert.equal(staying.quantity, 2);
      assert.equal(staying.trackingCode, `${trackingCode}-2`);
      assert.deepEqual(await tallies(box),
          {lineCount: 1, carCount: 0, barrelCount: 1, otherCount: 0});
    });

    it("splits a part again, never reusing a cancelled part's code",
        async () => {
          const first = await newContainer();
          const second = await newContainer();
          const root = await call("addWaitingPackage", counter());
          const code = root.trackingCode;
          const {parts: [p2]} = await call("assignContainerLines", {
            containerId: first, lineIds: [root.lineId],
            pieceCounts: {[root.lineId]: 1}});
          assert.equal(p2.trackingCode, `${code}-2`);
          assert.equal(p2.pieceCount, 3);
          const {parts: [p3]} = await call("assignContainerLines", {
            containerId: second, lineIds: [p2.partLineId],
            pieceCounts: {[p2.partLineId]: 2}});
          assert.equal(p3.trackingCode, `${code}-3`);
          assert.equal((await lineOf(p3.partLineId)).rootLineId, root.lineId);
          assert.equal((await lineOf(root.lineId)).lastPartIndex, 3);
          assert.deepEqual(await tallies(second),
              {lineCount: 1, carCount: 0, barrelCount: 1, otherCount: 1});
          // Cancel -3 (the TV went home), take -2 off its box and split it
          // again: the new part is -4, never a second -3.
          await call("removeContainerLine", {lineId: p3.partLineId});
          await call("unassignContainerLine", {lineId: p2.partLineId});
          assert.deepEqual(await tallies(second),
              {lineCount: 0, carCount: 0, barrelCount: 0, otherCount: 0});
          const {parts: [p4]} = await call("assignContainerLines", {
            containerId: second, lineIds: [p2.partLineId],
            pieceCounts: {[p2.partLineId]: 1}});
          assert.equal(p4.trackingCode, `${code}-4`);
          assert.equal((await lineOf(p4.partLineId)).partIndex, 4);
          assert.deepEqual((await groupOf(root.lineId))
              .map((d) => d.data().trackingCode).sort(),
          [code, `${code}-2`, `${code}-4`]);
          // Sending a part back never re-merges it.
          await call("unassignContainerLine", {lineId: p2.partLineId});
          const back = await lineOf(p2.partLineId);
          assert.equal(back.containerStatus, "waiting");
          assert.equal(back.pieceCount, 1);
          assert.equal((await lineOf(p4.partLineId)).pieceCount, 1);
          assert.deepEqual(await tallies(second),
              {lineCount: 0, carCount: 0, barrelCount: 0, otherCount: 0});
        });

    it("keeps the money on the root and the balance for the group",
        async () => {
          const {root, part} = await splitOne();
          // $250 for the group, $200 paid: $50 owed, taken from the part.
          await assert.rejects(pay({lineId: part.partLineId,
            amountCents: 5001, method: "cash"}),
          (error) => error.details?.reasons?.includes(
              "payment_exceeds_balance"));
          const paid = await pay({lineId: part.partLineId, amountCents: 5000,
            method: "zelle"});
          assert.equal(paid.lineId, root.lineId);
          assert.equal(paid.paidCents, 25000);
          const row = (await db.collection("containerLinePayments")
              .doc(paid.paymentId).get()).data();
          assert.equal(row.lineId, root.lineId);
          assert.equal((await lineOf(root.lineId)).paidCents, 25000);
          assert.equal((await lineOf(part.partLineId)).paidCents, 0);
          assert.equal((await audits(part.partLineId, "payment")).length, 1);
          // Paid in full: no part may be priced below its share now.
          await assert.rejects(call("setContainerLinePrice", {
            lineId: part.partLineId, priceCents: null, payOnArrival: false}),
          (error) => error.details?.reasons?.includes("price_below_paid"));
          const staying = await lineOf(part.partLineId);
          await assert.rejects(call("updateContainerLine", {
            lineId: part.partLineId, line: {...people, pieces: staying.pieces
                .map((p) => ({...p, priceCents: 0}))}}),
          (error) => error.details?.reasons?.includes("price_below_paid"));
          // Raising a part's price is fine and leaves a balance on the group.
          await call("updateContainerLine", {lineId: part.partLineId,
            line: {...people, pieces: staying.pieces.map((p) =>
              p.id === "p4" ? {...p, priceCents: 3000} : p)}});
          const found = await track(`${root.trackingCode}-2`);
          assert.deepEqual(found.record.payment,
              {priceCents: 28000, pickupFeeCents: 0, paidCents: 25000,
                balanceCents: 3000});
          // Cancelling the part now would leave the group overpaid.
          await assert.rejects(call("removeContainerLine",
              {lineId: part.partLineId}),
          (error) => error.details?.reason === "line_has_payments");
        });

    it("cancels an unpaid part, but not a root that has parts", async () => {
      const box = await newContainer();
      const root = await call("addWaitingPackage", counter());
      const {parts: [part]} = await call("assignContainerLines", {
        containerId: box, lineIds: [root.lineId],
        pieceCounts: {[root.lineId]: 3}});
      await assert.rejects(call("removeContainerLine",
          {containerId: box, lineId: root.lineId}),
      (error) => error.details?.reason === "line_has_parts");
      await call("removeContainerLine", {lineId: part.partLineId});
      assert.equal((await lineRef(part.partLineId).get()).exists, false);
      // With its part gone the root stands alone again.
      await call("removeContainerLine", {containerId: box,
        lineId: root.lineId});
      assert.deepEqual(await tallies(box),
          {lineCount: 0, carCount: 0, barrelCount: 0, otherCount: 0});
    });

    it("ships one part while the rest waits; tracking shows both",
        async () => {
          const {box, root, part} = await splitOne();
          await call("setContainerStatus", {containerId: box,
            status: "shipped"});
          assert.equal((await lineOf(root.lineId)).containerStatus,
              "shipped");
          assert.equal((await lineOf(part.partLineId)).containerStatus,
              "waiting");
          for (const code of [root.trackingCode,
            `${root.trackingCode}-2`.replace(/-/g, "").toLowerCase()]) {
            const {found, record} = await track(code);
            assert.equal(found, true, code);
            assert.deepEqual(record.parts.map((p) =>
              [p.trackingCode, p.stage, p.pieceCount, p.priceCents]), [
              [root.trackingCode, "in_transit", 2, 20000],
              [`${root.trackingCode}-2`, "waiting_container", 2, 5000]]);
            assert.deepEqual(record.payment,
                {priceCents: 25000, pickupFeeCents: 0, paidCents: 20000,
                  balanceCents: 5000});
            assert.ok(!JSON.stringify(record).includes("Fatou"));
          }
        });

    it("tells each part which share of the whole it is", async () => {
      connectWhatsApp();
      const {box, root} = await splitOne();
      await call("setContainerStatus", {containerId: box, status: "shipped"});
      await recordMoments(box);
      fakeWhatsApp(OK);
      const rowId = `${root.lineId}_receiver_shipped`;
      await deliver(rowId);
      const sent = whatsappCalls.find((c) => c.to === "224620000000");
      const texts = sent.template.components[0].parameters.map((p) => p.text);
      assert.equal(texts[1], "2 of your 4 pieces");
      assert.equal(texts[4], "2 de vos 4 colis");
    });
  });

  it("an unsplit package's message names its pieces", async () => {
    const box = await newContainer();
    const {lineId} = await call("addContainerLine", {containerId: box,
      line: {...people, pieces: [{kind: "barrel"}, {kind: "barrel"},
        {kind: "box", description: "Shoes"}]}});
    connectWhatsApp();
    await call("setContainerStatus", {containerId: box, status: "shipped"});
    await recordMoments(box);
    fakeWhatsApp(OK);
    await deliver(`${lineId}_receiver_shipped`);
    const texts = whatsappCalls[0].template.components[0].parameters
        .map((p) => p.text);
    assert.equal(texts[1], "2 barrels, 1 box");
    assert.equal(texts[4], "2 barils, 1 carton");
  });

  it("ships a part while the original line still waits", async () => {
    connectWhatsApp();
    const first = await newContainer();
    const second = await newContainer();
    const root = await call("addWaitingPackage", {...people,
      pieces: fourPieces()});
    const {parts: [part]} = await call("assignContainerLines", {
      containerId: first, lineIds: [root.lineId],
      pieceCounts: {[root.lineId]: 2}});
    // The original comes back off its box; the part goes on another one
    // and sails without it.
    await call("unassignContainerLine", {lineId: root.lineId});
    await call("assignContainerLines", {containerId: second,
      lineIds: [part.partLineId]});
    await call("setContainerStatus", {containerId: second,
      status: "shipped"});
    assert.equal((await lineOf(root.lineId)).containerStatus, "waiting");
    assert.equal((await lineOf(part.partLineId)).containerStatus, "shipped");
    assert.deepEqual(await tallies(first),
        {lineCount: 0, carCount: 0, barrelCount: 0, otherCount: 0});
    assert.deepEqual(await tallies(second),
        {lineCount: 1, carCount: 0, barrelCount: 0, otherCount: 2});
    const {record} = await track(root.trackingCode);
    assert.deepEqual(record.parts.map((p) => p.stage),
        ["waiting_container", "in_transit"]);
    // Its own departed message, naming its share.
    await recordMoments(second);
    fakeWhatsApp(OK);
    await deliver(`${part.partLineId}_receiver_shipped`);
    const texts = whatsappCalls[0].template.components[0].parameters
        .map((p) => p.text);
    assert.equal(texts[1], "2 of your 4 pieces");
    assert.equal(texts[7], part.trackingCode);
    // Nothing was said about the root, still waiting.
    assert.equal((await db.collection("containerUpdates")
        .doc(`${root.lineId}_receiver_shipped`).get()).exists, false);
    // Money for the shipped part still lands on the root.
    await call("setContainerLinePrice", {lineId: root.lineId,
      priceCents: 20000, payOnArrival: false});
    const paid = await pay({lineId: part.partLineId, amountCents: 25000,
      method: "cash"});
    assert.equal(paid.lineId, root.lineId);
  });
});

// Package delivered at destination (container_delivery.js): an action on
// updateContainerLine. Marking records the line and the container's count in
// one transaction, warns (never blocks) on a balance, tells each person once,
// and only a manager may undo - silently.
describe("delivered at destination", () => {
  const DELIVERIES_ONLY = "container-test-deliveries-only";
  before(async () => {
    await db.collection("users").doc(DELIVERIES_ONLY).set({
      role: "staff", businessId: BIZ, businessPermissions: ["deliveries"],
      fullName: "Ousmane Porter", email: "porter@example.test",
    });
  });
  const markDelivered = (lineId, extra = {}, uid = OWNER) =>
    call("updateContainerLine", {lineId, action: "deliver", ...extra}, uid);
  const undoDelivery = (lineId, uid = OWNER) =>
    call("updateContainerLine", {lineId, action: "undo_delivery"}, uid);
  const lineOf = async (lineId) =>
    (await db.collection("containerLines").doc(lineId).get()).data();
  const boxOf = async (box) =>
    (await db.collection("containers").doc(box).get()).data();
  const row = (lineId, role) =>
    db.collection("containerUpdates").doc(`${lineId}_${role}_delivered`);
  async function audits(box, action) {
    const snap = await db.collection("lotLedgerAudit")
        .where("entityId", "==", box).where("action", "==", action).get();
    return snap.docs.map((d) => d.get("summary"));
  }
  async function arrivedBox(lines = [barrelLine(3)]) {
    const box = await newContainer();
    const ids = [];
    for (const line of lines) {
      const {lineId} = await call("addContainerLine",
          {containerId: box, line});
      ids.push(lineId);
    }
    await call("setContainerStatus", {containerId: box, status: "shipped"});
    await call("setContainerStatus", {containerId: box, status: "arrived"});
    return {box, lineIds: ids};
  }

  it("refuses a package that is not at the destination yet", async () => {
    const box = await newContainer();
    const {lineId} = await call("addContainerLine",
        {containerId: box, line: barrelLine(1)});
    await assert.rejects(markDelivered(lineId),
        (error) => error.details?.reason === "delivery_not_arrived");
    await call("setContainerStatus", {containerId: box, status: "shipped"});
    await assert.rejects(markDelivered(lineId),
        (error) => error.details?.reason === "delivery_not_arrived");
    const waiting = await call("addWaitingPackage", {...barrelLine(1),
      destinationCountryId: "gn", destinationCountryName: "Guinea"});
    await assert.rejects(markDelivered(waiting.lineId),
        (error) => error.details?.reason === "delivery_not_arrived");
    await assert.rejects(
        call("updateContainerLine", {lineId, action: "teleport"}),
        (error) => error.details?.reason === "delivery_action_invalid");
    assert.equal((await lineOf(lineId)).deliveredAt, undefined);
  });

  it("records when, by whom and who collected it, and counts X of Y",
      async () => {
        const {box, lineIds: [first, second]} =
          await arrivedBox([barrelLine(3), barrelLine(2)]);
        assert.equal((await boxOf(box)).deliveredCount, 0);
        const result = await markDelivered(first);
        assert.equal(result.delivered, true);
        assert.equal(result.alreadyDelivered, false);
        assert.equal(result.collectedBy, "Mariama Bah");
        assert.equal(result.hasBalance, false);
        const line = await lineOf(first);
        assert.ok(line.deliveredAt && line.deliveredAt.toMillis() > 0);
        assert.equal(line.deliveredByStaffId, OWNER);
        assert.equal(line.deliveredByName, "Dala Owner");
        // Prefilled with the receiver; someone else may collect.
        assert.equal(line.collectedBy, "Mariama Bah");
        assert.equal(line.deliveredBalanceCents, 0);
        // The container's own status does not move: no auto-close.
        const counted = await boxOf(box);
        assert.equal(counted.status, "arrived");
        assert.equal(counted.deliveredCount, 1);
        assert.equal(counted.lineCount, 2);
        await markDelivered(second, {collectedBy: "  Ibrahima\nSow "});
        assert.equal((await lineOf(second)).collectedBy, "Ibrahima Sow");
        assert.equal((await boxOf(box)).deliveredCount, 2);
        assert.deepEqual((await audits(box, "line_delivered")).sort(), [
          "Delivered 2 barrels for Fatou Diallo, collected by Ibrahima Sow",
          "Delivered 3 barrels for Fatou Diallo, collected by Mariama Bah",
        ]);
        await assert.rejects(markDelivered(first,
            {collectedBy: "x".repeat(121)}),
        (error) => error.details?.reason === "collected_by_too_long");
      });

  it("warns about an unpaid balance, then delivers once confirmed",
      async () => {
        const {box, lineIds: [lineId]} = await arrivedBox();
        await call("setContainerLinePrice", {lineId, priceCents: 10000,
          payOnArrival: false});
        await pay({lineId, amountCents: 6000, method: "cash"});
        // A manager is told how much.
        await assert.rejects(markDelivered(lineId), (error) =>
          error.code === "failed-precondition" &&
          error.details?.reason === "delivery_balance_due" &&
          error.details?.hasBalance === true &&
          error.details?.balanceCents === 4000);
        // A deliveries-only person is told there is a balance, not how much.
        await assert.rejects(markDelivered(lineId, {}, DELIVERIES_ONLY),
            (error) => error.details?.reason === "delivery_balance_due" &&
            error.details?.hasBalance === true &&
            error.details?.balanceCents === null);
        assert.equal((await lineOf(lineId)).deliveredAt, undefined);
        const done = await markDelivered(lineId, {acknowledgeBalance: true},
            DELIVERIES_ONLY);
        assert.equal(done.alreadyDelivered, false);
        assert.equal(done.hasBalance, true);
        assert.equal(done.balanceCents, null);
        const line = await lineOf(lineId);
        assert.equal(line.deliveredBalanceCents, 4000);
        assert.equal(line.deliveredByStaffId, DELIVERIES_ONLY);
        assert.equal(line.deliveredByName, "Ousmane Porter");
        assert.deepEqual(await audits(box, "line_delivered"), [
          "Delivered 3 barrels for Fatou Diallo, collected by Mariama Bah, " +
            "with $40.00 still owed",
        ]);
      });

  it("lets containers or deliveries staff mark, nobody else", async () => {
    const {lineIds: [a, b]} =
      await arrivedBox([barrelLine(1), barrelLine(1)]);
    await assert.rejects(markDelivered(a, {}, NO_CONTAINERS),
        (error) => error.code === "permission-denied");
    await assert.rejects(markDelivered(a, {}, OTHER_BIZ_STAFF),
        (error) => error.code === "permission-denied");
    // Deliveries is not the containers section: no ordinary line edits.
    await assert.rejects(call("updateContainerLine", {lineId: a,
      line: barrelLine(2)}, DELIVERIES_ONLY),
    (error) => error.code === "permission-denied");
    assert.equal((await markDelivered(a, {}, DELIVERIES_ONLY)).delivered,
        true);
    assert.equal((await markDelivered(b, {}, RECEIVER)).delivered, true);
  });

  it("lets only the owner or a manager undo, silently", async () => {
    connectWhatsApp();
    const {box, lineIds: [lineId]} = await arrivedBox();
    await markDelivered(lineId, {}, DELIVERIES_ONLY);
    const rowsBefore = (await db.collection("containerUpdates")
        .where("lineId", "==", lineId).get()).size;
    for (const uid of [DELIVERIES_ONLY, NO_CONTAINERS, OTHER_BIZ_STAFF]) {
      await assert.rejects(undoDelivery(lineId, uid),
          (error) => error.code === "permission-denied", uid);
    }
    assert.ok((await lineOf(lineId)).deliveredAt);
    const undone = await undoDelivery(lineId);
    assert.equal(undone.undone, true);
    const line = await lineOf(lineId);
    for (const field of ["deliveredAt", "deliveredByStaffId",
      "deliveredByName", "collectedBy", "deliveredBalanceCents"]) {
      assert.equal(line[field], undefined, field);
    }
    assert.equal(line.deliveryUndoneByStaffId, OWNER);
    assert.ok(line.deliveryUndoneAt);
    assert.equal((await boxOf(box)).deliveredCount, 0);
    // No message about an undo.
    assert.equal((await db.collection("containerUpdates")
        .where("lineId", "==", lineId).get()).size, rowsBefore);
    assert.deepEqual(await audits(box, "line_delivery_undone"),
        ["Undid the delivery of 3 barrels for Fatou Diallo"]);
    // Undoing again changes nothing; a manager on staff may undo too.
    assert.equal((await undoDelivery(lineId)).undone, false);
    assert.equal((await boxOf(box)).deliveredCount, 0);
    await markDelivered(lineId);
    assert.equal((await undoDelivery(lineId, RECEIVER)).undone, true);
  });

  it("tells the sender and the receiver once each, however often it is " +
      "marked", async () => {
    connectWhatsApp();
    const {box, lineIds: [lineId]} = await arrivedBox();
    await markDelivered(lineId, {collectedBy: "Ibrahima Sow"});
    for (const role of ["sender", "receiver"]) {
      const queued = await row(lineId, role).get();
      assert.equal(queued.get("status"), "queued", role);
      assert.equal(queued.get("update"), "delivered");
    }
    // A second tap is idempotent: nothing changes, nothing is queued.
    const again = await markDelivered(lineId);
    assert.equal(again.alreadyDelivered, true);
    assert.equal(again.collectedBy, "Ibrahima Sow");
    assert.equal((await boxOf(box)).deliveredCount, 1);
    assert.equal((await audits(box, "line_delivered")).length, 1);
    fakeWhatsApp(OK);
    for (const role of ["sender", "receiver"]) {
      await deliver(row(lineId, role).id);
    }
    assert.equal(whatsappCalls.length, 2);
    for (const sent of whatsappCalls) {
      assert.equal(sent.template.name, "shipment_delivered_2lang");
      assert.equal(sent.template.language.code, "en");
    }
    const receiverCall = whatsappCalls.find((c) => c.to === "224620000000");
    const texts = receiverCall.template.components[0].parameters
        .map((p) => p.text);
    assert.equal(texts.length, 10);
    assert.deepEqual([texts[0], texts[1], texts[2], texts[4], texts[5],
      texts[6], texts[8]], ["Mariama Bah", "Dala Shipping", "3 barrels",
      "Ibrahima Sow", "Dala Shipping", "3 barils", "Ibrahima Sow"]);
    assert.match(texts[3], /^[A-Z][a-z]+ \d{1,2}, \d{4}$/);
    assert.match(texts[7], /^\d{1,2} [a-zéû]+ \d{4}$/);
    assert.ok(texts[9].startsWith("CL-"));
    assert.ok(whatsappCalls.some((c) => c.to === "16465550100"));
    const line = await lineOf(lineId);
    assert.equal(line.lastCustomerUpdate.update, "delivered");
    assert.deepEqual(line.lastCustomerUpdate.results
        .map((entry) => entry.status), ["sent", "sent"]);
    // Undo, then deliver again: the rows exist, so nobody hears twice.
    await undoDelivery(lineId);
    await markDelivered(lineId);
    for (const role of ["sender", "receiver"]) {
      assert.equal((await row(lineId, role).get()).get("status"), "sent");
    }
    assert.equal((await db.collection("containerUpdates")
        .where("lineId", "==", lineId).where("update", "==", "delivered")
        .get()).size, 2);
  });

  it("tells one person once when they are both sender and receiver",
      async () => {
        connectWhatsApp();
        const {lineIds: [same, shared]} = await arrivedBox([
          {...barrelLine(1), senderIsReceiver: true},
          {...barrelLine(1), customerPhone: "+224 620 00 00 00"},
        ]);
        await markDelivered(same);
        await markDelivered(shared);
        for (const lineId of [same, shared]) {
          const rows = await db.collection("containerUpdates")
              .where("lineId", "==", lineId)
              .where("update", "==", "delivered").get();
          assert.equal(rows.size, 1, lineId);
        }
      });

  it("records who would hear while WhatsApp is not connected", async () => {
    const {lineIds: [lineId]} = await arrivedBox();
    await markDelivered(lineId);
    for (const role of ["sender", "receiver"]) {
      assert.equal((await row(lineId, role).get()).get("status"),
          "waiting_for_whatsapp");
    }
  });

  it("waits for Meta to approve the template, without using an attempt",
      async () => {
        connectWhatsApp();
        const {lineIds: [lineId]} = await arrivedBox();
        await markDelivered(lineId);
        fakeWhatsApp({status: 404, body: {error: {code: 132001,
          message: "(#132001) Template name does not exist in the " +
            "translation"}}});
        await deliver(row(lineId, "receiver").id);
        const waiting = await row(lineId, "receiver").get();
        assert.equal(waiting.get("status"), "waiting_for_template");
        assert.equal(waiting.get("attempts"), 0);
        assert.equal(whatsappCalls[0].template.name,
            "shipment_delivered_2lang");
        // The half-hourly sweep queues it again; approved, it sends.
        await functions.requeueTemplateWaitingUpdates.run({});
        assert.equal((await row(lineId, "receiver").get()).get("status"),
            "queued");
        fakeWhatsApp(OK);
        await deliver(row(lineId, "receiver").id);
        assert.equal((await row(lineId, "receiver").get()).get("status"),
            "sent");
      });

  it("says nothing when the delivery was undone before the send",
      async () => {
        connectWhatsApp();
        const {lineIds: [lineId]} = await arrivedBox();
        await markDelivered(lineId);
        await undoDelivery(lineId);
        fakeWhatsApp(OK);
        await deliver(row(lineId, "receiver").id);
        assert.equal(whatsappCalls.length, 0);
        const failed = await row(lineId, "receiver").get();
        assert.equal(failed.get("status"), "failed");
        assert.match(failed.get("error"), /undone/);
      });

  it("delivers once when two phones mark it at the same moment",
      async () => {
        const {box, lineIds: [lineId]} = await arrivedBox();
        const results = await Promise.allSettled([
          markDelivered(lineId), markDelivered(lineId, {}, DELIVERIES_ONLY),
          markDelivered(lineId, {}, RECEIVER)]);
        const fresh = results.filter((r) => r.status === "fulfilled" &&
          r.value.alreadyDelivered === false);
        assert.equal(fresh.length, 1, JSON.stringify(results.map((r) =>
          r.reason?.message || r.value)));
        assert.equal((await boxOf(box)).deliveredCount, 1);
        assert.equal((await audits(box, "line_delivered")).length, 1);
      });

  it("repairs X of Y in a recount", async () => {
    const {box, lineIds: [a]} =
      await arrivedBox([barrelLine(1), barrelLine(1)]);
    await markDelivered(a);
    await db.collection("containers").doc(box).update({deliveredCount: 7});
    // Asking for the status the box already has recounts its tallies.
    await call("setContainerStatus", {containerId: box, status: "arrived"});
    const counted = await boxOf(box);
    assert.equal(counted.deliveredCount, 1);
    assert.equal(counted.lineCount, 2);
  });
});

// Staff activity alerts (staff_activity_alerts.js): the create triggers and
// the 10-minute flush, run against the emulator - a package or a car parked
// tells the others once, a burst is grouped into one summary, and a split
// part or a customer's reservation tells nobody.
describe("staff activity alerts", () => {
  const ABIZ = "alerts-test-biz";
  const A_OWNER = "alerts-test-owner";
  const A_CLERK = "alerts-test-clerk";
  const A_DRIVER = "alerts-test-driver";
  const A_PARKER = "alerts-test-parker";
  const A_MUTED = "alerts-test-muted";
  const A_FOREIGN = "alerts-test-foreign";
  const {Timestamp} = admin.firestore;

  before(async () => {
    await Promise.all([
      db.collection("businesses").doc(ABIZ).set({name: "Alerts Shipping",
        status: "approved", ownerUid: A_OWNER}),
      db.collection("users").doc(A_OWNER).set({role: "businessOwner",
        businessId: ABIZ, fullName: "Abdoullaye Sow",
        preferredLanguage: "fr"}),
      db.collection("users").doc(A_CLERK).set({role: "staff",
        businessId: ABIZ, fullName: "Aissatou Bah",
        businessPermissions: ["containers"]}),
      db.collection("users").doc(A_DRIVER).set({role: "staff",
        businessId: ABIZ, fullName: "Ousmane Porter",
        businessPermissions: ["deliveries"]}),
      db.collection("users").doc(A_PARKER).set({role: "staff",
        businessId: ABIZ, fullName: "Mamadou Diallo",
        businessPermissions: ["parking"]}),
      db.collection("users").doc(A_MUTED).set({role: "staff",
        businessId: ABIZ, businessPermissions: ["containers", "parking"],
        notificationPreferences: {packageAlerts: false,
          parkedCarAlerts: false}}),
      db.collection("users").doc(A_FOREIGN).set({role: "staff",
        businessId: "alerts-other-biz",
        businessPermissions: ["containers", "parking"]}),
    ]);
  });

  const inbox = async (uid) => (await db.collection("users").doc(uid)
      .collection("notifications").get()).docs.map((d) => d.data());
  let lineSerial = 0;
  async function newLine(extra = {}) {
    lineSerial += 1;
    const ref = db.collection("containerLines").doc(`alerts-line-${
      lineSerial}`);
    await ref.set({businessId: ABIZ, containerId: "", kind: "barrels",
      ownerKind: "customer", customerName: "", receiverName: "Fatou Diallo",
      priceCents: 15000, addedByStaffId: A_CLERK, rootLineId: ref.id,
      trackingCode: `CL-AL${lineSerial}`, createdAt: Timestamp.now(),
      ...extra});
    return ref;
  }
  const packageSaved = async (ref) =>
    functions.notifyStaffOfNewPackage.run({data: await ref.get(),
      params: {lineId: ref.id}});
  const windowRef = (kind, actor) => db.collection("staffActivityAlerts")
      .doc(`${ABIZ}_${kind}_${actor}`);

  it("tells the owner and delivery staff once, prices only to the owner",
      async () => {
        const ref = await newLine();
        await packageSaved(ref);
        await packageSaved(ref); // a retried event
        const [owner] = await inbox(A_OWNER);
        assert.equal((await inbox(A_OWNER)).length, 1);
        assert.equal(owner.title, "Colis enregistré");
        assert.equal(owner.body, "Aissatou a enregistré un colis pour " +
          "Fatou Diallo · $150.00 · en attente d'un conteneur");
        assert.equal(owner.data.type, "container_line");
        assert.equal(owner.data.lineId, ref.id);
        const driver = await inbox(A_DRIVER);
        assert.equal(driver.length, 1);
        assert.equal(driver[0].body, "Aissatou saved a package for " +
          "Fatou Diallo · waiting for a container");
        for (const uid of [A_CLERK, A_MUTED, A_FOREIGN, A_PARKER]) {
          assert.equal((await inbox(uid)).length, 0, uid);
        }
      });

  it("groups the next packages and flushes them as one summary",
      async () => {
        await packageSaved(await newLine());
        await packageSaved(await newLine());
        assert.equal((await inbox(A_OWNER)).length, 1);
        const held = (await windowRef("package", A_CLERK).get()).data();
        assert.equal(held.pending, 2);
        // A split part is the same package: no alert, no count.
        const part = await newLine({rootLineId: "alerts-line-1",
          splitFromLineId: "alerts-line-1"});
        await packageSaved(part);
        assert.equal((await windowRef("package", A_CLERK).get())
            .get("pending"), 2);
        // The window ends; the flush sends one summary, and only once.
        const past = Date.now() - 1000;
        await windowRef("package", A_CLERK).update({windowEndMs: past,
          flushDueMs: past});
        await functions.flushStaffActivityAlerts.run({});
        await functions.flushStaffActivityAlerts.run({});
        const owner = await inbox(A_OWNER);
        assert.equal(owner.length, 2);
        assert.ok(owner.some((n) => n.body ===
          "Aissatou a enregistré 2 colis de plus"));
        const driver = await inbox(A_DRIVER);
        assert.ok(driver.some((n) => n.body ===
          "Aissatou saved 2 more packages"));
        assert.equal((await windowRef("package", A_CLERK).get())
            .get("pending"), 0);
      });

  it("tells about a car parked by staff, never a customer reservation",
      async () => {
        const parked = db.collection("parkedCars").doc("alerts-car-1");
        await parked.set({businessId: ABIZ, enteredByUid: A_PARKER,
          enteredByBusiness: true, source: "business",
          trackingCode: "PK-AL1", carYear: "2018", carMake: "Toyota",
          carModel: "Camry", createdAt: Timestamp.now()});
        const reservation = db.collection("parkedCars").doc("alerts-car-2");
        await reservation.set({businessId: ABIZ, customerUid: "a-customer",
          trackingCode: "PK-AL2", carMake: "Honda", carModel: "Civic",
          createdAt: Timestamp.now()});
        const earlier = (await inbox(A_OWNER)).length;
        for (const ref of [parked, reservation]) {
          await functions.notifyStaffOfParkedCar.run({data: await ref.get(),
            params: {parkedCarId: ref.id}});
        }
        const owner = await inbox(A_OWNER);
        assert.equal(owner.length, earlier + 1);
        assert.ok(owner.some((n) => n.body ===
          "Mamadou a garé une Toyota Camry 2018 · PK-AL1" &&
          n.data.parkedCarId === "alerts-car-1"));
        // Package people do not hear about cars.
        assert.ok(!(await inbox(A_CLERK)).some((n) =>
          n.data.type === "parked_car"));
        assert.equal((await db.collection("staffActivityAlertClaims")
            .doc("car_alerts-car-2").get()).exists, false);
      });
});

// Platform activity alerts (platform_activity_alerts.js): the same create
// triggers, the sale trigger and the flush tell the platform's admins - the
// first event of a business at once, the rest of its window as one summary.
describe("platform activity alerts", () => {
  const PBIZ = "platform-alerts-biz";
  const P_OWNER = "platform-alerts-owner";
  const P_CLERK = "platform-alerts-clerk";
  const P_SELLER = "platform-alerts-seller";
  const P_SUPER = "platform-alerts-super";
  const P_OPS = "platform-alerts-ops";
  const P_FINANCE = "platform-alerts-finance";
  const P_MUTED = "platform-alerts-muted";
  const {Timestamp} = admin.firestore;

  before(async () => {
    await Promise.all([
      db.collection("businesses").doc(PBIZ).set({name: "Diallo Shipping",
        status: "approved", ownerUid: P_OWNER}),
      db.collection("users").doc(P_OWNER).set({role: "businessOwner",
        businessId: PBIZ, fullName: "Abdoullaye Sow"}),
      db.collection("users").doc(P_CLERK).set({role: "staff",
        businessId: PBIZ, fullName: "Aissatou Bah",
        businessPermissions: ["containers"]}),
      db.collection("users").doc(P_SELLER).set({role: "staff",
        businessId: PBIZ, fullName: "Moussa Camara",
        businessPermissions: ["inventory"]}),
      db.collection("users").doc(P_SUPER).set({role: "admin",
        adminRole: "superAdmin", fullName: "Hashim"}),
      db.collection("users").doc(P_OPS).set({role: "admin",
        adminRole: "operationsManager", preferredLanguage: "fr"}),
      db.collection("users").doc(P_FINANCE).set({role: "admin",
        adminRole: "financeManager"}),
      db.collection("users").doc(P_MUTED).set({role: "admin",
        adminRole: "superAdmin",
        notificationPreferences: {platformActivity: false}}),
    ]);
  });

  const feed = async (uid) => (await db.collection("users").doc(uid)
      .collection("notifications").get()).docs.map((d) => d.data())
      .filter((n) => n.data?.type === "platform_activity");
  const windowRef = () => db.collection("platformActivityAlerts").doc(PBIZ);
  let serial = 0;
  async function packageSaved() {
    serial += 1;
    const ref = db.collection("containerLines").doc(`platform-line-${serial}`);
    await ref.set({businessId: PBIZ, containerId: "", kind: "barrels",
      ownerKind: "customer", receiverName: "Fatou Diallo", priceCents: 15000,
      addedByStaffId: P_CLERK, rootLineId: ref.id,
      trackingCode: `CL-PA${serial}`, createdAt: Timestamp.now()});
    await functions.notifyStaffOfNewPackage.run({data: await ref.get(),
      params: {lineId: ref.id}});
    return ref;
  }
  async function saleMade(id, extra = {}) {
    const ref = db.collection("inventorySales").doc(id);
    await ref.set({businessId: PBIZ, soldByStaffId: P_SELLER, voided: false,
      totalCents: 8000, lines: [{quantity: 2}], createdAt: Timestamp.now(),
      ...extra});
    await functions.notifyAdminsOfSale.run({data: await ref.get(),
      params: {saleId: id}});
  }

  it("tells super admins and operations managers once, at once",
      async () => {
        const ref = await packageSaved();
        // A retried event.
        await functions.notifyStaffOfNewPackage.run({data: await ref.get(),
          params: {lineId: ref.id}});
        const superFeed = await feed(P_SUPER);
        assert.equal(superFeed.length, 1);
        assert.equal(superFeed[0].title, "Diallo Shipping");
        assert.equal(superFeed[0].body, "Aissatou saved a package for " +
          "Fatou Diallo · $150.00 · waiting for a container");
        assert.equal(superFeed[0].data.businessId, PBIZ);
        assert.equal(superFeed[0].data.relatedId, ref.id);
        const ops = await feed(P_OPS);
        assert.equal(ops.length, 1);
        assert.match(ops[0].body, /^Aissatou a enregistré un colis/);
        for (const uid of [P_FINANCE, P_MUTED, P_OWNER, P_CLERK]) {
          assert.equal((await feed(uid)).length, 0, uid);
        }
      });

  it("tallies the rest of the window and flushes one summary", async () => {
    await packageSaved();
    await packageSaved();
    await saleMade("platform-sale-1");
    // A voided sale is not news.
    await saleMade("platform-sale-2", {voided: true});
    assert.equal((await feed(P_SUPER)).length, 1);
    const held = (await windowRef().get()).data();
    assert.equal(held.pending, 3);
    const past = Date.now() - 1000;
    await windowRef().update({windowEndMs: past, flushDueMs: past});
    await functions.flushStaffActivityAlerts.run({});
    await functions.flushStaffActivityAlerts.run({});
    const superFeed = await feed(P_SUPER);
    assert.equal(superFeed.length, 2);
    const summary = superFeed.find((n) => n.data.summary === "true");
    assert.equal(summary.title, "Diallo Shipping · more activity");
    assert.equal(summary.body,
        "Aissatou: 2 packages · Moussa: 1 sale ($80.00)");
    assert.ok((await feed(P_OPS)).some((n) => n.body ===
      "Aissatou : 2 colis · Moussa : 1 vente ($80.00)"));
    const after = (await windowRef().get()).data();
    assert.equal(after.pending, 0);
    assert.deepEqual(after.tally, {});
  });

  it("a sale opening a new window goes out at once", async () => {
    await windowRef().update({windowEndMs: Date.now() - 1000});
    await saleMade("platform-sale-3");
    const superFeed = await feed(P_SUPER);
    assert.ok(superFeed.some((n) => n.body ===
      "Moussa sold 2 pieces · $80.00" &&
      n.data.relatedCollection === "inventorySales"));
  });
});

describe("scan to load", () => {
  const SCAN_BIZ = "scan-load-test-biz";
  const S_OWNER = "scan-load-test-owner";
  const S_LOADER = "scan-load-test-loader";
  const S_PORTER = "scan-load-test-deliveries-only";
  before(async () => {
    await Promise.all([
      db.collection("businesses").doc(SCAN_BIZ).set({
        name: "Scan Shipping", status: "approved", ownerUid: S_OWNER,
      }),
      db.collection("users").doc(S_OWNER).set({
        role: "businessOwner", businessId: SCAN_BIZ, fullName: "Scan Owner",
      }),
      db.collection("users").doc(S_LOADER).set({
        role: "staff", businessId: SCAN_BIZ, fullName: "Lamine Loader",
        businessPermissions: ["containers"],
      }),
      db.collection("users").doc(S_PORTER).set({
        role: "staff", businessId: SCAN_BIZ, fullName: "Ousmane Porter",
        businessPermissions: ["deliveries"],
      }),
    ]);
  });
  // Its own business, so the waiting list and its count are this suite's.
  const run = (name, data, uid = S_OWNER) =>
    functions[name].run({auth: {uid, token: {}}, data: {businessId: SCAN_BIZ,
      ...data}});
  const GUINEA = {destinationCountryId: "gn",
    destinationCountryName: "Guinea"};
  const SENEGAL = {destinationCountryId: "sn",
    destinationCountryName: "Senegal"};
  const people = {ownerKind: "customer", customerName: "Fatou Diallo",
    customerPhone: "+16465550100", receiverName: "Mariama Bah",
    receiverPhone: "+224620000000"};
  const barrels = (n, extra = {}) => ({...people, ...GUINEA,
    pieces: Array.from({length: n}, () => ({kind: "barrel"})), ...extra});
  let boxSerial = 0;
  async function box(extra = {}) {
    boxSerial += 1;
    const {containerId} = await run("createContainer", {
      label: `Scan box ${boxSerial}`, ...GUINEA, ...extra});
    return containerId;
  }
  const drop = (extra) => run("addWaitingPackage", extra || barrels(3));
  let scanSerial = 0;
  const nextScanId = () => `scan-test-${String(++scanSerial).padStart(4, "0")}`;
  const scan = (containerId, code, extra = {}, uid = S_OWNER) =>
    run("assignContainerLines", {containerId, action: "scan", code,
      scanId: nextScanId(), ...extra}, uid);
  const undo = (containerId, lineId, extra = {}) =>
    run("assignContainerLines", {containerId, action: "undo_scan", lineId,
      ...extra});
  const lineOf = async (id) =>
    (await db.collection("containerLines").doc(id).get()).data();
  const tallies = async (id) => {
    const row = (await db.collection("containers").doc(id).get()).data();
    return {lineCount: row.lineCount, carCount: row.carCount,
      barrelCount: row.barrelCount, otherCount: row.otherCount};
  };
  const audits = async (entityId, action) => {
    const snap = await db.collection("lotLedgerAudit")
        .where("entityId", "==", entityId).where("action", "==", action).get();
    return snap.docs.map((d) => d.data());
  };
  const link = (code) => `https://customer.laawoldigital.com/t/${code}`;
  const refused = (reason) => (error) => error.details?.reason === reason;
  const LOAD_KEYS = ["loadScannedPieces", "loadAddedByScan", "loadScannedAt",
    "loadScannedByStaffId", "loadScanIds", "loadMovedFromContainerId",
    "loadLeftPartId"];
  const noLoadFields = (line) =>
    LOAD_KEYS.every((key) => line[key] === undefined);
  // The answer to the scan that put it on reads the function's clock; the
  // stored mark is the server's commit time - a few ms apart.
  const sameTime = (answered, stored) =>
    assert.ok(Math.abs(answered - stored.toMillis()) < 5000,
        `${answered} is not near ${stored.toMillis()}`);

  it("puts a waiting package on whole, then counts, then says all in",
      async () => {
        const containerId = await box();
        const {lineId, trackingCode} = await drop();
        const first = await scan(containerId, link(trackingCode), {},
            S_LOADER);
        assert.equal(first.success, true);
        assert.equal(first.result, "loaded");
        const {assignedAt, ...firstLine} = first.line;
        sameTime(assignedAt, (await lineOf(lineId)).containerAssignedAt);
        assert.deepEqual(firstLine, {lineId, trackingCode,
          name: "Mariama Bah", kind: "barrels", pieceCount: 3,
          scannedPieces: 1, destinationCountryName: "Guinea",
          addedByScan: true, assignedVia: "scan",
          customerName: "Fatou Diallo", customerPhone: "+16465550100"});
        assert.deepEqual(first.container, {containerId,
          label: `Scan box ${boxSerial}`, lineCount: 1, pieceCount: 3});
        let line = await lineOf(lineId);
        assert.equal(line.containerId, containerId);
        assert.equal(line.containerStatus, "loading");
        assert.equal(line.loadScannedPieces, 1);
        assert.equal(line.loadAddedByScan, true);
        assert.equal(line.loadScannedByStaffId, S_LOADER);
        assert.ok(line.loadScannedAt.toMillis() > 0);
        assert.equal(line.loadScanIds.length, 1);
        assert.deepEqual(await tallies(containerId),
            {lineCount: 1, carCount: 0, barrelCount: 3, otherCount: 0});
        // One History entry on the package; no moment, no message.
        const [loaded] = await audits(lineId, "line_assigned");
        assert.match(loaded.summary,
            /^Loaded 3 barrels for Fatou Diallo on Scan box \d+ by scan$/);
        const moments = await db.collection("containers").doc(containerId)
            .collection("trackingEvents").get();
        assert.equal(moments.size, 0);

        // Typed, lower case: one more piece of the same package.
        const second = await scan(containerId, trackingCode.toLowerCase());
        assert.equal(second.result, "counted");
        assert.equal(second.line.scannedPieces, 2);
        assert.equal(second.line.pieceCount, 3);
        assert.equal(second.container.lineCount, 1);
        assert.equal((await scan(containerId, trackingCode)).result,
            "counted");
        const fourth = await scan(containerId, trackingCode);
        assert.equal(fourth.result, "all_scanned");
        assert.equal(fourth.line.scannedPieces, 3);
        line = await lineOf(lineId);
        assert.equal(line.loadScannedPieces, 3);
        assert.equal(line.loadScanIds.length, 3);
        assert.deepEqual(await tallies(containerId),
            {lineCount: 1, carCount: 0, barrelCount: 3, otherCount: 0});
        // Counted scans write no History.
        assert.equal((await audits(lineId, "line_assigned")).length, 1);
      });

  it("answers a retried scan id the same and changes nothing", async () => {
    const containerId = await box();
    const {lineId, trackingCode} = await drop();
    const scanId = nextScanId();
    const first = await scan(containerId, trackingCode, {scanId});
    const countedId = nextScanId();
    await scan(containerId, trackingCode, {scanId: countedId});
    const before = await lineOf(lineId);
    const again = await scan(containerId, trackingCode, {scanId});
    assert.equal(again.result, "loaded");
    assert.equal(again.line.scannedPieces, 2);
    assert.equal((await scan(containerId, trackingCode,
        {scanId: countedId})).result, "counted");
    const after = await lineOf(lineId);
    assert.equal(after.loadScannedPieces, 2);
    assert.deepEqual(after.loadScanIds, before.loadScanIds);
    assert.equal(after.updatedAt.toMillis(), before.updatedAt.toMillis());
    assert.deepEqual(await tallies(containerId),
        {lineCount: 1, carCount: 0, barrelCount: 3, otherCount: 0});
    assert.deepEqual(first.container, again.container);
  });

  it("refuses bad codes and ids, and codes it does not have", async () => {
    const containerId = await box();
    await assert.rejects(scan(containerId, "CL-K7M4P0"),
        refused("scan_code_invalid"));
    await assert.rejects(scan(containerId, "https://example.com/x"),
        refused("scan_code_invalid"));
    const {trackingCode} = await drop();
    await assert.rejects(scan(containerId, trackingCode, {scanId: "short"}),
        refused("scan_id_invalid"));
    await assert.rejects(scan(containerId, "CL-ZZZZZZ"), (error) =>
      error.code === "not-found" &&
      error.details?.reason === "line_not_found");
    // Another business's label is not found either.
    const theirs = await call("addWaitingPackage", {...barrels(1)});
    await assert.rejects(scan(containerId, theirs.trackingCode),
        refused("line_not_found"));
    await assert.rejects(
        run("assignContainerLines", {containerId, action: "teleport"}),
        refused("load_action_invalid"));
  });

  it("keeps the destination a hard block", async () => {
    const containerId = await box();
    const {lineId, trackingCode} = await drop(barrels(2, SENEGAL));
    await assert.rejects(scan(containerId, trackingCode),
        refused("destination_mismatch"));
    const line = await lineOf(lineId);
    assert.equal(line.containerId, "");
    assert.ok(noLoadFields(line));
    const undecided = await box({destinationCountryId: "",
      destinationCountryName: ""});
    await assert.rejects(scan(undecided, trackingCode),
        refused("container_destination_required"));
  });

  it("refuses a delivered package and a container not loading",
      async () => {
        const arrived = await box();
        const {lineId, trackingCode} = await drop(barrels(1));
        await run("assignContainerLines", {containerId: arrived,
          lineIds: [lineId]});
        await run("setContainerStatus", {containerId: arrived,
          status: "shipped"});
        await assert.rejects(scan(arrived, trackingCode),
            refused("container_locked"));
        await run("setContainerStatus", {containerId: arrived,
          status: "arrived"});
        await run("updateContainerLine", {lineId, action: "deliver"});
        const loadingBox = await box();
        await assert.rejects(scan(loadingBox, trackingCode),
            refused("line_delivered"));
      });

  it("offers to move a package from another loading container", async () => {
    const from = await box();
    const to = await box();
    const {lineId, trackingCode} = await drop();
    await scan(from, trackingCode);
    await scan(from, trackingCode);
    let error;
    try {
      await scan(to, trackingCode);
    } catch (caught) {
      error = caught;
    }
    assert.equal(error?.details?.reason, "line_in_other_container");
    assert.equal(error.details.otherContainerId, from);
    assert.match(error.details.otherContainerLabel, /^Scan box \d+$/);
    assert.equal(error.details.otherStatus, "loading");
    assert.equal(error.details.canMove, true);
    // Two of its pieces were scanned into the other box: the app warns.
    assert.equal(error.details.otherScannedPieces, 2);
    assert.equal((await lineOf(lineId)).containerId, from);
    const moved = await scan(to, trackingCode, {move: true});
    assert.equal(moved.result, "loaded");
    assert.equal(moved.line.scannedPieces, 1);
    const line = await lineOf(lineId);
    assert.equal(line.containerId, to);
    // Counted afresh on the new container, remembering where it came from.
    assert.equal(line.loadScannedPieces, 1);
    assert.equal(line.loadScanIds.length, 1);
    assert.equal(line.loadMovedFromContainerId, from);
    assert.equal(line.loadAddedByScan, undefined);
    assert.deepEqual(await tallies(from),
        {lineCount: 0, carCount: 0, barrelCount: 0, otherCount: 0});
    assert.deepEqual(await tallies(to),
        {lineCount: 1, carCount: 0, barrelCount: 3, otherCount: 0});
    const loads = await audits(lineId, "line_assigned");
    assert.equal(loads.length, 2);
    assert.ok(loads.some((row) =>
      /by scan \(moved from Scan box \d+\)$/.test(row.summary)));
    // The container it left says where it went, as a move by hand does.
    assert.equal((await audits(from, "line_moved")).length, 1);
  });

  it("never moves a package off a container that has shipped", async () => {
    const shipped = await box();
    const {trackingCode, lineId} = await drop(barrels(1));
    await run("assignContainerLines", {containerId: shipped,
      lineIds: [lineId]});
    await run("setContainerStatus", {containerId: shipped,
      status: "shipped"});
    const loadingBox = await box();
    for (const move of [false, true]) {
      await assert.rejects(scan(loadingBox, trackingCode, {move}),
          (error) => error.details?.reason === "line_in_other_container" &&
            error.details.canMove === false &&
            error.details.otherStatus === "shipped");
    }
    assert.equal((await lineOf(lineId)).containerId, shipped);
  });

  it("is only for people with the containers permission", async () => {
    const containerId = await box();
    const {trackingCode} = await drop();
    for (const action of ["scan", "undo_scan", "load_summary",
      "leave_unscanned"]) {
      await assert.rejects(run("assignContainerLines", {containerId, action,
        code: trackingCode, scanId: nextScanId(), lineId: "x"}, S_PORTER),
      (error) => error.code === "permission-denied", action);
    }
  });

  it("undoes a scan: one piece back, then back to waiting", async () => {
    const containerId = await box();
    const {lineId, trackingCode} = await drop();
    await scan(containerId, trackingCode);
    const lastId = nextScanId();
    await scan(containerId, trackingCode, {scanId: lastId});
    const uncounted = await undo(containerId, lineId, {scanId: lastId});
    assert.equal(uncounted.result, "uncounted");
    assert.equal(uncounted.line.scannedPieces, 1);
    // The same undo asked again takes back nothing more, and says so.
    const repeated = await undo(containerId, lineId, {scanId: lastId});
    assert.equal(repeated.result, "already_undone");
    assert.equal(repeated.line.scannedPieces, 1);
    assert.equal((await lineOf(lineId)).loadScanIds.length, 1);
    const unloaded = await undo(containerId, lineId);
    assert.equal(unloaded.result, "unloaded");
    assert.equal(unloaded.line.scannedPieces, 0);
    assert.equal(unloaded.container.lineCount, 0);
    const line = await lineOf(lineId);
    assert.equal(line.containerId, "");
    assert.equal(line.containerStatus, "waiting");
    assert.ok(noLoadFields(line));
    assert.deepEqual(await tallies(containerId),
        {lineCount: 0, carCount: 0, barrelCount: 0, otherCount: 0});
    const [entry] = await audits(lineId, "line_unassigned");
    assert.match(entry.summary, /^Scan undone: taken off Scan box \d+/);
    // Asked again once it is waiting: nothing changes.
    const again = await undo(containerId, lineId, {scanId: lastId});
    assert.equal(again.result, "already_undone");
    assert.equal((await lineOf(lineId)).containerId, "");
  });

  it("takes back the named scan even when it is not the last", async () => {
    const containerId = await box();
    const {lineId, trackingCode} = await drop();
    const firstId = nextScanId();
    await scan(containerId, trackingCode, {scanId: firstId});
    await scan(containerId, trackingCode);
    const result = await undo(containerId, lineId, {scanId: firstId});
    assert.equal(result.result, "uncounted");
    assert.equal(result.line.scannedPieces, 1);
    const line = await lineOf(lineId);
    assert.equal(line.loadScanIds.includes(firstId), false);
    assert.equal(line.containerId, containerId);
  });

  it("moves a package a scan moved back where it came from", async () => {
    const from = await box();
    const to = await box();
    const {lineId, trackingCode} = await drop();
    await scan(from, trackingCode);
    const moveId = nextScanId();
    await scan(to, trackingCode, {move: true, scanId: moveId});
    const back = await undo(to, lineId, {scanId: moveId});
    assert.equal(back.result, "moved_back");
    assert.deepEqual(back.movedBackTo, {containerId: from,
      label: `Scan box ${boxSerial - 1}`});
    assert.equal(back.line.scannedPieces, 0);
    assert.equal(back.container.lineCount, 0);
    const line = await lineOf(lineId);
    assert.equal(line.containerId, from);
    assert.equal(line.containerStatus, "loading");
    assert.ok(noLoadFields(line));
    assert.deepEqual(await tallies(from),
        {lineCount: 1, carCount: 0, barrelCount: 3, otherCount: 0});
    assert.deepEqual(await tallies(to),
        {lineCount: 0, carCount: 0, barrelCount: 0, otherCount: 0});
    const [entry] = await audits(lineId, "line_moved");
    assert.match(entry.summary,
        /^Scan undone: moved back from Scan box \d+ to Scan box \d+$/);
    // Asked again: nothing more.
    assert.equal((await undo(to, lineId, {scanId: moveId})).result,
        "already_undone");
  });

  it("keeps a moved package here at 0 once its old box has shipped",
      async () => {
        const from = await box();
        const to = await box();
        const {lineId, trackingCode} = await drop();
        const other = await drop(barrels(1));
        await scan(from, trackingCode);
        await scan(to, trackingCode, {move: true});
        // Something else on the old box, so it can ship.
        await run("assignContainerLines", {containerId: from,
          lineIds: [other.lineId]});
        await run("setContainerStatus", {containerId: from,
          status: "shipped"});
        const result = await undo(to, lineId);
        assert.equal(result.result, "uncounted");
        assert.equal(result.line.scannedPieces, 0);
        assert.equal((await lineOf(lineId)).containerId, to);
        assert.deepEqual(await tallies(to),
            {lineCount: 1, carCount: 0, barrelCount: 3, otherCount: 0});
      });

  it("keeps a package added by hand on the container at 0", async () => {
    const containerId = await box();
    const {lineId, trackingCode} = await drop();
    await run("assignContainerLines", {containerId, lineIds: [lineId]});
    const counted = await scan(containerId, trackingCode);
    assert.equal(counted.result, "counted");
    assert.equal(counted.line.scannedPieces, 1);
    const back = await undo(containerId, lineId);
    assert.equal(back.result, "uncounted");
    assert.equal(back.line.scannedPieces, 0);
    assert.equal((await lineOf(lineId)).containerId, containerId);
    // Nothing left to take back: no change, and not "uncounted".
    assert.equal((await undo(containerId, lineId)).result, "already_undone");
  });

  it("clears the scan marks when a package is moved or unassigned",
      async () => {
        const first = await box();
        const second = await box();
        const {lineId, trackingCode} = await drop();
        await scan(first, trackingCode);
        await run("moveContainerLine", {lineId, toContainerId: second});
        let line = await lineOf(lineId);
        assert.equal(line.containerId, second);
        assert.ok(noLoadFields(line));
        await scan(second, trackingCode);
        await run("unassignContainerLine", {lineId});
        line = await lineOf(lineId);
        assert.equal(line.containerId, "");
        assert.ok(noLoadFields(line));
      });

  it("sums up for Done loading", async () => {
    const MALI = {destinationCountryId: "ml",
      destinationCountryName: "Mali"};
    const containerId = await box(MALI);
    const part = await drop(barrels(3, MALI));
    const whole = await drop(barrels(1, MALI));
    const byHand = await drop(barrels(2, MALI));
    const waitingOnes = [];
    for (let i = 0; i < 3; i++) waitingOnes.push(await drop(barrels(1, MALI)));
    // Going elsewhere: not on the waiting list for this container.
    await drop(barrels(1, SENEGAL));
    await scan(containerId, part.trackingCode);
    await scan(containerId, whole.trackingCode);
    await run("assignContainerLines", {containerId,
      lineIds: [byHand.lineId]});
    const summary = await run("assignContainerLines", {containerId,
      action: "load_summary"});
    assert.equal(summary.success, true);
    assert.deepEqual(summary.container, {containerId,
      label: `Scan box ${boxSerial}`, lineCount: 3, pieceCount: 6});
    assert.deepEqual(summary.incomplete.map((row) =>
      [row.lineId, row.scannedPieces, row.pieceCount]),
    [[part.lineId, 1, 3]]);
    assert.deepEqual(summary.unscanned.map((row) => row.lineId),
        [byHand.lineId]);
    assert.equal(summary.waitingCount, 3);
    assert.deepEqual(summary.waiting.map((row) => row.lineId).sort(),
        waitingOnes.map((one) => one.lineId).sort());
    assert.equal(summary.waiting[0].destinationCountryName, "Mali");
  });

  it("leaves the unscanned pieces waiting as a part", async () => {
    const containerId = await box();
    const {lineId, trackingCode} = await drop(barrels(4));
    const leave = () => run("assignContainerLines", {containerId,
      action: "leave_unscanned", lineId});
    // Not on this container yet.
    await assert.rejects(leave(), refused("line_not_found"));
    await scan(containerId, trackingCode);
    await scan(containerId, trackingCode);
    const result = await leave();
    assert.equal(result.success, true);
    assert.equal(result.alreadyDone, false);
    assert.equal(result.line.pieceCount, 2);
    assert.equal(result.line.scannedPieces, 2);
    assert.equal(result.part.trackingCode, `${trackingCode}-2`);
    assert.equal(result.part.pieceCount, 2);
    assert.deepEqual(result.container, {containerId,
      label: `Scan box ${boxSerial}`, lineCount: 1, pieceCount: 2});
    const going = await lineOf(lineId);
    assert.equal(going.containerId, containerId);
    assert.equal(going.pieceCount, 2);
    assert.equal(going.loadScannedPieces, 2);
    const staying = await lineOf(result.part.lineId);
    assert.equal(staying.containerId, "");
    assert.equal(staying.containerStatus, "waiting");
    assert.equal(staying.rootLineId, lineId);
    assert.equal(staying.pieceCount, 2);
    assert.ok(noLoadFields(staying));
    assert.deepEqual(await tallies(containerId),
        {lineCount: 1, carCount: 0, barrelCount: 2, otherCount: 0});
    assert.equal(going.loadLeftPartId, result.part.lineId);
    // Asked again (its answer lost): the same part, nothing new.
    const again = await leave();
    assert.equal(again.alreadyDone, true);
    assert.deepEqual(again.part, result.part);
    assert.equal((await audits(lineId, "line_split")).length, 1);
    assert.deepEqual(await tallies(containerId),
        {lineCount: 1, carCount: 0, barrelCount: 2, otherCount: 0});
    // Never scanned (put on by hand): nothing to keep.
    const byHand = await drop(barrels(2));
    await run("assignContainerLines", {containerId,
      lineIds: [byHand.lineId]});
    await assert.rejects(run("assignContainerLines", {containerId,
      action: "leave_unscanned", lineId: byHand.lineId}),
    refused("piece_count_invalid"));
    // The part is scanned onto a container by its own code.
    const later = await box();
    const loaded = await scan(later, result.part.trackingCode);
    assert.equal(loaded.result, "loaded");
    assert.equal(loaded.line.lineId, result.part.lineId);
    // No message for a split.
    const queued = await db.collection("containerUpdates")
        .doc(`${result.part.lineId}_sender_received`).get();
    assert.equal(queued.exists, false);
  });

  describe("when, by whom and how a package went on", () => {
    const MARKS = ["containerAssignedAt", "containerAssignedByStaffId",
      "containerAssignedVia"];
    const noMarks = (line) => MARKS.every((key) => line[key] === undefined);
    const marked = (line, via, uid) => {
      assert.equal(line.containerAssignedVia, via);
      assert.equal(line.containerAssignedByStaffId, uid);
      assert.ok(line.containerAssignedAt.toMillis() > 0);
    };

    it("says hand for assignContainerLines without a scan", async () => {
      const containerId = await box();
      const {lineId} = await drop();
      await run("assignContainerLines", {containerId, lineIds: [lineId]},
          S_LOADER);
      marked(await lineOf(lineId), "hand", S_LOADER);
      // Asked again (nothing changes): the marks stay as they were.
      const before = (await lineOf(lineId)).containerAssignedAt.toMillis();
      await run("assignContainerLines", {containerId, lineIds: [lineId]});
      const line = await lineOf(lineId);
      assert.equal(line.containerAssignedAt.toMillis(), before);
      assert.equal(line.containerAssignedByStaffId, S_LOADER);
    });

    it("says hand for a package added straight onto a container",
        async () => {
          const containerId = await box();
          const {lineId} = await run("addContainerLine", {containerId,
            line: {...people, ...GUINEA,
              pieces: [{kind: "barrel"}, {kind: "barrel"}]}}, S_LOADER);
          marked(await lineOf(lineId), "hand", S_LOADER);
        });

    it("says scan for a scan from waiting, and keeps it when counting",
        async () => {
          const containerId = await box();
          const {lineId, trackingCode} = await drop();
          const loaded = await scan(containerId, trackingCode, {}, S_LOADER);
          const line = await lineOf(lineId);
          marked(line, "scan", S_LOADER);
          assert.equal(loaded.line.assignedVia, "scan");
          sameTime(loaded.line.assignedAt, line.containerAssignedAt);
          assert.equal(loaded.line.addedByScan, true);
          const counted = await scan(containerId, trackingCode, {}, S_OWNER);
          const after = await lineOf(lineId);
          marked(after, "scan", S_LOADER);
          assert.equal(after.containerAssignedAt.toMillis(),
              line.containerAssignedAt.toMillis());
          assert.equal(counted.line.assignedVia, "scan");
          assert.equal(counted.line.assignedAt,
              line.containerAssignedAt.toMillis());
        });

    it("says move for a move by hand and a scan with move", async () => {
      const first = await box();
      const second = await box();
      const third = await box();
      const {lineId, trackingCode} = await drop();
      await run("assignContainerLines", {containerId: first,
        lineIds: [lineId]});
      marked(await lineOf(lineId), "hand", S_OWNER);
      await run("moveContainerLine", {lineId, toContainerId: second},
          S_LOADER);
      marked(await lineOf(lineId), "move", S_LOADER);
      const moved = await scan(third, trackingCode, {move: true}, S_OWNER);
      const line = await lineOf(lineId);
      marked(line, "move", S_OWNER);
      assert.equal(line.containerId, third);
      assert.equal(moved.line.assignedVia, "move");
      assert.equal(moved.line.addedByScan, false);
      sameTime(moved.line.assignedAt, line.containerAssignedAt);
    });

    it("writes move for the container an undone move goes back to",
        async () => {
          const from = await box();
          const to = await box();
          const {lineId, trackingCode} = await drop();
          await scan(from, trackingCode, {}, S_OWNER);
          const moveId = nextScanId();
          await scan(to, trackingCode, {move: true, scanId: moveId}, S_OWNER);
          const back = await undo(to, lineId, {scanId: moveId});
          assert.equal(back.result, "moved_back");
          const line = await lineOf(lineId);
          assert.equal(line.containerId, from);
          marked(line, "move", S_OWNER);
          assert.equal(back.line.assignedVia, "move");
          sameTime(back.line.assignedAt, line.containerAssignedAt);
        });

    it("clears them when the package leaves the container", async () => {
      const containerId = await box();
      const byHand = await drop();
      await run("assignContainerLines", {containerId,
        lineIds: [byHand.lineId]});
      await run("unassignContainerLine", {lineId: byHand.lineId});
      let line = await lineOf(byHand.lineId);
      assert.equal(line.containerId, "");
      assert.ok(noMarks(line));
      // The undo that unloads a scanned package clears them too.
      const scanned = await drop();
      await scan(containerId, scanned.trackingCode);
      marked(await lineOf(scanned.lineId), "scan", S_OWNER);
      const result = await undo(containerId, scanned.lineId);
      assert.equal(result.result, "unloaded");
      assert.equal(result.line.assignedVia, "");
      assert.equal(result.line.assignedAt, null);
      assert.equal(result.line.addedByScan, false);
      line = await lineOf(scanned.lineId);
      assert.equal(line.containerId, "");
      assert.ok(noMarks(line));
      assert.ok(noLoadFields(line));
    });

    it("gives the part that stays waiting none", async () => {
      const root = await drop(barrels(4));
      const containerId = await box();
      const result = await run("assignContainerLines", {containerId,
        lineIds: [root.lineId], pieceCounts: {[root.lineId]: 2}}, S_LOADER);
      assert.equal(result.parts.length, 1);
      marked(await lineOf(root.lineId), "hand", S_LOADER);
      const part = await lineOf(result.parts[0].partLineId);
      assert.equal(part.containerId, "");
      assert.ok(noMarks(part));
      // Leave N waiting after scans: the part has none either.
      const other = await drop(barrels(3));
      await scan(containerId, other.trackingCode);
      const left = await run("assignContainerLines", {containerId,
        action: "leave_unscanned", lineId: other.lineId});
      marked(await lineOf(other.lineId), "scan", S_OWNER);
      assert.ok(noMarks(await lineOf(left.part.lineId)));
      assert.equal(left.line.assignedVia, "scan");
    });

    it("tells the summary rows how each package went on", async () => {
      const containerId = await box();
      const byHand = await drop(barrels(2, {customerName: "",
        customerPhone: ""}));
      await run("assignContainerLines", {containerId,
        lineIds: [byHand.lineId]});
      const summary = await run("assignContainerLines", {containerId,
        action: "load_summary"});
      const [row] = summary.unscanned;
      assert.equal(row.assignedVia, "hand");
      assert.equal(row.addedByScan, false);
      assert.ok(row.assignedAt > 0);
      // No sender: the receiver is the customer.
      assert.equal(row.customerName, "Mariama Bah");
      assert.equal(row.customerPhone, "+224620000000");
    });
  });

  it("leaves assignContainerLines without an action as it was", async () => {
    const containerId = await box();
    const {lineId} = await drop();
    const result = await run("assignContainerLines", {containerId,
      lineIds: [lineId]});
    assert.deepEqual(result, {success: true, assigned: 1,
      alreadyAssigned: 0, parts: []});
    const line = await lineOf(lineId);
    assert.equal(line.containerId, containerId);
    assert.ok(noLoadFields(line));
    const [entry] = await audits(lineId, "line_assigned");
    assert.match(entry.summary, /^Added 3 barrels for Fatou Diallo to /);
  });
});

describe("air containers (flights)", () => {
  const packageProof = require("../package_proof");
  const containerOf = async (id) =>
    (await db.collection("containers").doc(id).get()).data();
  const lineDataOf = async (id) =>
    (await db.collection("containerLines").doc(id).get()).data();
  const flight = (extra = {}) => ({shipMode: "air",
    airWaybill: "176-1234 5678", airline: " Air France ",
    destinationCountryId: "gn", destinationCountryName: "Guinea", ...extra});
  // The /d page, answered as the platform would answer it.
  const openDocument = async (query) => {
    const sent = {};
    const res = Object.assign(new EventEmitter(), {
      set() {}, setHeader() {}, getHeader() {}, removeHeader() {},
      status(code) {
        sent.status = code;
        return this;
      }, send(body) {
        sent.body = body;
        return this;
      },
    });
    await functions.parkingDocument(
        {method: "GET", query, headers: {}}, res);
    return sent;
  };

  it("creates a flight by its waybill, with no number and no shipping line",
      async () => {
        const {containerId} = await call("createContainer",
            flight({containerNumber: "MSKU1234567", carrierScac: "MAEU"}));
        const row = await containerOf(containerId);
        assert.equal(row.shipMode, "air");
        assert.equal(row.airWaybill, "176-12345678");
        assert.equal(row.airline, "Air France");
        assert.equal(row.containerNumber, "");
        assert.equal(row.carrierScac, "");
        // A box is written out as sea.
        const sea = await newContainer({containerNumber: "msku1234567",
          airWaybill: "176-12345678", airline: "Air France"});
        const box = await containerOf(sea);
        assert.equal(box.shipMode, "sea");
        assert.equal(box.containerNumber, "MSKU1234567");
        assert.equal(box.airWaybill, "");
        assert.equal(box.airline, "");
      });

  it("refuses a bad waybill by name, and a flight with no name at all",
      async () => {
        await assert.rejects(call("createContainer",
            flight({airWaybill: "12345"})),
        (error) => error.code === "invalid-argument" &&
          error.details?.reasons?.includes("air_waybill_invalid") &&
          /air waybill/i.test(error.message));
        await assert.rejects(call("createContainer",
            {shipMode: "air", destinationCountryId: "gn"}),
        (error) => error.details?.reasons?.includes(
            "container_label_required"));
        // A label is name enough; the waybill comes later.
        const {containerId} = await call("createContainer",
            {shipMode: "air", label: "Friday flight",
              destinationCountryId: "gn"});
        assert.equal((await containerOf(containerId)).airWaybill, "");
      });

  it("edits the waybill while loading, and locks it once departed",
      async () => {
        const {containerId} = await call("createContainer",
            flight({airWaybill: "", label: "Fri"}));
        await call("updateContainer", {containerId,
          changes: {airWaybill: "176-99887766", airline: "Brussels"}});
        let row = await containerOf(containerId);
        assert.equal(row.airWaybill, "176-99887766");
        assert.equal(row.airline, "Brussels");
        await assert.rejects(call("updateContainer", {containerId,
          changes: {airWaybill: "bad"}}),
        (error) => error.details?.reasons?.includes("air_waybill_invalid"));
        await call("addContainerLine", {containerId, line: barrelLine(1)});
        await call("setContainerStatus", {containerId, status: "shipped"});
        for (const changes of [{airWaybill: "176-11111111"},
          {airline: "Other"}, {shipMode: "sea", containerNumber:
            "MSKU1234567"}]) {
          await assert.rejects(call("updateContainer", {containerId, changes}),
              (error) => error.code === "failed-precondition" &&
                error.message === CONTAINER_MESSAGES.container_locked);
        }
        // The notes stay open, as on a box.
        await call("updateContainer", {containerId,
          changes: {notes: "fragile"}});
        row = await containerOf(containerId);
        assert.equal(row.notes, "fragile");
        assert.equal(row.airWaybill, "176-99887766");
      });

  it("does not read a box from before ship modes as changed to sea",
      async () => {
        const containerId = await newContainer({containerNumber:
          "MSKU1234567"});
        await db.collection("containers").doc(containerId).update({
          shipMode: admin.firestore.FieldValue.delete()});
        await call("addContainerLine", {containerId, line: barrelLine(1)});
        await call("setContainerStatus", {containerId, status: "shipped"});
        assert.equal((await containerOf(containerId)).shipMode, undefined);
        // A note after sailing is still just a note.
        await call("updateContainer", {containerId,
          changes: {notes: "late note"}});
        const row = await containerOf(containerId);
        assert.equal(row.notes, "late note");
        assert.equal(row.shipMode, "sea");
        assert.equal(row.containerNumber, "MSKU1234567");
      });

  it("turns a loading box into a flight, dropping number and line",
      async () => {
        const containerId = await newContainer({containerNumber:
          "MSKU1234567", carrierScac: "MAEU"});
        await call("updateContainer", {containerId,
          changes: {shipMode: "air", airWaybill: "176-55555555"}});
        const row = await containerOf(containerId);
        assert.equal(row.shipMode, "air");
        assert.equal(row.containerNumber, "");
        assert.equal(row.carrierScac, "");
        assert.equal(row.airWaybill, "176-55555555");
      });

  it("shows the flight on the tracking page, and photos to its people only",
      async () => {
        const {containerId} = await call("createContainer", flight());
        const {lineId} = await call("addContainerLine",
            {containerId, line: barrelLine(2)});
        await call("setContainerStatus", {containerId, status: "shipped"});
        const line = await lineDataOf(lineId);
        const lookup = (auth = null) => functions.lookupGuestTracking.run({
          auth, data: {identifier: line.trackingCode},
          rawRequest: {headers: {}}});
        const guest = await lookup();
        assert.deepEqual(guest.record.shipping, {mode: "air",
          airline: "Air France", airWaybill: "176-12345678"});
        assert.equal(guest.record.photos, undefined);
        // Photos filed on the line (the proof fields other callables write).
        const dropoff = `packagePhotos/${BIZ}/${OWNER}/dropoff00001.jpg`;
        const fromChat = `packagePhotos/${BIZ}/wa/abcdef1234567890.jpg`;
        const delivered = `packagePhotos/${BIZ}/agentUid1/delivered001.jpg`;
        await db.collection("containerLines").doc(lineId).update({
          photoPaths: [dropoff],
          customerPhotos: [{path: fromChat, phone: "+16465550100", atMs: 1}],
          deliveredPhotoPath: delivered,
        });
        assert.equal((await lookup()).record.photos, undefined);
        // A stranger with a verified phone: nothing.
        const stranger = await lookup({uid: "stranger-1",
          token: {phone_number: "+16465550199"}});
        assert.equal(stranger.record.photos, undefined);
        // The sender (the line's number was typed without +1 formatting
        // elsewhere; here it is the stored +16465550100).
        const sender = await lookup({uid: "sender-1",
          token: {phone_number: "+16465550100"}});
        assert.deepEqual(sender.record.photos.map((p) => p.kind),
            ["dropoff", "customer", "delivered"]);
        const token = (await lineDataOf(lineId)).documentToken;
        assert.ok(token && token.length >= 16, "a token was minted");
        const url = new URL(sender.record.photos[0].url);
        assert.equal(url.searchParams.get("view"), "photo");
        assert.equal(url.searchParams.get("t"), token);
        assert.equal(url.searchParams.get("p"), dropoff);
        const expires = Number(url.searchParams.get("e"));
        assert.ok(expires > Date.now() + packageProof.PHOTO_LINK_MS - 60000);
        assert.ok(expires <= Date.now() + packageProof.PHOTO_LINK_MS);
        assert.equal(packageProof.photoLinkValid(
            Object.fromEntries(url.searchParams), token, Date.now()), true);
        // The receiver too, on the same token; an anonymous session not.
        const receiver = await lookup({uid: "receiver-1",
          token: {phone_number: "+224620000000"}});
        assert.equal(new URL(receiver.record.photos[2].url).searchParams
            .get("t"), token);
        assert.equal(receiver.record.photos[2].kind, "delivered");
        const anonymous = await lookup({uid: "anon-1", token: {
          phone_number: "+16465550100", firebase: {sign_in_provider:
            "anonymous"}}});
        assert.equal(anonymous.record.photos, undefined);
        // Nothing of the paths leaks to the guest page.
        assert.ok(!JSON.stringify(guest).includes("packagePhotos"));
      });

  it("prints the customs list for staff with the containers permission",
      async () => {
        const {containerId} = await call("createContainer", flight());
        const {lineId} = await call("addContainerLine", {containerId,
          line: {kind: "other", quantity: 2, description: "Phones",
            ownerKind: "customer", customerName: "Fatou Diallo",
            customerPhone: "+16465550100", receiverName: "Mariama Bah",
            receiverPhone: "+224620000000", priceCents: 9000}});
        const other = await call("addContainerLine", {containerId,
          line: barrelLine(3)});
        // The declarations (the proof fields other callables write).
        await db.collection("containerLines").doc(lineId).update({
          contents: [{label: "iPhone 13", quantity: 2,
            serial: "356789012345678"}, {label: "clothes", quantity: 1,
            serial: ""}],
          weightLb: 4.2, declaredValueCents: 125000,
        });
        await db.collection("containerLines").doc(other.lineId).update({
          weightLb: 60, declaredValueCents: 30000});
        const {url} = await call("getContainerDocumentUrl",
            {containerId, view: "customs"});
        const query = Object.fromEntries(new URL(url).searchParams);
        assert.equal(query.view, "customs");
        assert.equal(query.t, (await containerOf(containerId)).documentToken);
        // The same token as the loading list and the labels.
        const plain = await call("getContainerDocumentUrl", {containerId});
        assert.equal(new URL(plain.url).searchParams.get("t"), query.t);
        await assert.rejects(call("getContainerDocumentUrl",
            {containerId, view: "customs"}, NO_CONTAINERS),
        (error) => error.code === "permission-denied");
        const page = await openDocument(query);
        assert.equal(page.status, 200);
        const line = await lineDataOf(lineId);
        assert.match(page.body, new RegExp(line.trackingCode));
        assert.match(page.body, /Shipment 176-12345678/);
        assert.match(page.body, /Air France/);
        assert.match(page.body, /Guinea/);
        assert.match(page.body, /Fatou Diallo/);
        assert.match(page.body, /\+224620000000/);
        assert.match(page.body,
            /2 × iPhone 13 \(S\/N 356789012345678\), clothes/);
        assert.match(page.body, /3 barrels/);
        assert.match(page.body, /4\.2 lb/);
        assert.match(page.body, /\$1,250\.00/);
        assert.match(page.body, /64\.2 lb/);
        assert.match(page.body, /\$1,550\.00/);
        assert.match(page.body, /@page\{size:letter portrait;/);
        // The business's price is not customs' business.
        assert.doesNotMatch(page.body, /90\.00|9000/);
        assert.doesNotMatch(page.body, /Container/);
        // A made-up token opens nothing.
        assert.equal((await openDocument({t: "x".repeat(32),
          view: "customs"})).status, 404);
      });
});

/* eslint-disable max-len */
// The sender's confirmation at drop-off (docs/AIR_PACKAGES.md §4.4): with the
// business switch on and a photo on the line, the sender's `received` row is
// the `confirm` row; the receiver still hears `received`. Driven through the
// one queue every registration uses (queueContainerLineUpdate), here by
// sending a box's current status, so the line can be seeded with its photo.
describe("the sender's confirmation at drop-off", () => {
  const PHOTO = `packagePhotos/${BIZ}/${OWNER}/dropoff-photo-1.jpg`;
  let serial = 0;
  async function seededLine(box, extra = {}) {
    serial += 1;
    const ref = db.collection("containerLines").doc(`confirm-line-${serial}`);
    await ref.set({
      businessId: BIZ, containerId: box, kind: "other", quantity: 1,
      description: "box of clothes", ownerKind: "customer",
      customerName: "Fatou Diallo", customerPhone: "+16465550100",
      receiverName: "Mariama Bah", receiverPhone: "+224620000000",
      trackingCode: `CL-TST${String(serial).padStart(3, "0")}`,
      contents: [{label: "phones", quantity: 2}, {label: "tablet", quantity: 1}],
      weightLb: 4.2, photoPaths: [PHOTO], createdAt: new Date(), ...extra,
    });
    return ref;
  }
  async function sendReceived(box) {
    await db.collection("containers").doc(box).collection("trackingEvents")
        .doc("seeded_received").set({label: "Received", source: "staff",
          customerUpdate: "received", timestamp: new Date()});
    connectWhatsApp();
    return call("sendContainerCurrentStatus", {containerId: box});
  }
  const rowsOf = async (lineId) => (await db.collection("containerUpdates")
      .where("lineId", "==", lineId).get()).docs
      .map((d) => ({id: d.id, ...d.data()})).sort((a, b) => a.id.localeCompare(b.id));
  const switchOn = () => db.collection("businesses").doc(BIZ)
      .set({packageProofSettings: {senderConfirm: true}}, {merge: true});
  afterEach(() => db.collection("businesses").doc(BIZ)
      .set({packageProofSettings: {senderConfirm: false}}, {merge: true}));

  it("queues confirm for the sender instead of received, received for the receiver, and sends the photo", async () => {
    await switchOn();
    const box = await newContainer();
    const ref = await seededLine(box);
    assert.equal((await sendReceived(box)).queued, 2);
    const rows = await rowsOf(ref.id);
    assert.deepEqual(rows.map((r) => [r.id, r.update, r.role, r.status]), [
      [`${ref.id}_receiver_received`, "received", "receiver", "queued"],
      [`${ref.id}_sender_confirm`, "confirm", "sender", "queued"],
    ]);
    const line = (await ref.get()).data();
    assert.equal(line.senderConfirmation.status, "asked");
    assert.ok(line.senderConfirmation.askedAtMs > 0);
    assert.match(line.documentToken, /^[A-Za-z0-9_-]{32}$/, "the token the photo link is signed with");
    assert.equal(line.lastCustomerUpdate.update, "received");
    assert.deepEqual(line.lastCustomerUpdate.results.map((r) => r.role).sort(), ["receiver", "sender"]);
    // The message: the photo as the header, the item list and weight, OK /
    // Something's wrong.
    fakeWhatsApp(OK);
    await deliver(`${ref.id}_sender_confirm`);
    assert.equal(whatsappCalls.length, 1);
    const [body] = whatsappCalls;
    assert.equal(body.to, "16465550100");
    assert.equal(body.template.name, "package_confirm_2lang");
    assert.deepEqual(body.template.language, {code: "en"});
    const [header, text, ok, problem] = body.template.components;
    assert.equal(header.type, "header");
    assert.match(header.parameters[0].image.link, new RegExp(
        // Straight at the function: Meta may not follow /d's redirect.
        "^https://us-central1-demo-laawol-containers\\.cloudfunctions\\.net/" +
        `parkingDocument\\?view=photo&t=${line.documentToken}` +
        `&p=${encodeURIComponent(PHOTO).replace(/\\./g, "\\.")}&e=\\d+&s=[0-9a-f]{24}$`));
    assert.deepEqual(text.parameters.map((p) => p.text), [
      "Fatou Diallo", "Dala Shipping", "2 phones, tablet", "4.2 lb",
      "Dala Shipping", "2 phones, tablet", "4,2 lb", line.trackingCode]);
    assert.deepEqual(ok, {type: "button", sub_type: "quick_reply", index: "0", parameters: [{type: "payload", payload: "confirm_ok"}]});
    assert.deepEqual(problem, {type: "button", sub_type: "quick_reply", index: "1", parameters: [{type: "payload", payload: "confirm_problem"}]});
    const sentRow = (await db.collection("containerUpdates").doc(`${ref.id}_sender_confirm`).get()).data();
    assert.equal(sentRow.status, "sent");
    assert.equal(sentRow.whatsappMessageId, "wamid.TEST");
    assert.equal((await ref.get()).data().senderConfirmation.status, "asked");
    // The receiver's message is the usual one.
    fakeWhatsApp(OK);
    await deliver(`${ref.id}_receiver_received`);
    assert.equal(whatsappCalls[0].template.name, "shipment_received_2lang");
    // Asking again never re-asks an answered sender.
    await ref.set({senderConfirmation: {status: "confirmed", askedAtMs: 1, answeredAtMs: 2}}, {merge: true});
    await db.collection("containerUpdates").doc(`${ref.id}_sender_confirm`).update({status: "failed"});
    await call("sendContainerCurrentStatus", {containerId: box});
    assert.equal((await ref.get()).data().senderConfirmation.status, "confirmed");
  });

  it("sends the plain received without a photo, or with the switch off", async () => {
    await switchOn();
    const box = await newContainer();
    const noPhoto = await seededLine(box, {photoPaths: []});
    await sendReceived(box);
    assert.deepEqual((await rowsOf(noPhoto.id)).map((r) => r.id), [
      `${noPhoto.id}_receiver_received`, `${noPhoto.id}_sender_received`]);
    assert.equal((await noPhoto.get()).data().senderConfirmation, undefined);
    await db.collection("businesses").doc(BIZ)
        .set({packageProofSettings: {senderConfirm: false}}, {merge: true});
    const off = await newContainer();
    const withPhoto = await seededLine(off);
    await sendReceived(off);
    assert.deepEqual((await rowsOf(withPhoto.id)).map((r) => r.id), [
      `${withPhoto.id}_receiver_received`, `${withPhoto.id}_sender_received`]);
    assert.equal((await withPhoto.get()).data().senderConfirmation, undefined);
    assert.equal((await withPhoto.get()).data().documentToken, undefined);
  });

  it("sends the pickup code to the receiver when the box is ready", async () => {
    const box = await newContainer();
    const ref = await seededLine(box, {pickupCode: "4821"});
    connectWhatsApp();
    await call("setContainerStatus", {containerId: box, status: "shipped"});
    await call("setContainerStatus", {containerId: box, status: "arrived"});
    await recordMoments(box);
    fakeWhatsApp(OK);
    await deliver(`${ref.id}_receiver_arrived`);
    assert.equal(whatsappCalls[0].template.name, "shipment_ready_pickup_2lang");
    assert.match(whatsappCalls[0].template.components[0].parameters[7].text,
        /Pickup number \/ N° de retrait : 4821$/);
    fakeWhatsApp(OK);
    await deliver(`${ref.id}_sender_arrived`);
    assert.equal(whatsappCalls[0].template.name, "shipment_ready_pickup_2lang");
    assert.doesNotMatch(whatsappCalls[0].template.components[0].parameters[7].text, /4821/);
  });
});
/* eslint-enable max-len */
// Proof on the package (docs/AIR_PACKAGES.md): the drop-off photos checked
// against Storage, the "photos required" switch, the pickup code minted
// with a line, the handover with the code or the override and the money
// collected, the loading warning, the /d photo link and the 12-month sweep.
// Its own business, so its switches disturb no other suite.
describe("proof on the package", () => {
  const P_BIZ = "proof-test-biz";
  const P_OWNER = "proof-test-owner";
  const P_STAFF = "proof-test-staff";
  const P_AGENT = "proof-test-deliveries-only";
  const bucket = admin.storage().bucket(
      `${process.env.GCLOUD_PROJECT}.firebasestorage.app`);
  const bizRef = db.collection("businesses").doc(P_BIZ);
  before(async () => {
    await Promise.all([
      bizRef.set({name: "Proof Shipping", status: "approved",
        ownerUid: P_OWNER}),
      db.collection("users").doc(P_OWNER).set({
        role: "businessOwner", businessId: P_BIZ, fullName: "Proof Owner",
      }),
      db.collection("users").doc(P_STAFF).set({
        role: "staff", businessId: P_BIZ, fullName: "Counter Staff",
        businessPermissions: ["containers"],
      }),
      db.collection("users").doc(P_AGENT).set({
        role: "staff", businessId: P_BIZ, fullName: "Guinea Agent",
        businessPermissions: ["deliveries"],
      }),
    ]);
  });
  const switches = (proof) => bizRef.update({packageProofSettings: proof});
  const run = (name, data, uid = P_OWNER) =>
    functions[name].run({auth: {uid, token: {}}, data: {businessId: P_BIZ,
      ...data}});
  const GUINEA = {destinationCountryId: "gn",
    destinationCountryName: "Guinea"};
  const people = {ownerKind: "customer", customerName: "Fatou Diallo",
    customerPhone: "+16465550100", receiverName: "Mariama Bah",
    receiverPhone: "+224620000000"};
  // Unpriced, so a handover owes nothing unless a test prices it.
  const barrels = (n, extra = {}) => ({...people, ...GUINEA,
    pieces: Array.from({length: n}, () => ({kind: "barrel"})), ...extra});
  const priced = (cents) => barrels(cents.length, {pieces: cents.map(
      (priceCents) => ({kind: "barrel", priceCents}))});
  const lineOf = async (id) =>
    (await db.collection("containerLines").doc(id).get()).data();
  // A refusal names its code as `reason` (one rule) or in `reasons` (the
  // line validator, every problem at once).
  const refused = (reason) => (error) => error.details?.reason === reason ||
    (Array.isArray(error.details?.reasons) &&
      error.details.reasons.includes(reason));
  let photoSerial = 0;
  // A photo as the app uploads it: the uploader's own folder.
  async function photo(uid, {contentType = "image/jpeg", size = 2048,
    folder = uid, ext = "jpg"} = {}) {
    photoSerial += 1;
    const path = `packagePhotos/${P_BIZ}/${folder}/` +
      `photo-${String(photoSerial).padStart(8, "0")}.${ext}`;
    await bucket.file(path).save(Buffer.alloc(size, 1), {contentType});
    return path;
  }
  let boxSerial = 0;
  async function arrivedBox(lines, uid = P_OWNER) {
    boxSerial += 1;
    const {containerId} = await run("createContainer", {
      label: `Proof box ${boxSerial}`, ...GUINEA}, uid);
    const ids = [];
    for (const line of lines) {
      const {lineId} = await run("addContainerLine", {containerId, line},
          uid);
      ids.push(lineId);
    }
    await run("setContainerStatus", {containerId, status: "shipped"});
    await run("setContainerStatus", {containerId, status: "arrived"});
    return {containerId, lineIds: ids};
  }
  const deliver = (lineId, extra = {}, uid = P_AGENT) =>
    run("updateContainerLine", {lineId, action: "deliver", ...extra}, uid);
  const paymentsOf = async (lineId) => (await db
      .collection("containerLinePayments").where("businessId", "==", P_BIZ)
      .where("lineId", "==", lineId).get()).docs.map((d) => d.data());
  const audits = async (entityId, action) => {
    const snap = await db.collection("lotLedgerAudit")
        .where("entityId", "==", entityId).where("action", "==", action).get();
    return snap.docs.map((d) => d.get("summary"));
  };

  describe("photos at drop-off", () => {
    it("stores the caller's own uploads and refuses anything else",
        async () => {
          await switches({});
          const own = await photo(P_STAFF);
          const second = await photo(P_STAFF, {contentType: "image/webp",
            ext: "webp"});
          const dropped = await run("addWaitingPackage", barrels(2, {
            photoPaths: [own, second, own],
            contents: [{label: "Phones", quantity: 2, serial: "IMEI-1"}],
            weightLb: 4.26, declaredValueCents: 120000}), P_STAFF);
          const line = await lineOf(dropped.lineId);
          assert.deepEqual(line.photoPaths, [own, second]);
          assert.deepEqual(line.contents,
              [{label: "Phones", quantity: 2, serial: "IMEI-1"}]);
          assert.equal(line.weightLb, 4.3);
          assert.equal(line.declaredValueCents, 120000);
          assert.equal(line.pickupCode, undefined);
          // Someone else's folder, a missing file, a wrong type, too big,
          // the server's folder.
          const others = await photo(P_OWNER);
          for (const bad of [
            [others],
            [`packagePhotos/${P_BIZ}/${P_STAFF}/missing-00000001.jpg`],
            [await photo(P_STAFF, {contentType: "image/gif"})],
            [await photo(P_STAFF, {size: 2 * 1024 * 1024 + 1})],
            [await photo(P_STAFF, {folder: "req"})],
            [`packageRequestPhotos/${P_BIZ}/${P_STAFF}/photo-00000001.jpg`],
          ]) {
            await assert.rejects(run("addWaitingPackage",
                barrels(1, {photoPaths: bad}), P_STAFF),
            refused("photo_invalid"), bad[0]);
            await assert.rejects(run("addContainerLine", {
              containerId: (await run("createContainer",
                  {label: "Photo box", ...GUINEA})).containerId,
              line: barrels(1, {photoPaths: bad})}, P_STAFF),
            refused("photo_invalid"), bad[0]);
          }
          for (const [field, value, reason] of [
            ["contents", [{label: "x".repeat(61)}], "contents_invalid"],
            ["weightLb", 0, "weight_invalid"],
            ["declaredValueCents", -5, "declared_value_invalid"],
          ]) {
            await assert.rejects(run("addWaitingPackage",
                barrels(1, {[field]: value}), P_STAFF), (error) =>
              error.details?.reasons?.includes(reason), reason);
          }
        });

    it("requires one at the counter when the switch is on, for air only",
        async () => {
          await switches({photosRequired: true});
          await assert.rejects(run("addWaitingPackage",
              barrels(1, {shipMode: "air"}), P_STAFF),
          (error) => error.code === "failed-precondition" &&
            error.details?.reason === "photo_required");
          // A sea package (the default) never needs one.
          const sea = await run("addWaitingPackage", barrels(1), P_STAFF);
          assert.equal((await lineOf(sea.lineId)).shipMode, "sea");
          const seaBox = await run("createContainer",
              {label: "Required sea box", ...GUINEA});
          await run("addContainerLine", {containerId: seaBox.containerId,
            line: barrels(1, {photoPaths: []})}, P_STAFF);
          await switches({});
        });

    it("requires one on an air line when the switch is on", async () => {
      await switches({photosRequired: true});
      const {containerId} = await run("createContainer",
          {label: "Required flight", shipMode: "air", ...GUINEA});
      // Added straight onto a flight, it flies: the photo is needed.
      await assert.rejects(run("addContainerLine", {containerId,
        line: barrels(1, {photoPaths: []})}, P_STAFF),
      refused("photo_required"));
      const own = await photo(P_STAFF);
      const dropped = await run("addWaitingPackage",
          barrels(1, {photoPaths: [own], shipMode: "air"}), P_STAFF);
      assert.deepEqual((await lineOf(dropped.lineId)).photoPaths, [own]);
      const added = await run("addContainerLine", {containerId,
        line: barrels(1, {photoPaths: [own]})}, P_STAFF);
      assert.deepEqual((await lineOf(added.lineId)).photoPaths, [own]);
      assert.equal((await lineOf(added.lineId)).shipMode, "air");
      // Taking the last photo off a counter line is refused the same way.
      await assert.rejects(run("updateContainerLine", {
        lineId: dropped.lineId, line: {...barrels(1), photoPaths: []}},
      P_STAFF), refused("photo_required"));
      await switches({});
    });

    it("edits the four fields, keeping what the server added", async () => {
      await switches({});
      const own = await photo(P_STAFF);
      const dropped = await run("addWaitingPackage",
          barrels(2, {photoPaths: [own], weightLb: 3}), P_STAFF);
      // A copy the server made from a request, as a received line has.
      const copied = await photo(P_STAFF, {folder: "req"});
      await db.collection("containerLines").doc(dropped.lineId)
          .update({photoPaths: [copied, own]});
      const more = await photo(P_STAFF);
      const edited = await run("updateContainerLine", {
        lineId: dropped.lineId,
        line: {...barrels(2), photoPaths: [copied, own, more],
          contents: [{label: "Tablet"}], weightLb: 3.5,
          declaredValueCents: 40000}}, P_STAFF);
      assert.deepEqual(edited.changed,
          ["photoPaths", "contents", "weightLb", "declaredValueCents"]);
      const line = await lineOf(dropped.lineId);
      assert.deepEqual(line.photoPaths, [copied, own, more]);
      assert.deepEqual(line.contents,
          [{label: "Tablet", quantity: 1, serial: ""}]);
      assert.equal(line.weightLb, 3.5);
      assert.equal(line.declaredValueCents, 40000);
      // The server's copy may stay, but a new path in the server's folder
      // is not the caller's to add; nor is the owner's upload.
      await assert.rejects(run("updateContainerLine", {
        lineId: dropped.lineId,
        line: {...barrels(2), photoPaths: [copied,
          await photo(P_STAFF, {folder: "req"})]}}, P_STAFF),
      refused("photo_invalid"));
      await assert.rejects(run("updateContainerLine", {
        lineId: dropped.lineId,
        line: {...barrels(2), photoPaths: [await photo(P_OWNER)]}},
      P_STAFF), refused("photo_invalid"));
      // An edit that says nothing about them keeps them.
      await run("updateContainerLine", {lineId: dropped.lineId,
        line: barrels(3)}, P_STAFF);
      assert.deepEqual((await lineOf(dropped.lineId)).photoPaths,
          [copied, own, more]);
      const history = await audits(dropped.lineId, "line_edited");
      assert.ok(history.some((s) => /photos, contents, weight, declared value/
          .test(s)), history.join(" | "));
    });
  });

  describe("the pickup code", () => {
    it("is minted on every new line, parts included, when switched on",
        async () => {
          await switches({pickupCode: true});
          const dropped = await run("addWaitingPackage", barrels(3));
          const line = await lineOf(dropped.lineId);
          assert.match(line.pickupCode, /^\d{4}$/);
          assert.notEqual(line.pickupCode, "0000");
          const {containerId} = await run("createContainer",
              {label: "Code box", ...GUINEA});
          const added = await run("addContainerLine", {containerId,
            line: barrels(1)});
          assert.match((await lineOf(added.lineId)).pickupCode, /^\d{4}$/);
          // Two of the three go on; the part that stays gets its own code.
          const split = await run("assignContainerLines", {containerId,
            lineIds: [dropped.lineId], pieceCounts: {[dropped.lineId]: 2}});
          const part = await lineOf(split.parts[0].partLineId);
          assert.match(part.pickupCode, /^\d{4}$/);
          await switches({});
          const plain = await run("addWaitingPackage", barrels(1));
          assert.equal((await lineOf(plain.lineId)).pickupCode, undefined);
        });
  });

  describe("handover with the code", () => {
    it("delivers on the code, refuses a wrong one, takes the override",
        async () => {
          await switches({pickupCode: true});
          const {lineIds: [coded, other]} =
            await arrivedBox([barrels(1), barrels(1)]);
          const code = (await lineOf(coded)).pickupCode;
          await assert.rejects(deliver(coded), (error) =>
            error.code === "failed-precondition" &&
            error.details?.reason === "pickup_code_invalid");
          await assert.rejects(deliver(coded, {pickupCode: "0000"}),
              refused("pickup_code_invalid"));
          await assert.rejects(deliver(coded,
              {override: {collectedBy: "Ibrahima Sow"}}),
          refused("override_incomplete"));
          await assert.rejects(deliver(coded,
              {override: {collectedBy: "I", photoPath: await photo(P_AGENT)}}),
          refused("override_incomplete"));
          // The photo must be the agent's own upload.
          await assert.rejects(deliver(coded, {override: {
            collectedBy: "Ibrahima Sow", photoPath: await photo(P_OWNER)}}),
          refused("photo_invalid"));
          assert.equal((await lineOf(coded)).deliveredAt, undefined);
          const done = await deliver(coded, {pickupCode: ` ${code} `});
          assert.equal(done.delivered, true);
          assert.equal(done.deliveredWithoutCode, false);
          const line = await lineOf(coded);
          assert.equal(line.deliveredWithoutCode, false);
          assert.equal(line.deliveredPhotoPath, "");
          assert.equal(line.collectedBy, "Mariama Bah");
          // Without the code: who collected, and the agent's photo.
          const proof = await photo(P_AGENT);
          const overridden = await deliver(other, {override: {
            collectedBy: " Ibrahima Sow ", photoPath: proof}});
          assert.equal(overridden.deliveredWithoutCode, true);
          assert.equal(overridden.collectedBy, "Ibrahima Sow");
          const without = await lineOf(other);
          assert.equal(without.deliveredWithoutCode, true);
          assert.equal(without.deliveredPhotoPath, proof);
          assert.equal(without.collectedBy, "Ibrahima Sow");
          assert.deepEqual((await audits(without.containerId,
              "line_delivered")).sort(), [
            "Delivered 1 barrel for Fatou Diallo, collected by Ibrahima " +
              "Sow without a pickup code",
            "Delivered 1 barrel for Fatou Diallo, collected by Mariama Bah",
          ]);
          // Undo clears the override; the file stays.
          await run("updateContainerLine", {lineId: other,
            action: "undo_delivery"});
          const undone = await lineOf(other);
          assert.equal(undone.deliveredWithoutCode, undefined);
          assert.equal(undone.deliveredPhotoPath, undefined);
          assert.equal((await bucket.file(proof).exists())[0], true);
          // The switch off: no code asked, even of a line that has one.
          await switches({});
          assert.equal((await deliver(other)).delivered, true);
        });

    it("records the USD collected as a cash payment on the root",
        async () => {
          await switches({});
          const {lineIds: [lineId]} =
            await arrivedBox([priced([6000, 4000])]);
          await assert.rejects(deliver(lineId, {collectedCents: -1}),
              refused("collected_cents_invalid"));
          await assert.rejects(deliver(lineId, {collectedCents: 12.5}),
              refused("collected_cents_invalid"));
          await assert.rejects(deliver(lineId, {collectedCents: 10001}),
              refused("payment_exceeds_balance"));
          // Part of it: the rest still warns, then is acknowledged.
          await assert.rejects(deliver(lineId, {collectedCents: 4000}),
              (error) => error.details?.reason === "delivery_balance_due" &&
                error.details?.hasBalance === true &&
                error.details?.balanceCents === null);
          assert.deepEqual(await paymentsOf(lineId), []);
          const done = await deliver(lineId, {collectedCents: 4000,
            acknowledgeBalance: true});
          assert.equal(done.collectedCents, 4000);
          assert.ok(done.paymentId);
          assert.equal(done.hasBalance, true);
          const line = await lineOf(lineId);
          assert.equal(line.collectedAtDeliveryCents, 4000);
          assert.equal(line.paidCents, 4000);
          assert.equal(line.deliveredBalanceCents, 6000);
          const [payment] = await paymentsOf(lineId);
          assert.equal(payment.amountCents, 4000);
          assert.equal(payment.method, "cash");
          assert.equal(payment.note, "At pickup");
          assert.equal(payment.receivedByStaffId, P_AGENT);
          assert.equal(payment.recordedByStaffId, P_AGENT);
          assert.equal(payment.reverted, false);
          const history = await audits(line.containerId, "payment");
          assert.ok(history.some((s) =>
            s.startsWith("Received $40.00 (cash) by Guinea Agent")),
          history.join(" | "));
          // Undo keeps the money: the owner reverts it with the payment
          // callable.
          await run("updateContainerLine", {lineId, action: "undo_delivery"});
          const undone = await lineOf(lineId);
          assert.equal(undone.paidCents, 4000);
          assert.equal(undone.collectedAtDeliveryCents, 4000);
          assert.equal((await paymentsOf(lineId)).length, 1);
          // Delivered again, the rest collected: paid in full, no warning.
          const again = await deliver(lineId, {collectedCents: 6000});
          assert.equal(again.hasBalance, false);
          assert.equal((await lineOf(lineId)).paidCents, 10000);
          assert.equal((await paymentsOf(lineId)).length, 2);
          // A part of a split package pays on its root.
          const dropped = await run("addWaitingPackage",
              priced([2500, 2500]));
          const {containerId} = await run("createContainer",
              {label: "Split box", ...GUINEA});
          const split = await run("assignContainerLines", {containerId,
            lineIds: [dropped.lineId], pieceCounts: {[dropped.lineId]: 1}});
          await run("setContainerStatus", {containerId, status: "shipped"});
          await run("setContainerStatus", {containerId, status: "arrived"});
          await deliver(dropped.lineId, {collectedCents: 2500,
            acknowledgeBalance: true});
          assert.equal((await lineOf(dropped.lineId)).paidCents, 2500);
          assert.equal((await paymentsOf(dropped.lineId)).length, 1);
          assert.equal((await paymentsOf(split.parts[0].partLineId)).length,
              0);
          // Nothing collected: no payment, nothing on the line.
          const {lineIds: [free]} = await arrivedBox([barrels(1)]);
          await deliver(free, {collectedCents: 0});
          assert.equal((await lineOf(free)).collectedAtDeliveryCents,
              undefined);
          assert.deepEqual(await paymentsOf(free), []);
        });
  });

  describe("the loading warning", () => {
    const problem = {senderConfirmation: {status: "problem",
      answeredAtMs: Date.now()}};
    it("warns about a sender's problem until acknowledged, by list and by " +
        "scan", async () => {
      await switches({});
      const flagged = await run("addWaitingPackage", barrels(1));
      const fine = await run("addWaitingPackage", barrels(1));
      await db.collection("containerLines").doc(flagged.lineId)
          .update(problem);
      const {containerId} = await run("createContainer",
          {label: "Warn box", ...GUINEA});
      await assert.rejects(run("assignContainerLines", {containerId,
        lineIds: [flagged.lineId, fine.lineId]}), (error) =>
        error.code === "failed-precondition" &&
        error.details?.reason === "sender_problem" &&
        JSON.stringify(error.details?.warnings) === JSON.stringify(
            [{lineId: flagged.lineId, reason: "sender_problem"}]) &&
        JSON.stringify(error.details?.lineIds) ===
          JSON.stringify([flagged.lineId]));
      assert.equal((await lineOf(flagged.lineId)).containerId, "");
      const placed = await run("assignContainerLines", {containerId,
        lineIds: [flagged.lineId, fine.lineId], acknowledgeProblems: true});
      assert.equal(placed.assigned, 2);
      assert.deepEqual(placed.warnings,
          [{lineId: flagged.lineId, reason: "sender_problem"}]);
      // No problem: no warnings key at all.
      const clean = await run("assignContainerLines", {containerId,
        lineIds: [(await run("addWaitingPackage", barrels(1))).lineId]});
      assert.equal("warnings" in clean, false);
      // By scan, the same.
      const scanned = await run("addWaitingPackage", barrels(2));
      await db.collection("containerLines").doc(scanned.lineId)
          .update(problem);
      let scans = 0;
      const scan = (extra = {}) => run("assignContainerLines", {containerId,
        action: "scan", code: scanned.trackingCode,
        scanId: `proof-scan-${String(++scans).padStart(4, "0")}`, ...extra});
      await assert.rejects(scan(), refused("sender_problem"));
      const loaded = await scan({acknowledgeProblems: true});
      assert.equal(loaded.result, "loaded");
      assert.deepEqual(loaded.warnings,
          [{lineId: scanned.lineId, reason: "sender_problem"}]);
      // Counting one more piece of it warns no more.
      const counted = await scan();
      assert.equal(counted.result, "counted");
      assert.equal("warnings" in counted, false);
    });
  });

  describe("the photo link", () => {
    const proof = require("../package_proof");
    // Enough of an Express response for the onRequest wrapper and the
    // handler (as test/whatsapp-conversations.test.js fakes it).
    function fakeRes() {
      const res = {statusCode: 0, body: "", headers: {}, headersSent: false,
        on: () => res, once: () => res, emit: () => true};
      res.set = (k, v) => {
        res.headers[k.toLowerCase()] = v;
        return res;
      };
      res.setHeader = res.set;
      res.getHeader = (k) => res.headers[k.toLowerCase()];
      res.status = (code) => {
        res.statusCode = code;
        return res;
      };
      res.send = (value) => {
        res.body = value;
        res.headersSent = true;
        return res;
      };
      res.end = (value) => {
        if (value !== undefined) res.body = value;
        res.headersSent = true;
        return res;
      };
      return res;
    }
    async function open(link) {
      const query = Object.fromEntries(new URL(link, "https://x.test")
          .searchParams.entries());
      const res = fakeRes();
      await functions.parkingDocument({method: "GET", query, headers: {},
        url: "/d", body: {}, rawBody: Buffer.from(""),
        on: () => {}, once: () => {},
        get: () => "", header: () => ""}, res);
      return res;
    }
    it("serves a line's own photo on a signed, unexpired link; 404 " +
        "otherwise", async () => {
      await switches({});
      const own = await photo(P_STAFF);
      const dropped = await run("addWaitingPackage",
          barrels(1, {photoPaths: [own]}), P_STAFF);
      const token = crypto.randomBytes(24).toString("base64url");
      const handover = await photo(P_AGENT);
      await db.collection("containerLines").doc(dropped.lineId).update({
        documentToken: token, deliveredPhotoPath: handover,
        customerPhotos: [{path: await photo(P_STAFF, {folder: "wa"}),
          phone: "+224620000000", atMs: Date.now(), caseId: "c1"}]});
      const line = await lineOf(dropped.lineId);
      const link = (path, expiresMs = Date.now() + proof.PHOTO_LINK_MS) =>
        proof.photoLink({base: "/d", token, path, expiresMs});
      for (const path of [own, handover, line.customerPhotos[0].path]) {
        const res = await open(link(path));
        assert.equal(res.statusCode, 200, path);
        assert.equal(res.headers["content-type"], "image/jpeg");
        assert.equal(res.headers["cache-control"], "private, max-age=3600");
        assert.equal(Buffer.isBuffer(res.body), true);
        assert.equal(res.body.length, 2048);
      }
      // Expired, a tampered path, a bad signature, a path the line does
      // not carry, another line's token.
      assert.equal((await open(link(own, Date.now() - 1000))).statusCode,
          404);
      assert.equal((await open(link(own).replace(encodeURIComponent(own),
          encodeURIComponent(await photo(P_STAFF))))).statusCode, 404);
      assert.equal((await open(link(own).replace(/&s=[0-9a-f]+/,
          "&s=000000000000000000000000"))).statusCode, 404);
      assert.equal((await open(link(await photo(P_STAFF)))).statusCode, 404);
      const other = crypto.randomBytes(24).toString("base64url");
      assert.equal((await open(proof.photoLink({base: "/d", token: other,
        path: own, expiresMs: Date.now() + 1000}))).statusCode, 404);
    });
  });

  describe("the 12-month sweep", () => {
    it("deletes the files of lines delivered a year ago and keeps the " +
        "record", async () => {
      await switches({});
      const year = 366 * 24 * 60 * 60 * 1000;
      const old = await photo(P_STAFF);
      const customer = await photo(P_STAFF, {folder: "wa"});
      const handover = await photo(P_AGENT);
      const recent = await photo(P_STAFF);
      const aged = await run("addWaitingPackage", barrels(1, {
        photoPaths: [old], contents: [{label: "Phones", quantity: 2,
          serial: "IMEI-9"}]}), P_STAFF);
      const fresh = await run("addWaitingPackage",
          barrels(1, {photoPaths: [recent]}), P_STAFF);
      const bare = await run("addWaitingPackage", barrels(1), P_STAFF);
      const ago = admin.firestore.Timestamp.fromMillis(Date.now() - year);
      await db.collection("containerLines").doc(aged.lineId).update({
        deliveredAt: ago, deliveredPhotoPath: handover,
        customerPhotos: [{path: customer, phone: "+224620000000",
          atMs: Date.now() - year, caseId: "c1"}]});
      await db.collection("containerLines").doc(bare.lineId).update({
        deliveredAt: ago});
      await db.collection("containerLines").doc(fresh.lineId).update({
        deliveredAt: admin.firestore.Timestamp.fromMillis(
            Date.now() - year / 2)});
      await functions.sweepPackageRequests.run({});
      const swept = await lineOf(aged.lineId);
      assert.deepEqual(swept.photoPaths, []);
      assert.equal(swept.deliveredPhotoPath, "");
      assert.equal(swept.customerPhotos[0].path, "");
      assert.equal(swept.customerPhotos[0].phone, "+224620000000");
      assert.ok(swept.photosDeletedAtMs > 0);
      assert.deepEqual(swept.contents,
          [{label: "Phones", quantity: 2, serial: "IMEI-9"}]);
      assert.ok(swept.deliveredAt);
      for (const path of [old, customer, handover]) {
        assert.equal((await bucket.file(path).exists())[0], false, path);
      }
      // A line with nothing to delete is passed over; a recent one waits.
      assert.equal((await lineOf(bare.lineId)).photosDeletedAtMs, undefined);
      const kept = await lineOf(fresh.lineId);
      assert.deepEqual(kept.photoPaths, [recent]);
      assert.equal(kept.photosDeletedAtMs, undefined);
      assert.equal((await bucket.file(recent).exists())[0], true);
      // The cursor moved past what was visited: a second run re-reads
      // nothing and deletes nothing more.
      const cursor = (await db.collection("platformConfig")
          .doc("packagePhotoSweep").get()).data();
      assert.ok(cursor.afterDeliveredAt);
      await functions.sweepPackageRequests.run({});
      assert.equal((await lineOf(aged.lineId)).photosDeletedAtMs,
          swept.photosDeletedAtMs);
    });
  });
});

// "Ships by: Sea · Air" (docs/AIR_PACKAGES.md §7): a waiting package says
// how it ships; it rides only a container of the same mode; a line added
// straight onto a container takes the container's; the business is marked
// `shipsByAir` the first time it starts a flight. Its own business, so the
// flag starts unset.
describe("ships by: sea or air", () => {
  const S_BIZ = "shipmode-test-biz";
  const S_OWNER = "shipmode-test-owner";
  const bizRef = db.collection("businesses").doc(S_BIZ);
  before(async () => {
    await Promise.all([
      bizRef.set({name: "Mode Shipping", status: "approved",
        ownerUid: S_OWNER}),
      db.collection("users").doc(S_OWNER).set({
        role: "businessOwner", businessId: S_BIZ, fullName: "Mode Owner",
      }),
    ]);
  });
  const run = (name, data) =>
    functions[name].run({auth: {uid: S_OWNER, token: {}},
      data: {businessId: S_BIZ, ...data}});
  const GUINEA = {destinationCountryId: "gn",
    destinationCountryName: "Guinea"};
  const pkg = (extra = {}) => ({ownerKind: "customer",
    customerName: "Fatou Diallo", customerPhone: "+16465550100",
    receiverName: "Mariama Bah", receiverPhone: "+224620000000", ...GUINEA,
    pieces: [{kind: "barrel"}], ...extra});
  const lineOf = async (id) =>
    (await db.collection("containerLines").doc(id).get()).data();
  let serial = 0;
  const box = async (extra = {}) => (await run("createContainer", {
    label: `Mode box ${++serial}`, ...GUINEA, ...extra})).containerId;
  const mismatch = (shipMode, lineIds) => (error) =>
    error.code === "failed-precondition" &&
    error.details?.reason === "ship_mode_mismatch" &&
    error.details?.shipMode === shipMode &&
    (!lineIds || JSON.stringify(error.details?.lineIds) ===
      JSON.stringify(lineIds)) &&
    error.message === (shipMode === "air" ?
      CONTAINER_MESSAGES.ship_mode_mismatch_air :
      CONTAINER_MESSAGES.ship_mode_mismatch);
  let scans = 0;
  const scan = (containerId, code) => run("assignContainerLines", {
    containerId, action: "scan", code,
    scanId: `mode-scan-${String(++scans).padStart(4, "0")}`});

  it("marks the business on its first flight, never on a sea box",
      async () => {
        await box();
        assert.equal((await bizRef.get()).data().shipsByAir, undefined);
        const sea = await box();
        await run("updateContainer", {containerId: sea,
          changes: {notes: "still sea"}});
        assert.equal((await bizRef.get()).data().shipsByAir, undefined);
        // Turning a loading box into a flight marks it too.
        await run("updateContainer", {containerId: sea,
          changes: {shipMode: "air", airWaybill: "176-10000001"}});
        assert.equal((await bizRef.get()).data().shipsByAir, true);
        // Back to sea: the flag stays.
        await run("updateContainer", {containerId: sea,
          changes: {shipMode: "sea"}});
        assert.equal((await bizRef.get()).data().shipsByAir, true);
        await bizRef.update({shipsByAir: admin.firestore.FieldValue.delete()});
        await box({shipMode: "air", airWaybill: "176-10000002"});
        assert.equal((await bizRef.get()).data().shipsByAir, true);
      });

  it("is sea by default and air when chosen, on a waiting package",
      async () => {
        const sea = await run("addWaitingPackage", pkg());
        assert.equal((await lineOf(sea.lineId)).shipMode, "sea");
        const air = await run("addWaitingPackage", pkg({shipMode: "air"}));
        assert.equal((await lineOf(air.lineId)).shipMode, "air");
        await assert.rejects(run("addWaitingPackage",
            pkg({shipMode: "rail"})), (error) =>
          error.details?.reasons?.includes("ship_mode_invalid"));
      });

  it("gives a line added onto a container the container's mode",
      async () => {
        const flight = await box({shipMode: "air"});
        const sea = await box();
        const onFlight = await run("addContainerLine", {containerId: flight,
          line: pkg({shipMode: "sea"})});
        assert.equal((await lineOf(onFlight.lineId)).shipMode, "air");
        const onSea = await run("addContainerLine", {containerId: sea,
          line: pkg({shipMode: "air"})});
        assert.equal((await lineOf(onSea.lineId)).shipMode, "sea");
      });

  it("refuses the wrong mode from the list, both ways, all or none",
      async () => {
        const flight = await box({shipMode: "air"});
        const sea = await box();
        const s1 = (await run("addWaitingPackage", pkg())).lineId;
        const a1 = (await run("addWaitingPackage",
            pkg({shipMode: "air"}))).lineId;
        await assert.rejects(run("assignContainerLines",
            {containerId: flight, lineIds: [a1, s1]}), mismatch("sea", [s1]));
        await assert.rejects(run("assignContainerLines",
            {containerId: sea, lineIds: [s1, a1]}), mismatch("air", [a1]));
        // Nothing went on.
        assert.equal((await lineOf(a1)).containerId, "");
        assert.equal((await lineOf(s1)).containerId, "");
        await run("assignContainerLines", {containerId: flight,
          lineIds: [a1]});
        await run("assignContainerLines", {containerId: sea, lineIds: [s1]});
        assert.equal((await lineOf(a1)).containerId, flight);
        assert.equal((await lineOf(s1)).containerId, sea);
        // Nor moved across.
        await assert.rejects(run("moveContainerLine",
            {lineId: a1, toContainerId: sea}), mismatch("air", [a1]));
        await assert.rejects(run("moveContainerLine",
            {lineId: s1, toContainerId: flight}), mismatch("sea", [s1]));
        // Flight to flight moves.
        const flight2 = await box({shipMode: "air"});
        await run("moveContainerLine", {lineId: a1, toContainerId: flight2});
        assert.equal((await lineOf(a1)).containerId, flight2);
      });

  it("refuses the wrong mode by scan, both ways", async () => {
    const flight = await box({shipMode: "air"});
    const sea = await box();
    const s1 = await run("addWaitingPackage", pkg());
    const a1 = await run("addWaitingPackage", pkg({shipMode: "air"}));
    await assert.rejects(scan(flight, s1.trackingCode),
        mismatch("sea", [s1.lineId]));
    await assert.rejects(scan(sea, a1.trackingCode),
        mismatch("air", [a1.lineId]));
    await scan(flight, a1.trackingCode);
    await scan(sea, s1.trackingCode);
    assert.equal((await lineOf(a1.lineId)).containerId, flight);
    assert.equal((await lineOf(s1.lineId)).containerId, sea);
  });

  it("changes Ships by while waiting, never once on a container",
      async () => {
        const {lineId} = await run("addWaitingPackage", pkg());
        const edited = await run("updateContainerLine",
            {lineId, line: {...pkg(), shipMode: "air"}});
        assert.deepEqual(edited.changed, ["shipMode"]);
        assert.equal((await lineOf(lineId)).shipMode, "air");
        const flight = await box({shipMode: "air"});
        await run("assignContainerLines", {containerId: flight,
          lineIds: [lineId]});
        await assert.rejects(run("updateContainerLine",
            {lineId, line: {...pkg(), shipMode: "sea"}}), (error) =>
          error.code === "failed-precondition" &&
            error.details?.reason === "ship_mode_locked");
        assert.equal((await lineOf(lineId)).shipMode, "air");
        // An edit that leaves it out is fine.
        await run("updateContainerLine",
            {lineId, line: {...pkg(), receiverName: "Aissatou Bah"}});
        // Back on the waiting list it keeps the flight's mode.
        await run("unassignContainerLine", {lineId});
        assert.equal((await lineOf(lineId)).shipMode, "air");
      });

  it("carries a loading box's lines along when its mode changes",
      async () => {
        const containerId = await box();
        const {lineId} = await run("addContainerLine",
            {containerId, line: pkg()});
        await run("updateContainer", {containerId,
          changes: {shipMode: "air", airWaybill: "176-10000003"}});
        assert.equal((await lineOf(lineId)).shipMode, "air");
      });
});
