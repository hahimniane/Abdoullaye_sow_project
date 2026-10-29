"use strict";

// The lot ledger callables against the Firestore emulator: the VIN
// duplicate rule (owner decision 2026-10-22) on createLotActivity,
// updateLotActivity and voidLotActivity, and its server-only locks.
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

const BIZ = "lotvin-biz";
const OWNER = "lotvin-owner";
const STAFF = "lotvin-staff";
const VIN = "1HGCM82633A004352";

const run = (name, uid, data) => functions[name].run({
  auth: {uid, token: {}}, data,
});

let vinSeq = 0;
/**
 * A fresh VIN per test, so the tests never see each other's records.
 *
 * @return {string} 17 characters.
 */
function freshVin() {
  vinSeq += 1;
  return `${VIN.slice(0, 11)}${String(900000 + vinSeq)}`;
}

function activity(overrides = {}) {
  return {
    businessId: BIZ,
    activityTypeId: "dispatch",
    feeCents: 5000,
    activityDate: "2026-10-15T12:00:00",
    customerName: "Alimou Barry",
    customerPhone: "+1 (201) 555-1234",
    vinNumber: VIN,
    carYear: "2018",
    carMake: "Toyota",
    carModel: "Camry",
    paymentMethod: "direct",
    paymentReceived: true,
    receivedVia: "cash",
    receivedByStaffId: STAFF,
    ...overrides,
  };
}

async function locksFor(activityId) {
  const snap = await db.collection("lotVinJobLocks")
      .where("activityId", "==", activityId).get();
  return snap.docs;
}

async function ownerInbox() {
  const snap = await db.collection("users").doc(OWNER)
      .collection("notifications").get();
  return snap.docs.map((doc) => doc.data())
      .filter((row) => row.data?.type === "lot_activity_repeat");
}

const refusal = (code, reason) => (error) => {
  assert.equal(error.code, code, error.message);
  assert.equal(error.details?.reason, reason);
  return true;
};

