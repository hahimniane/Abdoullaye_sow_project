"use strict";

const assert = require("node:assert/strict");
const {before, describe, it} = require("node:test");
const admin = require("firebase-admin");

// Laawol bills against the Firestore and Auth emulators (docs/
// PLATFORM_BILLING.md): who may read and change bills, deal versions and
// the month each is billed with, the bill read from real records (Volume
// rollups, the month's lines for package prices, parked cars, shop sales,
// commission), payments, close / drift / reopen, the commission
// keep / replace switch over the business's own fee fields, and that the
// all-business table only lists businesses with a deal or activity.
//
// Writes with ADMIN credentials, so it refuses to run outside the emulator.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
      "Run this through `npm run test:billing` (firebase emulators:exec). " +
      "A direct node --test run would write its fixtures into the " +
      "real project.");
}

process.env.FUNCTIONS_EMULATOR = "true";

const functions = require("../index");
const {currentMonthKey, shiftMonth} = require("../volume_counts");
const {zonedDayKey} = require("../console_summaries");

const db = admin.firestore();
const {Timestamp, FieldValue} = admin.firestore;

const BIZ = "bill-test-biz";
const BIZ_B = "bill-test-other";
const BIZ_IDLE = "bill-test-idle";
const BIZ_NOFEE = "bill-test-nofee";
const OWNER = "bill-test-owner";
const SUPER = "bill-test-super";
const FINANCE = "bill-test-finance";
const SUPPORT = "bill-test-support";

const CUR = currentMonthKey(new Date());
const PREV = shiftMonth(CUR, -1);
const PREV2 = shiftMonth(CUR, -2);
const TODAY = zonedDayKey(new Date(), "America/New_York");
const at = (iso) => Timestamp.fromDate(new Date(iso));

const call = (data, uid = SUPER) => functions.platformBilling.run({
  auth: {uid, token: {email_verified: true}}, data});

const refusedWith = (code) => (error) => {
  assert.ok(Array.isArray(error.details?.reasons),
      `no reasons on ${error.code}: ${error.message}`);
  assert.ok(error.details.reasons.includes(code),
      `${code} not in ${JSON.stringify(error.details.reasons)}`);
  return true;
};

const V1 = {barrel: {centsEach: 500}, package: {mode: "fixed",
  centsEach: 100}, minimumCents: 5000};
const V2 = {barrel: {centsEach: 500}, package: {mode: "percent", bps: 500,
  minCents: 100}, parking: {mode: "perCar", centsEach: 1000},
itemSold: {centsEach: 25}, flatCents: 2000};

let firstPaymentId = "";
let secondPaymentId = "";

