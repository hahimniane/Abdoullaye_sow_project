"use strict";

const assert = require("node:assert/strict");
const {before, describe, it} = require("node:test");
const admin = require("firebase-admin");

// The package request callables, the WhatsApp queue for their messages,
// the hourly sweep and the card-barrel hook, run directly against the
// Firestore and Storage emulators (docs/PACKAGE_REQUESTS.md §4 and §8).
// What package-requests.test.js pins as pure rules is exercised here end to
// end: lock races, a stale confirm, double confirms, the spam limit, the
// idempotent Received, the photos.
//
// Writes with ADMIN credentials, so it refuses to run outside the emulator.
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
      "Run this through `npm run test:requests` (firebase emulators:exec). " +
      "A direct node --test run would write its fixtures into the " +
      "real project.");
}

process.env.FUNCTIONS_EMULATOR = "true";
process.env.WHATSAPP_ACCESS_TOKEN = "unset";
process.env.WHATSAPP_PHONE_NUMBER_ID = "unset";

const functions = require("../index");
const db = admin.firestore();

const BIZ = "req-test-biz";
const OTHER_BIZ = "req-test-other";
const OWNER = "req-test-owner";
const MARIAMA = "req-test-mariama";
const AWA = "req-test-awa";
const NO_CONTAINERS = "req-test-ledger-only";
const OTHER_OWNER = "req-test-other-owner";
const CUSTOMER = "req-test-customer";
const ANON = {firebase: {sign_in_provider: "anonymous"}};
const DAY = 24 * 60 * 60 * 1000;

const WEEK = {
  mon: {open: true, from: "09:00", to: "18:00"},
  tue: {open: true, from: "09:00", to: "18:00"},
  wed: {open: true, from: "09:00", to: "18:00"},
  thu: {open: true, from: "09:00", to: "18:00"},
  fri: {open: true, from: "09:00", to: "18:00"},
  sat: {open: true, from: "09:00", to: "18:00"},
  sun: {open: true, from: "09:00", to: "18:00"},
};

const call = (name, data, uid = OWNER, token = {}) =>
  functions[name].run({auth: {uid, token}, data, rawRequest: {}});
const staff = (name, data, uid = OWNER) =>
  call(name, {businessId: BIZ, ...data}, uid);
const reasonOf = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error.details?.reason || error.code;
  }
  return "no error";
};

let phones = 0;
// Every submission from a fresh number: the per-phone limit is real here.
const freshPhone = () => `+1646555${String(1000 + (++phones)).slice(-4)}`;

const todayPlus = (days) => {
  const local = new Date(Date.now() - 4 * 60 * 60 * 1000 + days * DAY);
  return local.toISOString().slice(0, 10);
};

let keys = 0;
const submission = (extra = {}) => ({
  businessId: BIZ,
  destinationCountryId: "gn",
  handoff: "bring_in",
  locationId: "default",
  plannedDate: todayPlus(3),
  sender: {name: "Fatou Diallo", phoneE164: freshPhone()},
  receiver: {name: "Mariama Bah", phoneE164: "+224620000000"},
  pieces: [{kind: "barrel"}, {kind: "box", description: "Clothes"}],
  language: "en",
  idempotencyKey: `test-key-${Date.now()}-${++keys}`,
  ...extra,
});
const submit = (extra = {}, uid = `anon-${keys + 1}`) =>
  call("submitPackageRequest", submission(extra), uid, ANON);
const requestDoc = async (id) =>
  (await db.collection("packageRequests").doc(id).get()).data();

// WhatsApp, faked at the fetch boundary.
const realFetch = global.fetch;
let whatsappCalls = [];
function fakeWhatsApp(answer) {
  whatsappCalls = [];
  global.fetch = async (url, init) => {
    if (!String(url).includes("graph.facebook.com")) {
      return realFetch(url, init);
    }
    whatsappCalls.push(JSON.parse(init.body));
    return new Response(JSON.stringify(answer.body || {}),
        {status: answer.status});
  };
}
function connectWhatsApp() {
  process.env.WHATSAPP_ACCESS_TOKEN = "EAAG-test-token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "109876543210";
}
function disconnectWhatsApp() {
  process.env.WHATSAPP_ACCESS_TOKEN = "unset";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "unset";
  global.fetch = realFetch;
}
async function deliver(rowId) {
  const snap = await db.collection("containerUpdates").doc(rowId).get();
  return functions.deliverContainerCustomerUpdate.run({
    data: {
      before: {data: () => null},
      after: {data: () => ({...snap.data(), status: "queued"}),
        ref: snap.ref},
    },
    params: {messageId: rowId},
    time: new Date().toISOString(),
  });
}

