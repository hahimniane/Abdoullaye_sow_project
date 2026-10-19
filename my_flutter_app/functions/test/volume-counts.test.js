"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");

const {
  MAX_ROLLUP_CONTAINERS,
  averagePerContainer,
  buildMonthRollup,
  containerMonthKey,
  containerWriteTargets,
  currentMonthKey,
  isCustomerLine,
  isMonthKey,
  isRootLine,
  lastMonths,
  lineMonthKey,
  linePieces,
  lineReceivedAt,
  lineWriteTargets,
  monthKeyOf,
  monthWindow,
  monthsBetween,
  nextMonth,
  partNeedsRoot,
  percentChange,
  previousMonth,
  rollupContainers,
  rollupNumbers,
  shiftMonth,
  volumeDocId,
  volumeTableRows,
} = require("../volume_counts");

const ts = (iso) => {
  const date = new Date(iso);
  return {toDate: () => date, toMillis: () => date.getTime()};
};
const BIZ = "biz_a";

describe("pieces on a line", () => {
  it("reads legacy lines from kind and quantity", () => {
    assert.deepEqual(linePieces({kind: "car", quantity: 1}),
        {pieces: 1, barrels: 0, packages: 0, cars: 1});
    assert.deepEqual(linePieces({kind: "barrels", quantity: 4}),
        {pieces: 4, barrels: 4, packages: 0, cars: 0});
    assert.deepEqual(linePieces({kind: "other", quantity: 2}),
        {pieces: 2, barrels: 0, packages: 2, cars: 0});
    // An "other" with no quantity is still one thing, as the tallies say.
    assert.deepEqual(linePieces({kind: "other"}),
        {pieces: 1, barrels: 0, packages: 1, cars: 0});
    assert.deepEqual(linePieces({kind: "barrels", quantity: 0}),
        {pieces: 0, barrels: 0, packages: 0, cars: 0});
    assert.deepEqual(linePieces(null),
        {pieces: 1, barrels: 0, packages: 1, cars: 0});
  });

  it("prefers the denormalized counts, then pieces[]", () => {
    assert.deepEqual(linePieces({kind: "other", quantity: 9,
      barrelPieces: 2, packagePieces: 1, carPieces: 0,
      pieces: [{kind: "box"}]}),
    {pieces: 3, barrels: 2, packages: 1, cars: 0});
    assert.deepEqual(linePieces({kind: "other", quantity: 9,
      pieces: [{kind: "barrel"}, {kind: "box"}, {kind: "other"}]}),
    {pieces: 3, barrels: 1, packages: 2, cars: 0});
    // A part that kept no pieces counts none (its root lost them too).
    assert.deepEqual(linePieces({kind: "other", quantity: 2,
      barrelPieces: 0, packagePieces: 0, carPieces: 0}),
    {pieces: 0, barrels: 0, packages: 0, cars: 0});
  });

  it("a car is one piece whatever else it says", () => {
    assert.deepEqual(linePieces({kind: "car", quantity: 5, carPieces: 3}),
        {pieces: 1, barrels: 0, packages: 0, cars: 1});
  });
});

describe("roots, parts and customer loads", () => {
  it("a root names no root or itself", () => {
    assert.equal(isRootLine({}, "a"), true);
    assert.equal(isRootLine({rootLineId: "a"}, "a"), true);
    assert.equal(isRootLine({rootLineId: "a"}, "b"), false);
  });

  it("stock is not a customer load, and neither is a part", () => {
    assert.equal(isCustomerLine({ownerKind: "customer"}, "a"), true);
    assert.equal(isCustomerLine({ownerKind: "stock"}, "a"), false);
    assert.equal(isCustomerLine({ownerKind: "customer", rootLineId: "a"},
        "b"), false);
  });

  it("a part with no receivedAt inherits its root's", () => {
    const root = {receivedAt: ts("2026-09-30T15:00:00Z"),
      createdAt: ts("2026-09-30T15:00:00Z")};
    const part = {rootLineId: "root", createdAt: ts("2026-10-05T15:00:00Z")};
    assert.equal(partNeedsRoot(part, "part"), true);
    assert.equal(lineReceivedAt(part, "part", root).toISOString(),
        "2026-09-30T15:00:00.000Z");
    assert.equal(lineMonthKey(part, "part", undefined, root), "2026-09");
    // Without the root in hand it falls back to when it was created.
    assert.equal(lineMonthKey(part, "part"), "2026-10");
    // Its own receivedAt wins.
    assert.equal(partNeedsRoot({...part, receivedAt: ts(
        "2026-10-02T12:00:00Z")}, "part"), false);
  });

  it("legacy lines are received when they were created", () => {
    assert.equal(lineMonthKey({createdAt: ts("2026-10-10T12:00:00Z")}, "x"),
        "2026-10");
    assert.equal(lineMonthKey({}, "x"), "");
  });
});

