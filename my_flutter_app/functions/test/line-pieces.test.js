"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const pieces = require("../line_pieces");
const {
  containerCounts,
  containerLineEditAudit,
  containerLineEditChanges,
  containerLineEditRefusal,
  containerLineEditTarget,
  containerLineRecord,
  containerLineWhat,
  validateContainerLine,
  validateContainerLineEdit,
  validateWaitingPackage,
} = require("../container_manifest");
const {CONTAINER_MESSAGES} = require("../container_manifest");
const {cases} = require("./fixtures/line-pieces-cases.json");

const customer = {ownerKind: "customer", customerName: "Fatou Diallo",
  customerPhone: "+16465550100", receiverName: "Mariama Bah",
  receiverPhone: "+224620000000", destinationCountryId: "gn",
  destinationCountryName: "Guinea"};

// JSON has no undefined: the fixture's null stands for both.
const plain = (value) => JSON.parse(JSON.stringify(value ?? null));

describe("the shared line-pieces cases", () => {
  it("covers every rule the mirrors must keep", () => {
    const covered = new Set(cases.map((c) => c.fn));
    for (const fn of ["pieceErrors", "normalizePieces", "distributeCents",
      "linePieces", "lineCounts", "piecesTotalCents", "piecesSummaryFields",
      "pieceSummaryText", "linePiecesWhat", "lineGroupSummary",
      "paidFloorForLine", "splitPieces", "nextPartIndex",
      "partTrackingCode", "lineTotalCents", "pickupFeeOf", "pickupFeeErrors",
      "linePickupFeeCents", "piecesLineFields"]) {
      assert.ok(covered.has(fn), `${fn} has no shared case`);
    }
  });

  for (const c of cases) {
    it(`${c.fn}: ${c.note}`, () => {
      assert.deepEqual(plain(pieces[c.fn](...c.args)), c.expected);
    });
  }
});

describe("lines with pieces", () => {
  const counter = {...customer, pieces: [
    {kind: "barrel", priceCents: 10000},
    {kind: "barrel", priceCents: 10000},
    {kind: "box", description: "Clothes", priceCents: 4500,
      sizeIn: {l: 20, w: 20, h: 20}},
  ]};

  it("is judged by its pieces, not a kind or a quantity", () => {
    assert.deepEqual(validateWaitingPackage(counter), []);
    assert.deepEqual(validateContainerLine({...customer, pieces: []}),
        ["pieces_required"]);
    assert.deepEqual(validateContainerLine({...customer,
      pieces: [{kind: "box"}]}), ["piece_description_required"]);
    // A car is a car, whatever pieces ride along.
    assert.ok(validateContainerLine({...customer, kind: "car",
      pieces: [{kind: "barrel"}]}).includes("vin_required"));
  });

  it("stores the pieces, the counts, the total and the old summary", () => {
    const record = containerLineRecord(counter, {containerStatus: "waiting"});
    assert.equal(record.kind, "other");
    assert.equal(record.quantity, 3);
    assert.equal(record.description, "Barrel, Clothes");
    assert.equal(record.priceCents, 24500);
    assert.equal(record.pieceCount, 3);
    assert.equal(record.barrelPieces, 2);
    assert.equal(record.packagePieces, 1);
    assert.equal(record.carPieces, 0);
    assert.deepEqual(record.pieces.map((p) => p.id), ["p1", "p2", "p3"]);
    assert.equal(record.lengthIn, null);
    // A price typed beside the pieces is not the price.
    assert.equal(containerLineRecord({...counter, priceCents: 1})
        .priceCents, 24500);
  });

  it("keeps the old form for a request without pieces, with counts", () => {
    const record = containerLineRecord({...customer, kind: "barrels",
      quantity: 4, priceCents: 40000});
    assert.equal(record.pieces, null);
    assert.equal(record.quantity, 4);
    assert.equal(record.priceCents, 40000);
    assert.equal(record.pieceCount, 4);
    assert.equal(record.barrelPieces, 4);
    const car = containerLineRecord({...customer, kind: "car",
      vinNumber: "1HGCM82633A004352"});
    assert.equal(car.carPieces, 1);
    assert.equal(car.pieceCount, 1);
  });

  it("refuses a total under what was paid", () => {
    assert.deepEqual(validateContainerLine(counter, 30000),
        ["price_below_paid"]);
    assert.deepEqual(validateContainerLine(counter, 24500), []);
  });

  it("counts the pieces actually on a container", () => {
    const mixed = containerLineRecord(counter);
    const legacy = {kind: "barrels", quantity: 2};
    assert.deepEqual(containerCounts([mixed, legacy, {kind: "car"},
      {kind: "other", quantity: 3, description: "Tires"}]),
    {lineCount: 4, carCount: 1, barrelCount: 4, otherCount: 4});
  });

  it("says what it is in the history", () => {
    assert.equal(containerLineWhat(containerLineRecord(counter)),
        "2 barrels, 1 box");
    assert.equal(containerLineWhat({kind: "barrels", quantity: 3}),
        "3 barrels");
  });

  it("every new refusal code has a sentence", () => {
    for (const code of ["pieces_required", "pieces_too_many",
      "piece_kind_invalid", "piece_description_required",
      "piece_description_too_long", "piece_size_invalid",
      "piece_price_invalid", "piece_count_invalid", "line_has_parts"]) {
      assert.ok(CONTAINER_MESSAGES[code], `${code} has no message`);
    }
  });
});

