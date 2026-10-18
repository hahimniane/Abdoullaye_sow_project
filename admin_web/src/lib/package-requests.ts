/**
 * Customer package requests on the web (docs/PACKAGE_REQUESTS.md §8): the
 * customer's request form, the /e/<token> estimate page and the business
 * console's Requests view all read their rules from here.
 *
 * Pure: no Firebase, no React. The server (functions/package_requests.js)
 * is the authority; what is here mirrors it so a form can say what is wrong
 * before sending, and so every screen words a request the same way.
 *
 * Copy: static English strings are rendered as they are and translated by
 * french-dom.ts. Values built from data (dates, money, hours, counts) are
 * produced here in the page's language and rendered `data-no-translate`.
 */

import { destinationCountryOptionForRow } from "./destination-countries.ts";

export type Lang = "en" | "fr";
export type PieceKind = "barrel" | "box" | "other";
export type Handoff = "bring_in" | "collect";
export type PickupWindow = "morning" | "afternoon" | "evening";
export type WeekDay = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type DayHours = { open: boolean; from: string; to: string };
export type WeekHours = Record<WeekDay, DayHours>;

export type RequestStatus =
  | "new"
  | "estimate_sent"
  | "confirmed"
  | "received"
  | "declined"
  | "customer_declined"
  | "cancelled"
  | "expired";

export const WEEK_DAYS: readonly WeekDay[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const PIECE_KINDS: readonly PieceKind[] = ["barrel", "box", "other"];
export const PICKUP_WINDOWS: readonly PickupWindow[] = ["morning", "afternoon", "evening"];
export const OPEN_REQUEST_STATUSES: readonly RequestStatus[] = ["new", "estimate_sent", "confirmed"];

export const REQUEST_LIMITS = {
  pieces: 20,
  photosPerPiece: 5,
  name: 80,
  description: 120,
  address: 200,
  note: 300,
  areas: 300,
  reason: 300,
  plannedDaysAhead: 60,
  // The rule refuses 2 MB; the form aims well under it.
  photoTargetBytes: 1.5 * 1024 * 1024,
  photoMaxSide: 1600,
} as const;

export const LOCK_MS = 15 * 60 * 1000;
export const LOCK_HEARTBEAT_MS = 5 * 60 * 1000;
export const REQUEST_LINK_BASE = "https://laawoldigital.com/r/";
export const DEFAULT_TIME_ZONE = "America/New_York";

export type RequestLocation = { id: string; label: string; address: string; hours: WeekHours | null };

export type RequestOption = {
  businessId: string;
  businessName: string;
  businessPhone: string;
  profileImageUrl: string;
  slug: string;
  country: { id: string; name: string };
  barrelPriceCents: number | null;
  cardBarrelBooking: boolean;
  bringIn: { available: boolean; locations: RequestLocation[] };
  collect: { available: boolean; areas: string };
  timeZone: string;
};

export type RequestBusinessHeader = {
  businessId: string;
  name: string;
  phone: string;
  profileImageUrl: string;
  slug: string;
  acceptRequests: boolean;
};

export type PublicRequest = {
  id: string;
  code: string;
  status: RequestStatus;
  handoff: Handoff;
  language: Lang;
  business: { id: string; name: string; phone: string };
  destination: { id: string; name: string };
  location: RequestLocation | null;
  plannedDate: string;
  pickup: { address: string; date: string; window: string; note: string } | null;
  sender: { name: string };
  receiver: { name: string };
  pieces: { id: string; kind: PieceKind; description: string; sizeIn: unknown; photoCount: number }[];
  estimate: {
    version: number;
    totalCents: number;
    pieces: { id: string; cents: number }[];
    pickupFeeCents: number;
    pickupSchedule: { date: string; window: string } | null;
    note: string;
    sentAt: string;
  } | null;
  confirmedVersion: number | null;
  confirmedAt: string;
  confirmedVia: string;
  priceDropped: boolean;
  declineReason: string;
  expiresAt: string;
  payment: { timing: string; paidCents: number };
  trackingCode: string;
  receivedAt: string;
  timeZone: string;
};

type Row = Record<string, unknown>;

function asRow(value: unknown): Row {
  return value && typeof value === "object" ? (value as Row) : {};
}

function text(value: unknown, max = 200): string {
  return String(value ?? "").trim().slice(0, max);
}

const E164 = /^\+[1-9]\d{7,14}$/;

/** A phone as the server stores it (formatting dropped), or "" when it is not E.164. */
export function e164(value: unknown): string {
  const compact = text(value, 40).replace(/[\s().-]/g, "");
  return E164.test(compact) ? compact : "";
}

// ---------------------------------------------------------------------------
// Links.
// ---------------------------------------------------------------------------

const SLUG_PATH = /^\/r\/([a-z0-9-]{3,40})\/?$/i;
const TOKEN_PATH = /^\/e\/([A-Za-z0-9_-]{43})\/?$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** The slug of `/r/<slug>` (or `?r=`), lower-cased, or "". */
export function requestSlugFromLocation(pathname: string, search: string): string {
  const match = SLUG_PATH.exec(String(pathname ?? ""));
  if (match) return match[1].toLowerCase();
  const param = new URLSearchParams(search).get("r") ?? "";
  return /^[a-z0-9-]{3,40}$/i.test(param) ? param.toLowerCase() : "";
}

/** The token of `/e/<token>` (or `?t=`), or "". */
export function estimateTokenFromLocation(pathname: string, search: string): string {
  const match = TOKEN_PATH.exec(String(pathname ?? ""));
  if (match) return match[1];
  const param = new URLSearchParams(search).get("t") ?? "";
  return TOKEN.test(param) ? param : "";
}

/**
 * `/r/<slug>` and `/e/<token>` in their query form, for a host that serves
 * the not-found page on unknown paths; "" for any other path.
 */
export function requestPathRedirect(pathname: string): string {
  const slug = SLUG_PATH.exec(String(pathname ?? ""));
  if (slug) return `/?service=package-request&r=${slug[1].toLowerCase()}`;
  const token = TOKEN_PATH.exec(String(pathname ?? ""));
  if (token) return `/?service=package-estimate&t=${token[1]}`;
  return "";
}

export function requestLink(slug: string): string {
  return `${REQUEST_LINK_BASE}${text(slug, 40)}`;
}

// ---------------------------------------------------------------------------
// Dates, in the business's zone; shown US month-first in English.
// ---------------------------------------------------------------------------

/** Today's date in a zone, "YYYY-MM-DD". */
export function todayKeyIn(zone: string, nowMs = Date.now()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: zone || DEFAULT_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(nowMs));
  } catch {
    return new Date(nowMs).toISOString().slice(0, 10);
  }
}