async function saveSettings(extra = {}, uid = OWNER) {
  return call("setPackageRequestSettings", {
    businessId: BIZ,
    acceptRequests: true,
    openingHours: {default: WEEK},
    pickup: {enabled: true, areas: "Bronx, Harlem"},
    cardBarrelBooking: false,
    ...extra,
  }, uid);
}

async function sweep() {
  await functions.sweepPackageRequests.run({});
}

before(async () => {
  await Promise.all([
    db.collection("businesses").doc(BIZ).set({
      name: "Dala Shipping", status: "approved", ownerUid: OWNER,
      phone: "+16465550199", addressLine1: "410 East 138th Street",
      city: "Bronx", state: "NY", country: "United States",
    }),
    db.collection("businesses").doc(BIZ).collection("destinationCountries")
        .doc("gn").set({name: "Guinea", isActive: true,
          barrelShippingPrice: 150}),
    db.collection("businesses").doc(BIZ).collection("destinationCountries")
        .doc("sn").set({name: "Senegal", isActive: true}),
    db.collection("businesses").doc(OTHER_BIZ).set({
      name: "Other Shipping", status: "approved", ownerUid: OTHER_OWNER,
      requestSlug: "taken-slug"}),
    db.collection("packageRequestSlugs").doc("taken-slug")
        .set({businessId: OTHER_BIZ}),
    db.collection("users").doc(OWNER).set({role: "businessOwner",
      businessId: BIZ, fullName: "Dala Owner", email: "o@example.test"}),
    db.collection("users").doc(MARIAMA).set({role: "staff", businessId: BIZ,
      businessPermissions: ["containers"], fullName: "Mariama"}),
    db.collection("users").doc(AWA).set({role: "staff", businessId: BIZ,
      businessPermissions: ["containers"], fullName: "Awa",
      preferredLanguage: "fr"}),
    db.collection("users").doc(NO_CONTAINERS).set({role: "staff",
      businessId: BIZ, businessPermissions: ["ledger"], fullName: "Ledger"}),
    db.collection("users").doc(OTHER_OWNER).set({role: "businessOwner",
      businessId: OTHER_BIZ, fullName: "Other"}),
    db.collection("users").doc(CUSTOMER).set({role: "customer",
      fullName: "Signed-in customer"}),
  ]);
});

describe("request settings", () => {
  it("are the owner's: staff are refused", async () => {
    assert.equal(await reasonOf(saveSettings({}, MARIAMA)),
        "permission-denied");
    assert.equal(await reasonOf(saveSettings({}, OTHER_OWNER)),
        "permission-denied");
  });

  it("assign a slug from the name on the first save, changeable once",
      async () => {
        const first = await saveSettings();
        assert.equal(first.requestSlug, "dala-shipping");
        assert.equal(first.requestLink,
            "https://laawoldigital.com/r/dala-shipping");
        assert.equal(await reasonOf(saveSettings({requestSlug:
          "taken-slug"})), "slug_taken");
        assert.equal(await reasonOf(saveSettings({requestSlug: "Bad Slug"})),
            "slug_invalid");
        const changed = await saveSettings({requestSlug: "dala-bronx"});
        assert.equal(changed.requestSlug, "dala-bronx");
        assert.equal(await reasonOf(saveSettings({requestSlug:
          "dala-again"})), "slug_locked");
        // Saving without a slug keeps it.
        assert.equal((await saveSettings()).requestSlug, "dala-bronx");
        const claim = await db.collection("packageRequestSlugs")
            .doc("dala-shipping").get();
        assert.equal(claim.exists, false);
      });

  it("refuse hours for a location that is not the business's", async () => {
    assert.equal(await reasonOf(saveSettings({openingHours: {nowhere:
      WEEK}})), "location_unknown");
  });

  it("give a QR of the link to the business's container people", async () => {
    const qr = await staff("getPackageRequestLinkQr", {}, MARIAMA);
    assert.equal(qr.url, "https://laawoldigital.com/r/dala-bronx");
    assert.match(qr.pngDataUrl, /^data:image\/png;base64,/);
    assert.equal(await reasonOf(staff("getPackageRequestLinkQr", {},
        NO_CONTAINERS)), "permission-denied");
  });
});

