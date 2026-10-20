"use strict";

const assert = require("node:assert/strict");
const {after, before, describe, it} = require("node:test");
const admin = require("firebase-admin");

// Phone accounts (docs/PHONE_ACCOUNTS.md) against the Auth and Firestore
// emulators: accounts made from records (and only once for two records at
// once), the derived fields following staff edits, the WhatsApp code with its
// limits, the SMS path landing on the same uid, merging into an email
// account, "My packages" without prices, "This isn't mine", and a deleted
// account staying deleted. Meta is faked at `fetch`; the emulators' own REST
// endpoints are passed through.
//
// Writes with ADMIN credentials, so it refuses to run outside the emulator.
if (!process.env.FIRESTORE_EMULATOR_HOST ||
    !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error(
      "Run this through `npm run test:phone-accounts` " +
      "(firebase emulators:exec --only auth,firestore). A direct node --test " +
      "run would write its fixtures into the real project.");
}

process.env.FUNCTIONS_EMULATOR = "true";
process.env.WHATSAPP_ACCESS_TOKEN = "EAAG-test-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "109876543210";

const functions = require("../index");
const {limitDocId} = require("../phone_accounts");
const db = admin.firestore();
const PROJECT = process.env.GCLOUD_PROJECT || "demo-laawol-phone";
const AUTH_HOST = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;

const US_BIZ = "ph-us-biz";
const GN_BIZ = "ph-gn-biz";
const OWNER = "ph-owner";

// --- Meta, faked -----------------------------------------------------------
const sent = [];
let metaFails = false;
const realFetch = global.fetch;
before(() => {
  global.fetch = async (url, init) => {
    if (String(url).startsWith("https://graph.facebook.com/")) {
      const body = JSON.parse(init.body);
      sent.push(body);
      if (metaFails) {
        return new Response(JSON.stringify({error: {code: 131000,
          message: "Template not approved"}}), {status: 400});
      }
      return new Response(JSON.stringify({messages: [{id: `wamid.${
        sent.length}`}]}), {status: 200});
    }
    return realFetch(url, init);
  };
});
after(() => {
  global.fetch = realFetch;
});

/**
 * @param {string} e164 A number.
 * @return {string} The code the last WhatsApp message to it carried.
 */
function lastCodeTo(e164) {
  const digits = e164.replace(/\D/g, "");
  const message = [...sent].reverse().find((body) => body.to === digits);
  assert.ok(message, `no WhatsApp message to ${e164}`);
  return message.template.components[0].parameters[0].text;
}

// --- callable plumbing -----------------------------------------------------
let address = 0;
const call = (action, data = {}, auth = null) => functions.phoneAccount.run({
  auth, data: {action, ...data},
  rawRequest: {headers: {"x-forwarded-for": `10.9.0.${++address % 250}`}},
});
const asUser = (uid, token = {}) => ({uid, token: {
  firebase: {sign_in_provider: "phone"}, ...token}});
const reasonOf = (promise) => promise.then(() => "ok",
    (error) => error.details?.reason || `${error.code}: ${error.message}`);

// --- emulator REST helpers -------------------------------------------------
async function authRest(path, body) {
  const response = await realFetch(
      `${AUTH_HOST}/identitytoolkit.googleapis.com/v1/${path}?key=fake`, {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify(body)});
  const json = await response.json();
  assert.ok(response.ok, JSON.stringify(json));
  return json;
}

/**
 * Firebase SMS sign-in, as the app's "Send it by text instead" does it.
 *
 * @param {string} e164 The number.
 * @return {Promise<object>} {idToken, localId, ...}.
 */
async function smsSignIn(e164) {
  const {sessionInfo} = await authRest("accounts:sendVerificationCode",
      {phoneNumber: e164, recaptchaToken: "ignored"});
  const codes = await (await realFetch(
      `${AUTH_HOST}/emulator/v1/projects/${PROJECT}/verificationCodes`))
      .json();
  const entry = [...codes.verificationCodes].reverse()
      .find((item) => item.sessionInfo === sessionInfo);
  return authRest("accounts:signInWithPhoneNumber",
      {sessionInfo, code: entry.code});
}

async function signInWithCustomToken(token) {
  const session = await authRest("accounts:signInWithCustomToken",
      {token, returnSecureToken: true});
  // This endpoint answers without localId: read the uid from the ID token.
  const claims = JSON.parse(Buffer.from(session.idToken.split(".")[1],
      "base64url").toString("utf8"));
  return {...session, localId: claims.user_id};
}

// --- records ---------------------------------------------------------------
let seq = 0;
const nextId = (prefix) => `${prefix}-${Date.now()}-${++seq}`;

/**
 * Writes a parked car and runs its trigger, as a staff save would.
 *
 * @param {object} data The record's fields.
 * @return {Promise<string>} Its id.
 */
async function parkedCar(data) {
  const id = nextId("pk");
  const ref = db.collection("parkedCars").doc(id);
  const record = {businessId: US_BIZ, status: "parked",
    trackingCode: `PK-${id.slice(-6).toUpperCase()}`,
    createdAt: admin.firestore.Timestamp.now(), ...data};
  await ref.set(record);
  await runParkedTrigger(id);
  return id;
}

async function runParkedTrigger(id, before = null, snapshot = null) {
  const snap = snapshot || await db.collection("parkedCars").doc(id).get();
  await functions.syncParkedCarOccupancy.run({params: {parkedCarId: id},
    data: {before: before ? {exists: true, data: () => before} :
      {exists: false, data: () => null},
    after: {exists: true, data: () => snap.data(), ref: snap.ref,
      updateTime: snap.updateTime}}});
}

async function containerLine(data) {
  const id = nextId("cl");
  const record = {businessId: US_BIZ, ownerKind: "customer",
    containerStatus: "waiting", containerId: "",
    trackingCode: `CL-${id.slice(-6).toUpperCase()}`,
    customerName: "Fatou Diallo", priceCents: 15000,
    pieces: [{kind: "barrel", priceCents: 15000}],
    createdAt: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now(), ...data};
  await db.collection("containerLines").doc(id).set(record);
  await runLineTrigger(id, null);
  return id;
}

