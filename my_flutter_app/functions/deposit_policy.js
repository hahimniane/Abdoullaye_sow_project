/**
 * What a customer puts at risk when a business holds a place for them, and
 * how long they can change their mind.
 *
 * The problem this exists for: on anything further out than a week, the card
 * networks will not hold funds until the service happens - an authorization
 * lasts 7 days and then releases. But the business commits the capacity on the
 * day of booking. Without something at risk from that day, a customer who
 * cancels three days before departure leaves a slot that cannot be refilled,
 * and the business has been protecting it for free the whole time.
 *
 * So the deposit settles immediately, and it is what a late cancellation
 * forfeits. Unlike a hold it does not expire, and unlike a cancellation fee
 * billed after the fact it is money already in hand - chasing someone who has
 * already walked away fails often and leaves no leverage.
 *
 * **The business sets both numbers, the platform bounds them, and either can
 * be set per service** (decided 2026-08-10). Only the business knows what an
 * empty slot costs it and how late it can still refill one - and those answers
 * differ by service, because a barrel leaving monthly and a car viewing next
 * Tuesday are not the same commitment. Only the platform can stop a business
 * from asking for something absurd.
 *
 * The resolution order is the one `servicePlatformFeePct` already uses:
 * **this service's value, then the business's blanket value, then nothing.**
 * Same shape on purpose - a second way of expressing "per service, with a
 * fallback" would be one more thing to keep in step.
 *
 * See docs/PLAN-payment-timing-and-cancellation.md. Nothing charges against
 * this yet - it is the settings layer, not the flow.
 */

/**
 * The services that take a payment far enough ahead for any of this to apply.
 *
 * Shared barrels are deliberately absent: a pool that never fills is its own
 * problem and needs its own answer. Car sales are absent because the deposit
 * there is the existing car-deposit flow, not a reservation.
 */
const DEPOSIT_SERVICES = Object.freeze([
  "barrelShipping",
  "freight",
  "carParking",
  "carTransport",
]);

/**
 * More than half the price up front stops being a deposit and becomes payment
 * in advance, which is the thing this whole design is moving away from.
 */
const MAX_DEPOSIT_PCT = 50;

/**
 * Ceiling in dollars whatever the percentage works out to. A percentage that
 * is reasonable on a $200 barrel order is not reasonable on a large freight
 * consignment, and a deposit is meant to cover an empty slot rather than
 * finance the trip.
 */
const PLATFORM_MAX_DEPOSIT = 500;

/**
 * Below this a deposit costs more to handle than it protects.
 *
 * Stripe charges roughly 2.9% + $0.30 and **keeps it on refund**. On a $5
 * deposit that is about 45 cents, nearly a tenth of the deposit, burned every
 * time a customer cancels inside the free window - the exact waste this design
 * exists to stop. Under this floor the honest answer is to take no deposit at
 * all rather than a token one.
 */
const MIN_WORTHWHILE_DEPOSIT = 10;

/**
 * The furthest ahead of the service that free cancellation may end.
 *
 * A business that sets 60 days has not set a cancellation policy, it has
 * abolished one: almost nobody books further ahead than that, so the free
 * window would never exist for a real customer.
 */
const MAX_CUTOFF_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Rounds to whole cents, so the figure quoted to the customer is the figure
 * charged. Rounding twice drifts by a cent on exactly the order someone would
 * complain about.
 *
 * @param {number} value An amount in dollars.
 * @return {number} The amount, to the cent.
 */
function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Reads one value for one service: this service's setting, then the blanket
 * setting, then nothing.
 *
 * @param {object} business The business document.
 * @param {string} perServiceField The map of per-service overrides.
 * @param {string} blanketField The business-wide field.
 * @param {string} service A service id.
 * @return {number} The resolved raw value, or 0 when nothing is set.
 */
function resolveSetting(business, perServiceField, blanketField, service) {
  const overrides = business?.[perServiceField];
  if (overrides && typeof overrides === "object" && service) {
    const raw = Number(overrides[service]);
    // A per-service 0 is a real answer meaning "not for this one", so it has
    // to stop the chain rather than fall through to the blanket value. That is
    // the whole point of setting it per service.
    if (Number.isFinite(raw) && raw >= 0 &&
        overrides[service] !== null && overrides[service] !== "" &&
        overrides[service] !== undefined) {
      return raw;
    }
  }
  const blanket = Number(business?.[blanketField]);
  return Number.isFinite(blanket) && blanket > 0 ? blanket : 0;
}

