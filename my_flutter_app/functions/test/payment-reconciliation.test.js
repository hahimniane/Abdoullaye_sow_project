const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");
const {
  COMPLETION_CLAIM_LEASE_MS,
  PAYMENT_STATES,
  PaymentReconciliationError,
  advanceReconciliationState,
  assertReconciliationMatch,
  buildReconciliationDecision,
  buildStalePendingScanPlan,
  buildStripeEventClaim,
  paymentCompletionClaim,
  paymentIntentIdempotencyKey,
  paymentStateFromStripe,
  routePaymentIntentMetadata,
  selectStalePendingPage,
  stripeEventAlreadyClaimed,
} = require("../payment_reconciliation");

const CASES = [
  {
    // A business-entered walk-up paid by hosted checkout: the record is
    // written BEFORE Stripe mints the PaymentIntent, so it has no stored
    // intent id. This exact shape was unreconcilable for both webhook and
    // sweep ("Stripe payment does not match the payment document") until an
    // empty stored id was allowed to mean "not yet bound".
    paymentType: "business_parking_entry",
    metadata: {
      reservationId: "walkup_1",
      businessId: "business_1",
    },
    path: "parkedCars/walkup_1",
    type: "business_parking_entry",
    document: {
      id: "walkup_1",
      data: {
        businessId: "business_1",
        amountDueCents: 5000,
        currency: "usd",
        paymentStatus: "pending",
        checkoutSessionId: "cs_test_1",
      },
    },
  },
  {
    // A lot-ledger activity paid through the durable /p link. Same shape as
    // the walk-up above: no customer account, the business is the identity,
    // and no PaymentIntent id is stored until the webhook binds it. This
    // type was missing from the routes entirely, so a paid job stayed
    // "Awaiting payment" forever.
    paymentType: "lot_activity",
    metadata: {
      activityId: "act_1",
      businessId: "business_1",
    },
    path: "lotActivities/act_1",
    type: "lot_activity",
    document: {
      id: "act_1",
      data: {
        businessId: "business_1",
        feeCents: 5000,
        paymentStatus: "awaiting_payment_link",
        checkoutSessionId: "cs_test_lot_1",
      },
    },
  },
  {
    paymentType: "parking_deposit",
    metadata: {
      reservationId: "park_1",
      customerUid: "user_1",
      businessId: "business_1",
    },
    path: "parkedCars/park_1",
    type: "parking",
    document: {
      id: "park_1",
      data: {
        customerUid: "user_1",
        businessId: "business_1",
        depositAmountCents: 5000,
        currency: "usd",
        stripePaymentIntentId: "pi_1",
        paymentStatus: "pending",
      },
    },
  },
  {
    paymentType: "barrel_pool_deposit",
    metadata: {
      poolId: "pool_1",
      participantUid: "user_1",
      customerUid: "user_1",
      businessId: "business_1",
    },
    path: "barrelPools/pool_1/participants/user_1",
    type: "shared_barrel_deposit",
    document: {
      id: "user_1",
      data: {
        uid: "user_1",
        businessId: "business_1",
        cardDepositAmountCents: 5000,
        currency: "usd",
        stripePaymentIntentIds: ["pi_old", "pi_1"],
        paymentStatus: "pending",
      },
    },
  },
  {
    paymentType: "barrel_pool_join",
    metadata: {
      poolId: "pool_1",
      participantUid: "user_2",
      customerUid: "user_2",
      businessId: "business_1",
    },
    path: "barrelPools/pool_1/participants/user_2",
    type: "shared_barrel_deposit",
    document: {
      id: "user_2",
      data: {
        uid: "user_2",
        businessId: "business_1",
        cardDepositAmountCents: 5000,
        currency: "usd",
        stripePaymentIntentIds: ["pi_1"],
        paymentStatus: "pending",
      },
    },
  },
  {
    paymentType: "barrel_pool_balance",
    metadata: {
      requestId: "request_1",
      poolId: "pool_1",
      participantUid: "user_1",
      customerUid: "user_1",
      businessId: "business_1",
    },
    path: "barrelPoolBalanceRequests/request_1",
    type: "shared_barrel_balance",
    document: {
      id: "request_1",
      data: {
        barrelPoolId: "pool_1",
        participantUid: "user_1",
        customerUid: "user_1",
        businessId: "business_1",
        amountCents: 5000,
        currency: "usd",
        stripePaymentIntentId: "pi_1",
        paymentStatus: "pending",
      },
    },
  },
  {
    paymentType: "barrel_shipment",
    metadata: {
      shipmentId: "shipment_1",
      customerUid: "user_1",
      businessId: "business_1",
    },
    path: "barrelShipments/shipment_1",
    type: "barrel_shipment",
    document: {
      id: "shipment_1",
      data: {
        customerUid: "user_1",
        businessId: "business_1",
        cardChargeAmountCents: 5000,
        stripePaymentIntentId: "pi_1",
        paymentStatus: "pending",
      },
    },
  },
  {
    paymentType: "barrel_order",
    metadata: {
      orderId: "order_1",
      customerUid: "user_1",
    },
    path: "barrelOrders/order_1",
    type: "barrel_order",
    document: {
      id: "order_1",
      data: {
        customerUid: "user_1",
        cardChargeAmountCents: 5000,
        currency: "usd",
        stripePaymentIntentId: "pi_1",
        paymentStatus: "pending",
      },
    },
  },
  {
    paymentType: "barrel_destination_change",
    metadata: {
      shipmentId: "shipment_change_1",
      changeRequestId: "change_1",
      customerUid: "user_1",
      businessId: "business_1",
    },
    path: "barrelShipments/shipment_change_1",
    type: "barrel_destination_change",
    document: {
      id: "shipment_change_1",
      data: {
        customerUid: "user_1",
        // The paid change may already have moved the shipment to a different
        // destination business when a later Stripe event is reconciled.
        businessId: "business_2",
        destinationAdjustmentRequestId: "change_1",
        destinationAdjustmentAmountCents: 5000,
        currency: "usd",
        destinationAdjustmentPaymentIntentId: "pi_1",
        destinationAdjustmentPaymentStatus: "pending",
      },
    },
  },
  {
    paymentType: "freight_shipment",
    metadata: {
      shipmentId: "freight_1",
      customerUid: "user_1",
      businessId: "business_1",
    },
    path: "freightShipments/freight_1",
    type: "freight",
    document: {
      id: "freight_1",
      data: {
        customerUid: "user_1",
        businessId: "business_1",
        cardChargeAmountCents: 5000,
        stripePaymentIntentId: "pi_1",
        paymentStatus: "pending",
      },
    },
  },
  {
    paymentType: "freight_settlement_adjustment",
    metadata: {
      settlementId: "freight_1_v1",
      attemptId: "balance_v1",
      shipmentId: "freight_1",
      customerUid: "user_1",
      businessId: "business_1",
    },
    path: "freightSettlements/freight_1_v1/paymentAttempts/balance_v1",
    type: "freight_settlement_adjustment",
    document: {
      id: "balance_v1",
      data: {
        settlementId: "freight_1_v1",
        shipmentId: "freight_1",
        customerUid: "user_1",
        businessId: "business_1",
        cardChargeAmountCents: 5000,
        currency: "usd",
        stripePaymentIntentId: "pi_1",
        paymentStatus: "pending",
        applicationStatus: "pending",
      },
    },
  },
  {
    paymentType: "reservation_deposit",
    metadata: {
      purchaseId: "purchase_1",
      carId: "car_1",
      buyerUid: "user_1",
      businessId: "business_1",
    },
    path: "carPurchases/purchase_1",
    type: "car_deposit",
    document: {
      id: "purchase_1",
      data: {
        carId: "car_1",
        buyerUid: "user_1",
        businessId: "business_1",
        depositAmount: 50,
        depositCurrency: "USD",
        paymentType: "reservation_deposit",
        stripePaymentIntentId: "pi_1",
        paymentStatus: "pending",
      },
    },
  },
  {
    paymentType: "full_purchase",
    metadata: {
      purchaseId: "purchase_2",
      carId: "car_2",
      buyerUid: "user_2",
      businessId: "business_1",
    },
    path: "carPurchases/purchase_2",
    type: "car_purchase",
    document: {
      id: "purchase_2",
      data: {
        carId: "car_2",
        buyerUid: "user_2",
        businessId: "business_1",
        depositAmount: 50,
        depositCurrency: "USD",
        paymentType: "full_purchase",
        stripePaymentIntentId: "pi_1",
        paymentStatus: "pending",
      },
    },
  },
  {
    paymentType: "hold_extension",
    metadata: {
      purchaseId: "purchase_1",
      extensionId: "extension_1",
      buyerUid: "user_1",
      businessId: "business_1",
    },
    path: "carPurchases/purchase_1",
    type: "hold_extension",
    document: {
      id: "purchase_1",
      data: {
        buyerUid: "user_1",
        businessId: "business_1",
        extensionExtraAmountCents: 5000,
        extensionId: "extension_1",
        depositCurrency: "USD",
        extensionPaymentIntentId: "pi_1",
        extensionPaymentStatus: "pending",
      },
    },
  },
];

