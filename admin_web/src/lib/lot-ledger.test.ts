import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { translateValue } from "./french-dom.ts";

import {
  DEFAULT_EXPENSE_PROOF_THRESHOLD_CENTS,
  LOT_CUSTOM_ACTIVITY_ID,
  dollarsToCents,
  emptyLotActivityDraft,
  emptyLotActivityTypeDraft,
  emptyLotExpenseEntryDraft,
  expenseProofRequired,
  formatCents,
  formatPercent,
  lotActivityPayload,
  lotActivityPaymentLabel,
  canChaseLotActivity,
  lotActivityAwaitsDirect,
  validateLotActivityDraft,
  validateLotActivityTypeDraft,
  validateLotExpenseEntryDraft,
  fixedLineAppliesTo,
  lotMonthExpenseCents,
  lotExpenseByLine,
  lotActivityTypePayload,
  // Instalments: what has arrived against what was agreed.
  LOT_ACTIVITY_MIN_CARD_PAYMENT_CENTS,
  LOT_ACTIVITY_PAYMENT_SOURCES,
  lotActivityPaidCents,
  lotActivityRemainingCents,
  lotActivityPartlyPaid,
  lotActivityPaymentBadge,
  lotActivityBalanceText,
  lotActivityPaymentPlan,
  lotActivityScoreboard,
  lotPaymentMonth,
  emptyLotInstalmentDraft,
  validateLotInstalmentDraft,
  lotInstalmentMessage,
  lotInstalmentPayload,
} from "./lot-ledger.ts";
// The activity ledger and the parking ledger share a payment vocabulary; the
// badge test below compares them directly rather than trusting two lists.
import { businessParkingPaymentBadge } from "./business-parking-entry.ts";

test("money renders a true minus with the sign outside the symbol", () => {
  assert.equal(formatCents(929100), "$9,291.00");
  assert.equal(formatCents(-929100), "−$9,291.00");
  assert.equal(formatCents(0), "$0.00");
  assert.equal(formatPercent(0.12), "12%");
  assert.equal(formatPercent(-0.04), "−4%");
  // Never $-9,291.
  assert.ok(!formatCents(-929100).includes("$-"));
});

test("dollar strings parse to whole cents, junk to null", () => {
  assert.equal(dollarsToCents("50"), 5000);
  assert.equal(dollarsToCents("50.5"), 5050);
  assert.equal(dollarsToCents("$1,200.00"), 120000);
  assert.equal(dollarsToCents("0"), 0);
  assert.equal(dollarsToCents(""), null);
  assert.equal(dollarsToCents("abc"), null);
});

test("an activity type needs a name and a fee, and 0 is a real fee", () => {
  assert.deepEqual(validateLotActivityTypeDraft(emptyLotActivityTypeDraft), [
    "activity_type_label_required",
    "activity_type_fee_invalid",
  ]);
  assert.deepEqual(
    validateLotActivityTypeDraft({ label: "Key cutting", defaultFee: "0", needsAuctionHouse: false }),
    [],
  );
  assert.deepEqual(
    validateLotActivityTypeDraft({ label: "Dispatch", defaultFee: "-5", needsAuctionHouse: false }),
    ["activity_type_fee_invalid"],
  );
});

test("recording an activity reports every problem at once", () => {
  const errors = validateLotActivityDraft(emptyLotActivityDraft, ["t1"]);
  assert.ok(errors.includes("activity_type_invalid"));
  assert.ok(errors.includes("fee_required"));
  assert.ok(errors.includes("activity_date_required"));
  assert.ok(errors.includes("customer_name_required"));
  assert.ok(errors.includes("vin_required"));
});

test("a stale activity-type id is caught client-side; a known one passes", () => {
  const base = {
    ...emptyLotActivityDraft,
    activityTypeId: "gone",
    fee: "100",
    activityDate: "2026-08-01",
    customerName: "Alimou",
    vinNumber: "EC035066",
    paymentMethod: "direct" as const,
    receivedByStaffId: "staff1",
  };
  assert.ok(validateLotActivityDraft(base, ["t1"]).includes("activity_type_invalid"));
  assert.deepEqual(validateLotActivityDraft({ ...base, activityTypeId: "t1" }, ["t1"]), []);
});

test("a custom one-off needs its own label", () => {
  const draft = {
    ...emptyLotActivityDraft,
    activityTypeId: LOT_CUSTOM_ACTIVITY_ID,
    fee: "40",
    activityDate: "2026-08-01",
    customerName: "Yao",
    vinNumber: "HC780312",
    paymentMethod: "direct" as const,
    receivedByStaffId: "s1",
  };
  assert.deepEqual(validateLotActivityDraft(draft, []), ["custom_label_required"]);
  assert.deepEqual(
    validateLotActivityDraft({ ...draft, customLabel: "Jump start" }, []),
    [],
  );
});

test("payment method drives which contact/staff fields are required", () => {
  const link = {
    ...emptyLotActivityDraft,
    activityTypeId: "t1",
    fee: "100",
    activityDate: "2026-08-01",
    customerName: "A",
    vinNumber: "V",
    paymentMethod: "payment_link" as const,
  };
  // A link with no phone and no email has nowhere to go.
  assert.ok(validateLotActivityDraft(link, ["t1"]).includes("payment_link_contact_required"));
  assert.deepEqual(validateLotActivityDraft({ ...link, customerPhone: "2015551234" }, ["t1"]), []);

  // Direct, money already received, with no staff member named is refused.
  const direct = { ...link, paymentMethod: "direct" as const, receivedByStaffId: "" };
  assert.ok(validateLotActivityDraft(direct, ["t1"]).includes("received_by_required"));

  // But a direct activity logged as not-yet-paid names no one, and passes -
  // the money is not in hand, so there is nobody who received it.
  const owed = { ...direct, paymentReceived: false };
  assert.deepEqual(validateLotActivityDraft(owed, ["t1"]), []);
});

