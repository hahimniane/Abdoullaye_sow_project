"use strict";

/**
 * Customer package requests (docs/PACKAGE_REQUESTS.md §2-§4, §7, §8).
 *
 * A customer asks one business to take a load - "Bring it in" (they drop it
 * off) or "Collect from me" (the business picks it up). The business sends an
 * estimate, the customer confirms it on the /e/<token> page (or agrees by
 * phone), it shows as Expected in the Waiting list, and the "Received" tap
 * turns it into one containerLines line (request_receive.js).
 *
 * Everything here is pure: no Firestore, no network, no clock except the
 * `nowMs` the caller passes. index.js reads, decides with these functions and
 * writes; test/package-requests.test.js pins every rule.
 */

const {isInternationalPhone} = require("./container_manifest");

const STATUS = Object.freeze({
  NEW: "new",
  ESTIMATE_SENT: "estimate_sent",
  CONFIRMED: "confirmed",
  RECEIVED: "received",
  DECLINED: "declined",
  CUSTOMER_DECLINED: "customer_declined",
  CANCELLED: "cancelled",
  EXPIRED: "expired",
});
const STATUSES = Object.freeze(Object.values(STATUS));
const OPEN_STATUSES = Object.freeze(
    [STATUS.NEW, STATUS.ESTIMATE_SENT, STATUS.CONFIRMED]);

const HANDOFF = Object.freeze({BRING_IN: "bring_in", COLLECT: "collect"});
const HANDOFFS = Object.freeze(Object.values(HANDOFF));
const PIECE_KINDS = Object.freeze(["barrel", "box", "other"]);
const PICKUP_WINDOWS = Object.freeze(["morning", "afternoon", "evening"]);
const WEEK_DAYS = Object.freeze(["mon", "tue", "wed", "thu", "fri", "sat",
  "sun"]);
const LANGUAGES = Object.freeze(["en", "fr"]);
const CONFIRMED_VIA = Object.freeze({
  LINK: "link", STAFF_PHONE: "staff_phone", CARD: "card"});

const DEFAULT_TIME_ZONE = "America/New_York";

const LIMIT = Object.freeze({
  PIECES: 20,
  PHOTOS_PER_PIECE: 5,
  NAME: 80,
  DESCRIPTION: 120,
  ADDRESS: 200,
  NOTE: 300,
  AREAS: 300,
  REASON: 300,
  PIECE_CENTS: 10000000,
  SIZE_IN: 600,
  PLANNED_DAYS_AHEAD: 60,
  HISTORY: 100,
});

const DAY_MS = 24 * 60 * 60 * 1000;
const TIMER = Object.freeze({
  LOCK_MS: 15 * 60 * 1000,
  IDEMPOTENCY_MS: 10 * 60 * 1000,
  ESTIMATE_REMINDER_MS: DAY_MS,
  ESTIMATE_EXPIRY_MS: 14 * DAY_MS,
  NEW_ALERT_MS: 3 * DAY_MS,
  NEW_EXPIRY_MS: 30 * DAY_MS,
  DROPOFF_REMINDER_DAYS: 3,
  CONFIRMED_EXPIRY_DAYS: 30,
  PHOTO_RETENTION_MS: 90 * DAY_MS,
  // A received request whose line is not ready for pickup yet is looked at
  // again this often, to start the 90 days once it is.
  PHOTO_RECHECK_MS: 7 * DAY_MS,
});

const ACTION = Object.freeze({
  ESTIMATE_REMINDER: "estimate_reminder",
  STAFF_ALERT: "staff_alert",
  DROPOFF_REMINDER: "dropoff_reminder",
  EXPIRE: "expire",
  DELETE_PHOTOS: "delete_photos",
  CHECK_PHOTOS: "check_photos",
});

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,80}$/;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)$/;
const PHOTO_FILE = /^[A-Za-z0-9_-]{8,64}(\.(jpg|jpeg|png|webp))?$/;
const PHOTO_CONTENT_TYPES = Object.freeze(
    ["image/jpeg", "image/png", "image/webp"]);
const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
const PHOTO_ROOT = "packageRequestPhotos";

// What a refusal says, in English. Clients show their own copy per code.
const REQUEST_MESSAGES = Object.freeze({
  business_unavailable: "This business is not taking requests right now.",
  business_not_found: "We could not find that business.",
  requests_off: "This business is not taking requests right now.",
  destination_unavailable: "This business does not ship there any more.",
  bring_in_unavailable: "This business has no drop-off hours yet.",
  collect_unavailable: "This business does not pick up.",
  handoff_invalid: "Choose how the goods reach the business.",
  location_invalid: "Choose where you will drop it off.",
  planned_date_invalid: "Choose a day in the next 60 days.",
  planned_day_closed: "The business is closed that day.",
  pickup_address_required: "Enter the pickup address.",
  pickup_date_invalid: "Choose a pickup day in the next 60 days.",
  pickup_window_invalid: "Choose a time of day for the pickup.",
  sender_name_required: "Enter your name.",
  sender_phone_invalid: "Enter your WhatsApp number with its country code.",
  receiver_name_required: "Enter the receiver's name.",
  receiver_phone_invalid:
    "Enter the receiver's phone number with its country code.",
  pieces_required: "Add at least one piece.",
  too_many_pieces: "A request can hold at most 20 pieces.",
  piece_kind_invalid: "Choose what each piece is.",
  piece_description_required: "Say what each box or item is.",
  text_too_long: "One of the answers is too long.",
  size_invalid: "Sizes are inches, all three or none.",
  too_many_photos: "Up to 5 photos per piece.",
  photo_invalid: "One of the photos could not be used. Add it again.",
  language_invalid: "Choose a language.",
  idempotency_key_invalid: "Refresh the page and send again.",
  rate_limited: "Too many requests. Please wait and try again.",
  request_not_found: "We could not find that request.",
  request_closed: "This request is closed.",
  estimate_changed: "This estimate changed. See the new one.",
  estimate_missing: "There is no estimate to confirm yet.",
  estimate_locked: "Someone else is writing the estimate.",
  estimate_stale: "Someone sent a newer estimate. Reload it first.",
  estimate_piece_missing: "Every piece needs a price.",
  estimate_piece_unknown: "That piece is not on the request.",
  amount_invalid: "Enter a valid amount.",
  pickup_fee_invalid: "Enter a valid pickup fee.",
  pickup_schedule_invalid: "Choose a valid pickup day and time.",
  card_order: "This request was paid by card. Refund the barrel order " +
    "instead.",
  reason_required: "Give a reason.",
  slug_invalid: "Use 3 to 40 lowercase letters, digits or dashes.",
  slug_taken: "That link is already taken.",
  slug_locked: "The request link can only be changed once.",
  slug_missing: "Save the request settings first.",
  hours_invalid: "Opening hours need a start before the end.",
  location_unknown: "That location is not one of yours.",
  pickup_areas_required: "Say which areas you pick up from.",
  price_required: "Price every piece, or none of them.",
});

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const isText = (value) => typeof value === "string";
const intIn = (value, min, max) => Number.isInteger(value) &&
  value >= min && value <= max;

/**
 * @param {*} value A stored or typed phone.
 * @return {string} The E.164 form ("+..."), or "" when it is not one.
 */
function e164(value) {
  const compact = text(value, 40).replace(/[\s().-]/g, "");
  return isInternationalPhone(compact) ? compact : "";
}