async function runLineTrigger(id, before) {
  const snap = await db.collection("containerLines").doc(id).get();
  await functions.rollupVolumeOnLineWrite.run({params: {lineId: id},
    data: {
      before: before ? {exists: true, data: () => before} :
        {exists: false, data: () => null},
      after: {exists: true, data: () => snap.data(),
        updateTime: snap.updateTime}}});
}

const record = async (collection, id) =>
  (await db.collection(collection).doc(id).get()).data();
const userByPhone = (e164) => admin.auth().getUserByPhoneNumber(e164)
    .catch(() => null);
const profile = async (uid) =>
  (await db.collection("users").doc(uid).get()).data();

let phoneSeq = 0;
// A fresh valid US number per test, so limits never collide.
const freshUs = () => `+1202555${String(1000 + (++phoneSeq) % 9000)}`;

before(async () => {
  await db.collection("businesses").doc(US_BIZ).set({name: "Dala Shipping",
    businessName: "Dala Shipping", country: "United States",
    ownerUid: OWNER, status: "approved"});
  await db.collection("businesses").doc(GN_BIZ).set({name: "Conakry Express",
    country: "Guinea", ownerUid: OWNER, status: "approved"});
  await db.collection("users").doc(OWNER).set({role: "businessOwner",
    businessId: US_BIZ, email: "owner@example.com",
    notificationPreferences: {businessActivity: true}});
});

// ---------------------------------------------------------------------------

describe("accounts from records", () => {
  it("makes an account for sender and receiver at once, local US number " +
      "included", async () => {
    const sender = freshUs();
    const receiver = "+224622" + String(100000 + seq).slice(-6);
    const id = await containerLine({customerPhone: sender.slice(2),
      receiverPhone: receiver, receiverName: "Mamadou Bah"});
    const line = await record("containerLines", id);
    assert.equal(line.customerPhoneE164, sender);
    assert.equal(line.receiverPhoneE164, receiver);
    assert.equal(line.phoneCountryCodeMissing, undefined);
    const [s, r] = await Promise.all([userByPhone(sender),
      userByPhone(receiver)]);
    assert.ok(s && r, "both accounts exist");
    assert.equal(r.displayName, "Mamadou Bah");
    const rp = await profile(r.uid);
    assert.equal(rp.role, "customer");
    assert.equal(rp.accountOrigin, "shipment");
    assert.equal(rp.firstSignInAt, null);
    assert.equal(rp.email, "");
    assert.equal(rp.preferredLanguage, "fr"); // +224
    assert.deepEqual(rp.createdFrom, {collection: "containerLines",
      recordId: id, field: "receiverPhone"});
    // Its own stamp re-fires the trigger: nothing changes the second time.
    const before = await record("containerLines", id);
    await runLineTrigger(id, before);
    assert.deepEqual((await record("containerLines", id)).phoneSyncedAt,
        before.phoneSyncedAt);
  });

  it("two records with the same new number at once make one account",
      async () => {
        const phone = freshUs();
        const ids = await Promise.all([1, 2, 3].map(() => parkedCar({
          customerPhone: phone, customerName: "Awa"})));
        const users = (await admin.auth().listUsers(1000)).users
            .filter((user) => user.phoneNumber === phone);
        assert.equal(users.length, 1);
        for (const id of ids) {
          assert.equal((await record("parkedCars", id)).customerPhoneE164,
              phone);
        }
      });

  it("flags a local number it cannot place; fixing it makes the account",
      async () => {
        const id = await parkedCar({customerPhone: "622 12 34 99"});
        let car = await record("parkedCars", id);
        assert.deepEqual(car.phoneCountryCodeMissing, ["customerPhone"]);
        assert.equal(car.customerPhoneE164, undefined);
        assert.equal(await userByPhone("+224622123499"), null);
        await db.collection("parkedCars").doc(id)
            .update({customerPhone: "+224 622 12 34 99"});
        await runParkedTrigger(id);
        car = await record("parkedCars", id);
        assert.equal(car.phoneCountryCodeMissing, undefined);
        assert.equal(car.customerPhoneE164, "+224622123499");
        assert.ok(await userByPhone("+224622123499"));
      });

  it("reuses an email account that verified the number", async () => {
    const phone = freshUs();
    const email = await admin.auth().createUser({email: `v${seq}@ex.com`,
      password: "secret123", phoneNumber: phone});
    await parkedCar({customerPhone: phone});
    const users = (await admin.auth().listUsers(1000)).users
        .filter((user) => user.phoneNumber === phone);
    assert.deepEqual(users.map((user) => user.uid), [email.uid]);
    // Nobody wrote a profile over the email account's.
    assert.equal(await profile(email.uid), undefined);
  });

  it("never recreates a deleted account; signing in again does", async () => {
    const phone = freshUs();
    await db.collection("phoneAccountOptOuts").doc(phone)
        .set({uid: "gone", deletedAt: new Date()});
    await parkedCar({customerPhone: phone});
    assert.equal(await userByPhone(phone), null);
    await call("requestPhoneLoginCode", {phone});
    const verified = await call("verifyPhoneLoginCode", {
      challengeId: (await db.collection("phoneLoginChallenges")
          .where("phoneE164", "==", phone).get()).docs[0].id,
      code: lastCodeTo(phone)});
    assert.ok(verified.customToken);
    assert.equal(verified.isNewAccount, true);
    assert.equal((await db.collection("phoneAccountOptOuts").doc(phone)
        .get()).exists, false);
    assert.equal((await userByPhone(phone)).uid, verified.uid);
  });
});

