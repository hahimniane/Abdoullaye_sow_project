const assert = require("node:assert/strict");
const {describe, it} = require("node:test");
const {
  buildBusinessCarBackfillPayload,
  buildBusinessCarBackfillResult,
  eligibleBackfillDocs,
  needsBusinessCarBackfill,
  normalizeBackfillCarIds,
} = require("../business_car_backfill");

function fakeDoc(id, data, exists = true) {
  return {
    id,
    exists,
    data: () => data,
  };
}

describe("business car backfill helpers", () => {
  it("normalizes explicit legacy car IDs safely", () => {
    const values = [" car_a ", "", "car_a", null, "car_b"];
    const longId = "x".repeat(220);

    assert.deepEqual(
        normalizeBackfillCarIds([...values, longId]),
        ["car_a", "car_b", "x".repeat(160)],
    );
  });

  it("keeps assigned cars ineligible by default", () => {
    assert.equal(needsBusinessCarBackfill({}), true);
    assert.equal(needsBusinessCarBackfill({businessId: ""}), true);
    assert.equal(needsBusinessCarBackfill({businessId: "   "}), true);
    assert.equal(needsBusinessCarBackfill({businessId: "biz_a"}), false);

    const docs = [
      fakeDoc("missing", {title: "No owner"}),
      fakeDoc("blank", {businessId: " "}),
      fakeDoc("assigned", {businessId: "biz_a"}),
      fakeDoc("deleted", {}, false),
    ];

    assert.deepEqual(
        eligibleBackfillDocs(docs).map((doc) => doc.id),
        ["missing", "blank"],
    );
  });

  it("allows explicit reassignment of selected legacy cars", () => {
    const docs = [
      fakeDoc("missing", {title: "No owner"}),
      fakeDoc("wrong", {businessId: "keren_auto_sales"}),
      fakeDoc("already", {businessId: "biz_a"}),
      fakeDoc("deleted", {}, false),
    ];

    assert.equal(
        needsBusinessCarBackfill(
            {businessId: "keren_auto_sales"},
            {allowAssigned: true, targetBusinessId: "biz_a"},
        ),
        true,
    );
    assert.equal(
        needsBusinessCarBackfill(
            {businessId: "biz_a"},
            {allowAssigned: true, targetBusinessId: "biz_a"},
        ),
        false,
    );
    assert.deepEqual(
        eligibleBackfillDocs(docs, {
          allowAssigned: true,
          targetBusinessId: "biz_a",
        }).map((doc) => doc.id),
        ["missing", "wrong"],
    );
  });

  it("builds dry-run result details for super-admin review", () => {
    const docs = [
      fakeDoc("car_1", {}),
      fakeDoc("car_2", {businessId: "biz_a"}),
      fakeDoc("car_3", {businessId: ""}),
    ];
    const eligibleDocs = eligibleBackfillDocs(docs);

    assert.deepEqual(
        buildBusinessCarBackfillResult({
          dryRun: true,
          businessId: "biz_a",
          docs,
          eligibleDocs,
        }),
        {
          success: true,
          dryRun: true,
          businessId: "biz_a",
          scanned: 3,
          eligible: 2,
          updated: 0,
          skipped: 1,
          nextAfterId: "car_3",
          carIds: ["car_1", "car_3"],
          inspected: [
            {
              id: "car_1",
              eligible: true,
              currentBusinessId: "",
              businessName: "",
              title: "",
              status: "",
            },
            {
              id: "car_2",
              eligible: false,
              currentBusinessId: "biz_a",
              businessName: "",
              title: "",
              status: "",
            },
            {
              id: "car_3",
              eligible: true,
              currentBusinessId: "",
              businessName: "",
              title: "",
              status: "",
            },
          ],
        },
    );
  });

  it("builds the merge payload from the selected business", () => {
    const updatedAt = Symbol("serverTimestamp");

    assert.deepEqual(
        buildBusinessCarBackfillPayload({
          businessId: "biz_a",
          business: {
            name: "Business A",
            status: "approved",
            profileImageUrl: "https://example.com/logo.png",
          },
          enabledServices: ["carSales"],
          updatedAt,
        }),
        {
          businessId: "biz_a",
          businessName: "Business A",
          businessStatus: "approved",
          businessProfileImageUrl: "https://example.com/logo.png",
          enabledServices: ["carSales"],
          updatedAt,
        },
    );
  });
});