export function dateKeyValid(key: unknown): key is string {
  if (typeof key !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

export function addDaysToKey(key: string, days: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function weekdayOfKey(key: string): WeekDay {
  const [y, m, d] = key.split("-").map(Number);
  return WEEK_DAYS[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7];
}

/** "Sat, Oct 24" / "sam. 24 oct." - a planned day as people read it. */
export function plannedDayText(key: string, lang: Lang): string {
  if (!dateKeyValid(key)) return "";
  const [y, m, d] = key.split("-").map(Number);
  return new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

/** The days a customer may plan or ask for: today .. +60 in the business's zone. */
export function pickableDays(zone: string, nowMs = Date.now()): { min: string; max: string } {
  const min = todayKeyIn(zone, nowMs);
  return { min, max: addDaysToKey(min, REQUEST_LIMITS.plannedDaysAhead) };
}

// ---------------------------------------------------------------------------
// Opening hours.
// ---------------------------------------------------------------------------

export function emptyWeek(): WeekHours {
  return Object.fromEntries(WEEK_DAYS.map((day) => [day, { open: false, from: "09:00", to: "18:00" }])) as WeekHours;
}

/** A stored week read defensively (every day present). */
export function weekFrom(raw: unknown): WeekHours {
  const row = asRow(raw);
  const week = emptyWeek();
  for (const day of WEEK_DAYS) {
    const value = asRow(row[day]);
    week[day] = {
      open: value.open === true,
      from: /^\d{2}:\d{2}$/.test(text(value.from, 5)) ? text(value.from, 5) : "09:00",
      to: /^\d{2}:\d{2}$/.test(text(value.to, 5)) ? text(value.to, 5) : "18:00",
    };
  }
  return week;
}

export function weekHasHours(week: WeekHours | null | undefined): boolean {
  return Boolean(week) && WEEK_DAYS.some((day) => week?.[day]?.open === true);
}

/** The first problem of a week, as the server's code, or "". */
export function weekProblem(week: WeekHours): string {
  for (const day of WEEK_DAYS) {
    const value = week[day];
    if (!value.open) continue;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.from) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.to) || value.from >= value.to) {
      return "hours_invalid";
    }
  }
  return "";
}

const DAY_WORDS: Record<Lang, Record<WeekDay, string>> = {
  en: { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" },
  fr: { mon: "lun.", tue: "mar.", wed: "mer.", thu: "jeu.", fri: "ven.", sat: "sam.", sun: "dim." },
};

/** "2:30 PM" / "14 h 30". */
export function clockText(hhmm: string, lang: Lang): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm;
  if (lang === "fr") return `${h} h ${String(m).padStart(2, "0")}`;
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** One line per run of days with the same hours: ["Mon–Fri 9:00 AM–6:00 PM", "Sat 10:00 AM–2:00 PM"]. */
export function hoursLines(week: WeekHours | null | undefined, lang: Lang): string[] {
  if (!week || !weekHasHours(week)) return [];
  const groups: { days: WeekDay[]; from: string; to: string }[] = [];
  WEEK_DAYS.forEach((day, index) => {
    const value = week[day];
    if (!value?.open) return;
    const last = groups[groups.length - 1];
    if (last && last.from === value.from && last.to === value.to && last.days[last.days.length - 1] === WEEK_DAYS[index - 1]) {
      last.days.push(day);
    } else {
      groups.push({ days: [day], from: value.from, to: value.to });
    }
  });
  return groups.map((group) => {
    const first = DAY_WORDS[lang][group.days[0]];
    const last = DAY_WORDS[lang][group.days[group.days.length - 1]];
    const days = group.days.length === 1 ? first : `${first}–${last}`;
    return `${days} ${clockText(group.from, lang)}–${clockText(group.to, lang)}`;
  });
}

export function dayIsOpen(week: WeekHours | null | undefined, key: string): boolean {
  if (!week || !dateKeyValid(key)) return false;
  return week[weekdayOfKey(key)]?.open === true;
}

// ---------------------------------------------------------------------------
// Money and pieces.
// ---------------------------------------------------------------------------

/** "$1,250.00" / "1 250,00 $" (as the WhatsApp message writes it). */
export function moneyText(cents: number | null | undefined, lang: Lang): string {
  const value = Math.max(0, Number(cents) || 0) / 100;
  const [whole, part] = value.toFixed(2).split(".");
  if (lang === "fr") return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${part} $`;
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${part}`;
}

/**
 * Typed dollars to cents: "45", "45.5", "45,50" (French comma), "1,250.00".
 * Anything else (letters, two separators read two ways) is null - never guessed.
 */
export function readDollars(typed: string): number | null {
  const raw = text(typed, 20).replace(/\s|\$/g, "");
  if (!raw) return null;
  let normalized = raw;
  if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(raw)) normalized = raw.replace(/,/g, "");
  else if (/^\d+,\d{1,2}$/.test(raw)) normalized = raw.replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  return Number.isFinite(cents) && cents >= 0 && cents <= 10_000_000 ? cents : null;
}

export function centsToInput(cents: number | null | undefined, lang: Lang): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "";
  const value = (cents / 100).toFixed(2);
  return lang === "fr" ? value.replace(".", ",") : value;
}

