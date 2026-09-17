"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  LOT_CUSTOM_ACTIVITY_ID,
  LOT_ACTIVITY_SEED_TYPES,
  normalizeReceivedVia,
  normalizeAuctionHouse,
  validateLotActivityType,
  lotActivityTypeRecord,
  validateLotActivity,
  lotActivityRecord,
  lotActivityInitialStatus,
  expenseProofRequired,
  validateLotExpenseEntry,
  lotExpenseEntryRecord,
} = require("../lot_ledger");

const ACTIVITY = Object.freeze({
  activityTypeId: "t1",
  feeCents: 15000,
  activityDate: "2026-08-15T12:00:00",
  customerName: "Alimou",
  vinNumber: "ec035066",
  paymentMethod: "payment_link",
  customerPhone: "2015551234",
});

describe("activity type catalogue", () => {
  it("requires a name and a fee, and 0 is a real fee", () => {
    assert.deepEqual(validateLotActivityType({}), [
      "activity_type_label_required",
      "activity_type_fee_invalid",
    ]);
    assert.deepEqual(
        validateLotActivityType({label: "Key cutting", defaultFeeCents: 0}),
        [],
    );
    assert.deepEqual(
        validateLotActivityType({label: "Dispatch", defaultFeeCents: -1}),
        ["activity_type_fee_invalid"],
    );
  });

  it("normalizes the record", () => {
    const r = lotActivityTypeRecord({
      label: "Title purchase",
      defaultFeeCents: 10000,
      needsAuctionHouse: true,
      sortOrder: 2,
    });
    assert.equal(r.label, "Title purchase");
    assert.equal(r.defaultFeeCents, 10000);
    assert.equal(r.needsAuctionHouse, true);
    assert.equal(r.active, true);
    assert.equal(r.sortOrder, 2);
  });
});

describe("recording an activity", () => {
  it("reports every problem at once", () => {
    const errors = validateLotActivity({}, {knownTypeIds: ["t1"]});
    assert.ok(errors.includes("activity_type_invalid"));
    assert.ok(errors.includes("fee_required"));
    assert.ok(errors.includes("activity_date_required"));
    assert.ok(errors.includes("customer_name_required"));
    assert.ok(errors.includes("vin_required"));
    assert.ok(errors.includes("payment_method_invalid"));
  });

  it("accepts a known type and a reachable link", () => {
    assert.deepEqual(validateLotActivity(ACTIVITY, {knownTypeIds: ["t1"]}), []);
  });

  it("rejects a stale type id and requires a custom label for one-offs", () => {
    assert.ok(
        validateLotActivity(
            {...ACTIVITY, activityTypeId: "gone"},
            {knownTypeIds: ["t1"]},
        ).includes("activity_type_invalid"),
    );
    assert.ok(
        validateLotActivity(
            {...ACTIVITY, activityTypeId: LOT_CUSTOM_ACTIVITY_ID},
            {knownTypeIds: ["t1"]},
        ).includes("custom_label_required"),
    );
  });

  it("a link needs contact; direct needs a staff collector", () => {
    assert.ok(
        validateLotActivity(
            {...ACTIVITY, customerPhone: "", customerEmail: ""},
            {knownTypeIds: ["t1"]},
        ).includes("payment_link_contact_required"),
    );
    assert.ok(
        validateLotActivity(
            {...ACTIVITY, paymentMethod: "direct", receivedByStaffId: ""},
            {knownTypeIds: ["t1"]},
        ).includes("received_by_required"),
    );
    // But a direct activity logged before the money arrives names no one and
    // passes - there is nobody who received it yet.
    assert.deepEqual(
        validateLotActivity(
            {
              ...ACTIVITY,
              paymentMethod: "direct",
              receivedByStaffId: "",
              paymentReceived: false,
            },
            {knownTypeIds: ["t1"]},
        ),
        [],
    );
  });

  it("a not-yet-paid direct activity awaits, names no one", () => {
    assert.deepEqual(lotActivityInitialStatus("direct", false), {
      status: "awaiting_direct_payment",
      needsStripe: false,
    });
    const r = lotActivityRecord(
        {...ACTIVITY, paymentMethod: "direct", receivedByStaffId: "s2",
          receivedVia: "cash", paymentReceived: false},
        {activityTypeLabel: "Dispatch", feeCents: 15000,
          recordedByStaffId: "s1"},
    );
    assert.equal(r.receivedByStaffId, "");
    assert.equal(r.receivedVia, "");
  });

  it("the record denormalizes label, uppercases VIN, drops mismatches", () => {
    const r = lotActivityRecord(
        {...ACTIVITY, receivedByStaffId: "drop-me"},
        {
          activityTypeLabel: "Dispatch",
          feeCents: 15000,
          recordedByStaffId: "s1",
        },
    );
    assert.equal(r.activityTypeLabel, "Dispatch");
    assert.equal(r.vinNumber, "EC035066");
    assert.equal(r.receivedByStaffId, ""); // a link carries no collector
    assert.equal(r.receivedVia, "");
    assert.equal(r.recordedByStaffId, "s1");
  });

  it("direct is succeeded on arrival; a link awaits the website", () => {
    assert.deepEqual(lotActivityInitialStatus("direct"), {
      status: "succeeded",
      needsStripe: false,
    });
    assert.deepEqual(lotActivityInitialStatus("payment_link"), {
      status: "awaiting_payment_link",
      needsStripe: true,
    });
  });

  it("normalizes off-platform method and auction house to known values", () => {
    assert.equal(normalizeReceivedVia("ZELLE "), "zelle");
    assert.equal(normalizeReceivedVia("bitcoin"), "other");
    assert.equal(normalizeAuctionHouse("Copart"), "Copart");
    assert.equal(normalizeAuctionHouse("madeup"), "");
  });
});

