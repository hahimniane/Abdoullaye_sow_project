"use strict";

const assert = require("node:assert/strict");
const {before, describe, it} = require("node:test");
const admin = require("firebase-admin");
const {EventEmitter} = require("node:events");

// The inventory callables, run directly against the Firestore emulator:
// what inventory.test.js can only pin as pure math - that two quick sales of
// the last piece both go through, that a retried sale is one sale, that a
// void puts stock back once - is exercised here against real transactions.
//
// Writes with ADMIN credentials, so it refuses to run outside the emulator.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
      "Run this through `npm run test:inventory` (firebase emulators:exec). " +
      "A direct node --test run would write its fixtures into the " +
      "real project.");
}

process.env.FUNCTIONS_EMULATOR = "true";

const functions = require("../index");
const db = admin.firestore();

const BIZ = "inv-test-biz";
const BIZ_OFF = "inv-test-biz-off";
const BIZ_DEFAULT = "inv-test-biz-default";
const OWNER = "inv-test-owner";
const CASHIER = "inv-test-cashier";
const NO_INVENTORY = "inv-test-ledger-only";
const STRANGER = "inv-test-other-business-staff";
const OFF_OWNER = "inv-test-off-owner";
const DEFAULT_OWNER = "inv-test-default-owner";

const call = (name, data, uid = OWNER) =>
  functions[name].run({auth: {uid, token: {}}, data: {businessId: BIZ,
    ...data}});

let keys = 0;
const requestId = () => `req-${Date.now()}-${++keys}`;

async function newItem(extra = {}) {
  const made = await call("createInventoryItem", {
    name: `Shea butter ${++keys}`, priceCents: 1000, costCents: 400,
    quantity: 5, lowStockAt: 2, ...extra,
  });
  return made.itemId;
}

const itemDoc = async (id) => (await db.collection("inventoryItems")
    .doc(id).get()).data();
const sell = (lines, extra = {}, uid = OWNER) => call("recordInventorySale", {
  clientRequestId: requestId(), paymentMethod: "cash", lines, ...extra,
}, uid);
const movementsOf = async (itemId) => (await db.collection(
    "inventoryMovements").where("businessId", "==", BIZ)
    .where("itemId", "==", itemId).get()).docs.map((d) => d.data())
    .sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());

const refusal = (code, kind) => (error) => {
  assert.equal(error.details?.reason, code, error.message);
  if (kind) assert.equal(error.code, kind);
  return true;
};

before(async () => {
  await Promise.all([
    db.collection("businesses").doc(BIZ).set({
      name: "Dala Shop", status: "approved", enabledServices: ["inventory"],
    }),
    db.collection("businesses").doc(BIZ_OFF).set({
      name: "No Inventory Shop", status: "approved",
      enabledServices: ["freight"],
    }),
    // Never chose its services: the default list must NOT include inventory.
    db.collection("businesses").doc(BIZ_DEFAULT).set({
      name: "Default Shop", status: "approved",
    }),
    db.collection("users").doc(OWNER).set({
      role: "businessOwner", businessId: BIZ, email: "owner@example.test",
      fullName: "Dala Owner",
    }),
    db.collection("users").doc(CASHIER).set({
      role: "staff", businessId: BIZ, businessPermissions: ["inventory"],
      fullName: "Awa Cashier", email: "cashier@example.test",
    }),
    db.collection("users").doc(NO_INVENTORY).set({
      role: "staff", businessId: BIZ, businessPermissions: ["ledger"],
      email: "ledger@example.test",
    }),
    db.collection("users").doc(STRANGER).set({
      role: "staff", businessId: BIZ_OFF, businessPermissions: ["inventory"],
      email: "stranger@example.test",
    }),
    db.collection("users").doc(OFF_OWNER).set({
      role: "businessOwner", businessId: BIZ_OFF, email: "off@example.test",
    }),
    db.collection("users").doc(DEFAULT_OWNER).set({
      role: "businessOwner", businessId: BIZ_DEFAULT,
      email: "default@example.test",
    }),
  ]);
});