const KIND_WORDS: Record<Lang, Record<PieceKind, [string, string]>> = {
  en: { barrel: ["barrel", "barrels"], box: ["box", "boxes"], other: ["item", "items"] },
  fr: { barrel: ["fût", "fûts"], box: ["carton", "cartons"], other: ["colis", "colis"] },
};

/** "2 barrels, 1 box" / "2 fûts, 1 carton". */
export function piecesSummary(pieces: readonly { kind?: unknown }[], lang: Lang): string {
  const counts: Record<PieceKind, number> = { barrel: 0, box: 0, other: 0 };
  for (const piece of pieces) {
    const kind = text(piece?.kind, 20) as PieceKind;
    if (kind in counts) counts[kind] += 1;
  }
  return PIECE_KINDS.filter((kind) => counts[kind] > 0)
    .map((kind) => `${counts[kind]} ${KIND_WORDS[lang][kind][counts[kind] === 1 ? 0 : 1]}`)
    .join(", ");
}

export const PIECE_KIND_LABELS: Record<PieceKind, string> = { barrel: "Barrel", box: "Box", other: "Other" };
const PIECE_KIND_WORDS: Record<Lang, Record<PieceKind, string>> = {
  en: PIECE_KIND_LABELS,
  fr: { barrel: "Fût", box: "Carton", other: "Autre" },
};
/** What a piece is, in the page's language: render it `data-no-translate`. */
export function pieceKindLabel(kind: PieceKind, lang: Lang): string {
  return PIECE_KIND_WORDS[lang][kind] ?? PIECE_KIND_WORDS[lang].other;
}
export const PICKUP_WINDOW_LABELS: Record<PickupWindow, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
};

// ---------------------------------------------------------------------------
// The customer's form.
// ---------------------------------------------------------------------------

export type PhotoDraft = {
  key: string;
  path: string;
  previewUrl: string;
  status: "uploading" | "ready" | "error";
};

export type PieceDraft = {
  key: string;
  kind: PieceKind;
  description: string;
  photos: PhotoDraft[];
};

export type RequestDraft = {
  businessId: string;
  countryId: string;
  handoff: Handoff | "";
  locationId: string;
  plannedDate: string;
  pickupAddress: string;
  pickupDate: string;
  pickupWindow: PickupWindow | "";
  pickupNote: string;
  senderName: string;
  senderPhone: string;
  receiverName: string;
  receiverPhone: string;
  pieces: PieceDraft[];
};

let pieceSerial = 0;
export function newPieceDraft(kind: PieceKind = "barrel"): PieceDraft {
  pieceSerial += 1;
  return { key: `piece-${Date.now()}-${pieceSerial}`, kind, description: "", photos: [] };
}

export function emptyRequestDraft(): RequestDraft {
  return {
    businessId: "",
    countryId: "",
    handoff: "",
    locationId: "",
    plannedDate: "",
    pickupAddress: "",
    pickupDate: "",
    pickupWindow: "",
    pickupNote: "",
    senderName: "",
    senderPhone: "",
    receiverName: "",
    receiverPhone: "",
    pieces: [newPieceDraft("barrel")],
  };
}

/**
 * Choosing how the goods reach the business: the other answer's fields are
 * cleared (guardrails §4 rule 3 - never submit an address for a drop-off).
 */
export function chooseHandoff(draft: RequestDraft, handoff: Handoff, option: RequestOption | null): RequestDraft {
  const spots = option?.bringIn.locations ?? [];
  return handoff === "bring_in"
    ? {
        ...draft,
        handoff,
        locationId: spots.length === 1 ? spots[0].id : draft.locationId,
        pickupAddress: "",
        pickupDate: "",
        pickupWindow: "",
        pickupNote: "",
      }
    : { ...draft, handoff, locationId: "", plannedDate: "" };
}

/** The countries the eligible businesses ship to, by name in the page's language. */
export function requestCountries(options: readonly RequestOption[], lang: Lang): { id: string; name: string }[] {
  const seen = new Map<string, string>();
  for (const option of options) {
    if (!seen.has(option.country.id)) seen.set(option.country.id, countryName(option.country, lang));
  }
  return [...seen.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, lang));
}

let frenchRegions: Intl.DisplayNames | null = null;

