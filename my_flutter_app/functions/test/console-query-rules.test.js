// The consoles' new query shapes (ordered, paged, filtered in the query)
// must still be provable by firestore.rules: a list query the rules cannot
// prove stays inside the reader's business is refused whole, which reads as
// a list that never loads. Each shape below is the one admin_web asks for
// (admin_web/src/lib/console-query-indexes.test.ts lists them), run as the
// business it belongs to - allowed - and as another business - refused.
//
// Run through `npm run test:console-query-rules` (firebase emulators:exec).
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
      "Run this through `npm run test:console-query-rules` " +
      "(firebase emulators:exec); it seeds with admin credentials.");
}

const fs = require("node:fs");
const path = require("node:path");
const {after, before, describe, it} = require("node:test");
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require("@firebase/rules-unit-testing");

const projectId = "demo-laawol-console-queries";
let testEnv;

const USERS = {
  "owner-a": {role: "businessOwner", businessId: "biz_a"},
  "owner-b": {role: "businessOwner", businessId: "biz_b"},
  "staff-freight-a": {role: "staff", businessId: "biz_a",
    businessPermissions: ["freight"]},
  "platform-admin": {role: "admin", adminRole: "superAdmin"},
};

function dbFor(uid) {
  return testEnv.authenticatedContext(uid, {
    email_verified: true, ...USERS[uid]}).firestore();
}

const ts = (iso) => new Date(iso);

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: fs.readFileSync(
          path.join(__dirname, "..", "..", "firestore.rules"), "utf8"),
    },
  });
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const writes = [];
    for (const [uid, profile] of Object.entries(USERS)) {
      writes.push(db.doc(`users/${uid}`).set({
        ...profile, email: `${uid}@laawol.test`, accountStatus: "active"}));
    }
    const put = (p, data) => writes.push(db.doc(p).set(data));
    for (const biz of ["biz_a", "biz_b"]) {
      put(`businesses/${biz}`, {name: biz, status: "approved",
        ownerUid: biz === "biz_a" ? "owner-a" : "owner-b"});
      put(`barrelShipments/${biz}-1`, {businessId: biz, status: "pending",
        createdAt: ts("2026-09-01")});
      put(`freightShipments/${biz}-1`, {businessId: biz, status: "pending",
        createdAt: ts("2026-09-01")});
      put(`transportRequests/${biz}-1`, {businessId: biz,
        status: "scheduled", createdAt: ts("2026-09-01")});
      put(`transportOpportunities/r1__${biz}`, {businessId: biz,
        requestId: "r1", status: "open", createdAt: ts("2026-09-01")});
      put(`transportQuotes/r1__${biz}`, {businessId: biz, requestId: "r1",
        status: "submitted"});
      put(`carPurchases/${biz}-1`, {businessId: biz, purchaseStatus:
        "reserved", createdAt: ts("2026-09-01"), buyerUid: "someone"});
      put(`cars/${biz}-car`, {businessId: biz, status: "active",
        isRebuiltTitle: false, createdAt: ts("2026-09-01")});
      put(`barrelPools/${biz}-1`, {businessId: biz, status: "open",
        updatedAt: ts("2026-09-01")});
      put(`barrelPoolBalanceRequests/${biz}-1`, {businessId: biz,
        status: "pending"});
      put(`parkedCars/${biz}-active`, {businessId: biz, status: "parked",
        parkingDate: ts("2026-09-01"), occupancyEndMs: 8.64e15});
      put(`parkedCars/${biz}-ended`, {businessId: biz, status: "parked",
        parkingDate: ts("2026-07-01"), occupancyEndMs: Date.UTC(2026, 7, 1)});
      put(`containers/${biz}-open`, {businessId: biz, status: "loading"});
      put(`containers/${biz}-arrived`, {businessId: biz, status: "arrived",
        arrivedAt: ts("2026-08-01")});
      put(`containerLines/${biz}-l1`, {businessId: biz,
        containerId: `${biz}-open`, kind: "car",
        vinNumber: "1HGCM82633A004352"});
      put(`lotActivities/${biz}-1`, {businessId: biz, activityTypeId: "title",
        activityDate: ts("2026-09-03"), paymentStatus:
          "awaiting_direct_payment"});
      put(`lotActivities/${biz}-undated`, {businessId: biz,
        activityDate: null, paymentStatus: "succeeded"});
      put(`lotExpenseEntries/${biz}-1`, {businessId: biz, month: "2026-09",
        amountCents: 100});
      put(`lotCustomers/${biz}-1`, {businessId: biz,
        lastSeenAt: ts("2026-09-01")});
      put(`invoices/${biz}-1`, {businessId: biz, status: "open",
        issuedOn: "2026-09-01", dueOn: "2026-09-15"});
      put(`lotLedgerAudit/${biz}-1`, {businessId: biz, acknowledged: false,
        at: ts("2026-09-01"), entityId: "x"});
      put(`supportCases/${biz}-1`, {businessId: biz,
        updatedAt: ts("2026-09-01"), customerUid: "someone"});
    }
    put("freightQuoteRequests/fq1", {eligibleBusinessIds: ["biz_a"],
      quoteStatus: "collecting", customerUid: "someone"});
    await Promise.all(writes);
  });
});

after(async () => {
  if (testEnv) await testEnv.cleanup();
});