describe("what customers see", () => {
  it("lists the business and its destinations, and opens by slug",
      async () => {
        const all = await call("listPackageRequestOptions", {}, undefined);
        const ours = all.options.filter((o) => o.businessId === BIZ);
        assert.deepEqual(ours.map((o) => o.country.id).sort(), ["gn", "sn"]);
        const gn = ours.find((o) => o.country.id === "gn");
        assert.equal(gn.barrelPriceCents, 15000);
        assert.equal(gn.bringIn.available, true);
        assert.equal(gn.bringIn.locations[0].id, "default");
        assert.equal(ours.find((o) => o.country.id === "sn").barrelPriceCents,
            null);
        const bySlug = await call("listPackageRequestOptions",
            {slug: "dala-bronx"});
        assert.equal(bySlug.business.businessId, BIZ);
        assert.equal(bySlug.options.length, 2);
        assert.equal(await reasonOf(call("listPackageRequestOptions",
            {slug: "no-such-shop"})), "business_not_found");
      });

  it("has no bring-in without opening hours", async () => {
    await saveSettings({openingHours: {}});
    const bySlug = await call("listPackageRequestOptions",
        {slug: "dala-bronx"});
    assert.ok(bySlug.options.every((o) => !o.bringIn.available &&
      o.collect.available));
    assert.equal(await reasonOf(submit()), "bring_in_unavailable");
    await saveSettings();
  });
});

describe("submitting a request", () => {
  it("sends an all-barrel request's estimate at once", async () => {
    const sent = await submit({pieces: [{kind: "barrel"}, {kind: "barrel"}]});
    assert.equal(sent.status, "estimate_sent");
    assert.equal(sent.totalCents, 30000);
    assert.match(sent.code, /^R-[23456789BCDFGHJKMNPQRSTVWXYZ]{5}$/);
    assert.match(sent.token, /^[A-Za-z0-9_-]{43}$/);
    const row = await db.collection("containerUpdates")
        .doc(`req_${sent.requestId}_estimate_v1`).get();
    assert.equal(row.data().status, "waiting_for_whatsapp");
    assert.equal(row.data().requestId, sent.requestId);
    const stored = await requestDoc(sent.requestId);
    assert.equal(stored.estimate.auto, true);
    assert.equal(stored.sender.uid, undefined, "anonymous: no uid");
    assert.ok(stored.nextActionAt, "the 24 h reminder is scheduled");
  });

  it("waits for an estimate when a piece has no price", async () => {
    const sent = await submit();
    assert.equal(sent.status, "new");
    assert.equal(sent.totalCents, null);
    const stored = await requestDoc(sent.requestId);
    assert.deepEqual(stored.pieces.map((p) => p.estimateCents), [15000, null]);
    // A destination with no barrel price: barrels need an estimate too.
    const senegal = await submit({destinationCountryId: "sn",
      pieces: [{kind: "barrel"}]});
    assert.equal(senegal.status, "new");
  });

  it("keeps a signed-in customer's uid for the app's list", async () => {
    const sent = await call("submitPackageRequest", submission(), CUSTOMER);
    assert.equal((await requestDoc(sent.requestId)).sender.uid, CUSTOMER);
  });

  it("answers the same key twice with the first request", async () => {
    const data = submission();
    const first = await call("submitPackageRequest", data, "anon-same", ANON);
    const again = await call("submitPackageRequest", data, "anon-same", ANON);
    assert.equal(again.requestId, first.requestId);
    assert.equal(again.replayed, true);
    // Another session with the same key is another request.
    const other = await call("submitPackageRequest", data, "anon-other", ANON);
    assert.notEqual(other.requestId, first.requestId);
  });

  it("refuses the sixth request in an hour from one phone", async () => {
    const phone = freshPhone();
    for (let i = 0; i < 5; i++) {
      await submit({sender: {name: "Spam", phoneE164: phone}});
    }
    assert.equal(await reasonOf(submit({sender: {name: "Spam",
      phoneE164: phone}})), "rate_limited");
  });

  it("refuses every invalid field at once", async () => {
    try {
      await submit({sender: {name: "", phoneE164: "646"},
        receiver: {name: "Mariama", phoneE164: "+224"},
        pieces: Array.from({length: 21}, () => ({kind: "barrel"}))});
      assert.fail("accepted");
    } catch (error) {
      assert.equal(error.code, "invalid-argument");
      assert.deepEqual(error.details.reasons, ["sender_name_required",
        "sender_phone_invalid", "receiver_phone_invalid", "too_many_pieces"]);
    }
  });

  it("notifies the owner and container staff, not other staff", async () => {
    const sent = await submit();
    const bells = async (uid) => (await db.collection("users").doc(uid)
        .collection("notifications").where("data.requestId", "==",
            sent.requestId).get()).docs.map((d) => d.data());
    const owner = await bells(OWNER);
    assert.equal(owner.length, 1);
    assert.equal(owner[0].data.type, "package_request");
    assert.equal(owner[0].data.event, "new");
    assert.equal(owner[0].title, "New package request");
    assert.equal((await bells(MARIAMA)).length, 1);
    assert.equal((await bells(AWA))[0].title, "Nouvelle demande d'envoi");
    assert.equal((await bells(NO_CONTAINERS)).length, 0);
  });

  it("accepts the caller's own photos and refuses anyone else's", async () => {
    const bucket = admin.storage().bucket(
        `${process.env.GCLOUD_PROJECT}.firebasestorage.app`);
    const own = `packageRequestPhotos/${BIZ}/anon-photo/photo-00001.jpg`;
    const gif = `packageRequestPhotos/${BIZ}/anon-photo/photo-00002.jpg`;
    await bucket.file(own).save(Buffer.alloc(2048, 1),
        {contentType: "image/jpeg"});
    await bucket.file(gif).save(Buffer.alloc(2048, 1),
        {contentType: "image/gif"});
    const withPhotos = (paths) => call("submitPackageRequest", submission({
      pieces: [{kind: "box", description: "TV", photoPaths: paths}]}),
    "anon-photo", ANON);
    const sent = await withPhotos([own]);
    const stored = await requestDoc(sent.requestId);
    assert.deepEqual(stored.pieces[0].photoPaths, [own]);
    const [meta] = await bucket.file(own).getMetadata();
    assert.equal(meta.metadata.requestId, sent.requestId);
    assert.equal(await reasonOf(withPhotos([gif])), "photo_invalid");
    assert.equal(await reasonOf(withPhotos(
        [`packageRequestPhotos/${BIZ}/anon-photo/missing-0001.jpg`])),
    "photo_invalid");
    assert.equal(await reasonOf(call("submitPackageRequest", submission({
      pieces: [{kind: "box", description: "TV", photoPaths: [own]}]}),
    "anon-thief", ANON)), "photo_invalid");
  });
});

