import assert from "node:assert/strict";
import test from "node:test";

import {
  canResend,
  chargeTypeFor,
  customerPayView,
  dueWeeks,
  ledgerLabel,
  mayRefund,
  money,
  paidOnlineText,
  payChip,
  payNowButtonText,
  payNowOn,
  payoutDay,
  payoutPaidPayload,
  payoutProblems,
  payoutWeeksOf,
  publicPayNowOf,
  refundPayload,
  refundProblems,
  refundableCents,
  requestPayNowOf,
  safeLinkUrl,
} from "./pay-now.ts";

const LINK = "https://laawoldigital.com/p?t=abc123";

test("a payment link opens only as https", () => {
  assert.equal(safeLinkUrl(LINK), LINK);
  for (const bad of ["javascript:alert(1)", "http://laawoldigital.com/p?t=x", "data:text/html,hi", "", "not a url", null]) assert.equal(safeLinkUrl(bad), "", String(bad));
});

test("the request page reads payNow defensively", () => {
  assert.equal(publicPayNowOf(null), null);
  assert.equal(publicPayNowOf({ status: "weird" }), null);
  assert.deepEqual(publicPayNowOf({ status: "open", amountCents: 13000, linkUrl: LINK, paidCents: 0, refundedCents: 0 }), { status: "open", amountCents: 13000, linkUrl: LINK, paidCents: 0, refundedCents: 0 });
  assert.equal(publicPayNowOf({ status: "open", amountCents: 13000, linkUrl: "javascript:x" })?.linkUrl, "");
});

test("an optional Pay now button while the link is open and the request is open", () => {
  const open = publicPayNowOf({ status: "open", amountCents: 13000, linkUrl: LINK });
  assert.deepEqual(customerPayView(open, true, 13000), { kind: "pay", amountCents: 13000, linkUrl: LINK });
  assert.deepEqual(customerPayView(open, false, 13000), { kind: "none" }, "a closed request offers nothing");
  assert.deepEqual(customerPayView(publicPayNowOf({ status: "open", amountCents: 13000, linkUrl: "" }), true, 13000), { kind: "none" }, "no safe link, no button");
  assert.deepEqual(customerPayView(publicPayNowOf({ status: "cancelled", amountCents: 13000, linkUrl: LINK }), true, 13000), { kind: "none" });
  assert.deepEqual(customerPayView(null, true, 13000), { kind: "none" });
});

test("paid online, refunded, and the balance when the total went up", () => {
  const paid = publicPayNowOf({ status: "paid", amountCents: 13000, paidCents: 13000, refundedCents: 0 });
  assert.deepEqual(customerPayView(paid, true, 13000), { kind: "paid", paidCents: 13000, refundedCents: 0, refunded: "none", balanceCents: 0 });
  assert.equal((customerPayView(paid, true, 15000) as { balanceCents: number }).balanceCents, 2000, "the difference is paid in person");
  assert.equal((customerPayView(paid, false, 15000) as { balanceCents: number }).balanceCents, 0);
  const part = publicPayNowOf({ status: "partly_refunded", paidCents: 13000, refundedCents: 2000 });
  assert.equal((customerPayView(part, true, 11000) as { refunded: string }).refunded, "part");
  assert.equal((customerPayView(part, true, 11000) as { balanceCents: number }).balanceCents, 0);
  const all = publicPayNowOf({ status: "refunded", paidCents: 13000, refundedCents: 13000 });
  const view = customerPayView(all, true, 13000) as Extract<ReturnType<typeof customerPayView>, { kind: "paid" }>;
  assert.equal(view.refunded, "all");
  assert.equal(view.balanceCents, 0);
  assert.deepEqual(paidOnlineText(view, "en"), { paid: "Paid online $130.00", refunded: "Refunded $130.00" });
  assert.equal(paidOnlineText(view, "fr").paid.startsWith("Payé en ligne 130,00"), true);
  assert.equal(payNowButtonText(13000, "en"), "Pay now $130.00");
  assert.equal(payNowButtonText(13000, "fr").startsWith("Payer maintenant 130,00"), true);
});

test("the business's chip tells the state in one line", () => {
  const of = (payNow: object) => requestPayNowOf({ payNow });
  assert.equal(payChip(null, "en"), null);
  assert.deepEqual(payChip(of({ status: "open", amountCents: 13000, linkUrl: LINK }), "en"), { tone: "link", text: "Link sent $130.00" });
  assert.deepEqual(payChip(of({ status: "paid", paidCents: 13000 }), "en"), { tone: "paid", text: "Paid online $130.00" });
  assert.equal(payChip(of({ status: "partly_refunded", paidCents: 13000, refundedCents: 2000 }), "en")?.text, "Paid online $130.00 · refunded $20.00");
  assert.equal(payChip(of({ status: "refunded", paidCents: 13000, refundedCents: 13000 }), "en")?.text, "Refunded $130.00");
  assert.equal(payChip(of({ status: "cancelled" }), "fr")?.text, "Lien annulé");
});

test("Resend only for an open link; Refund only up to what is left", () => {
  const open = requestPayNowOf({ payNow: { status: "open", amountCents: 13000, linkUrl: LINK } });
  const paid = requestPayNowOf({ payNow: { status: "paid", paidCents: 13000, refundedCents: 3000, refunds: [{ atMs: 5, amountCents: 3000, byName: "Awa", reason: "damaged" }] } });
  assert.equal(canResend(open), true);
  assert.equal(canResend(paid), false);
  assert.equal(canResend(null), false);
  assert.equal(refundableCents(open), 0);
  assert.equal(refundableCents(paid), 10000);
  assert.equal(refundableCents(null), 0);
  assert.deepEqual(paid?.refunds, [{ atMs: 5, amountCents: 3000, byName: "Awa", reason: "damaged" }]);
});