function intentFor(testCase, overrides = {}) {
  return {
    id: "pi_1",
    amount: 5000,
    currency: "usd",
    status: "succeeded",
    metadata: {
      paymentType: testCase.paymentType,
      ...testCase.metadata,
    },
    ...overrides,
  };
}

describe("payment metadata routing", () => {
  for (const testCase of CASES) {
    it(`routes and validates ${testCase.paymentType}`, () => {
      const intent = intentFor(testCase);
      const target = routePaymentIntentMetadata(intent.metadata);
      assert.equal(target.paymentType, testCase.paymentType);
      assert.equal(target.type, testCase.type);
      assert.equal(target.path, testCase.path);
      assert.equal(assertReconciliationMatch({
        target,
        intent,
        document: testCase.document,
      }), true);
    });
  }

  it("still rejects a bound record whose intent id differs", () => {
    // The empty-means-unbound tolerance must not weaken the strict match:
    // a record that HAS an intent id only settles for that exact intent.
    const walkup = CASES.find(
        (item) => item.paymentType === "business_parking_entry",
    );
    const intent = intentFor(walkup);
    const target = routePaymentIntentMetadata(intent.metadata);
    assert.throws(
        () => assertReconciliationMatch({
          target,
          intent,
          document: {
            ...walkup.document,
            data: {
              ...walkup.document.data,
              stripePaymentIntentId: "pi_someone_else",
            },
          },
        }),
        (error) => error instanceof PaymentReconciliationError &&
          error.code === "document-mismatch",
    );
  });

  it("rejects unknown and incomplete metadata", () => {
    assert.throws(
        () => routePaymentIntentMetadata({paymentType: "mystery"}),
        (error) => error instanceof PaymentReconciliationError &&
          error.code === "unsupported-payment-type",
    );
    assert.throws(
        () => routePaymentIntentMetadata({paymentType: "barrel_order"}),
        (error) => error instanceof PaymentReconciliationError &&
          error.code === "invalid-metadata",
    );
  });

  it("rejects customer, amount, intent, and metadata target mismatches", () => {
    const testCase = CASES.find(
        (item) => item.paymentType === "parking_deposit",
    );
    const intent = intentFor(testCase);
    const target = routePaymentIntentMetadata(intent.metadata);
    const badDocument = {
      id: testCase.document.id,
      data: {
        ...testCase.document.data,
        customerUid: "attacker",
        depositAmountCents: 4900,
        stripePaymentIntentId: "pi_other",
      },
    };
    assert.throws(
        () => assertReconciliationMatch({
          target,
          intent,
          document: badDocument,
        }),
        (error) => {
          assert.equal(error.code, "document-mismatch");
          assert.deepEqual(
              error.details.mismatches.map((row) => row.field),
              ["customerUid", "amount", "stripePaymentIntentId"],
          );
          return true;
        },
    );
    const otherTarget = routePaymentIntentMetadata({
      ...intent.metadata,
      reservationId: "park_other",
    });
    assert.throws(
        () => assertReconciliationMatch({
          target: otherTarget,
          intent,
          document: badDocument,
        }),
        (error) => error.code === "target-mismatch",
    );
  });
});

