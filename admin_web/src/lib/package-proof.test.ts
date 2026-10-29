import assert from "node:assert/strict";
import test from "node:test";

import {
  contentDraftRowProblems,
  contentsText,
  emptyProofDraft,
  lineMissingProof,
  loadAnywayText,
  normalizeContents,
  normalizeDeclaredValueCents,
  normalizePhotoPaths,
  normalizeWeightLb,
  photoRequirementRefusal,
  proofDraftFromLine,
  proofDraftProblems,
  proofPayload,
  proofRefusalText,
  proofSettingsOf,
  proofTickLabels,
  proofTicks,
  readDeclaredValue,
  senderConfirmationOf,
  senderProblemRefusalFrom,
  validateProofFields,
  weightText,
  withProblemAcknowledgement,
} from "./package-proof.ts";

const BIZ = "nensona";
const UID = "staffUid123";
const PATH = `packagePhotos/${BIZ}/${UID}/abcd1234efgh.jpg`;

// The same cases as functions/test/package-proof.test.js: the console
// refuses what the server would refuse, before the round trip.

test("keeps at most five unique photo paths", () => {
  const paths = Array.from({ length: 6 }, (_, i) => `packagePhotos/${BIZ}/${UID}/photo000${i}xx.jpg`);
  assert.equal(normalizePhotoPaths(paths).error, "photo_invalid");
  assert.deepEqual(normalizePhotoPaths([PATH, PATH]).paths, [PATH]);
  assert.deepEqual(normalizePhotoPaths(undefined), { paths: [], error: "" });
  assert.equal(normalizePhotoPaths("x").error, "photo_invalid");
  assert.equal(normalizePhotoPaths([`packagePhotos/${BIZ}/${UID}/short.jpg`]).error, "photo_invalid");
  // Server-made folders are paths like any other on a line.
  assert.deepEqual(normalizePhotoPaths([`packagePhotos/${BIZ}/req/req00000001_1.jpg`]).error, "");
});

test("normalizes the item list", () => {
  const out = normalizeContents([
    { label: " iPhone 13 ", quantity: "2", serial: "35-209900-176148-1" },
    { label: "clothes" },
    { label: "" },
  ]);
  assert.equal(out.error, "");
  assert.deepEqual(out.contents, [
    { label: "iPhone 13", quantity: 2, serial: "35-209900-176148-1" },
    { label: "clothes", quantity: 1, serial: "" },
  ]);
  assert.equal(normalizeContents([{ label: "x", quantity: 100 }]).error, "contents_invalid");
  assert.equal(normalizeContents([{ label: "x".repeat(61) }]).error, "contents_invalid");
  assert.equal(normalizeContents(Array.from({ length: 11 }, () => ({ label: "a" }))).error, "contents_invalid");
  assert.deepEqual(normalizeContents(undefined), { contents: [], error: "" });
});

test("writes the list for a message and trims long ones", () => {
  const contents = [
    { label: "phones", quantity: 2, serial: "" },
    { label: "tablet", quantity: 1, serial: "" },
    { label: "clothes", quantity: 1, serial: "" },
  ];
  assert.equal(contentsText(contents), "2 phones, tablet, clothes");
  assert.equal(contentsText([]), "");
  const long = contentsText(Array.from({ length: 10 }, (_, i) => ({ label: `item number ${i} with a long name`, quantity: 1, serial: "" })), 60);
  assert.ok(long.length <= 60, long);
  assert.ok(long.endsWith("…"));
});

test("rounds weight to one decimal within range", () => {
  assert.equal(normalizeWeightLb("4.26"), 4.3);
  // A decimal comma, as typed on a French keyboard.
  assert.equal(normalizeWeightLb("4,26"), 4.3);
  assert.equal(normalizeWeightLb(null), null);
  assert.equal(normalizeWeightLb(""), null);
  assert.ok(Number.isNaN(normalizeWeightLb(0)));
  assert.ok(Number.isNaN(normalizeWeightLb(2001)));
  assert.ok(Number.isNaN(normalizeWeightLb("heavy")));
  assert.equal(weightText(4.2, "en"), "4.2 lb");
  assert.equal(weightText(4.2, "fr"), "4,2 lb");
  assert.equal(weightText(5, "en"), "5 lb");
  assert.equal(weightText(null, "en"), "");
});

