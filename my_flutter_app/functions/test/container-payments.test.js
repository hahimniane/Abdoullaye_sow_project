"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  CONTAINER_PAYMENT_METHODS,
  PAYMENT_STATUS,
  MAX_CENTS,
  priceCentsOf,
  paidCentsOf,
  priceErrors,
  linePriceRecord,
  validateLinePayment,
  linePaymentRecord,
  sumLivePayments,
  paymentRevertRefusal,
  linePaymentStanding,
} = require("../container_payments");
const {INVOICE_PAYMENT_METHODS} = require("../invoice_ledger");
const {CONTAINER_MESSAGES} = require("../container_manifest");

describe("a package's price", () => {
  it("is whole cents above zero, and empty means not priced yet", () => {
    assert.equal(priceCentsOf(15000), 15000);
    assert.equal(priceCentsOf("15000"), 15000);
    assert.equal(priceCentsOf(null), null);
    assert.equal(priceCentsOf(""), null);
    assert.equal(priceCentsOf(undefined), null);
    for (const bad of [0, -1, 12.5, "abc", MAX_CENTS + 1]) {
      assert.equal(priceCentsOf(bad), null, String(bad));
      assert.deepEqual(priceErrors(bad), ["price_invalid"], String(bad));
    }
    assert.deepEqual(priceErrors(null), []);
    assert.deepEqual(priceErrors(MAX_CENTS), []);
  });

  it("can never drop below what was paid, nor be taken away after", () => {
    assert.deepEqual(priceErrors(5000, 5000), []);
    assert.deepEqual(priceErrors(4999, 5000), ["price_below_paid"]);
    assert.deepEqual(priceErrors(null, 5000), ["price_below_paid"]);
    assert.deepEqual(priceErrors(null, 0), []);
  });

  it("is stored with the pay-on-arrival promise beside it", () => {
    assert.deepEqual(linePriceRecord({priceCents: "9000",
      payOnArrival: true}), {priceCents: 9000, payOnArrival: true});
    assert.deepEqual(linePriceRecord({}),
        {priceCents: null, payOnArrival: false});
    assert.deepEqual(linePriceRecord({priceCents: null,
      payOnArrival: "yes"}), {priceCents: null, payOnArrival: false});
    assert.deepEqual(linePriceRecord(null),
        {priceCents: null, payOnArrival: false});
  });
});

describe("recording a payment", () => {
  const line = (extra = {}) => ({priceCents: 15000, paidCents: 0, ...extra});
  const pay = (extra = {}) => ({amountCents: 5000, method: "cash", ...extra});

  it("takes any amount up to what is still owed", () => {
    assert.deepEqual(validateLinePayment(pay(), line()), []);
    assert.deepEqual(validateLinePayment(pay({amountCents: 15000}), line()),
        []);
    assert.deepEqual(validateLinePayment(pay({amountCents: 10000}),
        line({paidCents: 5000})), []);
  });

  it("refuses more than the balance, so a line is never overpaid", () => {
    assert.deepEqual(validateLinePayment(pay({amountCents: 15001}), line()),
        ["payment_exceeds_balance"]);
    assert.deepEqual(validateLinePayment(pay({amountCents: 10001}),
        line({paidCents: 5000})), ["payment_exceeds_balance"]);
    assert.deepEqual(validateLinePayment(pay({amountCents: 1}),
        line({paidCents: 15000})), ["payment_exceeds_balance"]);
  });

  it("needs a price first", () => {
    assert.deepEqual(validateLinePayment(pay(), line({priceCents: null})),
        ["price_required"]);
    assert.deepEqual(validateLinePayment(pay(), {}), ["price_required"]);
  });

  it("needs a real amount and a known way it arrived", () => {
    for (const bad of [0, -5, "abc", null, undefined]) {
      assert.deepEqual(validateLinePayment(pay({amountCents: bad}), line()),
          ["amount_required"], String(bad));
    }
    assert.deepEqual(validateLinePayment(pay({amountCents: MAX_CENTS + 1}),
        line()), ["amount_too_large"]);
    assert.deepEqual(validateLinePayment(pay({method: "barter"}), line()),
        ["payment_method_invalid"]);
    assert.deepEqual(validateLinePayment({amountCents: 0, method: ""},
        line()), ["amount_required", "payment_method_invalid"]);
  });

  it("uses the same ways of paying as invoices do", () => {
    assert.deepEqual(CONTAINER_PAYMENT_METHODS, INVOICE_PAYMENT_METHODS);
    for (const method of CONTAINER_PAYMENT_METHODS) {
      assert.deepEqual(validateLinePayment(pay({method}), line()), []);
    }
  });

  it("is stored as whole cents with a trimmed note, not reverted", () => {
    assert.deepEqual(linePaymentRecord({amountCents: "5000.4",
      method: "zelle", note: "  paid by the sister  "}),
    {amountCents: 5000, method: "zelle", note: "paid by the sister",
      reverted: false});
    assert.equal(linePaymentRecord({amountCents: 100, method: "cash",
      note: "x".repeat(500)}).note.length, 200);
  });
});

