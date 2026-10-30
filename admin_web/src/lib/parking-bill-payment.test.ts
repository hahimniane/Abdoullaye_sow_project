import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BILL_PAYMENT_MESSAGES,
  BILL_PAYMENT_REFUSAL,
  billPaymentFor,
  billPaymentItems,
  billPaymentPlan,
  billPaymentRecordRequest,
  billPaymentRefusalText,
  billPaymentsByCustomer,
  billPaymentsForCustomer,
  billPaymentUndoRequest,
  type BillPaymentCustomer,
} from "./parking-bill-payment.ts";

// Paying part of a month bill (docs/PARKING_BILL_PAYMENTS.md). The server's
// parking_bill_payment.js is the rule; the shared fixture pins the server,
// this console mirror and the app to the same answers.
const fixtureUrl = new URL("../../../my_flutter_app/functions/test/fixtures/parking-bill-payment-cases.json", import.meta.url);
type FixtureCase = {
  name: string;
  customer: BillPaymentCustomer;
  amountCents: number;
  expect: {
    ok: boolean;
    reason: string;
    payableCents: number;
    leftCents: number;
    parts: { kind: string; id: string; label: string; amountCents: number; full: boolean }[];
  };
};
const fixture = JSON.parse(readFileSync(fixtureUrl, "utf8")) as {
  cases: FixtureCase[];
  labels: { parts: { label: string }[]; en: string; fr: string }[];
};

test("every shared case gives the server's answer", () => {
  assert.ok(fixture.cases.length >= 10, "the fixture has its cases");
  for (const k of fixture.cases) {
    const plan = billPaymentPlan(k.customer, k.amountCents);
    assert.deepEqual(
      {
        ok: plan.ok,
        reason: plan.reason,
        payableCents: plan.payableCents,
        leftCents: plan.leftCents,
        parts: plan.parts.map((p) => ({ kind: p.kind, id: p.id, label: p.label, amountCents: p.amountCents, full: p.full })),
      },
      k.expect,
      k.name,
    );
  }
});

test("every shared label reads the same in both languages", () => {
  assert.ok(fixture.labels.length >= 5);
  for (const l of fixture.labels) {
    assert.equal(billPaymentFor(l.parts, "en"), l.en);
    assert.equal(billPaymentFor(l.parts, "fr"), l.fr);
    assert.equal(billPaymentFor(l.parts), l.en, "English by default");
  }
});

test("the items are oldest first and a paid-through plan never exceeds them", () => {
  const first = fixture.cases[0];
  const items = billPaymentItems(first.customer);
  assert.deepEqual(items.map((i) => `${i.kind}:${i.id}`), ["car:old1", "activity:a0", "car:c1", "car:c1", "activity:a1"]);
  const dayKeys = items.map((i) => i.dayKey);
  assert.deepEqual(dayKeys.slice(0, 2), ["2026-08-03", "2026-08-20"].sort(), "before the month, by date");
  assert.equal(items.reduce((s, i) => s + i.amountCents, 0), billPaymentPlan(first.customer, 1).payableCents);
  assert.deepEqual(billPaymentItems(null), []);
  assert.equal(billPaymentPlan(undefined, 100).reason, BILL_PAYMENT_REFUSAL.NOTHING_TO_PAY);
});

test("the refusals have the server's words", () => {
  assert.equal(BILL_PAYMENT_MESSAGES[BILL_PAYMENT_REFUSAL.NO_AMOUNT], "Enter the amount received.");
  assert.equal(BILL_PAYMENT_MESSAGES[BILL_PAYMENT_REFUSAL.MORE_THAN_OWED], "That is more than this bill owes. Record what is owed and give the rest back.");
  assert.equal(Object.keys(BILL_PAYMENT_MESSAGES).length, Object.keys(BILL_PAYMENT_REFUSAL).length, "a message for every refusal");
  // The reasons are the server's strings, spelled the same.
  const server = readFileSync(new URL("../../../my_flutter_app/functions/parking_bill_payment.js", import.meta.url), "utf8");
  for (const code of Object.values(BILL_PAYMENT_REFUSAL)) assert.ok(server.includes(`"${code}"`), code);
  for (const message of Object.values(BILL_PAYMENT_MESSAGES)) {
    // The server writes them across lines; compare without the joins.
    const joined = server.replace(/"\s*\+\s*\n\s*"/g, "");
    assert.ok(joined.includes(message), message);
  }
});

