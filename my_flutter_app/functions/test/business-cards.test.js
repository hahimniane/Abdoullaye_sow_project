"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const cards = require("../business_cards");

// Business cards, the rules with no Firestore (docs/BUSINESS_CARDS.md): the
// code a printed QR carries, the settings a business may choose, and the
// allowlist a stranger's scan is answered with.

const counter = () => {
  let n = 0;
  return (max) => n++ % max;
};

describe("card codes", () => {
  it("builds eight characters from the alphabet nobody misreads", () => {
    const code = cards.buildCardCode(counter());
    assert.equal(code, "23456789");
    assert.equal(code.length, cards.CARD_CODE_LENGTH);
    assert.match(code, cards.CARD_CODE_PATTERN);
    for (const banned of "01OILAEIU") {
      assert.ok(!cards.CARD_ALPHABET.includes(banned), banned);
    }
  });

  it("reads a typed code in any case and refuses anything else", () => {
    assert.equal(cards.normalizeCardCode(" k7m4p2xb "), "K7M4P2XB");
    assert.equal(cards.normalizeCardCode("K7M4P2X"), "");
    assert.equal(cards.normalizeCardCode("K7M4P2XBB"), "");
    assert.equal(cards.normalizeCardCode("K7M4P2XO"), "");
    assert.equal(cards.normalizeCardCode("../users/x"), "");
    assert.equal(cards.normalizeCardCode(null), "");
  });

  it("prints a link that never changes", () => {
    assert.equal(cards.CARD_LINK_BASE, "https://laawoldigital.com/c/");
  });
});

describe("card settings", () => {
  it("gives a business that chose nothing the plain white card", () => {
    assert.deepEqual(cards.normalizeCardSettings(undefined), {
      style: "classic", color: "laawol", accent: "red", photo: "none",
      tagline: "", services: []});
  });

  it("never throws on a damaged document", () => {
    assert.deepEqual(cards.normalizeCardSettings({
      style: "neon", color: 7, accent: null, photo: "boat",
      tagline: "  Car sales \n and   parking ", services: "x"}), {
      style: "classic", color: "laawol", accent: "red", photo: "none",
      tagline: "Car sales and parking", services: []});
  });

  it("keeps what the owner chose, six service lines at most", () => {
    const saved = cards.normalizeCardSettings({
      style: "signature", color: "navy", accent: "red", photo: "car",
      tagline: "Car Sales • Parking • Shipping",
      services: ["Buy & Sell Cars", " ", "Car Parking", "3", "4", "5", "6",
        "7"]});
    assert.equal(saved.style, "signature");
    assert.equal(saved.photo, "car");
    assert.deepEqual(saved.services,
        ["Buy & Sell Cars", "Car Parking", "3", "4", "5", "6"]);
  });

  it("tells an owner everything that is wrong with a save", () => {
    const {errors} = cards.cleanCardSettingsInput({
      style: "neon", color: "pink", accent: "x", photo: "boat",
      tagline: "x".repeat(61),
      services: ["1", "2", "3", "4", "5", "6", "y".repeat(41)]});
    assert.deepEqual(errors.sort(), ["accent_invalid", "color_invalid",
      "photo_invalid", "service_too_long", "services_too_many",
      "style_invalid", "tagline_too_long"]);
    assert.deepEqual(cards.cleanCardSettingsInput({services: "x"}).errors,
        ["services_invalid"]);
  });

  it("accepts a good save and fills what was left out", () => {
    const {settings, errors} = cards.cleanCardSettingsInput({
      style: "signature", color: "navy"});
    assert.deepEqual(errors, []);
    assert.equal(settings.accent, "red");
    assert.deepEqual(settings.services, []);
  });
});

describe("what a scan may see", () => {
  const business = {name: "Sahel Auto Sales", phone: "+1 3475550100",
    website: "https://www.sahelauto.example", addressLine1: "1739 w ave",
    city: "Bronx", state: "NY", postalCode: "10457",
    profileImageUrl: "https://img.example/logo.jpg", requestSlug: "sahel",
    email: "info@sahelauto.example", ownerUid: "owner-1",
    ownerEmail: "owner@example.com", stripeAccountId: "acct_1",
    platformFeePct: 0.08, card: {style: "signature", color: "navy"}};
  const user = {fullName: "Awa Camara", phone: "+13475550142",
    email: "a@example.com", role: "businessOwner", businessId: "biz",
    businessPermissions: ["people"], fcmTokens: ["t"]};

  it("shows the person, both numbers and the business, nothing else", () => {
    const card = cards.publicCard({code: "K7M4P2XB", businessId: "biz",
      business, services: ["carSales", "carParking"], user});
    assert.deepEqual(card, {
      code: "K7M4P2XB",
      link: "https://laawoldigital.com/c/K7M4P2XB",
      person: {name: "Awa Camara", phone: "+13475550142"},
      business: {businessId: "biz", name: "Sahel Auto Sales",
        phone: "+1 3475550100", website: "https://www.sahelauto.example",
        addressLine1: "1739 w ave", city: "Bronx", state: "NY",
        postalCode: "10457", logoUrl: "https://img.example/logo.jpg",
        requestSlug: "sahel", services: ["carSales", "carParking"]},
      settings: {style: "signature", color: "navy", accent: "red",
        photo: "none", tagline: "", services: []},
    });
    const text = JSON.stringify(card);
    for (const secret of ["example.com", "acct_1", "owner-1", "people",
      "businessOwner", "fcm"]) {
      assert.ok(!text.includes(secret), `${secret} leaked`);
    }
  });

  it("is the business's own card when there is no person", () => {
    const card = cards.publicCard({code: "K7M4P2XB", businessId: "biz",
      business, services: [], user: null});
    assert.equal(card.person, null);
    assert.equal(card.business.name, "Sahel Auto Sales");
  });

  it("never prints an email as a name", () => {
    assert.equal(cards.cardPersonName({email: "a@example.com"}), "");
    assert.equal(cards.publicCard({code: "K7M4P2XB", businessId: "biz",
      business, services: [], user: {email: "a@example.com"}}).person, null);
  });

  it("takes the person's number from wherever their account keeps it",
      () => {
        assert.equal(cards.cardPersonPhone({phone: " +1347 "}), "+1347");
        assert.equal(cards.cardPersonPhone({
          phoneInvite: {phoneE164: "+13475550100"}}), "+13475550100");
        assert.equal(cards.cardPersonPhone({}), "");
      });
});

describe("who is on the team", () => {
  it("counts current staff and the owner, and nobody who left", () => {
    const staff = {role: "staff", businessId: "biz"};
    assert.equal(cards.isTeamMember(staff, "biz", "owner", "s1"), true);
    assert.equal(cards.isTeamMember({role: "customer", businessId: "biz"},
        "biz", "owner", "s1"), false);
    assert.equal(cards.isTeamMember(staff, "other", "owner", "s1"), false);
    assert.equal(cards.isTeamMember({role: "customer"}, "biz", "owner",
        "owner"), true);
    assert.equal(cards.isTeamMember(null, "biz", "owner", "owner"), false);
  });
});
