const assert = require("node:assert/strict");
const test = require("node:test");
const {
  computeAggregate,
  normalizeOrderStatus,
  reviewDocId,
  statusFieldsByCollection,
  validateFlagSubmission,
  validateReviewSubmission,
} = require("../business_review");

test(
    "computeAggregate damps a single 5-star review toward the prior",
    () => {
      const single = computeAggregate({reviewCount: 1, reviewRatingSum: 5});
      assert.equal(single.reviewAverage, 5);
      assert.ok(
          single.reviewWeightedScore < 4,
          "one review should not hit 5",
      );

      const established = computeAggregate({
        reviewCount: 500,
        reviewRatingSum: 2100,
      });
      assert.equal(established.reviewAverage, 4.2);
      assert.ok(
          established.reviewWeightedScore > single.reviewWeightedScore,
          "500 reviews averaging 4.2 must outrank a single 5-star review",
      );
      assert.ok(
          Math.abs(established.reviewWeightedScore - 4.2) < 0.05,
          "high volume should converge close to the true average",
      );
    },
);

test(
    "computeAggregate with zero reviews returns the platform prior mean",
    () => {
      const aggregate = computeAggregate({
        reviewCount: 0,
        reviewRatingSum: 0,
      });
      assert.equal(aggregate.reviewAverage, 0);
      assert.equal(aggregate.reviewWeightedScore, 3.8);
    },
);

test(
    "validateReviewSubmission accepts integer ratings 1-5 with a comment",
    () => {
      const result = validateReviewSubmission({
        rating: 4,
        comment: "Great service",
      });
      assert.deepEqual(result.missing, []);
      assert.equal(result.rating, 4);
      assert.equal(result.comment, "Great service");
    },
);

test(
    "validateReviewSubmission rejects out-of-range/fractional/missing input",
    () => {
      const cases = [
        {rating: 0, comment: "x"},
        {rating: 6, comment: "x"},
        {rating: 3.5, comment: "x"},
        {rating: 4, comment: "  "},
      ];
      for (const submission of cases) {
        assert.ok(
            validateReviewSubmission(submission).missing.length > 0,
            JSON.stringify(submission),
        );
      }
    },
);

test("validateFlagSubmission requires a non-empty reason", () => {
  const valid = validateFlagSubmission({reason: "Fake review"});
  assert.deepEqual(valid.missing, []);
  assert.ok(validateFlagSubmission({reason: ""}).missing.length > 0);
});

test("reviewDocId is deterministic from the source order reference", () => {
  assert.equal(reviewDocId("carPurchases", "abc123"), "carPurchases_abc123");
});

// This mirrors CustomerOrder.normalizeStatus in customer_order.dart 1:1 — if
// that switch ever changes, this test (and this function) must change too.
test("normalizeOrderStatus mirrors the Dart client's normalization", () => {
  const cases = {
    in_transit: "inTransit",
    completed: "completed",
    sold: "completed",
    paid: "completed",
    succeeded: "completed",
    cancelled: "cancelled",
    canceled: "cancelled",
    refunded: "refunded",
    refund_pending: "refunded",
    active: "active",
    reserved: "active",
    hold: "active",
    "": "pending",
    unknown_status: "pending",
  };
  for (const [raw, expected] of Object.entries(cases)) {
    assert.equal(normalizeOrderStatus(raw), expected, `raw status "${raw}"`);
  }
});

test(
    "statusFieldsByCollection matches each CustomerOrder.fromXxx factory",
    () => {
      assert.equal(
          statusFieldsByCollection({purchaseStatus: "sold"}, "carPurchases"),
          "sold",
      );
      assert.equal(
          statusFieldsByCollection({paymentStatus: "paid"}, "carPurchases"),
          "paid",
      );
      assert.equal(
          statusFieldsByCollection({status: "completed"}, "parkedCars"),
          "completed",
      );
      assert.equal(
          statusFieldsByCollection({paymentStatus: "paid"}, "parkedCars"),
          "paid",
      );
      assert.equal(
          statusFieldsByCollection(
              {status: "completed"},
              "transportRequests",
          ),
          "completed",
      );
      assert.equal(
          statusFieldsByCollection(
              {status: "completed"},
              "barrelShipments",
          ),
          "completed",
      );
      assert.equal(
          statusFieldsByCollection(
              {status: "completed"},
              "freightShipments",
          ),
          "completed",
      );
    },
);
