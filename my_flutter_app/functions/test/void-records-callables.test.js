"use strict";

// Voiding a parked car (updateBusinessParkingEntry action "void"), voiding an
// expense line (voidLotExpenseEntry {lineId}) and stopping a line after a
// month (upsertLotExpenseLine action "setEndMonth") against the Firestore
// emulator. Records are never deleted: a void only marks them.
//
// Run through `npm run test:lot-ledger` (firebase emulators:exec).

const assert = require("node:assert/strict");
const {before, describe, it} = require("node:test");
const admin = require("firebase-admin");

// This suite writes with ADMIN credentials: never against a real project.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
      "Run this through `npm run test:lot-ledger` (firebase " +
      "emulators:exec). A direct node --test run would write its fixtures " +
      "into the real project.");
}

process.env.FUNCTIONS_EMULATOR = "true";

const functions = require("../index");
admin.auth().getUser = async (uid) => ({
  uid,
  email: `${uid}@example.test`,
  emailVerified: true,
});
const db = admin.firestore();
const {Timestamp} = admin.firestore;

const BIZ = "void-biz";
const OTHER_BIZ = "void-other-biz";
const OWNER = "void-owner";
const PARKING_STAFF = "void-parking-staff";
const LEDGER_STAFF = "void-ledger-staff";
const OTHER_OWNER = "void-other-owner";

const run = (name, uid, data) => functions[name].run({
  auth: {uid, token: {}}, data,
});

const refusal = (code, reason) => (error) => {
  assert.equal(error.code, code, error.message);
  assert.equal(error.details?.reason, reason, error.message);
  return true;
};

let seq = 0;
/**
 * Seeds a business-entered parked car occupying the lot for October 2026.
 *
 * @param {object} overrides Fields to change.
 * @return {Promise<string>} Its id.
 */
async function seedCar(overrides = {}) {
  seq += 1;
  const ref = db.collection("parkedCars").doc(`void-car-${seq}`);
  await ref.set({
    businessId: BIZ,
    source: "business",
    enteredByBusiness: true,
    trackingCode: `PK-VOID${seq}`,
    status: "reserved",
    customerName: "Alimou Barry",
    customerPhone: "+12015551234",
    carMake: "Toyota",
    carModel: "Camry",
    carYear: "2018",
    vinNumber: "1HGCM82633A004352",
    paymentMethod: "direct",
    paymentStatus: "awaiting_direct_payment",
    dailyRate: 10,
    dailyRateCents: 1000,
    amountDue: 100,
    amountDueCents: 10000,
    totalCost: 100,
    totalCostCents: 10000,
    amountPaidCents: 0,
    parkingDate: Timestamp.fromDate(new Date("2026-10-01T12:00:00Z")),
    parkingEndDate: Timestamp.fromDate(new Date("2026-10-10T12:00:00Z")),
    occupancyEndMs: new Date("2026-10-10T12:00:00Z").getTime(),
    ...overrides,
  });
  return ref.id;
}

const car = async (id) => (await db.collection("parkedCars").doc(id).get())
    .data();

async function auditFor(entityId) {
  const snap = await db.collection("lotLedgerAudit")
      .where("entityId", "==", entityId).get();
  return snap.docs.map((doc) => doc.data());
}

