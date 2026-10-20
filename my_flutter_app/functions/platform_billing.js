"use strict";

/**
 * Laawol bills: what a business owes the platform for a month under its own
 * deal (docs/PLATFORM_BILLING.md). The pure half - no Firestore, no clock:
 * the deal and its validation, the bill's math, which deal is in effect for
 * a month, drift after a month is closed, payments, and the commission
 * keep/replace plans. platform_billing_handlers.js reads the records and
 * calls these. Mirrored for the console by admin_web/src/lib/
 * platform-billing.ts; both run test/fixtures/platform-billing-cases.json.
 *
 * Money is whole US cents. Rates are basis points (1 bp = 0.01%), so a
 * percentage is integer math: pct(c, bps) = floor((c * bps + 5000) / 10000),
 * which rounds half up to the cent.
 *
 * Order of a bill (exact):
 *   charges      = sum of the charge lines
 *   beforeLimits = charges + flat
 *   amount       = max(beforeLimits, minimum)   when a minimum is set
 *   amount       = min(amount, cap)             when a cap is set
 *   earned       = commission taken + amount    (commission never counts
 *                                                toward the minimum or cap)
 */

const {linePieces: piecesOfLine} = require("./line_pieces");

const MAX_UNIT_CENTS = 1000000; // $10,000 per unit
const MAX_MONTH_CENTS = 100000000; // $1,000,000 a month
const MAX_BPS = 10000; // 100%
const MAX_VERSIONS = 120;
const MAX_NOTE = 300;
const MAX_REASON = 300;
const MAX_PAYMENTS_PER_MONTH = 200;
const MAX_REOPEN_HISTORY = 20;
const EFFECTIVE_MONTHS_BACK = 24;
const EFFECTIVE_MONTHS_AHEAD = 12;
const EARLIEST_PAID_ON = "2020-01-01";

const COMMISSION_MODES = Object.freeze(["keep", "replace"]);
const PAYMENT_METHODS = Object.freeze(["zelle", "cash", "card",
  "bank_transfer", "check", "other"]);
const CHARGE_KEYS = Object.freeze(["barrels", "packages", "shippedCars",
  "parking", "itemsSold", "bankConnection", "bankChecks"]);

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * How each refusal code reaches the caller.
 */
const REFUSAL_STATUS = Object.freeze({
  billing_view_required: "permission-denied",
  billing_manage_required: "permission-denied",
  action_invalid: "invalid-argument",
  business_invalid: "invalid-argument",
  month_invalid: "invalid-argument",
  deal_invalid: "invalid-argument",
  charge_mode_invalid: "invalid-argument",
  amount_invalid: "invalid-argument",
  rate_invalid: "invalid-argument",
  minimum_invalid: "invalid-argument",
  cap_invalid: "invalid-argument",
  minimum_above_cap: "invalid-argument",
  effective_month_invalid: "invalid-argument",
  effective_month_out_of_range: "invalid-argument",
  note_too_long: "invalid-argument",
  commission_mode_invalid: "invalid-argument",
  paid_on_invalid: "invalid-argument",
  method_invalid: "invalid-argument",
  reason_required: "invalid-argument",
  cursor_invalid: "invalid-argument",
  effective_month_closed: "failed-precondition",
  deal_history_full: "failed-precondition",
  month_not_over: "failed-precondition",
  month_already_closed: "failed-precondition",
  month_not_closed: "failed-precondition",
  payment_exceeds_balance: "failed-precondition",
  payments_full: "failed-precondition",
  bill_incomplete: "failed-precondition",
  payment_already_voided: "failed-precondition",
  business_not_found: "not-found",
  payment_not_found: "not-found",
});

const REFUSAL_MESSAGES = Object.freeze({
  billing_view_required: "Only finance admins can read bills.",
  billing_manage_required: "Only super admins can change bills.",
  action_invalid: "Unknown bills action.",
  business_invalid: "Choose a business.",
  month_invalid: "Choose a month (yyyy-mm).",
  deal_invalid: "The deal is not in a form the server understands.",
  charge_mode_invalid: "Choose how the charge is counted.",
  amount_invalid: "Enter an amount greater than $0.",
  rate_invalid: "Enter a percentage above 0 and up to 100.",
  minimum_invalid: "Enter a minimum of $0 or more.",
  cap_invalid: "Enter a cap greater than $0.",
  minimum_above_cap: "The monthly minimum cannot be above the cap.",
  effective_month_invalid: "Choose the month the deal starts.",
  effective_month_out_of_range:
    "A deal can start up to 24 months back or 12 months ahead.",
  note_too_long: "Keep the note under 300 characters.",
  commission_mode_invalid: "Choose keep or replace.",
  paid_on_invalid: "Choose the day it was paid (not in the future).",
  method_invalid: "Choose how it was paid.",
  reason_required: "Say why.",
  cursor_invalid: "Start again from the first page.",
  effective_month_closed:
    "That month is closed. Start the deal in an open month.",
  deal_history_full: "This business has too many deal changes.",
  month_not_over: "A month can be closed once it is over.",
  month_already_closed: "This month is already closed.",
  month_not_closed: "This month is not closed.",
  payment_exceeds_balance: "That is more than this month still owes.",
  payments_full: "This month has too many payments.",
  bill_incomplete:
    "Some records are still being counted. Try again in a moment.",
  payment_already_voided: "That payment was already voided.",
  business_not_found: "Unknown business.",
  payment_not_found: "Unknown payment.",
});

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const isObject = (value) => Boolean(value) && typeof value === "object" &&
  !Array.isArray(value);