describe("editing a line with pieces", () => {
  const stored = containerLineRecord({...customer, pieces: [
    {kind: "barrel", priceCents: 10000},
    {kind: "barrel", priceCents: 10000},
    {kind: "barrel", priceCents: 10000},
  ]}, {containerStatus: "shipped", containerId: "box"});

  it("a price change is a price change, open in every state", () => {
    const asked = {pieces: stored.pieces.map((p, i) =>
      ({...p, priceCents: i === 0 ? 12000 : p.priceCents}))};
    const next = containerLineEditTarget(stored, asked, false);
    const changes = containerLineEditChanges(stored, next);
    assert.deepEqual(changes, ["priceCents", "piecePrices"]);
    assert.equal(containerLineEditRefusal({status: "shipped"}, changes), null);
    const {summary} = containerLineEditAudit(stored, next, changes);
    assert.match(summary, /: piece prices for Fatou Diallo$/);
  });

  it("adding a piece changes what the line is, so only while open", () => {
    const asked = {pieces: [...stored.pieces,
      {kind: "box", description: "Clothes", priceCents: 4000}]};
    const next = containerLineEditTarget(stored, asked, false);
    const changes = containerLineEditChanges(stored, next);
    assert.ok(changes.includes("pieces"));
    assert.equal(containerLineEditRefusal({status: "shipped"}, changes),
        "container_locked");
    assert.equal(containerLineEditRefusal({status: "loading"}, changes), null);
    assert.equal(next.pieceCount ?? containerLineRecord(next).pieceCount, 4);
    const {summary} = containerLineEditAudit(stored, next, changes);
    assert.equal(summary,
        "Edited 3 barrels, 1 box (was 3 barrels): pieces, price " +
        "for Fatou Diallo");
  });

  it("an old app sending the summary changes nothing", () => {
    const asked = {kind: "other", quantity: 9, description: "Whatever"};
    const next = containerLineEditTarget(stored, asked, false);
    assert.deepEqual(containerLineEditChanges(stored, next), []);
  });

  it("judges the price against the floor the server works out", () => {
    const asked = {pieces: stored.pieces.map((p) => ({...p,
      priceCents: 5000}))};
    assert.deepEqual(validateContainerLineEdit(stored, asked, false, 20000),
        ["price_below_paid"]);
    assert.deepEqual(validateContainerLineEdit(stored, asked, false, 15000),
        []);
  });

  it("a legacy line has no pickup fee and keeps its price", () => {
    const legacy = containerLineRecord({...customer, kind: "barrels",
      quantity: 2, priceCents: 20000});
    assert.equal(legacy.pickupFeeCents, 0);
    assert.equal(legacy.priceCents, 20000);
    assert.equal(pieces.linePickupFeeCents({kind: "barrels", quantity: 2,
      priceCents: 20000}), 0);
  });

  it("a legacy line edited with pieces takes them", () => {
    const legacy = {...customer, kind: "barrels", quantity: 2,
      priceCents: 20000};
    const asked = {pieces: [{kind: "barrel", priceCents: 10000},
      {kind: "barrel", priceCents: 10000}]};
    const next = containerLineEditTarget(legacy, asked, false);
    const changes = containerLineEditChanges(legacy, next);
    assert.ok(changes.includes("pieces"));
    assert.ok(!changes.includes("priceCents"));
  });
});