describe("seed activity types", () => {
  it("seeds four Keren activities; only title needs an auction house", () => {
    assert.equal(LOT_ACTIVITY_SEED_TYPES.length, 4);
    const labels = LOT_ACTIVITY_SEED_TYPES.map((t) => t.label);
    assert.deepEqual(labels, [
      "Title purchase at auction",
      "Dispatch",
      "Reassignment",
      "Storage release",
    ]);
    const needAuction = LOT_ACTIVITY_SEED_TYPES.filter(
        (t) => t.needsAuctionHouse,
    );
    assert.equal(needAuction.length, 1);
    assert.equal(needAuction[0].label, "Title purchase at auction");
    // Each seed validates against the same rule the callable enforces.
    for (const seed of LOT_ACTIVITY_SEED_TYPES) {
      assert.deepEqual(validateLotActivityType(seed), []);
    }
  });
});

describe("expenses", () => {
  it("requires proof at and above the threshold, allows below and at 0", () => {
    assert.equal(expenseProofRequired(7500, 7500), true);
    assert.equal(expenseProofRequired(7499, 7500), false);
    assert.equal(expenseProofRequired(500000, 0), false);
  });

  it("reports missing amount/date/payer and enforces proof server-side", () => {
    assert.deepEqual(validateLotExpenseEntry({}, {thresholdCents: 7500}), [
      "expense_amount_required",
      "expense_date_required",
      "expense_paid_by_required",
    ]);
    assert.deepEqual(
        validateLotExpenseEntry(
            {
              amountCents: 12000,
              spentAt: "2026-08-01T12:00:00",
              paidByStaffId: "s1",
            },
            {thresholdCents: 7500, hasProof: false},
        ),
        ["expense_proof_required"],
    );
    assert.deepEqual(
        validateLotExpenseEntry(
            {
              amountCents: 12000,
              spentAt: "2026-08-01T12:00:00",
              paidByStaffId: "s1",
            },
            {thresholdCents: 7500, hasProof: true},
        ),
        [],
    );
  });

  it("snapshots the proof rule at entry time", () => {
    const r = lotExpenseEntryRecord(
        {
          lineId: "water",
          month: "2026-08",
          amountCents: 12000,
          paidByStaffId: "s1",
          note: "jugs",
        },
        {recordedByStaffId: "s2", thresholdCents: 7500},
    );
    assert.equal(r.proofRequired, true);
    assert.equal(r.recordedByStaffId, "s2");
    assert.equal(r.amountCents, 12000);
  });
});

