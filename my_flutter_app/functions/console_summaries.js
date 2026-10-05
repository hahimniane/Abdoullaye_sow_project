"use strict";

/**
 * The money and count figures the web consoles show, worked out on the
 * server from EVERY record rather than from a capped listener.
 *
 * The consoles used to total whatever their listeners happened to hold:
 * `where(businessId) + limit(N)` with no order, which Firestore answers with
 * the first N documents by id - a random subset. Past N, new records went
 * missing from the list and every total on the page was silently wrong. The
 * lists are now ordered and paged; the totals come from here.
 *
 * Pure: no Firestore, no clock unless one is passed in. Each block mirrors a
 * console module function for function, and
 * `admin_web/src/lib/console-summaries-parity.test.ts` runs both sides over
 * the same fixtures and requires identical output:
 *
 *   - earnings            admin_web/src/lib/business-earnings.ts
 *   - platform earnings   admin_web/src/lib/platform-earnings.ts
 *   - business overview   admin_web/src/lib/business-overview.ts
 *   - parking totals      admin_web/src/lib/business-parking-entry.ts
 *   - lot ledger          admin_web/src/lib/lot-ledger.ts
 *   - invoice board       admin_web/src/lib/invoice-ledger.ts
 *
 * Where the console reads a date in the viewer's local calendar, the
 * functions here take that viewer's IANA time zone, so a legacy row with no
 * stored month key lands in the same month on both sides.
 */

const {invoiceIsOverdue} = require("./invoice_ledger");

// ---------------------------------------------------------------------------
// Shared readers.
// ---------------------------------------------------------------------------

/**
 * A Date from anything a Firestore row (or a console row) may hold.
 * Mirrors `asDate` in admin_web/src/lib/format.ts.
 *
 * @param {*} value Timestamp, Date, ISO string or millis.
 * @return {Date|null} The date, or null when unusable.
 */
function asDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === "object" && "toDate" in value) {
    if (typeof value.toDate === "function") return value.toDate();
  }
  return null;
}

/**
 * Mirrors `toDateOrNull` in business-parking-entry.ts (which also reads a
 * bare `{seconds}` object).
 *
 * @param {*} value A stored date.
 * @return {Date|null} The date.
 */
function toDateOrNull(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") {
    try {
      return value.toDate();
    } catch (_) {
      return null;
    }
  }
  if (value instanceof Date) return value;
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

const zoneFormatters = new Map();

/**
 * A validated IANA zone, or "" (UTC) when the caller sent nothing usable.
 *
 * @param {*} timeZone What the console reported.
 * @return {string} A zone Intl accepts, or "".
 */
function normalizeTimeZone(timeZone) {
  const zone = String(timeZone || "").trim().slice(0, 64);
  if (!zone) return "";
  if (zoneFormatters.has(zone)) return zone;
  try {
    zoneFormatters.set(zone, new Intl.DateTimeFormat("en-CA", {
      timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
    }));
    return zone;
  } catch (_) {
    return "";
  }
}

/**
 * "yyyy-mm-dd" of the calendar day `date` falls on in `timeZone` (UTC when
 * none). The console computes these with local getters; the server cannot,
 * so it is told the viewer's zone.
 *
 * @param {Date} date The instant.
 * @param {string} timeZone IANA zone or "".
 * @return {string} The day key.
 */
