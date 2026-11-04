"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");
const pay = require("../package_pay_now");

// Pay now's pure rules (docs/PACKAGE_BOX_SIZES_PAY_NOW.md section 3): when a
// link exists, the weeks, the weekly payout arithmetic, refunds, the ledger
// rows and the words the WhatsApp templates carry.

const ON = {payNow: true};
const OFF = {payNow: false};

const request = (extra = {}) => ({
  status: "confirmed",
  handoff: "bring_in",
  payment: {timing: "at_handoff", paidCents: 0},
  pieces: [
    {id: "p1", kind: "barrel", estimateCents: 15000,
      price: {source: "barrel", unitCents: 15000}},
    {id: "p2", kind: "box", estimateCents: 4000,
      price: {source: "item", unitCents: 4000, includedLb: 0}},
  ],
  estimate: {version: 1, totalCents: 19000, auto: true, pickupFeeCents: 0,
    pieces: [{id: "p1", cents: 15000}, {id: "p2", cents: 4000}]},
  ...extra,
});

describe("the Pay now switch", () => {
  it("reads payNow, else the older card switch", () => {
    const business = (raw) => ({packageRequestSettings: raw});
    assert.equal(pay.payNowSettingsOf(business({payNow: true})).payNow, true);
    assert.equal(pay.payNowSettingsOf(business({payNow: false,
      cardBarrelBooking: true})).payNow, false);
    assert.equal(pay.payNowSettingsOf(business({cardBarrelBooking: true}))
        .payNow, true);
    assert.equal(pay.payNowSettingsOf(business({})).payNow, false);
    assert.equal(pay.payNowSettingsOf({}).payNow, false);
  });

  it("a save sets both fields from payNow, or from the old switch", () => {
    assert.equal(pay.payNowFromInput({payNow: true,
      cardBarrelBooking: false}), true);
    assert.equal(pay.payNowFromInput({payNow: false,
      cardBarrelBooking: true}), false);
    assert.equal(pay.payNowFromInput({cardBarrelBooking: true}), true);
    assert.equal(pay.payNowFromInput({}), false);
    assert.equal(pay.payNowFromInput(null), false);
  });

  it("charges direct only with Stripe connected and payouts on", () => {
    assert.equal(pay.chargeTypeOf({stripeAccountId: "acct_1",
      payoutsEnabled: true}), "direct");
    assert.equal(pay.chargeTypeOf({stripeAccountId: "acct_1",
      payoutsEnabled: false}), "platform");
    assert.equal(pay.chargeTypeOf({payoutsEnabled: true}), "platform");
    assert.equal(pay.chargeTypeOf({}), "platform");
  });
});

describe("payNowState", () => {
  it("is payable when the switch is on and the total is exact", () => {
    assert.deepEqual(pay.payNowState(request(), ON),
        {payable: true, amountCents: 19000, reason: ""});
  });

  it("is not payable when the switch is off, and says so", () => {
    const state = pay.payNowState(request(), OFF);
    assert.equal(state.payable, false);
    assert.equal(state.reason, "pay_now_off");
    assert.equal(state.amountCents, 19000);
  });

  it("follows the old card switch when payNow is not given", () => {
    assert.equal(pay.payNowState(request(),
        {cardBarrelBooking: true}).payable, true);
    assert.equal(pay.payNowState(request(),
        {cardBarrelBooking: false}).payable, false);
  });

  it("needs a confirmed, open request", () => {
    for (const status of ["new", "estimate_sent", "received", "declined",
      "cancelled", "expired", "customer_declined"]) {
      const state = pay.payNowState(request({status}), ON);
      assert.equal(state.payable, false, status);
      assert.equal(state.reason, "request_not_open", status);
    }
    assert.equal(pay.payNowState(request({closedAtMs: 5}), ON).reason,
        "request_not_open");
  });

  it("leaves the barrel card order flow alone", () => {
    const state = pay.payNowState(request({payment: {timing: "card",
      paidCents: 15000}}), ON);
    assert.equal(state.payable, false);
    assert.equal(state.reason, "card_order");
  });

  it("needs a total above zero", () => {
    assert.equal(pay.payNowState(request({estimate: null}), ON).reason,
        "no_total");
    assert.equal(pay.payNowState(request({estimate: {totalCents: 0,
      pieces: []}}), ON).reason, "no_total");
  });

  it("refuses a total Stripe could not charge", () => {
    const big = request();
    big.estimate = {...big.estimate, totalCents: 100000000};
    assert.equal(pay.payNowState(big, ON).reason, "amount_too_large");
  });

  it("is not exact while a piece has no price", () => {
    const row = request();
    row.estimate = {...row.estimate, pieces: [{id: "p1", cents: 15000}]};
    assert.equal(pay.payNowState(row, ON).reason, "unpriced_piece");
    const nobody = request({pieces: []});
    assert.equal(pay.payNowState(nobody, ON).reason, "unpriced_piece");
  });

  it("is not exact while the counter's scale decides a price", () => {
    const perLb = request();
    perLb.pieces[1] = {id: "p2", kind: "box", estimateCents: 4000,
      price: {source: "per_lb", perLbCents: 400, weightLb: 10}};
    assert.equal(pay.payNowState(perLb, ON).reason, "weighed_at_counter");
    const included = request();
    included.pieces[1] = {id: "p2", kind: "box", estimateCents: 4000,
      price: {source: "item", unitCents: 4000, includedLb: 20}};
    assert.equal(pay.payNowState(included, ON).reason,
        "weighed_at_counter");
  });

  it("is exact when a person priced every piece, scale or not", () => {
    const row = request();
    row.pieces[1] = {id: "p2", kind: "box", estimateCents: 4000,
      price: {source: "per_lb", perLbCents: 400, weightLb: 10}};
    row.estimate = {...row.estimate, auto: false};
    assert.equal(pay.payNowState(row, ON).payable, true);
  });

  it("needs the pickup fee to be known", () => {
    const collect = request({handoff: "collect", pickup: {address: "1 Main"}});
    assert.equal(pay.payNowState(collect, ON).reason, "pickup_fee_unknown");
    collect.pickup = {address: "1 Main", feeCents: 1500};
    collect.estimate = {...collect.estimate, pickupFeeCents: 1500,
      totalCents: 20500};
    assert.equal(pay.payNowState(collect, ON).payable, true);
    // A person's estimate names the fee itself.
    const byStaff = request({handoff: "collect", pickup: {address: "x"}});
    byStaff.estimate = {...byStaff.estimate, auto: false,
      pickupFeeCents: 0};
    assert.equal(pay.payNowState(byStaff, ON).payable, true);
  });
});

