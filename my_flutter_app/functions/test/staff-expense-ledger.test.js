"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");

const ledger = require("../staff_expense_ledger");

describe("staff_expense_ledger: membership", () => {
  it("counts staff and the owner of this business only", () => {
    assert.equal(ledger.isBusinessMember(
        {role: "staff", businessId: "b1"}, "b1"), true);
    assert.equal(ledger.isBusinessMember(
        {role: "businessOwner", businessId: "b1"}, "b1"), true);
    assert.equal(ledger.isBusinessMember(
        {role: "staff", businessId: "b2"}, "b1"), false);
    assert.equal(ledger.isBusinessMember(
        {role: "customer", businessId: "b1"}, "b1"), false);
    assert.equal(ledger.isBusinessMember(
        {role: "admin", businessId: "b1"}, "b1"), false);
    assert.equal(ledger.isBusinessMember(null, "b1"), false);
    assert.equal(ledger.isBusinessMember(
        {role: "staff", businessId: ""}, ""), false);
  });
});

describe("staff_expense_ledger: the parking link", () => {
  it("builds the link from the customer's key", () => {
    const out = ledger.staffParkingLinkRecord({
      customerKey: " phone:2015551234 ", customerName: "Abdoulaye Sow",
      customerPhone: "+1 201 555 1234",
    }, {uid: "owner", nowMs: 1700});
    assert.deepEqual(out, {link: {
      customerKey: "phone:2015551234", customerName: "Abdoulaye Sow",
      customerPhone: "+1 201 555 1234", linkedAtMs: 1700,
      linkedByUid: "owner",
    }});
  });

  it("an empty key unlinks", () => {
    assert.deepEqual(ledger.staffParkingLinkRecord({customerKey: ""}, {}),
        {link: null});
    assert.deepEqual(ledger.staffParkingLinkRecord({}, {}), {link: null});
  });

  it("refuses a key that is not a bill's key", () => {
    for (const customerKey of ["2015551234", "phone:", "email:a@b.c"]) {
      assert.deepEqual(ledger.staffParkingLinkRecord({customerKey}, {}),
          {refusal: "link_customer_invalid"});
    }
    assert.equal(ledger.staffParkingLinkRecord(
        {customerKey: "name:abdoulaye sow"}, {}).link.customerKey,
    "name:abdoulaye sow");
  });
});

describe("staff_expense_ledger: repayments", () => {
  const ok = {amountCents: 500, method: "cash", creditCents: 500};

  it("accepts up to the credit", () => {
    assert.equal(ledger.repaymentRefusal(ok), "");
    for (const method of ledger.REPAYMENT_METHODS) {
      assert.equal(ledger.repaymentRefusal({...ok, method}), "");
    }
  });

  it("refuses a bad amount", () => {
    for (const amountCents of [0, -1, 1.5, "500", null, undefined, NaN,
      100000001]) {
      assert.equal(ledger.repaymentRefusal({...ok, amountCents}),
          "repayment_amount_invalid", String(amountCents));
    }
  });

  it("refuses an unknown method", () => {
    for (const method of ["", "card", "CASH", undefined]) {
      assert.equal(ledger.repaymentRefusal({...ok, method}),
          "repayment_method_invalid");
    }
  });

  it("refuses more than the credit", () => {
    assert.equal(ledger.repaymentRefusal({...ok, amountCents: 501}),
        "repayment_exceeds_credit");
    assert.equal(ledger.repaymentRefusal({...ok, creditCents: 0}),
        "repayment_exceeds_credit");
    assert.equal(ledger.repaymentRefusal({...ok, creditCents: undefined}),
        "repayment_exceeds_credit");
  });

  it("dates the payback: today by default, never a later day", () => {
    const today = "2026-10-29";
    assert.equal(ledger.repaymentDayKey("", today), today);
    assert.equal(ledger.repaymentDayKey(undefined, today), today);
    assert.equal(ledger.repaymentDayKey("2026-09-30", today), "2026-09-30");
    assert.equal(ledger.repaymentDayKey("2026-09-30T12:00:00", today),
        "2026-09-30");
    assert.equal(ledger.repaymentDayKey("2026-10-30", today), null);
    assert.equal(ledger.repaymentDayKey("2026-02-30", today), null);
    assert.equal(ledger.repaymentDayKey("yesterday", today), null);
  });

  it("records the month of the paid-back day", () => {
    const row = ledger.repaymentRecord({
      staffId: "s1", amountCents: 1250, method: "zelle", note: " cash box ",
      givenByStaffId: "",
    }, {businessId: "b1", uid: "u1", dayKey: "2026-09-30"});
    assert.deepEqual(row, {
      businessId: "b1", staffId: "s1", amountCents: 1250, month: "2026-09",
      method: "zelle", givenByStaffId: "u1", note: "cash box", voided: false,
      voidedAt: null, voidedByUid: "", recordedByUid: "u1",
    });
  });

  it("voids only a live repayment of this business", () => {
    assert.equal(ledger.repaymentVoidRefusal(null, "b1"),
        "repayment_not_found");
    assert.equal(ledger.repaymentVoidRefusal({businessId: "b2"}, "b1"),
        "repayment_not_found");
    assert.equal(ledger.repaymentVoidRefusal(
        {businessId: "b1", voided: true}, "b1"), "repayment_voided");
    assert.equal(ledger.repaymentVoidRefusal({businessId: "b1"}, "b1"), "");
  });

  it("names every refusal with a kind and a message", () => {
    for (const code of ["link_owner_only", "staff_not_member",
      "repayment_amount_invalid", "repayment_exceeds_credit",
      "repayment_not_found", "repayment_voided", "repayment_method_invalid",
      "repayment_date_invalid", "link_customer_invalid"]) {
      const {kind, message} = ledger.staffCreditRefusal(code);
      assert.ok(kind && message && message !== code, code);
    }
  });
});

