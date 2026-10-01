import assert from "node:assert/strict";
import test from "node:test";

import {
  monthLabel,
  parkingMonthBillText,
  parkingMonthStatement,
  parkingMonthSummary,
  previousMonthKey,
  shiftMonthKey,
} from "./parking-month-statement.ts";

// The same cases as the server's test, so the three copies agree.
const at = (iso: string) => ({ toDate: () => new Date(`${iso}T12:00:00Z`) });
const OCT1 = new Date("2026-10-01T13:00:00Z");
const diallo = {
  id: "f150", customerName: "Diallo", carYear: "2024", carMake: "Ford", carModel: "F150",
  vinNumber: "1ftfw1e50pfa63120", parkingDate: at("2026-09-01"), dailyRate: 15,
  paymentStatus: "awaiting_direct_payment", status: "reserved",
};

test("one car's month: that month's days at the rate", () => {
  const bill = parkingMonthStatement(diallo, "2026-09", OCT1)!;
  assert.equal(bill.days, 30);
  assert.equal(bill.monthCents, 45000);
  assert.equal(bill.dueCents, 45000);
  assert.equal(bill.stillParked, true);
});

test("earlier months are their own line, paid oldest first", () => {
  const since = { ...diallo, parkingDate: at("2026-08-22") };
  assert.equal(parkingMonthStatement(since, "2026-09", OCT1)!.priorUnpaidCents, 15000);
  const part = parkingMonthStatement({ ...since, amountPaidCents: 20000 }, "2026-09", OCT1)!;
  assert.equal(part.priorUnpaidCents, 0);
  assert.equal(part.monthPaidCents, 5000);
  assert.equal(part.dueCents, 40000);
});

test("left mid-month, priced stays across months, and the exclusions", () => {
  const left = { ...diallo, parkingDate: at("2026-09-05"), parkingEndDate: at("2026-09-20"), amountDueCents: 19200 };
  assert.equal(parkingMonthStatement(left, "2026-09", OCT1)!.days, 16);
  assert.equal(parkingMonthStatement(left, "2026-10", OCT1), null);
  const across = { ...diallo, parkingDate: at("2026-09-21"), parkingEndDate: at("2026-10-10"), amountDueCents: 24000 };
  assert.equal(parkingMonthStatement(across, "2026-09", OCT1)!.monthCents, 12000);
  assert.equal(parkingMonthStatement({ ...diallo, paymentStatus: "paid" }, "2026-09", OCT1)!.owes, false);
  assert.equal(parkingMonthStatement({ ...diallo, status: "cancelled" }, "2026-09", OCT1), null);
  assert.equal(parkingMonthStatement({ ...diallo, paymentStatus: "not_required" }, "2026-09", OCT1), null);
});

test("the business's month adds up and lists who owes, biggest first", () => {
  const s = parkingMonthSummary([
    diallo,
    { ...diallo, id: "rogue", customerName: "Djibril", dailyRate: 10, amountPaidCents: 30000 },
    { ...diallo, id: "corolla", customerName: "Amadou", dailyRate: 12, amountPaidCents: 10000 },
    { ...diallo, id: "gone", status: "cancelled" },
  ], "2026-09", OCT1);
  assert.equal(s.carsOnLot, 3);
  assert.equal(s.carsOwing, 2);
  assert.equal(s.billedCents, 111000);
  assert.equal(s.collectedCents, 40000);
  assert.equal(s.owedCents, 71000);
  assert.deepEqual(s.owing.map((b) => b.id), ["f150", "corolla"]);
});

test("months and the WhatsApp text", () => {
  assert.equal(monthLabel("2026-09"), "September 2026");
  assert.equal(monthLabel("2026-09", "fr"), "septembre 2026");
  assert.equal(previousMonthKey(OCT1), "2026-09");
  assert.equal(shiftMonthKey("2026-01", -1), "2025-12");
  const since = { ...diallo, parkingDate: at("2026-08-22"), amountPaidCents: 20000 };
  assert.equal(parkingMonthBillText(parkingMonthStatement(since, "2026-09", OCT1)!, "Keren Auto Sales"), [
    "Keren Auto Sales — Parking bill, September 2026",
    "For: Diallo",
    "2024 Ford F150 · VIN 1FTFW1E50PFA63120",
    "",
    "2026-09-01 to 2026-09-30: 30 days × $15.00 — $450.00",
    "Paid — -$50.00",
    "BALANCE DUE: $400.00",
  ].join("\n"));
});
