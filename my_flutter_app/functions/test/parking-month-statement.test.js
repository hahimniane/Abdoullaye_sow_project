"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  previousMonthKey,
  monthLabel,
  parkingMonthStatement,
  parkingMonthSummary,
  parkingMonthBillText,
  parkingMonthCustomerText,
  monthBillPaymentPlan,
} = require("../parking_month_statement");

const at = (iso) => ({toDate: () => new Date(`${iso}T12:00:00Z`)});
const OCT1 = new Date("2026-10-01T13:00:00Z");

// Diallo's F150, the case that started this: in 09/01, open, $15/day,
// nothing paid.
const diallo = {
  id: "f150", customerName: "Diallo", carYear: "2024", carMake: "Ford",
  carModel: "F150", vinNumber: "1ftfw1e50pfa63120",
  parkingDate: at("2026-09-01"),
  dailyRate: 15, paymentStatus: "awaiting_direct_payment", status: "reserved",
};

describe("one car's month", () => {
  it("bills that month's days at the rate", () => {
    const bill = parkingMonthStatement(diallo, "2026-09", OCT1);
    assert.equal(bill.periodFrom, "2026-09-01");
    assert.equal(bill.periodTo, "2026-09-30");
    assert.equal(bill.days, 30);
    assert.equal(bill.dayRateCents, 1500);
    assert.equal(bill.monthCents, 45000);
    assert.equal(bill.priorUnpaidCents, 0);
    assert.equal(bill.dueCents, 45000);
    assert.equal(bill.owes, true);
    assert.equal(bill.stillParked, true);
    assert.equal(bill.partialMonth, false);
    assert.equal(bill.vehicle, "2024 Ford F150");
  });

  it("shows earlier months as their own line, paid oldest first", () => {
    const since = {...diallo, parkingDate: at("2026-08-22")};
    // August 22-31 is 10 days ($150); September is $450.
    const unpaid = parkingMonthStatement(since, "2026-09", OCT1);
    assert.equal(unpaid.priorUnpaidCents, 15000);
    assert.equal(unpaid.monthUnpaidCents, 45000);
    assert.equal(unpaid.dueCents, 60000);
    // $200 pays August off first, then $50 of September.
    const part = parkingMonthStatement(
        {...since, amountPaidCents: 20000}, "2026-09", OCT1);
    assert.equal(part.priorUnpaidCents, 0);
    assert.equal(part.monthPaidCents, 5000);
    assert.equal(part.monthUnpaidCents, 40000);
    assert.equal(part.dueCents, 40000);
  });

  it("counts a car that left mid-month without paying", () => {
    const left = {...diallo, parkingDate: at("2026-09-05"),
      parkingEndDate: at("2026-09-20"), amountDueCents: 19200, dailyRate: 12};
    const bill = parkingMonthStatement(left, "2026-09", OCT1);
    assert.equal(bill.days, 16);
    assert.equal(bill.monthCents, 19200);
    assert.equal(bill.stillParked, false);
    assert.equal(bill.owes, true);
    assert.equal(parkingMonthStatement(left, "2026-10", OCT1), null,
        "gone before October");
  });

  it("spreads a priced stay across the months it covers", () => {
    const across = {...diallo, parkingDate: at("2026-09-21"),
      parkingEndDate: at("2026-10-10"), amountDueCents: 24000};
    // 20 days, $240: ten in September, ten in October.
    assert.equal(parkingMonthStatement(across, "2026-09", OCT1).monthCents,
        12000);
  });

  it("leaves out cars that owe nothing for the month", () => {
    assert.equal(parkingMonthStatement(
        {...diallo, amountPaidCents: 45000}, "2026-09", OCT1).owes, false);
    assert.equal(parkingMonthStatement(
        {...diallo, paymentStatus: "paid"}, "2026-09", OCT1).owes, false);
    assert.equal(parkingMonthStatement(
        {...diallo, status: "cancelled"}, "2026-09", OCT1), null);
    assert.equal(parkingMonthStatement(
        {...diallo, paymentStatus: "not_required"}, "2026-09", OCT1), null);
    assert.equal(parkingMonthStatement(diallo, "2026-08", OCT1), null,
        "not there yet in August");
  });

  it("works a month still running up to today", () => {
    const mid = parkingMonthStatement(diallo, "2026-10",
        new Date("2026-10-05T15:00:00Z"));
    assert.equal(mid.days, 5);
    assert.equal(mid.partialMonth, true);
    assert.equal(mid.priorUnpaidCents, 45000);
  });
});