/**
 * Reads a business's policy for one service, with safe answers when it has set
 * nothing.
 *
 * A business that has never touched this asks for no deposit and lets people
 * cancel free until the service itself. That is a real choice - some would
 * rather have the booking than the security - so it is the default rather than
 * an error.
 *
 * @param {object} business The business document.
 * @param {string} [service] A service id; omit for the blanket policy.
 * @return {object} The policy in force for that service.
 */
function depositPolicy(business, service) {
  const rawPct = resolveSetting(
      business, "serviceReservationDepositPct", "reservationDepositPct",
      service,
  );
  const pct = rawPct > 0 ? Math.min(MAX_DEPOSIT_PCT, rawPct) : 0;

  const rawCutoff = resolveSetting(
      business, "serviceCancellationCutoffDays", "cancellationCutoffDays",
      service,
  );
  const cutoffDays = rawCutoff > 0 ? Math.min(MAX_CUTOFF_DAYS, rawCutoff) : 0;

  return {
    service: service || "",
    takesDeposit: pct > 0,
    depositPct: pct,
    cutoffDays,
    maxDeposit: PLATFORM_MAX_DEPOSIT,
    minWorthwhileDeposit: MIN_WORTHWHILE_DEPOSIT,
  };
}

/**
 * What this customer would put down for this order.
 *
 * @param {object} params Inputs.
 * @param {object} params.business The business document.
 * @param {string} [params.service] A service id.
 * @param {*} params.orderTotal What the whole order costs.
 * @return {object} The deposit, the balance left to pay, and why.
 */
function quoteDeposit({business, service, orderTotal}) {
  const policy = depositPolicy(business, service);
  const total = Number(orderTotal);
  if (!Number.isFinite(total) || total <= 0) {
    return {deposit: 0, balance: 0, policy, reason: "no_order_total"};
  }

  const none = (reason) => ({deposit: 0, balance: roundMoney(total),
    policy, reason});

  if (!policy.takesDeposit) return none("business_takes_no_deposit");

  const raw = total * (policy.depositPct / 100);
  // Never more than the order itself: a deposit larger than the price is not a
  // deposit, and the platform cap has to bite before the percentage does.
  const deposit = roundMoney(Math.min(raw, PLATFORM_MAX_DEPOSIT, total));

  if (deposit < MIN_WORTHWHILE_DEPOSIT) return none("below_worthwhile_floor");

  return {
    deposit,
    balance: roundMoney(total - deposit),
    policy,
    reason: "deposit_applies",
  };
}

/**
 * When free cancellation ends for a booking, and whether it already has.
 *
 * The case that matters is booking *inside* the window - someone booking two
 * days before a departure whose business set a three-day cutoff is past the
 * free window the moment they pay. That has to be said at checkout rather than
 * discovered at cancellation, so it is reported here rather than left for the
 * flow to infer.
 *
 * @param {object} params Inputs.
 * @param {object} params.business The business document.
 * @param {string} [params.service] A service id.
 * @param {number} params.serviceAtMs When the service happens, epoch ms.
 * @param {number} params.nowMs The current time, epoch ms.
 * @return {object} The cutoff, and whether the free window is already over.
 */
function freeCancellationWindow({business, service, serviceAtMs, nowMs}) {
  const policy = depositPolicy(business, service);
  const serviceAt = Number(serviceAtMs);
  const now = Number(nowMs);
  if (!Number.isFinite(serviceAt) || !Number.isFinite(now)) {
    return {policy, cutoffAtMs: null, alreadyPast: false,
      reason: "no_service_date"};
  }
  // No cutoff set means free until the service itself, which is what every
  // booking looked like before this existed.
  const cutoffAtMs = serviceAt - policy.cutoffDays * MS_PER_DAY;
  return {
    policy,
    cutoffAtMs,
    alreadyPast: now >= cutoffAtMs,
    reason: policy.cutoffDays > 0 ? "cutoff_applies" : "free_until_service",
  };
}

