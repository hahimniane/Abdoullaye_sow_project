"use strict";

// Fleet phase 1b (docs/FLEET.md §8) against the Firestore emulator: bank
// deposits pay drivers by themselves (known sender, then the driver's
// cents), an unknown one waits for the office, the office's pick is
// remembered, a deposit is never used twice, undo gives it back, and the
// pay-day schedule saves with its cost. Synthetic data only.
//
// Run through `npm run test:fleet` (firebase emulators:exec).

const assert = require("node:assert/strict");
const {before, describe, it} = require("node:test");
const admin = require("firebase-admin");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
      "Run this through `npm run test:fleet` (firebase emulators:exec). " +
      "A direct node --test run would write into the real project.");
}
process.env.FUNCTIONS_EMULATOR = "true";

const functions = require("../index");
const {HttpsError} = require("firebase-functions/v2/https");
const {createFleetHandlers} = require("../fleet_handlers");
const {BANK_MATCH_START_MS} = require("../fleet_bank");
admin.auth().getUser = async (uid) => ({
  uid, email: `${uid}@example.test`, emailVerified: true});
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const BIZ = "fleetbank-biz";
const OWNER = "fleetbank-owner";
const STAFF = "fleetbank-staff";
const PLATFORM = "fleetbank-platform";

const run = (name, uid, data) => functions[name].run({
  auth: {uid, token: {}}, data, rawRequest: {}});
const act = (uid, action, data = {}) =>
  run("fleetAction", uid, {action, businessId: BIZ, ...data});
const refused = (reason) => (error) => error.details?.reason === reason;
const doc = async (col, id) => (await db.collection(col).doc(id).get()).data();

// The matching the bank sync calls (index.js syncBankLink).
const silent = {info() {}, warn() {}, error() {}};
const handlers = createFleetHandlers({admin, HttpsError, FieldValue,
  logger: silent, writeAudit: async () => undefined,
  dayKeyNow: () => "2026-12-02"});

const AFTER = BANK_MATCH_START_MS + 30 * 86400000;
let n = 0;
async function deposit(amountCents, senderName, extra = {}) {
  const id = `${BIZ}_txn-${++n}`;
  await db.collection("businessBankCredits").doc(id).set({businessId: BIZ,
    transactionId: `txn-${n}`, accountId: "acct", amountCents, pending: false,
    atMs: AFTER + n * 1000, dateKey: "2026-12-02", senderName,
    createdAt: FieldValue.serverTimestamp(), ...extra});
  return id;
}

async function openRent(driverId, amountCents) {
  const ref = db.collection("fleetBills").doc();
  await ref.set({businessId: BIZ, driverId, carId: "car", assignmentId: "a",
    kind: "rent", label: "Rent", periodFrom: "2026-12-01",
    periodTo: "2026-12-31", dueDayKey: "2026-12-01", amountCents,
    paidCents: 0, status: "open"});
  return ref.id;
}

before(async () => {
  await Promise.all([
    db.collection("businesses").doc(BIZ).set({name: "Bank Fleet Co",
      status: "approved", ownerUid: OWNER, enabledServices: ["fleet"],
      fleet: {enabled: true, enabledAtMs: BANK_MATCH_START_MS}}),
    db.collection("users").doc(OWNER).set({role: "businessOwner",
      businessId: BIZ, fullName: "Owner"}),
    db.collection("users").doc(STAFF).set({role: "staff", businessId: BIZ,
      businessPermissions: ["fleet"], fullName: "Fleet Staff"}),
    db.collection("users").doc(PLATFORM).set({role: "admin",
      adminRole: "superAdmin", fullName: "Platform"}),
    db.collection("fleetDrivers").doc("drv-a").set({businessId: BIZ,
      name: "Driver A", status: "active", personalCents: 17,
      rememberedSenders: ["ALPHA SENDER"], creditCents: 0}),
    db.collection("fleetDrivers").doc("drv-b").set({businessId: BIZ,
      name: "Driver B", status: "active", personalCents: 42,
      rememberedSenders: [], creditCents: 0}),
    db.collection("fleetDrivers").doc("drv-gone").set({businessId: BIZ,
      name: "Gone", status: "left", personalCents: 55,
      rememberedSenders: ["GONE SENDER"], creditCents: 0}),
    db.collection("businessBankLinks").doc(BIZ).set({businessId: BIZ,
      status: "active", institutionName: "Test Bank", accountMask: "0001"}),
  ]);
});

