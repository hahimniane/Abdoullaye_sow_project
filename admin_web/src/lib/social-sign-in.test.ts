import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { ATTRIBUTE_TRANSLATIONS, TEXT_TRANSLATIONS, translateValue } from "./french-dom.ts";
import { screenStrings } from "./screen-strings.ts";
import {
  COMPLETE_SOCIAL_SIGN_IN_CALLABLE,
  COMPLETE_SOCIAL_SIGN_IN_PAYLOAD,
  SOCIAL_SIGN_IN_COPY,
  errorCodeOf,
  isSocialAccount,
  isSocialCancel,
  needsRedirectFallback,
  parseSocialProfileAnswer,
  shouldLinkPendingCredential,
  socialSignInErrorMessage,
} from "./social-sign-in.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("only Google and Apple accounts finish a social sign-in", () => {
  assert.equal(isSocialAccount([{providerId: "google.com"}]), true);
  assert.equal(isSocialAccount([{providerId: "password"}, {providerId: "apple.com"}]), true);
  assert.equal(isSocialAccount([{providerId: "password"}]), false);
  assert.equal(isSocialAccount([{providerId: "phone"}]), false);
  assert.equal(isSocialAccount([]), false);
  assert.equal(isSocialAccount(undefined), false);
});

test("the server's answer is read strictly", () => {
  assert.deepEqual(parseSocialProfileAnswer({profileCreated: true}), {
    profileCreated: true,
    invitationPending: false,
  });
  assert.deepEqual(parseSocialProfileAnswer({invitationPending: true}), {
    profileCreated: false,
    invitationPending: true,
  });
  assert.deepEqual(parseSocialProfileAnswer(null), {
    profileCreated: false,
    invitationPending: false,
  });
  assert.deepEqual(parseSocialProfileAnswer({profileCreated: "yes"}), {
    profileCreated: false,
    invitationPending: false,
  });
});

test("closing the Google window is silent; a blocked popup redirects", () => {
  assert.equal(isSocialCancel("auth/popup-closed-by-user"), true);
  assert.equal(isSocialCancel("auth/cancelled-popup-request"), true);
  assert.equal(isSocialCancel("auth/popup-blocked"), false);
  assert.equal(needsRedirectFallback("auth/popup-blocked"), true);
  assert.equal(needsRedirectFallback("auth/popup-closed-by-user"), false);
  assert.equal(needsRedirectFallback("auth/network-request-failed"), false);
});

test("each failure has its own message, never Firebase's English", () => {
  assert.equal(
    socialSignInErrorMessage("auth/account-exists-with-different-credential"),
    SOCIAL_SIGN_IN_COPY.accountExists,
  );
  assert.equal(socialSignInErrorMessage("auth/network-request-failed"), SOCIAL_SIGN_IN_COPY.network);
  assert.equal(socialSignInErrorMessage("auth/unauthorized-domain"), SOCIAL_SIGN_IN_COPY.unavailable);
  assert.equal(socialSignInErrorMessage("auth/internal-error"), SOCIAL_SIGN_IN_COPY.failed);
  assert.equal(socialSignInErrorMessage(""), SOCIAL_SIGN_IN_COPY.failed);
  assert.equal(errorCodeOf({code: "auth/popup-blocked"}), "auth/popup-blocked");
  assert.equal(errorCodeOf(new Error("x")), "");
  assert.equal(errorCodeOf(null), "");
});

test("a pending Google credential links only to the same email", () => {
  assert.equal(shouldLinkPendingCredential("Ada@Example.com", "ada@example.com"), true);
  assert.equal(shouldLinkPendingCredential("ada@example.com", "bob@example.com"), false);
  assert.equal(shouldLinkPendingCredential("", "ada@example.com"), false);
  assert.equal(shouldLinkPendingCredential(null, null), false);
});

test("the callable and payload match the server", () => {
  const server = readFileSync("../my_flutter_app/functions/index.js", "utf8");
  const start = server.indexOf(`exports.${COMPLETE_SOCIAL_SIGN_IN_CALLABLE} = onCall(`);
  assert.ok(start > 0);
  const handler = server.slice(start, start + 1200);
  assert.match(handler, /request\.data\?\.self === true/);
  assert.match(handler, /socialSignIn\.completeSocialSignIn\(request\)/);
  assert.deepEqual(COMPLETE_SOCIAL_SIGN_IN_PAYLOAD, {self: true});
});

function missingFrench(strings: readonly string[]): string[] {
  return strings.filter((english) => !(english in TEXT_TRANSLATIONS) && !(english in ATTRIBUTE_TRANSLATIONS));
}

test("every Google sign-in sentence has its French, and it converges", () => {
  const strings = [
    ...Object.values(SOCIAL_SIGN_IN_COPY),
    "Continue with Google",
    "Opening Google...",
    "or",
  ];
  assert.deepEqual(missingFrench(strings), []);
  for (const english of strings) {
    const french = translateValue(english, "fr");
    assert.notEqual(french, english, english);
    assert.equal(translateValue(french, "fr"), french, `${english} converges`);
  }
  const button = read("../components/google-sign-in-button.tsx");
  assert.ok(button.includes(`"Continue with Google"`));
  assert.ok(button.includes(`"Opening Google..."`));
  assert.deepEqual(missingFrench(screenStrings(button, "google-sign-in-button.tsx")), []);
});

test("every console sign-in offers Google, wired to the router", () => {
  const router = read("../components/console-router.tsx");
  // The shared sign-in card (admin., business. and customer. hosts).
  assert.match(router, /<GoogleSignInButton[\s\S]*?onBusyChange=\{setGoogleBusy\}/);
  // A first Google sign-in gets its profile before the router decides
  // there is none; an existing account never reaches the call.
  assert.match(router, /!snap\.exists\(\) && isSocialAccount\(user\.providerData\)/);
  assert.match(router, /completeSocialSignInOnce\(user\.uid\)/);
  // A password sign-in links a Google credential that found this account.
  assert.match(router, /linkPendingSocialCredential\(signedIn\.user\)/);
  // The Apple button is iOS-app only.
  assert.doesNotMatch(router, /Continue with Apple/);
});
