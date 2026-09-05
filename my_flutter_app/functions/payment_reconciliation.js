const crypto = require("node:crypto");

const PAYMENT_STATES = Object.freeze({
  PENDING: "pending",
  PROCESSING: "processing",
  FAILED: "failed",
  CANCELLED: "cancelled",
  SUCCEEDED: "succeeded",
  REFUNDED: "refunded",
  DISPUTED: "disputed",
});

const PAYMENT_ROUTES = Object.freeze({
  parking_deposit: Object.freeze({
    kind: "parking",
    identityKeys: ["reservationId"],
    collection: "parkedCars",
    documentIdKey: "reservationId",
    customerMetadataKey: "customerUid",
    customerField: "customerUid",
    businessField: "businessId",
    amountCentsField: "depositAmountCents",
    currencyField: "currency",
    intentField: "stripePaymentIntentId",
    paymentStatusField: "paymentStatus",
    domainStatusField: "status",
    succeededDomainStatus: "reserved",
    cancelledDomainStatus: "cancelled",
    operationKeys: ["reservationId"],
  }),
  // A business-entered walk-up car whose customer was sent a Stripe payment
  // link (docs/PLAN-2026-08-backlog.md item 5). No customer account exists
  // for it - deliberately - so the business that entered the car is the
  // identity every Stripe event for it is checked against.
  business_parking_entry: Object.freeze({
    kind: "business_parking_entry",
    identityKeys: ["reservationId"],
    collection: "parkedCars",
    documentIdKey: "reservationId",
    customerMetadataKey: "businessId",
    customerField: "businessId",
    businessField: "businessId",
    amountCentsField: "amountDueCents",
    currencyField: "currency",
    intentField: "stripePaymentIntentId",
    paymentStatusField: "paymentStatus",
    domainStatusField: "status",
    succeededDomainStatus: "reserved",
    cancelledDomainStatus: "cancelled",
    operationKeys: ["reservationId"],
  }),
  // A lot-ledger activity (a job the lot billed for) paid through the durable
  // /p link. Like a business parking entry it has no customer account: the
  // business that recorded the job is the identity every Stripe event is
  // checked against. There is no domain status to flip - paymentStatus is
  // the whole story for these rows.
  lot_activity: Object.freeze({
    kind: "lot_activity",
    identityKeys: ["activityId"],
    collection: "lotActivities",
    documentIdKey: "activityId",
    customerMetadataKey: "businessId",
    customerField: "businessId",
    businessField: "businessId",
    amountCentsField: "feeCents",
    currencyField: "currency",
    defaultCurrency: "usd",
    intentField: "stripePaymentIntentId",
    paymentStatusField: "paymentStatus",
    operationKeys: ["activityId"],
  }),
  barrel_pool_deposit: Object.freeze({
    kind: "shared_barrel_deposit",
    identityKeys: ["poolId", "participantUid"],
    collection: "barrelPools",
    subcollection: "participants",
    documentIdKey: "participantUid",
    parentIdKey: "poolId",
    customerMetadataKey: "customerUid",
    customerField: "uid",
    businessField: "businessId",
    amountCentsField: "cardDepositAmountCents",
    currencyField: "currency",
    intentArrayField: "stripePaymentIntentIds",
    paymentStatusField: "paymentStatus",
    operationKeys: ["poolId", "participantUid"],
  }),
  barrel_pool_join: Object.freeze({
    kind: "shared_barrel_deposit",
    identityKeys: ["poolId", "participantUid"],
    collection: "barrelPools",
    subcollection: "participants",
    documentIdKey: "participantUid",
    parentIdKey: "poolId",
    customerMetadataKey: "customerUid",
    customerField: "uid",
    businessField: "businessId",
    amountCentsField: "cardDepositAmountCents",
    currencyField: "currency",
    intentArrayField: "stripePaymentIntentIds",
    paymentStatusField: "paymentStatus",
    operationKeys: ["poolId", "participantUid"],
  }),
  barrel_pool_balance: Object.freeze({
    kind: "shared_barrel_balance",
    identityKeys: ["requestId", "poolId", "participantUid"],
    collection: "barrelPoolBalanceRequests",
    documentIdKey: "requestId",
    customerMetadataKey: "customerUid",
    customerField: "customerUid",
    businessField: "businessId",
    amountCentsField: "amountCents",
    currencyField: "currency",
    intentField: "stripePaymentIntentId",
    paymentStatusField: "paymentStatus",
    domainStatusField: "status",
    succeededDomainStatus: "paid",
    cancelledDomainStatus: "cancelled",
    documentMetadataFields: Object.freeze({
      poolId: "barrelPoolId",
      participantUid: "participantUid",
    }),
    operationKeys: ["requestId"],
  }),
  barrel_shipment: Object.freeze({
    kind: "barrel_shipment",
    identityKeys: ["shipmentId"],
    collection: "barrelShipments",
    documentIdKey: "shipmentId",
    customerMetadataKey: "customerUid",
    customerField: "customerUid",
    businessField: "businessId",
    amountCentsField: "cardChargeAmountCents",
    currencyField: "currency",
    defaultCurrency: "usd",
    intentField: "stripePaymentIntentId",
    paymentStatusField: "paymentStatus",
    domainStatusField: "status",
    succeededDomainStatus: "pending",
    cancelledDomainStatus: "cancelled",
    operationKeys: ["shipmentId"],
  }),
  barrel_destination_change: Object.freeze({
    kind: "barrel_destination_change",
    identityKeys: ["shipmentId", "changeRequestId"],
    collection: "barrelShipments",
    documentIdKey: "shipmentId",
    customerMetadataKey: "customerUid",
    customerField: "customerUid",
    amountCentsField: "destinationAdjustmentAmountCents",
    currencyField: "currency",
    defaultCurrency: "usd",
    intentField: "destinationAdjustmentPaymentIntentId",
    paymentStatusField: "destinationAdjustmentPaymentStatus",
    documentMetadataFields: Object.freeze({
      changeRequestId: "destinationAdjustmentRequestId",
    }),
    operationKeys: ["shipmentId", "changeRequestId"],
  }),
  barrel_order: Object.freeze({
    kind: "barrel_order",
    identityKeys: ["orderId"],
    collection: "barrelOrders",
    documentIdKey: "orderId",
    customerMetadataKey: "customerUid",
    customerField: "customerUid",
    amountCentsField: "cardChargeAmountCents",
    currencyField: "currency",
    intentField: "stripePaymentIntentId",
    paymentStatusField: "paymentStatus",
    domainStatusField: "status",
    succeededDomainStatus: "pending",
    cancelledDomainStatus: "cancelled",
    operationKeys: ["orderId"],
  }),
  transport_job: Object.freeze({
    kind: "transport_job",
    identityKeys: ["requestId"],
    collection: "transportRequests",
    documentIdKey: "requestId",
    customerMetadataKey: "customerUid",
    customerField: "customerUid",
    businessField: "businessId",
    amountCentsField: "totalCents",
    currencyField: "currency",
    intentField: "stripePaymentIntentId",
    paymentStatusField: "paymentStatus",
    domainStatusField: "status",
    succeededDomainStatus: "pending",
    cancelledDomainStatus: "cancelled",
    operationKeys: ["requestId"],
  }),
  freight_shipment: Object.freeze({
    kind: "freight",
    identityKeys: ["shipmentId"],
    collection: "freightShipments",
    documentIdKey: "shipmentId",
    customerMetadataKey: "customerUid",
    customerField: "customerUid",
    businessField: "businessId",
    amountCentsField: "cardChargeAmountCents",
    currencyField: "currency",
    defaultCurrency: "usd",
    intentField: "stripePaymentIntentId",
    paymentStatusField: "paymentStatus",
    domainStatusField: "status",
    succeededDomainStatus: "pending",
    cancelledDomainStatus: "cancelled",
    operationKeys: ["shipmentId"],
  }),
  freight_settlement_adjustment: Object.freeze({
    kind: "freight_settlement_adjustment",
    identityKeys: ["settlementId", "attemptId", "shipmentId"],
    collection: "freightSettlements",
    subcollection: "paymentAttempts",
    documentIdKey: "attemptId",
    parentIdKey: "settlementId",
    customerMetadataKey: "customerUid",
    customerField: "customerUid",
    businessField: "businessId",
    amountCentsField: "cardChargeAmountCents",
    currencyField: "currency",
    defaultCurrency: "usd",
    intentField: "stripePaymentIntentId",
    paymentStatusField: "paymentStatus",
    domainStatusField: "applicationStatus",
    succeededDomainStatus: "applied",
    cancelledDomainStatus: "pending",
    documentMetadataFields: Object.freeze({shipmentId: "shipmentId"}),
    operationKeys: ["settlementId", "attemptId"],
  }),
  reservation_deposit: Object.freeze({
    kind: "car_deposit",
    identityKeys: ["purchaseId", "carId"],
    collection: "carPurchases",
    documentIdKey: "purchaseId",
    customerMetadataKey: "buyerUid",
    customerField: "buyerUid",
    businessField: "businessId",
    amountDollarsField: "depositAmount",
    currencyField: "depositCurrency",
    intentField: "stripePaymentIntentId",
    paymentStatusField: "paymentStatus",
    domainStatusField: "purchaseStatus",
    succeededDomainStatus: "reserved",
    cancelledDomainStatus: "cancelled",
    documentMetadataFields: Object.freeze({carId: "carId"}),
    operationKeys: ["purchaseId"],
  }),
  full_purchase: Object.freeze({
    kind: "car_purchase",
    identityKeys: ["purchaseId", "carId"],
    collection: "carPurchases",
    documentIdKey: "purchaseId",
    customerMetadataKey: "buyerUid",
    customerField: "buyerUid",
    businessField: "businessId",
    amountDollarsField: "depositAmount",
    currencyField: "depositCurrency",
    intentField: "stripePaymentIntentId",
    paymentStatusField: "paymentStatus",
    domainStatusField: "purchaseStatus",
    succeededDomainStatus: "completed",
    cancelledDomainStatus: "cancelled",
    documentMetadataFields: Object.freeze({carId: "carId"}),
    operationKeys: ["purchaseId"],
  }),
  hold_extension: Object.freeze({
    kind: "hold_extension",
    identityKeys: ["purchaseId", "extensionId"],
    collection: "carPurchases",
    documentIdKey: "purchaseId",
    customerMetadataKey: "buyerUid",
    customerField: "buyerUid",
    businessField: "businessId",
    amountCentsField: "extensionExtraAmountCents",
    currencyField: "depositCurrency",
    intentField: "extensionPaymentIntentId",
    paymentStatusField: "extensionPaymentStatus",
    domainStatusField: "extensionRequestStatus",
    succeededDomainStatus: "paid",
    documentMetadataFields: Object.freeze({extensionId: "extensionId"}),
    operationKeys: ["purchaseId", "extensionId"],
  }),
});