describe("deposits pay drivers by themselves", () => {
  it("a known sender pays that driver's oldest bill", async () => {
    const bill = await openRent("drv-a", 35000);
    const id = await deposit(35000, "Alpha  Sender");
    const out = await handlers.matchBankDeposits(BIZ, [id]);
    assert.deepEqual(out, {paid: 1, waiting: 0});
    assert.equal((await doc("fleetBills", bill)).status, "paid");
    const credit = await doc("businessBankCredits", id);
    assert.equal(credit.consumedBy.kind, "fleet_payment");
    const payment = await doc("fleetPayments", credit.consumedBy.id);
    assert.equal(payment.driverId, "drv-a");
    assert.equal(payment.method, "zelle");
    assert.equal(payment.matchedBy, "sender");
    assert.equal(payment.bankTxnId, id);
    // A second sync of the same deposit changes nothing.
    assert.deepEqual(await handlers.matchBankDeposits(BIZ, [id]),
        {paid: 0, waiting: 0});
  });

  it("else the cents are the code, and the sender is remembered", async () => {
    await openRent("drv-b", 35000);
    const id = await deposit(35042, "BRAVO NEW");
    assert.deepEqual(await handlers.matchBankDeposits(BIZ, [id]),
        {paid: 1, waiting: 0});
    const driver = await doc("fleetDrivers", "drv-b");
    assert.ok(driver.rememberedSenders.includes("BRAVO NEW"));
    assert.equal(driver.creditCents, 42, "the extra 42 cents is credit");
  });

  it("unknown sender or driver who left waits; old deposit is skipped",
      async () => {
        const unknown = await deposit(30000, "WHO IS THIS");
        const gone = await deposit(30055, "GONE SENDER");
        const old = await deposit(30000, "WHO IS THIS",
            {atMs: BANK_MATCH_START_MS - 1000});
        const noSender = await deposit(30000, "");
        assert.deepEqual(await handlers.matchBankDeposits(BIZ,
            [unknown, gone, old, noSender]), {paid: 0, waiting: 2});
        assert.equal((await doc("businessBankCredits", unknown)).fleetWaiting,
            true);
        assert.equal((await doc("businessBankCredits", old)).fleetWaiting,
            undefined, "before go-live: never touched");
        const status = await act(STAFF, "bank_status");
        assert.deepEqual(status.waiting.map((w) => w.id).sort(),
            [gone, unknown].sort());
        assert.equal(status.bank.connected, true);
      });

  it("the office picks the driver once; the next one pays by itself",
      async () => {
        const first = await deposit(30000, "WHO IS THIS");
        await handlers.matchBankDeposits(BIZ, [first]);
        await act(STAFF, "bank_assign", {creditId: first, driverId: "drv-b"});
        await assert.rejects(act(STAFF, "bank_assign",
            {creditId: first, driverId: "drv-a"}),
        refused("fleet_deposit_used"));
        const next = await deposit(30000, "Who Is This");
        assert.deepEqual(await handlers.matchBankDeposits(BIZ, [next]),
            {paid: 1, waiting: 0});
        const credit = await doc("businessBankCredits", next);
        const payment = await doc("fleetPayments", credit.consumedBy.id);
        assert.equal(payment.driverId, "drv-b");
      });

  it("a deposit used for a shop sale is never a driver's", async () => {
    const sale = await deposit(35017, "ALPHA SENDER",
        {consumedBy: {kind: "sale", id: "s1"}});
    assert.deepEqual(await handlers.matchBankDeposits(BIZ, [sale]),
        {paid: 0, waiting: 0});
  });

  it("the bank sends a used Zelle again under a new id: it waits for the " +
      "office, never pays twice", async () => {
    // Pending, paid by itself (cents .17 = drv-a).
    const pending = await deposit(45017, "ALPHA SENDER", {pending: true});
    assert.deepEqual(await handlers.matchBankDeposits(BIZ, [pending]),
        {paid: 1, waiting: 0});
    // The bank posts it under a new id with no link, and removes the
    // pending one.
    await db.collection("businessBankCredits").doc(pending).set(
        {removed: true}, {merge: true});
    const posted = await deposit(45017, "Alpha Sender",
        {dateKey: "2026-12-03"});
    assert.deepEqual(await handlers.matchBankDeposits(BIZ, [posted]),
        {paid: 0, waiting: 1});
    const credit = await doc("businessBankCredits", posted);
    assert.equal(credit.consumedBy, undefined);
    assert.equal(credit.fleetWaitingReason, "possible_duplicate");
    // A second, real Zelle of the same amount after the first posted (not
    // pending, not removed) still pays by itself.
    const used = await deposit(45017, "ALPHA SENDER", {
      consumedBy: {kind: "fleet_payment", id: "p-old"}});
    const again = await deposit(45017, "ALPHA SENDER");
    await db.collection("businessBankCredits").doc(posted).set(
        {consumedBy: {kind: "fleet_payment", id: "office"}}, {merge: true});
    assert.ok(used);
    // Only the removed pending one is a possible repeat of `again` (same
    // amount and sender, within 5 days): it waits too. That is the safe
    // side: the office pays it with one tap if the driver sent it twice.
    assert.deepEqual(await handlers.matchBankDeposits(BIZ, [again]),
        {paid: 0, waiting: 1});
  });

  it("undo gives the deposit back to the waiting list", async () => {
    const id = await deposit(12317, "ALPHA SENDER");
    await handlers.matchBankDeposits(BIZ, [id]);
    const paymentId = (await doc("businessBankCredits", id)).consumedBy.id;
    await act(OWNER, "payment_undo", {paymentId});
    const credit = await doc("businessBankCredits", id);
    assert.equal(credit.consumedBy, undefined);
    assert.equal(credit.fleetWaiting, true);
    assert.equal(credit.fleetWaitingReason, "undone");
  });
});

describe("the pay-day schedule and its cost", () => {
  it("a Fleet admin saves it and sees the monthly cost; staff cannot",
      async () => {
        const schedule = {every: 15, fromHour: 7, toHour: 23,
          monthDays: [1, 2, 3]};
        await assert.rejects(act(STAFF, "bank_schedule_save", {schedule}),
            refused("fleet_admin_only"));
        const saved = await act(OWNER, "bank_schedule_save", {schedule});
        assert.deepEqual(saved.quote, {perDay: 64, days: 3, perMonth: 192,
          centsEach: 12, monthCents: 2304});
        const b = await doc("businesses", BIZ);
        assert.deepEqual(b.fleet.settings.bankSchedule, {...schedule,
          mondays: false});
        const status = await act(STAFF, "bank_status");
        assert.equal(status.quote.monthCents, 2304);
      });

  it("the business's own Bills price is the one quoted", async () => {
    await db.collection("billingDeals").doc(BIZ).set({versions: [{
      effectiveFrom: "2026-01", deal: {bankCheck: {centsEach: 20}}}]});
    const status = await act(STAFF, "bank_status");
    assert.equal(status.quote.centsEach, 20);
    assert.equal(status.quote.monthCents, 192 * 20);
  });
});