describe("the business's month", () => {
  it("adds up the lot and lists who owes, biggest first", () => {
    const rows = [
      diallo,
      {...diallo, id: "rogue", customerName: "Djibril", dailyRate: 10,
        amountPaidCents: 30000},
      {...diallo, id: "corolla", customerName: "Amadou", dailyRate: 12,
        amountPaidCents: 10000},
      {...diallo, id: "gone", status: "cancelled"},
    ];
    const s = parkingMonthSummary(rows, "2026-09", OCT1);
    assert.equal(s.carsOnLot, 3);
    assert.equal(s.carsOwing, 2);
    assert.equal(s.billedCents, 45000 + 30000 + 36000);
    assert.equal(s.collectedCents, 30000 + 10000);
    assert.equal(s.owedCents, 45000 + 26000);
    assert.deepEqual(s.owing.map((b) => b.id), ["f150", "corolla"]);
  });
});

describe("words", () => {
  it("names months and finds last month", () => {
    assert.equal(monthLabel("2026-09"), "September 2026");
    assert.equal(previousMonthKey(OCT1), "2026-09");
    assert.equal(previousMonthKey(new Date("2026-01-01T13:00:00Z")),
        "2025-12");
  });

  it("writes the WhatsApp text", () => {
    const since = {...diallo, parkingDate: at("2026-08-22"),
      amountPaidCents: 20000};
    const txt = parkingMonthBillText(
        parkingMonthStatement(since, "2026-09", OCT1), "Keren Auto Sales");
    assert.equal(txt, [
      "Keren Auto Sales — Parking bill, September 2026",
      "For: Diallo",
      "2024 Ford F150 · VIN 1FTFW1E50PFA63120",
      "",
      "2026-09-01 to 2026-09-30: 30 days × $15.00 — $450.00",
      "Paid — -$50.00",
      "BALANCE DUE: $400.00",
    ].join("\n"));
  });
});

