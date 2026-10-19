/**
 * Phone accounts on the web (docs/PHONE_ACCOUNTS.md): the pure half.
 *
 * Everything here runs under node with no Firebase: the answers of the
 * `phoneAccount` callable read defensively, the refusal reasons mapped to
 * console copy (never the server's English message), the "My packages"
 * grouping, the resend countdown, and the staff-side phone flags on a
 * record. The callable glue lives in `phone-accounts-client.ts`.
 *
 * Every English sentence below has its French in french-dom.ts
 * (phone-accounts.test.ts checks each one).
 */

import type { GuestTrackingStage } from "./guest-tracking.ts";

/** The one callable; `data.action` names the handler (§5.1). */
export const PHONE_ACCOUNT_CALLABLE = "phoneAccount";

export type PhoneAccountAction =
  | "requestPhoneLoginCode"
  | "verifyPhoneLoginCode"
  | "completePhoneSignIn"
  | "getMyShipments"
  | "reportShipmentNotMine"
  | "syncRecord";

export type PhoneRole = "sender" | "receiver";

/** Where a signed-in customer lands to see their packages. */
export const MY_PACKAGES_PATH = "/?open=packages";

/** The customer console's arrival tab from its address (`?open=packages`). */
export function customerTabFromSearch(search: string): "packages" | null {
  const value = new URLSearchParams(String(search ?? "")).get("open");
  return value === "packages" ? "packages" : null;
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

export type PhoneCodeChallenge = {
  challengeId: string;
  channel: "whatsapp";
  /** The only part of the number ever shown from a tracking link. */
  lastTwo: string;
  expiresAtMs: number;
  /** How long before another code may be asked for (30 s). */
  resendAfterMs: number;
};

const DEFAULT_RESEND_AFTER_MS = 30_000;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function cleanString(value: unknown, max = 200): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function wholeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/** requestPhoneLoginCode's answer. Throws on an answer with no challenge. */
export function parsePhoneCodeChallenge(value: unknown): PhoneCodeChallenge {
  const row = record(value);
  const challengeId = cleanString(row.challengeId, 64);
  if (!challengeId) throw new Error("phone-code-challenge-invalid");
  const lastTwo = cleanString(row.lastTwo, 2);
  const resend = wholeNumber(row.resendAfterMs);
  return {
    challengeId,
    channel: "whatsapp",
    lastTwo: /^\d{2}$/.test(lastTwo) ? lastTwo : "",
    expiresAtMs: wholeNumber(row.expiresAtMs),
    resendAfterMs: resend > 0 ? Math.min(resend, 10 * 60_000) : DEFAULT_RESEND_AFTER_MS,
  };
}

export type PhoneSignInToken = { customToken: string; uid: string; isNewAccount: boolean };
export type PhoneLinkResult = { linked: true; merged: boolean };

/** verifyPhoneLoginCode's answer for a sign-in code. Throws without a token. */
export function parsePhoneSignInToken(value: unknown): PhoneSignInToken {
  const row = record(value);
  const customToken = cleanString(row.customToken, 8192);
  if (!customToken) throw new Error("phone-sign-in-token-invalid");
  return { customToken, uid: cleanString(row.uid, 128), isNewAccount: row.isNewAccount === true };
}

/** verifyPhoneLoginCode (link code) / completePhoneSignIn({placeholderIdToken}). */
export function parsePhoneLinkResult(value: unknown): PhoneLinkResult {
  const row = record(value);
  if (row.linked !== true) throw new Error("phone-link-result-invalid");
  return { linked: true, merged: row.merged === true };
}

// ---------------------------------------------------------------------------
// Refusals: details.reason -> console copy
// ---------------------------------------------------------------------------

export const PHONE_REFUSAL_REASONS = [
  "phone_invalid",
  "needs_country_code",
  "tracking_not_found",
  "no_phone_on_record",
  "rate_limited",
  "whatsapp_unavailable",
  "sign_in_required",
  "code_wrong",
  "code_expired",
  "too_many_attempts",
  "challenge_not_found",
  "phone_in_use",
  "wrong_account",
  "proof_invalid",
  "no_verified_phone",
  "record_invalid",
  "phone_sign_in_unavailable",
] as const;

export type PhoneRefusalReason = (typeof PHONE_REFUSAL_REASONS)[number] | "unknown";

export type PhoneRefusal = {
  reason: PhoneRefusalReason;
  /** rate_limited: how long until another code may be asked for. */
  retryAfterMs?: number;
  /** code_wrong: tries left on this code. */
  attemptsLeft?: number;
};

/**
 * The refusal a callable error carries in `details.reason`. Anything else -
 * a network failure, a timeout, an older server - is "unknown". The server's
 * English `message` is never read: the console shows its own words.
 */
export function phoneRefusalOf(error: unknown): PhoneRefusal {
  const details = record(record(error).details);
  const raw = cleanString(details.reason, 40);
  const reason = (PHONE_REFUSAL_REASONS as readonly string[]).includes(raw)
    ? (raw as PhoneRefusalReason)
    : "unknown";
  const refusal: PhoneRefusal = { reason };
  if (reason === "rate_limited") {
    const wait = Number(details.retryAfterMs);
    if (Number.isFinite(wait) && wait > 0) refusal.retryAfterMs = Math.round(wait);
  }
  if (reason === "code_wrong") {
    const left = Number(details.attemptsLeft);
    if (Number.isFinite(left) && left >= 0) refusal.attemptsLeft = Math.trunc(left);
  }
  return refusal;
}

export const PHONE_REFUSAL_COPY: Record<PhoneRefusalReason, string> = {
  phone_invalid: "Enter a valid phone number.",
  needs_country_code: "Add your country code: choose the country, then type the number.",
  tracking_not_found: "We couldn’t find that package. Check the code and try again.",
  no_phone_on_record: "This package has no number we can send a code to.",
  rate_limited: "Too many codes were asked for.",
  whatsapp_unavailable: "WhatsApp codes are not available right now. We can send a text instead.",
  sign_in_required: "Sign in first, then try again.",
  code_wrong: "That code is not right.",
  code_expired: "That code has expired. Ask for a new one.",
  too_many_attempts: "Too many wrong codes. Ask for a new one.",
  challenge_not_found: "That code is no longer valid. Ask for a new one.",
  phone_in_use:
    "This number already belongs to another Laawol account. Sign in with that number instead, or use a different number.",
  wrong_account: "This code was asked for by another account. Ask for a new one.",
  proof_invalid: "We could not confirm the number. Verify it again.",
  no_verified_phone: "Add and verify your phone number to see your packages.",
  record_invalid: "That package could not be found. Refresh and try again.",
  phone_sign_in_unavailable: "Use your email and password to sign in to this account.",
  unknown: "Something went wrong. Check your connection and try again.",
};

/** The labels of the second half of a refusal, before its value. */
export const PHONE_REFUSAL_DETAIL_LABELS = {
  retry: "You can ask again in",
  attempts: "Attempts left:",
  waitFewMinutes: "Wait a few minutes and try again.",
} as const;

/**
 * "45 s", "3 min", "2 h": spelled the same in French, so the value can sit
 * under data-no-translate next to its translated label.
 */
export function waitText(ms: number): string {
  const seconds = Math.max(1, Math.ceil(Number(ms) / 1000) || 1);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.ceil(minutes / 60)} h`;
}

export type PhoneRefusalText = {
  message: string;
  /** A translated label and the value after it (under data-no-translate). */
  detail?: { label: string; value: string };
  /** A sentence after the message, translated as copy. */
  hint?: string;
};

export function phoneRefusalText(refusal: PhoneRefusal): PhoneRefusalText {
  const message = PHONE_REFUSAL_COPY[refusal.reason] ?? PHONE_REFUSAL_COPY.unknown;
  if (refusal.reason === "rate_limited") {
    return refusal.retryAfterMs
      ? { message, detail: { label: PHONE_REFUSAL_DETAIL_LABELS.retry, value: waitText(refusal.retryAfterMs) } }
      : { message, hint: PHONE_REFUSAL_DETAIL_LABELS.waitFewMinutes };
  }
  if (refusal.reason === "code_wrong" && refusal.attemptsLeft !== undefined) {
    return { message, detail: { label: PHONE_REFUSAL_DETAIL_LABELS.attempts, value: String(refusal.attemptsLeft) } };
  }
  return { message };
}

/** A code typed or pasted: its digits, six at most. */
export function sanitizeLoginCode(raw: string): string {
  return String(raw ?? "").replace(/\D/g, "").slice(0, 6);
}

/** Whole seconds until a moment (0 once it has passed): the resend countdown. */
export function secondsUntil(atMs: number, nowMs: number): number {
  const left = Number(atMs) - Number(nowMs);
  return Number.isFinite(left) && left > 0 ? Math.ceil(left / 1000) : 0;
}

/**
 * Settles with the promise, or rejects with `timeoutError` after `ms` - so a
 * spinner waiting on it always ends (guardrails §3).
 */
export async function withTimeout<T>(promise: Promise<T>, ms: number, timeoutError: unknown): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(timeoutError), ms);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// Sign-in hints on a tracking page (record.signIn)
// ---------------------------------------------------------------------------

export type GuestSignInHint = { role: PhoneRole; lastTwo: string };

/** The role words on a hint, only when the record has two numbers. */
export const PHONE_ROLE_LABELS: Record<PhoneRole, string> = {
  sender: "Sender",
  receiver: "Receiver",
};

/** record.signIn read defensively: sender/receiver only, two digits each, one per role. */
export function parseSignInHints(value: unknown): GuestSignInHint[] {
  if (!Array.isArray(value)) return [];
  const hints: GuestSignInHint[] = [];
  for (const item of value.slice(0, 4)) {
    const row = record(item);
    const role = row.role === "sender" || row.role === "receiver" ? row.role : null;
    const lastTwo = cleanString(row.lastTwo, 2);
    if (!role || !/^\d{2}$/.test(lastTwo)) continue;
    if (hints.some((hint) => hint.role === role)) continue;
    hints.push({ role, lastTwo });
  }
  return hints;
}

// ---------------------------------------------------------------------------
// My packages
// ---------------------------------------------------------------------------

export type MyShipmentShipping = {
  shippingLine?: string;
  containerNumber?: string;
  bookingNumber?: string;
};

export type MyShipmentPart = { trackingCode: string; stage: string; pieceCount: number };

export type MyShipmentItem = {
  /** "<collection>/<id>": what "This isn't mine" sends back. */
  key: string;
  collection: string;
  role: PhoneRole;
  roles: PhoneRole[];
  businessId: string;
  businessName: string;
  service: string;
  trackingCode: string;
  stage: GuestTrackingStage | string;
  pieceCount: number;
  parts: MyShipmentPart[];
  shipping: MyShipmentShipping | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type MyShipmentsCursor = { beforeMs: number; skipKeys: string[] };

export type MyShipmentsPage = {
  items: MyShipmentItem[];
  nextCursor: MyShipmentsCursor | null;
  phoneLastTwo: string;
};

const SHIPPING_KEYS = ["shippingLine", "containerNumber", "bookingNumber"] as const;

function parseShipping(value: unknown): MyShipmentShipping | null {
  const row = record(value);
  const shipping: MyShipmentShipping = {};
  for (const key of SHIPPING_KEYS) {
    const textValue = cleanString(row[key], 60);
    if (textValue) shipping[key] = textValue;
  }
  return Object.keys(shipping).length ? shipping : null;
}

function parseItem(value: unknown): MyShipmentItem | null {
  const row = record(value);
  const key = cleanString(row.key, 300);
  const role = row.role === "receiver" ? "receiver" : row.role === "sender" ? "sender" : null;
  if (!key || !role) return null;
  const roles = Array.isArray(row.roles)
    ? (row.roles.filter((item) => item === "sender" || item === "receiver") as PhoneRole[])
    : [];
  const parts = Array.isArray(row.parts)
    ? row.parts.slice(0, 100).flatMap((part) => {
        const p = record(part);
        const trackingCode = cleanString(p.trackingCode, 60);
        return trackingCode
          ? [{ trackingCode, stage: cleanString(p.stage, 40), pieceCount: wholeNumber(p.pieceCount) }]
          : [];
      })
    : [];
  const createdAtMs = wholeNumber(row.createdAtMs);
  return {
    key,
    collection: cleanString(row.collection, 60) || key.split("/")[0],
    role,
    roles: roles.length ? [...new Set(roles)] : [role],
    businessId: cleanString(row.businessId, 128),
    businessName: cleanString(row.businessName, 120),
    service: cleanString(row.service, 40),
    trackingCode: cleanString(row.trackingCode, 60),
    stage: cleanString(row.stage, 40),
    pieceCount: wholeNumber(row.pieceCount),
    parts,
    shipping: parseShipping(row.shipping),
    createdAtMs,
    updatedAtMs: Math.max(wholeNumber(row.updatedAtMs), createdAtMs),
  };
}

function parseCursor(value: unknown): MyShipmentsCursor | null {
  const row = record(value);
  const beforeMs = wholeNumber(row.beforeMs);
  if (!beforeMs) return null;
  const skipKeys = Array.isArray(row.skipKeys)
    ? row.skipKeys.map((key) => cleanString(key, 300)).filter(Boolean).slice(0, 100)
    : [];
  return { beforeMs, skipKeys };
}

/** getMyShipments' answer, read defensively: malformed items are dropped. */
export function parseMyShipmentsPage(value: unknown): MyShipmentsPage {
  const row = record(value);
  const items = Array.isArray(row.items)
    ? row.items.map(parseItem).filter((item): item is MyShipmentItem => item !== null)
    : [];
  const lastTwo = cleanString(row.phoneLastTwo, 2);
  return {
    items,
    nextCursor: parseCursor(row.nextCursor),
    phoneLastTwo: /^\d{2}$/.test(lastTwo) ? lastTwo : "",
  };
}

/** A later page added after the ones already shown; a key seen before is kept once. */
export function appendShipmentPage(current: readonly MyShipmentItem[], next: readonly MyShipmentItem[]): MyShipmentItem[] {
  const seen = new Set(current.map((item) => item.key));
  return [...current, ...next.filter((item) => !seen.has(item.key))];
}

export type BusinessShipmentGroup = {
  businessId: string;
  businessName: string;
  items: MyShipmentItem[];
};

export type GroupedShipments = {
  /** The person sent these (role "sender", including sent to themselves). */
  mine: BusinessShipmentGroup[];
  /** Someone sent these to the person (role "receiver"). */
  comingToYou: BusinessShipmentGroup[];
};

function groupByBusiness(items: readonly MyShipmentItem[]): BusinessShipmentGroup[] {
  const groups = new Map<string, BusinessShipmentGroup>();
  for (const item of items) {
    const id = item.businessId || `name:${item.businessName}`;
    const group = groups.get(id);
    if (group) {
      group.items.push(item);
      if (!group.businessName && item.businessName) group.businessName = item.businessName;
    } else {
      groups.set(id, { businessId: item.businessId, businessName: item.businessName, items: [item] });
    }
  }
  return [...groups.values()];
}

/**
 * My packages, as the screen lists it (§6): newest first, then grouped by
 * business - a business sits where its newest package does - and split into
 * "My packages" (sender) and "Coming to you" (receiver). The sort is stable:
 * two packages made the same millisecond keep the server's order.
 */
export function groupMyShipments(items: readonly MyShipmentItem[]): GroupedShipments {
  const newestFirst = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (b.item.createdAtMs - a.item.createdAtMs) || (a.index - b.index))
    .map(({ item }) => item);
  return {
    mine: groupByBusiness(newestFirst.filter((item) => item.role !== "receiver")),
    comingToYou: groupByBusiness(newestFirst.filter((item) => item.role === "receiver")),
  };
}

// ---------------------------------------------------------------------------
// Staff: the phone flags a record carries (§3)
// ---------------------------------------------------------------------------

export type RecordPhoneField = "customerPhone" | "receiverPhone";

export const PHONE_FLAG_COPY = {
  countryCodeMissing: "Add the country code",
  reportedNotMine: "The person says this number isn't theirs - check it",
} as const;

function flagList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** Whether a raw phone field is flagged by the server on this record. */
export function recordPhoneFlags(row: unknown, field: RecordPhoneField) {
  const data = record(row);
  return {
    countryCodeMissing: flagList(data.phoneCountryCodeMissing).includes(field),
    reportedNotMine: flagList(data.phoneReportedNotMine).includes(field),
  };
}

/** The warnings shown next to a phone, in display order. */
export function recordPhoneWarnings(row: unknown, field: RecordPhoneField): string[] {
  const flags = recordPhoneFlags(row, field);
  return [
    ...(flags.countryCodeMissing ? [PHONE_FLAG_COPY.countryCodeMissing] : []),
    ...(flags.reportedNotMine ? [PHONE_FLAG_COPY.reportedNotMine] : []),
  ];
}

/**
 * The WhatsApp line under "Whose" warns on its own when a stored number has
 * no "+" (container-manifest.ts). When the server already flags that field
 * - shown right next to the phone - the line's copy of it is dropped, so a
 * number never carries the same warning twice.
 */
export const LINE_COUNTRY_CODE_WARNINGS: Record<RecordPhoneField, string> = {
  customerPhone: "Customer's phone needs a country code",
  receiverPhone: "Receiver's phone needs a country code",
};

export function unflaggedLineWarnings(row: unknown, warnings: readonly string[]): string[] {
  const fields = Object.keys(LINE_COUNTRY_CODE_WARNINGS) as RecordPhoneField[];
  return warnings.filter((warning) => !fields.some((field) =>
    LINE_COUNTRY_CODE_WARNINGS[field] === warning && recordPhoneFlags(row, field).countryCodeMissing));
}
