/**
 * Proof on a package (docs/AIR_PACKAGES.md): drop-off photos, what is
 * inside, weight and declared value, the sender's WhatsApp confirmation and
 * the three ticks a package shows. Mirrors the server's `package_proof.js`
 * rules so the console checks what it sends before the round trip; the
 * server is the authority.
 *
 * Pure: no Firebase, no DOM. The photo path shape lives in
 * `package-photo.ts` (the upload helper); this module reads it.
 */

import { CONTAINER_MESSAGES } from "./container-manifest.ts";

type Row = Record<string, unknown>;
type Lang = "en" | "fr";

function asRow(value: unknown): Row {
  return value && typeof value === "object" ? (value as Row) : {};
}

function text(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

// packagePhotos/{businessId}/{folder}/{fileId}.{ext}. The folder is the
// uploader's uid for staff photos, "wa" for photos copied from WhatsApp and
// "req" for photos copied from a package request (both server-only).
export const PACKAGE_PHOTO_ROOT = "packagePhotos";
const PHOTO_FILE = /^[A-Za-z0-9_-]{8,64}\.(jpg|jpeg|png|webp)$/;
const PHOTO_FOLDER = /^[A-Za-z0-9_-]{2,128}$/;
export const MAX_PHOTOS = 5;

/** `packagePhotos/{businessId}/{uid}/{fileId}`, or "" when the parts are not ours. */
export function packagePhotoPath(businessId: string, uid: string, fileId: string): string {
  const path = `${PACKAGE_PHOTO_ROOT}/${businessId}/${uid}/${fileId}`;
  return packagePhotoParts(path) ? path : "";
}

/** The parts of a package photo path, or null for anything else (the server's `photoPathParts`). */
export function packagePhotoParts(path: string): { businessId: string; folder: string; fileId: string } | null {
  const parts = String(path || "").split("/");
  if (parts.length !== 4 || parts[0] !== PACKAGE_PHOTO_ROOT) return null;
  const [, businessId, folder, fileId] = parts;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(businessId) || !PHOTO_FOLDER.test(folder)) return null;
  if (!PHOTO_FILE.test(fileId)) return null;
  return { businessId, folder, fileId };
}
export const MAX_CONTENTS = 10;
export const MAX_CONTENT_LABEL = 60;
export const MAX_CONTENT_QUANTITY = 99;
export const MAX_SERIAL = 40;
export const MIN_WEIGHT_LB = 0.1;
export const MAX_WEIGHT_LB = 2000;
export const MAX_DECLARED_VALUE_CENTS = 100000 * 100;

export const CONFIRMATION_STATUSES = ["none", "asked", "confirmed", "problem"] as const;
export type SenderConfirmationStatus = (typeof CONFIRMATION_STATUSES)[number];

export type ContentItem = { label: string; quantity: number; serial: string };

/** The four fields the line callables take, as the server stores them. */
export type ProofFields = {
  photoPaths: string[];
  contents: ContentItem[];
  weightLb: number | null;
  declaredValueCents: number | null;
};

export type ProofRefusal = "photo_invalid" | "photo_required" | "contents_invalid" | "weight_invalid" | "declared_value_invalid";

/**
 * The server's wording for a proof refusal (package_proof.REFUSAL). Read
 * from the console's refusal map when it carries the code; these fallbacks
 * are the server's own sentences, for a map that does not know the code yet.
 */
const PROOF_REFUSAL_FALLBACK: Record<ProofRefusal, string> = {
  photo_invalid: "One of the photos could not be used. Add it again.",
  photo_required: "Add at least one photo of the package.",
  contents_invalid: "Check the item list: a name up to 60 characters, a quantity from 1 to 99, and an optional serial number.",
  weight_invalid: "Enter a weight between 0.1 and 2000 lb.",
  declared_value_invalid: "Enter a declared value of $0 or more.",
};

export function proofRefusalText(code: ProofRefusal): string {
  return (CONTAINER_MESSAGES as Record<string, string>)[code] ?? PROOF_REFUSAL_FALLBACK[code];
}

// ---------------------------------------------------------------------------
// Photos.
// ---------------------------------------------------------------------------

/** The photo list a line stores: unique, in order, at most MAX_PHOTOS. */
export function normalizePhotoPaths(raw: unknown): { paths: string[]; error: "" | "photo_invalid" } {
  if (raw === undefined || raw === null) return { paths: [], error: "" };
  if (!Array.isArray(raw)) return { paths: [], error: "photo_invalid" };
  const paths: string[] = [];
  for (const entry of raw) {
    const path = String(entry ?? "").trim();
    if (!packagePhotoParts(path)) return { paths: [], error: "photo_invalid" };
    if (!paths.includes(path)) paths.push(path);
  }
  if (paths.length > MAX_PHOTOS) return { paths: [], error: "photo_invalid" };
  return { paths, error: "" };
}