/**
 * @param {*} value Raw value.
 * @param {number} min Smallest allowed.
 * @param {number} max Largest allowed.
 * @return {boolean} Whether it is a whole number in [min, max].
 */
function wholeIn(value, min, max) {
  return typeof value === "number" && Number.isInteger(value) &&
    value >= min && value <= max;
}

/**
 * A non-negative whole count (anything else reads as 0).
 *
 * @param {*} value Raw value.
 * @return {number} The count.
 */
function count(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n);
}

/**
 * A percentage of an amount, rounded half up to the cent.
 *
 * @param {number} cents Whole cents (>= 0).
 * @param {number} bps Basis points.
 * @return {number} Whole cents.
 */
function percentOfCents(cents, bps) {
  const c = Math.max(0, Math.round(Number(cents) || 0));
  const b = Math.max(0, Math.round(Number(bps) || 0));
  return Math.floor((c * b + 5000) / 10000);
}

// -------------------------------------------------------------------------
// Months and days.
// -------------------------------------------------------------------------

/**
 * @param {*} value Input.
 * @return {boolean} Whether it is "yyyy-mm".
 */
function isMonthKey(value) {
  return typeof value === "string" && MONTH_RE.test(value);
}

/**
 * @param {string} month "yyyy-mm".
 * @return {number} Months since year 0 (for distances), NaN when invalid.
 */
function monthIndex(month) {
  const match = MONTH_RE.exec(String(month));
  if (!match) return NaN;
  return Number(match[1]) * 12 + Number(match[2]) - 1;
}

/**
 * @param {*} value Input.
 * @return {boolean} Whether it is a real calendar day "yyyy-mm-dd".
 */
