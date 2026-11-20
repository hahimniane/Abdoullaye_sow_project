"use strict";

// Fleet payment proof on WhatsApp (docs/FLEET_PAYMENT_PROOF.md) against the
// Firestore emulator: a driver's picture is a claim, the bank deposit is the
// proof, the conversation, the timers, the office actions, the Q2 late fee
// and the recheck fixes. The Claude API, WhatsApp and the clock are
// injected. Synthetic data only.
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
const bankSync = require("../bank_sync");
admin.auth().getUser = async (uid) => ({
  uid, email: `${uid}@example.test`, emailVerified: true});
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const BIZ = "fclaim-biz";
const OTHER = "fclaim-other-biz";
const OWNER = "fclaim-owner";
const STAFF = "fclaim-staff";
const NOPERM = "fclaim-noperm";

const run = (name, uid, data) => functions[name].run({
  auth: {uid, token: {}}, data, rawRequest: {}});
const act = (uid, action, data = {}) =>
  run("fleetAction", uid, {action, businessId: BIZ, ...data});
const refused = (reason) => (error) => error.details?.reason === reason;
const doc = async (col, id) => (await db.collection(col).doc(id).get()).data();

// --- fakes -----------------------------------------------------------------
const silent = {info() {}, warn() {}, error() {}};
const clock = {t: Date.now()};
const texts = [];
const receipts = [];
let refreshes = 0;
let nextReading = null;
let readCalls = 0;
const handlers = createFleetHandlers({admin, HttpsError, FieldValue,
  logger: silent, writeAudit: async () => undefined,
  dayKeyNow: () => "2026-12-02", now: () => clock.t,
  sendFleetMessage: async (args) => {
    receipts.push(args);
    return "sent";
  },
  sendFleetText: async ({businessId, phone, text}) => {
    texts.push({businessId, phone, text});
    return {ok: true};
  },
  fleetScheduledRefresh: async () => {
    refreshes += 1;
    return true;
  },
  readPicture: async () => {
    readCalls += 1;
    if (nextReading instanceof Error) throw nextReading;
    return nextReading;
  }});

const reading = (over = {}) => JSON.stringify({isPayment: true,
  amountCents: 40000, dayKey: "2026-12-02", recipient: "Claims Fleet Co",
  senderName: "Someone", confident: true, ...over});

let w = 0;
function inbound(from, o = {}) {
  const log = {kept: [], said: []};
  let kept = false;
  const ctx = {
    event: {from, wamid: `fclaim-wamid-${++w}`, type: o.image ? "image" :
      "text", text: o.text || "", media: o.image ?
      {id: "m1", mimeType: "image/jpeg"} : null},
    lang: o.lang || "en", kept: () => kept,
    fetchImage: async () => ({base64: "AAAA", mimeType: "image/jpeg"}),
    keep: async (businessId, opts) => {
      kept = true;
      log.kept.push([businessId, opts]);
      return {caseId: `case-${businessId}-${w}`,
        mediaPath: `support_cases/case-${businessId}-${w}/whatsapp/p.jpg`};
    },
    say: async (text) => {
      log.said.push(text);
    },
  };
  return {ctx, log};
}
const send = async (from, o) => {
  const {ctx, log} = inbound(from, o);
  const step = await handlers.handleClaimInbound(ctx);
  return {step, log};
};
const picture = (from, json, o = {}) => {
  nextReading = json;
  return send(from, {image: true, ...o});
};
const claimsOf = async (where) => (await db.collection("fleetClaims")
    .where("businessId", "==", BIZ).get()).docs
    .map((d) => ({id: d.id, ...d.data()})).filter(where || (() => true));

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
async function openRent(driverId, amountCents, due = "2026-12-01") {
  const ref = db.collection("fleetBills").doc();
  await ref.set({businessId: BIZ, driverId, carId: "car", assignmentId: "a",
    kind: "rent", label: "Rent", periodFrom: due, periodTo: due,
    dueDayKey: due, amountCents, paidCents: 0, status: "open"});
  return ref.id;
}
const driver = (id, name, phone, extra = {}) =>
  db.collection("fleetDrivers").doc(id).set({businessId: BIZ, name, phone,
    status: "active", creditCents: 0, rememberedSenders: [], ...extra});

const P_A = "+16465559101";
const P_B = "+16465559102";
const P_C = "+16465559103";
const P_STRANGER = "+16465559199";
const P_OTHERBIZ = "+16465559201";

