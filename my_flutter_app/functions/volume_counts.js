"use strict";

/**
 * Monthly volume - what a business handled in a month, counted in pieces
 * (docs/PACKAGE_REQUESTS.md §5 and §7, "Monthly volume - as built").
 *
 * The pure half. Every Firestore call stays in `volume_rollup.js`; this file
 * decides what a line or a container counts as, which month it counts in,
 * which monthly rollups a write touches, and what a rollup document holds.
 *
 * What counts:
 *   - A piece counts in the month (America/New_York) its line was RECEIVED:
 *     `receivedAt`, or for a legacy line with none, `createdAt`. A split part
 *     with no `receivedAt` of its own inherits its root's.
 *   - Pieces come from the line's denormalized counts (`barrelPieces`,
 *     `packagePieces`, `carPieces`), else from `pieces[]`, else - a legacy
 *     line - from kind/quantity: a car is 1 car piece, barrels are `quantity`
 *     barrel pieces, anything else `quantity` package pieces.
 *   - Customer lines are the customer loads received: root lines only (a
 *     split part is the same load), and not the business's own stock.
 *   - A container counts in the month it SAILED (`sailedAt`) while it is
 *     shipped or arrived. What it carried is the pieces of the lines whose
 *     `containerId` is that container - counted independently of when those
 *     lines were received.
 */

const {zonedDayKey, normalizeTimeZone} = require("./console_summaries");
const {zoneOffsetMs} = require("./inventory");

const VOLUME_COLLECTION = "volumeMonthly";
const VOLUME_TIME_ZONE = "America/New_York";
/** The container list a rollup keeps; the totals still count every one. */
const MAX_ROLLUP_CONTAINERS = 200;
/** The longest range one rebuild call accepts. */
const MAX_REBUILD_MONTHS = 24;
const TREND_MONTHS = 12;
const SHIPPED_STATUSES = new Set(["shipped", "arrived"]);
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
// Far beyond any real line; a typo must not inflate a month.
const MAX_LINE_PIECES = 999;

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);

/**
 * A non-negative whole count.
 *
 * @param {*} value Raw value.
 * @return {number} The count, 0 when unusable.
 */
function count(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_LINE_PIECES, Math.round(n));
}

/**
 * @param {*} value A field that may hold a count.
 * @return {boolean} Whether it is a number at all (0 included).
 */
function isCount(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * A Date from anything a Firestore row may hold.
 *
 * @param {*} value Timestamp, Date, ISO string, millis or {seconds}.
 * @return {Date|null} The date, or null when unusable.
 */
function toDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "object") {
    if (typeof value.toDate === "function") {
      try {
        const date = value.toDate();
        return date instanceof Date && !Number.isNaN(date.getTime()) ?
          date : null;
      } catch (_) {
        return null;
      }
    }
    if (typeof value.seconds === "number") {
      return new Date(value.seconds * 1000);
    }
    if (typeof value._seconds === "number") {
      return new Date(value._seconds * 1000);
    }
    return null;
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

// -------------------------------------------------------------------------
// Months.
// -------------------------------------------------------------------------

/**
 * @param {*} value Input.
 * @return {boolean} Whether it is a "yyyy-mm" month key.
 */
function isMonthKey(value) {
  return typeof value === "string" && MONTH_RE.test(value);
}

/**
 * @param {string} timeZone IANA zone, or "" for the volume zone.
 * @return {string} A zone Intl accepts.
 */
function volumeZone(timeZone) {
  return normalizeTimeZone(timeZone || VOLUME_TIME_ZONE) || VOLUME_TIME_ZONE;
}

/**
 * The month an instant falls in, in a zone.
 *
 * @param {Date} date The instant.
 * @param {string} [timeZone] IANA zone (America/New_York by default).
 * @return {string} "yyyy-mm", or "" for no date.
 */
function monthKeyOf(date, timeZone = VOLUME_TIME_ZONE) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return zonedDayKey(date, volumeZone(timeZone)).slice(0, 7);
}

/**
 * @param {string} month "yyyy-mm".
 * @param {number} delta Months to move (negative goes back).
 * @return {string} The month that many months away.
 */