test("the refund form: an amount up to what is left, and a reason", () => {
  const ok = refundProblems({ amount: "25.50", reason: "Damaged in transit", refundableCents: 10000 });
  assert.deepEqual(ok, { cents: 2550, problems: [] });
  assert.deepEqual(refundProblems({ amount: "100", reason: "all", refundableCents: 10000 }).problems, []);
  assert.deepEqual(refundProblems({ amount: "100,01", reason: "x", refundableCents: 10000 }).problems, ["refund_too_much"]);
  assert.deepEqual(refundProblems({ amount: "", reason: "x", refundableCents: 10000 }).problems, ["refund_invalid"]);
  assert.deepEqual(refundProblems({ amount: "0", reason: "x", refundableCents: 10000 }).problems, ["refund_invalid"]);
  assert.deepEqual(refundProblems({ amount: "abc", reason: "", refundableCents: 10000 }).problems, ["refund_invalid", "reason_required"]);
  assert.deepEqual(refundPayload("b1", "r1", 2550, "  Damaged "), { action: "pay_refund", businessId: "b1", requestId: "r1", amountCents: 2550, reason: "Damaged" });
});

test("who is offered Refund", () => {
  assert.equal(mayRefund({ role: "businessOwner" }), true);
  assert.equal(mayRefund({ role: "admin" }), true);
  assert.equal(mayRefund({ role: "staff", businessPermissions: ["containers", "ledger"] }), true);
  assert.equal(mayRefund({ role: "staff", businessPermissions: ["containers", "void"] }), false);
  assert.equal(mayRefund({ role: "staff", businessPermissions: ["ledger"] }), false);
  assert.equal(mayRefund({ role: "staff", businessPermissions: ["containers"] }), false);
  assert.equal(mayRefund({ role: "staff" }), false);
  assert.equal(mayRefund({ role: "customer" }), false);
});

test("one switch: payNow wins, else the old card switch; direct only with Stripe payouts", () => {
  assert.equal(payNowOn({ payNow: true, cardBarrelBooking: false }), true);
  assert.equal(payNowOn({ payNow: false, cardBarrelBooking: true }), false);
  assert.equal(payNowOn({ cardBarrelBooking: true }), true);
  assert.equal(payNowOn({}), false);
  assert.equal(payNowOn(null), false);
  assert.equal(chargeTypeFor({ stripeAccountId: "acct_1", payoutsEnabled: true }), "direct");
  assert.equal(chargeTypeFor({ stripeAccountId: "acct_1", payoutsEnabled: false }), "platform");
  assert.equal(chargeTypeFor({}), "platform");
});

test("weekly payouts are read, sorted newest first, with their lines", () => {
  const { weeks, unpaidBillCents } = payoutWeeksOf({
    unpaidBillCents: 4000,
    weeks: [
      { businessId: "b1", businessName: "Keren", weekKey: "2026-10-26", netCents: 8000, status: "paid", method: "zelle", reference: "Z1", paidAtMs: 5, lines: [] },
      { businessId: "b1", businessName: "Keren", weekKey: "2026-11-02", collectedCents: 13000, feesCents: -417, refundsCents: -2000, billOffsetCents: -4000, netCents: 6583, status: "due", lines: [{ type: "payment", requestCode: "R-K7M4P", amountCents: 13000, atMs: 9 }, { type: "bogus", amountCents: 1 }] },
      { weekKey: "bad" },
    ],
  });
  assert.equal(unpaidBillCents, 4000);
  assert.deepEqual(weeks.map((w) => w.weekKey), ["2026-11-02", "2026-10-26"]);
  assert.equal(weeks[0].lines.length, 2);
  assert.equal(weeks[0].lines[1].type, "");
  assert.equal(weeks[1].method, "zelle");
  assert.deepEqual(dueWeeks(weeks).map((w) => w.weekKey), ["2026-11-02"]);
  assert.equal(payoutDay("2026-11-02"), "2026-11-09", "paid the following Monday");
  assert.equal(payoutDay("2026-12-28"), "2027-01-04");
  assert.equal(ledgerLabel("stripe_fee", "en"), "Card fee");
  assert.equal(ledgerLabel("", "en"), "");
  assert.equal(money(-417, "en"), "-$4.17");
});

test("paying out: a method for a positive week; a negative week goes onto the bill", () => {
  assert.deepEqual(payoutProblems({ method: "zelle", reference: "x", netCents: 6583 }), []);
  assert.deepEqual(payoutProblems({ method: "", reference: "", netCents: 6583 }), ["payout_method_invalid"]);
  assert.deepEqual(payoutProblems({ method: "", reference: "", netCents: -500 }), []);
  assert.deepEqual(payoutPaidPayload({ businessId: "b1", weekKey: "2026-11-02", netCents: 6583 }, "zelle", " ref "), { action: "payout_paid", businessId: "b1", weekKey: "2026-11-02", method: "zelle", reference: "ref" });
  assert.deepEqual(payoutPaidPayload({ businessId: "b1", weekKey: "2026-11-02", netCents: -500 }, "zelle", "x"), { action: "payout_paid", businessId: "b1", weekKey: "2026-11-02", method: "other", reference: "" });
});