describe("who may use inventory", () => {
  const valid = {name: "Soap", priceCents: 500, quantity: 1};

  it("lets the owner and a staff member holding the section in", async () => {
    await call("createInventoryItem", valid, OWNER);
    await call("createInventoryItem", valid, CASHIER);
  });

  it("refuses staff without the inventory section", async () => {
    await assert.rejects(call("createInventoryItem", valid, NO_INVENTORY),
        (error) => error.code === "permission-denied");
    await assert.rejects(sell([], {}, NO_INVENTORY),
        (error) => error.code === "permission-denied");
  });

  it("refuses another business's staff", async () => {
    await assert.rejects(call("createInventoryItem", valid, STRANGER),
        (error) => error.code === "permission-denied");
  });

  it("refuses every callable while the service is off", async () => {
    const off = (name, data) => functions[name].run({
      auth: {uid: OFF_OWNER, token: {}}, data: {businessId: BIZ_OFF, ...data},
    });
    const calls = [
      ["createInventoryItem", valid],
      ["updateInventoryItem", {itemId: "x", name: "y"}],
      ["adjustInventoryStock", {itemId: "x", mode: "add", quantity: 1}],
      ["archiveInventoryItem", {itemId: "x", archived: true}],
      ["deleteInventoryItem", {itemId: "x", confirm: true}],
      ["recordInventorySale", {clientRequestId: "req-12345678",
        paymentMethod: "cash",
        lines: [{itemId: "x", quantity: 1, soldPriceCents: 1}]}],
      ["voidInventorySale", {saleId: "x"}],
      ["getInventoryLabelsUrl", {itemId: "x", copies: 1}],
      ["getInventorySummary", {range: "today"}],
    ];
    for (const [name, data] of calls) {
      await assert.rejects(off(name, data),
          refusal("service_disabled", "failed-precondition"), name);
    }
  });

  it("is off for a business that never chose its services", async () => {
    await assert.rejects(functions.createInventoryItem.run({
      auth: {uid: DEFAULT_OWNER, token: {}},
      data: {businessId: BIZ_DEFAULT, ...valid},
    }), refusal("service_disabled", "failed-precondition"));
  });

  it("answers an unknown business as not found", async () => {
    await assert.rejects(functions.createInventoryItem.run({
      auth: {uid: OWNER, token: {}}, data: {businessId: "nope", ...valid},
    }), (error) => error.code === "permission-denied" ||
      error.details?.reason === "business_not_found");
  });
});

describe("creating and editing products", () => {
  it("creates a product with a unique IT- code and an initial movement",
      async () => {
        const made = await call("createInventoryItem", {
          name: "  Shea butter  ", priceCents: 1250, quantity: 7,
          lowStockAt: 3, category: "Skin",
          photoUrl: "https://cdn.example.test/shea.png",
        });
        assert.match(made.code, /^IT-[2-9B-DF-HJ-NP-TV-Z]{6}$/);
        const row = await itemDoc(made.itemId);
        assert.equal(row.businessId, BIZ);
        assert.equal(row.name, "Shea butter");
        assert.equal(row.code, made.code);
        assert.equal(row.priceCents, 1250);
        assert.equal(row.costCents, null);
        assert.equal(row.quantity, 7);
        assert.equal(row.lowStockAt, 3);
        assert.equal(row.archived, false);
        assert.equal(row.countWasOff, false);
        assert.equal(row.createdByStaffId, OWNER);
        assert.ok(row.createdAt && row.updatedAt);
        const moves = await movementsOf(made.itemId);
        assert.equal(moves.length, 1);
        assert.deepEqual(
            [moves[0].type, moves[0].delta, moves[0].quantityAfter,
              moves[0].byStaffId, moves[0].saleId],
            ["initial", 7, 7, OWNER, ""]);
      });

  it("writes no movement for a product that starts at zero", async () => {
    const id = await newItem({quantity: 0});
    assert.deepEqual(await movementsOf(id), []);
  });

  it("gives every product its own code", async () => {
    const made = await Promise.all(Array.from({length: 8}, () => newItem()));
    const codes = new Set();
    for (const id of made) codes.add((await itemDoc(id)).code);
    assert.equal(codes.size, 8);
  });

  it("names every problem and creates nothing", async () => {
    const before = (await db.collection("inventoryItems")
        .where("businessId", "==", BIZ).get()).size;
    await assert.rejects(call("createInventoryItem", {
      name: "", priceCents: 0, quantity: -1,
    }), (error) => {
      assert.equal(error.code, "invalid-argument");
      assert.deepEqual(error.details.reasons.sort(),
          ["name_required", "price_invalid", "quantity_invalid"]);
      assert.equal(error.details.reason, error.details.reasons[0]);
      assert.match(error.message, /name/i);
      return true;
    });
    assert.equal((await db.collection("inventoryItems")
        .where("businessId", "==", BIZ).get()).size, before);
  });

  it("edits fields, records who and keeps the count", async () => {
    const id = await newItem({quantity: 4});
    await call("updateInventoryItem",
        {itemId: id, priceCents: 1500, costCents: "", name: "Renamed"},
        CASHIER);
    const row = await itemDoc(id);
    assert.equal(row.priceCents, 1500);
    assert.equal(row.costCents, null);
    assert.equal(row.name, "Renamed");
    assert.equal(row.quantity, 4);
    assert.equal(row.updatedByStaffId, CASHIER);
    const audit = await db.collection("lotLedgerAudit")
        .where("businessId", "==", BIZ).where("entityId", "==", id).get();
    const edited = audit.docs.map((d) => d.data())
        .find((a) => a.action === "edited");
    assert.equal(edited.entityType, "inventory_item");
    assert.equal(edited.byStaffId, CASHIER);
    assert.ok(edited.changes.some((c) => c.field === "Price" &&
      c.from === "$10.00" && c.to === "$15.00"));
  });

  it("refuses to edit the count or nothing at all", async () => {
    const id = await newItem();
    await assert.rejects(call("updateInventoryItem", {itemId: id,
      quantity: 99}), refusal("quantity_not_editable", "invalid-argument"));
    await assert.rejects(call("updateInventoryItem", {itemId: id}),
        refusal("nothing_to_update"));
    await assert.rejects(call("updateInventoryItem", {itemId: id,
      priceCents: -3}), refusal("price_invalid"));
  });

  it("never touches another business's product", async () => {
    const id = await newItem();
    const other = await db.collection("inventoryItems").add({
      businessId: BIZ_OFF, name: "Theirs", code: "IT-ZZZZZZ", priceCents: 100,
      quantity: 1, archived: false,
    });
    for (const [name, data] of [
      ["updateInventoryItem", {name: "x"}],
      ["adjustInventoryStock", {mode: "add", quantity: 1}],
      ["archiveInventoryItem", {archived: true}],
      ["deleteInventoryItem", {confirm: true}],
      ["getInventoryLabelsUrl", {copies: 1}],
    ]) {
      await assert.rejects(call(name, {itemId: other.id, ...data}),
          refusal("item_not_found", "not-found"), name);
    }
    await assert.rejects(call("recordInventorySale", {
      clientRequestId: requestId(), paymentMethod: "cash",
      lines: [{itemId: other.id, quantity: 1, soldPriceCents: 100}],
    }), refusal("item_not_found"));
    assert.equal((await db.collection("inventoryItems").doc(other.id).get())
        .get("quantity"), 1);
    assert.ok(id);
  });
});

