"use strict";

const assert = require("node:assert/strict");
const {before, describe, it} = require("node:test");
const admin = require("firebase-admin");

// Monthly volume against the Firestore and Auth emulators: the two rollup
// triggers (run by hand with the before/after a write produced, as the
// container suite does) and the three callables. What the pure tests in
// volume-counts.test.js cannot show - that the month queries really find a
// legacy line, a new line and a split part, that a recount converges, that
// a burst collapses, and who may read the numbers - is exercised here.
//
// Writes with ADMIN credentials, so it refuses to run outside the emulator.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
      "Run this through `npm run test:volume` (firebase emulators:exec). " +
      "A direct node --test run would write its fixtures into the " +
      "real project.");
}

process.env.FUNCTIONS_EMULATOR = "true";

const functions = require("../index");
const db = admin.firestore();
const {Timestamp} = admin.firestore;

const BIZ = "vol-test-biz";
const OTHER_BIZ = "vol-test-other-biz";
// Lines exist, the business document does not (deleted).
const GONE_BIZ = "vol-test-gone-biz";
const OWNER = "vol-test-owner";
const LOADER = "vol-test-loader";
const LEDGER_ONLY = "vol-test-ledger-only";
const OTHER_OWNER = "vol-test-other-owner";
const SUPER = "vol-test-super-admin";
const FINANCE = "vol-test-finance-admin";
const SUPPORT = "vol-test-support-admin";

const at = (iso) => Timestamp.fromDate(new Date(iso));
const OCT = "2026-10";
const SEP = "2026-09";
const NOV = "2026-11";

const call = (name, data, uid = OWNER) =>
  functions[name].run({auth: {uid, token: {email_verified: true}}, data});

const snap = (data) => ({exists: Boolean(data), data: () => data || undefined});

async function fireLine(id, beforeData, afterData) {
  return functions.rollupVolumeOnLineWrite.run({
    params: {lineId: id},
    data: {before: snap(beforeData), after: snap(afterData)},
  });
}

async function fireContainer(id, beforeData, afterData) {
  return functions.rollupVolumeOnContainerWrite.run({
    params: {containerId: id},
    data: {before: snap(beforeData), after: snap(afterData)},
  });
}

// Writes a line (whole) and runs the trigger the write would fire.
async function writeLine(id, data) {
  const ref = db.collection("containerLines").doc(id);
  const prior = await ref.get();
  const beforeData = prior.exists ? prior.data() : null;
  await ref.set(data);
  const afterData = (await ref.get()).data();
  return fireLine(id, beforeData, afterData);
}

async function deleteLine(id) {
  const ref = db.collection("containerLines").doc(id);
  const prior = await ref.get();
  await ref.delete();
  return fireLine(id, prior.exists ? prior.data() : null, null);
}

async function writeContainer(id, data) {
  const ref = db.collection("containers").doc(id);
  const prior = await ref.get();
  const beforeData = prior.exists ? prior.data() : null;
  await ref.set(data);
  return fireContainer(id, beforeData, (await ref.get()).data());
}

async function rollup(businessId, month) {
  const doc = await db.collection("volumeMonthly")
      .doc(`${businessId}_${month}`).get();
  return doc.exists ? doc.data() : null;
}

const pick = (doc) => doc ? {pieces: doc.pieces || 0,
  barrels: doc.barrels || 0, packages: doc.packages || 0,
  cars: doc.cars || 0, customerLines: doc.customerLines || 0,
  containersShipped: doc.containersShipped || 0} :
  {pieces: 0, barrels: 0, packages: 0, cars: 0, customerLines: 0,
    containersShipped: 0};

const legacyBarrels = (quantity, createdIso, extra = {}) => ({
  businessId: BIZ, kind: "barrels", quantity, ownerKind: "customer",
  customerName: "Fatou Diallo", containerId: "", containerStatus: "waiting",
  createdAt: at(createdIso), ...extra,
});

const denied = (error) => {
  assert.equal(error.code, "permission-denied", error.message);
  return true;
};

before(async () => {
  await Promise.all([SUPER, FINANCE, SUPPORT].map((uid) =>
    admin.auth().createUser({uid, email: `${uid}@example.test`,
      password: "VolumeAdmin-2026!", emailVerified: true})));
  await Promise.all([
    db.collection("businesses").doc(BIZ).set({name: "Conakry Express",
      status: "approved", enabledServices: ["barrelShipping"]}),
    db.collection("businesses").doc(OTHER_BIZ).set({name: "Dakar Cargo",
      status: "approved", enabledServices: ["freight"]}),
    db.collection("users").doc(OWNER).set({role: "businessOwner",
      businessId: BIZ, email: "owner@example.test"}),
    db.collection("users").doc(LOADER).set({role: "staff", businessId: BIZ,
      businessPermissions: ["containers"], email: "loader@example.test"}),
    db.collection("users").doc(LEDGER_ONLY).set({role: "staff",
      businessId: BIZ, businessPermissions: ["ledger"],
      email: "ledger@example.test"}),
    db.collection("users").doc(OTHER_OWNER).set({role: "businessOwner",
      businessId: OTHER_BIZ, email: "other@example.test"}),
    db.collection("users").doc(SUPER).set({role: "admin",
      platformAdmin: true, adminRole: "superAdmin"}),
    db.collection("users").doc(FINANCE).set({role: "admin",
      platformAdmin: true, adminRole: "financeManager"}),
    db.collection("users").doc(SUPPORT).set({role: "admin",
      platformAdmin: true, adminRole: "supportAdmin"}),
  ]);
});

