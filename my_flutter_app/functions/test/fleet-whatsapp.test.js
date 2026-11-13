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
  it("the exact Zelle amount is the whole dollars owed and the driver's " +
      "cents", () => {
    assert.equal(fw.zelleAmountCents(35000, 17), 35017);
    // Owed $349.83 after last month's 17 cents of credit: send $350.17,
    // never $349.17 (66 cents short, and a reminder over pennies).
    assert.equal(fw.zelleAmountCents(34983, 17), 35017);
    assert.equal(fw.zelleAmountCents(35050, 17), 35117);
    assert.equal(fw.zelleAmountCents(0, 17), 17);
    assert.equal(fw.zelleAmountCents(35000, null), null);
    assert.equal(fw.zelleAmountCents(35000, 100), null);
  });

  it("the reminder: status, amount, Zelle and exact amount, both languages",
      () => {
        const values = fw.reminderValues({driverName: "Moussa",
          businessName: "Landa Shipping", businessPhone: "+1 718 807 6869",
          settings: {zelle: {name: "Landa Shipping", handle: "718-807-6869"}},
          kind: "late", dueDayKey: "2026-11-01", owedCents: 70000,
          personalCents: 9});
        assert.deepEqual(values, [
          "Moussa",
          "Landa Shipping", "was due on Nov 1, 2026 and is late", "$700.00",
          "Landa Shipping (718-807-6869)", "$700.09",
          "Landa Shipping", "était due le 1 nov. 2026 et est en retard",
          "700,00 $", "Landa Shipping (718-807-6869)", "700,09 $",
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