function isDayKey(value) {
  const match = DAY_RE.exec(String(value ?? ""));
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1,
      Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

/**
 * @param {string} businessId The business.
 * @param {string} month "yyyy-mm".
 * @return {string} The billingMonths document id.
 */
function billingMonthId(businessId, month) {
  return `${text(businessId).replace(/\//g, "_")}_${month}`;
}

/**
 * Whether a month may be closed: it must be over (before the current one).
 *
 * @param {string} month "yyyy-mm".
 * @param {string} currentMonth The month it is now (New York).
 * @return {boolean} True when it has ended.
 */
function monthIsOver(month, currentMonth) {
  return isMonthKey(month) && isMonthKey(currentMonth) &&
    month < currentMonth;
}

// -------------------------------------------------------------------------
// The deal.
// -------------------------------------------------------------------------

/**
 * @return {object} A deal with no charge at all (bills $0).
 */
function emptyDeal() {
  return {barrel: null, package: null, shippedCar: null, parking: null,
    itemSold: null, bankConnection: null, bankCheck: null, flatCents: 0,
    minimumCents: null, capCents: null};
}

/**
 * The deal as stored, and every reason it cannot be. Refuses rather than
 * clamps: a typo must never quietly bill something else.
 *
 * @param {*} raw The deal a request sends.
 * @return {{deal: (object|null), errors: Array<string>}} The deal (null
 *   when any error) and the refusal codes, each once.
 */
function normalizeDeal(raw) {
  const errors = new Set();
  if (!isObject(raw)) return {deal: null, errors: ["deal_invalid"]};
  const deal = emptyDeal();

  const unit = (value, min = 1) => {
    if (!wholeIn(value, min, MAX_UNIT_CENTS)) {
      errors.add("amount_invalid");
      return 0;
    }
    return value;
  };
  const rate = (value) => {
    if (!wholeIn(value, 1, MAX_BPS)) {
      errors.add("rate_invalid");
      return 0;
    }
    return value;
  };
  const charge = (value) => {
    if (value === undefined || value === null) return null;
    if (!isObject(value)) {
      errors.add("deal_invalid");
      return null;
    }
    return value;
  };

  const barrel = charge(raw.barrel);
  if (barrel) deal.barrel = {centsEach: unit(barrel.centsEach)};

  const pkg = charge(raw.package);
  if (pkg) {
    if (pkg.mode === "fixed") {
      deal.package = {mode: "fixed", centsEach: unit(pkg.centsEach)};
    } else if (pkg.mode === "percent") {
      const min = pkg.minCents === undefined || pkg.minCents === null ?
        0 : pkg.minCents;
      if (!wholeIn(min, 0, MAX_UNIT_CENTS)) errors.add("minimum_invalid");
      deal.package = {mode: "percent", bps: rate(pkg.bps),
        minCents: wholeIn(min, 0, MAX_UNIT_CENTS) ? min : 0};
    } else {
      errors.add("charge_mode_invalid");
    }
  }

  const car = charge(raw.shippedCar);
  if (car) deal.shippedCar = {centsEach: unit(car.centsEach)};

  const parking = charge(raw.parking);
  if (parking) {
    if (parking.mode === "perCar") {
      deal.parking = {mode: "perCar", centsEach: unit(parking.centsEach)};
    } else if (parking.mode === "percent") {
      deal.parking = {mode: "percent", bps: rate(parking.bps)};
    } else {
      errors.add("charge_mode_invalid");
    }
  }

  const item = charge(raw.itemSold);
  if (item) deal.itemSold = {centsEach: unit(item.centsEach)};

  // Check bank (docs/ZELLE_BANK_CHECK.md): a monthly price for a connected
  // bank, and a price per paid bank refresh. Deals saved before have
  // neither: they read as no charge.
  const bankConnection = charge(raw.bankConnection);
  if (bankConnection) {
    deal.bankConnection = {centsEach: unit(bankConnection.centsEach)};
  }
  const bankCheck = charge(raw.bankCheck);
  if (bankCheck) deal.bankCheck = {centsEach: unit(bankCheck.centsEach)};

  const flat = raw.flatCents === undefined || raw.flatCents === null ?
    0 : raw.flatCents;
  if (!wholeIn(flat, 0, MAX_MONTH_CENTS)) errors.add("amount_invalid");
  else deal.flatCents = flat;

  if (raw.minimumCents !== undefined && raw.minimumCents !== null) {
    if (!wholeIn(raw.minimumCents, 1, MAX_MONTH_CENTS)) {
      errors.add("minimum_invalid");
    } else {
      deal.minimumCents = raw.minimumCents;
    }
  }
  if (raw.capCents !== undefined && raw.capCents !== null) {
    if (!wholeIn(raw.capCents, 1, MAX_MONTH_CENTS)) {
      errors.add("cap_invalid");
    } else {
      deal.capCents = raw.capCents;
    }
  }
  if (deal.minimumCents !== null && deal.capCents !== null &&
      deal.minimumCents > deal.capCents) {
    errors.add("minimum_above_cap");
  }
  return errors.size > 0 ? {deal: null, errors: [...errors]} :
    {deal, errors: []};
}

/**
 * A stored deal read back (an unreadable one reads as no charge, never as
 * a guess).
 *
 * @param {*} raw A stored deal.
 * @return {object} The deal.
 */
function storedDeal(raw) {
  const {deal} = normalizeDeal(raw);
  return deal || emptyDeal();
}

/**
 * @param {object|null} deal A deal.
 * @return {boolean} Whether it charges nothing at all.
 */
function isEmptyDeal(deal) {
  if (!deal) return true;
  return !deal.barrel && !deal.package && !deal.shippedCar &&
    !deal.parking && !deal.itemSold && !deal.bankConnection &&
    !deal.bankCheck && !(deal.flatCents > 0) && !(deal.minimumCents > 0);
}

/**
 * Which records a deal needs read beyond the Volume rollup.
 *
 * @param {object|null} deal A deal.
 * @return {{packagePrices: boolean, parking: boolean, items: boolean,
 *   bank: boolean}}
 */
function dealNeeds(deal) {
  return {
    packagePrices: deal?.package?.mode === "percent",
    parking: Boolean(deal?.parking),
    items: Boolean(deal?.itemSold),
    bank: Boolean(deal?.bankConnection || deal?.bankCheck),
  };
}

/**
 * @param {...object} needs dealNeeds results.
 * @return {object} Their union.
 */
function mergeNeeds(...needs) {
  return {
    packagePrices: needs.some((n) => n?.packagePrices),
    parking: needs.some((n) => n?.parking),
    items: needs.some((n) => n?.items),
    bank: needs.some((n) => n?.bank),
  };
}

// -------------------------------------------------------------------------
// Deal versions.
// -------------------------------------------------------------------------

/**
 * The version in effect for a month: the greatest effectiveFrom <= month;
 * on a tie, the one saved last.
 *
 * @param {Array<object>} versions Stored versions.
 * @param {string} month "yyyy-mm".
 * @return {object|null} The version, or null when none applies yet.
 */
function dealInEffect(versions, month) {
  let best = null;
  for (const version of Array.isArray(versions) ? versions : []) {
    const from = text(version?.effectiveFrom, 7);
    if (!isMonthKey(from) || from > month) continue;
    if (!best || from > best.effectiveFrom ||
        (from === best.effectiveFrom &&
          (Number(version.createdAtMs) || 0) >=
            (Number(best.createdAtMs) || 0))) {
      best = version;
    }
  }
  return best ? {...best, deal: storedDeal(best.deal)} : null;
}

/**
 * Every reason a deal change cannot be saved (besides the deal itself).
 *
 * @param {object} args
 * @param {*} args.effectiveFrom The month it starts.
 * @param {*} args.note Optional note.
 * @param {string} args.currentMonth The month it is now.
 * @param {Set<string>} [args.closedMonths] The business's closed months.
 * @param {number} [args.versionCount] Versions already stored.
 * @return {string[]} Refusal codes.
 */
function dealSaveErrors({effectiveFrom, note, currentMonth,
  closedMonths = new Set(), versionCount = 0}) {
  const errors = [];
  if (!isMonthKey(effectiveFrom)) {
    errors.push("effective_month_invalid");
  } else {
    const distance = monthIndex(effectiveFrom) - monthIndex(currentMonth);
    if (distance < -EFFECTIVE_MONTHS_BACK ||
        distance > EFFECTIVE_MONTHS_AHEAD) {
      errors.push("effective_month_out_of_range");
    } else if (closedMonths.has(effectiveFrom)) {
      errors.push("effective_month_closed");
    }
  }
  if (String(note ?? "").trim().length > MAX_NOTE) {
    errors.push("note_too_long");
  }
  if (versionCount >= MAX_VERSIONS) errors.push("deal_history_full");
  return errors;
}

/**
 * The versions with one more, oldest first.
 *
 * @param {Array<object>} versions Stored versions.
 * @param {object} version The new one.
 * @return {Array<object>} The list to store.
 */
function addVersion(versions, version) {
  const list = (Array.isArray(versions) ? versions : []).slice();
  list.push(version);
  return list.sort((a, b) =>
    String(a.effectiveFrom).localeCompare(String(b.effectiveFrom)) ||
    (Number(a.createdAtMs) || 0) - (Number(b.createdAtMs) || 0));
}

// -------------------------------------------------------------------------
// Usage: what the month's records say.
// -------------------------------------------------------------------------

/**
 * Usage cleaned: counts whole and non-negative; what was not read is null.
 *
 * @param {object} raw {barrels, packages, cars, packagePrices,
 *   parkingCars, parkingBilledCents, itemsSold, bankConnected,
 *   bankRefreshes, complete}. bankConnected: whether the business had an
 *   active bank link in the month; bankRefreshes: its paid bank refreshes.
 * @return {object} The usage.
 */
function normalizeUsage(raw) {
  const row = isObject(raw) ? raw : {};
  const maybe = (value) => value === null || value === undefined ? null :
    count(value);
  const prices = Array.isArray(row.packagePrices) ?
    row.packagePrices.map((price) => price === null || price === undefined ?
      null : count(price)) : null;
  return {
    barrels: count(row.barrels),
    packages: prices ? prices.length : count(row.packages),
    cars: count(row.cars),
    packagePrices: prices,
    parkingCars: maybe(row.parkingCars),
    parkingBilledCents: maybe(row.parkingBilledCents),
    itemsSold: maybe(row.itemsSold),
    bankConnected: row.bankConnected === null ||
      row.bankConnected === undefined ? null : row.bankConnected === true,
    bankRefreshes: maybe(row.bankRefreshes),
    complete: row.complete !== false,
  };
}

/**
 * The package prices of a set of lines: one entry per package piece (box or
 * other), its recorded price or null for "no price". Pieces read through
 * line_pieces.js, so a legacy line's price is spread over its pieces as
 * every screen reads it; a pickup fee is not a package price.
 *
 * @param {Array<object>} lines Stored lines (already this month's).
 * @return {Array<number|null>} The prices.
 */
function packagePricesOfLines(lines) {
  const prices = [];
  for (const line of Array.isArray(lines) ? lines : []) {
    for (const piece of piecesOfLine(line)) {
      if (piece.kind === "barrel" || piece.kind === "car") continue;
      const price = piece.priceCents;
      prices.push(typeof price === "number" && Number.isInteger(price) &&
        price >= 0 ? price : null);
    }
  }
  return prices;
}

// -------------------------------------------------------------------------
// The bill.
// -------------------------------------------------------------------------

/**
 * The package line of a bill.
 *
 * @param {object} rule The deal's package charge.
 * @param {object} usage Normalized usage.
 * @return {object} The line.
 */
function packageLine(rule, usage) {
  if (rule.mode === "fixed") {
    return {key: "packages", mode: "fixed", quantity: usage.packages,
      centsEach: rule.centsEach, cents: usage.packages * rule.centsEach};
  }
  const prices = usage.packagePrices ||
    Array.from({length: usage.packages}, () => null);
  let cents = 0;
  let noPrice = 0;
  let atMinimum = 0;
  let pricedCents = 0;
  for (const price of prices) {
    if (price === null) {
      noPrice += 1;
      cents += rule.minCents;
      if (rule.minCents > 0) atMinimum += 1;
      continue;
    }
    pricedCents += price;
    const share = percentOfCents(price, rule.bps);
    if (share < rule.minCents) {
      atMinimum += 1;
      cents += rule.minCents;
    } else {
      cents += share;
    }
  }
  return {key: "packages", mode: "percent", quantity: prices.length,
    bps: rule.bps, minCents: rule.minCents, pricedCents,
    noPriceCount: noPrice, atMinimumCount: atMinimum,
    pricesUnknown: !usage.packagePrices, cents};
}

/**
 * A month's bill under a deal.
 *
 * @param {object} args
 * @param {object|null} args.deal The deal in effect (null: no deal).
 * @param {object} args.usage The month's usage.
 * @param {number} [args.commissionCents] Commission taken in the month.
 * @return {object} The bill.
 */
function computeBill({deal, usage, commissionCents = 0}) {
  const u = normalizeUsage(usage);
  const commission = count(commissionCents);
  const lines = [];
  if (deal) {
    if (deal.barrel) {
      lines.push({key: "barrels", mode: "fixed", quantity: u.barrels,
        centsEach: deal.barrel.centsEach,
        cents: u.barrels * deal.barrel.centsEach});
    }
    if (deal.package) lines.push(packageLine(deal.package, u));
    if (deal.shippedCar) {
      lines.push({key: "shippedCars", mode: "fixed", quantity: u.cars,
        centsEach: deal.shippedCar.centsEach,
        cents: u.cars * deal.shippedCar.centsEach});
    }
    if (deal.parking) {
      if (deal.parking.mode === "perCar") {
        const cars = u.parkingCars || 0;
        lines.push({key: "parking", mode: "perCar", quantity: cars,
          centsEach: deal.parking.centsEach,
          cents: cars * deal.parking.centsEach});
      } else {
        const billed = u.parkingBilledCents || 0;
        lines.push({key: "parking", mode: "percent",
          quantity: u.parkingCars || 0, bps: deal.parking.bps,
          baseCents: billed, cents: percentOfCents(billed, deal.parking.bps)});
      }
    }
    if (deal.itemSold) {
      const items = u.itemsSold || 0;
      lines.push({key: "itemsSold", mode: "fixed", quantity: items,
        centsEach: deal.itemSold.centsEach,
        cents: items * deal.itemSold.centsEach});
    }
    if (deal.bankConnection) {
      // Charged for the month when the business had an active bank link.
      const months = u.bankConnected ? 1 : 0;
      lines.push({key: "bankConnection", mode: "fixed", quantity: months,
        centsEach: deal.bankConnection.centsEach,
        cents: months * deal.bankConnection.centsEach});
    }
    if (deal.bankCheck) {
      const refreshes = u.bankRefreshes || 0;
      lines.push({key: "bankChecks", mode: "fixed", quantity: refreshes,
        centsEach: deal.bankCheck.centsEach,
        cents: refreshes * deal.bankCheck.centsEach});
    }
  }
  const chargesCents = lines.reduce((sum, line) => sum + line.cents, 0);
  const flatCents = deal ? deal.flatCents || 0 : 0;
  const beforeLimitsCents = chargesCents + flatCents;
  let amount = beforeLimitsCents;
  let minimumAdjustmentCents = 0;
  let capAdjustmentCents = 0;
  const minimumCents = deal?.minimumCents ?? null;
  const capCents = deal?.capCents ?? null;
  if (minimumCents !== null && amount < minimumCents) {
    minimumAdjustmentCents = minimumCents - amount;
    amount = minimumCents;
  }
  if (capCents !== null && amount > capCents) {
    capAdjustmentCents = capCents - amount; // negative: a reduction
    amount = capCents;
  }
  return {
    hasDeal: Boolean(deal),
    lines,
    chargesCents,
    flatCents,
    beforeLimitsCents,
    minimumCents,
    minimumAdjustmentCents,
    capCents,
    capAdjustmentCents,
    amountCents: amount,
    commissionCents: commission,
    earnedCents: commission + amount,
  };
}

// -------------------------------------------------------------------------
// Closed months: drift.
// -------------------------------------------------------------------------

const DRIFT_KEYS = Object.freeze([
  ["barrels", "count"],
  ["packages", "count"],
  ["packagesNoPrice", "count"],
  ["packagePriceCents", "cents"],
  ["cars", "count"],
  ["parkingCars", "count"],
  ["parkingBilledCents", "cents"],
  ["itemsSold", "count"],
  ["bankConnected", "count"],
  ["bankRefreshes", "count"],
  ["commissionCents", "cents"],
]);

/**
 * The figures drift compares, from a usage and the commission.
 *
 * @param {object} usage Normalized usage.
 * @param {number} commissionCents Commission.
 * @return {object} key -> number|null (null: not read).
 */
function driftFigures(usage, commissionCents) {
  const u = normalizeUsage(usage);
  const prices = u.packagePrices;
  return {
    barrels: u.barrels,
    packages: u.packages,
    packagesNoPrice: prices ? prices.filter((p) => p === null).length : null,
    packagePriceCents: prices ?
      prices.reduce((sum, p) => sum + (p || 0), 0) : null,
    cars: u.cars,
    parkingCars: u.parkingCars,
    parkingBilledCents: u.parkingBilledCents,
    itemsSold: u.itemsSold,
    bankConnected: u.bankConnected === null ? null : Number(u.bankConnected),
    bankRefreshes: u.bankRefreshes,
    commissionCents: count(commissionCents),
  };
}

/**
 * What changed in a closed month's records since it was closed.
 *
 * @param {object} snapshot The closed snapshot {usage, deal, bill}.
 * @param {object} liveUsage The month's usage now (read with the snapshot
 *   deal's needs).
 * @param {number} liveCommissionCents Commission now.
 * @return {object} {changed, items: [{key, kind, before, after, delta}],
 *   closedAmountCents, amountNowCents, amountDeltaCents}.
 */
function billDrift(snapshot, liveUsage, liveCommissionCents) {
  const snap = isObject(snapshot) ? snapshot : {};
  const before = driftFigures(snap.usage, snap.bill?.commissionCents);
  const after = driftFigures(liveUsage, liveCommissionCents);
  const items = [];
  for (const [key, kind] of DRIFT_KEYS) {
    const a = before[key];
    const b = after[key];
    if (a === null || b === null || a === b) continue;
    items.push({key, kind, before: a, after: b, delta: b - a});
  }
  const deal = snap.deal ? storedDeal(snap.deal) : null;
  const now = computeBill({deal, usage: liveUsage,
    commissionCents: liveCommissionCents});
  const closedAmountCents = count(snap.bill?.amountCents);
  return {
    changed: items.length > 0,
    items,
    closedAmountCents,
    amountNowCents: now.amountCents,
    amountDeltaCents: now.amountCents - closedAmountCents,
  };
}

// -------------------------------------------------------------------------
// Payments and standing.
// -------------------------------------------------------------------------

/**
 * Every reason a payment cannot be recorded.
 *
 * @param {object} input {amountCents, paidOn, method, note}.
 * @param {string} todayKey Today in New York, "yyyy-mm-dd".
 * @return {string[]} Refusal codes.
 */
function paymentErrors(input, todayKey) {
  const row = isObject(input) ? input : {};
  const errors = [];
  if (!wholeIn(row.amountCents, 1, MAX_MONTH_CENTS)) {
    errors.push("amount_invalid");
  }
  const paidOn = text(row.paidOn, 10);
  if (!isDayKey(paidOn) || paidOn < EARLIEST_PAID_ON ||
      (isDayKey(todayKey) && paidOn > todayKey)) {
    errors.push("paid_on_invalid");
  }
  if (!PAYMENT_METHODS.includes(text(row.method, 40))) {
    errors.push("method_invalid");
  }
  if (String(row.note ?? "").trim().length > MAX_NOTE) {
    errors.push("note_too_long");
  }
  return errors;
}

/**
 * The payment as stored.
 *
 * @param {object} input Validated input.
 * @param {object} meta {businessId, month, recordedBy, recordedAtMs}.
 * @return {object} The document body.
 */
function paymentRecord(input, {businessId, month, recordedBy,
  recordedAtMs}) {
  return {
    businessId: text(businessId),
    month,
    amountCents: input.amountCents,
    paidOn: text(input.paidOn, 10),
    method: text(input.method, 40),
    note: text(input.note, MAX_NOTE),
    recordedBy: text(recordedBy, 128),
    recordedAtMs: Number(recordedAtMs) || 0,
    voided: false,
  };
}

/**
 * @param {Array<object>} payments A month's payments, voided included.
 * @return {number} The sum of those that still count.
 */
function sumPayments(payments) {
  return (Array.isArray(payments) ? payments : [])
      .filter((p) => p && p.voided !== true)
      .reduce((sum, p) => sum + count(p.amountCents), 0);
}

/**
 * Where a month stands.
 *
 * @param {object} args {amountCents, paidCents}.
 * @return {{status: string, unpaidCents: number, overpaidCents: number}}
 *   status: nothing_owed | unpaid | partial | paid | overpaid.
 */
function monthStanding({amountCents, paidCents}) {
  const owed = count(amountCents);
  const paid = count(paidCents);
  let status;
  if (paid > owed) status = "overpaid";
  else if (owed === 0) status = "nothing_owed";
  else if (paid === owed) status = "paid";
  else if (paid > 0) status = "partial";
  else status = "unpaid";
  return {status, unpaidCents: Math.max(0, owed - paid),
    overpaidCents: Math.max(0, paid - owed)};
}

/**
 * Whether one more payment fits a closed month.
 *
 * @param {object} args {closed, amountCents, paidCents, addCents}.
 * @return {string|null} payment_exceeds_balance, or null.
 */
function paymentBalanceRefusal({closed, amountCents, paidCents, addCents}) {
  if (!closed) return null;
  return count(paidCents) + count(addCents) > count(amountCents) ?
    "payment_exceeds_balance" : null;
}

// -------------------------------------------------------------------------
// Commission keep / replace.
// -------------------------------------------------------------------------

/**
 * What switching to "replace" writes on the business, and the backup that
 * lets "keep" put it back. Same fields the Finance settings write.
 *
 * @param {object} business The businesses/{id} document.
 * @return {{backup: object, set: object}} `set` maps field paths to 0.
 */
function commissionReplacePlan(business) {
  const row = isObject(business) ? business : {};
  const present = Object.prototype.hasOwnProperty.call(row,
      "platformFeePct") && row.platformFeePct !== undefined;
  const services = isObject(row.servicePlatformFeePct) ?
    row.servicePlatformFeePct : {};
  const backup = {
    platformFeePct: {present, value: present ? row.platformFeePct : null},
    servicePlatformFeePct: {},
  };
  const set = {platformFeePct: 0};
  for (const key of Object.keys(services).sort()) {
    if (!/^[A-Za-z0-9_]{1,60}$/.test(key)) continue;
    backup.servicePlatformFeePct[key] = services[key];
    set[`servicePlatformFeePct.${key}`] = 0;
  }
  return {backup, set};
}

/**
 * What switching back to "keep" writes: each backed-up value, but only
 * where the field still reads the 0 Bills wrote.
 *
 * @param {object} business The businesses/{id} document now.
 * @param {object|null} backup The stored commissionBackup.
 * @return {{set: object, remove: Array<string>, notRestored: Array<string>}}
 */
function commissionRestorePlan(business, backup) {
  const row = isObject(business) ? business : {};
  const saved = isObject(backup) ? backup : {};
  const set = {};
  const remove = [];
  const notRestored = [];
  const fee = isObject(saved.platformFeePct) ? saved.platformFeePct :
    {present: false, value: null};
  if (row.platformFeePct === 0) {
    if (fee.present) set.platformFeePct = fee.value;
    else remove.push("platformFeePct");
  } else {
    notRestored.push("platformFeePct");
  }
  const services = isObject(saved.servicePlatformFeePct) ?
    saved.servicePlatformFeePct : {};
  const current = isObject(row.servicePlatformFeePct) ?
    row.servicePlatformFeePct : {};
  for (const key of Object.keys(services).sort()) {
    if (!/^[A-Za-z0-9_]{1,60}$/.test(key)) continue;
    const field = `servicePlatformFeePct.${key}`;
    if (current[key] === 0) set[field] = services[key];
    else notRestored.push(field);
  }
  return {set, remove, notRestored};
}

// -------------------------------------------------------------------------
// Commission taken in a month.
// -------------------------------------------------------------------------

/**
 * Commission taken per business in a window, from earnings lines
 * (console_summaries.js platformEarningsLines): earned lines only.
 *
 * @param {Array<object>} lines Earnings lines.
 * @param {{startMs: number, endMs: number}} window The month.
 * @return {Map<string, number>} businessId -> cents.
 */
function commissionByBusiness(lines, window) {
  const out = new Map();
  for (const line of Array.isArray(lines) ? lines : []) {
    if (line?.state !== "earned") continue;
    const id = text(line.businessId);
    const ms = Number(line.ms);
    if (!id || !Number.isFinite(ms) || line.ms === null) continue;
    if (ms < window.startMs || ms >= window.endMs) continue;
    out.set(id, (out.get(id) || 0) + count(line.feeCents));
  }
  return out;
}

// -------------------------------------------------------------------------
// The month's table.
// -------------------------------------------------------------------------

/**
 * The order businesses are listed in: with a deal first, then by name.
 *
 * @param {Array<{businessId: string, name: string, hasDeal: boolean}>} rows
 *   Candidates.
 * @return {Array<object>} Sorted copy.
 */
function orderCandidates(rows) {
  return (Array.isArray(rows) ? rows : []).slice().sort((a, b) =>
    Number(Boolean(b.hasDeal)) - Number(Boolean(a.hasDeal)) ||
    String(a.name || a.businessId).localeCompare(
        String(b.name || b.businessId), "en", {sensitivity: "base"}) ||
    String(a.businessId).localeCompare(String(b.businessId)));
}

/**
 * The tiles over the rows of a month.
 *
 * @param {Array<object>} rows Computed rows ({amountCents, paidCents,
 *   commissionCents}).
 * @return {object} {owedCents, paidCents, commissionCents, earnedCents,
 *   businesses, withDeal}.
 */
function summarizeRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const sum = (key) => list.reduce((s, row) => s + count(row?.[key]), 0);
  const owedCents = sum("amountCents");
  const commissionCents = sum("commissionCents");
  return {
    owedCents,
    paidCents: sum("paidCents"),
    commissionCents,
    earnedCents: owedCents + commissionCents,
    businesses: list.length,
    withDeal: list.filter((row) => row?.hasDeal).length,
  };
}