describe("WhatsApp sign-in codes", () => {
  it("signs in with the code, on the number's account, in its language",
      async () => {
        const phone = "+224622" + String(200000 + seq).slice(-6);
        await parkedCar({businessId: GN_BIZ, customerPhone: phone});
        const placeholder = await userByPhone(phone);
        const asked = await call("requestPhoneLoginCode", {phone});
        assert.equal(asked.channel, "whatsapp");
        assert.equal(asked.lastTwo, phone.slice(-2));
        assert.equal(asked.resendAfterMs, 30000);
        const message = sent[sent.length - 1];
        assert.equal(message.template.name, "laawol_login_code");
        assert.equal(message.template.language.code, "fr");
        const code = lastCodeTo(phone);
        // Only a hash is stored.
        const stored = (await db.collection("phoneLoginChallenges")
            .doc(asked.challengeId).get()).data();
        assert.ok(!JSON.stringify(stored).includes(code));
        const result = await call("verifyPhoneLoginCode",
            {challengeId: asked.challengeId, code});
        assert.equal(result.uid, placeholder.uid);
        const session = await signInWithCustomToken(result.customToken);
        assert.equal(session.localId, placeholder.uid);
        const p = await profile(placeholder.uid);
        assert.ok(p.firstSignInAt, "first sign-in recorded");
        assert.equal(p.phoneVerified, true);
        // The code works once.
        assert.equal(await reasonOf(call("verifyPhoneLoginCode",
            {challengeId: asked.challengeId, code})), "challenge_not_found");
      });

  it("locks the code after five wrong tries", async () => {
    const phone = freshUs();
    await parkedCar({customerPhone: phone}); // a known number gets codes
    const asked = await call("requestPhoneLoginCode", {phone});
    const right = lastCodeTo(phone);
    const wrong = right === "000000" ? "111111" : "000000";
    const reasons = [];
    for (let i = 0; i < 5; i++) {
      reasons.push(await reasonOf(call("verifyPhoneLoginCode",
          {challengeId: asked.challengeId, code: wrong})));
    }
    assert.deepEqual(reasons, ["code_wrong", "code_wrong", "code_wrong",
      "code_wrong", "too_many_attempts"]);
    assert.equal(await reasonOf(call("verifyPhoneLoginCode",
        {challengeId: asked.challengeId, code: right})), "too_many_attempts");
  });

  it("limits sends: a resend gap, and five an hour per number", async () => {
    const phone = freshUs();
    await call("requestPhoneLoginCode", {phone});
    const again = await call("requestPhoneLoginCode", {phone})
        .catch((error) => error);
    assert.equal(again.details.reason, "rate_limited");
    assert.ok(again.details.retryAfterMs > 0 &&
      again.details.retryAfterMs <= 30000);
    // Four more already this hour (the gap long past): the sixth is refused.
    const other = freshUs();
    await db.collection("phoneLoginLimits")
        .doc(limitDocId("phone_hour", other)).set({count: 5,
          windowStartMs: Date.now() - 60000, lastAtMs: Date.now() - 60000});
    assert.equal(await reasonOf(call("requestPhoneLoginCode",
        {phone: other})), "rate_limited");
  });

  it("asks for a country code rather than guessing", async () => {
    assert.equal(await reasonOf(call("requestPhoneLoginCode",
        {phone: "2025550123"})), "needs_country_code");
    assert.equal(await reasonOf(call("requestPhoneLoginCode",
        {phone: "hello"})), "phone_invalid");
  });

  it("sends to the number on a tracking code, never revealing it",
      async () => {
        const receiver = freshUs();
        const id = await containerLine({customerPhone: freshUs(),
          receiverPhone: receiver});
        const {trackingCode} = await record("containerLines", id);
        const page = await functions.lookupGuestTracking.run({auth: null,
          data: {identifier: trackingCode}, rawRequest: {headers: {}}});
        assert.deepEqual(page.record.signIn.map((hint) => hint.role),
            ["sender", "receiver"]);
        assert.equal(page.record.signIn[1].lastTwo, receiver.slice(-2));
        assert.ok(!JSON.stringify(page).includes(receiver.slice(2)));
        const asked = await call("requestPhoneLoginCode",
            {trackingCode, role: "receiver"});
        assert.deepEqual(Object.keys(asked).sort(), ["challengeId", "channel",
          "expiresAtMs", "lastTwo", "resendAfterMs"]);
        assert.ok(!JSON.stringify(asked).includes(receiver.slice(2)));
        assert.equal(sent[sent.length - 1].to, receiver.slice(1));
        assert.equal(await reasonOf(call("requestPhoneLoginCode",
            {trackingCode: "CL-NOPE99", role: "sender"})),
        "tracking_not_found");
      });

  it("says WhatsApp is unavailable so the client offers a text", async () => {
    const phone = freshUs();
    await parkedCar({customerPhone: phone});
    metaFails = true;
    try {
      assert.equal(await reasonOf(call("requestPhoneLoginCode",
          {phone})), "whatsapp_unavailable");
    } finally {
      metaFails = false;
    }
  });
});

