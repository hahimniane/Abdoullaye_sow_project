import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  guestContactProblems,
  isGuestContactComplete,
  normalizeGuestContact,
  readGuestContactDraft,
  rememberGuestContactDraft,
} from "./guest-contact.ts";
import { translateValue } from "./french-dom.ts";

const COMPLETE = {
  name: "  Mariama Diallo ",
  email: " Mariama@Example.COM ",
  phone: "+1 201 555 0147",
};

test("a guest's details are trimmed and lowercased", () => {
  assert.deepEqual(normalizeGuestContact(COMPLETE), {
    name: "Mariama Diallo",
    email: "mariama@example.com",
    phone: "+12015550147",
  });
  assert.equal(isGuestContactComplete(COMPLETE), true);
});

test("every unusable field is named at once", () => {
  // One problem revealed per attempt turns a single mistake into three
  // round trips through the form.
  assert.deepEqual(guestContactProblems({}), ["name", "email", "phone"]);
  assert.deepEqual(
    guestContactProblems({ name: "A", email: "nope", phone: "+12015550147" }),
    ["email"],
  );
  assert.deepEqual(
    guestContactProblems({ name: "A", email: "a@b.co", phone: "12" }),
    ["phone"],
  );
});

test("the sheet opens knowing what the form already collected", () => {
  // The booking form asks for the sender's name, then the continuation
  // sheet asked for it again from scratch - a guest read that as the page
  // having lost their work. The form parks a draft when it opens the
  // sheet, and the sheet seeds its fields from it.
  const store = new Map<string, string>();
  (globalThis as { sessionStorage?: unknown }).sessionStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
  try {
    rememberGuestContactDraft({ name: "  Mariama Diallo  " });
    assert.deepEqual(readGuestContactDraft(), { name: "Mariama Diallo" });
    // A draft is partial by design and never validated.
    rememberGuestContactDraft({ name: "M", email: "", phone: "" });
    assert.deepEqual(readGuestContactDraft(), { name: "M" });
    // An all-blank draft is not worth parking - the last real one stays.
    rememberGuestContactDraft({ name: "   " });
    assert.deepEqual(readGuestContactDraft(), { name: "M" });
  } finally {
    delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  }
  // Junk in storage prefills nothing rather than crashing the sheet.
  assert.deepEqual(readGuestContactDraft(), {});

  const panel = readFileSync("src/components/guest-contact-panel.tsx", "utf8");
  assert.match(panel, /readGuestContactDraft\(\)/);
  const shipping = readFileSync(
    "src/components/customer-shipping-services.tsx",
    "utf8",
  );
  // Every booking form that knows the sender's name hands it over: barrels,
  // freight, and car transport all gate their submit the same way.
  const drafts = shipping.match(/draft: \{name: senderName\}/g) || [];
  assert.ok(
    drafts.length >= 3,
    `every sender-name form passes a draft (saw ${drafts.length})`,
  );
});

test("a guest booking never needs a password", () => {
  // The whole point of the path: anonymous sign-in, no credential screen.
  const panel = readFileSync("src/components/guest-contact-panel.tsx", "utf8");
  const session = readFileSync("src/lib/guest-checkout.ts", "utf8");
  assert.match(panel, /beginGuestSession/);
  assert.match(panel, /guestSessionErrorMessage/);
  assert.doesNotMatch(panel, /type="password"/);
  assert.doesNotMatch(panel, /createUserWithEmailAndPassword/);
  assert.match(session, /signInAnonymously/);
  assert.match(session, /completeGuestSignIn/);
});

test("the guest block rides on every call, and only for a guest", () => {
  // A signed-in customer carrying a stale guest block would have their
  // receipts redirected to whatever address it held.
  const shared = readFileSync("src/lib/guest-checkout.ts", "utf8");
  assert.match(shared, /auth\.currentUser\?\.isAnonymous/);
  assert.match(shared, /return payload;/);

  // Both paths a booking can take have to attach it: the checkout redirect,
  // and the plain callable that asking a route for a price goes through.
  for (const path of [
    "src/lib/use-checkout.ts",
    "src/components/customer-shipping-services.tsx",
  ]) {
    assert.match(readFileSync(path, "utf8"), /withGuestContact/, path);
  }
});

test("shared barrels still require a real account", () => {
  // Strangers share one physical barrel, so the platform has to know who
  // they are. Guest checkout must not reach that service.
  const entry = readFileSync("src/components/customer-service-entry.tsx", "utf8");
  const guard = entry.match(/const guestAllowed =[\s\S]*?;/)?.[0] ?? "";
  assert.match(guard, /"barrel"/);
  assert.match(guard, /"freight"/);
  assert.doesNotMatch(guard, /shared-barrels/);
});

test("guest checkout copy is localized in French", () => {
  for (const english of [
    "Continue as guest",
    "Use a Laawol account instead",
    "Enter a valid phone number",
    "Your tracking number arrives by email. Keep it to follow this booking.",
    "We could not start guest checkout. Try again, or use a Laawol account.",
  ]) {
    const french = translateValue(english, "fr");
    assert.notEqual(french, english, english);
    assert.ok(french.length > 0, english);
  }
});

test("accepting a price leads to a booking on the web too", () => {
  // This shipped to Flutter first and stopped there, which is exactly the
  // split the parity rule exists to prevent: a customer on the web could
  // accept a price and still have nowhere to pay it.
  const shipping = readFileSync(
    "src/components/customer-shipping-services.tsx",
    "utf8",
  );
  assert.match(shipping, /onPriceAccepted/);
  assert.match(shipping, /agreedQuoteRequestId/);
  assert.match(shipping, /Fill in the receiver and the address below/);

  // The id travels, the amount never does - the server reads the agreed
  // price off the request the customer accepted.
  const payload = readFileSync("src/lib/customer-shipping.ts", "utf8");
  assert.match(payload, /quoteRequestId: trimmed\(fields\.quoteRequestId\)/);
  assert.doesNotMatch(payload, /agreedAmountCents/);
});
