import assert from "node:assert/strict";
import test from "node:test";

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
  validateLotActivityDraft,
  validateLotActivityTypeDraft,
  validateLotExpenseEntryDraft,
  fixedLineAppliesTo,
  lotMonthExpenseCents,
  lotExpenseByLine,
} from "./lot-ledger.ts";

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

  // Direct with no staff member named is refused.
  const direct = { ...link, paymentMethod: "direct" as const, receivedByStaffId: "" };
  assert.ok(validateLotActivityDraft(direct, ["t1"]).includes("received_by_required"));
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
  // Chase only on an unpaid link.
  assert.ok(canChaseLotActivity({ paymentMethod: "payment_link", paymentStatus: "awaiting_payment_link" }));
  assert.ok(!canChaseLotActivity({ paymentMethod: "payment_link", paymentStatus: "succeeded" }));
  assert.ok(!canChaseLotActivity({ paymentMethod: "direct", paymentStatus: "awaiting_direct_payment" }));
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