test("a not-yet-paid direct activity carries no receiver and sends the flag", () => {
  const owed = lotActivityPayload(
    {
      ...emptyLotActivityDraft,
      activityTypeId: "t1",
      fee: "50",
      activityDate: "2026-09-11",
      customerName: "Sow",
      vinNumber: "abc123",
      paymentMethod: "direct",
      paymentReceived: false,
      receivedVia: "cash",
      receivedByStaffId: "s1",
    },
    "biz1",
  );
  assert.equal(owed.paymentReceived, false);
  assert.equal(owed.receivedByStaffId, "");
  assert.equal(owed.receivedVia, "");
});

test("the activity payload strips a staff/method mismatch and freezes the date at midday", () => {
  const link = lotActivityPayload(
    {
      ...emptyLotActivityDraft,
      activityTypeId: "t1",
      fee: "150",
      activityDate: "2026-08-15",
      customerName: "Alimou",
      customerPhone: "2015551234",
      vinNumber: "ec035066",
      paymentMethod: "payment_link",
      receivedByStaffId: "should-be-dropped",
    },
    "biz1",
  );
  assert.equal(link.feeCents, 15000);
  assert.equal(link.activityDate, "2026-08-15T12:00:00");
  assert.equal(link.vinNumber, "EC035066");
  // A link never carries a staff collector.
  assert.equal(link.receivedByStaffId, "");
  assert.equal(link.receivedVia, "");
});

test("the payment badge reads the money, not the status colour", () => {
  assert.equal(
    lotActivityPaymentLabel({ paymentMethod: "payment_link", paymentStatus: "succeeded" }),
    "Paid on the platform",
  );
  assert.equal(
    lotActivityPaymentLabel({ paymentMethod: "payment_link", paymentStatus: "awaiting_payment_link" }),
    "Awaiting payment",
  );
  assert.equal(
    lotActivityPaymentLabel({ paymentMethod: "direct", paymentStatus: "succeeded", receivedVia: "zelle" }),
    "Zelle transfer",
  );
  // A direct activity logged before its cash arrived reads as awaiting, and
  // can be settled - not "Paid outside the platform".
  assert.equal(
    lotActivityPaymentLabel({ paymentMethod: "direct", paymentStatus: "awaiting_direct_payment" }),
    "Awaiting payment",
  );
  // Chase/settle: an unpaid link OR a direct activity still owed. Not a
  // settled row of either kind.
  assert.ok(canChaseLotActivity({ paymentMethod: "payment_link", paymentStatus: "awaiting_payment_link" }));
  assert.ok(!canChaseLotActivity({ paymentMethod: "payment_link", paymentStatus: "succeeded" }));
  assert.ok(canChaseLotActivity({ paymentMethod: "direct", paymentStatus: "awaiting_direct_payment" }));
  assert.ok(!canChaseLotActivity({ paymentMethod: "direct", paymentStatus: "succeeded" }));
  // Only a direct-awaiting row is "settle only" (no link to re-send).
  assert.ok(lotActivityAwaitsDirect({ paymentMethod: "direct", paymentStatus: "awaiting_direct_payment" }));
  assert.ok(!lotActivityAwaitsDirect({ paymentMethod: "payment_link", paymentStatus: "awaiting_payment_link" }));
});

test("proof is required at and above the threshold, allowed below, and off at 0", () => {
  assert.equal(expenseProofRequired(7500, 7500), true);
  assert.equal(expenseProofRequired(12000, 7500), true);
  assert.equal(expenseProofRequired(7499, 7500), false);
  assert.equal(expenseProofRequired(500000, 0), false);

  const over = {
    ...emptyLotExpenseEntryDraft,
    amount: "120",
    spentAt: "2026-08-01",
    paidByStaffId: "s1",
    hasProof: false,
  };
  assert.deepEqual(validateLotExpenseEntryDraft(over, 7500), ["expense_proof_required"]);
  assert.deepEqual(validateLotExpenseEntryDraft({ ...over, hasProof: true }, 7500), []);
  // Raise the threshold and the same $120 saves with no receipt.
  assert.deepEqual(validateLotExpenseEntryDraft(over, 50000), []);
});

test("an expense needs an amount, a date, and who paid", () => {
  assert.deepEqual(
    validateLotExpenseEntryDraft(emptyLotExpenseEntryDraft, DEFAULT_EXPENSE_PROOF_THRESHOLD_CENTS),
    ["expense_amount_required", "expense_date_required", "expense_paid_by_required"],
  );
});

test("the edit form keeps the day the activity happened, not the 1st", async () => {
  const { dateInputValue } = await import("./lot-ledger.ts");
  const stamp = { toDate: () => new Date(2026, 7, 15, 8, 0, 0) };
  assert.equal(dateInputValue(stamp), "2026-08-15");
  assert.equal(dateInputValue(new Date(2026, 0, 3)), "2026-01-03");
  assert.equal(dateInputValue(""), "");
  assert.equal(dateInputValue("not a date"), "");
});

