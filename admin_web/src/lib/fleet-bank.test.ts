import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { bankScheduleQuote, cleanBankSchedule, hourLabel, readFleetBankStatus, waitingReasonText } from "./fleet-bank.ts";
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
});

test("the new words read in French", () => {
  for (const english of [
    "Pay-day bank checks",
    "Zelle from the bank",
    "Check bank now",
    "Pay this driver",
    "Save the schedule",
    waitingReasonText("unknown"),
    waitingReasonText("two_drivers"),
    waitingReasonText("undone"),
  ]) {
    assert.notEqual(translateValue(english, "fr"), english, `no French for "${english}"`);
  }
});