describe("months (America/New_York)", () => {
  it("a line received Oct 31 11:30 PM New York is October", () => {
    // 11:30 PM EDT on Oct 31 is 03:30 UTC on Nov 1.
    const line = {receivedAt: ts("2026-11-01T03:30:00Z")};
    assert.equal(lineMonthKey(line, "x"), "2026-10");
    assert.equal(lineMonthKey(line, "x", "UTC"), "2026-11");
    assert.equal(lineMonthKey({receivedAt: ts("2026-11-01T04:00:00Z")}, "x"),
        "2026-11");
  });

  it("month windows start at New York midnight, across DST", () => {
    assert.deepEqual(monthWindow("2026-10"), {
      startMs: Date.parse("2026-10-01T04:00:00Z"),
      endMs: Date.parse("2026-11-01T04:00:00Z"),
    });
    // Clocks fall back on Nov 1: December starts at 05:00 UTC.
    assert.deepEqual(monthWindow("2026-11"), {
      startMs: Date.parse("2026-11-01T04:00:00Z"),
      endMs: Date.parse("2026-12-01T05:00:00Z"),
    });
    assert.deepEqual(monthWindow("2026-03"), {
      startMs: Date.parse("2026-03-01T05:00:00Z"),
      endMs: Date.parse("2026-04-01T04:00:00Z"),
    });
    assert.equal(monthWindow("2026-13"), null);
    assert.equal(monthWindow("nope"), null);
  });

  it("every instant of a window is in that month", () => {
    const {startMs, endMs} = monthWindow("2026-11");
    assert.equal(monthKeyOf(new Date(startMs)), "2026-11");
    assert.equal(monthKeyOf(new Date(endMs - 1)), "2026-11");
    assert.equal(monthKeyOf(new Date(startMs - 1)), "2026-10");
    assert.equal(monthKeyOf(new Date(endMs)), "2026-12");
  });

  it("moves between months and across years", () => {
    assert.equal(previousMonth("2026-01"), "2025-12");
    assert.equal(nextMonth("2026-12"), "2027-01");
    assert.equal(shiftMonth("2026-10", -12), "2025-10");
    assert.equal(shiftMonth("bad", 1), "");
    assert.equal(isMonthKey("2026-10"), true);
    assert.equal(isMonthKey("2026-1"), false);
    assert.equal(isMonthKey("2026-00"), false);
  });

  it("lists ranges and the last 12 months", () => {
    assert.deepEqual(monthsBetween("2025-11", "2026-02"),
        ["2025-11", "2025-12", "2026-01", "2026-02"]);
    assert.deepEqual(monthsBetween("2026-02", "2025-11"), []);
    assert.deepEqual(monthsBetween("2020-01", "2026-01"), [],
        "longer than the cap is refused, not truncated");
    const trend = lastMonths("2026-10");
    assert.equal(trend.length, 12);
    assert.equal(trend[0], "2025-11");
    assert.equal(trend[11], "2026-10");
  });

  it("the default month is the current New York month", () => {
    assert.equal(currentMonthKey(new Date("2026-11-01T03:59:00Z")),
        "2026-10");
    assert.equal(currentMonthKey(new Date("2026-11-01T04:00:00Z")),
        "2026-11");
  });
});

describe("containers count in the month they sailed", () => {
  it("only while shipped or arrived", () => {
    const sailed = {status: "shipped", sailedAt: ts("2026-10-12T14:00:00Z")};
    assert.equal(containerMonthKey(sailed), "2026-10");
    assert.equal(containerMonthKey({...sailed, status: "arrived"}),
        "2026-10");
    assert.equal(containerMonthKey({...sailed, status: "loading"}), "");
    assert.equal(containerMonthKey({status: "shipped"}), "");
  });
});