describe("stock", () => {
  it("adds, then sets, with a movement each and the count flag cleared",
      async () => {
        const id = await newItem({quantity: 2});
        const added = await call("adjustInventoryStock",
            {itemId: id, mode: "add", quantity: 3, note: "delivery"});
        assert.equal(added.quantity, 5);
        // Make the count doubtful, then count properly.
        await sell([{itemId: id, quantity: 9, soldPriceCents: 1000}]);
        assert.equal((await itemDoc(id)).countWasOff, true);
        const set = await call("adjustInventoryStock",
            {itemId: id, mode: "set", quantity: 12}, CASHIER);
        assert.equal(set.quantity, 12);
        const row = await itemDoc(id);
        assert.equal(row.quantity, 12);
        assert.equal(row.countWasOff, false);
        const moves = await movementsOf(id);
        assert.deepEqual(
            moves.map((m) => [m.type, m.delta, m.quantityAfter]),
            [["initial", 2, 2], ["add", 3, 5], ["sale", -5, 0],
              ["set", 12, 12]]);
        assert.equal(moves[1].note, "delivery");
        assert.equal(moves[3].byStaffId, CASHIER);
      });

  it("refuses a bad mode or amount without changing the count", async () => {
    const id = await newItem({quantity: 5});
    await assert.rejects(call("adjustInventoryStock",
        {itemId: id, mode: "remove", quantity: 1}), refusal("mode_invalid"));
    await assert.rejects(call("adjustInventoryStock",
        {itemId: id, mode: "add", quantity: 0}), refusal("quantity_invalid"));
    await assert.rejects(call("adjustInventoryStock",
        {itemId: id, mode: "set", quantity: -1}), refusal("quantity_invalid"));
    assert.equal((await itemDoc(id)).quantity, 5);
    assert.equal((await movementsOf(id)).length, 1);
  });
});