/** The drop-off photos a line carries, as stored. */
export function linePhotoPaths(line: unknown): string[] {
  const raw = asRow(line).photoPaths;
  return Array.isArray(raw) ? raw.map((p) => String(p ?? "").trim()).filter((p) => packagePhotoParts(p)) : [];
}

// ---------------------------------------------------------------------------
// Contents, weight, declared value.
// ---------------------------------------------------------------------------

/** What is inside: `[{label, quantity, serial}]`, at most MAX_CONTENTS. */
export function normalizeContents(raw: unknown): { contents: ContentItem[]; error: "" | "contents_invalid" } {
  if (raw === undefined || raw === null) return { contents: [], error: "" };
  if (!Array.isArray(raw)) return { contents: [], error: "contents_invalid" };
  const contents: ContentItem[] = [];
  for (const entry of raw) {
    const row = asRow(entry);
    const label = text(row.label, MAX_CONTENT_LABEL + 1);
    if (!label) continue;
    if (label.length > MAX_CONTENT_LABEL) return { contents: [], error: "contents_invalid" };
    const quantity = Number(row.quantity ?? 1);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_CONTENT_QUANTITY) {
      return { contents: [], error: "contents_invalid" };
    }
    const serial = text(row.serial, MAX_SERIAL + 1).replace(/[^A-Za-z0-9 ./-]/g, "").trim();
    if (serial.length > MAX_SERIAL) return { contents: [], error: "contents_invalid" };
    contents.push({ label, quantity, serial });
  }
  if (contents.length > MAX_CONTENTS) return { contents: [], error: "contents_invalid" };
  return { contents, error: "" };
}

/** The item list a line stores, read defensively. */
export function lineContents(line: unknown): ContentItem[] {
  return normalizeContents(asRow(line).contents).contents;
}

/** "2 phones, tablet, clothes" for a message or a label; serials left out. */
export function contentsText(contents: readonly ContentItem[], max = 120): string {
  const parts = contents
    .filter((c) => c && c.label)
    .map((c) => (Number(c.quantity) > 1 ? `${c.quantity} ${c.label}` : String(c.label)));
  const joined = parts.join(", ");
  if (joined.length <= max) return joined;
  return joined.slice(0, Math.max(0, max - 1)).replace(/,?\s*\S*$/, "") + "…";
}

/** Weight in pounds with one decimal, or NaN; null for "not given". */
export function normalizeWeightLb(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const value = Number(typeof raw === "string" ? raw.replace(",", ".") : raw);
  if (!Number.isFinite(value)) return NaN;
  const rounded = Math.round(value * 10) / 10;
  if (rounded < MIN_WEIGHT_LB || rounded > MAX_WEIGHT_LB) return NaN;
  return rounded;
}

/** The weight a line stores, or null. */
export function lineWeightLb(line: unknown): number | null {
  const value = normalizeWeightLb(asRow(line).weightLb);
  return value === null || Number.isNaN(value) ? null : value;
}

/** "4.2 lb" (EN) or "4,2 lb" (FR); "" when there is no weight. */
export function weightText(weightLb: number | null | undefined, lang: Lang = "en"): string {
  if (typeof weightLb !== "number" || !Number.isFinite(weightLb) || weightLb <= 0) return "";
  const n = weightLb.toFixed(1).replace(/\.0$/, "");
  return `${lang === "fr" ? n.replace(".", ",") : n} lb`;
}

/** Whole cents at or above zero, or NaN; null for "not given". */
export function normalizeDeclaredValueCents(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > MAX_DECLARED_VALUE_CENTS) return NaN;
  return value;
}

/** The declared value a line stores, or null. */
export function lineDeclaredValueCents(line: unknown): number | null {
  const value = normalizeDeclaredValueCents(asRow(line).declaredValueCents);
  return value === null || Number.isNaN(value) ? null : value;
}

/** The proof fields of a new or edited line, checked together. */
export function validateProofFields(raw: unknown): { fields: ProofFields | null; error: "" | ProofRefusal } {
  const row = asRow(raw);
  const photos = normalizePhotoPaths(row.photoPaths);
  if (photos.error) return { fields: null, error: photos.error };
  const contents = normalizeContents(row.contents);
  if (contents.error) return { fields: null, error: contents.error };
  const weightLb = normalizeWeightLb(row.weightLb);
  if (Number.isNaN(weightLb)) return { fields: null, error: "weight_invalid" };
  const declaredValueCents = normalizeDeclaredValueCents(row.declaredValueCents);
  if (Number.isNaN(declaredValueCents)) return { fields: null, error: "declared_value_invalid" };
  return {
    fields: { photoPaths: photos.paths, contents: contents.contents, weightLb, declaredValueCents },
    error: "",
  };
}

