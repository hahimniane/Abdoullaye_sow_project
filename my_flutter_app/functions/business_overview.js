"use strict";

/**
 * The business Today page - the pure half (getBusinessOverview in
 * console_totals.js does the reading).
 *
 * Today answers "how is the business doing this month" from the work it
 * actually does, not only from what customers ordered online:
 *
 *   - Activity: packages and barrels received, cars shipped and containers
 *     sailed this month against last month, straight from the Volume rollup
 *     (`volumeMonthly`, volume_counts.js) - never counted a second way.
 *   - Containers in progress: the boxes still loading or at sea.
 *   - Needs attention: how many of each kind of work is waiting.
 *   - Money: every payment that landed this month - at the counter (package
 *     payments, invoice payments, lot jobs, parking, the shop) and online -
 *     by service and by method, and what customers still owe.
 *
 * Months are New York months, the same windows Volume and Bills use
 * (volume_counts.monthWindow). Money is whole US cents throughout.
 *
 * Every figure is worked out once per business (and cached); what one
 * viewer may see is cut from it by `todayForViewer`, so a staff member never
 * receives a number their sections do not already show them.
 */

const {
  businessParkingAmountPaid,
  commissionState,
  earningsLineItems,
  finishParkingSummary,
  isOpenStatus,
  lineDate,
  parkingSummaryPartial,
} = require("./console_summaries");
const {normalizeDirectPaymentMethod} = require("./business_parking_entry");
const {creditStanding, storeAccessOf} = require("./inventory");
const {
  VOLUME_TIME_ZONE,
  containerDisplayNumber,
  currentMonthKey,
  monthKeyOf,
  monthWindow,
  percentChange,
  previousMonth,
  rollupContainers,
  rollupNumbers,
  toDate,
} = require("./volume_counts");

const TODAY_TIME_ZONE = VOLUME_TIME_ZONE;

/**
 * The services that put goods on a container - mirrors `shippingServiceIds`
 * in admin_web/src/lib/business-sidebar.ts (a console test keeps the two in
 * step). Containers, Volume and the package queues exist only for these.
 */
const SHIPPING_SERVICES = Object.freeze(["barrelShipping", "freight",
  "carTransport", "carParking"]);

/** Containers still in the business's hands or at sea. */
const IN_PROGRESS_CONTAINER_STATUSES = Object.freeze(["loading", "shipped"]);
/** How many open containers the Today list shows. */
const CONTAINER_LIST_LIMIT = 5;

/** Where money comes from on Today, in display order. */
const MONEY_SERVICES = Object.freeze(["packages", "invoices", "lot",
  "parking", "shop", "online"]);
/** How it was paid. `online` is a card payment taken through Stripe. */
const MONEY_METHODS = Object.freeze(["cash", "zelle", "cashapp", "venmo",
  "check", "card_in_person", "online", "other"]);
const MONEY_METHOD_SET = new Set(MONEY_METHODS);
// Far beyond any real single payment ($1M); a corrupt row must not swamp
// the month.
const MAX_PAYMENT_CENTS = 100000000;

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);

/**
 * @param {*} value A count.
 * @return {number} A whole, non-negative count.
 */
function wholeCount(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * @param {*} value An amount in cents.
 * @return {number} Whole, non-negative cents within the payment cap.
 */
function centsOf(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_PAYMENT_CENTS) : 0;
}

// -------------------------------------------------------------------------
// Months.
// -------------------------------------------------------------------------

/**
 * This month and the one before, in New York time, with the instants they
 * cover. `startMs`..`endMs` spans both, for one read of two months.
 *
 * @param {Date} [now] The clock.
 * @return {object} {month, previousMonth, timeZone, current: {startMs,
 *   endMs}, previous: {startMs, endMs}, startMs, endMs, firstDay, lastDay}.
 */
function todayMonths(now = new Date()) {
  const month = currentMonthKey(now, TODAY_TIME_ZONE);
  const before = previousMonth(month);
  const current = monthWindow(month, TODAY_TIME_ZONE);
  const previous = monthWindow(before, TODAY_TIME_ZONE);
  return {
    month,
    previousMonth: before,
    timeZone: TODAY_TIME_ZONE,
    current,
    previous,
    startMs: previous.startMs,
    endMs: current.endMs,
    // Day keys bounding both months, for fields stored as "yyyy-mm-dd".
    firstDay: `${before}-01`,
    lastDay: `${month}-31`,
  };
}