describe("which rollups a write touches", () => {
  const line = {businessId: BIZ, kind: "barrels", quantity: 3,
    ownerKind: "customer", createdAt: ts("2026-10-05T12:00:00Z"),
    containerId: "", containerStatus: "waiting"};

  it("a payment or a status catching up touches nothing", () => {
    const after = {...line, paidCents: 5000, containerStatus: "shipped"};
    assert.deepEqual(lineWriteTargets({before: line, after, id: "l1"}),
        {months: [], containerIds: []});
  });

  it("a new line touches its month; a deleted one too", () => {
    assert.deepEqual(lineWriteTargets({before: null, after: line, id: "l1"})
        .months, [{businessId: BIZ, month: "2026-10"}]);
    assert.deepEqual(lineWriteTargets({before: line, after: null, id: "l1"})
        .months, [{businessId: BIZ, month: "2026-10"}]);
  });

  it("moving receivedAt to another month touches both", () => {
    const moved = {...line, receivedAt: ts("2026-09-28T12:00:00Z")};
    assert.deepEqual(lineWriteTargets({before: line, after: moved, id: "l1"})
        .months, [{businessId: BIZ, month: "2026-10"},
      {businessId: BIZ, month: "2026-09"}]);
  });

  it("assigning to a container names the container", () => {
    const loaded = {...line, containerId: "box1",
      containerStatus: "loading"};
    const out = lineWriteTargets({before: line, after: loaded, id: "l1"});
    assert.deepEqual(out.months, []);
    assert.deepEqual(out.containerIds, ["box1"]);
    const moved = {...loaded, containerId: "box2"};
    assert.deepEqual(lineWriteTargets({before: loaded, after: moved,
      id: "l1"}).containerIds, ["box1", "box2"]);
  });

  it("a container that sails touches its sailing month", () => {
    const loading = {businessId: BIZ, status: "loading",
      containerNumber: "MSCU1234567"};
    const shipped = {...loading, status: "shipped",
      sailedAt: ts("2026-10-20T12:00:00Z")};
    assert.deepEqual(containerWriteTargets({before: loading,
      after: shipped}), [{businessId: BIZ, month: "2026-10"}]);
    // Un-shipped (a repair): the month it had counted in.
    assert.deepEqual(containerWriteTargets({before: shipped,
      after: loading}), [{businessId: BIZ, month: "2026-10"}]);
    // A notes edit after sailing changes nothing counted.
    assert.deepEqual(containerWriteTargets({before: shipped,
      after: {...shipped, notes: "late"}}), []);
    // A corrected sailing date that crosses a month touches both.
    assert.deepEqual(containerWriteTargets({before: shipped,
      after: {...shipped, sailedAt: ts("2026-11-02T12:00:00Z")}}),
    [{businessId: BIZ, month: "2026-10"}, {businessId: BIZ,
      month: "2026-11"}]);
    // Arriving keeps it in its sailing month, but its status shows.
    assert.deepEqual(containerWriteTargets({before: shipped,
      after: {...shipped, status: "arrived"}}),
    [{businessId: BIZ, month: "2026-10"}]);
    // A loading box that is edited or deleted touches nothing.
    assert.deepEqual(containerWriteTargets({before: loading,
      after: null}), []);
  });
});

