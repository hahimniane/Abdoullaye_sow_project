"use strict";

// Store transfers (docs/INVENTORY.md "Store transfers (v5)"): the pure rules.
// The emulator suite (inventory-transfer-callables.test.js) runs the same
// rules through real transactions.

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");
const inv = require("../inventory");
const tr = require("../inventory_transfers");

const MAIN = "biz_main";
const stores = [
  {id: MAIN, name: "Main store", archived: false},
  {id: "bronx", name: "Bronx store", archived: false},
  {id: "harlem", name: "Harlem store", archived: false},
  {id: "old", name: "Old store", archived: true},
];
const owner = {owner: true, all: true, homeStoreId: ""};
const bronxStaff = {owner: false, all: false, homeStoreId: "bronx"};
const harlemStaff = {owner: false, all: false, homeStoreId: "harlem"};
const allStaff = {owner: false, all: true, homeStoreId: ""};
const noStore = {owner: false, all: false, homeStoreId: ""};

const line = (itemId, sent, extra = {}) => ({
  ...tr.transferLine(itemId, {name: `P ${itemId}`, brand: "", code: "IT-1",
    costCents: 100}, sent),
  ...extra,
});

describe("transfers: refusal codes and movements", () => {
  it("gives every new code its message and kind", () => {
    const kinds = {
      transfer_not_found: "not-found",
      transfer_not_draft: "failed-precondition",
      transfer_not_in_transit: "failed-precondition",
      line_not_disputed: "failed-precondition",
      line_already_resolved: "failed-precondition",
      store_has_transfers: "failed-precondition",
      item_in_transfer: "failed-precondition",
      item_not_in_transfer: "invalid-argument",
      received_too_many: "invalid-argument",
      write_off_reason_invalid: "invalid-argument",
      resolution_invalid: "invalid-argument",
      note_too_long: "invalid-argument",
      transfer_lines_required: "invalid-argument",
      transfer_lines_too_many: "invalid-argument",
    };
    for (const [code, kind] of Object.entries(kinds)) {
      assert.equal(inv.refusalKind(code), kind, code);
      assert.notEqual(inv.inventoryMessage(code), code, code);
    }
  });

  it("knows the transfer movements and keeps the instant pair", () => {
    for (const type of ["transfer_out", "transfer_in", "transfer_sent",
      "transfer_received", "transfer_cancelled", "transfer_returned",
      "transfer_written_off"]) {
      assert.ok(inv.MOVEMENT_TYPES.includes(type), type);
    }
  });

  it("stores the code and the other store on a transfer movement only",
      () => {
        const moved = inv.movementRecord({businessId: "b", itemId: "i",
          type: "transfer_sent", delta: -3, quantityAfter: 2, uid: "u",
          storeId: "bronx", transferId: "t1", transferCode: "TR-ABC123",
          counterpartStoreId: "harlem"});
        assert.equal(moved.transferCode, "TR-ABC123");
        assert.equal(moved.counterpartStoreId, "harlem");
        assert.equal(moved.delta, -3);
        const plain = inv.movementRecord({businessId: "b", itemId: "i",
          type: "add", delta: 1, quantityAfter: 1, uid: "u"});
        assert.equal("transferCode" in plain, false);
        assert.equal("counterpartStoreId" in plain, false);
      });
});

