"use strict";

/**
 * Proof on a package (docs/AIR_PACKAGES.md): drop-off photos, what is inside,
 * weight and declared value, the sender's WhatsApp confirmation, the pickup
 * code shown at handover, and the three ticks a package shows.
 *
 * Pure: no Firestore, no clock, no randomness (callers pass bytes). The
 * console's `package-proof.ts` and the app's `package_proof.dart` mirror the
 * rules that clients check before calling the server.
 */

const crypto = require("node:crypto");

const PHOTO_ROOT = "packagePhotos";
// packagePhotos/{businessId}/{folder}/{fileId}.{ext}. The folder is the
// uploader's uid for staff photos, "wa" for photos copied from WhatsApp and
// "req" for photos copied from a package request (both server-only).
const PHOTO_FILE = /^[A-Za-z0-9_-]{8,64}\.(jpg|jpeg|png|webp)$/;
const PHOTO_FOLDER = /^[A-Za-z0-9_-]{2,128}$/;
const PHOTO_TYPES = Object.freeze(["image/jpeg", "image/png", "image/webp"]);
const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
const MAX_PHOTOS = 5;
const MAX_CUSTOMER_PHOTOS = 10;
const PHOTO_LINK_MS = 30 * 24 * 60 * 60 * 1000;
const PHOTO_RETENTION_MS = 365 * 24 * 60 * 60 * 1000;

const MAX_CONTENTS = 10;
const MAX_CONTENT_LABEL = 60;
const MAX_CONTENT_QUANTITY = 99;
const MAX_SERIAL = 40;
const MIN_WEIGHT_LB = 0.1;
const MAX_WEIGHT_LB = 2000;
const MAX_DECLARED_VALUE_CENTS = 100000 * 100;

const CONFIRMATION = Object.freeze({
  NONE: "none",
  ASKED: "asked",
  CONFIRMED: "confirmed",
  PROBLEM: "problem",
});
const CONFIRM_PAYLOAD = Object.freeze({
  OK: "confirm_ok",
  PROBLEM: "confirm_problem",
});

const PROOF_SETTING_KEYS = Object.freeze(
    ["photosRequired", "senderConfirm", "pickupCode"]);

const REFUSAL = Object.freeze({
  photo_invalid: "One of the photos could not be used. Add it again.",
  photo_required: "Add at least one photo of the package.",
  contents_invalid: "Check the item list: a name up to 60 characters, " +
    "a quantity from 1 to 99, and an optional serial number.",
  weight_invalid: "Enter a weight between 0.1 and 2000 lb.",
  declared_value_invalid: "Enter a declared value of $0 or more.",
  pickup_code_invalid: "The pickup code does not match. Ask the receiver " +
    "for the code in their message, or deliver without a code.",
  override_incomplete: "Delivering without a code needs the name of the " +
    "person collecting and a photo.",
});

const text = (value, max) => String(value ?? "").trim().slice(0, max);

/**
 * `packagePhotos/{businessId}/{folder}/{fileId}.{ext}`, or "".
 * @param {string} businessId
 * @param {string} folder
 * @param {string} fileId
 * @return {string}
 */
function photoPath(businessId, folder, fileId) {
  const path = `${PHOTO_ROOT}/${businessId}/${folder}/${fileId}`;
  return photoPathParts(path) ? path : "";
}

/**
 * The parts of a photo path, or null when it is not one of ours.
 * @param {string} path
 * @return {object|null} `{businessId, folder, fileId}`
 */
function photoPathParts(path) {
  const parts = String(path || "").split("/");
  if (parts.length !== 4 || parts[0] !== PHOTO_ROOT) return null;
  const [, businessId, folder, fileId] = parts;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(businessId)) return null;
  if (!PHOTO_FOLDER.test(folder) || !PHOTO_FILE.test(fileId)) return null;
  return {businessId, folder, fileId};
}

/**
 * A staff photo path this caller may attach: in this business, in the
 * caller's own folder. Server-made folders (`wa`, `req`) are accepted only
 * when `allowServerFolders` is set (an edit keeps what the server added).
 * @param {string} path
 * @param {object} o `{businessId, uid, allowServerFolders?}`
 * @return {boolean}
 */
function photoPathAllowed(path, o) {
  const parts = photoPathParts(path);
  if (!parts || parts.businessId !== String(o?.businessId || "")) return false;
  if (parts.folder === String(o?.uid || "")) return true;
  return Boolean(o?.allowServerFolders) &&
    (parts.folder === "wa" || parts.folder === "req");
}