describe("a month's rollup", () => {
  const received = (iso) => ts(iso);
  const lines = [
    {id: "legacy", data: {businessId: BIZ, kind: "barrels", quantity: 2,
      ownerKind: "customer", createdAt: received("2026-10-03T12:00:00Z"),
      containerId: "box1"}},
    {id: "car", data: {businessId: BIZ, kind: "car", quantity: 1,
      ownerKind: "stock", createdAt: received("2026-10-04T12:00:00Z"),
      receivedAt: received("2026-10-04T12:00:00Z"), containerId: "box1"}},
    {id: "new", data: {businessId: BIZ, kind: "other", quantity: 3,
      barrelPieces: 1, packagePieces: 2, carPieces: 0, pieceCount: 3,
      rootLineId: "new", ownerKind: "customer",
      createdAt: received("2026-10-10T12:00:00Z"),
      receivedAt: received("2026-10-10T12:00:00Z"), containerId: ""}},
    // Another month, another business: candidates the caller over-read.
    {id: "sept", data: {businessId: BIZ, kind: "barrels", quantity: 5,
      createdAt: received("2026-09-30T12:00:00Z")}},
    {id: "other-biz", data: {businessId: "biz_b", kind: "barrels",
      quantity: 5, createdAt: received("2026-10-03T12:00:00Z")}},
  ];
  const containers = [
    {id: "box1", data: {businessId: BIZ, status: "shipped",
      containerNumber: "MSCU1234567", destinationCountryName: "Guinea",
      sailedAt: received("2026-10-20T12:00:00Z")}},
    {id: "empty", data: {businessId: BIZ, status: "arrived",
      label: "Box with nothing", destinationCountryName: "Senegal",
      sailedAt: received("2026-10-01T12:00:00Z")}},
    {id: "loading", data: {businessId: BIZ, status: "loading",
      sailedAt: received("2026-10-01T12:00:00Z")}},
  ];
  const contents = new Map([["box1", [lines[0], lines[1],
    // Received in September, shipped in October: still on the box.
    {id: "sept-on-box", data: {businessId: BIZ, kind: "barrels",
      quantity: 4, containerId: "box1",
      createdAt: received("2026-09-02T12:00:00Z")}}]]]);

  it("counts pieces received, customer loads and containers sailed", () => {
    const rollup = buildMonthRollup({businessId: BIZ, month: "2026-10",
      lines: [...lines, lines[0]], containers, contents});
    assert.equal(rollup.pieces, 6);
    assert.equal(rollup.barrels, 3);
    assert.equal(rollup.packages, 2);
    assert.equal(rollup.cars, 1);
    assert.equal(rollup.lineCount, 3);
    assert.equal(rollup.customerLines, 2, "stock is not a customer");
    assert.equal(rollup.containersShipped, 2);
    assert.equal(rollup.containerPieces, 7);
    assert.equal(rollup.avgPerContainer, 3.5);
    assert.deepEqual(rollup.containers.map((c) => c.id), ["empty", "box1"]);
    const box = rollup.containers[1];
    assert.deepEqual([box.number, box.destination, box.barrels,
      box.packages, box.cars, box.pieces, box.lineCount],
    ["MSCU1234567", "Guinea", 6, 0, 1, 7, 3]);
    const empty = rollup.containers[0];
    assert.deepEqual([empty.number, empty.pieces], ["Box with nothing", 0]);
    assert.equal(rollup.complete, true);
  });

  it("a month with nothing is zeros, not an error", () => {
    const rollup = buildMonthRollup({businessId: BIZ, month: "2026-08",
      lines, containers, contents});
    assert.deepEqual([rollup.pieces, rollup.customerLines,
      rollup.containersShipped, rollup.avgPerContainer],
    [0, 0, 0, null]);
  });

  it("a split in the same month leaves the totals unchanged", () => {
    const whole = {id: "root", data: {businessId: BIZ, kind: "other",
      rootLineId: "root", partIndex: 1, ownerKind: "customer",
      barrelPieces: 4, packagePieces: 0, carPieces: 0,
      receivedAt: received("2026-10-08T12:00:00Z"),
      createdAt: received("2026-10-08T12:00:00Z")}};
    const before = buildMonthRollup({businessId: BIZ, month: "2026-10",
      lines: [whole]});
    const root = {id: "root", data: {...whole.data, barrelPieces: 2}};
    // The part carries the other 2 and, here, no receivedAt of its own; it
    // was split off in November but counts when its root was received.
    const part = {id: "part", data: {businessId: BIZ, kind: "other",
      rootLineId: "root", partIndex: 2, ownerKind: "customer",
      barrelPieces: 2, packagePieces: 0, carPieces: 0,
      createdAt: received("2026-11-03T12:00:00Z")}};
    const after = buildMonthRollup({businessId: BIZ, month: "2026-10",
      lines: [root, part], roots: new Map([["root", root.data]])});
    assert.equal(after.pieces, before.pieces);
    assert.equal(after.barrels, 4);
    assert.equal(after.customerLines, before.customerLines,
        "a split part is the same customer load");
    const november = buildMonthRollup({businessId: BIZ, month: "2026-11",
      lines: [root, part], roots: new Map([["root", root.data]])});
    assert.equal(november.pieces, 0);
  });

  it("keeps at most 200 containers in the list but counts them all", () => {
    const many = [];
    for (let i = 0; i < MAX_ROLLUP_CONTAINERS + 5; i += 1) {
      many.push({id: `b${String(i).padStart(3, "0")}`, data: {businessId: BIZ,
        status: "shipped", sailedAt: received("2026-10-15T12:00:00Z")}});
    }
    const rollup = buildMonthRollup({businessId: BIZ, month: "2026-10",
      containers: many});
    assert.equal(rollup.containersShipped, MAX_ROLLUP_CONTAINERS + 5);
    assert.equal(rollup.containers.length, MAX_ROLLUP_CONTAINERS);
    assert.equal(rollup.containersTruncated, true);
  });
});