describe("the line trigger recounts the month a line was received", () => {
  it("counts a legacy line by its createdAt and quantity", async () => {
    await writeLine("legacy-1", legacyBarrels(3, "2026-10-10T15:00:00Z"));
    assert.deepEqual(pick(await rollup(BIZ, OCT)), {pieces: 3, barrels: 3,
      packages: 0, cars: 0, customerLines: 1, containersShipped: 0});
  });

  it("counts a new line by its pieces; Oct 31 11:30 PM NY is October",
      async () => {
        await writeLine("new-1", {businessId: BIZ, kind: "other",
          quantity: 3, ownerKind: "customer", rootLineId: "new-1",
          partIndex: 1, source: "counter", pieceCount: 3, barrelPieces: 1,
          packagePieces: 2, carPieces: 0,
          pieces: [{id: "p1", kind: "barrel"}, {id: "p2", kind: "box"},
            {id: "p3", kind: "other"}],
          containerId: "", containerStatus: "waiting",
          receivedAt: at("2026-11-01T03:30:00Z"),
          createdAt: at("2026-11-01T03:30:00Z")});
        assert.deepEqual(pick(await rollup(BIZ, OCT)), {pieces: 6,
          barrels: 4, packages: 2, cars: 0, customerLines: 2,
          containersShipped: 0});
        assert.equal(pick(await rollup(BIZ, NOV)).pieces, 0);
      });

  it("is idempotent: the same event again, or a rebuild, agrees",
      async () => {
        const doc = (await db.collection("containerLines").doc("legacy-1")
            .get()).data();
        await fireLine("legacy-1", null, doc);
        await fireLine("legacy-1", null, doc);
        const once = pick(await rollup(BIZ, OCT));
        const rebuilt = await call("rebuildVolumeMonths",
            {fromMonth: SEP, toMonth: NOV, businessId: BIZ}, FINANCE);
        assert.equal(rebuilt.done, true);
        assert.deepEqual(rebuilt.months, [SEP, OCT, NOV]);
        assert.deepEqual(pick(await rollup(BIZ, OCT)), once);
        assert.equal(once.pieces, 6);
      });

  it("ignores writes that change nothing it counts", async () => {
    const ref = db.collection("containerLines").doc("legacy-1");
    const priorSeq = (await rollup(BIZ, OCT)).requestSeq;
    const beforeData = (await ref.get()).data();
    await ref.set({paidCents: 2500}, {merge: true});
    const result = await fireLine("legacy-1", beforeData,
        (await ref.get()).data());
    assert.equal(result.targets, 0);
    assert.equal((await rollup(BIZ, OCT)).requestSeq, priorSeq);
  });

  it("follows a line whose receivedAt moves to another month", async () => {
    const ref = db.collection("containerLines").doc("legacy-1");
    await writeLine("legacy-1", {...(await ref.get()).data(),
      receivedAt: at("2026-09-29T14:00:00Z")});
    assert.equal(pick(await rollup(BIZ, OCT)).pieces, 3);
    assert.deepEqual(pick(await rollup(BIZ, SEP)), {pieces: 3, barrels: 3,
      packages: 0, cars: 0, customerLines: 1, containersShipped: 0});
  });

  it("drops a deleted line", async () => {
    await deleteLine("legacy-1");
    assert.equal(pick(await rollup(BIZ, SEP)).pieces, 0);
    assert.equal(pick(await rollup(BIZ, OCT)).pieces, 3);
  });

  it("a split in the same month leaves the month unchanged", async () => {
    await writeLine("root-1", {businessId: BIZ, kind: "barrels",
      quantity: 4, ownerKind: "customer", rootLineId: "root-1",
      partIndex: 1, pieceCount: 4, barrelPieces: 4, packagePieces: 0,
      carPieces: 0, containerId: "", containerStatus: "waiting",
      receivedAt: at("2026-10-08T14:00:00Z"),
      createdAt: at("2026-10-08T14:00:00Z")});
    const whole = pick(await rollup(BIZ, OCT));
    // Two of the four leave on a container; the other two stay as a part.
    // The part was split off in November and (here) names no receivedAt,
    // so it inherits its root's: October.
    const rootRef = db.collection("containerLines").doc("root-1");
    await writeLine("root-1", {...(await rootRef.get()).data(),
      quantity: 2, pieceCount: 2, barrelPieces: 2});
    await writeLine("root-1-2", {businessId: BIZ, kind: "barrels",
      quantity: 2, ownerKind: "customer", rootLineId: "root-1",
      partIndex: 2, pieceCount: 2, barrelPieces: 2, packagePieces: 0,
      carPieces: 0, containerId: "", containerStatus: "waiting",
      createdAt: at("2026-11-03T14:00:00Z")});
    assert.deepEqual(pick(await rollup(BIZ, OCT)), whole);
    assert.equal(pick(await rollup(BIZ, NOV)).pieces, 0);
    // A rebuild (which finds the part through its root) agrees.
    await call("rebuildVolumeMonths", {fromMonth: OCT, toMonth: NOV,
      businessId: BIZ}, SUPER);
    assert.deepEqual(pick(await rollup(BIZ, OCT)), whole);
    assert.equal(pick(await rollup(BIZ, NOV)).pieces, 0);
  });

  it("collapses a burst into one recount that is still right", async () => {
    await Promise.all([1, 2, 3].map((n) => db.collection("containerLines")
        .doc(`burst-${n}`).set(legacyBarrels(1, "2026-10-15T15:00:00Z"))));
    const results = await Promise.all([1, 2, 3].map(async (n) =>
      fireLine(`burst-${n}`, null, (await db.collection("containerLines")
          .doc(`burst-${n}`).get()).data())));
    assert.ok(results.reduce((sum, r) => sum + r.written, 0) >= 1);
    assert.ok(results.some((r) => r.written === 0),
        "the earlier turns stepped aside for the last one");
    const after = pick(await rollup(BIZ, OCT));
    assert.equal(after.pieces, 3 + 4 + 3);
    assert.equal(after.customerLines, 1 + 1 + 3);
  });
});

