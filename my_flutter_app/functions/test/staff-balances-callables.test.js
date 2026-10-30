"use strict";

// Staff balances (docs/STAFF_BALANCES.md) against the Firestore and Storage
// emulators: the Business account accepted wherever money is recorded with a
// receiver, the handover lifecycle and who may do what, and the
// staff_balances answer end to end on seeded data.
//
// Run through `npm run test:staff-balances` (firebase emulators:exec).

const assert = require("node:assert/strict");
const {before, describe, it} = require("node:test");
const admin = require("firebase-admin");

// This suite writes with ADMIN credentials: never against a real project.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
      "Run this through `npm run test:staff-balances` (firebase " +
      "emulators:exec). A direct node --test run would write its fixtures " +
      "into the real project.");
}

process.env.FUNCTIONS_EMULATOR = "true";

const functions = require("../index");
const {parkingMonthSummary} = require("../parking_month_statement");
const zelleCheck = require("../zelle_check");
admin.auth().getUser = async (uid) => ({
  uid,
  email: `${uid}@example.test`,
  emailVerified: true,
});
const db = admin.firestore();
const bucket = admin.storage().bucket(
    `${process.env.GCLOUD_PROJECT}.firebasestorage.app`);

const BIZ = "sbal-biz";
const OTHER_BIZ = "sbal-other-biz";
const OWNER = "sbal-owner";
const MO = "sbal-mo";
const FA = "sbal-fa";
const LIMITED = "sbal-limited";
const OUTSIDER = "sbal-outsider";
const CUSTOMER = "sbal-customer";
const PLATFORM = "sbal-platform-admin";
const BANK = "business_account";

const call = (name, uid, data) => functions[name].run({
  auth: {uid, token: {}}, data: {businessId: BIZ, ...data},
});
const act = (uid, action, data = {}) =>
  call("updateLotExpenseEntry", uid, {action, ...data});

const refusal = (code, reason) => (error) => {
  assert.equal(error.code, code, error.message);
  assert.equal(error.details?.reason, reason, error.message);
  return true;
};
const denied = (error) => error.code === "permission-denied";
// The container-style refusals list their code in `details.reasons`.
const notOnTeam = (error) => error.code === "invalid-argument" &&
  error.details?.reasons?.[0] === "received_by_invalid";

const handoverOf = async (id) =>
  (await db.collection("staffHandovers").doc(id).get()).data();
const auditOf = async (id) => (await db.collection("lotLedgerAudit")
    .where("entityId", "==", id).get()).docs
    .map((d) => d.data()).filter((d) => d.entityType === "staff_handover")
    .map((d) => d.action).sort();
const rowOf = (answer, staffId) =>
  answer.staff.find((row) => row.staffId === staffId);

before(async () => {
  const user = (id, fields) => db.collection("users").doc(id).set({
    fullName: id, email: `${id}@example.test`, ...fields});
  const perms = ["parking", "ledger", "containers", "inventory", "invoices"];
  await Promise.all([
    db.collection("businesses").doc(BIZ).set({
      name: "Balances Lot", status: "approved", ownerUid: OWNER,
      enabledServices: ["carParking", "inventory"],
    }),
    db.collection("businesses").doc(OTHER_BIZ).set({
      name: "Another Lot", status: "approved", ownerUid: "sbal-other-owner",
    }),
    user(OWNER, {role: "businessOwner", businessId: BIZ,
      fullName: "Alhoussaine Barry"}),
    user(MO, {role: "staff", businessId: BIZ, businessPermissions: perms,
      fullName: "Mamadou Diallo"}),
    user(FA, {role: "staff", businessId: BIZ, businessPermissions: perms,
      fullName: "Fatou Ba"}),
    user(LIMITED, {role: "staff", businessId: BIZ,
      businessPermissions: ["barrels"], fullName: "Barrels Only"}),
    user(OUTSIDER, {role: "staff", businessId: OTHER_BIZ,
      businessPermissions: perms}),
    user(CUSTOMER, {role: "customer"}),
    user(PLATFORM, {role: "admin", adminRole: "superAdmin"}),
  ]);
});

