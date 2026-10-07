import assert from "node:assert/strict";
import test from "node:test";

import {
  monthBillPaymentPlan,
  mostUsedName,
  monthLabel,
  parkingMonthCustomerText,
  parkingMonthBillText,
  parkingMonthCustomerPaid,
  parkingMonthStatement,
  parkingPaidViaLabel,
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
  assert.equal(parkingMonthStatement({ ...diallo, dailyRate: 0, paymentStatus: "not_required" }, "2026-09", OCT1), null, "a free stay runs up nothing");
  assert.equal(parkingMonthStatement({ ...diallo, paymentStatus: "not_required" }, "2026-09", OCT1)!.dueCents, 45000, "a mislabelled open stay still owes");
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
    "Sep 1, 2026 to Sep 30, 2026: 30 days × $15.00 — $450.00",
    "Paid — -$50.00",
    "BALANCE DUE: $400.00",
  ].join("\n"));
});

test("one bill per phone, every car with its dates; mirrors the server", () => {
  const base = { parkingDate: at("2026-09-18"), dailyRate: 12, paymentStatus: "awaiting_direct_payment", status: "reserved" };
  const rows = [
    { ...base, id: "a", customerName: "abdoulaye sow", customerPhone: "347-562-8973", carYear: "2014", carMake: "Toyota", carModel: "Corolla" },
    { ...base, id: "b", customerName: "Abdoulaye Sow", customerPhone: "+1 (347) 562 8973", parkingDate: at("2026-09-21"), parkingEndDate: at("2026-09-24"), amountDueCents: 4800, carYear: "2017", carMake: "Toyota", carModel: "RAV4", amountPaidCents: 1000 },
    { ...base, id: "c", customerName: "Ministre", customerPhone: "3475628973", carYear: "2015", carMake: "Toyota", carModel: "RAV4" },
    { ...diallo, customerPhone: "6465550000" },
  ];
  const s = parkingMonthSummary(rows, "2026-09", OCT1);
  assert.equal(s.customers.length, 2);
  assert.deepEqual(s.customersOwing.map((c) => c.customerName), ["Diallo", "Abdoulaye Sow"]);
  const sow = s.customers.find((c) => c.cars.length === 3)!;
  assert.deepEqual(sow.cars.map((b) => b.registeredTo), ["abdoulaye sow", "Ministre", "Abdoulaye Sow"]);
  assert.equal(sow.dueCents, 35000);
  assert.equal(mostUsedName(["Abd Sow", "abdoulaye sow", "Abdoulaye Sow"]), "Abdoulaye Sow");
  assert.equal(parkingMonthCustomerText(sow, "Keren Auto Sales"), [
    "Keren Auto Sales — Monthly bill, September 2026",
    "For: Abdoulaye Sow · 347-562-8973",
    "",
    "Parking",
    "2014 Toyota Corolla (registered to abdoulaye sow)",
    "  Sep 18, 2026 to Sep 30, 2026: 13 days × $12.00 — $156.00",
    "2015 Toyota RAV4 (registered to Ministre)",
    "  Sep 18, 2026 to Sep 30, 2026: 13 days × $12.00 — $156.00",
    "2017 Toyota RAV4 (registered to Abdoulaye Sow)",
    "  Sep 21, 2026 to Sep 24, 2026: 4 days × $12.00 — $48.00",
    "  Paid — -$10.00",
    "",
    "Total for September — $360.00",
    "Paid — -$10.00",
    "BALANCE DUE: $350.00",
  ].join("\n"));
});