// ---------------------------------------------------------------------------
// The business's switches.
// ---------------------------------------------------------------------------

export type ProofSettings = { photosRequired: boolean; senderConfirm: boolean; pickupCode: boolean };

export const PROOF_SETTINGS_OFF: ProofSettings = Object.freeze({ photosRequired: false, senderConfirm: false, pickupCode: false });

/** The three switches on `businesses/{id}.packageProofSettings`; missing means off. */
export function proofSettingsOf(business: unknown): ProofSettings {
  const raw = asRow(asRow(business).packageProofSettings);
  return {
    photosRequired: raw.photosRequired === true,
    senderConfirm: raw.senderConfirm === true,
    pickupCode: raw.pickupCode === true,
  };
}

/**
 * Whether a counter drop-off may be saved without a photo: "" or the refusal.
 * The switch is for packages that fly: a sea package (the default, and every
 * line from before "Ships by") never needs one.
 */
export function photoRequirementRefusal(settings: Pick<ProofSettings, "photosRequired">, line: unknown): "" | "photo_required" {
  if (!settings?.photosRequired) return "";
  const row = asRow(line);
  if (String(row.shipMode || "").toLowerCase() !== "air") return "";
  const source = String(row.source || "counter");
  if (source !== "counter") return "";
  const photos = Array.isArray(row.photoPaths) ? row.photoPaths : [];
  return photos.length ? "" : "photo_required";
}

// ---------------------------------------------------------------------------
// "Ships by: Sea · Air" (docs/AIR_PACKAGES.md §7). A waiting package says how
// it ships; only an air package carries the proof section (photos, what is
// inside, weight, declared value). The choice is offered once the business
// has started a flight (`businesses/{id}.shipsByAir`, set by the server).
// ---------------------------------------------------------------------------

export type PackageShipMode = "sea" | "air";

/** A line's (or a typed) ship mode: "air", or "sea" for anything else. */
export function packageShipModeOf(value: unknown): PackageShipMode {
  return String(value ?? "").trim().toLowerCase() === "air" ? "air" : "sea";
}

/** Whether the business ships by air: the flag the server sets on its first flight. */
export function shipsByAirOf(business: unknown): boolean {
  return asRow(business).shipsByAir === true;
}

/**
 * Whether a package form offers "Ships by": when the business flies, or when
 * the package being edited already flies (so it can be set back to sea).
 */
export function shipsByChoiceShown(shipsByAir: boolean, line: unknown = null): boolean {
  return shipsByAir === true || packageShipModeOf(asRow(line).shipMode) === "air";
}

/** Whether the form shows the proof section: only for a package that flies. */
export function proofSectionShown(shipMode: unknown): boolean {
  return packageShipModeOf(shipMode) === "air";
}

/**
 * What a package form sends for the proof section: the four fields for an
 * air package; nothing for a sea one (an edit then keeps what is stored).
 */
export function proofPayloadFor(shipMode: unknown, draft: ProofDraft): Partial<ProofFields> {
  return proofSectionShown(shipMode) ? proofPayload(draft) : {};
}

// ---------------------------------------------------------------------------
// The sender's confirmation and the three ticks.
// ---------------------------------------------------------------------------

export type SenderConfirmation = {
  status: SenderConfirmationStatus;
  askedAtMs: number;
  answeredAtMs: number;
  wamid: string;
  note: string;
};

/** The sender's confirmation as stored, with defaults. */
export function senderConfirmationOf(line: unknown): SenderConfirmation {
  const raw = asRow(asRow(line).senderConfirmation);
  const status = (CONFIRMATION_STATUSES as readonly string[]).includes(String(raw.status))
    ? (raw.status as SenderConfirmationStatus)
    : "none";
  return {
    status,
    askedAtMs: Number(raw.askedAtMs) || 0,
    answeredAtMs: Number(raw.answeredAtMs) || 0,
    wamid: String(raw.wamid || ""),
    note: String(raw.note || ""),
  };
}

export type ProofTicks = {
  photo: boolean;
  senderOk: SenderConfirmationStatus;
  delivered: boolean;
  /** The override was used at handover: delivered, but without the code. */
  deliveredWithoutCode: boolean;
  complete: boolean;
};