describe("transfers: input", () => {
  it("ties the document id to the business and the retry key", () => {
    const a = tr.transferDocId("b1", "key-12345678");
    assert.equal(a.length, 40);
    assert.equal(a, tr.transferDocId("b1", "key-12345678"));
    assert.notEqual(a, tr.transferDocId("b2", "key-12345678"));
    assert.notEqual(a, tr.transferDocId("b1", "key-12345679"));
    // A sale with the same key never shares the transfer's id.
    assert.notEqual(a, inv.saleDocId("b1", "key-12345678"));
  });

  it("merges a product added twice and reads the stores", () => {
    const input = tr.cleanTransferInput({clientRequestId: "key-12345678",
      fromStoreId: " bronx ", toStoreId: "harlem", lines: [
        {itemId: "a", quantity: 2}, {itemId: "b", quantity: "3"},
        {itemId: "a", quantity: 4}]});
    assert.deepEqual(input.errors, []);
    assert.equal(input.fromStoreId, "bronx");
    assert.deepEqual(input.lines,
        [{itemId: "a", quantity: 6}, {itemId: "b", quantity: 3}]);
  });

  it("refuses a bad key, the same store, no lines, bad quantities", () => {
    assert.deepEqual(tr.cleanTransferInput({clientRequestId: "short",
      fromStoreId: "a", toStoreId: "a", lines: []}).errors,
    ["client_request_id_invalid", "same_store", "transfer_lines_required"]);
    for (const quantity of [0, -1, 1.5, "", null, true, 1000001]) {
      assert.deepEqual(tr.cleanTransferInput({clientRequestId: "key-12345678",
        fromStoreId: "a", toStoreId: "b",
        lines: [{itemId: "x", quantity}]}).errors, ["quantity_invalid"],
      String(quantity));
    }
    // Two halves that pass the maximum together.
    assert.deepEqual(tr.cleanTransferInput({clientRequestId: "key-12345678",
      fromStoreId: "a", toStoreId: "b", lines: [
        {itemId: "x", quantity: 600000}, {itemId: "x", quantity: 600000}]})
        .errors, ["quantity_invalid"]);
    assert.deepEqual(tr.cleanTransferInput({clientRequestId: "key-12345678",
      fromStoreId: "a", toStoreId: "b", lines: [{itemId: "x/y", quantity: 1}]})
        .errors, ["item_not_found"]);
    assert.deepEqual(tr.cleanTransferInput({clientRequestId: "key-12345678",
      fromStoreId: "", toStoreId: "b", lines: [{itemId: "x", quantity: 1}]})
        .errors, ["store_not_found"]);
  });

  it("allows at most 100 products", () => {
    const lines = Array.from({length: 101}, (_, i) =>
      ({itemId: `p${i}`, quantity: 1}));
    assert.deepEqual(tr.cleanTransferInput({clientRequestId: "key-12345678",
      fromStoreId: "a", toStoreId: "b", lines}).errors,
    ["transfer_lines_too_many"]);
    assert.deepEqual(tr.cleanTransferInput({clientRequestId: "key-12345678",
      fromStoreId: "a", toStoreId: "b", lines: lines.slice(0, 100)}).errors,
    []);
  });
});

describe("transfers: who may do what", () => {
  const check = (access, from = "bronx", to = "harlem", converted = true) =>
    tr.checkTransferStores({converted, stores, fromStoreId: from,
      toStoreId: to, access}).code;

  it("lets the source store's staff, owners and all-stores staff send", () => {
    assert.equal(check(bronxStaff), null);
    assert.equal(check(owner), null);
    assert.equal(check(allStaff), null);
    assert.equal(check(harlemStaff), "store_not_allowed");
    assert.equal(check(noStore), "home_store_required");
  });

  it("refuses unknown, archived and identical stores", () => {
    assert.equal(check(owner, "bronx", "nowhere"), "store_not_found");
    assert.equal(check(owner, "bronx", "old"), "store_archived");
    assert.equal(check(owner, "old", "bronx"), "store_archived");
    assert.equal(check(owner, "bronx", "bronx"), "same_store");
    assert.equal(check(owner, "bronx", "harlem", false), "store_not_found");
  });

  it("cancels, discards, receives and settles by role", () => {
    const t = {fromStoreId: "bronx", toStoreId: "harlem",
      sentByStaffId: "sender", createdByStaffId: "maker"};
    assert.equal(tr.canCancel(bronxStaff, "sender", t), true);
    assert.equal(tr.canCancel(bronxStaff, "someone", t), false);
    assert.equal(tr.canCancel(allStaff, "someone", t), true);
    assert.equal(tr.canCancel(harlemStaff, "other", t), false);
    assert.equal(tr.canDiscardDraft(bronxStaff, "x", t), true);
    assert.equal(tr.canDiscardDraft(harlemStaff, "maker", t), true);
    assert.equal(tr.canDiscardDraft(harlemStaff, "x", t), false);
    assert.equal(tr.canReceive(harlemStaff, t), true);
    assert.equal(tr.canReceive(bronxStaff, t), false);
    assert.equal(tr.canReceive(owner, t), true);
    assert.equal(tr.canReceive(noStore, t), false);
    assert.equal(tr.canResolve(owner), true);
    assert.equal(tr.canResolve(allStaff), true);
    assert.equal(tr.canResolve(harlemStaff), false);
  });
});