function zonedDayKey(date, timeZone) {
  const zone = normalizeTimeZone(timeZone);
  if (!zone) return date.toISOString().slice(0, 10);
  const parts = zoneFormatters.get(zone).formatToParts(date);
  const pick = (type) => (parts.find((p) => p.type === type) || {}).value;
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function numericValue(value) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function normalized(value) {
  return String(value ?? "").trim().toLowerCase();
}

function trimmed(value, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

// ---------------------------------------------------------------------------
// Earnings - mirrors admin_web/src/lib/business-earnings.ts.
// ---------------------------------------------------------------------------

const EARNINGS_SERVICE_LABELS = Object.freeze({
  barrelShipping: "Barrel shipping",
  freight: "Freight",
  carSales: "Car sales",
  carTransport: "Car transport",
  carParking: "Car parking",
});

const EARNINGS_PAID_STATUSES = new Set([
  "paid", "succeeded", "completed", "collected", "released",
]);
const EARNINGS_PENDING_STATUSES = new Set([
  "pending", "pending_payment", "processing", "requires_payment_method",
  "requires_confirmation",
]);

function centsOrDollars(row, centFields, dollarFields) {
  for (const field of centFields) {
    const cents = numericValue(row[field]);
    if (cents > 0) return cents / 100;
  }
  for (const field of dollarFields) {
    const amount = numericValue(row[field]);
    if (amount > 0) return amount;
  }
  return 0;
}

function earningsPaymentState(row) {
  const statuses = [
    row.paymentStatus, row.status, row.purchaseStatus, row.payoutStatus,
  ].map(normalized).filter(Boolean);
  if (statuses.some((s) => EARNINGS_PAID_STATUSES.has(s))) return "paid";
  if (statuses.some((s) => EARNINGS_PENDING_STATUSES.has(s))) return "pending";
  return "unpaid";
}

function earningsServiceRow(serviceId) {
  return {
    serviceId,
    label: EARNINGS_SERVICE_LABELS[serviceId] ?? serviceId,
    grossReceived: 0,
    platformFees: 0,
    businessEarnings: 0,
    pendingGross: 0,
    paidTransactions: 0,
    pendingTransactions: 0,
  };
}

function businessPayoutAmount(row, gross, platformFee) {
  const explicit = centsOrDollars(row,
      ["businessPayoutCents", "businessPayoutAmountCents"],
      ["businessPayoutAmount"]);
  if (explicit > 0) return explicit;
  return Math.max(0, gross - platformFee);
}

function platformFeeAmount(row, gross) {
  const explicit = centsOrDollars(row,
      ["platformFeeCents", "platformCommissionCents"],
      ["platformFeeAmount", "platformCommissionAmount"]);
  if (explicit > 0) return explicit;
  const pct = numericValue(row.platformFeePct ?? row.platformCommissionRate);
  if (pct > 0 && pct < 1) return gross * pct;
  return 0;
}

/**
 * Raw record arrays flattened into billable lines.
 *
 * @param {object} input {purchases, shipments, freightShipments, transports,
 *   parkedCars}, each optional.
 * @return {Array<object>} {serviceId, row, source, gross} per line.
 */
function earningsLineItems(input) {
  const items = [];
  const push = (serviceId, source, row, gross) => {
    if (!Number.isFinite(gross) || gross <= 0) return;
    items.push({serviceId, row, source, gross});
  };
  const list = (rows) => Array.isArray(rows) ?
    rows.filter((row) => Boolean(row) && typeof row === "object") : [];

  list(input.purchases).forEach((row) => {
    push("carSales", row, row, centsOrDollars(row,
        ["depositAmountCents", "amountCents"],
        ["depositAmount", "amount", "price", "listingPrice"]));
    const extensionGross = centsOrDollars(row,
        ["extensionExtraAmountCents"], ["extensionExtraAmount"]);
    if (extensionGross > 0) {
      push("carSales", row, {
        ...row,
        paymentStatus: row.extensionPaymentStatus,
        platformFeeCents: row.extensionPlatformFeeCents,
        businessPayoutCents: row.extensionBusinessPayoutCents,
        platformFeePct: row.extensionPlatformFeePct,
      }, extensionGross);
    }
  });

  list(input.shipments).forEach((row) => {
    push("barrelShipping", row, row, centsOrDollars(row,
        ["totalCents", "priceCents", "amountCents"],
        ["total", "price", "amount"]));
  });

  list(input.freightShipments).forEach((row) => {
    const versionTwo = numericValue(row.freightPricingVersion) >= 2;
    const settled = normalized(row.priceSettlementStatus) === "settled";
    const freightRow = versionTwo && !settled ?
      {...row, paymentStatus: "pending", payoutStatus: "pending"} : row;
    push("freight", row, freightRow, versionTwo ?
      settled ?
        centsOrDollars(row, ["finalTotalCents"], ["finalTotal"]) :
        centsOrDollars(row, ["estimatedTotalCents"], ["estimatedTotal"]) :
      centsOrDollars(row, ["totalCents", "priceCents", "amountCents"],
          ["total", "price", "amount"]));
  });

  list(input.transports).forEach((row) => {
    push("carTransport", row, row, centsOrDollars(row,
        ["totalCents", "priceCents", "amountCents"],
        ["totalCost", "price", "quoteAmount", "amount"]));
  });

  list(input.parkedCars).forEach((row) => {
    push("carParking", row, row, centsOrDollars(row,
        ["totalCostCents", "totalCents", "amountCents"],
        ["totalCost", "price", "amount"]));
  });

  return items;
}

/**
 * One business's earnings by service.
 *
 * @param {object} input The record arrays.
 * @return {object} {totals, services}.
 */
function summarizeBusinessEarnings(input) {
  const services = new Map();
  for (const serviceId of Object.keys(EARNINGS_SERVICE_LABELS)) {
    services.set(serviceId, earningsServiceRow(serviceId));
  }
  earningsLineItems(input).forEach((item) => {
    const service = services.get(item.serviceId) ??
      earningsServiceRow(item.serviceId);
    const platformFee = platformFeeAmount(item.row, item.gross);
    const businessEarning =
      businessPayoutAmount(item.row, item.gross, platformFee);
    const state = earningsPaymentState(item.row);
    if (state === "paid") {
      service.grossReceived += item.gross;
      service.platformFees += platformFee;
      service.businessEarnings += businessEarning;
      service.paidTransactions += 1;
    } else if (state === "pending") {
      service.pendingGross += item.gross;
      service.pendingTransactions += 1;
    }
    services.set(item.serviceId, service);
  });
  const rows = Array.from(services.values());
  const totals = rows.reduce((sum, row) => ({
    grossReceived: sum.grossReceived + row.grossReceived,
    platformFees: sum.platformFees + row.platformFees,
    businessEarnings: sum.businessEarnings + row.businessEarnings,
    pendingGross: sum.pendingGross + row.pendingGross,
    paidTransactions: sum.paidTransactions + row.paidTransactions,
    pendingTransactions: sum.pendingTransactions + row.pendingTransactions,
  }), {
    grossReceived: 0, platformFees: 0, businessEarnings: 0,
    pendingGross: 0, paidTransactions: 0, pendingTransactions: 0,
  });
  return {totals, services: rows};
}

// ---------------------------------------------------------------------------
// Platform earnings - mirrors admin_web/src/lib/platform-earnings.ts.
// ---------------------------------------------------------------------------

const COLLECTED_STATUSES = new Set(["succeeded", "paid", "captured",
  "collected"]);
const VOID_STATUSES = new Set(["failed", "cancelled", "canceled", "refunded",
  "reversed", "chargeback", "expired", "voided", "void", "not_required"]);
const COLLECTED_FALLBACK_STATUSES = new Set([...COLLECTED_STATUSES,
  "completed", "released"]);
const DIRECT_PAYMENT_METHODS = new Set(["direct", "cash", "zelle", "check",
  "offline", "manual"]);
const OFF_PLATFORM_STATUSES = new Set(["collected_by_business",
  "awaiting_direct_payment"]);
const UNASSIGNED_BUSINESS_NAME = "Unassigned business";
const MAX_DAILY_SPAN_DAYS = 92;
const MAX_POINTS = 240;
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug",
  "Sep", "Oct", "Nov", "Dec"];
const DAY_MS = 86400000;

function emptyBucket() {
  return {earnedCents: 0, pendingCents: 0, grossCents: 0,
    notCommissionableCents: 0, voidCents: 0, records: 0};
}

function toCents(dollars) {
  const amount = Number(dollars ?? 0);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

function isNonCommissionable(row) {
  if (row.platformBilled === false) return true;
  if (DIRECT_PAYMENT_METHODS.has(normalized(row.paymentMethod))) return true;
  if (normalized(row.payoutStatus) === "not_applicable") return true;
  if (OFF_PLATFORM_STATUSES.has(normalized(row.paymentStatus))) return true;
  return false;
}

function commissionState(row) {
  if (isNonCommissionable(row)) return "notCommissionable";
  const paymentStatus = normalized(row.paymentStatus);
  if (paymentStatus) {
    if (COLLECTED_STATUSES.has(paymentStatus)) return "earned";
    if (VOID_STATUSES.has(paymentStatus)) return "void";
    return "pending";
  }
  const fallbacks = [row.purchaseStatus, row.payoutStatus, row.status]
      .map(normalized).filter(Boolean);
  if (fallbacks.some((s) => COLLECTED_FALLBACK_STATUSES.has(s))) {
    return "earned";
  }
  if (fallbacks.some((s) => VOID_STATUSES.has(s))) return "void";
  return "pending";
}

const LINE_DATE_FIELDS = ["paidAt", "paymentCompletedAt", "balancePaidAt",
  "collectedAt", "completedAt", "createdAt", "submittedAt", "requestedAt",
  "updatedAt"];

function lineDate(row, source) {
  for (const field of LINE_DATE_FIELDS) {
    const date = asDate(row[field]) ?? asDate(source[field]);
    if (date && Number.isFinite(date.getTime())) return date;
  }
  return null;
}

function businessIndex(businesses) {
  const byId = new Map();
  const byName = new Map();
  if (!Array.isArray(businesses)) return {byId, byName};
  for (const business of businesses) {
    if (!business || typeof business !== "object") continue;
    const id = normalized(business.id);
    const name = normalized(business.name);
    if (id && !byId.has(id)) byId.set(id, business);
    if (name && !byName.has(name)) byName.set(name, business);
  }
  return {byId, byName};
}

function resolveBusiness(row, source, index) {
  const rawId = String(row.businessId ?? source.businessId ?? "").trim();
  const rawName = String(row.businessName ?? source.businessName ?? "").trim();
  const match = index.byId.get(rawId.toLowerCase()) ??
    index.byName.get(rawName.toLowerCase());
  const id = rawId || String(match?.id ?? "").trim();
  const name = rawName || String(match?.name ?? "").trim() ||
    (id ? id : UNASSIGNED_BUSINESS_NAME);
  return {id, name};
}

function addToBucket(bucket, state, grossCents, feeCents) {
  bucket.records += 1;
  if (state === "earned") {
    bucket.earnedCents += feeCents;
    bucket.grossCents += grossCents;
    return;
  }
  if (state === "pending") {
    bucket.pendingCents += feeCents;
    bucket.grossCents += grossCents;
    return;
  }
  if (state === "notCommissionable") {
    bucket.notCommissionableCents += grossCents;
    bucket.grossCents += grossCents;
    return;
  }
  bucket.voidCents += grossCents;
}

function startOfUtcDay(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(),
      date.getUTCDate());
}

function startOfUtcMonth(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function utcDayKey(ms) {
  const date = new Date(ms);
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

function utcMonthKey(ms) {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-` +
    `${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function buildSeries(lines, undatedRecords) {
  if (lines.length === 0) {
    return {granularity: "day", points: [], undatedRecords};
  }
  // A loop, not Math.min(...spread): a platform-wide scan can hold more
  // lines than a call stack can take as arguments.
  let first = Infinity;
  let last = -Infinity;
  for (const line of lines) {
    if (line.ms < first) first = line.ms;
    if (line.ms > last) last = line.ms;
  }
  const spanDays = Math.floor((startOfUtcDay(new Date(last)) -
    startOfUtcDay(new Date(first))) / DAY_MS);
  const granularity = spanDays > MAX_DAILY_SPAN_DAYS ? "month" : "day";
  const keyOf = (ms) => granularity === "day" ? utcDayKey(ms) :
    utcMonthKey(ms);
  const buckets = new Map();
  const addPoint = (startMs) => {
    const key = keyOf(startMs);
    if (buckets.has(key)) return;
    const date = new Date(startMs);
    buckets.set(key, {
      key,
      label: granularity === "day" ?
        `${MONTH_LABELS[date.getUTCMonth()]} ${date.getUTCDate()}` :
        `${MONTH_LABELS[date.getUTCMonth()]} ${date.getUTCFullYear()}`,
      startMs,
      earnedCents: 0,
      pendingCents: 0,
    });
  };
  if (granularity === "day") {
    for (let ms = startOfUtcDay(new Date(first));
      ms <= startOfUtcDay(new Date(last)); ms += DAY_MS) {
      addPoint(ms);
      if (buckets.size >= MAX_POINTS) break;
    }
  } else {
    const end = startOfUtcMonth(new Date(last));
    let cursor = startOfUtcMonth(new Date(first));
    while (cursor <= end && buckets.size < MAX_POINTS) {
      addPoint(cursor);
      const at = new Date(cursor);
      cursor = Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1);
    }
  }
  for (const line of lines) {
    if (line.state !== "earned" && line.state !== "pending") continue;
    const date = new Date(line.ms);
    const startMs = granularity === "day" ? startOfUtcDay(date) :
      startOfUtcMonth(date);
    addPoint(startMs);
    const point = buckets.get(keyOf(startMs));
    if (!point) continue;
    if (line.state === "earned") point.earnedCents += line.feeCents;
    else point.pendingCents += line.feeCents;
  }
  const points = Array.from(buckets.values())
      .sort((a, b) => a.startMs - b.startMs);
  return {
    granularity,
    points: points.length > MAX_POINTS ?
      points.slice(points.length - MAX_POINTS) : points,
    undatedRecords,
  };
}

function sortBucketRows(rows) {
  return rows.sort((a, b) => {
    if (b.earnedCents !== a.earnedCents) return b.earnedCents - a.earnedCents;
    if (b.pendingCents !== a.pendingCents) {
      return b.pendingCents - a.pendingCents;
    }
    if (b.grossCents !== a.grossCents) return b.grossCents - a.grossCents;
    return String(a.name ?? a.label ?? "")
        .localeCompare(String(b.name ?? b.label ?? ""));
  });
}

/**
 * Every finance line reduced to what the roll-up needs, once. Summaries for
 * any focus are then a pass over these, so the server can answer a focus
 * change without re-reading the records.
 *
 * @param {object} input Record arrays plus `businesses` for names.
 * @return {Array<object>} Compact lines.
 */
function platformEarningsLines(input = {}) {
  const index = businessIndex(input.businesses);
  const lines = [];
  for (const item of earningsLineItems(input)) {
    const grossCents = toCents(item.gross);
    if (grossCents <= 0) continue;
    const business = resolveBusiness(item.row, item.source, index);
    const state = commissionState(item.row);
    const feeCents = state === "notCommissionable" || state === "void" ? 0 :
      Math.max(0, Math.min(grossCents,
          toCents(platformFeeAmount(item.row, item.gross))));
    const date = lineDate(item.row, item.source);
    lines.push({
      serviceId: item.serviceId,
      businessId: business.id,
      businessKey: business.id || `name:${business.name.toLowerCase()}`,
      businessName: business.name,
      state,
      grossCents,
      feeCents,
      ms: date ? date.getTime() : null,
    });
  }
  return lines;
}

/**
 * The platform's books over precomputed lines, optionally focused.
 *
 * @param {Array<object>} lines From platformEarningsLines.
 * @param {object} [focus] {businessKey, serviceId}.
 * @return {object} {totals, byBusiness, byService, series}.
 */
function summarizePlatformEarningsLines(lines, focus = {}) {
  const totals = emptyBucket();
  const businessBuckets = new Map();
  const serviceBuckets = new Map();
  const datedLines = [];
  let undatedRecords = 0;
  const focusBusinessKey = String(focus?.businessKey ?? "").trim();
  const focusServiceId = String(focus?.serviceId ?? "").trim();
  for (const line of lines) {
    if (focusBusinessKey && line.businessKey !== focusBusinessKey) continue;
    if (focusServiceId && line.serviceId !== focusServiceId) continue;
    addToBucket(totals, line.state, line.grossCents, line.feeCents);
    let businessRow = businessBuckets.get(line.businessKey);
    if (!businessRow) {
      businessRow = {businessId: line.businessId, key: line.businessKey,
        name: line.businessName, ...emptyBucket()};
      businessBuckets.set(line.businessKey, businessRow);
    }
    addToBucket(businessRow, line.state, line.grossCents, line.feeCents);
    let serviceRow = serviceBuckets.get(line.serviceId);
    if (!serviceRow) {
      serviceRow = {serviceId: line.serviceId,
        label: EARNINGS_SERVICE_LABELS[line.serviceId] ?? line.serviceId,
        ...emptyBucket()};
      serviceBuckets.set(line.serviceId, serviceRow);
    }
    addToBucket(serviceRow, line.state, line.grossCents, line.feeCents);
    if (line.ms != null) {
      datedLines.push({ms: line.ms, state: line.state,
        feeCents: line.feeCents});
    } else {
      undatedRecords += 1;
    }
  }
  return {
    totals,
    byBusiness: sortBucketRows(Array.from(businessBuckets.values())),
    byService: sortBucketRows(Array.from(serviceBuckets.values())),
    series: buildSeries(datedLines, undatedRecords),
  };
}

/**
 * Same signature and result as the console's summarizePlatformEarnings.
 *
 * @param {object} input Record arrays, businesses and optional focus.
 * @return {object} The summary.
 */
function summarizePlatformEarnings(input = {}) {
  return summarizePlatformEarningsLines(platformEarningsLines(input),
      input.focus || {});
}

// ---------------------------------------------------------------------------
// Business overview - mirrors admin_web/src/lib/business-overview.ts.
// ---------------------------------------------------------------------------

const CLOSED_STATUSES = Object.freeze(["", "completed", "cancelled", "sold",
  "inactive", "refunded", "rejected", "resolved", "closed"]);
const CLOSED_STATUS_SET = new Set(CLOSED_STATUSES);

function isOpenStatus(value) {
  return !CLOSED_STATUS_SET.has(String(value ?? "").trim().toLowerCase());
}

function purchaseStatusOf(row) {
  const value = String(row.purchaseStatus ?? row.status ?? "").trim();
  return value || "pending";
}

function topStatuses(rows, field) {
  const counts = new Map();
  rows.forEach((row) => {
    const raw = String(row[field] ?? "").trim();
    const value = (raw || "unknown").toLowerCase();
    counts.set(value, (counts.get(value) ?? 0) + 1);
  });
  return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
}

/**
 * Everything the business Today tab totals: headline counts, the analytics
 * breakdowns and the earnings by service.
 *
 * @param {object} input {cars, purchases, shipments, freightShipments,
 *   transports, parkedCars, support}.
 * @return {object} The overview.
 */
function businessOverviewSummary(input = {}) {
  const list = (rows) => Array.isArray(rows) ? rows : [];
  const cars = list(input.cars);
  const purchases = list(input.purchases);
  const shipments = list(input.shipments);
  const freightShipments = list(input.freightShipments);
  const transports = list(input.transports);
  const parkedCars = list(input.parkedCars);
  const support = list(input.support);
  const activeCars = cars.filter((row) =>
    String(row.status ?? "").trim() === "active");
  return {
    metrics: {
      activeListings: activeCars.length,
      openShipments: [...shipments, ...freightShipments]
          .filter((row) => isOpenStatus(row.status)).length,
      pendingPurchases: purchases
          .filter((row) => isOpenStatus(purchaseStatusOf(row))).length,
      openSupport: support.filter((row) => isOpenStatus(row.status)).length,
      transports: transports.length,
      parkedCars: parkedCars.length,
    },
    listingBreakdown: topStatuses(cars, "status"),
    operationBreakdown: topStatuses(
        [...shipments, ...freightShipments, ...transports, ...parkedCars],
        "status"),
    purchaseBreakdown: topStatuses(purchases, "purchaseStatus"),
    activeInventoryValue: activeCars
        .reduce((sum, row) => sum + numericValue(row.price), 0),
    paidHoldValue: purchases.reduce((sum, row) =>
      sum + numericValue(row.depositAmount ?? row.holdDepositAmount), 0),
    earnings: summarizeBusinessEarnings({purchases, shipments,
      freightShipments, transports, parkedCars}),
  };
}

// ---------------------------------------------------------------------------
// Parking totals - mirrors admin_web/src/lib/business-parking-entry.ts.
// ---------------------------------------------------------------------------

function isBusinessEnteredParking(row) {
  return trimmed(row?.source, 40) === "business" ||
    row?.enteredByBusiness === true;
}

function businessParkingAmountDue(row) {
  const cents = Number(row?.amountDueCents ?? row?.totalCostCents);
  if (Number.isFinite(cents) && cents > 0) return Math.round(cents) / 100;
  const dollars = Number(row?.amountDue ?? row?.totalCost);
  return Number.isFinite(dollars) ? dollars : 0;
}

function businessParkingStayDays(row, now = new Date()) {
  const start = toDateOrNull(row?.parkingDate);
  if (!start) return 0;
  const end = toDateOrNull(row?.parkingEndDate) ?? now;
  const startDay = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(),
      start.getUTCDate());
  const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(),
      end.getUTCDate());
  const days = Math.round((endDay - startDay) / DAY_MS) + 1;
  const minimum = Number(row?.minimumDays) > 0 ? Number(row.minimumDays) : 1;
  return Math.max(minimum, days);
}

function businessParkingAccrued(row, now = new Date()) {
  const openEnded = !row?.parkingEndDate;
  if (!openEnded) return businessParkingAmountDue(row);
  const daily = Number(row?.dailyRate) || 0;
  return daily > 0 ? businessParkingStayDays(row, now) * daily : 0;
}

function businessParkingAmountPaid(row, now = new Date()) {
  const cents = Number(row?.amountPaidCents);
  if (Number.isFinite(cents) && cents > 0) return Math.round(cents) / 100;
  const status = trimmed(row?.paymentStatus, 40);
  if (status === "succeeded" || status === "paid") {
    return businessParkingAccrued(row, now);
  }
  return 0;
}

function businessParkingBalance(row, now = new Date()) {
  if (trimmed(row?.status, 40) === "cancelled") return 0;
  const owed = businessParkingAccrued(row, now) -
    businessParkingAmountPaid(row, now);
  return owed > 0 ? Math.round(owed * 100) / 100 : 0;
}

function businessParkingEndLabel(row, now = new Date()) {
  const end = toDateOrNull(row?.parkingEndDate);
  if (!end) return "Open-ended";
  const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(),
      end.getUTCDate());
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(),
      now.getUTCDate());
  return endDay < today ? "Ended" : "Ends";
}

