"use strict";

// "I paid everything" (docs/TEAM_SETTLE.md) end to end against the Auth and
// Firestore emulators: a team member says they paid their month, the amount
// and split are frozen, the receiver confirms (a hand-over for the cash and
// a month bill payment for the parking are written) or declines, one undo
// takes both off, and the owner pays back what the business owes.
//
// Run through `npm run test:team-settle` (firebase emulators:exec).

/* global globalThis */

const assert = require("node:assert/strict");
const {after, before, beforeEach, describe, it, mock} =
  require("node:test");
const admin = require("firebase-admin");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
      "Run this through `npm run test:team-settle` (firebase " +
      "emulators:exec). A direct node --test run would write its fixtures " +
      "into the real project.");
}

process.env.FUNCTIONS_EMULATOR = "true";
process.env.WHATSAPP_ACCESS_TOKEN = "test-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "1475234702329161";
process.env.WHATSAPP_APP_SECRET = "test-app-secret";

const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const href = String(url);
  if (href.includes("graph.facebook.com") && href.endsWith("/messages")) {
    sent.push(JSON.parse(init.body));
    return new Response(JSON.stringify(
        {messages: [{id: `wamid.out.${sent.length}`}]}), {status: 200});
  }
  if (href.includes("laawoldigital.com/assets/logo.png")) {
    return new Response("", {status: 404});
  }
  return realFetch(url, init);
};

const functions = require("../index");
const {occupancyEndMs} = require("../parking_occupancy");
admin.auth().getUser = async (uid) => ({
  uid, email: `${uid}@example.test`, emailVerified: true});
const db = admin.firestore();
const {Timestamp} = admin.firestore;

const BIZ = "tset-lot";
const OTHER_BIZ = "tset-other-lot";
const OWNER = "tset-owner";
const FULL = "tset-full";
const MEMBER = "tset-member";
const PLAIN = "tset-plain";
const OUTSIDER = "tset-outsider";
const MONTH = "2026-10";
const NOW = Date.parse("2026-11-11T15:00:00Z");

const call = (action, uid, extra = {}) => functions.updateLotExpenseEntry.run({
  auth: {uid, token: {}}, rawRequest: {},
  data: {action, businessId: BIZ, ...extra}});
const request = (uid, extra = {}) => call("team_settle_request", uid, {
  monthKey: MONTH, amountCents: 10100, scope: "everything",
  receiverId: OWNER, method: "cash", ...extra});
const refusal = (code, reason) => (error) => {
  assert.equal(error.code, code, error.message);
  assert.equal(error.details?.reason, reason, error.message);
  return true;
};
const day = (iso) => Timestamp.fromDate(new Date(`${iso}T12:00:00Z`));
const rows = async (name) => (await db.collection(name)
    .where("businessId", "==", BIZ).get()).docs
    .map((doc) => ({id: doc.id, ...doc.data()}));
const settlement = async (id) => (await db.collection("staffMonthSettlements")
    .doc(id).get()).data();
const notes = async (uid) => (await db.collection("users").doc(uid)
    .collection("notifications").get()).docs.map((doc) => doc.data());

async function seedCar(id, overrides) {
  const row = {
    businessId: BIZ, businessName: "Dala Parking", source: "business",
    enteredByBusiness: true, trackingCode: `PK-${id.toUpperCase()}`,
    status: "reserved", customerName: "Fatou Camara",
    customerPhone: "+12015550101", carMake: "Toyota", carModel: "Corolla",
    carYear: "2014", paymentMethod: "direct",
    paymentStatus: "awaiting_direct_payment", dailyRate: 10,
    amountPaidCents: 0, createdAt: Timestamp.now(), ...overrides,
  };
  await db.collection("parkedCars").doc(id)
      .set({...row, occupancyEndMs: occupancyEndMs(row)});
}