describe("what has been paid", () => {
  it("is the sum of the payments that were not reverted", () => {
    assert.equal(sumLivePayments([
      {amountCents: 5000}, {amountCents: 2500, reverted: true},
      {amountCents: 1000, reverted: false}]), 6000);
    assert.equal(sumLivePayments([]), 0);
    assert.equal(sumLivePayments(null), 0);
    assert.equal(sumLivePayments([null, {amountCents: -5}]), 0);
    assert.equal(paidCentsOf("junk"), 0);
    assert.equal(paidCentsOf(-5), 0);
  });

  it("refuses to revert a payment twice, or one that is gone", () => {
    assert.equal(paymentRevertRefusal({amountCents: 5}), null);
    assert.equal(paymentRevertRefusal({amountCents: 5, reverted: true}),
        "payment_already_reverted");
    assert.equal(paymentRevertRefusal(null), "payment_not_found");
  });
});

describe("where a package stands", () => {
  const standing = (line) => linePaymentStanding(line);

  it("reads unpaid, partial, paid and pay on arrival", () => {
    assert.deepEqual(standing({priceCents: 15000, paidCents: 0}),
        {status: PAYMENT_STATUS.UNPAID, priceCents: 15000, paidCents: 0,
          balanceCents: 15000});
    assert.equal(standing({priceCents: 15000, paidCents: 5000}).status,
        "partial");
    assert.deepEqual(standing({priceCents: 15000, paidCents: 15000}),
        {status: "paid", priceCents: 15000, paidCents: 15000,
          balanceCents: 0});
    assert.equal(standing({priceCents: 15000, paidCents: 0,
      payOnArrival: true}).status, "pay_on_arrival");
  });

  it("lets money that landed speak louder than the promise", () => {
    assert.equal(standing({priceCents: 15000, paidCents: 5000,
      payOnArrival: true}).status, "partial");
    assert.equal(standing({priceCents: 15000, paidCents: 15000,
      payOnArrival: true}).status, "paid");
  });

  it("is not unpaid when nothing has been priced", () => {
    assert.equal(standing({}).status, "no_price");
    assert.equal(standing({priceCents: null, payOnArrival: true}).status,
        "pay_on_arrival");
    assert.equal(standing({}).balanceCents, 0);
    assert.equal(standing(null).status, "no_price");
  });

  it("never reports a negative balance", () => {
    assert.equal(standing({priceCents: 1000, paidCents: 5000}).balanceCents,
        0);
  });
});

describe("the words the screens show", () => {
  it("has a message for every code a payment can be refused with", () => {
    for (const code of ["price_invalid", "price_below_paid", "price_required",
      "amount_required", "amount_too_large", "payment_method_invalid",
      "payment_exceeds_balance", "payment_not_found",
      "payment_already_reverted"]) {
      assert.ok(CONTAINER_MESSAGES[code], code);
    }
  });
});
