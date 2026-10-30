"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const proof = require("../package_proof");

const BIZ = "nensona";
const UID = "staffUid123";
const PATH = `packagePhotos/${BIZ}/${UID}/abcd1234efgh.jpg`;

describe("photo paths", () => {
  it("accepts our root, a folder and a jpg/png/webp file", () => {
    assert.deepEqual(proof.photoPathParts(PATH),
        {businessId: BIZ, folder: UID, fileId: "abcd1234efgh.jpg"});
    assert.equal(proof.photoPath(BIZ, "wa", "a1b2c3d4e5f6.webp"),
        `packagePhotos/${BIZ}/wa/a1b2c3d4e5f6.webp`);
  });

  it("rejects other roots, traversal and odd extensions", () => {
    for (const bad of [
      `packageRequestPhotos/${BIZ}/${UID}/abcd1234efgh.jpg`,
      `packagePhotos/${BIZ}/${UID}/../abcd1234efgh.jpg`,
      `packagePhotos/${BIZ}/${UID}/abcd1234efgh.gif`,
      `packagePhotos/${BIZ}/${UID}/short.jpg`,
      `packagePhotos/${BIZ}/abcd1234efgh.jpg`,
      "",
    ]) {
      assert.equal(proof.photoPathParts(bad), null, bad);
      assert.equal(proof.photoPath(BIZ, UID, "../x.jpg"), "");
    }
  });

  it("lets staff attach only their own folder in their business", () => {
    assert.equal(proof.photoPathAllowed(PATH, {businessId: BIZ, uid: UID}),
        true);
    assert.equal(proof.photoPathAllowed(PATH, {businessId: "keren", uid: UID}),
        false);
    assert.equal(proof.photoPathAllowed(PATH, {businessId: BIZ, uid: "other"}),
        false);
    const wa = `packagePhotos/${BIZ}/wa/abcd1234efgh.jpg`;
    assert.equal(proof.photoPathAllowed(wa, {businessId: BIZ, uid: UID}),
        false);
    assert.equal(proof.photoPathAllowed(wa,
        {businessId: BIZ, uid: UID, allowServerFolders: true}), true);
  });

  it("handover slips: the caller's own folder in their business only", () => {
    const slip = `staffHandoverProofs/${BIZ}/${UID}/abcd1234efgh.png`;
    assert.equal(proof.handoverProofAllowed(slip,
        {businessId: BIZ, uid: UID}), true);
    assert.equal(proof.handoverProofAllowed(slip,
        {businessId: BIZ, uid: "other"}), false);
    assert.equal(proof.handoverProofAllowed(slip,
        {businessId: "keren", uid: UID}), false);
    // A package photo is not a slip, and a slip is not a package photo.
    assert.equal(proof.handoverProofAllowed(PATH,
        {businessId: BIZ, uid: UID}), false);
    assert.equal(proof.photoPathParts(slip), null);
    assert.equal(proof.handoverProofAllowed(
        `staffHandoverProofs/${BIZ}/${UID}/short.jpg`,
        {businessId: BIZ, uid: UID}), false);
  });

  it("checks size and type of the stored file", () => {
    assert.equal(proof.photoMetadataValid(
        {size: "120000", contentType: "image/jpeg"}), true);
    assert.equal(proof.photoMetadataValid(
        {size: 3 * 1024 * 1024, contentType: "image/jpeg"}), false);
    assert.equal(proof.photoMetadataValid(
        {size: 1000, contentType: "application/pdf"}), false);
    assert.equal(proof.photoMetadataValid({size: 0, contentType: "image/png"}),
        false);
  });

  it("keeps at most five unique paths", () => {
    const paths = Array.from({length: 6},
        (_, i) => `packagePhotos/${BIZ}/${UID}/photo000${i}xx.jpg`);
    assert.equal(proof.normalizePhotoPaths(paths).error, "photo_invalid");
    assert.deepEqual(proof.normalizePhotoPaths([PATH, PATH]).paths, [PATH]);
    assert.deepEqual(proof.normalizePhotoPaths(undefined),
        {paths: [], error: ""});
    assert.equal(proof.normalizePhotoPaths("x").error, "photo_invalid");
  });
});