// The member, October 2026: $100 of parking on his own car, a $35 expense
// from September not yet credited, and $36 he took in cash on Zed's car on
// Oct 15 -> owes $100 - $35 + $36 = $101.
async function seedMember(extra = {}) {
  await seedCar("own", {forStaffId: MEMBER, forStaffName: "Yao Kouassi",
    customerName: "Yao Kouassi", customerPhone: "", carMake: "Honda",
    carModel: "Accord", carYear: "2015", parkingDate: day("2026-10-10"),
    parkingEndDate: day("2026-10-19"), amountDue: 100, amountDueCents: 10000,
    totalCost: 100, totalCostCents: 10000, ...extra});
  await seedCar("zed", {customerName: "Zed Camara",
    customerPhone: "+12015550099", carMake: "Kia", carModel: "Rio",
    parkingDate: day("2026-10-03"), parkingEndDate: day("2026-10-10"),
    amountDue: 500, amountDueCents: 50000, totalCost: 500,
    totalCostCents: 50000, amountPaidCents: 3600,
    parkingPayments: [{amountCents: 3600, receivedByStaffId: MEMBER,
      receivedVia: "cash", at: day("2026-10-15")}]});
  await db.collection("lotExpenseEntries").doc("tset-exp-sep").set({
    businessId: BIZ, paidByStaffId: MEMBER, amountCents: 3500,
    month: "2026-09", spentAt: day("2026-09-06"), note: "cups",
    voided: false});
}

async function clear() {
  for (const name of ["parkedCars", "lotActivities", "lotActivityPayments",
    "lotExpenseEntries", "staffExpenseRepayments", "staffHandovers",
    "staffMonthSettlements", "parkingBillPayments", "parkingMessages",
    "lotLedgerAudit", "whatsappContacts", "whatsappTemplateCounts"]) {
    const snap = await db.collection(name).get();
    await Promise.all(snap.docs.map((doc) => doc.ref.delete()));
  }
  for (const uid of [OWNER, FULL, MEMBER, PLAIN]) {
    const snap = await db.collection("users").doc(uid)
        .collection("notifications").get();
    await Promise.all(snap.docs.map((doc) => doc.ref.delete()));
  }
  await db.collection("businesses").doc(BIZ).update({
    parkingWhatsApp: admin.firestore.FieldValue.delete()});
  sent.length = 0;
}

before(async () => {
  await Promise.all([
    db.collection("businesses").doc(BIZ).set({
      name: "Dala Parking", status: "approved", ownerUid: OWNER,
      country: "United States", phone: "+13475550100",
      enabledServices: ["carParking"], parkingDailyRate: 10}),
    db.collection("businesses").doc(OTHER_BIZ).set({
      name: "Other Lot", status: "approved", ownerUid: "tset-other-owner",
      country: "United States", enabledServices: ["carParking"]}),
    db.collection("users").doc(OWNER).set({role: "businessOwner",
      businessId: BIZ, fullName: "Ousmane Sow"}),
    db.collection("users").doc(FULL).set({role: "staff", businessId: BIZ,
      fullAccess: true, businessPermissions: ["parking", "ledger"],
      fullName: "Hassimiou Niane"}),
    db.collection("users").doc(MEMBER).set({role: "staff", businessId: BIZ,
      businessPermissions: ["parking"], fullName: "Yao Kouassi",
      phone: "+12015550077"}),
    db.collection("users").doc(PLAIN).set({role: "staff", businessId: BIZ,
      businessPermissions: ["parking"], fullName: "Awa Diop"}),
    db.collection("users").doc(OUTSIDER).set({role: "staff",
      businessId: OTHER_BIZ, businessPermissions: ["parking"],
      fullName: "Sekou Toure"}),
  ]);
  mock.timers.enable({apis: ["Date"], now: NOW});
});

after(() => mock.timers.reset());

beforeEach(async () => {
  await clear();
  await seedMember();
});