const STALE_SCAN_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "parking",
    collection: "parkedCars",
    statusField: "paymentStatus",
  }),
  Object.freeze({
    id: "shared_barrel_deposits",
    collectionGroup: "participants",
    statusField: "paymentStatus",
  }),
  Object.freeze({
    id: "shared_barrel_balances",
    collection: "barrelPoolBalanceRequests",
    statusField: "paymentStatus",
  }),
  Object.freeze({
    id: "barrel_shipments",
    collection: "barrelShipments",
    statusField: "paymentStatus",
  }),
  Object.freeze({
    id: "barrel_destination_changes",
    collection: "barrelShipments",
    statusField: "destinationAdjustmentPaymentStatus",
    intentField: "destinationAdjustmentPaymentIntentId",
  }),
  Object.freeze({
    id: "barrel_orders",
    collection: "barrelOrders",
    statusField: "paymentStatus",
  }),
  Object.freeze({
    id: "freight_shipments",
    collection: "freightShipments",
    statusField: "paymentStatus",
  }),
  Object.freeze({
    id: "freight_settlement_adjustments",
    collectionGroup: "paymentAttempts",
    statusField: "paymentStatus",
  }),
  Object.freeze({
    id: "car_purchases",
    collection: "carPurchases",
    statusField: "paymentStatus",
  }),
  Object.freeze({
    id: "hold_extensions",
    collection: "carPurchases",
    statusField: "extensionPaymentStatus",
  }),
  // Lot activities wait in their own state name, so the scan must be told
  // which value means "still unpaid" or it would never look at them.
  Object.freeze({
    id: "lot_activities",
    collection: "lotActivities",
    statusField: "paymentStatus",
    pendingStates: ["awaiting_payment_link"],
  }),
]);

class PaymentReconciliationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "PaymentReconciliationError";
    this.code = code;
    this.details = details;
  }
}

function clean(value) {
  return String(value === undefined || value === null ? "" : value).trim();
}

function required(value, field) {
  const normalized = clean(value);
  if (!normalized) {
    throw new PaymentReconciliationError(
        "invalid-metadata",
        `Stripe metadata is missing ${field}`,
        {field},
    );
  }
  return normalized;
}

function targetPath(config, identity) {
  if (config.subcollection) {
    return `${config.collection}/${identity[config.parentIdKey]}/` +
      `${config.subcollection}/${identity[config.documentIdKey]}`;
  }
  return `${config.collection}/${identity[config.documentIdKey]}`;
}

function routePaymentIntentMetadata(metadata) {
  const source = metadata && typeof metadata === "object" ? metadata : {};
  const paymentType = required(source.paymentType, "paymentType");
  const config = PAYMENT_ROUTES[paymentType];
  if (!config) {
    throw new PaymentReconciliationError(
        "unsupported-payment-type",
        `Unsupported Stripe payment type: ${paymentType}`,
        {paymentType},
    );
  }
  const identity = {};
  for (const key of config.identityKeys) {
    identity[key] = required(source[key], key);
  }
  const customerKey = config.customerMetadataKey;
  const customerUid = required(source[customerKey], customerKey);
  const businessId = clean(source.businessId);
  return Object.freeze({
    type: config.kind,
    paymentType,
    path: targetPath(config, identity),
    documentId: identity[config.documentIdKey],
    identity: Object.freeze(identity),
    customerUid,
    businessId,
    config,
  });
}