describe("SMS sign-in and merging", () => {
  it("a Firebase SMS sign-in lands on the same account as the code",
      async () => {
        const phone = freshUs();
        await parkedCar({customerPhone: phone});
        const placeholder = await userByPhone(phone);
        const session = await smsSignIn(phone);
        assert.equal(session.localId, placeholder.uid);
        const done = await call("completePhoneSignIn", {},
            asUser(placeholder.uid));
        assert.equal(done.uid, placeholder.uid);
        assert.equal(done.profileCreated, false);
        assert.ok((await profile(placeholder.uid)).firstSignInAt);
      });

  it("a brand new number gets a profile on its first SMS sign-in",
      async () => {
        const phone = freshUs();
        const session = await smsSignIn(phone);
        const done = await call("completePhoneSignIn", {},
            asUser(session.localId));
        assert.equal(done.profileCreated, true);
        const p = await profile(session.localId);
        assert.equal(p.accountOrigin, "phone_sign_in");
        assert.equal(p.role, "customer");
      });

  it("merges a placeholder into an email account by WhatsApp code",
      async () => {
        const phone = freshUs();
        const lineId = await containerLine({customerPhone: phone});
        const placeholder = await userByPhone(phone);
        await db.collection("users").doc(placeholder.uid)
            .collection("hiddenShipments").doc("parkedCars__x")
            .set({key: "parkedCars/x"});
        const email = await admin.auth().createUser({
          email: `m${seq}@ex.com`, password: "secret123"});
        await db.collection("users").doc(email.uid).set({role: "customer",
          email: `m${seq}@ex.com`, fullName: "Mariama",
          // An older, unverified number: the proven one replaces it.
          phone: "+12025559999"});
        const emailAuth = {uid: email.uid, token: {
          firebase: {sign_in_provider: "password"}}};
        // Not signed in: no linking.
        assert.equal(await reasonOf(call("requestPhoneLoginCode",
            {phone, purpose: "link"})), "sign_in_required");
        const asked = await call("requestPhoneLoginCode",
            {phone, purpose: "link"}, emailAuth);
        // Another account cannot use that code.
        assert.equal(await reasonOf(call("verifyPhoneLoginCode",
            {challengeId: asked.challengeId, code: lastCodeTo(phone)},
            asUser("someone-else"))), "wrong_account");
        const result = await call("verifyPhoneLoginCode",
            {challengeId: asked.challengeId, code: lastCodeTo(phone)},
            emailAuth);
        assert.deepEqual(result, {linked: true, merged: true});
        assert.equal((await admin.auth().getUser(email.uid)).phoneNumber,
            phone);
        const linked = await profile(email.uid);
        assert.equal(linked.phone, phone);
        assert.equal(linked.phoneVerified, true);
        assert.equal(await admin.auth().getUser(placeholder.uid)
            .catch((error) => error.code), "auth/user-not-found");
        assert.equal(await profile(placeholder.uid), undefined);
        assert.ok((await db.collection("users").doc(email.uid)
            .collection("hiddenShipments").doc("parkedCars__x").get()).exists);
        // The email account now sees the line by its number.
        const mine = await call("getMyShipments", {},
            {uid: email.uid, token: {phone_number: phone,
              firebase: {sign_in_provider: "password"}}});
        assert.ok(mine.items.some((item) =>
          item.key === `containerLines/${lineId}`));
        // The number's claim follows it: a later shipment reuses the email
        // account and makes nothing.
        const claim = (await db.collection("phoneAccountClaims").doc(phone)
            .get()).data();
        assert.equal(claim.uid, email.uid);
        assert.equal(claim.profileReady, true);
        await parkedCar({customerPhone: phone});
        assert.deepEqual((await admin.auth().listUsers(1000)).users
            .filter((user) => user.phoneNumber === phone)
            .map((user) => user.uid), [email.uid]);
      });

  it("merges by SMS proof from a secondary sign-in", async () => {
    const phone = freshUs();
    await parkedCar({customerPhone: phone});
    const placeholder = await userByPhone(phone);
    const proof = await smsSignIn(phone); // the secondary app instance
    assert.equal(proof.localId, placeholder.uid);
    const email = await admin.auth().createUser({email: `s${seq}@ex.com`,
      password: "secret123"});
    await db.collection("users").doc(email.uid).set({role: "customer",
      email: `s${seq}@ex.com`});
    const result = await call("completePhoneSignIn",
        {placeholderIdToken: proof.idToken},
        {uid: email.uid, token: {firebase: {sign_in_provider: "password"}}});
    assert.deepEqual(result, {linked: true, merged: true});
    assert.equal((await admin.auth().getUser(email.uid)).phoneNumber, phone);
  });

  it("never merges an account someone has signed in to", async () => {
    const phone = freshUs();
    const session = await smsSignIn(phone);
    await call("completePhoneSignIn", {}, asUser(session.localId));
    const email = await admin.auth().createUser({email: `n${seq}@ex.com`,
      password: "secret123"});
    await db.collection("users").doc(email.uid).set({role: "customer",
      email: `n${seq}@ex.com`});
    const proof = await smsSignIn(phone);
    assert.equal(await reasonOf(call("completePhoneSignIn",
        {placeholderIdToken: proof.idToken},
        {uid: email.uid, token: {firebase: {sign_in_provider: "password"}}})),
    "phone_in_use");
    assert.ok(await admin.auth().getUser(session.localId));
  });
});

