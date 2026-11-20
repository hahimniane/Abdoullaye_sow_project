"use strict";

// docs/FLEET.md section 3. The shared fixture is also run by the console
// (admin_web/src/lib/fleet-billing.test.ts).

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");
const {
  FLEET_MESSAGES,
  allocatePayment,
  applyCredit,
  assignPersonalCents,
  whoDroveAt,
  driverBalance,
  lateFeesToCreate,
  rentBillsToCreate,
  rentPeriods,
} = require("../fleet_billing");
const fixture = require("./fixtures/fleet-billing-cases.json");

const pick = (value, keys) =>
  Object.fromEntries(keys.map((k) => [k, value?.[k]]));

describe("fleet billing: rent periods", () => {
  for (const c of fixture.periodCases) {
    it(c.name, () => {
      assert.deepEqual(rentPeriods(c.assignment, c.through), c.expect);
    });
  }
});

describe("fleet billing: rent bills", () => {
  for (const c of fixture.billCases) {
    it(c.name, () => {
      const bills = rentBillsToCreate(c.assignment, c.existing, c.through,
          c.settings);
      if (c.expect) assert.deepEqual(bills, c.expect);
      if (c.expectIds) {
        assert.deepEqual(bills.map((b) => b.id), c.expectIds);
      }
      if (c.expectAmounts) {
        assert.deepEqual(bills.map((b) => b.amountCents), c.expectAmounts);
      }
    });
  }

  it("running twice with the new ids as existing creates nothing", () => {
    const c = fixture.billCases[0];
    const first = rentBillsToCreate(c.assignment, [], "2027-02-10", {});
    const again = rentBillsToCreate(c.assignment, first.map((b) => b.id),
        "2027-02-10", {});
    assert.equal(first.length, 4);
    assert.deepEqual(again, []);
  });
});

describe("fleet billing: a bill once the plate came back", () => {
  const {billAfterReturn} = require("../fleet_billing");
  const nov = {periodFrom: "2026-11-01", periodTo: "2026-11-30",
    amountCents: 40000};

  it("a period used to its last day stays as it is", () => {
    assert.equal(billAfterReturn(nov, "2026-11-30", {}), 40000);
    assert.equal(billAfterReturn(nov, "2027-01-10", {returnRule: "days"}),
        40000);
  });

  it("the period the return falls in follows the return rule", () => {
    assert.equal(billAfterReturn(nov, "2026-11-15", {}), 40000);
    assert.equal(billAfterReturn(nov, "2026-11-15", {returnRule: "days"}),
        20000);
  });

  it("a period that begins after the return is worth nothing", () => {
    assert.equal(billAfterReturn(nov, "2026-10-31", {}), 0);
    assert.equal(billAfterReturn({amountCents: 40000}, "2026-11-15", {}), 0);
  });
});

describe("fleet billing: late fees", () => {
  for (const c of fixture.lateFeeCases) {
    it(c.name, () => {
      const fees = lateFeesToCreate(c.bills, c.settings, c.today);
      const keys = Object.keys(c.expect[0] || {});
      assert.deepEqual(fees.map((f) => pick(f, keys)), c.expect);
      for (const f of fees) {
        assert.equal(f.kind, "late_fee");
        assert.equal(f.status, "open");
        assert.equal(f.paidCents, 0);
      }
    });
  }
});

describe("fleet billing: payments and credit", () => {
  for (const c of fixture.allocationCases) {
    it(c.name, () => {
      assert.deepEqual(allocatePayment(c.bills, c.amountCents), c.expect);
    });
  }
  for (const c of fixture.creditCases) {
    it(`credit: ${c.name}`, () => {
      assert.deepEqual(applyCredit(c.bills, c.creditCents), c.expect);
    });
  }

  it("every refusal code has a plain sentence", () => {
    assert.ok(FLEET_MESSAGES.fleet_no_amount);
  });

  it("the allocations plus credit always equal what was paid", () => {
    const c = fixture.allocationCases[0];
    const r = allocatePayment(c.bills, c.amountCents);
    const used = r.allocations.reduce((s, a) => s + a.cents, 0);
    assert.equal(used + r.creditAddedCents, c.amountCents);
  });
});

