import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// A select that asks "Change X status to Approved?" before saving must keep
// the value the person picked. runAction awaits the confirmation; by then the
// controlled select has re-rendered back to the saved value, so reading
// event.target.value inside the action saved the OLD status (Landa Shipping
// stayed Pending after "Approved" was confirmed, 2026-11-12).
const adminConsole = readFileSync(new URL("../components/admin-console.tsx", import.meta.url), "utf8");

test("a confirmed select reads the picked value before the confirmation, never after", () => {
  assert.doesNotMatch(adminConsole, /onChange=\{\((e|event)\) =>\s*runAction\(/,
    "runAction confirms first: capture the value in the handler's parameters");
  const handlers = adminConsole.match(/onChange=\{\(\{ target: \{ value: picked \} \}\) =>\s*runAction\(/g) ?? [];
  assert.ok(handlers.length >= 8, `business, listing and item statuses, admin role, account role, memberships (found ${handlers.length})`);
});

test("approve without Stripe: super admin only, sent through the review with the document bypass", async () => {
  assert.match(adminConsole, /options\.platformStripeBypass === true &&\s*isSuperAdmin &&\s*!stripeVerification\.ready;/);
  assert.match(adminConsole, /platformStripeBypass: approveWithoutStripe,/);
  assert.match(adminConsole, /canApproveWithoutStripe=\{isSuperAdmin\}/);
  const { translateValue } = await import("./french-dom.ts");
  for (const english of ["Approve without Stripe", "Business approved without Stripe"]) {
    assert.notEqual(translateValue(english, "fr"), english, `no French for "${english}"`);
  }
});
