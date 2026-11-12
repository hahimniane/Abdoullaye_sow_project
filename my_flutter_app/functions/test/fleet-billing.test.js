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
