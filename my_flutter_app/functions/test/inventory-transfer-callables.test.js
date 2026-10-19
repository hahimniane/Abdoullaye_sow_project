"use strict";

const assert = require("node:assert/strict");
const {before, describe, it} = require("node:test");
const admin = require("firebase-admin");

// Store transfers (docs/INVENTORY.md "Store transfers (v5)"), run against the
// Firestore emulator: what inventory-transfers.test.js pins as pure rules -
// that a retried Send sends once, that two receivers or a cancel racing a
// receipt end with one winner, that a product's total stays the sum of its
// stores' counts while pieces are on their way - exercised through real
// transactions.
//
// Writes with ADMIN credentials, so it refuses to run outside the emulator.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
      "Run this through `npm run test:transfers` (firebase emulators:exec). " +
      "A direct node --test run would write its fixtures into the " +
      "real project.");
}

process.env.FUNCTIONS_EMULATOR = "true";

const functions = require("../index");
const db = admin.firestore();

const TB = "trf-biz";
const OFF = "trf-biz-off";
const OWN = "trf-owner";
const BRONX = "trf-bronx-clerk";
const HARLEM = "trf-harlem-clerk";
const HARLEM_FR = "trf-harlem-clerk-fr";
const ROVER = "trf-all-stores";
const NOHOME = "trf-no-home";
const LEDGER = "trf-ledger-only";
const MUTED = "trf-harlem-muted";
const OFF_OWNER = "trf-off-owner";
const MAIN = `${TB}_main`;

const call = (name, data, uid = OWN, biz = TB) => functions[name].run({
  auth: {uid, token: {}}, data: {businessId: biz, ...data}});

let keys = 0;
const key = () => `trf-${Date.now()}-${++keys}`;

const refusal = (code, kind) => (error) => {
  assert.equal(error.details?.reason, code, error.message);
  if (kind) assert.equal(error.code, kind);
  return true;
};

// Emulator lock arbitration (see inventory-callables.test.js): a raw ABORTED
// or "Transaction is invalid or closed" is retried, never a refusal.
const isEmulatorContention = (error) => !error?.details?.reason &&
  (error?.code === 10 || (error?.code === 3 &&
    /transaction is invalid or closed/i.test(String(error.message))));
async function untilSettled(run, attempts = 8) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= attempts || !isEmulatorContention(error)) throw error;
    }
  }
}
const outcomeOf = (run) => untilSettled(run).then(() => "ok", (error) =>
  error.details?.reason || `${error.code}: ${error.message}`);

const item = async (id) => (await db.collection("inventoryItems").doc(id)
    .get()).data();
const stockAt = async (itemId, storeId) => {
  const doc = await db.collection("inventoryStock")
      .doc(`${itemId}__${storeId}`).get();
  return doc.exists ? doc.data().quantity : null;
};
const sumRows = async (itemId) => (await db.collection("inventoryStock")
    .where("businessId", "==", TB).where("itemId", "==", itemId).get())
    .docs.reduce((n, d) => n + d.data().quantity, 0);
// The product's total is always the sum of its stores' counts: pieces in
// transit or disputed are in neither.
const assertInvariant = async (itemId) => {
  assert.equal((await item(itemId)).quantity, await sumRows(itemId),
      `total = sum of rows for ${itemId}`);
};
const transferOf = async (id) => (await db.collection("inventoryTransfers")
    .doc(id).get()).data();
const movesOf = async (transferId) => (await db.collection(
    "inventoryMovements").where("businessId", "==", TB)
    .where("transferId", "==", transferId).get()).docs.map((d) => d.data());
const pushesOf = async (transferId) => (await db.collection(
    "notificationDeliveries").where("data.transferId", "==", transferId)
    .get()).docs.map((d) => d.data());
const historyOf = async (transferId) => (await db.collection("lotLedgerAudit")
    .where("businessId", "==", TB).where("entityId", "==", transferId).get())
    .docs.map((d) => d.data());

let bronx;
let harlem;
let shoes;
let hoodie;

/**
 * A product with `bronxCount` pieces in the Bronx store.
 *
 * @param {number} bronxCount Pieces at Bronx.
 * @param {object} extra More product fields.
 * @return {Promise<string>} Its id.
 */
async function product(bronxCount, extra = {}) {
  const made = await call("createInventoryItem", {name: `Shoe ${++keys}`,
    priceCents: 5000, costCents: 2000, stock: {[bronx]: bronxCount},
    ...extra});
  return made.itemId;
}

const send = (lines, extra = {}, uid = BRONX) => call(
    "sendInventoryTransfer", {clientRequestId: key(), fromStoreId: bronx,
      toStoreId: harlem, lines, ...extra}, uid);