describe("My packages", () => {
  it("lists every record with the number, newest first, without money",
      async () => {
        const phone = freshUs();
        const older = await containerLine({customerPhone: phone,
          createdAt: admin.firestore.Timestamp.fromMillis(Date.now() - 5000)});
        const newer = await parkedCar({customerPhone: freshUs(),
          receiverPhone: phone});
        const received = await containerLine({customerPhone: freshUs(),
          receiverPhone: phone});
        const holder = await userByPhone(phone);
        const auth = asUser(holder.uid, {phone_number: phone});
        const page = await call("getMyShipments", {}, auth);
        const keys = page.items.map((item) => item.key);
        assert.deepEqual(keys, [`containerLines/${received}`,
          `containerLines/${older}`]);
        assert.ok(!keys.includes(`parkedCars/${newer}`),
            "parking has no receiver");
        const [comingToYou, mine] = page.items;
        assert.equal(comingToYou.role, "receiver");
        assert.equal(mine.role, "sender");
        assert.equal(mine.businessName, "Dala Shipping");
        assert.equal(mine.stage, "waiting_container");
        assert.doesNotMatch(JSON.stringify(page),
            /priceCents|payment|15000|Fatou|signIn/);
        assert.equal(page.phoneLastTwo, phone.slice(-2));
      });

  it("a number staff change leaves the old account at once", async () => {
    const phone = freshUs();
    const id = await containerLine({customerPhone: phone});
    const holder = await userByPhone(phone);
    const auth = asUser(holder.uid, {phone_number: phone});
    assert.equal((await call("getMyShipments", {}, auth)).items.length, 1);
    // Before any trigger re-stamps it.
    const next = freshUs();
    await db.collection("containerLines").doc(id)
        .update({customerPhone: next});
    assert.equal((await call("getMyShipments", {}, auth)).items.length, 0);
    await runLineTrigger(id, null);
    const line = await record("containerLines", id);
    assert.equal(line.customerPhoneE164, next);
    const newHolder = await userByPhone(next);
    assert.equal((await call("getMyShipments", {},
        asUser(newHolder.uid, {phone_number: next}))).items.length, 1);
  });

  it("pages through more than a page", async () => {
    const phone = freshUs();
    const base = Date.now() - 100000;
    for (let i = 0; i < 27; i++) {
      await db.collection("containerLines").doc(nextId("pg")).set({
        businessId: US_BIZ, customerPhone: phone, customerPhoneE164: phone,
        containerStatus: "waiting", trackingCode: `CL-PG${i}`,
        createdAt: admin.firestore.Timestamp.fromMillis(base + i * 10)});
    }
    const auth = asUser("pager", {phone_number: phone});
    const first = await call("getMyShipments", {}, auth);
    assert.equal(first.items.length, 25);
    assert.ok(first.nextCursor);
    const second = await call("getMyShipments",
        {cursor: first.nextCursor}, auth);
    assert.equal(second.items.length, 2);
    assert.equal(second.nextCursor, null);
    const all = [...first.items, ...second.items].map((item) => item.key);
    assert.equal(new Set(all).size, 27);
  });

  it("refuses anonymous callers and accounts without a verified number",
      async () => {
        assert.equal(await reasonOf(call("getMyShipments", {}, null)),
            "sign_in_required");
        assert.equal(await reasonOf(call("getMyShipments", {}, {uid: "anon",
          token: {firebase: {sign_in_provider: "anonymous"}}})),
        "sign_in_required");
        const email = await admin.auth().createUser({email: `u${seq}@ex.com`,
          password: "secret123"});
        assert.equal(await reasonOf(call("getMyShipments", {}, {uid:
          email.uid, token: {firebase: {sign_in_provider: "password"}}})),
        "no_verified_phone");
      });

  it("This isn't mine hides it and tells the business once", async () => {
    const phone = freshUs();
    const id = await containerLine({customerPhone: phone});
    const holder = await userByPhone(phone);
    const auth = asUser(holder.uid, {phone_number: phone});
    const key = `containerLines/${id}`;
    const first = await call("reportShipmentNotMine",
        {key, role: "sender"}, auth);
    assert.deepEqual(first, {hidden: true, notified: true});
    assert.deepEqual((await record("containerLines", id))
        .phoneReportedNotMine, ["customerPhone"]);
    assert.equal((await call("getMyShipments", {}, auth)).items.length, 0);
    const second = await call("reportShipmentNotMine",
        {key, role: "sender"}, auth);
    assert.deepEqual(second, {hidden: true, notified: false});
    const notices = (await db.collection("users").doc(OWNER)
        .collection("notifications").get()).docs.map((doc) => doc.data())
        .filter((n) => n.data.relatedId === id);
    assert.equal(notices.length, 1);
    assert.equal(notices[0].data.type, "phone_number_reported");
    // Someone else's record cannot be reported.
    const other = await containerLine({customerPhone: freshUs()});
    assert.equal(await reasonOf(call("reportShipmentNotMine",
        {key: `containerLines/${other}`}, auth)), "record_invalid");
    assert.equal(await reasonOf(call("reportShipmentNotMine",
        {key: "users/x"}, auth)), "record_invalid");
    // Staff fix the number: the report goes with the old number.
    await db.collection("containerLines").doc(id)
        .update({customerPhone: freshUs()});
    await runLineTrigger(id, null);
    assert.equal((await record("containerLines", id)).phoneReportedNotMine,
        undefined);
  });

  it("refuses an unknown action", async () => {
    assert.equal(await reasonOf(call("deleteEverything")), "action_invalid");
  });
});

describe("launch backfill", () => {
  const {run} = require("../scripts/backfill-phone-accounts");
  const BIZ = "throwaway_test_business";

  it("dry-runs, commits one business, resumes, and converges", async () => {
    await db.collection("businesses").doc(BIZ).set({name: "Throwaway",
      country: "United States"});
    const phones = [freshUs(), freshUs(), freshUs()];
    const ids = [];
    for (const [i, phone] of phones.entries()) {
      const id = nextId("bf");
      ids.push(id);
      // Old records: written before the triggers knew about phones.
      await db.collection("containerLines").doc(id).set({businessId: BIZ,
        customerPhone: phone.slice(2),
        receiverPhone: i === 0 ? "622 12 34 56" : "",
        containerStatus: "waiting", trackingCode: `CL-BF${i}`,
        createdAt: admin.firestore.Timestamp.now()});
    }
    // Another business's record is never touched by a single-business run.
    const otherId = nextId("bf-other");
    const otherPhone = freshUs();
    await db.collection("containerLines").doc(otherId).set({
      businessId: US_BIZ, customerPhone: otherPhone,
      createdAt: admin.firestore.Timestamp.now()});

    const dry = await run({projectId: PROJECT, businessId: BIZ,
      commit: false, limit: 500, cursor: ""}, admin);
    assert.equal(dry.done, true);
    assert.equal(dry.report.containerLines.scanned, 3);
    assert.equal(dry.report.containerLines.stamped, 3);
    assert.equal(dry.report.containerLines.flagged, 1); // "622 12 34 56"
    assert.equal(dry.report.containerLines.created, 3);
    for (const phone of phones) assert.equal(await userByPhone(phone), null);
    assert.equal((await record("containerLines", ids[0])).customerPhoneE164,
        undefined);

    // Two records per run: the first run stops and hands over a cursor.
    const first = await run({projectId: PROJECT, businessId: BIZ,
      commit: true, limit: 2, cursor: ""}, admin);
    assert.equal(first.done, false);
    assert.ok(first.cursor);
    const second = await run({projectId: PROJECT, businessId: BIZ,
      commit: true, limit: 500, cursor: first.cursor}, admin);
    assert.equal(second.done, true);
    for (const [i, phone] of phones.entries()) {
      assert.ok(await userByPhone(phone), `account ${i}`);
      assert.equal((await record("containerLines", ids[i]))
          .customerPhoneE164, phone);
    }
    assert.deepEqual((await record("containerLines", ids[0]))
        .phoneCountryCodeMissing, ["receiverPhone"]);
    assert.equal((await record("containerLines", otherId)).customerPhoneE164,
        undefined);
    assert.equal(await userByPhone(otherPhone), null);

    // Run again: nothing to stamp, every account reused.
    const again = await run({projectId: PROJECT, businessId: BIZ,
      commit: true, limit: 500, cursor: ""}, admin);
    assert.equal(again.report.containerLines.stamped, 0);
    assert.equal(again.report.containerLines.created, 0);
    assert.equal(again.report.containerLines.reused, 3);
  });

  it("refuses a run without the project confirmed", () => {
    const {parseArgs} = require("../scripts/backfill-phone-accounts");
    assert.throws(() => parseArgs(["--project", "p"]), /--confirm/);
    assert.throws(() => parseArgs(["--project", "p", "--confirm", "p",
      "--commit", "--dry-run"]), /not both/);
    assert.deepEqual(parseArgs(["--project", "p", "--confirm", "p",
      "--business", "b"]), {projectId: "p", commit: false, businessId: "b",
      limit: 500, cursor: ""});
  });
});

