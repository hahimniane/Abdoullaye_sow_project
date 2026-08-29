"use client";

import { auth } from "./firebase.ts";
import { recallGuestContact } from "./guest-contact.ts";

/**
 * Attaches a guest's contact details to a callable payload.
 *
 * A guest holds an anonymous Firebase session, which carries no email and no
 * phone, so the details the business needs to reach them travel with the
 * request instead. Applied at the two places every service call passes
 * through - the checkout redirect and the plain callable helper - rather than
 * in each of the forms.
 *
 * A signed-in customer never carries the block, and the backend ignores one
 * even if it arrives: otherwise a stale block could redirect a real
 * customer's receipts.
 */
export function withGuestContact(payload: Record<string, unknown>) {
  if (!auth.currentUser?.isAnonymous) return payload;
  const guestContact = recallGuestContact();
  return guestContact ? { ...payload, guestContact } : payload;
}
