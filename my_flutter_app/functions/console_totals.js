"use strict";

/**
 * Callables that answer the consoles' totals from every record.
 *
 * The consoles' lists are ordered and paged; a page is not a basis for a
 * total. These handlers count with Firestore aggregation queries where the
 * figure is a plain count or sum of a stored field, and page through the
 * records with a cursor where the figure needs per-document math (a stay's
 * balance accrues by the day; an earnings line reads one of several money
 * fields). The math is console_summaries.js, held to the console's own
 * modules by a parity test.
 *
 * Everything Firebase-specific arrives through `deps`, so index.js keeps only
 * a one-line export per callable and this file stays self-contained.
 *
 * Read cost is bounded two ways: scans only touch the collections the screen
 * actually totals, and expensive summaries are cached in
 * `consoleSummaryCache/{key}` (server-only; no rule lets a client near it)
 * for a few minutes, so a busy Today tab costs one scan per window rather
 * than one per visit. A cached answer says when it was computed, and a
 * caller may ask for a fresh one once the cache is a minute old.
 */

const {
  CLOSED_STATUSES,
  businessOverviewSummary,
  combineParkingPartials,
  finishParkingSummary,
  invoiceBoardAggregates,
  lotLedgerTotals,
  normalizeTimeZone,
  parkingSummaryPartial,
  platformEarningsLines,
  summarizePlatformEarningsLines,
  yearMonthKeys,
  zonedDayKey,
} = require("./console_summaries");
const crypto = require("node:crypto");
const {drainPages} = require("./scheduled_sweep");

const CACHE_COLLECTION = "consoleSummaryCache";
/** Bumped when a cached payload's shape or math changes. */
const CACHE_VERSION = 1;
const OVERVIEW_TTL_MS = 10 * 60 * 1000;
const PARKING_ENDED_TTL_MS = 15 * 60 * 1000;
const PLATFORM_TTL_MS = 10 * 60 * 1000;
/** A forced refresh is honoured only once the cache is at least this old. */
const MIN_REFRESH_AGE_MS = 60 * 1000;
const SCAN_PAGE_SIZE = 500;
/** Leave room inside the callable's timeout for the answer itself. */
const SCAN_BUDGET_MS = 90 * 1000;
const IN_BATCH = 30;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const ADMIN_STATUS_VOCABULARY = Object.freeze({
  businesses: ["pending", "approved", "suspended", "changes_requested",
    "rejected"],
  cars: ["active", "inactive", "reserved", "sold"],
  barrelShipments: ["pending_payment", "pending", "in_transit",
    "ready_for_pickup", "completed", "cancelled"],
  freightShipments: ["pending_payment", "pending", "in_transit",
    "ready_for_pickup", "completed", "cancelled"],
  carPurchases: ["pending", "viewing_scheduled", "reserved", "completed",
    "cancelled", "no_show", "refunded", "forfeited"],
  roles: ["admin", "businessOwner", "staff", "customer"],
});

// ---------------------------------------------------------------------------
// Pure input checks (exported for tests).
// ---------------------------------------------------------------------------

/**
 * A "yyyy-mm" or the fallback.
 *
 * @param {*} value Input.
 * @param {string} fallback Used when the input is not a month.
 * @return {string} A month key.
 */
function monthOr(value, fallback) {
  const month = String(value || "").trim();
  return MONTH_RE.test(month) ? month : fallback;
}

/**
 * The ledger request, normalized: an inclusive span (swapped when given
 * backwards, never more than 36 months), the report month and year, the
 * viewer's current month and zone.
 *
 * @param {object} data Callable input.
 * @param {Date} now The clock.
 * @return {object} The normalized request.
 */
function normalizeLedgerRequest(data, now = new Date()) {
  const timeZone = normalizeTimeZone(data?.timeZone);
  const today = zonedDayKey(now, timeZone);
  const nowMonth = monthOr(data?.nowMonth, today.slice(0, 7));
  let rangeStart = monthOr(data?.rangeStart, nowMonth);
  let rangeEnd = monthOr(data?.rangeEnd, rangeStart);
  if (rangeStart > rangeEnd) [rangeStart, rangeEnd] = [rangeEnd, rangeStart];
  if (monthSpan(rangeStart, rangeEnd) > 36) {
    throw Object.assign(new Error("The date range is too long."),
        {code: "invalid-argument"});
  }
  const month = monthOr(data?.month, nowMonth);
  const yearNumber = Math.trunc(Number(data?.year));
  const year = yearNumber >= 2000 && yearNumber <= 2100 ?
    yearNumber : Number(month.slice(0, 4));
  const bounds = [rangeStart, rangeEnd, month, `${year}-01`, `${year}-12`]
      .sort();
  return {timeZone, nowMonth, rangeStart, rangeEnd, month, year,
    readFrom: bounds[0], readThrough: bounds[bounds.length - 1]};
}