describe("lot ledger: the VIN duplicate rule", () => {
  before(async () => {
    await Promise.all([
      db.collection("businesses").doc(BIZ).set({
        name: "Lot VIN Test", status: "approved", ownerUid: OWNER,
        enabledServices: ["carParking"],
      }),
      db.collection("users").doc(OWNER).set({
        role: "businessOwner", businessId: BIZ, fullName: "Owner Person",
        email: "lotvin-owner@example.test", preferredLanguage: "fr",
      }),
      db.collection("users").doc(STAFF).set({
        role: "staff", businessId: BIZ, businessPermissions: ["ledger"],
        fullName: "Mamadou Diallo", email: "lotvin-staff@example.test",
      }),
      db.collection("lotActivityTypes").doc("dispatch").set({
        businessId: BIZ, label: "Dispatch", defaultFeeCents: 5000,
        needsVehicle: true, active: true, sortOrder: 0,
      }),
      db.collection("lotActivityTypes").doc("storage").set({
        businessId: BIZ, label: "Storage release", defaultFeeCents: 2000,
        needsVehicle: true, active: true, sortOrder: 1,
      }),
      db.collection("lotActivityTypes").doc("lending").set({
        businessId: BIZ, label: "Auction account", defaultFeeCents: 1000,
        needsVehicle: false, active: true, sortOrder: 2,
      }),
    ]);
  });

  it("refuses the same car, job and customer, naming the first", async () => {
    const vinNumber = freshVin();
    const first = await run("createLotActivity", STAFF,
        activity({vinNumber}));
    assert.equal(first.success, true);
    const [lock] = await locksFor(first.activityId);
    assert.ok(lock, "the first record takes the lock");
    assert.equal(lock.data().vinKey, vinNumber);

    // The same customer, typed differently, the VIN with a space.
    await assert.rejects(run("createLotActivity", STAFF, activity({
      vinNumber: `${vinNumber.slice(0, 5)} ${vinNumber.slice(5)}`
          .toLowerCase(),
      customerPhone: "201-555-1234",
    })), (error) => {
      refusal("already-exists", "vin_job_duplicate")(error);
      assert.equal(error.details.existingActivityId, first.activityId);
      assert.equal(error.details.existingTrackingCode, first.trackingCode);
      assert.equal(error.details.existingCustomerName, "Alimou Barry");
      assert.match(error.details.existingActivityDate, /^2026-10-15T/);
      return true;
    });
    // By name, when the new one has no phone.
    await assert.rejects(run("createLotActivity", STAFF, activity({
      vinNumber, customerPhone: "", customerName: "alimou  BARRY",
    })), refusal("already-exists", "vin_job_duplicate"));

    const stored = await db.collection("lotActivities")
        .where("businessId", "==", BIZ)
        .where("vinNumber", "==", vinNumber).get();
    assert.equal(stored.size, 1, "nothing else was written");
    // Another job on the same car is not a duplicate.
    const other = await run("createLotActivity", STAFF,
        activity({vinNumber, activityTypeId: "storage", feeCents: 2000}));
    assert.equal(other.success, true);
  });

  it("lets exactly one of two simultaneous taps land", async () => {
    const vinNumber = freshVin();
    const results = await Promise.allSettled([
      run("createLotActivity", STAFF, activity({vinNumber})),
      run("createLotActivity", STAFF, activity({vinNumber})),
    ]);
    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");
    assert.equal(won.length, 1, JSON.stringify(results.map((r) =>
      r.reason?.message || r.status)));
    assert.equal(lost.length, 1);
    assert.equal(lost[0].reason.code, "already-exists");
    assert.equal(lost[0].reason.details.existingActivityId,
        won[0].value.activityId);
    const stored = await db.collection("lotActivities")
        .where("businessId", "==", BIZ)
        .where("vinNumber", "==", vinNumber).get();
    assert.equal(stored.size, 1);
  });

  it("asks before recording the job for another customer, then tells " +
      "the owner", async () => {
    const vinNumber = freshVin();
    const first = await run("createLotActivity", STAFF,
        activity({vinNumber}));
    const before = (await ownerInbox()).length;
    const resale = activity({
      vinNumber, customerName: "Fatou Camara", customerPhone: "6465550000",
    });

    await assert.rejects(run("createLotActivity", STAFF, resale),
        (error) => {
          refusal("failed-precondition", "vin_job_repeat_confirm")(error);
          assert.deepEqual(error.details.existing.map((row) =>
            [row.activityId, row.trackingCode, row.customerName]),
          [[first.activityId, first.trackingCode, "Alimou Barry"]]);
          assert.match(error.details.existing[0].activityDate, /^2026-10-15/);
          return true;
        });
    assert.equal((await ownerInbox()).length, before, "no alert unconfirmed");

    const second = await run("createLotActivity", STAFF,
        {...resale, confirmRepeat: true});
    assert.equal(second.success, true);
    assert.deepEqual(second.repeatOfActivityIds, [first.activityId]);
    const stored = (await db.collection("lotActivities")
        .doc(second.activityId).get()).data();
    assert.deepEqual(stored.repeatOfActivityIds, [first.activityId]);
    assert.equal(stored.repeatConfirmedByStaffId, STAFF);
    assert.ok(stored.repeatConfirmedAt, "when it was confirmed");
    assert.equal((await locksFor(second.activityId)).length, 1);

    const alerts = await ownerInbox();
    assert.equal(alerts.length, before + 1, "the owner is told once");
    const alert = alerts.find((row) =>
      row.data.activityId === second.activityId);
    // The owner reads French (preferredLanguage: "fr").
    assert.equal(alert.body, "Un deuxième Dispatch a été enregistré pour " +
      `Toyota Camry 2018 · VIN …${vinNumber.slice(-8)} ` +
      `(${second.trackingCode}) par Mamadou`);
    assert.equal(alert.data.relatedCollection, "lotActivities");
    assert.equal(alert.data.businessId, BIZ);
    // Push and inbox only: no email or SMS is queued for it.
    const deliveries = (await db.collection("notificationDeliveries")
        .where("recipientUid", "==", OWNER).get()).docs
        .map((doc) => doc.data())
        .filter((row) => row.data?.activityId === second.activityId);
    assert.deepEqual(deliveries.map((row) => row.channel), ["push"]);
    // Recorded by the owner: nobody else to tell, and not the owner.
    const third = await run("createLotActivity", OWNER, activity({
      vinNumber, customerName: "Third Buyer", customerPhone: "9175550000",
      confirmRepeat: true,
    }));
    assert.deepEqual(third.repeatOfActivityIds.sort(),
        [first.activityId, second.activityId].sort());
    assert.equal((await ownerInbox()).length, before + 1);
  });

  it("forgets a voided record and releases its lock", async () => {
    const vinNumber = freshVin();
    const first = await run("createLotActivity", STAFF,
        activity({vinNumber}));
    assert.equal((await locksFor(first.activityId)).length, 1);
    await run("voidLotActivity", STAFF,
        {activityId: first.activityId, reason: "typed twice"});
    assert.equal((await locksFor(first.activityId)).length, 0,
        "the lock went with the void");
    const voided = (await db.collection("lotActivities")
        .doc(first.activityId).get()).data();
    assert.equal(voided.voided, true, "voided, never deleted");

    // The same car, job and customer may now be recorded again - no
    // confirmation, because nothing active is left.
    const again = await run("createLotActivity", STAFF,
        activity({vinNumber}));
    assert.equal(again.success, true);
    assert.equal(again.repeatOfActivityIds, undefined);
    assert.equal((await locksFor(again.activityId)).length, 1);
    await assert.rejects(run("voidLotActivity", STAFF,
        {activityId: first.activityId}), {code: "failed-precondition"});
  });

  it("applies the rule to an edit that changes the car, job or customer",
      async () => {
        const vinNumber = freshVin();
        const otherVin = freshVin();
        const a = await run("createLotActivity", STAFF,
            activity({vinNumber}));
        const b = await run("createLotActivity", STAFF,
            activity({vinNumber: otherVin}));
        const [bLock] = await locksFor(b.activityId);

        // Editing b onto a's car, same customer: refused, nothing moves.
        await assert.rejects(run("updateLotActivity", STAFF, {
          activityId: b.activityId, changes: activity({vinNumber}),
        }), (error) => {
          refusal("already-exists", "vin_job_duplicate")(error);
          assert.equal(error.details.existingActivityId, a.activityId);
          return true;
        });
        assert.equal((await db.collection("lotActivities")
            .doc(b.activityId).get()).data().vinNumber, otherVin);
        assert.equal((await locksFor(b.activityId))[0].id, bLock.id);

        // An edit that keeps the car, job and customer never trips on
        // itself (the fee changes; the identity does not).
        const kept = await run("updateLotActivity", STAFF, {
          activityId: a.activityId,
          changes: activity({vinNumber, customerPhone: "2015551234"}),
        });
        assert.equal(kept.success, true);

        // Onto a's car for another customer: asks, then moves the lock.
        const resale = activity({vinNumber, customerName: "Fatou Camara",
          customerPhone: "6465550000"});
        await assert.rejects(run("updateLotActivity", STAFF, {
          activityId: b.activityId, changes: resale,
        }), refusal("failed-precondition", "vin_job_repeat_confirm"));
        const moved = await run("updateLotActivity", STAFF, {
          activityId: b.activityId, changes: resale, confirmRepeat: true,
        });
        assert.equal(moved.success, true);
        const stored = (await db.collection("lotActivities")
            .doc(b.activityId).get()).data();
        assert.equal(stored.vinNumber, vinNumber);
        assert.deepEqual(stored.repeatOfActivityIds, [a.activityId]);
        assert.equal(stored.repeatConfirmedByStaffId, STAFF);
        const locks = await locksFor(b.activityId);
        assert.equal(locks.length, 1, "one lock, moved");
        assert.notEqual(locks[0].id, bLock.id);
        assert.equal((await db.collection("lotVinJobLocks").doc(bLock.id)
            .get()).exists, false, "the old lock is released");

        // b's old car is free again for that customer.
        const back = await run("createLotActivity", STAFF,
            activity({vinNumber: otherVin}));
        assert.equal(back.success, true);
      });

  it("never checks a job with no car", async () => {
    const lending = activity({activityTypeId: "lending", feeCents: 1000,
      vinNumber: "", carYear: "", carMake: "", carModel: ""});
    const first = await run("createLotActivity", STAFF, lending);
    const second = await run("createLotActivity", STAFF, lending);
    assert.equal(first.success, true);
    assert.equal(second.success, true);
    assert.equal((await locksFor(first.activityId)).length, 0);
    assert.equal((await locksFor(second.activityId)).length, 0);
  });

  it("lists the business's possible duplicates", async () => {
    const vinNumber = freshVin();
    const a = await run("createLotActivity", STAFF, activity({vinNumber}));
    const b = await run("createLotActivity", STAFF, activity({vinNumber,
      customerName: "Fatou Camara", customerPhone: "6465550000",
      confirmRepeat: true}));
    const result = await run("getLotLedgerTotals", STAFF,
        {businessId: BIZ, action: "vinDuplicates"});
    const group = result.duplicates.find((g) => g.vinKey === vinNumber);
    assert.ok(group, "the resale is listed");
    assert.equal(group.sameCustomer, false);
    assert.deepEqual(group.activities.map((row) => row.id).sort(),
        [a.activityId, b.activityId].sort());
  });
});

