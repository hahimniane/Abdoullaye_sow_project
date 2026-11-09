/**
 * "Send on WhatsApp" on a parked car, and the car's last WhatsApp status
 * (docs/PARKING_LEFT_WHATSAPP.md §2, §4): who is offered the button, the
 * request and answer of the callable, the refusal and result sentences, the
 * one status line, and the note after a corrected phone number.
 *
 * Pure: no React, no Firebase. `parking-whatsapp-send.test.ts` runs it under
 * node. The server mirror is `my_flutter_app/functions/parking_whatsapp.js`
 * (`carIsMessageable`); the callable stays the authority, this only keeps the
 * button off cars it would refuse.
 *
 * Where the last status comes from is ONE place - `lastStatusRequest` /
 * `parseLastStatus` here and `fetchLastWhatsAppStatus` in the component file.
 * Today it is the callable action `whatsapp_status`; staff can also read
 * `parkingMessages` (firestore.rules, canManageBusiness), so switching to a
 * query there changes only that one function.
 */

import { parkingWhatsAppEnabled, parkingWhatsAppRefusalText } from "./parking-whatsapp.ts";

type Row = Record<string, unknown>;
export type Lang = "en" | "fr";

const text = (value: unknown, max = 300) => String(value ?? "").trim().slice(0, max);
const asRow = (value: unknown): Row => (value && typeof value === "object" ? (value as Row) : {});

/** A callable that has not answered by now is given up on (loading always resolves). */
export const PARKING_WHATSAPP_SEND_TIMEOUT_MS = 40_000;

export const PARKING_WHATSAPP_SEND_COPY = {
  button: "Send on WhatsApp",
  sent: "Sent on WhatsApp.",
  failed: "Not delivered. Check the number.",
  stopped: "This customer asked to stop WhatsApp messages.",
  phoneChanged: "Saved. The last message will be resent to the new number.",
} as const;

// ---------------------------------------------------------------------------
// Who is offered the button
// ---------------------------------------------------------------------------

/**
 * Whether a parked car shows the button and the status line: the business
 * switch is on and the car is one the feature speaks about - entered by the
 * lot itself (not an online booking), not voided, not cancelled, and not a
 * team member's own car.
 */
export function parkingWhatsAppSendVisible(business: unknown, car: unknown): boolean {
  if (!parkingWhatsAppEnabled(business)) return false;
  const row = asRow(car);
  if (Object.keys(row).length === 0) return false;
  if (row.voided === true || text(row.status, 40) === "cancelled") return false;
  if (text(row.forStaffId, 128)) return false;
  return text(row.source, 40) === "business" || row.enteredByBusiness === true;
}

// ---------------------------------------------------------------------------
// The send
// ---------------------------------------------------------------------------

export function sendWhatsAppRequest(businessId: string, carId: string) {
  return { action: "send_whatsapp", businessId, carId };
}

export type SendKind = "parked" | "left";
export type SendStatus = "sent" | "failed" | "stopped";
export type SendResult = { kind: SendKind; status: SendStatus; error: string };

/** The callable's answer, defensively. An unknown status reads as failed: never claim a send that was not confirmed. */
export function parseSendResult(value: unknown): SendResult {
  const row = asRow(value);
  const status = text(row.status, 20);
  return {
    kind: text(row.kind, 20) === "left" ? "left" : "parked",
    status: status === "sent" || status === "stopped" ? status : "failed",
    error: text(row.error, 300),
  };
}

/** The sentence after a send: sent, paused by the customer, or not delivered. */
export function sendResultText(result: SendResult): string {
  if (result.status === "sent") return PARKING_WHATSAPP_SEND_COPY.sent;
  if (result.status === "stopped") return PARKING_WHATSAPP_SEND_COPY.stopped;
  return PARKING_WHATSAPP_SEND_COPY.failed;
}

/** The sentence for a refused send (`details.reason`), else the generic one. Never the raw message. */
export function sendRefusalText(error: unknown): string {
  return parkingWhatsAppRefusalText(error);
}

// ---------------------------------------------------------------------------
// The last status
// ---------------------------------------------------------------------------

export type LastStatus = { kind: string; status: string; error: string; atMs: number };

export function lastStatusRequest(businessId: string, carId: string) {
  return { action: "whatsapp_status", businessId, carId };
}