// [label, (db, businessId) => query] - the shape admin_web asks for.
const SHAPES = [
  ["barrel shipments, newest first, status picked", (db, b) =>
    db.collection("barrelShipments").where("businessId", "==", b)
        .where("status", "==", "pending").orderBy("createdAt", "desc")
        .limit(50)],
  ["freight shipments, newest first", (db, b) =>
    db.collection("freightShipments").where("businessId", "==", b)
        .orderBy("createdAt", "desc").limit(50)],
  ["transport jobs, newest first", (db, b) =>
    db.collection("transportRequests").where("businessId", "==", b)
        .orderBy("createdAt", "desc").limit(50)],
  ["open transport opportunities", (db, b) =>
    db.collection("transportOpportunities").where("businessId", "==", b)
        .where("status", "in", ["open", "quoted", "withdrawn"])],
  ["own transport quotes by request", (db, b) =>
    db.collection("transportQuotes").where("businessId", "==", b)
        .where("requestId", "in", ["r1"])],
  ["purchases, newest first", (db, b) =>
    db.collection("carPurchases").where("businessId", "==", b)
        .orderBy("createdAt", "desc").limit(50)],
  ["pools by update", (db, b) =>
    db.collection("barrelPools").where("businessId", "==", b)
        .orderBy("updatedAt", "desc").limit(50)],
  ["pending balance requests", (db, b) =>
    db.collection("barrelPoolBalanceRequests").where("businessId", "==", b)
        .where("status", "==", "pending")],
  ["running stays", (db, b) =>
    db.collection("parkedCars").where("businessId", "==", b)
        .where("occupancyEndMs", ">=", Date.UTC(2026, 9, 5))],
  ["ended stays, paged", (db, b) =>
    db.collection("parkedCars").where("businessId", "==", b)
        .where("occupancyEndMs", "<", Date.UTC(2026, 9, 5))
        .orderBy("occupancyEndMs", "desc").limit(50)],
  ["Today parked cars by parkingDate", (db, b) =>
    db.collection("parkedCars").where("businessId", "==", b)
        .orderBy("parkingDate", "desc").limit(25)],
  ["open containers", (db, b) =>
    db.collection("containers").where("businessId", "==", b)
        .where("status", "in", ["loading", "shipped"])],
  ["arrived containers, paged", (db, b) =>
    db.collection("containers").where("businessId", "==", b)
        .where("status", "==", "arrived").orderBy("arrivedAt", "desc")
        .limit(25)],
  ["lines of open containers", (db, b) =>
    db.collection("containerLines").where("businessId", "==", b)
        .where("containerId", "in", [`${b}-open`])],
  ["activity list, ranged, typed, owed", (db, b) =>
    db.collection("lotActivities").where("businessId", "==", b)
        .where("activityTypeId", "==", "title")
        .where("paymentStatus", "in",
            ["awaiting_payment_link", "awaiting_direct_payment"])
        .where("activityDate", ">=", ts("2026-08-01"))
        .where("activityDate", "<", ts("2026-11-01"))
        .orderBy("activityDate", "desc").limit(50)],
  ["month end: unsettled activities", (db, b) =>
    db.collection("lotActivities").where("businessId", "==", b)
        .where("paymentStatus", "!=", "succeeded")],
  ["month end: undated activities", (db, b) =>
    db.collection("lotActivities").where("businessId", "==", b)
        .where("activityDate", "==", null)],
  ["expense entries in the year", (db, b) =>
    db.collection("lotExpenseEntries").where("businessId", "==", b)
        .where("month", ">=", "2026-01").where("month", "<=", "2026-12")],
  ["lot customers, recent first", (db, b) =>
    db.collection("lotCustomers").where("businessId", "==", b)
        .orderBy("lastSeenAt", "desc").limit(300)],
  ["overdue invoices", (db, b) =>
    db.collection("invoices").where("businessId", "==", b)
        .where("status", "==", "open").where("dueOn", ">", "")
        .where("dueOn", "<", "2026-10-05").orderBy("dueOn", "asc").limit(50)],
  ["unacknowledged ledger changes", (db, b) =>
    db.collection("lotLedgerAudit").where("businessId", "==", b)
        .where("acknowledged", "==", false).orderBy("at", "desc").limit(6)],
  ["support inbox, newest activity first", (db, b) =>
    db.collection("supportCases").where("businessId", "==", b)
        .orderBy("updatedAt", "desc").limit(50)],
];

describe("console query shapes pass the rules for their own business", () => {
  for (const [label, build] of SHAPES) {
    it(`${label}: allowed for the business, refused for another`,
        async () => {
          const result = await assertSucceeds(
              build(dbFor("owner-a"), "biz_a").get());
          if (!label.startsWith("month end: unsettled")) {
            // The fixture has a matching row, so the shape really ran.
            if (!label.includes("ended") && !label.includes("undated")) {
              if (result.size < 1) throw new Error(`${label}: no rows`);
            }
          }
          await assertFails(build(dbFor("owner-b"), "biz_a").get());
        });
  }

  it("open freight price requests: eligible business only", async () => {
    const query = (db, b) => db.collection("freightQuoteRequests")
        .where("eligibleBusinessIds", "array-contains", b)
        .where("quoteStatus", "==", "collecting");
    const result = await assertSucceeds(
        query(dbFor("staff-freight-a"), "biz_a").get());
    if (result.size !== 1) throw new Error("the open request is listed");
    await assertFails(query(dbFor("owner-b"), "biz_a").get());
  });

  it("the cars of the purchases on screen, by id", async () => {
    const db = dbFor("owner-a");
    const result = await assertSucceeds(db.collection("cars")
        .where("businessId", "==", "biz_a")
        .where("__name__", "in", ["biz_a-car"]).get());
    if (result.size !== 1) throw new Error("the car is found by its id");
  });
});