describe("event idempotency and operation keys", () => {
  it("builds a stable Stripe-event claim and detects duplicates", () => {
    const event = {
      id: "evt_123_test",
      type: "payment_intent.succeeded",
      created: 123,
    };
    const first = buildStripeEventClaim(event);
    assert.equal(first.path, "stripeWebhookEvents/evt_123_test");
    assert.equal(first.data.status, "processing");
    assert.equal(
        stripeEventAlreadyClaimed(first.data, event.id),
        true,
    );
    assert.equal(stripeEventAlreadyClaimed(null, event.id), false);
    assert.throws(
        () => buildStripeEventClaim({...event, id: "../unsafe"}),
        (error) => error.code === "invalid-event-id",
    );
  });

  it("makes deterministic operation keys from stable domain IDs", () => {
    const one = paymentIntentIdempotencyKey({
      paymentType: "barrel_pool_deposit",
      stableDomainIds: {participantUid: "user_1", poolId: "pool_1"},
    });
    const reordered = paymentIntentIdempotencyKey({
      paymentType: "barrel_pool_deposit",
      stableDomainIds: {poolId: "pool_1", participantUid: "user_1"},
    });
    const different = paymentIntentIdempotencyKey({
      paymentType: "barrel_pool_deposit",
      stableDomainIds: {poolId: "pool_1", participantUid: "user_2"},
    });
    assert.equal(one, reordered);
    assert.notEqual(one, different);
    assert.ok(one.length < 255);
  });

  it("requires a distinct stable extension ID for each hold extension", () => {
    assert.throws(
        () => paymentIntentIdempotencyKey({
          paymentType: "hold_extension",
          stableDomainIds: {purchaseId: "purchase_1"},
        }),
        (error) => error.code === "invalid-metadata",
    );
    assert.notEqual(
        paymentIntentIdempotencyKey({
          paymentType: "hold_extension",
          stableDomainIds: {
            purchaseId: "purchase_1",
            extensionId: "extension_1",
          },
        }),
        paymentIntentIdempotencyKey({
          paymentType: "hold_extension",
          stableDomainIds: {
            purchaseId: "purchase_1",
            extensionId: "extension_2",
          },
        }),
    );
  });
});