describe("payNowPlan", () => {
  it("opens a link the first time the request is payable", () => {
    assert.deepEqual(pay.payNowPlan(request(), ON), {action: "open",
      amountCents: 19000, notify: true, balanceDueCents: 0,
      refundDueCents: 0});
  });

  it("does nothing when there is nothing to pay", () => {
    assert.equal(pay.payNowPlan(request(), OFF).action, "none");
    assert.equal(pay.payNowPlan(request({status: "estimate_sent"}), ON)
        .action, "none");
  });

  it("is quiet when the open amount did not change, one message when it " +
    "did", () => {
    const open = pay.newPayNow({token: "t", linkUrl: "u", amountCents: 19000,
      chargeType: "platform", nowMs: 1});
    assert.equal(pay.payNowPlan(request({payNow: open}), ON).action, "none");
    const moved = request({payNow: {...open, amountCents: 15000}});
    assert.deepEqual(pay.payNowPlan(moved, ON), {action: "open",
      amountCents: 19000, notify: true, balanceDueCents: 0,
      refundDueCents: 0});
  });

  it("cancels an open link that stopped being payable, and reopens it", () => {
    const open = pay.newPayNow({token: "t", linkUrl: "u", amountCents: 19000,
      chargeType: "platform", nowMs: 1});
    assert.equal(pay.payNowPlan(request({payNow: open}), OFF).action,
        "cancel");
    const cancelled = {...open, status: "cancelled"};
    assert.equal(pay.payNowPlan(request({payNow: cancelled}), OFF).action,
        "none");
    const again = pay.payNowPlan(request({payNow: cancelled}), ON);
    assert.equal(again.action, "open");
    assert.equal(again.notify, true);
  });

  it("keeps the same token when a link reopens", () => {
    const cancelled = {...pay.newPayNow({token: "keep", linkUrl: "u",
      amountCents: 100, chargeType: "platform", nowMs: 1}),
    status: "cancelled", mintCount: 2};
    const next = pay.applyPlan(cancelled, {action: "open",
      amountCents: 19000}, {nowMs: 9, token: "other"});
    assert.equal(next.token, "keep");
    assert.equal(next.status, "open");
    assert.equal(next.amountCents, 19000);
    assert.equal(next.mintCount, 2);
  });

  it("asks for the difference at the counter when a paid total goes up",
      () => {
        const paid = {...pay.newPayNow({token: "t", linkUrl: "u",
          amountCents: 19000, chargeType: "platform", nowMs: 1}),
        status: "paid", paidCents: 19000};
        const up = request({payNow: paid});
        up.estimate = {...up.estimate, totalCents: 24000};
        const plan = pay.payNowPlan(up, ON);
        assert.equal(plan.action, "balances");
        assert.equal(plan.balanceDueCents, 5000);
        assert.equal(plan.refundDueCents, 0);
        assert.equal(plan.notify, false);
      });

  it("prompts a refund when a paid total goes down", () => {
    const paid = {...pay.newPayNow({token: "t", linkUrl: "u",
      amountCents: 19000, chargeType: "platform", nowMs: 1}),
    status: "paid", paidCents: 19000};
    const down = request({payNow: paid});
    down.estimate = {...down.estimate, totalCents: 17000};
    const plan = pay.payNowPlan(down, ON);
    assert.equal(plan.refundDueCents, 2000);
    assert.equal(plan.balanceDueCents, 0);
    // Same total: nothing to write.
    assert.equal(pay.payNowPlan(request({payNow: paid}), ON).action, "none");
  });

  it("counts a partial refund as money no longer paid", () => {
    const partly = {...pay.newPayNow({token: "t", linkUrl: "u",
      amountCents: 19000, chargeType: "platform", nowMs: 1}),
    status: "partly_refunded", paidCents: 19000, refundedCents: 4000};
    assert.equal(pay.netPaidCents(partly), 15000);
    assert.deepEqual(pay.payNowBalances(request({payNow: partly})),
        {balanceDueCents: 4000, refundDueCents: 0});
    assert.equal(pay.netPaidCents({status: "open", paidCents: 5}), 0);
    assert.equal(pay.netPaidCents(null), 0);
  });

  it("closes an unpaid link with the request, and leaves a paid one", () => {
    const open = pay.newPayNow({token: "t", linkUrl: "u", amountCents: 1,
      chargeType: "platform", nowMs: 1});
    const patch = pay.closePatch({payNow: open}, 77);
    assert.equal(patch.payNow.status, "cancelled");
    assert.equal(patch.payNow.updatedAtMs, 77);
    assert.deepEqual(pay.closePatch({payNow: {...open, status: "paid"}}, 1),
        {});
    assert.deepEqual(pay.closePatch({}, 1), {});
  });

  it("shows the customer the link only while it is open, and never " +
    "the Stripe ids", () => {
    const open = {...pay.newPayNow({token: "secret", linkUrl: "https://x/p",
      amountCents: 19000, chargeType: "direct", connectedAccountId: "acct_9",
      nowMs: 1}), paymentIntentId: "pi_1", chargeId: "ch_1"};
    const view = pay.publicPayNow(open);
    assert.deepEqual(view, {status: "open", amountCents: 19000,
      linkUrl: "https://x/p", paidCents: 0, refundedCents: 0,
      balanceDueCents: 0});
    assert.equal(JSON.stringify(view).includes("secret"), false);
    assert.equal(pay.publicPayNow({...open, status: "paid", paidCents:
      19000}).linkUrl, "");
    assert.equal(pay.publicPayNow(null), null);
  });
});

