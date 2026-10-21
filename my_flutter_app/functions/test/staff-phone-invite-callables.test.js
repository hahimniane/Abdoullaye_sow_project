"use strict";

const assert = require("node:assert/strict");
const {after, before, describe, it} = require("node:test");
const admin = require("firebase-admin");

// Staff invited by phone (docs/STAFF_PHONE_INVITES.md) against the Auth and
// Firestore emulators: inviting by number (WhatsApp sent, or the link when
// the template is not approved), resend and cancel, the /j/ preview and the
// masked code, accepting after a phone sign-in (a new account, and a
// customer made from a shipment that keeps its packages), the store chosen
// on the form, the sign-in exception (phone-invited staff in; owners and
// email-invited staff still out), and removal ending the sessions. Meta is
// faked at `fetch`; the emulators' own REST endpoints are passed through.
//
// Writes with ADMIN credentials, so it refuses to run outside the emulator.
if (!process.env.FIRESTORE_EMULATOR_HOST ||
    !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  throw new Error(
      "Run this through `npm run test:staff-invites` " +
      "(firebase emulators:exec --only auth,firestore). A direct node --test " +
      "run would write its fixtures into the real project.");
}

process.env.FUNCTIONS_EMULATOR = "true";
process.env.WHATSAPP_ACCESS_TOKEN = "EAAG-test-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "109876543210";

const functions = require("../index");
const {phoneInvitationId} = require("../staff_phone_invite");
const {limitDocId} = require("../phone_accounts");
const db = admin.firestore();
const AUTH_HOST = `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`;

const BIZ = "si-biz";
const OTHER_BIZ = "si-other-biz";
const OWNER = "si-owner";
const OTHER_OWNER = "si-other-owner";
const SUPER = "si-super";
const STORE_A = "si-store-a";
const STORE_B = "si-store-b";

// --- Meta, faked -----------------------------------------------------------
const sent = [];
// "ok", or a Meta error code to answer with.
let metaAnswer = "ok";
const realFetch = global.fetch;
before(() => {
  global.fetch = async (url, init) => {
    const target = String(url);
    if (target.startsWith("https://graph.facebook.com/")) {
      const body = JSON.parse(init.body);
      sent.push(body);
      if (metaAnswer !== "ok") {
        return new Response(JSON.stringify({error: {code: metaAnswer,
          message: "Template name does not exist in the translation"}}),
        {status: 400});
      }
      return new Response(JSON.stringify({messages: [{id: `wamid.${
        sent.length}`}]}), {status: 200});
    }
    // The email invitation's Firebase template (no provider connected).
    if (target.startsWith("https://identitytoolkit.googleapis.com/")) {
      return new Response(JSON.stringify({email: "x"}), {status: 200});
    }
    return realFetch(url, init);
  };
});
after(() => {
  global.fetch = realFetch;
});

const messagesTo = (e164) => sent.filter((body) =>
  body.to === e164.replace(/\D/g, ""));
const lastTo = (e164) => messagesTo(e164).at(-1);
const lastCodeTo = (e164) => {
  const message = [...messagesTo(e164)].reverse().find((body) =>
    body.template.name === "laawol_login_code");
  assert.ok(message, `no code to ${e164}`);
  return message.template.components[0].parameters[0].text;
};

// --- callable plumbing -----------------------------------------------------
let address = 0;
const phoneCall = (action, data = {}, auth = null) =>
  functions.phoneAccount.run({auth, data: {action, ...data},
    rawRequest: {headers: {"x-forwarded-for": `10.8.0.${++address % 250}`}}});
const asOwner = (uid = OWNER) => ({uid, token: {}});
const invite = (data, uid = OWNER) => functions.inviteBusinessMember.run({
  auth: asOwner(uid), data: {businessId: BIZ, locale: "en",
    businessPermissions: ["inventory"], ...data}});
const accept = (uid, data = {}) => functions.acceptAccessInvitation.run({
  auth: {uid, token: {}}, data});