before(async () => {
  const clerk = {role: "staff", businessId: TB,
    businessPermissions: ["inventory"]};
  await Promise.all([
    db.collection("businesses").doc(TB).set({name: "AMT Multi Services",
      status: "approved", enabledServices: ["inventory"], ownerUid: OWN}),
    db.collection("businesses").doc(OFF).set({name: "Off", status: "approved",
      enabledServices: ["freight"]}),
    db.collection("users").doc(OWN).set({role: "businessOwner",
      businessId: TB, fullName: "Dala Owner", email: "own@example.test"}),
    db.collection("users").doc(BRONX).set({...clerk,
      fullName: "Ibrahima Sow"}),
    db.collection("users").doc(HARLEM).set({...clerk,
      fullName: "Aminata Ba"}),
    db.collection("users").doc(HARLEM_FR).set({...clerk,
      fullName: "Awa Diop", preferredLanguage: "fr"}),
    db.collection("users").doc(ROVER).set({...clerk, fullName: "Rover"}),
    db.collection("users").doc(NOHOME).set({...clerk, fullName: "No Home"}),
    db.collection("users").doc(MUTED).set({...clerk, fullName: "Muted",
      notificationPreferences: {inventoryTransfers: false}}),
    db.collection("users").doc(LEDGER).set({role: "staff", businessId: TB,
      businessPermissions: ["ledger"]}),
    db.collection("users").doc(OFF_OWNER).set({role: "businessOwner",
      businessId: OFF}),
  ]);
  bronx = (await call("createInventoryStore", {name: "Bronx store"})).storeId;
  harlem = (await call("createInventoryStore", {name: "Harlem store"}))
      .storeId;
  for (const [userId, homeStoreId, allStores] of [[BRONX, bronx, false],
    [HARLEM, harlem, false], [HARLEM_FR, harlem, false], [MUTED, harlem, false],
    [ROVER, "", true], [NOHOME, "", false]]) {
    await call("setInventoryStaffAccess", {userId, homeStoreId, allStores});
  }
  shoes = await product(8, {name: "11", brand: "Jordan"});
  hoodie = await product(3, {name: "Tech hoodie", costCents: null});
});

describe("transfers: the gate", () => {
  it("is closed while the service is off and to staff without it",
      async () => {
        const calls = [
          ["saveInventoryTransferDraft", {clientRequestId: key()}],
          ["sendInventoryTransfer", {clientRequestId: key()}],
          ["cancelInventoryTransfer", {transferId: "x"}],
          ["receiveInventoryTransfer", {transferId: "x"}],
          ["resolveInventoryTransferLine", {transferId: "x", itemId: "y",
            action: "return"}],
        ];
        for (const [name, data] of calls) {
          await assert.rejects(call(name, data, OFF_OWNER, OFF),
              refusal("service_disabled", "failed-precondition"), name);
          await assert.rejects(call(name, data, LEDGER),
              (error) => error.code === "permission-denied", name);
        }
      });

  it("answers an unknown transfer as not found", async () => {
    for (const name of ["cancelInventoryTransfer",
      "receiveInventoryTransfer"]) {
      await assert.rejects(call(name, {transferId: "nope"}),
          refusal("transfer_not_found", "not-found"), name);
    }
    await assert.rejects(call("resolveInventoryTransferLine",
        {transferId: "nope", itemId: shoes, action: "return"}),
    refusal("transfer_not_found"));
  });
});