describe("editing a recorded activity protects the money", () => {
  const {
    lotActivityEditRefusal,
    lotActivityLockedPaymentFields,
  } = require("../lot_ledger");
  const paidLink = {
    paymentMethod: "payment_link", paymentStatus: "succeeded",
    feeCents: 11000,
  };

  it("refuses to revive a voided entry", () => {
    assert.equal(
        lotActivityEditRefusal({...paidLink, voided: true}, {}, 11000),
        "activity_voided",
    );
  });

  it("locks the amount once the customer has paid", () => {
    assert.equal(
        lotActivityEditRefusal(
            paidLink, {paymentMethod: "payment_link"}, 12000),
        "paid_amount_locked",
    );
    assert.equal(
        lotActivityEditRefusal(
            paidLink, {paymentMethod: "payment_link"}, 11000),
        null,
    );
  });

  it("does not let an edit switch how the money is taken", () => {
    const unpaid = {
      paymentMethod: "payment_link", paymentStatus: "awaiting_payment_link",
      feeCents: 11000,
    };
    assert.equal(
        lotActivityEditRefusal(unpaid, {paymentMethod: "direct"}, 11000),
        "payment_method_locked",
    );
    // A price change on an unpaid link is allowed (the link is re-issued).
    assert.equal(
        lotActivityEditRefusal(unpaid, {paymentMethod: "payment_link"}, 9000),
        null,
    );
  });

  it("keeps the stored payment fields over whatever the edit sent", () => {
    assert.deepEqual(lotActivityLockedPaymentFields({
      paymentMethod: "direct", receivedVia: "zelle",
      receivedByStaffId: "staff_9",
    }), {
      paymentMethod: "direct", receivedVia: "zelle",
      receivedByStaffId: "staff_9",
    });
  });
});