describe("the estimate lock and sending estimates", () => {
  it("lets one person write at a time, and the second waits", async () => {
    const {requestId} = await submit();
    const first = await staff("startPackageEstimate", {requestId}, MARIAMA);
    assert.equal(first.lock.name, "Mariama");
    assert.equal(first.version, 0);
    assert.equal(await reasonOf(staff("startPackageEstimate", {requestId},
        AWA)), "estimate_locked");
    // Sending re-checks the lock in the transaction.
    assert.equal(await reasonOf(staff("sendPackageEstimate", {requestId,
      baseVersion: 0, pieces: [{id: "p1", cents: 15000},
        {id: "p2", cents: 4000}]}, AWA)), "estimate_locked");
    // The lock runs out after 15 minutes idle: then Awa takes it over.
    await db.collection("packageRequests").doc(requestId).update({
      "lock.untilMs": Date.now() - 1});
    const takeover = await staff("startPackageEstimate", {requestId}, AWA);
    assert.equal(takeover.lock.name, "Awa");
    const stored = await requestDoc(requestId);
    assert.equal(stored.history.at(-1).action, "lock_taken_over");
    assert.equal(stored.history.at(-1).reason, "Mariama");
  });

  it("gives the lock to exactly one of two people asking at once",
      async () => {
        const {requestId} = await submit();
        const results = await Promise.allSettled([
          staff("startPackageEstimate", {requestId}, MARIAMA),
          staff("startPackageEstimate", {requestId}, AWA),
        ]);
        const won = results.filter((r) => r.status === "fulfilled");
        const lost = results.filter((r) => r.status === "rejected");
        assert.equal(won.length, 1);
        assert.equal(lost.length, 1);
        assert.equal(lost[0].reason.details.reason, "estimate_locked");
      });

  it("sends version after version, refusing a stale one", async () => {
    const {requestId, token} = await submit();
    await staff("startPackageEstimate", {requestId}, MARIAMA);
    const v1 = await staff("sendPackageEstimate", {requestId, baseVersion: 0,
      pieces: [{id: "p1", cents: 15000}, {id: "p2", cents: 4000}],
      note: "Box weighed 20 lb"}, MARIAMA);
    assert.deepEqual(v1, {success: true, version: 1, status: "estimate_sent",
      totalCents: 19000, reconfirmRequired: false, priceDropped: false});
    assert.equal(await reasonOf(staff("sendPackageEstimate", {requestId,
      baseVersion: 0, pieces: [{id: "p1", cents: 1}, {id: "p2", cents: 1}]},
    AWA)), "estimate_stale");
    assert.equal(await reasonOf(staff("sendPackageEstimate", {requestId,
      baseVersion: 1, pieces: [{id: "p1", cents: 1}]}, AWA)),
    "estimate_piece_missing");
    const stored = await requestDoc(requestId);
    assert.equal(stored.lock, null, "sending releases the lock");
    assert.equal(stored.estimate.sentByName, "Mariama");
    assert.equal(stored.estimateHistory.length, 1);
    const row = await db.collection("containerUpdates")
        .doc(`req_${requestId}_estimate_v1`).get();
    assert.equal(row.exists, true);
    const page = await call("getPackageRequestByToken", {token});
    assert.equal(page.request.estimate.totalCents, 19000);
    assert.equal(page.request.estimate.note, "Box weighed 20 lb");
  });
});