test("activities join the month: dated in it, older unpaid carried, void and free dropped", () => {
  const act = (over: Record<string, unknown>) => ({
    businessId: "k", activityTypeLabel: "title", feeCents: 10000, customerName: "Abdoulaye Sow",
    customerPhone: "3475628973", carYear: "2013", carMake: "Toyota", carModel: "RAV4",
    paymentStatus: "awaiting_direct_payment", ...over,
  });
  const cars = [{ parkingDate: at("2026-09-18"), dailyRate: 12, paymentStatus: "awaiting_direct_payment", status: "reserved", id: "car",
    customerName: "abdoulaye sow", customerPhone: "347-562-8973", carYear: "2014", carMake: "Toyota", carModel: "Corolla" }];
  const acts = [
    act({ id: "sep", activityDate: at("2026-09-14"), amountPaidCents: 4000 }),
    act({ id: "aug", activityDate: at("2026-08-20"), feeCents: 9000 }),
    act({ id: "augPaid", activityDate: at("2026-08-02"), paymentStatus: "succeeded" }),
    act({ id: "void", activityDate: at("2026-09-15"), voided: true }),
    act({ id: "free", activityDate: at("2026-09-16"), feeCents: 0 }),
    act({ id: "oct", activityDate: at("2026-10-01") }),
    act({ id: "other", activityDate: at("2026-09-03"), customerName: "Fatou", customerPhone: "6465550199", paymentStatus: "succeeded" }),
  ];
  const s = parkingMonthSummary(cars, "2026-09", OCT1, acts);
  const sow = s.customers.find((c) => c.customerName === "Abdoulaye Sow")!;
  assert.deepEqual(sow.activities.map((a) => a.id), ["sep"]);
  assert.deepEqual(sow.olderActivities.map((a) => a.id), ["aug"]);
  assert.equal(sow.dueCents, 15600 + 6000 + 9000);
  assert.equal(s.billedCents, 15600 + 10000 + 10000);
  assert.equal(s.collectedCents, 14000);
  assert.deepEqual(s.customersOwing.map((c) => c.customerName), ["Abdoulaye Sow"]);
  assert.equal(parkingMonthCustomerText(sow, "Keren"), [
    "Keren — Monthly bill, September 2026",
    "For: Abdoulaye Sow · 347-562-8973",
    "",
    "Parking",
    "2014 Toyota Corolla (registered to abdoulaye sow)",
    "  Sep 18, 2026 to Sep 30, 2026: 13 days × $12.00 — $156.00",
    "",
    "Activities",
    "Sep 14, 2026 · Title · 2013 Toyota RAV4 (registered to Abdoulaye Sow) — $100.00",
    "  Paid — -$40.00",
    "",
    "Unpaid from before",
    "Aug 20, 2026 · Title · 2013 Toyota RAV4 (registered to Abdoulaye Sow) — $90.00",
    "",
    "Total for September — $256.00",
    "Unpaid from before — $90.00",
    "Paid — -$40.00",
    "BALANCE DUE: $306.00",
  ].join("\n"));
});

test("mark all paid: each line's due through its own payment; link cars skipped", () => {
  const cars = [
    { id: "open", parkingDate: at("2026-09-18"), dailyRate: 12, paymentStatus: "awaiting_direct_payment", paymentMethod: "direct", source: "business", status: "reserved",
      customerName: "Sow", customerPhone: "3475628973", amountPaidCents: 6000, carYear: "2014", carMake: "Toyota", carModel: "Corolla" },
    { id: "link", parkingDate: at("2026-09-20"), dailyRate: 12, paymentStatus: "awaiting_payment_link", paymentMethod: "payment_link", status: "reserved",
      customerName: "Sow", customerPhone: "3475628973", carYear: "2015", carMake: "Toyota", carModel: "RAV4" },
    { id: "paid", parkingDate: at("2026-09-01"), dailyRate: 12, paymentStatus: "paid", paymentMethod: "direct", status: "reserved", customerName: "Sow", customerPhone: "3475628973" },
  ];
  const acts = [
    { id: "sep", activityDate: at("2026-09-14"), feeCents: 10000, amountPaidCents: 4000, activityTypeLabel: "title", customerName: "Sow", customerPhone: "3475628973" },
    { id: "aug", activityDate: at("2026-08-20"), feeCents: 9000, activityTypeLabel: "reassignment", customerName: "Sow", customerPhone: "3475628973" },
  ];
  const plan = monthBillPaymentPlan(parkingMonthSummary(cars, "2026-09", OCT1, acts).customers[0]);
  assert.deepEqual(plan.items.map((x) => [x.kind, x.id, x.amountCents]), [["car", "open", 9600], ["activity", "sep", 6000], ["activity", "aug", 9000]]);
  assert.deepEqual(plan.skipped.map((x) => [x.id, x.reason]), [["link", "payment_link"]]);
  assert.equal(plan.totalCents, 24600);
  const online = parkingMonthSummary([{ ...cars[0], source: "customer" }], "2026-09", OCT1).customers[0];
  assert.deepEqual(monthBillPaymentPlan(online).skipped.map((x) => x.reason), ["online"]);
});