describe("photo links", () => {
  const token = "tok_0123456789abcdefghij";
  const now = 1800000000000;

  it("signs the token, path and expiry and verifies them", () => {
    const link = proof.photoLink({base: "https://laawoldigital.com/d", token,
      path: PATH, expiresMs: now + proof.PHOTO_LINK_MS});
    const url = new URL(link);
    assert.equal(url.searchParams.get("view"), "photo");
    const query = Object.fromEntries(url.searchParams.entries());
    assert.equal(proof.photoLinkValid(query, token, now), true);
    assert.equal(proof.photoLinkValid(query, token,
        now + proof.PHOTO_LINK_MS + 1), false, "expired");
    assert.equal(proof.photoLinkValid(query, "other-token", now), false);
    assert.equal(proof.photoLinkValid({...query, e: String(now + 10 ** 10)},
        token, now), false, "stretched expiry");
    assert.equal(proof.photoLinkValid({...query, p: PATH.replace("abcd",
        "zzzz")}, token, now), false, "other file");
    assert.equal(proof.photoLinkValid(query, "", now), false, "no token");
  });
});

describe("pickup code", () => {
  it("is four digits and never 0000", () => {
    assert.equal(proof.pickupCodeFrom(Buffer.from([0, 0])).length, 4);
    assert.notEqual(proof.pickupCodeFrom(Buffer.from([0, 0])), "0000");
    // 0x2710 = 10000 -> 0 -> replaced, never "0000".
    assert.notEqual(proof.pickupCodeFrom(Buffer.from([0x27, 0x10])), "0000");
    assert.match(proof.pickupCodeFrom(Buffer.from([0xff, 0xfe])), /^\d{4}$/);
    assert.equal(proof.pickupCodeFrom(Buffer.from([0x00, 0x2a])), "0042");
  });

  it("matches digits only, ignoring spaces", () => {
    assert.equal(proof.pickupCodeMatches("48 21", "4821"), true);
    assert.equal(proof.pickupCodeMatches("4822", "4821"), false);
    assert.equal(proof.pickupCodeMatches("", "4821"), false);
    assert.equal(proof.pickupCodeMatches("4821", ""), false);
  });

  it("decides the handover from the switch, the code and the override", () => {
    const on = {pickupCode: true};
    const line = {pickupCode: "4821"};
    assert.deepEqual(proof.handoverCheck({pickupCode: false}, line, {}),
        {refusal: "", withoutCode: false});
    assert.deepEqual(proof.handoverCheck(on, {}, {}),
        {refusal: "", withoutCode: false}, "older line without a code");
    assert.deepEqual(proof.handoverCheck(on, line, {pickupCode: "4821"}),
        {refusal: "", withoutCode: false});
    assert.deepEqual(proof.handoverCheck(on, line, {pickupCode: "1111"}),
        {refusal: "pickup_code_invalid", withoutCode: false});
    assert.deepEqual(proof.handoverCheck(on, line, {override: {}}),
        {refusal: "override_incomplete", withoutCode: false});
    assert.deepEqual(proof.handoverCheck(on, line,
        {override: {collectedBy: "Mamadou Bah", photoPath: PATH}}),
    {refusal: "", withoutCode: true});
  });
});

describe("contents, weight and value", () => {
  it("normalizes the item list", () => {
    const out = proof.normalizeContents([
      {label: " iPhone 13 ", quantity: "2", serial: "35-209900-176148-1"},
      {label: "clothes"},
      {label: ""},
    ]);
    assert.equal(out.error, "");
    assert.deepEqual(out.contents, [
      {label: "iPhone 13", quantity: 2, serial: "35-209900-176148-1"},
      {label: "clothes", quantity: 1, serial: ""},
    ]);
    assert.equal(proof.normalizeContents([{label: "x", quantity: 100}]).error,
        "contents_invalid");
    assert.equal(proof.normalizeContents([{label: "x".repeat(61)}]).error,
        "contents_invalid");
    assert.equal(proof.normalizeContents(Array.from({length: 11},
        () => ({label: "a"}))).error, "contents_invalid");
    assert.deepEqual(proof.normalizeContents(undefined),
        {contents: [], error: ""});
  });

  it("writes the list for a message and trims long ones", () => {
    const contents = [{label: "phones", quantity: 2}, {label: "tablet",
      quantity: 1}, {label: "clothes", quantity: 1}];
    assert.equal(proof.contentsText(contents), "2 phones, tablet, clothes");
    assert.equal(proof.contentsText([]), "");
    const long = proof.contentsText(Array.from({length: 10},
        (_, i) => ({label: `item number ${i} with a long name`, quantity: 1})),
    60);
    assert.ok(long.length <= 60, long);
    assert.ok(long.endsWith("…"));
  });

  it("rounds weight to one decimal within range", () => {
    assert.equal(proof.normalizeWeightLb("4.26"), 4.3);
    assert.equal(proof.normalizeWeightLb(null), null);
    assert.equal(proof.normalizeWeightLb(""), null);
    assert.ok(Number.isNaN(proof.normalizeWeightLb(0)));
    assert.ok(Number.isNaN(proof.normalizeWeightLb(2001)));
    assert.ok(Number.isNaN(proof.normalizeWeightLb("heavy")));
    assert.equal(proof.weightText(4.2, "en"), "4.2 lb");
    assert.equal(proof.weightText(4.2, "fr"), "4,2 lb");
    assert.equal(proof.weightText(5, "en"), "5 lb");
    assert.equal(proof.weightText(null, "en"), "");
  });

  it("takes whole cents at or above zero as the declared value", () => {
    assert.equal(proof.normalizeDeclaredValueCents(90000), 90000);
    assert.equal(proof.normalizeDeclaredValueCents(0), 0);
    assert.equal(proof.normalizeDeclaredValueCents(null), null);
    assert.ok(Number.isNaN(proof.normalizeDeclaredValueCents(-1)));
    assert.ok(Number.isNaN(proof.normalizeDeclaredValueCents(10.5)));
  });

  it("checks the four fields together and names the first problem", () => {
    const ok = proof.validateProofFields({photoPaths: [PATH],
      contents: [{label: "phone"}], weightLb: 4.2, declaredValueCents: 1000});
    assert.equal(ok.error, "");
    assert.deepEqual(ok.fields, {photoPaths: [PATH], contents: [{label:
      "phone", quantity: 1, serial: ""}], weightLb: 4.2,
    declaredValueCents: 1000});
    assert.deepEqual(proof.validateProofFields({}).fields,
        {photoPaths: [], contents: [], weightLb: null,
          declaredValueCents: null});
    assert.equal(proof.validateProofFields({weightLb: -1}).error,
        "weight_invalid");
    assert.equal(proof.validateProofFields({declaredValueCents: 1.5}).error,
        "declared_value_invalid");
  });
});