/**
 * @param {*} value A Timestamp, Date, millis or ISO string.
 * @return {string} The New York month it falls in, "" when undated.
 */
function monthOfInstant(value) {
  const date = toDate(value);
  return date ? monthKeyOf(date, TODAY_TIME_ZONE) : "";
}

// -------------------------------------------------------------------------
// Who sees what.
// -------------------------------------------------------------------------

/**
 * What one viewer may see on Today. A section shows when the business offers
 * the service behind it and the viewer holds the permission that opens the
 * matching console tab - the tab each row links to. Money for the whole
 * business (collected, by method, the owed total) is for owners and
 * platform admins only: staff see a figure only where their own tab already
 * shows it.
 *
 * @param {object} user The caller's profile.
 * @param {Iterable<string>} services The business's enabled services.
 * @param {function(object, string): boolean} hasPermission index.js's
 *   hasBusinessPermission.
 * @return {object} Flags.
 */
function todayViewer(user, services, hasPermission) {
  const offers = new Set(services);
  const has = (section) => Boolean(user) && hasPermission(user, section);
  const shipping = SHIPPING_SERVICES.some((id) => offers.has(id));
  const access = storeAccessOf(user || {});
  return {
    finance: user?.role === "businessOwner" || user?.role === "admin",
    containers: shipping && has("containers"),
    barrels: offers.has("barrelShipping") && has("barrels"),
    freight: offers.has("freight") && has("freight"),
    transport: offers.has("carTransport") && has("transport"),
    purchases: offers.has("carSales") && has("purchases"),
    listings: offers.has("carSales") && has("listings"),
    parking: offers.has("carParking") && has("parking"),
    // Invoices have no service gate; "ledger" opens them too.
    invoices: has("invoices") || has("ledger"),
    // The shop's totals are every store's: staff tied to one store do not
    // see the others' sales anywhere else, so not here either.
    inventory: offers.has("inventory") && has("inventory") && access.all,
    support: has("support"),
  };
}

// -------------------------------------------------------------------------
// Activity (Volume rollup).
// -------------------------------------------------------------------------

/**
 * One month's activity from its stored rollup: what was received (by kind)
 * and what sailed. Cars shipped are the cars on the containers that sailed
 * that month.
 *
 * @param {object|null} doc A `volumeMonthly` document (or null).
 * @return {object} {pieces, packages, barrels, carsReceived, carsShipped,
 *   containersShipped, piecesShipped}.
 */
function activityOfRollup(doc) {
  const numbers = rollupNumbers(doc);
  const containers = rollupContainers(doc);
  // The rollup lists at most MAX_ROLLUP_CONTAINERS boxes; past that the
  // listed cars undercount, which a month never reaches in practice.
  const carsShipped = containers.reduce((sum, c) => sum + c.cars, 0);
  return {
    pieces: numbers.pieces,
    packages: numbers.packages,
    barrels: numbers.barrels,
    carsReceived: numbers.cars,
    carsShipped,
    containersShipped: numbers.containersShipped,
    piecesShipped: numbers.containerPieces,
  };
}

/**
 * This month against last month.
 *
 * @param {object|null} currentDoc This month's rollup.
 * @param {object|null} previousDoc Last month's rollup.
 * @return {object} {current, previous, change: {key: pct|null}}.
 */
function activityCompare(currentDoc, previousDoc) {
  const current = activityOfRollup(currentDoc);
  const previous = activityOfRollup(previousDoc);
  const change = {};
  for (const key of Object.keys(current)) {
    change[key] = percentChange(current[key], previous[key]);
  }
  return {current, previous, change};
}

// -------------------------------------------------------------------------
// Containers in progress.
// -------------------------------------------------------------------------

/**
 * The open containers, compact: loading ones first (newest first), then the
 * ones at sea (most recently sailed first).
 *
 * @param {Array<object>} rows Container documents ({id, ...}).
 * @param {number} [limit] How many to list.
 * @return {object} {loading, atSea, list, more}.
 */