describe("selling", () => {
  it("sells at a discount, snapshots the line and takes stock down",
      async () => {
        const id = await newItem({quantity: 5, priceCents: 1000,
          costCents: 400, name: "Black soap"});
        const result = await sell([
          {itemId: id, quantity: 2, soldPriceCents: 800}], {}, CASHIER);
        assert.equal(result.totalCents, 1600);
        assert.deepEqual(result.warnings, []);
        assert.equal(result.replayed, false);
        const sale = (await db.collection("inventorySales")
            .doc(result.saleId).get()).data();
        assert.equal(sale.businessId, BIZ);
        assert.equal(sale.paymentMethod, "cash");
        assert.equal(sale.soldByStaffId, CASHIER);
        assert.equal(sale.voided, false);
        assert.equal(sale.totalCents, 1600);
        assert.deepEqual(sale.lines, [{
          itemId: id, name: "Black soap", code: (await itemDoc(id)).code,
          quantity: 2, listPriceCents: 1000, soldPriceCents: 800,
          costCents: 400, countWasOff: false, stockDeducted: 2,
        }]);
        const row = await itemDoc(id);
        assert.equal(row.quantity, 3);
        assert.equal(row.countWasOff, false);
        const moves = await movementsOf(id);
        const move = moves[moves.length - 1];
        assert.deepEqual(
            [move.type, move.delta, move.quantityAfter, move.saleId,
              move.byStaffId],
            ["sale", -2, 3, result.saleId, CASHIER]);
        // The history is recorded, but a counter sale is not "news".
        const audit = await db.collection("lotLedgerAudit")
            .where("businessId", "==", BIZ)
            .where("entityId", "==", result.saleId).get();
        assert.equal(audit.size, 1);
        assert.equal(audit.docs[0].get("entityType"), "inventory_sale");
        assert.equal(audit.docs[0].get("acknowledged"), true);
      });

  it("keeps the snapshot when the product is edited later", async () => {
    const id = await newItem({name: "Before", priceCents: 700});
    const {saleId} = await sell([
      {itemId: id, quantity: 1, soldPriceCents: 700}]);
    await call("updateInventoryItem",
        {itemId: id, name: "After", priceCents: 900});
    const sale = (await db.collection("inventorySales").doc(saleId).get())
        .data();
    assert.equal(sale.lines[0].name, "Before");
    assert.equal(sale.lines[0].listPriceCents, 700);
  });

  it("sells more than the count: floors at 0, flags, and warns", async () => {
    const id = await newItem({quantity: 1});
    const result = await sell([
      {itemId: id, quantity: 3, soldPriceCents: 1000}]);
    assert.equal(result.totalCents, 3000);
    assert.deepEqual(result.warnings,
        [{itemId: id, reason: "count_was_off"}]);
    const row = await itemDoc(id);
    assert.equal(row.quantity, 0);
    assert.equal(row.countWasOff, true);
    const sale = (await db.collection("inventorySales")
        .doc(result.saleId).get()).data();
    assert.equal(sale.lines[0].quantity, 3);
    assert.equal(sale.lines[0].countWasOff, true);
    assert.equal(sale.lines[0].stockDeducted, 1);
    const moves = await movementsOf(id);
    assert.equal(moves[moves.length - 1].delta, -1);
    assert.equal(moves[moves.length - 1].quantityAfter, 0);
  });

  it("answers a retried sale with the same sale, once", async () => {
    const id = await newItem({quantity: 5});
    const key = requestId();
    const lines = [{itemId: id, quantity: 2, soldPriceCents: 1000}];
    const first = await sell(lines, {clientRequestId: key});
    const again = await sell(lines, {clientRequestId: key});
    assert.equal(again.saleId, first.saleId);
    assert.equal(again.totalCents, first.totalCents);
    assert.equal(first.replayed, false);
    assert.equal(again.replayed, true);
    assert.equal((await itemDoc(id)).quantity, 3);
    const sales = await db.collection("inventorySales")
        .where("businessId", "==", BIZ)
        .where("clientRequestId", "==", key).get();
    assert.equal(sales.size, 1);
    const sold = (await movementsOf(id)).filter((m) => m.type === "sale");
    assert.equal(sold.length, 1);
  });

  it("books one sale for several simultaneous sends of one key", async () => {
    const id = await newItem({quantity: 5});
    const key = requestId();
    const lines = [{itemId: id, quantity: 1, soldPriceCents: 1000}];
    const settled = await Promise.allSettled(Array.from({length: 4}, () =>
      sell(lines, {clientRequestId: key})));
    const results = settled.filter((r) => r.status === "fulfilled")
        .map((r) => r.value);
    // A send that loses the transaction race can be refused with a
    // contention error (the emulator reports it as "invalid or closed");
    // retrying with the same key is the app's answer to that.
    for (const r of settled.filter((x) => x.status === "rejected")) {
      assert.match(`${r.reason?.code} ${r.reason?.message}`,
          /abort|contention|invalid or closed/i);
    }
    assert.ok(results.length >= 1);
    assert.equal(new Set(results.map((r) => r.saleId)).size, 1);
    assert.equal(results.filter((r) => !r.replayed).length, 1);
    const again = await sell(lines, {clientRequestId: key});
    assert.equal(again.replayed, true);
    assert.equal(again.saleId, results[0].saleId);
    assert.equal((await itemDoc(id)).quantity, 4);
  });

  it("lets two sales of the last piece both through, floored and flagged",
      async () => {
        const id = await newItem({quantity: 1});
        const [a, b] = await Promise.all([
          sell([{itemId: id, quantity: 1, soldPriceCents: 1000}], {}, OWNER),
          sell([{itemId: id, quantity: 1, soldPriceCents: 1000}], {}, CASHIER),
        ]);
        assert.notEqual(a.saleId, b.saleId);
        const row = await itemDoc(id);
        assert.equal(row.quantity, 0);
        assert.equal(row.countWasOff, true);
        // Exactly one of them found the shelf already empty.
        assert.equal([a, b].filter((r) => r.warnings.length > 0).length, 1);
        const sales = await Promise.all([a, b].map(async (r) => (
          await db.collection("inventorySales").doc(r.saleId).get()).data()));
        assert.equal(sales.filter((s) => s.lines[0].countWasOff).length, 1);
        assert.deepEqual(sales.map((s) => s.lines[0].stockDeducted).sort(),
            [0, 1]);
        const sold = (await movementsOf(id)).filter((m) => m.type === "sale");
        assert.deepEqual(sold.map((m) => m.delta).sort(), [-1, 0]);
        assert.ok(sold.every((m) => m.quantityAfter >= 0));
      });

  it("shares one product's stock across two lines of one sale", async () => {
    const id = await newItem({quantity: 3});
    const result = await sell([
      {itemId: id, quantity: 2, soldPriceCents: 1000},
      {itemId: id, quantity: 2, soldPriceCents: 800},
    ]);
    assert.equal(result.totalCents, 3600);
    assert.equal((await itemDoc(id)).quantity, 0);
    assert.deepEqual(result.warnings,
        [{itemId: id, reason: "count_was_off"}]);
  });

  it("refuses an archived product and changes nothing", async () => {
    const live = await newItem({quantity: 5});
    const gone = await newItem({quantity: 5});
    await call("archiveInventoryItem", {itemId: gone, archived: true});
    const key = requestId();
    await assert.rejects(sell([
      {itemId: live, quantity: 1, soldPriceCents: 1000},
      {itemId: gone, quantity: 1, soldPriceCents: 1000},
    ], {clientRequestId: key}), (error) => {
      assert.equal(error.details.reason, "item_archived");
      assert.deepEqual(error.details.itemIds, [gone]);
      return true;
    });
    assert.equal((await itemDoc(live)).quantity, 5);
    assert.equal((await itemDoc(gone)).quantity, 5);
    assert.equal((await db.collection("inventorySales")
        .where("clientRequestId", "==", key).get()).size, 0);
  });

  it("refuses a malformed sale before touching anything", async () => {
    const id = await newItem({quantity: 5});
    const bad = (data) => call("recordInventorySale", {
      clientRequestId: requestId(), paymentMethod: "cash",
      lines: [{itemId: id, quantity: 1, soldPriceCents: 100}], ...data});
    await assert.rejects(bad({paymentMethod: "bitcoin"}),
        refusal("payment_method_invalid", "invalid-argument"));
    await assert.rejects(bad({lines: []}), refusal("lines_required"));
    await assert.rejects(bad({clientRequestId: "x"}),
        refusal("client_request_id_invalid"));
    await assert.rejects(bad({lines: [
      {itemId: id, quantity: 0, soldPriceCents: 100}]}),
    refusal("quantity_invalid"));
    await assert.rejects(bad({lines: [
      {itemId: id, quantity: 1, soldPriceCents: ""}]}),
    refusal("price_invalid"));
    await assert.rejects(bad({lines: [
      {itemId: "no-such-item", quantity: 1, soldPriceCents: 100}]}),
    refusal("item_not_found", "not-found"));
    assert.equal((await itemDoc(id)).quantity, 5);
  });
});