/**
 * Past months of a business that are still open while a deal applied.
 *
 * @param {object} args
 * @param {Array<object>} args.versions Deal versions.
 * @param {Set<string>} args.closedMonths Closed months.
 * @param {string} args.currentMonth The month it is now.
 * @param {number} [args.max] How far back to look.
 * @return {string[]} The months, newest first.
 */
function pastOpenMonths({versions, closedMonths, currentMonth, max = 24}) {
  const list = Array.isArray(versions) ? versions : [];
  const first = list.map((v) => text(v?.effectiveFrom, 7))
      .filter(isMonthKey).sort()[0];
  if (!first || !isMonthKey(currentMonth)) return [];
  const out = [];
  const nowIndex = monthIndex(currentMonth);
  for (let back = 1; back <= max; back += 1) {
    const index = nowIndex - back;
    const year = Math.floor(index / 12);
    const month = `${String(year).padStart(4, "0")}-` +
      `${String(index - year * 12 + 1).padStart(2, "0")}`;
    if (month < first) break;
    const version = dealInEffect(list, month);
    if (!version || isEmptyDeal(version.deal)) continue;
    if (!closedMonths.has(month)) out.push(month);
  }
  return out;
}

module.exports = {
  CHARGE_KEYS,
  COMMISSION_MODES,
  EARLIEST_PAID_ON,
  EFFECTIVE_MONTHS_AHEAD,
  EFFECTIVE_MONTHS_BACK,
  MAX_BPS,
  MAX_MONTH_CENTS,
  MAX_NOTE,
  MAX_PAYMENTS_PER_MONTH,
  MAX_REASON,
  MAX_REOPEN_HISTORY,
  MAX_UNIT_CENTS,
  MAX_VERSIONS,
  PAYMENT_METHODS,
  REFUSAL_MESSAGES,
  REFUSAL_STATUS,
  addVersion,
  billDrift,
  billingMonthId,
  commissionByBusiness,
  commissionReplacePlan,
  commissionRestorePlan,
  computeBill,
  dealInEffect,
  dealNeeds,
  dealSaveErrors,
  emptyDeal,
  isDayKey,
  isEmptyDeal,
  isMonthKey,
  mergeNeeds,
  monthIndex,
  monthIsOver,
  monthStanding,
  normalizeDeal,
  normalizeUsage,
  orderCandidates,
  packagePricesOfLines,
  pastOpenMonths,
  paymentBalanceRefusal,
  paymentErrors,
  paymentRecord,
  percentOfCents,
  storedDeal,
  sumPayments,
  summarizeRows,
};