describe("transfers: send", () => {
  const items = new Map([
    ["a", {quantity: 10, storeStock: true, costCents: 100}],
    ["legacy", {quantity: 7, costCents: null}],
    ["gone", {quantity: 4, storeStock: true, archived: true}],
  ]);
  const rows = new Map([["a", {quantity: 6, countWasOff: true}]]);

  it("takes the pieces out of the source row and the total", () => {
    const plan = tr.planSend({lines: [{itemId: "a", quantity: 4}], items, rows,
      fromStoreId: "bronx", mainStoreId: MAIN});
    assert.deepEqual(plan.errors, []);
    assert.deepEqual(plan.writes, [{itemId: "a", amount: 4, rowQuantity: 2,
      rowCountWasOff: true, totalAfter: 6, extraRows: []}]);
  });

  it("can send everything a store holds, not one more", () => {
    assert.deepEqual(tr.planSend({lines: [{itemId: "a", quantity: 6}], items,
      rows, fromStoreId: "bronx", mainStoreId: MAIN}).errors, []);
    const over = tr.planSend({lines: [{itemId: "a", quantity: 7}], items, rows,
      fromStoreId: "bronx", mainStoreId: MAIN});
    assert.deepEqual(over.errors, ["insufficient_stock"]);
    assert.deepEqual(over.details.available, {a: 6});
    assert.deepEqual(over.writes, []);
  });

  it("reads a product without rows as held whole by Main", () => {
    const plan = tr.planSend({lines: [{itemId: "legacy", quantity: 3}], items,
      rows: new Map(), fromStoreId: MAIN, mainStoreId: MAIN});
    assert.deepEqual(plan.writes, [{itemId: "legacy", amount: 3,
      rowQuantity: 4, rowCountWasOff: false, totalAfter: 4, extraRows: []}]);
    // From another store it holds nothing there.
    assert.deepEqual(tr.planSend({lines: [{itemId: "legacy", quantity: 1}],
      items, rows: new Map(), fromStoreId: "bronx", mainStoreId: MAIN}).errors,
    ["insufficient_stock"]);
  });

  it("names every refused product at once and writes nothing", () => {
    const plan = tr.planSend({lines: [{itemId: "a", quantity: 99},
      {itemId: "gone", quantity: 1}, {itemId: "nope", quantity: 1}], items,
    rows, fromStoreId: "bronx", mainStoreId: MAIN});
    assert.deepEqual(plan.errors,
        ["item_not_found", "item_archived", "insufficient_stock"]);
    assert.deepEqual(plan.details.byReason, {item_not_found: ["nope"],
      item_archived: ["gone"], insufficient_stock: ["a"]});
    assert.deepEqual(plan.details.itemIds, ["nope", "gone", "a"]);
    assert.deepEqual(plan.writes, []);
  });

  it("snapshots the product on the line", () => {
    assert.deepEqual(tr.transferLine("a", {name: " 11 ", brand: "Jordan",
      code: "IT-AAAAAA", costCents: 2500}, 3), {itemId: "a", name: "11",
      brand: "Jordan", code: "IT-AAAAAA", costCents: 2500, quantitySent: 3,
      quantityReceived: null, missing: 0, resolution: "", writeOffReason: "",
      resolutionNote: "", resolvedByStaffId: "", resolvedByName: "",
      resolvedAt: null});
    assert.equal(tr.transferLine("a", {costCents: null}, 1).costCents, null);
    assert.equal(tr.transferLine("a", {costCents: 1.5}, 1).costCents, null);
  });
});