/** The three ticks a package shows (derived, never stored). */
export function proofTicks(line: unknown): ProofTicks {
  const row = asRow(line);
  const photo = Array.isArray(row.photoPaths) && row.photoPaths.length > 0;
  const senderOk = senderConfirmationOf(row).status;
  const delivered = Boolean(row.deliveredAt);
  return {
    photo,
    senderOk,
    delivered,
    deliveredWithoutCode: delivered && row.deliveredWithoutCode === true,
    complete: photo && senderOk === "confirmed" && delivered,
  };
}

/**
 * "Missing proof" on the Waiting list: no drop-off photo, or - when the
 * business asks senders to confirm - a sender who has not said OK yet
 * (asked, none) or said something is wrong.
 */
export function lineMissingProof(line: unknown, settings: Pick<ProofSettings, "senderConfirm">): boolean {
  const ticks = proofTicks(line);
  if (!ticks.photo) return true;
  return Boolean(settings?.senderConfirm) && ticks.senderOk !== "confirmed";
}

/** The ticks' words, for tooltips and the staff view. */
export function proofTickLabels(ticks: ProofTicks, lang: Lang = "en"): { photo: string; sender: string; delivered: string } {
  const fr = lang === "fr";
  const sender = {
    none: fr ? "Expéditeur : pas demandé" : "Sender: not asked",
    asked: fr ? "Expéditeur : demandé" : "Sender: asked",
    confirmed: fr ? "Expéditeur : confirmé" : "Sender: confirmed",
    problem: fr ? "Expéditeur : problème signalé" : "Sender: reported a problem",
  }[ticks.senderOk];
  return {
    photo: ticks.photo ? (fr ? "Photo de dépôt" : "Drop-off photo") : (fr ? "Pas de photo" : "No photo"),
    sender,
    delivered: !ticks.delivered
      ? (fr ? "Pas encore livré" : "Not delivered yet")
      : ticks.deliveredWithoutCode
        ? (fr ? "Livré sans code" : "Delivered without code")
        : (fr ? "Livré" : "Delivered"),
  };
}

// ---------------------------------------------------------------------------
// Loading a package whose sender reported a problem: the server refuses
// with `reason: "sender_problem"` and the line ids until the caller sends
// `acknowledgeProblems: true` (docs/AIR_PACKAGES.md §4.8).
// ---------------------------------------------------------------------------

/** The line ids a `sender_problem` refusal names, or null for any other failure. */
export function senderProblemRefusalFrom(error: unknown): { lineIds: string[] } | null {
  const details = asRow(asRow(error).details);
  if (String(details.reason || "") !== "sender_problem") return null;
  const raw = Array.isArray(details.lineIds) ? details.lineIds : [];
  const warned = Array.isArray(details.warnings) ? details.warnings.map((w) => asRow(w).lineId) : [];
  const lineIds = [...new Set([...raw, ...warned].map((id) => text(id, 200)).filter(Boolean))];
  return { lineIds };
}

/** "Sender reported a problem with CL-ABC123. Load anyway?" */
export function loadAnywayText(codes: readonly string[], lang: Lang = "en"): string {
  const list = codes.filter(Boolean).join(", ");
  if (lang === "fr") {
    return codes.length > 1
      ? `L’expéditeur a signalé un problème avec ${list}. Charger quand même ?`
      : `L’expéditeur a signalé un problème avec ${list || "ce colis"}. Charger quand même ?`;
  }
  return `Sender reported a problem with ${list || "this package"}. Load anyway?`;
}

/**
 * Runs a loading call once; when it is refused for a sender's problem, asks
 * and runs it again acknowledging. Resolves null when the person declines;
 * any other failure is rethrown as it was.
 */
export async function withProblemAcknowledgement<T>(
  run: (acknowledgeProblems: boolean) => Promise<T>,
  confirm: (lineIds: string[]) => Promise<boolean>,
): Promise<T | null> {
  try {
    return await run(false);
  } catch (error) {
    const problem = senderProblemRefusalFrom(error);
    if (!problem) throw error;
    const ok = await confirm(problem.lineIds);
    if (!ok) return null;
    return run(true);
  }
}

// ---------------------------------------------------------------------------
// The form: what staff type, and what the callables are sent.
// ---------------------------------------------------------------------------

export type ProofPhotoDraft = {
  key: string;
  /** The Storage path once uploaded; "" while uploading or after a failure. */
  path: string;
  /** An object URL for a photo chosen now; "" for one already on the line. */
  previewUrl: string;
  status: "uploading" | "ready" | "error";
  /** Why the upload failed, for the form to show; "" otherwise. */
  error?: string;
};

export type ContentDraft = { key: string; label: string; quantity: string; serial: string };