// Names are typed a dozen ways for the same person; the phone is who the
// WhatsApp reaches. One bill per phone, every car on it with its dates.
describe("one bill per customer", () => {
  const base = {parkingDate: at("2026-09-18"), dailyRate: 12,
    paymentStatus: "awaiting_direct_payment", status: "reserved"};
  const rows = [
    {...base, id: "a", customerName: "abdoulaye sow",
      customerPhone: "347-562-8973", carYear: "2014", carMake: "Toyota",
      carModel: "Corolla"},
    {...base, id: "b", customerName: "Abdoulaye Sow",
      customerPhone: "+1 (347) 562 8973", parkingDate: at("2026-09-21"),
      parkingEndDate: at("2026-09-24"), amountDueCents: 4800,
      carYear: "2017", carMake: "Toyota", carModel: "RAV4",
      amountPaidCents: 1000},
    {...base, id: "c", customerName: "Ministre", customerPhone: "3475628973",
      carYear: "2015", carMake: "Toyota", carModel: "RAV4"},
    {...diallo, customerPhone: "6465550000"},
  ];

  it("groups by phone whatever the name, most used spelling shown", () => {
    const s = parkingMonthSummary(rows, "2026-09", OCT1);
    assert.equal(s.customers.length, 2);
    const sow = s.customers.find((c) => c.cars.length === 3);
    assert.equal(sow.customerName, "Abdoulaye Sow");
    assert.deepEqual(sow.cars.map((b) => b.registeredTo), ["", "Ministre", ""]);
    assert.equal(sow.monthCents, 15600 + 15600 + 4800);
    assert.equal(sow.monthPaidCents, 1000);
    assert.equal(sow.dueCents, 15600 + 15600 + 3800);
    assert.deepEqual(s.customersOwing.map((c) => c.customerName),
        ["Diallo", "Abdoulaye Sow"]);
  });

  it("writes one text listing every car and its dates", () => {
    const sow = parkingMonthSummary(rows, "2026-09", OCT1).customers
        .find((c) => c.cars.length === 3);
    assert.equal(parkingMonthCustomerText(sow, "Keren Auto Sales"), [
      "Keren Auto Sales — Monthly bill, September 2026",
      "For: Abdoulaye Sow · 347-562-8973",
      "",
      "Parking",
      "2014 Toyota Corolla",
      "  2026-09-18 to 2026-09-30: 13 days × $12.00 — $156.00",
      "2015 Toyota RAV4 (registered to Ministre)",
      "  2026-09-18 to 2026-09-30: 13 days × $12.00 — $156.00",
      "2017 Toyota RAV4",
      "  2026-09-21 to 2026-09-24: 4 days × $12.00 — $48.00",
      "  Paid — -$10.00",
      "",
      "Total for September — $360.00",
      "Paid — -$10.00",
      "BALANCE DUE: $350.00",
    ].join("\n"));
  });
});

// Ledger activities join the month: dated in the month, they are its; an
// older one still unpaid comes along as "unpaid from before". Same customer
// key (the phone), so cars and jobs land on one bill.
describe("activities on the month's bill", () => {
  const act = (over) => ({
    businessId: "k", activityTypeLabel: "title", feeCents: 10000,
    customerName: "Abdoulaye Sow", customerPhone: "3475628973",
    carYear: "2013", carMake: "Toyota", carModel: "RAV4",
    paymentStatus: "awaiting_direct_payment", ...over,
  });
  const cars = [{parkingDate: at("2026-09-18"), dailyRate: 12,
    paymentStatus: "awaiting_direct_payment", status: "reserved", id: "car",
    customerName: "abdoulaye sow", customerPhone: "347-562-8973",
    carYear: "2014", carMake: "Toyota", carModel: "Corolla"}];
  const acts = [
    act({id: "sep", activityDate: at("2026-09-14"), amountPaidCents: 4000}),
    act({id: "aug", activityDate: at("2026-08-20"), feeCents: 9000}),
    act({id: "augPaid", activityDate: at("2026-08-02"),
      paymentStatus: "succeeded"}),
    act({id: "void", activityDate: at("2026-09-15"), voided: true}),
    act({id: "free", activityDate: at("2026-09-16"), feeCents: 0}),
    act({id: "oct", activityDate: at("2026-10-01")}),
    act({id: "other", activityDate: at("2026-09-03"), customerName: "Fatou",
      customerPhone: "6465550199", paymentStatus: "succeeded"}),
  ];

  it("counts the month's, carries older unpaid, drops void and free", () => {
    const s = parkingMonthSummary(cars, "2026-09", OCT1, acts);
    const sow = s.customers.find((c) => c.customerName === "Abdoulaye Sow");
    assert.deepEqual(sow.cars.map((c) => c.id), ["car"]);
    assert.deepEqual(sow.activities.map((a) => a.id), ["sep"]);
    assert.deepEqual(sow.olderActivities.map((a) => a.id), ["aug"]);
    assert.equal(sow.activities[0].label, "Title");
    assert.equal(sow.activities[0].paidCents, 4000);
    assert.equal(sow.monthCents, 15600 + 10000);
    assert.equal(sow.monthPaidCents, 4000);
    assert.equal(sow.priorUnpaidCents, 9000);
    assert.equal(sow.dueCents, 15600 + 6000 + 9000);
    const fatou = s.customers.find((c) => c.customerName === "Fatou");
    assert.equal(fatou.owes, false, "paid activity, nothing owed");
    assert.equal(s.activitiesInMonth, 2);
    assert.equal(s.billedCents, 15600 + 10000 + 10000);
    assert.equal(s.collectedCents, 4000 + 10000);
    assert.deepEqual(s.customersOwing.map((c) => c.customerName),
        ["Abdoulaye Sow"]);
  });

  it("lists every activity and what was paid toward it in the text", () => {
    const sow = parkingMonthSummary(cars, "2026-09", OCT1, acts).customers
        .find((c) => c.customerName === "Abdoulaye Sow");
    assert.equal(parkingMonthCustomerText(sow, "Keren"), [
      "Keren — Monthly bill, September 2026",
      "For: Abdoulaye Sow · 347-562-8973",
      "",
      "Parking",
      "2014 Toyota Corolla",
      "  2026-09-18 to 2026-09-30: 13 days × $12.00 — $156.00",
      "",
      "Activities",
      "2026-09-14 · Title · 2013 Toyota RAV4 — $100.00",
      "  Paid — -$40.00",
      "",
      "Unpaid from before",
      "2026-08-20 · Title · 2013 Toyota RAV4 — $90.00",
      "",
      "Total for September — $256.00",
      "Unpaid from before — $90.00",
      "Paid — -$40.00",
      "BALANCE DUE: $306.00",
    ].join("\n"));
  });
});