describe("saying you paid", () => {
  it("files it pending, frozen, and tells the receiver - nothing counts yet",
      async () => {
        const r = await request(MEMBER);
        assert.equal(r.status, "pending");
        assert.equal(r.cashCents, 3600);
        assert.equal(r.parkingCents, 6500);
        const row = await settlement(r.settlementId);
        assert.deepEqual([row.staffId, row.amountCents, row.cashCents,
          row.parkingCents, row.statementOwedCents, row.receiverId,
          row.status], [MEMBER, 10100, 3600, 6500, 10100, OWNER, "pending"]);
        assert.equal((await rows("staffHandovers")).length, 0);
        assert.equal((await rows("parkingBillPayments")).length, 0);
        const told = await notes(OWNER);
        assert.equal(told.length, 1);
        assert.match(told[0].body,
            /Yao Kouassi says he paid you \$101\.00 for/);
      });

  it("lets the member pay only the cash, or only the parking", async () => {
    const cash = await request(MEMBER, {scope: "cash", amountCents: 3600});
    assert.deepEqual([cash.cashCents, cash.parkingCents], [3600, 0]);
    const parking = await request(MEMBER, {scope: "parking",
      amountCents: 6500});
    assert.deepEqual([parking.cashCents, parking.parkingCents], [0, 6500]);
  });

  it("refuses more than the scope owes, nothing owed, and bad input",
      async () => {
        await assert.rejects(request(MEMBER, {scope: "cash",
          amountCents: 3601}), refusal("failed-precondition",
            "team_settle_more_than_owed"));
        await assert.rejects(request(MEMBER, {amountCents: 10101}),
            refusal("failed-precondition", "team_settle_more_than_owed"));
        await assert.rejects(request(MEMBER, {amountCents: 0}),
            refusal("invalid-argument", "team_settle_no_amount"));
        await assert.rejects(request(MEMBER, {scope: "all"}),
            refusal("invalid-argument", "team_settle_scope_invalid"));
        await assert.rejects(request(MEMBER, {method: "gold"}),
            refusal("invalid-argument", "team_settle_method_invalid"));
        await assert.rejects(request(MEMBER, {monthKey: "2027-01"}),
            refusal("invalid-argument", "team_settle_month_invalid"));
        // Nobody else has a statement that month.
        await assert.rejects(request(PLAIN),
            refusal("failed-precondition", "team_settle_no_statement"));
      });

  it("names only the owner, someone with Full access, or the Business " +
      "account as the receiver", async () => {
    await assert.rejects(request(MEMBER, {receiverId: PLAIN}),
        refusal("failed-precondition", "team_settle_receiver_invalid"));
    await assert.rejects(request(MEMBER, {receiverId: MEMBER}),
        refusal("failed-precondition", "team_settle_receiver_invalid"));
    assert.equal((await request(MEMBER, {receiverId: FULL})).status,
        "pending");
    assert.equal((await request(MEMBER,
        {receiverId: "business_account"})).status, "pending");
  });

  it("is for yourself: only the owner or Full access files for someone " +
      "else", async () => {
    await assert.rejects(request(PLAIN, {staffId: MEMBER}),
        refusal("permission-denied", "team_settle_not_own"));
    await assert.rejects(request(OUTSIDER),
        (error) => error.code === "permission-denied");
  });
});