/** The last status, or null when no message was ever sent for the car. */
export function parseLastStatus(value: unknown): LastStatus | null {
  const row = asRow(value);
  const status = text(row.status, 20);
  if (!status) return null;
  const atMs = Number(row.atMs);
  return {
    kind: text(row.kind, 20),
    status,
    error: text(row.error, 300),
    atMs: Number.isFinite(atMs) && atMs > 0 ? atMs : 0,
  };
}

/** A sent message is a fact of a moment; the status the callable just returned becomes the new line. */
export function statusFromSend(result: SendResult, nowMs: number): LastStatus {
  return { kind: result.kind, status: result.status, error: result.error, atMs: nowMs };
}

/** "Nov 9, 2026, 2:05 PM" / "9 nov. 2026 à 14 h 05": month first in English, 12-hour; French 24-hour as the app writes it. */
export function whatsappMomentText(atMs: number, lang: Lang = "en", timeZone?: string): string {
  const date = new Date(atMs);
  if (!Number.isFinite(date.getTime())) return "";
  if (lang === "en") {
    return new Intl.DateTimeFormat("en-US", {
      month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone,
    }).format(date);
  }
  const day = new Intl.DateTimeFormat("fr-CA", { month: "short", day: "numeric", year: "numeric", timeZone }).format(date);
  const time = new Intl.DateTimeFormat("fr-CA", { hour: "numeric", minute: "2-digit", hour12: false, timeZone }).format(date);
  return `${day} à ${time}`;
}

/**
 * The one line on the car: "WhatsApp: sent Nov 9, 2026, 2:05 PM" or
 * "WhatsApp: not delivered. Check the number.". Built in the page's language
 * because it carries a date.
 */
export function lastStatusLine(last: LastStatus | null, lang: Lang = "en", timeZone?: string): string {
  const fr = lang === "fr";
  if (!last) return fr ? "WhatsApp : aucun message envoyé" : "WhatsApp: nothing sent yet";
  const when = last.atMs > 0 ? whatsappMomentText(last.atMs, lang, timeZone) : "";
  const at = (en: string, frWord: string) =>
    fr ? `WhatsApp : ${frWord}${when ? ` le ${when}` : ""}` : `WhatsApp: ${en}${when ? ` ${when}` : ""}`;
  switch (last.status) {
    case "sent": return at("sent", "envoyé");
    case "delivered": return at("delivered", "distribué");
    case "read": return at("read", "lu");
    case "failed": return fr ? "WhatsApp : non distribué. Vérifiez le numéro." : "WhatsApp: not delivered. Check the number.";
    case "stopped": return fr ? "WhatsApp : en pause, le client a demandé l’arrêt" : "WhatsApp: paused, the customer asked to stop";
    case "queued": return fr ? "WhatsApp : en attente d’envoi" : "WhatsApp: waiting to be sent";
    default: return fr ? "WhatsApp : aucun message envoyé" : "WhatsApp: nothing sent yet";
  }
}

// ---------------------------------------------------------------------------
// A corrected phone number
// ---------------------------------------------------------------------------

const digitsOf = (value: unknown) => text(value, 40).replace(/\D+/g, "");

/** Whether an edit really moved the customer to another number (formatting alone is not a change). */
export function customerPhoneChanged(before: unknown, after: unknown): boolean {
  const next = digitsOf(after);
  return next.length > 0 && next !== digitsOf(before);
}

/**
 * Whether the save should say the last message will be resent: the number
 * changed on a car the business messages, with the switch on. The server
 * decides whether it can actually send (a number it cannot reach is skipped).
 */
export function phoneChangeResends(business: unknown, car: unknown, before: unknown, after: unknown): boolean {
  return parkingWhatsAppSendVisible(business, car) && customerPhoneChanged(before, after);
}

// ---------------------------------------------------------------------------
// Fixing the customer's contact: which callable a save uses
// ---------------------------------------------------------------------------

/** The edit form's fields, as strings. Only the three contact fields may change on a paid car. */
export type ParkingEditFields = {
  whose?: string;
  forStaffId?: string;
  ownerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  carMake?: string;
  carModel?: string;
  carYear?: string;
  vinNumber?: string;
  startDate?: string;
  endDate?: string;
  paymentMethod?: string;
};