describe("the Business account is accepted as the receiver", () => {
  it("parking: a partial payment, mark-paid and received link", async () => {
    const car = (extra = {}) => ({
      businessId: BIZ, source: "business", paymentMethod: "direct",
      paymentStatus: "awaiting_direct_payment", status: "reserved",
      parkingDate: "2026-09-01", parkingEndDate: "2026-09-10",
      amountDueCents: 10000, dailyRate: 10, customerName: "Walk In",
      customerPhone: "2015550111", ...extra,
    });
    await db.collection("parkedCars").doc("sbal-car-1").set(car());
    const partial = await call("recordBusinessParkingPartialPayment", OWNER, {
      entryId: "sbal-car-1", amountCents: 3000, receivedVia: "zelle",
      receivedByStaffId: BANK,
    });
    assert.equal(partial.success, true);
    const stored = (await db.collection("parkedCars").doc("sbal-car-1")
        .get()).data();
    assert.equal(stored.parkingPayments[0].receivedByStaffId, BANK);
    assert.equal(stored.parkingPayments[0].receivedVia, "zelle");
    assert.equal(stored.receivedByStaffId, BANK);

    await db.collection("parkedCars").doc("sbal-car-2").set(car());
    await call("markBusinessParkingPaid", OWNER, {
      entryId: "sbal-car-2", receivedVia: "zelle", receivedByStaffId: BANK,
    });
    const marked = (await db.collection("parkedCars").doc("sbal-car-2")
        .get()).data();
    assert.equal(marked.paymentStatus, "paid");
    assert.equal(marked.receivedByStaffId, BANK);

    await db.collection("parkedCars").doc("sbal-car-3").set(car({
      paymentMethod: "payment_link", paymentStatus: "awaiting_link"}));
    await call("recordParkingPaymentReceived", OWNER, {
      parkedCarId: "sbal-car-3", receivedByStaffId: BANK,
    });
    const received = (await db.collection("parkedCars").doc("sbal-car-3")
        .get()).data();
    assert.equal(received.paymentStatus, "succeeded");
    assert.equal(received.receivedByStaffId, BANK);
  });

  it("lot activities: an instalment and the rest in one go", async () => {
    await db.collection("lotActivities").doc("sbal-act-1").set({
      businessId: BIZ, feeCents: 5000, paymentMethod: "direct",
      paymentStatus: "awaiting_direct", amountPaidCents: 0,
      customerName: "Walk In", voided: false,
    });
    await call("recordLotActivityInstalment", OWNER, {
      activityId: "sbal-act-1", amountCents: 2000, receivedVia: "zelle",
      receivedByStaffId: BANK,
    });
    const rows = (await db.collection("lotActivityPayments")
        .where("activityId", "==", "sbal-act-1").get()).docs
        .map((d) => d.data());
    assert.equal(rows.length, 1);
    assert.equal(rows[0].receivedByStaffId, BANK);
    assert.equal(rows[0].receivedVia, "zelle");
    await call("recordLotActivityDirectPayment", OWNER, {
      activityId: "sbal-act-1", receivedVia: "zelle", receivedByStaffId: BANK,
    });
    const done = (await db.collection("lotActivities").doc("sbal-act-1")
        .get()).data();
    assert.equal(done.paymentStatus, "succeeded");
    assert.equal(done.receivedByStaffId, BANK);
  });

  it("packages: a payment, the money at drop-off, and at delivery",
      async () => {
        const people = {ownerKind: "customer", customerName: "Fatou Diallo",
          customerPhone: "+16465550100", receiverName: "Mariama Bah",
          receiverPhone: "+224620000000", destinationCountryId: "gn",
          destinationCountryName: "Guinea"};
        const paid = (lineId) => db.collection("containerLinePayments")
            .where("lineId", "==", lineId).get()
            .then((snap) => snap.docs.map((d) => d.data()));
        const {lineId} = await call("addWaitingPackage", OWNER, {
          kind: "barrels", quantity: 2, priceCents: 15000, ...people});
        const first = await call("recordContainerLinePayment", OWNER, {
          lineId, amountCents: 5000, method: "zelle",
          receivedByStaffId: BANK});
        assert.equal(first.paidCents, 5000);
        const [row] = await paid(lineId);
        assert.equal(row.receivedByStaffId, BANK);
        assert.equal(row.recordedByStaffId, OWNER);
        // The history names it.
        const history = (await db.collection("lotLedgerAudit")
            .where("entityId", "==", lineId).where("action", "==", "payment")
            .get()).docs.map((d) => d.data().summary);
        assert.ok(history.some((t) => /by Business account/.test(t)),
            history.join(" | "));
        // Someone else's staff and a made-up name are still refused.
        for (const stranger of [OUTSIDER, "no-such-person"]) {
          await assert.rejects(call("recordContainerLinePayment", OWNER, {
            lineId, amountCents: 100, method: "cash",
            receivedByStaffId: stranger}),
          notOnTeam);
        }

        const dropped = await call("addWaitingPackage", OWNER, {
          kind: "barrels", quantity: 1, priceCents: 8000, ...people,
          payment: {amountCents: 3000, method: "zelle",
            receivedByStaffId: BANK}});
        assert.equal((await paid(dropped.lineId))[0].receivedByStaffId, BANK);

        // The money collected at delivery: the agent unless another is named.
        const {containerId} = await call("createContainer", OWNER, {
          label: "Balances box", destinationCountryId: "gn",
          destinationCountryName: "Guinea"});
        const line = await call("addContainerLine", OWNER, {containerId,
          line: {...people, pieces: [{kind: "barrel", priceCents: 6000},
            {kind: "barrel", priceCents: 4000}]}});
        await call("setContainerStatus", OWNER,
            {containerId, status: "shipped"});
        await call("setContainerStatus", OWNER,
            {containerId, status: "arrived"});
        await assert.rejects(call("updateContainerLine", OWNER, {
          lineId: line.lineId, action: "deliver", collectedCents: 1000,
          acknowledgeBalance: true, receivedByStaffId: OUTSIDER}),
        notOnTeam);
        await call("updateContainerLine", OWNER, {
          lineId: line.lineId, action: "deliver", collectedCents: 4000,
          acknowledgeBalance: true, receivedByStaffId: BANK});
        const [delivered] = await paid(line.lineId);
        assert.equal(delivered.amountCents, 4000);
        assert.equal(delivered.receivedByStaffId, BANK);
        assert.equal(delivered.recordedByStaffId, OWNER);
      });

  it("inventory: a sale, a sale's credit payment, and a switch", async () => {
    const item = await call("createInventoryItem", OWNER, {name: "Shea",
      priceCents: 1000, costCents: 400, quantity: 20, lowStockAt: 2});
    let serial = 0;
    const sale = (extra = {}) => call("recordInventorySale", OWNER, {
      clientRequestId: `sbal-req-${Date.now()}-${++serial}`,
      paymentMethod: "zelle",
      lines: [{itemId: item.itemId, quantity: 2, soldPriceCents: 1000}],
      ...extra,
    });
    const made = await sale({receivedByStaffId: BANK});
    const stored = (await db.collection("inventorySales").doc(made.saleId)
        .get()).data();
    assert.equal(stored.receivedByStaffId, BANK);
    assert.equal(stored.paidNowCents, 2000);
    await assert.rejects(sale({receivedByStaffId: OUTSIDER}),
        (error) => error.details?.reason === "received_by_invalid");

    // The credit's collector is always a person.
    await assert.rejects(sale({receivedByStaffId: BANK, credit: {
      paidNowCents: 500, customerName: "Aminata",
      customerPhone: "+224620000000", collectorStaffId: BANK}}),
    refusal("invalid-argument", "collector_invalid"));
    const credit = await sale({credit: {paidNowCents: 500,
      customerName: "Aminata", customerPhone: "+224620000000",
      collectorStaffId: MO}});
    const payment = await call("recordInventoryCreditPayment", OWNER, {
      saleId: credit.saleId, amountCents: 700, method: "zelle",
      receivedByStaffId: BANK});
    const row = (await db.collection("inventoryCreditPayments")
        .doc(payment.paymentId).get()).data();
    assert.equal(row.receivedByStaffId, BANK);

    // A credit nothing was collected on can become a paid sale.
    const untouched = await sale({credit: {paidNowCents: 0,
      customerName: "Aminata", customerPhone: "+224620000000",
      collectorStaffId: MO}});
    const switched = await call("switchInventorySalePayment", OWNER, {
      saleId: untouched.saleId, clientRequestId: `sbal-sw-${Date.now()}`,
      to: "paid", paymentMethod: "zelle", receivedByStaffId: BANK});
    assert.equal(switched.success, true);
    const after = (await db.collection("inventorySales")
        .doc(untouched.saleId).get()).data();
    assert.equal(after.receivedByStaffId, BANK);
  });

  it("invoices: a payment recorded for the Business account", async () => {
    const made = await call("createInvoice", OWNER, {
      title: "Towing", customerName: "Ibrahima",
      customerPhone: "2015550177"});
    await call("addInvoiceLine", OWNER, {invoiceId: made.invoiceId,
      line: {description: "Towing", quantity: 1, unitPriceCents: 9000}});
    const mine = await call("recordInvoicePayment", OWNER, {
      invoiceId: made.invoiceId, payment: {amountCents: 1000,
        method: "cash"}});
    const bank = await call("recordInvoicePayment", OWNER, {
      invoiceId: made.invoiceId, payment: {amountCents: 2000,
        method: "zelle", receivedByStaffId: BANK}});
    const other = await call("recordInvoicePayment", OWNER, {
      invoiceId: made.invoiceId, payment: {amountCents: 500,
        method: "cash", receivedByStaffId: MO}});
    const receiver = async (id) => (await db.collection("invoicePayments")
        .doc(id).get()).data().receivedByStaffId;
    assert.equal(await receiver(mine.paymentId), OWNER);
    assert.equal(await receiver(bank.paymentId), BANK);
    assert.equal(await receiver(other.paymentId), MO);
    await assert.rejects(call("recordInvoicePayment", OWNER, {
      invoiceId: made.invoiceId, payment: {amountCents: 100, method: "cash",
        receivedByStaffId: OUTSIDER}}),
    notOnTeam);
  });
});