/**
 * Checks what a business is trying to save, blanket or per service.
 *
 * Refuses rather than silently clamping: a business that types 80 should be
 * told the limit is 50, not quietly saved as 50 and left believing it charges
 * 80. Clamping is right when reading someone else's stale data; it is wrong
 * when someone is looking at the field they just typed.
 *
 * @param {object} settings The submitted settings.
 * @return {object} {ok} plus an {error} code, or the values to store.
 */
function validateDepositSettings(settings) {
  const pct = validateOne(
      settings?.reservationDepositPct, MAX_DEPOSIT_PCT,
      "deposit_pct_invalid", "deposit_pct_too_high",
  );
  if (!pct.ok) return pct;

  const cutoff = validateOne(
      settings?.cancellationCutoffDays, MAX_CUTOFF_DAYS,
      "cutoff_days_invalid", "cutoff_days_too_high",
  );
  if (!cutoff.ok) return cutoff;

  const perServicePct = validatePerService(
      settings?.serviceReservationDepositPct, MAX_DEPOSIT_PCT,
      "deposit_pct_invalid", "deposit_pct_too_high",
  );
  if (!perServicePct.ok) return perServicePct;

  const perServiceCutoff = validatePerService(
      settings?.serviceCancellationCutoffDays, MAX_CUTOFF_DAYS,
      "cutoff_days_invalid", "cutoff_days_too_high",
  );
  if (!perServiceCutoff.ok) return perServiceCutoff;

  return {
    ok: true,
    reservationDepositPct: pct.value,
    cancellationCutoffDays: cutoff.value,
    serviceReservationDepositPct: perServicePct.value,
    serviceCancellationCutoffDays: perServiceCutoff.value,
  };
}

/**
 * Checks one number against its ceiling.
 *
 * @param {*} raw The submitted value.
 * @param {number} max The platform ceiling.
 * @param {string} invalidError Code for nonsense.
 * @param {string} tooHighError Code for over the ceiling.
 * @return {object} {ok, value} or {ok: false, error}.
 */
function validateOne(raw, max, invalidError, tooHighError) {
  if (raw === null || raw === undefined || raw === "") {
    return {ok: true, value: 0};
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    return {ok: false, error: invalidError};
  }
  if (value > max) return {ok: false, error: tooHighError};
  return {ok: true, value};
}

/**
 * Checks a map of per-service overrides, dropping unknown services rather than
 * storing settings that nothing will ever read.
 *
 * @param {*} raw The submitted map.
 * @param {number} max The platform ceiling.
 * @param {string} invalidError Code for nonsense.
 * @param {string} tooHighError Code for over the ceiling.
 * @return {object} {ok, value} or {ok: false, error}.
 */
function validatePerService(raw, max, invalidError, tooHighError) {
  if (!raw || typeof raw !== "object") return {ok: true, value: {}};
  const value = {};
  for (const service of DEPOSIT_SERVICES) {
    if (!(service in raw)) continue;
    const entry = raw[service];
    if (entry === null || entry === undefined || entry === "") continue;
    const checked = validateOne(entry, max, invalidError, tooHighError);
    if (!checked.ok) return checked;
    value[service] = checked.value;
  }
  return {ok: true, value};
}

/** The sentences the customer and the business actually read. */
const DEPOSIT_ERRORS = Object.freeze({
  deposit_pct_invalid: "Enter a deposit between 0 and " +
    `${MAX_DEPOSIT_PCT}% of the order.`,
  deposit_pct_too_high: `A deposit cannot be more than ${MAX_DEPOSIT_PCT}% ` +
    "of the order. Above that you are asking for payment in advance, not a " +
    "deposit.",
  cutoff_days_invalid: "Enter how many days before the service free " +
    "cancellation should end.",
  cutoff_days_too_high: "Free cancellation cannot end more than " +
    `${MAX_CUTOFF_DAYS} days before the service. Beyond that almost nobody ` +
    "books early enough for the free window to exist.",
});

module.exports = {
  DEPOSIT_SERVICES,
  MAX_DEPOSIT_PCT,
  PLATFORM_MAX_DEPOSIT,
  MIN_WORTHWHILE_DEPOSIT,
  MAX_CUTOFF_DAYS,
  DEPOSIT_ERRORS,
  depositPolicy,
  quoteDeposit,
  freeCancellationWindow,
  validateDepositSettings,
};