describe("confirming", () => {
  async function estimated() {
    const sent = await submit();
    await staff("sendPackageEstimate", {requestId: sent.requestId,
      baseVersion: 0, pieces: [{id: "p1", cents: 15000},
        {id: "p2", cents: 5000}]}, MARIAMA);
    return sent;
  }

  it("confirms only the version shown, once", async () => {
    const {requestId, token} = await estimated();
    await staff("sendPackageEstimate", {requestId, baseVersion: 1,
      pieces: [{id: "p1", cents: 15000}, {id: "p2", cents: 6000}]}, MARIAMA);
    try {
      await call("confirmPackageEstimate", {token, version: 1});
      assert.fail("a stale version confirmed");
    } catch (error) {
      assert.equal(error.details.reason, "estimate_changed");
      assert.equal(error.details.currentVersion, 2);
    }
    const ok = await call("confirmPackageEstimate", {token, version: 2});
    assert.deepEqual(ok, {success: true, status: "confirmed",
      confirmedVersion: 2, alreadyConfirmed: false});
    const again = await call("confirmPackageEstimate", {token, version: 2});
    assert.equal(again.alreadyConfirmed, true);
    const stored = await requestDoc(requestId);
    assert.equal(stored.confirmedVia, "link");
    assert.equal(stored.confirmedTotalCents, 21000);
    const bell = await db.collection("users").doc(OWNER)
        .collection("notifications").where("data.requestId", "==", requestId)
        .where("data.event", "==", "confirmed").get();
    assert.equal(bell.size, 1, "one alert for two taps");
  });

  it("refuses to confirm after a cancel, and with no estimate", async () => {
    const {requestId, token} = await estimated();
    await staff("cancelPackageRequest", {requestId,
      reason: "Customer moved"}, MARIAMA);
    assert.equal(await reasonOf(call("confirmPackageEstimate",
        {token, version: 1})), "request_closed");
    const page = await call("getPackageRequestByToken", {token});
    assert.equal(page.request.status, "cancelled");
    assert.equal(page.request.declineReason, "Customer moved");
    const fresh = await submit();
    assert.equal(await reasonOf(call("confirmPackageEstimate",
        {token: fresh.token, version: 0})), "estimate_missing");
    assert.equal(await reasonOf(call("getPackageRequestByToken",
        {token: "x".repeat(43)})), "request_not_found");
  });

  it("asks again when the price goes up; stays confirmed when it goes " +
      "down", async () => {
    const {requestId, token} = await estimated();
    await call("confirmPackageEstimate", {token, version: 1});
    const down = await staff("sendPackageEstimate", {requestId,
      baseVersion: 1, pieces: [{id: "p1", cents: 15000},
        {id: "p2", cents: 4000}]}, MARIAMA);
    assert.equal(down.status, "confirmed");
    assert.equal(down.priceDropped, true);
    const page = await call("getPackageRequestByToken", {token});
    assert.equal(page.request.priceDropped, true);
    const up = await staff("sendPackageEstimate", {requestId,
      baseVersion: 2, pieces: [{id: "p1", cents: 15000},
        {id: "p2", cents: 9000}]}, MARIAMA);
    assert.equal(up.status, "estimate_sent");
    assert.equal(up.reconfirmRequired, true);
    assert.equal((await call("confirmPackageEstimate", {token, version: 3}))
        .status, "confirmed");
  });

  it("lets staff record that the customer agreed by phone", async () => {
    const {requestId} = await estimated();
    assert.equal(await reasonOf(staff("confirmPackageRequestByPhone",
        {requestId, version: 9}, AWA)), "estimate_changed");
    await staff("confirmPackageRequestByPhone", {requestId, version: 1}, AWA);
    const stored = await requestDoc(requestId);
    assert.equal(stored.status, "confirmed");
    assert.equal(stored.confirmedVia, "staff_phone");
    assert.equal(stored.history.at(-1).byName, "Awa");
  });

  it("lets the customer say no thanks, once", async () => {
    const {token} = await estimated();
    await call("declinePackageEstimate", {token, reason: "Too much"});
    const again = await call("declinePackageEstimate", {token});
    assert.equal(again.status, "customer_declined");
    assert.equal(await reasonOf(call("confirmPackageEstimate",
        {token, version: 1})), "request_closed");
  });

  it("needs a reason to decline or cancel", async () => {
    const {requestId} = await submit();
    assert.equal(await reasonOf(staff("declinePackageRequest",
        {requestId, reason: " "}, MARIAMA)), "reason_required");
    await staff("declinePackageRequest", {requestId,
      reason: "We no longer ship there"}, MARIAMA);
    assert.equal((await requestDoc(requestId)).status, "declined");
    assert.equal(await reasonOf(staff("declinePackageRequest",
        {requestId, reason: "again"}, MARIAMA)), "request_closed");
  });
});