before(async () => {
  await Promise.all([
    db.collection("businesses").doc(BIZ).set({name: "Claims Fleet Co",
      phone: "+17185550100", status: "approved", ownerUid: OWNER,
      enabledServices: ["fleet"], fleet: {enabled: true,
        enabledAtMs: BANK_MATCH_START_MS, settings: {
          zelle: {name: "Claims Fleet Co", handle: "718-555-0100"},
          whatsapp: {enabled: true, onlyDriverIds: ["c-a", "c-c"]}}}}),
    db.collection("businesses").doc(OTHER).set({name: "Other Fleet",
      status: "approved", enabledServices: ["fleet"],
      fleet: {enabled: true, settings: {whatsapp: {enabled: false}}}}),
    db.collection("users").doc(OWNER).set({role: "businessOwner",
      businessId: BIZ, fullName: "Owner"}),
    db.collection("users").doc(STAFF).set({role: "staff", businessId: BIZ,
      businessPermissions: ["fleet"], fullName: "Fleet Staff"}),
    db.collection("users").doc(NOPERM).set({role: "staff", businessId: BIZ,
      businessPermissions: ["parking"], fullName: "No Fleet"}),
    driver("c-a", "Fatoumata Bah", P_A),
    driver("c-b", "Moussa Keita", P_B), // not on the "only" list
    driver("c-c", "Mariama Camara", P_C),
    db.collection("fleetDrivers").doc("c-other").set({businessId: OTHER,
      name: "Other Driver", phone: P_OTHERBIZ, status: "active",
      creditCents: 0, rememberedSenders: []}),
    db.collection("businessBankLinks").doc(BIZ).set({businessId: BIZ,
      status: "active", institutionName: "Test Bank", accountMask: "0001"}),
  ]);
});

describe("who takes part", () => {
  it("a picture from a driver who is not covered, or a business with " +
      "WhatsApp off, is not Fleet's: the message goes on as before",
  async () => {
    const calls = readCalls;
    for (const from of [P_B, P_OTHERBIZ]) {
      const {step, log} = await picture(from, reading());
      assert.deepEqual(step, {handled: false}, from);
      assert.deepEqual(log.kept, []);
      assert.deepEqual(log.said, []);
    }
    assert.equal(readCalls, calls, "not even read");
  });

  it("a text from a covered driver with no open question is ordinary",
      async () => {
        const {step} = await send(P_A, {text: "hello, is my car ready?"});
        assert.deepEqual(step, {handled: false});
      });

  it("a picture that is not a payment is an ordinary support message",
      async () => {
        const {step, log} = await picture(P_A, JSON.stringify(
            {isPayment: false}));
        assert.deepEqual(step, {handled: false});
        assert.deepEqual(log.kept, []);
        assert.equal((await claimsOf((c) => c.fromPhone === P_A)).length, 0);
      });

  it("a stranger's picture that is not a payment to this business is " +
      "ordinary too", async () => {
    for (const json of [JSON.stringify({isPayment: false}),
      reading({recipient: "Joe Doe"}), "garbage", reading({recipient: ""})]) {
      const {step} = await picture(P_STRANGER, json);
      assert.deepEqual(step, {handled: false});
    }
    nextReading = new Error("API down");
    assert.deepEqual((await send(P_STRANGER, {image: true})).step,
        {handled: false});
  });
});

describe("a driver's picture is a claim; the bank is the proof", () => {
  it("a readable picture waits for the bank; nothing is paid from it",
      async () => {
        const bill = await openRent("c-a", 40000);
        const {step, log} = await picture(P_A, reading());
        assert.equal(step.handled, true);
        assert.equal(step.outcome, "claim_waiting_bank");
        assert.deepEqual(log.said,
            ["Got it. We will confirm when the bank shows it."]);
        assert.equal(log.kept[0][0], BIZ, "kept in the business's thread");
        const [claim] = await claimsOf((c) => c.fromPhone === P_A);
        assert.equal(claim.state, "waiting_bank");
        assert.equal(claim.driverId, "c-a");
        assert.equal(claim.amountCents, 40000);
        assert.equal(claim.open, true);
        assert.equal(claim.read.recipient, "Claims Fleet Co");
        assert.ok(claim.mediaPath.startsWith("support_cases/"));
        assert.equal(claim.bankCheckDueAtMs, clock.t + 15 * 60000);
        assert.equal(claim.closeAtMs, clock.t + 7 * 86400000);
        assert.equal((await doc("fleetBills", bill)).status, "open");
      });

  it("the same picture twice is not a second claim", async () => {
    const {step, log} = await picture(P_A, reading());
    assert.equal(step.outcome, "claim_duplicate");
    assert.match(log.said[0], /already have this payment/);
    assert.equal((await claimsOf((c) => c.fromPhone === P_A)).length, 1);
  });

  it("the deposit carries the driver's own name: it is theirs, the " +
      "sender is remembered, the bank's date and amount are recorded",
  async () => {
    receipts.length = 0;
    const id = await deposit(40000, "Fatoumata B. Bah #12",
        {dateKey: "2026-12-03"});
    assert.deepEqual(await handlers.matchBankDeposits(BIZ, [id]),
        {paid: 1, waiting: 0});
    const credit = await doc("businessBankCredits", id);
    const payment = await doc("fleetPayments", credit.consumedBy.id);
    assert.equal(payment.driverId, "c-a");
    assert.equal(payment.paidDayKey, "2026-12-03", "the bank's date (Q2)");
    assert.equal(payment.matchedBy, "claim");
    const [claim] = await claimsOf((c) => c.fromPhone === P_A);
    assert.equal(claim.state, "paid");
    assert.equal(claim.open, false);
    assert.equal(claim.paymentId, credit.consumedBy.id);
    assert.equal(payment.claimId, claim.id);
    assert.ok((await doc("fleetDrivers", "c-a")).rememberedSenders
        .includes("FATOUMATA B BAH"));
    assert.equal(receipts.length, 1, "the receipt is sent");
    assert.equal(receipts[0].row.driverId, "c-a");
  });

  it("after the first time no picture is needed", async () => {
    await openRent("c-a", 40000, "2027-01-01");
    receipts.length = 0;
    const id = await deposit(40000, "Fatoumata B. Bah");
    assert.deepEqual(await handlers.matchBankDeposits(BIZ, [id]),
        {paid: 1, waiting: 0});
    assert.equal(receipts.length, 1);
  });

  it("a picture of a payment already recorded does not wait for the bank",
      async () => {
        // The deposit above paid c-a on 2026-12-03 (no claim of its own).
        const {step, log} = await picture(P_A, reading({
          amountCents: 40000, dayKey: "2026-12-03"}));
        assert.equal(step.outcome, "claim_paid");
        assert.match(log.said[0], /already recorded this payment of \$400\.00/);
        const mine = await claimsOf((c) => c.fromPhone === P_A &&
          c.reason === "already_recorded");
        assert.equal(mine.length, 1);
        assert.equal(mine[0].open, false);
      });

  it("replies come in French when the driver writes French", async () => {
    await driver("c-fr", "Aissatou Sy", "+16465559150");
    await db.collection("businesses").doc(BIZ).update({
      "fleet.settings.whatsapp.onlyDriverIds": ["c-a", "c-c", "c-fr"]});
    const {log} = await picture("+16465559150", reading({
      amountCents: 12300, dayKey: "2026-12-02"}), {lang: "fr"});
    assert.deepEqual(log.said,
        ["Bien reçu. Nous confirmerons dès que la banque l’affichera."]);
  });
});

