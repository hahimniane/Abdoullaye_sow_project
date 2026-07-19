const assert = require("node:assert/strict");
const {describe, it} = require("node:test");
const {
  buildE2EPlatformAdminProfile,
  buildFreightBalanceFixture,
  FreightSettlementStatus,
} = require("../scripts/e2e-seed-fixtures");

describe("E2E seed fixtures", () => {
  it("grants the seeded platform admin an explicit super-admin role", () => {
    assert.deepEqual(buildE2EPlatformAdminProfile(), {
      role: "admin",
      platformAdmin: true,
      adminRole: "superAdmin",
      fullName: "E2E Platform Admin",
      email: "e2e.admin@laawol.test",
    });
  });

  it("seeds freight with a payable $25 balance", () => {
    const now = {fixtureTimestamp: true};
    const fixture = buildFreightBalanceFixture({
      now,
      businessId: "e2e-logistics",
    });

    assert.equal(
        fixture.settlementPath,
        "freightSettlements/freight-e2e-balance_v1",
    );
    assert.equal(
        fixture.shipmentUpdate.priceSettlementStatus,
        FreightSettlementStatus.BALANCE_DUE,
    );
    assert.equal(fixture.shipmentUpdate.status, "awaiting_balance_payment");
    assert.equal(fixture.shipmentUpdate.weightVerificationStatus, "confirmed");
    assert.equal(fixture.shipmentUpdate.balanceDueCents, 2500);
    assert.equal(fixture.settlement.balanceDueCents, 2500);
    assert.equal(fixture.settlement.finalTotalCents, 15000);
    assert.equal(fixture.settlement.shipmentId, "freight-e2e-balance");
    assert.equal(
        fixture.shipmentUpdate.settlementId,
        fixture.settlement.settlementId,
    );
    assert.equal(fixture.settlement.weightConfirmedAt, now);
  });
});