test("a rejection reads as its reason, never the raw text", () => {
  assert.equal(billPaymentRefusalText({ details: { reason: "bill_payment_bill_changed" } }), BILL_PAYMENT_MESSAGES.bill_payment_bill_changed);
  assert.equal(billPaymentRefusalText({ code: "functions/permission-denied", details: { reason: "bill_payment_ledger_required" } }), BILL_PAYMENT_MESSAGES.bill_payment_ledger_required);
  assert.match(billPaymentRefusalText({ code: "functions/permission-denied", message: "internal detail" }), /not allowed/);
  const unknown = billPaymentRefusalText(new Error("INTERNAL stack trace"));
  assert.doesNotMatch(unknown, /INTERNAL/);
  assert.match(unknown, /did not save/);
  assert.match(billPaymentRefusalText(null), /did not save/);
  assert.match(billPaymentRefusalText({ details: { reason: "toString" } }), /did not save/, "an inherited key is not a reason");
});

test("the record request carries what the server needs, and the preview's payable total", () => {
  const plan = billPaymentPlan(fixture.cases[0].customer, 6500);
  assert.deepEqual(
    billPaymentRecordRequest({
      businessId: "biz1", monthKey: "2026-09", customerKey: "phone:2015550101", amountCents: 6500,
      receivedVia: "zelle", receivedByStaffId: "staff1", note: "  Month end — September 2026  ", expectedPayableCents: plan.payableCents,
    }),
    {
      action: "bill_payment_record", businessId: "biz1", monthKey: "2026-09", customerKey: "phone:2015550101",
      amountCents: 6500, receivedVia: "zelle", receivedByStaffId: "staff1", note: "Month end — September 2026", expectedPayableCents: 13000,
    },
  );
  const bare = billPaymentRecordRequest({
    businessId: "b", monthKey: "2026-09", customerKey: "k", amountCents: 12.4, receivedVia: "cash", receivedByStaffId: "business_account", expectedPayableCents: 100,
  });
  assert.equal(bare.note, "");
  assert.equal(bare.amountCents, 12, "whole cents");
  assert.equal(bare.receivedByStaffId, "business_account");
});

test("the undo request names the payment", () => {
  assert.deepEqual(billPaymentUndoRequest("biz1", "pay1"), { action: "bill_payment_undo", businessId: "biz1", billPaymentId: "pay1" });
});

test("a customer's payments: matched by customerKey, newest first", () => {
  const rows = [
    { id: "p1", customerKey: "phone:1", amountCents: 1000, atMs: 1000, status: "recorded", receivedVia: "cash", receivedByStaffId: "s1", parts: [{ label: "A", amountCents: 1000, full: true }] },
    { id: "p2", customerKey: "phone:2", amountCents: 500, atMs: 5000, status: "recorded" },
    { id: "p3", customerKey: "phone:1", amountCents: 2000, atMs: 3000, status: "undone", undoneAtMs: 4000 },
    { id: "p4", customerKey: "phone:1", amountCents: 700, atMs: 2000, status: "recorded" },
    { id: "nokey", amountCents: 9, atMs: 9 },
  ];
  assert.deepEqual(billPaymentsForCustomer(rows, "phone:1").map((p) => p.id), ["p3", "p4", "p1"]);
  assert.deepEqual(billPaymentsForCustomer(rows, "phone:2").map((p) => p.id), ["p2"]);
  assert.deepEqual(billPaymentsForCustomer(rows, "phone:9"), []);
  assert.deepEqual(billPaymentsForCustomer(null, "phone:1"), []);
  const byCustomer = billPaymentsByCustomer(rows);
  assert.equal(byCustomer.size, 2, "a row with no customer is dropped");
  const [undone] = byCustomer.get("phone:1")!;
  assert.equal(undone.status, "undone");
  assert.equal(undone.undoneAtMs, 4000);
  const recorded = byCustomer.get("phone:1")![2];
  assert.deepEqual(recorded.parts, [{ label: "A", amountCents: 1000, full: true }]);
  assert.equal(recorded.receivedVia, "cash");
  // Same moment: a stable order by id.
  const tied = billPaymentsForCustomer([{ id: "b", customerKey: "k", atMs: 1 }, { id: "a", customerKey: "k", atMs: 1 }], "k");
  assert.deepEqual(tied.map((p) => p.id), ["a", "b"]);
  // Anything but "undone" stands.
  assert.equal(billPaymentsForCustomer([{ id: "x", customerKey: "k", status: "weird" }], "k")[0].status, "recorded");
});