describe("transfers: drafts", () => {
  it("saves a draft that reserves nothing, and saves it again in place",
      async () => {
        const clientRequestId = key();
        const first = await call("saveInventoryTransferDraft", {
          clientRequestId, fromStoreId: bronx, toStoreId: harlem,
          lines: [{itemId: shoes, quantity: 2}]}, BRONX);
        assert.match(first.code, /^TR-[A-Z0-9]{6}$/);
        assert.equal(first.status, "draft");
        assert.equal(await stockAt(shoes, bronx), 8, "nothing reserved");
        // More than the store holds is fine in a draft (checked at Send).
        const again = await call("saveInventoryTransferDraft", {
          clientRequestId, fromStoreId: bronx, toStoreId: harlem,
          lines: [{itemId: shoes, quantity: 50},
            {itemId: hoodie, quantity: 1}]}, BRONX);
        assert.equal(again.transferId, first.transferId);
        assert.equal(again.code, first.code);
        const stored = await transferOf(first.transferId);
        assert.equal(stored.stage, "draft");
        assert.equal(stored.itemsCount, 51);
        assert.deepEqual(stored.itemIds, [shoes, hoodie]);
        assert.deepEqual(stored.timeline.map((e) => e.event),
            ["draft_created"]);
        assert.equal(stored.timeline[0].byName, "Ibrahima Sow");
        assert.equal(stored.clientRequestId, clientRequestId);
        assert.equal(stored.lines[0].brand, "Jordan");
        assert.equal(stored.lines[0].costCents, 2000);
        assert.equal(stored.lines[1].costCents, null);
      });

  it("refuses a store the caller does not work in", async () => {
    const draft = (uid, from = bronx) => call("saveInventoryTransferDraft", {
      clientRequestId: key(), fromStoreId: from, toStoreId: harlem,
      lines: [{itemId: shoes, quantity: 1}]}, uid);
    await assert.rejects(draft(HARLEM), refusal("store_not_allowed",
        "permission-denied"));
    await assert.rejects(draft(NOHOME), refusal("home_store_required"));
    await assert.rejects(draft(OWN, harlem), refusal("same_store"));
    await assert.rejects(draft(OWN, "nowhere"), refusal("store_not_found"));
    await draft(ROVER);
  });

  it("refuses another business's product, naming it", async () => {
    await assert.rejects(call("saveInventoryTransferDraft", {
      clientRequestId: key(), fromStoreId: bronx, toStoreId: harlem,
      lines: [{itemId: "someone-elses", quantity: 1}]}),
    (error) => {
      assert.equal(error.details.reason, "item_not_found");
      assert.deepEqual(error.details.itemIds, ["someone-elses"]);
      return true;
    });
  });

  it("discards a draft without touching stock, by its store only",
      async () => {
        const saved = await call("saveInventoryTransferDraft", {
          clientRequestId: key(), fromStoreId: bronx, toStoreId: harlem,
          lines: [{itemId: shoes, quantity: 1}]}, BRONX);
        await assert.rejects(call("cancelInventoryTransfer",
            {transferId: saved.transferId}, HARLEM),
        refusal("store_not_allowed"));
        const done = await call("cancelInventoryTransfer",
            {transferId: saved.transferId}, BRONX);
        assert.equal(done.itemsReturned, 0);
        const stored = await transferOf(saved.transferId);
        assert.deepEqual([stored.status, stored.stage], ["cancelled", "done"]);
        assert.deepEqual(stored.timeline.map((e) => e.event),
            ["draft_created", "draft_discarded"]);
        assert.equal(await stockAt(shoes, bronx), 8);
        assert.equal((await historyOf(saved.transferId))[0].action,
            "draft_discarded");
      });
});