const reasonOf = (promise) => promise.then(() => "ok",
    (error) => error.details?.reason || `${error.code}: ${error.message}`);
const profile = async (uid) =>
  (await db.collection("users").doc(uid).get()).data();
const invitation = async (id) =>
  (await db.collection("accessInvitations").doc(id).get()).data();

// A second code to the same number inside 30 s is refused (resend gap):
// forget the number's buckets, as waiting would.
const forgetLimits = (e164) => Promise.all(["phone_hour", "phone_day"].map(
    (kind) => db.collection("phoneLoginLimits").doc(limitDocId(kind, e164))
        .delete()));

let phoneSeq = 0;
const freshUs = () => `+1202555${String(2000 + (++phoneSeq) % 7000)}`;
const tokenOf = (link) => link.split("/j/")[1];

async function authRest(path, body) {
  const response = await realFetch(
      `${AUTH_HOST}/identitytoolkit.googleapis.com/v1/${path}?key=fake`, {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify(body)});
  const json = await response.json();
  assert.ok(response.ok, JSON.stringify(json));
  return json;
}

async function smsSignIn(e164) {
  const {sessionInfo} = await authRest("accounts:sendVerificationCode",
      {phoneNumber: e164, recaptchaToken: "ignored"});
  const project = process.env.GCLOUD_PROJECT || "demo-laawol-staff-invites";
  const codes = await (await realFetch(
      `${AUTH_HOST}/emulator/v1/projects/${project}/verificationCodes`))
      .json();
  const entry = [...codes.verificationCodes].reverse()
      .find((item) => item.sessionInfo === sessionInfo);
  return authRest("accounts:signInWithPhoneNumber",
      {sessionInfo, code: entry.code});
}

/**
 * The invitation link's sign-in, as the app and console run it: the masked
 * WhatsApp code, then the code.
 *
 * @param {string} token The /j/ token.
 * @param {string} e164 The invited number (to read the fake message).
 * @return {Promise<{uid: string, customToken: string}>} The account.
 */
async function signInFromLink(token, e164) {
  const asked = await phoneCall("requestPhoneLoginCode", {inviteToken: token});
  const verified = await phoneCall("verifyPhoneLoginCode",
      {challengeId: asked.challengeId, code: lastCodeTo(e164)});
  return verified;
}

before(async () => {
  await Promise.all([
    db.collection("businesses").doc(BIZ).set({name: "Dala Shipping",
      country: "United States", ownerUid: OWNER, status: "approved",
      enabledServices: ["inventory", "barrelShipping"]}),
    db.collection("businesses").doc(OTHER_BIZ).set({name: "Conakry Express",
      country: "Guinea", ownerUid: OTHER_OWNER, status: "approved"}),
    db.collection("users").doc(OWNER).set({role: "businessOwner",
      businessId: BIZ, email: "owner@example.test", fullName: "Fatou Diallo"}),
    db.collection("users").doc(OTHER_OWNER).set({role: "businessOwner",
      businessId: OTHER_BIZ, email: "other@example.test",
      fullName: "Alpha Bah"}),
    db.collection("users").doc(SUPER).set({role: "admin",
      platformAdmin: true, adminRole: "superAdmin",
      email: "super@example.test"}),
    admin.auth().createUser({uid: SUPER, email: "super@example.test",
      emailVerified: true}),
    db.collection("inventoryStores").doc(STORE_A).set({businessId: BIZ,
      name: "Main", archived: false}),
    db.collection("inventoryStores").doc(STORE_B).set({businessId: BIZ,
      name: "Bronx", archived: false}),
  ]);
});

// ---------------------------------------------------------------------------