function containersInProgress(rows, limit = CONTAINER_LIST_LIMIT) {
  const open = (Array.isArray(rows) ? rows : [])
      .filter((row) => row && IN_PROGRESS_CONTAINER_STATUSES
          .includes(text(row.status, 20)));
  const ms = (value) => toDate(value)?.getTime() ?? 0;
  open.sort((a, b) => {
    const rank = (row) => text(row.status, 20) === "loading" ? 0 : 1;
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    const at = (row) => rank(row) === 0 ? ms(row.createdAt) : ms(row.sailedAt);
    return at(b) - at(a) || String(a.id).localeCompare(String(b.id));
  });
  const loading = open.filter((row) => text(row.status, 20) === "loading")
      .length;
  return {
    loading,
    atSea: open.length - loading,
    list: open.slice(0, Math.max(0, limit)).map((row) => {
      const barrels = wholeCount(row.barrelCount);
      const cars = wholeCount(row.carCount);
      const packages = wholeCount(row.otherCount);
      return {
        id: text(row.id),
        name: containerDisplayNumber(row),
        status: text(row.status, 20),
        destination: text(row.destinationCountryName, 120),
        destinationCountryId: text(row.destinationCountryId, 60),
        pieces: barrels + cars + packages,
        barrels,
        cars,
        packages,
        lines: wholeCount(row.lineCount),
        sailedAtMs: ms(row.sailedAt) || null,
      };
    }),
    more: open.length > Math.max(0, limit),
  };
}

// -------------------------------------------------------------------------
// Money.
// -------------------------------------------------------------------------

/**
 * @param {*} raw A stored method ("Zelle", "card_in_person", "cash app"...).
 * @return {string} One of MONEY_METHODS.
 */
function moneyMethod(raw) {
  const value = text(raw, 40).toLowerCase();
  if (!value) return "other";
  if (value === "online" || value === "card" || value === "stripe" ||
      value === "payment_link") {
    return "online";
  }
  const direct = normalizeDirectPaymentMethod(value);
  return MONEY_METHOD_SET.has(direct) ? direct : "other";
}

/**
 * @return {object} An empty month: {totalCents, payments, byService,
 *   byMethod} with every key present.
 */
function emptyMoney() {
  return {
    totalCents: 0,
    payments: 0,
    byService: Object.fromEntries(MONEY_SERVICES.map((key) => [key, 0])),
    byMethod: Object.fromEntries(MONEY_METHODS.map((key) => [key, 0])),
  };
}

/**
 * Package payments at the counter (containerLinePayments). A request paid
 * online by card is written here when it is received, marked
 * `source: "card_order"` - that one is an online payment.
 *
 * @param {Array<object>} rows Payment documents.
 * @return {Array<object>} {month, cents, service, method}.
 */
function packagePaymentEntries(rows) {
  return (Array.isArray(rows) ? rows : [])
      .filter((row) => row && row.reverted !== true)
      .map((row) => ({
        month: monthOfInstant(row.createdAt),
        cents: centsOf(row.amountCents),
        service: "packages",
        method: text(row.source, 20) === "card_order" ? "online" :
          moneyMethod(row.method),
      }));
}

/**
 * Hand-recorded invoice payments, in the month of the day they were paid.
 *
 * @param {Array<object>} rows invoicePayments documents.
 * @return {Array<object>} Entries.
 */
function invoicePaymentEntries(rows) {
  return (Array.isArray(rows) ? rows : [])
      .filter((row) => row && row.reverted !== true)
      .map((row) => ({
        month: /^\d{4}-\d{2}-\d{2}$/.test(text(row.paidOn, 10)) ?
          text(row.paidOn, 7) : monthOfInstant(row.createdAt),
        cents: centsOf(row.amountCents),
        service: "invoices",
        method: moneyMethod(row.method),
      }));
}

/**
 * Lot job payments (lotActivityPayments), in the ledger's own month
 * (`paidAtMonth`). A card payment came through the job's payment link.
 *
 * @param {Array<object>} rows Payment documents.
 * @return {Array<object>} Entries.
 */
function lotPaymentEntries(rows) {
  return (Array.isArray(rows) ? rows : [])
      .filter((row) => row && row.reverted !== true && row.voided !== true)
      .map((row) => ({
        month: /^\d{4}-\d{2}$/.test(text(row.paidAtMonth, 7)) ?
          text(row.paidAtMonth, 7) : monthOfInstant(row.createdAt),
        cents: centsOf(row.amountCents),
        service: "lot",
        method: text(row.source, 10) === "card" ? "online" :
          moneyMethod(row.receivedVia),
      }));
}