describe("transfers: receive", () => {
  const lines = [line("a", 6), line("b", 5), line("c", 3)];

  it("reads a line left out as arrived in full", () => {
    const input = tr.cleanReceiveInput({lines: [
      {itemId: "a", quantityReceived: 4}]}, lines);
    assert.deepEqual(input.errors, []);
    assert.deepEqual([...input.received], [["a", 4], ["b", 5], ["c", 3]]);
  });

  it("refuses more than was sent, unknown products, repeats, long notes",
      () => {
        assert.deepEqual(tr.cleanReceiveInput({lines: [
          {itemId: "a", quantityReceived: 7}]}, lines).errors,
        ["received_too_many"]);
        assert.deepEqual(tr.cleanReceiveInput({lines: [
          {itemId: "z", quantityReceived: 1}]}, lines).errors,
        ["item_not_in_transfer"]);
        assert.deepEqual(tr.cleanReceiveInput({lines: [
          {itemId: "a", quantityReceived: 1},
          {itemId: "a", quantityReceived: 2}]}, lines).errors,
        ["quantity_invalid"]);
        for (const bad of [-1, 1.5, "", null, "x"]) {
          assert.deepEqual(tr.cleanReceiveInput({lines: [
            {itemId: "a", quantityReceived: bad}]}, lines).errors,
          ["quantity_invalid"], String(bad));
        }
        assert.deepEqual(tr.cleanReceiveInput({note: "x".repeat(301)}, lines)
            .errors, ["note_too_long"]);
        assert.equal(tr.cleanReceiveInput({note: "  Box opened "}, lines).note,
            "Box opened");
      });

  it("puts what arrived into the destination and holds the rest", () => {
    const items = new Map([
      ["a", {quantity: 2, storeStock: true}],
      ["b", {quantity: 0, storeStock: true}],
      ["c", {quantity: 9, storeStock: true}],
    ]);
    const rows = new Map([["c", {quantity: 1, countWasOff: false}]]);
    const received = new Map([["a", 4], ["b", 5], ["c", 0]]);
    const plan = tr.planReceive({lines, received, items, rows,
      toStoreId: "harlem", mainStoreId: MAIN});
    assert.equal(plan.status, "received_with_differences");
    assert.equal(plan.stage, "review");
    assert.deepEqual(plan.writes.map((w) => [w.itemId, w.amount,
      w.rowQuantity, w.totalAfter]), [["a", 4, 4, 6], ["b", 5, 5, 5]]);
    assert.deepEqual(plan.lines.map((l) => [l.quantityReceived, l.missing]),
        [[4, 2], [5, 0], [0, 3]]);
    assert.equal(plan.totals.receivedCount, 9);
    assert.equal(plan.totals.missingCount, 5);
    assert.equal(plan.totals.openMissingCount, 5);
  });

  it("finishes a transfer where everything arrived", () => {
    const items = new Map(lines.map((l) => [l.itemId,
      {quantity: 0, storeStock: true}]));
    const plan = tr.planReceive({lines,
      received: tr.cleanReceiveInput({}, lines).received, items,
      rows: new Map(), toStoreId: "harlem", mainStoreId: MAIN});
    assert.equal(plan.status, "received");
    assert.equal(plan.stage, "done");
    assert.equal(plan.totals.missingCount, 0);
    assert.equal(plan.totals.receivedCount, 14);
  });

  it("refuses to pass the most a store can hold", () => {
    const plan = tr.planStockIn({itemId: "a",
      item: {quantity: 999999, storeStock: true},
      row: {quantity: 999999}, storeId: "harlem", mainStoreId: MAIN,
      amount: 2});
    assert.deepEqual(plan.errors, ["quantity_invalid"]);
  });

  it("materialises Main when stock arrives for a product without rows", () => {
    const plan = tr.planStockIn({itemId: "legacy", item: {quantity: 5},
      row: undefined, storeId: "harlem", mainStoreId: MAIN, amount: 2});
    assert.deepEqual(plan.write.extraRows,
        [{storeId: MAIN, quantity: 5, countWasOff: false}]);
    assert.equal(plan.write.totalAfter, 7);
    assert.equal(plan.write.rowQuantity, 2);
  });
});

