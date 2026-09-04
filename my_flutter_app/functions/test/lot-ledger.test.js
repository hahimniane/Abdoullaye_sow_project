"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  LOT_CUSTOM_ACTIVITY_ID,
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
      validateLotActivity({...ACTIVITY, activityTypeId: "gone"}, {knownTypeIds: ["t1"]})
        .includes("activity_type_invalid"),
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
  });

  it("the record denormalizes the label, uppercases the VIN, and drops mismatched fields", () => {
    const r = lotActivityRecord(
      {...ACTIVITY, receivedByStaffId: "drop-me"},
      {activityTypeLabel: "Dispatch", feeCents: 15000, recordedByStaffId: "s1"},
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
        {amountCents: 12000, spentAt: "2026-08-01T12:00:00", paidByStaffId: "s1"},
        {thresholdCents: 7500, hasProof: false},
      ),
      ["expense_proof_required"],
    );
    assert.deepEqual(
      validateLotExpenseEntry(
        {amountCents: 12000, spentAt: "2026-08-01T12:00:00", paidByStaffId: "s1"},
        {thresholdCents: 7500, hasProof: true},
      ),
      [],
    );
  });

  it("snapshots the proof rule at entry time", () => {
    const r = lotExpenseEntryRecord(
      {lineId: "water", month: "2026-08", amountCents: 12000, paidByStaffId: "s1", note: "jugs"},
      {recordedByStaffId: "s2", thresholdCents: 7500},
    );
    assert.equal(r.proofRequired, true);
    assert.equal(r.recordedByStaffId, "s2");
    assert.equal(r.amountCents, 12000);
  });
});