describe("inviting by phone", () => {
  it("creates the invitation and sends the bilingual WhatsApp message",
      async () => {
        const phone = freshUs();
        const result = await invite({method: "phone", phone,
          fullName: "Mamadou Barry"});
        assert.equal(result.channel, "phone");
        assert.equal(result.invitationId, phoneInvitationId(phone, BIZ));
        assert.equal(result.whatsappSent, true);
        assert.equal(result.whatsappStatus, "sent");
        assert.match(result.inviteLink,
            /^https:\/\/customer\.laawoldigital\.com\/j\/[A-Za-z0-9_-]{43}$/);
        assert.equal(result.phoneMasked, `+1 ••••${phone.slice(-2)}`);

        const stored = await invitation(result.invitationId);
        assert.equal(stored.channel, "phone");
        assert.equal(stored.phoneE164, phone);
        assert.equal(stored.email, "");
        assert.equal(stored.status, "pending");
        assert.equal(stored.lastWhatsAppStatus, "sent");
        assert.deepEqual(stored.businessPermissions, ["inventory"]);

        const message = lastTo(phone);
        assert.equal(message.template.name, "staff_account_setup");
        assert.deepEqual(message.template.components[0].parameters
            .map((p) => p.text), ["Mamadou Barry",
          "your staff access at Dala Shipping"]);
        assert.equal(message.template.components[1].parameters[0].text,
            tokenOf(result.inviteLink));
      });

  it("still creates it, with the link to share, when the template is not " +
      "approved yet or WhatsApp is not connected", async () => {
    const pending = freshUs();
    metaAnswer = 132001;
    let result;
    try {
      result = await invite({method: "phone", phone: pending,
        fullName: "Awa"});
    } finally {
      metaAnswer = "ok";
    }
    assert.equal(result.whatsappSent, false);
    assert.equal(result.whatsappStatus, "template_pending");
    assert.ok(result.inviteLink);
    assert.equal((await invitation(result.invitationId)).status, "pending");

    const unset = freshUs();
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    process.env.WHATSAPP_ACCESS_TOKEN = "unset";
    try {
      result = await invite({method: "phone", phone: unset, fullName: "Ibou"});
    } finally {
      process.env.WHATSAPP_ACCESS_TOKEN = token;
    }
    assert.equal(result.whatsappStatus, "not_configured");
    assert.equal(messagesTo(unset).length, 0);
    const rows = await functions.listBusinessInvitations.run({
      auth: asOwner(), data: {businessId: BIZ}});
    const row = rows.invitations.find((entry) =>
      entry.invitationId === result.invitationId);
    assert.equal(row.channel, "phone");
    assert.equal(row.whatsappStatus, "not_configured");
    assert.equal(row.inviteLink, result.inviteLink);
    assert.equal(row.email, "");
    assert.equal(JSON.stringify(row).includes(unset.slice(1)), false);
  });

  it("refuses a number without a country code, a bad number, a second " +
      "live invitation, and a number whose account has other access",
  async () => {
    // A US business may type ten digits; a Guinean one must add +224.
    const local = await invite({method: "phone", phone: "(202) 555-0199",
      fullName: "Local"});
    assert.equal(local.channel, "phone");
    assert.equal(await reasonOf(functions.inviteBusinessMember.run({
      auth: asOwner(OTHER_OWNER), data: {businessId: OTHER_BIZ,
        method: "phone", phone: "622123456", fullName: "X"}})),
    "phone-country-code-required");
    assert.equal(await reasonOf(invite({method: "phone", phone: "12",
      fullName: "X"})), "valid-phone-required");
    assert.equal(await reasonOf(invite({method: "phone",
      phone: "+12025550199", fullName: "Again"})),
    "invitation-already-pending");
    assert.equal(await reasonOf(invite({method: "phone", phone: freshUs(),
      fullName: ""})), "full-name-required");
    // Not the business's owner.
    assert.equal(await reasonOf(invite({method: "phone", phone: freshUs(),
      fullName: "X"}, OTHER_OWNER)), "business-owner-required");
    // The number belongs to another business's owner.
    const ownerPhone = freshUs();
    const ownerUser = await admin.auth().createUser({phoneNumber: ownerPhone});
    await db.collection("users").doc(ownerUser.uid).set({
      role: "businessOwner", businessId: OTHER_BIZ});
    assert.equal(await reasonOf(invite({method: "phone", phone: ownerPhone,
      fullName: "Owner"})), "existing-authority-conflict");
  });

  it("checks the store chosen on the form", async () => {
    assert.equal(await reasonOf(invite({method: "phone", phone: freshUs(),
      fullName: "X", inventoryStoreAccess: {allStores: false}})),
    "store-access-invalid");
    assert.equal(await reasonOf(invite({method: "phone", phone: freshUs(),
      fullName: "X", inventoryStoreAccess: {allStores: false,
        homeStoreId: "not-a-store"}})), "store-not-found");
  });
});

