"use strict";

// A driver reports a payment from the app (docs/FLEET.md section 14),
// against the Firestore emulator: `fleetAction {action: "driver_claim"}`
// makes the same claim as a picture sent on WhatsApp, for the caller's own
// driver record only. The picture reader and the file store are fakes.
// Synthetic data only.
//
// Run through `npm run test:fleet` (firebase emulators:exec).

const assert = require("node:assert/strict");
const {before, beforeEach, describe, it} = require("node:test");
const admin = require("firebase-admin");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
      "Run this through `npm run test:fleet` (firebase emulators:exec). " +
      "A direct node --test run would write into the real project.");
}
process.env.FUNCTIONS_EMULATOR = "true";

const functions = require("../index");
const {HttpsError} = require("firebase-functions/v2/https");
const {createFleetHandlers, sniffImageType} = require("../fleet_handlers");
admin.auth().getUser = async (uid) => ({
  uid, email: `${uid}@example.test`, emailVerified: true});
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const BIZ = "fdclaim-biz";
const OTHER = "fdclaim-other";
const OWNER = "fdclaim-owner";
const P_AWA = "+16465556101";
const P_BEN = "+16465556102";
const P_MANY = "+16465556103";

const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]),
  Buffer.alloc(64, 7)]).toString("base64");
