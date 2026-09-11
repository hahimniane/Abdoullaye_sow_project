const assert = require("node:assert/strict");
const {describe, it} = require("node:test");
const {businessParkingPartialPaymentPlan} =
  require("../business_parking_entry");

// A twenty-day stay can be paid five or ten days at a time. Staff give days or
// dollars; the running total moves, and a fixed stay flips to fully paid only
// once its payments reach its total.
describe("a part payment against parking", () => {
  const fixed = {
    source: "business", paymentMethod: "direct", status: "reserved",
    paymentStatus: "awaiting_direct_payment",
    parkingEndDate: {seconds: 1}, // a leave date = fixed total
    amountDueCents: 24000, dailyRateCents: 1200,
  };

  it("prices a number of days from the car's own daily rate", () => {
    const plan = businessParkingPartialPaymentPlan(
        {entry: fixed, days: 5, dailyRateCents: 1200});
    assert.equal(plan.ok, true);
    assert.equal(plan.appliedCents, 6000); // 5 x $12
    assert.equal(plan.newPaidCents, 6000);
    assert.equal(plan.fullyCovered, false); // 60 of 240
  });

  it("accepts a dollar amount directly", () => {
    const plan = businessParkingPartialPaymentPlan(
        {entry: fixed, amountCents: 5000, dailyRateCents: 1200});
    assert.equal(plan.appliedCents, 5000);
  });

  it("adds to what was paid, and covers fully at the total", () => {
    const half = {...fixed, amountPaidCents: 18000};
    const plan = businessParkingPartialPaymentPlan(
        {entry: half, days: 5, dailyRateCents: 1200});
    assert.equal(plan.newPaidCents, 24000);
    assert.equal(plan.fullyCovered, true);
  });

  it("clamps an overpayment on a fixed stay to the balance", () => {
    const almost = {...fixed, amountPaidCents: 22000};
    const plan = businessParkingPartialPaymentPlan(
        {entry: almost, days: 10, dailyRateCents: 1200}); // would be $120
    assert.equal(plan.appliedCents, 2000); // only $20 was owed
    assert.equal(plan.fullyCovered, true);
  });

  it("an open-ended stay is never fully covered by a part payment", () => {
    const open = {
      source: "business", paymentMethod: "direct", status: "reserved",
      paymentStatus: "awaiting_direct_payment", dailyRateCents: 1200,
    };
    const plan = businessParkingPartialPaymentPlan(
        {entry: open, days: 5, dailyRateCents: 1200});
    assert.equal(plan.ok, true);
    assert.equal(plan.appliedCents, 6000);
    assert.equal(plan.openEnded, true);
    assert.equal(plan.fullyCovered, false); // it keeps accruing
  });

  it("refuses days when the car has no daily rate", () => {
    const plan = businessParkingPartialPaymentPlan(
        {entry: {...fixed, dailyRateCents: 0}, days: 5, dailyRateCents: 0});
    assert.equal(plan.ok, false);
    assert.equal(plan.reason, "no_daily_rate");
  });

  it("refuses when neither days nor an amount is given", () => {
    assert.equal(
        businessParkingPartialPaymentPlan({entry: fixed, dailyRateCents: 1200})
            .reason, "no_amount");
  });

  it("refuses a link entry, a cancelled one, and one already paid", () => {
    assert.equal(businessParkingPartialPaymentPlan(
        {entry: {...fixed, paymentMethod: "payment_link"}, amountCents: 1000})
        .reason, "payment_link_is_stripe_owned");
    assert.equal(businessParkingPartialPaymentPlan(
        {entry: {...fixed, status: "cancelled"}, amountCents: 1000})
        .reason, "entry_cancelled");
    assert.equal(businessParkingPartialPaymentPlan(
        {entry: {...fixed, paymentStatus: "paid"}, amountCents: 1000})
        .reason, "already_paid");
  });

  it("refuses junk instead of crashing", () => {
    for (const entry of [undefined, null, "", 5, {}, []]) {
      assert.equal(
          businessParkingPartialPaymentPlan({entry, amountCents: 100}).ok,
          false);
    }
  });
});
