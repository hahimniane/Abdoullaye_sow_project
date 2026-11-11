"use strict";

// A negotiated discount on a parked car (docs/PARKING_DISCOUNT.md) end to
// end against the Firestore emulator: give one, settle for a lower amount,
// undo, and who may.
//
// Run through `npm run test:parking-discount` (firebase emulators:exec).

const assert = require("node:assert/strict");
const {before, describe, it} = require("node:test");
const admin = require("firebase-admin");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
      "Run this through `npm run test:parking-discount` (firebase " +
      "emulators:exec). A direct node --test run would write its fixtures " +
      "into the real project.");
}
process.env.FUNCTIONS_EMULATOR = "true";

const functions = require("../index");
admin.auth().getUser = async (uid) => ({
  uid, email: `${uid}@example.test`, emailVerified: true});
const db = admin.firestore();
const {Timestamp} = admin.firestore;

const BIZ = "pkdisc-lot";
const OWNER = "pkdisc-owner";
const STAFF = "pkdisc-staff";
const PACKAGES_ONLY = "pkdisc-packages";

const run = (name, uid, data) => functions[name].run({
  auth: {uid, token: {}}, data, rawRequest: {}});
const act = (uid, action, data) =>
  run("updateBusinessParkingEntry", uid, {action, ...data});
const car = async (id) => (await db.collection("parkedCars").doc(id).get())
    .data();
const history = async (id) => (await db.collection("lotLedgerAudit")
    .where("entityId", "==", id).get()).docs.map((d) => d.data().summary);
const refused = (reason) => (error) => error.details?.reason === reason;
const daysAgo = (n) => Timestamp.fromDate(
    new Date(Date.now() - n * 86400000));

let n = 0;
async function seedCar(extra) {
  const id = `pkdisc-car-${++n}`;
  await db.collection("parkedCars").doc(id).set({
    businessId: BIZ, source: "business", enteredByBusiness: true,
    paymentMethod: "direct", paymentStatus: "awaiting_direct_payment",
    status: "reserved", customerName: `Customer ${n}`,
    customerPhone: `+1201555${2000 + n}`, carMake: "Toyota",
    carModel: "Camry", carYear: "2015", dailyRate: 12,
    ...extra,
  });
  return id;
}

before(async () => {
  await Promise.all([
    db.collection("businesses").doc(BIZ).set({
      name: "Discount Lot", status: "approved", ownerUid: OWNER,
      country: "United States", enabledServices: ["carParking"],
      parkingTotalSpaces: 10, parkingDailyRate: 12,
    }),
    db.collection("users").doc(OWNER).set({role: "businessOwner",
      businessId: BIZ, fullName: "Owner One"}),
    db.collection("users").doc(STAFF).set({role: "staff", businessId: BIZ,
      businessPermissions: ["parking"], fullName: "Lot Staff"}),
    db.collection("users").doc(PACKAGES_ONLY).set({role: "staff",
      businessId: BIZ, businessPermissions: ["barrels"],
      fullName: "Package Staff"}),
  ]);
});

describe("give a discount", () => {
  it("staff with parking give one: its own line, the rest still owed",
      async () => {
        // Parked 10 days ago at $12: $132 owed today (11 days).
        const id = await seedCar({parkingDate: daysAgo(10)});
        const answer = await act(STAFF, "discount_give",
            {entryId: id, amountCents: 3200, reason: "Long stay"});
        assert.equal(answer.success, true);
        assert.equal(answer.amountCents, 3200);
        assert.equal(answer.settled, false);
        const c = await car(id);
        assert.equal(c.parkingDiscountCents, 3200);
        assert.equal(c.parkingDiscounts.length, 1);
        assert.equal(c.parkingDiscounts[0].givenByUid, STAFF);
        assert.equal(c.parkingDiscounts[0].reason, "Long stay");
        assert.equal(c.paymentStatus, "awaiting_direct_payment");
        assert.equal(c.amountPaidCents, undefined, "a discount is not money");
        assert.deepEqual(await history(id),
            ["Discount of $32.00 given (Long stay)"]);
      });

  it("refuses without a reason, above what is owed, and to others",
      async () => {
        const id = await seedCar({parkingDate: daysAgo(4)});
        await assert.rejects(act(STAFF, "discount_give",
            {entryId: id, amountCents: 100, reason: " "}),
        refused("discount_reason_required"));
        await assert.rejects(act(STAFF, "discount_give",
            {entryId: id, amountCents: 6001, reason: "x"}),
        refused("discount_more_than_owed"));
        await assert.rejects(act(PACKAGES_ONLY, "discount_give",
            {entryId: id, amountCents: 100, reason: "x"}),
        (error) => error.code === "permission-denied");
        await assert.rejects(act(OWNER, "discount_give",
            {entryId: await seedCar({parkingDate: daysAgo(4),
              paymentMethod: "payment_link"}), amountCents: 100,
            reason: "x"}),
        refused("discount_not_direct"));
        assert.equal((await car(id)).parkingDiscountCents, undefined);
      });
});