describe("handovers: the lifecycle", () => {
  const record = (uid, extra = {}) => act(uid, "record_handover", {
    toId: FA, amountCents: 2000, method: "cash", note: "end of day",
    ...extra,
  });

  it("records a pending handover that waits for the receiver", async () => {
    const out = await record(MO);
    assert.equal(out.success, true);
    assert.equal(out.status, "pending");
    const row = await handoverOf(out.handoverId);
    assert.equal(row.businessId, BIZ);
    assert.equal(row.kind, "handover");
    assert.equal(row.fromStaffId, MO);
    assert.equal(row.toId, FA);
    assert.equal(row.amountCents, 2000);
    assert.equal(row.method, "cash");
    assert.equal(row.note, "end of day");
    assert.equal(row.proofPath, "");
    assert.equal(row.status, "pending");
    assert.equal(row.createdByUid, MO);
    assert.ok(row.createdAt);
    assert.equal(row.confirmedAt, null);
    assert.deepEqual(await auditOf(out.handoverId), ["recorded"]);
  });

  it("refuses a handover to yourself, a bad amount, method or receiver",
      async () => {
        await assert.rejects(record(MO, {toId: MO}),
            refusal("invalid-argument", "handover_to_self"));
        for (const amountCents of [0, -5, 12.5, "2000", null]) {
          await assert.rejects(record(MO, {amountCents}),
              refusal("invalid-argument", "handover_amount_invalid"));
        }
        await assert.rejects(record(MO, {method: "card"}),
            refusal("invalid-argument", "handover_method_invalid"));
        for (const toId of [OUTSIDER, CUSTOMER, "nobody-at-all", ""]) {
          await assert.rejects(record(MO, {toId}),
              refusal("failed-precondition", "handover_receiver_invalid"));
        }
        // To the Business account is fine, and so is the owner.
        await record(MO, {toId: BANK});
        await record(MO, {toId: OWNER});
      });

  it("is for the business's own people", async () => {
    await assert.rejects(record(OUTSIDER), denied);
    await assert.rejects(record(CUSTOMER), denied);
    // A platform admin is no one's giver: they hold nothing.
    await assert.rejects(record(PLATFORM),
        refusal("failed-precondition", "staff_not_member"));
  });

  it("takes a slip from the giver's own folder, once it is stored",
      async () => {
        const path = `staffHandoverProofs/${BIZ}/${MO}/slip-00000001.jpg`;
        await assert.rejects(record(MO, {proofPath: path}),
            refusal("invalid-argument", "handover_proof_invalid"));
        await bucket.file(path).save(Buffer.alloc(2048, 1),
            {contentType: "image/jpeg"});
        const out = await record(MO, {proofPath: path});
        assert.equal((await handoverOf(out.handoverId)).proofPath, path);
        // Someone else's folder, another business, a package photo, a file
        // that is not an image or too big.
        const others = [
          `staffHandoverProofs/${BIZ}/${FA}/slip-00000002.jpg`,
          `staffHandoverProofs/${OTHER_BIZ}/${MO}/slip-00000003.jpg`,
          `packagePhotos/${BIZ}/${MO}/slip-00000004.jpg`,
          `staffHandoverProofs/${BIZ}/${MO}/slip-00000005.jpg`,
          `staffHandoverProofs/${BIZ}/${MO}/slip-00000006.jpg`,
        ];
        for (const other of others) {
          await bucket.file(other).save(Buffer.alloc(2048, 1),
              {contentType: other.endsWith("05.jpg") ?
                "application/pdf" : "image/jpeg"});
        }
        await bucket.file(others[4]).save(Buffer.alloc(2 * 1024 * 1024 + 1, 1),
            {contentType: "image/jpeg"});
        for (const other of others) {
          await assert.rejects(record(MO, {proofPath: other}),
              refusal("invalid-argument", "handover_proof_invalid"), other);
        }
      });

  it("only the receiver confirms; it then cannot be answered again",
      async () => {
        const {handoverId} = await record(MO);
        for (const uid of [MO, OWNER, LIMITED]) {
          await assert.rejects(act(uid, "confirm_handover", {handoverId}),
              refusal("permission-denied", "handover_not_receiver"));
          await assert.rejects(act(uid, "decline_handover", {handoverId}),
              refusal("permission-denied", "handover_not_receiver"));
        }
        await assert.rejects(act(OUTSIDER, "confirm_handover", {handoverId}),
            denied);
        assert.equal((await handoverOf(handoverId)).status, "pending");
        const out = await act(FA, "confirm_handover", {handoverId});
        assert.equal(out.status, "confirmed");
        const row = await handoverOf(handoverId);
        assert.equal(row.status, "confirmed");
        assert.equal(row.confirmedByUid, FA);
        assert.ok(row.confirmedAt);
        await assert.rejects(act(FA, "confirm_handover", {handoverId}),
            refusal("failed-precondition", "handover_not_pending"));
        await assert.rejects(act(FA, "decline_handover", {handoverId}),
            refusal("failed-precondition", "handover_not_pending"));
        assert.deepEqual(await auditOf(handoverId), ["confirmed", "recorded"]);
      });

  it("declining keeps the row and says why", async () => {
    const {handoverId} = await record(MO);
    const out = await act(FA, "decline_handover",
        {handoverId, note: "not received"});
    assert.equal(out.status, "declined");
    const row = await handoverOf(handoverId);
    assert.equal(row.status, "declined");
    assert.equal(row.declinedByUid, FA);
    assert.equal(row.declineNote, "not received");
    assert.ok(row.declinedAt);
    await assert.rejects(act(FA, "confirm_handover", {handoverId}),
        refusal("failed-precondition", "handover_not_pending"));
    assert.deepEqual(await auditOf(handoverId), ["declined", "recorded"]);
  });

  it("the Business account is confirmed by the owner (or an admin) only",
      async () => {
        const {handoverId} = await record(MO, {toId: BANK});
        for (const uid of [MO, FA, LIMITED]) {
          await assert.rejects(act(uid, "confirm_handover", {handoverId}),
              refusal("permission-denied", "handover_not_receiver"));
        }
        const out = await act(OWNER, "confirm_handover", {handoverId});
        assert.equal(out.status, "confirmed");
        const viaAdmin = await record(FA, {toId: BANK});
        await act(PLATFORM, "confirm_handover",
            {handoverId: viaAdmin.handoverId});
        assert.equal((await handoverOf(viaAdmin.handoverId)).confirmedByUid,
            PLATFORM);
      });

  it("the giver voids while pending; the owner any time; never twice",
      async () => {
        const pending = await record(MO);
        // Someone who is neither the giver nor the owner cannot.
        await assert.rejects(act(FA, "void_handover",
            {handoverId: pending.handoverId}),
        refusal("permission-denied", "handover_void_not_allowed"));
        const out = await act(MO, "void_handover",
            {handoverId: pending.handoverId, reason: "wrong person"});
        assert.equal(out.status, "voided");
        const row = await handoverOf(pending.handoverId);
        assert.equal(row.status, "voided");
        assert.equal(row.voidedByUid, MO);
        assert.equal(row.voidReason, "wrong person");
        assert.ok(row.voidedAt);
        await assert.rejects(act(OWNER, "void_handover",
            {handoverId: pending.handoverId}),
        refusal("failed-precondition", "handover_voided"));
        // A voided handover cannot be confirmed.
        await assert.rejects(act(FA, "confirm_handover",
            {handoverId: pending.handoverId}),
        refusal("failed-precondition", "handover_not_pending"));

        const confirmed = await record(MO);
        await act(FA, "confirm_handover", {handoverId: confirmed.handoverId});
        await assert.rejects(act(MO, "void_handover",
            {handoverId: confirmed.handoverId}),
        refusal("permission-denied", "handover_void_not_allowed"));
        await act(OWNER, "void_handover", {handoverId: confirmed.handoverId});
        assert.equal((await handoverOf(confirmed.handoverId)).status,
            "voided");
        assert.deepEqual(await auditOf(confirmed.handoverId),
            ["confirmed", "recorded", "voided"]);
        // Never deleted.
        assert.ok((await db.collection("staffHandovers")
            .doc(confirmed.handoverId).get()).exists);
      });

  it("refuses an unknown handover and another business's", async () => {
    await db.collection("staffHandovers").doc("sbal-foreign").set({
      businessId: OTHER_BIZ, fromStaffId: "x", toId: FA, amountCents: 100,
      status: "pending"});
    for (const action of ["confirm_handover", "decline_handover",
      "void_handover"]) {
      for (const handoverId of ["no-such-handover", "sbal-foreign", ""]) {
        await assert.rejects(act(OWNER, action, {handoverId}),
            refusal("not-found", "handover_not_found"));
      }
    }
    assert.equal((await handoverOf("sbal-foreign")).status, "pending");
  });

  it("opening amounts are the owner's, one step, already confirmed",
      async () => {
        const opening = (uid, extra = {}) => act(uid, "record_opening", {
          staffId: MO, amountCents: 5000, note: "before this existed",
          ...extra,
        });
        for (const uid of [MO, FA, LIMITED]) {
          await assert.rejects(opening(uid),
              refusal("permission-denied", "opening_owner_only"));
        }
        await assert.rejects(opening(OUTSIDER), denied);
        for (const amountCents of [0, -1, 1.5, "5000"]) {
          await assert.rejects(opening(OWNER, {amountCents}),
              refusal("invalid-argument", "opening_amount_invalid"));
        }
        for (const staffId of [OUTSIDER, CUSTOMER, BANK, "nobody", ""]) {
          await assert.rejects(opening(OWNER, {staffId}),
              refusal("failed-precondition", "staff_not_member"));
        }
        const out = await opening(OWNER);
        assert.equal(out.status, "confirmed");
        const row = await handoverOf(out.handoverId);
        assert.equal(row.kind, "opening");
        assert.equal(row.fromStaffId, MO);
        assert.equal(row.toId, BANK);
        assert.equal(row.amountCents, 5000);
        assert.equal(row.status, "confirmed");
        assert.equal(row.createdByUid, OWNER);
        assert.equal(row.confirmedByUid, OWNER);
        assert.ok(row.confirmedAt);
        assert.deepEqual(await auditOf(out.handoverId), ["opening"]);
        // A platform admin counts as the owner.
        await opening(PLATFORM, {staffId: FA});
      });

  it("an unknown action is still refused", async () => {
    await assert.rejects(act(OWNER, "delete_everything"),
        refusal("invalid-argument", "staff_action_invalid"));
  });
});