describe("resend and cancel", () => {
  it("resends with a fresh week and the same link, then cancels",
      async () => {
        const phone = freshUs();
        const first = await invite({method: "phone", phone,
          fullName: "Resend Me"});
        const before = (await invitation(first.invitationId)).expiresAt
            .toMillis();
        await new Promise((resolve) => setTimeout(resolve, 20));
        const resent = await functions.resendAccessInvitation.run({
          auth: asOwner(), data: {invitationId: first.invitationId}});
        assert.equal(resent.channel, "phone");
        assert.equal(resent.inviteLink, first.inviteLink);
        assert.equal(resent.whatsappSent, true);
        const stored = await invitation(first.invitationId);
        assert.ok(stored.expiresAt.toMillis() > before);
        assert.equal(stored.sendCount, 2);
        assert.equal(messagesTo(phone).filter((body) =>
          body.template.name === "staff_account_setup").length, 2);

        await functions.cancelAccessInvitation.run({auth: asOwner(),
          data: {invitationId: first.invitationId}});
        const token = tokenOf(first.inviteLink);
        const preview = await phoneCall("staffInvite", {token});
        assert.equal(preview.status, "cancelled");
        assert.equal(await reasonOf(phoneCall("requestPhoneLoginCode",
            {inviteToken: token})), "invite_not_found");
        // Nothing to accept for that number any more.
        const user = await admin.auth().createUser({phoneNumber: phone});
        assert.equal(await reasonOf(accept(user.uid, {inviteToken: token})),
            "invitation-not-pending");
        assert.equal(await reasonOf(accept(user.uid)),
            "active-invitation-not-found");
      });
});