describe("fleet billing: balance", () => {
  for (const c of fixture.balanceCases) {
    it(c.name, () => {
      assert.deepEqual(driverBalance(c.bills, c.creditCents, c.today),
          c.expect);
    });
  }
});

describe("fleet billing: personal cents", () => {
  for (const c of fixture.personalCases) {
    it(c.name, () => {
      assert.deepEqual(assignPersonalCents(c.drivers), c.expect);
    });
  }

  it("more than 99 drivers: the extra get null", () => {
    const drivers = Array.from({length: 101}, (_, i) => ({
      id: `d${String(i).padStart(3, "0")}`, personalCents: null, createdAt: i,
    }));
    const out = assignPersonalCents(drivers);
    const values = Object.values(out).filter((v) => v !== null);
    assert.equal(values.length, 99);
    assert.equal(new Set(values).size, 99);
    assert.equal(out.d099, null);
    assert.equal(out.d100, null);
    assert.equal(out.d000, 1);
  });
});

describe("fleet billing: who drove", () => {
  for (const c of fixture.whoDroveCases) {
    it(c.name, () => {
      assert.deepEqual(whoDroveAt(c.assignments, c.substitutes,
          c.carId, c.dayKey), c.expect);
    });
  }
});

describe("fleet billing: a late fee paid on time is taken back (Q2)", () => {
  const {lateFeesPaidOnTime} = require("../fleet_billing");
  const rent = (id, due, amount = 35000) => ({id, kind: "rent",
    status: "open", amountCents: amount, paidCents: 0, dueDayKey: due});
  const fee = (forId, day, extra = {}) => ({id: `${forId}_late`,
    kind: "late_fee", status: "open", amountCents: 5000, paidCents: 0,
    dueDayKey: day, lateFeeForBillId: forId, ...extra});
  const bills = [rent("r1", "2026-12-01"), fee("r1", "2026-12-05")];

  it("a payment dated on or before the fee day that covers the rent", () => {
    assert.deepEqual(lateFeesPaidOnTime(bills, "2026-12-05", 35000),
        ["r1_late"]);
    assert.deepEqual(lateFeesPaidOnTime(bills, "2026-12-02", 40000),
        ["r1_late"]);
  });
  it("not after the fee day, not when the rent is not covered", () => {
    assert.deepEqual(lateFeesPaidOnTime(bills, "2026-12-06", 35000), []);
    assert.deepEqual(lateFeesPaidOnTime(bills, "2026-12-05", 34999), []);
    assert.deepEqual(lateFeesPaidOnTime(bills, "", 35000), []);
  });
  it("not a fee that is partly paid, waived, or for another bill", () => {
    assert.deepEqual(lateFeesPaidOnTime([bills[0],
      fee("r1", "2026-12-05", {paidCents: 100})], "2026-12-05", 35000), []);
    assert.deepEqual(lateFeesPaidOnTime([bills[0],
      fee("r1", "2026-12-05", {status: "waived"})], "2026-12-05", 35000), []);
    assert.deepEqual(lateFeesPaidOnTime([fee("gone", "2026-12-05")],
        "2026-12-05", 35000), []);
  });
  it("fees are paid first, so a fee whose rent the money cannot cover " +
      "stays and takes the money first", () => {
    const two = [rent("r1", "2026-12-01"), fee("r1", "2026-12-05"),
      rent("r2", "2027-01-01"), fee("r2", "2027-01-05")];
    assert.deepEqual(lateFeesPaidOnTime(two, "2026-12-04", 35000), []);
    assert.deepEqual(lateFeesPaidOnTime(two, "2026-12-04", 70000).sort(),
        ["r1_late", "r2_late"]);
  });
});