function parkingPaymentCents(entry) {
  const cents = Number(entry.amountCents);
  if (Number.isFinite(cents) && cents > 0) return Math.round(cents);
  const dollars = Number(entry.amount);
  return Number.isFinite(dollars) && dollars > 0 ?
    Math.round(dollars * 100) : 0;
}

function zonedMonthKey(date, timeZone) {
  if (!date) return "";
  return zonedDayKey(date, timeZone).slice(0, 7);
}

/**
 * Additive parking partials over a set of rows. Unrounded, so partials over
 * disjoint row sets can be added and rounded once (finishParkingSummary).
 *
 * @param {Array<object>} rows parkedCars documents.
 * @param {object} options {now, months, timeZone}.
 * @return {object} The partial.
 */
function parkingSummaryPartial(rows, {now = new Date(), months = [],
  timeZone = ""} = {}) {
  const index = new Map(months.map((m, i) => [m, i]));
  const partial = {inLot: 0, reserved: 0, left: 0, collected: 0, owed: 0,
    overdueCount: 0, overdueAmount: 0, records: 0,
    collectedByMonth: months.map(() => 0)};
  for (const row of Array.isArray(rows) ? rows : []) {
    partial.records += 1;
    const cancelled = trimmed(row?.status, 40) === "cancelled";
    const ended = businessParkingEndLabel(row, now) === "Ended";
    if (!cancelled && !ended) {
      if (isBusinessEnteredParking(row)) partial.inLot += 1;
      else partial.reserved += 1;
    }
    if (ended) partial.left += 1;
    const paid = businessParkingAmountPaid(row, now);
    const balance = businessParkingBalance(row, now);
    partial.collected += paid;
    partial.owed += balance;
    if (!cancelled && ended && balance > 0) {
      partial.overdueCount += 1;
      partial.overdueAmount += balance;
    }
    // Collected by the month the money arrived
    // (businessParkingCollectedByMonth).
    const collectedCents = Math.round(paid * 100);
    if (collectedCents <= 0 || months.length === 0) continue;
    const payments = (Array.isArray(row?.parkingPayments) ?
      row.parkingPayments : [])
        .map((item) => item ?? {})
        .map((entry) => ({cents: parkingPaymentCents(entry),
          at: toDateOrNull(entry.at)}))
        .filter((entry) => entry.cents > 0)
        .sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));
    let documented = 0;
    for (const entry of payments) {
      const cents = Math.min(entry.cents, collectedCents - documented);
      if (cents <= 0) break;
      documented += cents;
      const slot = index.get(zonedMonthKey(entry.at, timeZone));
      if (slot !== undefined) partial.collectedByMonth[slot] += cents;
    }
    const remainder = collectedCents - documented;
    if (remainder <= 0) continue;
    const settledOn = toDateOrNull(row?.directPaymentReceivedAt) ??
      toDateOrNull(row?.paidAt) ?? toDateOrNull(row?.updatedAt) ??
      toDateOrNull(row?.createdAt);
    const slot = index.get(zonedMonthKey(settledOn, timeZone));
    if (slot !== undefined) partial.collectedByMonth[slot] += remainder;
  }
  return partial;
}

