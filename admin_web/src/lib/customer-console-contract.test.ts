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

test("customer console reads wallet data only below the signed-in UID", () => {
  assert.match(source, /doc\(db, "wallets", uid\)/);
  assert.match(source, /collection\(db, "wallets", uid, "transactions"\)/);
});

test("customer marketplace only requests active public listings", () => {
  assert.match(source, /where\("status", "==", "active"\)/);
});
