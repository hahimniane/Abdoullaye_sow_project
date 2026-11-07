"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {after, before, describe, it} = require("node:test");
const admin = require("firebase-admin");
const {makeRsaPair, makeTestCertificate, signatureValid, unzip} =
  require("./wallet-test-kit");

// Business cards against the Firestore emulator (docs/BUSINESS_CARDS.md):
// a card is minted once per person, a scan needs no sign-in and sees only
// the allowlist, a person who left shows the business alone, staff see
// their own card unless they may see People, and only the owner changes
// the look. And the wallet passes (docs/BUSINESS_CARDS.md): a team member's
// own card, the Save links, and the signed Apple download served by
// parkingDocument.
//
// Writes with ADMIN credentials, so it refuses to run outside the emulator.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
      "Run this through `npm run test:cards` (firebase emulators:exec). " +
      "A direct node --test run would write its fixtures into the " +
      "real project.");
}

process.env.FUNCTIONS_EMULATOR = "true";

const functions = require("../index");
const {CARD_CODE_PATTERN} = require("../business_cards");
const wallet = require("../business_card_wallet");

const db = admin.firestore();

const BIZ = "card-test-biz";
const PENDING = "card-test-pending";
const OWNER = "card-test-owner";
const PEOPLE = "card-test-people";
const STAFF = "card-test-staff";
const OUTSIDER = "card-test-outsider";

const call = (data, uid) => functions.businessCards.run({
  auth: uid ? {uid, token: {email_verified: true}} : undefined, data});
const scan = (code) => call({action: "get", code});

const refused = (status) => (error) => {
  assert.equal(error.code, status, error.message);
  return true;
};

before(async () => {
  await Promise.all([
    db.collection("businesses").doc(BIZ).set({name: "Sahel Auto Sales",
      status: "approved", ownerUid: OWNER, phone: "+13475550100",
      website: "sahelauto.example", email: "info@example.test",
      enabledServices: ["carSales", "carParking"]}),
    db.collection("businesses").doc(PENDING).set({name: "Not Yet",
      status: "pending", ownerUid: OUTSIDER}),
    db.collection("users").doc(OWNER).set({role: "businessOwner",
      businessId: BIZ, fullName: "Awa Camara",
      phone: "+13475550142", email: "owner@example.test"}),
    db.collection("users").doc(PEOPLE).set({role: "staff", businessId: BIZ,
      businessPermissions: ["people"], fullName: "Mariam Diallo",
      phone: "+13475550101"}),
    db.collection("users").doc(STAFF).set({role: "staff", businessId: BIZ,
      businessPermissions: ["parking"], fullName: "Yao Kouassi",
      phone: "+13475550102"}),
    db.collection("users").doc(OUTSIDER).set({role: "businessOwner",
      businessId: PENDING, fullName: "Other Owner"}),
  ]);
});

