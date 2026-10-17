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
  // Inventory staff of a multi-store business: one tied to a store, one with
  // no store yet, one with all-stores access.
  "staff-inv-annex": {role: "staff", businessId: "biz_a",
    businessPermissions: ["inventory"], inventoryHomeStoreId: "biz_a-annex"},
  "staff-inv-none": {role: "staff", businessId: "biz_a",
    businessPermissions: ["inventory"]},
  "staff-inv-all": {role: "staff", businessId: "biz_a",
    businessPermissions: ["inventory"], inventoryAllStores: true},
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
      put(`inventoryItems/${biz}-item`, {businessId: biz, name: "Shea",
        code: "IT-K7M4P2", archived: false, priceCents: 1000, quantity: 5});
      put(`inventoryItems/${biz}-old`, {businessId: biz, name: "Old stock",
        code: "IT-OLD234", archived: true, priceCents: 500, quantity: 0});
      put(`inventorySales/${biz}-sale`, {businessId: biz, voided: false,
        totalCents: 1000, createdAt: ts("2026-09-01"), lines: []});
      put(`inventoryMovements/${biz}-move`, {businessId: biz,
        itemId: `${biz}-item`, type: "sale", createdAt: ts("2026-09-01")});
      // Categories and stores (v2); the business has two active stores.
      put(`inventoryConfig/${biz}`, {businessId: biz, storesConverted: true,
        mainStoreId: `${biz}-main`, multiStore: true});
      put(`inventoryCategories/${biz}-cat`, {businessId: biz, name: "Skin",
        nameKey: "skin", archived: false});
      put(`inventoryCategories/${biz}-cat-old`, {businessId: biz,
        name: "Old", nameKey: "old", archived: true});
      // Brands (v3), the same list shapes as categories.
      put(`inventoryBrands/${biz}-brand`, {businessId: biz, name: "Jordan",
        nameKey: "jordan", archived: false});
      put(`inventoryBrands/${biz}-brand-old`, {businessId: biz,
        name: "Old", nameKey: "old", archived: true});
      put(`inventoryBrandKeys/${biz}-lock`, {businessId: biz,
        brandId: `${biz}-brand`, nameKey: "jordan"});
      put(`inventoryStores/${biz}-main`, {businessId: biz, name: "Main store",
        archived: false, isMain: true});
      put(`inventoryStores/${biz}-annex`, {businessId: biz, name: "Annex",
        archived: false, isMain: false});
      put(`inventoryStores/${biz}-closed`, {businessId: biz, name: "Closed",
        archived: true, isMain: false});
      for (const store of ["main", "annex"]) {
        put(`inventoryStock/${biz}-item__${biz}-${store}`, {businessId: biz,
          itemId: `${biz}-item`, storeId: `${biz}-${store}`, quantity: 3,
          countWasOff: false});
        put(`inventorySales/${biz}-sale-${store}`, {businessId: biz,
          voided: false, totalCents: 1000, createdAt: ts("2026-09-02"),
          lines: [], storeId: `${biz}-${store}`});
        put(`inventoryMovements/${biz}-move-${store}`, {businessId: biz,
          itemId: `${biz}-item`, type: "sale", createdAt: ts("2026-09-02"),
          storeId: `${biz}-${store}`});
        // Credit sales and their later payments (v4).
        put(`inventorySales/${biz}-credit-${store}`, {businessId: biz,
          voided: false, totalCents: 5000, createdAt: ts("2026-09-04"),
          lines: [], storeId: `${biz}-${store}`, creditCents: 4000,
          creditPaidCents: 1000, creditStatus: "open",
          credit: {customerName: "Fatou", customerPhone: "+12075550100",
            collectorStaffId: "owner-a", dueDate: "2026-09-30"}});
        put(`inventoryCreditPayments/${biz}-pay-${store}`, {businessId: biz,
          saleId: `${biz}-credit-${store}`, storeId: `${biz}-${store}`,
          amountCents: 1000, method: "cash", reverted: false,
          createdAt: ts("2026-09-05")});
      }
      put(`inventoryMovements/${biz}-transfer`, {businessId: biz,
        itemId: `${biz}-item`, type: "transfer_out", transferId: "t1",
        createdAt: ts("2026-09-03"), storeId: `${biz}-main`});
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
  ["inventory: products by name", (db, b) =>
    db.collection("inventoryItems").where("businessId", "==", b)
        .orderBy("name").limit(200)],
  ["inventory: active products by name", (db, b) =>
    db.collection("inventoryItems").where("businessId", "==", b)
        .where("archived", "==", false).orderBy("name").limit(200)],
  ["inventory: archived products", (db, b) =>
    db.collection("inventoryItems").where("businessId", "==", b)
        .where("archived", "==", true).limit(200)],
  ["inventory: a scanned code", (db, b) =>
    db.collection("inventoryItems").where("businessId", "==", b)
        .where("code", "==", "IT-K7M4P2").limit(1)],
  ["inventory: sales, newest first, paged", (db, b) =>
    db.collection("inventorySales").where("businessId", "==", b)
        .orderBy("createdAt", "desc").limit(50)],
  ["inventory: a product's stock history", (db, b) =>
    db.collection("inventoryMovements").where("businessId", "==", b)
        .where("itemId", "==", `${b}-item`)
        .orderBy("createdAt", "desc").limit(50)],
  ["inventory: categories by name", (db, b) =>
    db.collection("inventoryCategories").where("businessId", "==", b)
        .orderBy("nameKey").limit(200)],
  ["inventory: active categories by name", (db, b) =>
    db.collection("inventoryCategories").where("businessId", "==", b)
        .where("archived", "==", false).orderBy("nameKey").limit(200)],
  ["inventory: the whole brand list", (db, b) =>
    db.collection("inventoryBrands").where("businessId", "==", b)],
  ["inventory: brands by name", (db, b) =>
    db.collection("inventoryBrands").where("businessId", "==", b)
        .orderBy("nameKey").limit(200)],
  ["inventory: active brands by name", (db, b) =>
    db.collection("inventoryBrands").where("businessId", "==", b)
        .where("archived", "==", false).orderBy("nameKey").limit(200)],
  ["inventory: stores by name", (db, b) =>
    db.collection("inventoryStores").where("businessId", "==", b)
        .orderBy("name").limit(50)],
  ["inventory: active stores by name", (db, b) =>
    db.collection("inventoryStores").where("businessId", "==", b)
        .where("archived", "==", false).orderBy("name").limit(50)],
  ["inventory: every stock row", (db, b) =>
    db.collection("inventoryStock").where("businessId", "==", b).limit(500)],
  ["inventory: a store's stock rows", (db, b) =>
    db.collection("inventoryStock").where("businessId", "==", b)
        .where("storeId", "==", `${b}-annex`).limit(500)],
  ["inventory: a product's stock rows", (db, b) =>
    db.collection("inventoryStock").where("businessId", "==", b)
        .where("itemId", "==", `${b}-item`)],
  ["inventory: a store's sales, newest first", (db, b) =>
    db.collection("inventorySales").where("businessId", "==", b)
        .where("storeId", "==", `${b}-annex`)
        .orderBy("createdAt", "desc").limit(50)],
  ["inventory: a store's stock history", (db, b) =>
    db.collection("inventoryMovements").where("businessId", "==", b)
        .where("storeId", "==", `${b}-annex`)
        .orderBy("createdAt", "desc").limit(50)],
  ["inventory: a product's history in one store", (db, b) =>
    db.collection("inventoryMovements").where("businessId", "==", b)
        .where("itemId", "==", `${b}-item`)
        .where("storeId", "==", `${b}-main`)
        .orderBy("createdAt", "desc").limit(50)],
  ["inventory: the two sides of a transfer", (db, b) =>
    db.collection("inventoryMovements").where("businessId", "==", b)
        .where("transferId", "==", "t1")],
  // Credit sales (v4) and the sales history.
  ["inventory: open credit", (db, b) =>
    db.collection("inventorySales").where("businessId", "==", b)
        .where("creditStatus", "==", "open").limit(500)],
  ["inventory: a store's open credit", (db, b) =>
    db.collection("inventorySales").where("businessId", "==", b)
        .where("storeId", "==", `${b}-annex`)
        .where("creditStatus", "==", "open").limit(500)],
  ["inventory: a sale's credit payments", (db, b) =>
    db.collection("inventoryCreditPayments").where("businessId", "==", b)
        .where("saleId", "==", `${b}-credit-main`)],
  ["inventory: a store sale's credit payments", (db, b) =>
    db.collection("inventoryCreditPayments").where("businessId", "==", b)
        .where("storeId", "==", `${b}-annex`)
        .where("saleId", "==", `${b}-credit-annex`)],
  ["inventory: sales in a period", (db, b) =>
    db.collection("inventorySales").where("businessId", "==", b)
        .where("createdAt", ">=", ts("2026-09-01"))
        .where("createdAt", "<", ts("2026-10-01"))
        .orderBy("createdAt", "desc").limit(1000)],
  ["inventory: a store's sales in a period", (db, b) =>
    db.collection("inventorySales").where("businessId", "==", b)
        .where("storeId", "==", `${b}-annex`)
        .where("createdAt", ">=", ts("2026-09-01"))
        .where("createdAt", "<", ts("2026-10-01"))
        .orderBy("createdAt", "desc").limit(1000)],
  ["inventory: stock movements in a period", (db, b) =>
    db.collection("inventoryMovements").where("businessId", "==", b)
        .where("createdAt", ">=", ts("2026-09-01"))
        .where("createdAt", "<", ts("2026-10-01"))
        .orderBy("createdAt", "desc").limit(500)],
  ["inventory: a store's stock movements in a period", (db, b) =>
    db.collection("inventoryMovements").where("businessId", "==", b)
        .where("storeId", "==", `${b}-annex`)
        .where("createdAt", ">=", ts("2026-09-01"))
        .where("createdAt", "<", ts("2026-10-01"))
        .orderBy("createdAt", "desc").limit(500)],
  ["inventory: credit payments in a period", (db, b) =>
    db.collection("inventoryCreditPayments").where("businessId", "==", b)
        .where("createdAt", ">=", ts("2026-09-01"))
        .where("createdAt", "<", ts("2026-10-01"))
        .orderBy("createdAt", "desc").limit(500)],
  ["inventory: a store's credit payments in a period", (db, b) =>
    db.collection("inventoryCreditPayments").where("businessId", "==", b)
        .where("storeId", "==", `${b}-annex`)
        .where("createdAt", ">=", ts("2026-09-01"))
        .where("createdAt", "<", ts("2026-10-01"))
        .orderBy("createdAt", "desc").limit(500)],
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

  describe("a multi-store business: staff see only their store", () => {
    // The three tables a store limits, as the clients ask for them.
    const SCOPED = [
      ["stock rows", (db, b, store) => {
        const q = db.collection("inventoryStock").where("businessId", "==", b);
        return store ? q.where("storeId", "==", store) : q;
      }],
      ["sales, newest first", (db, b, store) => {
        const q = db.collection("inventorySales").where("businessId", "==", b);
        return (store ? q.where("storeId", "==", store) : q)
            .orderBy("createdAt", "desc");
      }],
      ["a product's history", (db, b, store) => {
        const q = db.collection("inventoryMovements")
            .where("businessId", "==", b)
            .where("itemId", "==", `${b}-item`);
        return store ? q.where("storeId", "==", store) : q;
      }],
      ["open credit", (db, b, store) => {
        const q = db.collection("inventorySales").where("businessId", "==", b);
        return (store ? q.where("storeId", "==", store) : q)
            .where("creditStatus", "==", "open");
      }],
      ["credit payments in a period", (db, b, store) => {
        const q = db.collection("inventoryCreditPayments")
            .where("businessId", "==", b);
        return (store ? q.where("storeId", "==", store) : q)
            .where("createdAt", ">=", ts("2026-09-01"))
            .orderBy("createdAt", "desc");
      }],
      ["stock movements in a period", (db, b, store) => {
        const q = db.collection("inventoryMovements")
            .where("businessId", "==", b);
        return (store ? q.where("storeId", "==", store) : q)
            .where("createdAt", ">=", ts("2026-09-01"))
            .orderBy("createdAt", "desc");
      }],
    ];

    for (const [label, build] of SCOPED) {
      it(`${label}: scoped to the home store, refused otherwise`,
          async () => {
            const annex = "biz_a-annex";
            const staff = dbFor("staff-inv-annex");
            const mine = await assertSucceeds(build(staff, "biz_a", annex)
                .get());
            if (mine.size < 1) throw new Error("the home store's rows load");
            for (const row of mine.docs) {
              if (row.data().storeId !== annex) {
                throw new Error("a row of another store came back");
              }
            }
            await assertFails(build(staff, "biz_a", "biz_a-main").get());
            await assertFails(build(staff, "biz_a", null).get());
          });

      it(`${label}: no home store sees nothing, all-stores sees all`,
          async () => {
            await assertFails(build(dbFor("staff-inv-none"), "biz_a",
                "biz_a-annex").get());
            await assertFails(build(dbFor("staff-inv-none"), "biz_a", null)
                .get());
            const all = await assertSucceeds(build(dbFor("staff-inv-all"),
                "biz_a", null).get());
            const owner = await assertSucceeds(build(dbFor("owner-a"),
                "biz_a", null).get());
            const admin = await assertSucceeds(build(dbFor("platform-admin"),
                "biz_a", null).get());
            if (all.size < 2 || owner.size < 2 || admin.size < 2) {
              throw new Error("all stores load for the all-store roles");
            }
            await assertFails(build(dbFor("owner-b"), "biz_a", null).get());
          });
    }

    it("the shared lists stay readable by store staff", async () => {
      const staff = dbFor("staff-inv-none");
      for (const name of ["inventoryItems", "inventoryCategories",
        "inventoryBrands", "inventoryStores"]) {
        await assertSucceeds(staff.collection(name)
            .where("businessId", "==", "biz_a").get());
      }
    });
  });

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