describe("staff_expense_ledger: the month-end push", () => {
  const customers = [
    {key: "phone:1", dueCents: 3000},
    {key: "phone:2", dueCents: 2000},
    {key: "phone:3", dueCents: 0},
  ];
  const entries = [
    {paidByStaffId: "s1", amountCents: 3500, month: "2026-09"},
    {paidByStaffId: "s1", amountCents: 9999, month: "2026-10"},
  ];

  it("leaves the bills alone with no links or no data", () => {
    const plain = {customersOwing: 2, dueCents: 5000, expenseCreditCents: 0};
    assert.deepEqual(ledger.monthEndOwing(customers, null), plain);
    assert.deepEqual(ledger.monthEndOwing(customers,
        {entries, repayments: [], links: {}, monthKey: "2026-09"}), plain);
  });

  it("counts what is still owed after a linked staff member's expenses",
      () => {
        const out = ledger.monthEndOwing(customers, {
          entries, repayments: [], monthKey: "2026-09",
          links: {s1: {customerKey: "phone:1"}},
        });
        assert.deepEqual(out,
            {customersOwing: 1, dueCents: 2000, expenseCreditCents: 3000});
      });

  it("a repayment lowers the credit the bill gets", () => {
    const out = ledger.monthEndOwing(customers, {
      entries, monthKey: "2026-09",
      repayments: [{staffId: "s1", amountCents: 1000, month: "2026-09"}],
      links: {s1: {customerKey: "phone:1"}},
    });
    assert.deepEqual(out,
        {customersOwing: 2, dueCents: 2500, expenseCreditCents: 2500});
  });
});

describe("staff expense credit: server wiring (source contract)", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "index.js"),
      "utf8");
  const between = (from, to) => {
    const start = source.indexOf(from);
    assert.notEqual(start, -1, from);
    return source.slice(start, source.indexOf(to, start + from.length));
  };

  it("routes actions before the purchase edit reads an entry", () => {
    const fn = between("exports.updateLotExpenseEntry = ",
        "\nexports.");
    assert.ok(fn.indexOf("staffExpenseCreditAction(uid, action, data)") <
      fn.indexOf("collection(\"lotExpenseEntries\").doc(entryId)"));
  });

  it("caps a repayment inside the transaction that writes it", () => {
    const fn = between("async function recordStaffRepayment(",
        "\nasync function ");
    const tx = fn.slice(fn.indexOf("db.runTransaction("));
    assert.ok(tx.includes("transaction.get(db.collection(" +
      "\"staffExpenseRepayments\")"));
    assert.ok(tx.indexOf("repaymentRefusal(") < tx.indexOf("transaction.set("));
    assert.doesNotMatch(source, /staffExpenseRepayments"\)[^;]*\.delete\(/);
  });

  it("the month-end push uses the netted owing", () => {
    const fn = between("async function notifyParkingMonthEndFor(",
        "\nexports.");
    assert.match(fn, /staffExpenseLedger\.monthEndOwing\(summary\.customers/);
    assert.doesNotMatch(fn, /summary\.dueCents/);
    assert.doesNotMatch(fn, /summary\.customersOwing/);
  });
});