function shiftMonth(month, delta) {
  const match = MONTH_RE.exec(String(month));
  if (!match) return "";
  const index = Number(match[1]) * 12 + Number(match[2]) - 1 +
    Math.trunc(Number(delta) || 0);
  const year = Math.floor(index / 12);
  const mm = index - year * 12 + 1;
  return `${String(year).padStart(4, "0")}-${String(mm).padStart(2, "0")}`;
}

const previousMonth = (month) => shiftMonth(month, -1);
const nextMonth = (month) => shiftMonth(month, 1);

/**
 * The months from `from` through `to`, oldest first.
 *
 * @param {string} from "yyyy-mm".
 * @param {string} to "yyyy-mm".
 * @param {number} [max] Refuse (return []) a longer range.
 * @return {string[]} The months, [] when the range is invalid.
 */
function monthsBetween(from, to, max = MAX_REBUILD_MONTHS) {
  if (!isMonthKey(from) || !isMonthKey(to) || from > to) return [];
  const out = [];
  for (let month = from; month <= to; month = nextMonth(month)) {
    out.push(month);
    if (out.length > max) return [];
  }
  return out;
}

/**
 * The `n` months ending with `month`, oldest first (a 12-month trend).
 *
 * @param {string} month "yyyy-mm".
 * @param {number} [n] How many.
 * @return {string[]} The months.
 */
function lastMonths(month, n = TREND_MONTHS) {
  if (!isMonthKey(month)) return [];
  const out = [];
  for (let i = n - 1; i >= 0; i -= 1) out.push(shiftMonth(month, -i));
  return out;
}

/**
 * The local midnight a day begins at, as an instant.
 *
 * @param {number} year Full year.
 * @param {number} monthIndex 0-11 (12 rolls into the next year).
 * @param {string} zone IANA zone.
 * @return {number} Millis.
 */
function zonedMonthStartMs(year, monthIndex, zone) {
  const midnight = Date.UTC(year, monthIndex, 1);
  // Shift by the zone's offset at that moment, then once more because the
  // offset can differ by then (a DST change near midnight).
  let start = midnight - zoneOffsetMs(midnight, zone);
  start = midnight - zoneOffsetMs(start, zone);
  return start;
}

/**
 * The instants a month covers in a zone: [startMs, endMs).
 *
 * @param {string} month "yyyy-mm".
 * @param {string} [timeZone] IANA zone (America/New_York by default).
 * @return {{startMs: number, endMs: number}|null} The window.
 */
function monthWindow(month, timeZone = VOLUME_TIME_ZONE) {
  const match = MONTH_RE.exec(String(month));
  if (!match) return null;
  const zone = volumeZone(timeZone);
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  return {
    startMs: zonedMonthStartMs(year, monthIndex, zone),
    endMs: zonedMonthStartMs(year, monthIndex + 1, zone),
  };
}

/**
 * The month a viewer is in now (the month picker's default).
 *
 * @param {Date} [now] The current instant.
 * @param {string} [timeZone] IANA zone.
 * @return {string} "yyyy-mm".
 */
function currentMonthKey(now = new Date(), timeZone = VOLUME_TIME_ZONE) {
  return monthKeyOf(now, timeZone);
}

// -------------------------------------------------------------------------
// Lines.
// -------------------------------------------------------------------------

/**
 * The pieces a line holds, by kind.
 *
 * @param {object} line A stored line.
 * @return {{pieces: number, barrels: number, packages: number,
 *   cars: number}} Its pieces.
 */
function linePieces(line) {
  const row = line && typeof line === "object" ? line : {};
  const kind = text(row.kind, 20);
  let barrels = 0;
  let packages = 0;
  let cars = 0;
  if (kind === "car") {
    // A car is its own line and always one piece, whatever else it says.
    cars = 1;
  } else if (isCount(row.barrelPieces) || isCount(row.packagePieces) ||
      isCount(row.carPieces)) {
    barrels = count(row.barrelPieces);
    packages = count(row.packagePieces);
    cars = count(row.carPieces);
  } else if (Array.isArray(row.pieces) && row.pieces.length > 0) {
    for (const piece of row.pieces.slice(0, MAX_LINE_PIECES)) {
      const pieceKind = text(piece?.kind, 20);
      if (pieceKind === "barrel") barrels += 1;
      else if (pieceKind === "car") cars += 1;
      else packages += 1;
    }
  } else if (kind === "barrels") {
    barrels = count(row.quantity);
  } else {
    // "other" (and anything older): the quantity, at least one - the same
    // reading as the container tallies (containerCounts).
    packages = count(row.quantity) || 1;
  }
  return {pieces: barrels + packages + cars, barrels, packages, cars};
}