describe("the driver is asked once when the bank does not settle it", () => {
  it("unreadable: asks the amount, accepts it, then waits for the bank",
      async () => {
        await openRent("c-c", 30000);
        nextReading = new Error("API down");
        const first = await send(P_C, {image: true});
        assert.equal(first.step.outcome, "claim_asking_amount");
        assert.match(first.log.said[0], /could not read the amount/);
        const again = await send(P_C, {text: "soon"});
        assert.equal(again.step.outcome, "claim_asked_again");
        assert.match(again.log.said[0], /only the amount/);
        const typed = await send(P_C, {text: "$300"});
        assert.equal(typed.step.outcome, "claim_amount");
        const [claim] = await claimsOf((c) => c.fromPhone === P_C);
        assert.equal(claim.state, "waiting_bank");
        assert.equal(claim.amountCents, 30000);
        assert.equal(claim.read, null);
      });

  it("no match: one forced bank check at 15 minutes, then the name is " +
      "asked once; the answer matches the deposit", async () => {
    const id = await deposit(30000, "Aminata Diallo");
    await handlers.matchBankDeposits(BIZ, [id]);
    assert.equal((await doc("businessBankCredits", id)).fleetWaitingReason,
        "unknown", "not the driver's name: it waits");
    const business = await doc("businesses", BIZ);
    const start = clock.t;
    refreshes = 0;
    texts.length = 0;
    clock.t = start + 14 * 60000;
    await handlers.runClaimTimers(BIZ, business, clock.t);
    assert.equal(refreshes, 0, "too early");
    clock.t = start + 16 * 60000;
    let out = await handlers.runClaimTimers(BIZ, business, clock.t);
    assert.equal(refreshes, 1);
    assert.ok(out.checked >= 1);
    out = await handlers.runClaimTimers(BIZ, business, clock.t);
    assert.equal(refreshes, 1, "one check per claim, at most");
    assert.deepEqual(texts.filter((t) => t.phone === P_C), [],
        "the name comes after the check");
    clock.t = start + 25 * 60000;
    out = await handlers.runClaimTimers(BIZ, business, clock.t);
    assert.ok(out.asked >= 1);
    const mine = () => texts.filter((t) => t.phone === P_C);
    assert.equal(mine().length, 1);
    assert.equal(mine()[0].text,
        "What name is on the account you paid from?");
    const [claim] = await claimsOf((c) => c.fromPhone === P_C);
    assert.equal(claim.state, "asking_name");
    // Asked once.
    clock.t = start + 40 * 60000;
    await handlers.runClaimTimers(BIZ, business, clock.t);
    assert.equal(mine().length, 1);
    // The answer matches the waiting deposit.
    receipts.length = 0;
    const done = await send(P_C, {text: "It's Aminata Diallo"});
    assert.equal(done.step.outcome, "claim_named");
    const after = await doc("fleetClaims", claim.id);
    assert.equal(after.state, "paid");
    assert.equal(after.payerName, "Aminata Diallo");
    assert.equal((await doc("businessBankCredits", id)).consumedBy.kind,
        "fleet_payment");
    assert.ok((await doc("fleetDrivers", "c-c")).rememberedSenders
        .includes("AMINATA DIALLO"));
    assert.equal(receipts.length, 1);
  });
});