// "Paid" at month end: billed for the month and nothing left owing - for the
// month or carried in from before. Nothing billed is neither paid nor owing.
// The same cases as the server's and the app's tests, so the three agree.
test("who has paid for the month: fully, partly, overpaid, carried, nothing billed", () => {
  const car = (over: Record<string, unknown>) => ({ ...diallo, ...over });
  const cars = [
    car({ id: "unpaid" }),
    car({ id: "paid", customerName: "Barry", customerPhone: "6465550101", amountPaidCents: 45000, parkingPayments: [{ receivedVia: "cash" }, { receivedVia: "Zelle" }] }),
    car({ id: "part", customerName: "Camara", customerPhone: "6465550102", amountPaidCents: 20000, parkingPayments: [{ receivedVia: "cash" }] }),
    car({ id: "credit", customerName: "Keita", customerPhone: "6465550103", amountPaidCents: 60000, paymentMethod: "direct", directPaymentMethod: "venmo" }),
    car({ id: "link", customerName: "Sylla", customerPhone: "6465550104", paymentMethod: "payment_link", paymentStatus: "succeeded" }),
    car({ id: "online", customerName: "Bah", customerPhone: "6465550105", paymentStatus: "paid" }),
    car({ id: "carried", customerName: "Sow", customerPhone: "6465550106", amountPaidCents: 45000, parkingPayments: [{ receivedVia: "cash" }] }),
  ];
  const act = (over: Record<string, unknown>) => ({ businessId: "k", activityTypeLabel: "title", feeCents: 10000, paymentStatus: "awaiting_direct_payment", ...over });
  const acts = [
    act({ id: "sowAug", activityDate: at("2026-08-20"), feeCents: 9000, customerName: "Sow", customerPhone: "6465550106" }),
    act({ id: "fatou", activityDate: at("2026-09-03"), customerName: "Fatou", customerPhone: "6465550107", paymentStatus: "succeeded", paymentMethod: "direct", receivedVia: "cashapp" }),
    act({ id: "diopAug", activityDate: at("2026-08-10"), feeCents: 5000, customerName: "Diop", customerPhone: "6465550108" }),
  ];
  const s = parkingMonthSummary(cars, "2026-09", OCT1, acts);
  const by = (name: string) => s.customers.find((c) => c.customerName === name)!;

  // One definition.
  assert.equal(parkingMonthCustomerPaid({ monthCents: 100, dueCents: 0 }), true);
  assert.equal(parkingMonthCustomerPaid({ monthCents: 100, dueCents: 1 }), false);
  assert.equal(parkingMonthCustomerPaid({ monthCents: 0, dueCents: 0 }), false, "nothing billed is not paid");

  assert.deepEqual(s.customersPaid.map((c) => c.customerName), ["Bah", "Barry", "Fatou", "Keita", "Sylla"]);
  assert.deepEqual(s.customersOwing.map((c) => c.customerName), ["Diallo", "Camara", "Sow", "Diop"]);
  assert.equal(s.customers.length, 9);
  for (const c of s.customers) {
    assert.equal(c.paid, parkingMonthCustomerPaid(c));
    assert.ok(!(c.paid && c.owes), `${c.customerName} is not both`);
  }

  // Fully paid: what came in, and how.
  assert.equal(by("Barry").paid, true);
  assert.equal(by("Barry").monthPaidCents, 45000);
  assert.deepEqual(by("Barry").paidVia, ["cash", "zelle"]);
  assert.deepEqual(by("Sylla").paidVia, ["card_link"]);
  assert.deepEqual(by("Bah").paidVia, ["online"]);
  assert.deepEqual(by("Fatou").paidVia, ["cashapp"]);
  // Partly paid still owes.
  assert.equal(by("Camara").paid, false);
  assert.equal(by("Camara").owes, true);
  assert.equal(by("Camara").monthPaidCents, 20000);
  assert.equal(by("Camara").dueCents, 25000);
  assert.deepEqual(by("Camara").paidVia, ["cash"]);
  assert.deepEqual(by("Diallo").paidVia, [], "nothing paid, no method");
  // Overpaid is paid; the month is capped at its total.
  assert.equal(by("Keita").paid, true);
  assert.equal(by("Keita").monthPaidCents, 45000);
  assert.equal(by("Keita").dueCents, 0);
  assert.deepEqual(by("Keita").paidVia, ["venmo"]);
  // The month paid but older still unpaid is not paid.
  assert.equal(by("Sow").monthPaidCents, 45000);
  assert.equal(by("Sow").priorUnpaidCents, 9000);
  assert.equal(by("Sow").paid, false);
  assert.equal(by("Sow").owes, true);
  // Nothing billed for the month is neither.
  assert.equal(by("Diop").monthCents, 0);
  assert.equal(by("Diop").paid, false);
  assert.equal(by("Diop").owes, true, "only the older unpaid job");
});

test("how it was paid reads in the console's own words", () => {
  assert.equal(parkingPaidViaLabel("cash"), "Cash payment");
  assert.equal(parkingPaidViaLabel("zelle"), "Zelle transfer");
  assert.equal(parkingPaidViaLabel("card_link"), "Payment link");
  assert.equal(parkingPaidViaLabel("online"), "Online");
  assert.equal(parkingPaidViaLabel("barter"), "Another method");
});

