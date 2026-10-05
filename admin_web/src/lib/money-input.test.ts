import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parseMoneyCents, readMoneyInput } from "./money-input.ts";
import { dollarsToCents as invoiceCents } from "./invoice-ledger.ts";
import { dollarsToCents as ledgerCents } from "./lot-ledger.ts";

test("a comma before cents is the decimal mark, not a thousands separator", () => {
  // Regression: "12,50" was read as 1250 dollars.
  assert.equal(parseMoneyCents("12,50"), 1250);
  assert.equal(ledgerCents("12,50"), 1250);
  assert.equal(invoiceCents("12,50"), 1250);
  assert.equal(parseMoneyCents("0,5"), 50);
  assert.equal(parseMoneyCents(".5"), 50);
});

test("thousands grouping in either convention", () => {
  assert.equal(parseMoneyCents("1,250"), 125000);
  assert.equal(parseMoneyCents("1,200.50"), 120050);
  assert.equal(parseMoneyCents("1.200,50"), 120050);
  assert.equal(parseMoneyCents("1 200,50"), 120050);
  assert.equal(parseMoneyCents("$1,200,000"), 120000000);
});

test("ambiguous or over-precise text is refused, not guessed", () => {
  for (const bad of ["1,2,3", "12,500,5", "1,20.5", "12.34.56", "12,", "abc", "1,2345"]) {
    assert.equal(readMoneyInput(bad).issue, "invalid", bad);
  }
  assert.equal(readMoneyInput("12.505").issue, "fractionalCents");
  assert.equal(readMoneyInput("  ").issue, "empty");
  assert.equal(parseMoneyCents("-5"), -500);
});

test("the console reads money exactly as the app does", () => {
  // The Dart reader is the source; this file mirrors it rule for rule.
  const dart = readFileSync(
    new URL("../../../my_flutter_app/lib/utils/money_input.dart", import.meta.url),
    "utf8",
  );
  assert.match(dart, /MoneyInput readMoneyInput\(String input\)/);
  assert.match(dart, /mark == ',' && after == 3/);
  assert.match(dart, /_maxDollarDigits = 12/);
});

test("price fields keep their blank meaning and accept a decimal comma", async () => {
  const { moneyDollars } = await import("./money-input.ts");
  assert.equal(moneyDollars("", 0), 0);
  assert.ok(Number.isNaN(moneyDollars("")));
  assert.equal(moneyDollars("12,50"), 12.5);
  assert.ok(Number.isNaN(moneyDollars("1,2,3", 0)));
});