/** Longer encoded keys are hashed; Firestore allows 1,500 bytes. */
const MAX_CACHE_DOC_ID_LENGTH = 400;

/**
 * The cache document id for a key built from request input.
 *
 * Keys carry the viewer's IANA zone ("America/New_York") and ids the caller
 * sent, and "/" separates path segments in Firestore: an unencoded key
 * pointed `doc()` at a collection, so every lot ledger total failed for a
 * business viewed from such a zone. Percent-encoding leaves plain keys as
 * they were (existing cache entries still hit) and readable; anything that
 * is still too long, or would be empty, is hashed.
 *
 * @param {string} key The logical cache key.
 * @return {string} One valid document id.
 */
function cacheDocId(key) {
  const raw = String(key ?? "");
  const encoded = encodeURIComponent(raw);
  if (encoded && encoded.length <= MAX_CACHE_DOC_ID_LENGTH &&
      encoded !== "." && encoded !== ".." && !/^__.*__$/.test(encoded)) {
    return encoded;
  }
  return `h_${crypto.createHash("sha256").update(raw).digest("hex")}`;
}

function monthSpan(a, b) {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am) + 1;
}

/**
 * [start, end) in UTC milliseconds for "yyyy-mm" .. "yyyy-mm" inclusive.
 *
 * @param {string} fromMonth First month.
 * @param {string} throughMonth Last month.
 * @return {{startMs: number, endMs: number}} Bounds.
 */
function monthRangeMs(fromMonth, throughMonth) {
  const [fy, fm] = fromMonth.split("-").map(Number);
  const [ty, tm] = throughMonth.split("-").map(Number);
  return {startMs: Date.UTC(fy, fm - 1, 1), endMs: Date.UTC(ty, tm, 1)};
}

