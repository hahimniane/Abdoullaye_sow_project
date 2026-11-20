"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const fw = require("../fleet_whatsapp");

describe("Fleet WhatsApp: when a reminder goes out", () => {
  it("2 days before, on the day, 3 days late, then weekly", () => {
    const due = "2026-12-01";
    assert.equal(fw.reminderKind(due, "2026-11-29"), "soon");
    assert.equal(fw.reminderKind(due, "2026-11-30"), null);
    assert.equal(fw.reminderKind(due, "2026-12-01"), "today");
    assert.equal(fw.reminderKind(due, "2026-12-02"), null);
    assert.equal(fw.reminderKind(due, "2026-12-04"), "late");
    assert.equal(fw.reminderKind(due, "2026-12-05"), null);
    assert.equal(fw.reminderKind(due, "2026-12-11"), "late");
    assert.equal(fw.reminderKind(due, "2026-12-18"), "late");
    assert.equal(fw.reminderKind("bad", "2026-12-01"), null);
  });

  it("is about the oldest open bill with money left", () => {
    assert.equal(fw.oldestOpenBill([
      {id: "dec", status: "open", dueDayKey: "2026-12-01", amountCents: 35000,
        paidCents: 0},
      {id: "nov", status: "open", dueDayKey: "2026-11-01", amountCents: 35000,
        paidCents: 0},
      {id: "oct", status: "open", dueDayKey: "2026-10-01", amountCents: 35000,
        paidCents: 35000},
      {id: "sep", status: "paid", dueDayKey: "2026-09-01", amountCents: 35000,
        paidCents: 35000},
    ]).id, "nov");
    assert.equal(fw.oldestOpenBill([]), null);
  });
});

describe("Fleet WhatsApp: what it says", () => {
  it("the personal cents are gone: no helper builds an amount from them",
      () => {
        assert.equal(fw.zelleAmountCents, undefined);
      });

  it("the reminder: status, the plain amount owed, Zelle, both languages",
      () => {
        const values = fw.reminderValues({driverName: "Moussa",
          businessName: "Landa Shipping", businessPhone: "+1 718 807 6869",
          settings: {zelle: {name: "Landa Shipping", handle: "718-807-6869"}},
          kind: "late", dueDayKey: "2026-11-01", owedCents: 70000,
          // An old caller may still pass them: they are ignored.
          personalCents: 9});
        assert.deepEqual(values, [
          "Moussa",
          "Landa Shipping", "was due on Nov 1, 2026 and is late", "$700.00",
          "Landa Shipping (718-807-6869)", "$700.00",
          "Landa Shipping", "était due le 1 nov. 2026 et est en retard",
          "700,00 $", "Landa Shipping (718-807-6869)", "700,00 $",
          "+1 718 807 6869",
        ]);
        assert.equal(fw.reminderValues({kind: "soon", dueDayKey: "2026-12-01",
          owedCents: 35000})[2], "is due on Dec 1, 2026");
        assert.equal(fw.reminderValues({kind: "today",
          dueDayKey: "2026-12-01", owedCents: 35000})[7],
        "est due aujourd’hui");
      });

  it("the receipt: amount, day and what is left or the credit", () => {
    const values = fw.receiptValues({driverName: "Moussa",
      businessName: "Landa Shipping", businessPhone: "+17188076869",
      amountCents: 35017, paidDayKey: "2026-12-02", owedCents: 0,
      creditCents: 17});
    assert.equal(values[2], "$350.17");
    assert.equal(values[3], "Dec 2, 2026");
    assert.match(values[4], /you have \$0\.17 credit/);
    assert.equal(values[6], "350,17 $");
    assert.equal(values[7], "2 déc. 2026");
    assert.equal(fw.receiptValues({owedCents: 5000})[4],
        "You still owe $50.00.");
    assert.equal(fw.receiptValues({})[4], "You owe nothing now.");
    assert.equal(values.length, 10);
  });

  it("the /messages body; ids that never send twice; reachable numbers",
      () => {
        const body = fw.templateBody(fw.REMINDER_TEMPLATE, "+1 (718) 807-6869",
            ["a", "", "c"]);
        assert.equal(body.to, "17188076869");
        assert.equal(body.template.name, "fleet_rent_reminder_2lang");
        assert.deepEqual(body.template.components[0].parameters.map(
            (p) => p.text), ["a", "—", "c"]);
        assert.equal(fw.messageId("receipt", {paymentId: "p1"}), "receipt_p1");
        assert.equal(fw.messageId("reminder", {driverId: "d", billId: "b",
          todayKey: "2026-12-01"}), "reminder_d_b_2026-12-01");
        assert.equal(fw.reachable("+17188076869"), true);
        assert.equal(fw.reachable("12345"), false);
        assert.equal(fw.reachable(""), false);
      });
});