before(async () => {
  await Promise.all([SUPER, FINANCE, SUPPORT].map((uid) =>
    admin.auth().createUser({uid, email: `${uid}@example.test`,
      password: "BillsAdmin-2026!", emailVerified: true})));
  const lines = db.collection("containerLines");
  await Promise.all([
    db.collection("users").doc(SUPER).set({role: "admin",
      platformAdmin: true, adminRole: "superAdmin", fullName: "Sam Super"}),
    db.collection("users").doc(FINANCE).set({role: "admin",
      platformAdmin: true, adminRole: "financeManager"}),
    db.collection("users").doc(SUPPORT).set({role: "admin",
      platformAdmin: true, adminRole: "supportAdmin"}),
    db.collection("users").doc(OWNER).set({role: "businessOwner",
      businessId: BIZ}),
    db.collection("businesses").doc(BIZ).set({name: "Conakry Express",
      status: "approved", ownerUid: OWNER,
      enabledServices: ["barrelShipping", "carParking", "inventory"],
      platformFeePct: 0.08,
      servicePlatformFeePct: {parkingPlatformFeePct: 0.05}}),
    db.collection("businesses").doc(BIZ_B).set({name: "Dakar Cargo",
      status: "approved", enabledServices: ["carParking"]}),
    db.collection("businesses").doc(BIZ_IDLE).set({name: "Idle Shop",
      status: "approved", enabledServices: ["inventory"]}),
    db.collection("businesses").doc(BIZ_NOFEE).set({name: "No Fee Lot",
      status: "approved", enabledServices: ["carParking"]}),
    // Volume rollups (what the triggers would have counted).
    db.collection("volumeMonthly").doc(`${BIZ}_${PREV}`).set({
      businessId: BIZ, month: PREV, barrels: 10, packages: 87, cars: 2,
      pieces: 99, complete: true}),
    db.collection("volumeMonthly").doc(`${BIZ}_${PREV2}`).set({
      businessId: BIZ, month: PREV2, barrels: 4, packages: 10, cars: 0,
      pieces: 14, complete: true}),
    db.collection("volumeMonthly").doc(`${BIZ_B}_${PREV}`).set({
      businessId: BIZ_B, month: PREV, barrels: 5, packages: 0, cars: 0,
      pieces: 5, complete: true}),
    // The month's lines, for package prices: a box at $40 and a bag with
    // no price; a legacy line of 2 at $30 (spread $15 each); a barrel; and
    // a line received the month before (not this month's).
    lines.doc("bill-line-1").set({businessId: BIZ, kind: "other",
      rootLineId: "bill-line-1", receivedAt: at(`${PREV}-05T15:00:00Z`),
      createdAt: at(`${PREV}-05T15:00:00Z`), pieces: [
        {id: "p1", kind: "box", description: "TV", priceCents: 4000},
        {id: "p2", kind: "other", description: "Bag", priceCents: null}],
      packagePieces: 2, barrelPieces: 0, carPieces: 0}),
    lines.doc("bill-line-2").set({businessId: BIZ, kind: "other",
      quantity: 2, priceCents: 3000, description: "Shoes",
      createdAt: at(`${PREV}-09T15:00:00Z`)}),
    lines.doc("bill-line-3").set({businessId: BIZ, kind: "barrels",
      rootLineId: "bill-line-3", receivedAt: at(`${PREV}-10T15:00:00Z`),
      pieces: [{id: "p1", kind: "barrel", priceCents: 9000}]}),
    lines.doc("bill-line-4").set({businessId: BIZ, kind: "other",
      rootLineId: "bill-line-4", receivedAt: at(`${PREV2}-20T15:00:00Z`),
      pieces: [{id: "p1", kind: "box", description: "Old",
        priceCents: 100000}]}),
    // Parked cars: one ten-day stay in the month, one that started the
    // month before and left on the 4th, one that left before the month.
    db.collection("parkedCars").doc("bill-car-1").set({businessId: BIZ,
      parkingDate: `${PREV}-03`, parkingEndDate: `${PREV}-12`,
      totalCostCents: 30000, status: "active", paymentMethod: "direct",
      occupancyEndMs: Date.parse(`${PREV}-12`)}),
    db.collection("parkedCars").doc("bill-car-2").set({businessId: BIZ,
      parkingDate: `${PREV2}-25`, parkingEndDate: `${PREV}-04`,
      totalCostCents: 12000, status: "active", paymentMethod: "direct",
      occupancyEndMs: Date.parse(`${PREV}-04`)}),
    db.collection("parkedCars").doc("bill-car-3").set({businessId: BIZ,
      parkingDate: `${PREV2}-01`, parkingEndDate: `${PREV2}-05`,
      totalCostCents: 5000, status: "active", paymentMethod: "direct",
      occupancyEndMs: Date.parse(`${PREV2}-05`)}),
    // Shop sales: 3 + 2 items count; a voided sale and another month's
    // sale do not.
    db.collection("inventorySales").doc("bill-sale-1").set({businessId: BIZ,
      createdAt: at(`${PREV}-11T16:00:00Z`), voided: false, totalCents: 1500,
      lines: [{itemId: "i1", quantity: 3, soldPriceCents: 500}]}),
    db.collection("inventorySales").doc("bill-sale-2").set({businessId: BIZ,
      createdAt: at(`${PREV}-21T16:00:00Z`), voided: false, totalCents: 800,
      lines: [{itemId: "i2", quantity: 2, soldPriceCents: 400}]}),
    db.collection("inventorySales").doc("bill-sale-3").set({businessId: BIZ,
      createdAt: at(`${PREV}-22T16:00:00Z`), voided: true, totalCents: 900,
      lines: [{itemId: "i2", quantity: 9, soldPriceCents: 100}]}),
    db.collection("inventorySales").doc("bill-sale-4").set({businessId: BIZ,
      createdAt: at(`${PREV2}-22T16:00:00Z`), voided: false,
      totalCents: 100, lines: [{itemId: "i2", quantity: 7,
        soldPriceCents: 100}]}),
    // Commission Laawol took on a card payment in the month: $20.
    db.collection("barrelShipments").doc("bill-ship-1").set({
      businessId: BIZ, totalCents: 20000, platformFeeCents: 2000,
      paymentStatus: "succeeded", paidAt: at(`${PREV}-08T15:00:00Z`)}),
  ]);
});