describe("the container trigger counts containers in their sailing month",
    () => {
      const box = {businessId: BIZ, status: "loading",
        containerNumber: "MSCU1234567", label: "Sailing 20 Oct",
        destinationCountryId: "gn", destinationCountryName: "Guinea",
        lineCount: 0};

      it("counts what is on it when it sails, then not when un-shipped",
          async () => {
            await writeContainer("box-1", box);
            // Loading lines onto a loading box recounts nothing for it.
            const lineRef = db.collection("containerLines").doc("new-1");
            const loaded = {...(await lineRef.get()).data(),
              containerId: "box-1", containerStatus: "loading"};
            const loadResult = await writeLine("new-1", loaded);
            assert.equal(loadResult.targets, 0);
            await writeLine("box-car", {businessId: BIZ, kind: "car",
              quantity: 1, ownerKind: "stock", vinNumber: "1HGCM82633A004352",
              containerId: "box-1", containerStatus: "loading",
              // Received in September, shipped in October: independent.
              createdAt: at("2026-09-12T14:00:00Z")});
            await writeContainer("box-1", {...box, status: "shipped",
              sailedAt: at("2026-10-20T14:00:00Z")});
            const oct = await rollup(BIZ, OCT);
            assert.equal(oct.containersShipped, 1);
            assert.equal(oct.containerPieces, 4);
            assert.deepEqual(oct.containers.map((c) => [c.id, c.number,
              c.destination, c.barrels, c.packages, c.cars]),
            [["box-1", "MSCU1234567", "Guinea", 1, 2, 1]]);
            assert.equal(pick(await rollup(BIZ, SEP)).cars, 1,
                "the car still counts in the month it was received");

            // Lines catching up on the status change nothing counted.
            const sameLine = await writeLine("new-1",
                {...loaded, containerStatus: "shipped"});
            assert.equal(sameLine.targets, 0);

            await writeContainer("box-1", {...box, status: "loading"});
            assert.equal((await rollup(BIZ, OCT)).containersShipped, 0);
          });

      it("lists a container that sailed with nothing on it", async () => {
        await writeContainer("box-empty", {...box, containerNumber: "",
          label: "Empty run", status: "shipped",
          sailedAt: at("2026-10-02T14:00:00Z")});
        const oct = await rollup(BIZ, OCT);
        assert.equal(oct.containersShipped, 1);
        assert.deepEqual(oct.containers.map((c) => [c.number, c.pieces]),
            [["Empty run", 0]]);
        assert.equal(oct.avgPerContainer, 0);
      });

      it("a line added to a sailed container recounts its month",
          async () => {
            await writeContainer("box-1", {...box, status: "shipped",
              sailedAt: at("2026-10-20T14:00:00Z")});
            await writeLine("late-line", legacyBarrels(2,
                "2026-08-01T14:00:00Z", {containerId: "box-1",
                  containerStatus: "shipped"}));
            const oct = await rollup(BIZ, OCT);
            const sailed = oct.containers.find((c) => c.id === "box-1");
            assert.equal(sailed.barrels, 3);
            assert.equal(oct.containersShipped, 2);
          });
    });

