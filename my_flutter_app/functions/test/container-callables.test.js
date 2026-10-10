"use strict";

const assert = require("node:assert/strict");
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
const db = admin.firestore();

const BIZ = "container-test-biz";
const OWNER = "container-test-owner";
const NO_CONTAINERS = "container-test-ledger-only";
const VIN = "1HGCM82633A004352";

const call = (name, data, uid = OWNER) =>
  functions[name].run({auth: {uid, token: {}}, data: {businessId: BIZ,
    ...data}});

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
    await assert.rejects(
        call("updateContainerLineContacts", {lineId,
          contacts: {customerName: " "}}),
        (error) => error.code === "invalid-argument" &&
          error.details?.reasons?.includes("customer_name_required"));
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
            "container_status_update");
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

    it("tells nobody: no moment on any timeline, no WhatsApp row", async () => {
      const before = await updatesOf();
      connectWhatsApp();
      fakeWhatsApp(OK);
      const box = await newContainer();
      const {lineId} = await call("addWaitingPackage", waitingPackage());
      await call("assignContainerLines", {containerId: box,
        lineIds: [lineId]});
      await recordMoments(box);
      assert.equal(await eventsOf(box), 0);
      assert.equal(await updatesOf(), before);
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
              /abort|contention/i);
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
          await call("recordContainerLinePayment", {lineId,
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
          await call("recordContainerLinePayment", {lineId,
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
      await call("recordContainerLinePayment", {lineId, amountCents: 6000,
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
      const first = await call("recordContainerLinePayment", {lineId,
        amountCents: 5000, method: "cash", note: "at the counter"});
      assert.equal(first.paidCents, 5000);
      const second = await call("recordContainerLinePayment", {lineId,
        amountCents: 10000, method: "zelle"});
      assert.equal(second.paidCents, 15000);
      const rows = await payments(lineId);
      assert.equal(rows.length, 2);
      const row = rows.find((r) => r.id === first.paymentId);
      assert.equal(row.businessId, BIZ);
      assert.equal(row.amountCents, 5000);
      assert.equal(row.method, "cash");
      assert.equal(row.note, "at the counter");
      assert.equal(row.receivedByStaffId, OWNER);
      assert.equal(row.reverted, false);
      assert.ok(row.createdAt);
      assert.equal((await lineRef(lineId).get()).get("paidCents"), 15000);
      assert.equal((await audits(lineId, "payment")).length, 2);
      const full = (await audits(lineId, "payment"))
          .map((e) => e.summary).filter((t) => /paid in full/.test(t));
      assert.equal(full.length, 1);
    });

    it("refuses an overpayment, no price, and a bad payment", async () => {
      const unpriced = await call("addWaitingPackage", waitingPackage());
      await assert.rejects(call("recordContainerLinePayment",
          {lineId: unpriced.lineId, amountCents: 100, method: "cash"}),
      (error) => error.details?.reasons?.includes("price_required"));
      const {lineId} = await call("addWaitingPackage",
          waitingPackage({priceCents: 10000}));
      await call("recordContainerLinePayment", {lineId, amountCents: 7000,
        method: "cash"});
      await assert.rejects(call("recordContainerLinePayment",
          {lineId, amountCents: 3001, method: "cash"}),
      (error) => error.code === "invalid-argument" &&
          error.details?.reasons?.includes("payment_exceeds_balance"));
      await assert.rejects(call("recordContainerLinePayment",
          {lineId, amountCents: 0, method: "barter"}),
      (error) => error.details?.reasons?.includes("amount_required") &&
          error.details?.reasons?.includes("payment_method_invalid"));
      await assert.rejects(call("recordContainerLinePayment",
          {lineId, amountCents: 100, method: "cash"}, NO_CONTAINERS),
      (error) => error.code === "permission-denied");
      assert.equal((await lineRef(lineId).get()).get("paidCents"), 7000);
      assert.equal((await payments(lineId)).length, 1);
    });

    it("never overpays when two are recorded at once", async () => {
      const {lineId} = await call("addWaitingPackage",
          waitingPackage({priceCents: 10000}));
      const results = await Promise.allSettled([1, 2, 3, 4].map(() =>
        call("recordContainerLinePayment",
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
      const a = await call("recordContainerLinePayment", {lineId,
        amountCents: 4000, method: "cash"});
      await call("recordContainerLinePayment", {lineId, amountCents: 3000,
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
      assert.equal(row.receivedByStaffId, OWNER);
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
      await call("recordContainerLinePayment", {lineId, amountCents: 7000,
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
          const result = await call("recordContainerLinePayment",
              {lineId, amountCents: 10000, method: "cash"});
          assert.equal(result.paidCents, 10000);
          assert.equal((await audits(box, "payment")).length, 1);
          assert.equal((await audits(lineId, "payment")).length, 1);
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
  });
});

// node:test runs the suites above when this file is executed directly.

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

