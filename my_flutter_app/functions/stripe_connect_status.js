function stripeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function stripeRequirementsUpdate(account) {
  const requirements = account?.requirements || {};
  return {
    currentlyDue: stripeStringList(requirements.currently_due),
    pastDue: stripeStringList(requirements.past_due),
    pendingVerification: stripeStringList(requirements.pending_verification),
    eventuallyDue: stripeStringList(requirements.eventually_due),
    disabledReason: String(requirements.disabled_reason || "").trim(),
    errors: Array.isArray(requirements.errors) ?
      requirements.errors.slice(0, 10).map((error) => ({
        code: String(error?.code || "").trim(),
        requirement: String(error?.requirement || "").trim(),
        reason: String(error?.reason || "").trim(),
      })) :
      [],
  };
}

function buildStripeAccountBusinessUpdate(account, {serverTimestamp}) {
  const chargesEnabled = account.charges_enabled === true;
  const payoutsEnabled =
    account.charges_enabled === true && account.payouts_enabled === true;
  const timestamp =
    typeof serverTimestamp === "function" ? serverTimestamp() : serverTimestamp;
  return {
    stripeAccountId: account.id,
    chargesEnabled,
    payoutsEnabled,
    stripeRequirements: stripeRequirementsUpdate(account),
    ...(payoutsEnabled && {
      connectOnboardedAt: timestamp,
    }),
    updatedAt: timestamp,
  };
}

module.exports = {
  buildStripeAccountBusinessUpdate,
  stripeRequirementsUpdate,
  stripeStringList,
};
