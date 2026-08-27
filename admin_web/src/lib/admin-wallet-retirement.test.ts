import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { TEXT_TRANSLATIONS } from "./french-dom.ts";

const source = readFileSync("src/components/admin-console.tsx", "utf8");

// The wallet and its card-return queue are removed
// (docs/PLAN-2026-08-backlog.md #3). The stored documents survive - deleting
// data is not reversible - but nothing in the console may read them, so the
// console stops paying to read collections it can do nothing with.
test("the admin console subscribes to no wallet collection", () => {
  assert.doesNotMatch(source, /"wallets"/);
  assert.doesNotMatch(source, /"walletRefundRequests"/);
  assert.doesNotMatch(source, /useAdminCollectionGroup/);
});

test("no wallet balance, pending total, or refund queue is rendered", () => {
  assert.doesNotMatch(source, /amountFromWallet|findWalletForRefund/);
  assert.doesNotMatch(source, /RefundRequestRow/);
  assert.doesNotMatch(source, /Pending in wallets/);
  assert.doesNotMatch(source, /Held for customers/);
  assert.doesNotMatch(source, /Customer money to return/);
  assert.doesNotMatch(source, /Wallet transaction/);
});

test("the retired review callable is no longer invoked", () => {
  assert.doesNotMatch(source, /reviewWalletRefundRequest/);
  assert.doesNotMatch(source, /requestWalletCardRefund/);
});

test("card refunds that are still live keep their surface", () => {
  // "Refund due" is freight settlement, which still refunds to the card, and
  // the refund status labels still describe real records. Only the wallet
  // queue went away.
  assert.match(source, /"Refund due"/);
  assert.match(source, /refund_processing: "Refund processing"/);
  assert.match(source, /refunded: "Refunded"/);
});

test("no orphaned French entry is left describing the wallet", () => {
  const orphans = Object.entries(TEXT_TRANSLATIONS).filter(
    ([english, french]) =>
      /wallet/i.test(english) || /portefeuille/i.test(french),
  );
  assert.deepEqual(orphans, []);
});
