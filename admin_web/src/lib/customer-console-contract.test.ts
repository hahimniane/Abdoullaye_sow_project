import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/components/customer-console.tsx", "utf8");

test("customer activity listeners are ownership scoped", () => {
  assert.match(source, /"barrelShipments", "customerUid", uid/);
  assert.match(source, /"freightShipments", "customerUid", uid/);
  assert.match(source, /"transportRequests", "customerUid", uid/);
  assert.match(source, /"parkedCars", "customerUid", uid/);
  assert.match(source, /"carPurchases", "buyerUid", uid/);
  assert.match(source, /where\(ownerField, "==", uid\)/);
});

test("the customer console no longer touches wallets at all", () => {
  // The wallet is removed (docs/PLAN-2026-08-backlog.md #3) - the platform
  // holds no customer money, so the console must not read or show a balance.
  assert.doesNotMatch(source, /"wallets"/);
  assert.doesNotMatch(source, /WalletView|useWallet|CustomerWalletActions/);
});

test("customer marketplace only requests active public listings", () => {
  assert.match(source, /where\("status", "==", "active"\)/);
  assert.match(source, /\.filter\(customerCarListingIsEligible\)/);
});
