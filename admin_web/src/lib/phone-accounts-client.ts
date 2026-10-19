/**
 * The `phoneAccount` callable and the Firebase phone-auth pieces the web
 * uses (docs/PHONE_ACCOUNTS.md §5-7). Thin glue: every answer is read by the
 * pure parsers in phone-accounts.ts, and every refusal is mapped there.
 */

import { httpsCallable } from "firebase/functions";
import {
  PhoneAuthProvider,
  RecaptchaVerifier,
  signInWithCredential,
  signInWithCustomToken,
  signInWithPhoneNumber,
  signOut,
  type AuthCredential,
  type ConfirmationResult,
} from "firebase/auth";

import { auth, functions, withSecondaryAuth } from "@/lib/firebase";
import { currentWebLanguage } from "@/lib/language";
import {
  PHONE_ACCOUNT_CALLABLE,
  parseMyShipmentsPage,
  parsePhoneCodeChallenge,
  parsePhoneLinkResult,
  parsePhoneSignInToken,
  phoneRefusalOf,
  withTimeout,
  type MyShipmentsCursor,
  type MyShipmentsPage,
  type PhoneAccountAction,
  type PhoneCodeChallenge,
  type PhoneLinkResult,
  type PhoneRole,
  type PhoneSignInToken,
} from "@/lib/phone-accounts";

/** A callable never keeps a button spinning longer than this. */
const CALL_TIMEOUT_MS = 30_000;
/** Firebase's own SMS send (reCAPTCHA + network): the profile's limit. */
export const PHONE_AUTH_TIMEOUT_MS = 60_000;

async function callPhoneAccount(action: PhoneAccountAction, data: Record<string, unknown> = {}) {
  const call = httpsCallable(functions, PHONE_ACCOUNT_CALLABLE, { timeout: CALL_TIMEOUT_MS });
  const result = await call({ ...data, action });
  return result.data;
}

export type PhoneCodeRequest =
  | { phone: string; purpose?: "link" }
  | { trackingCode: string; role: PhoneRole };

export async function requestPhoneLoginCode(request: PhoneCodeRequest): Promise<PhoneCodeChallenge> {
  return parsePhoneCodeChallenge(await callPhoneAccount("requestPhoneLoginCode", request));
}

/** A sign-in code: mints the custom token. */
export async function verifyPhoneSignInCode(challengeId: string, code: string): Promise<PhoneSignInToken> {
  return parsePhoneSignInToken(await callPhoneAccount("verifyPhoneLoginCode", { challengeId, code }));
}

/** A link code (the signed-in account proving a number): {linked, merged}. */
export async function verifyPhoneLinkCode(challengeId: string, code: string): Promise<PhoneLinkResult> {
  return parsePhoneLinkResult(await callPhoneAccount("verifyPhoneLoginCode", { challengeId, code }));
}

/** A WhatsApp code's token, signed in on the page's own Auth. */
export async function signInWithPhoneToken(token: PhoneSignInToken) {
  return withTimeout(signInWithCustomToken(auth, token.customToken), CALL_TIMEOUT_MS, {
    code: "auth/verification-timeout",
  });
}

const completedSignIns = new Map<string, Promise<unknown>>();

/**
 * completePhoneSignIn({}) after an SMS sign-in, once per account per page:
 * the sign-in form and the console router may both ask for it (the router
 * when the profile is not there yet), and only one call goes out. A failed
 * call is forgotten so the next caller tries again.
 */
export function completePhoneSignInOnce(uid: string): Promise<unknown> {
  const existing = completedSignIns.get(uid);
  if (existing) return existing;
  const pending = callPhoneAccount("completePhoneSignIn", {}).catch(async (error) => {
    completedSignIns.delete(uid);
    // Phone sign-in is for customers only: an account with business or
    // platform access that got in by text is signed straight out again.
    if (phoneRefusalOf(error).reason === "phone_sign_in_unavailable") {
      await signOut(auth).catch(() => undefined);
    }
    throw error;
  });
  completedSignIns.set(uid, pending);
  return pending;
}

/**
 * The SMS merge proof (§7): signs the placeholder's phone credential in on a
 * secondary app, takes its ID token, signs it out, and asks the server to
 * move the number onto the signed-in (email) account.
 */
export async function linkPhoneFromCredential(credential: AuthCredential): Promise<PhoneLinkResult> {
  const placeholderIdToken = await withTimeout(
    withSecondaryAuth(async (secondary) => {
      const signedIn = await signInWithCredential(secondary, credential);
      return signedIn.user.getIdToken();
    }),
    CALL_TIMEOUT_MS,
    { code: "auth/verification-timeout" },
  );
  return parsePhoneLinkResult(await callPhoneAccount("completePhoneSignIn", { placeholderIdToken }));
}

/** The phone credential Firebase hands back with credential-already-in-use. */
export function phoneCredentialFromError(error: unknown): AuthCredential | null {
  try {
    return PhoneAuthProvider.credentialFromError(error as Parameters<typeof PhoneAuthProvider.credentialFromError>[0]);
  } catch {
    return null;
  }
}

export async function getMyShipments(cursor: MyShipmentsCursor | null): Promise<MyShipmentsPage> {
  return parseMyShipmentsPage(await callPhoneAccount("getMyShipments", cursor ? { cursor } : {}));
}

export async function reportShipmentNotMine(key: string, role: PhoneRole) {
  await callPhoneAccount("reportShipmentNotMine", { key, role });
}

/**
 * The invisible reCAPTCHA every web SMS uses (the profile verification
 * builds it the same way). `containerId` names an empty element that stays
 * mounted while the verifier lives; clear() it when done or after a failure.
 */
export function invisibleRecaptcha(containerId: string): RecaptchaVerifier {
  return new RecaptchaVerifier(auth, containerId, { size: "invisible" });
}

/** Firebase SMS sign-in ("Send it by text instead"). */
export async function sendSignInText(phone: string, verifier: RecaptchaVerifier): Promise<ConfirmationResult> {
  auth.languageCode = currentWebLanguage();
  return withTimeout(signInWithPhoneNumber(auth, phone, verifier), PHONE_AUTH_TIMEOUT_MS, {
    code: "auth/verification-timeout",
  });
}