/**
 * Whether a stored file is a photo we accept (size and type).
 * @param {object} meta `{size, contentType}`
 * @return {boolean}
 */
function photoMetadataValid(meta) {
  const size = Number(meta?.size);
  if (!Number.isFinite(size) || size <= 0 || size > PHOTO_MAX_BYTES) {
    return false;
  }
  return PHOTO_TYPES.includes(String(meta?.contentType || "").toLowerCase());
}

/**
 * The photo list a line stores: unique, in order, at most MAX_PHOTOS.
 * @param {unknown} raw
 * @return {object} `{paths, error}`
 */
function normalizePhotoPaths(raw) {
  if (raw === undefined || raw === null) return {paths: [], error: ""};
  if (!Array.isArray(raw)) return {paths: [], error: "photo_invalid"};
  const paths = [];
  for (const entry of raw) {
    const path = String(entry || "").trim();
    if (!photoPathParts(path)) return {paths: [], error: "photo_invalid"};
    if (!paths.includes(path)) paths.push(path);
  }
  if (paths.length > MAX_PHOTOS) return {paths: [], error: "photo_invalid"};
  return {paths, error: ""};
}

/**
 * A time-limited link to one photo, served by the /d document endpoint
 * (view=photo). The signature binds the line's document token, the path and
 * the expiry, so a link cannot be stretched or pointed at another file.
 * @param {object} o `{base, token, path, expiresMs}`
 * @return {string}
 */
function photoLink(o) {
  const expires = Math.floor(Number(o.expiresMs));
  const sig = photoSignature(o.token, o.path, expires);
  const q = new URLSearchParams({
    view: "photo", t: String(o.token), p: String(o.path), e: String(expires),
    s: sig,
  });
  return `${o.base}?${q.toString()}`;
}

/**
 * @param {string} token
 * @param {string} path
 * @param {number} expiresMs
 * @return {string}
 */
function photoSignature(token, path, expiresMs) {
  return crypto.createHash("sha256")
      .update(`${token}|${path}|${Math.floor(Number(expiresMs))}`)
      .digest("hex").slice(0, 24);
}

/**
 * Whether a /d?view=photo query is genuine and still valid.
 * @param {object} query `{t, p, e, s}`
 * @param {string} token The line's stored document token.
 * @param {number} nowMs
 * @return {boolean}
 */
