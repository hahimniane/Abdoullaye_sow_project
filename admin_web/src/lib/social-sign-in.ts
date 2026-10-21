/**
 * Sign in with Google on the consoles (admin., business. and customer.):
 * the pure half, unit-tested in social-sign-in.test.ts. The Firebase glue is
 * social-sign-in-client.ts; the button is components/google-sign-in-button.tsx.
 *
 * One email is one account in this project, so a Google sign-in with an
 * email that already has an account opens THAT account (same uid, role and
 * business). A brand-new Google account gets a plain customer profile from
 * `createMissingUserProfile({self: true})` (functions social_sign_in.js) - never
 * business or platform access; an invitation waiting for that person is
 * left to the existing invitation setup.
 */

/**
 * The callable and payload that finish a social sign-in: the profile-repair
 * callable, for the caller's own missing profile (functions index.js).
 */
export const COMPLETE_SOCIAL_SIGN_IN_CALLABLE = "createMissingUserProfile";
export const COMPLETE_SOCIAL_SIGN_IN_PAYLOAD = Object.freeze({self: true});

export const SOCIAL_PROVIDER_IDS = ["google.com", "apple.com"] as const;

/** True for an account that signs in with Google or Apple. */
export function isSocialAccount(
  providerData: ReadonlyArray<{providerId?: string | null}> | null | undefined,
): boolean {
  return (providerData ?? []).some((entry) =>
    (SOCIAL_PROVIDER_IDS as readonly string[]).includes(entry?.providerId ?? ""),
  );
}

/** What the server did for a Google sign-in. */
export type SocialProfileAnswer = {
  profileCreated: boolean;
  invitationPending: boolean;
};

export function parseSocialProfileAnswer(data: unknown): SocialProfileAnswer {
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  return {
    profileCreated: record.profileCreated === true,
    invitationPending: record.invitationPending === true,
  };
}

/** The person closed the Google window: nothing to show. */
export function isSocialCancel(code: string): boolean {
  return [
    "auth/popup-closed-by-user",
    "auth/cancelled-popup-request",
    "auth/user-cancelled",
  ].includes(code);
}

/** The browser would not open the window: sign in by redirect instead. */
export function needsRedirectFallback(code: string): boolean {
  return [
    "auth/popup-blocked",
    "auth/operation-not-supported-in-environment",
  ].includes(code);
}

export const SOCIAL_SIGN_IN_COPY = {
  accountExists:
    "This email already has a Laawol account. Sign in with your email and password once, and Google will be linked to it.",
  network: "Network error. Check your connection and try again.",
  tooManyRequests: "Too many attempts. Try again later.",
  disabled: "This account is disabled. Contact Laawol support.",
  unavailable: "Google sign-in is not available here right now. Sign in with your email instead.",
  failed: "We couldn’t sign you in with Google. Try again, or sign in another way.",
  profileFailed: "We couldn’t finish setting up your account. Try again.",
} as const;

/** The message for a failed Google sign-in (French via french-dom). */
export function socialSignInErrorMessage(code: string): string {
  switch (code) {
    case "auth/account-exists-with-different-credential":
    case "auth/credential-already-in-use":
    case "auth/email-already-in-use":
      return SOCIAL_SIGN_IN_COPY.accountExists;
    case "auth/network-request-failed":
      return SOCIAL_SIGN_IN_COPY.network;
    case "auth/too-many-requests":
      return SOCIAL_SIGN_IN_COPY.tooManyRequests;
    case "auth/user-disabled":
      return SOCIAL_SIGN_IN_COPY.disabled;
    case "auth/operation-not-allowed":
    case "auth/unauthorized-domain":
    case "auth/configuration-not-found":
      return SOCIAL_SIGN_IN_COPY.unavailable;
    default:
      return SOCIAL_SIGN_IN_COPY.failed;
  }
}

/** The Firebase error code of anything thrown, or "". */
export function errorCodeOf(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as {code?: unknown}).code ?? "");
  }
  return "";
}

/**
 * Link the Google credential that bumped into an existing account once the
 * person signs into that account with its password - only for the same
 * email, so a shared computer never ties one person's Google account to
 * someone else's Laawol account.
 */
export function shouldLinkPendingCredential(
  pendingEmail: string | null | undefined,
  signedInEmail: string | null | undefined,
): boolean {
  const pending = (pendingEmail ?? "").trim().toLowerCase();
  return pending !== "" && pending === (signedInEmail ?? "").trim().toLowerCase();
}