export type ProofDraft = {
  photos: ProofPhotoDraft[];
  contents: ContentDraft[];
  /** Pounds as typed, one decimal. */
  weightLb: string;
  /** Whole dollars as typed. */
  declaredValue: string;
};

let draftSequence = 0;
function nextKey(prefix: string): string {
  draftSequence += 1;
  return `${prefix}-${draftSequence}`;
}

export function newContentDraft(): ContentDraft {
  return { key: nextKey("item"), label: "", quantity: "1", serial: "" };
}

export function emptyProofDraft(): ProofDraft {
  return { photos: [], contents: [], weightLb: "", declaredValue: "" };
}

/** A stored line back into the form: its photos (server folders included), items, weight and value. */
export function proofDraftFromLine(line: unknown): ProofDraft {
  const weight = lineWeightLb(line);
  const value = lineDeclaredValueCents(line);
  return {
    photos: linePhotoPaths(line).map((path) => ({ key: nextKey("photo"), path, previewUrl: "", status: "ready" as const })),
    contents: lineContents(line).map((item) => ({ key: nextKey("item"), label: item.label, quantity: String(item.quantity), serial: item.serial })),
    weightLb: weight === null ? "" : String(weight),
    declaredValue: value === null ? "" : String(Math.round(value / 100)),
  };
}

export function photosStillUploading(draft: Pick<ProofDraft, "photos">): boolean {
  return draft.photos.some((photo) => photo.status === "uploading");
}

/** Whole dollars typed into the declared-value field, as cents; NaN when not a whole amount at or above zero. */
export function readDeclaredValue(typed: string): number | null {
  const clean = String(typed ?? "").trim().replace(/[$\s,]/g, "");
  if (!clean) return null;
  if (!/^\d+$/.test(clean)) return NaN;
  return Number(clean) * 100;
}

export type ProofDraftProblem = "photo_required" | "contents_invalid" | "weight_invalid" | "declared_value_invalid" | "photos_uploading";

/**
 * The form's own checks before the call: the same rules as the server,
 * plus the photo requirement when the business switched it on and the
 * entry is a counter drop-off.
 */
export function proofDraftProblems(draft: ProofDraft, options: { photosRequired?: boolean } = {}): ProofDraftProblem[] {
  const problems: ProofDraftProblem[] = [];
  if (photosStillUploading(draft)) problems.push("photos_uploading");
  const ready = draft.photos.filter((photo) => photo.status === "ready" && photo.path);
  if (options.photosRequired && ready.length === 0) problems.push("photo_required");
  const contents = normalizeContents(draft.contents.map((item) => ({ label: item.label, quantity: item.quantity.trim() === "" ? 1 : Number(item.quantity), serial: item.serial })));
  if (contents.error) problems.push("contents_invalid");
  if (Number.isNaN(normalizeWeightLb(draft.weightLb))) problems.push("weight_invalid");
  const value = readDeclaredValue(draft.declaredValue);
  if (Number.isNaN(value) || Number.isNaN(normalizeDeclaredValueCents(value))) problems.push("declared_value_invalid");
  return problems;
}

/** Which item rows are wrong, for the row's own message. */
export function contentDraftRowProblems(draft: ProofDraft): boolean[] {
  return draft.contents.map((item) => {
    if (!item.label.trim()) return item.quantity.trim() !== "" && item.quantity.trim() !== "1" || item.serial.trim() !== "";
    return normalizeContents([{ label: item.label, quantity: item.quantity.trim() === "" ? 1 : Number(item.quantity), serial: item.serial }]).error !== "";
  });
}

export function proofProblemText(problem: ProofDraftProblem): string {
  if (problem === "photos_uploading") return "Wait for the photos to finish uploading.";
  return proofRefusalText(problem);
}

/**
 * The four fields as the callables take them. Photos that failed to upload
 * are left out; a blank weight or value is sent as null (not given).
 */
export function proofPayload(draft: ProofDraft): ProofFields {
  const photoPaths = normalizePhotoPaths(draft.photos.filter((photo) => photo.status === "ready" && photo.path).map((photo) => photo.path)).paths;
  const contents = normalizeContents(draft.contents.map((item) => ({ label: item.label, quantity: item.quantity.trim() === "" ? 1 : Number(item.quantity), serial: item.serial }))).contents;
  const weight = normalizeWeightLb(draft.weightLb);
  const value = readDeclaredValue(draft.declaredValue);
  return {
    photoPaths,
    contents,
    weightLb: weight === null || Number.isNaN(weight) ? null : weight,
    declaredValueCents: value === null || Number.isNaN(value) ? null : value,
  };
}