const NON_CONTACT_FIELDS = [
  "whose", "forStaffId", "carMake", "carModel", "carYear", "vinNumber", "startDate", "endDate", "paymentMethod",
] as const;

const same = (a: unknown, b: unknown) => text(a, 200) === text(b, 200);

/** Which of the customer's name, phone and email the draft changes, under the server's field names. */
export function changedContactFields(original: ParkingEditFields, draft: ParkingEditFields): string[] {
  const out: string[] = [];
  if (!same(original.ownerName, draft.ownerName)) out.push("customerName");
  if (digitsOf(original.customerPhone) !== digitsOf(draft.customerPhone)) out.push("customerPhone");
  if (text(original.customerEmail, 180).toLowerCase() !== text(draft.customerEmail, 180).toLowerCase()) out.push("customerEmail");
  return out;
}

/** Whether the draft changes anything about the car or the stay itself (not the contact). */
export function changedStayFields(original: ParkingEditFields, draft: ParkingEditFields): boolean {
  return NON_CONTACT_FIELDS.some((field) => !same(original[field], draft[field]));
}

export type ParkingSaveRoute = "contact" | "full" | "none" | "blocked";

/**
 * Which callable a save of the edit form uses:
 * - "contact": `update_contact` - only name, phone or email changed (always
 *   allowed, even on a paid or left car, and it never touches money or dates);
 * - "full": the full edit, because the car or the stay changed (or nothing did
 *   and only the status may have);
 * - "none": a paid car with no contact change - nothing to save;
 * - "blocked": a paid car whose stay fields differ (the form keeps them read-only).
 */
export function parkingSaveRoute(original: ParkingEditFields, draft: ParkingEditFields, paid: boolean): ParkingSaveRoute {
  const contact = changedContactFields(original, draft).length > 0;
  const stay = changedStayFields(original, draft);
  if (paid) return stay ? "blocked" : contact ? "contact" : "none";
  if (stay) return "full";
  return contact ? "contact" : "full";
}

/** The `update_contact` request: only the fields that changed. */
export function updateContactRequest(businessId: string, carId: string, original: ParkingEditFields, draft: ParkingEditFields) {
  const changed = changedContactFields(original, draft);
  return {
    action: "update_contact",
    businessId,
    carId,
    ...(changed.includes("customerPhone") ? { customerPhone: text(draft.customerPhone, 40) } : {}),
    ...(changed.includes("customerName") ? { customerName: text(draft.ownerName, 120) } : {}),
    ...(changed.includes("customerEmail") ? { customerEmail: text(draft.customerEmail, 180).toLowerCase() } : {}),
  };
}

/** The fields `update_contact` says it changed. */
export function parseContactResult(value: unknown): { changed: string[] } {
  const list = asRow(value).changed;
  return { changed: Array.isArray(list) ? list.map((item) => text(item, 40)).filter(Boolean) : [] };
}

/** The resend note applies when the server really changed the phone and the car is one the business messages. */
export function contactSaveResends(business: unknown, car: unknown, changed: readonly string[]): boolean {
  return changed.includes("customerPhone") && parkingWhatsAppSendVisible(business, car);
}

/** A name and a phone must stay filled in (the server refuses an empty one too). */
export function contactDraftReasons(draft: ParkingEditFields): string[] {
  const out: string[] = [];
  if (!text(draft.ownerName)) out.push("customer_name_required");
  if (!text(draft.customerPhone)) out.push("customer_phone_required");
  return out;
}

/** The refusals of `update_contact` (`details.reason`), in words. */
export const PARKING_CONTACT_REFUSALS: Record<string, string> = {
  nothing_to_change: "Nothing changed.",
  customer_phone_required: "Enter the customer's phone number.",
  customer_name_required: "Enter the customer's name.",
  customer_email_invalid: "Enter a valid email address.",
  team_car: "A team member's car takes its name and number from the team member.",
  not_business_entered: "Only cars the business recorded can be changed here.",
  car_voided: "This car was voided.",
  unknown: "The parking record could not be updated.",
};

/** The sentence for a refused contact save. Never the raw server message. */
export function parkingContactRefusalText(error: unknown): string {
  const reason = text(asRow(asRow(error).details).reason, 80);
  return PARKING_CONTACT_REFUSALS[reason] ?? PARKING_CONTACT_REFUSALS.unknown;
}