function expectedAmountCents(config, data) {
  if (config.amountCentsField) {
    return Number(data[config.amountCentsField]);
  }
  return Math.round(Number(data[config.amountDollarsField]) * 100);
}

function pushMismatch(mismatches, field, expected, actual) {
  if (clean(expected) !== clean(actual)) {
    mismatches.push({field, expected, actual});
  }
}

function reconciliationMismatches({target, intent, document}) {
  const data = document?.data || {};
  const config = target.config;
  const mismatches = [];
  pushMismatch(
      mismatches,
      "documentId",
      target.documentId,
      document?.id,
  );
  pushMismatch(
      mismatches,
      config.customerField,
      target.customerUid,
      data[config.customerField],
  );
  if (target.businessId && config.businessField) {
    pushMismatch(
        mismatches,
        "businessId",
        target.businessId,
        data[config.businessField],
    );
  }
  for (const [metadataKey, field] of Object.entries(
      config.documentMetadataFields || {},
  )) {
    pushMismatch(
        mismatches,
        metadataKey,
        target.identity[metadataKey],
        data[field],
    );
  }
  if (data.paymentType) {
    pushMismatch(
        mismatches,
        "paymentType",
        target.paymentType,
        data.paymentType,
    );
  }
  const expectedAmount = expectedAmountCents(config, data);
  if (!Number.isSafeInteger(expectedAmount) || expectedAmount < 0 ||
      expectedAmount !== Number(intent?.amount)) {
    mismatches.push({
      field: "amount",
      expected: expectedAmount,
      actual: intent?.amount,
    });
  }
  const expectedCurrency = clean(
      data[config.currencyField] || config.defaultCurrency,
  ).toLowerCase();
  if (!expectedCurrency || expectedCurrency !== clean(intent?.currency)
      .toLowerCase()) {
    mismatches.push({
      field: "currency",
      expected: expectedCurrency,
      actual: intent?.currency,
    });
  }
  const intentId = clean(intent?.id);
  if (config.intentArrayField) {
    const ids = Array.isArray(data[config.intentArrayField]) ?
      data[config.intentArrayField].map(clean) : [];
    if (!ids.includes(intentId)) {
      mismatches.push({
        field: config.intentArrayField,
        expected: intentId,
        actual: ids,
      });
    }
  } else if (clean(data[config.intentField])) {
    // A stored id must match exactly. But an EMPTY stored id means the
    // intent was never bound to the document - hosted Checkout mints the
    // PaymentIntent only when the customer opens the page, after the record
    // was written - and that is "not yet bound", not "different payment".
    // Treating it as a mismatch made every link-paid parking entry
    // unreconcilable by webhook and sweep alike. Identity is still enforced:
    // the intent's own signed metadata routed to exactly this document, and
    // amount and currency must match above.
    pushMismatch(
        mismatches,
        config.intentField,
        intentId,
        data[config.intentField],
    );
  }
  return mismatches;
}