/** A destination's name in the page's language ("Guinée" in French), else its stored name. */
export function countryName(country: { id: string; name: string }, lang: Lang): string {
  const known = destinationCountryOptionForRow({ id: country.id, name: country.name });
  const english = country.name || known.name;
  if (lang !== "fr") return english;
  if (known.nameFr) return known.nameFr;
  if (!known.code) return english;
  try {
    frenchRegions = frenchRegions ?? new Intl.DisplayNames(["fr"], { type: "region" });
    const french = frenchRegions.of(known.code.toUpperCase());
    return french && french !== known.code.toUpperCase() ? french : english;
  } catch {
    return english;
  }
}

export function optionsForCountry(options: readonly RequestOption[], countryId: string): RequestOption[] {
  return options
    .filter((option) => option.country.id === countryId)
    .sort((a, b) => a.businessName.localeCompare(b.businessName));
}

export function selectedOption(options: readonly RequestOption[], draft: Pick<RequestDraft, "businessId" | "countryId">): RequestOption | null {
  return options.find((option) => option.businessId === draft.businessId && option.country.id === draft.countryId) ?? null;
}

export function selectedLocation(option: RequestOption | null, draft: Pick<RequestDraft, "locationId">): RequestLocation | null {
  const spots = option?.bringIn.locations ?? [];
  return spots.find((spot) => spot.id === draft.locationId) ?? (spots.length === 1 ? spots[0] : null);
}

/** The estimate the customer sees before sending: barrels priced, the rest "the business will send you an estimate". */
export function draftEstimate(draft: Pick<RequestDraft, "pieces">, option: RequestOption | null): {
  pricedCents: number;
  unpriced: number;
  allPriced: boolean;
} {
  const price = option?.barrelPriceCents ?? null;
  let pricedCents = 0;
  let unpriced = 0;
  for (const piece of draft.pieces) {
    if (piece.kind === "barrel" && price) pricedCents += price;
    else unpriced += 1;
  }
  return { pricedCents, unpriced, allPriced: unpriced === 0 && draft.pieces.length > 0 };
}

export type RequestFieldStep = "details" | "pieces";

/** The steps a field lives on, for taking a person back to the first problem. */
export const REQUEST_ERROR_STEP: Record<string, RequestFieldStep> = {
  handoff_invalid: "details",
  location_invalid: "details",
  planned_date_invalid: "details",
  planned_day_closed: "details",
  pickup_address_required: "details",
  pickup_date_invalid: "details",
  pickup_window_invalid: "details",
  sender_name_required: "details",
  sender_phone_invalid: "details",
  receiver_name_required: "details",
  receiver_phone_invalid: "details",
  pieces_required: "pieces",
  too_many_pieces: "pieces",
  piece_kind_invalid: "pieces",
  piece_description_required: "pieces",
  too_many_photos: "pieces",
  photo_invalid: "pieces",
  size_invalid: "pieces",
};

/** What is wrong with the details step, as the server's codes. */
export function detailsProblems(draft: RequestDraft, option: RequestOption | null, nowMs = Date.now()): string[] {
  const errors: string[] = [];
  const zone = option?.timeZone || DEFAULT_TIME_ZONE;
  const { min, max } = pickableDays(zone, nowMs);
  const inRange = (key: string) => dateKeyValid(key) && key >= min && key <= max;
  if (draft.handoff !== "bring_in" && draft.handoff !== "collect") errors.push("handoff_invalid");
  if (draft.handoff === "bring_in") {
    const location = selectedLocation(option, draft);
    if (!location) errors.push("location_invalid");
    if (!inRange(draft.plannedDate)) errors.push("planned_date_invalid");
    else if (location && !dayIsOpen(location.hours, draft.plannedDate)) errors.push("planned_day_closed");
  }
  if (draft.handoff === "collect") {
    if (!draft.pickupAddress.trim()) errors.push("pickup_address_required");
    if (!inRange(draft.pickupDate)) errors.push("pickup_date_invalid");
    if (!PICKUP_WINDOWS.includes(draft.pickupWindow as PickupWindow)) errors.push("pickup_window_invalid");
  }
  if (!draft.senderName.trim()) errors.push("sender_name_required");
  if (!e164(draft.senderPhone)) errors.push("sender_phone_invalid");
  if (!draft.receiverName.trim()) errors.push("receiver_name_required");
  if (!e164(draft.receiverPhone)) errors.push("receiver_phone_invalid");
  const long =
    draft.senderName.trim().length > REQUEST_LIMITS.name ||
    draft.receiverName.trim().length > REQUEST_LIMITS.name ||
    draft.pickupAddress.trim().length > REQUEST_LIMITS.address ||
    draft.pickupNote.trim().length > REQUEST_LIMITS.note;
  if (long) errors.push("text_too_long");
  return errors;
}

/** What is wrong with the pieces step, as the server's codes. */
export function piecesProblems(draft: Pick<RequestDraft, "pieces">): string[] {
  const errors: string[] = [];
  const add = (code: string) => {
    if (!errors.includes(code)) errors.push(code);
  };
  if (draft.pieces.length === 0) add("pieces_required");
  if (draft.pieces.length > REQUEST_LIMITS.pieces) add("too_many_pieces");
  for (const piece of draft.pieces) {
    if (piece.kind !== "barrel" && !piece.description.trim()) add("piece_description_required");
    if (piece.description.trim().length > REQUEST_LIMITS.description) add("text_too_long");
    if (piece.photos.length > REQUEST_LIMITS.photosPerPiece) add("too_many_photos");
    if (piece.photos.some((photo) => photo.status === "error")) add("photo_invalid");
  }
  return errors;
}