describe("the receiver answers", () => {
  it("confirming writes the cash hand-over and the bill payment, as " +
      "frozen, and the statement goes to $0", async () => {
    const r = await request(MEMBER);
    // Only the named receiver answers: not Full access, not another staff.
    await assert.rejects(call("team_settle_confirm", FULL,
        {settlementId: r.settlementId}),
    refusal("permission-denied", "team_settle_not_receiver"));
    await assert.rejects(call("team_settle_confirm", PLAIN,
        {settlementId: r.settlementId}),
    refusal("permission-denied", "team_settle_not_receiver"));
    await assert.rejects(call("team_settle_confirm", MEMBER,
        {settlementId: r.settlementId}),
    refusal("permission-denied", "team_settle_not_receiver"));

    const done = await call("team_settle_confirm", OWNER,
        {settlementId: r.settlementId});
    assert.equal(done.status, "confirmed");
    const row = await settlement(r.settlementId);
    assert.equal(row.status, "confirmed");
    assert.equal(row.confirmedByUid, OWNER);
    assert.ok(row.confirmedAtMs > 0);

    const [handover] = await rows("staffHandovers");
    assert.deepEqual([handover.fromStaffId, handover.toId,
      handover.amountCents, handover.status, handover.kind,
      handover.settlementId],
    [MEMBER, OWNER, 3600, "confirmed", "handover", r.settlementId]);
    assert.equal(row.handoverId, handover.id);

    const [bill] = await rows("parkingBillPayments");
    assert.deepEqual([bill.amountCents, bill.receivedByStaffId,
      bill.settlementId, bill.settleCashCents, bill.status],
    [6500, OWNER, r.settlementId, 3600, "recorded"]);
    assert.equal(row.billPaymentId, bill.id);
    const car = (await db.collection("parkedCars").doc("own").get()).data();
    assert.equal(car.amountPaidCents, 6500);

    // Its bill payment is undone only with the settlement, never alone.
    await assert.rejects(functions.updateBusinessParkingEntry.run({
      auth: {uid: OWNER, token: {}}, rawRequest: {},
      data: {action: "bill_payment_undo", businessId: BIZ,
        billPaymentId: bill.id}}),
    refusal("failed-precondition", "bill_payment_from_settlement"));

    // The statement is settled: nothing more can be paid on it.
    await assert.rejects(request(MEMBER, {amountCents: 100}),
        refusal("failed-precondition", "team_settle_nothing_owed"));
    // The member heard it; the receipt is the bill receipt (switch off here).
    assert.equal((await notes(MEMBER)).length, 1);
    assert.equal(done.receipt, "");
    // Answered once.
    await assert.rejects(call("team_settle_confirm", OWNER,
        {settlementId: r.settlementId}),
    refusal("failed-precondition", "team_settle_not_pending"));
  });

  it("the Business account is confirmed by the owner or Full access, " +
      "never ordinary staff", async () => {
    const r = await request(MEMBER, {receiverId: "business_account",
      method: "zelle"});
    await assert.rejects(call("team_settle_confirm", PLAIN,
        {settlementId: r.settlementId}),
    refusal("permission-denied", "team_settle_not_receiver"));
    await call("team_settle_confirm", FULL, {settlementId: r.settlementId});
    const [handover] = await rows("staffHandovers");
    assert.equal(handover.toId, "business_account");
    const [bill] = await rows("parkingBillPayments");
    assert.equal(bill.receivedByStaffId, "business_account");
  });

  it("a cash-only settlement writes just the hand-over", async () => {
    const r = await request(MEMBER, {scope: "cash", amountCents: 3600});
    await call("team_settle_confirm", OWNER, {settlementId: r.settlementId});
    assert.equal((await rows("staffHandovers")).length, 1);
    assert.equal((await rows("parkingBillPayments")).length, 0);
    assert.equal((await settlement(r.settlementId)).billPaymentId, "");
  });

  it("declining changes nothing and tells the member", async () => {
    const r = await request(MEMBER);
    await assert.rejects(call("team_settle_decline", PLAIN,
        {settlementId: r.settlementId}),
    refusal("permission-denied", "team_settle_not_receiver"));
    await call("team_settle_decline", OWNER,
        {settlementId: r.settlementId, note: "not received yet"});
    const row = await settlement(r.settlementId);
    assert.deepEqual([row.status, row.declinedByUid, row.declineNote],
        ["declined", OWNER, "not received yet"]);
    assert.equal((await rows("staffHandovers")).length, 0);
    assert.equal((await rows("parkingBillPayments")).length, 0);
    const told = await notes(MEMBER);
    assert.equal(told.length, 1);
    assert.match(told[0].body, /not confirmed: not received yet/);
    // The month still owes the same: it can be filed again.
    assert.equal((await request(MEMBER)).status, "pending");
  });

  it("the owner filing it for the member needs no confirm step", async () => {
    const r = await request(OWNER, {staffId: MEMBER});
    assert.equal(r.status, "confirmed");
    const row = await settlement(r.settlementId);
    assert.deepEqual([row.requestedByUid, row.confirmedByUid, row.status],
        [OWNER, OWNER, "confirmed"]);
    assert.equal((await rows("staffHandovers")).length, 1);
    assert.equal((await rows("parkingBillPayments")).length, 1);
    // Full access files it too, naming themselves as the receiver.
    await call("team_settle_undo", PLAIN, {settlementId: r.settlementId});
    const again = await request(FULL, {staffId: MEMBER, receiverId: FULL});
    assert.equal(again.status, "confirmed");
  });
});

