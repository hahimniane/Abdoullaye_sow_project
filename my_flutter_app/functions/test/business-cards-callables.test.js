"use strict";

const assert = require("node:assert/strict");
const {before, describe, it} = require("node:test");
const admin = require("firebase-admin");

// Business cards against the Firestore emulator (docs/BUSINESS_CARDS.md):
// a card is minted once per person, a scan needs no sign-in and sees only
// the allowlist, a person who left shows the business alone, staff see
// their own card unless they may see People, and only the owner changes
// the look.
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