describe("instalments", () => {
  const {
    LOT_ACTIVITY_MIN_CARD_PAYMENT_CENTS,
    lotActivityPaidCents,
    lotActivityRemainingCents,
    lotActivityPartlyPaid,
    lotActivityPaymentPlan,
    lotActivityPaymentRecord,
    lotActivityEditRefusal,
  } = require("../lot_ledger");

  const job = (feeCents, paidCents, extra = {}) => ({
    feeCents, amountPaidCents: paidCents,
    paymentStatus: "awaiting_payment_link", ...extra,
  });
  const plan = (activity, amountCents, source) =>
    lotActivityPaymentPlan({activity, amountCents, source});

  it("applies a first instalment and leaves the rest owing", () => {
    const result = plan(job(100000, 0), 5000, "cash");
    assert.equal(result.ok, true);
    assert.equal(result.appliedCents, 5000);
    assert.equal(result.newPaidCents, 5000);
    assert.equal(result.remainingCents, 95000);
    assert.equal(result.fullyCovered, false);
  });

  it("settles the activity when the last instalment lands", () => {
    const result = plan(job(100000, 95000), 5000, "cash");
    assert.equal(result.fullyCovered, true);
    assert.equal(result.remainingCents, 0);
  });

  // Staff typing more than is owed is a typo, not a tip - the same call
  // parking already makes.
  it("clamps cash to the balance and never reports an overpayment", () => {
    const result = plan(job(100000, 95000), 99999, "cash");
    assert.equal(result.appliedCents, 5000);
    assert.equal(result.overpaidCents, 0);
    assert.equal(result.newPaidCents, 100000);
  });

  // By the time a card payment reaches us Stripe has already taken it, so
  // clamping would quietly keep money the books never show.
  it("reports a card overpayment instead of swallowing it", () => {
    const result = plan(job(100000, 95000), 99999, "card");
    assert.equal(result.appliedCents, 5000);
    assert.equal(result.overpaidCents, 94999);
    assert.equal(result.fullyCovered, true);
  });

  it("refuses a card payment under the minimum, but never cash", () => {
    assert.equal(
        plan(job(100000, 0), LOT_ACTIVITY_MIN_CARD_PAYMENT_CENTS - 1, "card")
            .reason,
        "below_card_minimum");
    assert.equal(
        plan(job(100000, 0), LOT_ACTIVITY_MIN_CARD_PAYMENT_CENTS, "card").ok,
        true);
    assert.equal(plan(job(100000, 0), 100, "cash").ok, true);
  });

  it("refuses payment against a voided or settled job", () => {
    assert.equal(plan(job(100000, 5000, {voided: true}), 1000, "cash").reason,
        "activity_voided");
    assert.equal(plan(job(100000, 100000), 1000, "cash").reason,
        "already_paid");
    assert.equal(
        plan(job(100000, 0, {paymentStatus: "cancelled"}), 1000, "cash").reason,
        "activity_cancelled");
    assert.equal(plan(job(100000, 0), 0, "cash").reason, "no_amount");
    assert.equal(plan(job(100000, 0), -500, "cash").reason, "no_amount");
  });

  // Every activity settled before instalments existed carries no running
  // total. Reading one as unpaid would resurrect finished jobs as debts.
  it("reads a pre-instalment settled activity as fully paid", () => {
    const legacy = {feeCents: 2500, paymentStatus: "succeeded"};
    assert.equal(lotActivityPaidCents(legacy), 2500);
    assert.equal(lotActivityRemainingCents(legacy), 0);
    assert.equal(lotActivityPartlyPaid(legacy), false);
    assert.equal(plan(legacy, 500, "cash").reason, "already_paid");
  });

  // A dead job is not a debt: its balance must stop being chased.
  it("never calls a voided job part paid", () => {
    assert.equal(lotActivityPartlyPaid(job(100000, 35000)), true);
    assert.equal(
        lotActivityPartlyPaid(job(100000, 35000, {voided: true})), false);
  });

  it("lets a part-paid total move, but never below what was collected", () => {
    assert.equal(lotActivityEditRefusal(job(100000, 35000), {}, 130000), null);
    assert.equal(lotActivityEditRefusal(job(100000, 35000), {}, 35000), null);
    assert.equal(lotActivityEditRefusal(job(100000, 35000), {}, 4000),
        "below_amount_paid");
  });

  // The month key is the point: a September job paid in November is November
  // income, and a scoreboard reading the activity's month never sees it.
  it("stamps a payment with its own month and rail", () => {
    const record = lotActivityPaymentRecord({
      businessId: "biz_1", activityId: "act_1", amountCents: 20000,
      source: "cash", receivedVia: "zelle", receivedByStaffId: "staff_2",
      recordedByStaffId: "staff_2", paidAtMonth: "2026-11", note: "part",
    });
    assert.equal(record.paidAtMonth, "2026-11");
    assert.equal(record.source, "cash");
    assert.equal(record.receivedVia, "zelle");
    assert.equal(record.receivedByStaffId, "staff_2");
  });

  // Card money has no one holding it, so naming a staff member would be a lie.
  it("keeps cash-only fields off a card payment", () => {
    const record = lotActivityPaymentRecord({
      businessId: "biz_1", activityId: "act_1", amountCents: 20000,
      source: "card", receivedVia: "zelle", receivedByStaffId: "staff_2",
      paidAtMonth: "2026-11",
    });
    assert.equal(record.receivedVia, "");
    assert.equal(record.receivedByStaffId, "");
  });
});

describe("activity types that record no vehicle", () => {
  const {lotActivityTypeRecord: typeRecord, validateLotActivity: validate} =
    require("../lot_ledger");

  it("demands a vehicle unless the type opts out", () => {
    assert.equal(typeRecord({label: "Dispatch", defaultFeeCents: 0})
        .needsVehicle, true);
    assert.equal(typeRecord({label: "Access", defaultFeeCents: 0,
      needsVehicle: false}).needsVehicle, false);
  });

  it("drops the VIN requirement only for a type with no vehicle", () => {
    const input = {
      activityTypeId: "t1", feeCents: 100000, activityDate: "2026-10-03",
      customerName: "Mamadou", paymentMethod: "direct",
      receivedByStaffId: "staff_1",
    };
    const opts = {knownTypeIds: ["t1"]};
    assert.ok(validate(input, opts).includes("vin_required"));
    assert.ok(!validate(input, {...opts, needsVehicle: false})
        .includes("vin_required"));
  });
});