describe("Laawol bills", () => {
  it("lets finance read, super admins change, nobody else in", async () => {
    for (const uid of [SUPPORT, OWNER]) {
      await assert.rejects(call({action: "getMonthBills", month: PREV}, uid),
          refusedWith("billing_view_required"));
    }
    const view = await call({action: "getMonthBills", month: PREV},
        FINANCE);
    assert.equal(view.canManage, false);
    for (const action of ["saveDeal", "recordPayment", "closeMonth",
      "reopenMonth", "setCommissionMode", "voidPayment"]) {
      await assert.rejects(call({action, businessId: BIZ, month: PREV,
        deal: V1}, FINANCE), refusedWith("billing_manage_required"));
    }
    await assert.rejects(call({action: "dropTables"}, FINANCE),
        refusedWith("action_invalid"));
    await assert.rejects(call({action: "getMonthBills", month: "Oct"},
        FINANCE), refusedWith("month_invalid"));
  });

  it("refuses a bad deal with every reason", async () => {
    await assert.rejects(call({action: "saveDeal", businessId: BIZ,
      effectiveFrom: PREV, deal: {barrel: {centsEach: 0},
        minimumCents: 5000, capCents: 100}}),
    (error) => refusedWith("amount_invalid")(error) &&
      refusedWith("minimum_above_cap")(error));
    await assert.rejects(call({action: "saveDeal", businessId: BIZ,
      effectiveFrom: shiftMonth(CUR, -30), deal: V1}),
    refusedWith("effective_month_out_of_range"));
    await assert.rejects(call({action: "saveDeal", businessId: "nope",
      effectiveFrom: PREV, deal: V1}), refusedWith("business_not_found"));
    await assert.rejects(call({action: "saveDeal", businessId: "a/b",
      effectiveFrom: PREV, deal: V1}), refusedWith("business_invalid"));
  });

  it("bills each month with the deal in effect then", async () => {
    const v1 = await call({action: "saveDeal", businessId: BIZ,
      effectiveFrom: PREV2, deal: V1, note: "First deal"});
    const v2 = await call({action: "saveDeal", businessId: BIZ,
      effectiveFrom: PREV, deal: V2});
    assert.notEqual(v1.versionId, v2.versionId);

    const old = await call({action: "getBusinessBill", businessId: BIZ,
      month: PREV2}, FINANCE);
    assert.equal(old.dealVersionId, v1.versionId);
    // 4 barrels x $5 + 10 packages x $1 = $30, raised to the $50 minimum.
    assert.equal(old.bill.chargesCents, 3000);
    assert.equal(old.bill.minimumAdjustmentCents, 2000);
    assert.equal(old.amountCents, 5000);

    const bill = await call({action: "getBusinessBill", businessId: BIZ,
      month: PREV}, FINANCE);
    assert.equal(bill.dealVersionId, v2.versionId);
    assert.equal(bill.status, "open");
    assert.equal(bill.complete, true);
    const lines = Object.fromEntries(bill.bill.lines.map((l) =>
      [l.key, l]));
    assert.equal(lines.barrels.cents, 5000);
    // $40 -> $2.00; no price -> $1 minimum; two $15 -> 75c each -> $1 each.
    assert.equal(lines.packages.quantity, 4);
    assert.equal(lines.packages.noPriceCount, 1);
    assert.equal(lines.packages.cents, 500);
    assert.equal(lines.parking.quantity, 2);
    assert.equal(lines.parking.cents, 2000);
    assert.equal(lines.itemsSold.quantity, 5);
    assert.equal(lines.itemsSold.cents, 125);
    assert.equal(bill.bill.flatCents, 2000);
    assert.equal(bill.amountCents, 9625);
    assert.equal(bill.commissionCents, 2000);
    assert.equal(bill.earnedCents, 11625);
    assert.equal(bill.usage.packagePrices, undefined);
    assert.equal(bill.versions.length, 2);
    assert.equal(bill.versions[0].id, v2.versionId);
    assert.equal(bill.people[SUPER], "Sam Super");
    assert.equal(bill.canManage, false);
  });

  it("lists only businesses with a deal or activity, deal first",
      async () => {
        const month = await call({action: "getMonthBills", month: PREV},
            FINANCE);
        const ids = month.rows.map((row) => row.businessId);
        assert.deepEqual(ids, [BIZ, BIZ_B]);
        assert.equal(month.rows[0].amountCents, 9625);
        assert.equal(month.rows[0].hasDeal, true);
        assert.equal(month.rows[1].amountCents, 0);
        assert.equal(month.rows[1].counts.barrels, 5);
        assert.equal(month.summary.owedCents, 9625);
        assert.equal(month.summary.commissionCents, 2000);
        assert.equal(month.summary.partial, false);
        assert.equal(month.nextCursor, null);
        await assert.rejects(call({action: "getMonthBills", month: PREV,
          cursor: -1}, FINANCE), refusedWith("cursor_invalid"));
      });

  it("tries other rates without saving them", async () => {
    const one = await call({action: "whatIf", businessId: BIZ, month: PREV,
      deal: {barrel: {centsEach: 100}}}, FINANCE);
    assert.equal(one.now.amountCents, 9625);
    assert.equal(one.alt.amountCents, 1000);
    assert.equal(one.deltaCents, -8625);
    const all = await call({action: "whatIf", month: PREV,
      deal: {parking: {mode: "perCar", centsEach: 500}}}, FINANCE);
    const ids = all.rows.map((row) => row.businessId).sort();
    // The parking card brings in every business offering parking.
    assert.deepEqual(ids, [BIZ, BIZ_NOFEE, BIZ_B].sort());
    const mine = all.rows.find((row) => row.businessId === BIZ);
    assert.equal(mine.nowCents, 9625);
    assert.equal(mine.altCents, 1000);
    assert.equal(all.totals.altCents, 1000);
    assert.equal(all.totals.nowCents, 9625);
    await assert.rejects(call({action: "whatIf", month: PREV,
      deal: {barrel: {centsEach: -1}}}, FINANCE),
    refusedWith("amount_invalid"));
    const saved = await db.collection("billingDeals").doc(BIZ).get();
    assert.equal(saved.data().versions.length, 2);
  });

  it("records partial payments", async () => {
    const first = await call({action: "recordPayment", businessId: BIZ,
      month: PREV, amountCents: 4000, paidOn: TODAY, method: "zelle",
      note: "First half"});
    firstPaymentId = first.paymentId;
    assert.equal(first.paidCents, 4000);
    await assert.rejects(call({action: "recordPayment", businessId: BIZ,
      month: PREV, amountCents: 100, paidOn: "2999-01-01",
      method: "cash"}), refusedWith("paid_on_invalid"));
    await assert.rejects(call({action: "recordPayment", businessId: BIZ,
      month: PREV, amountCents: 100, paidOn: TODAY, method: "bitcoin"}),
    refusedWith("method_invalid"));
    const bill = await call({action: "getBusinessBill", businessId: BIZ,
      month: PREV}, FINANCE);
    assert.equal(bill.paidCents, 4000);
    assert.equal(bill.standing.status, "partial");
    assert.equal(bill.unpaidCents, 5625);
    assert.equal(bill.payments.length, 1);
    assert.equal(bill.payments[0].note, "First half");
  });

  it("closes an ended month, freezes it, and refuses to overpay it",
      async () => {
        await assert.rejects(call({action: "closeMonth", businessId: BIZ,
          month: CUR}), refusedWith("month_not_over"));
        const closed = await call({action: "closeMonth", businessId: BIZ,
          month: PREV});
        assert.equal(closed.amountCents, 9625);
        await assert.rejects(call({action: "closeMonth", businessId: BIZ,
          month: PREV}), refusedWith("month_already_closed"));
        await assert.rejects(call({action: "recordPayment", businessId: BIZ,
          month: PREV, amountCents: 6000, paidOn: TODAY, method: "cash"}),
        refusedWith("payment_exceeds_balance"));
        const rest = await call({action: "recordPayment", businessId: BIZ,
          month: PREV, amountCents: 5625, paidOn: TODAY, method: "check"});
        secondPaymentId = rest.paymentId;
        const bill = await call({action: "getBusinessBill", businessId: BIZ,
          month: PREV}, FINANCE);
        assert.equal(bill.status, "closed");
        assert.equal(bill.standing.status, "paid");
        assert.equal(bill.closed.closedBy, SUPER);
        assert.equal(bill.drift.changed, false);
        await assert.rejects(call({action: "saveDeal", businessId: BIZ,
          effectiveFrom: PREV, deal: V1}),
        refusedWith("effective_month_closed"));
      });

  it("shows drift after close and never changes the closed amount",
      async () => {
        await db.collection("volumeMonthly").doc(`${BIZ}_${PREV}`)
            .update({barrels: 13, pieces: 102});
        const bill = await call({action: "getBusinessBill", businessId: BIZ,
          month: PREV}, FINANCE);
        assert.equal(bill.amountCents, 9625);
        assert.equal(bill.drift.changed, true);
        assert.deepEqual(bill.drift.items.map((i) => [i.key, i.delta]),
            [["barrels", 3]]);
        assert.equal(bill.drift.amountNowCents, 11125);
        const month = await call({action: "getMonthBills", month: PREV},
            FINANCE);
        const row = month.rows.find((r) => r.businessId === BIZ);
        assert.equal(row.status, "closed");
        assert.equal(row.amountCents, 9625);
        assert.equal(row.counts.barrels, 10);
        assert.equal(row.drift.changed, true);
      });

  it("voids a payment (struck through, never erased)", async () => {
    const voided = await call({action: "voidPayment", businessId: BIZ,
      paymentId: secondPaymentId, reason: "Bounced"});
    assert.equal(voided.paidCents, 4000);
    await assert.rejects(call({action: "voidPayment", businessId: BIZ,
      paymentId: secondPaymentId}), refusedWith("payment_already_voided"));
    await assert.rejects(call({action: "voidPayment", businessId: BIZ_B,
      paymentId: firstPaymentId}), refusedWith("payment_not_found"));
    const bill = await call({action: "getBusinessBill", businessId: BIZ,
      month: PREV}, FINANCE);
    assert.equal(bill.payments.length, 2);
    assert.equal(bill.payments.find((p) => p.id === secondPaymentId).voided,
        true);
    assert.equal(bill.unpaidToDateCents, 5625);
    const month = await call({action: "getMonthBills", month: PREV},
        FINANCE);
    assert.equal(month.summary.unpaidToDateCents, 5625);
    assert.equal(month.rows[0].unpaidToDateCents, 5625);
  });

  it("reopens a closed month with a reason, back to live", async () => {
    await assert.rejects(call({action: "reopenMonth", businessId: BIZ,
      month: PREV, reason: "  "}), refusedWith("reason_required"));
    await call({action: "reopenMonth", businessId: BIZ, month: PREV,
      reason: "Barrels were missed"});
    await assert.rejects(call({action: "reopenMonth", businessId: BIZ,
      month: PREV, reason: "again"}), refusedWith("month_not_closed"));
    const bill = await call({action: "getBusinessBill", businessId: BIZ,
      month: PREV}, FINANCE);
    assert.equal(bill.status, "open");
    assert.equal(bill.amountCents, 11125);
    assert.equal(bill.reopenHistory.length, 1);
    assert.equal(bill.reopenHistory[0].closedAmountCents, 9625);
    assert.equal(bill.unpaidToDateCents, 0);
    const audits = await db.collection("adminAuditLogs")
        .where("actorUid", "==", SUPER).get();
    const actions = new Set(audits.docs.map((d) => d.data().action));
    for (const action of ["billing_deal_saved", "billing_payment_recorded",
      "billing_payment_voided", "billing_month_closed",
      "billing_month_reopened"]) {
      assert.ok(actions.has(action), action);
    }
  });

  it("replace zeroes the fee fields Finance uses; keep restores them",
      async () => {
        const businessRef = db.collection("businesses").doc(BIZ);
        const replaced = await call({action: "setCommissionMode",
          businessId: BIZ, mode: "replace"});
        assert.equal(replaced.changed, true);
        let business = (await businessRef.get()).data();
        assert.equal(business.platformFeePct, 0);
        assert.equal(business.servicePlatformFeePct.parkingPlatformFeePct, 0);
        assert.equal(business.platformFeeUpdatedBy, SUPER);
        const again = await call({action: "setCommissionMode",
          businessId: BIZ, mode: "replace"});
        assert.equal(again.changed, false);
        const kept = await call({action: "setCommissionMode",
          businessId: BIZ, mode: "keep"});
        assert.deepEqual(kept.notRestored, []);
        business = (await businessRef.get()).data();
        assert.equal(business.platformFeePct, 0.08);
        assert.equal(business.servicePlatformFeePct.parkingPlatformFeePct,
            0.05);
        // The deal versions survive the switch.
        const deal = (await db.collection("billingDeals").doc(BIZ).get())
            .data();
        assert.equal(deal.versions.length, 2);
        assert.equal(deal.commissionMode, "keep");
        await assert.rejects(call({action: "setCommissionMode",
          businessId: BIZ, mode: "both"}),
        refusedWith("commission_mode_invalid"));
      });

  it("an inherited rate comes back inherited; a changed one is left",
      async () => {
        const ref = db.collection("businesses").doc(BIZ_NOFEE);
        await call({action: "setCommissionMode", businessId: BIZ_NOFEE,
          mode: "replace"});
        assert.equal((await ref.get()).data().platformFeePct, 0);
        await call({action: "setCommissionMode", businessId: BIZ_NOFEE,
          mode: "keep"});
        assert.equal("platformFeePct" in (await ref.get()).data(), false);

        await call({action: "setCommissionMode", businessId: BIZ,
          mode: "replace"});
        await db.collection("businesses").doc(BIZ)
            .update({platformFeePct: 0.06});
        const kept = await call({action: "setCommissionMode",
          businessId: BIZ, mode: "keep"});
        assert.deepEqual(kept.notRestored, ["platformFeePct"]);
        const business = (await db.collection("businesses").doc(BIZ).get())
            .data();
        assert.equal(business.platformFeePct, 0.06);
        assert.equal(business.servicePlatformFeePct.parkingPlatformFeePct,
            0.05);
        const audits = await db.collection("adminAuditLogs")
            .where("targetId", "==", BIZ).get();
        const actions = audits.docs.map((d) => d.data().action);
        assert.ok(actions.includes("billing_commission_replaced"));
        assert.ok(actions.includes("billing_commission_restored"));
      });

  it("a month with nothing open is not listed", async () => {
    const month = await call({action: "getMonthBills", month: CUR},
        FINANCE);
    // The deal applies this month (v2 from PREV on), so the business with
    // the deal is listed; the idle shop is not.
    assert.ok(month.rows.some((row) => row.businessId === BIZ));
    assert.ok(!month.rows.some((row) => row.businessId === BIZ_IDLE));
    await db.collection("businesses").doc(BIZ_IDLE)
        .update({updatedAt: FieldValue.serverTimestamp()});
  });
});