describe("void a parked car", () => {
  before(async () => {
    await Promise.all([
      db.collection("businesses").doc(BIZ).set({
        name: "Void Lot", status: "approved", ownerUid: OWNER,
        enabledServices: ["carParking"],
        parkingTotalSpaces: 1, parkingBlockedSpaces: 0,
        parkingDailyRate: 10,
      }),
      db.collection("businesses").doc(OTHER_BIZ).set({
        name: "Other Lot", status: "approved", ownerUid: OTHER_OWNER,
        enabledServices: ["carParking"],
      }),
      db.collection("users").doc(OWNER).set({
        role: "businessOwner", businessId: BIZ, fullName: "Owner Person",
        email: "void-owner@example.test",
      }),
      db.collection("users").doc(OTHER_OWNER).set({
        role: "businessOwner", businessId: OTHER_BIZ, fullName: "Other",
        email: "void-other-owner@example.test",
      }),
      db.collection("users").doc(PARKING_STAFF).set({
        role: "staff", businessId: BIZ, businessPermissions: ["parking"],
        fullName: "Mamadou Diallo", email: "void-parking@example.test",
      }),
      db.collection("users").doc(LEDGER_STAFF).set({
        role: "staff", businessId: BIZ, businessPermissions: ["ledger"],
        fullName: "Fatou Camara", email: "void-ledger@example.test",
      }),
    ]);
  });

  it("voids with who and why, keeps the record and audits it", async () => {
    const id = await seedCar();
    const result = await run("updateBusinessParkingEntry", PARKING_STAFF,
        {entryId: id, action: "void", reason: "  entered twice "});
    assert.deepEqual(result, {success: true, entryId: id, voided: true});
    const stored = await car(id);
    assert.equal(stored.voided, true);
    assert.equal(stored.voidedByStaffId, PARKING_STAFF);
    assert.equal(stored.voidReason, "entered twice");
    assert.ok(stored.voidedAt, "when it was voided");
    assert.equal(stored.status, "reserved", "status is not rewritten");
    assert.equal(stored.customerName, "Alimou Barry", "nothing else moved");
    const audit = await auditFor(id);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].entityType, "parking");
    assert.equal(audit[0].action, "voided");
    assert.equal(audit[0].summary, "Voided — entered twice");
    assert.equal(audit[0].byStaffId, PARKING_STAFF);
  });

  it("refuses a second void, a missing car and another business",
      async () => {
        const id = await seedCar();
        await run("updateBusinessParkingEntry", OWNER,
            {entryId: id, action: "void"});
        await assert.rejects(run("updateBusinessParkingEntry", OWNER,
            {entryId: id, action: "void"}),
        refusal("failed-precondition", "car_voided"));
        await assert.rejects(run("updateBusinessParkingEntry", OWNER,
            {entryId: "void-no-such-car", action: "void"}),
        refusal("not-found", "car_not_found"));
        const mine = await seedCar();
        await assert.rejects(run("updateBusinessParkingEntry", OTHER_OWNER,
            {entryId: mine, action: "void"}),
        (error) => error.code === "permission-denied");
        assert.notEqual((await car(mine)).voided, true);
      });

  it("needs the parking permission", async () => {
    const id = await seedCar();
    await assert.rejects(run("updateBusinessParkingEntry", LEDGER_STAFF,
        {entryId: id, action: "void"}),
    (error) => error.code === "permission-denied");
    assert.notEqual((await car(id)).voided, true);
  });

  it("cancels an unpaid payment link with it", async () => {
    const id = await seedCar({
      paymentMethod: "payment_link", paymentStatus: "pending",
      checkoutSessionId: "cs_test_void", paymentLinkToken: "tok_void_1234567",
    });
    await run("updateBusinessParkingEntry", OWNER,
        {entryId: id, action: "void", reason: "test"});
    const stored = await car(id);
    assert.equal(stored.voided, true);
    assert.ok(stored.paymentLinkCancelledAt, "the link is cancelled");
    assert.equal(stored.paymentLinkCancelledByUid, OWNER);
    assert.equal(stored.checkoutStatus, "cancelled");
    // Cancel link afterwards finds it already cancelled.
    const again = await run("cancelBusinessParkingPaymentLink", OWNER,
        {entryId: id});
    assert.equal(again.alreadyCancelled, true);
  });

  it("keeps a paid car's payment on the record", async () => {
    const id = await seedCar({paymentStatus: "paid", amountPaidCents: 10000,
      directPaymentReceived: true});
    await run("updateBusinessParkingEntry", OWNER,
        {entryId: id, action: "void"});
    const stored = await car(id);
    assert.equal(stored.voided, true);
    assert.equal(stored.amountPaidCents, 10000);
    assert.equal(stored.paymentStatus, "paid");
    assert.equal(stored.paymentLinkCancelledAt, undefined);
  });

  it("refuses edit, payments, close and links after the void", async () => {
    const id = await seedCar();
    await run("updateBusinessParkingEntry", OWNER,
        {entryId: id, action: "void"});
    const voided = refusal("failed-precondition", "car_voided");
    await assert.rejects(run("updateBusinessParkingEntry", OWNER,
        {entryId: id, changes: {customerName: "Someone Else"}}), voided);
    await assert.rejects(run("markBusinessParkingPaid", OWNER,
        {entryId: id, receivedVia: "cash"}), voided);
    await assert.rejects(run("recordBusinessParkingPartialPayment", OWNER,
        {entryId: id, amountCents: 1000, receivedVia: "cash",
          receivedByStaffId: OWNER}), voided);
    await assert.rejects(run("revertBusinessParkingPaid", OWNER,
        {entryId: id}), voided);
    await assert.rejects(run("resendBusinessParkingPaymentLink", OWNER,
        {entryId: id}), voided);
    await assert.rejects(run("recordParkingPaymentReceived", OWNER,
        {parkedCarId: id, amountCents: 1000, receivedByStaffId: OWNER}),
    voided);
    await assert.rejects(run("closeParkingStay", OWNER,
        {parkedCarId: id, endDate: "2026-10-12"}), voided);
    await assert.rejects(run("billParkingThroughToday", OWNER,
        {parkedCarId: id}), voided);
    assert.equal((await car(id)).customerName, "Alimou Barry");
  });

  it("frees its space", async () => {
    // Weeks ahead, so no other test's October car overlaps; the lot has
    // one space.
    const far = new Date(Date.now() + 40 * 86400000);
    const farEnd = new Date(far.getTime() + 3 * 86400000);
    const id = await seedCar({
      parkingDate: Timestamp.fromDate(far),
      parkingEndDate: Timestamp.fromDate(farEnd),
      occupancyEndMs: farEnd.getTime()});
    const entry = {
      businessId: BIZ, customerName: "Second Car",
      customerPhone: "+12015559876", carMake: "Honda", carModel: "Civic",
      carYear: "2019", paymentMethod: "direct",
      startDate: far.toISOString().slice(0, 10),
      endDate: farEnd.toISOString().slice(0, 10),
    };
    await assert.rejects(run("createBusinessParkingEntry", OWNER, entry),
        /No parking spaces/);
    await run("updateBusinessParkingEntry", OWNER,
        {entryId: id, action: "void"});
    const created = await run("createBusinessParkingEntry", OWNER, entry);
    assert.equal(created.success, true, "the voided car freed its space");
  });

  it("is in no parking total", async () => {
    const lot = "void-totals-biz";
    await db.collection("businesses").doc(lot).set({
      name: "Totals Lot", status: "approved", ownerUid: "void-totals-owner",
      enabledServices: ["carParking"], parkingTotalSpaces: 5,
    });
    await db.collection("users").doc("void-totals-owner").set({
      role: "businessOwner", businessId: lot, fullName: "Totals Owner",
      email: "void-totals@example.test",
    });
    const id = await seedCar({businessId: lot, parkingEndDate: null,
      occupancyEndMs: 8640000000000000, amountPaidCents: 2000});
    const totals = async () => (await run("getParkingTotals",
        "void-totals-owner", {businessId: lot, year: 2026, refresh: true,
          timeZone: "UTC"})).parking.totals;
    const live = await totals();
    assert.equal(live.inLot, 1);
    assert.equal(live.collected, 20);
    await run("updateBusinessParkingEntry", "void-totals-owner",
        {entryId: id, action: "void"});
    const after = await totals();
    assert.equal(after.inLot, 0);
    assert.equal(after.collected, 0);
    assert.equal(after.owed, 0);
    assert.equal(after.spacesUsed, 0);
  });
});