// Review fixes (2026-10).
describe("cost, role and proof guards", () => {
  const {createPhoneAccounts} = require("../phone_accounts");

  it("answers an unknown number exactly like a known one, sending nothing",
      async () => {
        const known = freshUs();
        await parkedCar({customerPhone: known});
        const unknown = freshUs();
        const before = sent.length;
        const a = await call("requestPhoneLoginCode", {phone: known});
        assert.equal(sent.length, before + 1);
        const b = await call("requestPhoneLoginCode", {phone: unknown});
        assert.equal(sent.length, before + 1, "nothing sent to an unknown");
        assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
        assert.equal(b.channel, "whatsapp");
        assert.equal(b.lastTwo, unknown.slice(-2));
        // Nothing opens that challenge, and it says so like any wrong code.
        assert.equal(await reasonOf(call("verifyPhoneLoginCode",
            {challengeId: b.challengeId, code: "123456"})), "code_wrong");
        // Its limits still count: the resend gap applies the same.
        assert.equal(await reasonOf(call("requestPhoneLoginCode",
            {phone: unknown})), "rate_limited");
      });

  it("never signs staff or owners in with a phone code", async () => {
    const phone = freshUs();
    const staff = await admin.auth().createUser({phoneNumber: phone,
      email: `staff${seq}@ex.com`, password: "secret123"});
    await db.collection("users").doc(staff.uid).set({role: "staff",
      businessId: US_BIZ, businessPermissions: ["containers"]});
    await parkedCar({customerPhone: phone});
    const before = sent.length;
    await call("requestPhoneLoginCode", {phone});
    assert.equal(sent.length, before, "no code sent to a staff number");
    // A text sign-in still works at Firebase; the bookkeeping refuses it.
    const session = await smsSignIn(phone);
    assert.equal(session.localId, staff.uid);
    assert.equal(await reasonOf(call("completePhoneSignIn", {},
        asUser(staff.uid))), "phone_sign_in_unavailable");
    // Nor may staff link a number by code.
    assert.equal(await reasonOf(call("requestPhoneLoginCode",
        {phone: freshUs(), purpose: "link"}, {uid: staff.uid,
          token: {firebase: {sign_in_provider: "password"}}})),
    "phone_sign_in_unavailable");
    // And a code that was sent before the account became staff is refused.
    const customerPhone = freshUs();
    await parkedCar({customerPhone});
    const asked = await call("requestPhoneLoginCode",
        {phone: customerPhone});
    const holder = await userByPhone(customerPhone);
    await db.collection("users").doc(holder.uid).set({role: "admin",
      platformAdmin: true}, {merge: true});
    assert.equal(await reasonOf(call("verifyPhoneLoginCode",
        {challengeId: asked.challengeId, code: lastCodeTo(customerPhone)})),
    "phone_sign_in_unavailable");
  });

  it("refuses a merge proof whose holder no longer holds the number",
      async () => {
        const phone = freshUs();
        await parkedCar({customerPhone: phone});
        const proof = await smsSignIn(phone);
        // The number moves to another account before the proof arrives.
        const placeholder = await userByPhone(phone);
        await admin.auth().updateUser(placeholder.uid, {phoneNumber: null});
        const other = await admin.auth().createUser({phoneNumber: phone});
        await db.collection("users").doc(other.uid).set({role: "customer",
          accountOrigin: "shipment", firstSignInAt: null});
        const email = await admin.auth().createUser({
          email: `p${seq}@ex.com`, password: "secret123"});
        await db.collection("users").doc(email.uid).set({role: "customer"});
        assert.equal(await reasonOf(call("completePhoneSignIn",
            {placeholderIdToken: proof.idToken}, {uid: email.uid,
              token: {firebase: {sign_in_provider: "password"}}})),
        "proof_invalid");
        assert.equal((await admin.auth().getUser(email.uid)).phoneNumber,
            undefined);
      });

  it("a failed account creation leaves the number unstamped, and the " +
      "next sync makes it", async () => {
    let failNext = true;
    const flakyAuth = new Proxy(admin.auth(), {get(target, name) {
      if (name === "createUser") {
        return async (...args) => {
          if (failNext) {
            failNext = false;
            throw Object.assign(new Error("Auth is down"),
                {code: "auth/internal-error"});
          }
          return target.createUser(...args);
        };
      }
      const value = target[name];
      return typeof value === "function" ? value.bind(target) : value;
    }});
    const accounts = createPhoneAccounts({db: () => db,
      auth: () => flakyAuth,
      FieldValue: admin.firestore.FieldValue,
      Timestamp: admin.firestore.Timestamp,
      logger: {warn() {}, error() {}, info() {}},
      countries: require("../country_catalog").ALL_COUNTRIES,
      defaultNotificationPreferences: () => ({})});
    const phone = freshUs();
    const id = nextId("flaky");
    await db.collection("parkedCars").doc(id).set({businessId: US_BIZ,
      customerPhone: phone, createdAt: admin.firestore.Timestamp.now()});
    const first = await accounts.syncRecordPhones("parkedCars", id);
    assert.equal(first.accounts[0].status, "failed");
    assert.equal((await record("parkedCars", id)).customerPhoneE164,
        undefined, "not stamped while it has no account");
    const second = await accounts.syncRecordPhones("parkedCars", id);
    assert.equal(second.accounts[0].status, "created");
    assert.equal((await record("parkedCars", id)).customerPhoneE164, phone);
  });

  it("This isn't mine needs the stored number to be the caller's exactly",
      async () => {
        const phone = freshUs();
        // A local number at a non-NANP business: never stamped, though its
        // digits are the tail of the caller's number.
        const id = nextId("gn");
        await db.collection("parkedCars").doc(id).set({businessId: GN_BIZ,
          customerPhone: phone.slice(2),
          createdAt: admin.firestore.Timestamp.now()});
        await runParkedTrigger(id);
        assert.deepEqual((await record("parkedCars", id))
            .phoneCountryCodeMissing, ["customerPhone"]);
        assert.equal(await reasonOf(call("reportShipmentNotMine",
            {key: `parkedCars/${id}`}, asUser("x", {phone_number: phone}))),
        "record_invalid");
      });

  it("stamps records a staff client created directly", async () => {
    const phone = freshUs();
    const id = nextId("tr");
    // The legacy staff transport form writes the record itself: no trigger.
    await db.collection("transportRequests").doc(id).set({
      businessId: US_BIZ, customerPhone: phone, status: "pending",
      createdAt: admin.firestore.Timestamp.now()});
    // A customer who may not manage transport cannot ask.
    assert.match(await reasonOf(call("syncRecord",
        {key: `transportRequests/${id}`}, asUser("stranger"))),
    /permission-denied|not-found/);
    // The new app asks right after saving...
    const result = await call("syncRecord",
        {key: `transportRequests/${id}`}, asUser(OWNER));
    assert.equal(result.synced, true);
    assert.equal((await record("transportRequests", id)).customerPhoneE164,
        phone);
    // ...and the hourly sweep catches what old apps left.
    const oldId = nextId("bs");
    const oldPhone = freshUs();
    await db.collection("barrelShipments").doc(oldId).set({
      businessId: US_BIZ, receiverPhone: oldPhone, status: "pending",
      createdAt: admin.firestore.Timestamp.now()});
    await functions.sweepPackageRequests.run({});
    assert.equal((await record("barrelShipments", oldId)).receiverPhoneE164,
        oldPhone);
    assert.ok(await userByPhone(oldPhone));
  });

  it("stops every send at the platform's daily cap", async () => {
    const {limitDocId: docId, GLOBAL_SENDS_PER_DAY} =
      require("../phone_accounts");
    const ref = db.collection("phoneLoginLimits")
        .doc(docId("global_day", "all"));
    const saved = (await ref.get()).data() || null;
    await ref.set({count: GLOBAL_SENDS_PER_DAY,
      windowStartMs: Date.now() - 1000, lastAtMs: Date.now() - 1000});
    try {
      const phone = freshUs();
      await parkedCar({customerPhone: phone});
      assert.equal(await reasonOf(call("requestPhoneLoginCode", {phone})),
          "rate_limited");
    } finally {
      if (saved) await ref.set(saved);
      else await ref.delete();
    }
  });
});