// Staff expenses come off their parking bill (STAFF_EXPENSE_CREDIT.md §4):
// the actions on updateLotExpenseEntry.
describe("lot ledger: staff expense credit actions", () => {
  const SC_BIZ = "staffcredit-biz";
  const SC_OWNER = "staffcredit-owner";
  const SC_LEDGER = "staffcredit-ledger";
  const SC_PARKER = "staffcredit-parker";
  const SC_PAYER = "staffcredit-payer";
  const SC_OUTSIDER = "staffcredit-outsider";
  const SC_CUSTOMER = "staffcredit-customer";
  const PLATFORM = "staffcredit-admin";
  const link = (uid, overrides = {}) => run("updateLotExpenseEntry", uid, {
    action: "link_staff_parking", businessId: SC_BIZ, staffId: SC_PAYER,
    customerKey: "phone:2015550101", customerName: "Abdoulaye Sow",
    customerPhone: "201-555-0101", ...overrides,
  });
  const repay = (uid, overrides = {}) => run("updateLotExpenseEntry", uid, {
    action: "record_staff_repayment", businessId: SC_BIZ, staffId: SC_PAYER,
    amountCents: 1000, method: "cash", note: "from the till", ...overrides,
  });
  const voidRepay = (uid, repaymentId) => run("updateLotExpenseEntry", uid,
      {action: "void_staff_repayment", businessId: SC_BIZ, repaymentId});
  const links = async () => (await db.collection("businesses").doc(SC_BIZ)
      .get()).data().staffParkingLinks || {};

  before(async () => {
    const user = (id, fields) => db.collection("users").doc(id).set({
      fullName: id, email: `${id}@example.test`, ...fields});
    await Promise.all([
      db.collection("businesses").doc(SC_BIZ).set({
        name: "Staff credit lot", status: "approved", ownerUid: SC_OWNER,
        enabledServices: ["carParking"],
      }),
      user(SC_OWNER, {role: "businessOwner", businessId: SC_BIZ}),
      user(SC_LEDGER, {role: "staff", businessId: SC_BIZ,
        businessPermissions: ["ledger"]}),
      user(SC_PARKER, {role: "staff", businessId: SC_BIZ,
        businessPermissions: ["parking"]}),
      user(SC_PAYER, {role: "staff", businessId: SC_BIZ,
        businessPermissions: ["parking"], fullName: "Abdoulaye Sow"}),
      user(SC_OUTSIDER, {role: "staff", businessId: "another-biz",
        businessPermissions: ["ledger"]}),
      user(SC_CUSTOMER, {role: "customer"}),
      user(PLATFORM, {role: "admin", adminRole: "superAdmin"}),
      // $448.31 paid out of pocket over two months; a voided row and
      // another business's row never count.
      db.collection("lotExpenseEntries").doc("sc-e1").set({
        businessId: SC_BIZ, paidByStaffId: SC_PAYER, amountCents: 30000,
        month: "2026-09", voided: false}),
      db.collection("lotExpenseEntries").doc("sc-e2").set({
        businessId: SC_BIZ, paidByStaffId: SC_PAYER, amountCents: 14831,
        month: "2026-10", voided: false}),
      db.collection("lotExpenseEntries").doc("sc-e3").set({
        businessId: SC_BIZ, paidByStaffId: SC_PAYER, amountCents: 50000,
        month: "2026-10", voided: true}),
      db.collection("lotExpenseEntries").doc("sc-e4").set({
        businessId: "another-biz", paidByStaffId: SC_PAYER,
        amountCents: 50000, month: "2026-10", voided: false}),
    ]);
  });

  it("the owner links a staff member, and unlinks them", async () => {
    const out = await link(SC_OWNER);
    assert.equal(out.success, true);
    const stored = (await links())[SC_PAYER];
    assert.equal(stored.customerKey, "phone:2015550101");
    assert.equal(stored.customerName, "Abdoulaye Sow");
    assert.equal(stored.customerPhone, "201-555-0101");
    assert.equal(stored.linkedByUid, SC_OWNER);
    assert.ok(stored.linkedAtMs > 0);

    await link(SC_OWNER, {customerKey: "", customerName: "",
      customerPhone: ""});
    assert.equal((await links())[SC_PAYER], undefined);
    const audit = await db.collection("lotLedgerAudit")
        .where("entityId", "==", SC_PAYER).get();
    assert.deepEqual(audit.docs.map((d) => d.data().action).sort(),
        ["linked", "unlinked"]);

    // A platform admin may link too.
    await link(PLATFORM);
    assert.equal((await links())[SC_PAYER].linkedByUid, PLATFORM);
  });

  it("refuses staff linking, even with the ledger permission", async () => {
    await assert.rejects(link(SC_LEDGER),
        refusal("permission-denied", "link_owner_only"));
    await assert.rejects(link(SC_OUTSIDER),
        (error) => error.code === "permission-denied");
    await assert.rejects(link(SC_CUSTOMER),
        (error) => error.code === "permission-denied");
  });

  it("refuses linking someone not on the staff", async () => {
    for (const staffId of [SC_OUTSIDER, SC_CUSTOMER, "nobody-at-all", ""]) {
      await assert.rejects(link(SC_OWNER, {staffId}),
          refusal("failed-precondition", "staff_not_member"));
    }
    await assert.rejects(link(SC_OWNER, {customerKey: "2015550101"}),
        refusal("invalid-argument", "link_customer_invalid"));
  });

  it("records a payback up to what is owed, then voids it once", async () => {
    const out = await repay(SC_LEDGER, {amountCents: 4831,
      paidAt: "2026-09-30", givenByStaffId: SC_OWNER});
    assert.equal(out.success, true);
    assert.equal(out.month, "2026-09");
    assert.equal(out.creditCents, 40000);
    const row = (await db.collection("staffExpenseRepayments")
        .doc(out.repaymentId).get()).data();
    assert.equal(row.businessId, SC_BIZ);
    assert.equal(row.staffId, SC_PAYER);
    assert.equal(row.amountCents, 4831);
    assert.equal(row.month, "2026-09");
    assert.equal(row.method, "cash");
    assert.equal(row.givenByStaffId, SC_OWNER);
    assert.equal(row.recordedByUid, SC_LEDGER);
    assert.equal(row.note, "from the till");
    assert.equal(row.voided, false);
    assert.equal(row.paidAt.toDate().toISOString(),
        "2026-09-30T12:00:00.000Z");
    assert.ok(row.createdAt);

    // $400.00 left: one cent more is refused, the rest is fine.
    await assert.rejects(repay(SC_OWNER, {amountCents: 40001}),
        refusal("failed-precondition", "repayment_exceeds_credit"));
    const rest = await repay(SC_OWNER, {amountCents: 40000,
      method: "zelle"});
    assert.equal(rest.creditCents, 0);
    await assert.rejects(repay(SC_OWNER, {amountCents: 1}),
        refusal("failed-precondition", "repayment_exceeds_credit"));

    // Voiding gives the credit back; the row stays.
    await voidRepay(SC_LEDGER, rest.repaymentId);
    const voided = (await db.collection("staffExpenseRepayments")
        .doc(rest.repaymentId).get()).data();
    assert.equal(voided.voided, true);
    assert.equal(voided.voidedByUid, SC_LEDGER);
    assert.ok(voided.voidedAt);
    await assert.rejects(voidRepay(SC_OWNER, rest.repaymentId),
        refusal("failed-precondition", "repayment_voided"));
    const again = await repay(SC_OWNER, {amountCents: 40000});
    assert.equal(again.creditCents, 0);
    await voidRepay(SC_OWNER, again.repaymentId);

    const audit = await db.collection("lotLedgerAudit")
        .where("businessId", "==", SC_BIZ)
        .where("entityType", "==", "staff_repayment").get();
    assert.deepEqual(audit.docs.map((d) => d.data().action).sort(),
        ["recorded", "recorded", "recorded", "voided", "voided"]);
  });

  it("refuses a bad amount, method or date", async () => {
    for (const amountCents of [0, -5, 12.5, "1000"]) {
      await assert.rejects(repay(SC_OWNER, {amountCents}),
          refusal("invalid-argument", "repayment_amount_invalid"));
    }
    await assert.rejects(repay(SC_OWNER, {method: "card"}),
        refusal("invalid-argument", "repayment_method_invalid"));
    await assert.rejects(repay(SC_OWNER, {paidAt: "2999-01-01"}),
        refusal("invalid-argument", "repayment_date_invalid"));
    await assert.rejects(repay(SC_OWNER, {givenByStaffId: SC_OUTSIDER}),
        refusal("failed-precondition", "staff_not_member"));
    // Someone who never paid an expense is owed nothing.
    await assert.rejects(repay(SC_OWNER, {staffId: SC_PARKER}),
        refusal("failed-precondition", "repayment_exceeds_credit"));
  });

  it("needs the ledger permission", async () => {
    await assert.rejects(repay(SC_PARKER),
        (error) => error.code === "permission-denied");
    await assert.rejects(repay(SC_OUTSIDER),
        (error) => error.code === "permission-denied");
    const out = await repay(SC_LEDGER, {amountCents: 1});
    await assert.rejects(voidRepay(SC_PARKER, out.repaymentId),
        (error) => error.code === "permission-denied");
    await voidRepay(SC_LEDGER, out.repaymentId);
  });

  it("refuses voiding a payback that is not this business's", async () => {
    await assert.rejects(voidRepay(SC_OWNER, "no-such-payback"),
        refusal("not-found", "repayment_not_found"));
    await db.collection("staffExpenseRepayments").doc("sc-foreign").set({
      businessId: "another-biz", staffId: SC_PAYER, amountCents: 5,
      month: "2026-10", voided: false});
    await assert.rejects(voidRepay(SC_OWNER, "sc-foreign"),
        refusal("not-found", "repayment_not_found"));
  });

  it("an unknown action is refused; no action still edits", async () => {
    await assert.rejects(run("updateLotExpenseEntry", SC_OWNER,
        {action: "delete_everything", businessId: SC_BIZ}),
    refusal("invalid-argument", "staff_action_invalid"));
    await assert.rejects(run("updateLotExpenseEntry", SC_OWNER,
        {entryId: "no-such-entry", changes: {}}),
    (error) => error.code === "not-found");
  });
});