/**
 * What the shop took at the counter: each sale's paid-now part (a credit
 * sale's later payments are their own rows), and the credit payments.
 * Voided sales and reverted payments took nothing.
 *
 * @param {Array<object>} sales inventorySales documents.
 * @param {Array<object>} creditPayments inventoryCreditPayments documents.
 * @return {Array<object>} Entries.
 */
function shopPaymentEntries(sales, creditPayments) {
  const out = [];
  for (const sale of Array.isArray(sales) ? sales : []) {
    if (!sale || sale.voided === true) continue;
    // A sale from before credit existed stores no paidNowCents: it was paid
    // in full, less nothing (summarizeSales reads it the same way).
    const paidNow = Number.isInteger(sale.paidNowCents) ?
      sale.paidNowCents :
      Math.max(0, wholeCount(sale.totalCents) -
        creditStanding(sale).creditCents);
    out.push({
      month: monthOfInstant(sale.createdAt),
      cents: centsOf(paidNow),
      service: "shop",
      method: moneyMethod(sale.paymentMethod),
    });
  }
  for (const row of Array.isArray(creditPayments) ? creditPayments : []) {
    if (!row || row.reverted === true) continue;
    out.push({
      month: monthOfInstant(row.createdAt),
      cents: centsOf(row.amountCents),
      service: "shop",
      method: moneyMethod(row.method),
    });
  }
  return out;
}

/**
 * Parking money by the month it arrived - the same attribution as the
 * Parking page (parkingSummaryPartial's collectedByMonth): the recorded
 * instalments first, capped at what the stay has been paid, then any
 * remainder on the day it was settled. The remainder of a stay settled by
 * hand carries the method staff chose; one paid through Stripe is online.
 *
 * @param {Array<object>} rows parkedCars documents.
 * @param {Date} [now] The clock (an open-ended stay accrues by the day).
 * @return {Array<object>} Entries.
 */
function parkingPaymentEntries(rows, now = new Date()) {
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row) continue;
    const collectedCents = Math.round(businessParkingAmountPaid(row, now) *
      100);
    if (collectedCents <= 0) continue;
    const payments = (Array.isArray(row.parkingPayments) ?
      row.parkingPayments : [])
        .map((entry) => entry ?? {})
        .map((entry) => ({
          cents: wholeCount(entry.amountCents) ||
            Math.round((Number(entry.amount) > 0 ? Number(entry.amount) : 0) *
              100),
          at: toDate(entry.at),
          method: moneyMethod(entry.receivedVia),
        }))
        .filter((entry) => entry.cents > 0)
        .sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));
    let documented = 0;
    for (const entry of payments) {
      const cents = Math.min(entry.cents, collectedCents - documented);
      if (cents <= 0) break;
      documented += cents;
      out.push({month: entry.at ? monthKeyOf(entry.at, TODAY_TIME_ZONE) : "",
        cents, service: "parking", method: entry.method});
    }
    const remainder = collectedCents - documented;
    if (remainder <= 0) continue;
    const settledOn = toDate(row.directPaymentReceivedAt) ??
      toDate(row.paidAt) ?? toDate(row.updatedAt) ?? toDate(row.createdAt);
    const byHand = row.directPaymentReceived === true ||
      Boolean(text(row.directPaymentMethod, 40));
    out.push({
      month: settledOn ? monthKeyOf(settledOn, TODAY_TIME_ZONE) : "",
      cents: remainder,
      service: "parking",
      method: byHand ? moneyMethod(row.directPaymentMethod) : "online",
    });
  }
  return out;
}

/**
 * Money customers paid online for marketplace orders - barrel and freight
 * shipments, transport, car holds - by the day it was collected. Only
 * what Stripe collected for the business counts (commissionState
 * "earned"); orders marked paid directly to the business are left out,
 * because the counter records that money where it was taken. Parking is
 * its own service (parkingPaymentEntries) and is not read here.
 *
 * @param {object} input {purchases, shipments, freightShipments,
 *   transports}.
 * @return {Array<object>} Entries.
 */
function onlineOrderEntries(input = {}) {
  const items = earningsLineItems({
    purchases: input.purchases,
    shipments: input.shipments,
    freightShipments: input.freightShipments,
    transports: input.transports,
  });
  const out = [];
  for (const item of items) {
    if (commissionState(item.row) !== "earned") continue;
    const date = lineDate(item.row, item.source);
    out.push({
      month: date ? monthKeyOf(date, TODAY_TIME_ZONE) : "",
      cents: Math.round(item.gross * 100),
      service: "online",
      method: "online",
    });
  }
  return out;
}