describe("Fleet WhatsApp: the driver's name (M6, same cases as the console)",
    () => {
      const cases = [
        ["Fawaz #9", "Fawaz"],
        ["ABU HASSAN (25)", "ABU HASSAN"],
        ["Amadou Diallo #49 STORAGE 2/14/25", "Amadou Diallo"],
        ["Dorjee Tenzin T (26) Drop it 08/25/2025 at 12:55 Pm",
          "Dorjee Tenzin T"],
        ["IDY # 50", "IDY"],
        ["KHUSRAV # (26)", "KHUSRAV"],
        ["Bako Sy", "Bako Sy"],
        ["  Bako   Sy  ", "Bako Sy"],
        ["Mamadou voir folder 12", "Mamadou"],
        ["Mamadou VOIR  FOLDER", "Mamadou"],
        ["Ali drop", "Ali"],
        ["Ali storage", "Ali"],
        ["Dropo Kone", "Dropo Kone"],
        ["Storageman", "Storageman"],
        ["Sam (25) Jones", "Sam (25) Jones"],
      ];
      for (const [input, expected] of cases) {
        it(JSON.stringify(input), () =>
          assert.equal(fw.driverDisplayName(input), expected));
      }
      it("falls back to the full name; is idempotent", () => {
        assert.equal(fw.driverDisplayName("#46"), "#46");
        assert.equal(fw.driverDisplayName("(25)"), "(25)");
        assert.equal(fw.driverDisplayName("STORAGE 2/14/25"),
            "STORAGE 2/14/25");
        assert.equal(fw.driverDisplayName(""), "");
        assert.equal(fw.driverDisplayName(null), "");
        for (const [input] of cases) {
          assert.equal(fw.driverDisplayName(fw.driverDisplayName(input)),
              fw.driverDisplayName(input));
        }
      });
      it("a receipt and a reminder greet the display name", () => {
        assert.equal(fw.receiptValues({driverName: "Fawaz #9"})[0], "Fawaz");
        assert.equal(fw.reminderValues({driverName: "ABU HASSAN (25)",
          kind: "today", dueDayKey: "2026-12-01"})[0], "ABU HASSAN");
      });
    });

describe("Fleet WhatsApp: rent bill only, credit, retries (M1, M3, M5)", () => {
  it("a reminder is about the oldest open RENT bill (M5)", () => {
    const bills = [
      {id: "fee", kind: "late_fee", status: "open", dueDayKey: "2026-11-01",
        amountCents: 5000, paidCents: 0},
      {id: "charge", kind: "charge", status: "open", dueDayKey: "2026-11-02",
        amountCents: 5000, paidCents: 0},
      {id: "dec", kind: "rent", status: "open", dueDayKey: "2026-12-01",
        amountCents: 35000, paidCents: 0},
      {id: "nov", kind: "rent", status: "open", dueDayKey: "2026-11-15",
        amountCents: 35000, paidCents: 35000},
    ];
    assert.equal(fw.oldestOpenRentBill(bills).id, "dec");
    assert.equal(fw.oldestOpenRentBill(bills.slice(0, 2)), null);
    assert.equal(fw.oldestOpenRentBill([]), null);
  });

  it("the amount stated is owed minus credit, never below zero (M3)", () => {
    assert.equal(fw.amountToState(35000, 10000), 25000);
    assert.equal(fw.amountToState(35000, 35000), 0);
    assert.equal(fw.amountToState(35000, 99999), 0);
    assert.equal(fw.amountToState(0, 0, 35000), 35000);
    assert.equal(fw.amountToState(5000, 1000, 35000), 39000);
    assert.equal(fw.amountToState(5000, -50), 5000);
  });

  it("only a failed row, or one queued over 10 minutes, is retried, at " +
      "most 3 attempts in all (M1)", () => {
    const now = 10 * 60 * 60 * 1000;
    assert.equal(fw.mayRetry({status: "failed", attempts: 1}, now), true);
    assert.equal(fw.mayRetry({status: "failed"}, now), true, "old row");
    assert.equal(fw.mayRetry({status: "failed", attempts: 2}, now), true);
    assert.equal(fw.mayRetry({status: "failed", attempts: 3}, now), false);
    for (const status of ["sent", "stopped", "skipped"]) {
      assert.equal(fw.mayRetry({status, attempts: 1}, now), false, status);
    }
    assert.equal(fw.mayRetry({status: "queued", attempts: 1,
      queuedAtMs: now - 5 * 60000}, now), false, "in flight");
    assert.equal(fw.mayRetry({status: "queued", attempts: 1,
      queuedAtMs: now - 11 * 60000}, now), true, "lost in a crash");
    assert.equal(fw.mayRetry({status: "queued", attempts: 3,
      queuedAtMs: now - 11 * 60000}, now), false);
  });
});