/**
 * @param {*} status A stored status.
 * @return {boolean} Whether the request is still open.
 */
function isOpenStatus(status) {
  return OPEN_STATUSES.includes(text(status, 40));
}

/**
 * @param {object} request A stored request.
 * @return {boolean} Whether it was paid online by card.
 */
function isCardPaid(request) {
  return text(request?.payment?.timing, 20) === "card";
}

// ---------------------------------------------------------------------------
// Dates and time zones. A date a person picks is a "YYYY-MM-DD" key in the
// business's zone; timers compare instants.
// ---------------------------------------------------------------------------

/**
 * @param {*} zone A stored IANA zone.
 * @return {string} It, when Intl knows it, else America/New_York.
 */
function businessTimeZone(zone) {
  const value = text(zone, 64);
  if (!value) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", {timeZone: value});
    return value;
  } catch (_) {
    return DEFAULT_TIME_ZONE;
  }
}

/**
 * @param {number} ms An instant.
 * @param {string} zone A valid zone.
 * @return {number} Local time minus UTC, in ms.
 */
function zoneOffsetMs(ms, zone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, hourCycle: "h23", year: "numeric", month: "numeric",
    day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
  }).formatToParts(new Date(ms));
  const pick = (type) => Number(parts.find((p) => p.type === type).value);
  const asUtc = Date.UTC(pick("year"), pick("month") - 1, pick("day"),
      pick("hour"), pick("minute"), pick("second"));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * @param {number} ms An instant.
 * @param {string} zone A zone.
 * @return {string} The local date there, "YYYY-MM-DD".
 */
function dateKeyIn(ms, zone) {
  const local = new Date(ms + zoneOffsetMs(ms, businessTimeZone(zone)));
  return local.toISOString().slice(0, 10);
}

/**
 * @param {*} key A typed date.
 * @return {boolean} Whether it is a real calendar date "YYYY-MM-DD".
 */
function dateKeyValid(key) {
  if (!isText(key) || !DATE_KEY.test(key)) return false;
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d;
}

/**
 * @param {string} key "YYYY-MM-DD".
 * @param {number} days Days to add (may be negative).
 * @return {string} The other date.
 */
function addDays(key, days) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * @param {string} key "YYYY-MM-DD".
 * @return {string} Its weekday, "mon".."sun".
 */
function weekdayOf(key) {
  const [y, m, d] = key.split("-").map(Number);
  // getUTCDay: 0 = Sunday.
  return WEEK_DAYS[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7];
}

/**
 * The first instant of a local date in a zone (DST-safe).
 *
 * @param {string} key "YYYY-MM-DD".
 * @param {string} zone A zone.
 * @return {number} Epoch ms.
 */
function startOfDayMs(key, zone) {
  const tz = businessTimeZone(zone);
  const [y, m, d] = key.split("-").map(Number);
  const midnight = Date.UTC(y, m - 1, d);
  let start = midnight - zoneOffsetMs(midnight, tz);
  start = midnight - zoneOffsetMs(start, tz);
  return start;
}

/**
 * A date a customer picks: today .. today + 60 in the business's zone.
 *
 * @param {*} key The date.
 * @param {number} nowMs Now.
 * @param {string} zone The business's zone.
 * @return {boolean} Whether it may be chosen.
 */
function pickableDate(key, nowMs, zone) {
  if (!dateKeyValid(key)) return false;
  const today = dateKeyIn(nowMs, zone);
  return key >= today && key <= addDays(today, LIMIT.PLANNED_DAYS_AHEAD);
}

// ---------------------------------------------------------------------------
// Business settings.
// ---------------------------------------------------------------------------

/**
 * A request link slug from a business name: lower case, accents dropped,
 * anything else a dash, 3..40 characters.
 *
 * @param {*} name The business's name.
 * @return {string} A slug that passes slugValid.
 */
function slugFromName(name) {
  let slug = text(name, 120).normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
      .slice(0, 40).replace(/-+$/g, "");
  if (slug.length < 3) slug = `${slug || "shop"}-ship`.replace(/^-/, "");
  return slug;
}

/**
 * @param {*} slug A typed slug.
 * @return {boolean} `[a-z0-9-]{3,40}`, no dash at either end, no "--".
 */
function slugValid(slug) {
  return isText(slug) && SLUG_PATTERN.test(slug) && !slug.includes("--");
}

/**
 * @param {string} base A valid slug.
 * @param {number} attempt 0 for the slug itself, then 2, 3, ...
 * @return {string} "base", "base-2", ... still within 40 characters.
 */
function slugCandidate(base, attempt) {
  if (!attempt) return base;
  const suffix = `-${attempt}`;
  return `${base.slice(0, 40 - suffix.length).replace(/-+$/, "")}${suffix}`;
}

/**
 * One location's week of opening hours.
 *
 * @param {*} raw {mon..sun: {open, from, to}}.
 * @return {{week: ?object, ok: boolean}} The cleaned week (every day
 *   present), or ok false when a day is malformed.
 */
function cleanWeek(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const week = {};
  for (const day of WEEK_DAYS) {
    const value = input[day] && typeof input[day] === "object" ?
      input[day] : {open: false};
    if (value.open !== true) {
      week[day] = {open: false, from: "", to: ""};
      continue;
    }
    const from = text(value.from, 5);
    const to = text(value.to, 5);
    if (!TIME_OF_DAY.test(from) || !TIME_OF_DAY.test(to) || from >= to) {
      return {week: null, ok: false};
    }
    week[day] = {open: true, from, to};
  }
  return {week, ok: true};
}

/**
 * @param {object|null} week A cleaned week.
 * @return {boolean} Whether it is open at least one day.
 */
function weekHasHours(week) {
  return Boolean(week) && WEEK_DAYS.some((day) => week[day]?.open === true);
}

/**
 * Validates the owner's request settings.
 *
 * @param {object} input The callable's data.
 * @param {object} ctx {locationIds: string[]} the business's drop-off ids.
 * @return {{settings: object, slug: string, errors: string[]}} What to
 *   store, the slug asked for ("" = keep / assign), and every problem.
 */
function validateRequestSettings(input, ctx = {}) {
  const errors = [];
  const data = input && typeof input === "object" ? input : {};
  const known = new Set(Array.isArray(ctx.locationIds) ? ctx.locationIds : []);
  const openingHours = {};
  const rawHours = data.openingHours && typeof data.openingHours === "object" ?
    data.openingHours : {};
  for (const [locationId, rawWeek] of Object.entries(rawHours)) {
    if (!known.has(locationId)) {
      if (!errors.includes("location_unknown")) errors.push("location_unknown");
      continue;
    }
    const {week, ok} = cleanWeek(rawWeek);
    if (!ok) {
      if (!errors.includes("hours_invalid")) errors.push("hours_invalid");
      continue;
    }
    openingHours[locationId] = week;
  }
  const pickupInput = data.pickup && typeof data.pickup === "object" ?
    data.pickup : {};
  const areasRaw = String(pickupInput.areas ?? "").trim();
  if (areasRaw.length > LIMIT.AREAS) errors.push("text_too_long");
  const pickup = {
    enabled: pickupInput.enabled === true,
    areas: areasRaw.slice(0, LIMIT.AREAS),
  };
  if (pickup.enabled && !pickup.areas) errors.push("pickup_areas_required");
  const slug = data.requestSlug === undefined || data.requestSlug === null ?
    "" : String(data.requestSlug).trim().toLowerCase();
  if (slug && !slugValid(slug)) errors.push("slug_invalid");
  return {
    settings: {
      acceptRequests: data.acceptRequests === true,
      openingHours,
      pickup,
      cardBarrelBooking: data.cardBarrelBooking === true,
      timeZone: businessTimeZone(data.timeZone),
    },
    slug,
    errors,
  };
}