describe("transfers: sending", () => {
  it("takes the stock out of the source store, once", async () => {
    const clientRequestId = key();
    const draft = await call("saveInventoryTransferDraft", {clientRequestId,
      fromStoreId: bronx, toStoreId: harlem,
      lines: [{itemId: shoes, quantity: 1}]}, BRONX);
    const beforeTotal = (await item(shoes)).quantity;
    const sent = await call("sendInventoryTransfer", {clientRequestId,
      fromStoreId: bronx, toStoreId: harlem,
      lines: [{itemId: shoes, quantity: 3}, {itemId: hoodie, quantity: 1}]},
    BRONX);
    assert.equal(sent.transferId, draft.transferId, "the draft is sent");
    assert.equal(sent.code, draft.code);
    assert.deepEqual([sent.status, sent.itemsCount, sent.productsCount,
      sent.replayed], ["in_transit", 4, 2, false]);
    assert.equal(await stockAt(shoes, bronx), 5);
    assert.equal(await stockAt(shoes, harlem), null, "not there yet");
    assert.equal((await item(shoes)).quantity, beforeTotal - 3);
    await assertInvariant(shoes);
    await assertInvariant(hoodie);
    const stored = await transferOf(sent.transferId);
    assert.deepEqual([stored.status, stored.stage, stored.sentByStaffId,
      stored.sentByName], ["in_transit", "in_transit", BRONX, "Ibrahima Sow"]);
    assert.deepEqual(stored.timeline.map((e) => e.event),
        ["draft_created", "sent"]);
    assert.equal(stored.valueCents, 6000);
    assert.equal(stored.linesWithoutCost, 1);
    const moves = await movesOf(sent.transferId);
    assert.deepEqual(moves.map((m) => [m.type, m.delta, m.storeId,
      m.counterpartStoreId, m.transferCode]).sort(), [
      ["transfer_sent", -1, bronx, harlem, sent.code],
      ["transfer_sent", -3, bronx, harlem, sent.code]].sort());
    // A retry (double tap, lost answer) is the same transfer.
    const replay = await call("sendInventoryTransfer", {clientRequestId,
      fromStoreId: bronx, toStoreId: harlem,
      lines: [{itemId: shoes, quantity: 3}, {itemId: hoodie, quantity: 1}]},
    BRONX);
    assert.equal(replay.replayed, true);
    assert.equal(replay.transferId, sent.transferId);
    assert.equal(await stockAt(shoes, bronx), 5, "not taken twice");
    assert.equal((await movesOf(sent.transferId)).length, 2);
    // The draft key cannot become a draft again.
    await assert.rejects(call("saveInventoryTransferDraft", {clientRequestId,
      fromStoreId: bronx, toStoreId: harlem,
      lines: [{itemId: shoes, quantity: 1}]}, BRONX),
    (error) => error.details.reason === "transfer_not_draft" &&
      error.details.status === "in_transit");
    // History and the push: the destination's team and the owner, never the
    // sender, never someone who switched it off.
    const history = await historyOf(sent.transferId);
    assert.equal(history.find((h) => h.action === "sent").summary,
        `Sent 4 items from Bronx store to Harlem store (${sent.code})`);
    const pushes = await pushesOf(sent.transferId);
    assert.deepEqual(pushes.map((p) => p.recipientUid).sort(),
        [OWN, HARLEM, HARLEM_FR].sort());
    assert.deepEqual([...new Set(pushes.map((p) => p.channel))], ["push"]);
    const byUid = Object.fromEntries(pushes.map((p) => [p.recipientUid, p]));
    assert.equal(byUid[HARLEM].title, "Bronx store sent you 4 items");
    assert.equal(byUid[HARLEM_FR].title,
        "Bronx store vous a envoyé 4 articles");
    assert.equal(byUid[OWN].title, "Bronx store sent 4 items to Harlem store");
    assert.equal(byUid[OWN].data.type, "inventory_transfer");
    assert.equal(byUid[OWN].data.kind, "sent");
  });

  it("refuses more than the store holds, an archived product, a foreign " +
      "store's staff", async () => {
    const id = await product(2);
    await assert.rejects(send([{itemId: id, quantity: 3}]), (error) => {
      assert.equal(error.details.reason, "insufficient_stock");
      assert.deepEqual(error.details.available, {[id]: 2});
      assert.deepEqual(error.details.itemIds, [id]);
      return true;
    });
    assert.equal(await stockAt(id, bronx), 2);
    await send([{itemId: id, quantity: 2}]);
    assert.equal(await stockAt(id, bronx), 0);
    const archived = await product(4);
    await call("archiveInventoryItem", {itemId: archived, archived: true});
    await assert.rejects(send([{itemId: archived, quantity: 1}]),
        refusal("item_archived", "failed-precondition"));
    await assert.rejects(send([{itemId: shoes, quantity: 1}], {}, HARLEM),
        refusal("store_not_allowed"));
  });

  it("sends from Main a product that never got its store rows", async () => {
    const legacy = db.collection("inventoryItems").doc();
    await legacy.set({businessId: TB, name: "Legacy", code: "IT-LEGACY",
      priceCents: 100, costCents: 50, quantity: 5, archived: false,
      countWasOff: false});
    const sent = await call("sendInventoryTransfer", {clientRequestId: key(),
      fromStoreId: MAIN, toStoreId: harlem,
      lines: [{itemId: legacy.id, quantity: 2}]});
    assert.equal(await stockAt(legacy.id, MAIN), 3);
    assert.equal((await item(legacy.id)).storeStock, true);
    // Sent straight away (no draft): the record starts at "sent".
    assert.deepEqual((await transferOf(sent.transferId)).timeline
        .map((e) => e.event), ["sent"]);
    await assertInvariant(legacy.id);
    await call("receiveInventoryTransfer", {transferId: sent.transferId});
    assert.equal(await stockAt(legacy.id, harlem), 2);
    await assertInvariant(legacy.id);
  });

  it("lets only one of two sends of the last pieces through", async () => {
    const id = await product(3);
    const outcomes = await Promise.all([
      outcomeOf(() => send([{itemId: id, quantity: 2}])),
      outcomeOf(() => send([{itemId: id, quantity: 2}], {}, OWN)),
    ]);
    assert.deepEqual(outcomes.sort(), ["insufficient_stock", "ok"]);
    assert.equal(await stockAt(id, bronx), 1);
    await assertInvariant(id);
  });

  it("never lets a sale and a send take the same pieces", async () => {
    const id = await product(1);
    const outcomes = await Promise.all([
      outcomeOf(() => send([{itemId: id, quantity: 1}])),
      outcomeOf(() => call("recordInventorySale", {clientRequestId: key(),
        paymentMethod: "cash", storeId: bronx,
        lines: [{itemId: id, quantity: 1, soldPriceCents: 5000}]}, BRONX)),
    ]);
    // The sale may go through on a count of 0 ("count was off" is allowed);
    // what can never happen is the send taking pieces that are not there.
    assert.ok(outcomes.includes("ok"), outcomes.join());
    assert.ok((await stockAt(id, bronx)) >= 0);
    await assertInvariant(id);
    const transfers = (await db.collection("inventoryTransfers")
        .where("businessId", "==", TB).where("itemIds", "array-contains", id)
        .get()).docs.map((d) => d.data());
    const sales = (await db.collection("inventorySales")
        .where("businessId", "==", TB).get()).docs.map((d) => d.data())
        .filter((s) => s.lines.some((l) => l.itemId === id));
    const deducted = sales.reduce((n, s) => n + s.lines
        .filter((l) => l.itemId === id)
        .reduce((m, l) => m + l.stockDeducted, 0), 0);
    assert.equal(transfers.length + deducted, 1, "one piece left once");
  });
});

