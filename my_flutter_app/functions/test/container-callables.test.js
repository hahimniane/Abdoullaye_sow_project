"use strict";

const assert = require("node:assert/strict");
const {afterEach, before, describe, it} = require("node:test");
const admin = require("firebase-admin");

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

// node:test runs the suites above when this file is executed directly.