/**
 * The stored settings, read defensively.
 *
 * @param {object} business The business document.
 * @return {object} {acceptRequests, openingHours, pickup, cardBarrelBooking,
 *   timeZone}.
 */
function requestSettingsOf(business) {
  const raw = business?.packageRequestSettings &&
    typeof business.packageRequestSettings === "object" ?
    business.packageRequestSettings : {};
  const openingHours = {};
  if (raw.openingHours && typeof raw.openingHours === "object") {
    for (const [id, week] of Object.entries(raw.openingHours)) {
      const cleaned = cleanWeek(week);
      if (cleaned.ok) openingHours[id] = cleaned.week;
    }
  }
  return {
    acceptRequests: raw.acceptRequests === true,
    openingHours,
    pickup: {
      enabled: raw.pickup?.enabled === true,
      areas: text(raw.pickup?.areas, LIMIT.AREAS),
    },
    cardBarrelBooking: raw.cardBarrelBooking === true,
    timeZone: businessTimeZone(raw.timeZone),
  };
}

/**
 * The drop-off locations a customer may choose: those with opening hours.
 *
 * @param {object[]} locations {id, label, address} of the business.
 * @param {object} settings requestSettingsOf(business).
 * @return {object[]} {id, label, address, hours}.
 */
function bringInLocations(locations, settings) {
  return (Array.isArray(locations) ? locations : [])
      .filter((loc) => loc && weekHasHours(settings.openingHours[loc.id]))
      .map((loc) => ({
        id: text(loc.id, 120),
        label: text(loc.label, 120),
        address: text(loc.address, 300),
        hours: settings.openingHours[loc.id],
      }));
}

/**
 * One business x destination as the customer form lists it.
 *
 * @param {object} args {businessId, business, destinationId, destination,
 *   locations}.
 * @return {object|null} The option, or null when this pair is not offered.
 */
function requestOption({businessId, business, destinationId, destination,
  locations}) {
  if (!business || text(business.status, 40) !== "approved") return null;
  const settings = requestSettingsOf(business);
  if (!settings.acceptRequests || !text(business.requestSlug, 40)) return null;
  if (!destination || destination.isActive !== true) return null;
  const spots = bringInLocations(locations, settings);
  const bringIn = {available: spots.length > 0, locations: spots};
  const collect = {available: settings.pickup.enabled,
    areas: settings.pickup.enabled ? settings.pickup.areas : ""};
  if (!bringIn.available && !collect.available) return null;
  const price = Number(destination.barrelShippingPrice || 0);
  return {
    businessId,
    businessName: text(business.name, 120) || businessId,
    businessPhone: text(business.phone, 40),
    profileImageUrl: text(business.profileImageUrl, 1000),
    slug: text(business.requestSlug, 40),
    country: {id: destinationId,
      name: text(destination.name, 120) || destinationId},
    barrelPriceCents: Number.isFinite(price) && price > 0 ?
      Math.round(price * 100) : null,
    cardBarrelBooking: settings.cardBarrelBooking,
    bringIn,
    collect,
    timeZone: settings.timeZone,
  };
}

// ---------------------------------------------------------------------------
// The customer's submission.
// ---------------------------------------------------------------------------

/**
 * @param {*} path A photo path a client sent.
 * @param {string} businessId The business.
 * @param {string} uid The caller.
 * @return {boolean} Whether it is one of the caller's uploads for it.
 */
function photoPathValid(path, businessId, uid) {
  if (!isText(path) || !businessId || !uid) return false;
  const parts = path.split("/");
  return parts.length === 4 && parts[0] === PHOTO_ROOT &&
    parts[1] === businessId && parts[2] === uid && PHOTO_FILE.test(parts[3]);
}

/**
 * @param {object} meta {contentType, size} of a stored file.
 * @return {boolean} Whether it may be attached.
 */
function photoMetadataValid(meta) {
  return PHOTO_CONTENT_TYPES.includes(text(meta?.contentType, 60)) &&
    Number(meta?.size) > 0 && Number(meta?.size) < PHOTO_MAX_BYTES;
}

/**
 * @param {*} raw {l, w, h} inches, or nothing.
 * @return {{size: ?object, ok: boolean}}
 */
function cleanSize(raw) {
  if (raw === undefined || raw === null) return {size: null, ok: true};
  if (typeof raw !== "object") return {size: null, ok: false};
  const sides = ["l", "w", "h"].map((k) => raw[k]);
  if (sides.every((v) => v === undefined || v === null || v === "")) {
    return {size: null, ok: true};
  }
  const nums = sides.map(Number);
  if (nums.some((n) => !Number.isFinite(n) || n <= 0 || n > LIMIT.SIZE_IN)) {
    return {size: null, ok: false};
  }
  const round = (n) => Math.round(n * 100) / 100;
  return {size: {l: round(nums[0]), w: round(nums[1]), h: round(nums[2])},
    ok: true};
}

/**
 * The pieces as stored, with the barrel price as their estimate.
 *
 * @param {*} raw The client's pieces.
 * @param {object} ctx {barrelPriceCents, businessId, uid}.
 * @return {{pieces: object[], errors: string[], photoPaths: string[]}}
 */
function cleanPieces(raw, ctx = {}) {
  const errors = [];
  const add = (code) => {
    if (!errors.includes(code)) errors.push(code);
  };
  const list = Array.isArray(raw) ? raw : [];
  if (list.length === 0) add("pieces_required");
  if (list.length > LIMIT.PIECES) add("too_many_pieces");
  const pieces = [];
  const photoPaths = [];
  list.slice(0, LIMIT.PIECES).forEach((item, index) => {
    const piece = item && typeof item === "object" ? item : {};
    const kind = text(piece.kind, 20);
    if (!PIECE_KINDS.includes(kind)) add("piece_kind_invalid");
    const descriptionRaw = String(piece.description ?? "").trim();
    if (descriptionRaw.length > LIMIT.DESCRIPTION) add("text_too_long");
    if (kind !== "barrel" && !descriptionRaw) {
      add("piece_description_required");
    }
    const {size, ok} = cleanSize(piece.sizeIn);
    if (!ok) add("size_invalid");
    const paths = Array.isArray(piece.photoPaths) ? piece.photoPaths : [];
    if (paths.length > LIMIT.PHOTOS_PER_PIECE) add("too_many_photos");
    const cleanPaths = [];
    for (const path of paths.slice(0, LIMIT.PHOTOS_PER_PIECE)) {
      if (!photoPathValid(path, ctx.businessId, ctx.uid) ||
          photoPaths.includes(path)) {
        add("photo_invalid");
        continue;
      }
      cleanPaths.push(path);
      photoPaths.push(path);
    }
    const price = Number.isInteger(ctx.barrelPriceCents) &&
      ctx.barrelPriceCents > 0 ? ctx.barrelPriceCents : null;
    pieces.push({
      id: `p${index + 1}`,
      kind: PIECE_KINDS.includes(kind) ? kind : "other",
      description: descriptionRaw.slice(0, LIMIT.DESCRIPTION),
      sizeIn: size,
      photoPaths: cleanPaths,
      estimateCents: kind === "barrel" ? price : null,
    });
  });
  return {pieces, errors, photoPaths};
}