describe("open requests outlive the business's switches (§4)", () => {
  it("continue when requests are turned off or the destination goes",
      async () => {
        const {requestId, token} = await submit();
        await saveSettings({acceptRequests: false});
        await db.collection("businesses").doc(BIZ)
            .collection("destinationCountries").doc("gn")
            .update({isActive: false});
        try {
          assert.equal(await reasonOf(submit()), "requests_off");
          await saveSettings();
          assert.equal(await reasonOf(submit()), "destination_unavailable");
          const v1 = await staff("sendPackageEstimate", {requestId,
            baseVersion: 0, pieces: [{id: "p1", cents: 15000},
              {id: "p2", cents: 2000}]}, MARIAMA);
          assert.equal(v1.version, 1);
          assert.equal((await call("confirmPackageEstimate",
              {token, version: 1})).status, "confirmed");
        } finally {
          await saveSettings();
          await db.collection("businesses").doc(BIZ)
              .collection("destinationCountries").doc("gn")
              .update({isActive: true});
        }
      });
});

describe("Received", () => {
  it("creates one waiting line with the §7 fields, once", async () => {
    const {requestId, token} = await submit();
    await staff("sendPackageEstimate", {requestId, baseVersion: 0,
      pieces: [{id: "p1", cents: 15000}, {id: "p2", cents: 4500}]}, MARIAMA);
    await call("confirmPackageEstimate", {token, version: 1});
    assert.equal(await reasonOf(staff("receivePackageRequest", {requestId,
      pieces: [{id: "p2", priceCents: 5000}],
      payment: {amountCents: 30000, method: "cash",
        receivedByStaffId: MARIAMA}}, MARIAMA)), "payment_exceeds_balance");
    const received = await staff("receivePackageRequest", {requestId,
      pieces: [{id: "p2", priceCents: 5000}],
      payment: {amountCents: 10000, method: "cash",
        receivedByStaffId: MARIAMA}}, MARIAMA);
    assert.equal(received.alreadyReceived, false);
    assert.match(received.trackingCode, /^CL-/);
    assert.equal(received.paidCents, 10000);
    const line = (await db.collection("containerLines")
        .doc(received.lineId).get()).data();
    assert.equal(line.businessId, BIZ);
    assert.equal(line.containerId, "");
    assert.equal(line.containerStatus, "waiting");
    assert.equal(line.source, "request");
    assert.equal(line.requestId, requestId);
    assert.equal(line.rootLineId, received.lineId);
    assert.equal(line.partIndex, 1);
    assert.equal(line.pieceCount, 2);
    assert.equal(line.barrelPieces, 1);
    assert.equal(line.packagePieces, 1);
    assert.equal(line.carPieces, 0);
    assert.equal(line.priceCents, 20000);
    assert.equal(line.paidCents, 10000);
    assert.ok(line.receivedAt);
    assert.deepEqual(line.pieces.map((p) => p.priceCents), [15000, 5000]);
    // The bilingual received message, as for any new package.
    const rows = await db.collection("containerUpdates")
        .where("lineId", "==", received.lineId).get();
    assert.deepEqual(rows.docs.map((d) => d.data().update).sort(),
        ["received", "received"]);
    const again = await staff("receivePackageRequest", {requestId,
      pieces: []}, AWA);
    assert.equal(again.alreadyReceived, true);
    assert.equal(again.lineId, received.lineId);
    const lines = await db.collection("containerLines")
        .where("requestId", "==", requestId).get();
    assert.equal(lines.size, 1);
    const stored = await requestDoc(requestId);
    assert.equal(stored.status, "received");
    assert.equal(stored.trackingCode, received.trackingCode);
    const page = await call("getPackageRequestByToken", {token});
    assert.equal(page.request.trackingCode, received.trackingCode);
  });

  it("makes one line when two people tap Received at once", async () => {
    const {requestId} = await submit({pieces: [{kind: "barrel"}]});
    const [a, b] = await Promise.all([
      staff("receivePackageRequest", {requestId, pieces: []}, MARIAMA),
      staff("receivePackageRequest", {requestId, pieces: []}, AWA),
    ]);
    assert.equal(a.lineId, b.lineId);
    assert.equal([a, b].filter((r) => r.alreadyReceived).length, 1);
    const lines = await db.collection("containerLines")
        .where("requestId", "==", requestId).get();
    assert.equal(lines.size, 1);
  });

  it("is refused on a closed request", async () => {
    const {requestId} = await submit();
    await staff("cancelPackageRequest", {requestId, reason: "No"}, MARIAMA);
    assert.equal(await reasonOf(staff("receivePackageRequest",
        {requestId, pieces: []}, MARIAMA)), "request_closed");
  });

  it("is refused to staff without containers and to other businesses",
      async () => {
        const {requestId} = await submit();
        assert.equal(await reasonOf(staff("receivePackageRequest",
            {requestId, pieces: []}, NO_CONTAINERS)), "permission-denied");
        assert.equal(await reasonOf(call("receivePackageRequest",
            {businessId: OTHER_BIZ, requestId, pieces: []}, OTHER_OWNER)),
        "request_not_found");
      });
});

