import assert from "node:assert/strict";
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