describe("staff_balances: the answer end to end", () => {
  const E_BIZ = "sbal-e2e-biz";
  const E_OWNER = "sbal-e2e-owner";
  const E_MO = "sbal-e2e-mo";
  const E_FA = "sbal-e2e-fa";
  const E_LIMITED = "sbal-e2e-limited";
  const E_OUTSIDER = "sbal-e2e-outsider";
  const eAct = (uid, action, data = {}) => functions.updateLotExpenseEntry.run({
    auth: {uid, token: {}}, data: {action, businessId: E_BIZ, ...data}});
  const balances = (uid = E_OWNER) => eAct(uid, "staff_balances");

  before(async () => {
    const user = (id, fields) => db.collection("users").doc(id).set({
      fullName: id, email: `${id}@example.test`, ...fields});
    const perms = ["parking", "ledger", "containers", "inventory"];
    await Promise.all([
      db.collection("businesses").doc(E_BIZ).set({
        name: "Balances E2E", status: "approved", ownerUid: E_OWNER,
        enabledServices: ["carParking"],
      }),
      user(E_OWNER, {role: "businessOwner", businessId: E_BIZ,
        fullName: "Alhoussaine Barry"}),
      user(E_MO, {role: "staff", businessId: E_BIZ,
        businessPermissions: perms, fullName: "Mamadou Diallo"}),
      user(E_FA, {role: "staff", businessId: E_BIZ,
        businessPermissions: perms, fullName: "Fatou Ba"}),
      user(E_LIMITED, {role: "staff", businessId: E_BIZ,
        businessPermissions: ["barrels"], fullName: "Barrels Only"}),
      user(E_OUTSIDER, {role: "staff", businessId: BIZ,
        businessPermissions: perms}),
      // Parking: instalments to Mo and to the Business account; a voided car
      // and an online payment hold nothing. The open stay owes (it runs up
      // $100 a day from January); Fatou parks it and paid expenses.
      db.collection("parkedCars").doc("e2e-car-1").set({
        businessId: E_BIZ, parkingDate: "2026-09-01",
        parkingEndDate: "2026-09-10", amountDueCents: 10000,
        amountPaidCents: 4000, receivedByStaffId: E_MO,
        parkingPayments: [
          {amountCents: 2500, receivedVia: "cash", receivedByStaffId: E_MO},
          {amountCents: 1500, receivedVia: "zelle",
            receivedByStaffId: BANK},
        ]}),
      db.collection("parkedCars").doc("e2e-car-2").set({
        businessId: E_BIZ, parkingDate: "2026-09-01", voided: true,
        amountPaidCents: 9000, receivedByStaffId: E_MO}),
      db.collection("parkedCars").doc("e2e-car-3").set({
        businessId: E_BIZ, parkingDate: "2026-09-01",
        paymentMethod: "payment_link", amountPaidCents: 7000,
        parkingPayments: [{amountCents: 7000, receivedVia: ""}]}),
      db.collection("parkedCars").doc("e2e-car-4").set({
        businessId: E_BIZ, parkingDate: "2026-01-01", dailyRate: 100,
        source: "business", paymentMethod: "direct", status: "reserved",
        paymentStatus: "awaiting_direct", customerName: "Fatou Ba",
        customerPhone: "201-555-0142"}),
      // Another business's money never counts.
      db.collection("parkedCars").doc("e2e-foreign").set({
        businessId: "someone-else", amountPaidCents: 99900,
        receivedByStaffId: E_MO}),
      db.collection("lotActivities").doc("e2e-act-1").set({
        businessId: E_BIZ, feeCents: 5000, paymentMethod: "direct",
        paymentStatus: "succeeded", receivedVia: "zelle",
        receivedByStaffId: E_FA}),
      db.collection("lotActivities").doc("e2e-act-2").set({
        businessId: E_BIZ, feeCents: 4000, voided: true}),
      db.collection("lotActivityPayments").doc("e2e-ap-1").set({
        businessId: E_BIZ, activityId: "e2e-act-2", amountCents: 4000,
        source: "cash", receivedByStaffId: E_MO}),
      db.collection("containerLinePayments").doc("e2e-cp-1").set({
        businessId: E_BIZ, lineId: "l1", amountCents: 7000, method: "cash",
        receivedByStaffId: E_MO, reverted: false}),
      db.collection("containerLinePayments").doc("e2e-cp-2").set({
        businessId: E_BIZ, lineId: "l1", amountCents: 1200, method: "cash",
        receivedByStaffId: E_MO, reverted: true}),
      db.collection("inventorySales").doc("e2e-sale-1").set({
        businessId: E_BIZ, totalCents: 3000, paidNowCents: 3000,
        paymentMethod: "cash", receivedByStaffId: E_FA, voided: false}),
      db.collection("invoicePayments").doc("e2e-ip-1").set({
        businessId: E_BIZ, invoiceId: "i1", amountCents: 1000,
        method: "check", receivedByStaffId: E_MO, reverted: false}),
      db.collection("lotExpenseEntries").doc("e2e-exp-1").set({
        businessId: E_BIZ, paidByStaffId: E_FA, amountCents: 5000,
        month: "2026-01", voided: false}),
      db.collection("lotExpenseEntries").doc("e2e-exp-2").set({
        businessId: E_BIZ, paidByStaffId: E_FA, amountCents: 9999,
        month: "2026-01", voided: true}),
    ]);
  });

  it("holds, by method, from every source; the bank's own is apart",
      async () => {
        const out = await balances();
        assert.deepEqual(Object.keys(out).sort(),
            ["asOfMs", "businessAccount", "pending", "staff"]);
        assert.ok(Math.abs(out.asOfMs - Date.now()) < 60000);
        assert.deepEqual(out.staff.map((r) => r.staffId),
            [E_OWNER, E_LIMITED, E_FA, E_MO]);
        assert.deepEqual(out.staff.map((r) => r.name), ["Alhoussaine Barry",
          "Barrels Only", "Fatou Ba", "Mamadou Diallo"]);
        const mo = rowOf(out, E_MO);
        assert.equal(mo.collectedCents, 10500);
        assert.deepEqual(mo.collectedByMethod, {cash: 9500, check: 1000});
        assert.equal(mo.heldCents, 10500);
        const fa = rowOf(out, E_FA);
        assert.equal(fa.collectedCents, 8000);
        assert.deepEqual(fa.collectedByMethod, {zelle: 5000, cash: 3000});
        assert.deepEqual(out.businessAccount,
            {receivedCents: 1500, pendingInCents: 0});
        assert.deepEqual(out.pending, []);
        // Nothing for the owner or the barrels-only staff member yet.
        for (const id of [E_OWNER, E_LIMITED]) {
          assert.equal(rowOf(out, id).netCents, 0);
        }
      });

  it("nets Fatou's parking bill with the expenses she paid", async () => {
    const out = await balances();
    const bills = parkingMonthSummary(
        [{id: "e2e-car-4", parkingDate: "2026-01-01", dailyRate: 100,
          source: "business", paymentMethod: "direct", status: "reserved",
          paymentStatus: "awaiting_direct", customerName: "Fatou Ba",
          customerPhone: "201-555-0142"}],
        zelleCheck.dateKeyIn(Date.now(), "America/New_York").slice(0, 7),
        new Date());
    const due = bills.customers[0].dueCents;
    assert.ok(due > 5000, `${due}`);
    // Nobody is linked yet: her $50.00 is owed to her whole.
    let fa = rowOf(out, E_FA);
    assert.equal(fa.parkingDueCents, 0);
    assert.equal(fa.expenseOwedToThemCents, 5000);
    assert.equal(fa.netCents, 8000 - 5000);
    // The owner links her to the customer; now it comes off the bill.
    await eAct(E_OWNER, "link_staff_parking", {staffId: E_FA,
      customerKey: "phone:2015550142", customerName: "Fatou Ba",
      customerPhone: "201-555-0142"});
    fa = rowOf(await balances(), E_FA);
    assert.equal(fa.parkingDueCents, due - 5000);
    assert.equal(fa.expenseCreditCents, 5000);
    assert.equal(fa.expenseOwedToThemCents, 0);
    assert.equal(fa.netCents, 8000 + due - 5000);
  });

  it("any member sees it; outsiders and customers do not", async () => {
    for (const uid of [E_OWNER, E_MO, E_FA, E_LIMITED]) {
      assert.equal((await balances(uid)).staff.length, 4, uid);
    }
    await assert.rejects(balances(E_OUTSIDER), denied);
    await assert.rejects(balances(CUSTOMER), denied);
    await assert.rejects(eAct(E_OWNER, "staff_balances",
        {businessId: "no-such-business"}), (error) =>
      error.code === "permission-denied" || error.code === "not-found");
    // A platform admin may look too.
    assert.equal((await balances(PLATFORM)).staff.length, 4);
  });

  it("a handover waits, then moves the money once confirmed", async () => {
    const before = await balances();
    const moBefore = rowOf(before, E_MO);
    const faBefore = rowOf(before, E_FA);
    const made = await eAct(E_MO, "record_handover", {toId: E_FA,
      amountCents: 4000, method: "cash", note: "Friday"});
    let out = await balances();
    // Pending: shown apart, held unchanged, and listed for the receiver.
    assert.equal(rowOf(out, E_MO).pendingOutCents, 4000);
    assert.equal(rowOf(out, E_FA).pendingInCents, 4000);
    assert.equal(rowOf(out, E_MO).heldCents, moBefore.heldCents);
    assert.equal(rowOf(out, E_FA).heldCents, faBefore.heldCents);
    assert.equal(out.pending.length, 1);
    assert.equal(out.pending[0].id, made.handoverId);
    assert.equal(out.pending[0].fromName, "Mamadou Diallo");
    assert.equal(out.pending[0].toName, "Fatou Ba");
    assert.equal(out.pending[0].amountCents, 4000);
    assert.equal(out.pending[0].note, "Friday");
    assert.ok(out.pending[0].createdAtMs > 0);

    await eAct(E_FA, "confirm_handover", {handoverId: made.handoverId});
    out = await balances();
    assert.equal(rowOf(out, E_MO).heldCents, moBefore.heldCents - 4000);
    assert.equal(rowOf(out, E_MO).handedOutCents, 4000);
    assert.equal(rowOf(out, E_FA).heldCents, faBefore.heldCents + 4000);
    assert.equal(rowOf(out, E_FA).receivedFromOthersCents, 4000);
    assert.equal(rowOf(out, E_MO).pendingOutCents, 0);
    assert.deepEqual(out.pending, []);

    // To the Business account: confirmed by the owner.
    const bank = await eAct(E_MO, "record_handover", {toId: BANK,
      amountCents: 1500, method: "deposit"});
    out = await balances();
    assert.deepEqual(out.businessAccount,
        {receivedCents: 1500, pendingInCents: 1500});
    await eAct(E_OWNER, "confirm_handover", {handoverId: bank.handoverId});
    out = await balances();
    assert.deepEqual(out.businessAccount,
        {receivedCents: 3000, pendingInCents: 0});
    assert.equal(rowOf(out, E_MO).heldCents, moBefore.heldCents - 5500);

    // Declined and voided ones move nothing.
    const declined = await eAct(E_MO, "record_handover", {toId: E_FA,
      amountCents: 900, method: "cash"});
    await eAct(E_FA, "decline_handover", {handoverId: declined.handoverId});
    const voided = await eAct(E_MO, "record_handover", {toId: E_FA,
      amountCents: 800, method: "cash"});
    await eAct(E_MO, "void_handover", {handoverId: voided.handoverId});
    out = await balances();
    assert.equal(rowOf(out, E_MO).heldCents, moBefore.heldCents - 5500);
    assert.deepEqual(out.pending, []);

    // The owner clears what Fatou handed over before this existed.
    await eAct(E_OWNER, "record_opening", {staffId: E_FA,
      amountCents: 2000});
    out = await balances();
    assert.equal(rowOf(out, E_FA).handedOutCents, 2000);
    assert.equal(rowOf(out, E_FA).heldCents, faBefore.heldCents + 4000 - 2000);
    assert.equal(out.businessAccount.receivedCents, 5000);

    // Voiding the confirmed one (owner) puts the money back.
    await eAct(E_OWNER, "void_handover", {handoverId: made.handoverId});
    out = await balances();
    assert.equal(rowOf(out, E_MO).heldCents, moBefore.heldCents - 1500);
    assert.equal(rowOf(out, E_FA).heldCents, faBefore.heldCents - 2000);
  });
});
