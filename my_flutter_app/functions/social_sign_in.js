"use strict";

/**
 * Sign in with Google / Apple (app and consoles).
 *
 * Firebase Auth does the sign-in on the client. One email is one account in
 * this project, so a Google sign-in with an email that already has an
 * account lands on THAT account (same uid, same profile, same role) and
 * this callable leaves it alone. A brand-new Google or Apple account has no
 * `users/{uid}` profile yet: `completeSocialSignIn` (served by the
 * createMissingUserProfile callable with {self: true}) gives it one - always a
 * plain customer, exactly like a sign-up (createCustomerUser) - unless an
 * access invitation is waiting for that person, in which case the existing
 * invitation flow (acceptAccessInvitation) owns what the profile becomes.
 *
 * Nothing here can grant staff, owner or admin access.
 *
 * The pure half (`socialProviderOf`, `socialCustomerProfile`) is unit-tested
 * in test/social-sign-in.test.js together with the handler, which takes
 * everything Firebase-specific through `deps`.
 */

const {HttpsError} = require("firebase-functions/v2/https");

const SOCIAL_PROVIDERS = Object.freeze(["google.com", "apple.com"]);

/**
 * The social provider an Auth user signs in with, if any.
 *
 * @param {object} userRecord An Auth UserRecord (or its JSON).
 * @param {string} tokenProvider The ID token's firebase.sign_in_provider.
 * @return {string} "google.com", "apple.com" or "".
 */
function socialProviderOf(userRecord, tokenProvider = "") {
  if (SOCIAL_PROVIDERS.includes(tokenProvider)) return tokenProvider;
  const linked = (userRecord?.providerData || [])
      .map((entry) => String(entry?.providerId || ""))
      .find((providerId) => SOCIAL_PROVIDERS.includes(providerId));
  return linked || "";
}

/**
 * The customer profile a new social account starts with: the same fields a
 * sign-up writes (createCustomerUser), minus what Google/Apple do not give
 * us. Apple shares a name only on the very first sign-in and may share a
 * relay address instead of the real email; both are kept as given.
 *
 * @param {object} userRecord An Auth UserRecord.
 * @param {string} provider "google.com" | "apple.com".
 * @return {object} The profile fields (timestamps added by the caller).
 */
function socialCustomerProfile(userRecord, provider) {
  const email = String(userRecord?.email || "").trim().toLowerCase();
  const fullName = String(userRecord?.displayName || "").trim().slice(0, 120);
  const phone = String(userRecord?.phoneNumber || "").trim();
  return {
    email,
    fullName,
    phone,
    role: "customer",
    signUpMethod: provider === "apple.com" ? "apple" : "google",
  };
}

/**
 * @param {object} deps Firebase pieces: db(), auth(), FieldValue,
 *   defaultNotificationPreferences(), pendingInvitationsFor(uid, email,
 *   phone), normalizePhone(phone), logger.
 * @return {{completeSocialSignIn: function(object): Promise<object>}} The
 *   handler.
 */
function createSocialSignIn(deps) {
  /**
   * completeSocialSignIn: after a Google or Apple sign-in.
   *
   * @param {object} request The callable request.
   * @return {Promise<{profileCreated: boolean, invitationPending: boolean}>}
   *   What happened to the caller's profile.
   */
  async function completeSocialSignIn(request) {
    const uid = request.auth?.uid;
    const tokenProvider =
      String(request.auth?.token?.firebase?.sign_in_provider || "");
    if (!uid || tokenProvider === "anonymous") {
      throw new HttpsError("unauthenticated", "Sign in first",
          {reason: "sign_in_required"});
    }
    const userRef = deps.db().collection("users").doc(uid);
    const existing = await userRef.get();
    // An existing account keeps everything: role, business, history.
    if (existing.exists) {
      return {profileCreated: false, invitationPending: false};
    }
    const userRecord = await deps.auth().getUser(uid);
    const provider = socialProviderOf(userRecord, tokenProvider);
    if (!provider) {
      throw new HttpsError("failed-precondition",
          "Sign in with Google or Apple first",
          {reason: "not_social_sign_in"});
    }
    const verifiedEmail = userRecord.emailVerified && userRecord.email ?
      String(userRecord.email).toLowerCase() : "";
    const pending = await deps.pendingInvitationsFor(uid, verifiedEmail,
        String(userRecord.phoneNumber || ""));
    if (pending.length) {
      // The invitation decides this account's profile.
      return {profileCreated: false, invitationPending: true};
    }
    const fields = socialCustomerProfile(userRecord, provider);
    const now = deps.FieldValue.serverTimestamp();
    try {
      // create(): a second call (double tap, two devices) never overwrites.
      await userRef.create({
        ...fields,
        ...(fields.phone ?
          {normalizedPhone: deps.normalizePhone(fields.phone)} : {}),
        notificationPreferences: deps.defaultNotificationPreferences(),
        createdAt: now,
        updatedAt: now,
      });
    } catch (error) {
      if (error?.code === 6 || error?.code === "already-exists") {
        return {profileCreated: false, invitationPending: false};
      }
      deps.logger?.error?.("completeSocialSignIn profile create failed", {
        uid, error: error instanceof Error ? error.message : String(error),
      });
      throw new HttpsError("internal", "Could not create account profile",
          {reason: "profile_create_failed"});
    }
    return {profileCreated: true, invitationPending: false};
  }

  return {completeSocialSignIn};
}

module.exports = {
  SOCIAL_PROVIDERS,
  createSocialSignIn,
  socialCustomerProfile,
  socialProviderOf,
};