const PNG = Buffer.concat([Buffer.from(
    [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(64, 7)])
    .toString("base64");

const phones = new Map([["uid-awa", P_AWA], ["uid-ben", P_BEN],
  ["uid-many", P_MANY]]);
const stored = [];
let nextReading = null;
let reads = 0;
const silent = {info() {}, warn() {}, error() {}};
const handlers = createFleetHandlers({admin, HttpsError, FieldValue,
  logger: silent, writeAudit: async () => undefined,
  dayKeyNow: () => "2026-12-02",
  requireAuth: (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }
    return request.auth.uid;
  },
  callerPhone: async (request) => phones.get(request.auth.uid) || "",
  readPicture: async (image) => {
    reads += 1;
    assert.match(image.mimeType, /^image\/(jpeg|png|webp)$/);
    if (nextReading instanceof Error) throw nextReading;
    return nextReading;
  },
  storeClaimImage: async (file) => {
    stored.push(file);
    return {filePath: `fleetClaims/${file.businessId}/${file.driverId}/x.jpg`,
      fileUrl: `https://files.test/${stored.length}`};
  },
  sendFleetMessage: async () => "sent",
  sendFleetText: async () => ({ok: true}),
  fleetScheduledRefresh: async () => true});

const reading = (over = {}) => JSON.stringify({isPayment: true,
  amountCents: 40000, dayKey: "2026-12-02", recipient: "Claim Fleet Co",
  senderName: "Someone", confident: true, ...over});
const claim = (uid, data = {}) => handlers.fleetAction({auth: {uid, token: {}},
  data: {action: "driver_claim", businessId: BIZ, imageBase64: JPEG,
    amountCents: 40000, lang: "en", ...data}, rawRequest: {}});
const refused = (reason) => (error) => error.details?.reason === reason;
const claimsOf = async (driverId) => (await db.collection("fleetClaims")
    .where("driverId", "==", driverId).get()).docs
    .map((d) => ({id: d.id, ...d.data()}));

before(async () => {
  const business = (name, enabled = true) => ({name, phone: "+17185550100",
    status: "approved", ownerUid: OWNER, enabledServices: ["fleet"],
    fleet: {enabled, settings: {zelle: {name: `${name} LLC`,
      handle: "pay@claim.test"}}}});
  await db.collection("businesses").doc(BIZ).set(business("Claim Fleet Co"));
  await db.collection("businesses").doc(OTHER).set(business("Other Fleet"));
  await db.collection("users").doc(OWNER).set({role: "businessOwner",
    businessId: BIZ, fullName: "Owner"});
  const driver = (id, name, phone, businessId = BIZ) =>
    db.collection("fleetDrivers").doc(id).set({businessId, name, phone,
      status: "active", creditCents: 0});
  await driver("fdclaim-awa", "Awa Test", P_AWA);
  await driver("fdclaim-ben", "Ben Test", P_BEN, OTHER);
  await driver("fdclaim-many", "Many Test", P_MANY);
});

beforeEach(() => {
  stored.length = 0;
  reads = 0;
  nextReading = reading();
});

describe("sniffImageType", () => {
  it("knows a picture by its first bytes, whatever it is called", () => {
    assert.equal(sniffImageType(Buffer.from(JPEG, "base64")), "image/jpeg");
    assert.equal(sniffImageType(Buffer.from(PNG, "base64")), "image/png");
    assert.equal(sniffImageType(Buffer.concat([Buffer.from("RIFF"),
      Buffer.alloc(4), Buffer.from("WEBP"), Buffer.alloc(8)])), "image/webp");
    assert.equal(sniffImageType(Buffer.from("%PDF-1.7 not a picture")), "");
    assert.equal(sniffImageType(Buffer.alloc(4)), "");
    assert.equal(sniffImageType(null), "");
  });
});

describe("driver_claim", () => {
  it("makes a claim that waits for the bank, with the picture kept once",
      async () => {
        const out = await claim("uid-awa");
        assert.deepEqual(out, {success: true, outcome: "waiting",
          amountCents: 40000, reason: null});
        const [made] = await claimsOf("fdclaim-awa");
        assert.equal(made.state, "waiting_bank");
        assert.equal(made.amountCents, 40000);
        assert.equal(made.businessId, BIZ);
        assert.equal(made.fromPhone, P_AWA);
        assert.equal(made.source, "app");
        assert.equal(made.fileUrl, "https://files.test/1");
        assert.equal(made.open, true);
        assert.equal(stored.length, 1);
        assert.equal(stored[0].mimeType, "image/jpeg");
        assert.equal(stored[0].driverId, "fdclaim-awa");
      });

  it("shows on the driver's own account as being checked", async () => {
    const home = await handlers.fleetAction({auth: {uid: "uid-awa",
      token: {}}, data: {action: "driver_home"}, rawRequest: {}});
    const mine = home.fleets.find((f) => f.businessId === BIZ);
    assert.deepEqual(mine.claims.map((c) => [c.amountCents, c.state]),
        [[40000, "checking"]]);
    // The picture's address never goes back to a phone.
    assert.equal(JSON.stringify(home).includes("files.test"), false);
  });

  it("lets the office see the picture", async () => {
    const [made] = await claimsOf("fdclaim-awa");
    const photo = await functions.fleetAction.run({auth: {uid: OWNER,
      token: {}}, data: {action: "claim_photo", businessId: BIZ,
      claimId: made.id}, rawRequest: {}});
    assert.deepEqual(photo, {success: true, url: "https://files.test/1",
      deleted: false});
    const status = await functions.fleetAction.run({auth: {uid: OWNER,
      token: {}}, data: {action: "bank_status", businessId: BIZ},
    rawRequest: {}});
    assert.equal(status.claims.find((c) => c.id === made.id).hasPhoto, true);
  });

  it("says so when the same payment is reported twice, and keeps no " +
      "second picture", async () => {
    const out = await claim("uid-awa");
    assert.equal(out.outcome, "duplicate");
    assert.equal((await claimsOf("fdclaim-awa")).length, 1);
    assert.equal(stored.length, 0);
  });

  it("uses the amount the driver typed when the picture cannot be read",
      async () => {
        nextReading = new Error("reader down");
        const out = await claim("uid-awa", {amountCents: 12345,
          imageBase64: PNG});
        assert.deepEqual(out, {success: true, outcome: "waiting",
          amountCents: 12345, reason: null});
        const made = (await claimsOf("fdclaim-awa"))
            .find((c) => c.amountCents === 12345);
        assert.equal(made.state, "waiting_bank");
        assert.equal(stored[0].mimeType, "image/png");
      });

  it("turns away a picture that is not a payment, keeping nothing",
      async () => {
        nextReading = reading({isPayment: false});
        const before = (await claimsOf("fdclaim-awa")).length;
        assert.deepEqual(await claim("uid-awa", {amountCents: 5000}),
            {success: true, outcome: "not_a_payment"});
        assert.equal((await claimsOf("fdclaim-awa")).length, before);
        assert.equal(stored.length, 0);
      });

  it("hands a payment to someone else to the office", async () => {
    nextReading = reading({recipient: "Somebody Else", amountCents: 7700});
    const out = await claim("uid-awa", {amountCents: 7700});
    assert.equal(out.outcome, "office");
    assert.equal(out.reason, "wrong_recipient");
    const made = (await claimsOf("fdclaim-awa"))
        .find((c) => c.amountCents === 7700);
    assert.equal(made.state, "office");
  });

  it("refuses anyone who is not a driver of that business", async () => {
    // Ben drives for another fleet.
    await assert.rejects(claim("uid-ben"), refused("fleet_not_driver"));
    // No verified phone at all.
    await assert.rejects(claim("uid-nobody"), refused("fleet_not_driver"));
    // Not signed in.
    await assert.rejects(handlers.fleetAction({auth: null,
      data: {action: "driver_claim", businessId: BIZ, imageBase64: JPEG,
        amountCents: 100}, rawRequest: {}}),
    (error) => error.code === "unauthenticated");
    assert.equal(reads, 0, "no picture is read for a stranger");
    assert.equal(stored.length, 0);
  });

  it("refuses a file that is not a picture, a giant one, and no amount",
      async () => {
        const text = Buffer.from("this is not a picture at all").toString(
            "base64");
        await assert.rejects(claim("uid-awa", {imageBase64: text}),
            refused("fleet_claim_image"));
        await assert.rejects(claim("uid-awa", {imageBase64: ""}),
            refused("fleet_claim_image"));
        const giant = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]),
          Buffer.alloc(7 * 1024 * 1024)]).toString("base64");
        await assert.rejects(claim("uid-awa", {imageBase64: giant}),
            refused("fleet_claim_image"));
        for (const amountCents of [0, -5, "abc", 5000001, undefined]) {
          await assert.rejects(claim("uid-awa", {amountCents}),
              refused("fleet_claim_amount"), String(amountCents));
        }
        assert.equal(reads, 0);
      });

  it("stops after ten reports in a day", async () => {
    const now = Date.now();
    for (let i = 0; i < 10; i += 1) {
      await db.collection("fleetClaims").doc(`fdclaim-many-${i}`).set({
        businessId: BIZ, driverId: "fdclaim-many", state: "closed",
        open: false, amountCents: 100 + i, createdAtMs: now - i * 60000});
    }
    await assert.rejects(claim("uid-many"), refused("fleet_claim_too_many"));
    assert.equal(reads, 0);
    // Yesterday's do not count.
    await db.collection("fleetClaims").doc("fdclaim-many-0").update(
        {createdAtMs: now - 2 * 86400000});
    assert.equal((await claim("uid-many")).outcome, "waiting");
  });

  it("refuses when Fleet is off for the business", async () => {
    await db.collection("businesses").doc(BIZ).set(
        {fleet: {enabled: false}}, {merge: true});
    await assert.rejects(claim("uid-awa", {amountCents: 999}),
        refused("fleet_off"));
    await db.collection("businesses").doc(BIZ).set(
        {fleet: {enabled: true}}, {merge: true});
  });
});