// Midnight UTC of `now`'s day - the "ended" boundary of a stay.
function startOfUtcDayMs(now) {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function chunks(values, size = IN_BATCH) {
  const out = [];
  for (let i = 0; i < values.length; i += size) {
    out.push(values.slice(i, i + size));
  }
  return out;
}

/**
 * Admin counts for a status field, completed with "other" so the buckets
 * always add back up to the total.
 *
 * @param {number} total Every document.
 * @param {object} counts Count per known status.
 * @return {object} counts plus `other` when anything is unaccounted for.
 */
function withOther(total, counts) {
  const known = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const other = Math.max(0, total - known);
  return other > 0 ? {...counts, other} : {...counts};
}

// ---------------------------------------------------------------------------
// Handlers.
// ---------------------------------------------------------------------------

/**
 * @param {object} deps Firebase pieces and index.js permission helpers.
 * @return {object} Callable handlers keyed by export name.
 */
function createConsoleTotalsHandlers(deps) {
  const {
    admin,
    HttpsError,
    logger,
    requireAuth,
    requireBusinessManager,
    requireBusinessPermission,
    hasBusinessPermission,
    getUserProfile,
    hasAdminCapability,
    hasAdminSectionAccess = () => false,
    normalizeBusinessServices,
    ensureParkingOccupancyIndexed,
    now = () => new Date(),
  } = deps;
  const db = () => admin.firestore();

  function businessIdFrom(request) {
    const businessId = String(request.data?.businessId || "").trim();
    if (!businessId) {
      throw new HttpsError("invalid-argument", "Missing business.");
    }
    return businessId;
  }

  function invalid(error) {
    if (error?.code === "invalid-argument") {
      throw new HttpsError("invalid-argument", error.message);
    }
    throw error;
  }

  /**
   * Every document a query matches, paged by cursor under a deadline.
   *
   * @param {object} query A Firestore query (ordering optional).
   * @param {number} deadlineMs Stop starting pages after this.
   * @return {Promise<{rows: Array<object>, complete: boolean}>} Rows.
   */
  async function readAll(query, deadlineMs) {
    const rows = [];
    const result = await drainPages({
      fetchPage: async (cursor) => {
        const page = cursor ? query.startAfter(cursor) : query;
        return (await page.limit(SCAN_PAGE_SIZE).get()).docs;
      },
      processPage: async (docs) => {
        for (const doc of docs) rows.push({id: doc.id, ...doc.data()});
      },
      pageSize: SCAN_PAGE_SIZE,
      deadlineMs,
      // The deadline was taken from this clock; measure it with the same one.
      now: () => now().getTime(),
    });
    return {rows, complete: result.exhausted};
  }

  async function readCache(key) {
    const snap = await db().collection(CACHE_COLLECTION)
        .doc(cacheDocId(key)).get();
    if (!snap.exists) return null;
    const data = snap.data() || {};
    if (data.version !== CACHE_VERSION) return null;
    try {
      return {computedAtMs: Number(data.computedAtMs) || 0,
        payload: JSON.parse(String(data.payloadJson || "null"))};
    } catch (_) {
      return null;
    }
  }

  async function writeCache(key, payload, computedAtMs) {
    try {
      await db().collection(CACHE_COLLECTION).doc(cacheDocId(key)).set({
        version: CACHE_VERSION,
        computedAtMs,
        payloadJson: JSON.stringify(payload),
      });
    } catch (error) {
      // A cache that cannot be written only costs the next caller a scan.
      logger.warn("Console summary cache not written", {key,
        error: String(error?.message || error)});
    }
  }

  // A cached payload while it is fresh, else `compute()` (stored for the
  // next caller). `refresh` skips a cache older than a minute.
  async function cached(key, ttlMs, refresh, compute) {
    const at = now().getTime();
    const hit = await readCache(key);
    if (hit) {
      const age = at - hit.computedAtMs;
      const fresh = age >= 0 && age < ttlMs;
      if (fresh && !(refresh && age >= MIN_REFRESH_AGE_MS)) {
        return {...hit.payload, computedAtMs: hit.computedAtMs, cached: true};
      }
    }
    const payload = await compute();
    if (payload.complete !== false) await writeCache(key, payload, at);
    return {...payload, computedAtMs: at, cached: false};
  }

  // ---- Business Today -----------------------------------------------------

  async function getBusinessOverview(request) {
    const uid = requireAuth(request);
    const businessId = businessIdFrom(request);
    const user = await requireBusinessManager(uid, businessId);
    const businessSnap = await db().collection("businesses")
        .doc(businessId).get();
    const services = new Set(
        normalizeBusinessServices(businessSnap.data()?.enabledServices));
    const withCars = hasBusinessPermission(user, "listings");
    const key = `businessOverview__${businessId}__${withCars ? "cars" : "-"}`;
    return cached(key, OVERVIEW_TTL_MS, request.data?.refresh === true,
        async () => {
          const deadline = now().getTime() + SCAN_BUDGET_MS;
          const scoped = (name) => db().collection(name)
              .where("businessId", "==", businessId);
          const none = {rows: [], complete: true};
          const [cars, purchases, shipments, freightShipments, transports,
            parkedCars, support] = await Promise.all([
            withCars ? readAll(scoped("cars"), deadline) : none,
            services.has("carSales") ?
              readAll(scoped("carPurchases"), deadline) : none,
            services.has("barrelShipping") ?
              readAll(scoped("barrelShipments"), deadline) : none,
            services.has("freight") ?
              readAll(scoped("freightShipments"), deadline) : none,
            services.has("carTransport") ?
              readAll(scoped("transportRequests"), deadline) : none,
            services.has("carParking") ?
              readAll(scoped("parkedCars"), deadline) : none,
            readAll(scoped("supportCases"), deadline),
          ]);
          const parts = [cars, purchases, shipments, freightShipments,
            transports, parkedCars, support];
          return {
            overview: businessOverviewSummary({
              cars: cars.rows,
              purchases: purchases.rows,
              shipments: shipments.rows,
              freightShipments: freightShipments.rows,
              transports: transports.rows,
              parkedCars: parkedCars.rows,
              support: support.rows,
            }),
            complete: parts.every((part) => part.complete),
          };
        });
  }

  // ---- Invoices -----------------------------------------------------------

  async function getInvoiceBoardTotals(request) {
    const uid = requireAuth(request);
    const businessId = businessIdFrom(request);
    await requireBusinessPermission(uid, businessId, "ledger");
    const today = DAY_RE.test(String(request.data?.today || "")) ?
      String(request.data.today) :
      zonedDayKey(now(), normalizeTimeZone(request.data?.timeZone));
    const base = db().collection("invoices")
        .where("businessId", "==", businessId);
    const {AggregateField} = require("firebase-admin/firestore");
    const results = await Promise.all(
        invoiceBoardAggregates(today).map(async (spec) => {
          let query = base;
          for (const [field, op, value] of spec.filters) {
            query = query.where(field, op, value);
          }
          const snap = await query.aggregate(spec.sum ?
            {value: AggregateField.sum(spec.sum)} :
            {value: AggregateField.count()}).get();
          return [spec.key, Number(snap.data().value) || 0];
        }));
    return {board: Object.fromEntries(results), today,
      computedAtMs: now().getTime()};
  }

  // ---- Parking ------------------------------------------------------------

  // The lot's parking figures over every stay. Stays that have ended do not
  // change as the days pass, so their partial is cached; stays still running
  // (and open-ended ones, which accrue daily) are read fresh every call. The
  // fresh read starts at the boundary the cached part was computed at, so a
  // stay that ended in between is in exactly one of the two.
  async function parkingSummaryFor(businessId, {timeZone, year, refresh,
    deadlineMs}) {
    await ensureParkingOccupancyIndexed(db(), businessId);
    const at = now();
    const months = yearMonthKeys(year);
    const options = {now: at, months, timeZone};
    const parked = db().collection("parkedCars")
        .where("businessId", "==", businessId);
    const key = `parkingEnded__${businessId}__${year}__${timeZone || "UTC"}`;
    const ended = await cached(key, PARKING_ENDED_TTL_MS, refresh,
        async () => {
          const boundaryMs = startOfUtcDayMs(at);
          const read = await readAll(
              parked.where("occupancyEndMs", "<", boundaryMs), deadlineMs);
          return {boundaryMs, complete: read.complete,
            partial: parkingSummaryPartial(read.rows, options)};
        });
    const active = await readAll(
        parked.where("occupancyEndMs", ">=", ended.boundaryMs), deadlineMs);
    const business = await db().collection("businesses").doc(businessId)
        .get();
    const summary = finishParkingSummary(
        combineParkingPartials(ended.partial,
            parkingSummaryPartial(active.rows, options)),
        Number(business.data()?.parkingTotalSpaces) || 0);
    return {...summary, months, year,
      complete: ended.complete !== false && active.complete,
      endedComputedAtMs: ended.computedAtMs};
  }

  async function getParkingTotals(request) {
    const uid = requireAuth(request);
    const businessId = businessIdFrom(request);
    await requireBusinessPermission(uid, businessId, "parking");
    const timeZone = normalizeTimeZone(request.data?.timeZone);
    const yearNumber = Math.trunc(Number(request.data?.year));
    const year = yearNumber >= 2000 && yearNumber <= 2100 ?
      yearNumber : Number(zonedDayKey(now(), timeZone).slice(0, 4));
    const parking = await parkingSummaryFor(businessId, {timeZone, year,
      refresh: request.data?.refresh === true,
      deadlineMs: now().getTime() + SCAN_BUDGET_MS});
    return {parking, computedAtMs: now().getTime()};
  }

  // ---- Lot ledger ---------------------------------------------------------

  async function getLotLedgerTotals(request) {
    const uid = requireAuth(request);
    const businessId = businessIdFrom(request);
    await requireBusinessPermission(uid, businessId, "ledger");
    let input;
    try {
      input = normalizeLedgerRequest(request.data || {}, now());
    } catch (error) {
      invalid(error);
    }
    const deadline = now().getTime() + SCAN_BUDGET_MS;
    const scoped = (name) => db().collection(name)
        .where("businessId", "==", businessId);
    const {startMs, endMs} = monthRangeMs(input.readFrom, input.readThrough);
    const {Timestamp} = require("firebase-admin/firestore");

    // Activities dated anywhere the span, the report month or the report
    // year can reach; payments that arrived in the span; the year's
    // purchases (and the ones logged without a bill month, dated by
    // spentAt in code); every expense line.
    const [activityRead, paymentRead, linesRead, entryRead, undatedEntries] =
      await Promise.all([
        readAll(scoped("lotActivities")
            .where("activityDate", ">=", Timestamp.fromMillis(startMs))
            .where("activityDate", "<", Timestamp.fromMillis(endMs))
            .orderBy("activityDate", "desc"), deadline),
        readAll(scoped("lotActivityPayments")
            .where("paidAtMonth", ">=", input.rangeStart)
            .where("paidAtMonth", "<=", input.rangeEnd)
            .orderBy("paidAtMonth"), deadline),
        readAll(scoped("lotExpenseLines"), deadline),
        readAll(scoped("lotExpenseEntries")
            .where("month", ">=", input.readFrom)
            .where("month", "<=", input.readThrough)
            .orderBy("month"), deadline),
        readAll(scoped("lotExpenseEntries").where("month", "==", ""),
            deadline),
      ]);

    // Payments against the span's jobs (wherever they arrived) explain how
    // much of each job's "paid" is documented; jobs paid in the span but
    // billed outside it are fetched so their payments can be attributed.
    const activities = new Map(activityRead.rows.map((r) => [r.id, r]));
    const payments = new Map(paymentRead.rows.map((r) => [r.id, r]));
    const ids = [...activities.keys()];
    for (const batch of chunks(ids)) {
      const snap = await db().collection("lotActivityPayments")
          .where("activityId", "in", batch).get();
      for (const doc of snap.docs) {
        if (doc.data()?.businessId !== businessId) continue;
        payments.set(doc.id, {id: doc.id, ...doc.data()});
      }
    }
    const missing = [...new Set([...payments.values()]
        .map((p) => String(p.activityId || ""))
        .filter((id) => id && !activities.has(id)))];
    for (const batch of chunks(missing, 100)) {
      const refs = batch.map((id) => db().collection("lotActivities").doc(id));
      const snaps = await db().getAll(...refs);
      for (const snap of snaps) {
        if (!snap.exists || snap.data()?.businessId !== businessId) continue;
        activities.set(snap.id, {id: snap.id, ...snap.data()});
      }
    }

    const totals = lotLedgerTotals({
      activities: [...activities.values()],
      payments: [...payments.values()],
      expenseLines: linesRead.rows,
      expenseEntries: [...entryRead.rows, ...undatedEntries.rows],
      rangeStart: input.rangeStart,
      rangeEnd: input.rangeEnd,
      month: input.month,
      year: input.year,
      nowMonth: input.nowMonth,
      timeZone: input.timeZone,
    });
    const parking = await parkingSummaryFor(businessId, {
      timeZone: input.timeZone, year: input.year,
      refresh: request.data?.refresh === true, deadlineMs: deadline});
    return {
      ledger: totals,
      parking,
      request: {rangeStart: input.rangeStart, rangeEnd: input.rangeEnd,
        month: input.month, year: input.year, nowMonth: input.nowMonth},
      complete: [activityRead, paymentRead, linesRead, entryRead,
        undatedEntries].every((part) => part.complete) && parking.complete,
      computedAtMs: now().getTime(),
    };
  }

  // ---- Admin Today --------------------------------------------------------

  async function countWhere(collectionName, filters = []) {
    let query = db().collection(collectionName);
    for (const [field, op, value] of filters) {
      query = query.where(field, op, value);
    }
    const snap = await query.count().get();
    return Number(snap.data().count) || 0;
  }

  async function countsBy(collectionName, field, values) {
    const [total, ...each] = await Promise.all([
      countWhere(collectionName),
      ...values.map((value) => countWhere(collectionName,
          [[field, "==", value]])),
    ]);
    return {total, counts: withOther(total,
        Object.fromEntries(values.map((value, i) => [value, each[i]])))};
  }

  // Business ids that business accounts point at with no business profile
  // behind them - the profiles an admin still has to create.
  async function missingBusinessProfiles() {
    const [accounts, businesses] = await Promise.all([
      db().collection("users")
          .where("role", "in", ["businessOwner", "staff"])
          .select("businessId").get(),
      db().collection("businesses").select().get(),
    ]);
    const known = new Set(businesses.docs.map((doc) => doc.id));
    const referenced = new Set(accounts.docs
        .map((doc) => String(doc.data()?.businessId || "").trim())
        .filter(Boolean));
    return [...referenced].filter((id) => !known.has(id)).length;
  }

  async function getAdminOverview(request) {
    const uid = requireAuth(request);
    const user = await getUserProfile(uid);
    // Today is every platform admin's landing tab, view-only roles included,
    // and its counts are what the rules already let any verified admin read
    // (isAdmin in firestore.rules): an admin profile and a verified email.
    const allowed = user?.role === "admin" &&
      request.auth?.token?.email_verified === true;
    if (!allowed) {
      throw new HttpsError("permission-denied",
          "Platform administrator permission required");
    }
    const vocab = ADMIN_STATUS_VOCABULARY;
    const [users, businesses, cars, barrels, freight, purchases,
      applicationsTotal, applicationsPending, missingProfiles] =
      await Promise.all([
        countsBy("users", "role", vocab.roles),
        countsBy("businesses", "status", vocab.businesses),
        countsBy("cars", "status", vocab.cars),
        countsBy("barrelShipments", "status", vocab.barrelShipments),
        countsBy("freightShipments", "status", vocab.freightShipments),
        countsBy("carPurchases", "purchaseStatus", vocab.carPurchases),
        countWhere("businessApplications"),
        countWhere("businessApplications", [["status", "==", "pending"]]),
        missingBusinessProfiles(),
      ]);
    return {
      users,
      businesses,
      cars,
      barrelShipments: barrels,
      freightShipments: freight,
      purchases,
      applications: {total: applicationsTotal, pending: applicationsPending},
      missingProfiles,
      computedAtMs: now().getTime(),
    };
  }

  // ---- Admin finance: platform earnings ------------------------------------

  // Lines are compact and focus changes re-summarize them, so a warm
  // instance answers a click on a business or service without a re-read.
  let platformLines = null;

  async function getPlatformEarnings(request) {
    const uid = requireAuth(request);
    const user = await getUserProfile(uid);
    // Anyone who may open the Finance tab: the finance capability (manage)
    // or view access to the finance section.
    if (!hasAdminCapability(user, "finance") &&
        !hasAdminSectionAccess(user, "finance", "view")) {
      throw new HttpsError("permission-denied",
          "Only finance admins can read platform earnings");
    }
    const at = now().getTime();
    const refresh = request.data?.refresh === true;
    const stale = !platformLines || at - platformLines.computedAtMs >=
      PLATFORM_TTL_MS || (refresh &&
        at - platformLines.computedAtMs >= MIN_REFRESH_AGE_MS);
    if (stale) {
      const deadline = at + SCAN_BUDGET_MS;
      const all = (name) => readAll(db().collection(name), deadline);
      const [purchases, shipments, freightShipments, transports, parkedCars,
        businesses] = await Promise.all([
        all("carPurchases"), all("barrelShipments"), all("freightShipments"),
        all("transportRequests"), all("parkedCars"),
        readAll(db().collection("businesses").select("name"), deadline),
      ]);
      const parts = [purchases, shipments, freightShipments, transports,
        parkedCars, businesses];
      platformLines = {
        computedAtMs: at,
        complete: parts.every((part) => part.complete),
        lines: platformEarningsLines({
          purchases: purchases.rows,
          shipments: shipments.rows,
          freightShipments: freightShipments.rows,
          transports: transports.rows,
          parkedCars: parkedCars.rows,
          businesses: businesses.rows,
        }),
      };
    }
    const focus = {
      businessKey: String(request.data?.focus?.businessKey || "").trim()
          .slice(0, 200),
      serviceId: String(request.data?.focus?.serviceId || "").trim()
          .slice(0, 60),
    };
    const {lines} = platformLines;
    const summary = summarizePlatformEarningsLines(lines);
    return {
      summary,
      focused: focus.businessKey || focus.serviceId ?
        summarizePlatformEarningsLines(lines, focus) : summary,
      businessRows: focus.serviceId ?
        summarizePlatformEarningsLines(lines,
            {serviceId: focus.serviceId}).byBusiness :
        summary.byBusiness,
      serviceRows: focus.businessKey ?
        summarizePlatformEarningsLines(lines,
            {businessKey: focus.businessKey}).byService :
        summary.byService,
      complete: platformLines.complete,
      computedAtMs: platformLines.computedAtMs,
    };
  }

  return {
    getAdminOverview,
    getBusinessOverview,
    getInvoiceBoardTotals,
    getLotLedgerTotals,
    getParkingTotals,
    getPlatformEarnings,
  };
}

module.exports = {
  ADMIN_STATUS_VOCABULARY,
  CACHE_COLLECTION,
  CLOSED_STATUSES,
  cacheDocId,
  createConsoleTotalsHandlers,
  monthRangeMs,
  normalizeLedgerRequest,
  startOfUtcDayMs,
  withOther,
};