describe("voiding a sale", () => {
  it("puts the stock back once, and refuses a second void", async () => {
    const id = await newItem({quantity: 5});
    const {saleId} = await sell([
      {itemId: id, quantity: 2, soldPriceCents: 1000}]);
    assert.equal((await itemDoc(id)).quantity, 3);
    const done = await call("voidInventorySale",
        {saleId, reason: "wrong item"}, CASHIER);
    assert.equal(done.success, true);
    assert.equal((await itemDoc(id)).quantity, 5);
    const sale = (await db.collection("inventorySales").doc(saleId).get())
        .data();
    assert.equal(sale.voided, true);
    assert.equal(sale.voidedByStaffId, CASHIER);
    assert.ok(sale.voidedAt);
    assert.equal(sale.voidReason, "wrong item");
    const moves = await movementsOf(id);
    const last = moves[moves.length - 1];
    assert.deepEqual([last.type, last.delta, last.quantityAfter, last.saleId,
      last.note], ["void", 2, 5, saleId, "wrong item"]);
    await assert.rejects(call("voidInventorySale", {saleId}),
        refusal("sale_voided", "failed-precondition"));
    assert.equal((await itemDoc(id)).quantity, 5);
    // Nothing erased: the sale and its lines are still there.
    assert.equal(sale.lines.length, 1);
  });

  it("restores only what left the shelf after a floored sale", async () => {
    const id = await newItem({quantity: 1});
    const {saleId} = await sell([
      {itemId: id, quantity: 3, soldPriceCents: 1000}]);
    await call("voidInventorySale", {saleId});
    assert.equal((await itemDoc(id)).quantity, 1);
  });

  it("lets two simultaneous voids through only once", async () => {
    const id = await newItem({quantity: 5});
    const {saleId} = await sell([
      {itemId: id, quantity: 2, soldPriceCents: 1000}]);
    const results = await Promise.allSettled([
      call("voidInventorySale", {saleId}),
      call("voidInventorySale", {saleId}, CASHIER),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await itemDoc(id)).quantity, 5);
  });

  it("voids a sale whose product has since been deleted", async () => {
    const id = await newItem({quantity: 5});
    const {saleId} = await sell([
      {itemId: id, quantity: 1, soldPriceCents: 1000}]);
    await call("deleteInventoryItem", {itemId: id, confirm: true});
    const done = await call("voidInventorySale", {saleId});
    assert.deepEqual(done.skippedItemIds, [id]);
    assert.equal((await db.collection("inventorySales").doc(saleId).get())
        .get("voided"), true);
  });

  it("refuses an unknown sale and another business's sale", async () => {
    await assert.rejects(call("voidInventorySale", {saleId: "nope"}),
        refusal("sale_not_found", "not-found"));
    await assert.rejects(call("voidInventorySale", {saleId: ""}),
        refusal("sale_not_found"));
    const foreign = await db.collection("inventorySales").add({
      businessId: BIZ_OFF, lines: [], totalCents: 0, voided: false,
    });
    await assert.rejects(call("voidInventorySale", {saleId: foreign.id}),
        refusal("sale_not_found"));
  });
});