describe("Fleet WhatsApp: looking ahead for the coming period (M2)", () => {
  const monthly = {id: "a1", driverId: "d1", period: "monthly", dueDay: 3,
    rentCents: 35000, startDayKey: "2026-10-01"};
  const paid = (from) => ({id: `a1_${from}`, kind: "rent", status: "paid",
    periodFrom: from, periodTo: from.slice(0, 8) + "30"});

  it("a monthly period due in exactly 2 days with no bill yet", () => {
    const coming = fw.comingBill(monthly,
        [paid("2026-10-01"), paid("2026-11-01")], "2026-12-01", {});
    assert.equal(coming.dueDayKey, "2026-12-03");
    assert.equal(coming.periodFrom, "2026-12-01");
    assert.equal(coming.amountCents, 35000);
    assert.equal(coming.label, "Plate fee Dec 2026");
    assert.equal(fw.comingBill(monthly, [], "2026-11-30", {}), null);
    assert.equal(fw.comingBill(monthly, [], "2026-12-02", {}), null);
    assert.equal(fw.comingBill(monthly, [], "2026-12-03", {}), null);
  });

  it("nothing when the bill exists, or the assignment ended", () => {
    assert.equal(fw.comingBill(monthly, [paid("2026-12-01")], "2026-12-01",
        {}), null);
    assert.equal(fw.comingBill({...monthly, endDayKey: "2026-11-20"}, [],
        "2026-12-01", {}), null);
    assert.equal(fw.comingBill(null, [], "2026-12-01", {}), null);
    assert.equal(fw.comingBill(monthly, [], "bad", {}), null);
  });

  it("respects billFromDayKey and rentHistory", () => {
    const late = {...monthly, billFromDayKey: "2026-12-10"};
    assert.equal(fw.comingBill(late, [], "2026-12-01", {}), null);
    const first = fw.comingBill(late, [], "2026-12-08", {});
    assert.equal(first.dueDayKey, "2026-12-10");
    assert.equal(first.periodFrom, "2026-12-10");
    const cheaper = {...monthly, rentHistory: [{fromDayKey: "2026-12-01",
      toDayKey: "2026-12-31", rentCents: 30000, dueDay: 3}]};
    assert.equal(fw.comingBill(cheaper, [], "2026-12-01", {}).amountCents,
        30000);
  });

  it("weekly periods look ahead too", () => {
    const weekly = {id: "w1", driverId: "d1", period: "weekly", dueDay: 3,
      rentCents: 8000, startDayKey: "2026-11-30"};
    const coming = fw.comingBill(weekly, [], "2026-12-07", {});
    assert.equal(coming.periodFrom, "2026-12-07");
    assert.equal(coming.dueDayKey, "2026-12-09");
  });

  it("its message id is create-once per driver, assignment and period",
      () => {
        assert.equal(fw.messageId("lookahead", {driverId: "d1",
          assignmentId: "a1", periodFrom: "2026-12-01"}),
        "reminder_d1_soon_a1_2026-12-01");
      });
});