/**
 * @param {object[]} pieces Stored pieces.
 * @return {{pieceCount: number, barrelPieces: number, packagePieces: number}}
 */
function pieceCounts(pieces) {
  const list = Array.isArray(pieces) ? pieces : [];
  const barrels = list.filter((p) => p?.kind === "barrel").length;
  return {pieceCount: list.length, barrelPieces: barrels,
    packagePieces: list.length - barrels};
}

/**
 * Validates a customer's submission against the business's offer.
 *
 * @param {object} input The callable's data.
 * @param {object} ctx {option (requestOption or null), businessId, uid,
 *   nowMs, business (doc or null)}.
 * @return {{precondition: string, errors: string[], record: ?object,
 *   photoPaths: string[]}} `precondition`: a failed-precondition code (the
 *   offer itself is not there), else `errors` (invalid-argument codes).
 */
function validateSubmission(input, ctx) {
  const data = input && typeof input === "object" ? input : {};
  const business = ctx.business;
  if (!business || text(business.status, 40) !== "approved") {
    return {precondition: "business_unavailable", errors: [], record: null,
      photoPaths: []};
  }
  if (!requestSettingsOf(business).acceptRequests) {
    return {precondition: "requests_off", errors: [], record: null,
      photoPaths: []};
  }
  const option = ctx.option;
  if (!option) {
    return {precondition: "destination_unavailable", errors: [],
      record: null, photoPaths: []};
  }
  const errors = [];
  const add = (code) => {
    if (!errors.includes(code)) errors.push(code);
  };
  const handoff = text(data.handoff, 20);
  if (!HANDOFFS.includes(handoff)) add("handoff_invalid");
  if (handoff === HANDOFF.BRING_IN && !option.bringIn.available) {
    return {precondition: "bring_in_unavailable", errors: [], record: null,
      photoPaths: []};
  }
  if (handoff === HANDOFF.COLLECT && !option.collect.available) {
    return {precondition: "collect_unavailable", errors: [], record: null,
      photoPaths: []};
  }
  const zone = option.timeZone;
  let location = null;
  let plannedDate = "";
  let pickup = null;
  if (handoff === HANDOFF.BRING_IN) {
    const spots = option.bringIn.locations;
    const wanted = text(data.locationId, 120);
    location = wanted ? spots.find((spot) => spot.id === wanted) :
      (spots.length === 1 ? spots[0] : null);
    if (!location) add("location_invalid");
    plannedDate = text(data.plannedDate, 10);
    if (!pickableDate(plannedDate, ctx.nowMs, zone)) {
      add("planned_date_invalid");
    } else if (location && location.hours[weekdayOf(plannedDate)]?.open !==
        true) {
      add("planned_day_closed");
    }
  } else if (handoff === HANDOFF.COLLECT) {
    const raw = data.pickup && typeof data.pickup === "object" ?
      data.pickup : {};
    const address = String(raw.address ?? "").trim();
    const note = String(raw.note ?? "").trim();
    if (!address) add("pickup_address_required");
    if (address.length > LIMIT.ADDRESS || note.length > LIMIT.NOTE) {
      add("text_too_long");
    }
    const date = text(raw.date, 10);
    if (!pickableDate(date, ctx.nowMs, zone)) add("pickup_date_invalid");
    const window = text(raw.window, 20);
    if (!PICKUP_WINDOWS.includes(window)) add("pickup_window_invalid");
    pickup = {address: address.slice(0, LIMIT.ADDRESS), date, window,
      note: note.slice(0, LIMIT.NOTE)};
  }
  const person = (raw, role) => {
    const value = raw && typeof raw === "object" ? raw : {};
    const name = String(value.name ?? "").trim();
    if (!name) add(`${role}_name_required`);
    if (name.length > LIMIT.NAME) add("text_too_long");
    const phone = e164(value.phoneE164);
    if (!phone) add(`${role}_phone_invalid`);
    return {name: name.slice(0, LIMIT.NAME), phoneE164: phone};
  };
  const sender = person(data.sender, "sender");
  const receiver = person(data.receiver, "receiver");
  const {pieces, errors: pieceErrors, photoPaths} = cleanPieces(data.pieces, {
    barrelPriceCents: option.barrelPriceCents,
    businessId: ctx.businessId,
    uid: ctx.uid,
  });
  pieceErrors.forEach(add);
  const language = text(data.language, 5);
  if (!LANGUAGES.includes(language)) add("language_invalid");
  const idempotencyKey = text(data.idempotencyKey, 80);
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) add("idempotency_key_invalid");
  if (errors.length > 0) {
    return {precondition: "", errors, record: null, photoPaths: []};
  }
  return {
    precondition: "",
    errors,
    photoPaths,
    record: {
      businessId: ctx.businessId,
      businessName: option.businessName,
      handoff,
      locationId: location ? location.id : "",
      location: location ?
        {id: location.id, label: location.label, address: location.address} :
        null,
      plannedDate,
      pickup,
      sender,
      receiver,
      destinationCountryId: option.country.id,
      destinationCountryName: option.country.name,
      pieces,
      ...pieceCounts(pieces),
      language,
      idempotencyKey,
      timeZone: zone,
    },
  };
}

// ---------------------------------------------------------------------------
// Estimates.
// ---------------------------------------------------------------------------

/**
 * The automatic first estimate: only when every piece already has a price
 * (all barrels with the business's barrel price).
 *
 * @param {object[]} pieces Stored pieces.
 * @param {number} nowMs Now.
 * @return {object|null} Version 1, or null when a piece needs an estimate.
 */
function automaticEstimate(pieces, nowMs) {
  const list = Array.isArray(pieces) ? pieces : [];
  if (list.length === 0 ||
      list.some((p) => !Number.isInteger(p.estimateCents))) {
    return null;
  }
  const rows = list.map((p) => ({id: p.id, cents: p.estimateCents}));
  return {
    version: 1,
    totalCents: rows.reduce((sum, row) => sum + row.cents, 0),
    pieces: rows,
    pickupFeeCents: 0,
    pickupSchedule: null,
    note: "",
    sentByUid: "",
    sentByName: "",
    sentAtMs: nowMs,
    auto: true,
  };
}

/**
 * @param {object} request A stored request.
 * @return {number} The current estimate version, 0 when none.
 */
function estimateVersion(request) {
  const version = Number(request?.estimate?.version || 0);
  return Number.isInteger(version) && version > 0 ? version : 0;
}

/**
 * Validates a staff estimate.
 *
 * @param {object} input {pieces: [{id, cents}], pickupFeeCents?,
 *   pickupSchedule?, note?}.
 * @param {object} request The stored request.
 * @param {number} nowMs Now.
 * @return {{estimate: ?object, errors: string[]}} The new version's
 *   body (without version/sentBy), or every problem.
 */