/**
 * Two partials over disjoint rows, as one.
 *
 * @param {object} a A partial.
 * @param {object} b A partial over the same months.
 * @return {object} The sum.
 */
function combineParkingPartials(a, b) {
  const months = Math.max(a.collectedByMonth.length,
      b.collectedByMonth.length);
  return {
    inLot: a.inLot + b.inLot,
    reserved: a.reserved + b.reserved,
    left: a.left + b.left,
    collected: a.collected + b.collected,
    owed: a.owed + b.owed,
    overdueCount: a.overdueCount + b.overdueCount,
    overdueAmount: a.overdueAmount + b.overdueAmount,
    records: a.records + b.records,
    collectedByMonth: Array.from({length: months}, (_, i) =>
      (a.collectedByMonth[i] || 0) + (b.collectedByMonth[i] || 0)),
  };
}

/**
 * The finished parking figures, shaped like the console's
 * businessParkingTotals / businessParkingOverdue /
 * businessParkingCollectedByMonth results.
 *
 * @param {object} partial A (combined) partial.
 * @param {number} spacesTotal The lot's spaces.
 * @return {object} {totals, overdue, collectedByMonth, records}.
 */
function finishParkingSummary(partial, spacesTotal = 0) {
  return {
    totals: {
      inLot: partial.inLot,
      reserved: partial.reserved,
      left: partial.left,
      collected: Math.round(partial.collected * 100) / 100,
      owed: Math.round(partial.owed * 100) / 100,
      spacesTotal: Math.max(0, Math.trunc(Number(spacesTotal) || 0)),
      spacesUsed: partial.inLot + partial.reserved,
    },
    overdue: {
      count: partial.overdueCount,
      amount: Math.round(partial.overdueAmount * 100) / 100,
    },
    collectedByMonth: partial.collectedByMonth,
    records: partial.records,
  };
}