/**
 * @param {object} line A stored line.
 * @param {string} id Its document id.
 * @return {boolean} Whether it is the root of its group (its own load, not a
 *   split part): no rootLineId, or its own id.
 */
function isRootLine(line, id) {
  const root = text(line?.rootLineId);
  return !root || root === text(id);
}

/**
 * @param {object} line A stored line.
 * @param {string} id Its document id.
 * @return {boolean} Whether it is a split part that names no receivedAt of
 *   its own, so it needs its root's.
 */
function partNeedsRoot(line, id) {
  return !isRootLine(line, id) && !toDate(line?.receivedAt);
}

/**
 * When a line's pieces were received: its own receivedAt; for a part with
 * none, its root's; else (legacy) when it was created.
 *
 * @param {object} line A stored line.
 * @param {string} id Its document id.
 * @param {object|null} [root] The root line, when this is a part.
 * @return {Date|null} The instant.
 */
function lineReceivedAt(line, id, root = null) {
  const own = toDate(line?.receivedAt);
  if (own) return own;
  if (!isRootLine(line, id) && root) {
    const inherited = toDate(root.receivedAt) || toDate(root.createdAt);
    if (inherited) return inherited;
  }
  return toDate(line?.createdAt);
}

/**
 * @param {object} line A stored line.
 * @param {string} id Its document id.
 * @param {string} [timeZone] IANA zone.
 * @param {object|null} [root] The root line, when this is a part.
 * @return {string} The month its pieces count in, "" when undated.
 */
function lineMonthKey(line, id, timeZone = VOLUME_TIME_ZONE, root = null) {
  return monthKeyOf(lineReceivedAt(line, id, root), timeZone);
}

/**
 * @param {object} line A stored line.
 * @param {string} id Its document id.
 * @return {boolean} Whether it is a customer load (root, not stock).
 */
function isCustomerLine(line, id) {
  return isRootLine(line, id) && text(line?.ownerKind, 20) !== "stock";
}

// -------------------------------------------------------------------------
// Containers.
// -------------------------------------------------------------------------

/**
 * @param {object} container A stored container.
 * @return {boolean} Whether it has sailed (shipped or arrived, with a date).
 */
function containerShipped(container) {
  return SHIPPED_STATUSES.has(text(container?.status, 20)) &&
    Boolean(toDate(container?.sailedAt));
}

/**
 * @param {object} container A stored container.
 * @param {string} [timeZone] IANA zone.
 * @return {string} The month it counts in, "" while it has not sailed.
 */
function containerMonthKey(container, timeZone = VOLUME_TIME_ZONE) {
  if (!containerShipped(container)) return "";
  return monthKeyOf(toDate(container.sailedAt), timeZone);
}

/**
 * What a container is called on the volume screens: its number, else its
 * booking, else its working name.
 *
 * @param {object} container A stored container.
 * @return {string} The name.
 */
function containerDisplayNumber(container) {
  return text(container?.containerNumber, 20) ||
    text(container?.bookingReference, 60) || text(container?.label, 120);
}

// -------------------------------------------------------------------------
// Which rollups a write touches.
// -------------------------------------------------------------------------

/**
 * @param {string} businessId The business.
 * @param {string} month "yyyy-mm".
 * @return {string} The rollup document id.
 */
function volumeDocId(businessId, month) {
  return `${text(businessId).replace(/\//g, "_")}_${month}`;
}

/**
 * What of a line the month's line counts read. Two writes with the same
 * signature cannot change those counts (a payment, a contact edit, the
 * container's status catching up on its lines).
 *
 * @param {object|null} line The line, or null when absent.
 * @param {string} id Its id.
 * @param {string} timeZone IANA zone.
 * @param {object|null} root Its root, when it is a part lacking receivedAt.
 * @return {string} The signature ("" when absent).
 */
function lineCountSignature(line, id, timeZone, root) {
  if (!line) return "";
  const pieces = linePieces(line);
  return JSON.stringify([text(line.businessId),
    lineMonthKey(line, id, timeZone, root), pieces.barrels, pieces.packages,
    pieces.cars, isCustomerLine(line, id)]);
}

