const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const indexSource = fs.readFileSync(
    path.join(__dirname, "..", "index.js"),
    "utf8",
);

// A direct-charge PaymentIntent is created on the business's connected account
// (the Stripe-Account header), so its client secret only resolves for a caller
// presenting that same account. Hosted web checkout carries the account in its
// redirect URL, but the native payment sheet confirms a bare client secret
// against whatever account its publishable key points at - the platform. If a
// response hands out a client secret without the account that owns it, mobile
// payments for that flow fail with "The client_secret provided does not match
// any associated PaymentIntent on this account" while web keeps working.
test("every client secret returned to a client carries its account", () => {
  const secretReturns = (
    indexSource.match(/clientSecret: paymentIntent\.client_secret/g) || []
  ).length;
  const accountReturns = (
    indexSource.match(
        /stripeConnectedAccountId: clientStripeAccountId\(/g,
    ) || []
  ).length;

  assert.ok(
      secretReturns > 0,
      "expected index.js to return client secrets to callers",
  );
  assert.equal(
      accountReturns,
      secretReturns,
      `${secretReturns} response(s) return a client secret but only ` +
      `${accountReturns} return stripeConnectedAccountId. Every payload that ` +
      "hands a client secret to a client must also hand back the account it " +
      "belongs to, via clientStripeAccountId(...).",
  );
});

test("clientStripeAccountId normalises a missing account to empty", () => {
  const start = indexSource.indexOf("function clientStripeAccountId(");
  assert.ok(start >= 0, "clientStripeAccountId helper is missing");

  // Evaluate the helper in isolation so the contract holds against the real
  // source rather than a copy that can drift.
  const end = indexSource.indexOf("\n}", start) + 2;
  // eslint-disable-next-line no-new-func
  const clientStripeAccountId = new Function(
      `${indexSource.slice(start, end)}; return clientStripeAccountId;`,
  )();

  // A platform-owned intent must yield "", never "undefined"/"null" - the
  // client treats any non-empty value as an account to scope Stripe to, and a
  // stringified nullish would break an otherwise working platform charge.
  assert.equal(clientStripeAccountId(undefined), "");
  assert.equal(clientStripeAccountId(null), "");
  assert.equal(clientStripeAccountId(""), "");
  assert.equal(clientStripeAccountId("acct_direct_123"), "acct_direct_123");
});