/**
 * Money entries added up for each of the given months.
 *
 * @param {Array<object>} entries {month, cents, service, method}.
 * @param {string[]} months The months wanted.
 * @return {Object<string, object>} An emptyMoney() per month.
 */
function moneyByMonth(entries, months) {
  const out = Object.fromEntries(months.map((month) => [month,
    emptyMoney()]));
  for (const entry of Array.isArray(entries) ? entries : []) {
    const bucket = out[entry?.month];
    const cents = centsOf(entry?.cents);
    if (!bucket || cents <= 0) continue;
    const service = MONEY_SERVICES.includes(entry.service) ?
      entry.service : "online";
    const method = MONEY_METHOD_SET.has(entry.method) ? entry.method : "other";
    bucket.totalCents += cents;
    bucket.payments += 1;
    bucket.byService[service] += cents;
    bucket.byMethod[method] += cents;
  }
  return out;
}

// -------------------------------------------------------------------------
// The page.
// -------------------------------------------------------------------------

/**
 * Everything Today shows, for the whole business. Each input is what one
 * read returned, or null when that read was not made (service off) or
 * failed; a failed read leaves its figure null - shown as unknown, never as
 * a false zero.
 *
 * @param {object} input The reads.
 * @return {object} The business's Today.
 */
function buildToday(input = {}) {
  const months = input.months || todayMonths(input.now || new Date());
  const now = input.now || new Date();
  const list = (rows) => Array.isArray(rows) ? rows : [];
  const has = (value) => value !== null && value !== undefined;
  const count = (value) => has(value) ? wholeCount(value) : null;
  const open = (rows, statusOf = (row) => row.status) => has(rows) ?
    list(rows).filter((row) => row && isOpenStatus(statusOf(row))).length :
    null;

  const activity = has(input.volume) ?
    activityCompare(input.volume.current, input.volume.previous) : null;
  const containers = has(input.containers) ?
    containersInProgress(input.containers) : null;

  const parkingRows = input.parkedCars;
  const parkingPartial = has(parkingRows) ?
    parkingSummaryPartial(list(parkingRows), {now}) : null;
  const parking = parkingPartial ?
    finishParkingSummary(parkingPartial, input.parkingSpaces).totals : null;

  const queues = {
    packageRequests: count(input.packageRequestsOpen),
    waitingPackages: count(input.waitingPackages),
    containersLoading: containers ? containers.loading : null,
    barrelOrders: open(input.shipments),
    freightOrders: open(input.freightShipments),
    carPurchases: open(input.purchases,
        (row) => text(row.purchaseStatus ?? row.status) || "pending"),
    transportRequests: open(input.transports),
    supportRequests: open(input.support),
    openInvoices: has(input.invoicesOwed) ?
      wholeCount(input.invoicesOwed.count) : null,
  };

  const lineOwed = input.linesOwed;
  const owed = {
    packagesCents: has(lineOwed) ? Math.max(0,
        centsOfSum(lineOwed.priceCents) - centsOfSum(lineOwed.paidCents)) :
      null,
    invoicesCents: has(input.invoicesOwed) ?
      centsOfSum(input.invoicesOwed.balanceCents) : null,
    parkingCents: parkingPartial ?
      Math.round(Math.max(0, parkingPartial.owed) * 100) : null,
    shopCreditCents: has(input.shopCreditOwed) ? Math.max(0,
        centsOfSum(input.shopCreditOwed.creditCents) -
        centsOfSum(input.shopCreditOwed.creditPaidCents)) : null,
  };

  const monthKeys = [months.month, months.previousMonth];
  const sources = {
    packages: has(input.packagePayments) ?
      packagePaymentEntries(input.packagePayments) : null,
    invoices: has(input.invoicePayments) ?
      invoicePaymentEntries(input.invoicePayments) : null,
    lot: has(input.lotPayments) ? lotPaymentEntries(input.lotPayments) : null,
    parking: has(parkingRows) ? parkingPaymentEntries(parkingRows, now) : null,
    shop: has(input.shopSales) || has(input.shopCreditPayments) ?
      shopPaymentEntries(input.shopSales, input.shopCreditPayments) : null,
    online: onlineOrderEntries({
      purchases: input.purchases, shipments: input.shipments,
      freightShipments: input.freightShipments, transports: input.transports,
    }),
  };
  const entries = Object.values(sources).filter(Boolean).flat();
  const byMonth = moneyByMonth(entries, monthKeys);
  const money = {
    current: byMonth[months.month],
    previous: byMonth[months.previousMonth],
    change: percentChange(byMonth[months.month].totalCents,
        byMonth[months.previousMonth].totalCents),
  };

  const shopSales = has(input.shopSales) ? (() => {
    const counts = Object.fromEntries(monthKeys.map((m) => [m, 0]));
    for (const sale of list(input.shopSales)) {
      if (!sale || sale.voided === true) continue;
      const month = monthOfInstant(sale.createdAt);
      if (month in counts) counts[month] += 1;
    }
    return {current: counts[months.month],
      previous: counts[months.previousMonth],
      change: percentChange(counts[months.month],
          counts[months.previousMonth])};
  })() : null;

  return {
    month: months.month,
    previousMonth: months.previousMonth,
    timeZone: months.timeZone,
    activity,
    containers,
    queues,
    owed,
    money,
    shop: shopSales,
    parking: parking ? {inLot: parking.inLot, reserved: parking.reserved,
      spacesTotal: parking.spacesTotal} : null,
    listings: has(input.cars) ? {
      active: list(input.cars).filter((row) =>
        text(row.status, 20) === "active").length,
    } : null,
    // The reads that failed or stopped early: their figures are missing or
    // short, and the page says so.
    unavailable: [...new Set(Array.isArray(input.unavailable) ?
      input.unavailable.map((name) => text(name, 40)).filter(Boolean) :
      [])].sort(),
  };
}

