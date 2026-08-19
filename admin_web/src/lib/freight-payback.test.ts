import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  coverageFeeCentsFor,
  freightPaybackFor,
} from "./freight-payback.ts";

// Twin of functions/test/freight-payback.test.js and
// test/freight_payback_test.dart - three clients, one price.
const TABLE = {
  electronics: {
    items: [
      {id: "iphone", label: "iPhone", paybackAmount: 400},
      {id: "samsung-phone", label: "Samsung phone", paybackAmount: 250},
    ],
    otherPaybackAmount: 100,
  },
  clothing: {items: [], otherPaybackAmount: 0},
};

test("prices the exact row the business published", () => {
  assert.equal(
    freightPaybackFor({table: TABLE, categoryId: "electronics", itemId: "iphone"})
      .paybackAmount,
    400,
  );
  assert.equal(
    freightPaybackFor({
      table: TABLE, categoryId: "electronics", itemId: "samsung-phone",
    }).paybackAmount,
    250,
  );
});

test("falls back to the catch-all, and says unlisted otherwise", () => {
  const unknown = freightPaybackFor({
    table: TABLE, categoryId: "electronics", itemId: "walkman",
  });
  assert.equal(unknown.paybackAmount, 100);
  assert.equal(unknown.source, "other");
  assert.equal(
    freightPaybackFor({table: TABLE, categoryId: "clothing", itemId: "boubou"})
      .listed,
    false,
  );
  assert.equal(
    freightPaybackFor({table: undefined, categoryId: "electronics"}).listed,
    false,
  );
});

test("the fee comes from the business's payback, never a claim", () => {
  assert.equal(coverageFeeCentsFor(400, 2), 800);
  assert.equal(coverageFeeCentsFor(0, 2), 0);
  assert.equal(coverageFeeCentsFor(400, 0), 0);
});

test("protection reads as reassurance, never as loss-talk in the face", () => {
  // The owner's rule: don't lead with "if we lose your item". Browsing gets
  // the "i"; the review line is insurance language with the promise stated.
  const customer = readFileSync(
    new URL("../components/customer-shipping-services.tsx", import.meta.url),
    "utf8",
  );
  assert.match(customer, /Protection included · up to/);
  assert.doesNotMatch(customer, /label:\s*"Cover for loss"/);
  // The typed declared value is gone wherever a table exists.
  assert.match(customer, /usesItemPricing \? \{itemId\} : \{declaredValue\}/);
});