describe("a payment for a driver, from a phone not on file (Q7)", () => {
  it("asks which driver; a covered driver's number makes the claim theirs",
      async () => {
        await openRent("c-a", 25000, "2027-02-01");
        const first = await picture(P_STRANGER, reading({amountCents: 25000,
          recipient: "CLAIMS FLEET CO LLC"}));
        assert.equal(first.step.outcome, "claim_asking_driver");
        assert.equal(first.log.said[0],
            "Which driver is this payment for? Send their phone number.");
        assert.equal(first.log.kept[0][0], BIZ);
        const bad = await send(P_STRANGER, {text: "my friend"});
        assert.equal(bad.step.outcome, "claim_asked_again");
        const ok = await send(P_STRANGER, {text: "646-555-9101"});
        assert.equal(ok.step.outcome, "claim_driver_found");
        const [claim] = await claimsOf((c) => c.fromPhone === P_STRANGER);
        assert.equal(claim.driverId, "c-a");
        assert.equal(claim.state, "waiting_bank");
        assert.equal(claim.amountCents, 25000);
        // Their deposit, from the stranger (not the driver's own name),
        // waits: the claim has no payer name yet.
        const id = await deposit(25000, "Friend Payer");
        await handlers.matchBankDeposits(BIZ, [id]);
        assert.equal((await doc("businessBankCredits", id)).fleetWaiting,
            true);
      });

  it("a number that is not one of the business's drivers goes to the " +
      "office", async () => {
    const P2 = "+16465559198";
    await picture(P2, reading());
    await send(P2, {text: "646-555-9999"});
    const [claim] = await claimsOf((c) => c.fromPhone === P2);
    assert.equal(claim.state, "office");
    assert.equal(claim.reason, "not_a_driver");
  });

  it("three bad answers go to the office; so does a driver who is not " +
      "covered", async () => {
    const P3 = "+16465559197";
    await picture(P3, reading());
    await send(P3, {text: "no"});
    await send(P3, {text: "no"});
    const last = await send(P3, {text: "no"});
    assert.equal(last.step.outcome, "claim_office");
    const [claim] = await claimsOf((c) => c.fromPhone === P3);
    assert.equal(claim.reason, "not_a_driver");
    const P4 = "+16465559196";
    await picture(P4, reading());
    await send(P4, {text: P_B});
    const [c4] = await claimsOf((c) => c.fromPhone === P4);
    assert.equal(c4.reason, "not_a_driver", "c-b is not covered");
  });
});

describe("pictures that go to the office", () => {
  it("another recipient is answered at once", async () => {
    const {step, log} = await picture(P_A, reading({recipient: "Joe Doe",
      amountCents: 11100}));
    assert.equal(step.outcome, "claim_office");
    assert.equal(step.notify, true);
    assert.equal(log.said[0],
        "This payment went to Joe Doe, not Claims Fleet Co. We sent it to " +
        "the office.");
    assert.deepEqual(log.kept[0][1], {needsReply: true});
    const claims = await claimsOf((c) => c.reason === "wrong_recipient");
    assert.equal(claims.length, 1);
    assert.equal(claims[0].open, true);
  });

  it("older than 10 days is refused", async () => {
    const {log} = await picture(P_A, reading({dayKey: "2026-11-10",
      amountCents: 22200}));
    assert.match(log.said[0], /more than 10 days old/);
    assert.equal((await claimsOf((c) => c.reason === "too_old")).length, 1);
  });
});

describe("the timers: 2 days, 7 days, and the late reminder", () => {
  it("2 days: the driver is told and the office sees it; 7 days: closed; " +
      "a late reminder is paused while it is open", async () => {
    await driver("c-t", "Timer Driver", "+16465559160");
    await db.collection("businesses").doc(BIZ).update({
      "fleet.settings.whatsapp.onlyDriverIds":
        ["c-a", "c-c", "c-fr", "c-t"]});
    const bill = await openRent("c-t", 40000, "2026-11-28");
    const {log} = await picture("+16465559160", reading({
      amountCents: 40000, dayKey: "2026-12-02"}));
    assert.equal(log.said.length, 1);
    const claim = (await claimsOf((c) => c.fromPhone === "+16465559160"))[0];
    const business = await doc("businesses", BIZ);
    // Late reminder paused.
    receipts.length = 0;
    await handlers.remindBusiness(BIZ, business, "2026-12-01");
    assert.ok(!receipts.some((r) => r.row.driverId === "c-t"),
        "no late reminder for c-t");
    texts.length = 0;
    const start = clock.t;
    clock.t = start + 2 * 86400000;
    // (the bank check and the name come first on an old claim)
    await handlers.runClaimTimers(BIZ, business, clock.t);
    await handlers.runClaimTimers(BIZ, business, clock.t + 6 * 60000);
    const mineT = () => texts.filter((t) => t.phone === "+16465559160" &&
      /have not received/.test(t.text));
    const told = mineT();
    assert.equal(told.length, 1);
    assert.equal(told[0].text,
        "We have not received your $400.00 yet. Please check with your bank.");
    const flagged = await doc("fleetClaims", claim.id);
    assert.ok(flagged.toldLateAtMs > 0);
    assert.equal(flagged.reason, "no_deposit");
    assert.equal(flagged.open, true, "still open: a deposit can still pay it");
    await handlers.runClaimTimers(BIZ, business, clock.t + 12 * 60000);
    assert.equal(mineT().length, 1, "told once");
    clock.t = start + 7 * 86400000;
    const out = await handlers.runClaimTimers(BIZ, business, clock.t);
    assert.ok(out.closed >= 1);
    const closed = await doc("fleetClaims", claim.id);
    assert.equal(closed.state, "closed");
    assert.equal(closed.open, false);
    assert.equal((await doc("fleetBills", bill)).status, "open",
        "the bill stays unpaid");
    clock.t = start;
  });
});