function cleanEstimateInput(input, request, nowMs) {
  const errors = [];
  const add = (code) => {
    if (!errors.includes(code)) errors.push(code);
  };
  const data = input && typeof input === "object" ? input : {};
  const ids = new Set((request.pieces || []).map((p) => p.id));
  const given = new Map();
  for (const row of Array.isArray(data.pieces) ? data.pieces : []) {
    const id = text(row?.id, 10);
    if (!ids.has(id)) {
      add("estimate_piece_unknown");
      continue;
    }
    if (!intIn(row?.cents, 0, LIMIT.PIECE_CENTS)) {
      add("amount_invalid");
      continue;
    }
    given.set(id, row.cents);
  }
  const rows = [];
  for (const piece of request.pieces || []) {
    if (!given.has(piece.id)) add("estimate_piece_missing");
    else rows.push({id: piece.id, cents: given.get(piece.id)});
  }
  const collect = request.handoff === HANDOFF.COLLECT;
  let pickupFeeCents = 0;
  if (data.pickupFeeCents !== undefined && data.pickupFeeCents !== null) {
    if (!collect || !intIn(data.pickupFeeCents, 0, LIMIT.PIECE_CENTS)) {
      add("pickup_fee_invalid");
    } else {
      pickupFeeCents = data.pickupFeeCents;
    }
  }
  let pickupSchedule = null;
  if (data.pickupSchedule !== undefined && data.pickupSchedule !== null) {
    const date = text(data.pickupSchedule?.date, 10);
    const window = text(data.pickupSchedule?.window, 20);
    if (!collect || !pickableDate(date, nowMs, request.timeZone) ||
        !PICKUP_WINDOWS.includes(window)) {
      add("pickup_schedule_invalid");
    } else {
      pickupSchedule = {date, window};
    }
  }
  const note = String(data.note ?? "").trim();
  if (note.length > LIMIT.NOTE) add("text_too_long");
  if (errors.length > 0) return {estimate: null, errors};
  return {
    errors,
    estimate: {
      totalCents: rows.reduce((sum, row) => sum + row.cents, 0) +
        pickupFeeCents,
      pieces: rows,
      pickupFeeCents,
      pickupSchedule,
      note,
    },
  };
}

/**
 * Whether the caller may send a new estimate now.
 *
 * @param {object} request The stored request (read in the transaction).
 * @param {object} args {uid, nowMs, baseVersion}.
 * @return {object|null} A refusal {code, details}, or null.
 */
function estimateSendRefusal(request, {uid, nowMs, baseVersion}) {
  if (!isOpenStatus(request.status)) {
    return {code: "request_closed", details: {status: request.status}};
  }
  if (isCardPaid(request)) return {code: "card_order", details: {}};
  const lock = lockState(request, nowMs);
  if (lock.live && lock.uid !== uid) {
    return {code: "estimate_locked",
      details: {lockedByName: lock.name, untilMs: lock.untilMs}};
  }
  const current = estimateVersion(request);
  if (!Number.isInteger(baseVersion) || baseVersion !== current) {
    return {code: "estimate_stale", details: {currentVersion: current}};
  }
  return null;
}

/**
 * The status a new estimate version leaves the request in.
 *
 * @param {object} request The stored request.
 * @param {number} totalCents The new total.
 * @return {{status: string, reconfirmRequired: boolean,
 *   priceDropped: boolean}}
 */
function statusAfterEstimate(request, totalCents) {
  if (request.status === STATUS.CONFIRMED) {
    const confirmed = Number(request.confirmedTotalCents);
    if (Number.isFinite(confirmed) && totalCents <= confirmed) {
      return {status: STATUS.CONFIRMED, reconfirmRequired: false,
        priceDropped: true};
    }
    return {status: STATUS.ESTIMATE_SENT, reconfirmRequired: true,
      priceDropped: false};
  }
  return {status: STATUS.ESTIMATE_SENT, reconfirmRequired: false,
    priceDropped: false};
}

// ---------------------------------------------------------------------------
// The estimate lock: one person at a time, 15 minutes of idleness.
// ---------------------------------------------------------------------------

/**
 * @param {object} request A stored request.
 * @param {number} nowMs Now.
 * @return {{live: boolean, uid: string, name: string, untilMs: number}}
 */
function lockState(request, nowMs) {
  const lock = request?.lock && typeof request.lock === "object" ?
    request.lock : null;
  const untilMs = Number(lock?.untilMs || 0);
  return {
    live: Boolean(lock) && untilMs > nowMs && Boolean(text(lock.uid, 128)),
    uid: text(lock?.uid, 128),
    name: text(lock?.name, 120),
    untilMs,
  };
}

/**
 * What asking for the lock does.
 *
 * @param {object} request The stored request.
 * @param {object} args {uid, nowMs}.
 * @return {{action: string, lock: ?object, previous: object}} take,
 *   extend, takeover, locked, closed or card. `takeover`: someone else's lock
 *   ran out and is taken (History says so).
 */
function lockDecision(request, {uid, nowMs}) {
  const previous = lockState(request, nowMs);
  if (!isOpenStatus(request.status)) {
    return {action: "closed", lock: null, previous};
  }
  if (isCardPaid(request)) return {action: "card", lock: null, previous};
  if (previous.live && previous.uid !== uid) {
    return {action: "locked", lock: null, previous};
  }
  const action = previous.live ? "extend" :
    (previous.uid && previous.uid !== uid ? "takeover" : "take");
  return {action, lock: {uid, untilMs: nowMs + TIMER.LOCK_MS}, previous};
}

// ---------------------------------------------------------------------------
// Confirming, declining, cancelling.
// ---------------------------------------------------------------------------

/**
 * What confirming the version the customer saw does.
 *
 * @param {object} request The stored request.
 * @param {*} version The version the page showed.
 * @return {{action: string, code: string, details: object}} confirm,
 *   already or refuse.
 */
function confirmDecision(request, version) {
  const status = text(request.status, 40);
  if (status === STATUS.CONFIRMED) return {action: "already"};
  if (!isOpenStatus(status)) {
    return {action: "refuse", code: "request_closed", details: {status}};
  }
  const current = estimateVersion(request);
  if (status === STATUS.NEW || current === 0) {
    return {action: "refuse", code: "estimate_missing", details: {}};
  }
  if (!Number.isInteger(version) || version !== current) {
    return {action: "refuse", code: "estimate_changed",
      details: {currentVersion: current}};
  }
  return {action: "confirm"};
}

/**
 * The customer's "No thanks".
 *
 * @param {object} request The stored request.
 * @return {{action: string, code: string, details: object}} decline,
 *   already or refuse.
 */
function customerDeclineDecision(request) {
  const status = text(request.status, 40);
  if (status === STATUS.CUSTOMER_DECLINED) return {action: "already"};
  if (!isOpenStatus(status)) {
    return {action: "refuse", code: "request_closed", details: {status}};
  }
  if (isCardPaid(request)) {
    return {action: "refuse", code: "card_order", details: {}};
  }
  return {action: "decline"};
}

/**
 * Staff decline (new / estimate_sent) or cancel (any open status).
 *
 * @param {object} request The stored request.
 * @param {"decline"|"cancel"} kind Which.
 * @return {object|null} A refusal {code, details}, or null.
 */
function staffCloseRefusal(request, kind) {
  const status = text(request.status, 40);
  const allowed = kind === "decline" ?
    [STATUS.NEW, STATUS.ESTIMATE_SENT] : OPEN_STATUSES;
  if (!allowed.includes(status)) {
    return {code: "request_closed", details: {status}};
  }
  if (isCardPaid(request)) return {code: "card_order", details: {}};
  return null;
}

/**
 * @param {*} raw A typed reason.
 * @return {{reason: string, error: string}} The reason, or why not.
 */
