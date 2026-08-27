const DEFAULT_CURRENCY = "usd";
const DEFAULT_COMMISSION_RATE = 0.1;
const DEFAULT_SIMULATE_PAYMENTS = true;

function paymentSimulationEnabled(value) {
  const normalized = String(
      value === undefined || value === null ? "true" : value,
  ).trim().toLowerCase();
  return !["false", "0", "no", "off"].includes(normalized);
}

function runtimePaymentSimulationEnabled(env = process.env) {
  if (env.SIMULATE_PAYMENTS !== undefined && env.SIMULATE_PAYMENTS !== null) {
    return paymentSimulationEnabled(env.SIMULATE_PAYMENTS);
  }
  return env.FUNCTIONS_EMULATOR === "true" ||
    env.FIRESTORE_EMULATOR_HOST !== undefined;
}

function isValidStripeSecretKey(value) {
  return /^sk_(test|live)_/.test(String(value || "").trim());
}

function centsFromDollars(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100);
}

function dollarsFromCents(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number) / 100;
}

function sharedBarrelDepositCents(pricePerShare, sharesClaimed) {
  const totalCents = centsFromDollars(pricePerShare * sharesClaimed);
  return Math.max(1, Math.round(totalCents * 0.3));
}

function sharedBarrelBalanceCents(
    pricePerShare,
    sharesClaimed,
    pickupFee = 0,
) {
  const totalCents = centsFromDollars(
      pricePerShare * sharesClaimed + pickupFee,
  );
  return Math.max(0, totalCents - sharedBarrelDepositCents(
      pricePerShare,
      sharesClaimed,
  ));
}

// A deposit is either charged to the card or there is nothing to charge.
// There used to be a third case - a deposit fully covered by wallet credit,
// which settled without a charge - but the wallet is retired
// (docs/PLAN-2026-08-backlog.md #3), so a zero amount now only ever means
// nothing is owed.
function sharedPoolPaymentFields({
  poolId,
  uid,
  amountCents,
  type,
  currency = DEFAULT_CURRENCY,
  simulatePayments = DEFAULT_SIMULATE_PAYMENTS,
}) {
  const amount = dollarsFromCents(amountCents);
  return {
    amount,
    amountCents,
    currency,
    paymentStatus: amountCents > 0 ?
      (simulatePayments ? "succeeded" : "pending") :
      "not_required",
    stripePaymentIntentIds: amountCents > 0 && simulatePayments ?
      [`simulated_${type}_${poolId}_${uid}`] :
      [],
  };
}

function sharedPoolSealAccounting({
  pool,
  participantRows,
  shipUnderfilled,
  commissionRate = DEFAULT_COMMISSION_RATE,
}) {
  const participantDepositCents = participantRows.reduce((sum, participant) =>
    sum + Number(participant.depositAmountCents || 0), 0);
  const participantBalanceCents = participantRows.reduce((sum, participant) =>
    sum + Number(participant.balanceAmountCents || 0), 0);
  const openShares = Number(pool.openShares || 0);
  const underfilledShares = shipUnderfilled ? Math.max(0, openShares) : 0;
  const underfilledAmountCents = underfilledShares > 0 ?
    centsFromDollars(Number(pool.pricePerShare || 0) * underfilledShares) :
    0;
  const grossAmountCents = participantDepositCents +
    participantBalanceCents +
    underfilledAmountCents;
  const platformCommissionCents = Math.round(
      grossAmountCents * commissionRate,
  );
  const businessPayoutCents = Math.max(
      0,
      grossAmountCents - platformCommissionCents,
  );
  return {
    participantDepositCents,
    participantBalanceCents,
    underfilledShares,
    underfilledAmountCents,
    grossAmountCents,
    platformCommissionCents,
    businessPayoutCents,
  };
}

function simulatedPoolBalanceIntent(poolId, participantUid) {
  return `simulated_barrel_pool_balance_${poolId}_${participantUid}`;
}

function hasRemainingSharedPoolBalanceDue(participantDocs, paidParticipantUid) {
  return participantDocs.some((doc) => {
    if (doc.id === paidParticipantUid) return false;
    const data = typeof doc.data === "function" ? doc.data() || {} : doc || {};
    return data.balancePaymentStatus === "balance_due" ||
      data.paymentStatus === "balance_due";
  });
}

function buildOpenBarrelMirrorPayload({
  poolId,
  pool,
  now,
  currency = DEFAULT_CURRENCY,
  activeStatuses,
}) {
  const data = pool || {};
  const status = String(data.status || "");
  const allowedStatuses = activeStatuses || new Set([
    "open",
    "partially_filled",
    "pending_seal",
  ]);
  if (!allowedStatuses.has(status) || Number(data.openShares || 0) <= 0) {
    return null;
  }

  return {
    poolId,
    businessId: data.businessId || "",
    businessName: data.businessName || "",
    destinationCountryId: data.destinationCountryId || "",
    destinationCountryName: data.destinationCountryName || "",
    sharesAvailable: Number(data.openShares || 0),
    totalShares: Number(data.totalShares || 0),
    pricePerShare: Number(data.pricePerShare || 0),
    depositPerShare: Number(data.depositPerShare || 0),
    currency: data.currency || currency,
    shipMode: data.shipMode || "sea",
    joinDeadline: data.joinDeadline || null,
    origin: data.origin || "customerPosted",
    holderRole: data.holderRole || "customer",
    approvalMode: data.approvalMode || "approval",
    status: "open",
    createdAt: data.createdAt || now,
    updatedAt: now,
  };
}

module.exports = {
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
};