// The running total and the payment status are two facts about the same
// money. Every path that moves one has to move the other, or a job reads as
// owing $650 under a "Paid" badge - which is exactly how the parking ledger's
// own historical bug behaved. These read the source because the callables
// need Firestore and Stripe to run, and the assertion is about what they
// write, not how they compute it.
describe("settling and unsettling keep the balance honest", () => {
  const {readFileSync} = require("node:fs");
  const source = readFileSync(
      require("node:path").join(__dirname, "..", "index.js"), "utf8");

  const callable = (name) => {
    const start = source.indexOf(`exports.${name} = onCall(`);
    assert.ok(start > -1, `${name} not found`);
    const next = source.indexOf("\nexports.", start + 1);
    return source.slice(start, next === -1 ? undefined : next);
  };

  it("marking a part-paid job received also clears its balance", () => {
    const body = callable("recordLotActivityDirectPayment");
    assert.match(
        body,
        /amountPaidCents: Math\.max\(0, Number\(current\.feeCents\)/);
    // The money that settles it is recorded, so the history accounts for
    // every dollar instead of jumping from $350 to paid.
    assert.match(body, /lotActivityRemainingCents\(current\)/);
    assert.match(body, /collection\("lotActivityPayments"\)/);
  });

  it("reverting a payment puts the balance back to nothing paid", () => {
    const body = callable("revertLotActivityDirectPayment");
    assert.match(body, /amountPaidCents: 0/);
    // Flagged, never deleted - the same call voiding makes.
    assert.match(body, /reverted: true/);
    assert.doesNotMatch(body, /\.delete\(\)\s*;?\s*$/m);
  });

  it("an instalment settles the job only when it clears the balance", () => {
    const body = callable("recordLotActivityInstalment");
    assert.match(body, /if \(plan\.fullyCovered\)/);
    assert.match(body, /runTransaction/);
    // Taking cash closes the window in which the customer could still pay a
    // balance that has just stopped being owed.
    assert.match(body, /expireStripeCheckoutSession/);
  });
});

// validateLotActivity reads `opts.needsVehicle !== false`, so a resolver path
// that forgets the field sends `undefined` and the server demands a VIN for a
// job whose form does not even show the field. That shipped: the call sites
// passed `fee.needsVehicle` while the resolver never set it, and every unit
// test above passed because they call the validator directly with explicit
// options. The wiring between the two is what needs pinning, not either end.
describe("the type's vehicle rule reaches the validator", () => {
  const {readFileSync} = require("node:fs");
  const source = readFileSync(
      require("node:path").join(__dirname, "..", "index.js"), "utf8");

  const resolver = (() => {
    const start = source.indexOf("async function resolveLotActivityFee(");
    assert.ok(start > -1, "resolveLotActivityFee not found");
    return source.slice(start, source.indexOf("\nasync function", start + 1));
  })();

  it("every path out of resolveLotActivityFee reports needsVehicle", () => {
    const returns = resolver.match(/return \{[\s\S]*?\};/g) || [];
    assert.ok(returns.length >= 3,
        `expected every exit to be checked, found ${returns.length}`);
    for (const block of returns) {
      assert.match(
          block, /needsVehicle/,
          "a resolveLotActivityFee return omits needsVehicle, so the server " +
          "will demand a VIN for a type that records no car:\n" + block);
    }
  });

  it("both callables hand the resolved rule to validation", () => {
    const pattern = new RegExp(
        "validateLotActivity\\(\\s*\\w+, \\{knownTypeIds: " +
        "fee\\.knownTypeIds,?[\\s\\S]{0,80}?\\}\\)", "g");
    const calls = source.match(pattern) || [];
    assert.equal(calls.length, 2, "expected create and update to validate");
    for (const call of calls) {
      assert.match(call, /needsVehicle: fee\.needsVehicle/);
    }
  });
});
