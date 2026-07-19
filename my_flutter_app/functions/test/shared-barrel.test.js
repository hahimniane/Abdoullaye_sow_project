const assert = require("node:assert/strict");
const {describe, it} = require("node:test");
const {
  buildOpenBarrelMirrorPayload,
  isValidStripeSecretKey,
  paymentSimulationEnabled,
  runtimePaymentSimulationEnabled,
  sharedBarrelBalanceCents,
  sharedBarrelDepositCents,
  sharedPoolPaymentFields,
  sharedPoolSealAccounting,
  simulatedPoolBalanceIntent,
  hasRemainingSharedPoolBalanceDue,
} = require("../shared_barrel");

function doc(id, data) {
  return {
    id,
    data: () => data,
  };
}

describe("shared barrel helpers", () => {
  it("defaults payment simulation on unless explicitly disabled", () => {
    assert.equal(paymentSimulationEnabled(undefined), true);
    assert.equal(paymentSimulationEnabled("true"), true);
    assert.equal(paymentSimulationEnabled("1"), true);
    assert.equal(paymentSimulationEnabled("false"), false);
    assert.equal(paymentSimulationEnabled("0"), false);
    assert.equal(paymentSimulationEnabled("no"), false);
    assert.equal(paymentSimulationEnabled("off"), false);
  });

  it("defaults runtime payment simulation only in emulator contexts", () => {
    assert.equal(runtimePaymentSimulationEnabled({}), false);
    assert.equal(
        runtimePaymentSimulationEnabled({FUNCTIONS_EMULATOR: "true"}),
        true,
    );
    assert.equal(
        runtimePaymentSimulationEnabled({
          FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
        }),
        true,
    );
    assert.equal(
        runtimePaymentSimulationEnabled({
          FUNCTIONS_EMULATOR: "true",
          SIMULATE_PAYMENTS: "false",
        }),
        false,
    );
    assert.equal(
        runtimePaymentSimulationEnabled({SIMULATE_PAYMENTS: "true"}),
        true,
    );
  });

  it("validates Stripe secret key shape without exposing the secret", () => {
    assert.equal(isValidStripeSecretKey("sk_test_123"), true);
    assert.equal(isValidStripeSecretKey("sk_live_123"), true);
    assert.equal(isValidStripeSecretKey(" pk_test_123 "), false);
    assert.equal(isValidStripeSecretKey("not-a-stripe-secret"), false);
    assert.equal(isValidStripeSecretKey(""), false);
    assert.equal(isValidStripeSecretKey(undefined), false);
  });

  it("charges a 30 percent deposit and leaves pickup in the balance", () => {
    assert.equal(sharedBarrelDepositCents(100, 1), 3000);
    assert.equal(sharedBarrelDepositCents(75, 2), 4500);
    assert.equal(sharedBarrelBalanceCents(100, 1, 12.5), 8250);
    assert.equal(sharedBarrelBalanceCents(75, 2, 0), 10500);
  });

  it("builds all shared deposit payment field variants", () => {
    assert.deepEqual(
        sharedPoolPaymentFields({
          poolId: "pool_a",
          uid: "customer-a",
          amountCents: 3000,
          type: "barrel_pool_deposit",
          simulatePayments: true,
        }),
        {
          amount: 30,
          amountCents: 3000,
          currency: "usd",
          paymentStatus: "succeeded",
          stripePaymentIntentIds: [
            "simulated_barrel_pool_deposit_pool_a_customer-a",
          ],
        },
    );

    assert.deepEqual(
        sharedPoolPaymentFields({
          poolId: "pool_a",
          uid: "customer-a",
          amountCents: 3000,
          type: "barrel_pool_deposit",
          simulatePayments: false,
        }),
        {
          amount: 30,
          amountCents: 3000,
          currency: "usd",
          paymentStatus: "pending",
          stripePaymentIntentIds: [],
        },
    );

    assert.equal(
        sharedPoolPaymentFields({
          poolId: "pool_a",
          uid: "customer-a",
          amountCents: 0,
          totalDepositCents: 3000,
          type: "barrel_pool_deposit",
          simulatePayments: false,
        }).paymentStatus,
        "succeeded",
    );
    assert.equal(
        sharedPoolPaymentFields({
          poolId: "pool_a",
          uid: "customer-a",
          amountCents: 0,
          totalDepositCents: 0,
          type: "barrel_pool_deposit",
        }).paymentStatus,
        "not_required",
    );
  });

  it("accounts for underfilled shares before platform commission", () => {
    assert.deepEqual(
        sharedPoolSealAccounting({
          pool: {openShares: 1, pricePerShare: 100},
          participantRows: [
            {depositAmountCents: 3000, balanceAmountCents: 7000},
            {depositAmountCents: 3000, balanceAmountCents: 7500},
          ],
          shipUnderfilled: true,
          commissionRate: 0.1,
        }),
        {
          participantDepositCents: 6000,
          participantBalanceCents: 14500,
          underfilledShares: 1,
          underfilledAmountCents: 10000,
          grossAmountCents: 30500,
          platformCommissionCents: 3050,
          businessPayoutCents: 27450,
        },
    );
  });

  it("tracks remaining balance due across accepted participants", () => {
    const participants = [
      doc("owner", {balancePaymentStatus: "balance_due"}),
      doc("joiner", {paymentStatus: "succeeded"}),
      doc("late", {paymentStatus: "balance_due"}),
    ];

    assert.equal(
        hasRemainingSharedPoolBalanceDue(participants, "owner"),
        true,
    );
    assert.equal(
        hasRemainingSharedPoolBalanceDue(participants, "late"),
        true,
    );
    assert.equal(
        hasRemainingSharedPoolBalanceDue(
            [
              doc("owner", {balancePaymentStatus: "balance_due"}),
              doc("joiner", {paymentStatus: "succeeded"}),
            ],
            "owner",
        ),
        false,
    );
  });

  it("names simulated balance intents predictably for audit trails", () => {
    assert.equal(
        simulatedPoolBalanceIntent("pool_a", "customer-a"),
        "simulated_barrel_pool_balance_pool_a_customer-a",
    );
  });

  it("builds a PII-free open barrel mirror payload", () => {
    const now = {sentinel: "serverTimestamp"};
    const payload = buildOpenBarrelMirrorPayload({
      poolId: "pool_a",
      now,
      pool: {
        status: "partially_filled",
        businessId: "business_a",
        businessName: "Keren",
        destinationCountryId: "sn",
        destinationCountryName: "Senegal",
        openShares: 1,
        totalShares: 2,
        pricePerShare: 120,
        depositPerShare: 36,
        currency: "usd",
        shipMode: "sea",
        joinDeadline: {seconds: 200},
        origin: "dropOff",
        holderRole: "business",
        approvalMode: "approval",
        createdAt: {seconds: 100},
        createdByUid: "owner_uid",
        senderName: "Private Sender",
        senderAddress: "123 Private Street",
        receiverName: "Private Receiver",
        receiverPhone: "+15555550100",
        customerEmail: "private@example.com",
        customerPhone: "+15555550101",
        publicParticipants: {
          owner_uid: {senderName: "Private Sender"},
        },
        participants: {
          joiner_uid: {receiverPhone: "+15555550102"},
        },
      },
    });

    assert.deepEqual(Object.keys(payload).sort(), [
      "approvalMode",
      "businessId",
      "businessName",
      "createdAt",
      "currency",
      "depositPerShare",
      "destinationCountryId",
      "destinationCountryName",
      "holderRole",
      "joinDeadline",
      "origin",
      "poolId",
      "pricePerShare",
      "sharesAvailable",
      "shipMode",
      "status",
      "totalShares",
      "updatedAt",
    ].sort());
    assert.equal(payload.poolId, "pool_a");
    assert.equal(payload.sharesAvailable, 1);
    assert.equal(payload.status, "open");
    assert.deepEqual(payload.updatedAt, now);
    assert.equal(Object.hasOwn(payload, "senderName"), false);
    assert.equal(Object.hasOwn(payload, "senderAddress"), false);
    assert.equal(Object.hasOwn(payload, "receiverName"), false);
    assert.equal(Object.hasOwn(payload, "receiverPhone"), false);
    assert.equal(Object.hasOwn(payload, "customerEmail"), false);
    assert.equal(Object.hasOwn(payload, "publicParticipants"), false);
    assert.equal(Object.hasOwn(payload, "participants"), false);
  });

  it("does not mirror terminal or full shared barrel pools", () => {
    assert.equal(
        buildOpenBarrelMirrorPayload({
          poolId: "pool_a",
          pool: {status: "sealed", openShares: 1},
          now: {},
        }),
        null,
    );
    assert.equal(
        buildOpenBarrelMirrorPayload({
          poolId: "pool_a",
          pool: {status: "open", openShares: 0},
          now: {},
        }),
        null,
    );
  });
});