describe("the office", () => {
  let claimId;
  let driverBId;
  it("bank_status lists the open claims", async () => {
    await driver("c-o", "Office Driver", "+16465559170");
    await db.collection("businesses").doc(BIZ).update({
      "fleet.settings.whatsapp.onlyDriverIds":
        ["c-a", "c-c", "c-fr", "c-t", "c-o"]});
    await picture("+16465559170", reading({amountCents: 19900}));
    const status = await act(STAFF, "bank_status");
    const mine = status.claims.find((c) => c.driverId === "c-o");
    claimId = mine.id;
    assert.deepEqual(Object.keys(mine).sort(), ["amountCents",
      "createdAtMs", "driverId", "driverName", "fromPhone", "hasPhoto", "id",
      "payerName", "reason", "state", "toldLateAtMs"].sort());
    assert.equal(mine.driverName, "Office Driver");
    assert.equal(mine.amountCents, 19900);
    assert.equal(mine.state, "waiting_bank");
    assert.equal(mine.hasPhoto, true);
    assert.ok(status.claims.every((c) => c.state !== "paid" &&
      c.state !== "closed"));
    await assert.rejects(act(NOPERM, "bank_status"));
  });

  it("claim_photo gives Fleet staff the thread's file", async () => {
    const claim = await doc("fleetClaims", claimId);
    const {messageDocId} = require("../whatsapp_conversations");
    await db.collection("supportCases").doc(claim.caseId)
        .collection("messages").doc(messageDocId("in", claim.messageId)).set({
          metadata: {fileUrl: "https://files.example/p.jpg"}});
    assert.deepEqual(await act(STAFF, "claim_photo", {claimId}),
        {success: true, url: "https://files.example/p.jpg", deleted: false});
    await assert.rejects(act(NOPERM, "claim_photo", {claimId}));
    await assert.rejects(run("fleetAction", STAFF, {action: "claim_photo",
      businessId: OTHER, claimId}));
  });

  it("claim_assign: 'this deposit is theirs' pays the driver the bank's " +
      "amount and answers the report", async () => {
    await openRent("c-o", 19900);
    const id = await deposit(20000, "Some Relative");
    await handlers.matchBankDeposits(BIZ, [id]);
    assert.equal((await doc("businessBankCredits", id)).fleetWaiting, true);
    await assert.rejects(act(NOPERM, "claim_assign",
        {claimId, creditId: id}));
    const out = await act(STAFF, "claim_assign", {claimId, creditId: id});
    assert.equal(out.success, true);
    assert.equal(out.amountCents, 20000);
    const claim = await doc("fleetClaims", claimId);
    assert.equal(claim.state, "paid");
    assert.equal(claim.creditId, id);
    assert.equal((await doc("fleetPayments", out.paymentId)).amountCents,
        20000);
    assert.equal((await doc("fleetDrivers", "c-o")).creditCents, 100,
        "extra becomes credit (Q3)");
    await assert.rejects(act(STAFF, "claim_assign", {claimId, creditId: id}),
        refused("fleet_claim_closed"));
  });

  it("claim_assign needs a driver and a waiting deposit", async () => {
    const {step} = await picture(P_STRANGER, reading({amountCents: 5500}));
    assert.equal(step.outcome, "claim_asking_driver");
    const [noDriver] = await claimsOf((c) => c.fromPhone === P_STRANGER &&
      c.state === "asking_driver");
    const waiting = await deposit(5500, "Nobody Known");
    await handlers.matchBankDeposits(BIZ, [waiting]);
    await assert.rejects(act(STAFF, "claim_assign",
        {claimId: noDriver.id, creditId: waiting}),
    refused("fleet_claim_no_driver"));
    await picture("+16465559170", reading({amountCents: 8800}));
    const [mine] = await claimsOf((c) => c.fromPhone === "+16465559170" &&
      c.state === "waiting_bank");
    const fresh = await deposit(8800, "Never Looked At");
    await assert.rejects(act(STAFF, "claim_assign",
        {claimId: mine.id, creditId: fresh}),
    refused("fleet_deposit_not_waiting"));
    // claim_close
    await act(STAFF, "claim_close", {claimId: noDriver.id});
    assert.equal((await doc("fleetClaims", noDriver.id)).state, "closed");
    await assert.rejects(act(STAFF, "claim_close", {claimId: noDriver.id}),
        refused("fleet_claim_closed"));
    await assert.rejects(act(NOPERM, "claim_close", {claimId: mine.id}));
    driverBId = mine.id;
  });

  it("payer_names_save: up to 10 sender keys; accounts, apps and one " +
      "word are refused", async () => {
    const out = await act(STAFF, "payer_names_save", {driverId: "c-b",
      names: ["Moussa Keita", "moussa  KEITA", "Awa Sow #44"]});
    assert.deepEqual(out, {success: true, names: ["MOUSSA KEITA", "AWA SOW"]});
    assert.deepEqual((await doc("fleetDrivers", "c-b")).rememberedSenders,
        ["MOUSSA KEITA", "AWA SOW"]);
    for (const names of [["360 Checking XXXXXXX2820"], ["Zelle"], ["Bah"],
      ["MONEY SENT"]]) {
      await assert.rejects(act(STAFF, "payer_names_save",
          {driverId: "c-b", names}), refused("fleet_bad_name"));
    }
    await assert.rejects(act(STAFF, "payer_names_save", {driverId: "c-b",
      names: Array.from({length: 11}, (_, i) => `Name Number${"x".repeat(i)}`),
    }), refused("fleet_bad_input"));
    await assert.rejects(act(STAFF, "payer_names_save",
        {driverId: "nope", names: []}), refused("fleet_not_found"));
    await assert.rejects(act(NOPERM, "payer_names_save",
        {driverId: "c-b", names: []}));
    // Removing is saving a shorter list.
    assert.deepEqual((await act(STAFF, "payer_names_save",
        {driverId: "c-b", names: ["Awa Sow"]})).names, ["AWA SOW"]);
    // A name remembered before the rule (one word) may stay while others
    // change.
    await db.collection("fleetDrivers").doc("c-b")
        .update({rememberedSenders: ["LEGACY"]});
    assert.deepEqual((await act(STAFF, "payer_names_save",
        {driverId: "c-b", names: ["LEGACY", "Awa Sow"]})).names,
    ["LEGACY", "AWA SOW"]);
    assert.ok(driverBId);
  });
});

