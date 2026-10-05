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