describe("archive and delete", () => {
  it("archives and restores, recording who", async () => {
    const id = await newItem();
    await call("archiveInventoryItem", {itemId: id, archived: true}, CASHIER);
    let row = await itemDoc(id);
    assert.equal(row.archived, true);
    assert.equal(row.updatedByStaffId, CASHIER);
    await call("archiveInventoryItem", {itemId: id, archived: false});
    row = await itemDoc(id);
    assert.equal(row.archived, false);
    const audit = (await db.collection("lotLedgerAudit")
        .where("businessId", "==", BIZ).where("entityId", "==", id).get())
        .docs.map((d) => d.get("action"));
    assert.ok(audit.includes("archived") && audit.includes("restored"));
  });

  it("is idempotent and wants a real boolean", async () => {
    const id = await newItem();
    await call("archiveInventoryItem", {itemId: id, archived: true});
    await call("archiveInventoryItem", {itemId: id, archived: true});
    await assert.rejects(call("archiveInventoryItem",
        {itemId: id, archived: "yes"}), refusal("archived_invalid"));
  });

  it("keeps an archived product printable and editable", async () => {
    const id = await newItem();
    await call("archiveInventoryItem", {itemId: id, archived: true});
    await call("updateInventoryItem", {itemId: id, name: "Still editable"});
    await call("adjustInventoryStock", {itemId: id, mode: "add", quantity: 1});
    const {url} = await call("getInventoryLabelsUrl",
        {itemId: id, copies: 1});
    assert.ok(url);
  });

  it("deletes only behind a confirmation, and history survives", async () => {
    const id = await newItem({quantity: 5, name: "Doomed"});
    const {saleId} = await sell([
      {itemId: id, quantity: 1, soldPriceCents: 1000}]);
    await assert.rejects(call("deleteInventoryItem", {itemId: id}),
        refusal("confirm_required", "invalid-argument"));
    await assert.rejects(call("deleteInventoryItem",
        {itemId: id, confirm: "true"}), refusal("confirm_required"));
    assert.ok((await db.collection("inventoryItems").doc(id).get()).exists);
    await call("deleteInventoryItem", {itemId: id, confirm: true});
    assert.equal((await db.collection("inventoryItems").doc(id).get()).exists,
        false);
    const sale = (await db.collection("inventorySales").doc(saleId).get())
        .data();
    assert.equal(sale.lines[0].name, "Doomed");
    assert.equal(sale.lines[0].listPriceCents, 1000);
    await assert.rejects(call("deleteInventoryItem",
        {itemId: id, confirm: true}), refusal("item_not_found"));
  });
});

describe("tags", () => {
  it("hands back a link that opens the QR page, and the same token again",
      async () => {
        const id = await newItem({name: "Secret product name"});
        const {url} = await call("getInventoryLabelsUrl",
            {itemId: id, copies: 3});
        const query = new URL(url).searchParams;
        assert.equal(query.get("view"), "inventoryTags");
        assert.equal(query.get("labels"), "tag");
        assert.equal(query.get("copies"), "3");
        const token = query.get("t");
        assert.equal((await itemDoc(id)).documentToken, token);
        const again = await call("getInventoryLabelsUrl",
            {itemId: id, copies: 500});
        assert.equal(new URL(again.url).searchParams.get("t"), token);
        assert.equal(new URL(again.url).searchParams.get("copies"), "500");

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
        await open(Object.fromEntries(query));
        assert.equal(sent.status, 200);
        assert.equal(sent.body.match(/class="tag"/g).length, 3);
        assert.match(sent.body, /<svg/);
        assert.doesNotMatch(sent.body, /Secret product name/);
        // The same token without the tags view finds no document.
        await open({t: token});
        assert.equal(sent.status, 404);
        // A made-up token opens nothing.
        await open({t: "x".repeat(32), view: "inventoryTags"});
        assert.equal(sent.status, 404);
      });

  it("prints 1 to 500 and refuses the rest", async () => {
    const id = await newItem();
    for (const copies of [0, 501, -1, 2.5, "lots", undefined]) {
      await assert.rejects(call("getInventoryLabelsUrl", {itemId: id, copies}),
          refusal("copies_invalid", "invalid-argument"), String(copies));
    }
    await call("getInventoryLabelsUrl", {itemId: id, copies: 1});
    await call("getInventoryLabelsUrl", {itemId: id, copies: 500});
  });

  it("is gated like the rest", async () => {
    const id = await newItem();
    await assert.rejects(call("getInventoryLabelsUrl",
        {itemId: id, copies: 1}, NO_INVENTORY),
    (error) => error.code === "permission-denied");
  });
});

