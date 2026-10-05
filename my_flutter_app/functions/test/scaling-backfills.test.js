"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  OPEN_ENDED_OCCUPANCY_END_MS,
} = require("../parking_occupancy");
const {
  carrierTrackingDonePatch,
  shipmentCarrierTrackingFinished,
} = require("../shipment_tracking");
const {
  EDIT_FLOOR_MS,
  isProposalExpired,
  legacyRespondByAtMs,
  responseDeadlineMs,
} = require("../car_viewing");
const {
  backfillCarrierTrackingDone,
  backfillParkingOccupancy,
  backfillViewingRespondBy,
  ensureParkingOccupancyIndexed,
  isBenignRace,
  parkingOccupancyMarkerId,
} = require("../scaling_backfills");

// A tiny in-memory Firestore: enough of the query/update surface the
// backfills use (==, in, orderBy(documentId), limit, startAfter, guarded
// update, marker get/set).
function fakeDb(collections) {
  let clock = 1;
  const store = {};
  for (const [name, docs] of Object.entries(collections)) {
    store[name] = new Map(Object.entries(docs).map(([id, data]) =>
      [id, {data: {...data}, updateTime: clock++}]));
  }
  const writes = [];
  const snap = (name, id) => {
    const entry = store[name].get(id);
    return {
      id,
      exists: Boolean(entry),
      updateTime: entry?.updateTime,
      data: () => entry ? {...entry.data} : undefined,
      get: (field) => entry?.data[field],
      ref: refFor(name, id),
    };
  };
  function refFor(name, id) {
    return {
      get: async () => snap(name, id),
      set: async (data) => {
        store[name].set(id, {data: {...data}, updateTime: clock++});
      },
      update: async (patch, precondition) => {
        const entry = store[name].get(id);
        if (!entry) throw Object.assign(new Error("gone"), {code: 5});
        if (precondition?.lastUpdateTime !== undefined &&
            precondition.lastUpdateTime !== entry.updateTime) {
          throw Object.assign(new Error("raced"), {code: 9});
        }
        Object.assign(entry.data, patch);
        entry.updateTime = clock++;
        writes.push({name, id, patch});
      },
    };
  }
  function query(name, filters = [], limitN = Infinity, after = null) {
    return {
      where: (field, op, value) =>
        query(name, [...filters, {field, op, value}], limitN, after),
      orderBy: () => query(name, filters, limitN, after),
      limit: (n) => query(name, filters, n, after),
      startAfter: (doc) => query(name, filters, limitN, doc.id),
      get: async () => {
        const ids = [...store[name].keys()].sort()
            .filter((id) => after === null || id > after)
            .filter((id) => filters.every(({field, op, value}) => {
              const v = store[name].get(id).data[field];
              if (op === "==") return v === value;
              if (op === "in") return value.includes(v);
              throw new Error(`fake does not support ${op}`);
            }))
            .slice(0, limitN);
        return {docs: ids.map((id) => snap(name, id))};
      },
    };
  }
  return {
    writes,
    store,
    collection: (name) => {
      store[name] = store[name] || new Map();
      return {...query(name), doc: (id) => refFor(name, id)};
    },
  };
}

const day = (iso) => new Date(`${iso}T12:00:00Z`);

describe("parking occupancy backfill", () => {
  const rows = () => ({
    a: {businessId: "lot1", parkingDate: day("2019-01-01")},
    b: {businessId: "lot1", parkingDate: day("2026-09-01"),
      parkingEndDate: day("2026-09-05")},
    c: {businessId: "lot2", parkingDate: day("2026-09-01")},
    d: {businessId: "lot1", parkingDate: day("2026-09-01"),
      occupancyEndMs: OPEN_ENDED_OCCUPANCY_END_MS},
  });

  it("stamps only that lot's rows that need it, then marks it", async () => {
    const db = fakeDb({parkedCars: rows()});
    const stats = await backfillParkingOccupancy(db, "lot1",
        {deadlineMs: Infinity});
    assert.equal(stats.complete, true);
    assert.equal(stats.scanned, 3);
    assert.equal(stats.updated, 2);
    assert.equal(db.store.parkedCars.get("a").data.occupancyEndMs,
        OPEN_ENDED_OCCUPANCY_END_MS);
    assert.equal(db.store.parkedCars.get("b").data.occupancyEndMs,
        day("2026-09-05").getTime());
    assert.equal(db.store.parkedCars.get("c").data.occupancyEndMs, undefined);
    assert.ok(db.store.scalingBackfills.has(parkingOccupancyMarkerId("lot1")));
  });

  it("is idempotent: a second run writes nothing", async () => {
    const db = fakeDb({parkedCars: rows()});
    await backfillParkingOccupancy(db, "lot1", {deadlineMs: Infinity});
    const before = db.writes.length;
    const again = await backfillParkingOccupancy(db, "lot1",
        {deadlineMs: Infinity});
    assert.equal(again.updated, 0);
    assert.equal(db.writes.length, before);
  });

  it("dry run counts but neither writes nor marks", async () => {
    const db = fakeDb({parkedCars: rows()});
    const stats = await backfillParkingOccupancy(db, "lot1",
        {commit: false, deadlineMs: Infinity});
    assert.equal(stats.updated, 2);
    assert.equal(db.writes.length, 0);
    assert.equal(db.store.scalingBackfills, undefined);
  });

  it("an unfinished backfill is not marked and the ensure call fails " +
      "closed", async () => {
    const db = fakeDb({parkedCars: rows()});
    await assert.rejects(
        ensureParkingOccupancyIndexed(db, "lot-x-unfinished",
            {deadlineMs: 1}),
        (error) => error.code === "occupancy-backfill-incomplete",
    );
    assert.equal(db.store.scalingBackfills?.size || 0, 0);
  });

  it("treats a changed or deleted row as a benign race", () => {
    assert.equal(isBenignRace({code: 9}), true);
    assert.equal(isBenignRace({code: 5}), true);
    assert.equal(isBenignRace({code: 14}), false);
  });
});