describe("void and stop an expense line", () => {
  const line = async (fields = {}) => {
    seq += 1;
    const ref = db.collection("lotExpenseLines").doc(`void-line-${seq}`);
    await ref.set({businessId: BIZ, label: "Royal Waste", kind: "fixed",
      recurringCents: 2000, active: true, sortOrder: 0,
      createdAt: Timestamp.fromDate(new Date("2026-01-10T12:00:00Z")),
      ...fields});
    return ref.id;
  };
  const purchase = async (lineId, fields = {}) => {
    seq += 1;
    await db.collection("lotExpenseEntries").doc(`void-entry-${seq}`).set({
      businessId: BIZ, lineId, month: "2026-10", amountCents: 2000,
      paidByStaffId: OWNER, ...fields});
    return `void-entry-${seq}`;
  };
  const stored = async (id) =>
    (await db.collection("lotExpenseLines").doc(id).get()).data();

  it("voids a line with who and why, and audits it", async () => {
    const id = await line();
    const result = await run("voidLotExpenseEntry", LEDGER_STAFF,
        {lineId: id, reason: "test line"});
    assert.deepEqual(result, {success: true, lineId: id});
    const row = await stored(id);
    assert.equal(row.voided, true);
    assert.equal(row.active, false);
    assert.equal(row.voidedByStaffId, LEDGER_STAFF);
    assert.equal(row.voidReason, "test line");
    assert.ok(row.voidedAt);
    assert.equal(row.label, "Royal Waste", "kept on the record");
    const [audit] = await auditFor(id);
    assert.equal(audit.entityType, "expense_line");
    assert.equal(audit.action, "voided");
    assert.equal(audit.summary, "Voided — test line");
  });

  it("refuses again, missing, without permission and over purchases",
      async () => {
        const id = await line();
        await run("voidLotExpenseEntry", OWNER, {lineId: id});
        await assert.rejects(run("voidLotExpenseEntry", OWNER, {lineId: id}),
            refusal("failed-precondition", "line_voided"));
        await assert.rejects(run("voidLotExpenseEntry", OWNER,
            {lineId: "void-no-such-line"}),
        refusal("not-found", "line_not_found"));
        const guarded = await line();
        await assert.rejects(run("voidLotExpenseEntry", PARKING_STAFF,
            {lineId: guarded}), (error) => error.code === "permission-denied");
        const busy = await line();
        const entryId = await purchase(busy);
        await assert.rejects(run("voidLotExpenseEntry", OWNER,
            {lineId: busy}), (error) => {
          refusal("failed-precondition", "line_has_purchases")(error);
          assert.equal(error.message, "Void this line's purchases first.");
          return true;
        });
        // Once the purchase is voided, the line can go.
        await run("voidLotExpenseEntry", OWNER, {entryId});
        await run("voidLotExpenseEntry", OWNER, {lineId: busy});
        assert.equal((await stored(busy)).voided, true);
        // A voided line takes no edit and no purchase.
        await assert.rejects(run("upsertLotExpenseLine", OWNER, {
          businessId: BIZ, lineId: busy, label: "Back", kind: "fixed",
          recurringCents: 100}), refusal("failed-precondition",
            "line_voided"));
        await assert.rejects(run("createLotExpenseEntry", OWNER, {
          businessId: BIZ, lineId: busy, month: "2026-11",
          amountCents: 500, spentAt: "2026-11-02", paidByStaffId: OWNER}),
        refusal("failed-precondition", "line_voided"));
      });

  it("stops after a month, refuses bad months, and resumes", async () => {
    const id = await line();
    await purchase(id, {month: "2026-09"});
    const stop = await run("upsertLotExpenseLine", LEDGER_STAFF,
        {businessId: BIZ, lineId: id, action: "setEndMonth",
          endMonth: "2026-10"});
    assert.deepEqual(stop, {success: true, lineId: id, endMonth: "2026-10"});
    assert.equal((await stored(id)).endMonth, "2026-10");
    // A purchase after the last month is refused.
    await assert.rejects(run("createLotExpenseEntry", OWNER, {
      businessId: BIZ, lineId: id, month: "2026-11", amountCents: 500,
      spentAt: "2026-11-02", paidByStaffId: OWNER}),
    refusal("failed-precondition", "line_stopped"));
    await assert.rejects(run("upsertLotExpenseLine", OWNER,
        {businessId: BIZ, lineId: id, action: "setEndMonth",
          endMonth: "2026-13"}),
    refusal("failed-precondition", "end_month_invalid"));
    await assert.rejects(run("upsertLotExpenseLine", OWNER,
        {businessId: BIZ, lineId: id, action: "setEndMonth",
          endMonth: "2026-08"}), (error) => {
      refusal("failed-precondition", "end_month_before_purchases")(error);
      assert.equal(error.message,
          "This line has purchases after that month.");
      return true;
    });
    await assert.rejects(run("upsertLotExpenseLine", PARKING_STAFF,
        {businessId: BIZ, lineId: id, action: "setEndMonth", endMonth: ""}),
    (error) => error.code === "permission-denied");
    // A full edit keeps the stop.
    await run("upsertLotExpenseLine", OWNER, {businessId: BIZ, lineId: id,
      label: "Royal Waste Inc", kind: "fixed", recurringCents: 2500});
    assert.equal((await stored(id)).endMonth, "2026-10");
    const resume = await run("upsertLotExpenseLine", OWNER,
        {businessId: BIZ, lineId: id, action: "setEndMonth", endMonth: ""});
    assert.equal(resume.endMonth, "");
    assert.equal((await stored(id)).endMonth, "");
    const summaries = (await auditFor(id)).map((row) => row.summary);
    assert.ok(summaries.includes("Stopped after October 2026"),
        JSON.stringify(summaries));
    assert.ok(summaries.includes("Resumed"));
  });

  it("totals skip a voided line and a stopped line's later months",
      async () => {
        const lot = "void-ledger-totals-biz";
        const owner = "void-ledger-totals-owner";
        await db.collection("businesses").doc(lot).set({
          name: "Ledger Lot", status: "approved", ownerUid: owner,
          enabledServices: ["carParking"],
        });
        await db.collection("users").doc(owner).set({
          role: "businessOwner", businessId: lot, fullName: "Ledger Owner",
          email: "void-ledger-totals@example.test",
        });
        const base = {businessId: lot, kind: "fixed", recurringCents: 2000,
          active: true, label: "Bill",
          createdAt: Timestamp.fromDate(new Date("2026-01-10T12:00:00Z"))};
        await db.collection("lotExpenseLines").doc("void-tot-live")
            .set({...base});
        await db.collection("lotExpenseLines").doc("void-tot-voided")
            .set({...base, voided: true, active: false});
        await db.collection("lotExpenseLines").doc("void-tot-stopped")
            .set({...base, endMonth: "2026-10"});
        const month = async (m) => (await run("getLotLedgerTotals", owner, {
          businessId: lot, month: m, year: 2026, rangeStart: m, rangeEnd: m,
          nowMonth: "2026-12", timeZone: "UTC", refresh: true,
        })).ledger.monthExpenseCents;
        assert.equal(await month("2026-10"), 4000, "live + stopped");
        assert.equal(await month("2026-11"), 2000, "live only");
      });
});