describe("payment reconciliation state machine", () => {
  const stateCases = [
    ["payment_intent.succeeded", "succeeded", PAYMENT_STATES.SUCCEEDED],
    ["payment_intent.processing", "processing", PAYMENT_STATES.PROCESSING],
    ["payment_intent.payment_failed", "requires_payment_method",
      PAYMENT_STATES.FAILED],
    ["payment_intent.canceled", "canceled", PAYMENT_STATES.CANCELLED],
    ["charge.refunded", "succeeded", PAYMENT_STATES.REFUNDED],
    ["charge.dispute.created", "succeeded", PAYMENT_STATES.DISPUTED],
  ];
  for (const [eventType, intentStatus, expected] of stateCases) {
    it(`distinguishes ${expected}`, () => {
      assert.equal(paymentStateFromStripe({
        eventType,
        intent: {status: intentStatus},
      }), expected);
    });
  }

  it("is idempotent for repeated state and ignores older events", () => {
    assert.deepEqual(advanceReconciliationState({
      currentState: PAYMENT_STATES.PROCESSING,
      currentEventCreated: 200,
      nextState: PAYMENT_STATES.PROCESSING,
      nextEventCreated: 200,
    }), {
      changed: false,
      reason: "already-applied",
      state: PAYMENT_STATES.PROCESSING,
    });
    assert.deepEqual(advanceReconciliationState({
      currentState: PAYMENT_STATES.PROCESSING,
      currentEventCreated: 200,
      nextState: PAYMENT_STATES.FAILED,
      nextEventCreated: 100,
    }), {
      changed: false,
      reason: "stale-event",
      state: PAYMENT_STATES.PROCESSING,
    });
  });

  it("never regresses successful or terminal payments", () => {
    const succeeded = advanceReconciliationState({
      currentState: PAYMENT_STATES.SUCCEEDED,
      currentEventCreated: 100,
      nextState: PAYMENT_STATES.FAILED,
      nextEventCreated: 200,
    });
    assert.equal(succeeded.changed, false);
    assert.equal(succeeded.state, PAYMENT_STATES.SUCCEEDED);
    for (const terminal of [
      PAYMENT_STATES.CANCELLED,
      PAYMENT_STATES.REFUNDED,
      PAYMENT_STATES.DISPUTED,
    ]) {
      const decision = advanceReconciliationState({
        currentState: terminal,
        nextState: PAYMENT_STATES.SUCCEEDED,
        nextEventCreated: 300,
      });
      assert.equal(decision.changed, false);
      assert.equal(decision.state, terminal);
    }
  });

  it("builds a convergent domain patch after validation", () => {
    const testCase = CASES.find(
        (item) => item.paymentType === "parking_deposit",
    );
    const intent = intentFor(testCase);
    const target = routePaymentIntentMetadata(intent.metadata);
    const result = buildReconciliationDecision({
      target,
      intent,
      document: testCase.document,
      event: {
        id: "evt_success_1",
        type: "payment_intent.succeeded",
        created: 500,
      },
    });
    assert.equal(result.changed, true);
    assert.equal(result.patch.paymentStatus, "succeeded");
    assert.equal(result.patch.status, "reserved");
    assert.equal(result.patch.stripeLastEventId, "evt_success_1");
    const repeatedDocument = {
      ...testCase.document,
      data: {...testCase.document.data, ...result.patch},
    };
    const repeated = buildReconciliationDecision({
      target,
      intent,
      document: repeatedDocument,
      event: {
        id: "evt_success_1",
        type: "payment_intent.succeeded",
        created: 500,
      },
    });
    assert.equal(repeated.changed, false);
    assert.deepEqual(repeated.patch, {});
  });

  it("replays completion when a client wrote succeeded without reconciliation",
      () => {
        const testCase = CASES.find((row) =>
          row.paymentType === "freight_shipment");
        const intent = intentFor(testCase);
        const target = routePaymentIntentMetadata(intent.metadata);
        const result = buildReconciliationDecision({
          target,
          intent,
          document: {
            ...testCase.document,
            data: {
              ...testCase.document.data,
              paymentStatus: PAYMENT_STATES.SUCCEEDED,
              status: "pending_payment",
            },
          },
          event: {
            id: "evt_freight_recovery",
            type: "payment_intent.succeeded",
            created: 600,
          },
        });
        assert.equal(result.changed, true);
        assert.equal(result.patch.paymentStatus, PAYMENT_STATES.SUCCEEDED);
        assert.equal(result.patch.status, "pending");
        assert.equal(
            result.patch.stripeReconciliationState,
            PAYMENT_STATES.SUCCEEDED,
        );
      });
});

