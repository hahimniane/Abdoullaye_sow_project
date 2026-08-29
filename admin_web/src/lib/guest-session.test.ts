import assert from "node:assert/strict";
import test from "node:test";

import { translateValue } from "./french-dom.ts";
import {
  completeGuestSignIn,
  ensureGuestOrAccount,
  guestSessionErrorMessage,
} from "./guest-session.ts";
import {
  forgetGuestContact,
  recallGuestContact,
  rememberGuestContact,
} from "./guest-contact.ts";

test("a signed-in customer never opens the guest continuation sheet", async () => {
  let asked = 0;
  const ready = await ensureGuestOrAccount({
    authenticated: true,
    guestReady: false,
    requestContinuation: () => {
      asked += 1;
      return true;
    },
  });
  assert.equal(ready, true);
  assert.equal(asked, 0);
});

test("a guest whose details are already in hand skips the sheet", async () => {
  let asked = 0;
  const ready = await ensureGuestOrAccount({
    authenticated: false,
    guestReady: true,
    requestContinuation: () => {
      asked += 1;
      return true;
    },
  });
  assert.equal(ready, true);
  assert.equal(asked, 0);
});

test("Continue as guest has to resolve true before checkout proceeds", async () => {
  assert.equal(
    await ensureGuestOrAccount({
      authenticated: false,
      requestContinuation: async () => undefined,
    }),
    false,
  );
  assert.equal(
    await ensureGuestOrAccount({
      authenticated: false,
      requestContinuation: async () => false,
    }),
    false,
  );
  assert.equal(
    await ensureGuestOrAccount({
      authenticated: false,
      requestContinuation: async () => true,
    }),
    true,
  );
});

test("an already-anonymous session is not signed in again", async () => {
  let signedIn = 0;
  await completeGuestSignIn({
    isAnonymous: true,
    signInAnonymously: async () => {
      signedIn += 1;
    },
    isAnonymousAfter: () => true,
  });
  assert.equal(signedIn, 0);
});

test("a sign-in that rejects after the session exists is still success", async () => {
  // The console's auth listener used to force a token refresh in the same
  // tick, which rejected signInAnonymously even though the guest was signed
  // in. Treating that as a connection error blocked Stripe.
  let user = {isAnonymous: false};
  await completeGuestSignIn({
    isAnonymous: false,
    signInAnonymously: async () => {
      user = {isAnonymous: true};
      throw new Error("auth/network-request-failed");
    },
    isAnonymousAfter: () => user.isAnonymous,
  });
});

test("a real sign-in failure is not reported as a connection problem", () => {
  assert.equal(
    guestSessionErrorMessage({code: "auth/network-request-failed"}),
    "We could not continue. Check your connection and try again.",
  );
  assert.equal(
    guestSessionErrorMessage({code: "auth/too-many-requests"}),
    "Too many attempts. Wait a few minutes and try again.",
  );
  assert.equal(
    guestSessionErrorMessage({code: "auth/operation-not-allowed"}),
    "We could not start guest checkout. Try again, or use a Laawol account.",
  );
  assert.equal(
    guestSessionErrorMessage(new Error("app-check")),
    "We could not start guest checkout. Try again, or use a Laawol account.",
  );
});

test("guest checkout failure copy is localized in French", () => {
  for (const english of [
    "We could not continue. Check your connection and try again.",
    "We could not start guest checkout. Try again, or use a Laawol account.",
    "Too many attempts. Wait a few minutes and try again.",
  ]) {
    const french = translateValue(english, "fr");
    assert.notEqual(french, english, english);
    assert.ok(french.length > 0, english);
  }
});

test("a guest's contact is kept in memory even when storage is blocked", () => {
  forgetGuestContact();
  rememberGuestContact({
    name: "Guest QA",
    email: "guest.qa.laawol@example.com",
    phone: "+12015550100",
  });
  assert.deepEqual(recallGuestContact(), {
    name: "Guest QA",
    email: "guest.qa.laawol@example.com",
    phone: "+12015550100",
  });
  forgetGuestContact();
  assert.equal(recallGuestContact(), null);
});