describe("a line with a pickup fee (owner decision 2026-10-18)", () => {
  // Barrel $90 · Box $40 · Pickup fee $20 · Total $150.
  const asked = {...customer, pickupFeeCents: 2000, pieces: [
    {kind: "barrel", priceCents: 9000},
    {kind: "box", description: "Clothes", priceCents: 4000},
  ]};
  const stored = containerLineRecord(asked, {containerStatus: "waiting"});

  it("stores the fee beside the pieces, inside the total", () => {
    assert.equal(stored.pickupFeeCents, 2000);
    assert.equal(stored.priceCents, 15000);
    assert.deepEqual(stored.pieces.map((p) => p.priceCents), [9000, 4000]);
    // The fee is no piece: the counts are the pieces'.
    assert.equal(stored.pieceCount, 2);
    assert.equal(stored.barrelPieces, 1);
    assert.equal(stored.packagePieces, 1);
    assert.deepEqual(validateContainerLine(asked), []);
    assert.deepEqual(validateContainerLine({...asked, pickupFeeCents: -1}),
        ["pickup_fee_invalid"]);
    assert.ok(CONTAINER_MESSAGES.pickup_fee_invalid);
    assert.ok(CONTAINER_MESSAGES.price_below_pickup_fee);
  });

  it("an edit that leaves the fee out keeps it", () => {
    const edit = {pieces: stored.pieces.map((p) =>
      ({...p, priceCents: p.kind === "box" ? 5000 : p.priceCents}))};
    const next = containerLineEditTarget(stored, edit, false);
    assert.equal(next.pickupFeeCents, 2000);
    assert.equal(next.priceCents, 16000);
    assert.deepEqual(containerLineEditChanges(stored, next),
        ["priceCents", "piecePrices"]);
  });

  it("staff may change the fee in the edit, open in every state", () => {
    const next = containerLineEditTarget(stored, {pickupFeeCents: 2500},
        false);
    assert.equal(next.priceCents, 15500);
    const changes = containerLineEditChanges(stored, next);
    assert.deepEqual(changes, ["priceCents", "pickupFeeCents"]);
    assert.equal(containerLineEditRefusal({status: "shipped"}, changes), null);
    const {summary} = containerLineEditAudit(stored, next, changes);
    assert.match(summary, /price, pickup fee for Fatou Diallo$/);
    const removed = containerLineEditTarget(stored, {pickupFeeCents: 0},
        false);
    assert.equal(removed.priceCents, 13000);
  });

  it("judges what was paid against pieces plus fee", () => {
    // $150 paid: dropping the box to $30 leaves $140 < $150.
    const cheaper = {pieces: stored.pieces.map((p) =>
      ({...p, priceCents: p.kind === "box" ? 3000 : p.priceCents}))};
    assert.deepEqual(validateContainerLineEdit({...stored, paidCents: 15000},
        cheaper, false), ["price_below_paid"]);
    // $140 paid: still covered, the fee counts.
    assert.deepEqual(validateContainerLineEdit({...stored, paidCents: 14000},
        cheaper, false), []);
    // Taking the fee away under what was paid is refused too.
    assert.deepEqual(validateContainerLineEdit({...stored, paidCents: 15000},
        {pickupFeeCents: 0}, false), ["price_below_paid"]);
  });

  it("a split keeps the fee on the root and counts it once", () => {
    const plan = pieces.splitPieces(stored, 1);
    const going = pieces.piecesLineFields(plan.going,
        pieces.linePickupFeeCents(stored));
    const staying = pieces.piecesLineFields(plan.staying);
    assert.equal(going.pickupFeeCents, 2000);
    assert.equal(going.priceCents, 11000);
    assert.equal(staying.pickupFeeCents, 0);
    assert.equal(staying.priceCents, 4000);
    const group = pieces.lineGroupSummary([
      {id: "root", line: {...stored, ...going, rootLineId: "root",
        partIndex: 1, paidCents: 5000}},
      {id: "part", line: {...staying, rootLineId: "root", partIndex: 2}},
    ], "root");
    assert.equal(group.priceCents, 15000);
    assert.equal(group.pickupFeeCents, 2000);
    assert.equal(group.balanceCents, 10000);
    // The part's floor: $50 paid, the root's $110 covers it all.
    assert.equal(pieces.paidFloorForLine(group, "part"), 0);
    assert.equal(pieces.paidFloorForLine(group, "root"), 1000);
  });
});