function photoLinkValid(query, token, nowMs) {
  const expires = Number(query?.e);
  if (!token || !Number.isFinite(expires) || expires <= nowMs) return false;
  const path = String(query?.p || "");
  if (!photoPathParts(path)) return false;
  const expected = photoSignature(token, path, expires);
  const given = String(query?.s || "");
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/**
 * Four digits, never 0000, from random bytes the caller supplies.
 * @param {Buffer|Uint8Array} bytes At least 2 bytes.
 * @return {string}
 */
function pickupCodeFrom(bytes) {
  const n = ((bytes[0] << 8) | bytes[1]) % 10000;
  return String(n === 0 ? 1000 + (bytes[1] % 9000) : n).padStart(4, "0");
}

/**
 * Whether a code typed at handover matches the line's code.
 * @param {string} given
 * @param {string} stored
 * @return {boolean}
 */
function pickupCodeMatches(given, stored) {
  const a = String(given || "").replace(/\D/g, "");
  const b = String(stored || "").replace(/\D/g, "");
  return a.length === 4 && a === b;
}

/**
 * What is inside: `[{label, quantity, serial}]`, at most MAX_CONTENTS.
 * @param {unknown} raw
 * @return {object} `{contents, error}`
 */
function normalizeContents(raw) {
  if (raw === undefined || raw === null) return {contents: [], error: ""};
  if (!Array.isArray(raw)) return {contents: [], error: "contents_invalid"};
  const contents = [];
  for (const entry of raw) {
    const label = text(entry?.label, MAX_CONTENT_LABEL + 1);
    if (!label) continue;
    if (label.length > MAX_CONTENT_LABEL) {
      return {contents: [], error: "contents_invalid"};
    }
    const quantityRaw = entry?.quantity ?? 1;
    const quantity = Number(quantityRaw);
    if (!Number.isInteger(quantity) || quantity < 1 ||
        quantity > MAX_CONTENT_QUANTITY) {
      return {contents: [], error: "contents_invalid"};
    }
    const serial = text(entry?.serial, MAX_SERIAL + 1)
        .replace(/[^A-Za-z0-9 ./-]/g, "").trim();
    if (serial.length > MAX_SERIAL) {
      return {contents: [], error: "contents_invalid"};
    }
    contents.push({label, quantity, serial});
  }
  if (contents.length > MAX_CONTENTS) {
    return {contents: [], error: "contents_invalid"};
  }
  return {contents, error: ""};
}

/**
 * "2 phones, 1 tablet, clothes" for a message or a label. Serials are left
 * out: they are for staff and customs, not for a chat.
 * @param {object[]} contents
 * @param {number} [max] Characters, for template parameters.
 * @return {string}
 */
function contentsText(contents, max = 120) {
  const parts = (Array.isArray(contents) ? contents : [])
      .filter((c) => c && c.label)
      .map((c) => (Number(c.quantity) > 1 ? `${c.quantity} ${c.label}` :
        String(c.label)));
  const joined = parts.join(", ");
  if (joined.length <= max) return joined;
  return joined.slice(0, Math.max(0, max - 1)).replace(/,?\s*\S*$/, "") + "…";
}

/**
 * Weight in pounds with one decimal, or NaN. `null`/"" mean "not given".
 * @param {unknown} raw
 * @return {number|null}
 */
function normalizeWeightLb(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return NaN;
  const rounded = Math.round(value * 10) / 10;
  if (rounded < MIN_WEIGHT_LB || rounded > MAX_WEIGHT_LB) return NaN;
  return rounded;
}

/**
 * "4.2 lb" (EN) or "4,2 lb" (FR); "" when there is no weight.
 * @param {number|null} weightLb
 * @param {string} lang
 * @return {string}
 */
function weightText(weightLb, lang = "en") {
  if (!Number.isFinite(weightLb) || weightLb <= 0) return "";
  const n = weightLb.toFixed(1).replace(/\.0$/, "");
  return `${lang === "fr" ? n.replace(".", ",") : n} lb`;
}

/**
 * Whole cents ≥ 0, or NaN. `null`/"" mean "not given".
 * @param {unknown} raw
 * @return {number|null}
 */
function normalizeDeclaredValueCents(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 ||
      value > MAX_DECLARED_VALUE_CENTS) {
    return NaN;
  }
  return value;
}

/**
 * The proof fields of a new or edited line, checked together.
 * @param {object} raw `{photoPaths, contents, weightLb, declaredValueCents}`
 * @return {object} `{fields, error}`
 */
function validateProofFields(raw) {
  const photos = normalizePhotoPaths(raw?.photoPaths);
  if (photos.error) return {fields: {}, error: photos.error};
  const contents = normalizeContents(raw?.contents);
  if (contents.error) return {fields: {}, error: contents.error};
  const weightLb = normalizeWeightLb(raw?.weightLb);
  if (Number.isNaN(weightLb)) return {fields: {}, error: "weight_invalid"};
  const declaredValueCents = normalizeDeclaredValueCents(
      raw?.declaredValueCents);
  if (Number.isNaN(declaredValueCents)) {
    return {fields: {}, error: "declared_value_invalid"};
  }
  return {
    fields: {
      photoPaths: photos.paths,
      contents: contents.contents,
      weightLb,
      declaredValueCents,
    },
    error: "",
  };
}

/**
 * The business's three switches; anything missing is off.
 * @param {object} business The `businesses/{id}` data.
 * @return {object} `{photosRequired, senderConfirm, pickupCode}`
 */
function proofSettingsOf(business) {
  const raw = business?.packageProofSettings || {};
  const out = {};
  for (const key of PROOF_SETTING_KEYS) out[key] = raw[key] === true;
  return out;
}

/**
 * The switches as the owner saves them.
 * @param {unknown} raw
 * @return {object} `{settings, error}`
 */
function validateProofSettings(raw) {
  if (raw === undefined || raw === null) {
    return {settings: proofSettingsOf({}), error: ""};
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return {settings: {}, error: "proof_settings_invalid"};
  }
  const settings = {};
  for (const key of PROOF_SETTING_KEYS) {
    const value = raw[key];
    if (value !== undefined && typeof value !== "boolean") {
      return {settings: {}, error: "proof_settings_invalid"};
    }
    settings[key] = value === true;
  }
  return {settings, error: ""};
}