describe("business cards", () => {
  let ownerCards = [];

  it("gives the owner a card for the business and each person, once",
      async () => {
        const first = await call({action: "list", businessId: BIZ}, OWNER);
        assert.equal(first.canEdit, true);
        assert.deepEqual(first.cards.map((card) => card.person?.name ?? null),
            [null, "Awa Camara", "Mariam Diallo", "Yao Kouassi"]);
        for (const card of first.cards) {
          assert.match(card.code, CARD_CODE_PATTERN);
          assert.equal(card.link, `https://laawoldigital.com/c/${card.code}`);
        }
        assert.equal(new Set(first.cards.map((card) => card.code)).size, 4);
        assert.deepEqual(first.cards.map((card) => card.mine),
            [false, true, false, false]);
        // Asked again, twice at once: the same codes, never a second card.
        const [again, also] = await Promise.all([
          call({action: "list", businessId: BIZ}, OWNER),
          call({action: "list", businessId: BIZ}, PEOPLE)]);
        const codes = first.cards.map((card) => card.code);
        assert.deepEqual(again.cards.map((card) => card.code), codes);
        assert.deepEqual(also.cards.map((card) => card.code), codes);
        assert.equal((await db.collection("businessCards")
            .where("businessId", "==", BIZ).get()).size, 4);
        ownerCards = first.cards;
      });

  it("shows other staff the business's card and their own only",
      async () => {
        const mine = await call({action: "list", businessId: BIZ}, STAFF);
        assert.equal(mine.canEdit, false);
        assert.deepEqual(mine.cards.map((card) => card.person?.name ?? null),
            [null, "Yao Kouassi"]);
        assert.equal(mine.cards[1].code, ownerCards[3].code);
      });

  it("keeps everyone else out", async () => {
    await assert.rejects(call({action: "list", businessId: BIZ}, OUTSIDER),
        refused("permission-denied"));
    await assert.rejects(call({action: "list", businessId: BIZ}),
        refused("unauthenticated"));
    await assert.rejects(call({action: "nope"}, OWNER),
        refused("invalid-argument"));
  });

  it("answers a scan with no sign-in and only what a customer may see",
      async () => {
        const answer = await scan(ownerCards[1].code.toLowerCase());
        assert.equal(answer.found, true);
        assert.deepEqual(answer.card.person,
            {name: "Awa Camara", phone: "+13475550142"});
        assert.equal(answer.card.business.name, "Sahel Auto Sales");
        assert.equal(answer.card.business.phone, "+13475550100");
        assert.deepEqual(answer.card.business.services,
            ["carSales", "carParking"]);
        const text = JSON.stringify(answer);
        for (const secret of ["example.test", OWNER, "businessOwner"]) {
          assert.ok(!text.includes(secret), `${secret} leaked`);
        }
        assert.equal((await scan(ownerCards[0].code)).card.person, null);
      });

  it("finds nothing for a wrong code or a business not approved",
      async () => {
        assert.deepEqual(await scan("22222222"),
            {version: 1, found: false});
        assert.deepEqual(await scan("not a code"),
            {version: 1, found: false});
        const pending = await call({action: "list", businessId: PENDING},
            OUTSIDER);
        assert.deepEqual(await scan(pending.cards[0].code),
            {version: 1, found: false});
      });

  it("shows the business alone once the person has left", async () => {
    const code = ownerCards[3].code;
    assert.equal((await scan(code)).card.person.name, "Yao Kouassi");
    await db.collection("users").doc(STAFF).update({role: "customer",
      businessId: admin.firestore.FieldValue.delete()});
    const after = await scan(code);
    assert.equal(after.found, true);
    assert.equal(after.card.person, null);
    assert.equal(after.card.business.name, "Sahel Auto Sales");
    // A suspended account's card says nothing about the person either.
    await db.collection("users").doc(PEOPLE).update({
      accountStatus: "suspended"});
    assert.equal((await scan(ownerCards[2].code)).card.person, null);
  });

  it("lets only the owner change how the cards look", async () => {
    await assert.rejects(call({action: "saveSettings", businessId: BIZ,
      settings: {style: "signature"}}, STAFF), refused("permission-denied"));
    await assert.rejects(call({action: "saveSettings", businessId: BIZ,
      settings: {style: "neon", services: ["1", "2", "3", "4", "5", "6",
        "7"]}}, OWNER), (error) => {
      assert.equal(error.code, "invalid-argument");
      assert.deepEqual(error.details.reasons.sort(),
          ["services_too_many", "style_invalid"]);
      return true;
    });
    const saved = await call({action: "saveSettings", businessId: BIZ,
      settings: {style: "signature", color: "navy", accent: "red",
        photo: "car", tagline: "Car Sales • Parking • Shipping",
        services: ["Buy & Sell Cars", "Car Parking"]}}, OWNER);
    assert.equal(saved.settings.style, "signature");
    const scanned = await scan(ownerCards[1].code);
    assert.deepEqual(scanned.card.settings, {style: "signature",
      color: "navy", accent: "red", photo: "car",
      tagline: "Car Sales • Parking • Shipping",
      services: ["Buy & Sell Cars", "Car Parking"]});
    // The business's other fields are untouched.
    const stored = (await db.collection("businesses").doc(BIZ).get()).data();
    assert.equal(stored.name, "Sahel Auto Sales");
    assert.equal(stored.card.updatedBy, OWNER);
  });
});