// ---------------------------------------------------------------------------
// Lot ledger - mirrors admin_web/src/lib/lot-ledger.ts and the panel's
// month/revenue reads in operations-panels.tsx (LotLedgerPanel).
// ---------------------------------------------------------------------------

const LOT_CUSTOM_ACTIVITY_ID = "custom";

function rowCents(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function lotPaymentStatus(row) {
  return String(row?.paymentStatus ?? "").trim();
}

function lotActivityPaidCents(row) {
  const stored = rowCents(row?.amountPaidCents);
  if (stored > 0) return stored;
  if (lotPaymentStatus(row) === "succeeded") return rowCents(row?.feeCents);
  return 0;
}

function lotActivityCounts(row) {
  return row?.voided !== true && lotPaymentStatus(row) !== "cancelled";
}

function lotSettledPaidCents(row) {
  const paid = lotActivityPaidCents(row);
  if (lotPaymentStatus(row) !== "succeeded") return paid;
  return Math.max(paid, rowCents(row?.feeCents));
}

// The activity's month, as the panel's lotRowMonth(row, "activityDate").
function lotActivityMonth(row) {
  const explicit = String(row?.activityDateMonth ?? "").trim();
  if (explicit) return explicit;
  const date = asDate(row?.activityDate);
  if (!date) return "";
  return `${date.getUTCFullYear()}-` +
    `${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Local `yyyy-mm-dd` of a stored date (lot-ledger.ts dateInputValue).
function lotDateInputValue(value, timeZone) {
  const date = asDate(value);
  if (!date || Number.isNaN(date.getTime())) return "";
  return zonedDayKey(date, timeZone);
}

function lotPaymentMonth(payment, timeZone) {
  const explicit = String(payment?.paidAtMonth ?? "").trim().slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(explicit)) return explicit;
  return lotDateInputValue(payment?.createdAt, timeZone).slice(0, 7);
}

function lotExpenseEntryMonth(entry, timeZone) {
  const explicit = String(entry?.month ?? "").trim().slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(explicit)) return explicit;
  return lotDateInputValue(entry?.spentAt, timeZone).slice(0, 7);
}

function fixedLineAppliesTo(line, month, nowMonth, timeZone) {
  if (String(line?.kind ?? "") !== "fixed") return false;
  if (line?.active === false) return false;
  if (month > nowMonth) return false;
  const from = lotDateInputValue(line?.createdAt, timeZone).slice(0, 7);
  if (from && month < from) return false;
  return true;
}

/**
 * What one month cost (lotMonthExpenseCents).
 *
 * @param {Array<object>} lines Expense lines.
 * @param {Array<object>} entries Expense entries.
 * @param {string} month "yyyy-mm".
 * @param {string} nowMonth The viewer's current "yyyy-mm".
 * @param {string} timeZone The viewer's zone.
 * @return {number} Cents.
 */
function lotMonthExpenseCents(lines, entries, month, nowMonth, timeZone) {
  const live = (entries || []).filter((e) => e?.voided !== true);
  let sum = 0;
  for (const entry of live) {
    if (lotExpenseEntryMonth(entry, timeZone) === month) {
      sum += Number(entry?.amountCents) || 0;
    }
  }
  for (const line of lines || []) {
    if (!fixedLineAppliesTo(line, month, nowMonth, timeZone)) continue;
    const lineId = String(line?.id ?? "");
    const logged = live.some((e) => String(e?.lineId ?? "") === lineId &&
      lotExpenseEntryMonth(e, timeZone) === month);
    if (logged) continue;
    sum += Number(line?.recurringCents) || 0;
  }
  return sum;
}

/**
 * The Activity tab's summary cards (lotActivityScoreboard).
 *
 * @param {object} input {activities, payments, inRange(month), timeZone}.
 * @return {object} {generatedCents, collectedCents, owedCents, jobs}.
 */
function lotActivityScoreboard({activities = [], payments = [], inRange,
  timeZone = ""}) {
  const byId = new Map();
  for (const row of activities) byId.set(String(row?.id ?? ""), row);
  const documented = new Map();
  let collectedCents = 0;
  for (const payment of payments) {
    const activityId = String(payment?.activityId ?? "");
    const activity = byId.get(activityId);
    if (!activity || !lotActivityCounts(activity)) continue;
    if (payment?.reverted === true) continue;
    const cents = rowCents(payment?.amountCents);
    documented.set(activityId, (documented.get(activityId) ?? 0) + cents);
    if (inRange(lotPaymentMonth(payment, timeZone))) collectedCents += cents;
  }
  let generatedCents = 0;
  let owedCents = 0;
  let jobs = 0;
  for (const row of activities) {
    if (!lotActivityCounts(row)) continue;
    if (!inRange(lotActivityMonth(row))) continue;
    const fee = rowCents(row?.feeCents);
    const paid = lotSettledPaidCents(row);
    generatedCents += fee;
    owedCents += Math.max(0, fee - paid);
    jobs += 1;
    const undocumented = paid - (documented.get(String(row?.id ?? "")) ?? 0);
    if (undocumented > 0) collectedCents += undocumented;
  }
  return {generatedCents, collectedCents, owedCents, jobs};
}

// "yyyy-mm" keys for every month of `year`.
function yearMonthKeys(year) {
  return Array.from({length: 12}, (_, i) =>
    `${year}-${String(i + 1).padStart(2, "0")}`);
}

/**
 * Everything the lot ledger's Activity, Expenses and Reports tabs total.
 * Revenue is the fee of every activity that was not cancelled or voided,
 * by the activity's own month - the same reads as LotLedgerPanel.
 *
 * @param {object} input {activities, payments, expenseLines,
 *   expenseEntries, rangeStart, rangeEnd, month, year, nowMonth, timeZone}.
 * @return {object} The ledger totals.
 */
function lotLedgerTotals(input) {
  const {activities = [], payments = [], expenseLines = [],
    expenseEntries = [], rangeStart, rangeEnd, month, year, nowMonth,
    timeZone = ""} = input;
  const billable = (row) => String(row?.paymentStatus) !== "cancelled" &&
    row?.voided !== true;
  const typeKey = (row) =>
    String(row?.activityTypeId) === LOT_CUSTOM_ACTIVITY_ID ?
      "custom" : String(row?.activityTypeId);
  const months = yearMonthKeys(year);
  const monthIndex = new Map(months.map((m, i) => [m, i]));
  const monthRevenueByType = {};
  const yearRevenueByType = {};
  const yearRevenueByMonth = months.map(() => 0);
  for (const row of activities) {
    if (!billable(row)) continue;
    const mk = lotActivityMonth(row);
    const fee = Number(row?.feeCents) || 0;
    if (mk === month) {
      const prev = monthRevenueByType[typeKey(row)] ?? {cents: 0, count: 0};
      monthRevenueByType[typeKey(row)] = {cents: prev.cents + fee,
        count: prev.count + 1};
    }
    if (mk.slice(0, 4) === String(year)) {
      yearRevenueByType[typeKey(row)] =
        (yearRevenueByType[typeKey(row)] ?? 0) + fee;
    }
    const slot = monthIndex.get(mk);
    if (slot !== undefined) yearRevenueByMonth[slot] += fee;
  }
  const monthRevenueCents = Object.values(monthRevenueByType)
      .reduce((sum, v) => sum + v.cents, 0);
  const yearExpenseByMonth = months.map((m) =>
    lotMonthExpenseCents(expenseLines, expenseEntries, m, nowMonth,
        timeZone));
  const monthExpenseCents = lotMonthExpenseCents(expenseLines, expenseEntries,
      month, nowMonth, timeZone);
  const scoreboard = lotActivityScoreboard({
    activities, payments, timeZone,
    inRange: (mk) => Boolean(mk) && mk >= rangeStart && mk <= rangeEnd,
  });
  return {
    scoreboard,
    month,
    monthRevenueCents,
    monthRevenueByType,
    monthExpenseCents,
    year,
    months,
    yearRevenueByMonth,
    yearRevenueByType,
    yearExpenseByMonth,
  };
}

// ---------------------------------------------------------------------------
// Invoice board - mirrors invoiceBoard in admin_web/src/lib/invoice-ledger.ts.
// ---------------------------------------------------------------------------

/**
 * The invoice scoreboard over rows (the definition the aggregates answer).
 *
 * @param {Array<object>} rows Invoice documents.
 * @param {string} today "yyyy-mm-dd" in the viewer's calendar.
 * @return {object} {open, overdue, owedCents, collectedCents, count}.
 */
function invoiceBoard(rows, today) {
  let open = 0;
  let overdue = 0;
  let owedCents = 0;
  let collectedCents = 0;
  for (const row of rows || []) {
    collectedCents += Math.max(0, Number(row.paidCents) || 0);
    if (String(row.status ?? "").trim() === "paid") continue;
    open += 1;
    owedCents += Math.max(0, Number(row.balanceCents) || 0);
    if (invoiceIsOverdue({...row, status: "open"}, today)) overdue += 1;
  }
  return {open, overdue, owedCents, collectedCents,
    count: (rows || []).length};
}

/**
 * The aggregation queries that answer invoiceBoard without reading the
 * invoices: each is a set of filters on `invoices` (beside businessId) and
 * one count or sum. `invoice-board-aggregates` tests replay these filters in
 * memory and require invoiceBoard's numbers.
 *
 * @param {string} today "yyyy-mm-dd".
 * @return {Array<object>} {key, filters: [[field, op, value]], sum?}.
 */
function invoiceBoardAggregates(today) {
  return [
    {key: "count", filters: []},
    {key: "open", filters: [["status", "==", "open"]]},
    {key: "overdue", filters: [["status", "==", "open"],
      ["dueOn", ">", ""], ["dueOn", "<", today]]},
    {key: "owedCents", filters: [["status", "==", "open"]],
      sum: "balanceCents"},
    {key: "collectedCents", filters: [], sum: "paidCents"},
  ];
}

module.exports = {
  CLOSED_STATUSES,
  EARNINGS_SERVICE_LABELS,
  LOT_CUSTOM_ACTIVITY_ID,
  asDate,
  businessOverviewSummary,
  businessParkingAccrued,
  businessParkingAmountPaid,
  businessParkingBalance,
  businessParkingEndLabel,
  combineParkingPartials,
  commissionState,
  earningsLineItems,
  finishParkingSummary,
  invoiceBoard,
  invoiceBoardAggregates,
  isOpenStatus,
  lotActivityMonth,
  lotActivityScoreboard,
  lotLedgerTotals,
  lotMonthExpenseCents,
  normalizeTimeZone,
  parkingSummaryPartial,
  platformEarningsLines,
  platformFeeAmount,
  summarizeBusinessEarnings,
  summarizePlatformEarnings,
  summarizePlatformEarningsLines,
  yearMonthKeys,
  zonedDayKey,
};