describe("undo", () => {
  it("any staff member takes off both the payment and the hand-over, and " +
      "History records who and when", async () => {
    const r = await request(MEMBER);
    await call("team_settle_confirm", OWNER, {settlementId: r.settlementId});
    const before = (await notes(MEMBER)).length;
    await assert.rejects(call("team_settle_undo", OUTSIDER,
        {settlementId: r.settlementId}),
    (error) => error.code === "permission-denied");
    const undone = await call("team_settle_undo", PLAIN,
        {settlementId: r.settlementId});
    assert.equal(undone.status, "undone");
    const row = await settlement(r.settlementId);
    assert.deepEqual([row.status, row.undoneByUid], ["undone", PLAIN]);
    assert.equal(row.undoneAtMs, NOW);
    const [handover] = await rows("staffHandovers");
    assert.deepEqual([handover.status, handover.voidedByUid],
        ["voided", PLAIN]);
    const [bill] = await rows("parkingBillPayments");
    assert.deepEqual([bill.status, bill.undoneByUid], ["undone", PLAIN]);
    const car = (await db.collection("parkedCars").doc("own").get()).data();
    assert.equal(car.amountPaidCents, 0);
    const audit = (await rows("lotLedgerAudit")).filter((a) =>
      a.entityType === "team_settlement" && a.entityId === r.settlementId)
        .map((a) => [a.action, a.byStaffId]);
    assert.deepEqual(audit.sort(), [["confirmed", OWNER],
      ["requested", MEMBER], ["undone", PLAIN]]);
    // No message to anyone.
    assert.equal((await notes(MEMBER)).length, before);
    // The month owes it all again, and cannot be undone twice.
    assert.equal((await request(MEMBER)).status, "pending");
    await assert.rejects(call("team_settle_undo", PLAIN,
        {settlementId: r.settlementId}),
    refusal("failed-precondition", "team_settle_not_undoable"));
  });

  it("withdraws one that is still waiting", async () => {
    const r = await request(MEMBER);
    await call("team_settle_undo", MEMBER, {settlementId: r.settlementId});
    assert.equal((await settlement(r.settlementId)).status, "undone");
    assert.equal((await rows("staffHandovers")).length, 0);
  });
});

describe("a later edit never changes what was frozen", () => {
  it("refuses to confirm what the statement can no longer take, and " +
      "leaves it waiting", async () => {
    const r = await request(MEMBER);
    // A new October expense of $40 lowers what the parking owes to $25.
    await db.collection("lotExpenseEntries").doc("tset-exp-oct").set({
      businessId: BIZ, paidByStaffId: MEMBER, amountCents: 4000,
      month: MONTH, spentAt: day("2026-10-12"), note: "soap",
      voided: false});
    await assert.rejects(call("team_settle_confirm", OWNER,
        {settlementId: r.settlementId}),
    refusal("failed-precondition", "team_settle_bill_changed"));
    const row = await settlement(r.settlementId);
    assert.equal(row.status, "pending");
    assert.equal(row.amountCents, 10100);
    assert.equal((await rows("staffHandovers")).length, 0);
    assert.equal((await rows("parkingBillPayments")).length, 0);
  });

  it("records exactly the frozen amount, and a later increase shows as " +
      "left to pay", async () => {
    const r = await request(MEMBER);
    await call("team_settle_confirm", OWNER, {settlementId: r.settlementId});
    // The month grows after it was paid: another $20 of parking.
    await seedCar("late", {forStaffId: MEMBER, forStaffName: "Yao Kouassi",
      customerName: "Yao Kouassi", customerPhone: "", carMake: "Ford",
      carModel: "Focus", parkingDate: day("2026-10-25"),
      parkingEndDate: day("2026-10-26"), amountDue: 20, amountDueCents: 2000,
      totalCost: 20, totalCostCents: 2000});
    const row = await settlement(r.settlementId);
    assert.equal(row.amountCents, 10100);
    assert.equal(row.statementOwedCents, 10100);
    await assert.rejects(request(MEMBER, {amountCents: 2001}),
        refusal("failed-precondition", "team_settle_more_than_owed"));
    const more = await request(MEMBER, {amountCents: 2000});
    assert.equal(more.parkingCents, 2000);
  });
});