describe("accepting after a phone sign-in", () => {
  it("previews without the number, signs in with the masked code and " +
      "makes a new account staff with its store", async () => {
    const phone = freshUs();
    const made = await invite({method: "phone", phone, fullName: "New Staff",
      inventoryStoreAccess: {allStores: false, homeStoreId: STORE_B}});
    const token = tokenOf(made.inviteLink);
    const preview = await phoneCall("staffInvite", {token});
    assert.deepEqual({status: preview.status, businessName:
      preview.businessName, invitedByName: preview.invitedByName,
    phoneLastTwo: preview.phoneLastTwo}, {status: "pending",
      businessName: "Dala Shipping", invitedByName: "Fatou Diallo",
      phoneLastTwo: phone.slice(-2)});
    assert.equal(JSON.stringify(preview).includes(phone.slice(1)), false);
    assert.equal(await reasonOf(phoneCall("staffInvite",
        {token: "z".repeat(43)})), "invite_not_found");

    // No account yet: the number still gets a real code (a live invitation).
    const signedIn = await signInFromLink(token, phone);
    assert.equal(signedIn.isNewAccount, true);
    assert.equal((await profile(signedIn.uid)).role, "customer");

    const result = await accept(signedIn.uid, {inviteToken: token});
    assert.equal(result.status, "accepted");
    assert.equal(result.channel, "phone");
    assert.equal(result.businessId, BIZ);
    const staff = await profile(signedIn.uid);
    assert.equal(staff.role, "staff");
    assert.equal(staff.businessId, BIZ);
    assert.equal(staff.businessName, "Dala Shipping");
    assert.deepEqual(staff.businessPermissions, ["inventory"]);
    assert.equal(staff.signInMethod, "phone");
    assert.equal(staff.phoneInvite.phoneE164, phone);
    assert.equal(staff.inventoryHomeStoreId, STORE_B);
    assert.equal(staff.inventoryAllStores, false);
    assert.equal((await invitation(made.invitationId)).status, "accepted");

    // Signing in again with the number (code and text) opens the staff
    // account: the exception.
    await forgetLimits(phone);
    const again = await phoneCall("requestPhoneLoginCode", {phone});
    const verified = await phoneCall("verifyPhoneLoginCode",
        {challengeId: again.challengeId, code: lastCodeTo(phone)});
    assert.equal(verified.uid, signedIn.uid);
    await smsSignIn(phone);
    const completed = await phoneCall("completePhoneSignIn", {},
        {uid: signedIn.uid, token: {firebase: {sign_in_provider: "phone"},
          phone_number: phone}});
    assert.equal(completed.uid, signedIn.uid);
    // ... but never linking another number to it.
    assert.equal(await reasonOf(phoneCall("requestPhoneLoginCode",
        {phone: freshUs(), purpose: "link"},
        {uid: signedIn.uid, token: {firebase: {sign_in_provider: "phone"}}})),
    "phone_sign_in_unavailable");
  });

  it("turns the number's customer account (made from a shipment) into the " +
      "staff account and keeps its packages", async () => {
    const phone = freshUs();
    const carId = `si-car-${Date.now()}`;
    await db.collection("parkedCars").doc(carId).set({businessId: OTHER_BIZ,
      status: "parked", trackingCode: `PK-${carId.slice(-6).toUpperCase()}`,
      customerName: "Kadiatou", customerPhone: phone,
      createdAt: admin.firestore.Timestamp.now()});
    const snap = await db.collection("parkedCars").doc(carId).get();
    await functions.syncParkedCarOccupancy.run({params: {parkedCarId: carId},
      data: {before: {exists: false, data: () => null},
        after: {exists: true, data: () => snap.data(), ref: snap.ref,
          updateTime: snap.updateTime}}});
    const placeholder = await admin.auth().getUserByPhoneNumber(phone);
    assert.equal((await profile(placeholder.uid)).accountOrigin, "shipment");

    const made = await invite({method: "phone", phone,
      fullName: "Kadiatou Staff"});
    assert.equal(made.targetUid, placeholder.uid);
    const signedIn = await signInFromLink(tokenOf(made.inviteLink), phone);
    assert.equal(signedIn.uid, placeholder.uid);
    // Without the token: the one live invitation of the verified number.
    const result = await accept(signedIn.uid);
    assert.equal(result.invitationId, made.invitationId);
    const staff = await profile(placeholder.uid);
    assert.equal(staff.role, "staff");
    assert.equal(staff.fullName, "Kadiatou");
    const mine = await phoneCall("getMyShipments", {},
        {uid: placeholder.uid, token: {firebase: {sign_in_provider: "custom"},
          phone_number: phone}});
    assert.ok(mine.items.some((item) => item.key === `parkedCars/${carId}`),
        JSON.stringify(mine.items));
  });

  it("refuses another number, an expired invitation, a choice between " +
      "two, and an account that got other access meanwhile", async () => {
    const phone = freshUs();
    const made = await invite({method: "phone", phone, fullName: "Two"});
    const second = await functions.inviteBusinessMember.run({
      auth: asOwner(OTHER_OWNER), data: {businessId: OTHER_BIZ,
        method: "phone", phone, fullName: "Two", locale: "fr"}});
    const signedIn = await signInFromLink(tokenOf(made.inviteLink), phone);
    assert.equal(await reasonOf(accept(signedIn.uid)),
        "invitation-selection-required");

    const stranger = await admin.auth().createUser({phoneNumber: freshUs()});
    await db.collection("users").doc(stranger.uid).set({role: "customer"});
    assert.equal(await reasonOf(accept(stranger.uid,
        {inviteToken: tokenOf(made.inviteLink)})),
    "invitation-identity-mismatch");

    await db.collection("accessInvitations").doc(second.invitationId).update({
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() - 1000)});
    assert.equal(await reasonOf(accept(signedIn.uid,
        {invitationId: second.invitationId})), "invitation-expired");

    await db.collection("users").doc(signedIn.uid).update({
      role: "staff", businessId: OTHER_BIZ});
    assert.equal(await reasonOf(accept(signedIn.uid,
        {inviteToken: tokenOf(made.inviteLink)})),
    "existing-authority-conflict");
  });
});

