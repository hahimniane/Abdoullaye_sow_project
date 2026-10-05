"use strict";

// Source contracts for the scaling audit fixes (2026-10). Each pins the
// property that made a job or callable bounded, so a later edit that quietly
// brings back an unbounded read fails here rather than in production.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "index.js"), "utf8");
const indexes = JSON.parse(fs.readFileSync(
    path.join(root, "..", "firestore.indexes.json"), "utf8")).indexes;

/**
 * The body of a top-level export or function, up to the next top-level
 * declaration.
 *
 * @param {string} header Exact start of the declaration.
 * @return {string} Its source.
 */
function block(header) {
  const start = source.indexOf(header);
  assert.notEqual(start, -1, `missing ${header}`);
  const rest = source.slice(start + header.length);
  const next = rest.search(/\n(exports\.|async function |function |const )/);
  return header + (next === -1 ? rest : rest.slice(0, next));
}

function hasIndex(collectionGroup, fields, queryScope = "COLLECTION") {
  return indexes.some((index) => index.collectionGroup === collectionGroup &&
    index.queryScope === queryScope &&
    JSON.stringify(index.fields.map((f) => f.fieldPath)) ===
      JSON.stringify(fields));
}

describe("parking availability reads only stays that can overlap", () => {
  const query = block("function parkedCarsForAvailability(");

  it("queries occupancyEndMs from the window start, with no limit", () => {
    assert.ok(query.includes(".where(\"occupancyEndMs\", \">=\", " +
      "occupancyWindowStartMs(start, end))"));
    assert.doesNotMatch(query, /\.limit\(/);
    assert.ok(hasIndex("parkedCars", ["businessId", "occupancyEndMs"]));
  });

  it("every booking path backfills first and reads in the transaction",
      () => {
        const uses = source.match(/await availabilityQueryFor\(/g) || [];
        // search, customer reservation, business entry, business edit
        assert.equal(uses.length, 4);
        const inTransaction =
          source.match(/transaction\.get\(availabilityQuery\)/g) || [];
        assert.equal(inTransaction.length, 3);
        assert.doesNotMatch(source,
            /transaction\.get\(\s*parkedCarsForAvailability/);
      });

  it("every server write that sets parking dates stamps occupancyEndMs",
      () => {
        const stamp = new RegExp("parkingEndDate: [^\\n]+\\n" +
          "(?:[^\\n]*\\n){0,3}?\\s+occupancyEndMs: occupancyEndMs\\(", "g");
        const writes = source.match(stamp) || [];
        assert.ok(writes.length >= 4, `only ${writes.length} stamped`);
        assert.match(block("exports.syncParkedCarOccupancy = "),
            /lastUpdateTime: after\.updateTime/);
      });

  it("the public search is rate limited and prices lots in parallel",
      () => {
        assert.match(block("exports.listPublicParkingOptions = "),
            /enforceCallableRateLimit\(request, \{\s*name: "listPublicParking/);
        const search = block("async function parkingOptionsForRequest(");
        assert.match(search,
            /mapWithConcurrency\(\s*lots, PARKING_SEARCH_CONCURRENCY/);
        assert.doesNotMatch(search, /for \(const doc of businesses\.docs\)/);
      });
});

describe("stale payment sweep schedules instead of re-reading forever", () => {
  const sweep = block("exports.reconcileStaleStripePayments = ");
  const record = block("async function sweepStalePaymentRecord(");

  it("schedules with reconcileSchedule and never bumps updatedAt", () => {
    assert.match(record, /planNextReconcileCheck\(/);
    assert.ok(record.includes(
        "snapshot.ref.update({[`reconcileSchedule.${scan.id}`]: entry})"));
    assert.doesNotMatch(record, /updatedAt:/);
  });

  it("every checked record is rescheduled, including early exits", () => {
    // The check returns instead of `continue`, so the schedule write after
    // it always runs.
    const check = block("async function checkStalePaymentRecord(");
    assert.doesNotMatch(check, /\bcontinue\b/);
  });

  it("runs the scans round-robin, rotated per run", () => {
    assert.match(sweep, /rotateForRun\(STALE_PAYMENT_SCANS, nowMs\)/);
    assert.match(sweep, /roundRobinPages\(/);
  });

  it("has a due-query index for every scan", () => {
    const scans = [
      ["parking", "parkedCars", "paymentStatus"],
      ["shared_barrel_deposits", "participants", "paymentStatus",
        "COLLECTION_GROUP"],
      ["shared_barrel_balances", "barrelPoolBalanceRequests",
        "paymentStatus"],
      ["barrel_shipments", "barrelShipments", "paymentStatus"],
      ["barrel_destination_changes", "barrelShipments",
        "destinationAdjustmentPaymentStatus"],
      ["barrel_orders", "barrelOrders", "paymentStatus"],
      ["freight_shipments", "freightShipments", "paymentStatus"],
      ["freight_settlement_adjustments", "paymentAttempts", "paymentStatus",
        "COLLECTION_GROUP"],
      ["car_purchases", "carPurchases", "paymentStatus"],
      ["hold_extensions", "carPurchases", "extensionPaymentStatus"],
    ];
    const ids = source.match(/^ {4}id: "([a-z_]+)",$/gm)
        .map((line) => line.trim().slice(5, -2));
    for (const [id, group, status, scope] of scans) {
      assert.ok(ids.includes(id), `scan ${id} no longer exists`);
      assert.ok(hasIndex(group,
          [status, `reconcileSchedule.${id}.nextCheckAt`], scope),
      `missing index for ${id}`);
    }
  });
});

describe("carrier polling is bounded", () => {
  it("terminal49Request times out", () => {
    assert.match(block("async function terminal49Request("),
        /signal: AbortSignal\.timeout\(TERMINAL49_TIMEOUT_MS\)/);
  });

  it("shipments are paged, isolated, done-flagged and budgeted", () => {
    const poll = block("async function pollCarrierTrackedShipments(");
    assert.match(poll, /where\("carrierTrackingDone", "==", false\)/);
    assert.match(poll, /drainPages\(/);
    assert.match(poll, /catch \(error\)/);
    // Containers poll first (each can message every customer on a box);
    // shipments then get what is left of the run, under a deadline.
    const run = block("exports.pollContainerTracking = ");
    assert.match(run, /fraction: 0\.9/);
    assert.ok(run.indexOf("pollOneTrackedContainer(") <
      run.indexOf("pollCarrierTrackedShipments("));
    assert.match(block("exports.subscribeToContainerTracking = "),
        /carrierTrackingDone: false/);
  });
});

describe("scheduled sweeps filter and order in the query", () => {
  it("month-end reads only the month", () => {
    const fn = block("async function notifyParkingMonthEndFor(");
    assert.match(fn, /where\("occupancyEndMs", ">=", bounds\.startMs\)/);
    assert.match(fn, /where\("paymentStatus", "!=", "succeeded"\)/);
    assert.ok(!fn.includes("collection(\"parkedCars\")" +
      ".where(\"businessId\", \"==\", businessId).get()"));
    assert.match(block("exports.notifyParkingMonthEnd = "),
        /timeoutSeconds: 540/);
    assert.ok(hasIndex("lotActivities", ["businessId", "paymentStatus"]));
  });

  it("viewing expiry pages by deadline", () => {
    const fn = block("exports.expireStaleCarViewings = ");
    assert.match(fn, /where\("respondByAt", "<=",/);
    assert.match(fn, /orderBy\("respondByAt"\)/);
    assert.doesNotMatch(fn, /\.limit\(300\)/);
    assert.ok(hasIndex("carPurchases", ["purchaseStatus", "respondByAt"]));
  });

  it("refund retry filters refundDueCents in the query", () => {
    const fn = block("exports.retryFreightSettlementRefunds = ");
    assert.match(fn, /where\("refundDueCents", ">", 0\)/);
    assert.doesNotMatch(fn, /\.filter\(\(doc\) => Number\(doc\.get/);
    assert.ok(hasIndex("freightSettlements",
        ["priceSettlementStatus", "refundDueCents"]));
  });

  it("barrel pool expiry pages by deadline", () => {
    const fn = block("exports.expireBarrelPools = ");
    assert.match(fn, /orderBy\("joinDeadline"\)/);
    assert.match(fn, /drainPages\(/);
    assert.ok(hasIndex("barrelPools", ["status", "joinDeadline"]));
  });
});

describe("function instance budget", () => {
  // Cloud Run counts cpu x maxInstances of EVERY deployed function against
  // the regional CPU quota; ~1,800 reserved CPUs already failed a deploy
  // (see the setGlobalOptions comment). Keep well under it.
  const RESERVED_CPU_BUDGET = 1000;

  it("stays under the reserved-CPU budget", () => {
    const globalMatch =
      source.match(/setGlobalOptions\(\{maxInstances: (\d+)\}\)/);
    assert.ok(globalMatch, "setGlobalOptions maxInstances moved");
    const globalMax = Number(globalMatch[1]);
    const constants = Object.fromEntries(
        [...source.matchAll(/^const ([A-Z_]+_MAX_INSTANCES) = (\d+);$/gm)]
            .map((m) => [m[1], Number(m[2])]));
    const parts = source.split(/^(?=exports\.[A-Za-z0-9_]+ = )/m).slice(1);
    let reserved = 0;
    let functions = 0;
    const perFunction = {};
    for (const part of parts) {
      const name = part.match(/^exports\.([A-Za-z0-9_]+) = /)[1];
      const alias =
        part.match(/^exports\.\w+ = exports\.(\w+);/);
      let max;
      if (alias) {
        max = perFunction[alias[1]];
      } else {
        if (!/^exports\.[A-Za-z0-9_]+ = on[A-Z]/.test(part)) continue;
        const options =
          part.slice(0, part.search(/async \(|\(\) =>|async function/));
        const found = options.match(/maxInstances: ([A-Z_0-9]+)/);
        max = found ? (/^\d+$/.test(found[1]) ? Number(found[1]) :
          constants[found[1]]) : globalMax;
      }
      assert.ok(Number.isFinite(max), `unresolved maxInstances for ${name}`);
      perFunction[name] = max;
      reserved += max;
      functions += 1;
    }
    assert.ok(functions > 200, `only found ${functions} functions`);
    assert.ok(reserved <= RESERVED_CPU_BUDGET,
        `${functions} functions reserve ${reserved} CPUs ` +
        `(budget ${RESERVED_CPU_BUDGET}); raise maxInstances only where ` +
        "traffic needs it, not globally");
  });
});
