import { isValidPhone, normalizePhone } from "./phone.ts";

/**
 * Details a customer gives when they book without an account.
 *
 * A guest holds an anonymous Firebase session, which carries no email and no
 * phone, so everything the business needs to reach them travels with the
 * booking instead.
 */
export type GuestContact = {
  name: string;
  email: string;
  phone: string;
};

export type GuestContactField = "name" | "email" | "phone";

/**
 * Deliberately permissive, and the same shape the backend applies. Whether an
 * address exists is settled by the confirmation email arriving, not by a
 * regex.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const NAME_MAX = 120;
const EMAIL_MAX = 254;

export function normalizeGuestContact(raw: Partial<GuestContact>): GuestContact {
  return {
    name: (raw.name ?? "").trim().slice(0, NAME_MAX),
    email: (raw.email ?? "").trim().toLowerCase().slice(0, EMAIL_MAX),
    phone: normalizePhone(raw.phone ?? ""),
  };
}

/**
 * Names every field that is not yet usable, so the form can mark all of them
 * at once rather than revealing one problem per attempt.
 */
export function guestContactProblems(
  raw: Partial<GuestContact>,
): GuestContactField[] {
  const contact = normalizeGuestContact(raw);
  const problems: GuestContactField[] = [];
  if (!contact.name) problems.push("name");
  if (!EMAIL_SHAPE.test(contact.email)) problems.push("email");
  if (!isValidPhone(contact.phone)) problems.push("phone");
  return problems;
}

export function isGuestContactComplete(raw: Partial<GuestContact>) {
  return guestContactProblems(raw).length === 0;
}

const STORAGE_KEY = "laawol.guest-contact";

/**
 * Kept in sessionStorage because checkout leaves the site for Stripe and
 * comes back: the contact has to survive that round trip, but it has no
 * business outliving the tab.
 */
export function rememberGuestContact(contact: GuestContact) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(contact));
  } catch {
    // A browser with storage blocked still completes the booking - the
    // contact simply does not survive the redirect back.
  }
}

export function recallGuestContact(): GuestContact | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = normalizeGuestContact(JSON.parse(raw) as GuestContact);
    return isGuestContactComplete(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function forgetGuestContact() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to do: the value expires with the tab regardless.
  }
}