// ---------------------------------------------------------------------------
// Wallet passes.
// ---------------------------------------------------------------------------

const WBIZ = "card-wallet-biz";
const WPENDING = "card-wallet-pending";
const WOWNER = "card-wallet-owner";
const WSTAFF = "card-wallet-staff";
const WBLOCKED = "card-wallet-blocked";
const WCUSTOMER = "card-wallet-customer";
const WADMIN = "card-wallet-admin";
const WPENDING_OWNER = "card-wallet-pending-owner";
const SECRET_NAMES = ["APPLE_PASS_CERT_PEM", "APPLE_PASS_KEY_PEM",
  "APPLE_PASS_TYPE_ID", "APPLE_WWDR_PEM", "GOOGLE_WALLET_ISSUER_ID",
  "GOOGLE_WALLET_SA_KEY"];
const ISSUER = "3388000000012345678";

const fakeRes = () => {
  const res = {statusCode: 0, body: "", headers: {}, headersSent: false,
    on: () => res, once: () => res, emit: () => true,
    set: (k, v) => {
      res.headers[String(k).toLowerCase()] = v;
      return res;
    },
    setHeader: (k, v) => {
      res.headers[String(k).toLowerCase()] = v;
    },
    getHeader: (k) => res.headers[String(k).toLowerCase()],
    end: (value) => {
      if (value !== undefined) res.body = value;
      res.headersSent = true;
      return res;
    }};
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.send = (value) => {
    res.body = value;
    return res;
  };
  return res;
};

/**
 * Opens a link the way a phone's browser would, through parkingDocument.
 *
 * @param {string} link The link the callable returned.
 * @return {Promise<object>} The fake response.
 */
async function openLink(link) {
  const query = Object.fromEntries(new URL(link).searchParams);
  const res = fakeRes();
  await functions.parkingDocument({method: "GET", query, headers: {},
    on: () => {}, once: () => {}}, res);
  return res;
}

const refusedWith = (status, reason) => (error) => {
  assert.equal(error.code, status, error.message);
  assert.equal(error.details?.reason, reason, error.message);
  return true;
};