describe("Checkout Sessions, closed requests and Received", () => {
  const paidPay = (extra = {}) => ({...pay.newPayNow({token: "t",
    linkUrl: "u", amountCents: 10000, chargeType: "platform", nowMs: 1}),
  status: "paid", paidCents: 10000, ...extra});

  it("treats a payment on a closed, received or cancelled link as stray",
      () => {
        const open = pay.newPayNow({token: "t", linkUrl: "u",
          amountCents: 100, chargeType: "platform", nowMs: 1});
        assert.equal(pay.strayPaymentReason(request({payNow: open})), "");
        assert.equal(pay.strayPaymentReason(request({payNow: {...open,
          status: "cancelled"}})), "link_not_open");
        assert.equal(pay.strayPaymentReason(request()), "link_not_open");
        for (const status of ["cancelled", "declined", "expired",
          "customer_declined", "received", "estimate_sent"]) {
          assert.equal(pay.strayPaymentReason(request({status,
            payNow: open})), "request_closed", status);
        }
        assert.equal(pay.strayPaymentReason(request({closedAtMs: 5,
          payNow: open})), "request_closed");
      });

  it("starts a link with no session expired, and a reopened one again",
      () => {
        const open = pay.newPayNow({token: "t", linkUrl: "u",
          amountCents: 100, chargeType: "platform", nowMs: 1});
        assert.equal(open.sessionExpiredAtMs, 0);
        const reopened = pay.applyPlan({...open, status: "cancelled",
          sessionExpiredAtMs: 99}, {action: "open", amountCents: 200},
        {nowMs: 5});
        assert.equal(reopened.sessionExpiredAtMs, 0);
      });

  it("keeps the whole line credit when an overpayment is refunded", () => {
    // $100 paid, price dropped to $80, the line was credited $80.
    const afterExcess = paidPay({status: "partly_refunded",
      refundedCents: 2000});
    assert.equal(pay.lineCreditAfterRefund(8000, afterExcess), 8000);
    // Refunding into the price takes the credit down with it.
    assert.equal(pay.lineCreditAfterRefund(8000, paidPay({status:
      "partly_refunded", refundedCents: 5000})), 5000);
    assert.equal(pay.lineCreditAfterRefund(8000, paidPay({status: "refunded",
      refundedCents: 10000})), 0);
    // A credit is never raised by a refund.
    assert.equal(pay.lineCreditAfterRefund(3000, paidPay({status:
      "partly_refunded", refundedCents: 1000})), 3000);
  });

  it("owes it all back when a paid request ends unreceived", () => {
    const paid = paidPay();
    for (const status of ["declined", "customer_declined", "cancelled",
      "expired"]) {
      const patch = pay.closePatch({payNow: paid, status: "confirmed"}, 77,
          status);
      assert.equal(patch.payNow.refundDueCents, 10000, status);
      assert.equal(patch.payNow.balanceDueCents, 0);
      assert.equal(patch.payNow.status, "paid");
      assert.equal(pay.payNowBalances({status, payNow: paid}).refundDueCents,
          10000);
    }
    // What was already refunded is not owed again.
    const partly = paidPay({status: "partly_refunded", refundedCents: 4000});
    assert.equal(pay.closePatch({payNow: partly}, 1, "cancelled").payNow
        .refundDueCents, 6000);
    // Fully refunded, received, or no status: nothing to prompt.
    assert.deepEqual(pay.closePatch({payNow: paidPay({status: "refunded",
      refundedCents: 10000})}, 1, "cancelled"), {});
    assert.deepEqual(pay.closePatch({payNow: paid}, 1), {});
    // An open link still just cancels, whatever the status.
    const open = pay.newPayNow({token: "t", linkUrl: "u", amountCents: 1,
      chargeType: "platform", nowMs: 1});
    assert.equal(pay.closePatch({payNow: open}, 1, "declined").payNow.status,
        "cancelled");
  });

  it("owes back only the overpayment once received", () => {
    const stored = pay.receivedPayNow(paidPay({paidCents: 10000}), {
      linePaymentId: "lp1", lineId: "line1", totalCents: 8000, nowMs: 9});
    assert.equal(stored.refundDueCents, 2000);
    assert.equal(stored.balanceDueCents, 0);
    assert.equal(stored.receivedTotalCents, 8000);
    assert.equal(stored.linePaymentId, "lp1");
    assert.equal(stored.receivedLineId, "line1");
    assert.equal(pay.payNowBalances({status: "received", payNow: stored})
        .refundDueCents, 2000);
    // The excess refunded: nothing left to prompt.
    const refunded = {...stored, status: "partly_refunded",
      refundedCents: 2000};
    assert.equal(pay.payNowBalances({status: "received", payNow: refunded})
        .refundDueCents, 0);
    // Paid exactly, or the price unknown: no prompt.
    assert.equal(pay.receivedPayNow(paidPay(), {totalCents: 10000, nowMs: 1})
        .refundDueCents, 0);
    assert.equal(pay.receivedPayNow(paidPay(), {totalCents: null, nowMs: 1})
        .refundDueCents, 0);
    assert.deepEqual(pay.payNowBalances({status: "received", payNow:
      paidPay()}), {balanceDueCents: 0, refundDueCents: 0});
  });

  it("tells staff about a refunded stray payment and a dashboard refund",
      () => {
        const row = {sender: {name: "Fatou Diallo"}, code: "R-1"};
        assert.deepEqual(pay.strayNotificationText(row, 13000, "en"),
            {title: "Online payment refunded", body:
              "Fatou Diallo · $130.00 · R-1 · request no longer open"});
        assert.equal(pay.strayNotificationText(row, 13000, "fr").title,
            "Paiement en ligne remboursé");
        assert.deepEqual(pay.refundNotificationText(row, 4000, "en"),
            {title: "Online refund", body: "Fatou Diallo · $40.00 · R-1"});
        assert.equal(pay.refundNotificationText(row, 4000, "fr").body,
            "Fatou Diallo · 40,00 $ · R-1");
      });
});