describe("who may read and rebuild volume", () => {
  before(async () => {
    // A business that no longer exists still has its numbers.
    await writeLine("gone-1", {businessId: GONE_BIZ, kind: "barrels",
      quantity: 7, ownerKind: "customer", containerId: "",
      createdAt: at("2026-10-05T14:00:00Z")});
    await writeLine("other-1", {businessId: OTHER_BIZ, kind: "other",
      quantity: 2, ownerKind: "customer", containerId: "",
      createdAt: at("2026-09-05T14:00:00Z")});
  });

  it("platform volume: finance admins only", async () => {
    for (const uid of [SUPPORT, OWNER, LOADER]) {
      await assert.rejects(call("getPlatformVolume", {month: OCT}, uid),
          denied);
    }
    const answer = await call("getPlatformVolume", {month: OCT}, FINANCE);
    assert.equal(answer.month, OCT);
    const ours = (await rollup(BIZ, OCT)).pieces;
    assert.equal(answer.totals.pieces, ours + 7);
    assert.deepEqual(answer.businesses.map((row) => [row.businessId,
      row.name]), ours > 7 ?
      [[BIZ, "Conakry Express"], [GONE_BIZ, GONE_BIZ]] :
      [[GONE_BIZ, GONE_BIZ], [BIZ, "Conakry Express"]]);
    assert.equal(answer.trend.length, 12);
    assert.equal(answer.trend[11].month, OCT);
    assert.equal(answer.trend[11].pieces, answer.totals.pieces);
    const sept = answer.trend[10];
    assert.equal(sept.month, SEP);
    assert.equal(answer.totals.previousPieces, sept.pieces);
    assert.ok(sept.pieces > 0);
    assert.equal(typeof answer.totals.piecesChangePct, "number");
    const superAnswer = await call("getPlatformVolume", {month: OCT}, SUPER);
    assert.equal(superAnswer.totals.pieces, answer.totals.pieces);
  });

  it("a month nobody counted is zeros, with no % change", async () => {
    const answer = await call("getPlatformVolume", {month: "2024-02"},
        SUPER);
    assert.equal(answer.totals.pieces, 0);
    assert.deepEqual(answer.businesses, []);
    assert.equal(answer.totals.piecesChangePct, null);
  });

  it("business volume: owner, containers staff and finance admins",
      async () => {
        const mine = await call("getBusinessVolume",
            {businessId: BIZ, month: OCT}, OWNER);
        assert.equal(mine.businessName, "Conakry Express");
        assert.equal(mine.totals.pieces, (await rollup(BIZ, OCT)).pieces);
        assert.equal(mine.containers.length, 2);
        const loader = await call("getBusinessVolume",
            {businessId: BIZ, month: OCT}, LOADER);
        assert.deepEqual(loader.totals, mine.totals);
        const financeView = await call("getBusinessVolume",
            {businessId: BIZ, month: OCT}, FINANCE);
        assert.deepEqual(financeView.containers, mine.containers);
        for (const uid of [LEDGER_ONLY, OTHER_OWNER, SUPPORT]) {
          await assert.rejects(call("getBusinessVolume",
              {businessId: BIZ, month: OCT}, uid), denied);
        }
        await assert.rejects(call("getBusinessVolume",
            {businessId: BIZ, month: "October"}, OWNER),
        (error) => error.code === "invalid-argument");
      });

  it("rebuild: finance managers, bounded and paged", async () => {
    for (const uid of [SUPPORT, OWNER]) {
      await assert.rejects(call("rebuildVolumeMonths",
          {fromMonth: OCT, toMonth: OCT}, uid), denied);
    }
    await assert.rejects(call("rebuildVolumeMonths",
        {fromMonth: "2020-01", toMonth: OCT}, FINANCE),
    (error) => error.code === "invalid-argument");
    await assert.rejects(call("rebuildVolumeMonths",
        {fromMonth: NOV, toMonth: OCT}, FINANCE),
    (error) => error.code === "invalid-argument");
    const before = pick(await rollup(BIZ, OCT));
    const all = await call("rebuildVolumeMonths",
        {fromMonth: SEP, toMonth: OCT}, FINANCE);
    assert.equal(all.done, true);
    assert.ok(all.rebuilt >= 4, `rebuilt ${all.rebuilt}`);
    assert.deepEqual(pick(await rollup(BIZ, OCT)), before);
    assert.equal(pick(await rollup(OTHER_BIZ, SEP)).pieces, 2);
  });
});