describe("transfers: cancel", () => {
  it("puts every sent piece back in the source store", () => {
    const lines = [line("a", 4), line("b", 2), line("gone", 1)];
    const items = new Map([["a", {quantity: 6, storeStock: true}],
      ["b", {quantity: 0, storeStock: true}]]);
    const rows = new Map([["a", {quantity: 2, countWasOff: true}]]);
    const plan = tr.planCancel({lines, items, rows, fromStoreId: "bronx",
      mainStoreId: MAIN});
    assert.deepEqual(plan.writes.map((w) => [w.itemId, w.rowQuantity,
      w.rowCountWasOff, w.totalAfter]), [["a", 6, true, 10], ["b", 2, false,
      2]]);
    assert.deepEqual(plan.skippedItemIds, ["gone"]);
    assert.equal(plan.itemsReturned, 6);
  });
});

describe("transfers: owner review", () => {
  const disputed = {status: "received_with_differences", lines: [
    line("a", 6, {quantityReceived: 4, missing: 2}),
    line("b", 5, {quantityReceived: 5, missing: 0}),
  ]};

  it("reads the decision", () => {
    assert.deepEqual(tr.cleanResolveInput({itemId: "a", action: "write_off",
      reason: "lost", note: " gone "}), {errors: [], itemId: "a",
      action: "write_off", reason: "lost", note: "gone", requestId: ""});
    assert.deepEqual(tr.cleanResolveInput({itemId: "a", action: "return",
      reason: "lost"}).reason, "");
    assert.deepEqual(tr.cleanResolveInput({itemId: "a", action: "keep"})
        .errors, ["resolution_invalid"]);
    assert.deepEqual(tr.cleanResolveInput({itemId: "a",
      action: "write_off"}).errors, ["write_off_reason_invalid"]);
    assert.deepEqual(tr.cleanResolveInput({itemId: "a", action: "write_off",
      reason: "eaten"}).errors, ["write_off_reason_invalid"]);
    assert.deepEqual(tr.cleanResolveInput({itemId: "a", action: "return",
      note: "x".repeat(301)}).errors, ["note_too_long"]);
    assert.deepEqual(tr.cleanResolveInput({action: "return"}).errors,
        ["item_not_in_transfer"]);
  });

  it("decides only a missing line, once", () => {
    const input = (extra) => tr.cleanResolveInput({itemId: "a",
      action: "return", ...extra});
    assert.equal(tr.checkResolve(disputed, input()).code, null);
    assert.equal(tr.checkResolve(disputed, input({itemId: "b"})).code,
        "line_not_disputed");
    assert.equal(tr.checkResolve(disputed, input({itemId: "z"})).code,
        "item_not_in_transfer");
    assert.equal(tr.checkResolve({...disputed, status: "received"}, input())
        .code, "line_not_disputed");
    const decided = {...disputed, lines: [tr.resolvedLine(disputed.lines[0],
        {action: "return", reason: "", note: "", uid: "o", name: "Owner",
          at: 1, requestId: "req-12345678"}), disputed.lines[1]]};
    const again = tr.checkResolve(decided, input());
    assert.equal(again.code, "line_already_resolved");
    assert.deepEqual(again.details, {resolution: "returned"});
    // The same request again is a replay, not a refusal.
    assert.equal(tr.checkResolve(decided, input({requestId: "req-12345678"}))
        .replayed, true);
    assert.equal(tr.checkResolve(decided, tr.cleanResolveInput({itemId: "a",
      action: "write_off", reason: "lost", requestId: "req-12345678"})).code,
    "line_already_resolved");
  });

  it("settles the transfer when the last missing line is decided", () => {
    assert.equal(tr.stageOf(disputed.status, disputed.lines), "review");
    const lines = [tr.resolvedLine(disputed.lines[0], {action: "write_off",
      reason: "stolen", note: "", uid: "o", name: "Owner", at: 1}),
    disputed.lines[1]];
    assert.equal(tr.stageOf(disputed.status, lines), "done");
    const totals = tr.transferTotals(lines);
    assert.equal(totals.openMissingCount, 0);
    assert.equal(totals.writtenOffCount, 2);
    assert.equal(lines[0].writeOffReason, "stolen");
  });

  it("maps each status to its stage", () => {
    assert.equal(tr.stageOf("draft", []), "draft");
    assert.equal(tr.stageOf("in_transit", []), "in_transit");
    assert.equal(tr.stageOf("received", []), "done");
    assert.equal(tr.stageOf("cancelled", []), "done");
  });
});