describe("the Join prompt after a normal sign-in", () => {
  it("lists what waits for the verified phone or email, and nothing for " +
      "staff", async () => {
    const phone = freshUs();
    const made = await invite({method: "phone", phone, fullName: "Prompt"});
    // A normal sign-in with the number (no link).
    const holder = await admin.auth().createUser({phoneNumber: phone});
    await db.collection("users").doc(holder.uid).set({role: "customer"});
    const listed = await accept(holder.uid, {action: "pending"});
    assert.deepEqual(listed.invitations.map((row) => [row.invitationId,
      row.kind, row.channel, row.businessName, row.invitedByName]),
    [[made.invitationId, "business", "phone", "Dala Shipping",
      "Fatou Diallo"]]);
    assert.equal((await invitation(made.invitationId)).status, "pending");
    // "Join" is the same acceptance.
    await accept(holder.uid, {invitationId: made.invitationId});
    assert.equal((await profile(holder.uid)).role, "staff");
    assert.deepEqual((await accept(holder.uid, {action: "pending"}))
        .invitations, []);

    // A verified email customer invited by email.
    const email = `si-prompt-${Date.now()}@example.test`;
    await admin.auth().createUser({email, emailVerified: true});
    const user = await admin.auth().getUserByEmail(email);
    await db.collection("users").doc(user.uid).set({role: "customer"});
    const byEmail = await invite({method: "email", email,
      fullName: "Email Prompt"});
    const rows = (await accept(user.uid, {action: "pending"})).invitations;
    assert.deepEqual(rows.map((row) => [row.invitationId, row.channel]),
        [[byEmail.invitationId, "email"]]);
    // No verified email and no phone: nothing, and no error.
    const bare = await admin.auth().createUser(
        {email: `bare-${Date.now()}@x.test`});
    assert.deepEqual((await accept(bare.uid, {action: "pending"}))
        .invitations, []);
  });
});

describe("who phone codes still refuse", () => {
  it("owners and email-invited staff get no code and no text sign-in",
      async () => {
        const cases = {
          businessOwner: {role: "businessOwner", businessId: BIZ},
          emailStaff: {role: "staff", businessId: BIZ,
            businessPermissions: ["inventory"]},
          admin: {role: "admin", platformAdmin: true,
            adminRole: "supportAdmin"},
        };
        for (const [name, data] of Object.entries(cases)) {
          const phone = freshUs();
          const user = await admin.auth().createUser({phoneNumber: phone});
          await db.collection("users").doc(user.uid).set(data);
          const asked = await phoneCall("requestPhoneLoginCode", {phone});
          // The decoy: the same answer, but no message and no code works.
          assert.equal(messagesTo(phone).length, 0, name);
          assert.equal(await reasonOf(phoneCall("verifyPhoneLoginCode",
              {challengeId: asked.challengeId, code: "000000"})),
          "code_wrong", name);
          await smsSignIn(phone);
          assert.equal(await reasonOf(phoneCall("completePhoneSignIn", {},
              {uid: user.uid, token: {firebase: {sign_in_provider: "phone"},
                phone_number: phone}})), "phone_sign_in_unavailable", name);
        }
      });

  it("an email invitation accepted by a phone account leaves no exception",
      async () => {
        const email = `si-email-${Date.now()}@example.test`;
        await invite({method: "email", email, fullName: "Email Staff",
          inventoryStoreAccess: {allStores: true}});
        const user = await admin.auth().getUserByEmail(email);
        const phone = freshUs();
        await admin.auth().updateUser(user.uid, {emailVerified: true,
          phoneNumber: phone});
        await db.collection("users").doc(user.uid).set({role: "customer",
          signInMethod: "phone", phoneInvite: {phoneE164: phone}});
        await accept(user.uid);
        const staff = await profile(user.uid);
        assert.equal(staff.role, "staff");
        assert.equal(staff.inventoryAllStores, true);
        assert.equal(staff.signInMethod, undefined);
        assert.equal(staff.phoneInvite, undefined);
        await smsSignIn(phone);
        assert.equal(await reasonOf(phoneCall("completePhoneSignIn", {},
            {uid: user.uid, token: {firebase: {sign_in_provider: "phone"},
              phone_number: phone}})), "phone_sign_in_unavailable");
      });
});