/**
 * What of a line a container's contents read.
 *
 * @param {object|null} line The line, or null when absent.
 * @return {string} The signature ("" when absent).
 */
function lineContentSignature(line) {
  if (!line) return "";
  const pieces = linePieces(line);
  return JSON.stringify([text(line.containerId), pieces.barrels,
    pieces.packages, pieces.cars]);
}

/**
 * Which rollups a line write touches.
 *
 * @param {object} args
 * @param {object|null} args.before The line before (null when created).
 * @param {object|null} args.after The line after (null when deleted).
 * @param {string} args.id The line id.
 * @param {object|null} [args.beforeRoot] Root of `before`, if it needs one.
 * @param {object|null} [args.afterRoot] Root of `after`, if it needs one.
 * @param {string} [args.timeZone] IANA zone.
 * @return {{months: Array<{businessId: string, month: string}>,
 *   containerIds: string[]}} Rollups to recompute for the line counts, and
 *   containers whose contents changed (the caller recomputes their sailing
 *   month when they have sailed).
 */
function lineWriteTargets({before, after, id, beforeRoot = null,
  afterRoot = null, timeZone = VOLUME_TIME_ZONE}) {
  const months = [];
  const seen = new Set();
  const add = (businessId, month) => {
    if (!businessId || !month) return;
    const key = volumeDocId(businessId, month);
    if (seen.has(key)) return;
    seen.add(key);
    months.push({businessId, month});
  };
  if (lineCountSignature(before, id, timeZone, beforeRoot) !==
      lineCountSignature(after, id, timeZone, afterRoot)) {
    if (before) {
      add(text(before.businessId), lineMonthKey(before, id, timeZone,
          beforeRoot));
    }
    if (after) {
      add(text(after.businessId), lineMonthKey(after, id, timeZone,
          afterRoot));
    }
  }
  const containerIds = [];
  if (lineContentSignature(before) !== lineContentSignature(after)) {
    for (const cid of [text(before?.containerId), text(after?.containerId)]) {
      if (cid && !containerIds.includes(cid)) containerIds.push(cid);
    }
  }
  return {months, containerIds};
}

/**
 * What of a container a month's rollup reads.
 *
 * @param {object|null} container The container, or null when absent.
 * @param {string} timeZone IANA zone.
 * @return {string} The signature ("" when absent or not sailed).
 */
function containerSignature(container, timeZone) {
  if (!container) return "";
  const month = containerMonthKey(container, timeZone);
  if (!month) return "";
  return JSON.stringify([text(container.businessId), month,
    toDate(container.sailedAt).getTime(), containerDisplayNumber(container),
    text(container.destinationCountryName, 120),
    text(container.destinationCountryId, 60), text(container.status, 20)]);
}

/**
 * Which rollups a container write touches: the month it sailed in before
 * and after, when anything the rollup shows changed (it sailed, it was moved
 * back, its date or number was corrected).
 *
 * @param {object} args
 * @param {object|null} args.before The container before.
 * @param {object|null} args.after The container after.
 * @param {string} [args.timeZone] IANA zone.
 * @return {Array<{businessId: string, month: string}>} Rollups.
 */
function containerWriteTargets({before, after,
  timeZone = VOLUME_TIME_ZONE}) {
  if (containerSignature(before, timeZone) ===
      containerSignature(after, timeZone)) {
    return [];
  }
  const out = [];
  for (const row of [before, after]) {
    const month = row ? containerMonthKey(row, timeZone) : "";
    const businessId = text(row?.businessId);
    if (!month || !businessId) continue;
    if (out.some((t) => t.businessId === businessId && t.month === month)) {
      continue;
    }
    out.push({businessId, month});
  }
  return out;
}

// -------------------------------------------------------------------------
// The rollup document.
// -------------------------------------------------------------------------

/**
 * @param {number} pieces Pieces carried.
 * @param {number} containers Containers shipped.
 * @return {number|null} Average pieces per container (one decimal), null
 *   when nothing shipped.
 */
function averagePerContainer(pieces, containers) {
  const n = Number(containers) || 0;
  if (n <= 0) return null;
  return Math.round(((Number(pieces) || 0) / n) * 10) / 10;
}