function cleanReason(raw) {
  const reason = String(raw ?? "").trim();
  if (!reason) return {reason: "", error: "reason_required"};
  if (reason.length > LIMIT.REASON) return {reason: "", error: "text_too_long"};
  return {reason, error: ""};
}

// ---------------------------------------------------------------------------
// History.
// ---------------------------------------------------------------------------

/**
 * @param {object[]} history The stored history.
 * @param {object} entry {atMs, action, byUid, byName, ...}.
 * @return {object[]} With the entry appended, the oldest dropped past 100.
 */
function appendHistory(history, entry) {
  const list = Array.isArray(history) ? history : [];
  const clean = {
    atMs: Number(entry.atMs) || 0,
    action: text(entry.action, 40),
    byUid: text(entry.byUid, 128),
    byName: text(entry.byName, 120),
  };
  for (const key of ["version", "totalCents", "piecesAdded",
    "piecesRemoved"]) {
    if (Number.isInteger(entry[key])) clean[key] = entry[key];
  }
  if (entry.reason) clean.reason = text(entry.reason, LIMIT.REASON);
  return [...list, clean].slice(-LIMIT.HISTORY);
}

// ---------------------------------------------------------------------------
// Timers. Every write recomputes `nextAction`/`nextActionAt`; the hourly
// sweep reads what is due.
// ---------------------------------------------------------------------------

/**
 * @param {*} value A Timestamp, Date, ms or ISO string.
 * @return {number} Epoch ms, 0 when none.
 */
function toMillis(value) {
  if (!value) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "object" && typeof value.seconds === "number") {
    return value.seconds * 1000;
  }
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * @param {object} request A stored request.
 * @param {string} field "createdAt", "confirmedAt", ...
 * @return {number} The instant, from `<field>Ms` (written with every
 *   server timestamp so pure code can read it before the write lands) or
 *   the Timestamp itself.
 */
function msOf(request, field) {
  return toMillis(request?.[`${field}Ms`]) || toMillis(request?.[field]);
}

/**
 * When an open request expires.
 *
 * @param {object} request A stored request (createdAtMs, estimate.sentAtMs,
 *   confirmedAtMs as numbers or Timestamps).
 * @return {number} Epoch ms, 0 for never (card-paid, closed).
 */
function expiryMs(request) {
  const status = text(request.status, 40);
  const zone = request.timeZone;
  if (status === STATUS.NEW) {
    return msOf(request, "createdAt") + TIMER.NEW_EXPIRY_MS;
  }
  if (status === STATUS.ESTIMATE_SENT) {
    const sent = toMillis(request.estimate?.sentAtMs ||
      request.estimate?.sentAt);
    return sent ? sent + TIMER.ESTIMATE_EXPIRY_MS : 0;
  }
  if (status === STATUS.CONFIRMED) {
    if (isCardPaid(request)) return 0;
    const confirmed = msOf(request, "confirmedAt");
    const day = request.handoff === HANDOFF.COLLECT ?
      text(request.pickup?.date, 10) : text(request.plannedDate, 10);
    const dayMs = dateKeyValid(day) ?
      startOfDayMs(addDays(day, TIMER.CONFIRMED_EXPIRY_DAYS + 1), zone) : 0;
    const confirmedEnd = confirmed ?
      confirmed + TIMER.CONFIRMED_EXPIRY_DAYS * DAY_MS : 0;
    return Math.max(dayMs, confirmedEnd);
  }
  return 0;
}

/**
 * The next thing the sweep must do for a request, and when.
 *
 * @param {object} request A stored request (as it will be written).
 * @param {object} [extra] {lineArrivedAtMs} for a received request whose
 *   line is ready for pickup.
 * @return {{action: string, atMs: number}|null} null: nothing, ever.
 */
function nextTimer(request, extra = {}) {
  const status = text(request.status, 40);
  const reminders = request.reminders || {};
  const candidates = [];
  const expires = expiryMs(request);
  if (expires) candidates.push({action: ACTION.EXPIRE, atMs: expires});
  if (status === STATUS.NEW && !reminders.staffAlert3dAt) {
    candidates.push({action: ACTION.STAFF_ALERT,
      atMs: msOf(request, "createdAt") + TIMER.NEW_ALERT_MS});
  }
  if (status === STATUS.ESTIMATE_SENT && !reminders.estimate24hAt) {
    const sent = toMillis(request.estimate?.sentAtMs ||
      request.estimate?.sentAt);
    if (sent) {
      candidates.push({action: ACTION.ESTIMATE_REMINDER,
        atMs: sent + TIMER.ESTIMATE_REMINDER_MS});
    }
  }
  if (status === STATUS.CONFIRMED && request.handoff === HANDOFF.BRING_IN &&
      !reminders.dropoff3dAt && !isCardPaid(request) &&
      dateKeyValid(text(request.plannedDate, 10))) {
    // Three days after the planned day: the morning of plannedDate + 3, in
    // the business's zone (9 AM so nobody is woken).
    const day = addDays(request.plannedDate, TIMER.DROPOFF_REMINDER_DAYS);
    candidates.push({action: ACTION.DROPOFF_REMINDER,
      atMs: startOfDayMs(day, request.timeZone) + 9 * 60 * 60 * 1000});
  }
  const hasPhotos = (request.pieces || [])
      .some((p) => Array.isArray(p.photoPaths) && p.photoPaths.length > 0);
  if (hasPhotos && !request.photosDeletedAt) {
    if (status === STATUS.RECEIVED) {
      candidates.push(extra.lineArrivedAtMs ?
        {action: ACTION.DELETE_PHOTOS,
          atMs: extra.lineArrivedAtMs + TIMER.PHOTO_RETENTION_MS} :
        {action: ACTION.CHECK_PHOTOS,
          atMs: Math.max(msOf(request, "receivedAt"),
              toMillis(extra.checkedAtMs)) + TIMER.PHOTO_RECHECK_MS});
    } else if (!isOpenStatus(status)) {
      const closed = msOf(request, "closedAt");
      candidates.push({action: ACTION.DELETE_PHOTOS,
        atMs: (closed || 0) + TIMER.PHOTO_RETENTION_MS});
    }
  }
  if (candidates.length === 0) return null;
  // Reminders before expiry when both fall due: sorting by time, ties to the
  // non-expiry action.
  candidates.sort((a, b) => a.atMs - b.atMs ||
    (a.action === ACTION.EXPIRE ? 1 : 0) -
      (b.action === ACTION.EXPIRE ? 1 : 0));
  return candidates[0];
}

// ---------------------------------------------------------------------------
// Words: pieces, money, hours - for WhatsApp (both languages) and History.
// ---------------------------------------------------------------------------

const KIND_WORDS = Object.freeze({
  en: {barrel: ["barrel", "barrels"], box: ["box", "boxes"],
    other: ["item", "items"]},
  fr: {barrel: ["fût", "fûts"], box: ["carton", "cartons"],
    other: ["colis", "colis"]},
});

/**
 * @param {object[]} pieces Stored pieces.
 * @param {"en"|"fr"} language The language.
 * @return {string} e.g. "2 barrels, 1 box, 1 item" / "2 fûts, 1 carton,
 *   1 colis".
 */
function describePieces(pieces, language) {
  const words = KIND_WORDS[language === "fr" ? "fr" : "en"];
  const counts = {barrel: 0, box: 0, other: 0};
  for (const piece of Array.isArray(pieces) ? pieces : []) {
    if (counts[piece?.kind] !== undefined) counts[piece.kind] += 1;
  }
  return PIECE_KINDS.filter((kind) => counts[kind] > 0)
      .map((kind) => `${counts[kind]} ${words[kind][counts[kind] === 1 ? 0 :
        1]}`)
      .join(", ");
}