describe("stale pending scan pagination", () => {
  it("builds bounded scans for every payment storage shape", () => {
    const scans = buildStalePendingScanPlan({
      cutoffMillis: 1000,
      pageSize: 500,
      cursorsByScan: {
        parking: {updatedAtMillis: 1, documentId: "park_1"},
      },
    });
    assert.deepEqual(scans.map((scan) => scan.id), [
      "parking",
      "shared_barrel_deposits",
      "shared_barrel_balances",
      "barrel_shipments",
      "barrel_destination_changes",
      "barrel_orders",
      "freight_shipments",
      "freight_settlement_adjustments",
      "car_purchases",
      "hold_extensions",
      "lot_activities",
    ]);
    assert.ok(scans.every((scan) => scan.limit === 200));
    // Lot activities wait under their own state name; the scan must look
    // for it or those rows are never swept.
    const lot = scans.find((scan) => scan.id === "lot_activities");
    assert.deepEqual(lot.pendingStates, ["awaiting_payment_link"]);
    assert.deepEqual(scans[0].pendingStates, ["pending", "processing"]);
    assert.deepEqual(scans[0].orderBy, ["updatedAt", "__name__"]);
    assert.equal(scans[0].cursor.documentId, "park_1");
  });

  it("drains a backlog without skipping equal-timestamp documents", () => {
    const scan = buildStalePendingScanPlan({
      cutoffMillis: 1000,
      pageSize: 2,
    })[0];
    const rows = [
      {id: "d", paymentStatus: "processing", updatedAtMillis: 20},
      {id: "b", paymentStatus: "pending", updatedAtMillis: 10},
      {id: "future", paymentStatus: "pending", updatedAtMillis: 2000},
      {id: "paid", paymentStatus: "succeeded", updatedAtMillis: 5},
      {id: "a", paymentStatus: "pending", updatedAtMillis: 10},
      {id: "c", paymentStatus: "pending", updatedAtMillis: 20},
    ];
    const first = selectStalePendingPage({rows, scan});
    assert.deepEqual(first.items.map((row) => row.id), ["a", "b"]);
    assert.equal(first.hasMore, true);
    const second = selectStalePendingPage({
      rows,
      scan,
      cursor: first.nextCursor,
    });
    assert.deepEqual(second.items.map((row) => row.id), ["c", "d"]);
    assert.equal(second.hasMore, false);
  });
});