describe("settle for a lower amount", () => {
  it("$2,000 owed, $1,500 paid: payment + discount, the car is paid",
      async () => {
        const id = await seedCar({parkingDate: daysAgo(60),
          parkingEndDate: daysAgo(30), amountDueCents: 200000,
          totalCostCents: 200000});
        await assert.rejects(act(STAFF, "discount_settle", {entryId: id,
          paidCents: 150000, receivedVia: "cash", receivedByStaffId: STAFF,
          reason: "Agreed", expectedOwedCents: 199999}),
        refused("discount_owed_changed"));
        const answer = await act(STAFF, "discount_settle", {entryId: id,
          paidCents: 150000, receivedVia: "cash", receivedByStaffId: STAFF,
          reason: "Agreed with the owner", expectedOwedCents: 200000});
        assert.equal(answer.amountCents, 50000);
        assert.equal(answer.settled, true);
        const c = await car(id);
        assert.equal(c.paymentStatus, "paid");
        assert.equal(c.amountPaidCents, 150000);
        assert.equal(c.parkingDiscountCents, 50000);
        assert.equal(c.parkingPayments.length, 1);
        assert.equal(c.parkingPayments[0].amountCents, 150000);
        assert.equal(c.parkingPayments[0].receivedByStaffId, STAFF);
        assert.equal(c.parkingPayments[0].discountId,
            c.parkingDiscounts[0].id);
        assert.equal(c.amountDueCents, 200000, "the price is never rewritten");
        assert.deepEqual(await history(id), ["Settled for $1500.00: " +
          "discount of $500.00 (Agreed with the owner)"]);

        // Undo: the discount comes off, the payment stays, it owes again.
        await act(STAFF, "discount_undo",
            {entryId: id, discountId: c.parkingDiscounts[0].id});
        const after = await car(id);
        assert.equal(after.paymentStatus, "awaiting_direct_payment");
        assert.equal(after.parkingDiscountCents, 0);
        assert.equal(after.parkingDiscounts[0].undone, true);
        assert.equal(after.parkingDiscounts[0].undoneByUid, STAFF);
        assert.equal(after.amountPaidCents, 150000);
        await assert.rejects(act(STAFF, "discount_undo",
            {entryId: id, discountId: c.parkingDiscounts[0].id}),
        refused("discount_already_undone"));
      });

  it("an open stay is covered through today and stays open", async () => {
    const id = await seedCar({parkingDate: daysAgo(9)});
    // 10 days x $12 = $120 owed; they pay $100.
    const answer = await act(OWNER, "discount_settle", {entryId: id,
      paidCents: 10000, receivedVia: "zelle",
      receivedByStaffId: "business_account", reason: "Regular"});
    assert.equal(answer.amountCents, 2000);
    assert.equal(answer.settled, false);
    const c = await car(id);
    assert.equal(c.paymentStatus, "awaiting_direct_payment");
    assert.equal(c.parkingEndDate, undefined, "never ends the stay");
    assert.equal(c.amountPaidCents, 10000);
    assert.equal(c.parkingDiscountCents, 2000);
  });

  it("a voided car takes no discount", async () => {
    const id = await seedCar({parkingDate: daysAgo(3), voided: true});
    await assert.rejects(act(STAFF, "discount_give",
        {entryId: id, amountCents: 100, reason: "x"}));
  });
});
