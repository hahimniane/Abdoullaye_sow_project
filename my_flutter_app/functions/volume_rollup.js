"use strict";

/**
 * Monthly volume rollups: `volumeMonthly/{businessId}_{yyyy-mm}`.
 *
 * Each rollup is RECOMPUTED from the records, never incremented: a trigger
 * on a line or a container works out which months the write touched
 * (volume_counts.js) and recounts each of them from scratch. A recount is
 * idempotent, so a retried or duplicated event, a trigger storm (assigning
 * fifty lines at once) or a repair from `rebuildVolumeMonths` all converge on
 * the same document.
 *
 * Concurrent recounts of one month are ordered by a turn number on the
 * rollup itself (`requestSeq`): each recount claims the next turn before it
 * reads, and writes only if no later recount has claimed one since. The last
 * recount to start therefore always writes, and it started after every write
 * whose trigger had fired. Triggers also wait a moment after claiming and
 * step aside when a newer turn arrives, so a burst collapses to one recount.
 *
 * Everything Firebase-specific arrives through `deps`, as console_totals.js
 * does, so index.js keeps a one-line export per function.
 */

const {
  MAX_REBUILD_MONTHS,
  TREND_MONTHS,
  VOLUME_COLLECTION,
  VOLUME_TIME_ZONE,
  buildMonthRollup,
  containerMonthKey,
  containerShipped,
  containerWriteTargets,
  currentMonthKey,
  isMonthKey,
  isRootLine,
  lastMonths,
  lineWriteTargets,
  monthWindow,
  monthsBetween,
  partNeedsRoot,
  percentChange,
  previousMonth,
  rollupContainers,
  rollupNumbers,
  volumeDocId,
  volumeTableRows,
} = require("./volume_counts");
const {drainPages} = require("./scheduled_sweep");

const PAGE_SIZE = 500;
/** A month's recount stops starting pages after this. */
const RECOUNT_BUDGET_MS = 45 * 1000;
/** How long a trigger waits for a burst to settle before recounting. */
const TRIGGER_DEBOUNCE_MS = 1500;
/** A rebuild call stops starting months after this (inside its timeout). */
const REBUILD_BUDGET_MS = 240 * 1000;
const REBUILD_BUSINESS_PAGE = 50;
const IN_BATCH = 30;
const CONTAINERS_SECTION = "containers";

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
 * @param {object} deps Firebase handles and permission helpers.
 * @return {object} Trigger and callable handlers keyed by export name.
 */