describe("refunds", () => {
  const paid = {status: "paid", paidCents: 19000, refundedCents: 0,
    refunds: []};

  it("allows all or part, up to what was paid", () => {
    assert.equal(pay.refundDecision(paid, 19000).ok, true);
    assert.equal(pay.refundDecision(paid, 1).ok, true);
    const partly = {...paid, status: "partly_refunded", refundedCents: 4000};
    assert.equal(pay.refundDecision(partly, 15000).ok, true);
    assert.equal(pay.refundDecision(partly, 15001).reason,
        "refund_too_much");
    assert.equal(pay.refundDecision(partly, 15001).remainingCents, 15000);
  });

  it("refuses more than the remainder", () => {
    assert.equal(pay.refundDecision(paid, 19001).reason, "refund_too_much");
  });

  it("refuses a bad amount", () => {
    for (const amount of [0, -5, 1.5, "100", null, undefined, NaN]) {
      assert.equal(pay.refundDecision(paid, amount).reason,
          "refund_invalid", String(amount));
    }
  });

  it("refuses when nothing was paid or all was refunded", () => {
    assert.equal(pay.refundDecision(null, 100).reason, "pay_not_paid");
    assert.equal(pay.refundDecision({status: "open", paidCents: 0}, 100)
        .reason, "pay_not_paid");
    assert.equal(pay.refundDecision({...paid, status: "refunded",
      refundedCents: 19000}, 100).reason, "pay_not_paid");
    assert.equal(pay.refundDecision({status: "cancelled"}, 100).reason,
        "pay_not_paid");
  });

  it("keeps the reason short", () => {
    assert.equal(pay.refundDecision(paid, 100, "x".repeat(400)).reason,
        "reason_too_long");
    assert.equal(pay.refundDecision(paid, 100, "  broke  ").note, "broke");
  });

  it("moves to partly_refunded, then refunded", () => {
    const first = pay.applyRefund(paid, {atMs: 1, amountCents: 4000,
      byUid: "u", byName: "Awa", reason: "damaged", refundId: "re_1"});
    assert.equal(first.status, "partly_refunded");
    assert.equal(first.refundedCents, 4000);
    assert.equal(first.refunds.length, 1);
    const second = pay.applyRefund(first, {atMs: 2, amountCents: 15000,
      byUid: "u", byName: "Awa", reason: "", refundId: "re_2"});
    assert.equal(second.status, "refunded");
    assert.equal(second.refundedCents, 19000);
    assert.equal(second.refunds[1].refundId, "re_2");
  });

  it("keeps the last 20 messages", () => {
    let list = [];
    for (let i = 0; i < 25; i++) {
      list = pay.appendMessage(list, {atMs: i, amountCents: 5,
        channel: "template", ok: i % 2 === 0});
    }
    assert.equal(list.length, 20);
    assert.equal(list[0].atMs, 5);
    assert.equal(list[19].ok, true);
    assert.equal(list[18].ok, false);
    const entry = pay.appendMessage([], {atMs: 1, amountCents: 5,
      channel: "carrier pigeon", ok: true, error: "boom", kind: "refund"})[0];
    assert.deepEqual(entry, {atMs: 1, amountCents: 5, channel: "template",
      ok: true, kind: "refund", error: "boom"});
  });
});