describe("transfers: cancelling", () => {
  it("puts the pieces back where they came from", async () => {
    const id = await product(5);
    const sent = await send([{itemId: id, quantity: 4}]);
    await assert.rejects(call("cancelInventoryTransfer",
        {transferId: sent.transferId}, HARLEM),
    refusal("store_not_allowed", "permission-denied"));
    const requestId = key();
    const cancelled = await call("cancelInventoryTransfer",
        {transferId: sent.transferId, requestId}, BRONX);
    assert.deepEqual([cancelled.status, cancelled.itemsReturned,
      cancelled.replayed], ["cancelled", 4, false]);
    assert.equal(await stockAt(id, bronx), 5);
    await assertInvariant(id);
    const moves = await movesOf(sent.transferId);
    assert.deepEqual(moves.map((m) => m.type).sort(),
        ["transfer_cancelled", "transfer_sent"]);
    const stored = await transferOf(sent.transferId);
    assert.deepEqual([stored.status, stored.stage, stored.cancelledByName],
        ["cancelled", "done", "Ibrahima Sow"]);
    // The same request again is a replay; another one is refused.
    assert.equal((await call("cancelInventoryTransfer",
        {transferId: sent.transferId, requestId}, BRONX)).replayed, true);
    await assert.rejects(call("cancelInventoryTransfer",
        {transferId: sent.transferId}, OWN), (error) =>
      error.details.reason === "transfer_not_in_transit" &&
      error.details.status === "cancelled");
    assert.equal(await stockAt(id, bronx), 5, "returned once");
    const pushes = await pushesOf(sent.transferId);
    assert.ok(pushes.some((p) => p.data.kind === "cancelled" &&
      p.recipientUid === HARLEM &&
      p.title === "Bronx store cancelled a transfer"));
  });

  it("lets the owner or all-stores staff cancel someone else's", async () => {
    const id = await product(2);
    const sent = await send([{itemId: id, quantity: 1}]);
    await call("cancelInventoryTransfer", {transferId: sent.transferId},
        ROVER);
    assert.equal(await stockAt(id, bronx), 2);
  });
});