test("an expense counts in exactly one month", async () => {
  const { lotExpenseEntryMonth } = await import("./lot-ledger.ts");
  const boughtInSeptember = new Date(2026, 8, 2, 12);
  // Logged against August's bill but bought in September: August only.
  assert.equal(
    lotExpenseEntryMonth({ month: "2026-08", spentAt: boughtInSeptember }),
    "2026-08",
  );
  // No bill month recorded: the purchase date decides.
  assert.equal(lotExpenseEntryMonth({ spentAt: boughtInSeptember }), "2026-09");
  assert.equal(lotExpenseEntryMonth({ month: "garbage", spentAt: boughtInSeptember }), "2026-09");
});


// ---------------------------------------------------------------------------
// What a month cost, and which line cost it.
// ---------------------------------------------------------------------------

const rent = {
  id: "rent",
  label: "Rent",
  kind: "fixed",
  recurringCents: 200000,
  active: true,
  createdAt: new Date(2026, 8, 4), // September 2026
};
const water = {
  id: "water",
  label: "Water",
  kind: "metered",
  recurringCents: 0,
  active: true,
  createdAt: new Date(2026, 8, 4),
};
const purchase = (id: string, lineId: string, cents: number, month: string, voided = false) => ({
  id,
  lineId,
  month,
  amountCents: cents,
  voided,
});

test("a standing charge is not owed before its line existed", () => {
  assert.equal(fixedLineAppliesTo(rent, "2026-08", "2026-09"), false);
  assert.equal(fixedLineAppliesTo(rent, "2026-09", "2026-09"), true);
});

test("a standing charge is not owed for a month that has not happened", () => {
  assert.equal(fixedLineAppliesTo(rent, "2026-10", "2026-09"), false);
});

test("the year bills only the months a standing charge was actually owed", () => {
  const months = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`);
  const year = months.reduce(
    (sum, m) => sum + lotMonthExpenseCents([rent], [], m, "2026-09"),
    0,
  );
  // One month of rent, not twelve — the bug that reported $24,092 for a lot
  // that had spent $2,092.
  assert.equal(year, 200000);
});

test("a logged purchase replaces a standing amount, and a voided one does not", () => {
  assert.equal(
    lotMonthExpenseCents([rent], [purchase("e1", "rent", 180000, "2026-09")], "2026-09", "2026-09"),
    180000,
  );
  assert.equal(
    lotMonthExpenseCents([rent], [purchase("e1", "rent", 180000, "2026-09", true)], "2026-09", "2026-09"),
    200000,
  );
});

test("the breakdown ranks lines and adds up to the total above it", () => {
  const months = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, "0")}`);
  const entries = [
    purchase("e1", "water", 6000, "2026-09"),
    purchase("e2", "water", 2000, "2026-09"),
  ];
  const spend = lotExpenseByLine([rent, water], entries, months, "2026-09");
  assert.deepEqual(spend.map((s) => s.label), ["Rent", "Water"]);
  assert.deepEqual(spend.map((s) => s.cents), [200000, 8000]);

  const total = months.reduce(
    (sum, m) => sum + lotMonthExpenseCents([rent, water], entries, m, "2026-09"),
    0,
  );
  assert.equal(spend.reduce((sum, s) => sum + s.cents, 0), total);
});

test("a purchase against a line that is gone still counts, unnamed", () => {
  const spend = lotExpenseByLine([], [purchase("e1", "deleted", 4200, "2026-09")], ["2026-09"], "2026-09");
  assert.equal(spend.length, 1);
  assert.equal(spend[0].cents, 4200);
  assert.equal(spend[0].label, "");
});