describe("a settled payment is completed exactly once", () => {
  const testCase = CASES.find((row) => row.paymentType === "parking_deposit");
  const intent = intentFor(testCase);
  const target = routePaymentIntentMetadata(intent.metadata);

  // What one worker's transaction does: re-read, re-decide, maybe claim.
  function transact(data, {eventId, claimId, nowMs, type}) {
    const decision = buildReconciliationDecision({
      target,
      intent,
      document: {id: testCase.document.id, data},
      event: {id: eventId, type: type || "payment_intent.succeeded",
        created: 500},
    });
    const claim = paymentCompletionClaim({
      data, decision, claimId, eventId, nowMs,
    });
    return {
      claim,
      data: claim.patch ? {...data, ...claim.patch} : data,
    };
  }

  it("lets one of three racing workers run the completion", () => {
    // Webhook, return page and stale sweep all see the same pending record.
    // Before the fix each one read "pending" and ran the completion handler.
    let data = {...testCase.document.data};
    const now = 1000000;
    const ran = [];
    for (const [eventId, claimId] of [
      ["evt_webhook_1", "claim_a"],
      ["evt_return_abc", "claim_b"],
      ["evt_reconcile_xyz", "claim_c"],
    ]) {
      const result = transact(data, {eventId, claimId, nowMs: now});
      data = result.data;
      if (result.claim.action === "complete") ran.push(eventId);
      else assert.equal(result.claim.action, "in_flight");
    }
    assert.deepEqual(ran, ["evt_webhook_1"]);
    assert.equal(data.stripeCompletionClaimId, "claim_a");
    // The claim does NOT mark the record succeeded: a crash mid-handler must
    // leave it replayable.
    assert.notEqual(data.stripeReconciliationState, PAYMENT_STATES.SUCCEEDED);
  });

  it("says already-succeeded once the winner has finished", () => {
    const finished = {
      ...testCase.document.data,
      paymentStatus: PAYMENT_STATES.SUCCEEDED,
      stripeReconciliationState: PAYMENT_STATES.SUCCEEDED,
      stripeLastEventCreated: 500,
    };
    const result = transact(finished, {
      eventId: "evt_late", claimId: "claim_late", nowMs: 5,
    });
    assert.equal(result.claim.action, "already_succeeded");
    assert.equal(result.claim.patch, null);
  });

  it("lets a new worker take over a claim whose holder died", () => {
    const claimed = {
      ...testCase.document.data,
      stripeCompletionClaimId: "claim_dead",
      stripeCompletionClaimedAtMs: 1000,
      stripeCompletionClaimEventId: "evt_dead",
    };
    const live = transact(claimed, {
      eventId: "evt_retry", claimId: "claim_new",
      nowMs: 1000 + COMPLETION_CLAIM_LEASE_MS - 1,
    });
    assert.equal(live.claim.action, "in_flight");
    const expired = transact(claimed, {
      eventId: "evt_retry", claimId: "claim_new",
      nowMs: 1000 + COMPLETION_CLAIM_LEASE_MS,
    });
    assert.equal(expired.claim.action, "complete");
    assert.equal(expired.data.stripeCompletionClaimId, "claim_new");
  });

  it("applies a non-success transition inside the transaction", () => {
    const result = transact({...testCase.document.data}, {
      eventId: "evt_failed", claimId: "claim_f", nowMs: 1,
      type: "payment_intent.payment_failed",
    });
    assert.equal(result.claim.action, "update");
    assert.equal(result.claim.patch.paymentStatus, PAYMENT_STATES.FAILED);
  });

  describe("index.js wiring", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "..", "index.js"), "utf8",
    );
    const fn = (name) => {
      const start = source.indexOf(`async function ${name}(`);
      assert.ok(start > 0, `${name} is defined`);
      return source.slice(start, source.indexOf("\n}\n", start));
    };

    it("claims in a transaction before any side effect", () => {
      const body = fn("reconcileStripePaymentEvent");
      const claimAt = body.indexOf("await claimPaymentCompletion(");
      const completeAt = body.indexOf("await runPaymentCompletion(target)");
      const accrueAt = body.indexOf("await recordSubscriptionAccrual(");
      assert.ok(claimAt > 0, "claims the completion");
      assert.ok(claimAt < completeAt, "claim precedes completion");
      assert.ok(completeAt < accrueAt, "completion precedes accrual");
      // The old shape ran side effects off a plain, non-transactional read.
      assert.doesNotMatch(body, /if \(decision\.changed\) \{\s*await run/);
      const claim = fn("claimPaymentCompletion");
      assert.match(claim, /runTransaction/);
      assert.match(claim, /transaction\.get\(ref\)/);
      assert.match(claim, /paymentCompletionClaim\(/);
    });

    it("keeps an in-flight completion out of the alarm path", () => {
      // Webhook asks Stripe to retry, the return page says pending, the
      // sweep skips without paging finance.
      const uses =
        source.match(/if \(isPaymentCompletionInFlight\(error\)\)/g) || [];
      assert.equal(uses.length, 3);
    });

    it("accrues commission once per PaymentIntent", () => {
      const body = fn("recordSubscriptionAccrual");
      assert.match(body, /runTransaction/);
      assert.match(body, /collection\("entries"\)\.doc\(plan\.entryId\)/);
      assert.match(body, /if \(entry\.exists\) return;/);
      assert.match(body, /transaction\.create\(entryRef/);
      assert.match(
          fn("reconcileStripePaymentEvent"),
          /recordSubscriptionAccrual\(ref, String\(intent\.id/,
      );
    });
  });
});
