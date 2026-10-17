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

// The emulator locks pessimistically: transactions that contend for the same
// documents wait about three seconds and one of them is then given up on. The
// Admin SDK retries a gRPC ABORTED by itself, but the emulator also reports a
// transaction it invalidated as INVALID_ARGUMENT "Transaction is invalid or
// closed", and the SDK only retries that code when the text says "has
// expired" (the production wording). So the loser reaches the caller raw,
// with no `details.reason`. That is lock arbitration, not an answer from the
// callable: a caller simply tries again, so the race tests do too.
//
// Only that raw, numeric-coded contention is retried. A refusal
// (`details.reason`), an HttpsError (string code) or any other failure is
// thrown at once, so a retry can never hide a real defect, and a retried
// call runs the real transaction again - what the stores finally hold is
// still what each test asserts. A call that gave up before committing
// changed nothing, so retrying it cannot apply it twice.
const GRPC_ABORTED = 10;
const GRPC_INVALID_ARGUMENT = 3;

const isEmulatorContention = (error) => !error?.details?.reason &&
  (error?.code === GRPC_ABORTED ||
    (error?.code === GRPC_INVALID_ARGUMENT &&
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

// What a race participant ended with: "ok", the callable's refusal reason, or
// - so a failure names itself instead of showing as `undefined` - the raw
// code and message.
const outcomeOf = (run) => untilSettled(run).then(() => "ok", (error) =>
  error.details?.reason || `${error.code}: ${error.message}`);

describe("retrying emulator contention", () => {
  const raw = (code, message) => Object.assign(new Error(message), {code});

  it("retries only a raw abort or an invalidated transaction", async () => {
    for (const error of [raw(GRPC_ABORTED, "10 ABORTED: too much contention"),
      raw(GRPC_INVALID_ARGUMENT, "3 INVALID_ARGUMENT: Transaction is " +
        "invalid or closed.")]) {
      let calls = 0;
      const value = await untilSettled(async () => {
        if (++calls < 3) throw error;
        return "done";
      });
      assert.deepEqual([value, calls], ["done", 3], error.message);
    }
  });

  it("throws a refusal, an HttpsError or any other failure at once",
      async () => {
        const refused = Object.assign(raw(GRPC_ABORTED, "refused"),
            {details: {reason: "insufficient_stock"}});
        const failures = [refused,
          Object.assign(new Error("denied"), {code: "permission-denied"}),
          raw(GRPC_INVALID_ARGUMENT, "3 INVALID_ARGUMENT: bad field"),
          raw(14, "14 UNAVAILABLE"), new Error("plain")];
        for (const error of failures) {
          let calls = 0;
          await assert.rejects(untilSettled(async () => {
            calls++;
            throw error;
          }), (thrown) => thrown === error);
          assert.equal(calls, 1, error.message);
        }
      });

  it("gives up after its attempts and surfaces the last error", async () => {
    const error = raw(GRPC_ABORTED, "10 ABORTED: still contended");
    let calls = 0;
    await assert.rejects(untilSettled(async () => {
      calls++;
      throw error;
    }, 3), (thrown) => thrown === error);
    assert.equal(calls, 3);
  });

  it("names a failure that has no reason instead of hiding it", async () => {
    assert.equal(await outcomeOf(async () => {
      throw raw(GRPC_INVALID_ARGUMENT, "3 INVALID_ARGUMENT: bad field");
    }), "3: 3 INVALID_ARGUMENT: bad field");
    assert.equal(await outcomeOf(async () => "fine"), "ok");
  });
});

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
          quantity: 2, categoryId: "", category: "", brandId: "", brand: "",
          listPriceCents: 1000,
          soldPriceCents: 800, costCents: 400, countWasOff: false,
          stockDeducted: 2,
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
        // Each send keeps its own key, so one the emulator gives up on is
        // sent again as the same sale, not booked twice.
        const ringUp = (uid) => {
          const extra = {clientRequestId: requestId()};
          return untilSettled(() => sell([{itemId: id, quantity: 1,
            soldPriceCents: 1000}], extra, uid));
        };
        const [a, b] = await Promise.all([ringUp(OWNER), ringUp(CASHIER)]);
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
    // A void the emulator gives up on is sent again and then finds the sale
    // already voided; exactly one of the two may go through.
    const results = await Promise.allSettled([
      untilSettled(() => call("voidInventorySale", {saleId})),
      untilSettled(() => call("voidInventorySale", {saleId}, CASHIER)),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    for (const r of results.filter((x) => x.status === "rejected")) {
      assert.equal(r.reason?.details?.reason, "sale_voided");
    }
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

describe("a shop asks for Inventory on its application", () => {
  let applicants = 0;
  let applicantUids = 0;
  const apply = async (extra = {}, name = `Request Shop ${++applicants}`) => {
    const uid = `inv-test-applicant-${++applicantUids}`;
    await admin.auth().createUser({
      uid, email: `${uid}@example.test`, password: "InventoryApply-2026!",
    });
    const answer = await functions.submitBusinessApplication.run({
      auth: {uid, token: {}},
      data: {
        ownerName: "Applicant", ownerPhone: "+224620000077",
        businessName: name, enabledServices: ["freight"],
        addressLine1: "1 Test Road", city: "Conakry", country: "Guinea",
        ...extra,
      },
    });
    const business = (await db.collection("businesses")
        .doc(answer.businessId).get()).data();
    const application = (await db.collection("businessApplications")
        .where("businessId", "==", answer.businessId).get()).docs[0].data();
    return {answer, business, application, uid};
  };

  it("stores the request and still leaves Inventory off", async () => {
    const {answer, business, application} =
      await apply({requestInventory: true});
    assert.equal(business.requestedInventory, true);
    assert.equal(application.requestedInventory, true);
    assert.equal(answer.requestedInventory, true);
    for (const list of [business.enabledServices, application.enabledServices,
      answer.enabledServices]) {
      assert.deepEqual(list, ["freight"]);
    }
  });

  it("never lets enabledServices carry inventory, requested or not",
      async () => {
        const {business, application} = await apply({
          requestInventory: true, enabledServices: ["freight", "inventory"],
        });
        assert.ok(!business.enabledServices.includes("inventory"));
        assert.ok(!application.enabledServices.includes("inventory"));
        assert.equal(business.requestedInventory, true);
      });

  it("records false when it is false or missing", async () => {
    const off = await apply({requestInventory: false});
    assert.equal(off.business.requestedInventory, false);
    assert.equal(off.application.requestedInventory, false);
    const missing = await apply();
    assert.equal(missing.business.requestedInventory, false);
    assert.equal(missing.application.requestedInventory, false);
  });

  it("ignores a value that is not the boolean true", async () => {
    for (const bad of ["true", 1, "yes", {}, ["inventory"], null]) {
      const {business, application} = await apply({requestInventory: bad});
      assert.equal(business.requestedInventory, false, String(bad));
      assert.equal(application.requestedInventory, false, String(bad));
    }
  });

  it("clears the request when an admin switches Inventory on", async () => {
    const ADMIN = "inv-test-request-admin";
    await admin.auth().createUser({
      uid: ADMIN, email: `${ADMIN}@example.test`,
      password: "InventoryAdmin-2026!", emailVerified: true,
    });
    await db.collection("users").doc(ADMIN).set({
      role: "admin", platformAdmin: true, adminRole: "superAdmin",
      email: "inv-request-admin@example.test",
    });
    const {answer} = await apply({requestInventory: true});
    const id = answer.businessId;
    const read = async () => (await db.collection("businesses").doc(id)
        .get()).data();
    const toggle = (enabled) => functions.setBusinessInventoryService.run({
      auth: {uid: ADMIN, token: {}}, data: {businessId: id, enabled},
    });
    assert.equal((await read()).requestedInventory, true);
    await toggle(true);
    const on = await read();
    assert.ok(on.enabledServices.includes("inventory"));
    assert.equal(on.requestedInventory, false);
    // Switching it off later does not resurrect the old request.
    await toggle(false);
    const off = await read();
    assert.ok(!off.enabledServices.includes("inventory"));
    assert.equal(off.requestedInventory, false);
  });

  it("clears a stale request even when Inventory was already on",
      async () => {
        const ADMIN = "inv-test-request-admin";
        await db.collection("businesses").doc("inv-test-stale-request").set({
          name: "Stale", status: "approved",
          enabledServices: ["freight", "inventory"], requestedInventory: true,
        });
        const answer = await functions.setBusinessInventoryService.run({
          auth: {uid: ADMIN, token: {}},
          data: {businessId: "inv-test-stale-request", enabled: true},
        });
        assert.equal(answer.changed, false);
        const stored = (await db.collection("businesses")
            .doc("inv-test-stale-request").get()).data();
        assert.equal(stored.requestedInventory, false);
        assert.ok(stored.enabledServices.includes("inventory"));
      });

  it("accepts an Inventory-only shop: no services, only the request",
      async () => {
        const {answer, business, application} = await apply({
          requestInventory: true, enabledServices: [],
        });
        assert.equal(answer.success, true);
        assert.equal(answer.status, "pending");
        assert.deepEqual(answer.enabledServices, []);
        assert.deepEqual(business.enabledServices, []);
        assert.deepEqual(application.enabledServices, []);
        assert.equal(business.requestedInventory, true);
        assert.equal(application.requestedInventory, true);
        assert.equal(business.status, "pending");
        const owner = (await db.collection("users").doc(business.ownerUid)
            .get()).data();
        assert.equal(owner.role, "businessOwner");
        assert.deepEqual(owner.businessServices, []);
        // The admin is told, so the shop shows up in the console.
        const notes = await db.collection("platformNotifications")
            .where("businessId", "==", answer.businessId).get();
        assert.equal(notes.size, 1);
        assert.deepEqual(notes.docs[0].data().enabledServices, []);
        assert.equal(notes.docs[0].data().requestedInventory, true);
      });

  it("treats a missing services list the same as an empty one", async () => {
    const {business} = await apply({
      requestInventory: true, enabledServices: undefined,
    });
    assert.deepEqual(business.enabledServices, []);
    assert.equal(business.requestedInventory, true);
  });

  it("still refuses no services and no request, with the same message",
      async () => {
        for (const extra of [
          {enabledServices: []},
          {enabledServices: [], requestInventory: false},
          {enabledServices: ["inventory"]},
          {enabledServices: [], requestInventory: "true"},
          {enabledServices: [], requestInventory: 1},
          {enabledServices: undefined},
        ]) {
          await assert.rejects(apply(extra), (error) =>
            error.code === "invalid-argument" &&
            error.message === "Choose at least one business service",
          JSON.stringify(extra));
        }
      });

  it("lets the admin approve an Inventory-only shop, then switch it on",
      async () => {
        const ADMIN = "inv-test-request-admin";
        const {answer} = await apply({
          requestInventory: true, enabledServices: [],
        });
        const id = answer.businessId;
        const ref = db.collection("businesses").doc(id);
        // Stripe is the one approval gate an Inventory-only shop still has;
        // it needs no service documents.
        await ref.update({
          stripeAccountId: "acct_inventory_only", chargesEnabled: true,
          payoutsEnabled: true,
        });
        // The console may omit the services list; that must NOT hand the
        // shop every default service.
        const review = await functions.reviewBusinessApplication.run({
          auth: {uid: ADMIN, token: {}},
          data: {businessId: id, action: "approve"},
        });
        assert.equal(review.success, true);
        const approved = (await ref.get()).data();
        assert.equal(approved.status, "approved");
        assert.deepEqual(approved.enabledServices, []);
        assert.equal(approved.requestedInventory, true);
        const on = await functions.setBusinessInventoryService.run({
          auth: {uid: ADMIN, token: {}},
          data: {businessId: id, enabled: true},
        });
        assert.deepEqual(on.enabledServices, ["inventory"]);
        const live = (await ref.get()).data();
        assert.deepEqual(live.enabledServices, ["inventory"]);
        assert.equal(live.requestedInventory, false);
        // The owner can now open the Inventory callables.
        const ownerUid = live.ownerUid;
        const made = await functions.createInventoryItem.run({
          auth: {uid: ownerUid, token: {}},
          data: {businessId: id, name: "Soap", priceCents: 500, quantity: 3},
        });
        assert.ok(made.itemId);
      });

  it("does not wipe a running business that asks for Inventory only",
      async () => {
        const first = await apply({enabledServices: ["freight"]},
            "Reapply Shop");
        const uid = first.uid;
        const again = await functions.submitBusinessApplication.run({
          auth: {uid, token: {}},
          data: {
            ownerName: "Applicant", ownerPhone: "+224620000077",
            businessName: "Reapply Shop", enabledServices: [],
            requestInventory: true, addressLine1: "1 Test Road",
            city: "Conakry", country: "Guinea",
          },
        });
        assert.equal(again.businessId, first.answer.businessId);
        assert.deepEqual(again.enabledServices, ["freight"]);
        const stored = (await db.collection("businesses")
            .doc(first.answer.businessId).get()).data();
        assert.deepEqual(stored.enabledServices, ["freight"]);
        assert.equal(stored.requestedInventory, true);
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

// ===========================================================================
// Categories and stores (v2). Each block owns its business so the numbers
// are exact; v1-shaped payloads (no storeId, no categoryId, `category` text,
// `quantity`) are replayed throughout.
// ===========================================================================

const callIn = (biz) => (name, data, uid) => functions[name].run({
  auth: {uid, token: {}}, data: {businessId: biz, ...data}});

async function seedBusiness(biz, users) {
  await db.collection("businesses").doc(biz).set({
    name: biz, status: "approved", enabledServices: ["inventory"]});
  await Promise.all(Object.entries(users).map(([uid, profile]) =>
    db.collection("users").doc(uid).set({
      email: `${uid}@example.test`, fullName: uid, ...profile})));
}

describe("v2 callables are gated like the rest", () => {
  it("refuses every new callable while the service is off", async () => {
    const off = (name, data) => functions[name].run({
      auth: {uid: OFF_OWNER, token: {}}, data: {businessId: BIZ_OFF, ...data},
    });
    const calls = [
      ["createInventoryCategory", {name: "Skin"}],
      ["renameInventoryCategory", {categoryId: "x", name: "Skin"}],
      ["archiveInventoryCategory", {categoryId: "x", archived: true}],
      ["syncInventoryCategories", {}],
      ["createInventoryStore", {name: "Annex"}],
      ["updateInventoryStore", {storeId: "x", name: "Annex"}],
      ["archiveInventoryStore", {storeId: "x", archived: true}],
      ["setInventoryStaffAccess", {userId: "x", homeStoreId: "",
        allStores: false}],
      ["transferInventoryStock", {itemId: "x", fromStoreId: "a",
        toStoreId: "b", quantity: 1}],
    ];
    for (const [name, data] of calls) {
      await assert.rejects(off(name, data),
          refusal("service_disabled", "failed-precondition"), name);
    }
  });

  it("refuses staff without the inventory section", async () => {
    for (const name of ["createInventoryCategory", "createInventoryStore",
      "transferInventoryStock"]) {
      await assert.rejects(call(name, {name: "x"}, NO_INVENTORY),
          (error) => error.code === "permission-denied", name);
    }
  });
});

describe("categories", () => {
  const CB = "inv-cat-biz";
  const C_OWNER = "inv-cat-owner";
  const C_STAFF = "inv-cat-staff";
  const c = callIn(CB);
  const categoriesOf = async () => (await db.collection("inventoryCategories")
      .where("businessId", "==", CB).get()).docs
      .map((d) => ({id: d.id, ...d.data()}));
  const itemRow = async (id) => (await db.collection("inventoryItems").doc(id)
      .get()).data();
  const mk = async (extra = {}) => (await c("createInventoryItem", {
    name: `Product ${++keys}`, priceCents: 1000, quantity: 5, ...extra,
  }, C_OWNER)).itemId;

  before(async () => {
    await seedBusiness(CB, {
      [C_OWNER]: {role: "businessOwner", businessId: CB},
      [C_STAFF]: {role: "staff", businessId: CB,
        businessPermissions: ["inventory"]},
    });
  });

  it("creates a category, trimmed, and refuses a duplicate in any case",
      async () => {
        const made = await c("createInventoryCategory",
            {name: "  Skin   care "}, C_STAFF);
        assert.equal(made.name, "Skin care");
        const row = (await db.collection("inventoryCategories")
            .doc(made.categoryId).get()).data();
        assert.deepEqual(
            [row.businessId, row.name, row.nameKey, row.archived,
              row.createdByStaffId],
            [CB, "Skin care", "skin care", false, C_STAFF]);
        await assert.rejects(
            c("createInventoryCategory", {name: "SKIN CARE"}, C_OWNER),
            (error) => {
              assert.equal(error.details.reason, "category_name_taken");
              assert.equal(error.code, "already-exists");
              assert.equal(error.details.categoryId, made.categoryId);
              return true;
            });
        await assert.rejects(c("createInventoryCategory", {name: "  "},
            C_OWNER), refusal("category_name_required", "invalid-argument"));
        await assert.rejects(c("createInventoryCategory",
            {name: "x".repeat(61)}, C_OWNER), refusal("category_too_long"));
        // Two businesses may both have a "Skin care".
        await functions.createInventoryCategory.run({
          auth: {uid: OWNER, token: {}},
          data: {businessId: BIZ, name: "Skin care"}});
      });

  it("gives a product the category it picked, with a name snapshot",
      async () => {
        const {categoryId} = await c("createInventoryCategory",
            {name: "Hair"}, C_OWNER);
        const id = await mk({categoryId});
        const row = await itemRow(id);
        assert.equal(row.categoryId, categoryId);
        assert.equal(row.category, "Hair");
        await assert.rejects(mk({categoryId: "no-such-category"}),
            refusal("category_not_found", "not-found"));
        await assert.rejects(mk({categoryId: "a/b"}),
            refusal("category_not_found"));
      });

  it("finds a typed name in the list, or creates it, never twice",
      async () => {
        const before = (await categoriesOf()).length;
        const ids = await Promise.all(Array.from({length: 4}, (_, i) =>
          mk({category: i % 2 ? "Candles" : "  candles "})));
        const rows = await Promise.all(ids.map(itemRow));
        assert.equal(new Set(rows.map((r) => r.categoryId)).size, 1);
        assert.ok(rows.every((r) => r.categoryId));
        assert.equal((await categoriesOf()).length, before + 1);
        // The snapshot is the category's own spelling, not what was typed.
        const casing = new Set(rows.map((r) => r.category));
        assert.equal(casing.size, 1);
        // An existing category is matched by name, whatever the case.
        const again = await mk({category: "HAIR"});
        assert.equal((await itemRow(again)).category, "Hair");
        assert.equal((await categoriesOf()).length, before + 1);
      });

  it("keeps the v1 shape: a `category` text works and an empty one clears",
      async () => {
        const id = await mk({category: "Oils"});
        const row = await itemRow(id);
        assert.equal(row.category, "Oils");
        assert.ok(row.categoryId);
        await c("updateInventoryItem", {itemId: id, category: ""}, C_OWNER);
        const cleared = await itemRow(id);
        assert.equal(cleared.category, "");
        assert.equal(cleared.categoryId, "");
        await c("updateInventoryItem", {itemId: id, category: "Oils"},
            C_OWNER);
        assert.equal((await itemRow(id)).categoryId, row.categoryId);
        await c("updateInventoryItem", {itemId: id, categoryId: ""}, C_OWNER);
        assert.equal((await itemRow(id)).categoryId, "");
        await c("updateInventoryItem", {itemId: id, categoryId: row.categoryId},
            C_OWNER);
        assert.equal((await itemRow(id)).category, "Oils");
      });

  it("renames a category on its products but not on past sales",
      async () => {
        const {categoryId} = await c("createInventoryCategory",
            {name: "Bags"}, C_OWNER);
        const ids = await Promise.all([mk({categoryId}), mk({categoryId})]);
        const sold = await c("recordInventorySale", {
          clientRequestId: requestId(), paymentMethod: "cash",
          lines: [{itemId: ids[0], quantity: 1, soldPriceCents: 1000}]},
        C_OWNER);
        const done = await c("renameInventoryCategory",
            {categoryId, name: "Handbags"}, C_STAFF);
        assert.equal(done.itemsUpdated, 2);
        assert.equal(done.complete, true);
        for (const id of ids) {
          const row = await itemRow(id);
          assert.equal(row.category, "Handbags");
          assert.equal(row.categoryId, categoryId);
        }
        const sale = (await db.collection("inventorySales").doc(sold.saleId)
            .get()).data();
        assert.equal(sale.lines[0].category, "Bags");
        assert.equal(sale.lines[0].categoryId, categoryId);
        // The old name is free again, the new one is taken.
        await c("createInventoryCategory", {name: "bags"}, C_OWNER);
        await assert.rejects(
            c("renameInventoryCategory", {categoryId, name: "BAGS"}, C_OWNER),
            refusal("category_name_taken"));
        // Renaming in place (only the case) is fine.
        await c("renameInventoryCategory", {categoryId, name: "HANDBAGS"},
            C_OWNER);
        assert.equal((await itemRow(ids[1])).category, "HANDBAGS");
        await assert.rejects(c("renameInventoryCategory",
            {categoryId: "nope", name: "Z"}, C_OWNER),
        refusal("category_not_found"));
        await assert.rejects(c("renameInventoryCategory",
            {categoryId, name: ""}, C_OWNER),
        refusal("category_name_required"));
      });

  it("archives a category and keeps it on the products", async () => {
    const {categoryId} = await c("createInventoryCategory",
        {name: "Seasonal"}, C_OWNER);
    const id = await mk({categoryId});
    await c("archiveInventoryCategory", {categoryId, archived: true},
        C_STAFF);
    assert.equal((await db.collection("inventoryCategories").doc(categoryId)
        .get()).get("archived"), true);
    assert.equal((await itemRow(id)).categoryId, categoryId);
    // The picker no longer offers it, but editing the product keeps it.
    await c("updateInventoryItem", {itemId: id, categoryId, name: "Kept"},
        C_OWNER);
    await assert.rejects(mk({categoryId}), refusal("category_not_found"));
    await assert.rejects(c("archiveInventoryCategory",
        {categoryId, archived: "yes"}, C_OWNER), refusal("archived_invalid"));
    // Typing its name brings it back instead of making a twin.
    const typed = await mk({category: "seasonal"});
    assert.equal((await itemRow(typed)).categoryId, categoryId);
    assert.equal((await db.collection("inventoryCategories").doc(categoryId)
        .get()).get("archived"), false);
  });

  it("matches legacy typed categories into the list as they are seen",
      async () => {
        const legacy = await db.collection("inventoryItems").add({
          businessId: CB, name: "Legacy bar", code: `IT-L${++keys}`,
          priceCents: 500, costCents: 100, quantity: 4, lowStockAt: null,
          category: "Soap", photoUrl: "", archived: false, countWasOff: false,
        });
        const twin = await db.collection("inventoryItems").add({
          businessId: CB, name: "Legacy bar 2", code: `IT-L${++keys}`,
          priceCents: 500, costCents: null, quantity: 4, lowStockAt: null,
          category: " Soap ", photoUrl: "", archived: false,
          countWasOff: false,
        });
        const s = await c("getInventorySummary", {range: "today"}, C_OWNER);
        assert.equal(s.truncated, false);
        const cats = (await categoriesOf()).filter((x) => x.nameKey === "soap");
        assert.equal(cats.length, 1);
        for (const ref of [legacy, twin]) {
          const row = (await ref.get()).data();
          assert.equal(row.categoryId, cats[0].id);
          assert.equal(row.category, "Soap");
        }
        // Idempotent: a second look makes nothing new.
        const total = (await categoriesOf()).length;
        await c("getInventorySummary", {range: "today"}, C_OWNER);
        assert.equal((await categoriesOf()).length, total);
        const synced = await c("syncInventoryCategories", {}, C_STAFF);
        assert.equal(synced.remaining, 0);
      });

  it("snapshots the category on a sale line, legacy products included",
      async () => {
        const legacy = await db.collection("inventoryItems").add({
          businessId: CB, name: "Old Hair thing", code: `IT-L${++keys}`,
          priceCents: 500, costCents: null, quantity: 4, lowStockAt: null,
          category: "hair", photoUrl: "", archived: false, countWasOff: false,
        });
        const sale = await c("recordInventorySale", {
          clientRequestId: requestId(), paymentMethod: "cash",
          lines: [{itemId: legacy.id, quantity: 1, soldPriceCents: 500}]},
        C_OWNER);
        const line = (await db.collection("inventorySales").doc(sale.saleId)
            .get()).data().lines[0];
        const hair = (await categoriesOf()).find((x) => x.nameKey === "hair");
        assert.equal(line.categoryId, hair.id);
        assert.equal(line.category, "hair");
      });

  describe("byCategory", () => {
    const RB = "inv-cat-report-biz";
    const r = callIn(RB);
    const R_OWNER = "inv-cat-report-owner";
    before(async () => {
      await seedBusiness(RB, {
        [R_OWNER]: {role: "businessOwner", businessId: RB}});
    });
    const mkr = async (extra) => (await r("createInventoryItem", {
      priceCents: 1000, quantity: 20, ...extra}, R_OWNER)).itemId;
    const ring = (lines) => r("recordInventorySale", {
      clientRequestId: requestId(), paymentMethod: "cash", lines}, R_OWNER);

    it("groups revenue and profit, drops voided sales, sorts by revenue",
        async () => {
          const food = (await r("createInventoryCategory", {name: "Food"},
              R_OWNER)).categoryId;
          const gear = (await r("createInventoryCategory", {name: "Gear"},
              R_OWNER)).categoryId;
          const rice = await mkr({name: "Rice", categoryId: food,
            costCents: 300});
          const tape = await mkr({name: "Tape", categoryId: gear,
            costCents: null});
          const misc = await mkr({name: "Misc"});
          const sold = await ring([
            {itemId: rice, quantity: 2, soldPriceCents: 800},
            {itemId: tape, quantity: 3, soldPriceCents: 1000},
            {itemId: misc, quantity: 1, soldPriceCents: 250}]);
          const gone = await ring([
            {itemId: tape, quantity: 5, soldPriceCents: 1000}]);
          await r("voidInventorySale", {saleId: gone.saleId}, R_OWNER);
          // A line written before categories existed: no snapshot at all.
          await db.collection("inventorySales").add({
            businessId: RB, voided: false, totalCents: 1000,
            createdAt: admin.firestore.Timestamp.now(),
            lines: [{itemId: rice, name: "Rice", quantity: 1,
              soldPriceCents: 1000, listPriceCents: 1000, costCents: 300}]});
          const s = await r("getInventorySummary", {range: "today"}, R_OWNER);
          assert.deepEqual(s.byCategory, [
            {categoryId: gear, name: "Gear", itemsSold: 3,
              revenueCents: 3000, profitCents: 0},
            {categoryId: food, name: "Food", itemsSold: 3,
              revenueCents: 2600, profitCents: 2600 - 900},
            {categoryId: "", name: "Uncategorized", itemsSold: 1,
              revenueCents: 250, profitCents: 0}]);
          assert.equal(s.revenueCents, 5850);
          // The category's current name shows on past sales.
          await r("renameInventoryCategory",
              {categoryId: food, name: "Groceries"}, R_OWNER);
          const after = await r("getInventorySummary", {range: "today"},
              R_OWNER);
          assert.ok(after.byCategory.some((e) => e.categoryId === food &&
            e.name === "Groceries"));
          assert.ok(sold.saleId);
          assert.deepEqual(after.byStore, []);
          assert.equal(after.multiStore, false);
        });
  });
});

describe("stores", () => {
  const SB = "inv-store-biz";
  const OWN = "inv-store-owner";
  const HOME_A = "inv-store-clerk-a";
  const HOME_B = "inv-store-clerk-b";
  const ROVER = "inv-store-rover";
  const NOHOME = "inv-store-nohome";
  const FOREIGN = "inv-store-foreign-staff";
  const s = callIn(SB);
  const row = async (id) => (await db.collection("inventoryItems").doc(id)
      .get()).data();
  const stockAt = async (itemId, storeId) => {
    const doc = await db.collection("inventoryStock")
        .doc(`${itemId}__${storeId}`).get();
    return doc.exists ? doc.data() : null;
  };
  const stockRows = async (itemId) => (await db.collection("inventoryStock")
      .where("businessId", "==", SB).where("itemId", "==", itemId).get())
      .docs.map((d) => d.data());
  // The product's total always equals the sum of its stores' counts.
  const sumRows = async (itemId) => (await stockRows(itemId))
      .reduce((n, x) => n + x.quantity, 0);
  const assertInvariant = async (itemId) => {
    const item = await row(itemId);
    assert.equal(item.storeStock, true, "per-store rows exist");
    assert.equal(item.quantity, await sumRows(itemId), "total = sum of rows");
  };
  const config = async () => (await db.collection("inventoryConfig")
      .doc(SB).get()).data();
  const moves = async (itemId) => (await db.collection("inventoryMovements")
      .where("businessId", "==", SB).where("itemId", "==", itemId).get())
      .docs.map((d) => d.data())
      .sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis());
  const mk = async (extra = {}, uid = OWN) => (await s("createInventoryItem", {
    name: `Item ${++keys}`, priceCents: 1000, costCents: 400, quantity: 10,
    lowStockAt: 2, ...extra,
  }, uid)).itemId;
  const ring = (itemId, quantity, extra = {}, uid = OWN) =>
    s("recordInventorySale", {clientRequestId: requestId(),
      paymentMethod: "cash", lines: [{itemId, quantity,
        soldPriceCents: 1000}], ...extra}, uid);

  let main;
  let annex;
  let depot;
  let legacyA;
  let legacyB;
  let legacySale;

  before(async () => {
    await seedBusiness(SB, {
      [OWN]: {role: "businessOwner", businessId: SB},
      [HOME_A]: {role: "staff", businessId: SB,
        businessPermissions: ["inventory"]},
      [HOME_B]: {role: "staff", businessId: SB,
        businessPermissions: ["inventory"]},
      [ROVER]: {role: "staff", businessId: SB,
        businessPermissions: ["inventory"]},
      [NOHOME]: {role: "staff", businessId: SB,
        businessPermissions: ["inventory"]},
      [FOREIGN]: {role: "staff", businessId: BIZ_OFF,
        businessPermissions: ["inventory"]},
    });
    main = `${SB}_main`;
  });

  describe("a single-store business is untouched", () => {
    it("has no stores, no stock rows and no storeId anywhere", async () => {
      legacyA = await mk({name: "Legacy A", quantity: 10, category: "Soap"});
      legacyB = await mk({name: "Legacy B", quantity: 3});
      const sale = await ring(legacyA, 1);
      legacySale = sale.saleId;
      assert.equal(sale.storeId, undefined);
      assert.equal((await row(legacyA)).quantity, 9);
      assert.equal((await row(legacyA)).storeStock, undefined);
      assert.equal((await db.collection("inventoryStock")
          .where("businessId", "==", SB).get()).size, 0);
      assert.equal((await db.collection("inventoryStores")
          .where("businessId", "==", SB).get()).size, 0);
      assert.equal((await db.collection("inventoryConfig").doc(SB).get())
          .exists, false);
      const stored = (await db.collection("inventorySales").doc(legacySale)
          .get()).data();
      assert.equal("storeId" in stored, false);
      const [move] = (await moves(legacyA)).slice(-1);
      assert.equal("storeId" in move, false);
      const adjusted = await s("adjustInventoryStock",
          {itemId: legacyB, mode: "add", quantity: 2}, OWN);
      assert.deepEqual(adjusted, {success: true, quantity: 5});
      const summary = await s("getInventorySummary",
          {range: "today", timeZone: "UTC"}, OWN);
      assert.equal(summary.multiStore, false);
      assert.deepEqual(summary.byStore, []);
    });

    it("refuses a store id and stock by store while there are no stores",
        async () => {
          await assert.rejects(ring(legacyA, 1, {storeId: "x"}),
              refusal("store_not_found"));
          await assert.rejects(s("adjustInventoryStock", {itemId: legacyA,
            mode: "add", quantity: 1, storeId: "x"}, OWN),
          refusal("store_not_found"));
          await assert.rejects(s("createInventoryItem", {name: "n",
            priceCents: 1, stock: {x: 1}}, OWN), refusal("store_not_found"));
          await assert.rejects(s("transferInventoryStock", {itemId: legacyA,
            fromStoreId: "a", toStoreId: "b", quantity: 1}, OWN),
          refusal("store_not_found"));
        });
  });

  describe("adding a second store", () => {
    it("is for the owner only and names every problem", async () => {
      await assert.rejects(s("createInventoryStore", {name: "Annex"}, HOME_A),
          refusal("owner_only", "permission-denied"));
      await assert.rejects(s("createInventoryStore", {name: " "}, OWN),
          refusal("store_name_required", "invalid-argument"));
      await assert.rejects(s("createInventoryStore", {name: "x".repeat(121)},
          OWN), refusal("name_too_long"));
      await assert.rejects(s("createInventoryStore",
          {name: "Annex", phone: "9".repeat(41)}, OWN),
      refusal("store_field_too_long"));
      assert.equal((await db.collection("inventoryStores")
          .where("businessId", "==", SB).get()).size, 0);
    });

    it("turns Main into a real store and keeps products and counts",
        async () => {
          const made = await s("createInventoryStore",
              {name: "Annex", address: "12 Rue Neuve", phone: "555-0100"}, OWN);
          annex = made.storeId;
          assert.equal(made.mainStoreId, main);
          const stores = (await db.collection("inventoryStores")
              .where("businessId", "==", SB).get()).docs
              .map((d) => ({id: d.id, ...d.data()}));
          assert.deepEqual(stores.map((x) => [x.id, x.name, x.isMain,
            x.archived]).sort(),
          [[annex, "Annex", false, false], [main, "Main store", true, false]]
              .sort());
          const a = stores.find((x) => x.id === annex);
          assert.deepEqual([a.address, a.phone, a.createdByStaffId],
              ["12 Rue Neuve", "555-0100", OWN]);
          const cfg = await config();
          assert.deepEqual([cfg.storesConverted, cfg.mainStoreId,
            cfg.multiStore, cfg.stockPending], [true, main, true, false]);
          // Every existing product moved under Main, totals untouched.
          assert.equal((await row(legacyA)).quantity, 9);
          assert.equal((await stockAt(legacyA, main)).quantity, 9);
          assert.equal((await stockAt(legacyB, main)).quantity, 5);
          await assertInvariant(legacyA);
          await assertInvariant(legacyB);
          // Old documents were not rewritten.
          const sale = (await db.collection("inventorySales").doc(legacySale)
              .get()).data();
          assert.equal("storeId" in sale, false);
        });

    it("adds a third store without converting again", async () => {
      const made = await s("createInventoryStore", {name: "Depot"}, OWN);
      depot = made.storeId;
      assert.equal(made.mainStoreId, main);
      assert.equal((await db.collection("inventoryStores")
          .where("businessId", "==", SB).get()).size, 3);
      assert.equal((await config()).mainStoreId, main);
    });

    it("renames and edits a store, owner only", async () => {
      await assert.rejects(s("updateInventoryStore",
          {storeId: annex, name: "X"}, HOME_A), refusal("owner_only"));
      await assert.rejects(s("updateInventoryStore", {storeId: annex}, OWN),
          refusal("nothing_to_update"));
      await assert.rejects(s("updateInventoryStore",
          {storeId: "nope", name: "X"}, OWN), refusal("store_not_found"));
      await assert.rejects(s("updateInventoryStore",
          {storeId: annex, name: ""}, OWN), refusal("store_name_required"));
      const done = await s("updateInventoryStore",
          {storeId: annex, name: "Annex Shop", phone: "555-0199"}, OWN);
      assert.deepEqual(done.changed, ["name", "phone"]);
      const doc = (await db.collection("inventoryStores").doc(annex).get())
          .data();
      assert.deepEqual([doc.name, doc.phone, doc.address],
          ["Annex Shop", "555-0199", "12 Rue Neuve"]);
      await s("updateInventoryStore", {storeId: main, name: "Main store"}, OWN);
    });
  });

  describe("who may use which store", () => {
    it("sets staff access, owner only", async () => {
      await assert.rejects(s("setInventoryStaffAccess", {userId: HOME_A,
        homeStoreId: annex, allStores: false}, HOME_B),
      refusal("owner_only", "permission-denied"));
      await assert.rejects(s("setInventoryStaffAccess", {userId: HOME_A,
        homeStoreId: annex, allStores: "yes"}, OWN),
      refusal("all_stores_invalid"));
      await assert.rejects(s("setInventoryStaffAccess", {userId: HOME_A,
        homeStoreId: "nope", allStores: false}, OWN),
      refusal("store_not_found"));
      await assert.rejects(s("setInventoryStaffAccess", {userId: FOREIGN,
        homeStoreId: annex, allStores: false}, OWN),
      refusal("user_not_found", "not-found"));
      await assert.rejects(s("setInventoryStaffAccess", {userId: OWN,
        homeStoreId: annex, allStores: false}, OWN),
      refusal("user_not_found"));
      await s("setInventoryStaffAccess",
          {userId: HOME_A, homeStoreId: annex, allStores: false}, OWN);
      await s("setInventoryStaffAccess",
          {userId: HOME_B, homeStoreId: main, allStores: false}, OWN);
      await s("setInventoryStaffAccess",
          {userId: ROVER, homeStoreId: "", allStores: true}, OWN);
      const a = (await db.collection("users").doc(HOME_A).get()).data();
      assert.deepEqual([a.inventoryHomeStoreId, a.inventoryAllStores],
          [annex, false]);
      const r = (await db.collection("users").doc(ROVER).get()).data();
      assert.deepEqual([r.inventoryHomeStoreId, r.inventoryAllStores],
          ["", true]);
    });

    it("refuses selling and stocking for staff with no home store",
        async () => {
          const id = await mk({quantity: 4});
          await assert.rejects(ring(id, 1, {}, NOHOME),
              refusal("home_store_required", "failed-precondition"));
          await assert.rejects(s("adjustInventoryStock", {itemId: id,
            mode: "add", quantity: 1}, NOHOME), refusal("home_store_required"));
          await assert.rejects(s("getInventorySummary", {range: "today"},
              NOHOME), refusal("home_store_required"));
          // Naming a store does not get around it.
          await assert.rejects(ring(id, 1, {storeId: main}, NOHOME),
              refusal("store_not_allowed", "permission-denied"));
          assert.equal((await row(id)).quantity, 4);
        });

    it("puts a v1 payload on the caller's home store, the owner's on Main",
        async () => {
          const id = await mk({quantity: 6});
          // Born at Main (the owner has no home store): 6 there.
          assert.equal((await stockAt(id, main)).quantity, 6);
          await s("adjustInventoryStock",
              {itemId: id, mode: "add", quantity: 4}, HOME_A);
          assert.equal((await stockAt(id, annex)).quantity, 4);
          assert.equal((await stockAt(id, main)).quantity, 6);
          assert.equal((await row(id)).quantity, 10);
          // A v1 sale from Annex's clerk takes from Annex...
          const sale = await ring(id, 3, {}, HOME_A);
          assert.equal(sale.storeId, annex);
          assert.equal((await stockAt(id, annex)).quantity, 1);
          // ...and the owner's from Main, with no storeId sent.
          const own = await ring(id, 2);
          assert.equal(own.storeId, main);
          assert.equal((await stockAt(id, main)).quantity, 4);
          assert.equal((await row(id)).quantity, 5);
          await assertInvariant(id);
          const stored = (await db.collection("inventorySales")
              .doc(sale.saleId).get()).data();
          assert.deepEqual([stored.storeId, stored.storeName],
              [annex, "Annex Shop"]);
          const last = (await moves(id)).pop();
          assert.equal(last.storeId, main);
        });

    it("keeps staff to their own store and lets all-stores staff roam",
        async () => {
          const id = await mk({stock: {[main]: 5, [annex]: 5}});
          await assert.rejects(ring(id, 1, {storeId: main}, HOME_A),
              refusal("store_not_allowed"));
          await assert.rejects(s("adjustInventoryStock", {itemId: id,
            mode: "add", quantity: 1, storeId: main}, HOME_A),
          refusal("store_not_allowed"));
          await assert.rejects(s("createInventoryItem", {name: "x",
            priceCents: 5, stock: {[main]: 1}}, HOME_A),
          refusal("store_not_allowed"));
          await ring(id, 1, {storeId: annex}, HOME_A);
          const roam = await ring(id, 1, {storeId: annex}, ROVER);
          assert.equal(roam.storeId, annex);
          // No storeId from an all-stores member without a home: Main.
          assert.equal((await ring(id, 1, {}, ROVER)).storeId, main);
          assert.equal((await stockAt(id, annex)).quantity, 3);
          assert.equal((await stockAt(id, main)).quantity, 4);
          await assertInvariant(id);
          await assert.rejects(ring(id, 1, {storeId: "nope"}, OWN),
              refusal("store_not_found", "not-found"));
        });

    it("starts a product in several stores with a `stock` map", async () => {
      const made = await s("createInventoryItem", {
        name: "Mapped", priceCents: 700, stock: {[main]: 2, [annex]: 3,
          [depot]: 0}}, OWN);
      const item = await row(made.itemId);
      assert.equal(item.quantity, 5);
      assert.equal(item.storeStock, true);
      assert.deepEqual((await stockRows(made.itemId))
          .map((x) => [x.storeId, x.quantity]).sort(),
      [[annex, 3], [depot, 0], [main, 2]].sort());
      const initial = (await moves(made.itemId)).filter(
          (m) => m.type === "initial");
      assert.deepEqual(initial.map((m) => [m.storeId, m.delta]).sort(),
          [[annex, 3], [main, 2]].sort());
      await assert.rejects(s("createInventoryItem", {name: "x", priceCents: 5,
        stock: {[main]: -1}}, OWN), refusal("quantity_invalid"));
      await assert.rejects(s("createInventoryItem", {name: "x", priceCents: 5,
        stock: {}}, OWN), refusal("quantity_invalid"));
      await assert.rejects(s("createInventoryItem", {name: "x", priceCents: 5,
        stock: {nope: 1}}, OWN), refusal("store_not_found"));
      // `quantity` plus a storeId puts the count in that store.
      const at = await s("createInventoryItem", {name: "At depot",
        priceCents: 5, quantity: 4, storeId: depot}, OWN);
      assert.equal((await stockAt(at.itemId, depot)).quantity, 4);
      assert.equal(await stockAt(at.itemId, main), null);
    });
  });

  describe("selling per store", () => {
    it("floors and flags the count of that store only", async () => {
      const id = await mk({stock: {[main]: 10, [annex]: 1}});
      const sale = await ring(id, 3, {storeId: annex}, OWN);
      assert.deepEqual(sale.warnings, [{itemId: id, reason: "count_was_off"}]);
      assert.equal((await stockAt(id, annex)).quantity, 0);
      assert.equal((await stockAt(id, annex)).countWasOff, true);
      assert.equal((await stockAt(id, main)).countWasOff, false);
      assert.equal((await stockAt(id, main)).quantity, 10);
      assert.equal((await row(id)).quantity, 10);
      assert.equal((await row(id)).countWasOff, true);
      await assertInvariant(id);
      // Main selling is unaffected by Annex being off.
      const fine = await ring(id, 2, {storeId: main}, OWN);
      assert.deepEqual(fine.warnings, []);
      // Setting the count at Annex clears its flag and the product's.
      const set = await s("adjustInventoryStock", {itemId: id, mode: "set",
        quantity: 4, storeId: annex}, OWN);
      assert.deepEqual([set.quantity, set.totalQuantity, set.storeId],
          [4, 12, annex]);
      assert.equal((await stockAt(id, annex)).countWasOff, false);
      assert.equal((await row(id)).countWasOff, false);
      await assertInvariant(id);
    });

    it("lets two simultaneous last-piece sales on one store both through",
        async () => {
          const id = await mk({stock: {[main]: 5, [annex]: 1}});
          // Each send keeps its own key: one the emulator gives up on is
          // sent again as the same sale, not booked twice.
          const ringOnce = (uid) => {
            const extra = {clientRequestId: requestId(), storeId: annex};
            return untilSettled(() => ring(id, 1, extra, uid));
          };
          const results = await Promise.all([ringOnce(HOME_A),
            ringOnce(ROVER)]);
          assert.equal(results.length, 2);
          assert.equal(results.filter((r) => r.warnings.length > 0).length, 1);
          assert.equal((await stockAt(id, annex)).quantity, 0);
          assert.equal((await stockAt(id, annex)).countWasOff, true);
          assert.equal((await row(id)).quantity, 5);
          await assertInvariant(id);
          const sold = (await moves(id)).filter((m) => m.type === "sale");
          assert.deepEqual(sold.map((m) => m.delta).sort(), [-1, 0]);
        });

    it("answers a retried sale with the same sale and stock once",
        async () => {
          const id = await mk({stock: {[annex]: 5}});
          const key = requestId();
          const first = await ring(id, 2, {clientRequestId: key,
            storeId: annex}, HOME_A);
          const again = await ring(id, 2, {clientRequestId: key}, HOME_A);
          assert.equal(first.replayed, false);
          assert.equal(again.replayed, true);
          assert.equal(again.saleId, first.saleId);
          assert.equal(again.storeId, annex);
          assert.equal((await stockAt(id, annex)).quantity, 3);
          await assertInvariant(id);
        });

    it("refuses an archived or foreign product and writes nothing",
        async () => {
          const id = await mk({quantity: 3});
          await s("archiveInventoryItem", {itemId: id, archived: true}, OWN);
          await assert.rejects(ring(id, 1), refusal("item_archived"));
          await assert.rejects(ring("nope", 1), refusal("item_not_found"));
          assert.equal((await stockAt(id, main)).quantity, 3);
        });

    it("serves an unmaterialised product from the Main store", async () => {
      // A product the lazy rule has never touched: no rows, no marker.
      const ref = await db.collection("inventoryItems").add({
        businessId: SB, name: "Lazy", code: `IT-Z${++keys}`, priceCents: 1000,
        costCents: null, quantity: 7, lowStockAt: null, category: "",
        categoryId: "", photoUrl: "", archived: false, countWasOff: false});
      const id = ref.id;
      // A sale at Annex finds nothing there (0, flagged) and must not lose
      // Main's 7: Main's row is written in the same transaction.
      const odd = await ring(id, 1, {storeId: annex}, ROVER);
      assert.equal(odd.warnings.length, 1);
      assert.equal((await stockAt(id, main)).quantity, 7);
      assert.equal((await stockAt(id, annex)).quantity, 0);
      assert.equal((await row(id)).quantity, 7);
      await assertInvariant(id);
      // And a transfer out of Main on a second such product.
      const two = (await db.collection("inventoryItems").add({
        businessId: SB, name: "Lazy 2", code: `IT-Z${++keys}`,
        priceCents: 1000, costCents: null, quantity: 7, lowStockAt: null,
        category: "", categoryId: "", photoUrl: "", archived: false,
        countWasOff: false})).id;
      await s("transferInventoryStock", {itemId: two, fromStoreId: main,
        toStoreId: annex, quantity: 3}, OWN);
      assert.equal((await stockAt(two, main)).quantity, 4);
      assert.equal((await stockAt(two, annex)).quantity, 3);
      await assertInvariant(two);
      // And a count set at Depot keeps Main's pieces too.
      const three = (await db.collection("inventoryItems").add({
        businessId: SB, name: "Lazy 3", code: `IT-Z${++keys}`,
        priceCents: 1000, costCents: null, quantity: 7, lowStockAt: null,
        category: "", categoryId: "", photoUrl: "", archived: false,
        countWasOff: false})).id;
      const set = await s("adjustInventoryStock", {itemId: three,
        mode: "add", quantity: 2, storeId: depot}, OWN);
      assert.deepEqual([set.quantity, set.totalQuantity], [2, 9]);
      await assertInvariant(three);
    });
  });

  describe("voiding restores to the store of the sale", () => {
    it("puts stock back where it left, once", async () => {
      const id = await mk({stock: {[main]: 5, [annex]: 5}});
      const sale = await ring(id, 2, {storeId: annex}, HOME_A);
      await assert.rejects(s("voidInventorySale", {saleId: sale.saleId},
          HOME_B), refusal("store_not_allowed"));
      assert.equal((await stockAt(id, annex)).quantity, 3);
      await s("voidInventorySale", {saleId: sale.saleId}, HOME_A);
      assert.equal((await stockAt(id, annex)).quantity, 5);
      assert.equal((await stockAt(id, main)).quantity, 5);
      assert.equal((await row(id)).quantity, 10);
      await assertInvariant(id);
      await assert.rejects(s("voidInventorySale", {saleId: sale.saleId}, OWN),
          refusal("sale_voided"));
      const back = (await moves(id)).filter((m) => m.type === "void");
      assert.deepEqual(back.map((m) => [m.storeId, m.delta]),
          [[annex, 2]]);
    });

    it("restores only what left a floored store", async () => {
      const id = await mk({stock: {[main]: 5, [annex]: 1}});
      const sale = await ring(id, 4, {storeId: annex}, OWN);
      assert.equal((await stockAt(id, annex)).quantity, 0);
      await s("voidInventorySale", {saleId: sale.saleId}, OWN);
      assert.equal((await stockAt(id, annex)).quantity, 1);
      assert.equal((await row(id)).quantity, 6);
      await assertInvariant(id);
    });

    it("sends a sale from before the stores back to Main", async () => {
      assert.equal((await stockAt(legacyA, main)).quantity, 9);
      await s("voidInventorySale", {saleId: legacySale}, HOME_B);
      assert.equal((await stockAt(legacyA, main)).quantity, 10);
      assert.equal((await row(legacyA)).quantity, 10);
      await assertInvariant(legacyA);
      // Annex's clerk cannot touch what Main sold.
      const other = await ring(legacyA, 1, {storeId: main}, OWN);
      await assert.rejects(s("voidInventorySale", {saleId: other.saleId},
          HOME_A), refusal("store_not_allowed"));
    });
  });

  describe("transfers", () => {
    it("moves pieces atomically, with one movement per side", async () => {
      const id = await mk({stock: {[main]: 8, [annex]: 1}});
      const done = await s("transferInventoryStock", {itemId: id,
        fromStoreId: main, toStoreId: annex, quantity: 5, note: "restock"},
      OWN);
      assert.deepEqual([done.from, done.to],
          [{storeId: main, quantity: 3}, {storeId: annex, quantity: 6}]);
      assert.equal((await stockAt(id, main)).quantity, 3);
      assert.equal((await stockAt(id, annex)).quantity, 6);
      assert.equal((await row(id)).quantity, 9);
      await assertInvariant(id);
      const pair = (await moves(id)).filter((m) => m.transferId);
      assert.equal(pair.length, 2);
      assert.equal(pair[0].transferId, pair[1].transferId);
      assert.equal(pair[0].transferId, done.transferId);
      const out = pair.find((m) => m.type === "transfer_out");
      const inn = pair.find((m) => m.type === "transfer_in");
      assert.deepEqual([out.storeId, out.delta, out.quantityAfter, out.note],
          [main, -5, 3, "restock"]);
      assert.deepEqual([inn.storeId, inn.delta, inn.quantityAfter],
          [annex, 5, 6]);
    });

    it("refuses the same store, too many pieces and bad numbers",
        async () => {
          const id = await mk({stock: {[main]: 2, [annex]: 0}});
          const move = (extra) => s("transferInventoryStock", {itemId: id,
            fromStoreId: main, toStoreId: annex, quantity: 1, ...extra}, OWN);
          await assert.rejects(move({toStoreId: main}),
              refusal("same_store", "invalid-argument"));
          await assert.rejects(move({quantity: 3}),
              refusal("insufficient_stock", "failed-precondition"));
          await assert.rejects(move({fromStoreId: depot, quantity: 1}),
              refusal("insufficient_stock"));
          for (const bad of [0, -1, 1.5, "x", null]) {
            await assert.rejects(move({quantity: bad}),
                refusal("quantity_invalid"), String(bad));
          }
          await assert.rejects(move({toStoreId: "nope"}),
              refusal("store_not_found"));
          await assert.rejects(s("transferInventoryStock", {itemId: "nope",
            fromStoreId: main, toStoreId: annex, quantity: 1}, OWN),
          refusal("item_not_found"));
          // Nothing moved, nothing logged.
          assert.equal((await stockAt(id, main)).quantity, 2);
          assert.equal((await stockAt(id, annex)).quantity, 0);
          assert.equal((await moves(id)).filter((m) => m.transferId).length, 0);
          // The exact count is fine and leaves zero, never negative.
          await move({quantity: 2});
          assert.equal((await stockAt(id, main)).quantity, 0);
          await assertInvariant(id);
        });

    it("never overdraws when two transfers race for the same pieces",
        {timeout: 120000}, async () => {
          const id = await mk({stock: {[main]: 3, [annex]: 0}});
          // Whichever call the emulator gives up on is sent again, and then
          // meets the other's committed result: it must be refused for
          // stock, never allowed to take the pieces a second time.
          const attempt = () => outcomeOf(() => s("transferInventoryStock",
              {itemId: id, fromStoreId: main, toStoreId: annex, quantity: 2},
              OWN));
          const outcomes = await Promise.all([attempt(), attempt()]);
          assert.deepEqual(outcomes.sort(), ["insufficient_stock", "ok"]);
          assert.equal((await stockAt(id, main)).quantity, 1);
          assert.equal((await stockAt(id, annex)).quantity, 2);
          await assertInvariant(id);
        });

    it("is for the owner and all-stores staff only", async () => {
      const id = await mk({stock: {[main]: 4, [annex]: 0}});
      const move = (uid) => s("transferInventoryStock", {itemId: id,
        fromStoreId: main, toStoreId: annex, quantity: 1}, uid);
      await assert.rejects(move(HOME_B),
          refusal("store_not_allowed", "permission-denied"));
      await assert.rejects(move(HOME_A), refusal("store_not_allowed"));
      await assert.rejects(move(NOHOME), refusal("store_not_allowed"));
      await move(ROVER);
      await move(OWN);
      assert.equal((await stockAt(id, annex)).quantity, 2);
      await assertInvariant(id);
    });
  });

  describe("summary per store", () => {
    it("judges low stock and counts per store and names the store",
        async () => {
          const id = await mk({name: "Per store", lowStockAt: 3,
            stock: {[main]: 20, [annex]: 2, [depot]: 9}});
          const odd = await mk({name: "Off count",
            stock: {[main]: 5, [annex]: 0}});
          await ring(odd, 1, {storeId: annex}, OWN);
          const all = await s("getInventorySummary",
              {range: "today", timeZone: "UTC"}, OWN);
          assert.equal(all.multiStore, true);
          const lowOf = (list, itemId) => list.filter((e) => e.itemId ===
            itemId).map((e) => [e.storeId, e.storeName, e.quantity]);
          assert.deepEqual(lowOf(all.low, id), [[annex, "Annex Shop", 2]]);
          assert.deepEqual(lowOf(all.low, odd),
              [[annex, "Annex Shop", 0]]);
          assert.deepEqual(all.countWasOff.filter((e) => e.itemId === odd)
              .map((e) => [e.storeId, e.storeName]), [[annex, "Annex Shop"]]);
          assert.ok(all.lowCount >= 2 && all.countWasOffCount >= 1);
          // One store: the owner's filter and the clerk's own view agree.
          const only = await s("getInventorySummary",
              {range: "today", timeZone: "UTC", storeId: annex}, OWN);
          const mine = await s("getInventorySummary",
              {range: "today", timeZone: "UTC"}, HOME_A);
          for (const view of [only, mine]) {
            assert.ok(view.low.every((e) => e.storeId === annex));
            assert.equal(view.storeId, annex);
            assert.equal(lowOf(view.low, id).length, 1);
          }
          assert.deepEqual(mine.byStore, []);
          assert.equal(only.byStore.length, 1);
        });

    it("adds up sales per store, for all-store callers only", async () => {
      const BS = "inv-store-numbers";
      const o = "inv-store-numbers-owner";
      const clerk = "inv-store-numbers-clerk";
      const n = callIn(BS);
      await seedBusiness(BS, {
        [o]: {role: "businessOwner", businessId: BS},
        [clerk]: {role: "staff", businessId: BS,
          businessPermissions: ["inventory"]}});
      const north = (await n("createInventoryStore", {name: "North"}, o))
          .storeId;
      const mainId = `${BS}_main`;
      await n("setInventoryStaffAccess", {userId: clerk, homeStoreId: north,
        allStores: false}, o);
      const item = (await n("createInventoryItem", {name: "Goods",
        priceCents: 1000, costCents: 400, stock: {[mainId]: 50, [north]: 50}},
      o)).itemId;
      const rung = (storeId, q, price, uid = o) => n("recordInventorySale",
          {clientRequestId: requestId(), paymentMethod: "cash", storeId,
            lines: [{itemId: item, quantity: q, soldPriceCents: price}]}, uid);
      await rung(mainId, 2, 1000);
      await rung(mainId, 1, 500);
      await rung(north, 4, 900, clerk);
      const gone = await rung(north, 10, 900, clerk);
      await n("voidInventorySale", {saleId: gone.saleId}, o);
      const all = await n("getInventorySummary", {range: "today"}, o);
      assert.equal(all.multiStore, true);
      assert.deepEqual(all.byStore, [
        {storeId: north, name: "North", salesCount: 1, itemsSold: 4,
          revenueCents: 3600, profitCents: 3600 - 1600},
        {storeId: mainId, name: "Main store", salesCount: 2, itemsSold: 3,
          revenueCents: 2500, profitCents: 2500 - 1200}]);
      assert.equal(all.revenueCents, 6100);
      assert.equal(all.salesCount, 3);
      const north_ = await n("getInventorySummary",
          {range: "today", storeId: north}, o);
      assert.equal(north_.revenueCents, 3600);
      assert.equal(north_.salesCount, 1);
      const mine = await n("getInventorySummary", {range: "today"}, clerk);
      assert.equal(mine.revenueCents, 3600);
      assert.deepEqual(mine.byStore, []);
      assert.equal(mine.storeId, north);
      await assert.rejects(n("getInventorySummary",
          {range: "today", storeId: mainId}, clerk),
      refusal("store_not_allowed"));
      await assert.rejects(n("getInventorySummary",
          {range: "today", storeId: "nope"}, o), refusal("store_not_found"));
      // The category report follows the same filter.
      assert.equal(mine.byCategory.reduce((x, e) => x + e.revenueCents, 0),
          3600);
    });
  });

  describe("archiving a store", () => {
    it("is owner only and refused while it holds stock", async () => {
      const id = await mk({stock: {[depot]: 3}});
      await assert.rejects(s("archiveInventoryStore",
          {storeId: depot, archived: true}, HOME_A), refusal("owner_only"));
      await assert.rejects(s("archiveInventoryStore",
          {storeId: depot, archived: "yes"}, OWN), refusal("archived_invalid"));
      await assert.rejects(s("archiveInventoryStore",
          {storeId: "nope", archived: true}, OWN),
      refusal("store_not_found"));
      await assert.rejects(s("archiveInventoryStore",
          {storeId: depot, archived: true}, OWN),
      refusal("store_has_stock", "failed-precondition"));
      assert.equal((await db.collection("inventoryStores").doc(depot).get())
          .get("archived"), false);
      // Empty it everywhere (every product with pieces there), then archive.
      const held = await db.collection("inventoryStock")
          .where("businessId", "==", SB).where("storeId", "==", depot)
          .where("quantity", ">", 0).get();
      for (const doc of held.docs) {
        await s("transferInventoryStock", {itemId: doc.data().itemId,
          fromStoreId: depot, toStoreId: annex,
          quantity: doc.data().quantity}, OWN);
      }
      await s("archiveInventoryStore", {storeId: depot, archived: true}, OWN);
      assert.equal((await db.collection("inventoryStores").doc(depot).get())
          .get("archived"), true);
      assert.equal((await config()).multiStore, true);
      assert.ok(id);
    });

    it("keeps an archived store out of sales, stock and transfers",
        async () => {
          const id = await mk({stock: {[main]: 5}});
          await assert.rejects(ring(id, 1, {storeId: depot}),
              refusal("store_archived", "failed-precondition"));
          await assert.rejects(s("adjustInventoryStock", {itemId: id,
            mode: "add", quantity: 1, storeId: depot}, OWN),
          refusal("store_archived"));
          await assert.rejects(s("transferInventoryStock", {itemId: id,
            fromStoreId: main, toStoreId: depot, quantity: 1}, OWN),
          refusal("store_archived"));
          await assert.rejects(s("setInventoryStaffAccess", {userId: HOME_A,
            homeStoreId: depot, allStores: false}, OWN),
          refusal("store_archived"));
          await assert.rejects(s("createInventoryItem", {name: "n",
            priceCents: 5, stock: {[depot]: 1}}, OWN),
          refusal("store_archived"));
        });

    it("acts as a single store again with one active store left",
        async () => {
          await s("archiveInventoryStore", {storeId: annex, archived: true},
              OWN).catch(async (error) => {
            assert.equal(error.details.reason, "store_has_stock");
            const held = await db.collection("inventoryStock")
                .where("businessId", "==", SB)
                .where("storeId", "==", annex).where("quantity", ">", 0).get();
            for (const doc of held.docs) {
              await s("transferInventoryStock", {itemId: doc.data().itemId,
                fromStoreId: annex, toStoreId: main,
                quantity: doc.data().quantity}, OWN);
            }
            await s("archiveInventoryStore",
                {storeId: annex, archived: true}, OWN);
          });
          assert.equal((await config()).multiStore, false);
          // The last active store cannot be archived.
          await assert.rejects(s("archiveInventoryStore",
              {storeId: main, archived: true}, OWN),
          refusal("last_store_active"));
          // Nobody needs a home store now, and stock still goes through rows.
          const id = await mk({quantity: 5}, NOHOME);
          const sale = await ring(id, 2, {}, NOHOME);
          assert.equal(sale.storeId, main);
          assert.equal((await stockAt(id, main)).quantity, 3);
          assert.equal((await row(id)).quantity, 3);
          await assertInvariant(id);
          const summary = await s("getInventorySummary", {range: "today"},
              NOHOME);
          assert.equal(summary.multiStore, false);
          assert.deepEqual(summary.byStore, []);
          // Restoring a store brings the multi-store rules back.
          await s("archiveInventoryStore", {storeId: annex, archived: false},
              OWN);
          assert.equal((await config()).multiStore, true);
          await assert.rejects(ring(id, 1, {}, NOHOME),
              refusal("home_store_required"));
        });
  });

  describe("old clients and housekeeping", () => {
    it("deletes a product's per-store rows with it", async () => {
      const id = await mk({stock: {[main]: 2, [annex]: 2}});
      assert.equal((await stockRows(id)).length, 2);
      await s("deleteInventoryItem", {itemId: id, confirm: true}, OWN);
      assert.equal((await stockRows(id)).length, 0);
    });

    it("finishes a pending move under Main on the next store call",
        async () => {
          const id = (await db.collection("inventoryItems").add({
            businessId: SB, name: "Pending", code: `IT-P${++keys}`,
            priceCents: 1000, costCents: null, quantity: 6, lowStockAt: null,
            category: "", categoryId: "", photoUrl: "", archived: false,
            countWasOff: false})).id;
          await db.collection("inventoryConfig").doc(SB).update(
              {stockPending: true});
          await s("updateInventoryStore", {storeId: annex, phone: "555-0000"},
              OWN);
          assert.equal((await config()).stockPending, false);
          assert.equal((await stockAt(id, main)).quantity, 6);
          assert.equal((await row(id)).storeStock, true);
          await assertInvariant(id);
        });

    it("keeps v1 request and answer shapes for the owner of a multi-store" +
        " business", async () => {
      const made = await s("createInventoryItem", {name: "V1 product",
        priceCents: 1250, costCents: 500, quantity: 7, lowStockAt: 2,
        category: "Legacy", photoUrl: "https://cdn.example.test/p.png"}, OWN);
      assert.deepEqual(Object.keys(made).sort(),
          ["categoryId", "code", "itemId", "success"]);
      const item = await row(made.itemId);
      assert.equal(item.quantity, 7);
      assert.equal(item.category, "Legacy");
      const sale = await s("recordInventorySale", {
        clientRequestId: requestId(), paymentMethod: "cash",
        lines: [{itemId: made.itemId, quantity: 1, soldPriceCents: 1250}]},
      OWN);
      for (const key of ["success", "saleId", "totalCents", "warnings",
        "replayed"]) {
        assert.ok(key in sale, key);
      }
      const adj = await s("adjustInventoryStock",
          {itemId: made.itemId, mode: "set", quantity: 9}, OWN);
      assert.equal(adj.success, true);
      assert.equal(adj.quantity, 9);
      assert.equal((await row(made.itemId)).quantity, 9);
      const summary = await s("getInventorySummary",
          {range: "today", timeZone: "America/New_York"}, OWN);
      for (const key of ["salesCount", "itemsSold", "revenueCents",
        "costCents", "profitCents", "discountCents", "best", "low",
        "countWasOff", "range", "since", "timeZone", "linesWithoutCost",
        "lowCount", "countWasOffCount", "truncated"]) {
        assert.ok(key in summary, key);
      }
      assert.equal(await sumRows(made.itemId), 9);
    });
  });
});

describe("adding the second store while sales are being rung up", () => {
  it("never loses a piece: the total always equals the stores' sum",
      {timeout: 120000}, async () => {
        const RB = "inv-race-biz";
        const owner = "inv-race-owner";
        const r = callIn(RB);
        await seedBusiness(RB, {
          [owner]: {role: "businessOwner", businessId: RB}});
        const ids = [];
        for (let i = 0; i < 6; i++) {
          ids.push((await r("createInventoryItem", {name: `Race ${i}`,
            priceCents: 1000, quantity: 20}, owner)).itemId);
        }
        // A sale the emulator gives up on is sent again with the same key -
        // the app's own retry - so each of the six is booked exactly once.
        const sales = ids.map((itemId) => {
          const clientRequestId = requestId();
          return untilSettled(() => r("recordInventorySale", {
            clientRequestId, paymentMethod: "cash",
            lines: [{itemId, quantity: 3, soldPriceCents: 1000}]}, owner));
        });
        const [, ...done] = await Promise.all([
          untilSettled(() => r("createInventoryStore", {name: "Second"},
              owner)), ...sales]);
        assert.equal(done.length, 6);
        for (const itemId of ids) {
          const item = (await db.collection("inventoryItems").doc(itemId)
              .get()).data();
          const rows = (await db.collection("inventoryStock")
              .where("businessId", "==", RB).where("itemId", "==", itemId)
              .get()).docs.map((d) => d.data());
          assert.equal(item.quantity, 17, "three pieces sold, once");
          assert.equal(item.storeStock, true);
          assert.equal(rows.reduce((n, x) => n + x.quantity, 0), 17);
        }
      });
});

// ===========================================================================
// Brands (v3): the same shape as categories, with `brand`/`brandId` on the
// product, the sale line and the summary. v2-shaped payloads are replayed.
// ===========================================================================

describe("brands", () => {
  const BB = "inv-brand-biz";
  const B_OWNER = "inv-brand-owner";
  const B_STAFF = "inv-brand-staff";
  const B_NONE = "inv-brand-ledger-only";
  const b = callIn(BB);
  const brandsOf = async () => (await db.collection("inventoryBrands")
      .where("businessId", "==", BB).get()).docs
      .map((d) => ({id: d.id, ...d.data()}));
  const itemRow = async (id) => (await db.collection("inventoryItems").doc(id)
      .get()).data();
  const mk = async (extra = {}) => (await b("createInventoryItem", {
    name: `Product ${++keys}`, priceCents: 1000, quantity: 5, ...extra,
  }, B_OWNER)).itemId;

  before(async () => {
    await seedBusiness(BB, {
      [B_OWNER]: {role: "businessOwner", businessId: BB},
      [B_STAFF]: {role: "staff", businessId: BB,
        businessPermissions: ["inventory"]},
      [B_NONE]: {role: "staff", businessId: BB,
        businessPermissions: ["ledger"]},
    });
  });

  it("is gated like the rest: service off, no inventory section",
      async () => {
        const off = (name, data) => functions[name].run({
          auth: {uid: OFF_OWNER, token: {}},
          data: {businessId: BIZ_OFF, ...data},
        });
        const calls = [
          ["createInventoryBrand", {name: "Jordan"}],
          ["renameInventoryBrand", {brandId: "x", name: "Jordan"}],
          ["archiveInventoryBrand", {brandId: "x", archived: true}],
        ];
        for (const [name, data] of calls) {
          await assert.rejects(off(name, data),
              refusal("service_disabled", "failed-precondition"), name);
          await assert.rejects(b(name, data, B_NONE),
              (error) => error.code === "permission-denied", name);
          await assert.rejects(b(name, data, STRANGER),
              (error) => error.code === "permission-denied", name);
        }
      });

  it("creates a brand, trimmed, and refuses a duplicate in any case",
      async () => {
        const made = await b("createInventoryBrand", {name: "  Air   Jordan "},
            B_STAFF);
        assert.equal(made.success, true);
        assert.equal(made.name, "Air Jordan");
        const row = (await db.collection("inventoryBrands")
            .doc(made.brandId).get()).data();
        assert.deepEqual(
            [row.businessId, row.name, row.nameKey, row.archived,
              row.createdByStaffId],
            [BB, "Air Jordan", "air jordan", false, B_STAFF]);
        assert.ok(row.createdAt && row.updatedAt);
        const lock = (await db.collection("inventoryBrandKeys")
            .doc(require("../inventory").brandKeyDocId(BB, "air jordan"))
            .get()).data();
        assert.deepEqual(lock, {businessId: BB, brandId: made.brandId,
          nameKey: "air jordan"});
        await assert.rejects(b("createInventoryBrand", {name: "AIR JORDAN"},
            B_OWNER), (error) => {
          assert.equal(error.code, "already-exists");
          assert.equal(error.details.reason, "brand_name_taken");
          assert.equal(error.details.brandId, made.brandId);
          assert.equal(error.details.archived, false);
          return true;
        });
        await assert.rejects(b("createInventoryBrand", {name: "   "}, B_OWNER),
            refusal("brand_name_required", "invalid-argument"));
        await assert.rejects(b("createInventoryBrand", {}, B_OWNER),
            refusal("brand_name_required"));
        await assert.rejects(b("createInventoryBrand",
            {name: "x".repeat(61)}, B_OWNER),
        refusal("brand_too_long", "invalid-argument"));
        const audit = (await db.collection("lotLedgerAudit")
            .where("businessId", "==", BB)
            .where("entityId", "==", made.brandId).get()).docs
            .map((d) => d.data());
        assert.equal(audit.length, 1);
        assert.equal(audit[0].entityType, "inventory_brand");
        assert.equal(audit[0].action, "created");
        assert.equal(audit[0].acknowledged, true);
      });

  it("gives a product the brand it picked, with a name snapshot", async () => {
    const {brandId} = await b("createInventoryBrand", {name: "Nike"}, B_OWNER);
    const made = await b("createInventoryItem", {name: "Air Max",
      priceCents: 1000, quantity: 5, brandId}, B_OWNER);
    assert.equal(made.brandId, brandId);
    const row = await itemRow(made.itemId);
    assert.equal(row.brandId, brandId);
    assert.equal(row.brand, "Nike");
    await assert.rejects(mk({brandId: "no-such-brand"}),
        refusal("brand_not_found", "not-found"));
    await assert.rejects(mk({brandId: "a/b"}), refusal("brand_not_found"));
    await assert.rejects(mk({brandId: 5}), refusal("brand_not_found"));
    await assert.rejects(mk({brand: "x".repeat(61)}),
        refusal("brand_too_long"));
  });

  it("refuses a brand of another business", async () => {
    const OB = "inv-brand-other-biz";
    const OO = "inv-brand-other-owner";
    await seedBusiness(OB, {[OO]: {role: "businessOwner", businessId: OB}});
    const foreign = (await callIn(OB)("createInventoryBrand",
        {name: "Foreign"}, OO)).brandId;
    await assert.rejects(mk({brandId: foreign}),
        refusal("brand_not_found"));
    // The same name in another business is a different brand.
    const mine = (await b("createInventoryBrand", {name: "Foreign"},
        B_OWNER)).brandId;
    assert.notEqual(mine, foreign);
    await assert.rejects(b("renameInventoryBrand",
        {brandId: foreign, name: "Mine now"}, B_OWNER),
    refusal("brand_not_found"));
    await assert.rejects(b("archiveInventoryBrand",
        {brandId: foreign, archived: true}, B_OWNER),
    refusal("brand_not_found"));
  });

  it("finds or creates a typed brand, race-safe, in the list's spelling",
      async () => {
        const before = (await brandsOf()).length;
        const ids = await Promise.all([0, 1, 2, 3].map((i) =>
          mk({brand: i % 2 ? "Adidas" : "  adidas "})));
        const rows = await Promise.all(ids.map(itemRow));
        assert.equal(new Set(rows.map((r) => r.brandId)).size, 1);
        assert.ok(rows.every((r) => r.brandId));
        assert.equal((await brandsOf()).length, before + 1);
        assert.equal(new Set(rows.map((r) => r.brand)).size, 1);
        const again = await mk({brand: rows[0].brand.toUpperCase()});
        assert.equal((await itemRow(again)).brand, rows[0].brand);
        assert.equal((await brandsOf()).length, before + 1);
      });

  it("lets brandId win over typed text, and clears with an empty value",
      async () => {
        const {brandId} = await b("createInventoryBrand", {name: "Puma"},
            B_OWNER);
        const wins = await mk({brandId, brand: "Something else"});
        assert.equal((await itemRow(wins)).brand, "Puma");
        assert.equal((await itemRow(wins)).brandId, brandId);
        const typedOnly = await mk({brand: "Reebok"});
        const row = await itemRow(typedOnly);
        assert.ok(row.brandId);
        await b("updateInventoryItem", {itemId: typedOnly, brand: ""},
            B_OWNER);
        const cleared = await itemRow(typedOnly);
        assert.equal(cleared.brand, "");
        assert.equal(cleared.brandId, "");
        await b("updateInventoryItem", {itemId: typedOnly, brand: "reebok"},
            B_OWNER);
        assert.equal((await itemRow(typedOnly)).brandId, row.brandId);
        await b("updateInventoryItem", {itemId: typedOnly, brandId: ""},
            B_OWNER);
        assert.equal((await itemRow(typedOnly)).brandId, "");
        await b("updateInventoryItem", {itemId: typedOnly, brandId, brand: ""},
            B_OWNER);
        assert.equal((await itemRow(typedOnly)).brand, "Puma");
        await assert.rejects(b("updateInventoryItem",
            {itemId: typedOnly, brandId: "nope"}, B_OWNER),
        refusal("brand_not_found"));
        await assert.rejects(b("updateInventoryItem",
            {itemId: typedOnly, brand: "x".repeat(61)}, B_OWNER),
        refusal("brand_too_long"));
      });

  it("keeps a v2-shaped request working: no brand fields, no brand",
      async () => {
        const id = await mk({category: "Shoes"});
        const row = await itemRow(id);
        assert.equal(row.brandId, "");
        assert.equal(row.brand, "");
        assert.equal(row.category, "Shoes");
        const edited = await b("updateInventoryItem",
            {itemId: id, name: "Renamed"}, B_OWNER);
        assert.deepEqual(edited.changed, ["Name"]);
        assert.equal((await itemRow(id)).brandId, "");
        const made = await b("createInventoryItem", {name: "Plain",
          priceCents: 100, quantity: 1}, B_OWNER);
        assert.deepEqual(Object.keys(made).sort(),
            ["code", "itemId", "success"]);
      });

  it("shows a brand change in the product history", async () => {
    const id = await mk();
    const {brandId} = await b("createInventoryBrand", {name: "Vans"}, B_OWNER);
    const done = await b("updateInventoryItem", {itemId: id, brandId},
        B_OWNER);
    assert.deepEqual(done.changed, ["Brand"]);
    const again = await b("updateInventoryItem", {itemId: id, brandId},
        B_OWNER);
    assert.deepEqual(again.changed, []);
  });

  it("renames a brand on its products but not on past sales", async () => {
    const {brandId} = await b("createInventoryBrand", {name: "Gucci"},
        B_OWNER);
    const ids = await Promise.all([mk({brandId}), mk({brandId})]);
    const sold = await b("recordInventorySale", {
      clientRequestId: requestId(), paymentMethod: "cash",
      lines: [{itemId: ids[0], quantity: 1, soldPriceCents: 1000}]}, B_OWNER);
    const done = await b("renameInventoryBrand",
        {brandId, name: "Gucci Italia"}, B_STAFF);
    assert.equal(done.success, true);
    assert.equal(done.brandId, brandId);
    assert.equal(done.name, "Gucci Italia");
    assert.equal(done.itemsUpdated, 2);
    assert.equal(done.complete, true);
    for (const id of ids) {
      const row = await itemRow(id);
      assert.equal(row.brand, "Gucci Italia");
      assert.equal(row.brandId, brandId);
    }
    const sale = (await db.collection("inventorySales").doc(sold.saleId)
        .get()).data();
    assert.equal(sale.lines[0].brand, "Gucci");
    assert.equal(sale.lines[0].brandId, brandId);
    // The old name is free again, the new one is taken.
    await b("createInventoryBrand", {name: "gucci"}, B_OWNER);
    await assert.rejects(
        b("renameInventoryBrand", {brandId, name: "GUCCI"}, B_OWNER),
        (error) => {
          assert.equal(error.code, "already-exists");
          assert.equal(error.details.reason, "brand_name_taken");
          return true;
        });
    // Renaming in place (only the case) is fine, and idempotent.
    await b("renameInventoryBrand", {brandId, name: "GUCCI ITALIA"}, B_OWNER);
    assert.equal((await itemRow(ids[1])).brand, "GUCCI ITALIA");
    const same = await b("renameInventoryBrand",
        {brandId, name: "GUCCI ITALIA"}, B_OWNER);
    assert.equal(same.itemsUpdated, 0);
    assert.equal(same.complete, true);
    await assert.rejects(b("renameInventoryBrand",
        {brandId: "nope", name: "Z"}, B_OWNER),
    refusal("brand_not_found", "not-found"));
    await assert.rejects(b("renameInventoryBrand", {name: "Z"}, B_OWNER),
        refusal("brand_not_found"));
    await assert.rejects(b("renameInventoryBrand", {brandId, name: ""},
        B_OWNER), refusal("brand_name_required"));
    await assert.rejects(b("renameInventoryBrand",
        {brandId, name: "x".repeat(61)}, B_OWNER), refusal("brand_too_long"));
  });

  it("walks a rename in bounded pages and says when more remain", async () => {
    const {brandId} = await b("createInventoryBrand", {name: "Bulk"},
        B_OWNER);
    const batch = db.batch();
    for (let i = 0; i < 405; i++) {
      batch.set(db.collection("inventoryItems").doc(`inv-brand-bulk-${i}`), {
        businessId: BB, name: `Bulk ${i}`, code: `BULK${i}`, priceCents: 1,
        costCents: null, quantity: 1, lowStockAt: null, category: "",
        categoryId: "", brandId, brand: "Bulk", photoUrl: "",
        archived: false, countWasOff: false});
    }
    await batch.commit();
    const done = await b("renameInventoryBrand", {brandId, name: "Bulky"},
        B_OWNER);
    assert.equal(done.itemsUpdated, 405);
    assert.equal(done.complete, true);
    const left = (await db.collection("inventoryItems")
        .where("businessId", "==", BB).where("brandId", "==", brandId).get())
        .docs.filter((d) => d.data().brand !== "Bulky");
    assert.equal(left.length, 0);
  });

  it("archives a brand and keeps it on the products", async () => {
    const {brandId} = await b("createInventoryBrand", {name: "Seasonal"},
        B_OWNER);
    const id = await mk({brandId});
    const done = await b("archiveInventoryBrand", {brandId, archived: true},
        B_STAFF);
    assert.deepEqual(done, {success: true, archived: true});
    assert.equal((await db.collection("inventoryBrands").doc(brandId).get())
        .data().archived, true);
    assert.equal((await itemRow(id)).brandId, brandId);
    // The product it is already on can still be edited with it.
    await b("updateInventoryItem", {itemId: id, brandId, name: "Kept"},
        B_OWNER);
    assert.equal((await itemRow(id)).name, "Kept");
    // It cannot be picked by id, but typing its name brings it back.
    await assert.rejects(mk({brandId}), refusal("brand_not_found"));
    const typed = await mk({brand: "seasonal"});
    assert.equal((await itemRow(typed)).brandId, brandId);
    assert.equal((await db.collection("inventoryBrands").doc(brandId).get())
        .data().archived, false);
    await assert.rejects(b("archiveInventoryBrand",
        {brandId, archived: "yes"}, B_OWNER), refusal("archived_invalid"));
    await assert.rejects(b("archiveInventoryBrand",
        {brandId: "", archived: true}, B_OWNER), refusal("brand_not_found"));
    await assert.rejects(b("archiveInventoryBrand",
        {brandId: "nope", archived: true}, B_OWNER),
    refusal("brand_not_found", "not-found"));
    const restored = await b("archiveInventoryBrand",
        {brandId, archived: false}, B_OWNER);
    assert.deepEqual(restored, {success: true, archived: false});
  });

  it("snapshots the brand on a sale line, empty for a plain product",
      async () => {
        const {brandId} = await b("createInventoryBrand", {name: "Fila"},
            B_OWNER);
        const branded = await mk({brandId});
        const plain = await mk();
        const sold = await b("recordInventorySale", {
          clientRequestId: requestId(), paymentMethod: "cash",
          lines: [{itemId: branded, quantity: 1, soldPriceCents: 1000},
            {itemId: plain, quantity: 1, soldPriceCents: 500}]}, B_OWNER);
        const sale = (await db.collection("inventorySales").doc(sold.saleId)
            .get()).data();
        assert.equal(sale.lines[0].brandId, brandId);
        assert.equal(sale.lines[0].brand, "Fila");
        assert.equal(sale.lines[1].brandId, "");
        assert.equal(sale.lines[1].brand, "");
      });

  describe("byBrand", () => {
    const RB = "inv-brand-report-biz";
    const r = callIn(RB);
    const R_OWNER = "inv-brand-report-owner";
    before(async () => {
      await seedBusiness(RB, {
        [R_OWNER]: {role: "businessOwner", businessId: RB}});
    });
    const mkr = async (extra) => (await r("createInventoryItem", {
      priceCents: 1000, quantity: 20, ...extra}, R_OWNER)).itemId;
    const ring = (lines) => r("recordInventorySale", {
      clientRequestId: requestId(), paymentMethod: "cash", lines}, R_OWNER);

    it("is empty without sales", async () => {
      const s = await r("getInventorySummary", {range: "today"}, R_OWNER);
      assert.deepEqual(s.byBrand, []);
    });

    it("groups revenue and profit, drops voided sales, reads legacy lines",
        async () => {
          const jordan = (await r("createInventoryBrand", {name: "Jordan"},
              R_OWNER)).brandId;
          const nike = (await r("createInventoryBrand", {name: "Nike"},
              R_OWNER)).brandId;
          await r("createInventoryBrand", {name: "Never sold"}, R_OWNER);
          const shoe = await mkr({name: "11", brandId: jordan,
            costCents: 300});
          const slide = await mkr({name: "Slide", brandId: nike,
            costCents: null});
          const misc = await mkr({name: "Misc"});
          const sold = await ring([
            {itemId: shoe, quantity: 2, soldPriceCents: 800},
            {itemId: slide, quantity: 3, soldPriceCents: 1000},
            {itemId: misc, quantity: 1, soldPriceCents: 250}]);
          const gone = await ring([
            {itemId: slide, quantity: 5, soldPriceCents: 1000}]);
          await r("voidInventorySale", {saleId: gone.saleId}, R_OWNER);
          // A line written before brands existed: no brand snapshot at all.
          await db.collection("inventorySales").add({
            businessId: RB, voided: false, totalCents: 1000,
            createdAt: admin.firestore.Timestamp.now(),
            lines: [{itemId: shoe, name: "11", quantity: 1,
              soldPriceCents: 1000, listPriceCents: 1000, costCents: 300}]});
          const s = await r("getInventorySummary", {range: "today"}, R_OWNER);
          assert.deepEqual(s.byBrand, [
            {brandId: nike, name: "Nike", itemsSold: 3,
              revenueCents: 3000, profitCents: 0},
            {brandId: jordan, name: "Jordan", itemsSold: 3,
              revenueCents: 2600, profitCents: 2600 - 900},
            {brandId: "", name: "No brand", itemsSold: 1,
              revenueCents: 250, profitCents: 0}]);
          assert.equal(s.revenueCents, 5850);
          // byCategory is untouched by brands.
          assert.deepEqual(s.byCategory.map((e) => e.categoryId), [""]);
          // The brand's current name shows on past sales.
          await r("renameInventoryBrand",
              {brandId: jordan, name: "Air Jordan"}, R_OWNER);
          const after = await r("getInventorySummary", {range: "today"},
              R_OWNER);
          assert.ok(after.byBrand.some((e) => e.brandId === jordan &&
            e.name === "Air Jordan"));
          assert.ok(sold.saleId);
        });
  });

  describe("in a business with several stores", () => {
    const SB = "inv-brand-store-biz";
    const S_OWNER = "inv-brand-store-owner";
    const s = callIn(SB);
    before(async () => {
      await seedBusiness(SB, {
        [S_OWNER]: {role: "businessOwner", businessId: SB}});
    });

    it("snapshots the brand on a per-store sale and counts it in byBrand",
        async () => {
          const {brandId} = await s("createInventoryBrand", {name: "Jordan"},
              S_OWNER);
          const made = await s("createInventoryItem", {name: "11",
            priceCents: 1000, quantity: 10, brandId}, S_OWNER);
          const second = await s("createInventoryStore", {name: "Annex"},
              S_OWNER);
          const sold = await s("recordInventorySale", {
            clientRequestId: requestId(), paymentMethod: "cash",
            storeId: second.storeId,
            lines: [{itemId: made.itemId, quantity: 1,
              soldPriceCents: 900}]}, S_OWNER);
          const sale = (await db.collection("inventorySales")
              .doc(sold.saleId).get()).data();
          assert.equal(sale.storeId, second.storeId);
          assert.equal(sale.lines[0].brandId, brandId);
          assert.equal(sale.lines[0].brand, "Jordan");
          const summary = await s("getInventorySummary", {range: "today"},
              S_OWNER);
          assert.deepEqual(summary.byBrand, [{brandId, name: "Jordan",
            itemsSold: 1, revenueCents: 900, profitCents: 0}]);
          const annex = await s("getInventorySummary",
              {range: "today", storeId: second.storeId}, S_OWNER);
          assert.equal(annex.byBrand.length, 1);
          const main = await s("getInventorySummary",
              {range: "today", storeId: `${SB}_main`}, S_OWNER);
          assert.deepEqual(main.byBrand, []);
        });
  });
});

describe("sale notifications", () => {
  // Who was told about a sale: one notificationDeliveries row (push channel;
  // sale alerts never go by email or SMS) per person told.
  const toldAbout = async (saleId) => {
    const snap = await db.collection("notificationDeliveries")
        .where("data.saleId", "==", saleId).get();
    return snap.docs.map((d) => d.data());
  };
  const recipientsOf = async (saleId) =>
    [...new Set((await toldAbout(saleId)).map((d) => d.recipientUid))].sort();

  describe("in a business with several stores", () => {
    const NB = "inv-notify-biz";
    const OWN = "inv-notify-owner";
    const A = "inv-notify-a";
    const B = "inv-notify-b";
    const C = "inv-notify-c";
    const D = "inv-notify-d";
    const MUTED = "inv-notify-muted";
    const s = callIn(NB);
    const MAIN = `${NB}_main`;
    let itemId;

    before(async () => {
      const clerk = {role: "staff", businessId: NB,
        businessPermissions: ["inventory"]};
      await seedBusiness(NB, {
        [OWN]: {role: "businessOwner", businessId: NB},
        [A]: {...clerk, fullName: "Mamadou Diallo"},
        [B]: clerk, [C]: clerk, [D]: clerk, [MUTED]: {...clerk,
          notificationPreferences: {inventorySales: false}},
      });
      itemId = (await s("createInventoryItem", {name: "11", brand: "Jordan",
        priceCents: 6000, quantity: 20}, OWN)).itemId;
      const annex = (await s("createInventoryStore", {name: "Annex"}, OWN))
          .storeId;
      await s("updateInventoryStore", {storeId: MAIN, name: "Downtown"}, OWN);
      for (const [userId, homeStoreId, allStores] of [[A, MAIN, false],
        [B, MAIN, false], [C, annex, true], [D, annex, false],
        [MUTED, MAIN, false]]) {
        await s("setInventoryStaffAccess", {userId, homeStoreId, allStores},
            OWN);
      }
    });

    it("tells the owner, the store's staff and all-stores staff, not the " +
        "seller nor another store", async () => {
      const clientRequestId = requestId();
      const sold = await s("recordInventorySale", {clientRequestId,
        paymentMethod: "cash",
        lines: [{itemId, quantity: 1, soldPriceCents: 6000}]}, A);
      assert.deepEqual(await recipientsOf(sold.saleId), [OWN, B, C].sort());
      const rows = await toldAbout(sold.saleId);
      // Push only (the owner's decision): one push ledger row per person,
      // never an email or SMS row, whatever the providers are set to.
      assert.deepEqual([...new Set(rows.map((row) => row.channel))], ["push"]);
      assert.equal(rows.length, 3);
      assert.equal((await db.collection("mail")
          .where("deliveryId", "in", rows.map((row) => row.deliveryId || "-"))
          .get()).size, 0);
      for (const row of rows) {
        assert.equal(row.preferenceKey, "inventorySales");
        assert.equal(row.title, "Sale at Downtown");
        assert.equal(row.body, "Mamadou sold Jordan 11 · $60.00");
        assert.deepEqual(row.data, {type: "inventory_sale", businessId: NB,
          saleId: sold.saleId, storeId: MAIN,
          relatedCollection: "inventorySales", relatedId: sold.saleId});
      }
      // The in-app inbox gets it too.
      const inbox = await db.collection("users").doc(B)
          .collection("notifications")
          .where("data.saleId", "==", sold.saleId).get();
      assert.equal(inbox.size, 1);
      assert.equal(inbox.docs[0].data().title, "Sale at Downtown");
      const claim = (await db.collection("inventorySaleNotifications")
          .doc(sold.saleId).get()).data();
      assert.deepEqual([...claim.recipientUids].sort(), [OWN, B, C].sort());

      // A retried call is the same sale and tells nobody again.
      const again = await s("recordInventorySale", {clientRequestId,
        paymentMethod: "cash",
        lines: [{itemId, quantity: 1, soldPriceCents: 6000}]}, A);
      assert.equal(again.replayed, true);
      assert.equal((await toldAbout(sold.saleId)).length, rows.length);

      // Voiding it notifies nobody.
      await s("voidInventorySale", {saleId: sold.saleId}, OWN);
      assert.equal((await toldAbout(sold.saleId)).length, rows.length);
    });

    it("tells the seller's store when the owner sells there", async () => {
      const sold = await s("recordInventorySale", {clientRequestId:
        requestId(), paymentMethod: "cash", storeId: MAIN,
      lines: [{itemId, quantity: 1, soldPriceCents: 6000}]}, OWN);
      assert.deepEqual(await recipientsOf(sold.saleId), [A, B, C].sort());
    });
  });

  it("tells every inventory staff member and the owner of a single-store " +
      "business", async () => {
    const SB = "inv-notify-single";
    const OWN = "inv-notify-single-owner";
    const SELLER = "inv-notify-single-seller";
    const OTHER = "inv-notify-single-other";
    const LEDGER = "inv-notify-single-ledger";
    const s = callIn(SB);
    await seedBusiness(SB, {
      [OWN]: {role: "businessOwner", businessId: SB},
      [SELLER]: {role: "staff", businessId: SB,
        businessPermissions: ["inventory"], fullName: "Awa Ndiaye"},
      [OTHER]: {role: "staff", businessId: SB,
        businessPermissions: ["inventory"]},
      [LEDGER]: {role: "staff", businessId: SB,
        businessPermissions: ["ledger"]},
    });
    const first = (await s("createInventoryItem", {name: "Cap",
      priceCents: 1000, quantity: 5}, OWN)).itemId;
    const second = (await s("createInventoryItem", {name: "Socks",
      priceCents: 500, quantity: 5}, OWN)).itemId;
    const sold = await s("recordInventorySale", {clientRequestId: requestId(),
      paymentMethod: "cash", lines: [
        {itemId: first, quantity: 2, soldPriceCents: 1000},
        {itemId: second, quantity: 1, soldPriceCents: 500}]}, SELLER);
    assert.deepEqual(await recipientsOf(sold.saleId), [OWN, OTHER].sort());
    const [row] = await toldAbout(sold.saleId);
    assert.equal(row.title, "New sale");
    assert.equal(row.body, "Awa sold 2 × Cap +1 more · $25.00");
    assert.equal(row.data.storeId, "");
  });

  it("writes it in the language the app saved on the profile", async () => {
    const LB = "inv-notify-lang";
    const OWN = "inv-notify-lang-owner";
    const SELLER = "inv-notify-lang-seller";
    const FR = "inv-notify-lang-fr";
    const s = callIn(LB);
    // Staff have no phone on file: the language must save without one.
    await seedBusiness(LB, {
      [OWN]: {role: "businessOwner", businessId: LB},
      [SELLER]: {role: "staff", businessId: LB,
        businessPermissions: ["inventory"], fullName: "Awa Ndiaye"},
      [FR]: {role: "staff", businessId: LB,
        businessPermissions: ["inventory"]},
    });
    const saveLanguage = (uid, preferredLanguage) =>
      functions.updateCustomerProfile.run({auth: {uid, token: {}},
        data: {preferredLanguage}});

    assert.deepEqual(await saveLanguage(FR, "fr"),
        {success: true, preferredLanguage: "fr"});
    const profile = (await db.collection("users").doc(FR).get()).data();
    assert.equal(profile.preferredLanguage, "fr");
    // Name and phone are left alone by a language-only save.
    assert.equal(profile.fullName, FR);
    assert.equal(profile.phone, undefined);
    // Only "en" and "fr" are kept; anything else is ignored.
    for (const bad of ["de", "FR", "", 7]) {
      assert.equal((await saveLanguage(FR, bad)).preferredLanguage, "");
    }
    assert.equal((await db.collection("users").doc(FR).get()).data()
        .preferredLanguage, "fr");
    await assert.rejects(() => saveLanguage("inv-notify-lang-nobody", "fr"),
        (error) => error.code === "not-found");

    const item = (await s("createInventoryItem", {name: "Cap",
      priceCents: 1000, quantity: 5}, OWN)).itemId;
    const sold = await s("recordInventorySale", {clientRequestId: requestId(),
      paymentMethod: "cash",
      lines: [{itemId: item, quantity: 1, soldPriceCents: 1000}]}, SELLER);
    const rows = Object.fromEntries((await toldAbout(sold.saleId))
        .map((row) => [row.recipientUid, row]));
    assert.deepEqual([rows[FR].title, rows[FR].body],
        ["Nouvelle vente", "Awa a vendu Cap · $10.00"]);
    assert.deepEqual([rows[OWN].title, rows[OWN].body],
        ["New sale", "Awa sold Cap · $10.00"]);
    const inbox = await db.collection("users").doc(FR)
        .collection("notifications")
        .where("data.saleId", "==", sold.saleId).get();
    assert.equal(inbox.docs[0].data().title, "Nouvelle vente");
  });
});

// ---------------------------------------------------------------------------
// v4: who received the money, credit sales, later payments, reminders.
// ---------------------------------------------------------------------------

describe("credit sales and who received the money", () => {
  const CB = "inv-credit-biz";
  const OWN = "inv-credit-owner";
  const CLERK = "inv-credit-clerk";
  const COLLECTOR = "inv-credit-collector";
  const MUTED = "inv-credit-muted";
  const OUTSIDER = "inv-credit-outsider";
  const s = callIn(CB);
  let itemId;
  // Far enough ahead to stay valid whatever day the suite runs.
  const LATER = "2099-12-31";
  const creditOf = (extra = {}) => ({paidNowCents: 2000,
    customerName: "Fatou Bah", customerPhone: "+1 207 555 0100",
    collectorStaffId: COLLECTOR, dueDate: LATER, ...extra});
  const sellIn = (extra = {}, uid = CLERK) => s("recordInventorySale", {
    clientRequestId: requestId(), paymentMethod: "cash",
    lines: [{itemId, quantity: 1, soldPriceCents: 6000}], ...extra}, uid);
  const saleOf = async (id) => (await db.collection("inventorySales")
      .doc(id).get()).data();
  const paymentsOf = async (saleId) => (await db.collection(
      "inventoryCreditPayments").where("businessId", "==", CB)
      .where("saleId", "==", saleId).get()).docs
      .map((d) => ({id: d.id, ...d.data()}));
  const pushesFor = async (saleId) => (await db.collection(
      "notificationDeliveries").where("data.saleId", "==", saleId)
      .where("preferenceKey", "==", "inventoryCredit").get()).docs
      .map((d) => d.data());

  before(async () => {
    const clerk = {role: "staff", businessId: CB,
      businessPermissions: ["inventory"]};
    await seedBusiness(CB, {
      [OWN]: {role: "businessOwner", businessId: CB, fullName: "Dala Owner"},
      [CLERK]: {...clerk, fullName: "Awa Cashier"},
      [COLLECTOR]: {role: "staff", businessId: CB,
        businessPermissions: ["ledger"], fullName: "Mamadou Diallo"},
      [MUTED]: {...clerk, notificationPreferences: {inventoryCredit: false}},
      [OUTSIDER]: {role: "staff", businessId: "inv-credit-elsewhere",
        businessPermissions: ["inventory"]},
    });
    await db.collection("businesses").doc(CB).set({ownerUid: OWN},
        {merge: true});
    itemId = (await s("createInventoryItem", {name: "Boubou",
      priceCents: 6000, quantity: 100}, OWN)).itemId;
  });

  describe("received by", () => {
    it("defaults to the seller and is paid in full", async () => {
      const sold = await sellIn();
      assert.equal(sold.creditCents, 0);
      const sale = await saleOf(sold.saleId);
      assert.equal(sale.receivedByStaffId, CLERK);
      assert.equal(sale.paidNowCents, 6000);
      assert.equal(sale.creditCents, 0);
      assert.equal(sale.creditPaidCents, 0);
      assert.equal(sale.creditStatus, "none");
      assert.equal(sale.credit, undefined);
    });

    it("takes another person of the business, the owner included",
        async () => {
          for (const who of [COLLECTOR, OWN]) {
            const sold = await sellIn({receivedByStaffId: who});
            assert.equal((await saleOf(sold.saleId)).receivedByStaffId, who);
          }
        });

    it("refuses someone of another business, or no one at all", async () => {
      for (const who of [OUTSIDER, "inv-credit-nobody", "a/b", 7]) {
        await assert.rejects(sellIn({receivedByStaffId: who}),
            refusal("received_by_invalid", "invalid-argument"), String(who));
      }
    });
  });

  describe("selling on credit", () => {
    it("records part now, the rest owed, and tells the collector",
        async () => {
          const before = (await itemDoc(itemId)).quantity;
          const sold = await sellIn({credit: creditOf()});
          assert.equal(sold.creditCents, 4000);
          assert.equal(sold.replayed, false);
          const sale = await saleOf(sold.saleId);
          assert.equal(sale.paidNowCents, 2000);
          assert.equal(sale.creditCents, 4000);
          assert.equal(sale.creditPaidCents, 0);
          assert.equal(sale.creditStatus, "open");
          assert.equal(sale.paymentMethod, "cash");
          assert.equal(sale.receivedByStaffId, CLERK);
          assert.deepEqual(sale.credit, {customerName: "Fatou Bah",
            customerPhone: "+12075550100", collectorStaffId: COLLECTOR,
            dueDate: LATER});
          // A credit sale still takes the goods off the shelf.
          assert.equal((await itemDoc(itemId)).quantity, before - 1);
          const [push, ...more] = await pushesFor(sold.saleId);
          assert.equal(more.length, 0);
          assert.equal(push.recipientUid, COLLECTOR);
          assert.equal(push.channel, "push");
          assert.equal(push.title, "Credit to collect");
          assert.equal(push.body, "Fatou Bah owes $40.00 · sale");
          assert.deepEqual(push.data, {type: "inventory_sale",
            kind: "credit", businessId: CB, saleId: sold.saleId,
            storeId: "", relatedCollection: "inventorySales",
            relatedId: sold.saleId});
        });

    it("sells entirely on credit without a payment method", async () => {
      const sold = await sellIn({paymentMethod: "",
        credit: creditOf({paidNowCents: 0, dueDate: ""})});
      const sale = await saleOf(sold.saleId);
      assert.equal(sale.paymentMethod, "");
      assert.equal(sale.paidNowCents, 0);
      assert.equal(sale.creditCents, 6000);
      assert.equal(sale.credit.dueDate, "");
    });

    it("tells nobody when the seller collects it or switched it off",
        async () => {
          const own = await sellIn({credit: creditOf({
            collectorStaffId: CLERK})});
          assert.deepEqual(await pushesFor(own.saleId), []);
          const muted = await sellIn({credit: creditOf({
            collectorStaffId: MUTED})});
          assert.deepEqual(await pushesFor(muted.saleId), []);
        });

    it("refuses what a credit sale cannot be", async () => {
      const cases = [
        [{paidNowCents: 6000}, "paid_now_invalid"],
        [{paidNowCents: -1}, "paid_now_invalid"],
        [{customerName: ""}, "credit_customer_required"],
        [{customerPhone: ""}, "credit_customer_required"],
        [{customerPhone: "207 555 0100"}, "customer_phone_invalid"],
        [{collectorStaffId: ""}, "collector_invalid"],
        [{collectorStaffId: OUTSIDER}, "collector_invalid"],
        [{dueDate: "2020-01-01"}, "due_date_invalid"],
        [{dueDate: "2099-02-30"}, "due_date_invalid"],
      ];
      for (const [bad, code] of cases) {
        await assert.rejects(sellIn({credit: creditOf(bad)}),
            refusal(code, "invalid-argument"), JSON.stringify(bad));
      }
      // Paying something now still needs the method.
      await assert.rejects(sellIn({paymentMethod: "", credit: creditOf()}),
          refusal("payment_method_invalid"));
    });

    it("answers a retried credit sale as the same sale", async () => {
      const clientRequestId = requestId();
      const data = {clientRequestId, paymentMethod: "cash",
        lines: [{itemId, quantity: 1, soldPriceCents: 6000}],
        credit: creditOf()};
      const first = await s("recordInventorySale", data, CLERK);
      const stock = (await itemDoc(itemId)).quantity;
      const again = await s("recordInventorySale", data, CLERK);
      assert.equal(again.replayed, true);
      assert.equal(again.saleId, first.saleId);
      assert.equal(again.creditCents, 4000);
      assert.equal((await itemDoc(itemId)).quantity, stock);
      assert.equal((await pushesFor(first.saleId)).length, 1);
    });
  });

  describe("collecting later", () => {
    let saleId;
    before(async () => {
      saleId = (await sellIn({credit: creditOf()})).saleId;
    });

    it("takes partial payments until paid, then refuses more", async () => {
      const first = await s("recordInventoryCreditPayment", {saleId,
        amountCents: 1500, method: "zelle", receivedByStaffId: COLLECTOR,
        note: "first half"}, CLERK);
      assert.deepEqual([first.creditPaidCents, first.creditStatus],
          [1500, "open"]);
      // More than is left is a typo, refused.
      await assert.rejects(s("recordInventoryCreditPayment", {saleId,
        amountCents: 2501, method: "cash"}, CLERK),
      refusal("payment_exceeds_balance", "invalid-argument"));
      const last = await s("recordInventoryCreditPayment", {saleId,
        amountCents: 2500, method: "cash"}, OWN);
      assert.deepEqual([last.creditPaidCents, last.creditStatus],
          [4000, "paid"]);
      await assert.rejects(s("recordInventoryCreditPayment", {saleId,
        amountCents: 1, method: "cash"}, OWN),
      refusal("payment_exceeds_balance"));
      const sale = await saleOf(saleId);
      assert.deepEqual([sale.creditPaidCents, sale.creditStatus],
          [4000, "paid"]);
      const rows = await paymentsOf(saleId);
      assert.equal(rows.length, 2);
      const byAmount = Object.fromEntries(rows.map((r) => [r.amountCents, r]));
      assert.equal(byAmount[1500].receivedByStaffId, COLLECTOR);
      assert.equal(byAmount[1500].recordedByStaffId, CLERK);
      assert.equal(byAmount[1500].note, "first half");
      assert.equal(byAmount[1500].storeId, "");
      // Nobody named: the person entering it held the money.
      assert.equal(byAmount[2500].receivedByStaffId, OWN);
      assert.equal(byAmount[2500].reverted, false);
    });

    it("reverts a payment and opens the credit again", async () => {
      const rows = await paymentsOf(saleId);
      const target = rows.find((r) => r.amountCents === 2500);
      const out = await s("revertInventoryCreditPayment",
          {paymentId: target.id}, CLERK);
      assert.deepEqual([out.creditPaidCents, out.creditStatus, out.saleId],
          [1500, "open", saleId]);
      const row = (await db.collection("inventoryCreditPayments")
          .doc(target.id).get()).data();
      assert.equal(row.reverted, true);
      assert.equal(row.revertedByStaffId, CLERK);
      assert.ok(row.revertedAt);
      await assert.rejects(s("revertInventoryCreditPayment",
          {paymentId: target.id}, CLERK),
      refusal("payment_already_reverted", "failed-precondition"));
      await assert.rejects(s("revertInventoryCreditPayment",
          {paymentId: "nope"}, CLERK),
      refusal("payment_not_found", "not-found"));
    });

    it("refuses a void while money collected on it stands", async () => {
      await assert.rejects(s("voidInventorySale", {saleId}, OWN),
          refusal("credit_has_payments", "failed-precondition"));
      for (const row of await paymentsOf(saleId)) {
        if (!row.reverted) {
          await s("revertInventoryCreditPayment", {paymentId: row.id}, OWN);
        }
      }
      await s("voidInventorySale", {saleId}, OWN);
      const sale = await saleOf(saleId);
      assert.equal(sale.voided, true);
      // A voided sale leaves the open-credit list.
      assert.equal(sale.creditStatus, "none");
      await assert.rejects(s("recordInventoryCreditPayment", {saleId,
        amountCents: 100, method: "cash"}, OWN),
      refusal("sale_voided", "failed-precondition"));
    });

    it("refuses payments on a normal sale, bad amounts and strangers",
        async () => {
          const plain = (await sellIn()).saleId;
          await assert.rejects(s("recordInventoryCreditPayment", {
            saleId: plain, amountCents: 100, method: "cash"}, OWN),
          refusal("no_credit", "failed-precondition"));
          const open = (await sellIn({credit: creditOf()})).saleId;
          await assert.rejects(s("recordInventoryCreditPayment", {
            saleId: open, amountCents: 0, method: "cash"}, OWN),
          refusal("amount_invalid"));
          await assert.rejects(s("recordInventoryCreditPayment", {
            saleId: open, amountCents: 100, method: "bitcoin"}, OWN),
          refusal("payment_method_invalid"));
          await assert.rejects(s("recordInventoryCreditPayment", {
            saleId: open, amountCents: 100, method: "cash",
            receivedByStaffId: OUTSIDER}, OWN),
          refusal("received_by_invalid"));
          await assert.rejects(s("recordInventoryCreditPayment", {
            saleId: "nope", amountCents: 100, method: "cash"}, OWN),
          refusal("sale_not_found", "not-found"));
          // A sale of this business is not another business's to touch.
          await assert.rejects(functions.recordInventoryCreditPayment.run({
            auth: {uid: OUTSIDER, token: {}}, data: {businessId: CB,
              saleId: open, amountCents: 100, method: "cash"}}),
          (error) => error.code === "permission-denied");
        });

    it("never overpays when two payments race", async () => {
      const open = (await sellIn({credit: creditOf()})).saleId;
      const results = await Promise.allSettled([3000, 3000].map((amount) =>
        s("recordInventoryCreditPayment", {saleId: open,
          amountCents: amount, method: "cash"}, OWN)));
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal((await saleOf(open)).creditPaidCents, 3000);
    });
  });

  describe("changing the collector", () => {
    it("reassigns, moves the due date, tells the new collector", async () => {
      const saleId = (await sellIn({credit: creditOf({
        collectorStaffId: CLERK})})).saleId;
      const out = await s("setInventoryCreditCollector", {saleId,
        collectorStaffId: COLLECTOR, dueDate: "2099-06-01"}, OWN);
      assert.deepEqual([out.collectorStaffId, out.dueDate, out.changed],
          [COLLECTOR, "2099-06-01", true]);
      const sale = await saleOf(saleId);
      assert.equal(sale.credit.collectorStaffId, COLLECTOR);
      assert.equal(sale.credit.dueDate, "2099-06-01");
      assert.equal(sale.credit.customerName, "Fatou Bah");
      assert.equal(sale.creditUpdatedByStaffId, OWN);
      const pushes = await pushesFor(saleId);
      assert.deepEqual(pushes.map((p) => p.recipientUid), [COLLECTOR]);
      // Leaving dueDate out keeps it; "" clears it.
      await s("setInventoryCreditCollector", {saleId,
        collectorStaffId: COLLECTOR}, OWN);
      assert.equal((await saleOf(saleId)).credit.dueDate, "2099-06-01");
      await s("setInventoryCreditCollector", {saleId,
        collectorStaffId: COLLECTOR, dueDate: ""}, OWN);
      assert.equal((await saleOf(saleId)).credit.dueDate, "");
      // Neither of those changed the collector: no new push.
      assert.equal((await pushesFor(saleId)).length, 1);
      const history = await db.collection("lotLedgerAudit")
          .where("businessId", "==", CB).where("entityId", "==", saleId)
          .where("action", "==", "credit_collector_changed").get();
      assert.equal(history.size, 2);
    });

    it("refuses an outsider, a past date and a sale without credit",
        async () => {
          const saleId = (await sellIn({credit: creditOf()})).saleId;
          await assert.rejects(s("setInventoryCreditCollector", {saleId,
            collectorStaffId: OUTSIDER}, OWN), refusal("collector_invalid"));
          await assert.rejects(s("setInventoryCreditCollector", {saleId,
            collectorStaffId: COLLECTOR, dueDate: "2020-01-01"}, OWN),
          refusal("due_date_invalid"));
          const plain = (await sellIn()).saleId;
          await assert.rejects(s("setInventoryCreditCollector", {
            saleId: plain, collectorStaffId: COLLECTOR}, OWN),
          refusal("no_credit"));
        });
  });

  describe("overdue reminders", () => {
    it("reminds the collector and the owner once every 3 days",
        async () => {
          const saleId = (await sellIn({credit: creditOf()})).saleId;
          // Due in the past (a client can only pick today or later).
          await db.collection("inventorySales").doc(saleId)
              .update({"credit.dueDate": "2026-01-02"});
          const overdue = async () => (await db.collection(
              "notificationDeliveries").where("data.saleId", "==", saleId)
              .where("title", "==", "Credit overdue").get()).docs
              .map((d) => d.data());
          await functions.remindOverdueInventoryCredit.run();
          const first = await overdue();
          assert.deepEqual(first.map((p) => p.recipientUid).sort(),
              [COLLECTOR, OWN].sort());
          assert.equal(first[0].body,
              "Fatou Bah owes $40.00 · sale · due 01/02/2026");
          assert.ok((await saleOf(saleId)).lastCreditReminderAt);
          // The next morning: nothing new.
          await functions.remindOverdueInventoryCredit.run();
          assert.equal((await overdue()).length, first.length);
          // Three days later, again.
          await db.collection("inventorySales").doc(saleId).update({
            lastCreditReminderAt: admin.firestore.Timestamp.fromMillis(
                Date.now() - 3 * 24 * 60 * 60 * 1000)});
          await functions.remindOverdueInventoryCredit.run();
          assert.equal((await overdue()).length, first.length * 2);
          // Paid off: never again.
          await s("recordInventoryCreditPayment", {saleId,
            amountCents: 4000, method: "cash"}, OWN);
          await db.collection("inventorySales").doc(saleId)
              .update({lastCreditReminderAt: null});
          await functions.remindOverdueInventoryCredit.run();
          assert.equal((await overdue()).length, first.length * 2);
        });
  });

  describe("in a business with several stores", () => {
    const MB = "inv-credit-stores";
    const MOWN = "inv-credit-stores-owner";
    const MAIN_CLERK = "inv-credit-stores-main";
    const ANNEX_CLERK = "inv-credit-stores-annex";
    const m = callIn(MB);
    let saleId;
    let annex;

    before(async () => {
      const clerk = {role: "staff", businessId: MB,
        businessPermissions: ["inventory"]};
      await seedBusiness(MB, {
        [MOWN]: {role: "businessOwner", businessId: MB},
        [MAIN_CLERK]: clerk, [ANNEX_CLERK]: clerk,
      });
      const product = (await m("createInventoryItem", {name: "Pagne",
        priceCents: 5000, quantity: 10}, MOWN)).itemId;
      annex = (await m("createInventoryStore", {name: "Annex"}, MOWN)).storeId;
      await m("setInventoryStaffAccess", {userId: MAIN_CLERK,
        homeStoreId: `${MB}_main`, allStores: false}, MOWN);
      await m("setInventoryStaffAccess", {userId: ANNEX_CLERK,
        homeStoreId: annex, allStores: false}, MOWN);
      saleId = (await m("recordInventorySale", {clientRequestId: requestId(),
        paymentMethod: "cash", lines: [{itemId: product, quantity: 1,
          soldPriceCents: 5000}], credit: {paidNowCents: 1000,
          customerName: "Aminata", customerPhone: "+224620000000",
          collectorStaffId: ANNEX_CLERK}}, MAIN_CLERK)).saleId;
    });

    it("names the store to the collector", async () => {
      const [push] = await pushesFor(saleId);
      assert.equal(push.recipientUid, ANNEX_CLERK);
      assert.equal(push.body, "Aminata owes $40.00 · Main store");
      assert.equal(push.data.storeId, `${MB}_main`);
    });

    it("keeps another store's staff out of the sale's credit", async () => {
      await assert.rejects(m("recordInventoryCreditPayment", {saleId,
        amountCents: 100, method: "cash"}, ANNEX_CLERK),
      refusal("store_not_allowed", "permission-denied"));
      await assert.rejects(m("setInventoryCreditCollector", {saleId,
        collectorStaffId: MAIN_CLERK}, ANNEX_CLERK),
      refusal("store_not_allowed"));
      const paid = await m("recordInventoryCreditPayment", {saleId,
        amountCents: 1000, method: "cash"}, MAIN_CLERK);
      assert.equal(paid.creditPaidCents, 1000);
      const [row] = await (await db.collection("inventoryCreditPayments")
          .where("businessId", "==", MB).where("saleId", "==", saleId).get())
          .docs.map((d) => ({id: d.id, ...d.data()}));
      assert.equal(row.storeId, `${MB}_main`);
      await assert.rejects(m("revertInventoryCreditPayment",
          {paymentId: row.id}, ANNEX_CLERK), refusal("store_not_allowed"));
      await m("revertInventoryCreditPayment", {paymentId: row.id}, MOWN);
    });
  });

  it("splits the summary into paid now and on credit", async () => {
    const SB = "inv-credit-summary";
    const SOWN = "inv-credit-summary-owner";
    const x = callIn(SB);
    await seedBusiness(SB, {[SOWN]: {role: "businessOwner", businessId: SB}});
    const product = (await x("createInventoryItem", {name: "Cap",
      priceCents: 1000, quantity: 10}, SOWN)).itemId;
    const line = [{itemId: product, quantity: 1, soldPriceCents: 1000}];
    await x("recordInventorySale", {clientRequestId: requestId(),
      paymentMethod: "cash", lines: line}, SOWN);
    const credit = await x("recordInventorySale", {clientRequestId:
      requestId(), paymentMethod: "cash", lines: line, credit: {
      paidNowCents: 400, customerName: "Awa", customerPhone: "+12075550101",
      collectorStaffId: SOWN}}, SOWN);
    await x("recordInventoryCreditPayment", {saleId: credit.saleId,
      amountCents: 100, method: "cash"}, SOWN);
    const summary = await x("getInventorySummary", {range: "today",
      timeZone: "America/New_York"}, SOWN);
    assert.equal(summary.revenueCents, 2000);
    assert.equal(summary.paidNowCents, 1400);
    assert.equal(summary.creditCents, 600);
    assert.equal(summary.creditOutstandingCents, 500);
  });
});