describe("weeks (Monday to Sunday, New York)", () => {
  const at = (iso) => Date.parse(iso);

  it("is the Monday of the New York week", () => {
    // Wed Nov 4 2026, noon UTC.
    assert.equal(pay.weekKeyFor(at("2026-11-04T12:00:00Z")), "2026-11-02");
    // Monday 00:00 New York (05:00Z after the fall clock change) starts it.
    assert.equal(pay.weekKeyFor(at("2026-11-02T04:59:00Z")), "2026-10-26");
    assert.equal(pay.weekKeyFor(at("2026-11-02T05:00:00Z")), "2026-11-02");
    // Sunday night is still the old week.
    assert.equal(pay.weekKeyFor(at("2026-11-02T04:00:00Z")), "2026-10-26");
  });

  it("is right across both clock changes", () => {
    // Fall back, Sun Nov 1 2026 (2am EDT -> 1am EST): the 1:30 that happens
    // twice is Sunday both times.
    assert.equal(pay.weekKeyFor(at("2026-11-01T05:30:00Z")), "2026-10-26");
    assert.equal(pay.weekKeyFor(at("2026-11-01T06:30:00Z")), "2026-10-26");
    assert.equal(pay.weekKeyFor(at("2026-11-02T04:59:59Z")), "2026-10-26");
    // Spring forward, Sun Mar 8 2026: Sunday 23:59 EDT is 03:59Z Monday.
    assert.equal(pay.weekKeyFor(at("2026-03-09T03:59:00Z")), "2026-03-02");
    assert.equal(pay.weekKeyFor(at("2026-03-09T04:00:00Z")), "2026-03-09");
    // A year boundary.
    assert.equal(pay.weekKeyFor(at("2027-01-01T15:00:00Z")), "2026-12-28");
  });

  it("knows a valid week key", () => {
    assert.equal(pay.weekKeyValid("2026-11-02"), true);
    assert.equal(pay.weekKeyValid("2026-11-03"), false);
    assert.equal(pay.weekKeyValid("2026-02-30"), false);
    assert.equal(pay.weekKeyValid("nov 2"), false);
    assert.equal(pay.weekKeyValid(undefined), false);
  });

  it("ends the week when the next Monday begins in New York", () => {
    const range = pay.weekRange("2026-11-02");
    assert.equal(range.startKey, "2026-11-02");
    assert.equal(range.endKey, "2026-11-08");
    assert.equal(range.payoutKey, "2026-11-09");
    assert.equal(range.startMs, at("2026-11-02T05:00:00Z"));
    assert.equal(range.endMs, at("2026-11-09T05:00:00Z"));
    // The week the clocks go forward is an hour short, back an hour long.
    const spring = pay.weekRange("2026-03-02");
    assert.equal(spring.endMs - spring.startMs, 7 * 24 * 3600000 - 3600000);
    const fall = pay.weekRange("2026-10-26");
    assert.equal(fall.endMs - fall.startMs, 7 * 24 * 3600000 + 3600000);
    assert.equal(pay.weekKeyFor(fall.endMs), "2026-11-02");
    assert.equal(pay.weekKeyFor(fall.endMs - 1), "2026-10-26");
  });

  it("names the New York day", () => {
    assert.equal(pay.zonedDayKey(at("2026-11-02T04:59:00Z")), "2026-11-01");
    assert.equal(pay.zonedDayKey(at("2026-11-02T05:00:00Z")), "2026-11-02");
  });
});