// "Mark all paid": every line through the payment it already takes, for
// exactly what the bill shows due on it; payment-link cars are Stripe's.
describe("marking a whole bill paid", () => {
  const cars = [
    {id: "open", parkingDate: at("2026-09-18"), dailyRate: 12,
      paymentStatus: "awaiting_direct_payment", paymentMethod: "direct",
      source: "business", status: "reserved", customerName: "Sow",
      customerPhone: "3475628973",
      amountPaidCents: 6000, carYear: "2014", carMake: "Toyota",
      carModel: "Corolla"},
    {id: "link", parkingDate: at("2026-09-20"), dailyRate: 12,
      paymentStatus: "awaiting_payment_link", paymentMethod: "payment_link",
      status: "reserved", customerName: "Sow", customerPhone: "3475628973",
      carYear: "2015", carMake: "Toyota", carModel: "RAV4"},
    {id: "paid", parkingDate: at("2026-09-01"), dailyRate: 12,
      paymentStatus: "paid", paymentMethod: "direct", status: "reserved",
      customerName: "Sow", customerPhone: "3475628973"},
  ];
  const acts = [
    {id: "sep", activityDate: at("2026-09-14"), feeCents: 10000,
      amountPaidCents: 4000, activityTypeLabel: "title",
      customerName: "Sow", customerPhone: "3475628973"},
    {id: "aug", activityDate: at("2026-08-20"), feeCents: 9000,
      activityTypeLabel: "reassignment", customerName: "Sow",
      customerPhone: "3475628973"},
  ];
  it("records each line's due, skips link cars and settled lines", () => {
    const sow = parkingMonthSummary(cars, "2026-09", OCT1, acts).customers[0];
    const plan = monthBillPaymentPlan(sow);
    assert.deepEqual(plan.items.map((x) => [x.kind, x.id, x.amountCents]), [
      ["car", "open", 15600 - 6000],
      ["activity", "sep", 6000],
      ["activity", "aug", 9000],
    ]);
    assert.deepEqual(plan.skipped.map((x) => [x.id, x.reason]),
        [["link", "payment_link"]]);
    assert.equal(plan.totalCents, 9600 + 6000 + 9000);
    // A car booked online (not entered by the business) is not ours to mark.
    const online = parkingMonthSummary([{...cars[0], source: "customer"}],
        "2026-09", OCT1).customers[0];
    const reasons = monthBillPaymentPlan(online).skipped.map((x) => x.reason);
    assert.deepEqual(reasons, ["online"]);
  });
});