describe("WhatsApp for requests", () => {
  it("sends the estimate with the token button and flags an unreachable " +
      "customer", async () => {
    // Connected before the requests are sent, so their rows are queued.
    connectWhatsApp();
    try {
      const {requestId, token} = await submit({pieces: [{kind: "barrel"}]});
      const rowId = `req_${requestId}_estimate_v1`;
      assert.equal((await db.collection("containerUpdates").doc(rowId).get())
          .data().status, "queued");
      fakeWhatsApp({status: 200, body: {messages: [{id: "wamid.REQ"}]}});
      await deliver(rowId);
      assert.equal(whatsappCalls.length, 1);
      const body = whatsappCalls[0];
      assert.equal(body.template.name, "package_estimate_2lang");
      assert.equal(body.template.components[1].parameters[0].text, token);
      assert.equal(body.template.components[0].parameters[2].text,
          "$150.00");
      let stored = await requestDoc(requestId);
      assert.equal(stored.whatsapp.status, "sent");
      assert.equal(stored.whatsappUnreachable, false);

      // Not on WhatsApp: Meta refuses the number for good.
      const other = await submit({pieces: [{kind: "barrel"}]});
      fakeWhatsApp({status: 400, body: {error: {code: 131026,
        message: "Message undeliverable"}}});
      await deliver(`req_${other.requestId}_estimate_v1`);
      stored = await requestDoc(other.requestId);
      assert.equal(stored.whatsappUnreachable, true);
      assert.equal(stored.whatsapp.status, "failed");

      // A template still in review waits, and is not the customer's fault.
      const third = await submit({pieces: [{kind: "barrel"}]});
      fakeWhatsApp({status: 404, body: {error: {code: 132001,
        message: "Template name does not exist in the translation"}}});
      await deliver(`req_${third.requestId}_estimate_v1`);
      const row = await db.collection("containerUpdates")
          .doc(`req_${third.requestId}_estimate_v1`).get();
      assert.equal(row.data().status, "waiting_for_template");
      stored = await requestDoc(third.requestId);
      assert.equal(stored.whatsappUnreachable, false);
    } finally {
      disconnectWhatsApp();
    }
  });
});