describe("removal", () => {
  it("clears the business and the exception and ends the sessions",
      async () => {
        const phone = freshUs();
        const made = await invite({method: "phone", phone,
          fullName: "Leaving Soon"});
        const signedIn = await signInFromLink(tokenOf(made.inviteLink),
            phone);
        await accept(signedIn.uid, {inviteToken: tokenOf(made.inviteLink)});
        await forgetLimits(phone);
        const session = await authRest("accounts:signInWithCustomToken",
            {token: (await phoneCall("verifyPhoneLoginCode", {
              challengeId: (await phoneCall("requestPhoneLoginCode",
                  {phone})).challengeId,
              code: lastCodeTo(phone)})).customToken,
            returnSecureToken: true});
        await admin.auth().verifyIdToken(session.idToken, true);
        // auth_time has one-second steps.
        await new Promise((resolve) => setTimeout(resolve, 1100));

        const result = await functions.updateBusinessMembership.run({
          auth: {uid: SUPER, token: {}},
          data: {userId: signedIn.uid, role: "customer"}});
        assert.equal(result.sessionsRevoked, true);
        const removed = await profile(signedIn.uid);
        assert.equal(removed.role, "customer");
        assert.equal(removed.businessId, undefined);
        assert.equal(removed.signInMethod, undefined);
        assert.equal(removed.phoneInvite, undefined);
        await assert.rejects(admin.auth().verifyIdToken(session.idToken,
            true), (error) => error.code === "auth/id-token-revoked");
        // Callables read the profile: the staff side refuses at once.
        assert.notEqual(await reasonOf(functions.listBusinessInvitations.run({
          auth: {uid: signedIn.uid, token: {}},
          data: {businessId: BIZ}})), "ok");
        // As a customer again, the number signs in like any customer.
        await forgetLimits(phone);
        const asked = await phoneCall("requestPhoneLoginCode", {phone});
        const back = await phoneCall("verifyPhoneLoginCode",
            {challengeId: asked.challengeId, code: lastCodeTo(phone)});
        assert.equal(back.uid, signedIn.uid);
      });

  it("leaves sessions alone for a change that keeps access", async () => {
    const user = await admin.auth().createUser({});
    await db.collection("users").doc(user.uid).set({role: "staff",
      businessId: BIZ, businessPermissions: ["inventory"]});
    const result = await functions.updateBusinessMembership.run({
      auth: {uid: SUPER, token: {}},
      data: {userId: user.uid, role: "staff", businessId: BIZ}});
    assert.equal(result.sessionsRevoked, false);
    const moved = await functions.updateBusinessMembership.run({
      auth: {uid: SUPER, token: {}},
      data: {userId: user.uid, role: "staff", businessId: OTHER_BIZ}});
    assert.equal(moved.sessionsRevoked, true);
    const demoted = await functions.updateUserRole.run({
      auth: {uid: SUPER, token: {}},
      data: {userId: user.uid, newRole: "customer"}});
    assert.equal(demoted.sessionsRevoked, true);
  });
});