export function photosStillUploading(draft: Pick<RequestDraft, "pieces">): boolean {
  return draft.pieces.some((piece) => piece.photos.some((photo) => photo.status === "uploading"));
}

/** The submitPackageRequest payload (§8.5). */
export function submitRequestPayload(draft: RequestDraft, option: RequestOption, language: Lang, idempotencyKey: string) {
  const location = selectedLocation(option, draft);
  return {
    businessId: option.businessId,
    destinationCountryId: option.country.id,
    handoff: draft.handoff,
    ...(draft.handoff === "bring_in"
      ? { locationId: location?.id ?? draft.locationId, plannedDate: draft.plannedDate }
      : {
          pickup: {
            address: draft.pickupAddress.trim(),
            date: draft.pickupDate,
            window: draft.pickupWindow,
            note: draft.pickupNote.trim(),
          },
        }),
    sender: { name: draft.senderName.trim(), phoneE164: e164(draft.senderPhone) },
    receiver: { name: draft.receiverName.trim(), phoneE164: e164(draft.receiverPhone) },
    pieces: draft.pieces.map((piece) => ({
      kind: piece.kind,
      description: piece.kind === "barrel" ? piece.description.trim() : piece.description.trim(),
      photoPaths: piece.photos.filter((photo) => photo.status === "ready" && photo.path).map((photo) => photo.path),
    })),
    language,
    idempotencyKey,
  };
}

/** A fresh idempotency key for one sending of the form. */
export function newIdempotencyKey(random: () => number = Math.random): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "web-";
  for (let i = 0; i < 24; i++) out += alphabet[Math.floor(random() * alphabet.length)];
  return out;
}

/** Where a photo is uploaded: the caller's own folder for that business (§8.4). */
export function photoUploadPath(businessId: string, uid: string, fileId: string): string {
  return `packageRequestPhotos/${businessId}/${uid}/${fileId}.jpg`;
}

/**
 * The size an image is drawn at before compressing: the longest side at most
 * 1600 px, never enlarged.
 */
