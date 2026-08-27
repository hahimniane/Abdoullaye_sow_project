function normalizeWebsite(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function isValidWebsite(value) {
  const normalized = normalizeWebsite(value);
  if (!normalized) return false;
  try {
    const parsed = new URL(normalized);
    return Boolean(parsed.hostname && parsed.hostname.includes("."));
  } catch {
    return false;
  }
}

function coerceReviewWebsite(value) {
  const normalized = normalizeWebsite(value);
  return normalized && isValidWebsite(normalized) ? normalized : "";
}

module.exports = {
  businessStripeNameSync,
  coerceReviewWebsite,
  isValidWebsite,
  normalizeWebsite,
};

/**
 * Whether a business write should push its name to the connected Stripe
 * account, and what to push.
 *
 * Fires on a real change only. A document write happens on every field a
 * business touches, and Stripe rate-limits account updates, so re-sending an
 * unchanged name on every save would spend that budget for nothing.
 *
 * It also fires the FIRST time an account is connected, even with no name
 * change: an account that arrives after the name was set would otherwise
 * keep showing the individual's name forever.
 *
 * @param {{before: ?Object, after: ?Object}} args The document either side.
 * @return {{sync: boolean, name: string, stripeAccountId: string,
 *   reason: string}} What to do.
 */
function businessStripeNameSync({before, after}) {
  const none = (reason) => ({sync: false, name: "", stripeAccountId: "",
    reason});
  if (!after) return none("deleted");

  const stripeAccountId = String(after.stripeAccountId || "").trim();
  if (!stripeAccountId) return none("no_stripe_account");

  const name = String(after.name || "").trim();
  // Never blank the Stripe name: an empty business_profile.name makes the
  // dashboard fall back to the individual, which is the exact confusion this
  // exists to prevent.
  if (!name) return none("no_name");

  const previousName = String(before?.name || "").trim();
  const previousAccount = String(before?.stripeAccountId || "").trim();
  const accountJustConnected = !previousAccount && !!stripeAccountId;
  if (!accountJustConnected && previousName === name) {
    return none("unchanged");
  }
  return {
    sync: true,
    name: name.slice(0, 250),
    stripeAccountId,
    reason: accountJustConnected ? "account_connected" : "name_changed",
  };
}
