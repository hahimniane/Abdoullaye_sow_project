import assert from "node:assert/strict";
import { test } from "node:test";

import { formatMoney, optionalText, text } from "./format.ts";

test("formats supported currencies with the active locale", () => {
  assert.equal(formatMoney(1234.5, "usd"), "$1,234.50");
});

test("keeps finance rows readable when a currency value is malformed", () => {
  assert.equal(formatMoney(125, "Unknown"), "125.00 UNKNOWN");
});

test("uses USD when the currency value is blank", () => {
  assert.equal(formatMoney(25, ""), "$25.00");
});

test("keeps absent domain values empty so callers can apply typed fallbacks", () => {
  assert.equal(optionalText(undefined), "");
  assert.equal(optionalText("   "), "");
  assert.equal(optionalText(" usd "), "usd");
});

test("respects an explicitly empty display fallback", () => {
  assert.equal(text(undefined, ""), "");
  assert.equal(text("   ", "Business"), "Business");
  assert.equal(text(undefined), "Unknown");
});