export function compressedSize(width: number, height: number, maxSide: number = REQUEST_LIMITS.photoMaxSide): { width: number; height: number } {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const scale = Math.min(1, maxSide / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** JPEG qualities to try, best first, until a file fits the target. */
export const COMPRESSION_QUALITIES = [0.82, 0.72, 0.62, 0.52, 0.42] as const;

// ---------------------------------------------------------------------------
// What a refusal says. English here; french-dom.ts carries the French.
// ---------------------------------------------------------------------------

export const REQUEST_ERROR_MESSAGES: Record<string, string> = {
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
  receiver_phone_invalid: "Enter the receiver's phone number with its country code.",
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
  card_order: "This request was paid by card. Refund the barrel order instead.",
  reason_required: "Give a reason.",
  slug_invalid: "Use 3 to 40 lowercase letters, digits or dashes.",
  slug_taken: "That link is already taken.",
  slug_locked: "The request link can only be changed once.",
  slug_missing: "Save the request settings first.",
  hours_invalid: "Opening hours need a start before the end.",
  location_unknown: "That location is not one of yours.",
  pickup_areas_required: "Say which areas you pick up from.",
  price_required: "Price every piece, or none of them.",
  price_invalid: "Enter a valid price.",
  amount_required: "Enter the amount received.",
  amount_too_large: "That amount is too large.",
  payment_exceeds_balance: "That is more than the price.",
  payment_method_invalid: "Choose how the money arrived.",
  received_by_required: "Choose who took the money.",
  received_by_invalid: "Choose someone from your team.",
};

export const REQUEST_GENERIC_ERROR = "Something went wrong. Try again.";
export const REQUEST_NETWORK_ERROR = "We could not reach Laawol. Check your connection and try again.";

export type CallableFailure = { reason: string; reasons: string[]; message: string; details: Row };

/** A callable error as the screens use it: the reason codes and English copy. */
export function requestFailure(error: unknown): CallableFailure {
  const record = asRow(error);
  const details = asRow(record.details);
  const reasons = Array.isArray(details.reasons) ? details.reasons.map((r) => text(r, 60)).filter(Boolean) : [];
  const reason = text(details.reason, 60) || reasons[0] || "";
  const code = text(record.code, 60);
  const message = REQUEST_ERROR_MESSAGES[reason] ??
    (code === "functions/unavailable" || code === "functions/deadline-exceeded" ? REQUEST_NETWORK_ERROR :
      code === "functions/resource-exhausted" ? REQUEST_ERROR_MESSAGES.rate_limited : REQUEST_GENERIC_ERROR);
  return { reason, reasons: reasons.length ? reasons : reason ? [reason] : [], message, details };
}

// ---------------------------------------------------------------------------
// Statuses and the business's lists.
// ---------------------------------------------------------------------------

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  new: "Needs estimate",
  estimate_sent: "Waiting for customer",
  confirmed: "Expected",
  received: "Package received",
  declined: "Declined",
  customer_declined: "Customer said no",
  cancelled: "Cancelled",
  expired: "Expired",
};

export function requestStatus(row: unknown): RequestStatus {
  const status = text(asRow(row).status, 40) as RequestStatus;
  return status in REQUEST_STATUS_LABELS ? status : "new";
}

export type RequestFilter = "needs_estimate" | "waiting_customer";

/** Requests filter chips: "Needs estimate · N" (new) and "Waiting for customer · N" (estimate_sent). */
export function requestFilterCounts(rows: readonly unknown[]): Record<RequestFilter, number> {
  let needs = 0;
  let waiting = 0;
  for (const row of rows) {
    const status = requestStatus(row);
    if (status === "new") needs += 1;
    else if (status === "estimate_sent") waiting += 1;
  }
  return { needs_estimate: needs, waiting_customer: waiting };
}

export function filterRequests(rows: readonly Row[], filter: RequestFilter): Row[] {
  const status: RequestStatus = filter === "needs_estimate" ? "new" : "estimate_sent";
  return rows.filter((row) => requestStatus(row) === status);
}

/** The confirmed ones: Expected in the Waiting list. */
export function expectedRequests(rows: readonly Row[]): Row[] {
  return rows
    .filter((row) => requestStatus(row) === "confirmed")
    .sort((a, b) => expectedSortKey(a).localeCompare(expectedSortKey(b)));
}

function expectedSortKey(row: Row): string {
  const pickup = asRow(row.pickup);
  return text(row.plannedDate, 10) || text(pickup.date, 10) || "9999";
}

export type LockView = { lockedByOther: boolean; name: string; mine: boolean };

/** "Mariama is writing the estimate": the lock as another person sees it. */
export function lockView(row: unknown, uid: string, nowMs = Date.now()): LockView {
  const lock = asRow(asRow(row).lock);
  const until = Number(lock.untilMs || 0);
  const live = until > nowMs && Boolean(text(lock.uid, 128));
  return {
    lockedByOther: live && text(lock.uid, 128) !== uid,
    mine: live && text(lock.uid, 128) === uid,
    name: text(lock.name, 120),
  };
}

export function requestPieces(row: unknown): { id: string; kind: PieceKind; description: string; photoPaths: string[]; estimateCents: number | null }[] {
  const list = Array.isArray(asRow(row).pieces) ? (asRow(row).pieces as unknown[]) : [];
  return list.map((raw) => {
    const piece = asRow(raw);
    const kind = text(piece.kind, 20) as PieceKind;
    return {
      id: text(piece.id, 10),
      kind: PIECE_KINDS.includes(kind) ? kind : "other",
      description: text(piece.description, REQUEST_LIMITS.description),
      photoPaths: Array.isArray(piece.photoPaths) ? piece.photoPaths.map((p) => text(p, 300)).filter(Boolean) : [],
      estimateCents: Number.isInteger(piece.estimateCents) ? Number(piece.estimateCents) : null,
    };
  });
}

export function requestEstimate(row: unknown): { version: number; totalCents: number; pieces: Map<string, number>; pickupFeeCents: number; note: string } | null {
  const estimate = asRow(asRow(row).estimate);
  const version = Number(estimate.version || 0);
  if (!Number.isInteger(version) || version <= 0) return null;
  const pieces = new Map<string, number>();
  for (const raw of Array.isArray(estimate.pieces) ? estimate.pieces : []) {
    const piece = asRow(raw);
    if (Number.isInteger(piece.cents)) pieces.set(text(piece.id, 10), Number(piece.cents));
  }
  return {
    version,
    totalCents: Number(estimate.totalCents) || 0,
    pieces,
    pickupFeeCents: Number(estimate.pickupFeeCents) || 0,
    note: text(estimate.note, REQUEST_LIMITS.note),
  };
}

/** The per-piece prices an editor opens with: the latest estimate, else the barrel prefill. */
export function estimateDraftPrices(row: unknown, lang: Lang): Record<string, string> {
  const estimate = requestEstimate(row);
  const out: Record<string, string> = {};
  for (const piece of requestPieces(row)) {
    const cents = estimate?.pieces.get(piece.id) ?? piece.estimateCents;
    out[piece.id] = centsToInput(cents, lang);
  }
  return out;
}

/** The sendPackageEstimate payload, or the first problem. */
export function sendEstimatePayload(
  businessId: string,
  row: Row,
  prices: Record<string, string>,
  extra: { pickupFee: string; note: string },
): { payload: Record<string, unknown> | null; error: string } {
  const pieces: { id: string; cents: number }[] = [];
  for (const piece of requestPieces(row)) {
    const cents = readDollars(prices[piece.id] ?? "");
    if (cents === null) return { payload: null, error: prices[piece.id]?.trim() ? "amount_invalid" : "estimate_piece_missing" };
    pieces.push({ id: piece.id, cents });
  }
  let pickupFeeCents: number | undefined;
  if (text(row.handoff, 20) === "collect" && extra.pickupFee.trim()) {
    const fee = readDollars(extra.pickupFee);
    if (fee === null) return { payload: null, error: "pickup_fee_invalid" };
    pickupFeeCents = fee;
  }
  if (extra.note.trim().length > REQUEST_LIMITS.note) return { payload: null, error: "text_too_long" };
  return {
    error: "",
    payload: {
      businessId,
      requestId: text(row.id, 128),
      baseVersion: requestEstimate(row)?.version ?? 0,
      pieces,
      ...(pickupFeeCents !== undefined ? { pickupFeeCents } : {}),
      note: extra.note.trim(),
    },
  };
}

/** The total an editor shows as prices are typed (null while a price is missing). */
export function draftTotalCents(row: Row, prices: Record<string, string>, pickupFee: string): number | null {
  let total = 0;
  for (const piece of requestPieces(row)) {
    const cents = readDollars(prices[piece.id] ?? "");
    if (cents === null) return null;
    total += cents;
  }
  if (text(row.handoff, 20) === "collect" && pickupFee.trim()) {
    const fee = readDollars(pickupFee);
    if (fee === null) return null;
    total += fee;
  }
  return total;
}

/** One line of the Received form: a piece of the request (with its id) or one brought on top. */
export type ReceiveItem = { key: string; id: string; kind: PieceKind; description: string; price: string };

/** The Received form opens with the request's pieces, priced from the estimate. */
export function receiveItemsFrom(row: unknown, lang: Lang): ReceiveItem[] {
  const prices = estimateDraftPrices(row, lang);
  return requestPieces(row).map((piece) => ({
    key: piece.id, id: piece.id, kind: piece.kind, description: piece.description, price: prices[piece.id] ?? "",
  }));
}

let receiveSerial = 0;
export function newReceiveItem(): ReceiveItem {
  receiveSerial += 1;
  return { key: `new-${Date.now()}-${receiveSerial}`, id: "", kind: "box", description: "", price: "" };
}

/**
 * The receivePackageRequest pieces (§8.6): the request's pieces by id, new
 * ones without, all priced or none; or the first problem.
 */
export function receiveItemsPayload(items: readonly ReceiveItem[]): {
  pieces: ({ id: string; priceCents: number | null } | { kind: PieceKind; description: string; priceCents: number | null })[];
  error: string;
} {
  if (items.length === 0) return { pieces: [], error: "pieces_required" };
  if (items.length > REQUEST_LIMITS.pieces) return { pieces: [], error: "too_many_pieces" };
  const pieces: ({ id: string; priceCents: number | null } | { kind: PieceKind; description: string; priceCents: number | null })[] = [];
  for (const item of items) {
    const typed = item.price.trim();
    const cents = typed ? readDollars(typed) : null;
    if (typed && cents === null) return { pieces: [], error: "price_invalid" };
    if (item.id) {
      pieces.push({ id: item.id, priceCents: cents });
    } else {
      if (item.kind !== "barrel" && !item.description.trim()) return { pieces: [], error: "piece_description_required" };
      pieces.push({ kind: item.kind, description: item.description.trim(), priceCents: cents });
    }
  }
  const priced = pieces.filter((p) => p.priceCents !== null).length;
  if (priced > 0 && priced < pieces.length) return { pieces: [], error: "price_required" };
  return { pieces, error: "" };
}

/** The receivePackageRequest pieces: final prices, prefilled from the estimate. */
export function receivePiecesPayload(row: Row, prices: Record<string, string>): { pieces: { id: string; priceCents: number | null }[]; error: string } {
  const pieces: { id: string; priceCents: number | null }[] = [];
  for (const piece of requestPieces(row)) {
    const typed = (prices[piece.id] ?? "").trim();
    if (!typed) {
      pieces.push({ id: piece.id, priceCents: null });
      continue;
    }
    const cents = readDollars(typed);
    if (cents === null) return { pieces: [], error: "price_invalid" };
    pieces.push({ id: piece.id, priceCents: cents });
  }
  const priced = pieces.filter((p) => p.priceCents !== null).length;
  if (priced > 0 && priced < pieces.length) return { pieces: [], error: "price_required" };
  return { pieces, error: "" };
}

// ---------------------------------------------------------------------------
// History, as staff read it. Structured rows, worded here (English; the
// French comes from french-dom.ts), the names and amounts kept apart.
// ---------------------------------------------------------------------------

export const HISTORY_ACTION_LABELS: Record<string, string> = {
  submitted: "Request sent by the customer",
  estimate_sent: "Estimate sent",
  confirmed_link: "Customer confirmed the estimate",
  confirmed_phone: "Customer agreed by phone",
  confirmed_card: "Paid online by card",
  customer_declined: "Customer said no thanks",
  declined: "Request declined",
  cancelled: "Request cancelled",
  expired: "Request expired",
  received: "Received at the counter",
  lock_taken_over: "Took over the estimate",
  pieces_changed: "Pieces changed at Received",
  reminder_sent: "Reminder sent",
};

export type HistoryRow = { atMs: number; label: string; byName: string; version: number | null; totalCents: number | null; reason: string; change: string };

export function requestHistory(row: unknown): HistoryRow[] {
  const list = Array.isArray(asRow(row).history) ? (asRow(row).history as unknown[]) : [];
  return list
    .map((raw) => {
      const entry = asRow(raw);
      const action = text(entry.action, 40);
      return {
        atMs: Number(entry.atMs) || 0,
        label: HISTORY_ACTION_LABELS[action] ?? action,
        byName: text(entry.byName, 120),
        version: Number.isInteger(entry.version) ? Number(entry.version) : null,
        totalCents: Number.isInteger(entry.totalCents) ? Number(entry.totalCents) : null,
        reason: action === "reminder_sent" || action === "lock_taken_over" ? "" : text(entry.reason, REQUEST_LIMITS.reason),
        // "+1 / −1": pieces added and left out at Received.
        change: action === "pieces_changed" ? `+${Number(entry.piecesAdded) || 0} / −${Number(entry.piecesRemoved) || 0}` : "",
      };
    })
    .reverse();
}

// ---------------------------------------------------------------------------
// The /e/ page: which state it shows.
// ---------------------------------------------------------------------------

export type EstimatePageState =
  | "waiting_estimate"
  | "confirm"
  | "confirmed"
  | "price_dropped"
  | "received"
  | "declined"
  | "customer_declined"
  | "cancelled"
  | "expired";

export function estimatePageState(request: Pick<PublicRequest, "status" | "priceDropped" | "estimate">): EstimatePageState {
  switch (request.status) {
    case "new":
      return "waiting_estimate";
    case "estimate_sent":
      return request.estimate ? "confirm" : "waiting_estimate";
    case "confirmed":
      return request.priceDropped ? "price_dropped" : "confirmed";
    case "received":
      return "received";
    case "declined":
      return "declined";
    case "customer_declined":
      return "customer_declined";
    case "cancelled":
      return "cancelled";
    default:
      return "expired";
  }
}

/** The /e/ page's piece rows: what it is and its price. */
export function estimateRows(request: Pick<PublicRequest, "pieces" | "estimate">): { id: string; kind: PieceKind; description: string; cents: number | null }[] {
  const prices = new Map((request.estimate?.pieces ?? []).map((row) => [row.id, row.cents]));
  return request.pieces.map((piece) => ({
    id: piece.id,
    kind: piece.kind,
    description: piece.description,
    cents: prices.has(piece.id) ? (prices.get(piece.id) as number) : null,
  }));
}

// ---------------------------------------------------------------------------
// The business's request settings (§8.6 setPackageRequestSettings).
// ---------------------------------------------------------------------------

export type SettingsLocation = { id: string; label: string; address: string };

/**
 * The drop-off spots hours are set for: the active office locations, or the
 * headquarters as `default` when the business has none (as the server does).
 */
export function requestLocationsFor(officeRows: readonly unknown[], business: unknown): SettingsLocation[] {
  const active = officeRows
    .map(asRow)
    .filter((row) => row.isActive === true)
    .map((row) => ({ id: text(row.id, 120), label: text(row.label, 120), address: text(row.address, 300) }))
    .filter((row) => row.id)
    .sort((a, b) => a.label.localeCompare(b.label));
  if (active.length > 0) return active;
  const biz = asRow(business);
  const street = text(biz.addressLine1, 200);
  if (!street) return [];
  const address = [street, text(biz.city, 80), text(biz.state, 40), text(biz.postalCode, 20)].filter(Boolean).join(", ");
  return [{ id: "default", label: text(biz.name, 120) || "Main office", address }];
}

export type RequestSettingsDraft = {
  acceptRequests: boolean;
  slug: string;
  hours: Record<string, WeekHours>;
  pickupEnabled: boolean;
  pickupAreas: string;
  cardBarrelBooking: boolean;
};

export function requestSettingsDraft(business: unknown, locations: readonly SettingsLocation[]): RequestSettingsDraft {
  const biz = asRow(business);
  const settings = asRow(biz.packageRequestSettings);
  const stored = asRow(settings.openingHours);
  const pickup = asRow(settings.pickup);
  const hours: Record<string, WeekHours> = {};
  for (const location of locations) hours[location.id] = weekFrom(stored[location.id]);
  return {
    acceptRequests: settings.acceptRequests === true,
    slug: text(biz.requestSlug, 40),
    hours,
    pickupEnabled: pickup.enabled === true,
    pickupAreas: text(pickup.areas, REQUEST_LIMITS.areas),
    cardBarrelBooking: settings.cardBarrelBooking === true,
  };
}

/** Whether the owner may still change the link (once, after it was assigned). */
export function slugEditable(business: unknown): boolean {
  const biz = asRow(business);
  return !text(biz.requestSlug, 40) || Number(biz.requestSlugEdits || 0) < 1;
}

export function requestSettingsProblems(draft: RequestSettingsDraft): string[] {
  const errors: string[] = [];
  for (const week of Object.values(draft.hours)) {
    if (weekProblem(week)) {
      errors.push("hours_invalid");
      break;
    }
  }
  if (draft.pickupEnabled && !draft.pickupAreas.trim()) errors.push("pickup_areas_required");
  if (draft.pickupAreas.trim().length > REQUEST_LIMITS.areas) errors.push("text_too_long");
  const slug = draft.slug.trim().toLowerCase();
  if (slug && (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug) || slug.includes("--"))) errors.push("slug_invalid");
  return errors;
}

export function requestSettingsPayload(businessId: string, draft: RequestSettingsDraft, currentSlug: string) {
  const slug = draft.slug.trim().toLowerCase();
  const openingHours: Record<string, WeekHours> = {};
  for (const [id, week] of Object.entries(draft.hours)) {
    if (weekHasHours(week)) openingHours[id] = week;
  }
  return {
    businessId,
    acceptRequests: draft.acceptRequests,
    openingHours,
    pickup: { enabled: draft.pickupEnabled, areas: draft.pickupEnabled ? draft.pickupAreas.trim() : "" },
    cardBarrelBooking: draft.cardBarrelBooking,
    ...(slug && slug !== currentSlug ? { requestSlug: slug } : {}),
  };
}

/** The flash after "Received", in the page's language (it carries the code). */
export function receivedFlash(trackingCode: string, already: boolean, lang: Lang): string {
  const code = text(trackingCode, 40);
  if (lang === "fr") {
    return already ? `Déjà reçu : ${code}` : `Reçu : ${code}. Le colis est dans la liste d’attente.`;
  }
  return already ? `Already received: ${code}` : `Received: ${code}. It is in the Waiting list.`;
}