function assertReconciliationMatch(input) {
  const metadataTarget = routePaymentIntentMetadata(input.intent?.metadata);
  if (metadataTarget.path !== input.target.path ||
      metadataTarget.paymentType !== input.target.paymentType) {
    throw new PaymentReconciliationError(
        "target-mismatch",
        "Loaded payment target does not match Stripe metadata",
        {expected: metadataTarget.path, actual: input.target.path},
    );
  }
  const mismatches = reconciliationMismatches(input);
  if (mismatches.length > 0) {
    throw new PaymentReconciliationError(
        "document-mismatch",
        "Stripe payment does not match the payment document",
        {mismatches},
    );
  }
  return true;
}

function paymentStateFromStripe({eventType, intent}) {
  const type = clean(eventType);
  if (type.startsWith("charge.dispute.")) {
    return PAYMENT_STATES.DISPUTED;
  }
  if (type === "charge.refunded" || type.startsWith("refund.")) {
    return PAYMENT_STATES.REFUNDED;
  }
  const eventStates = {
    "payment_intent.succeeded": PAYMENT_STATES.SUCCEEDED,
    // A manual-capture intent never emits payment_intent.succeeded at
    // confirmation - this is its "customer has paid" event. The money is
    // reserved on the card and capture cannot fail the way a fresh charge
    // can, so it counts as success (see payment_hold.js).
    "payment_intent.amount_capturable_updated": PAYMENT_STATES.SUCCEEDED,
    "payment_intent.processing": PAYMENT_STATES.PROCESSING,
    "payment_intent.payment_failed": PAYMENT_STATES.FAILED,
    "payment_intent.canceled": PAYMENT_STATES.CANCELLED,
  };
  if (eventStates[type]) return eventStates[type];
  const statusStates = {
    succeeded: PAYMENT_STATES.SUCCEEDED,
    processing: PAYMENT_STATES.PROCESSING,
    canceled: PAYMENT_STATES.CANCELLED,
    requires_payment_method: PAYMENT_STATES.FAILED,
    requires_action: PAYMENT_STATES.PROCESSING,
    requires_confirmation: PAYMENT_STATES.PROCESSING,
    // Held, not merely in flight: the bank has reserved the funds. Mapping
    // this to PROCESSING (as before 2026-08-10) left every held order
    // permanently pending, because a hold never becomes "succeeded" on its
    // own - capture is OUR move, made later by the hold scheduler.
    requires_capture: PAYMENT_STATES.SUCCEEDED,
  };
  return statusStates[clean(intent?.status)] || PAYMENT_STATES.PENDING;
}

