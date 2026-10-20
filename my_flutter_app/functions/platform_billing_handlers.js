"use strict";

/**
 * Laawol bills - the Firestore half (docs/PLATFORM_BILLING.md). One callable,
 * `platformBilling`, routes on `data.action`. Every figure is read from the
 * records each business already has and billed with the pure math in
 * platform_billing.js; nothing is counted twice:
 *
 *   barrels, packages, cars   volumeMonthly rollups (volume_rollup.js)
 *   package prices            the month's lines, read with Volume's query
 *   parked cars / billed      parking_month_statement.js parkingMonthSummary
 *   items sold                inventory.js summarizeSales
 *   commission taken          console_summaries.js platformEarningsLines
 *
 * Every read is bounded: per business per month, paged under a deadline, and
 * only what the deal needs. The commission lines are one platform read kept
 * on the instance for ten minutes, as getPlatformEarnings keeps its own.
 *
 * Everything Firebase-specific arrives through `deps`, so index.js keeps a
 * one-line export.
 */

const billing = require("./platform_billing");
const {
  VOLUME_COLLECTION,
  VOLUME_TIME_ZONE,
  currentMonthKey,
  isRootLine,
  lineMonthKey,
  monthWindow,
  volumeDocId,
} = require("./volume_counts");
const {
  mergeRowsById,
  monthBoundsMs: parkingMonthBoundsMs,
  parkingMonthSummary,
} = require("./parking_month_statement");
const {summarizeSales} = require("./inventory");
const {
  platformEarningsLines,
  zonedDayKey,
} = require("./console_summaries");
const {drainPages, mapWithConcurrency} = require("./scheduled_sweep");
const bankCheck = require("./bank_check");

const PAGE_SIZE = 500;
/** Rows one getMonthBills / whatIf call computes. */
const MAX_ROWS = 100;
const ROW_CONCURRENCY = 6;
/** Leave room inside the 120 s timeout for the answer itself. */
const CALL_BUDGET_MS = 90 * 1000;
const COMMISSION_TTL_MS = 10 * 60 * 1000;
const MIN_REFRESH_AGE_MS = 60 * 1000;
const MAX_MONTH_HISTORY = 240;
const IN_BATCH = 100;

const DEALS = "billingDeals";
const MONTHS = "billingMonths";
const PAYMENTS = "billingPayments";
const EARNINGS_COLLECTIONS = ["carPurchases", "barrelShipments",
  "freightShipments", "transportRequests", "parkedCars"];

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);

/**
 * @param {Array} values Values.
 * @param {number} size Chunk size.
 * @return {Array<Array>} The chunks.
 */
function chunks(values, size = IN_BATCH) {
  const out = [];
  for (let i = 0; i < values.length; i += size) {
    out.push(values.slice(i, i + size));
  }
  return out;
}

/**
 * A value Firestore can store and an audit log can show: plain JSON.
 *
 * @param {*} value Anything.
 * @return {*} A JSON copy (undefined becomes null).
 */