/**
 * Change from the previous figure, as a percentage (one decimal).
 *
 * @param {number} current This month.
 * @param {number} previous The month before.
 * @return {number|null} The change, null when there is nothing to compare
 *   with (the previous month was zero).
 */
function percentChange(current, previous) {
  const before = Number(previous) || 0;
  const now = Number(current) || 0;
  if (before <= 0) return null;
  return Math.round(((now - before) / before) * 1000) / 10;
}

/**
 * A month's rollup from the lines and containers that may belong to it.
 * Candidates outside the month or business are ignored and duplicates are
 * counted once, so the caller can hand over the union of several queries.
 *
 * @param {object} args
 * @param {string} args.businessId The business.
 * @param {string} args.month "yyyy-mm".
 * @param {string} [args.timeZone] IANA zone.
 * @param {Array<{id: string, data: object}>} args.lines Candidate lines.
 * @param {Map<string, object>} [args.roots] Root lines by id, for parts
 *   that lack receivedAt.
 * @param {Array<{id: string, data: object}>} args.containers Candidate
 *   containers.
 * @param {Map<string, Array<{id: string, data: object}>>} args.contents
 *   The lines on each container, by container id.
 * @param {boolean} [args.complete] False when a read stopped early.
 * @return {object} The rollup body (no timestamps).
 */
function buildMonthRollup({businessId, month, timeZone = VOLUME_TIME_ZONE,
  lines = [], roots = new Map(), containers = [], contents = new Map(),
  complete = true}) {
  const biz = text(businessId);
  const totals = {pieces: 0, barrels: 0, packages: 0, cars: 0,
    customerLines: 0, lineCount: 0};
  const counted = new Set();
  for (const entry of lines) {
    const id = text(entry?.id);
    const line = entry?.data || {};
    if (!id || counted.has(id) || text(line.businessId) !== biz) continue;
    const root = isRootLine(line, id) ? null :
      roots.get(text(line.rootLineId)) || null;
    if (lineMonthKey(line, id, timeZone, root) !== month) continue;
    counted.add(id);
    const pieces = linePieces(line);
    totals.pieces += pieces.pieces;
    totals.barrels += pieces.barrels;
    totals.packages += pieces.packages;
    totals.cars += pieces.cars;
    totals.lineCount += 1;
    if (isCustomerLine(line, id)) totals.customerLines += 1;
  }

  const shipped = [];
  const seenBoxes = new Set();
  for (const entry of containers) {
    const id = text(entry?.id);
    const box = entry?.data || {};
    if (!id || seenBoxes.has(id) || text(box.businessId) !== biz) continue;
    if (containerMonthKey(box, timeZone) !== month) continue;
    seenBoxes.add(id);
    const inside = {pieces: 0, barrels: 0, packages: 0, cars: 0};
    const onBox = new Set();
    for (const lineEntry of contents.get(id) || []) {
      const lineId = text(lineEntry?.id);
      const line = lineEntry?.data || {};
      if (!lineId || onBox.has(lineId) || text(line.containerId) !== id) {
        continue;
      }
      onBox.add(lineId);
      const pieces = linePieces(line);
      inside.pieces += pieces.pieces;
      inside.barrels += pieces.barrels;
      inside.packages += pieces.packages;
      inside.cars += pieces.cars;
    }
    shipped.push({
      id,
      number: containerDisplayNumber(box),
      destination: text(box.destinationCountryName, 120),
      destinationCountryId: text(box.destinationCountryId, 60),
      status: text(box.status, 20),
      sailedAtMs: toDate(box.sailedAt).getTime(),
      lineCount: onBox.size,
      ...inside,
    });
  }
  shipped.sort((a, b) => a.sailedAtMs - b.sailedAtMs ||
    a.id.localeCompare(b.id));
  const containerPieces = shipped.reduce((sum, c) => sum + c.pieces, 0);
  return {
    businessId: biz,
    month,
    timeZone: volumeZone(timeZone),
    ...totals,
    containersShipped: shipped.length,
    containerPieces,
    avgPerContainer: averagePerContainer(containerPieces, shipped.length),
    containers: shipped.slice(0, MAX_ROLLUP_CONTAINERS),
    containersTruncated: shipped.length > MAX_ROLLUP_CONTAINERS,
    complete: complete !== false,
  };
}