describe("a shared payer (one name, two drivers)", () => {
  it("waits; the driver who has an open claim for that amount gets it",
      async () => {
        await Promise.all([
          driver("c-w1", "Wife One", "+16465559181", {
            rememberedSenders: ["HUSBAND PAYER"]}),
          driver("c-w2", "Wife Two", "+16465559182", {
            rememberedSenders: ["HUSBAND PAYER"]}),
        ]);
        await db.collection("businesses").doc(BIZ).update({
          "fleet.settings.whatsapp.onlyDriverIds":
            ["c-a", "c-c", "c-fr", "c-t", "c-o", "c-w1", "c-w2"]});
        await openRent("c-w1", 31000);
        await openRent("c-w2", 31000);
        const id = await deposit(31000, "Husband Payer");
        await handlers.matchBankDeposits(BIZ, [id]);
        assert.equal((await doc("businessBankCredits", id))
            .fleetWaitingReason, "shared_payer");
        await picture("+16465559182", reading({amountCents: 31000}));
        const [claim] = await claimsOf((c) =>
          c.fromPhone === "+16465559182");
        // The picture came after the deposit: looked at again at once.
        const after = await doc("businessBankCredits", id);
        assert.equal(after.consumedBy.kind, "fleet_payment");
        const payment = await doc("fleetPayments", after.consumedBy.id);
        assert.equal(payment.driverId, "c-w2");
        assert.equal((await doc("fleetClaims", claim.id)).state, "paid");
      });
});

describe("Q2: paid on time takes the late fee back", () => {
  async function setup(id, name) {
    await driver(id, name, null, {rememberedSenders:
      [`${name} Payer`.toUpperCase()]});
    const rent = await openRent(id, 35000, "2026-12-01");
    const fee = db.collection("fleetBills").doc(`${rent}_late`);
    await fee.set({businessId: BIZ, driverId: id, kind: "late_fee",
      label: "Late fee", dueDayKey: "2026-12-05", amountCents: 5000,
      paidCents: 0, status: "open", lateFeeForBillId: rent});
    return {rent, fee};
  }

  it("on or before the fee day, covering the rent: the fee is void; undo " +
      "gives it back", async () => {
    const {rent, fee} = await setup("q2-a", "Qtwo Alpha");
    const id = await deposit(35000, "qtwo alpha payer",
        {dateKey: "2026-12-05"});
    await handlers.matchBankDeposits(BIZ, [id]);
    assert.equal((await doc("fleetBills", rent)).status, "paid");
    const voided = (await fee.get()).data();
    assert.equal(voided.status, "void");
    assert.equal(voided.voidReason, "paid_on_time");
    const paymentId = (await doc("businessBankCredits", id)).consumedBy.id;
    assert.deepEqual((await doc("fleetPayments", paymentId)).lateFeesVoided,
        [fee.id]);
    await act(OWNER, "payment_undo", {paymentId});
    const back = (await fee.get()).data();
    assert.equal(back.status, "open");
    assert.equal(back.voidReason, undefined);
    assert.equal((await doc("fleetBills", rent)).status, "open");
  });

  it("after the fee day the fee is paid first, as before", async () => {
    const {rent, fee} = await setup("q2-b", "Qtwo Bravo");
    const id = await deposit(35000, "qtwo bravo payer",
        {dateKey: "2026-12-06"});
    await handlers.matchBankDeposits(BIZ, [id]);
    assert.equal((await fee.get()).get("status"), "paid");
    assert.equal((await doc("fleetBills", rent)).paidCents, 30000);
  });

  it("an office-picked deposit takes it back too", async () => {
    const {fee} = await setup("q2-c", "Qtwo Charlie");
    const id = await deposit(35000, "Stranger Person", {dateKey: "2026-12-04"});
    await handlers.matchBankDeposits(BIZ, [id]);
    await act(STAFF, "bank_assign", {creditId: id, driverId: "q2-c"});
    assert.equal((await fee.get()).get("status"), "void");
  });

  it("a hand-recorded payment does not (only the bank's date counts)",
      async () => {
        const {fee} = await setup("q2-d", "Qtwo Delta");
        await act(STAFF, "payment_record", {driverId: "q2-d",
          amountCents: 35000, method: "cash", paidDayKey: "2026-12-02"});
        assert.equal((await fee.get()).get("status"), "paid");
      });
});