function createVolumeHandlers(deps) {
  const {
    admin,
    HttpsError,
    logger,
    requireAuth,
    getUserProfile,
    hasAdminCapability,
    hasAdminSectionAccess = () => false,
    requireBusinessPermission,
    now = () => new Date(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    debounceMs = TRIGGER_DEBOUNCE_MS,
    timeZone = VOLUME_TIME_ZONE,
  } = deps;
  const db = () => admin.firestore();
  const {Timestamp, FieldPath, FieldValue} =
    require("firebase-admin/firestore");

  /**
   * Every document a range query matches, by cursor, under a deadline.
   *
   * @param {object} query The filtered query.
   * @param {string} orderField The range field (pages are ordered by it).
   * @param {number} deadlineMs Stop starting pages after this.
   * @return {Promise<{docs: Array, complete: boolean}>} The documents.
   */
  async function readRange(query, orderField, deadlineMs) {
    const docs = [];
    const result = await drainPages({
      pageSize: PAGE_SIZE,
      deadlineMs,
      now: () => now().getTime(),
      fetchPage: async (cursor) => {
        let page = query.orderBy(orderField).limit(PAGE_SIZE);
        if (cursor) page = page.startAfter(cursor);
        return (await page.get()).docs;
      },
      processPage: async (page) => {
        docs.push(...page);
      },
    });
    return {docs, complete: result.exhausted};
  }

  /**
   * The lines whose pieces may count in a month: received in it, or (legacy
   * and parts lacking receivedAt) created in it, or parts of the month's
   * roots that name no receivedAt of their own.
   *
   * @param {string} businessId The business.
   * @param {{startMs: number, endMs: number}} window The month.
   * @param {number} deadlineMs Read deadline.
   * @return {Promise<object>} {lines, roots, complete}.
   */
  async function monthLines(businessId, window, deadlineMs) {
    const lines = db().collection("containerLines")
        .where("businessId", "==", businessId);
    const start = Timestamp.fromMillis(window.startMs);
    const end = Timestamp.fromMillis(window.endMs);
    const [received, created] = await Promise.all([
      readRange(lines.where("receivedAt", ">=", start)
          .where("receivedAt", "<", end), "receivedAt", deadlineMs),
      readRange(lines.where("createdAt", ">=", start)
          .where("createdAt", "<", end), "createdAt", deadlineMs),
    ]);
    const byId = new Map();
    for (const doc of received.docs) byId.set(doc.id, doc.data() || {});
    // Created this month but received some other month: not this month's.
    for (const doc of created.docs) {
      const data = doc.data() || {};
      if (!byId.has(doc.id) && !data.receivedAt) byId.set(doc.id, data);
    }
    // A split part with no receivedAt counts when its root was received,
    // which can be a different month from when the part was created.
    const rootIds = [...byId.entries()]
        .filter(([id, data]) => isRootLine(data, id) &&
          String(data.rootLineId || "") === id)
        .map(([id]) => id);
    let complete = received.complete && created.complete;
    for (const group of chunks(rootIds)) {
      if (now().getTime() >= deadlineMs) {
        complete = false;
        break;
      }
      const parts = await db().collection("containerLines")
          .where("rootLineId", "in", group).get();
      for (const doc of parts.docs) {
        const data = doc.data() || {};
        if (String(data.businessId || "") !== businessId) continue;
        if (!byId.has(doc.id) && partNeedsRoot(data, doc.id)) {
          byId.set(doc.id, data);
        }
      }
    }
    // Roots of the parts that need one and are not already in hand.
    const roots = new Map();
    const missing = new Set();
    for (const [id, data] of byId) {
      if (!partNeedsRoot(data, id)) continue;
      const rootId = String(data.rootLineId || "");
      if (byId.has(rootId)) roots.set(rootId, byId.get(rootId));
      else if (rootId && !rootId.includes("/")) missing.add(rootId);
    }
    for (const group of chunks([...missing], 100)) {
      const refs = group.map((id) => db().collection("containerLines").doc(id));
      const snaps = await db().getAll(...refs);
      for (const snap of snaps) {
        if (snap.exists) roots.set(snap.id, snap.data() || {});
      }
    }
    return {
      lines: [...byId.entries()].map(([id, data]) => ({id, data})),
      roots,
      complete,
    };
  }

  /**
   * The containers that sailed in a month, and the lines on each.
   *
   * @param {string} businessId The business.
   * @param {{startMs: number, endMs: number}} window The month.
   * @param {number} deadlineMs Read deadline.
   * @return {Promise<object>} {containers, contents, complete}.
   */
  async function monthContainers(businessId, window, deadlineMs) {
    const boxes = await readRange(db().collection("containers")
        .where("businessId", "==", businessId)
        .where("sailedAt", ">=", Timestamp.fromMillis(window.startMs))
        .where("sailedAt", "<", Timestamp.fromMillis(window.endMs)),
    "sailedAt", deadlineMs);
    const containers = boxes.docs
        .map((doc) => ({id: doc.id, data: doc.data() || {}}))
        .filter((entry) => containerShipped(entry.data));
    const contents = new Map();
    let complete = boxes.complete;
    for (const entry of containers) {
      if (now().getTime() >= deadlineMs) {
        complete = false;
        break;
      }
      const onBox = await db().collection("containerLines")
          .where("containerId", "==", entry.id).get();
      contents.set(entry.id, onBox.docs.map((doc) =>
        ({id: doc.id, data: doc.data() || {}})));
    }
    return {containers, contents, complete};
  }

  /**
   * Recounts one month of one business and stores it, unless a later
   * recount of the same month has started meanwhile.
   *
   * @param {string} businessId The business.
   * @param {string} month "yyyy-mm".
   * @param {object} [opts] {debounce: wait for a burst to settle first}.
   * @return {Promise<object>} {written, superseded, rollup}.
   */
  async function recountMonth(businessId, month, opts = {}) {
    const window = monthWindow(month, timeZone);
    if (!businessId || !window) return {written: false, invalid: true};
    const ref = db().collection(VOLUME_COLLECTION)
        .doc(volumeDocId(businessId, month));
    const turn = await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const next = (Number(snap.exists ? snap.data()?.requestSeq : 0) || 0) +
        1;
      tx.set(ref, {businessId, month, requestSeq: next}, {merge: true});
      return next;
    });
    if (opts.debounce && debounceMs > 0) {
      await sleep(debounceMs);
      const latest = await ref.get();
      if ((Number(latest.data()?.requestSeq) || 0) !== turn) {
        return {written: false, superseded: true};
      }
    }
    const deadlineMs = now().getTime() + RECOUNT_BUDGET_MS;
    const [lineRead, boxRead] = await Promise.all([
      monthLines(businessId, window, deadlineMs),
      monthContainers(businessId, window, deadlineMs),
    ]);
    const rollup = buildMonthRollup({
      businessId, month, timeZone,
      lines: lineRead.lines, roots: lineRead.roots,
      containers: boxRead.containers, contents: boxRead.contents,
      complete: lineRead.complete && boxRead.complete,
    });
    const written = await db().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if ((Number(snap.data()?.requestSeq) || 0) !== turn) return false;
      tx.set(ref, {
        ...rollup,
        requestSeq: turn,
        computedAtMs: now().getTime(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return true;
    });
    if (!rollup.complete) {
      logger.warn("volume recount stopped early", {businessId, month});
    }
    return {written, superseded: !written, rollup};
  }

  /**
   * @param {Array<{businessId: string, month: string}>} targets Rollups.
   * @param {object} opts Passed to recountMonth.
   * @return {Promise<number>} How many were written.
   */
  async function recountAll(targets, opts) {
    let written = 0;
    for (const target of targets) {
      const result = await recountMonth(target.businessId, target.month, opts);
      if (result.written) written += 1;
    }
    return written;
  }

  /**
   * @param {object|null} line A line that may be a part lacking receivedAt.
   * @param {string} id Its id.
   * @return {Promise<object|null>} Its root, when it needs one.
   */
  async function rootFor(line, id) {
    if (!line || !partNeedsRoot(line, id)) return null;
    const rootId = String(line.rootLineId || "").trim();
    if (!rootId || rootId.includes("/")) return null;
    const snap = await db().collection("containerLines").doc(rootId).get();
    return snap.exists ? snap.data() || {} : null;
  }

  // ---- Triggers --------------------------------------------------------

  async function rollupVolumeOnLineWrite(event) {
    const id = String(event.params?.lineId || "");
    const before = event.data?.before?.exists === false ? null :
      event.data?.before?.data?.() || null;
    const after = event.data?.after?.exists === false ? null :
      event.data?.after?.data?.() || null;
    if (!id || (!before && !after)) return {written: 0};
    const [beforeRoot, afterRoot] = await Promise.all([
      rootFor(before, id), rootFor(after, id)]);
    const {months, containerIds} = lineWriteTargets({before, after, id,
      beforeRoot, afterRoot, timeZone});
    const targets = [...months];
    if (containerIds.length > 0) {
      const snaps = await db().getAll(...containerIds.map((cid) =>
        db().collection("containers").doc(cid)));
      for (const snap of snaps) {
        if (!snap.exists) continue;
        const box = snap.data() || {};
        const month = containerMonthKey(box, timeZone);
        const businessId = String(box.businessId || "");
        if (!month || !businessId) continue;
        if (targets.some((t) => t.businessId === businessId &&
            t.month === month)) {
          continue;
        }
        targets.push({businessId, month});
      }
    }
    const written = await recountAll(targets, {debounce: true});
    return {written, targets: targets.length};
  }

  async function rollupVolumeOnContainerWrite(event) {
    const before = event.data?.before?.exists === false ? null :
      event.data?.before?.data?.() || null;
    const after = event.data?.after?.exists === false ? null :
      event.data?.after?.data?.() || null;
    const targets = containerWriteTargets({before, after, timeZone});
    const written = await recountAll(targets, {debounce: true});
    return {written, targets: targets.length};
  }

  // ---- Permissions -----------------------------------------------------

  /**
   * Platform admins who may open the Finance tab read the platform's volume
   * (it is what the platform bills on); managing finance may rebuild it.
   *
   * @param {object} request The callable request.
   * @param {string} level "view" or "manage".
   * @return {Promise<object>} The caller's profile.
   */
  async function requireVolumeAdmin(request, level) {
    const uid = requireAuth(request);
    const user = await getUserProfile(uid);
    const allowed = user?.role === "admin" && (level === "manage" ?
      hasAdminCapability(user, "finance") :
      hasAdminCapability(user, "finance") ||
        hasAdminSectionAccess(user, "finance", "view"));
    if (!allowed) {
      throw new HttpsError("permission-denied",
          "Only finance admins can read platform volume");
    }
    return user;
  }

  function monthFrom(value, fallback) {
    const month = String(value || "").trim();
    if (!month) return fallback;
    if (!isMonthKey(month)) {
      throw new HttpsError("invalid-argument", "Choose a month (yyyy-mm).");
    }
    return month;
  }

  // ---- Callables -------------------------------------------------------

  async function rebuildVolumeMonths(request) {
    await requireVolumeAdmin(request, "manage");
    const data = request.data || {};
    const thisMonth = currentMonthKey(now(), timeZone);
    const fromMonth = monthFrom(data.fromMonth, thisMonth);
    const toMonth = monthFrom(data.toMonth, fromMonth);
    const months = monthsBetween(fromMonth, toMonth, MAX_REBUILD_MONTHS);
    if (months.length === 0) {
      throw new HttpsError("invalid-argument",
          `Choose up to ${MAX_REBUILD_MONTHS} months, oldest first.`);
    }
    const one = String(data.businessId || "").trim();
    if (one.includes("/")) {
      throw new HttpsError("invalid-argument", "Unknown business.");
    }
    let businessIds;
    let nextBusinessId = "";
    if (one) {
      businessIds = [one];
    } else {
      let page = db().collection("businesses").select()
          .orderBy(FieldPath.documentId()).limit(REBUILD_BUSINESS_PAGE);
      const after = String(data.startAfterBusinessId || "").trim();
      if (after) page = page.startAfter(after);
      const snap = await page.get();
      businessIds = snap.docs.map((doc) => doc.id);
      if (snap.size === REBUILD_BUSINESS_PAGE) {
        nextBusinessId = businessIds[businessIds.length - 1];
      }
    }
    const deadlineMs = now().getTime() + REBUILD_BUDGET_MS;
    let rebuilt = 0;
    let incomplete = 0;
    // The last business fully recounted: the cursor a follow-up call
    // passes as startAfterBusinessId.
    let lastDone = one ? "" : String(data.startAfterBusinessId || "").trim();
    for (const businessId of businessIds) {
      if (now().getTime() >= deadlineMs) {
        return {rebuilt, incomplete, months, done: false,
          nextBusinessId: lastDone};
      }
      for (const month of months) {
        const result = await recountMonth(businessId, month);
        if (result.written) rebuilt += 1;
        if (result.rollup && !result.rollup.complete) incomplete += 1;
      }
      lastDone = businessId;
    }
    return {rebuilt, incomplete, months, done: !nextBusinessId,
      nextBusinessId};
  }

  /**
   * The month's totals and per-business rows across the platform, plus the
   * 12-month trend. Reads only rollups.
   *
   * @param {object} request The callable request ({month}).
   * @return {Promise<object>} The page's numbers.
   */
  async function getPlatformVolume(request) {
    await requireVolumeAdmin(request, "view");
    const month = monthFrom(request.data?.month,
        currentMonthKey(now(), timeZone));
    const collection = db().collection(VOLUME_COLLECTION);
    const {AggregateField} = require("firebase-admin/firestore");
    const trendMonths = lastMonths(month, TREND_MONTHS);
    const prev = previousMonth(month);
    const [docs, ...sums] = await Promise.all([
      // The numbers only - each rollup's container list stays behind.
      collection.where("month", "==", month)
          .select("businessId", "pieces", "barrels", "packages", "cars",
              "customerLines", "containersShipped", "containerPieces")
          .get(),
      ...[prev, ...trendMonths].map((m) => collection
          .where("month", "==", m)
          .aggregate({pieces: AggregateField.sum("pieces")}).get()),
    ]);
    const rows = docs.docs.map((doc) => doc.data() || {});
    const ids = [...new Set(rows.map((row) => String(row.businessId || ""))
        .filter((id) => id && !id.includes("/")))];
    const names = new Map();
    for (const group of chunks(ids, 100)) {
      const snaps = await db().getAll(...group.map((id) =>
        db().collection("businesses").doc(id)), {fieldMask: ["name"]});
      for (const snap of snaps) {
        if (snap.exists) names.set(snap.id, String(snap.data()?.name || ""));
      }
    }
    const table = volumeTableRows(rows, names);
    const pieceSum = (snap) =>
      Math.max(0, Math.round(Number(snap.data().pieces) || 0));
    const previousPieces = pieceSum(sums[0]);
    return {
      month,
      timeZone,
      totals: {
        ...table.totals,
        previousPieces,
        piecesChangePct: percentChange(table.totals.pieces, previousPieces),
      },
      businesses: table.rows,
      trend: trendMonths.map((m, index) =>
        ({month: m, pieces: pieceSum(sums[index + 1])})),
      computedAtMs: now().getTime(),
    };
  }

  /**
   * One business's month: its tiles and the containers it shipped. For the
   * business's owner and staff with the containers permission, and for the
   * platform admins who read platform volume (the admin side panel).
   *
   * @param {object} request The callable request ({businessId, month}).
   * @return {Promise<object>} The business's month.
   */
  async function getBusinessVolume(request) {
    const uid = requireAuth(request);
    const businessId = String(request.data?.businessId || "").trim();
    if (!businessId || businessId.includes("/")) {
      throw new HttpsError("invalid-argument", "Missing business.");
    }
    const user = await getUserProfile(uid);
    if (user?.role === "admin") {
      await requireVolumeAdmin(request, "view");
    } else {
      await requireBusinessPermission(uid, businessId, CONTAINERS_SECTION);
    }
    const month = monthFrom(request.data?.month,
        currentMonthKey(now(), timeZone));
    const prev = previousMonth(month);
    const collection = db().collection(VOLUME_COLLECTION);
    const [current, before, business] = await db().getAll(
        collection.doc(volumeDocId(businessId, month)),
        collection.doc(volumeDocId(businessId, prev)),
        db().collection("businesses").doc(businessId),
    );
    const doc = current.exists ? current.data() || {} : {};
    const numbers = rollupNumbers(doc);
    const previousPieces = rollupNumbers(before.exists ? before.data() : {})
        .pieces;
    return {
      month,
      timeZone,
      businessId,
      businessName: business.exists ?
        String(business.data()?.name || "") || businessId : businessId,
      totals: {
        ...numbers,
        previousPieces,
        piecesChangePct: percentChange(numbers.pieces, previousPieces),
      },
      containers: rollupContainers(doc),
      containersTruncated: doc.containersTruncated === true,
      complete: doc.complete !== false,
      computedAtMs: Number(doc.computedAtMs) || null,
    };
  }

  return {
    getBusinessVolume,
    getPlatformVolume,
    rebuildVolumeMonths,
    recountMonth,
    rollupVolumeOnContainerWrite,
    rollupVolumeOnLineWrite,
  };
}

module.exports = {
  TRIGGER_DEBOUNCE_MS,
  createVolumeHandlers,
};
