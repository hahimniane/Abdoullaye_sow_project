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
      person: {name: "Awa Camara", phone: "+13475550142", phones: []},
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

  it("finds the logo where the business's documents find it", () => {
    const logoOf = (fields) => cards.cardBusiness("biz", fields, []).logoUrl;
    // An older account keeps its logo in logoUrl, with no profile image.
    assert.equal(logoOf({logoUrl: "https://img.example/old.jpg",
      profileImageUrl: ""}), "https://img.example/old.jpg");
    assert.equal(logoOf({profileImageUrl: "https://img.example/new.jpg"}),
        "https://img.example/new.jpg");
    // No logo, or one that is not a plain https address: the card draws
    // the business's initials, never the Laawol mark.
    assert.equal(logoOf({}), "");
    assert.equal(logoOf({logoUrl: "javascript:alert(1)"}), "");
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

describe("a person's extra numbers", () => {
  const own = "+13475550142";

  it("keeps up to three, each a real number with a one-line label", () => {
    const {phones, errors} = cards.cleanCardPhonesInput([
      {label: "  WhatsApp\n ", phone: "(929) 555-0101"},
      {label: "Guinea", phone: "+224 621 23 45 67"},
      {label: "", phone: "+33 6 12 34 56 78"},
    ], own);
    assert.deepEqual(errors, []);
    assert.deepEqual(phones, [
      {label: "WhatsApp", phone: "(929) 555-0101"},
      {label: "Guinea", phone: "+224 621 23 45 67"},
      {label: "", phone: "+33 6 12 34 56 78"},
    ]);
  });

  it("drops blank rows and repeats of the person's own or earlier numbers",
      () => {
        const {phones, errors} = cards.cleanCardPhonesInput([
          {label: "Again", phone: "347-555-0142"},
          {label: "", phone: ""},
          {label: "Home", phone: "929 555 0101"},
          {label: "Home too", phone: "+1 929 555 0101"},
        ], "3475550142");
        assert.deepEqual(errors, []);
        assert.deepEqual(phones, [{label: "Home", phone: "929 555 0101"}]);
      });

  it("names every row that is wrong, and too many", () => {
    assert.deepEqual(cards.cleanCardPhonesInput([
      {label: "x", phone: "call me"},
      {label: "y", phone: "0621234567"},
    ], own).errors, ["phone_0_invalid", "phone_1_needs_country_code"]);
    const four = ["+19295550101", "+19295550102", "+19295550103",
      "+19295550104"].map((phone) => ({label: "", phone}));
    const result = cards.cleanCardPhonesInput(four, own);
    assert.deepEqual(result.errors, ["too_many_phones"]);
    assert.equal(result.phones.length, cards.CARD_EXTRA_PHONES_MAX);
  });

  it("cuts a long label and never throws on a damaged profile", () => {
    const [row] = cards.cleanCardPhonesInput(
        [{label: "x".repeat(50), phone: "+19295550101"}]).phones;
    assert.equal(row.label.length, cards.CARD_PHONE_LABEL_MAX);
    for (const raw of [null, "nope", 7, {}, [null, 3, "x"]]) {
      assert.deepEqual(cards.cardPersonPhones({cardPhones: raw}), []);
    }
  });

  it("are on the card a scan opens, after the person's own number", () => {
    const card = cards.publicCard({code: "K7M4P2XB", businessId: "b",
      business: {name: "Sahel"}, services: [], user: {fullName: "Awa",
        phone: own, cardPhones: [{label: "WhatsApp", phone: "+19295550101"},
          {label: "Bad", phone: "nope"}]}});
    assert.deepEqual(card.person, {name: "Awa", phone: own,
      phones: [{label: "WhatsApp", phone: "+19295550101"}]});
  });
});
