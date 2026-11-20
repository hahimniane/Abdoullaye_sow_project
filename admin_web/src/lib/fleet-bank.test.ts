import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { bankLineText, bankScheduleQuote, cleanBankSchedule, hourLabel, readFleetBankStatus, waitingReasonText } from "./fleet-bank.ts";
import { translateValue } from "./french-dom.ts";

const cases = JSON.parse(
  readFileSync(new URL("../../../my_flutter_app/functions/test/fixtures/fleet-bank-cases.json", import.meta.url), "utf8"),
) as { quotes: { name: string; schedule: unknown; centsEach: number; expect: unknown }[] };

test("the console's cost matches the server's for every shared case", () => {
  for (const c of cases.quotes) {
    assert.deepEqual(bankScheduleQuote(c.schedule, c.centsEach), c.expect, c.name);
  }
});

test("schedule cleaning and the clock read like the server and in US time", () => {
  assert.deepEqual(cleanBankSchedule({ every: 15, monthDays: [3, 1, 2] }).monthDays, [1, 2, 3]);
  assert.equal(hourLabel(7), "7 AM");
  assert.equal(hourLabel(23), "11 PM");
  assert.equal(hourLabel(24), "midnight");
  assert.equal(hourLabel(12), "noon");
  assert.equal(hourLabel(23, "fr"), "23 h");
});

test("bank_status is read defensively", () => {
  const status = readFleetBankStatus({
    schedule: { every: 15, fromHour: 7, toHour: 23, monthDays: [1, 2, 3] },
    quote: { centsEach: 12 },
    bank: { connected: true, institutionName: "Capital One", accountMask: "7125" },
    waiting: [{ id: "c1", amountCents: 35000, senderName: "NEW PERSON", atMs: 1, reason: "unknown" }, { id: "", amountCents: 5 }],
  });
  assert.equal(status.quote.monthCents, 2304);
  assert.equal(status.bank.connected, true);
  assert.equal(status.waiting.length, 1);
  assert.deepEqual(readFleetBankStatus(null).waiting, []);
  // Payments whose deposit the bank took back: read defensively, junk dropped.
  assert.deepEqual(readFleetBankStatus(null).removed, []);
  assert.deepEqual(
    readFleetBankStatus({ removed: [{ paymentId: "p1", driverId: "d1", amountCents: 40017, paidDayKey: "2026-12-02", senderName: "ALPHA" }, { paymentId: "", amountCents: 5 }, { paymentId: "p2", amountCents: 0 }] }).removed,
    [{ paymentId: "p1", driverId: "d1", amountCents: 40017, paidDayKey: "2026-12-02", senderName: "ALPHA" }],
  );
});

test("a shared payer waits for the office with its own words", () => {
  assert.equal(waitingReasonText("shared_payer"), "This person pays for more than one driver. Pick the driver.");
  assert.notEqual(waitingReasonText("shared_payer"), waitingReasonText("unknown"));
});

test("every waiting reason the server sends has its own sentence; none mentions cents", () => {
  const reasons = ["unknown", "shared_payer", "undone", "driver_left", "own_transfer", "not_zelle", "possible_duplicate"];
  const texts = reasons.map(waitingReasonText);
  assert.equal(new Set(texts).size, reasons.length);
  assert.equal(waitingReasonText("undone"), "This deposit's payment was undone. It will not pay anyone by itself: pick the driver.");
  for (const t of texts) assert.ok(!/cents/i.test(t), t);
});

test("the new words read in French", () => {
  for (const english of [
    "Pay-day bank checks",
    "Zelle from the bank",
    "Check bank now",
    "Pay this driver",
    "Save the schedule",
    waitingReasonText("unknown"),
    waitingReasonText("undone"),
    waitingReasonText("possible_duplicate"),
    waitingReasonText("own_transfer"),
    waitingReasonText("not_zelle"),
    waitingReasonText("driver_left"),
    waitingReasonText("shared_payer"),
    "The bank took back a deposit that had paid a driver",
    "The payment is still recorded. Look at the bank account: if the money is not there, undo the payment. If it is there, keep it.",
    "The money is there: keep it",
    "Undo the payment",
    "Payment undone.",
    "Payment kept.",
  ]) {
    assert.notEqual(translateValue(english, "fr"), english, `no French for "${english}"`);
  }
});

test("the bank's line is read as one short line, empty for old rows", () => {
  assert.equal(bankLineText("  ZELLE PAYMENT\n FROM  AWA SOW "), "ZELLE PAYMENT FROM AWA SOW");
  assert.equal(bankLineText(undefined), "");
  assert.equal(bankLineText(42), "");
  assert.equal(bankLineText("x".repeat(300)).length, 160);
  const status = readFleetBankStatus({ waiting: [{ id: "c1", amountCents: 100, bankLine: "ZELLE FROM A B" }, { id: "c2", amountCents: 100 }] });
  assert.deepEqual(status.waiting.map((w) => w.bankLine), ["ZELLE FROM A B", ""]);
});

test("the not-Zelle sentence does not claim what the deposit is", () => {
  const text = waitingReasonText("not_zelle");
  assert.equal(text, "The bank's line does not say Zelle, so it will not pay anyone by itself. Pick the driver if it is a driver's payment.");
  assert.doesNotMatch(text, /cash|check|card payout/i);
});