describe("transfers: receiving", () => {
  it("makes everything sellable at the destination when all arrived",
      async () => {
        const id = await product(6);
        const sent = await send([{itemId: id, quantity: 6}]);
        await assert.rejects(call("receiveInventoryTransfer",
            {transferId: sent.transferId}, BRONX),
        refusal("store_not_allowed"));
        const requestId = key();
        const got = await call("receiveInventoryTransfer",
            {transferId: sent.transferId, requestId}, HARLEM);
        assert.deepEqual([got.status, got.receivedCount, got.missingCount,
          got.replayed], ["received", 6, 0, false]);
        assert.equal(await stockAt(id, harlem), 6);
        assert.equal(await stockAt(id, bronx), 0);
        assert.equal((await item(id)).quantity, 6);
        await assertInvariant(id);
        const stored = await transferOf(sent.transferId);
        assert.deepEqual([stored.stage, stored.receivedByName,
          stored.receivedCount], ["done", "Aminata Ba", 6]);
        // Sellable there at once.
        await call("recordInventorySale", {clientRequestId: key(),
          paymentMethod: "cash",
          lines: [{itemId: id, quantity: 1, soldPriceCents: 5000}]}, HARLEM);
        assert.equal(await stockAt(id, harlem), 5);
        // Replay vs a second receipt.
        assert.equal((await call("receiveInventoryTransfer",
            {transferId: sent.transferId, requestId}, HARLEM)).replayed, true);
        await assert.rejects(call("receiveInventoryTransfer",
            {transferId: sent.transferId}, HARLEM_FR), (error) =>
          error.details.reason === "transfer_not_in_transit" &&
          error.details.status === "received");
        assert.equal(await stockAt(id, harlem), 5, "counted once");
        const history = await historyOf(sent.transferId);
        const received = history.find((h) => h.action === "received");
        assert.equal(received.summary,
            `Harlem store received all 6 items of ${sent.code}`);
        assert.equal(received.acknowledged, true);
        assert.ok(!(await pushesOf(sent.transferId))
            .some((p) => p.data.kind === "differences"));
      });

  it("holds what did not arrive and tells the owner", async () => {
    const a = await product(6);
    const b = await product(5);
    const sent = await send([{itemId: a, quantity: 6},
      {itemId: b, quantity: 5}]);
    await assert.rejects(call("receiveInventoryTransfer", {
      transferId: sent.transferId, lines: [{itemId: a,
        quantityReceived: 7}]}, HARLEM), (error) =>
      error.details.reason === "received_too_many" &&
      error.details.itemIds[0] === a);
    await assert.rejects(call("receiveInventoryTransfer", {
      transferId: sent.transferId, lines: [{itemId: shoes,
        quantityReceived: 1}]}, HARLEM), refusal("item_not_in_transfer"));
    await assert.rejects(call("receiveInventoryTransfer", {
      transferId: sent.transferId, note: "x".repeat(301)}, HARLEM),
    refusal("note_too_long"));
    const got = await call("receiveInventoryTransfer", {
      transferId: sent.transferId, note: "Box arrived opened",
      lines: [{itemId: a, quantityReceived: 4}]}, HARLEM);
    assert.deepEqual([got.status, got.receivedCount, got.missingCount],
        ["received_with_differences", 9, 2]);
    assert.equal(await stockAt(a, harlem), 4);
    assert.equal(await stockAt(b, harlem), 5);
    // The 2 missing are in no store and not in the total.
    assert.equal((await item(a)).quantity, 4);
    await assertInvariant(a);
    const stored = await transferOf(sent.transferId);
    assert.deepEqual([stored.stage, stored.openMissingCount,
      stored.receiveNote], ["review", 2, "Box arrived opened"]);
    assert.deepEqual(stored.timeline.slice(-1)[0].note, "Box arrived opened");
    const row = (await historyOf(sent.transferId))
        .find((h) => h.action === "received_with_differences");
    assert.equal(row.summary,
        `Harlem store received 9 of 11 items of ${sent.code}: 2 missing`);
    assert.equal(row.acknowledged, false, "it needs attention");
    const pushes = (await pushesOf(sent.transferId))
        .filter((p) => p.data.kind === "differences");
    assert.deepEqual(pushes.map((p) => p.recipientUid).sort(),
        [OWN, ROVER].sort());
    assert.equal(pushes[0].title, "2 items didn't arrive at Harlem store");
  });

  it("receives a product archived on the way", async () => {
    const id = await product(2);
    const sent = await send([{itemId: id, quantity: 2}]);
    await call("archiveInventoryItem", {itemId: id, archived: true});
    await call("receiveInventoryTransfer", {transferId: sent.transferId},
        HARLEM);
    assert.equal(await stockAt(id, harlem), 2);
  });

  it("lets one of two receivers win", async () => {
    const id = await product(3);
    const sent = await send([{itemId: id, quantity: 3}]);
    const outcomes = await Promise.all([HARLEM, HARLEM_FR].map((uid) =>
      outcomeOf(() => call("receiveInventoryTransfer",
          {transferId: sent.transferId}, uid))));
    assert.deepEqual(outcomes.sort(), ["ok", "transfer_not_in_transit"]);
    assert.equal(await stockAt(id, harlem), 3);
    await assertInvariant(id);
  });

  it("lets a cancel or a receipt win, never both", async () => {
    for (let round = 0; round < 3; round++) {
      const id = await product(4);
      const sent = await send([{itemId: id, quantity: 4}]);
      const [cancel, receive] = await Promise.all([
        outcomeOf(() => call("cancelInventoryTransfer",
            {transferId: sent.transferId}, BRONX)),
        outcomeOf(() => call("receiveInventoryTransfer",
            {transferId: sent.transferId}, HARLEM)),
      ]);
      assert.deepEqual([cancel, receive].sort(),
          ["ok", "transfer_not_in_transit"], `round ${round}`);
      const atBronx = await stockAt(id, bronx);
      const atHarlem = (await stockAt(id, harlem)) || 0;
      assert.equal(atBronx + atHarlem, 4, "the 4 pieces are in one place");
      assert.ok(atBronx === 4 || atHarlem === 4);
      await assertInvariant(id);
    }
  });
});