/**
 * @param {*} value An aggregate sum (may be null or fractional).
 * @return {number} Whole non-negative cents (no per-payment cap: a sum).
 */
function centsOfSum(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const QUEUE_GATES = Object.freeze({
  packageRequests: "containers",
  waitingPackages: "containers",
  containersLoading: "containers",
  barrelOrders: "barrels",
  freightOrders: "freight",
  carPurchases: "purchases",
  transportRequests: "transport",
  supportRequests: "support",
  openInvoices: "invoices",
});

const OWED_GATES = Object.freeze({
  packagesCents: "containers",
  invoicesCents: "invoices",
  parkingCents: "parking",
  shopCreditCents: "inventory",
});

/**
 * Today as one viewer may see it: a queue or a balance only when they may
 * open the tab it links to, the activity and containers with the
 * Containers permission, the business's money (collected, by method, the
 * owed total) only for owners and admins. What is cut is absent (null),
 * never zero.
 *
 * @param {object} today buildToday's result.
 * @param {object} viewer todayViewer's flags.
 * @return {object} The viewer's Today.
 */
function todayForViewer(today, viewer) {
  const v = viewer || {};
  const pick = (source, gates) => Object.fromEntries(
      Object.entries(gates).map(([key, gate]) =>
        [key, v[gate] ? source?.[key] ?? null : null]));
  const owed = pick(today.owed, OWED_GATES);
  const parts = Object.values(owed).filter((n) => n !== null);
  return {
    month: today.month,
    previousMonth: today.previousMonth,
    timeZone: today.timeZone,
    viewer: {...v},
    activity: v.containers ? today.activity : null,
    containers: v.containers ? today.containers : null,
    queues: pick(today.queues, QUEUE_GATES),
    owed: {
      ...owed,
      // What the whole business is owed: owners and admins only.
      totalCents: v.finance && parts.length > 0 ?
        parts.reduce((sum, n) => sum + n, 0) : null,
    },
    money: v.finance ? today.money : null,
    shop: v.inventory ? today.shop : null,
    parking: v.parking ? today.parking : null,
    listings: v.listings ? today.listings : null,
    unavailable: Array.isArray(today.unavailable) ? today.unavailable : [],
  };
}

module.exports = {
  CONTAINER_LIST_LIMIT,
  IN_PROGRESS_CONTAINER_STATUSES,
  MONEY_METHODS,
  MONEY_SERVICES,
  SHIPPING_SERVICES,
  TODAY_TIME_ZONE,
  activityCompare,
  activityOfRollup,
  buildToday,
  containersInProgress,
  emptyMoney,
  invoicePaymentEntries,
  lotPaymentEntries,
  moneyByMonth,
  moneyMethod,
  onlineOrderEntries,
  packagePaymentEntries,
  parkingPaymentEntries,
  shopPaymentEntries,
  todayForViewer,
  todayMonths,
  todayViewer,
};