describe("the hourly sweep", () => {
  const backdate = (id, fields) => db.collection("packageRequests").doc(id)
      .update({...fields, nextActionAt: admin.firestore.Timestamp
          .fromMillis(Date.now() - 1000)});

  it("alerts staff at 3 days and expires a never-estimated request at 30",
      async () => {
        const {requestId} = await submit();
        await backdate(requestId, {createdAtMs: Date.now() - 3 * DAY - 1000});
        await sweep();
        let stored = await requestDoc(requestId);
        assert.ok(stored.reminders.staffAlert3dAt);
        const bell = await db.collection("users").doc(OWNER)
            .collection("notifications")
            .where("data.requestId", "==", requestId)
            .where("data.event", "==", "stale_new").get();
        assert.equal(bell.size, 1);
        await backdate(requestId, {createdAtMs: Date.now() - 31 * DAY});
        await sweep();
        stored = await requestDoc(requestId);
        assert.equal(stored.status, "expired");
        assert.equal(stored.history.at(-1).action, "expired");
      });

  it("reminds once about an unconfirmed estimate, then expires it",
      async () => {
        const {requestId} = await submit({pieces: [{kind: "barrel"}]});
        await backdate(requestId, {"estimate.sentAtMs":
          Date.now() - DAY - 1000});
        await sweep();
        const row = await db.collection("containerUpdates")
            .doc(`req_${requestId}_estimate_reminder`).get();
        assert.equal(row.exists, true);
        assert.ok((await requestDoc(requestId)).reminders.estimate24hAt);
        await backdate(requestId, {"estimate.sentAtMs":
          Date.now() - 15 * DAY});
        await sweep();
        assert.equal((await requestDoc(requestId)).status, "expired");
        const {token} = await requestDoc(requestId);
        assert.equal(await reasonOf(call("confirmPackageEstimate",
            {token, version: 1})), "request_closed");
      });

  it("reminds about the drop-off 3 days after the planned day", async () => {
    const {requestId, token} = await submit({pieces: [{kind: "barrel"}]});
    await call("confirmPackageEstimate", {token, version: 1});
    await backdate(requestId, {plannedDate: todayPlus(-5)});
    await sweep();
    const row = await db.collection("containerUpdates")
        .doc(`req_${requestId}_dropoff_reminder`).get();
    assert.equal(row.exists, true);
    const stored = await requestDoc(requestId);
    assert.ok(stored.reminders.dropoff3dAt);
    assert.equal(stored.status, "confirmed");
  });
});

describe("card barrel orders (§8.10)", () => {
  const shipment = {businessId: BIZ, orderId: "order-1", quantity: 2,
    unitShippingFee: 150, shippingFee: 300, cardChargeAmountCents: 30000,
    senderName: "Card Customer", customerPhone: "+16465550777",
    customerUid: CUSTOMER, receiverName: "Mariama",
    receiverPhone: "+224620000000", destinationCountryId: "gn",
    destinationCountryName: "Guinea", pickupRequested: false,
    trackingCode: "BS-K7M4P2", status: "pending_payment",
    paymentStatus: "pending"};
  const fire = (id, before, after) => functions.notifyBarrelShipmentStatus
      .run({data: {before: {data: () => before}, after: {data: () => after}},
        params: {shipmentId: id}});

  it("lands paid orders as Expected, paid online, and cancels on refund",
      async () => {
        await saveSettings({cardBarrelBooking: true});
        const paid = {...shipment, paymentStatus: "succeeded",
          status: "pending"};
        await fire("ship-1", shipment, paid);
        await fire("ship-1", shipment, paid);
        const stored = await requestDoc("card_ship-1");
        assert.equal(stored.status, "confirmed");
        assert.equal(stored.confirmedVia, "card");
        assert.deepEqual(stored.payment, {timing: "card", paidCents: 30000});
        assert.equal(stored.pieces.length, 2);
        assert.equal(await reasonOf(staff("cancelPackageRequest",
            {requestId: "card_ship-1", reason: "x"}, MARIAMA)), "card_order");
        await fire("ship-1", paid, {...paid, paymentStatus: "refunded",
          status: "refunded"});
        assert.equal((await requestDoc("card_ship-1")).status, "cancelled");
        await saveSettings({cardBarrelBooking: false});
      });

  it("records the online payment on the line at Received", async () => {
    await saveSettings({cardBarrelBooking: true});
    await fire("ship-2", shipment, {...shipment, paymentStatus: "succeeded",
      status: "pending"});
    const received = await staff("receivePackageRequest",
        {requestId: "card_ship-2", pieces: []}, MARIAMA);
    const line = (await db.collection("containerLines")
        .doc(received.lineId).get()).data();
    assert.equal(line.source, "card_order");
    assert.equal(line.priceCents, 30000);
    assert.equal(line.paidCents, 30000);
    const payments = await db.collection("containerLinePayments")
        .where("businessId", "==", BIZ)
        .where("lineId", "==", received.lineId).get();
    assert.equal(payments.size, 1);
    assert.equal(payments.docs[0].data().note, "Paid online by card");
    await saveSettings({cardBarrelBooking: false});
  });

  it("does nothing for a business without card booking", async () => {
    await fire("ship-3", shipment, {...shipment, paymentStatus: "succeeded"});
    assert.equal(await requestDoc("card_ship-3"), undefined);
  });
});