/**
 * Whether a counter drop-off may be saved without a photo. The switch is
 * for packages that fly: a sea package (the default, and every line from
 * before "Ships by") never needs one.
 * @param {object} settings `{photosRequired}`
 * @param {object} line `{source, photoPaths, shipMode}`
 * @return {string} "" or the refusal code.
 */
function photoRequirementRefusal(settings, line) {
  if (!settings?.photosRequired) return "";
  if (String(line?.shipMode || "").toLowerCase() !== "air") return "";
  const source = String(line?.source || "counter");
  if (source !== "counter") return "";
  const photos = Array.isArray(line?.photoPaths) ? line.photoPaths : [];
  return photos.length ? "" : "photo_required";
}

/**
 * The sender's confirmation as stored, with defaults.
 * @param {object} line
 * @return {object} `{status, askedAtMs, answeredAtMs, wamid, note}`
 */
function senderConfirmationOf(line) {
  const raw = line?.senderConfirmation || {};
  const status = Object.values(CONFIRMATION).includes(raw.status) ?
    raw.status : CONFIRMATION.NONE;
  return {
    status,
    askedAtMs: Number(raw.askedAtMs) || 0,
    answeredAtMs: Number(raw.answeredAtMs) || 0,
    wamid: String(raw.wamid || ""),
    note: String(raw.note || ""),
  };
}

/**
 * What a button reply means, or "" for anything else.
 * @param {string} payload
 * @return {string} "confirmed", "problem" or ""
 */
function confirmationFromPayload(payload) {
  const value = String(payload || "").trim().toLowerCase();
  if (value === CONFIRM_PAYLOAD.OK) return CONFIRMATION.CONFIRMED;
  if (value === CONFIRM_PAYLOAD.PROBLEM) return CONFIRMATION.PROBLEM;
  return "";
}

/**
 * The three ticks a package shows.
 * @param {object} line
 * @return {object} `{photo, senderOk, delivered, complete}`
 */
function proofTicks(line) {
  const photo = Array.isArray(line?.photoPaths) && line.photoPaths.length > 0;
  const senderOk = senderConfirmationOf(line).status;
  const delivered = Boolean(line?.deliveredAt);
  return {
    photo,
    senderOk,
    delivered,
    complete: photo && senderOk === CONFIRMATION.CONFIRMED && delivered,
  };
}

/**
 * How a handover may proceed given the business switch, the line's code and
 * what the agent entered. "" means deliver normally.
 * @param {object} settings `{pickupCode}`
 * @param {object} line `{pickupCode}`
 * @param {object} input `{pickupCode, override: {collectedBy, photoPath}}`
 * @return {object} `{refusal, withoutCode}`
 */
function handoverCheck(settings, line, input) {
  const stored = String(line?.pickupCode || "");
  if (!settings?.pickupCode || !stored) {
    return {refusal: "", withoutCode: false};
  }
  if (pickupCodeMatches(input?.pickupCode, stored)) {
    return {refusal: "", withoutCode: false};
  }
  const override = input?.override;
  if (!override) return {refusal: "pickup_code_invalid", withoutCode: false};
  const name = text(override.collectedBy, 120);
  const photo = String(override.photoPath || "").trim();
  if (name.length < 2 || !photoPathParts(photo)) {
    return {refusal: "override_incomplete", withoutCode: false};
  }
  return {refusal: "", withoutCode: true};
}

module.exports = {
  CONFIRMATION,
  CONFIRM_PAYLOAD,
  MAX_CONTENTS,
  MAX_CUSTOMER_PHOTOS,
  MAX_PHOTOS,
  PHOTO_LINK_MS,
  PHOTO_MAX_BYTES,
  PHOTO_RETENTION_MS,
  PHOTO_ROOT,
  PHOTO_TYPES,
  PROOF_SETTING_KEYS,
  REFUSAL,
  confirmationFromPayload,
  contentsText,
  handoverCheck,
  normalizeContents,
  normalizeDeclaredValueCents,
  normalizePhotoPaths,
  normalizeWeightLb,
  photoLink,
  photoLinkValid,
  photoMetadataValid,
  photoPath,
  photoPathAllowed,
  photoPathParts,
  photoRequirementRefusal,
  photoSignature,
  pickupCodeFrom,
  pickupCodeMatches,
  proofSettingsOf,
  proofTicks,
  senderConfirmationOf,
  validateProofFields,
  validateProofSettings,
  weightText,
};