describe("the weekly payout", () => {
  const rows = (...list) => list.map(([type, amountCents]) =>
    ({type, amountCents}));

  it("is collected - fees - refunds - chargebacks - the bill", () => {
    const s = pay.summarizeWeek(rows(["payment", 13000], ["stripe_fee", -407],
        ["payment", 5000], ["stripe_fee", -175], ["refund", -2000],
        ["chargeback", -1000], ["dispute_fee", -1500]),
    {unpaidBillCents: 4000});
    assert.equal(s.collectedCents, 18000);
    assert.equal(s.feesCents, 582);
    assert.equal(s.refundsCents, 2000);
    assert.equal(s.chargebacksCents, 2500);
    assert.equal(s.beforeBillCents, 12918);
    assert.equal(s.billOffsetCents, 4000);
    assert.equal(s.netCents, 8918);
    assert.equal(s.payoutCents, 8918);
    assert.equal(s.toBillCents, 0);
    assert.equal(s.lines, 7);
  });

  it("never takes more from the week than the week brought", () => {
    const s = pay.summarizeWeek(rows(["payment", 3000], ["stripe_fee", -117]),
        {unpaidBillCents: 100000});
    assert.equal(s.beforeBillCents, 2883);
    assert.equal(s.billOffsetCents, 2883);
    assert.equal(s.netCents, 0);
    assert.equal(s.payoutCents, 0);
  });

  it("puts a negative week on the bill", () => {
    const s = pay.summarizeWeek(rows(["payment", 1000], ["stripe_fee", -59],
        ["refund", -1000]), {unpaidBillCents: 700});
    assert.equal(s.beforeBillCents, -59);
    assert.equal(s.billOffsetCents, 0);
    assert.equal(s.toBillCents, 59);
    assert.equal(s.netCents, -59);
    assert.equal(s.payoutCents, 0);
  });

  it("counts a won dispute back", () => {
    const s = pay.summarizeWeek(rows(["payment", 10000], ["chargeback",
      -10000], ["dispute_fee", -1500], ["chargeback", 10000]));
    assert.equal(s.chargebacksCents, 1500);
    assert.equal(s.beforeBillCents, 8500);
  });

  it("reads what was recorded once a week is paid", () => {
    const s = pay.summarizeWeek(rows(["payment", 10000], ["bill_offset",
      -3000], ["payout", -7000]), {unpaidBillCents: 99999});
    assert.equal(s.billOffsetCents, 3000);
  });

  it("answers an empty week", () => {
    const s = pay.summarizeWeek([]);
    assert.equal(s.netCents, 0);
    assert.equal(s.lines, 0);
    assert.equal(pay.summarizeWeek(undefined).collectedCents, 0);
  });

  it("is open until the week ends, then due, then paid", () => {
    const s = pay.summarizeWeek(rows(["payment", 1000]));
    const weekKey = "2026-11-02";
    const end = pay.weekRange(weekKey).endMs;
    assert.equal(pay.weekStatus({weekKey, nowMs: end - 1, summary: s,
      rows: 1}), "open");
    assert.equal(pay.weekStatus({weekKey, nowMs: end, summary: s, rows: 1}),
        "due");
    assert.equal(pay.weekStatus({weekKey, nowMs: end, summary: s, rows: 1,
      paid: true}), "paid");
    assert.equal(pay.weekStatus({weekKey, nowMs: end, summary: s, rows: 0}),
        "nothing");
    const wash = pay.summarizeWeek(rows(["payment", 1000], ["refund",
      -1000]));
    assert.equal(pay.weekStatus({weekKey, nowMs: end, summary: wash,
      rows: 2}), "nothing");
  });

  it("spreads the bill over unpaid weeks, oldest first", () => {
    const plan = pay.planOffsets([
      {weekKey: "2026-11-09", beforeBillCents: 5000},
      {weekKey: "2026-11-02", beforeBillCents: 3000},
      {weekKey: "2026-10-26", beforeBillCents: 1000},
    ], 6000);
    assert.equal(plan.get("2026-10-26"), 1000);
    assert.equal(plan.get("2026-11-02"), 3000);
    assert.equal(plan.get("2026-11-09"), 2000);
  });

  it("lets a negative week add to the bill for the weeks after it", () => {
    const plan = pay.planOffsets([
      {weekKey: "2026-10-26", beforeBillCents: -400},
      {weekKey: "2026-11-02", beforeBillCents: 1000},
    ], 0);
    assert.equal(plan.get("2026-10-26"), 0);
    assert.equal(plan.get("2026-11-02"), 400);
  });

  it("plans what a payout does", () => {
    const week = (...list) => rows(...list);
    assert.equal(pay.payoutPlan(week(["payment", 5000]), 0).kind, "payout");
    assert.equal(pay.payoutPlan(week(["payment", 5000]), 5000).kind,
        "bill_only");
    assert.equal(pay.payoutPlan(week(["payment", 5000], ["refund", -6000]),
        0).kind, "to_bill");
    assert.equal(pay.payoutPlan(week(["payment", 5000], ["refund", -5000]),
        0).kind, "empty");
    // Rows of an earlier attempt do not count twice.
    assert.equal(pay.payoutPlan(week(["payment", 5000], ["payout", -5000]),
        0).payoutCents, 5000);
  });

  it("writes the rows a payout needs", () => {
    const base = {businessId: "biz", weekKey: "2026-11-02", atMs: 1,
      byUid: "admin", byName: "Hashim", method: "zelle",
      reference: "Z123"};
    const plan = pay.payoutPlan(rows(["payment", 10000],
        ["stripe_fee", -320]), 2000);
    const out = pay.payoutRows({...base, plan});
    assert.deepEqual(out.map((r) => [r.id, r.row.type, r.row.amountCents]), [
      ["biz_2026-11-02_offset", "bill_offset", -2000],
      ["biz_2026-11-02_payout", "payout", -7680],
    ]);
    assert.equal(out[1].row.note, "zelle Z123");
    assert.equal(out[1].row.weekKey, "2026-11-02");
    const negative = pay.payoutRows({...base, plan: pay.payoutPlan(
        rows(["payment", 1000], ["refund", -1500]), 0)});
    assert.deepEqual(negative.map((r) => [r.row.type, r.row.amountCents]),
        [["to_bill", 500]]);
  });

  it("checks a Paid out request", () => {
    const after = pay.weekRange("2026-11-02").endMs;
    const ok = pay.cleanPayoutInput({weekKey: "2026-11-02", method: "Zelle",
      reference: " Z9 "}, after);
    assert.deepEqual(ok, {errors: [], weekKey: "2026-11-02",
      method: "zelle", reference: "Z9"});
    assert.deepEqual(pay.cleanPayoutInput({weekKey: "2026-11-03"}, after)
        .errors, ["week_invalid"]);
    assert.deepEqual(pay.cleanPayoutInput({weekKey: "2026-11-02"}, after - 1)
        .errors, ["week_not_over"]);
    assert.equal(pay.cleanPayoutInput({weekKey: "2026-11-02", method: "cash"},
        after).method, "");
    assert.deepEqual(pay.cleanPayoutInput({weekKey: "2026-11-02",
      reference: "x".repeat(200)}, after).errors, ["reference_too_long"]);
  });
});