function plain(value) {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

/**
 * @param {object} deps Firebase handles and permission helpers.
 * @return {object} {platformBilling}.
 */
function createPlatformBillingHandlers(deps) {
  const {
    admin,
    HttpsError,
    logger,
    requireAuth,
    getUserProfile,
    hasAdminCapability,
    hasAdminSectionAccess = () => false,
    setAdminAuditLog,
    ensureParkingOccupancyIndexed = async () => {},
    monthLines,
    now = () => new Date(),
    timeZone = VOLUME_TIME_ZONE,
  } = deps;
  const db = () => admin.firestore();
  const {Timestamp, FieldValue, FieldPath} =
    require("firebase-admin/firestore");

  // ---- Refusals ----------------------------------------------------------

  function refuse(codes) {
    const list = (Array.isArray(codes) ? codes : [codes]).filter(Boolean);
    const first = list[0] || "action_invalid";
    throw new HttpsError(billing.REFUSAL_STATUS[first] || "invalid-argument",
        billing.REFUSAL_MESSAGES[first] || first, {reasons: list});
  }

  // ---- Access ------------------------------------------------------------

  /**
   * Finance readers see bills (the Volume rule); super admins - the only
   * people who may write a business's platform fee - change them.
   *
   * @param {object} request The callable request.
   * @return {Promise<{uid: string, user: object, canManage: boolean}>}
   */
  async function access(request) {
    const uid = requireAuth(request);
    const user = await getUserProfile(uid);
    const view = user?.role === "admin" &&
      (hasAdminCapability(user, "finance") ||
        hasAdminSectionAccess(user, "finance", "view"));
    if (!view) refuse("billing_view_required");
    const canManage = user.role === "admin" &&
      String(user.adminRole || "").trim() === "superAdmin";
    return {uid, user, canManage};
  }

  function requireManage(ctx) {
    if (!ctx.canManage) refuse("billing_manage_required");
  }

  // ---- Inputs ------------------------------------------------------------

  const thisMonth = () => currentMonthKey(now(), timeZone);

  function monthFrom(value, fallback) {
    const month = text(value, 7);
    if (!month && fallback) return fallback;
    if (!billing.isMonthKey(month)) refuse("month_invalid");
    return month;
  }

  function businessIdFrom(value) {
    const id = text(value, 200);
    if (!id || id.length > 128 || id.includes("/")) {
      refuse("business_invalid");
    }
    return id;
  }

  function cursorFrom(value) {
    if (value === undefined || value === null || value === "") return 0;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) refuse("cursor_invalid");
    return n;
  }

  // ---- Reads -------------------------------------------------------------

  /**
   * Every document a query matches, paged under a deadline.
   *
   * @param {object} query A filtered, ordered query.
   * @param {number} deadlineMs Stop starting pages after this.
   * @return {Promise<{rows: Array<object>, complete: boolean}>}
   */
  async function readAll(query, deadlineMs) {
    const rows = [];
    const result = await drainPages({
      pageSize: PAGE_SIZE,
      deadlineMs,
      now: () => now().getTime(),
      fetchPage: async (cursor) => {
        let page = query.limit(PAGE_SIZE);
        if (cursor) page = page.startAfter(cursor);
        return (await page.get()).docs;
      },
      processPage: async (docs) => {
        for (const doc of docs) rows.push({id: doc.id, ...doc.data()});
      },
    });
    return {rows, complete: result.exhausted};
  }

  /**
   * Volume's figures for some businesses in a month (zeros when none).
   *
   * @param {string[]} ids Businesses.
   * @param {string} month "yyyy-mm".
   * @return {Promise<Map<string, object>>} id -> {barrels, packages, cars}.
   */
  async function volumeRows(ids, month) {
    const out = new Map();
    for (const group of chunks(ids)) {
      const snaps = await db().getAll(...group.map((id) =>
        db().collection(VOLUME_COLLECTION).doc(volumeDocId(id, month))));
      for (const snap of snaps) {
        const data = snap.exists ? snap.data() || {} : {};
        if (data.businessId) out.set(String(data.businessId), data);
      }
    }
    return out;
  }

  async function packagePrices(businessId, month, window, deadlineMs) {
    const read = await monthLines(businessId, window, deadlineMs);
    const lines = [];
    for (const {id, data} of read.lines) {
      if (text(data.businessId) !== businessId) continue;
      const root = isRootLine(data, id) ? null :
        read.roots.get(text(data.rootLineId)) || null;
      if (lineMonthKey(data, id, timeZone, root) === month) lines.push(data);
    }
    return {prices: billing.packagePricesOfLines(lines),
      complete: read.complete};
  }

  async function parkingUsage(businessId, month, deadlineMs) {
    const bounds = parkingMonthBoundsMs(month);
    try {
      await ensureParkingOccupancyIndexed(db(), businessId, {deadlineMs});
    } catch (error) {
      logger.warn("Bills: parking occupancy not indexed yet",
          {businessId, error: String(error?.message || error)});
      return {carsOnLot: 0, billedCents: 0, complete: false};
    }
    const activities = db().collection("lotActivities")
        .where("businessId", "==", businessId);
    const [cars, inMonth, undated] = await Promise.all([
      readAll(db().collection("parkedCars")
          .where("businessId", "==", businessId)
          .where("occupancyEndMs", ">=", bounds.startMs)
          .orderBy("occupancyEndMs"), deadlineMs),
      readAll(activities
          .where("activityDate", ">=", Timestamp.fromMillis(bounds.startMs))
          .where("activityDate", "<", Timestamp.fromMillis(bounds.endMs))
          .orderBy("activityDate", "desc"), deadlineMs),
      readAll(activities.where("activityDate", "==", null)
          .orderBy(FieldPath.documentId()), deadlineMs),
    ]);
    const summary = parkingMonthSummary(cars.rows, month, now(),
        mergeRowsById(inMonth.rows, undated.rows));
    return {carsOnLot: summary.carsOnLot, billedCents: summary.billedCents,
      complete: cars.complete && inMonth.complete && undated.complete};
  }

  async function itemsSold(businessId, window, deadlineMs) {
    const sales = await readAll(db().collection("inventorySales")
        .where("businessId", "==", businessId)
        .where("createdAt", ">=", Timestamp.fromMillis(window.startMs))
        .where("createdAt", "<", Timestamp.fromMillis(window.endMs))
        .orderBy("createdAt", "desc"), deadlineMs);
    return {itemsSold: summarizeSales(sales.rows).itemsSold,
      complete: sales.complete};
  }

  /**
   * A business's bank for a month (docs/ZELLE_BANK_CHECK.md): whether it had
   * an active link (bank_check.linkActiveInMonth) and its paid refreshes,
   * from businessBankUsage and the link. Two document reads.
   *
   * @param {string} businessId The business.
   * @param {string} month "yyyy-mm".
   * @param {{startMs: number, endMs: number}} window The month.
   * @return {Promise<object>} {bankConnected, bankRefreshes, usage, link}.
   */
  async function bankUsage(businessId, month, window) {
    // Never the sealed token: only the fields the month needs.
    const [usageSnap, [linkSnap]] = await Promise.all([
      db().collection(bankCheck.BANK_USAGE)
          .doc(bankCheck.usageDocId(businessId, month)).get(),
      db().getAll(db().collection("businessBankLinks").doc(businessId), {
        fieldMask: ["itemId", "status", "connectedAt", "disconnectedAt",
          "refreshLimit"]}),
    ]);
    const usage = usageSnap.exists ? usageSnap.data() || {} : null;
    const link = linkSnap.exists ? linkSnap.data() || {} : null;
    return {
      bankConnected: bankCheck.linkActiveInMonth({link, usage, window}),
      bankRefreshes: bankCheck.countOf(usage?.refreshes),
      usage,
      link,
    };
  }

  /**
   * One business's usage for a month: Volume's counts always, the rest only
   * when `needs` asks.
   *
   * @param {object} args {businessId, month, needs, volume, deadlineMs}.
   * @return {Promise<object>} Normalized usage with `complete`.
   */
  async function usageFor({businessId, month, needs, volume, deadlineMs}) {
    const window = monthWindow(month, timeZone);
    const row = volume || {};
    const [prices, parking, items, bank] = await Promise.all([
      needs.packagePrices ?
        packagePrices(businessId, month, window, deadlineMs) : null,
      needs.parking ? parkingUsage(businessId, month, deadlineMs) : null,
      needs.items ? itemsSold(businessId, window, deadlineMs) : null,
      needs.bank ? bankUsage(businessId, month, window) : null,
    ]);
    const usage = billing.normalizeUsage({
      barrels: row.barrels,
      packages: row.packages,
      cars: row.cars,
      packagePrices: prices ? prices.prices : null,
      parkingCars: parking ? parking.carsOnLot : null,
      parkingBilledCents: parking ? parking.billedCents : null,
      itemsSold: items ? items.itemsSold : null,
      bankConnected: bank ? bank.bankConnected : null,
      bankRefreshes: bank ? bank.bankRefreshes : null,
    });
    usage.complete = row.complete !== false &&
      (!prices || prices.complete) && (!parking || parking.complete) &&
      (!items || items.complete);
    return usage;
  }

  // ---- Commission taken --------------------------------------------------

  let commissionCache = null;

  /**
   * The platform's earnings lines (the getPlatformEarnings read), cached on
   * the instance.
   *
   * @param {boolean} refresh Ask again when the cache is a minute old.
   * @param {number} deadlineMs Read deadline.
   * @return {Promise<object>} {lines, complete, computedAtMs}.
   */
  async function earnings(refresh, deadlineMs) {
    const at = now().getTime();
    const age = commissionCache ? at - commissionCache.computedAtMs : Infinity;
    if (commissionCache && age >= 0 && age < COMMISSION_TTL_MS &&
        !(refresh && age >= MIN_REFRESH_AGE_MS)) {
      return commissionCache;
    }
    const all = (name) => readAll(db().collection(name)
        .orderBy(FieldPath.documentId()), deadlineMs);
    const parts = await Promise.all([
      ...EARNINGS_COLLECTIONS.map(all),
      readAll(db().collection("businesses").select("name")
          .orderBy(FieldPath.documentId()), deadlineMs),
    ]);
    const [purchases, shipments, freightShipments, transports, parkedCars,
      businesses] = parts;
    const fresh = {
      computedAtMs: at,
      complete: parts.every((part) => part.complete),
      lines: platformEarningsLines({
        purchases: purchases.rows,
        shipments: shipments.rows,
        freightShipments: freightShipments.rows,
        transports: transports.rows,
        parkedCars: parkedCars.rows,
        businesses: businesses.rows,
      }).map((line) => ({businessId: line.businessId, state: line.state,
        feeCents: line.feeCents, ms: line.ms})),
    };
    if (fresh.complete) commissionCache = fresh;
    return fresh;
  }

  async function commissionFor(month, refresh, deadlineMs) {
    const lines = await earnings(refresh, deadlineMs);
    return {
      byBusiness: billing.commissionByBusiness(lines.lines,
          monthWindow(month, timeZone)),
      complete: lines.complete,
      computedAtMs: lines.computedAtMs,
    };
  }

  // ---- Deals, months, payments, names ------------------------------------

  function dealOf(snapOrData) {
    const data = snapOrData && typeof snapOrData.data === "function" ?
      (snapOrData.exists ? snapOrData.data() || {} : null) : snapOrData;
    if (!data) {
      return {exists: false, versions: [], commissionMode: "keep",
        commissionBackup: null};
    }
    return {
      exists: true,
      versions: Array.isArray(data.versions) ? data.versions : [],
      commissionMode: data.commissionMode === "replace" ? "replace" : "keep",
      commissionBackup: data.commissionBackup || null,
    };
  }

  async function businessMonths(businessId) {
    const snap = await db().collection(MONTHS)
        .where("businessId", "==", businessId)
        .orderBy("month", "desc").limit(MAX_MONTH_HISTORY).get();
    return snap.docs.map((doc) => ({id: doc.id, ...doc.data()}));
  }

  async function monthPayments(businessId, month) {
    const snap = await db().collection(PAYMENTS)
        .where("businessId", "==", businessId)
        .where("month", "==", month)
        .limit(billing.MAX_PAYMENTS_PER_MONTH).get();
    return snap.docs.map((doc) => {
      const p = doc.data() || {};
      return {
        id: doc.id,
        amountCents: Number(p.amountCents) || 0,
        paidOn: text(p.paidOn, 10),
        method: text(p.method, 40),
        note: text(p.note, billing.MAX_NOTE),
        recordedBy: text(p.recordedBy, 128),
        recordedAtMs: Number(p.recordedAtMs) || 0,
        voided: p.voided === true,
        voidedBy: text(p.voidedBy, 128),
        voidedAtMs: Number(p.voidedAtMs) || null,
        voidReason: text(p.voidReason, billing.MAX_REASON),
      };
    }).sort((a, b) => a.recordedAtMs - b.recordedAtMs);
  }

  async function namesOf(collection, ids, fields) {
    const out = new Map();
    const clean = [...new Set(ids.map((id) => text(id))
        .filter((id) => id && !id.includes("/")))];
    for (const group of chunks(clean)) {
      const snaps = await db().getAll(...group.map((id) =>
        db().collection(collection).doc(id)), {fieldMask: fields});
      for (const snap of snaps) {
        if (!snap.exists) continue;
        const data = snap.data() || {};
        out.set(snap.id, fields.map((f) => text(data[f])).find(Boolean) ||
          "");
      }
    }
    return out;
  }

  // ---- One business's bill -----------------------------------------------

  /**
   * A business's bill for a month: live while open; the frozen snapshot
   * plus drift once closed.
   *
   * @param {object} args {businessId, month, deal (dealOf), monthDoc,
   *   volume, commission (cents), commissionComplete, deadlineMs}.
   * @return {Promise<object>} The bill row.
   */
  async function businessBill({businessId, month, deal, monthDoc, volume,
    commission, commissionComplete = true, deadlineMs}) {
    const version = billing.dealInEffect(deal.versions, month);
    const snapshot = monthDoc?.status === "closed" && monthDoc.snapshot ?
      monthDoc.snapshot : null;
    const liveDeal = snapshot ?
      (snapshot.deal ? billing.storedDeal(snapshot.deal) : null) :
      (version ? version.deal : null);
    const usage = await usageFor({businessId, month, volume, deadlineMs,
      needs: billing.dealNeeds(liveDeal)});
    const live = billing.computeBill({deal: liveDeal, usage,
      commissionCents: commission});
    const bill = snapshot ? snapshot.bill : live;
    const amountCents = snapshot ? Number(snapshot.bill?.amountCents) || 0 :
      live.amountCents;
    const paidCents = Number(monthDoc?.paidCents) || 0;
    return {
      businessId,
      month,
      status: snapshot ? "closed" : "open",
      hasDeal: Boolean(liveDeal) && !billing.isEmptyDeal(liveDeal),
      deal: liveDeal,
      dealVersionId: snapshot ? text(snapshot.dealVersionId) :
        text(version?.id),
      effectiveFrom: version ? version.effectiveFrom : "",
      usage: snapshot ? snapshot.usage : usage,
      liveUsage: usage,
      bill,
      liveBill: live,
      amountCents,
      paidCents,
      standing: billing.monthStanding({amountCents, paidCents}),
      commissionCents: snapshot ? Number(bill.commissionCents) || 0 :
        commission,
      drift: snapshot ? billing.billDrift(snapshot, usage, commission) : null,
      closedAtMs: snapshot ? Number(monthDoc.closedAtMs) || null : null,
      closedBy: snapshot ? text(monthDoc.closedBy, 128) : "",
      complete: usage.complete && commissionComplete,
    };
  }

  /**
   * A table row (no per-package prices: the list stays small).
   *
   * @param {object} row From businessBill.
   * @param {string} name The business's name.
   * @param {number} unpaidToDateCents Its closed months still owed.
   * @return {object} The row.
   */
  function tableRow(row, name, unpaidToDateCents) {
    return {
      businessId: row.businessId,
      name: name || row.businessId,
      hasDeal: row.hasDeal,
      deal: row.deal,
      effectiveFrom: row.effectiveFrom,
      status: row.status,
      // The counts the amount was worked out from (the snapshot's once
      // closed; drift says what moved since).
      counts: {
        barrels: Number(row.usage?.barrels) || 0,
        packages: Number(row.usage?.packages) || 0,
        cars: Number(row.usage?.cars) || 0,
        parkingCars: row.usage?.parkingCars ?? null,
        itemsSold: row.usage?.itemsSold ?? null,
        bankRefreshes: row.usage?.bankRefreshes ?? null,
      },
      amountCents: row.amountCents,
      paidCents: row.paidCents,
      unpaidCents: row.standing.unpaidCents,
      standing: row.standing.status,
      commissionCents: row.commissionCents,
      earnedCents: row.commissionCents + row.amountCents,
      unpaidToDateCents,
      drift: row.drift ? {changed: row.drift.changed,
        items: row.drift.items, amountNowCents: row.drift.amountNowCents,
        amountDeltaCents: row.drift.amountDeltaCents} : null,
      complete: row.complete,
    };
  }

  function stripPrices(usage) {
    if (!usage) return usage;
    const rest = {...usage};
    delete rest.packagePrices;
    return rest;
  }

  // ---- Candidates for the month's table ---------------------------------

  async function monthCandidates(month, deadlineMs, refresh, extra = []) {
    const [dealsSnap, volumeSnap, monthsSnap, commission, unpaidSnap] =
      await Promise.all([
        db().collection(DEALS).get(),
        db().collection(VOLUME_COLLECTION).where("month", "==", month)
            .select("businessId", "pieces", "barrels", "packages", "cars",
                "complete").get(),
        db().collection(MONTHS).where("month", "==", month).get(),
        commissionFor(month, refresh, deadlineMs),
        db().collection(MONTHS).where("status", "==", "closed")
            .where("unpaidCents", ">", 0)
            .select("businessId", "unpaidCents").get(),
      ]);
    const deals = new Map(dealsSnap.docs.map((doc) =>
      [doc.id, dealOf(doc.data() || {})]));
    const volume = new Map();
    for (const doc of volumeSnap.docs) {
      const data = doc.data() || {};
      if (data.businessId) volume.set(String(data.businessId), data);
    }
    const monthDocs = new Map(monthsSnap.docs.map((doc) =>
      [String(doc.data()?.businessId || ""), doc.data() || {}]));
    const unpaidToDate = new Map();
    for (const doc of unpaidSnap.docs) {
      const data = doc.data() || {};
      const id = String(data.businessId || "");
      unpaidToDate.set(id, (unpaidToDate.get(id) || 0) +
        (Number(data.unpaidCents) || 0));
    }
    const ids = new Set();
    for (const id of deals.keys()) ids.add(id);
    for (const [id, row] of volume) {
      if ((Number(row.pieces) || 0) > 0) ids.add(id);
    }
    for (const [id, cents] of commission.byBusiness) {
      if (cents > 0) ids.add(id);
    }
    for (const id of monthDocs.keys()) if (id) ids.add(id);
    for (const id of extra) ids.add(id);
    const clean = [...ids].filter((id) => id && !id.includes("/"));
    const names = await namesOf("businesses", clean, ["name"]);
    const ordered = billing.orderCandidates(clean.map((businessId) => {
      const version = billing.dealInEffect(
          deals.get(businessId)?.versions || [], month);
      return {businessId, name: names.get(businessId) || "",
        hasDeal: Boolean(version) && !billing.isEmptyDeal(version.deal)};
    }));
    return {ordered, deals, volume, monthDocs, commission, unpaidToDate,
      names};
  }

  // ---- Actions ----------------------------------------------------------

  async function getMonthBills(ctx, data) {
    const month = monthFrom(data.month, thisMonth());
    const cursor = cursorFrom(data.cursor);
    const startedMs = now().getTime();
    const deadlineMs = startedMs + CALL_BUDGET_MS;
    const c = await monthCandidates(month, deadlineMs, data.refresh === true);
    const page = c.ordered.slice(cursor, cursor + MAX_ROWS);
    const settled = await mapWithConcurrency(page, ROW_CONCURRENCY,
        async (candidate) => {
          const id = candidate.businessId;
          if (now().getTime() >= deadlineMs) return null;
          return businessBill({businessId: id, month,
            deal: c.deals.get(id) || dealOf(null),
            monthDoc: c.monthDocs.get(id) || null,
            volume: c.volume.get(id) || null,
            commission: c.commission.byBusiness.get(id) || 0,
            commissionComplete: c.commission.complete, deadlineMs});
        });
    const rows = [];
    let skipped = 0;
    settled.forEach((result, index) => {
      if (result.status === "fulfilled" && result.value) {
        rows.push(tableRow(result.value, page[index].name,
            c.unpaidToDate.get(page[index].businessId) || 0));
      } else {
        skipped += 1;
        if (result.status === "rejected") {
          logger.warn("Bills: a business could not be billed", {
            businessId: page[index].businessId, month,
            error: String(result.reason?.message || result.reason)});
        }
      }
    });
    const end = cursor + page.length;
    const summary = billing.summarizeRows(rows);
    let commissionCents = 0;
    for (const cents of c.commission.byBusiness.values()) {
      commissionCents += cents;
    }
    let unpaidToDateCents = 0;
    for (const cents of c.unpaidToDate.values()) unpaidToDateCents += cents;
    return {
      month,
      timeZone,
      summary: {
        ...summary,
        // The platform's month, not just this page's rows.
        commissionCents,
        earnedCents: summary.owedCents + commissionCents,
        unpaidToDateCents,
        candidates: c.ordered.length,
        partial: end < c.ordered.length || skipped > 0,
      },
      rows,
      skipped,
      nextCursor: end < c.ordered.length ? end : null,
      complete: skipped === 0 && rows.every((row) => row.complete) &&
        c.commission.complete,
      canManage: ctx.canManage,
      computedAtMs: now().getTime(),
      commissionComputedAtMs: c.commission.computedAtMs,
    };
  }

  async function getBusinessBill(ctx, data) {
    const businessId = businessIdFrom(data.businessId);
    const month = monthFrom(data.month, thisMonth());
    const deadlineMs = now().getTime() + CALL_BUDGET_MS;
    const [businessSnap, dealSnap, months, payments, volume, commission] =
      await Promise.all([
        db().collection("businesses").doc(businessId).get(),
        db().collection(DEALS).doc(businessId).get(),
        businessMonths(businessId),
        monthPayments(businessId, month),
        volumeRows([businessId], month),
        commissionFor(month, data.refresh === true, deadlineMs),
      ]);
    const deal = dealOf(dealSnap);
    if (!businessSnap.exists && !deal.exists && months.length === 0) {
      refuse("business_not_found");
    }
    const monthDoc = months.find((m) => m.month === month) || null;
    // Check bank usage for the month, whatever the deal: platform admins
    // see each business's checks, paid refreshes and estimated cost here.
    const bank = await bankUsage(businessId, month, monthWindow(month,
        timeZone));
    const bankStaff = await namesOf("users",
        Object.keys(bank.usage?.byUid || {}).slice(0, 100),
        ["fullName", "displayName", "name", "email"]);
    const row = await businessBill({businessId, month, deal, monthDoc,
      volume: volume.get(businessId) || null,
      commission: commission.byBusiness.get(businessId) || 0,
      commissionComplete: commission.complete, deadlineMs});
    const closedMonths = new Set(months.filter((m) => m.status === "closed")
        .map((m) => m.month));
    const people = new Set();
    for (const v of deal.versions) people.add(v.createdBy);
    for (const p of payments) {
      people.add(p.recordedBy);
      people.add(p.voidedBy);
    }
    people.add(row.closedBy);
    for (const r of monthDoc?.reopenHistory || []) people.add(r.reopenedBy);
    const names = await namesOf("users", [...people],
        ["fullName", "displayName", "email"]);
    const business = businessSnap.exists ? businessSnap.data() || {} : {};
    return {
      business: {id: businessId, name: text(business.name) || businessId,
        exists: businessSnap.exists,
        platformFeePct: business.platformFeePct ?? null},
      month,
      timeZone,
      status: row.status,
      hasDeal: row.hasDeal,
      deal: row.deal,
      dealVersionId: row.dealVersionId,
      effectiveFrom: row.effectiveFrom,
      bill: row.bill,
      usage: stripPrices(row.usage),
      liveBill: row.liveBill,
      drift: row.drift,
      closed: row.status === "closed" ? {closedAtMs: row.closedAtMs,
        closedBy: row.closedBy, amountCents: row.amountCents} : null,
      reopenHistory: (monthDoc?.reopenHistory || []).map((r) => ({
        reopenedAtMs: Number(r.reopenedAtMs) || 0,
        reopenedBy: text(r.reopenedBy, 128),
        reason: text(r.reason, billing.MAX_REASON),
        closedAmountCents: Number(r.closedAmountCents) || 0})),
      amountCents: row.amountCents,
      paidCents: row.paidCents,
      unpaidCents: row.standing.unpaidCents,
      standing: row.standing,
      commissionCents: row.commissionCents,
      earnedCents: row.commissionCents + row.amountCents,
      payments,
      versions: deal.versions.map((v) => ({id: text(v.id),
        effectiveFrom: text(v.effectiveFrom, 7),
        deal: billing.storedDeal(v.deal), note: text(v.note, billing.MAX_NOTE),
        createdAtMs: Number(v.createdAtMs) || 0,
        createdBy: text(v.createdBy, 128)}))
          .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) ||
            b.createdAtMs - a.createdAtMs),
      commissionMode: deal.commissionMode,
      months: months.map((m) => ({month: m.month, status: m.status,
        amountCents: m.status === "closed" ? Number(m.amountCents) || 0 :
          null,
        paidCents: Number(m.paidCents) || 0,
        unpaidCents: Number(m.unpaidCents) || 0,
        closedAtMs: Number(m.closedAtMs) || null})),
      unpaidToDateCents: months.filter((m) => m.status === "closed")
          .reduce((sum, m) => sum + (Number(m.unpaidCents) || 0), 0),
      pastOpenMonths: billing.pastOpenMonths({versions: deal.versions,
        closedMonths, currentMonth: thisMonth()}),
      people: Object.fromEntries(names),
      bankUsage: {...bankCheck.usageView({month, usage: bank.usage,
        limit: bankCheck.refreshLimitOf(bank.link), names: bankStaff}),
      connected: bank.bankConnected},
      canManage: ctx.canManage,
      complete: row.complete,
      computedAtMs: now().getTime(),
    };
  }

  async function whatIf(ctx, data) {
    const month = monthFrom(data.month, thisMonth());
    const {deal: alt, errors} = billing.normalizeDeal(data.deal);
    if (errors.length > 0) refuse(errors);
    const altNeeds = billing.dealNeeds(alt);
    const deadlineMs = now().getTime() + CALL_BUDGET_MS;
    if (data.businessId !== undefined && data.businessId !== null &&
        data.businessId !== "") {
      const businessId = businessIdFrom(data.businessId);
      const [dealSnap, volume, commission] = await Promise.all([
        db().collection(DEALS).doc(businessId).get(),
        volumeRows([businessId], month),
        commissionFor(month, false, deadlineMs),
      ]);
      const version = billing.dealInEffect(dealOf(dealSnap).versions, month);
      const current = version ? version.deal : null;
      const usage = await usageFor({businessId, month, deadlineMs,
        volume: volume.get(businessId) || null,
        needs: billing.mergeNeeds(billing.dealNeeds(current), altNeeds)});
      const cents = commission.byBusiness.get(businessId) || 0;
      const nowBill = billing.computeBill({deal: current, usage,
        commissionCents: cents});
      const altBill = billing.computeBill({deal: alt, usage,
        commissionCents: cents});
      return {month, businessId, usage: stripPrices(usage), now: nowBill,
        alt: altBill, deltaCents: altBill.amountCents - nowBill.amountCents,
        complete: usage.complete && commission.complete};
    }
    const cursor = cursorFrom(data.cursor);
    const extra = [];
    for (const [needed, service] of [[altNeeds.parking, "carParking"],
      [altNeeds.items, "inventory"]]) {
      if (!needed) continue;
      const snap = await db().collection("businesses")
          .where("enabledServices", "array-contains", service)
          .select().limit(1000).get();
      for (const doc of snap.docs) extra.push(doc.id);
    }
    if (altNeeds.bank) {
      // Businesses whose bank was in use that month (a check, a sync or a
      // connect wrote the month's usage).
      const snap = await db().collection(bankCheck.BANK_USAGE)
          .where("month", "==", month).select("businessId").limit(1000)
          .get();
      for (const doc of snap.docs) {
        const id = String(doc.data()?.businessId || "");
        if (id) extra.push(id);
      }
    }
    const c = await monthCandidates(month, deadlineMs, false, extra);
    const page = c.ordered.slice(cursor, cursor + MAX_ROWS);
    const settled = await mapWithConcurrency(page, ROW_CONCURRENCY,
        async (candidate) => {
          const id = candidate.businessId;
          if (now().getTime() >= deadlineMs) return null;
          const version = billing.dealInEffect(
              c.deals.get(id)?.versions || [], month);
          const current = version ? version.deal : null;
          const usage = await usageFor({businessId: id, month, deadlineMs,
            volume: c.volume.get(id) || null,
            needs: billing.mergeNeeds(billing.dealNeeds(current), altNeeds)});
          const cents = c.commission.byBusiness.get(id) || 0;
          const nowBill = billing.computeBill({deal: current, usage,
            commissionCents: cents});
          const altBill = billing.computeBill({deal: alt, usage,
            commissionCents: cents});
          return {businessId: id, name: candidate.name || id,
            hasDeal: candidate.hasDeal, usage: stripPrices(usage),
            nowCents: nowBill.amountCents, altCents: altBill.amountCents,
            deltaCents: altBill.amountCents - nowBill.amountCents,
            commissionCents: cents, altLines: altBill.lines,
            complete: usage.complete};
        });
    const rows = [];
    let skipped = 0;
    for (const result of settled) {
      if (result.status === "fulfilled" && result.value) {
        rows.push(result.value);
      } else {
        skipped += 1;
      }
    }
    const sum = (key) => rows.reduce((s, r) => s + r[key], 0);
    const end = cursor + page.length;
    return {
      month,
      rows,
      totals: {nowCents: sum("nowCents"), altCents: sum("altCents"),
        deltaCents: sum("altCents") - sum("nowCents"),
        commissionCents: sum("commissionCents"), businesses: rows.length},
      nextCursor: end < c.ordered.length ? end : null,
      candidates: c.ordered.length,
      skipped,
      complete: skipped === 0 && rows.every((row) => row.complete) &&
        c.commission.complete,
    };
  }

  async function businessExists(businessId) {
    const snap = await db().collection("businesses").doc(businessId).get();
    if (!snap.exists) refuse("business_not_found");
    return snap.data() || {};
  }

  async function saveDeal(ctx, data) {
    requireManage(ctx);
    const businessId = businessIdFrom(data.businessId);
    const {deal, errors} = billing.normalizeDeal(data.deal);
    if (errors.length > 0) refuse(errors);
    const effectiveFrom = text(data.effectiveFrom, 7) || thisMonth();
    const note = String(data.note ?? "").trim();
    const business = await businessExists(businessId);
    const months = await businessMonths(businessId);
    const closedMonths = new Set(months.filter((m) => m.status === "closed")
        .map((m) => m.month));
    const ref = db().collection(DEALS).doc(businessId);
    const atMs = now().getTime();
    const version = {
      id: `v${atMs.toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      effectiveFrom,
      deal,
      note: note.slice(0, billing.MAX_NOTE),
      createdAtMs: atMs,
      createdBy: ctx.uid,
    };
    await db().runTransaction(async (tx) => {
      const monthRef = db().collection(MONTHS)
          .doc(billing.billingMonthId(businessId, effectiveFrom));
      const [snap, monthSnap] = await Promise.all([tx.get(ref),
        billing.isMonthKey(effectiveFrom) ? tx.get(monthRef) : null]);
      if (monthSnap?.exists && monthSnap.data()?.status === "closed") {
        closedMonths.add(effectiveFrom);
      }
      const current = dealOf(snap);
      const problems = billing.dealSaveErrors({effectiveFrom, note,
        currentMonth: thisMonth(), closedMonths,
        versionCount: current.versions.length});
      if (problems.length > 0) refuse(problems);
      tx.set(ref, {
        businessId,
        commissionMode: current.commissionMode,
        commissionBackup: current.commissionBackup,
        versions: billing.addVersion(current.versions, version),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: ctx.uid,
      });
      setAdminAuditLog(tx, {
        action: "billing_deal_saved",
        actorUid: ctx.uid,
        actorRole: "superAdmin",
        targetCollection: DEALS,
        targetId: businessId,
        targetLabel: text(business.name) || businessId,
        nextValue: effectiveFrom,
        metadata: {versionId: version.id, deal: plain(deal),
          note: version.note},
      });
    });
    return {success: true, versionId: version.id, effectiveFrom, deal};
  }

  async function setCommissionMode(ctx, data) {
    requireManage(ctx);
    const businessId = businessIdFrom(data.businessId);
    const mode = text(data.mode, 20);
    if (!billing.COMMISSION_MODES.includes(mode)) {
      refuse("commission_mode_invalid");
    }
    const businessRef = db().collection("businesses").doc(businessId);
    const dealRef = db().collection(DEALS).doc(businessId);
    return db().runTransaction(async (tx) => {
      const [businessSnap, dealSnap] = await Promise.all([
        tx.get(businessRef), tx.get(dealRef)]);
      if (!businessSnap.exists) refuse("business_not_found");
      const business = businessSnap.data() || {};
      const current = dealOf(dealSnap);
      if (current.commissionMode === mode) {
        return {success: true, mode, changed: false, notRestored: []};
      }
      const before = {platformFeePct: business.platformFeePct ?? null,
        servicePlatformFeePct: business.servicePlatformFeePct ?? null};
      const stamp = {platformFeeUpdatedAt: FieldValue.serverTimestamp(),
        platformFeeUpdatedBy: ctx.uid};
      let notRestored = [];
      let backup = null;
      let after;
      if (mode === "replace") {
        const plan = billing.commissionReplacePlan(business);
        backup = plan.backup;
        tx.update(businessRef, {...plan.set, ...stamp});
        after = plan.set;
      } else {
        const plan = billing.commissionRestorePlan(business,
            current.commissionBackup);
        const updates = {...plan.set, ...stamp};
        for (const field of plan.remove) updates[field] = FieldValue.delete();
        tx.update(businessRef, updates);
        notRestored = plan.notRestored;
        after = {...plan.set, removed: plan.remove};
      }
      tx.set(dealRef, {
        businessId,
        commissionMode: mode,
        commissionBackup: backup,
        versions: current.versions,
        commissionModeChangedAtMs: now().getTime(),
        commissionModeChangedBy: ctx.uid,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: ctx.uid,
      });
      setAdminAuditLog(tx, {
        action: mode === "replace" ? "billing_commission_replaced" :
          "billing_commission_restored",
        actorUid: ctx.uid,
        actorRole: "superAdmin",
        targetCollection: "businesses",
        targetId: businessId,
        targetLabel: text(business.name) || businessId,
        statusField: "platformFeePct",
        previousValue: current.commissionMode,
        nextValue: mode,
        metadata: {before: plain(before), after: plain(after),
          notRestored},
      });
      return {success: true, mode, changed: true, notRestored};
    });
  }

  async function recordPayment(ctx, data) {
    requireManage(ctx);
    const businessId = businessIdFrom(data.businessId);
    const month = monthFrom(data.month);
    const errors = billing.paymentErrors(data, zonedDayKey(now(), timeZone));
    if (errors.length > 0) refuse(errors);
    const business = await businessExists(businessId);
    const monthRef = db().collection(MONTHS)
        .doc(billing.billingMonthId(businessId, month));
    const payRef = db().collection(PAYMENTS).doc();
    const atMs = now().getTime();
    return db().runTransaction(async (tx) => {
      const snap = await tx.get(monthRef);
      const doc = snap.exists ? snap.data() || {} : {};
      const closed = doc.status === "closed";
      const paid = Number(doc.paidCents) || 0;
      const paymentCount = Number(doc.paymentCount) || 0;
      if (paymentCount >= billing.MAX_PAYMENTS_PER_MONTH) {
        refuse("payments_full");
      }
      const balance = billing.paymentBalanceRefusal({closed,
        amountCents: doc.amountCents, paidCents: paid,
        addCents: data.amountCents});
      if (balance) refuse(balance);
      const record = billing.paymentRecord(data, {businessId, month,
        recordedBy: ctx.uid, recordedAtMs: atMs});
      tx.set(payRef, {...record, createdAt: FieldValue.serverTimestamp()});
      const nextPaid = paid + record.amountCents;
      const amount = closed ? Number(doc.amountCents) || 0 : null;
      tx.set(monthRef, {
        businessId,
        month,
        status: closed ? "closed" : "open",
        paidCents: nextPaid,
        paymentCount: paymentCount + 1,
        amountCents: amount,
        unpaidCents: closed ? Math.max(0, amount - nextPaid) : 0,
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
      setAdminAuditLog(tx, {
        action: "billing_payment_recorded",
        actorUid: ctx.uid,
        actorRole: "superAdmin",
        targetCollection: PAYMENTS,
        targetId: payRef.id,
        targetLabel: text(business.name) || businessId,
        nextValue: record.amountCents,
        metadata: {businessId, month, method: record.method,
          paidOn: record.paidOn},
      });
      return {success: true, paymentId: payRef.id, paidCents: nextPaid};
    });
  }

  async function voidPayment(ctx, data) {
    requireManage(ctx);
    const businessId = businessIdFrom(data.businessId);
    const paymentId = text(data.paymentId, 200);
    if (!paymentId || paymentId.includes("/")) refuse("payment_not_found");
    const reason = String(data.reason ?? "").trim();
    if (reason.length > billing.MAX_REASON) refuse("note_too_long");
    const payRef = db().collection(PAYMENTS).doc(paymentId);
    return db().runTransaction(async (tx) => {
      const paySnap = await tx.get(payRef);
      const payment = paySnap.exists ? paySnap.data() || {} : null;
      if (!payment || text(payment.businessId) !== businessId) {
        refuse("payment_not_found");
      }
      if (payment.voided === true) refuse("payment_already_voided");
      const month = text(payment.month, 7);
      const monthRef = db().collection(MONTHS)
          .doc(billing.billingMonthId(businessId, month));
      const monthSnap = await tx.get(monthRef);
      const doc = monthSnap.exists ? monthSnap.data() || {} : {};
      const closed = doc.status === "closed";
      const nextPaid = Math.max(0, (Number(doc.paidCents) || 0) -
        (Number(payment.amountCents) || 0));
      tx.update(payRef, {voided: true, voidedBy: ctx.uid,
        voidedAtMs: now().getTime(), voidReason: reason});
      tx.set(monthRef, {
        businessId,
        month,
        paidCents: nextPaid,
        unpaidCents: closed ?
          Math.max(0, (Number(doc.amountCents) || 0) - nextPaid) : 0,
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
      setAdminAuditLog(tx, {
        action: "billing_payment_voided",
        actorUid: ctx.uid,
        actorRole: "superAdmin",
        targetCollection: PAYMENTS,
        targetId: paymentId,
        targetLabel: businessId,
        previousValue: Number(payment.amountCents) || 0,
        reason,
        metadata: {businessId, month},
      });
      return {success: true, paidCents: nextPaid};
    });
  }

  async function closeMonth(ctx, data) {
    requireManage(ctx);
    const businessId = businessIdFrom(data.businessId);
    const month = monthFrom(data.month);
    if (!billing.monthIsOver(month, thisMonth())) refuse("month_not_over");
    const business = await businessExists(businessId);
    const deadlineMs = now().getTime() + CALL_BUDGET_MS;
    const monthRef = db().collection(MONTHS)
        .doc(billing.billingMonthId(businessId, month));
    const [dealSnap, volume, commission, monthSnap] = await Promise.all([
      db().collection(DEALS).doc(businessId).get(),
      volumeRows([businessId], month),
      commissionFor(month, false, deadlineMs),
      monthRef.get(),
    ]);
    if (monthSnap.exists && monthSnap.data()?.status === "closed") {
      refuse("month_already_closed");
    }
    const deal = dealOf(dealSnap);
    const row = await businessBill({businessId, month, deal, monthDoc: null,
      volume: volume.get(businessId) || null,
      commission: commission.byBusiness.get(businessId) || 0,
      commissionComplete: commission.complete, deadlineMs});
    if (!row.complete) refuse("bill_incomplete");
    const atMs = now().getTime();
    const snapshot = plain({
      bill: row.liveBill,
      usage: row.liveUsage,
      dealVersionId: row.dealVersionId,
      deal: row.deal,
      commissionMode: deal.commissionMode,
      computedAtMs: atMs,
    });
    return db().runTransaction(async (tx) => {
      const snap = await tx.get(monthRef);
      const doc = snap.exists ? snap.data() || {} : {};
      if (doc.status === "closed") refuse("month_already_closed");
      const paid = Number(doc.paidCents) || 0;
      const amount = row.liveBill.amountCents;
      tx.set(monthRef, {
        businessId,
        month,
        status: "closed",
        amountCents: amount,
        paidCents: paid,
        paymentCount: Number(doc.paymentCount) || 0,
        unpaidCents: Math.max(0, amount - paid),
        snapshot,
        closedAtMs: atMs,
        closedBy: ctx.uid,
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
      setAdminAuditLog(tx, {
        action: "billing_month_closed",
        actorUid: ctx.uid,
        actorRole: "superAdmin",
        targetCollection: MONTHS,
        targetId: monthRef.id,
        targetLabel: text(business.name) || businessId,
        nextValue: amount,
        metadata: {businessId, month, dealVersionId: row.dealVersionId},
      });
      return {success: true, amountCents: amount, closedAtMs: atMs};
    });
  }

  async function reopenMonth(ctx, data) {
    requireManage(ctx);
    const businessId = businessIdFrom(data.businessId);
    const month = monthFrom(data.month);
    const reason = String(data.reason ?? "").trim();
    if (!reason) refuse("reason_required");
    if (reason.length > billing.MAX_REASON) refuse("note_too_long");
    const monthRef = db().collection(MONTHS)
        .doc(billing.billingMonthId(businessId, month));
    return db().runTransaction(async (tx) => {
      const snap = await tx.get(monthRef);
      const doc = snap.exists ? snap.data() || {} : {};
      if (doc.status !== "closed") refuse("month_not_closed");
      const atMs = now().getTime();
      const history = (Array.isArray(doc.reopenHistory) ?
        doc.reopenHistory : []).concat([{reopenedAtMs: atMs,
        reopenedBy: ctx.uid, reason,
        closedAmountCents: Number(doc.amountCents) || 0}])
          .slice(-billing.MAX_REOPEN_HISTORY);
      tx.set(monthRef, {
        status: "open",
        amountCents: null,
        unpaidCents: 0,
        snapshot: null,
        lastSnapshot: doc.snapshot || null,
        closedAtMs: null,
        closedBy: null,
        reopenHistory: history,
        updatedAt: FieldValue.serverTimestamp(),
      }, {merge: true});
      setAdminAuditLog(tx, {
        action: "billing_month_reopened",
        actorUid: ctx.uid,
        actorRole: "superAdmin",
        targetCollection: MONTHS,
        targetId: monthRef.id,
        targetLabel: businessId,
        previousValue: Number(doc.amountCents) || 0,
        reason,
        metadata: {businessId, month},
      });
      return {success: true, status: "open"};
    });
  }

  const ACTIONS = {
    getMonthBills,
    getBusinessBill,
    whatIf,
    saveDeal,
    setCommissionMode,
    recordPayment,
    voidPayment,
    closeMonth,
    reopenMonth,
  };

  async function platformBilling(request) {
    const data = request.data && typeof request.data === "object" ?
      request.data : {};
    const action = text(data.action, 40);
    const run = Object.prototype.hasOwnProperty.call(ACTIONS, action) ?
      ACTIONS[action] : null;
    // Who is asking is settled before what they asked is judged.
    const ctx = await access(request);
    if (!run) refuse("action_invalid");
    return run(ctx, data);
  }

  return {platformBilling, ACTIONS: Object.keys(ACTIONS)};
}

module.exports = {
  CALL_BUDGET_MS,
  MAX_ROWS,
  createPlatformBillingHandlers,
};