// A "received" mark can be undone when the money never came in, and the
// reversal is logged under whoever did it (writeLotLedgerAudit on the server).
test("a paid activity can be set back to not received, from the panel", () => {
  const panel = readFileSync(
    "src/components/business/operations-panels.tsx", "utf8");
  // The action shows only on a paid, direct (off-platform) activity.
  assert.match(
    panel,
    /lotActivityPaid\(r\) && String\(r\.paymentMethod\) === "direct" && \(<button[^>]*>[\s\S]*?revertActivityPayment/,
  );
  // It goes through the dedicated callable, behind a confirmation.
  assert.match(panel, /"revertLotActivityDirectPayment"/);
  assert.match(panel, /async function revertActivityPayment\(/);
  assert.match(panel, /confirmImportantAction\(/);
});

// Every word the activity row puts on screen has to exist in French. The row
// names who recorded the job and, on a cash job, who took the money — each a
// bare preposition in its own text node, which is exactly the shape that slips
// past a review looking for sentences. It shipped English-only once.
test("the activity row's own copy is translated, prepositions included", () => {
  const panel = readFileSync(
    "src/components/business/operations-panels.tsx", "utf8");
  // The row renders both, beside the date and under the fee.
  assert.match(panel, /"By ",?\s*|\{"By "\}|By \{/);
  assert.match(panel, /staffName\(text\(r\.recordedByStaffId, ""\)\)/);
  for (const label of ["By", "by", "Edited", "Mark not received",
    "Set back to not received"]) {
    assert.notEqual(
      translateValue(label, "fr"), label,
      `"${label}" renders on the activity row with no French entry in ` +
      `french-dom.ts — add one.`);
  }
});

// The scoreboard, the filters and the lede above the table. These headings are
// sentence case in the source and uppercased by CSS, so the dictionary has to
// key on what the DOM actually carries, not on what the screenshot shows.
test("the lot ledger's scoreboard, filters and lede are translated", () => {
  for (const label of ["Generated", "Collected", "Owed", "Jobs",
    "All money", "This month", "Last 3 months", "Custom range",
    "The cards above cover the same range.", "Appointment requests"]) {
    assert.notEqual(
      translateValue(label, "fr"), label,
      `"${label}" renders on the lot ledger with no French entry in ` +
      `french-dom.ts — add one.`);
  }
  // The short keys above must not eat the longer strings they sit inside;
  // longest-first alternation is what protects these, in both directions.
  for (const [en, fr] of [
    ["Collected from orders the customer has paid",
      "Encaissée sur les commandes déjà payées par le client"],
    ["One-off jobs", "Prestations ponctuelles"],
    ["Due on arrival", "Dû à l’arrivée"],
    ["Appointment time", "Heure du rendez-vous"],
    ["Month by month", "Mois par mois"],
  ]) {
    assert.equal(translateValue(en, "fr"), fr);
    assert.equal(translateValue(fr, "en"), en);
  }
  // The lede interpolates the month, so the sentence reaches the DOM with the
  // period still attached to it.
  assert.equal(
    translateValue(". The cards above cover the same range.", "fr"),
    ". Les cartes ci-dessus couvrent la même période.");
});

// ===========================================================================
// Instalments — a job paid in pieces.
//
// `feeCents` is the agreed total, `amountPaidCents` what has arrived, and
// part-paid is DERIVED from the two rather than being a fifth payment status.
// Every rule below is a mirror of the instalment block in
// `my_flutter_app/functions/lot_ledger.js`; the contract test at the end of
// this section fails if the two drift apart.
// ===========================================================================

test("what has been collected: absent means nothing, a settled old row means all", () => {
  // Nothing written, nothing collected.
  assert.equal(lotActivityPaidCents({ feeCents: 100000 }), 0);
  // The running total wins when it is there.
  assert.equal(
    lotActivityPaidCents({ feeCents: 100000, amountPaidCents: 35000 }),
    35000,
  );
  // Rule (a): settled before instalments existed. No running total was ever
  // written, so the status is the only evidence — and it says paid in full.
  assert.equal(
    lotActivityPaidCents({ feeCents: 100000, paymentStatus: "succeeded" }),
    100000,
  );
  // An awaiting row with no total is simply unpaid.
  assert.equal(
    lotActivityPaidCents({ feeCents: 100000, paymentStatus: "awaiting_payment_link" }),
    0,
  );
  // Junk reads as zero rather than NaN, which would poison every total.
  assert.equal(lotActivityPaidCents({ feeCents: 100000, amountPaidCents: "x" }), 0);
  assert.equal(lotActivityPaidCents(null as unknown as Record<string, unknown>), 0);
});

test("the remaining balance never goes below zero", () => {
  assert.equal(lotActivityRemainingCents({ feeCents: 100000, amountPaidCents: 35000 }), 65000);
  assert.equal(lotActivityRemainingCents({ feeCents: 100000, paymentStatus: "succeeded" }), 0);
  // Overpaid on the card rail: the job owes nothing, it does not owe minus.
  assert.equal(lotActivityRemainingCents({ feeCents: 100000, amountPaidCents: 120000 }), 0);
  assert.equal(lotActivityRemainingCents({ feeCents: 0 }), 0);
});

test("part paid means some but not all — and a voided row is never part paid", () => {
  assert.ok(lotActivityPartlyPaid({ feeCents: 100000, amountPaidCents: 35000 }));
  // Nothing in yet.
  assert.ok(!lotActivityPartlyPaid({ feeCents: 100000, amountPaidCents: 0 }));
  // All of it in.
  assert.ok(!lotActivityPartlyPaid({ feeCents: 100000, amountPaidCents: 100000 }));
  // Rule (b): a voided job is dead. Its balance is not chased, so it is not
  // shown as part paid however much of it came in before it was voided.
  assert.ok(
    !lotActivityPartlyPaid({ feeCents: 100000, amountPaidCents: 35000, voided: true }),
  );
  // A row settled before instalments existed reads as fully paid, not part.
  assert.ok(!lotActivityPartlyPaid({ feeCents: 100000, paymentStatus: "succeeded" }));
});

test("the activity badge speaks the parking ledger's exact vocabulary", () => {
  // Both halves of this panel describe the same state, so they must use the
  // same words. If either list changes, this fails.
  const parkingWords = new Set<string>(
    [
      { paymentMethod: "direct", enteredByBusiness: true, paymentStatus: "succeeded" },
      { paymentMethod: "direct", enteredByBusiness: true, paymentStatus: "awaiting_direct_payment", amountPaidCents: 3500 },
      { paymentMethod: "direct", enteredByBusiness: true, paymentStatus: "awaiting_direct_payment" },
    ].map((row) => businessParkingPaymentBadge(row)),
  );
  assert.deepEqual([...parkingWords].sort(), ["Not paid", "Paid", "Part paid"]);

  assert.equal(lotActivityPaymentBadge({ feeCents: 100000, paymentStatus: "succeeded" }), "Paid");
  assert.equal(
    lotActivityPaymentBadge({ feeCents: 100000, amountPaidCents: 35000, paymentStatus: "awaiting_direct_payment" }),
    "Part paid",
  );
  assert.equal(
    lotActivityPaymentBadge({ feeCents: 100000, paymentStatus: "awaiting_payment_link" }),
    "Not paid",
  );
  // Fully covered before the status has caught up still reads as paid.
  assert.equal(
    lotActivityPaymentBadge({ feeCents: 100000, amountPaidCents: 100000, paymentStatus: "awaiting_payment_link" }),
    "Paid",
  );
  // A dead row carries no balance badge at all.
  assert.equal(lotActivityPaymentBadge({ feeCents: 100000, voided: true }), "");
  assert.equal(lotActivityPaymentBadge({ feeCents: 100000, paymentStatus: "cancelled" }), "");

  // Every word the badge can produce is one of the parking ledger's three.
  for (const row of [
    { feeCents: 100000, paymentStatus: "succeeded" },
    { feeCents: 100000, amountPaidCents: 35000 },
    { feeCents: 100000 },
  ]) {
    assert.ok(parkingWords.has(lotActivityPaymentBadge(row)));
  }
});

test("the row's balance line reads as $350.00 of $1,000.00", () => {
  assert.equal(
    lotActivityBalanceText({ feeCents: 100000, amountPaidCents: 35000 }),
    "$350.00 of $1,000.00",
  );
  // No fee, nothing to read a balance against.
  assert.equal(lotActivityBalanceText({ feeCents: 0, amountPaidCents: 0 }), "");
});

test("a payment is clamped to the balance, and a card payment has a floor", () => {
  const job = { feeCents: 100000, amountPaidCents: 35000 };
  // Cash: staff typing more than is owed is a typo, not a tip.
  const over = lotActivityPaymentPlan({ activity: job, amountCents: 90000, source: "cash" });
  assert.equal(over.ok, true);
  assert.equal(over.appliedCents, 65000);
  assert.equal(over.overpaidCents, 0);
  assert.equal(over.remainingCents, 0);
  assert.equal(over.fullyCovered, true);

  const part = lotActivityPaymentPlan({ activity: job, amountCents: 20000, source: "cash" });
  assert.equal(part.appliedCents, 20000);
  assert.equal(part.newPaidCents, 55000);
  assert.equal(part.remainingCents, 45000);
  assert.equal(part.fullyCovered, false);

  // Card: Stripe already took it, so the overspill is reported, not clamped
  // away silently.
  const card = lotActivityPaymentPlan({ activity: job, amountCents: 90000, source: "card" });
  assert.equal(card.appliedCents, 65000);
  assert.equal(card.overpaidCents, 25000);

  // $20 floor on the card rail only; cash has no minimum.
  assert.equal(
    lotActivityPaymentPlan({ activity: job, amountCents: 1500, source: "card" }).reason,
    "below_card_minimum",
  );
  assert.equal(lotActivityPaymentPlan({ activity: job, amountCents: 1500, source: "cash" }).ok, true);
  assert.equal(LOT_ACTIVITY_MIN_CARD_PAYMENT_CENTS, 2000);

  // Nothing to take.
  assert.equal(
    lotActivityPaymentPlan({ activity: { ...job, voided: true }, amountCents: 1000, source: "cash" }).reason,
    "activity_voided",
  );
  assert.equal(
    lotActivityPaymentPlan({ activity: { feeCents: 100000, paymentStatus: "cancelled" }, amountCents: 1000, source: "cash" }).reason,
    "activity_cancelled",
  );
  assert.equal(
    lotActivityPaymentPlan({ activity: { feeCents: 0 }, amountCents: 1000, source: "cash" }).reason,
    "nothing_to_pay",
  );
  assert.equal(
    lotActivityPaymentPlan({ activity: { feeCents: 100000, paymentStatus: "succeeded" }, amountCents: 1000, source: "cash" }).reason,
    "already_paid",
  );
  assert.equal(
    lotActivityPaymentPlan({ activity: job, amountCents: 0, source: "cash" }).reason,
    "no_amount",
  );
});

test("an instalment reports every problem at once and clamps what it sends", () => {
  const job = { feeCents: 100000, amountPaidCents: 35000 };
  // Nothing typed, nobody named.
  const empty = validateLotInstalmentDraft(emptyLotInstalmentDraft, job);
  assert.ok(empty.includes("instalment_amount_required"));
  assert.ok(empty.includes("instalment_received_by_required"));
  // Each refusal becomes a sentence, and the same sentence is not said twice.
  assert.equal(
    lotInstalmentMessage(empty),
    "Enter how much came in. Say which staff member took the payment.",
  );

  const good = { amount: "200", receivedVia: "cash", receivedByStaffId: "s1", note: "first half" };
  assert.deepEqual(validateLotInstalmentDraft(good, job), []);

  // A job that cannot take money is refused before the round trip.
  assert.deepEqual(
    validateLotInstalmentDraft(good, { feeCents: 100000, paymentStatus: "succeeded" }),
    ["already_paid"],
  );

  const payload = lotInstalmentPayload(
    { ...good, amount: "900" },
    { businessId: "biz1", activityId: "a1", activity: job },
  );
  assert.equal(payload.businessId, "biz1");
  assert.equal(payload.activityId, "a1");
  // $900 typed against a $650 balance is sent as $650.
  assert.equal(payload.amountCents, 65000);
  assert.equal(payload.receivedVia, "cash");
  assert.equal(payload.receivedByStaffId, "s1");
  assert.equal(payload.note, "first half");
});

test("a payment counts in the month it arrived, whatever month the job is in", () => {
  assert.equal(lotPaymentMonth({ paidAtMonth: "2026-11" }), "2026-11");
  // No month key written: fall back to when the record was created.
  assert.equal(
    lotPaymentMonth({ createdAt: new Date("2026-11-04T12:00:00") }),
    "2026-11",
  );
  assert.equal(lotPaymentMonth({ paidAtMonth: "nonsense" }), "");
});

// ---------------------------------------------------------------------------
// The scoreboard. Generated and Owed belong to the job's month; Collected
// belongs to the month the money arrived in. They therefore need not add up
// inside a single month — that is the owner's decision, not a rounding bug.
// ---------------------------------------------------------------------------

const septemberJob = {
  id: "a1",
  feeCents: 100000,
  amountPaidCents: 35000,
  paymentStatus: "awaiting_direct_payment",
  activityDateMonth: "2026-09",
};
const scoreboardFor = (
  activities: Record<string, unknown>[],
  payments: Record<string, unknown>[],
  months: string[],
) =>
  lotActivityScoreboard({
    activities,
    payments,
    activityMonth: (row) => String(row.activityDateMonth ?? ""),
    inRange: (month) => months.includes(month),
  });

test("Collected follows the payment's month; Owed is the job's remaining balance", () => {
  const payments = [
    { activityId: "a1", amountCents: 20000, paidAtMonth: "2026-09" },
    // The second instalment landed two months after the job was billed.
    { activityId: "a1", amountCents: 15000, paidAtMonth: "2026-11" },
  ];

  const september = scoreboardFor([septemberJob], payments, ["2026-09"]);
  assert.equal(september.generatedCents, 100000);
  assert.equal(september.collectedCents, 20000);
  // Owed is what the job still has outstanding, not its whole fee: reading
  // the fee here is what made a part-paid job look untouched.
  assert.equal(september.owedCents, 65000);
  assert.equal(september.jobs, 1);

  // November billed nothing, but money arrived in it.
  const november = scoreboardFor([septemberJob], payments, ["2026-11"]);
  assert.equal(november.generatedCents, 0);
  assert.equal(november.collectedCents, 15000);
  assert.equal(november.owedCents, 0);
  assert.equal(november.jobs, 0);

  // Over both months the parts add back up to what the row itself records.
  const both = scoreboardFor([septemberJob], payments, ["2026-09", "2026-11"]);
  assert.equal(both.collectedCents, 35000);
});

test("money collected before instalments existed is still counted, exactly once", () => {
  // A row settled the old way: a status, no running total, no payment
  // documents at all. Its month is the only date the money has.
  const legacy = {
    id: "old", feeCents: 50000, paymentStatus: "succeeded",
    activityDateMonth: "2026-09",
  };
  const legacyOnly = scoreboardFor([legacy], [], ["2026-09"]);
  assert.equal(legacyOnly.collectedCents, 50000);
  assert.equal(legacyOnly.owedCents, 0);

  // A row whose collection IS documented contributes its payments and nothing
  // extra — no double count.
  const documented = scoreboardFor(
    [septemberJob],
    [{ activityId: "a1", amountCents: 35000, paidAtMonth: "2026-09" }],
    ["2026-09"],
  );
  assert.equal(documented.collectedCents, 35000);

  // Half documented, half not: only the undocumented half is added back.
  const partlyDocumented = scoreboardFor(
    [septemberJob],
    [{ activityId: "a1", amountCents: 20000, paidAtMonth: "2026-09" }],
    ["2026-09"],
  );
  assert.equal(partlyDocumented.collectedCents, 35000);
});

test("voided and cancelled jobs are off the board, with their payments", () => {
  const voided = { id: "v", feeCents: 80000, amountPaidCents: 80000, voided: true, activityDateMonth: "2026-09" };
  const cancelled = { id: "c", feeCents: 80000, paymentStatus: "cancelled", activityDateMonth: "2026-09" };
  const board = scoreboardFor(
    [voided, cancelled],
    [{ activityId: "v", amountCents: 80000, paidAtMonth: "2026-09" }],
    ["2026-09"],
  );
  assert.deepEqual(board, { generatedCents: 0, collectedCents: 0, owedCents: 0, jobs: 0 });

  // A payment whose job is not on screen is left out rather than appearing as
  // money no visible row explains.
  const orphan = scoreboardFor([], [{ activityId: "gone", amountCents: 5000, paidAtMonth: "2026-09" }], ["2026-09"]);
  assert.equal(orphan.collectedCents, 0);
});

// ---------------------------------------------------------------------------
// An activity type that records no vehicle.
// ---------------------------------------------------------------------------

test("an activity type records a vehicle unless it says otherwise", () => {
  // The default is on: a lot's work is almost always done to a car.
  assert.equal(emptyLotActivityTypeDraft.needsVehicle, true);
  assert.equal(
    lotActivityTypePayload({ label: "Dispatch", defaultFee: "50", needsAuctionHouse: false }).needsVehicle,
    true,
  );
  assert.equal(
    lotActivityTypePayload({
      label: "Auction account", defaultFee: "50",
      needsAuctionHouse: false, needsVehicle: false,
    }).needsVehicle,
    false,
  );
});

test("a job with no vehicle is not asked for a VIN, and sends no car", () => {
  const draft = {
    ...emptyLotActivityDraft,
    activityTypeId: "t1",
    fee: "250",
    activityDate: "2026-09-16",
    customerName: "Alimou",
    customerPhone: "2015551234",
    carMake: "Toyota",
    carModel: "Camry",
    carYear: "2018",
    vinNumber: "",
  };
  // The car fields still guard by default — absent means yes, as on the server.
  assert.ok(validateLotActivityDraft(draft, ["t1"]).includes("vin_required"));
  assert.deepEqual(validateLotActivityDraft(draft, ["t1"], { needsVehicle: false }), []);

  // And a job with no vehicle carries no vehicle, even when the form had one
  // filled in before the activity was changed.
  const payload = lotActivityPayload(draft, "biz1", { needsVehicle: false });
  assert.equal(payload.vinNumber, "");
  assert.equal(payload.carMake, "");
  assert.equal(payload.carModel, "");
  assert.equal(payload.carYear, "");
  // The default still sends the car.
  assert.equal(lotActivityPayload(draft, "biz1").carMake, "Toyota");
});

// ---------------------------------------------------------------------------
// The mirror. These rules exist twice on purpose — once in the callable, once
// here — so this reads the server file and fails if the two stop agreeing.
// ---------------------------------------------------------------------------

test("the instalment rules mirror the server module", () => {
  const server = readFileSync(
    "../my_flutter_app/functions/lot_ledger.js", "utf8");

  // Same names, exported from both sides.
  for (const name of [
    "lotActivityPaidCents", "lotActivityRemainingCents",
    "lotActivityPartlyPaid", "lotActivityPaymentPlan",
    "lotActivityPaymentRecord", "LOT_ACTIVITY_MIN_CARD_PAYMENT_CENTS",
    "LOT_ACTIVITY_PAYMENT_SOURCES",
  ]) {
    assert.ok(
      server.includes(name),
      `${name} is gone from functions/lot_ledger.js — the console mirrors a ` +
      `module that no longer defines it.`);
  }

  // The card floor is one number in two files.
  const floor = server.match(/LOT_ACTIVITY_MIN_CARD_PAYMENT_CENTS = (\d+)/);
  assert.ok(floor, "the server no longer states a card minimum");
  assert.equal(Number(floor?.[1]), LOT_ACTIVITY_MIN_CARD_PAYMENT_CENTS);

  // The two rails, in the same order.
  assert.match(server, /LOT_ACTIVITY_PAYMENT_SOURCES = Object\.freeze\(\["cash", "card"\]\)/);
  assert.deepEqual([...LOT_ACTIVITY_PAYMENT_SOURCES], ["cash", "card"]);

  // paymentStatus keeps its four values: part-paid is derived, never stored.
  // A fifth member would silently change what every reader of "succeeded"
  // believes, on both sides of the wire.
  const statuses = server.match(/LOT_ACTIVITY_PAYMENT_STATUS = Object\.freeze\(\{[\s\S]*?\}\)/);
  assert.ok(statuses);
  assert.equal((statuses?.[0].match(/:\s*"/g) ?? []).length, 4);
  assert.ok(!/part_paid|"part paid"/i.test(statuses?.[0] ?? ""));

  // A type that records no vehicle is the server's own flag, read the same
  // absent-means-yes way here.
  assert.match(server, /needsVehicle: input\.needsVehicle !== false/);
  assert.match(server, /opts\.needsVehicle !== false/);

  // The instalment document's shape, field for field, is what the console
  // expects to read back on the scoreboard.
  for (const field of [
    "businessId", "activityId", "amountCents", "overpaidCents", "source",
    "receivedVia", "receivedByStaffId", "recordedByStaffId", "paidAtMonth",
    "note",
  ]) {
    assert.ok(
      new RegExp(`${field}:`).test(server),
      `lotActivityPaymentRecord no longer writes ${field}`);
  }
});

// ---------------------------------------------------------------------------
// What the console actually renders. A pure function that is never wired up
// is not a feature.
// ---------------------------------------------------------------------------

test("the console records instalments, and the scoreboard reads them", () => {
  const panel = readFileSync(
    "src/components/business/operations-panels.tsx", "utf8");

  // The instalment collection is read, and the scoreboard is built from it
  // rather than from the activity rows alone.
  assert.match(panel, /useBusinessRows\("lotActivityPayments"/);
  assert.match(panel, /lotActivityScoreboard\(\{[\s\S]*?payments: activityPayments\.rows/);

  // The chase modal offers a part payment and calls the new callable.
  assert.match(panel, /"recordLotActivityInstalment"/);
  assert.match(panel, /async function chaseRecordInstalment\(/);
  assert.match(panel, /lotInstalmentPayload\(/);
  // And it validates before spending a round trip.
  assert.match(panel, /validateLotInstalmentDraft\(/);

  // The row shows the balance state and how much of it has arrived.
  assert.match(panel, /lotActivityPaymentBadge\(r\)/);
  assert.match(panel, /lotActivityBalanceText\(r\)/);
});

test("an activity type can record no vehicle, and the form obeys it", () => {
  const panel = readFileSync(
    "src/components/business/operations-panels.tsx", "utf8");

  // The checkbox exists on both the existing-type row and the add form.
  assert.equal((panel.match(/Records a vehicle/g) ?? []).length >= 2, true);
  assert.match(panel, /needsVehicle: e\.target\.checked/);

  // The car fields are hidden, not disabled: the owner's rule is that a form
  // does not show a field its controlling answer switched off.
  assert.match(panel, /\{typeNeedsVehicle && \(/);
  assert.match(panel, /needsVehicle: typeNeedsVehicle/);

  // The vehicle cell must never print the literal word "Vehicle" over an
  // empty VIN line again.
  assert.ok(
    !/join\(" "\) \|\| "Vehicle"/.test(panel),
    'the activity row still falls back to the literal word "Vehicle"');
  assert.match(panel, /const vehicle = vehicleText \|\| "—";/);
});

test("every string the instalment work puts on screen exists in French", () => {
  for (const label of [
    "Records a vehicle",
    "A job done without a car — lending an auction account, say — needs an activity that records no vehicle. The form then stops asking for a VIN.",
    "Part paid", "Paid", "Not paid", "Still owed",
    "The whole balance", "Part of it — they paid some of it now",
    "Amount received", "More than the balance is recorded as the balance.",
    "The rest stays owed and can be collected again later, here or on the customer’s payment link.",
    "Record part payment", "Part payment recorded.",
    "This entry is no longer on screen. Close this and open it again.",
    "Enter how much came in.", "Say which staff member took the payment.",
    "This entry was cancelled, so there is nothing to collect.",
    "This entry has no fee to collect.",
    "This entry is already paid in full.",
    "A card payment has to be at least $20.00.",
    "Record payment", "Mark this activity's money as received.",
    // The note field's placeholder — an attribute is as visible as a label.
    "e.g. first instalment",
  ]) {
    assert.notEqual(
      translateValue(label, "fr"), label,
      `"${label}" renders in the lot ledger with no French entry in ` +
      `french-dom.ts — add one.`);
  }

  // Round-trip the new entries: a French value that sits inside an existing
  // one comes back as something else, which is the failure this guards.
  for (const [en, fr] of [
    ["Part paid", "Partiellement payé"],
    ["Still owed", "Reste dû"],
    ["Amount received", "Montant reçu"],
    ["Records a vehicle", "Enregistre un véhicule"],
    ["Record part payment", "Enregistrer un paiement partiel"],
  ]) {
    assert.equal(translateValue(en, "fr"), fr);
    assert.equal(translateValue(fr, "en"), en);
  }

  // The balance line reaches the DOM as one node with the amounts in it.
  assert.equal(
    translateValue("$350.00 of $1,000.00", "fr"),
    "$350.00 sur $1,000.00");
});

test("a job settled after a part payment owes nothing on the board", () => {
  // The shape a whole-balance settlement leaves behind: the status moved to
  // succeeded, the running total did not. Read literally that is $650 still
  // owed on a row badged Paid — the parking ledger's own bug. The board reads
  // settled as paid in full, so the three figures still reconcile.
  const settledAfterPart = {
    id: "a1", feeCents: 100000, amountPaidCents: 35000,
    paymentStatus: "succeeded", activityDateMonth: "2026-09",
  };
  const board = scoreboardFor(
    [settledAfterPart],
    [{ activityId: "a1", amountCents: 35000, paidAtMonth: "2026-09" }],
    ["2026-09"],
  );
  assert.equal(board.generatedCents, 100000);
  assert.equal(board.owedCents, 0);
  assert.equal(board.collectedCents, 100000);
  assert.equal(board.collectedCents + board.owedCents, board.generatedCents);

  // The row's own numbers still mirror the server exactly — only the board
  // applies the settled rule.
  assert.equal(lotActivityPaidCents(settledAfterPart), 35000);
  assert.equal(lotActivityRemainingCents(settledAfterPart), 65000);
});

test("settling a part-paid job goes through the instalment callable", () => {
  const panel = readFileSync(
    "src/components/business/operations-panels.tsx", "utf8");
  // recordLotActivityDirectPayment never writes amountPaidCents, so using it
  // on a part-paid job leaves a balance behind under a Paid badge. The panel
  // must route those rows to the instalment path instead.
  assert.match(
    panel,
    /if \(row && lotActivityPaidCents\(row\) > 0 && lotActivityRemainingCents\(row\) > 0\) \{\s*await chaseRecordInstalment\(activityId, lotActivityRemainingCents\(row\)\);/,
  );
  // And the balance line follows the badge rather than the raw numbers.
  assert.match(panel, /const partlyPaid = badge === "Part paid";/);
});

// A save launched from a modal leaves the modal open when it fails, and the
// panel's banner renders behind it — so the person sees a form that did not
// close and no reason why. That is exactly how "Enter the VIN." went
// unexplained on production: the server refused, the modal stayed, and the
// message was underneath it.
test("a failed save says so inside the modal, not behind it", () => {
  const panel = readFileSync(
    "src/components/business/operations-panels.tsx", "utf8");

  // runPanelAction can report a failure somewhere other than the panel banner.
  assert.match(panel, /onError\?: \(message: string\) => void/);
  assert.match(panel, /onError\?\.\(message\)/);

  // The two lot-ledger saves that run from a modal use it.
  const saves = panel.match(/await runPanelAction\([\s\S]*?\}, setDraftError\);/g) ?? [];
  assert.ok(
    saves.length >= 2,
    "the activity save and the type save should both route their failure " +
    "into the modal's own error line");
  assert.ok(saves.some((s) => /createLotActivity/.test(s)));
  assert.ok(saves.some((s) => /upsertLotActivityType/.test(s)));
});


// Parked-car money was missing from the month-by-month chart because a stay
// has no natural month. It now arrives by payment date, stacks on the income
// bar, counts in the running net and the year's Net, and the year breakdown
// stops mixing in a to-date standing total.
test("the reports chart carries parked-car income, by the month it arrived", () => {
  const panel = readFileSync(
    "src/components/business/operations-panels.tsx", "utf8");
  assert.match(panel, /businessParkingCollectedByMonth\(/);
  assert.match(panel, /<LotMonthlyChart revenue=\{yearRevenueByMonth\} parking=\{yearParkingByMonth\}/);
  assert.match(panel, /const yearIncome = yearRevenue \+ yearParking;/);
  assert.match(panel, /const yearNet = yearIncome - yearExpense;/);
  assert.match(panel, /<LotYearSummary revenue=\{yearRevenue\} parking=\{yearParking\}/);
  // The breakdown row for parking is the year's collected figure.
  assert.match(panel, /key: "__parking", label: "Car parking", cents: yearParking/);
  assert.doesNotMatch(panel, /Math\.round\(parkingGenerated \* 100\)/);
  // The chart counts parking in its running net.
  assert.match(panel, /const income = revenue\.map\(\(r, i\) => r \+ \(parking\[i\] \?\? 0\)\);/);
});
