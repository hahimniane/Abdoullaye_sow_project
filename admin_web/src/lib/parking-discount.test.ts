/**
 * The console's discount rules against the shared fixture the server and the
 * app also run (docs/PARKING_DISCOUNT.md).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { discountPreview, parkingDiscountsOf } from "./parking-discount.ts";
import { parkingBalanceNow } from "./parking-balance.ts";
import { parkingMonthStatement } from "./parking-month-statement.ts";

type Row = Record<string, unknown>;
const fixtureUrl = new URL("../../../my_flutter_app/functions/test/fixtures/parking-discount-cases.json", import.meta.url);
const fixture = JSON.parse(readFileSync(fixtureUrl, "utf8")) as {
  now: string;
  monthCases: { name: string; monthKey: string; car: Row; expect: Row }[];
  planCases: { name: string; mode: "discount" | "settle"; car: Row; amountCents: number; reason: string; receivedByStaffId?: string; expect: Row }[];
};
const NOW = new Date(fixture.now);
const pick = (value: unknown, keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, (value as Row | null)?.[k]]));

describe("parking discount (console): the month bill", () => {
  for (const c of fixture.monthCases) {
    it(c.name, () => {
      const bill = parkingMonthStatement(c.car, c.monthKey, NOW);
      assert.deepEqual(pick(bill, Object.keys(c.expect)), c.expect);
    });
  }
});

describe("parking discount (console): the preview", () => {
  for (const c of fixture.planCases) {
    it(c.name, () => {
      const plan = discountPreview(c.car, c.mode, c.amountCents, c.reason, c.receivedByStaffId ?? "", NOW);
      assert.deepEqual(pick(plan, Object.keys(c.expect)), c.expect);
    });
  }
});

describe("parking discount (console): the car", () => {
  it("balance takes the discount off and never counts it as paid", () => {
    const car = { parkingDate: "2026-10-20T12:00:00Z", dailyRate: 10, parkingDiscountCents: 2500 };
    const balance = parkingBalanceNow(car, new Date("2026-10-29T15:00:00Z"));
    assert.equal(balance?.paidCents, 0);
    assert.equal(balance?.discountCents, 2500);
    assert.equal(balance?.balanceCents, 7500);
  });

  it("lists discounts newest first, undone ones kept", () => {
    const list = parkingDiscountsOf({ parkingDiscounts: [
      { id: "a", amountCents: 100, atMs: 1, reason: "x" },
      { id: "b", amountCents: 200, atMs: 2, reason: "y", undone: true, undoneAtMs: 3 },
      { id: "", amountCents: 50 },
    ] });
    assert.deepEqual(list.map((d) => [d.id, d.undone]), [["b", true], ["a", false]]);
  });
});

describe("parking discount (console): French History lines", async () => {
  const { translateAuditSummary } = await import("./audit-summaries.ts");
  it("translates the three server sentences, the reason kept as typed", () => {
    assert.equal(translateAuditSummary("Discount of $500.00 given (Long stay)"),
      "Remise de $500.00 accordée (Long stay)");
    assert.equal(translateAuditSummary("Settled for $1500.00: discount of $500.00 (Agreed)"),
      "Réglé pour $1500.00 : remise de $500.00 (Agreed)");
    assert.equal(translateAuditSummary("Discount of $32.00 undone"), "Remise de $32.00 annulée");
  });
});

describe("parking discount (console): Month end settle for less", async () => {
  const { billSettlePlan } = await import("./parking-bill-payment.ts");
  const settleUrl = new URL("../../../my_flutter_app/functions/test/fixtures/parking-settle-cases.json", import.meta.url);
  const { cases } = JSON.parse(readFileSync(settleUrl, "utf8")) as { cases: { name: string; paidCents: number; customer: Row; expect: Row }[] };
  for (const c of cases) {
    it(c.name, () => {
      const plan = billSettlePlan(c.customer as never, c.paidCents);
      assert.equal(plan.ok, c.expect.ok);
      if (!c.expect.ok) {
        assert.equal(plan.reason, c.expect.reason);
        return;
      }
      assert.equal(plan.payableCents, c.expect.payableCents);
      assert.equal(plan.discountCents, c.expect.discountCents);
      assert.deepEqual(plan.parts.map((p) => [p.kind, p.id, p.amountCents, p.full]), c.expect.parts);
      assert.deepEqual(plan.discountParts.map((d) => [d.id, d.amountCents]), c.expect.discountParts);
    });
  }
});