describe("the ledger rows", () => {
  it("writes a payment and its Stripe fee, signed, with fixed ids", () => {
    const rows = pay.paymentRows({businessId: "biz", requestId: "r1",
      requestCode: "R-ABCDE", paidCents: 19000, stripeFeeCents: 581,
      atMs: Date.parse("2026-11-04T12:00:00Z")});
    assert.deepEqual(rows.map((r) => [r.id, r.row.type, r.row.amountCents,
      r.row.weekKey]), [
      ["r1_payment", "payment", 19000, "2026-11-02"],
      ["r1_fee", "stripe_fee", -581, "2026-11-02"],
    ]);
    assert.equal(rows[0].row.requestCode, "R-ABCDE");
    assert.equal(pay.paymentRows({businessId: "biz", requestId: "r1",
      paidCents: 100, stripeFeeCents: 0, atMs: 1}).length, 1);
  });

  it("takes a late row into the week it is given", () => {
    const rows = pay.paymentRows({businessId: "biz", requestId: "r1",
      paidCents: 100, stripeFeeCents: 3, atMs: 1, weekKey: "2026-11-09"});
    assert.equal(rows[0].row.weekKey, "2026-11-09");
    const badKey = pay.paymentRows({businessId: "biz", requestId: "r1",
      paidCents: 100, stripeFeeCents: 3, atMs: Date.parse(
          "2026-11-04T12:00:00Z"), weekKey: "2026-11-03"});
    assert.equal(badKey[0].row.weekKey, "2026-11-02");
  });

  it("writes a refund as money out", () => {
    const {id, row} = pay.refundRow({businessId: "biz", requestId: "r1",
      requestCode: "R-ABCDE", refundId: "re_9", amountCents: 4000, atMs: 1,
      byUid: "u", byName: "Awa", note: "damaged"});
    assert.equal(id, "r1_refund_re_9");
    assert.equal(row.type, "refund");
    assert.equal(row.amountCents, -4000);
    assert.equal(row.byName, "Awa");
  });

  it("writes a dispute as the amount and the $15 fee, and a win as money " +
    "back", () => {
    const args = {businessId: "biz", requestId: "r1", requestCode: "R-1",
      disputeId: "dp_1", amountCents: 19000, atMs: 1};
    const lost = pay.disputeRows(args);
    assert.deepEqual(lost.map((r) => [r.id, r.row.type, r.row.amountCents]), [
      ["r1_dispute_dp_1", "chargeback", -19000],
      ["r1_dispute_dp_1_fee", "dispute_fee", -1500],
    ]);
    const won = pay.disputeWonRow(args);
    assert.equal(won.row.type, "chargeback");
    assert.equal(won.row.amountCents, 19000);
    assert.notEqual(won.id, lost[0].id);
  });

  it("refuses a malformed row", () => {
    assert.throws(() => pay.ledgerRow({type: "gift", amountCents: 1,
      atMs: 1}));
    assert.throws(() => pay.ledgerRow({type: "payment", amountCents: 1.5,
      atMs: 1}));
  });
});