describe("recheck fixes", () => {
  it("(a) an undone deposit, and the bank's re-send or posted copy, " +
      "never pays by itself again", async () => {
    await driver("rk-a", "Recheck A", null, {rememberedSenders: ["RECHECK A"]});
    await openRent("rk-a", 41000);
    await openRent("rk-a", 41000, "2027-03-01");
    const id = await deposit(41000, "Recheck A", {pending: true});
    await handlers.matchBankDeposits(BIZ, [id]);
    const paymentId = (await doc("businessBankCredits", id)).consumedBy.id;
    await act(OWNER, "payment_undo", {paymentId});
    // The same stored deposit is looked at again: it waits as undone.
    assert.deepEqual(await handlers.matchBankDeposits(BIZ, [id]),
        {paid: 0, waiting: 1});
    assert.equal((await doc("businessBankCredits", id)).fleetWaitingReason,
        "undone");
    assert.equal((await doc("businessBankCredits", id)).fleetUndone, true);
    // The bank posts a copy under a new id (a sync's replacement).
    const txn = `${BIZ}_txn-posted-rk`;
    await db.collection("businessBankCredits").doc(txn).set({businessId: BIZ,
      transactionId: "txn-posted-rk", accountId: "acct", amountCents: 41000,
      pending: false, atMs: AFTER + 99999, dateKey: "2026-12-02",
      senderName: "Recheck A", createdAt: FieldValue.serverTimestamp()});
    await bankSync.applySyncPlan({db, FieldValue, businessId: BIZ},
        {upserts: [], removals: [], replacements: [{businessId: BIZ,
          transactionId: "txn-posted-rk", pendingTransactionId:
            id.replace(`${BIZ}_`, ""), accountId: "acct", amountCents: 41000,
          pending: false, atMs: AFTER + 99999, dateKey: "2026-12-02",
          senderName: "Recheck A", zelle: true}]});
    const posted = await doc("businessBankCredits", txn);
    assert.equal(posted.fleetUndone, true, "carried to the posted copy");
    assert.deepEqual(await handlers.matchBankDeposits(BIZ, [txn]),
        {paid: 0, waiting: 1});
    // A re-send under a new id, no link at all.
    const resend = await deposit(41000, "RECHECK A", {pending: false});
    assert.deepEqual(await handlers.matchBankDeposits(BIZ, [resend]),
        {paid: 0, waiting: 1});
    assert.equal((await doc("businessBankCredits", resend))
        .fleetWaitingReason, "undone");
    // The office can still pay it with one tap.
    await act(STAFF, "bank_assign", {creditId: txn, driverId: "rk-a"});
  });

  it("(b) connecting a different bank login starts matching from that " +
      "moment", async () => {
    await driver("rk-b", "Recheck B", null, {rememberedSenders: ["RECHECK B"]});
    await openRent("rk-b", 42000);
    const old = await deposit(42000, "Recheck B", {atMs: AFTER + 1000});
    const fresh = await deposit(42000, "Recheck B", {atMs: AFTER + 500000});
    await db.collection("businessBankLinks").doc(BIZ)
        .update({matchFromMs: AFTER + 100000});
    assert.deepEqual(await handlers.matchBankDeposits(BIZ, [old]),
        {paid: 0, waiting: 0}, "the old bank's deposit is never looked at");
    assert.equal((await doc("businessBankCredits", old)).consumedBy,
        undefined);
    assert.deepEqual(await handlers.matchBankDeposits(BIZ, [fresh]),
        {paid: 1, waiting: 0});
    await db.collection("businessBankLinks").doc(BIZ)
        .update({matchFromMs: FieldValue.delete()});
  });

  it("(c) one failing deposit no longer stops the others; a sweep picks " +
      "up deposits never looked at", async () => {
    clock.t = Date.now();
    await driver("rk-c", "Recheck C", null, {rememberedSenders: ["RECHECK C"]});
    await openRent("rk-c", 43000);
    await openRent("rk-c", 43000, "2027-04-01");
    const realFirestore = admin.firestore();
    const credits = (col) => ({
      doc: (id) => col.doc(id),
      where: (f, op, v) => ({
        where: (f2, op2, v2) => v2 === 777 ? {orderBy: () => ({limit: () => ({
          get: async () => {
            throw new Error("boom");
          }})})} : col.where(f, op, v).where(f2, op2, v2),
        orderBy: (...a) => col.where(f, op, v).orderBy(...a),
        get: () => col.where(f, op, v).get(),
      }),
    });
    const flaky = {...admin, firestore: Object.assign(() => new Proxy(
        realFirestore, {get: (t, k) => k === "collection" ?
          (name) => name === "businessBankCredits" ?
            credits(t.collection(name)) : t.collection(name) :
          typeof t[k] === "function" ? t[k].bind(t) : t[k]}),
    {FieldValue})};
    const h = createFleetHandlers({admin: flaky, HttpsError, FieldValue,
      logger: silent, writeAudit: async () => undefined,
      dayKeyNow: () => "2026-12-02", now: () => clock.t,
      sendFleetMessage: async () => "sent"});
    const bad = await deposit(777, "Whoever Person");
    const good = await deposit(43000, "Recheck C");
    const out = await h.matchBankDeposits(BIZ, [bad, good]);
    assert.equal(out.paid, 1, "the good one was paid after the bad one threw");
    // The sweep: deposits old enough that nobody looked at.
    const lost = await deposit(43000, "Recheck C", {createdAt:
      admin.firestore.Timestamp.fromMillis(clock.t - 3600000)});
    const business = await doc("businesses", BIZ);
    assert.deepEqual(await handlers.sweepDeposits(BIZ, business),
        {paid: 1, waiting: 0});
    assert.equal((await doc("businessBankCredits", lost)).consumedBy.kind,
        "fleet_payment");
    // A deposit younger than ten minutes is left to its own sync.
    const young = await deposit(43001, "Whoever Person");
    assert.deepEqual(await handlers.sweepDeposits(BIZ, business),
        {paid: 0, waiting: 0});
    assert.equal((await doc("businessBankCredits", young)).fleetWaiting,
        undefined);
  });

  it("(e) 'Pay this driver' needs an active driver and a waiting deposit",
      async () => {
        await driver("rk-e", "Recheck E", null, {status: "left"});
        const waiting = await deposit(5100, "Unknown Person");
        await handlers.matchBankDeposits(BIZ, [waiting]);
        await assert.rejects(act(STAFF, "bank_assign",
            {creditId: waiting, driverId: "rk-e"}),
        refused("fleet_driver_left"));
        await assert.rejects(act(STAFF, "bank_assign",
            {creditId: waiting, driverId: "no-such-driver"}),
        refused("fleet_not_found"));
        const unseen = await deposit(5200, "Unknown Person");
        await assert.rejects(act(STAFF, "bank_assign",
            {creditId: unseen, driverId: "c-b"}),
        refused("fleet_deposit_not_waiting"));
        await assert.rejects(act(STAFF, "bank_assign",
            {creditId: waiting, driverId: "c-other"}),
        refused("fleet_not_found"));
        // An active driver and a waiting deposit still work.
        await act(STAFF, "bank_assign", {creditId: waiting, driverId: "c-b"});
        assert.equal((await doc("businessBankCredits", waiting)).consumedBy
            .kind, "fleet_payment");
      });
});