describe("the business owes the member", () => {
  // A $200 September expense: owes = $100 - $200 + $36 = -$64.
  beforeEach(async () => {
    await db.collection("lotExpenseEntries").doc("tset-exp-sep").update(
        {amountCents: 20000});
  });

  it("nothing is left to pay, so a settlement is refused", async () => {
    await assert.rejects(request(MEMBER, {amountCents: 100}),
        refusal("failed-precondition", "team_settle_nothing_owed"));
  });

  it("the owner or Full access pays them back; it lands in the month and " +
      "tells the member", async () => {
    await assert.rejects(call("team_payback", PLAIN, {monthKey: MONTH,
      staffId: MEMBER, amountCents: 6400, method: "cash"}),
    refusal("permission-denied", "team_settle_owner_only"));
    await assert.rejects(call("team_payback", OWNER, {monthKey: MONTH,
      staffId: MEMBER, amountCents: 6401, method: "cash"}),
    refusal("failed-precondition", "team_payback_more_than_owed"));
    await assert.rejects(call("team_payback", OWNER, {monthKey: MONTH,
      staffId: MEMBER, amountCents: 100, method: "gold"}),
    refusal("invalid-argument", "team_settle_method_invalid"));

    const paid = await call("team_payback", FULL, {monthKey: MONTH,
      staffId: MEMBER, amountCents: 6400, method: "zelle"});
    assert.equal(paid.month, MONTH);
    const [repayment] = await rows("staffExpenseRepayments");
    assert.deepEqual([repayment.staffId, repayment.amountCents,
      repayment.method, repayment.month, repayment.recordedByUid],
    [MEMBER, 6400, "zelle", MONTH, FULL]);
    const told = await notes(MEMBER);
    assert.equal(told.length, 1);
    assert.match(told[0].body, /paid you back \$64\.00/);
    // The month is at $0: nothing more to pay back.
    await assert.rejects(call("team_payback", OWNER, {monthKey: MONTH,
      staffId: MEMBER, amountCents: 100, method: "cash"}),
    refusal("failed-precondition", "team_payback_not_owed"));
  });

  it("is refused when the member owes the business", async () => {
    await db.collection("lotExpenseEntries").doc("tset-exp-sep").update(
        {amountCents: 3500});
    await assert.rejects(call("team_payback", OWNER, {monthKey: MONTH,
      staffId: MEMBER, amountCents: 100, method: "cash"}),
    refusal("failed-precondition", "team_payback_not_owed"));
  });
});

describe("the receipt", () => {
  it("is the bill receipt with the whole settlement as its amount, sent " +
      "once on confirm", async () => {
    await db.collection("businesses").doc(BIZ).update({
      parkingWhatsApp: {enabled: true,
        enabledAtMs: Date.parse("2026-10-01T00:00:00Z"),
        enabledByUid: OWNER}});
    const r = await request(MEMBER);
    const done = await call("team_settle_confirm", OWNER,
        {settlementId: r.settlementId});
    assert.equal(done.receipt, "sent");
    assert.equal(sent.length, 1);
    const body = sent[0].template.components
        .find((part) => part.type === "body").parameters.map((p) => p.text);
    assert.ok(body.includes("$101.00"), body.join(" | "));
  });
});