describe("reading rollups back", () => {
  it("a missing or half-written rollup reads as zeros", () => {
    assert.deepEqual(rollupNumbers({requestSeq: 3}), {pieces: 0, barrels: 0,
      packages: 0, cars: 0, customerLines: 0, containersShipped: 0,
      containerPieces: 0, avgPerContainer: null});
    assert.deepEqual(rollupContainers(null), []);
    assert.deepEqual(rollupContainers({containers: [{id: "a", barrels: "2",
      packages: 1, cars: null, sailedAtMs: 5}]}), [{id: "a", number: "",
      destination: "", status: "", sailedAtMs: 5, pieces: 3, barrels: 2,
      packages: 1, cars: 0}]);
  });

  it("percent change guards a zero month", () => {
    assert.equal(percentChange(120, 100), 20);
    assert.equal(percentChange(90, 120), -25);
    assert.equal(percentChange(5, 0), null);
    assert.equal(percentChange(0, 0), null);
    assert.equal(percentChange(1, 3), -66.7);
    assert.equal(averagePerContainer(10, 0), null);
    assert.equal(averagePerContainer(10, 3), 3.3);
  });

  it("builds the By business table with a totals row", () => {
    const table = volumeTableRows([
      {businessId: "b1", pieces: 10, barrels: 6, packages: 3, cars: 1,
        customerLines: 4, containersShipped: 2, containerPieces: 9},
      {businessId: "gone", pieces: 30, barrels: 30, packages: 0, cars: 0,
        customerLines: 9, containersShipped: 1, containerPieces: 30},
      {businessId: "idle", requestSeq: 2},
    ], new Map([["b1", "Conakry Express"]]));
    assert.deepEqual(table.rows.map((r) => [r.businessId, r.name]),
        [["gone", "gone"], ["b1", "Conakry Express"]],
        "busiest first; a deleted business shows its id; idle rows drop");
    assert.equal(table.rows[1].avgPerContainer, 4.5);
    assert.deepEqual(table.totals, {businesses: 2, pieces: 40, barrels: 36,
      packages: 3, cars: 1, customerLines: 13, containersShipped: 3,
      containerPieces: 39, avgPerContainer: 13});
  });

  it("doc ids are business then month", () => {
    assert.equal(volumeDocId("biz_a", "2026-10"), "biz_a_2026-10");
  });
});

describe("the volume functions are wired with a small budget", () => {
  const root = path.join(__dirname, "..");
  const source = fs.readFileSync(path.join(root, "index.js"), "utf8");
  const indexes = JSON.parse(fs.readFileSync(
      path.join(root, "..", "firestore.indexes.json"), "utf8")).indexes;
  const rules = fs.readFileSync(path.join(root, "..", "firestore.rules"),
      "utf8");
  const hasIndex = (group, fields) => indexes.some((index) =>
    index.collectionGroup === group && index.queryScope === "COLLECTION" &&
    JSON.stringify(index.fields.map((f) => f.fieldPath)) ===
      JSON.stringify(fields));

  it("exports both triggers and the three callables, capped", () => {
    for (const [name, max] of [["rollupVolumeOnLineWrite", 2],
      ["rollupVolumeOnContainerWrite", 2], ["getPlatformVolume", 2],
      ["getBusinessVolume", 2], ["rebuildVolumeMonths", 1]]) {
      const start = source.indexOf(`exports.${name} = `);
      assert.notEqual(start, -1, `${name} is not exported`);
      const body = source.slice(start, start + 400);
      assert.match(body, new RegExp(`maxInstances: ${max}\\b`), name);
    }
    assert.match(source, /document: "containerLines\/\{lineId\}"/);
    assert.match(source, /document: "containers\/\{containerId\}"/);
    // Browser-facing callables: App Check, CORS and the public invoker
    // (guardrails §2), inline so the App Check count contract sees them.
    for (const name of ["getPlatformVolume", "getBusinessVolume",
      "rebuildVolumeMonths"]) {
      const start = source.indexOf(`exports.${name} = `);
      const body = source.slice(start, start + 300);
      assert.match(body, new RegExp("enforceAppCheck: ENFORCE_APP_CHECK, " +
          "cors: true, invoker: \"public\""), name);
    }
  });

  it("has the indexes its month queries need", () => {
    assert.ok(hasIndex("containerLines", ["businessId", "receivedAt"]));
    assert.ok(hasIndex("containerLines", ["businessId", "createdAt"]));
    assert.ok(hasIndex("containers", ["businessId", "sailedAt"]));
    // The admin page sums pieces per month (getPlatformVolume trend).
    assert.ok(hasIndex("volumeMonthly", ["month", "pieces"]));
  });

  it("keeps the rollups server-only", () => {
    assert.match(rules, new RegExp("match /volumeMonthly/\\{rollupId\\} " +
        "\\{\\s*allow read, write: if false;"));
  });
});
