import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { resolveBusinessPayoutStatus } from "./payout-status.ts";

test("business without a Stripe account still needs payout setup", () => {
  const status = resolveBusinessPayoutStatus({});

  assert.equal(status.state, "not_connected");
  assert.equal(status.primaryLabel, "Payout setup required");
  assert.equal(status.actionLabel, "Start Stripe registration");
  assert.match(status.helperText, /Register with Stripe/);
});

test("connected Stripe account is shown as pending instead of unconfigured", () => {
  const status = resolveBusinessPayoutStatus({
    stripeAccountId: "acct_connected",
    chargesEnabled: false,
    payoutsEnabled: false,
  });

  assert.equal(status.state, "connected_pending");
  assert.equal(status.primaryLabel, "Connected, pending verification");
  assert.equal(status.actionLabel, "Continue in Stripe");
});

test("payouts are ready only when both Stripe charge and payout flags are enabled", () => {
  const chargesOnly = resolveBusinessPayoutStatus({
    stripeAccountId: "acct_connected",
    chargesEnabled: true,
    payoutsEnabled: false,
  });
  const payoutsOnly = resolveBusinessPayoutStatus({
    stripeAccountId: "acct_connected",
    chargesEnabled: false,
    payoutsEnabled: true,
  });
  const ready = resolveBusinessPayoutStatus({
    stripeAccountId: "acct_connected",
    chargesEnabled: true,
    payoutsEnabled: true,
  });

  assert.equal(chargesOnly.state, "connected_pending");
  assert.equal(payoutsOnly.state, "connected_pending");
  assert.equal(ready.state, "ready");
  assert.equal(ready.primaryLabel, "Payouts enabled");
});

test("the payout panel re-checks Stripe when the operator returns to the tab", () => {
  // Onboarding is completed on Stripe's own site, so the answer arrives while
  // this tab is in the background. The once-per-account check has already run
  // by then and never runs again - which is exactly how a business that has
  // finished keeps being told to finish.
  const source = readFileSync("src/components/business-console.tsx", "utf8");
  assert.match(source, /document\.addEventListener\("visibilitychange", recheck\)/);
  assert.match(source, /window\.addEventListener\("focus", recheck\)/);
  assert.match(source, /document\.removeEventListener\("visibilitychange", recheck\)/);
  assert.match(source, /if \(document\.visibilityState !== "visible"\) return;/);
});

test("a silent status check that fails says so", () => {
  // Swallowing the error makes a failed check look identical to "Stripe still
  // says no", and the business stares at a stale banner with no way to know.
  const source = readFileSync("src/components/business-console.tsx", "utf8");
  assert.match(source, /setAutoCheckFailed\(true\)/);
  assert.match(source, /setAutoCheckFailed\(false\)/);
  assert.match(source, /autoCheckFailed && payoutStatus\.state !== "ready"/);
});