describe("wallet passes", () => {
  const pair = makeRsaPair();
  const cert = makeTestCertificate();
  const saved = Object.fromEntries(SECRET_NAMES.map(
      (name) => [name, process.env[name]]));
  let ownerCode = "";
  let staffCode = "";

  const setSecrets = () => {
    process.env.APPLE_PASS_CERT_PEM = cert.certPem;
    process.env.APPLE_PASS_KEY_PEM = cert.keyPem;
    process.env.APPLE_PASS_TYPE_ID = "pass.test.laawol";
    process.env.APPLE_WWDR_PEM = cert.certPem;
    process.env.GOOGLE_WALLET_ISSUER_ID = ISSUER;
    process.env.GOOGLE_WALLET_SA_KEY = JSON.stringify({
      client_email: "wallet@laawol-test.iam.gserviceaccount.com",
      private_key: pair.privateKey});
  };
  const clearSecrets = () => SECRET_NAMES.forEach((name) => {
    process.env[name] = "unset";
  });

  before(async () => {
    clearSecrets();
    await Promise.all([
      db.collection("businesses").doc(WBIZ).set({name: "Wallet Test Motors",
        status: "approved", ownerUid: WOWNER, phone: "+13475550180",
        addressLine1: "9 Example St", city: "Bronx", state: "NY",
        postalCode: "10457", website: "wallettest.example",
        enabledServices: ["carSales"],
        email: "private@example.test", card: {color: "teal"}}),
      db.collection("businesses").doc(WPENDING).set({name: "Wallet Pending",
        status: "pending", ownerUid: WPENDING_OWNER}),
      db.collection("users").doc(WOWNER).set({role: "businessOwner",
        businessId: WBIZ, fullName: "Fatou Bah", phone: "+13475550181",
        email: "fatou@example.test"}),
      db.collection("users").doc(WSTAFF).set({role: "staff",
        businessId: WBIZ, fullName: "Ibrahima Sy", phone: "+13475550182"}),
      db.collection("users").doc(WBLOCKED).set({role: "staff",
        businessId: WBIZ, fullName: "Blocked Person", accountStatus:
          "suspended"}),
      db.collection("users").doc(WCUSTOMER).set({role: "customer",
        fullName: "Just A Customer"}),
      db.collection("users").doc(WADMIN).set({role: "admin",
        fullName: "Platform Admin"}),
      db.collection("users").doc(WPENDING_OWNER).set({role: "businessOwner",
        businessId: WPENDING, fullName: "Pending Owner",
        phone: "+13475550183"}),
    ]);
  });

  after(() => {
    for (const name of SECRET_NAMES) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  it("gives a team member their own card, made once", async () => {
    const answer = await call({action: "mine"}, WSTAFF);
    assert.equal(answer.version, 1);
    assert.match(answer.code, CARD_CODE_PATTERN);
    assert.equal(answer.url, `https://laawoldigital.com/c/${answer.code}`);
    assert.equal(answer.card.code, answer.code);
    assert.equal(answer.card.link, answer.url);
    assert.deepEqual(answer.card.person,
        {name: "Ibrahima Sy", phone: "+13475550182"});
    assert.equal(answer.card.business.name, "Wallet Test Motors");
    assert.equal(answer.card.settings.color, "teal");
    staffCode = answer.code;
    // Asked twice, once together: the same code, and the same one the
    // console's list and a scan use.
    const [again, also] = await Promise.all([
      call({action: "mine", businessId: WBIZ}, WSTAFF),
      call({action: "mine"}, WSTAFF)]);
    assert.equal(again.code, staffCode);
    assert.equal(also.code, staffCode);
    assert.equal((await db.collection("businessCardOwners")
        .doc(`${WBIZ}_${WSTAFF}`).get()).data().code, staffCode);
    assert.equal((await scan(staffCode)).card.person.name, "Ibrahima Sy");
    const owner = await call({action: "mine"}, WOWNER);
    assert.notEqual(owner.code, staffCode);
    assert.equal(owner.card.person.name, "Fatou Bah");
    ownerCode = owner.code;
    const listed = await call({action: "list", businessId: WBIZ}, WOWNER);
    assert.equal(listed.cards.find((card) => card.mine).code, ownerCode);
  });

  it("shows nothing private on the card it hands back", async () => {
    const text = JSON.stringify(await call({action: "mine"}, WOWNER));
    for (const secret of ["example.test", "businessOwner", WOWNER, "staff"]) {
      assert.ok(!text.includes(secret), `${secret} leaked`);
    }
  });

  it("keeps everyone who is not on a business's team out", async () => {
    const notTeam = refusedWith("permission-denied", "not_team_member");
    await assert.rejects(call({action: "mine"}, WCUSTOMER), notTeam);
    await assert.rejects(call({action: "mine"}, WADMIN), notTeam);
    await assert.rejects(call({action: "mine"}, WBLOCKED), notTeam);
    await assert.rejects(call({action: "mine"}, "card-wallet-nobody"),
        notTeam);
    // A businessId may only name the caller's own business.
    await assert.rejects(call({action: "mine", businessId: BIZ}, WSTAFF),
        notTeam);
    await assert.rejects(call({action: "mine", businessId: "../x"}, WSTAFF),
        notTeam);
    await assert.rejects(call({action: "mine"}), refused("unauthenticated"));
    for (const platform of ["apple", "google"]) {
      await assert.rejects(call({action: "wallet", platform}, WCUSTOMER),
          notTeam);
      await assert.rejects(call({action: "wallet", platform}),
          refused("unauthenticated"));
    }
  });

  it("says no wallet is ready while the secrets are unset", async () => {
    clearSecrets();
    assert.deepEqual((await call({action: "mine"}, WSTAFF)).wallet,
        {apple: false, google: false});
    for (const platform of ["apple", "google"]) {
      await assert.rejects(call({action: "wallet", platform}, WSTAFF),
          refusedWith("failed-precondition", "wallet_not_ready"));
    }
    // Apple set up, Google not.
    process.env.APPLE_PASS_CERT_PEM = cert.certPem;
    process.env.APPLE_PASS_KEY_PEM = cert.keyPem;
    process.env.APPLE_PASS_TYPE_ID = "pass.test.laawol";
    process.env.APPLE_WWDR_PEM = cert.certPem;
    assert.deepEqual((await call({action: "mine"}, WSTAFF)).wallet,
        {apple: true, google: false});
    await assert.rejects(call({action: "wallet", platform: "google"}, WSTAFF),
        refusedWith("failed-precondition", "wallet_not_ready"));
    clearSecrets();
  });

  it("refuses a platform it does not know", async () => {
    setSecrets();
    for (const platform of [undefined, "", "samsung", "APPLE"]) {
      await assert.rejects(call({action: "wallet", platform}, WSTAFF),
          refusedWith("invalid-argument", "platform_invalid"));
    }
  });

  it("answers a Google Save link for the caller's own card", async () => {
    setSecrets();
    assert.deepEqual((await call({action: "mine"}, WSTAFF)).wallet,
        {apple: true, google: true});
    const answer = await call({action: "wallet", platform: "google"}, WSTAFF);
    assert.equal(answer.platform, "google");
    const jwt = answer.url.replace("https://pay.google.com/gp/v/save/", "");
    assert.notEqual(jwt, answer.url);
    const [head, body, signature] = jwt.split(".");
    assert.equal(crypto.createVerify("RSA-SHA256").update(`${head}.${body}`)
        .verify(pair.publicKey, Buffer.from(signature, "base64url")), true);
    const claims = JSON.parse(Buffer.from(body, "base64url"));
    assert.equal(claims.typ, "savetowallet");
    assert.deepEqual(claims.payload.genericClasses,
        [{id: `${ISSUER}.laawol_card`}]);
    const [object] = claims.payload.genericObjects;
    assert.equal(object.id, `${ISSUER}.laawol_card_${staffCode}`);
    assert.equal(object.classId, `${ISSUER}.laawol_card`);
    assert.equal(object.header.defaultValue.value, "Ibrahima Sy");
    assert.equal(object.cardTitle.defaultValue.value, "Wallet Test Motors");
    assert.equal(object.barcode.value,
        `https://laawoldigital.com/c/${staffCode}`);
    assert.equal(object.hexBackgroundColor, "#0f766e");
    assert.ok(!JSON.stringify(claims).includes("example.test"));
    // Someone else's link names their own card, never the caller's.
    const owner = await call({action: "wallet", platform: "google"}, WOWNER);
    const ownerJwt = owner.url.replace("https://pay.google.com/gp/v/save/",
        "");
    const ownerBody = JSON.parse(Buffer.from(
        ownerJwt.split(".")[1], "base64url"));
    assert.equal(ownerBody.payload.genericObjects[0].id,
        `${ISSUER}.laawol_card_${ownerCode}`);
  });

  it("refuses a wallet pass until the business is approved", async () => {
    setSecrets();
    for (const platform of ["apple", "google"]) {
      await assert.rejects(
          call({action: "wallet", platform}, WPENDING_OWNER),
          refusedWith("failed-precondition", "business_not_approved"));
    }
    // The card itself is still theirs to see.
    assert.equal((await call({action: "mine"}, WPENDING_OWNER)).card.person
        .name, "Pending Owner");
  });

  it("hands out a ten-minute Apple link that parkingDocument serves",
      async () => {
        setSecrets();
        const answer = await call({action: "wallet", platform: "apple"},
            WSTAFF);
        assert.equal(answer.platform, "apple");
        assert.equal(answer.expiresInSeconds, 600);
        const link = new URL(answer.url);
        assert.ok(link.pathname.endsWith("/parkingDocument"), answer.url);
        assert.equal(link.searchParams.get("view"), "card-pass");
        const res = await openLink(answer.url);
        assert.equal(res.statusCode, 200);
        assert.equal(res.headers["content-type"],
            "application/vnd.apple.pkpass");
        assert.match(res.headers["content-disposition"],
            new RegExp(`laawol-card-${staffCode}\\.pkpass`));
        assert.equal(res.headers["cache-control"], "private, no-store");
        const files = unzip(res.body);
        const pass = JSON.parse(files["pass.json"].toString("utf8"));
        assert.equal(pass.serialNumber, `laawol-card-${staffCode}`);
        assert.equal(pass.passTypeIdentifier, "pass.test.laawol");
        assert.equal(pass.organizationName, "Wallet Test Motors");
        assert.equal(pass.generic.primaryFields[0].value, "Ibrahima Sy");
        assert.equal(pass.barcodes[0].message,
            `https://laawoldigital.com/c/${staffCode}`);
        assert.equal(pass.backgroundColor, "rgb(15, 118, 110)");
        assert.equal(signatureValid(files.signature, files["manifest.json"],
            cert.certPem), true);
        assert.ok(!res.body.toString("latin1").includes("example.test"));
      });

  it("serves a card as it is now: a changed number is on the next pass",
      async () => {
        setSecrets();
        await db.collection("users").doc(WSTAFF).update({
          phone: "+13475550199"});
        const {url} = await call({action: "wallet", platform: "apple"},
            WSTAFF);
        const files = unzip((await openLink(url)).body);
        const pass = JSON.parse(files["pass.json"].toString("utf8"));
        assert.equal(pass.generic.secondaryFields[0].value, "(347) 555-0199");
      });

  it("rejects an expired, tampered or foreign Apple link", async () => {
    setSecrets();
    const {url} = await call({action: "wallet", platform: "apple"}, WSTAFF);
    const token = new URL(url).searchParams.get("t");
    const base = url.split("?")[0];
    const open = (t, extra = {}) => openLink(`${base}?${new URLSearchParams(
        {view: "card-pass", t, ...extra})}`);
    assert.equal((await open(token)).statusCode, 200);

    // Expired: signed eleven minutes ago.
    const stale = wallet.signCardPassToken(cert.keyPem, staffCode,
        Date.now() - 11 * 60 * 1000);
    assert.equal((await open(stale)).statusCode, 404);
    // Tampered: another card's code under this link's signature.
    const [body, mac] = token.split(".");
    const forged = Buffer.from(JSON.stringify({
      ...JSON.parse(Buffer.from(body, "base64url")),
      c: ownerCode})).toString("base64url");
    assert.equal((await open(`${forged}.${mac}`)).statusCode, 404);
    assert.equal((await open(`${body}.${mac.slice(0, -2)}AA`)).statusCode,
        404);
    // Signed with some other key, or not a token at all.
    assert.equal((await open(wallet.signCardPassToken("some other key",
        staffCode))).statusCode, 404);
    assert.equal((await open("short")).statusCode, 404);
    assert.equal((await open("x".repeat(40))).statusCode, 404);
    // A card code alone is the capability of the web page, not of a pass.
    assert.equal((await open(staffCode.repeat(3))).statusCode, 404);
    const res = await open(token);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "application/vnd.apple.pkpass");
  });

  it("stops serving the pass once Apple is unset or the business is not " +
      "approved", async () => {
    setSecrets();
    const {url} = await call({action: "wallet", platform: "apple"},
        WOWNER);
    assert.equal((await openLink(url)).statusCode, 200);
    await db.collection("businesses").doc(WBIZ).update({
      status: "suspended"});
    assert.equal((await openLink(url)).statusCode, 404);
    await db.collection("businesses").doc(WBIZ).update({
      status: "approved"});
    assert.equal((await openLink(url)).statusCode, 200);
    clearSecrets();
    assert.equal((await openLink(url)).statusCode, 404);
  });

  it("gives a person who left a pass for the business alone", async () => {
    setSecrets();
    const {url} = await call({action: "wallet", platform: "apple"}, WSTAFF);
    await db.collection("users").doc(WSTAFF).update({role: "customer",
      businessId: admin.firestore.FieldValue.delete()});
    const pass = JSON.parse(unzip((await openLink(url)).body)["pass.json"]
        .toString("utf8"));
    assert.equal(pass.generic.primaryFields[0].value, "Wallet Test Motors");
    assert.ok(!JSON.stringify(pass).includes("Ibrahima"));
    await assert.rejects(call({action: "wallet", platform: "apple"}, WSTAFF),
        refusedWith("permission-denied", "not_team_member"));
  });
});