describe("the words", () => {
  it("writes US money in both languages", () => {
    assert.equal(pay.moneyEn(13000), "$130.00");
    assert.equal(pay.moneyFr(13000), "130,00 $");
    assert.equal(pay.moneyEn(129999999), "$1,299,999.99");
    assert.equal(pay.moneyFr(129999999), "1 299 999,99 $");
    assert.equal(pay.moneyEn(5), "$0.05");
    assert.equal(pay.moneyFr(5), "0,05 $");
    assert.equal(pay.moneyEn(-1250), "-$12.50");
  });

  it("writes dates month first in English, day first in French", () => {
    assert.equal(pay.dateText("2026-11-02", "en"), "Nov 2, 2026");
    assert.equal(pay.dateText("2026-11-02", "fr"), "2 nov. 2026");
    assert.equal(pay.dateText("2026-12-01", "fr"), "1er déc. 2026");
    assert.equal(pay.dateText("2026-03-09", "en"), "Mar 9, 2026");
    assert.equal(pay.dateText("2026-13-09", "en"), "");
    assert.equal(pay.dateText("nope", "en"), "");
  });

  it("fills the pay link template as approved", () => {
    const body = pay.payNowTemplateMessage({phone: "+1 (646) 555-0100",
      name: "Fatou", business: "Dala Shipping", amountCents: 13000,
      code: "R-K7M4P", token: "tok_abc"});
    assert.equal(body.to, "16465550100");
    assert.equal(body.type, "template");
    assert.equal(body.template.name, "package_pay_now_2lang");
    assert.deepEqual(body.template.components[0].parameters.map((p) =>
      p.text), ["Fatou", "Dala Shipping", "$130.00", "Dala Shipping",
      "130,00 $", "R-K7M4P"]);
    assert.deepEqual(body.template.components[1], {type: "button",
      sub_type: "url", index: "0", parameters: [{type: "text",
        text: "tok_abc"}]});
  });

  it("keeps template values on one line", () => {
    const body = pay.payNowTemplateMessage({phone: "1", name: "A\nB\tC",
      business: "", amountCents: 1, code: "R", token: "t"});
    const params = body.template.components[0].parameters;
    assert.equal(params[0].text, "A B C");
    assert.equal(params[1].text, "-");
  });

  it("falls back to a button message inside the 24 hours", () => {
    const en = pay.payNowSessionMessage({phone: "+16465550100", name: "Fatou",
      business: "Dala", amountCents: 13000, code: "R-1",
      url: "https://laawoldigital.com/p?t=abc", language: "en"});
    assert.equal(en.type, "interactive");
    assert.equal(en.interactive.type, "cta_url");
    assert.equal(en.interactive.action.parameters.url,
        "https://laawoldigital.com/p?t=abc");
    assert.ok(en.interactive.body.text.includes("$130.00"));
    const fr = pay.payNowSessionMessage({phone: "1", name: "Fatou",
      business: "Dala", amountCents: 13000, code: "R-1", url: "u",
      language: "fr"});
    assert.ok(fr.interactive.body.text.includes("130,00 $"));
    assert.equal(fr.interactive.action.parameters.display_text,
        "Payer maintenant");
  });

  it("fills the payout receipt template as approved", () => {
    const body = pay.payoutTemplateMessage({phone: "+16465550100",
      name: "Alhoussaine", amountCents: 868000, weekKey: "2026-11-02",
      method: "zelle"});
    assert.equal(body.template.name, "pay_now_payout_2lang");
    assert.deepEqual(body.template.components[0].parameters.map((p) =>
      p.text), ["Alhoussaine", "$8,680.00", "Nov 2, 2026", "8 680,00 $",
      "2 nov. 2026", "Zelle"]);
    assert.equal(body.template.components.length, 1);
  });

  it("tells staff in their language", () => {
    const request = {sender: {name: "Fatou Diallo"}, code: "R-1"};
    assert.deepEqual(pay.paidNotificationText(request, 13000, "en"),
        {title: "Paid online", body: "Fatou Diallo · $130.00 · R-1"});
    assert.deepEqual(pay.paidNotificationText(request, 13000, "fr"),
        {title: "Payé en ligne", body: "Fatou Diallo · 130,00 $ · R-1"});
  });
});