describe("summary", () => {
  // A business of its own, so the numbers are exact.
  const SUM_BIZ = "inv-test-summary-biz";
  const sumCall = (name, data, uid = OWNER) => functions[name].run({
    auth: {uid, token: {}}, data: {businessId: SUM_BIZ, ...data}});
  let a;
  let b;

  before(async () => {
    await db.collection("businesses").doc(SUM_BIZ).set({
      name: "Summary Shop", status: "approved", enabledServices: ["inventory"],
    });
    await db.collection("users").doc("inv-test-summary-owner").set({
      role: "businessOwner", businessId: SUM_BIZ, email: "s@example.test",
    });
  });

  const as = "inv-test-summary-owner";
  const make = async (extra) => (await sumCall("createInventoryItem",
      {priceCents: 1000, quantity: 10, ...extra}, as)).itemId;
  const ring = (lines) => sumCall("recordInventorySale", {
    clientRequestId: requestId(), paymentMethod: "zelle", lines}, as);

  it("totals today's sales, excluding voided ones", async () => {
    a = await make({name: "Alpha", costCents: 400, lowStockAt: 5});
    b = await make({name: "Beta", costCents: null, lowStockAt: 1});
    await ring([
      {itemId: a, quantity: 2, soldPriceCents: 800},
      {itemId: b, quantity: 1, soldPriceCents: 1000}]);
    await ring([{itemId: a, quantity: 1, soldPriceCents: 1000}]);
    const voided = await ring([{itemId: a, quantity: 5, soldPriceCents: 1000}]);
    await sumCall("voidInventorySale", {saleId: voided.saleId}, as);

    const s = await sumCall("getInventorySummary",
        {range: "today", timeZone: "America/New_York"}, as);
    assert.equal(s.salesCount, 2);
    assert.equal(s.itemsSold, 4);
    assert.equal(s.revenueCents, 1600 + 1000 + 1000);
    // known costs only: Alpha 3 x 400
    assert.equal(s.costCents, 1200);
    assert.equal(s.profitCents, (1600 + 1000) - 1200);
    assert.equal(s.linesWithoutCost, 1);
    // Alpha 2 sold at 800 against a list of 1000
    assert.equal(s.discountCents, 400);
    assert.deepEqual(s.best.map((r) => [r.itemId, r.name, r.quantity,
      r.revenueCents]),
    [[a, "Alpha", 3, 2600], [b, "Beta", 1, 1000]]);
    assert.equal(s.range, "today");
    assert.equal(s.truncated, false);
    // Alpha has 10 - 3 = 7 left (the voided 5 came back); level 5: not low.
    assert.deepEqual(s.low, []);
    assert.equal(s.lowCount, 0);
  });

  it("lists low stock and doubtful counts", async () => {
    const c = await make({name: "Charlie", quantity: 1, lowStockAt: 3});
    const d = await make({name: "Delta", quantity: 0});
    await ring([{itemId: d, quantity: 1, soldPriceCents: 500}]);
    const s = await sumCall("getInventorySummary",
        {range: "month", timeZone: "America/New_York"}, as);
    assert.deepEqual(s.low.map((r) => r.name), ["Delta", "Charlie"]);
    assert.deepEqual(s.low[0],
        {itemId: d, name: "Delta", quantity: 0, lowStockAt: null});
    assert.deepEqual(s.countWasOff, [{itemId: d, name: "Delta"}]);
    assert.equal(s.countWasOffCount, 1);
    // Archived products leave both lists.
    await sumCall("archiveInventoryItem", {itemId: c, archived: true}, as);
    await sumCall("archiveInventoryItem", {itemId: d, archived: true}, as);
    const hidden = await sumCall("getInventorySummary",
        {range: "month"}, as);
    assert.deepEqual(hidden.low, []);
    assert.deepEqual(hidden.countWasOff, []);
  });

  it("counts a sale on the viewer's calendar day, not the server's",
      async () => {
        const {rangeBounds} = require("../inventory");
        const zone = "America/Los_Angeles";
        const {startMs} = rangeBounds("today", zone, new Date());
        const revenue = async () => (await sumCall("getInventorySummary",
            {range: "today", timeZone: zone}, as)).revenueCents;
        const before = await revenue();
        const id = await make({name: "Echo", quantity: 50});
        const late = await ring([
          {itemId: id, quantity: 1, soldPriceCents: 300}]);
        const early = await ring([
          {itemId: id, quantity: 1, soldPriceCents: 700}]);
        const at = (ms) => admin.firestore.Timestamp.fromMillis(ms);
        // One millisecond before local midnight is yesterday there; local
        // midnight itself is today.
        await db.collection("inventorySales").doc(late.saleId)
            .update({createdAt: at(startMs - 1)});
        await db.collection("inventorySales").doc(early.saleId)
            .update({createdAt: at(startMs)});
        assert.equal(await revenue() - before, 700);
        const month = await sumCall("getInventorySummary",
            {range: "month", timeZone: zone}, as);
        assert.ok(month.revenueCents >= before + 700);
      });

  it("refuses an unknown range", async () => {
    await assert.rejects(sumCall("getInventorySummary", {range: "year"}, as),
        refusal("range_invalid"));
  });

  it("is gated", async () => {
    await assert.rejects(sumCall("getInventorySummary", {range: "today"},
        NO_INVENTORY), (error) => error.code === "permission-denied");
  });
});

