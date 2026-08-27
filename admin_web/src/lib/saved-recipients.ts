/**
 * Remembered recipients on the web console (docs/PLAN-2026-08-backlog.md #7).
 *
 * The server already writes `users/{uid}/savedRecipients/{phoneDigits}` on
 * every barrel/freight send (functions/saved_recipients.js) and the mobile app
 * already offers them back (lib/services/saved_recipient_service.dart). This is
 * the web half, kept deliberately close to the mobile service so the two
 * clients behave the same.
 *
 * Pure by design - no Firestore, no React - so the matching rules can be
 * tested without a browser. The subscription lives in the hook that uses it.
 */

import { text } from "./format.ts";

/** Someone this customer has shipped to before. */
export type SavedRecipient = {
  id: string;
  name: string;
  phone: string;
  phoneKey: string;
  countryId: string;
  countryName: string;
  address: string;
  whatsappOnly: boolean;
  useCount: number;
};

/** Path of the collection the server writes and the owner may read. */
export function savedRecipientsPath(uid: string): [string, string, string] {
  return ["users", uid, "savedRecipients"];
}

/** How many recipients are kept in memory (mirrors the mobile service). */
export const SAVED_RECIPIENT_LIMIT = 50;

/** How many completions a receiver-name input offers at once. */
export const SAVED_RECIPIENT_SUGGESTION_LIMIT = 4;

/** Digits-only form of a phone number - the server's identity key. */
export function savedRecipientDigits(value: string) {
  return String(value || "").replace(/\D/g, "");
}

/** Reads one stored recipient, tolerating a document written before a field. */
export function savedRecipientFromData(
  id: string,
  data: Record<string, unknown>,
): SavedRecipient {
  const phone = text(data.phone, "");
  return {
    id,
    name: text(data.name, ""),
    phone,
    phoneKey: text(data.phoneKey, "") || savedRecipientDigits(phone),
    countryId: text(data.countryId, ""),
    countryName: text(data.countryName, ""),
    address: text(data.address, ""),
    whatsappOnly: data.whatsappOnly === true,
    useCount: Number(data.useCount || 0),
  };
}

/** A recipient is only worth offering when it can fill something in. */
export function savedRecipientIsUsable(recipient: SavedRecipient) {
  return Boolean(recipient.name && recipient.phone);
}

/**
 * True when this recipient is a plausible completion for what has been typed
 * so far. Matching the phone too means a customer who starts with the number
 * still gets the profile.
 *
 * Digits in the query only ever match the phone and letters only ever match
 * the name, so typing a name never dumps the whole address book on screen.
 */
export function savedRecipientMatches(
  recipient: SavedRecipient,
  search: string,
) {
  const trimmed = search.trim().toLowerCase();
  if (!trimmed) return false;
  if (recipient.name.toLowerCase().includes(trimmed)) return true;
  const digits = savedRecipientDigits(trimmed);
  if (!digits) return false;
  const phoneDigits =
    recipient.phoneKey || savedRecipientDigits(recipient.phone);
  return phoneDigits.includes(digits);
}

/**
 * The completions to offer for what the customer has typed.
 *
 * An exact name hit is dropped: they already picked that person, so
 * re-offering them only covers the fields they are trying to read.
 */
export function matchingSavedRecipients(
  recipients: readonly SavedRecipient[],
  search: string,
  max = SAVED_RECIPIENT_SUGGESTION_LIMIT,
): SavedRecipient[] {
  const trimmed = search.trim().toLowerCase();
  if (!trimmed) return [];
  return recipients
    .filter(savedRecipientIsUsable)
    .filter((recipient) => savedRecipientMatches(recipient, search))
    .filter((recipient) => recipient.name.toLowerCase() !== trimmed)
    .slice(0, max);
}