describe("transfers: owner review", () => {
  let transferId;
  let a;
  let b;
  let code;
  before(async () => {
    a = await product(6, {name: "11", brand: "Jordan"});
    b = await product(5);
    const sent = await send([{itemId: a, quantity: 6},
      {itemId: b, quantity: 5}]);
    transferId = sent.transferId;
    code = sent.code;
    await call("receiveInventoryTransfer", {transferId, lines: [
      {itemId: a, quantityReceived: 4}, {itemId: b, quantityReceived: 2}]},
    HARLEM);
  });

  it("is for the owner and all-stores staff, on missing lines only",
      async () => {
        await assert.rejects(call("resolveInventoryTransferLine", {transferId,
          itemId: a, action: "return"}, HARLEM), refusal("store_not_allowed"));
        await assert.rejects(call("resolveInventoryTransferLine", {transferId,
          itemId: a, action: "write_off"}),
        refusal("write_off_reason_invalid"));
        await assert.rejects(call("resolveInventoryTransferLine", {transferId,
          itemId: a, action: "keep"}), refusal("resolution_invalid"));
        await assert.rejects(call("resolveInventoryTransferLine", {transferId,
          itemId: shoes, action: "return"}), refusal("item_not_in_transfer"));
      });

  it("returns missing pieces to the source store", async () => {
    const before = await stockAt(a, bronx);
    const requestId = key();
    const done = await call("resolveInventoryTransferLine", {transferId,
      itemId: a, action: "return", requestId}, ROVER);
    assert.deepEqual([done.stage, done.openMissingCount, done.replayed],
        ["review", 3, false]);
    assert.equal(await stockAt(a, bronx), before + 2);
    await assertInvariant(a);
    assert.equal((await call("resolveInventoryTransferLine", {transferId,
      itemId: a, action: "return", requestId}, ROVER)).replayed, true);
    assert.equal(await stockAt(a, bronx), before + 2, "returned once");
    await assert.rejects(call("resolveInventoryTransferLine", {transferId,
      itemId: a, action: "write_off", reason: "lost"}), (error) =>
      error.details.reason === "line_already_resolved" &&
      error.details.resolution === "returned");
    const history = await historyOf(transferId);
    assert.equal(history.find((h) => h.action === "returned").summary,
        `Returned 2 of Jordan 11 to Bronx store (${code})`);
  });

  it("writes off the rest and settles the transfer", async () => {
    const atBronx = await stockAt(b, bronx);
    const done = await call("resolveInventoryTransferLine", {transferId,
      itemId: b, action: "write_off", reason: "damaged",
      note: "Crushed box"});
    assert.deepEqual([done.stage, done.openMissingCount], ["done", 0]);
    assert.equal(await stockAt(b, bronx), atBronx, "nothing comes back");
    await assertInvariant(b);
    const stored = await transferOf(transferId);
    assert.ok(stored.settledAt);
    assert.equal(stored.writtenOffCount, 3);
    assert.equal(stored.returnedCount, 2);
    const line = stored.lines.find((l) => l.itemId === b);
    assert.deepEqual([line.resolution, line.writeOffReason,
      line.resolutionNote, line.resolvedByName],
    ["written_off", "damaged", "Crushed box", "Dala Owner"]);
    assert.deepEqual(stored.timeline.map((e) => e.event).slice(-2),
        ["returned", "written_off"]);
    const off = (await movesOf(transferId))
        .find((m) => m.type === "transfer_written_off");
    assert.deepEqual([off.delta, off.storeId, off.itemId], [0, bronx, b]);
    await assert.rejects(call("resolveInventoryTransferLine", {transferId,
      itemId: b, action: "return"}), refusal("line_already_resolved"));
  });
});

describe("transfers: what they block", () => {
  it("keeps a store with transfers open from being archived", async () => {
    const queens = (await call("createInventoryStore", {name: "Queens"}))
        .storeId;
    const id = await product(2);
    const sent = await send([{itemId: id, quantity: 1}], {toStoreId: queens});
    await assert.rejects(call("archiveInventoryStore", {storeId: queens,
      archived: true}), (error) => error.details.reason ===
      "store_has_transfers" && error.details.transferCodes[0] === sent.code);
    await call("receiveInventoryTransfer", {transferId: sent.transferId,
      lines: [{itemId: id, quantityReceived: 0}]});
    // Still open: the missing piece waits for a decision.
    await assert.rejects(call("archiveInventoryStore", {storeId: queens,
      archived: true}), refusal("store_has_transfers"));
    await call("resolveInventoryTransferLine", {transferId: sent.transferId,
      itemId: id, action: "write_off", reason: "lost"});
    await call("archiveInventoryStore", {storeId: queens, archived: true});
    // A draft to an archived store is refused at Send.
    await assert.rejects(send([{itemId: id, quantity: 1}],
        {toStoreId: queens}), refusal("store_archived"));
  });

  it("keeps a product in an open transfer from being deleted", async () => {
    const id = await product(2);
    const sent = await send([{itemId: id, quantity: 1}]);
    await assert.rejects(call("deleteInventoryItem", {itemId: id,
      confirm: true}), (error) => error.details.reason === "item_in_transfer" &&
      error.details.transferCodes[0] === sent.code);
    await call("receiveInventoryTransfer", {transferId: sent.transferId},
        HARLEM);
    await call("deleteInventoryItem", {itemId: id, confirm: true});
  });
});