describe("proof settings and ticks", () => {
  it("reads the three switches, missing means off", () => {
    assert.deepEqual(proof.proofSettingsOf({}),
        {photosRequired: false, senderConfirm: false, pickupCode: false});
    assert.deepEqual(proof.proofSettingsOf({packageProofSettings:
      {photosRequired: true, pickupCode: "yes"}}),
    {photosRequired: true, senderConfirm: false, pickupCode: false});
    assert.equal(proof.validateProofSettings({senderConfirm: "on"}).error,
        "proof_settings_invalid");
    assert.deepEqual(proof.validateProofSettings({senderConfirm: true})
        .settings, {photosRequired: false, senderConfirm: true,
      pickupCode: false});
  });

  it("requires a photo only for air counter drop-offs when on", () => {
    const on = {photosRequired: true};
    assert.equal(proof.photoRequirementRefusal(on, {photoPaths: [],
      shipMode: "air"}), "photo_required");
    assert.equal(proof.photoRequirementRefusal(on, {source: "counter",
      photoPaths: [PATH], shipMode: "air"}), "");
    assert.equal(proof.photoRequirementRefusal(on, {source: "request",
      photoPaths: [], shipMode: "air"}), "");
    assert.equal(proof.photoRequirementRefusal({photosRequired: false},
        {photoPaths: [], shipMode: "air"}), "");
    // A sea package (or one from before "Ships by") never needs a photo.
    assert.equal(proof.photoRequirementRefusal(on, {source: "counter",
      photoPaths: [], shipMode: "sea"}), "");
    assert.equal(proof.photoRequirementRefusal(on, {photoPaths: []}), "");
  });

  it("maps button payloads and shows the three ticks", () => {
    assert.equal(proof.confirmationFromPayload("confirm_ok"), "confirmed");
    assert.equal(proof.confirmationFromPayload("CONFIRM_PROBLEM"), "problem");
    assert.equal(proof.confirmationFromPayload("hello"), "");
    assert.deepEqual(proof.proofTicks({shipMode: "air", photoPaths: [PATH],
      senderConfirmation: {status: "confirmed"}, deliveredAt: {}}),
    {air: true, photo: true, senderOk: "confirmed", delivered: true,
      complete: true});
    assert.deepEqual(proof.proofTicks({shipMode: "air"}), {air: true,
      photo: false, senderOk: "none", delivered: false, complete: false});
    assert.equal(proof.proofTicks({shipMode: "air", deliveredAt: {}})
        .complete, false);
    // A sea package (or one from before "Ships by") has only the delivered
    // tick: complete once delivered, with no photo or sender answer.
    assert.deepEqual(proof.proofTicks({}),
        {air: false, photo: false, senderOk: "none", delivered: false,
          complete: false});
    assert.equal(proof.proofTicks({shipMode: "sea", deliveredAt: {}})
        .complete, true);
    assert.equal(proof.senderConfirmationOf({senderConfirmation:
      {status: "weird"}}).status, "none");
  });
});
