import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { consoleHostKind } from "./console-host.ts";
import { translateValue } from "./french-dom.ts";

test("each deployed host resolves to its own console kind", () => {
  assert.equal(consoleHostKind("business.laawoldigital.com"), "business");
  assert.equal(consoleHostKind("admin.laawoldigital.com"), "admin");
  assert.equal(consoleHostKind("customer.laawoldigital.com"), "customer");
  // Local previews and anything unrecognised behave as the customer host -
  // the only one where self-serve sign-up belongs.
  assert.equal(consoleHostKind("localhost"), "customer");
  assert.equal(consoleHostKind("BUSINESS.LAAWOLDIGITAL.COM"), "business");
});

test("the business console offers no customer sign-up", () => {
  // The business host showed "Create your customer account": the account it
  // created was routed straight back to the customer workspace, and the
  // real business path (the partner application) was hidden behind that
  // dead-end sign-up form.
  const router = readFileSync("src/components/console-router.tsx", "utf8");
  assert.match(router, /consoleHostKind\(window\.location\.hostname\)/);
  // The sign-up tab only exists on the customer host...
  assert.match(router, /\{customerSignUp && \(/);
  // ...a sign-up mode carried in from elsewhere falls back to sign-in...
  assert.match(
    router,
    /current === "sign-up" \? "sign-in" : current/,
  );
  // ...and the partner-application link stands on the business sign-in view
  // where the sign-up tab used to be.
  assert.match(
    router,
    /consoleHost === "business" && mode === "sign-in"/,
  );
  // Each host introduces itself as what it is.
  assert.match(router, /Sign in to open your business workspace\./);
  assert.match(router, /Sign in to open your platform workspace\./);
});

test("the host-specific intro copy is localized in French", () => {
  for (const english of [
    "Sign in to open your business workspace.",
    "Sign in to open your platform workspace.",
  ]) {
    const french = translateValue(english, "fr");
    assert.notEqual(french, english, english);
  }
});