describe("transfers: totals", () => {
  it("counts value at known cost only", () => {
    const lines = [
      line("a", 6, {quantityReceived: 4, missing: 2}),
      {...line("b", 5), costCents: null, quantityReceived: 3, missing: 2},
    ];
    assert.deepEqual(tr.transferTotals(lines), {productsCount: 2,
      itemsCount: 11, receivedCount: 7, missingCount: 4, openMissingCount: 4,
      returnedCount: 0, writtenOffCount: 0, valueCents: 600,
      openMissingValueCents: 200, linesWithoutCost: 1});
    assert.equal(tr.transferTotals([line("a", 2)]).receivedCount, null);
  });
});

describe("transfers: history sentences", () => {
  const t = {code: "TR-ABC123", fromStoreName: "Bronx store",
    toStoreName: "Harlem store", itemsCount: 14, receivedCount: 12,
    missingCount: 2};
  it("writes each event the way the contract spells it", () => {
    assert.equal(tr.transferAuditSummary("sent", t),
        "Sent 14 items from Bronx store to Harlem store (TR-ABC123)");
    assert.equal(tr.transferAuditSummary("sent", {...t, itemsCount: 1}),
        "Sent 1 item from Bronx store to Harlem store (TR-ABC123)");
    assert.equal(tr.transferAuditSummary("cancelled", t),
        "Cancelled TR-ABC123: 14 items back in Bronx store");
    assert.equal(tr.transferAuditSummary("draft_discarded", t),
        "Discarded the draft TR-ABC123");
    assert.equal(tr.transferAuditSummary("received", t),
        "Harlem store received all 14 items of TR-ABC123");
    assert.equal(tr.transferAuditSummary("received_with_differences", t),
        "Harlem store received 12 of 14 items of TR-ABC123: 2 missing");
    assert.equal(tr.transferAuditSummary("returned",
        {...t, quantity: 2, itemName: "Jordan 11"}),
    "Returned 2 of Jordan 11 to Bronx store (TR-ABC123)");
    assert.equal(tr.transferAuditSummary("written_off",
        {...t, quantity: 2, itemName: "Jordan 11", reason: "lost"}),
    "Wrote off 2 of Jordan 11 from TR-ABC123: Lost in transit");
    assert.equal(tr.writeOffReasonLabel("damaged", "fr"), "Abîmé");
  });
});

