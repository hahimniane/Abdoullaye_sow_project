"use client";

import { getToken } from "firebase/app-check";
import { signInAnonymously } from "firebase/auth";

import { appCheck, auth } from "./firebase.ts";
import {
  isGuestContactComplete,
  normalizeGuestContact,
  recallGuestContact,
  rememberGuestContact,
  type GuestContact,
} from "./guest-contact.ts";
import { completeGuestSignIn } from "./guest-session.ts";

export {
  ensureGuestOrAccount,
  guestSessionErrorMessage,
  type AuthenticationRequiredHandler,
} from "./guest-session.ts";

async function waitForAppCheckToken() {
  if (!appCheck) return;
  try {
    await getToken(appCheck, false);
  } catch {
    // A missing token is not fatal here: Auth still tries, and we'd rather
    // surface that error than invent a network failure.
  }
}

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

/**
 * Stores the guest's contact and ensures an anonymous Firebase session.
 *
 * The booking that follows reads the contact back out of memory / storage,
 * so this has to succeed before checkout is allowed to run.
 */
export async function beginGuestSession(contact: GuestContact) {
  const normalized = normalizeGuestContact(contact);
  if (!isGuestContactComplete(normalized)) {
    throw new Error("Enter your contact details to continue");
  }
  rememberGuestContact(normalized);
  await completeGuestSignIn({
    isAnonymous: auth.currentUser?.isAnonymous === true,
    signInAnonymously: () => signInAnonymously(auth),
    isAnonymousAfter: () => auth.currentUser?.isAnonymous === true,
    waitForAppCheck: waitForAppCheckToken,
  });
}