/**
 * @param {number} cents Money.
 * @param {"en"|"fr"} language The language.
 * @return {string} "$1,250.00" / "1 250,00 $".
 */
function moneyText(cents, language) {
  const value = Math.max(0, Number(cents) || 0) / 100;
  const [whole, part] = value.toFixed(2).split(".");
  if (language === "fr") {
    return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${part} $`;
  }
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${part}`;
}

const DAY_WORDS = Object.freeze({
  en: {mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri",
    sat: "Sat", sun: "Sun"},
  fr: {mon: "lun.", tue: "mar.", wed: "mer.", thu: "jeu.", fri: "ven.",
    sat: "sam.", sun: "dim."},
});

/**
 * @param {string} hhmm "14:30".
 * @param {"en"|"fr"} language The language.
 * @return {string} "2:30 PM" / "14 h 30".
 */
function clockText(hhmm, language) {
  const [h, m] = hhmm.split(":").map(Number);
  if (language === "fr") return `${h} h ${String(m).padStart(2, "0")}`;
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/**
 * A week of hours in one line, consecutive days with the same hours joined.
 *
 * @param {object} week {mon..sun: {open, from, to}}.
 * @param {"en"|"fr"} language The language.
 * @return {string} "Mon–Fri 9:00 AM–6:00 PM, Sat 10:00 AM–2:00 PM".
 */
function hoursText(week, language) {
  const lang = language === "fr" ? "fr" : "en";
  if (!weekHasHours(week)) {
    return lang === "fr" ? "sur rendez-vous" : "by appointment";
  }
  const groups = [];
  for (const day of WEEK_DAYS) {
    const value = week[day];
    if (!value?.open) continue;
    const key = `${value.from}-${value.to}`;
    const last = groups[groups.length - 1];
    const previousDay = WEEK_DAYS[WEEK_DAYS.indexOf(day) - 1];
    if (last && last.key === key && last.days[last.days.length - 1] ===
        previousDay) {
      last.days.push(day);
    } else {
      groups.push({key, days: [day], from: value.from, to: value.to});
    }
  }
  return groups.map((group) => {
    const first = DAY_WORDS[lang][group.days[0]];
    const last = DAY_WORDS[lang][group.days[group.days.length - 1]];
    const days = group.days.length === 1 ? first : `${first}–${last}`;
    return `${days} ${clockText(group.from, lang)}–${clockText(group.to,
        lang)}`;
  }).join(", ");
}

/**
 * The values a request message fills (whatsapp_templates.js REQUEST_*).
 *
 * @param {object} request The stored request.
 * @param {object} args {destinationFr, hours (week or null)}.
 * @return {object} By request VARIABLE name.
 */
function requestMessageValues(request, args = {}) {
  const total = Number(request.estimate?.totalCents);
  const hours = args.hours || request.location?.hours || null;
  return {
    name: text(request.sender?.name, 60),
    business: text(request.businessName, 80),
    totalEn: Number.isFinite(total) ? moneyText(total, "en") : "",
    totalFr: Number.isFinite(total) ? moneyText(total, "fr") : "",
    piecesEn: describePieces(request.pieces, "en"),
    piecesFr: describePieces(request.pieces, "fr"),
    destinationEn: text(request.destinationCountryName, 80),
    destinationFr: text(args.destinationFr || request.destinationCountryName,
        80),
    hoursEn: hours ? hoursText(hours, "en") : "",
    hoursFr: hours ? hoursText(hours, "fr") : "",
    requestCode: text(request.code, 20),
    token: text(request.token, 80),
  };
}

// ---------------------------------------------------------------------------
// What the customer's /e/ page may see.
// ---------------------------------------------------------------------------

const iso = (value) => {
  const ms = toMillis(value);
  return ms ? new Date(ms).toISOString() : "";
};

/**
 * The customer's view of a request (the token is the capability): no phone
 * numbers, no photos, no staff names, no lock.
 *
 * @param {string} id The request id.
 * @param {object} request The stored request.
 * @param {object} business The business document (or {}).
 * @param {object} [extra] {hours} the drop-off location's current hours.
 * @return {object} The PublicRequest of §8.5.
 */
function publicRequestView(id, request, business = {}, extra = {}) {
  const estimate = request.estimate && typeof request.estimate === "object" ?
    request.estimate : null;
  return {
    id,
    code: text(request.code, 20),
    status: text(request.status, 40),
    handoff: text(request.handoff, 20),
    language: text(request.language, 5) || "en",
    business: {
      id: text(request.businessId, 128),
      name: text(business.name || request.businessName, 120),
      phone: text(business.phone, 40),
    },
    destination: {id: text(request.destinationCountryId, 60),
      name: text(request.destinationCountryName, 120)},
    location: request.location ? {
      id: text(request.location.id, 120),
      label: text(request.location.label, 120),
      address: text(request.location.address, 300),
      hours: extra.hours || null,
    } : null,
    plannedDate: text(request.plannedDate, 10),
    pickup: request.pickup ? {
      address: text(request.pickup.address, LIMIT.ADDRESS),
      date: text(request.pickup.date, 10),
      window: text(request.pickup.window, 20),
      note: text(request.pickup.note, LIMIT.NOTE),
    } : null,
    sender: {name: text(request.sender?.name, LIMIT.NAME)},
    receiver: {name: text(request.receiver?.name, LIMIT.NAME)},
    pieces: (request.pieces || []).map((p) => ({
      id: text(p.id, 10),
      kind: text(p.kind, 20),
      description: text(p.description, LIMIT.DESCRIPTION),
      sizeIn: p.sizeIn || null,
      photoCount: Array.isArray(p.photoPaths) ? p.photoPaths.length : 0,
    })),
    estimate: estimate ? {
      version: estimateVersion(request),
      totalCents: Number(estimate.totalCents) || 0,
      pieces: (estimate.pieces || []).map((row) => ({id: text(row.id, 10),
        cents: Number(row.cents) || 0})),
      pickupFeeCents: Number(estimate.pickupFeeCents) || 0,
      pickupSchedule: estimate.pickupSchedule || null,
      note: text(estimate.note, LIMIT.NOTE),
      sentAt: iso(estimate.sentAtMs || estimate.sentAt),
    } : null,
    confirmedVersion: Number.isInteger(request.confirmedVersion) ?
      request.confirmedVersion : null,
    confirmedAt: iso(request.confirmedAtMs || request.confirmedAt),
    confirmedVia: text(request.confirmedVia, 20),
    priceDropped: request.priceDropped === true,
    declineReason: text(request.declineReason, LIMIT.REASON),
    expiresAt: iso(request.expiresAtMs || request.expiresAt),
    payment: {
      timing: text(request.payment?.timing, 20) || "at_handoff",
      paidCents: Number(request.payment?.paidCents) || 0,
    },
    trackingCode: text(request.trackingCode, 40),
    receivedAt: iso(request.receivedAtMs || request.receivedAt),
    timeZone: businessTimeZone(request.timeZone),
  };
}

// ---------------------------------------------------------------------------
// Card barrel orders (§8.10).
// ---------------------------------------------------------------------------

/**
 * Whether a barrel shipment's update ends its card request.
 *
 * @param {object} shipment The barrelShipments document after the write.
 * @return {boolean} Cancelled or refunded.
 */
function shipmentEndsCardRequest(shipment) {
  const ended = ["cancelled", "canceled", "refunded"];
  return ended.includes(text(shipment?.status, 40)) ||
    ended.includes(text(shipment?.paymentStatus, 40));
}

/**
 * The confirmed request a paid card barrel shipment becomes.
 *
 * @param {object} shipment The barrelShipments document.
 * @param {object} args {shipmentId, businessName, nowMs, timeZone}.
 * @return {object} The request body (without code/token/timestamps).
 */
function cardRequestFromShipment(shipment, args) {
  const quantity = Math.max(1, Math.min(LIMIT.PIECES,
      Math.trunc(Number(shipment.quantity) || 1)));
  const unitFromFee = Math.round(Number(shipment.unitShippingFee || 0) * 100);
  const lineCents = Math.round(Number(shipment.shippingFee || 0) * 100);
  const unitCents = unitFromFee > 0 ? unitFromFee :
    (lineCents > 0 ? Math.round(lineCents / quantity) : 0);
  const chargedCents = Number.isInteger(shipment.cardChargeAmountCents) ?
    shipment.cardChargeAmountCents :
    Math.round(Number(shipment.price || 0) * 100);
  const pieces = Array.from({length: quantity}, (_, i) => ({
    id: `p${i + 1}`, kind: "barrel", description: "", sizeIn: null,
    photoPaths: [], estimateCents: unitCents,
  }));
  const collect = shipment.pickupRequested === true;
  const barrelsCents = unitCents * quantity;
  const pickupFeeCents = collect ? Math.max(0, chargedCents - barrelsCents) :
    0;
  const totalCents = barrelsCents + pickupFeeCents;
  const pickupMs = toMillis(shipment.pickupDateTime);
  const estimate = {
    version: 1,
    totalCents,
    pieces: pieces.map((p) => ({id: p.id, cents: unitCents})),
    pickupFeeCents,
    pickupSchedule: null,
    note: "",
    sentByUid: "",
    sentByName: "",
    sentAtMs: args.nowMs,
    auto: true,
  };
  return {
    businessId: text(shipment.businessId, 128),
    businessName: text(args.businessName || shipment.businessName, 120),
    handoff: collect ? HANDOFF.COLLECT : HANDOFF.BRING_IN,
    locationId: text(shipment.officeLocationId, 120),
    location: collect ? null : {
      id: text(shipment.officeLocationId, 120),
      label: text(shipment.officeLocationLabel, 120),
      address: text(shipment.pickupAddress, 300),
    },
    plannedDate: "",
    pickup: collect ? {
      address: text(shipment.pickupAddress, LIMIT.ADDRESS),
      date: pickupMs ? dateKeyIn(pickupMs, args.timeZone) : "",
      window: "",
      note: "",
    } : null,
    sender: {
      name: text(shipment.senderName || shipment.customerName, LIMIT.NAME),
      phoneE164: e164(shipment.customerPhone),
      ...(text(shipment.customerUid, 128) && shipment.isGuest !== true ?
        {uid: text(shipment.customerUid, 128)} : {}),
    },
    receiver: {name: text(shipment.receiverName, LIMIT.NAME),
      phoneE164: e164(shipment.receiverPhone)},
    submittedByUid: text(shipment.customerUid, 128),
    destinationCountryId: text(shipment.destinationCountryId, 60),
    destinationCountryName: text(shipment.destinationCountryName, 120),
    pieces,
    ...pieceCounts(pieces),
    status: STATUS.CONFIRMED,
    estimate,
    estimateHistory: [estimate],
    confirmedVersion: 1,
    confirmedTotalCents: totalCents,
    confirmedVia: CONFIRMED_VIA.CARD,
    priceDropped: false,
    lock: null,
    reminders: {},
    lineId: "",
    trackingCode: "",
    payment: {timing: "card",
      paidCents: chargedCents > 0 ? chargedCents : totalCents},
    cardOrder: {orderId: text(shipment.orderId, 128),
      shipmentId: text(args.shipmentId, 128)},
    language: "en",
    idempotencyKey: "",
    declineReason: "",
    whatsapp: null,
    whatsappUnreachable: false,
    timeZone: businessTimeZone(args.timeZone),
  };
}

// ---------------------------------------------------------------------------
// Staff notifications (§8.7).
// ---------------------------------------------------------------------------

/**
 * The bell + push for one event, in the reader's language.
 *
 * @param {string} event new | confirmed | customer_declined | stale_new |
 *   card_paid.
 * @param {object} request The stored request.
 * @param {"en"|"fr"} language The reader's language.
 * @return {{title: string, body: string}}
 */
function requestNotificationText(event, request, language) {
  const fr = language === "fr";
  const who = text(request.sender?.name, 60) || (fr ? "Un client" :
    "A customer");
  const what = describePieces(request.pieces, fr ? "fr" : "en");
  const code = text(request.code, 20);
  const tail = [what, code].filter(Boolean).join(" · ");
  switch (event) {
    case "confirmed":
      return {title: fr ? "Estimation acceptée" : "Estimate confirmed",
        body: `${who} · ${tail}`};
    case "customer_declined":
      return {title: fr ? "Estimation refusée" : "Estimate declined",
        body: `${who} · ${tail}`};
    case "stale_new":
      return {title: fr ? "Demande sans estimation depuis 3 jours" :
        "Request waiting 3 days for an estimate", body: `${who} · ${tail}`};
    case "card_paid":
      return {title: fr ? "Fûts payés en ligne" : "Barrels paid online",
        body: `${who} · ${tail}`};
    default:
      return {title: fr ? "Nouvelle demande d'envoi" : "New package request",
        body: `${who} · ${tail}`};
  }
}

module.exports = {
  STATUS,
  STATUSES,
  OPEN_STATUSES,
  HANDOFF,
  HANDOFFS,
  PIECE_KINDS,
  PICKUP_WINDOWS,
  WEEK_DAYS,
  CONFIRMED_VIA,
  DEFAULT_TIME_ZONE,
  LIMIT,
  TIMER,
  ACTION,
  PHOTO_ROOT,
  PHOTO_CONTENT_TYPES,
  PHOTO_MAX_BYTES,
  REQUEST_MESSAGES,
  e164,
  isOpenStatus,
  isCardPaid,
  businessTimeZone,
  dateKeyIn,
  dateKeyValid,
  addDays,
  weekdayOf,
  startOfDayMs,
  pickableDate,
  slugFromName,
  slugValid,
  slugCandidate,
  cleanWeek,
  weekHasHours,
  validateRequestSettings,
  requestSettingsOf,
  bringInLocations,
  requestOption,
  photoPathValid,
  photoMetadataValid,
  cleanSize,
  cleanPieces,
  pieceCounts,
  validateSubmission,
  automaticEstimate,
  estimateVersion,
  cleanEstimateInput,
  estimateSendRefusal,
  statusAfterEstimate,
  lockState,
  lockDecision,
  confirmDecision,
  customerDeclineDecision,
  staffCloseRefusal,
  cleanReason,
  appendHistory,
  toMillis,
  msOf,
  expiryMs,
  nextTimer,
  describePieces,
  moneyText,
  hoursText,
  requestMessageValues,
  publicRequestView,
  shipmentEndsCardRequest,
  cardRequestFromShipment,
  requestNotificationText,
};