describe("transfers: notifications", () => {
  const transfer = {id: "t1", businessId: "biz", code: "TR-ABC123",
    fromStoreId: "bronx", fromStoreName: "Bronx store", toStoreId: "harlem",
    toStoreName: "Harlem store", status: "in_transit",
    sentAt: Date.UTC(2026, 9, 15, 14), lines: [line("a", 9), line("b", 5)]};
  const staff = (id, extra = {}) => ({id, role: "staff", businessId: "biz",
    businessPermissions: ["inventory"], ...extra});
  const users = [
    {id: "own", role: "businessOwner", businessId: "biz"},
    staff("harlem1", {inventoryHomeStoreId: "harlem"}),
    staff("harlem-fr", {inventoryHomeStoreId: "harlem",
      preferredLanguage: "fr"}),
    staff("bronx1", {inventoryHomeStoreId: "bronx"}),
    staff("roamer", {inventoryAllStores: true}),
    staff("muted", {inventoryHomeStoreId: "harlem",
      notificationPreferences: {inventoryTransfers: false}}),
    staff("no-perm", {inventoryHomeStoreId: "harlem",
      businessPermissions: ["ledger"]}),
    staff("other-biz", {businessId: "x", inventoryHomeStoreId: "harlem"}),
  ];
  const plan = (kind, extra = {}) => tr.planTransferNotification({transfer,
    kind, users, actorUid: "bronx1", ownerUids: ["own"],
    nowMs: Date.UTC(2026, 9, 18, 13), ...extra});

  it("tells the destination's team and the owner when stock is sent", () => {
    const sent = plan("sent");
    assert.deepEqual(sent.recipients.map((r) => r.uid),
        ["own", "harlem-fr", "harlem1"]);
    assert.deepEqual(sent.recipients[0], {uid: "own", language: "en",
      title: "Bronx store sent 14 items to Harlem store",
      body: "TR-ABC123 · in transit"});
    assert.deepEqual(sent.recipients[2], {uid: "harlem1", language: "en",
      title: "Bronx store sent you 14 items",
      body: "TR-ABC123 · confirm when they arrive"});
    assert.deepEqual(sent.recipients[1], {uid: "harlem-fr", language: "fr",
      title: "Bronx store vous a envoyé 14 articles",
      body: "TR-ABC123 · confirmez à l'arrivée"});
    assert.deepEqual(sent.data, {type: "inventory_transfer", kind: "sent",
      businessId: "biz", transferId: "t1", code: "TR-ABC123",
      fromStoreId: "bronx", toStoreId: "harlem",
      relatedCollection: "inventoryTransfers", relatedId: "t1"});
  });

  it("never tells the person who did it", () => {
    assert.deepEqual(plan("sent", {actorUid: "own"}).recipients
        .map((r) => r.uid), ["harlem-fr", "harlem1"]);
  });

  it("tells the owner and all-stores staff about missing pieces", () => {
    const received = {...transfer, status: "received_with_differences",
      lines: [line("a", 9, {quantityReceived: 7, missing: 2}),
        line("b", 5, {quantityReceived: 5})]};
    const differences = tr.planTransferNotification({transfer: received,
      kind: "differences", users, actorUid: "harlem1", ownerUids: ["own"]});
    assert.deepEqual(differences.recipients.map((r) => r.uid),
        ["own", "roamer"]);
    assert.deepEqual(differences.recipients[0], {uid: "own", language: "en",
      title: "2 items didn't arrive at Harlem store",
      body: "TR-ABC123 from Bronx store · 12 of 14 arrived · " +
        "needs your decision"});
    const one = tr.transferNotificationCopy({transfer: {...received,
      lines: [line("a", 2, {quantityReceived: 1, missing: 1})]},
    kind: "differences", audience: "settler", language: "fr"});
    assert.deepEqual(one, {title: "1 article n'est pas arrivé à Harlem store",
      body: "TR-ABC123 de Bronx store · 1 sur 2 arrivés · à vous de décider"});
  });

  it("reminds the destination of stock still on its way", () => {
    const reminder = plan("transit_reminder", {actorUid: ""});
    assert.deepEqual(reminder.recipients.map((r) => r.uid),
        ["own", "harlem-fr", "harlem1"]);
    assert.equal(reminder.recipients[0].title,
        "14 items still on their way to Harlem store");
    assert.equal(reminder.recipients[0].body,
        "TR-ABC123 from Bronx store · sent 2 days ago · confirm when they " +
        "arrive");
    assert.equal(reminder.recipients[1].body,
        "TR-ABC123 de Bronx store · envoyé il y a 2 jours · confirmez à " +
        "l'arrivée");
  });

  it("reminds only the owner of an open dispute", () => {
    const disputed = {...transfer, status: "received_with_differences",
      lines: [line("a", 9, {quantityReceived: 8, missing: 1})]};
    const reminder = tr.planTransferNotification({transfer: disputed,
      kind: "dispute_reminder", users, ownerUids: ["own"]});
    assert.deepEqual(reminder.recipients, [{uid: "own", language: "en",
      title: "1 missing item needs your decision",
      body: "TR-ABC123 · Bronx store → Harlem store"}]);
  });

  it("says who cancelled", () => {
    assert.deepEqual(tr.transferNotificationCopy({transfer,
      kind: "cancelled", audience: "destination", language: "en"}),
    {title: "Bronx store cancelled a transfer",
      body: "TR-ABC123 · 14 items stay in Bronx store"});
  });

  it("reaches an owner whose profile names no business", () => {
    const orphanOwner = [{id: "own", role: "staff", businessId: ""}];
    assert.deepEqual(tr.planTransferNotification({transfer, kind: "sent",
      users: orphanOwner, ownerUids: ["own"]}).recipients.map((r) => r.uid),
    ["own"]);
  });

  it("caps the recipients", () => {
    const crowd = Array.from({length: 80}, (_, i) =>
      staff(`s${String(i).padStart(2, "0")}`,
          {inventoryHomeStoreId: "harlem"}));
    assert.equal(tr.planTransferNotification({transfer, kind: "sent",
      users: crowd}).recipients.length, 50);
  });
});