describe("carrierTrackingDone", () => {
  it("is done for final statuses and failed requests", () => {
    for (const status of ["completed", "cancelled", "delivered"]) {
      assert.equal(shipmentCarrierTrackingFinished({status}), true, status);
    }
    assert.equal(shipmentCarrierTrackingFinished(
        {status: "in_transit", fulfillmentStatus: "delivered"}), true);
    assert.equal(shipmentCarrierTrackingFinished(
        {status: "in_transit", trackingRequestStatus: "failed"}), true);
    assert.equal(shipmentCarrierTrackingFinished(
        {status: "in_transit", trackingRequestStatus: "tracking"}), false);
    assert.equal(shipmentCarrierTrackingFinished({}), false);
  });

  it("only patches carrier-tracked shipments, idempotently", () => {
    assert.equal(carrierTrackingDonePatch({status: "completed"}), null);
    const live = {trackingProvider: "carrier_api", status: "in_transit"};
    assert.deepEqual(carrierTrackingDonePatch(live),
        {carrierTrackingDone: false});
    assert.equal(carrierTrackingDonePatch(
        {...live, carrierTrackingDone: false}), null);
    assert.deepEqual(carrierTrackingDonePatch(
        {...live, status: "completed", carrierTrackingDone: false}),
    {carrierTrackingDone: true});
  });

  it("backfills each collection, then marks it done once", async () => {
    const db = fakeDb({
      barrelShipments: {
        s1: {trackingProvider: "carrier_api", status: "in_transit"},
        s2: {trackingProvider: "carrier_api", status: "completed"},
        s3: {trackingProvider: "manual", status: "in_transit"},
      },
      freightShipments: {},
    });
    const result = await backfillCarrierTrackingDone(db,
        ["barrelShipments", "freightShipments"], {deadlineMs: Infinity});
    assert.equal(result.complete, true);
    assert.equal(db.store.barrelShipments.get("s1").data.carrierTrackingDone,
        false);
    assert.equal(db.store.barrelShipments.get("s2").data.carrierTrackingDone,
        true);
    assert.equal(db.store.barrelShipments.get("s3").data.carrierTrackingDone,
        undefined);
    const again = await backfillCarrierTrackingDone(db,
        ["barrelShipments", "freightShipments"], {deadlineMs: Infinity});
    assert.equal(again.skipped, true);
  });
});

describe("viewing respondByAt backfill", () => {
  const now = day("2026-10-05").getTime();

  it("a pending proposal with no deadline is stamped due now", () => {
    assert.equal(legacyRespondByAtMs({purchaseStatus: "viewing_requested",
      respondByAtMs: null}, now), now);
    assert.equal(legacyRespondByAtMs({purchaseStatus: "viewing_countered"},
        now), now);
  });

  it("never changes whether a proposal has expired", () => {
    // The sweep reads a missing respondByAt as null, which isProposalExpired
    // treats as already overdue - stamping "now" keeps it overdue from the
    // next run on.
    const slots = [{startAtMs: now + 5 * 24 * 3600e3}];
    const legacy = {purchaseStatus: "viewing_requested",
      proposedSlots: slots, respondByAtMs: null};
    const stamped = {...legacy,
      respondByAtMs: legacyRespondByAtMs(legacy, now)};
    for (const later of [0, 1, 3600e3]) {
      assert.equal(isProposalExpired(legacy, now + later), true);
      assert.equal(isProposalExpired(stamped, now + later), true);
    }
  });

  it("leaves proposals that have a deadline, and non-pending ones", () => {
    const slots = [{startAtMs: now + 9e6}];
    assert.equal(legacyRespondByAtMs({purchaseStatus: "viewing_requested",
      respondByAtMs: responseDeadlineMs(slots, now)}, now), null);
    assert.equal(legacyRespondByAtMs({purchaseStatus: "viewing_scheduled",
      respondByAtMs: null}, now), null);
    assert.ok(EDIT_FLOOR_MS > 0);
  });

  it("writes respondByAt only where missing", async () => {
    const db = fakeDb({carPurchases: {
      p1: {purchaseStatus: "viewing_requested",
        proposedSlots: [{startAtMs: now}]},
      p2: {purchaseStatus: "viewing_scheduled",
        proposedSlots: [{startAtMs: now}]},
    }});
    const before = Date.now();
    const stats = await backfillViewingRespondBy(db, {deadlineMs: Infinity});
    assert.equal(stats.updated, 1);
    const stamped = db.store.carPurchases.get("p1").data.respondByAt
        .toMillis();
    assert.ok(stamped >= before && stamped <= Date.now());
    assert.equal(db.store.carPurchases.get("p2").data.respondByAt, undefined);
  });
});