describe("a platform admin switches Inventory on or off", () => {
  const ADMIN = "inv-test-platform-admin";
  const SUPPORT = "inv-test-support-admin";
  const TARGET = "inv-test-switch-biz";
  const toggle = (data, uid = ADMIN) => functions.setBusinessInventoryService
      .run({auth: {uid, token: {}}, data});
  const servicesOf = async (id = TARGET) => (await db.collection("businesses")
      .doc(id).get()).data().enabledServices;
  const auditsFor = async (id = TARGET) => (await db.collection(
      "adminAuditLogs").where("targetId", "==", id).get()).docs
      .map((d) => d.data()).filter((row) => row.metadata?.service ===
        "inventory");

  before(async () => {
    // A platform admin's profile check reads the Auth account (it must have a
    // verified email), so these two need real Auth emulator users.
    await Promise.all([ADMIN, SUPPORT].map((uid) => admin.auth().createUser({
      uid, email: `${uid}@example.test`, password: "InventoryAdmin-2026!",
      emailVerified: true,
    })));
    await Promise.all([
      db.collection("users").doc(ADMIN).set({
        role: "admin", platformAdmin: true, adminRole: "superAdmin",
        email: "inv-admin@example.test",
      }),
      db.collection("users").doc(SUPPORT).set({
        role: "admin", platformAdmin: true, adminRole: "supportAdmin",
        email: "inv-support@example.test",
      }),
      db.collection("businesses").doc(TARGET).set({
        name: "Switch Shop", status: "approved",
        enabledServices: ["barrelShipping", "freight"],
      }),
    ]);
  });

  it("enables it and keeps every other service", async () => {
    const answer = await toggle({businessId: TARGET, enabled: true});
    assert.equal(answer.enabled, true);
    assert.equal(answer.changed, true);
    const stored = await servicesOf();
    assert.deepEqual(stored, answer.enabledServices);
    assert.ok(stored.includes("inventory"));
    assert.ok(stored.includes("barrelShipping"));
    assert.ok(stored.includes("freight"));
    assert.equal(stored.length, 3);
    const audits = await auditsFor();
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, "inventory_service_enabled");
    assert.equal(audits[0].actorUid, ADMIN);
    assert.equal(audits[0].nextValue, true);
  });

  it("is a no-op, with no new audit row, when already on", async () => {
    const before = await servicesOf();
    const answer = await toggle({businessId: TARGET, enabled: true});
    assert.equal(answer.changed, false);
    assert.deepEqual(await servicesOf(), before);
    assert.equal((await auditsFor()).length, 1);
  });

  it("disables it and keeps the others", async () => {
    const answer = await toggle({businessId: TARGET, enabled: false});
    assert.equal(answer.enabled, false);
    assert.equal(answer.changed, true);
    assert.deepEqual(await servicesOf(), ["barrelShipping", "freight"]);
    const audits = await auditsFor();
    assert.equal(audits.length, 2);
    assert.ok(audits.some((row) =>
      row.action === "inventory_service_disabled" &&
      row.nextValue === false));
  });

  it("is a no-op when already off", async () => {
    const answer = await toggle({businessId: TARGET, enabled: false});
    assert.equal(answer.changed, false);
    assert.deepEqual(await servicesOf(), ["barrelShipping", "freight"]);
    assert.equal((await auditsFor()).length, 2);
  });

  it("lets the business use inventory only while it is on", async () => {
    const create = () => functions.createInventoryItem.run({
      auth: {uid: OFF_OWNER, token: {}},
      data: {businessId: BIZ_OFF, name: "Soap", priceCents: 500, quantity: 1},
    });
    await toggle({businessId: BIZ_OFF, enabled: true});
    assert.ok((await create()).itemId);
    assert.ok((await servicesOf(BIZ_OFF)).includes("freight"));
    await toggle({businessId: BIZ_OFF, enabled: false});
    await assert.rejects(create(), refusal("service_disabled"));
  });

  it("turns it on for a business that never chose its services", async () => {
    await toggle({businessId: BIZ_DEFAULT, enabled: true});
    const stored = await servicesOf(BIZ_DEFAULT);
    assert.ok(stored.includes("inventory"));
    assert.ok(stored.length > 1, "the default services are kept");
    await toggle({businessId: BIZ_DEFAULT, enabled: false});
    assert.ok(!(await servicesOf(BIZ_DEFAULT)).includes("inventory"));
  });

  it("refuses a business owner, even of that business", async () => {
    await assert.rejects(
        toggle({businessId: BIZ, enabled: false}, OWNER),
        (error) => error.code === "permission-denied");
    await assert.rejects(
        toggle({businessId: TARGET, enabled: true}, OFF_OWNER),
        (error) => error.code === "permission-denied");
    assert.ok((await servicesOf(BIZ)).includes("inventory"));
    assert.ok(!(await servicesOf()).includes("inventory"));
  });

  it("refuses an admin role without the businesses capability", async () => {
    await assert.rejects(
        toggle({businessId: TARGET, enabled: true}, SUPPORT),
        (error) => error.code === "permission-denied");
    assert.ok(!(await servicesOf()).includes("inventory"));
  });

  it("refuses a signed-out caller", async () => {
    await assert.rejects(functions.setBusinessInventoryService.run({
      data: {businessId: TARGET, enabled: true},
    }), (error) => error.code === "unauthenticated");
  });

  it("refuses an unknown business and does not create it", async () => {
    await assert.rejects(
        toggle({businessId: "inv-test-no-such-business", enabled: true}),
        (error) => error.code === "not-found");
    assert.equal((await db.collection("businesses")
        .doc("inv-test-no-such-business").get()).exists, false);
  });

  it("refuses a missing business id or a non-boolean switch", async () => {
    await assert.rejects(toggle({enabled: true}),
        (error) => error.code === "invalid-argument");
    for (const bad of [undefined, "true", 1, null]) {
      await assert.rejects(toggle({businessId: TARGET, enabled: bad}),
          (error) => error.code === "invalid-argument", String(bad));
    }
    assert.ok(!(await servicesOf()).includes("inventory"));
  });
});