describe("transfers: the summary", () => {
  it("adds what is on its way and disputed", async () => {
    const id = await product(4, {costCents: 1000});
    await send([{itemId: id, quantity: 3}]);
    const all = await call("getInventorySummary", {range: "month",
      timeZone: "America/New_York"});
    assert.ok(all.transfers.inTransitCount >= 1);
    assert.ok(all.transfers.inTransitValueCents >= 3000);
    assert.ok(all.transfers.disputedItems >= 0);
    assert.ok(all.transfers.receivedCount >= 1);
    // A Harlem clerk sees only transfers from or to Harlem; Main has none
    // in transit here.
    const mainView = await call("getInventorySummary", {range: "month",
      timeZone: "America/New_York", storeId: MAIN});
    assert.equal(mainView.transfers.inTransitCount, 0);
    const harlemView = await call("getInventorySummary", {range: "month",
      timeZone: "America/New_York"}, HARLEM);
    assert.equal(harlemView.storeId, harlem);
    assert.equal(harlemView.transfers.inTransitCount,
        all.transfers.inTransitCount - mainView.transfers.inTransitCount);
  });
});

describe("transfers: reminders", () => {
  const day = 24 * 60 * 60 * 1000;
  const ago = (days) => admin.firestore.Timestamp.fromMillis(
      Date.now() - days * day);

  it("reminds of stock still on its way after 2 days, then every 2 days",
      async () => {
        const id = await product(2);
        const sent = await send([{itemId: id, quantity: 1}]);
        const reminders = async () => (await pushesOf(sent.transferId))
            .filter((p) => p.data.kind === "transit_reminder");
        await functions.remindInventoryTransfers.run();
        assert.equal((await reminders()).length, 0, "not yet");
        await db.collection("inventoryTransfers").doc(sent.transferId)
            .update({sentAt: ago(3)});
        await functions.remindInventoryTransfers.run();
        const first = await reminders();
        assert.deepEqual(first.map((p) => p.recipientUid).sort(),
            [OWN, HARLEM, HARLEM_FR].sort());
        const english = first.find((p) => p.recipientUid === HARLEM);
        assert.equal(english.title,
            "1 item still on their way to Harlem store");
        assert.match(english.body, /sent 3 days ago/);
        await functions.remindInventoryTransfers.run();
        assert.equal((await reminders()).length, first.length, "once a day " +
          "at most");
        await db.collection("inventoryTransfers").doc(sent.transferId)
            .update({lastTransitReminderAt: ago(2)});
        await functions.remindInventoryTransfers.run();
        assert.equal((await reminders()).length, first.length * 2);
      });

  it("reminds the owner of an open dispute", async () => {
    const id = await product(2);
    const sent = await send([{itemId: id, quantity: 2}]);
    await call("receiveInventoryTransfer", {transferId: sent.transferId,
      lines: [{itemId: id, quantityReceived: 1}]}, HARLEM);
    await db.collection("inventoryTransfers").doc(sent.transferId)
        .update({receivedAt: ago(2), sentAt: ago(3)});
    await functions.remindInventoryTransfers.run();
    const pushes = (await pushesOf(sent.transferId))
        .filter((p) => p.data.kind === "dispute_reminder");
    assert.deepEqual(pushes.map((p) => p.recipientUid), [OWN]);
    assert.equal(pushes[0].title, "1 missing item needs your decision");
  });
});

describe("transfers: the instant transfer still works", () => {
  it("moves stock at once for old app versions", async () => {
    const id = await product(4);
    const moved = await call("transferInventoryStock", {itemId: id,
      fromStoreId: bronx, toStoreId: harlem, quantity: 3});
    assert.equal(moved.quantity, 3);
    assert.equal(await stockAt(id, harlem), 3);
    assert.equal(await stockAt(id, bronx), 1);
    await assertInvariant(id);
  });
});