test("takes whole cents at or above zero as the declared value", () => {
  assert.equal(normalizeDeclaredValueCents(90000), 90000);
  assert.equal(normalizeDeclaredValueCents(0), 0);
  assert.equal(normalizeDeclaredValueCents(null), null);
  assert.ok(Number.isNaN(normalizeDeclaredValueCents(-1)));
  assert.ok(Number.isNaN(normalizeDeclaredValueCents(10.5)));
  // The field takes whole dollars and sends cents.
  assert.equal(readDeclaredValue("900"), 90000);
  assert.equal(readDeclaredValue("$1,200"), 120000);
  assert.equal(readDeclaredValue(""), null);
  assert.ok(Number.isNaN(readDeclaredValue("12.50")));
  assert.ok(Number.isNaN(readDeclaredValue("-3")));
});

test("checks the four fields together and names the first problem", () => {
  const ok = validateProofFields({ photoPaths: [PATH], contents: [{ label: "phone" }], weightLb: 4.2, declaredValueCents: 1000 });
  assert.equal(ok.error, "");
  assert.deepEqual(ok.fields, { photoPaths: [PATH], contents: [{ label: "phone", quantity: 1, serial: "" }], weightLb: 4.2, declaredValueCents: 1000 });
  assert.deepEqual(validateProofFields({}).fields, { photoPaths: [], contents: [], weightLb: null, declaredValueCents: null });
  assert.equal(validateProofFields({ weightLb: -1 }).error, "weight_invalid");
  assert.equal(validateProofFields({ declaredValueCents: 1.5 }).error, "declared_value_invalid");
});

test("reads the three switches, missing means off", () => {
  assert.deepEqual(proofSettingsOf({}), { photosRequired: false, senderConfirm: false, pickupCode: false });
  assert.deepEqual(proofSettingsOf(null), { photosRequired: false, senderConfirm: false, pickupCode: false });
  assert.deepEqual(proofSettingsOf({ packageProofSettings: { photosRequired: true, pickupCode: "yes" } }), {
    photosRequired: true,
    senderConfirm: false,
    pickupCode: false,
  });
});

test("requires a photo only for counter drop-offs when switched on", () => {
  const on = { photosRequired: true };
  assert.equal(photoRequirementRefusal(on, { photoPaths: [] }), "photo_required");
  assert.equal(photoRequirementRefusal(on, { source: "counter", photoPaths: [PATH] }), "");
  assert.equal(photoRequirementRefusal(on, { source: "request", photoPaths: [] }), "");
  assert.equal(photoRequirementRefusal({ photosRequired: false }, { photoPaths: [] }), "");
});

test("shows the three ticks, and the delivered-without-code variant", () => {
  assert.deepEqual(proofTicks({ photoPaths: [PATH], senderConfirmation: { status: "confirmed" }, deliveredAt: {} }), {
    photo: true,
    senderOk: "confirmed",
    delivered: true,
    deliveredWithoutCode: false,
    complete: true,
  });
  assert.deepEqual(proofTicks({}), { photo: false, senderOk: "none", delivered: false, deliveredWithoutCode: false, complete: false });
  assert.equal(proofTicks({ deliveredAt: {}, deliveredWithoutCode: true }).deliveredWithoutCode, true);
  // The override flag means nothing on a package not delivered (a delivery undone).
  assert.equal(proofTicks({ deliveredWithoutCode: true }).deliveredWithoutCode, false);
  assert.equal(senderConfirmationOf({ senderConfirmation: { status: "weird" } }).status, "none");
  assert.equal(senderConfirmationOf({ senderConfirmation: { status: "problem", note: "Wrong count" } }).note, "Wrong count");
  const labels = proofTickLabels(proofTicks({ deliveredAt: {}, deliveredWithoutCode: true, senderConfirmation: { status: "asked" } }), "en");
  assert.equal(labels.delivered, "Delivered without code");
  assert.equal(labels.sender, "Sender: asked");
  assert.equal(labels.photo, "No photo");
  assert.equal(proofTickLabels(proofTicks({}), "fr").photo, "Pas de photo");
});

test("'Missing proof' is no photo, or an unconfirmed sender when the business asks", () => {
  const off = { senderConfirm: false };
  const on = { senderConfirm: true };
  assert.equal(lineMissingProof({}, off), true);
  assert.equal(lineMissingProof({ photoPaths: [PATH] }, off), false);
  assert.equal(lineMissingProof({ photoPaths: [PATH] }, on), true, "never asked");
  assert.equal(lineMissingProof({ photoPaths: [PATH], senderConfirmation: { status: "asked" } }, on), true);
  assert.equal(lineMissingProof({ photoPaths: [PATH], senderConfirmation: { status: "problem" } }, on), true);
  assert.equal(lineMissingProof({ photoPaths: [PATH], senderConfirmation: { status: "confirmed" } }, on), false);
});