describe("transfers: reminders", () => {
  const day = 24 * 60 * 60 * 1000;
  const sentAt = Date.UTC(2026, 9, 15, 14);
  const transit = {status: "in_transit", sentAt, lastTransitReminderAt: null};

  it("waits 2 days, then every 2 days", () => {
    assert.equal(tr.reminderDue(transit, sentAt + day), "");
    // The 9 AM run starts a little early on the second morning.
    assert.equal(tr.reminderDue(transit, sentAt + 2 * day - 60 * 60 * 1000),
        "transit_reminder");
    const reminded = {...transit, lastTransitReminderAt: sentAt + 2 * day};
    assert.equal(tr.reminderDue(reminded, sentAt + 3 * day), "");
    assert.equal(tr.reminderDue(reminded, sentAt + 4 * day),
        "transit_reminder");
  });

  it("reminds of an open dispute only while it is open", () => {
    const receivedAt = sentAt + day;
    const open = {status: "received_with_differences", receivedAt,
      lines: [line("a", 2, {quantityReceived: 1, missing: 1})]};
    assert.equal(tr.reminderDue(open, receivedAt + day), "");
    assert.equal(tr.reminderDue(open, receivedAt + 2 * day),
        "dispute_reminder");
    const settled = {...open, lines: [tr.resolvedLine(open.lines[0],
        {action: "return", uid: "o", name: "O", at: 1})]};
    assert.equal(tr.reminderDue(settled, receivedAt + 9 * day), "");
    assert.equal(tr.reminderDue({status: "received", receivedAt,
      lines: []}, receivedAt + 9 * day), "");
    assert.equal(tr.reminderDue({status: "cancelled", sentAt}, sentAt + 9 *
      day), "");
  });

  it("counts whole days since sending", () => {
    assert.equal(tr.daysSince(sentAt, sentAt + 3 * day + 5), 3);
    assert.equal(tr.daysSince(null, sentAt), 0);
    assert.equal(tr.daysSince({toMillis: () => sentAt}, sentAt + day), 1);
  });
});

describe("transfers: summary block", () => {
  const open = [
    {status: "in_transit", fromStoreId: "bronx", toStoreId: "harlem",
      lines: [line("a", 4), {...line("b", 2), costCents: null}]},
    {status: "in_transit", fromStoreId: "harlem", toStoreId: MAIN,
      lines: [line("c", 1)]},
    {status: "received_with_differences", fromStoreId: "bronx",
      toStoreId: MAIN, lines: [line("d", 5, {quantityReceived: 2,
        missing: 3})]},
  ];
  const received = [
    {status: "received", fromStoreId: "bronx", toStoreId: "harlem",
      lines: [line("e", 3, {quantityReceived: 3})]},
    open[2],
    {status: "cancelled", fromStoreId: "bronx", toStoreId: "harlem",
      lines: [line("f", 3)]},
  ];

  it("adds up what is on its way, disputed and received", () => {
    assert.deepEqual(tr.summarizeTransfers({open, received}), {
      inTransitCount: 2, inTransitItems: 7, inTransitValueCents: 500,
      disputedCount: 1, disputedItems: 3, disputedValueCents: 300,
      receivedCount: 2, receivedItems: 5, receivedWithDifferences: 1,
      linesWithoutCost: 1});
  });

  it("follows the store filter (from or to the store)", () => {
    const harlem = tr.summarizeTransfers({open, received, storeId: "harlem"});
    assert.equal(harlem.inTransitCount, 2);
    assert.equal(harlem.disputedCount, 0);
    assert.equal(harlem.receivedCount, 1);
    const main = tr.summarizeTransfers({open, received, storeId: MAIN});
    assert.deepEqual([main.inTransitCount, main.disputedCount,
      main.receivedCount], [1, 1, 1]);
  });
});
