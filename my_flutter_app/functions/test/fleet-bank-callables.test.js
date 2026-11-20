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
      name: "Driver A", status: "active",
      rememberedSenders: ["ALPHA SENDER"], creditCents: 0}),
    db.collection("fleetDrivers").doc("drv-b").set({businessId: BIZ,
      name: "Driver B", status: "active",
      rememberedSenders: [], creditCents: 0}),
    db.collection("fleetDrivers").doc("drv-rep").set({businessId: BIZ,
      name: "Replaced Payer", status: "active",
      rememberedSenders: ["REPLACED SENDER"], creditCents: 0}),
    db.collection("fleetDrivers").doc("drv-gone").set({businessId: BIZ,
      name: "Gone", status: "left",
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

  it("the cents of an amount mean nothing: a stranger with a driver's " +
      "old cents waits", async () => {
    await openRent("drv-b", 35000);
    const id = await deposit(35042, "BRAVO NEW");
    assert.deepEqual(await handlers.matchBankDeposits(BIZ, [id]),
        {paid: 0, waiting: 1});
    assert.equal((await doc("businessBankCredits", id)).fleetWaitingReason,
        "unknown");
    assert.deepEqual((await doc("fleetDrivers", "drv-b")).rememberedSenders,
        []);
  });

  it("unknown sender or driver who left waits; old deposit is skipped",
      async () => {
        const unknown = await deposit(30000, "WHO IS THIS");
        const gone = await deposit(30055, "GONE SENDER");
        const old = await deposit(30000, "WHO IS THIS",
            {atMs: BANK_MATCH_START_MS - 1000});
        const noSender = await deposit(30000, "");
        // No sender's name: it waits too (cash paid in at the bank).
        assert.deepEqual(await handlers.matchBankDeposits(BIZ,
            [unknown, gone, old, noSender]), {paid: 0, waiting: 3});
        assert.equal((await doc("businessBankCredits", unknown)).fleetWaiting,
            true);
        assert.equal((await doc("businessBankCredits", gone))
            .fleetWaitingReason, "driver_left");
        assert.equal((await doc("businessBankCredits", old)).fleetWaiting,
            undefined, "before go-live: never touched");
        const status = await act(STAFF, "bank_status");
        assert.deepEqual(status.waiting.map((w) => w.id).sort(),
            [gone, unknown, noSender].sort());
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

  it("two bank notices in the same second: one payment, and the deposit " +
      "is not left on the waiting list", async () => {
    // Cents .17 = drv-a. Both runs see the deposit unused and try it.
    const id = await deposit(46017, "ALPHA SENDER");
    const before = (await db.collection("fleetPayments")
        .where("businessId", "==", BIZ).get()).size;
    const runs = await Promise.all([
      handlers.matchBankDeposits(BIZ, [id]),
      handlers.matchBankDeposits(BIZ, [id]),
    ]);
    assert.equal(runs[0].paid + runs[1].paid, 1, "paid once");
    assert.equal(runs[0].waiting + runs[1].waiting, 0, "never waiting");
    const after = (await db.collection("fleetPayments")
        .where("businessId", "==", BIZ).get()).size;
    assert.equal(after - before, 1, "one payment");
    const credit = await doc("businessBankCredits", id);
    assert.equal(credit.consumedBy.kind, "fleet_payment");
    assert.notEqual(credit.fleetWaiting, true);
  });

  it("a transfer from an account waits for the office whatever its cents, " +
      "and is never remembered as a sender", async () => {
    // Cents .17 are drv-a's code: a person's Zelle would pay drv-a.
    const id = await deposit(117, "360 Checking XXXXXXX2820");
    assert.deepEqual(await handlers.matchBankDeposits(BIZ, [id]),
        {paid: 0, waiting: 1});
    const waiting = await doc("businessBankCredits", id);
    assert.equal(waiting.consumedBy, undefined);
    assert.equal(waiting.fleetWaitingReason, "own_transfer");
    // The office may still use it for a driver; the account is not learned.
    await act(STAFF, "bank_assign", {creditId: id, driverId: "drv-a"});
    const driver = await doc("fleetDrivers", "drv-a");
    assert.ok(!(driver.rememberedSenders || [])
        .includes("360 CHECKING XXXXXXX2820"));
    const next = await deposit(217, "360 Checking XXXXXXX2820");
    assert.deepEqual(await handlers.matchBankDeposits(BIZ, [next]),
        {paid: 0, waiting: 1});
  });

  it("a card payout, cash or a check never pays by itself and is never " +
      "remembered", async () => {
    // Cents .42 are drv-b's code; the bank does not call it a Zelle.
    const payout = await deposit(123442, "STRIPE", {zelle: false});
    assert.deepEqual(await handlers.matchBankDeposits(BIZ, [payout]),
        {paid: 0, waiting: 1});
    assert.equal((await doc("businessBankCredits", payout))
        .fleetWaitingReason, "not_zelle");
    // A driver did pay cash at the bank: the office says so, once.
    await act(STAFF, "bank_assign", {creditId: payout, driverId: "drv-b"});
    const driver = await doc("fleetDrivers", "drv-b");
    assert.ok(!(driver.rememberedSenders || []).includes("STRIPE"));
    const next = await deposit(88800, "STRIPE", {zelle: false});
    assert.deepEqual(await handlers.matchBankDeposits(BIZ, [next]),
        {paid: 0, waiting: 1});
    // The app's own name is nobody's, even on a Zelle with a driver's cents.
    const app = await deposit(20042, "Zelle", {zelle: true});
    assert.deepEqual(await handlers.matchBankDeposits(BIZ, [app]),
        {paid: 0, waiting: 1});
  });

  it("a driver who left: their old payer waits for the office", async () => {
    await db.collection("fleetDrivers").doc("drv-left2").set({businessId: BIZ,
      name: "Left Two", status: "left", rememberedSenders: ["LEFT PAYER"],
      creditCents: 0});
    const id = await deposit(20077, "Left Payer");
    assert.deepEqual(await handlers.matchBankDeposits(BIZ, [id]),
        {paid: 0, waiting: 1});
    const credit = await doc("businessBankCredits", id);
    assert.equal(credit.consumedBy, undefined);
    assert.equal(credit.fleetWaitingReason, "driver_left");
  });

  it("a sender remembered for two active drivers waits (a husband paying " +
      "for two)", async () => {
    await Promise.all([
      db.collection("fleetDrivers").doc("drv-w1").set({businessId: BIZ,
        name: "Wife One", status: "active", creditCents: 0,
        rememberedSenders: ["HUSBAND PAYER"]}),
      db.collection("fleetDrivers").doc("drv-w2").set({businessId: BIZ,
        name: "Wife Two", status: "active", creditCents: 0,
        rememberedSenders: ["HUSBAND PAYER"]}),
    ]);
    const id = await deposit(30042, "Husband Payer");
    assert.deepEqual(await handlers.matchBankDeposits(BIZ, [id]),
        {paid: 0, waiting: 1});
    assert.equal((await doc("businessBankCredits", id)).fleetWaitingReason,
        "shared_payer");
  });

  it("undo forgets the sender, so the same wrong match does not repeat",
      async () => {
        const id = await deposit(21042, "WRONG PERSON");
        await handlers.matchBankDeposits(BIZ, [id]);
        await act(STAFF, "bank_assign", {creditId: id, driverId: "drv-b"});
        assert.ok((await doc("fleetDrivers", "drv-b")).rememberedSenders
            .includes("WRONG PERSON"));
        const paymentId = (await doc("businessBankCredits", id)).consumedBy.id;
        await act(OWNER, "payment_undo", {paymentId});
        assert.ok(!(await doc("fleetDrivers", "drv-b")).rememberedSenders
            .includes("WRONG PERSON"));
        const next = await deposit(30000, "WRONG PERSON");
        assert.deepEqual(await handlers.matchBankDeposits(BIZ, [next]),
            {paid: 0, waiting: 1});
      });

  it("undo after the bank replaced the pending deposit frees the posted " +
      "one", async () => {
    const pending = await deposit(22017, "REPLACED SENDER", {pending: true});
    assert.deepEqual(await handlers.matchBankDeposits(BIZ, [pending]),
        {paid: 1, waiting: 0});
    const used = (await doc("businessBankCredits", pending)).consumedBy;
    // What a sync writes when the posted copy arrives (bank_sync.js).
    const posted = `${BIZ}_txn-posted-1`;
    await db.collection("businessBankCredits").doc(posted).set({
      businessId: BIZ, transactionId: "txn-posted-1", accountId: "acct",
      amountCents: 22017, pending: false, atMs: AFTER + 5000,
      dateKey: "2026-12-02", senderName: "REPLACED SENDER",
      replacesTransactionId: pending.replace(`${BIZ}_`, ""),
      consumedBy: used, consumedByUid: "bank",
      createdAt: FieldValue.serverTimestamp()});
    await db.collection("businessBankCredits").doc(pending).set({
      removed: true, replacedByTransactionId: "txn-posted-1"}, {merge: true});
    await act(OWNER, "payment_undo", {paymentId: used.id});
    const live = await doc("businessBankCredits", posted);
    assert.equal(live.consumedBy, undefined, "the posted copy is free again");
    assert.equal(live.fleetWaiting, true);
    assert.equal(live.fleetWaitingReason, "undone");
    const old = await doc("businessBankCredits", pending);
    assert.equal(old.consumedBy, undefined);
    assert.notEqual(old.fleetWaiting, true, "the removed copy never waits");
    const status = await act(STAFF, "bank_status");
    assert.ok(status.waiting.some((w) => w.id === posted));
    // The office can now give it to the right driver.
    await act(STAFF, "bank_assign", {creditId: posted, driverId: "drv-b"});
  });

  it("undo after the extra already paid a later bill takes it back from " +
      "that bill; the credit never goes below zero", async () => {
    await db.collection("fleetDrivers").doc("drv-over").set({businessId: BIZ,
      name: "Over Payer", status: "active",
      rememberedSenders: [], creditCents: 0});
    const first = await openRent("drv-over", 30000);
    // $350 on a $300 bill: $50 becomes credit.
    const paid = await act(OWNER, "payment_record", {driverId: "drv-over",
      amountCents: 35000, method: "cash"});
    assert.equal(paid.creditAddedCents, 5000);
    // The daily job since: next month's bill took $30 of the credit.
    const next = db.collection("fleetBills").doc();
    await next.set({businessId: BIZ, driverId: "drv-over", carId: "car",
      assignmentId: "a", kind: "rent", label: "Rent", periodFrom: "2027-01-01",
      periodTo: "2027-01-31", dueDayKey: "2027-01-01", amountCents: 30000,
      paidCents: 3000, status: "open"});
    await db.collection("fleetDrivers").doc("drv-over")
        .update({creditCents: 2000});
    await act(OWNER, "payment_undo", {paymentId: paid.paymentId});
    const driver = await doc("fleetDrivers", "drv-over");
    assert.equal(driver.creditCents, 0, "not minus $30");
    assert.equal((await doc("fleetBills", first)).paidCents, 0);
    assert.equal((await doc("fleetBills", first)).status, "open");
    assert.equal((await doc("fleetBills", next.id)).paidCents, 0,
        "the $30 the credit paid is owed again");
    const payment = await doc("fleetPayments", paid.paymentId);
    assert.deepEqual(payment.creditTakenBack,
        [{billId: next.id, cents: 3000}]);
    // The driver owes both bills in full again: $600.
    const owed = (await db.collection("fleetBills")
        .where("driverId", "==", "drv-over").get()).docs
        .reduce((sum, d) => sum + d.get("amountCents") - d.get("paidCents"), 0);
    assert.equal(owed, 60000);
  });

  it("the bank takes back a deposit that paid a driver: the office is told " +
      "and decides", async () => {
    await openRent("drv-a", 40000);
    const id = await deposit(40017, "ALPHA SENDER");
    assert.deepEqual(await handlers.matchBankDeposits(BIZ, [id]),
        {paid: 1, waiting: 0});
    const paymentId = (await doc("businessBankCredits", id)).consumedBy.id;
    // What a sync does when the bank removes it for good (bank_sync.js).
    await db.collection("businessBankCredits").doc(id)
        .set({removed: true}, {merge: true});
    assert.equal(await handlers.noteRemovedDeposits(BIZ, [id]), 1);
    assert.equal(await handlers.noteRemovedDeposits(BIZ, [id]), 0, "once");
    const payment = await doc("fleetPayments", paymentId);
    assert.equal(payment.status, "recorded", "the payment still stands");
    assert.equal(payment.bankRemoved, true);
    let status = await act(STAFF, "bank_status");
    assert.deepEqual(status.removed.map((r) => [r.paymentId, r.driverId,
      r.amountCents, r.senderName]),
    [[paymentId, "drv-a", 40017, "ALPHA SENDER"]]);
    // Only a Fleet admin decides; "keep" clears the notice, nothing else.
    await assert.rejects(act(STAFF, "bank_removed_keep", {paymentId}),
        refused("fleet_admin_only"));
    await act(OWNER, "bank_removed_keep", {paymentId});
    status = await act(STAFF, "bank_status");
    assert.deepEqual(status.removed, []);
    assert.equal((await doc("fleetPayments", paymentId)).status, "recorded");
    // A deposit that paid nobody, or another business's, marks nothing.
    const free = await deposit(5000, "NOBODY KNOWN");
    assert.equal(await handlers.noteRemovedDeposits(BIZ, [free, "x_y"]), 0);
  });

  it("an undone payment whose deposit the bank removed is no longer listed",
      async () => {
        const id = await deposit(21117, "ALPHA SENDER");
        await handlers.matchBankDeposits(BIZ, [id]);
        const paymentId = (await doc("businessBankCredits", id)).consumedBy.id;
        await db.collection("businessBankCredits").doc(id)
            .set({removed: true}, {merge: true});
        await handlers.noteRemovedDeposits(BIZ, [id]);
        await act(OWNER, "payment_undo", {paymentId});
        const status = await act(STAFF, "bank_status");
        assert.equal(status.removed.some((r) => r.paymentId === paymentId),
            false);
        // The removed deposit does not come back as waiting.
        assert.equal(status.waiting.some((w) => w.id === id), false);
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