test("the form: a stored line round-trips, the rules apply before the call, blanks are null", () => {
  const draft = proofDraftFromLine({
    photoPaths: [PATH, `packagePhotos/${BIZ}/req/req00000001_1.jpg`],
    contents: [{ label: "phone", quantity: 2, serial: "IMEI1" }],
    weightLb: 4.2,
    declaredValueCents: 90000,
  });
  assert.equal(draft.photos.length, 2);
  assert.equal(draft.photos[1].status, "ready");
  assert.deepEqual(draft.contents.map((c) => [c.label, c.quantity, c.serial]), [["phone", "2", "IMEI1"]]);
  assert.equal(draft.weightLb, "4.2");
  assert.equal(draft.declaredValue, "900");
  assert.deepEqual(proofDraftProblems(draft), []);
  assert.deepEqual(proofPayload(draft), {
    photoPaths: [PATH, `packagePhotos/${BIZ}/req/req00000001_1.jpg`],
    contents: [{ label: "phone", quantity: 2, serial: "IMEI1" }],
    weightLb: 4.2,
    declaredValueCents: 90000,
  });

  const blank = emptyProofDraft();
  assert.deepEqual(proofDraftProblems(blank), []);
  assert.deepEqual(proofPayload(blank), { photoPaths: [], contents: [], weightLb: null, declaredValueCents: null });
  assert.deepEqual(proofDraftProblems(blank, { photosRequired: true }), ["photo_required"]);
  // A photo still uploading, or one that failed, is not a photo yet.
  const uploading = { ...blank, photos: [{ key: "p", path: "", previewUrl: "blob:x", status: "uploading" as const }] };
  assert.deepEqual(proofDraftProblems(uploading, { photosRequired: true }), ["photos_uploading", "photo_required"]);
  const failed = { ...blank, photos: [{ key: "p", path: "", previewUrl: "blob:x", status: "error" as const }] };
  assert.deepEqual(proofPayload(failed).photoPaths, []);
  // An item row typed wrong names itself; an empty row is simply dropped.
  const items = { ...blank, contents: [
    { key: "a", label: "phone", quantity: "0", serial: "" },
    { key: "b", label: "", quantity: "1", serial: "" },
    { key: "c", label: "tablet", quantity: "", serial: "S/N 1" },
  ] };
  assert.deepEqual(contentDraftRowProblems(items), [true, false, false]);
  assert.deepEqual(proofDraftProblems(items), ["contents_invalid"]);
  assert.deepEqual(proofPayload({ ...items, contents: items.contents.slice(1) }).contents, [{ label: "tablet", quantity: 1, serial: "S/N 1" }]);
  assert.deepEqual(proofDraftProblems({ ...blank, weightLb: "0", declaredValue: "12.5" }), ["weight_invalid", "declared_value_invalid"]);
  // The server's sentences until the console map knows the codes.
  assert.equal(proofRefusalText("weight_invalid"), "Enter a weight between 0.1 and 2000 lb.");
});

test("a sender_problem refusal names its lines, and the second call acknowledges", async () => {
  const refusal = { code: "functions/failed-precondition", details: { reason: "sender_problem", lineIds: ["L1"], warnings: [{ lineId: "L1", reason: "sender_problem" }, { lineId: "L2", reason: "sender_problem" }] } };
  assert.deepEqual(senderProblemRefusalFrom(refusal), { lineIds: ["L1", "L2"] });
  assert.equal(senderProblemRefusalFrom({ details: { reason: "destination_mismatch" } }), null);
  assert.equal(senderProblemRefusalFrom(new Error("x")), null);

  const calls: boolean[] = [];
  const run = async (ack: boolean) => {
    calls.push(ack);
    if (!ack) throw refusal;
    return "loaded";
  };
  assert.equal(await withProblemAcknowledgement(run, async () => true), "loaded");
  assert.deepEqual(calls, [false, true]);
  calls.length = 0;
  assert.equal(await withProblemAcknowledgement(run, async () => false), null);
  assert.deepEqual(calls, [false]);
  // Any other failure passes through untouched.
  await assert.rejects(withProblemAcknowledgement(async () => { throw new Error("other"); }, async () => true), /other/);

  assert.equal(loadAnywayText(["CL-ABC123"], "en"), "Sender reported a problem with CL-ABC123. Load anyway?");
  assert.equal(loadAnywayText(["CL-ABC123", "CL-DEF456"], "fr"), "L’expéditeur a signalé un problème avec CL-ABC123, CL-DEF456. Charger quand même ?");
});
