/**
 * Pure guest-session rules, kept off Firebase so they can be unit-tested.
 *
 * The web guest path has two jobs after the customer fills the form:
 * start an anonymous session, then continue the submission that opened the
 * sheet. Mixing those with the console's profile boot is what turned a
 * sign-in error into "Check your connection" and dumped the customer back
 * on Review & pay with no Stripe.
 */

export type AuthenticationRequiredHandler = () =>
  | void
  | boolean
  | Promise<boolean | void>;

/**
 * Gate for a submit that may be a guest or a signed-in customer.
 *
 * A signed-in customer never opens the continuation sheet: that path is
 * working live and must not grow a guest-only round trip. A guest whose
 * details are already in hand also skips it. Anyone else waits for the
 * sheet; only an explicit `true` (guest continued, or they signed in)
 * lets the submit proceed to payment.
 */
export async function ensureGuestOrAccount(input: {
  authenticated: boolean;
  guestReady?: boolean;
  requestContinuation?: AuthenticationRequiredHandler;
}): Promise<boolean> {
  if (input.authenticated || input.guestReady) return true;
  return (await input.requestContinuation?.()) === true;
}

/**
 * Starts the anonymous session a guest booking needs.
 *
 * If the caller is already anonymous, this is a no-op: calling
 * `signInAnonymously` again races the console's forced token refresh and
 * was surfacing as a fake network error. If the sign-in promise rejects
 * after the user is already anonymous, that is still success — the session
 * is what the booking needs, not the promise.
 */
export async function completeGuestSignIn(input: {
  isAnonymous: boolean;
  signInAnonymously: () => Promise<unknown>;
  isAnonymousAfter: () => boolean;
  waitForAppCheck?: () => Promise<void>;
}): Promise<void> {
  if (input.isAnonymous) return;
  await input.waitForAppCheck?.();
  try {
    await input.signInAnonymously();
  } catch (error) {
    if (input.isAnonymousAfter()) return;
    throw error;
  }
}

/**
 * Maps a guest-session failure to copy. The connection line is only for an
 * actual network error; anything else was being masked by it.
 */
export function guestSessionErrorMessage(error: unknown): string {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as {code: unknown}).code)
      : "";
  const message = error instanceof Error ? error.message : String(error ?? "");
  const blob = `${code} ${message}`.toLowerCase();
  if (blob.includes("network-request-failed")) {
    return "We could not continue. Check your connection and try again.";
  }
  if (blob.includes("too-many-requests")) {
    return "Too many attempts. Wait a few minutes and try again.";
  }
  return "We could not start guest checkout. Try again, or use a Laawol account.";
}
