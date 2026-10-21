/**
 * Sign in with Google on the consoles: the Firebase glue over the pure rules
 * in social-sign-in.ts. A popup first; a browser that blocks it signs in by
 * redirect, and the console router finishes the account when the page
 * comes back.
 */

import { httpsCallable } from "firebase/functions";
import {
  GoogleAuthProvider,
  getRedirectResult,
  linkWithCredential,
  signInWithPopup,
  signInWithRedirect,
  type AuthCredential,
  type User,
} from "firebase/auth";

import { auth, functions } from "@/lib/firebase";
import {
  COMPLETE_SOCIAL_SIGN_IN_CALLABLE,
  COMPLETE_SOCIAL_SIGN_IN_PAYLOAD,
  errorCodeOf,
  isSocialCancel,
  needsRedirectFallback,
  parseSocialProfileAnswer,
  shouldLinkPendingCredential,
  type SocialProfileAnswer,
} from "@/lib/social-sign-in";

const REDIRECT_FLAG = "laawol.googleRedirect";
const CALL_TIMEOUT_MS = 30_000;

/** A Google credential whose email already had an account (see linkPendingSocialCredential). */
let pending: {credential: AuthCredential; email: string} | null = null;

function googleProvider() {
  const provider = new GoogleAuthProvider();
  // Always ask which Google account: a shared computer must not slip into
  // the last person's account.
  provider.setCustomParameters({prompt: "select_account"});
  return provider;
}

function rememberPending(error: unknown) {
  if (errorCodeOf(error) !== "auth/account-exists-with-different-credential") return;
  const credential = GoogleAuthProvider.credentialFromError(error as never);
  const email = String(
    (error as {customData?: {email?: unknown}})?.customData?.email ?? "",
  );
  pending = credential ? {credential, email} : null;
}

/**
 * "Continue with Google". Resolves "signed-in" (the console router then
 * opens the account), "cancelled" (the window was closed - show nothing) or
 * "redirecting" (the page is leaving for Google). Throws anything else.
 */
export async function signInWithGoogle(): Promise<"signed-in" | "cancelled" | "redirecting"> {
  try {
    await signInWithPopup(auth, googleProvider());
    return "signed-in";
  } catch (error) {
    const code = errorCodeOf(error);
    if (isSocialCancel(code)) return "cancelled";
    if (needsRedirectFallback(code)) {
      try {
        window.sessionStorage.setItem(REDIRECT_FLAG, "1");
      } catch {
        // Without storage the router still finishes the account; only a
        // failure after the redirect goes unreported.
      }
      try {
        await signInWithRedirect(auth, googleProvider());
      } catch (redirectError) {
        // Refused before leaving the page (e.g. a domain Firebase does not
        // authorize): nothing comes back to report.
        try {
          window.sessionStorage.removeItem(REDIRECT_FLAG);
        } catch {
          // Nothing stored, nothing to clear.
        }
        throw redirectError;
      }
      return "redirecting";
    }
    rememberPending(error);
    throw error;
  }
}

/**
 * After a redirect sign-in comes back: its failure, if any (a success is
 * picked up by the console router like any sign-in). Only asks Firebase
 * when this page started a redirect.
 */
export async function googleRedirectError(): Promise<unknown> {
  let started = false;
  try {
    started = window.sessionStorage.getItem(REDIRECT_FLAG) === "1";
    window.sessionStorage.removeItem(REDIRECT_FLAG);
  } catch {
    return null;
  }
  if (!started) return null;
  try {
    await getRedirectResult(auth);
    return null;
  } catch (error) {
    if (isSocialCancel(errorCodeOf(error))) return null;
    rememberPending(error);
    return error;
  }
}

/**
 * After an email/password sign-in: attach the Google credential that
 * bumped into this account, so Continue with Google works next time. Never
 * blocks or fails the sign-in.
 */
export async function linkPendingSocialCredential(user: User): Promise<void> {
  const waiting = pending;
  pending = null;
  if (!waiting || !shouldLinkPendingCredential(waiting.email, user.email)) return;
  await linkWithCredential(user, waiting.credential).catch(() => undefined);
}

const completed = new Map<string, Promise<SocialProfileAnswer>>();

/**
 * createMissingUserProfile({self: true}) once per account per page: makes a new Google
 * account's customer profile (never business or platform access) and
 * leaves an existing or invited account alone. A failed call is forgotten
 * so the next attempt tries again.
 */
export function completeSocialSignInOnce(uid: string): Promise<SocialProfileAnswer> {
  const existing = completed.get(uid);
  if (existing) return existing;
  const call = httpsCallable(functions, COMPLETE_SOCIAL_SIGN_IN_CALLABLE, {
    timeout: CALL_TIMEOUT_MS,
  });
  const answer = call({...COMPLETE_SOCIAL_SIGN_IN_PAYLOAD})
    .then((result) => parseSocialProfileAnswer(result.data))
    .catch((error) => {
      completed.delete(uid);
      throw error;
    });
  completed.set(uid, answer);
  return answer;
}