/**
 * The numbers of a stored rollup, every field defaulted - a month nobody
 * has computed (or one whose recompute only got as far as claiming its
 * turn) reads as zeros.
 *
 * @param {object|null|undefined} doc A stored rollup.
 * @return {object} {pieces, barrels, packages, cars, customerLines,
 *   containersShipped, containerPieces, avgPerContainer}.
 */
function rollupNumbers(doc) {
  const row = doc && typeof doc === "object" ? doc : {};
  const n = (value) => Math.max(0, Math.round(Number(value) || 0));
  const containersShipped = n(row.containersShipped);
  const containerPieces = n(row.containerPieces);
  return {
    pieces: n(row.pieces),
    barrels: n(row.barrels),
    packages: n(row.packages),
    cars: n(row.cars),
    customerLines: n(row.customerLines),
    containersShipped,
    containerPieces,
    avgPerContainer: averagePerContainer(containerPieces, containersShipped),
  };
}

/**
 * The containers a stored rollup lists, cleaned for a client.
 *
 * @param {object|null|undefined} doc A stored rollup.
 * @return {object[]} The list.
 */
function rollupContainers(doc) {
  const list = Array.isArray(doc?.containers) ? doc.containers : [];
  const n = (value) => Math.max(0, Math.round(Number(value) || 0));
  return list.slice(0, MAX_ROLLUP_CONTAINERS).map((c) => {
    const barrels = n(c?.barrels);
    const packages = n(c?.packages);
    const cars = n(c?.cars);
    return {
      id: text(c?.id),
      number: text(c?.number, 120),
      destination: text(c?.destination, 120),
      status: text(c?.status, 20),
      sailedAtMs: Number(c?.sailedAtMs) || 0,
      pieces: barrels + packages + cars,
      barrels,
      packages,
      cars,
    };
  });
}

/**
 * The "By business" table (and the CSV made from it): one row per business
 * for the month, busiest first, plus the totals row.
 *
 * @param {Array<object>} docs The month's stored rollups.
 * @param {Map<string, string>} names Current business names by id; a
 *   deleted or unnamed business falls back to its id.
 * @return {{rows: object[], totals: object}} The table.
 */
function volumeTableRows(docs, names = new Map()) {
  const rows = [];
  for (const doc of Array.isArray(docs) ? docs : []) {
    const businessId = text(doc?.businessId);
    if (!businessId) continue;
    const numbers = rollupNumbers(doc);
    if (numbers.pieces === 0 && numbers.containersShipped === 0 &&
        numbers.customerLines === 0) {
      continue;
    }
    rows.push({businessId, name: text(names.get(businessId), 200) ||
      businessId, ...numbers});
  }
  rows.sort((a, b) => b.pieces - a.pieces ||
    b.containersShipped - a.containersShipped ||
    a.name.localeCompare(b.name));
  const sum = (key) => rows.reduce((total, row) => total + row[key], 0);
  const containersShipped = sum("containersShipped");
  const containerPieces = sum("containerPieces");
  return {
    rows,
    totals: {
      businesses: rows.length,
      pieces: sum("pieces"),
      barrels: sum("barrels"),
      packages: sum("packages"),
      cars: sum("cars"),
      customerLines: sum("customerLines"),
      containersShipped,
      containerPieces,
      avgPerContainer: averagePerContainer(containerPieces,
          containersShipped),
    },
  };
}

module.exports = {
  MAX_REBUILD_MONTHS,
  MAX_ROLLUP_CONTAINERS,
  TREND_MONTHS,
  VOLUME_COLLECTION,
  VOLUME_TIME_ZONE,
  averagePerContainer,
  buildMonthRollup,
  containerDisplayNumber,
  containerMonthKey,
  containerShipped,
  containerWriteTargets,
  currentMonthKey,
  isCustomerLine,
  isMonthKey,
  isRootLine,
  lastMonths,
  lineMonthKey,
  linePieces,
  lineReceivedAt,
  lineWriteTargets,
  monthKeyOf,
  monthWindow,
  monthsBetween,
  nextMonth,
  partNeedsRoot,
  percentChange,
  previousMonth,
  rollupContainers,
  rollupNumbers,
  shiftMonth,
  toDate,
  volumeDocId,
  volumeTableRows,
};