// 2026-10 production incident: one parked car, two trigger runs at the same
// moment, two Auth users and two profiles for one number. Auth's phone
// uniqueness is not a lock; phoneAccountClaims/{e164} is.
describe("one phone, one account, under concurrency", () => {
  const {createPhoneAccounts} = require("../phone_accounts");
  const quiet = {warn() {}, error() {}, info() {}};
  const profilesWith = async (phone) => (await db.collection("users")
      .where("phone", "==", phone).get()).docs;

  /**
   * Auth as production behaved: createUser never refuses a number another
   * user has, and the phone lookup sees a new user only after a delay.
   *
   * @return {object} {auth, users}.
   */
  function racyAuth() {
    const users = [];
    let next = 0;
    const visible = (user) => Date.now() - user.createdMs > 300;
    const notFound = () => Object.assign(new Error("no user"),
        {code: "auth/user-not-found"});
    return {users, auth: {
      async getUserByPhoneNumber(phone) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        const user = users.find((row) => row.phoneNumber === phone &&
          visible(row));
        if (!user) throw notFound();
        return user;
      },
      async getUser(uid) {
        const user = users.find((row) => row.uid === uid);
        if (!user) throw notFound();
        return user;
      },
      async createUser({phoneNumber, displayName}) {
        await new Promise((resolve) => setTimeout(resolve, 60));
        const user = {uid: `racy-${Date.now()}-${++next}`, phoneNumber,
          displayName, providerData: [{providerId: "phone"}],
          metadata: {}, createdMs: Date.now()};
        users.push(user);
        return user;
      },
    }};
  }

  const accountsWith = (auth) => createPhoneAccounts({db: () => db,
    auth: () => auth, FieldValue: admin.firestore.FieldValue,
    Timestamp: admin.firestore.Timestamp, logger: quiet,
    countries: require("../country_catalog").ALL_COUNTRIES,
    defaultNotificationPreferences: () => ({})});

  it("N concurrent ensurePhoneAccount calls make one Auth user and one " +
      "profile, even when Auth would accept duplicates", async () => {
    const {auth, users} = racyAuth();
    const accounts = accountsWith(auth);
    const phone = freshUs();
    const results = await Promise.all(Array.from({length: 8}, (_, i) =>
      accounts.ensurePhoneAccount({e164: phone, displayName: "Awa",
        source: {collection: "parkedCars", recordId: `race-${i}`,
          field: "customerPhone"}})));
    assert.equal(users.filter((u) => u.phoneNumber === phone).length, 1);
    assert.deepEqual(results.map((r) => r.status).sort(),
        ["created", ...Array(7).fill("reused")]);
    assert.equal(new Set(results.map((r) => r.uid)).size, 1);
    const profiles = await profilesWith(phone);
    assert.equal(profiles.length, 1);
    assert.equal(profiles[0].id, users[0].uid);
    const claim = (await db.collection("phoneAccountClaims").doc(phone)
        .get()).data();
    assert.equal(claim.uid, users[0].uid);
    assert.equal(claim.profileReady, true);
    // Later records read the claim and stop: no Auth call at all.
    const lookups = users.length;
    assert.deepEqual(await accounts.ensurePhoneAccount({e164: phone}),
        {status: "reused", uid: users[0].uid});
    assert.equal(users.length, lookups);
  });

  it("N concurrent syncRecordPhones on records with the same new number " +
      "stamp them all on one account", async () => {
    const {auth, users} = racyAuth();
    const accounts = accountsWith(auth);
    const phone = freshUs();
    const ids = [];
    for (let i = 0; i < 4; i += 1) {
      const id = nextId("race");
      await db.collection("parkedCars").doc(id).set({businessId: US_BIZ,
        customerPhone: phone, customerName: "Awa",
        createdAt: admin.firestore.Timestamp.now()});
      ids.push(id);
    }
    // Each record twice at once: the trigger and its own re-fire.
    await Promise.all([...ids, ...ids].map((id) =>
      accounts.syncRecordPhones("parkedCars", id)));
    assert.equal(users.filter((u) => u.phoneNumber === phone).length, 1);
    assert.equal((await profilesWith(phone)).length, 1);
    for (const id of ids) {
      assert.equal((await record("parkedCars", id)).customerPhoneE164, phone);
    }
  });

  it("two runs of the parked-car trigger at the same moment (real Auth) " +
      "make one account, in one write", async () => {
    const phone = freshUs();
    const id = nextId("pk2");
    const ref = db.collection("parkedCars").doc(id);
    await ref.set({businessId: US_BIZ, status: "parked",
      customerPhone: phone, customerName: "Binta",
      parkingDate: admin.firestore.Timestamp.now(),
      createdAt: admin.firestore.Timestamp.now()});
    const snap = await ref.get();
    await Promise.all([runParkedTrigger(id, null, snap),
      runParkedTrigger(id, null, snap), runParkedTrigger(id, null, snap)]);
    assert.equal((await admin.auth().listUsers(1000)).users
        .filter((user) => user.phoneNumber === phone).length, 1);
    assert.equal((await profilesWith(phone)).length, 1);
    const stamped = await ref.get();
    assert.equal(stamped.data().customerPhoneE164, phone);
    assert.equal(typeof stamped.data().occupancyEndMs, "number",
        "occupancy and phones in the same write");
    // That write re-fires the trigger: nothing left to write.
    await runParkedTrigger(id, snap.data());
    assert.equal((await ref.get()).updateTime.isEqual(stamped.updateTime),
        true);
  });

  it("a status burst on old, never-stamped records makes nothing; a number " +
      "change does", async () => {
    const phone = freshUs();
    const id = nextId("old");
    const ref = db.collection("parkedCars").doc(id);
    const old = {businessId: US_BIZ, status: "parked", customerPhone: phone,
      createdAt: admin.firestore.Timestamp.fromMillis(
          Date.now() - 120 * 24 * 3600 * 1000)};
    await ref.set(old);
    await ref.update({status: "picked_up"});
    await runParkedTrigger(id, old);
    assert.equal(await userByPhone(phone), null);
    assert.equal((await record("parkedCars", id)).customerPhoneE164,
        undefined);
    // The same for an update-only trigger (barrels).
    const barrelId = nextId("oldb");
    const barrelPhone = freshUs();
    const barrel = {businessId: US_BIZ, status: "pending",
      receiverPhone: barrelPhone, createdAt: old.createdAt};
    await db.collection("barrelShipments").doc(barrelId).set(barrel);
    await db.collection("barrelShipments").doc(barrelId)
        .update({status: "shipped"});
    const after = await db.collection("barrelShipments").doc(barrelId).get();
    await functions.notifyBarrelShipmentStatus.run({
      params: {shipmentId: barrelId},
      data: {before: {exists: true, data: () => barrel},
        after: {exists: true, data: () => after.data(),
          updateTime: after.updateTime}}});
    assert.equal(await userByPhone(barrelPhone), null);
    assert.equal((await record("barrelShipments", barrelId))
        .receiverPhoneE164, undefined);
    // Staff change the parked car's number: at once.
    const newPhone = freshUs();
    const before = await record("parkedCars", id);
    await ref.update({customerPhone: newPhone});
    await runParkedTrigger(id, before);
    assert.equal((await record("parkedCars", id)).customerPhoneE164,
        newPhone);
    assert.ok(await userByPhone(newPhone));
  });

  it("a new customer profile writes no custom claims; staff still get " +
      "theirs", async () => {
    const run = async (uid, data) => {
      await db.collection("users").doc(uid).set(data);
      const snap = await db.collection("users").doc(uid).get();
      await functions.syncUserCustomClaims.run({params: {userId: uid},
        data: {before: {exists: false, data: () => null},
          after: {exists: true, data: () => snap.data()}}});
    };
    const customer = await admin.auth().createUser({phoneNumber: freshUs()});
    // A marker: any write by the trigger would replace it.
    await admin.auth().setCustomUserClaims(customer.uid, {marker: true});
    await run(customer.uid, {role: "customer", accountOrigin: "shipment"});
    assert.deepEqual((await admin.auth().getUser(customer.uid)).customClaims,
        {marker: true});
    const staff = await admin.auth().createUser({});
    await run(staff.uid, {role: "staff", businessId: US_BIZ,
      businessPermissions: ["containers"]});
    assert.deepEqual((await admin.auth().getUser(staff.uid)).customClaims, {
      role: "staff", businessId: US_BIZ, adminRole: null,
      businessPermissions: ["containers"]});
  });
});