describe("an undone payment sends its report back to the office", () => {
  it("the report is not left saying paid", async () => {
    await driver("rk-u", "Undo Driver", "+16465559190");
    await db.collection("businesses").doc(BIZ).update({
      "fleet.settings.whatsapp.onlyDriverIds":
        ["c-a", "c-c", "c-fr", "c-t", "c-o", "c-w1", "c-w2", "rk-u"]});
    await openRent("rk-u", 36000);
    await picture("+16465559190", reading({amountCents: 36000}));
    const id = await deposit(36000, "Undo Driver");
    await handlers.matchBankDeposits(BIZ, [id]);
    const [claim] = await claimsOf((c) => c.fromPhone === "+16465559190");
    assert.equal((await doc("fleetClaims", claim.id)).state, "paid");
    const paymentId = (await doc("businessBankCredits", id)).consumedBy.id;
    await act(OWNER, "payment_undo", {paymentId});
    const after = await doc("fleetClaims", claim.id);
    assert.equal(after.state, "office");
    assert.equal(after.reason, "payment_undone");
    assert.equal(after.open, true);
  });
});

describe("personal cents are gone", () => {
  it("a new driver gets none, and the old field is left alone", async () => {
    const added = await act(STAFF, "driver_save", {driver: {name: "New One",
      phone: "2125550177"}});
    assert.equal((await doc("fleetDrivers", added.driverId)).personalCents,
        undefined);
    await db.collection("fleetDrivers").doc("c-b")
        .update({personalCents: 42});
    await act(STAFF, "driver_save", {driverId: "c-b", driver: {
      name: "Moussa Keita", phone: P_B, status: "active"}});
    assert.equal((await doc("fleetDrivers", "c-b")).personalCents, 42);
    // A driver with no personalCents (or null) never breaks matching.
    const id = await deposit(1234, "No Cents Person");
    assert.deepEqual(await handlers.matchBankDeposits(BIZ, [id]),
        {paid: 0, waiting: 1});
  });
});