function normalizeEventCreated(value) {
  const number = Number(value || 0);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function advanceReconciliationState({
  currentState = PAYMENT_STATES.PENDING,
  currentEventCreated = 0,
  nextState,
  nextEventCreated = 0,
}) {
  const terminal = new Set([
    PAYMENT_STATES.CANCELLED,
    PAYMENT_STATES.REFUNDED,
    PAYMENT_STATES.DISPUTED,
  ]);
  const currentTime = normalizeEventCreated(currentEventCreated);
  const nextTime = normalizeEventCreated(nextEventCreated);
  if (!Object.values(PAYMENT_STATES).includes(nextState)) {
    throw new PaymentReconciliationError(
        "invalid-state",
        `Unsupported reconciliation state: ${nextState}`,
    );
  }
  if (nextState === currentState) {
    return {changed: false, reason: "already-applied", state: currentState};
  }
  if (terminal.has(currentState)) {
    return {changed: false, reason: "terminal", state: currentState};
  }
  if (currentState === PAYMENT_STATES.SUCCEEDED && ![
    PAYMENT_STATES.REFUNDED,
    PAYMENT_STATES.DISPUTED,
  ].includes(nextState)) {
    return {changed: false, reason: "succeeded", state: currentState};
  }
  if (nextTime < currentTime) {
    return {changed: false, reason: "stale-event", state: currentState};
  }
  return {
    changed: true,
    reason: "advanced",
    state: nextState,
    eventCreated: nextTime,
  };
}

function buildReconciliationPatch({target, decision, eventId}) {
  if (!decision.changed) return {};
  const config = target.config;
  const patch = {
    [config.paymentStatusField]: decision.state,
    stripeReconciliationState: decision.state,
    stripeLastEventId: required(eventId, "eventId"),
    stripeLastEventCreated: decision.eventCreated,
  };
  if (decision.state === PAYMENT_STATES.SUCCEEDED &&
      config.domainStatusField && config.succeededDomainStatus) {
    patch[config.domainStatusField] = config.succeededDomainStatus;
  }
  if (decision.state === PAYMENT_STATES.CANCELLED &&
      config.domainStatusField && config.cancelledDomainStatus) {
    patch[config.domainStatusField] = config.cancelledDomainStatus;
  }
  if ([PAYMENT_STATES.REFUNDED, PAYMENT_STATES.DISPUTED]
      .includes(decision.state)) {
    patch.paymentReviewRequired = true;
  }
  return patch;
}

function buildReconciliationDecision({target, intent, document, event}) {
  assertReconciliationMatch({target, intent, document});
  const data = document.data || {};
  const nextState = paymentStateFromStripe({
    eventType: event?.type,
    intent,
  });
  const decision = advanceReconciliationState({
    // A client completion call can persist paymentStatus before all domain
    // side effects (inventory, payout, pool summaries) are complete.
    // Only the server reconciliation marker proves the authoritative Stripe
    // event finished. Without it, replay the idempotent completion handler.
    currentState: data.stripeReconciliationState || PAYMENT_STATES.PENDING,
    currentEventCreated: data.stripeLastEventCreated,
    nextState,
    nextEventCreated: event?.created,
  });
  return {
    ...decision,
    target,
    patch: buildReconciliationPatch({
      target,
      decision,
      eventId: event?.id,
    }),
  };
}

function assertStripeEventId(eventId) {
  const value = required(eventId, "eventId");
  if (!/^evt_[A-Za-z0-9_]+$/.test(value)) {
    throw new PaymentReconciliationError(
        "invalid-event-id",
        "Invalid Stripe event ID",
        {eventId: value},
    );
  }
  return value;
}

function stripeEventLedgerPath(eventId) {
  return `stripeWebhookEvents/${assertStripeEventId(eventId)}`;
}

function buildStripeEventClaim(event) {
  const eventId = assertStripeEventId(event?.id);
  return {
    path: stripeEventLedgerPath(eventId),
    data: {
      eventId,
      eventType: required(event?.type, "eventType"),
      eventCreated: normalizeEventCreated(event?.created),
      status: "processing",
    },
  };
}

function stripeEventAlreadyClaimed(existing, eventId) {
  if (!existing) return false;
  return clean(existing.eventId) === assertStripeEventId(eventId);
}

function paymentIntentIdempotencyKey({paymentType, stableDomainIds}) {
  const config = PAYMENT_ROUTES[paymentType];
  if (!config) {
    throw new PaymentReconciliationError(
        "unsupported-payment-type",
        `Unsupported Stripe payment type: ${paymentType}`,
    );
  }
  const values = config.operationKeys.map((key) =>
    `${key}=${required(stableDomainIds?.[key], key)}`,
  );
  const canonical = ["payment-intent", "v1", paymentType, ...values]
      .join("|");
  const digest = crypto.createHash("sha256").update(canonical)
      .digest("hex").slice(0, 32);
  return `laawol-pi-v1-${paymentType}-${digest}`;
}

function normalizePageSize(value) {
  const number = Number(value || 100);
  if (!Number.isSafeInteger(number)) return 100;
  return Math.max(1, Math.min(200, number));
}

function buildStalePendingScanPlan({
  cutoffMillis,
  pageSize = 100,
  cursorsByScan = {},
}) {
  const cutoff = Number(cutoffMillis);
  if (!Number.isFinite(cutoff) || cutoff < 0) {
    throw new PaymentReconciliationError(
        "invalid-cutoff",
        "A non-negative stale-payment cutoff is required",
    );
  }
  return STALE_SCAN_DEFINITIONS.map((definition) => ({
    ...definition,
    pendingStates: definition.pendingStates ||
      [PAYMENT_STATES.PENDING, PAYMENT_STATES.PROCESSING],
    cutoffMillis: cutoff,
    orderBy: ["updatedAt", "__name__"],
    cursor: cursorsByScan[definition.id] || null,
    limit: normalizePageSize(pageSize),
  }));
}

function rowTimestamp(row) {
  const value = row.updatedAtMillis ?? row.updatedAt;
  if (typeof value?.toMillis === "function") return value.toMillis();
  return Number(value || 0);
}

function compareRows(left, right) {
  return rowTimestamp(left) - rowTimestamp(right) ||
    clean(left.id).localeCompare(clean(right.id));
}

function selectStalePendingPage({rows, scan, cursor = null}) {
  const pending = new Set(scan.pendingStates);
  const sorted = rows.filter((row) => {
    if (!pending.has(row[scan.statusField])) return false;
    if (rowTimestamp(row) > scan.cutoffMillis) return false;
    if (!cursor) return true;
    return rowTimestamp(row) > Number(cursor.updatedAtMillis) ||
      (rowTimestamp(row) === Number(cursor.updatedAtMillis) &&
        clean(row.id).localeCompare(clean(cursor.documentId)) > 0);
  }).sort(compareRows);
  const items = sorted.slice(0, scan.limit);
  const last = items[items.length - 1];
  return {
    items,
    hasMore: sorted.length > items.length,
    nextCursor: last ? {
      updatedAtMillis: rowTimestamp(last),
      documentId: clean(last.id),
    } : null,
  };
}

module.exports = {
  PAYMENT_ROUTES,
  PAYMENT_STATES,
  STALE_SCAN_DEFINITIONS,
  PaymentReconciliationError,
  advanceReconciliationState,
  assertReconciliationMatch,
  buildReconciliationDecision,
  buildReconciliationPatch,
  buildStalePendingScanPlan,
  buildStripeEventClaim,
  paymentIntentIdempotencyKey,
  paymentStateFromStripe,
  reconciliationMismatches,
  routePaymentIntentMetadata,
  selectStalePendingPage,
  stripeEventAlreadyClaimed,
  stripeEventLedgerPath,
};
