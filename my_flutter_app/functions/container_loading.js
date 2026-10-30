"use strict";

/**
 * Scan to load (owner decisions 2026-10-22; docs/WAITING_PACKAGES.md
 * "Scan to load").
 *
 * Loading a container is "scan, beep, next": staff open a container that is
 * still loading, start loading, and every package label they scan goes onto
 * THAT container. A scan of a waiting package puts it on whole (exactly as
 * `assignContainerLines` without `pieceCounts`); a scan of a package already
 * on the container counts one more of its pieces; a scan of one on another
 * container that is still loading may move it here when the caller says so.
 * Every piece of a package carries the same QR, so a scan counts "one more
 * piece of this package", never a particular piece.
 *
 * Pure: no Firestore, no clock. The callable is a set of actions on
 * `assignContainerLines` in index.js (no new Cloud Function export: the CPU
 * instance budget in test/scaling-contract.test.js is at its limit), which
 * runs each scan in one transaction re-reading the line and the container
 * and hands what it read to the decisions here.
 */

const {TRACKING_ALPHABET, TRACKING_CODE_LENGTH} = require("./tracking_code");
const {
  containerAssignRefusal,
  containerIsOpen,
  destinationMismatch,
  shipModeMismatch,
  shipModeOf,
  lineCustomerName,
  lineCustomerPhone,
} = require("./container_manifest");
const {lineIsDelivered} = require("./container_delivery");
const {lineCounts} = require("./line_pieces");
const {CONFIRMATION, senderConfirmationOf} = require("./package_proof");

const LOAD_ACTION = Object.freeze({
  SCAN: "scan",
  UNDO_SCAN: "undo_scan",
  LOAD_SUMMARY: "load_summary",
  LEAVE_UNSCANNED: "leave_unscanned",
});
const LOAD_ACTIONS = Object.freeze(Object.values(LOAD_ACTION));

// What a scan answers.
const SCAN_RESULT = Object.freeze({
  LOADED: "loaded",
  COUNTED: "counted",
  ALL_SCANNED: "all_scanned",
});
// What an undo answers.
const UNDO_RESULT = Object.freeze({
  UNCOUNTED: "uncounted",
  UNLOADED: "unloaded",
  // Its last scan undone, a package a scan moved here goes back to the
  // container it came from, while that one is still loading.
  MOVED_BACK: "moved_back",
  // Nothing to take back: that scan was undone already (a retried undo), or
  // is too old to be remembered, or nothing was scanned.
  ALREADY_UNDONE: "already_undone",
});

// Container lines carry the CL prefix (CONTAINER_LINE_CODE_PREFIX in
// index.js).
const PACKAGE_CODE_PREFIX = "CL";
const PACKAGE_CODE = new RegExp(`^${PACKAGE_CODE_PREFIX}` +
  `([${TRACKING_ALPHABET}]{${TRACKING_CODE_LENGTH}})([1-9]\\d{0,3})?$`);
const SCAN_ID = /^[A-Za-z0-9_-]{8,64}$/;
// How many scan ids a line remembers (a retried request answers the same):
// at least 20, two per piece for a big package, never more than 120.
const MIN_LOAD_SCAN_IDS = 20;
const MAX_LOAD_SCAN_IDS = 120;
// How many waiting packages the Done loading summary lists.
const LOAD_SUMMARY_WAITING_LIMIT = 50;

// The fields scanning keeps on a line while it is on a container. All are
// cleared whenever the line leaves its container (unassign, move, remove,
// an undo that unloads it) and none is ever client-writable.
const LOAD_FIELDS = Object.freeze([
  "loadScannedPieces",
  "loadAddedByScan",
  "loadScannedAt",
  "loadScannedByStaffId",
  "loadScanIds",
  // The container a scan moved the package from (set instead of
  // loadAddedByScan): undoing that scan moves it back there.
  "loadMovedFromContainerId",
  // The waiting part "Leave N waiting" made, so a retried request answers
  // with it.
  "loadLeftPartId",
]);

// When, by whom and how a line was put on its container (docs/
// WAITING_PACKAGES.md "Loading lists"). Written by every path that puts a
// line on a container; cleared with the LOAD_FIELDS when it leaves.
const ASSIGN_VIA = Object.freeze({HAND: "hand", SCAN: "scan", MOVE: "move"});
const ASSIGN_FIELDS = Object.freeze([
  "containerAssignedAt",
  "containerAssignedByStaffId",
  "containerAssignedVia",
]);

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const asRow = (value) => value && typeof value === "object" ? value : {};
const wholeCount = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 0;
};

// The loading warning (docs/AIR_PACKAGES.md §4.8): a package whose sender
// tapped "Something's wrong" goes on only once the loader has seen that
// and confirmed, the way a delivery with a balance does (the same shape:
// refused with the warnings until `acknowledgeProblems: true`).
const LOAD_WARNING = Object.freeze({SENDER_PROBLEM: "sender_problem"});

/**
 * @param {*} value The request's `action`.
 * @return {string} A LOAD_ACTION, or "" when it is not one.
 */
function loadActionOf(value) {
  const action = text(value, 40);
  return LOAD_ACTIONS.includes(action) ? action : "";
}

/**
 * The code a label link carries: `/t/<code>` (the QR) or the older
 * `?code=<code>`. Null when the text is not a link; "" for a link that
 * carries no code.
 *
 * @param {string} raw The scanned or typed text.
 * @return {string|null} The candidate code.
 */
function linkCandidate(raw) {
  if (!raw.includes("/") && !raw.includes("?")) return null;
  // A path alone (/t/CL-K7M4P2) is read against any host.
  const withScheme = /^https?:\/\//i.test(raw) ? raw :
    (raw.startsWith("/") ? `https://link.invalid${raw}` : `https://${raw}`);
  let url;
  try {
    url = new URL(withScheme);
  } catch (error) {
    return "";
  }
  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length >= 2 && segments[0].toLowerCase() === "t") {
    try {
      return decodeURIComponent(segments[1]);
    } catch (error) {
      return "";
    }
  }
  return url.searchParams.get("code") || "";
}

/**
 * A package code from whatever a camera or a person hands over: the code as
 * printed (`CL-K7M4P2`, a split part `CL-K7M4P2-2`), typed loosely
 * (`cl k7m4p2`, `clk7m4p22`), or the label's whole tracking link. Mirrors
 * `normalizeTrackingCode` narrowed to the CL prefix and the short alphabet
 * (the console's `packageCodeFrom`), so a zero typed for an O is no code.
 *
 * @param {*} raw The request's `code`.
 * @return {string} "CL-XXXXXX" or "CL-XXXXXX-n", or "" when there is none.
 */
function scanCodeFrom(raw) {
  // A trailing slash is the scanner's or the typist's, never the code's.
  const input = text(raw, 300).replace(/\/+$/, "");
  if (!input) return "";
  const link = linkCandidate(input);
  const candidate = link === null ? input : link;
  const compact = text(candidate, 60).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const match = PACKAGE_CODE.exec(compact);
  if (!match) return "";
  return match[2] ?
    `${PACKAGE_CODE_PREFIX}-${match[1]}-${match[2]}` :
    `${PACKAGE_CODE_PREFIX}-${match[1]}`;
}

/**
 * @param {*} raw The request's `scanId`.
 * @return {string} The id (8-64 of `[A-Za-z0-9_-]`), or "" when invalid.
 */
function scanIdOf(raw) {
  if (typeof raw !== "string") return "";
  return SCAN_ID.test(raw) ? raw : "";
}

/**
 * @param {object} line A stored line.
 * @return {number} Its pieces (a car is one).
 */
function linePieceCount(line) {
  return lineCounts(line).pieceCount;
}

/**
 * Pieces scanned onto the line's current container, never above its piece
 * count (an edit can take pieces away after they were scanned).
 *
 * @param {object} line A stored line.
 * @return {number} 0..pieceCount.
 */
function scannedPiecesOf(line) {
  return Math.min(wholeCount(asRow(line).loadScannedPieces),
      linePieceCount(line));
}

/**
 * @param {object} line A stored line.
 * @return {string[]} The scan ids it remembers, oldest first.
 */
function loadScanIdsOf(line) {
  const ids = asRow(line).loadScanIds;
  return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
}

/**
 * How many scan ids a line keeps: two per piece, at least
 * MIN_LOAD_SCAN_IDS, at most MAX_LOAD_SCAN_IDS, so a retry of any scan of a
 * package being loaded is still recognised.
 *
 * @param {number} pieceCount The line's pieces.
 * @return {number} The ids kept.
 */
function scanIdsKept(pieceCount) {
  return Math.min(MAX_LOAD_SCAN_IDS,
      Math.max(MIN_LOAD_SCAN_IDS, 2 * wholeCount(pieceCount)));
}

/**
 * The remembered scan ids with one more, keeping the last scanIdsKept.
 *
 * @param {*} ids The stored ids.
 * @param {string} scanId The new one.
 * @param {number} pieceCount The line's pieces.
 * @return {string[]} The ids to store.
 */
function appendScanId(ids, scanId, pieceCount = 0) {
  return [...loadScanIdsOf({loadScanIds: ids}), scanId]
      .slice(-scanIdsKept(pieceCount));
}

/**
 * The answer a scan already taken gave: `loaded` when it is the scan that
 * put the package on this container, else `counted`. The loading scan is
 * the first id remembered, as long as none has been forgotten (more scans
 * counted than ids kept means the first ones were dropped).
 *
 * @param {object} line The stored line, on this container.
 * @param {string} scanId The retried id.
 * @return {string} A SCAN_RESULT.
 */
function repeatedScanResult(line, scanId) {
  const row = asRow(line);
  const ids = loadScanIdsOf(row);
  const complete = wholeCount(row.loadScannedPieces) <= ids.length;
  const putHereByScan = row.loadAddedByScan === true ||
    Boolean(text(row.loadMovedFromContainerId));
  return putHereByScan && complete && ids[0] === scanId ?
    SCAN_RESULT.LOADED : SCAN_RESULT.COUNTED;
}

/**
 * What one scan does. Decided from what the transaction read; nothing here
 * writes.
 *
 * @param {object} args {line (stored, or null when gone), lineId,
 *   businessId, container (this one, stored), containerId,
 *   otherContainer (the one the line is on when that is another, stored,
 *   or null), scanId, move (the caller confirmed moving it here)}.
 * @return {object} One of:
 *   {refusal: code, details?} - nothing changes;
 *   {result, change: "none"} - a retried scan, or every piece in already;
 *   {result: "counted", change: "count", scannedPieces};
 *   {result: "loaded", change: "load"} - waiting, goes on whole;
 *   {result: "loaded", change: "move"} - from the other loading container.
 */
function scanDecision(args) {
  const {lineId, businessId, containerId, scanId} = args;
  const line = args.line && typeof args.line === "object" ? args.line : null;
  if (!line || text(line.businessId) !== text(businessId)) {
    return {refusal: "line_not_found"};
  }
  const on = text(line.containerId);
  const here = on !== "" && on === text(containerId);
  if (here && scanId && loadScanIdsOf(line).includes(scanId)) {
    return {result: repeatedScanResult(line, scanId), change: "none"};
  }
  if (!containerIsOpen(args.container)) return {refusal: "container_locked"};
  if (lineIsDelivered(line)) return {refusal: "line_delivered"};
  if (here) {
    const pieces = linePieceCount(line);
    const scanned = wholeCount(line.loadScannedPieces);
    if (scanned >= pieces) {
      return {result: SCAN_RESULT.ALL_SCANNED, change: "none"};
    }
    return {result: SCAN_RESULT.COUNTED, change: "count",
      scannedPieces: scanned + 1};
  }
  if (!on) {
    // Waiting: the same judgement as adding it from the waiting list.
    const refusal = containerAssignRefusal(args.container,
        [{id: lineId, line}], businessId);
    if (refusal) {
      return refusal.shipMode ? {refusal: refusal.code,
        details: {shipMode: refusal.shipMode}} : {refusal: refusal.code};
    }
    return {result: SCAN_RESULT.LOADED, change: "load"};
  }
  const other = args.otherContainer && typeof args.otherContainer ===
    "object" ? args.otherContainer : null;
  const canMove = Boolean(other) && containerIsOpen(other);
  // It could come here, but is going somewhere else: say that rather than
  // offer a move that would be refused.
  const clash = canMove ? destinationMismatch(line, args.container) : null;
  if (clash) return {refusal: clash};
  // Or going another way: a package on a sea box does not move to a flight.
  if (canMove && shipModeMismatch(line, args.container, other)) {
    return {refusal: "ship_mode_mismatch",
      details: {shipMode: shipModeOf(other.shipMode)}};
  }
  if (!canMove || args.move !== true) {
    return {refusal: "line_in_other_container", details: {
      otherContainerId: on,
      otherContainerLabel: text(other?.label) || "",
      otherStatus: text(other?.status, 20) || "",
      canMove,
      // Pieces already scanned into that container: moving takes them out.
      otherScannedPieces: scannedPiecesOf(line),
    }};
  }
  return {result: SCAN_RESULT.LOADED, change: "move"};
}

/**
 * What taking back a scan of a package does. Pieces are anonymous: an undo
 * naming a scan takes back that scan wherever it is in the remembered list;
 * one naming none takes back the last.
 *
 * @param {object} args {line (stored, or null), businessId, container
 *   (this one, stored), containerId, scanId (optional: the scan being
 *   taken back), origin (the container the line was moved from by a scan,
 *   stored, or null)}.
 * @return {object} {refusal} or {result, change: "none"|"uncount"|
 *   "unload"|"move_back", scannedPieces (after), scanIds (after),
 *   movedBackTo (the origin's id, for move_back)}.
 */
function undoScanDecision(args) {
  const {businessId, containerId} = args;
  const scanId = text(args.scanId, 64);
  const line = args.line && typeof args.line === "object" ? args.line : null;
  if (!line || text(line.businessId) !== text(businessId)) {
    return {refusal: "line_not_found"};
  }
  const nothing = (scanned) => ({result: UNDO_RESULT.ALREADY_UNDONE,
    change: "none", scannedPieces: scanned});
  if (text(line.containerId) !== text(containerId)) {
    // Taken off by this very undo (sent back to waiting, or moved back),
    // asked again.
    if (scanId) return nothing(0);
    return {refusal: "line_not_found"};
  }
  if (!containerIsOpen(args.container)) return {refusal: "container_locked"};
  const scanned = wholeCount(line.loadScannedPieces);
  const ids = loadScanIdsOf(line);
  const at = scanId ? ids.indexOf(scanId) : ids.length - 1;
  if (scanned === 0 || (scanId && at === -1)) {
    return nothing(scannedPiecesOf(line));
  }
  const scanIds = at === -1 ? ids : ids.filter((_, i) => i !== at);
  const next = scanned - 1;
  if (next === 0 && line.loadAddedByScan === true) {
    return {result: UNDO_RESULT.UNLOADED, change: "unload",
      scannedPieces: 0, scanIds: []};
  }
  const from = text(line.loadMovedFromContainerId);
  const origin = args.origin && typeof args.origin === "object" ?
    args.origin : null;
  if (next === 0 && from && from !== text(containerId) && origin &&
      text(origin.businessId) === text(businessId) &&
      containerIsOpen(origin) && !destinationMismatch(line, origin) &&
      !shipModeMismatch(line, origin, args.container)) {
    return {result: UNDO_RESULT.MOVED_BACK, change: "move_back",
      scannedPieces: 0, scanIds: [], movedBackTo: from};
  }
  return {result: UNDO_RESULT.UNCOUNTED, change: "uncount",
    scannedPieces: next, scanIds};
}

/**
 * The warnings loading these lines raises: one per line whose sender
 * reported a problem. Nothing else warns.
 *
 * @param {object[]} entries [{id, line}] about to go on.
 * @return {object[]} [{lineId, reason: "sender_problem"}], in order.
 */
function senderProblemWarnings(entries) {
  return (Array.isArray(entries) ? entries : [])
      .map((entry) => asRow(entry))
      .filter((entry) => text(entry.id) &&
        senderConfirmationOf(entry.line).status === CONFIRMATION.PROBLEM)
      .map((entry) => ({lineId: text(entry.id),
        reason: LOAD_WARNING.SENDER_PROBLEM}));
}

/**
 * The warning step: lines with a problem go on only once the caller has
 * seen the warnings and confirmed. Never a refusal of the package itself.
 *
 * @param {object[]} warnings senderProblemWarnings.
 * @param {boolean} acknowledged The request's `acknowledgeProblems`.
 * @return {string|null} "sender_problem" until confirmed, else null.
 */
function loadingProblemRefusal(warnings, acknowledged) {
  if (!Array.isArray(warnings) || warnings.length === 0) return null;
  return acknowledged === true ? null : LOAD_WARNING.SENDER_PROBLEM;
}

/**
 * What "Leave N waiting" does: split off the unscanned pieces when some,
 * not all, were scanned; answer with the part already made when a retried
 * request finds every remaining piece scanned and a part on record.
 *
 * @param {object} line The stored line, on the container.
 * @return {object} {change: "split"} | {change: "none", partId} |
 *   {refusal: "piece_count_invalid"}.
 */
function leaveUnscannedDecision(line) {
  const row = asRow(line);
  const pieces = linePieceCount(row);
  const scanned = wholeCount(row.loadScannedPieces);
  if (scanned > 0 && scanned < pieces) return {change: "split"};
  const partId = text(row.loadLeftPartId);
  if (scanned >= pieces && partId) return {change: "none", partId};
  return {refusal: "piece_count_invalid"};
}

/**
 * @param {*} value A stored timestamp (Firestore Timestamp, Date, or
 *   milliseconds).
 * @return {number|null} Milliseconds, or null when it is not a time.
 */
function millisOf(value) {
  if (value && typeof value.toMillis === "function") {
    const ms = value.toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * A line as the loading screen shows it.
 *
 * @param {string} lineId The line.
 * @param {object} line The line (after the change).
 * @return {object} {lineId, trackingCode, name, kind, pieceCount,
 *   scannedPieces, destinationCountryName, addedByScan, assignedVia,
 *   assignedAt (ms or null), customerName, customerPhone (the sender, else
 *   the receiver)}.
 */
function loadLineView(lineId, line) {
  const row = asRow(line);
  return {
    lineId: text(lineId),
    trackingCode: text(row.trackingCode, 60),
    // The receiver, else the line's customer.
    name: text(row.receiverName, 120) || lineCustomerName(row) || "",
    kind: text(row.kind, 20),
    pieceCount: linePieceCount(row),
    scannedPieces: scannedPiecesOf(row),
    destinationCountryName: text(row.destinationCountryName, 120),
    // How it got on the container (lines put on before this have none).
    addedByScan: row.loadAddedByScan === true,
    assignedVia: Object.values(ASSIGN_VIA).includes(
        row.containerAssignedVia) ? row.containerAssignedVia : "",
    assignedAt: millisOf(row.containerAssignedAt),
    customerName: lineCustomerName(row),
    customerPhone: lineCustomerPhone(row),
  };
}

/**
 * A container as the loading screen shows it, after a change.
 *
 * @param {string} containerId The container.
 * @param {object} container The stored container (before the change).
 * @param {object} delta Tally changes (containerLinesCountsDelta), if any.
 * @return {object} {containerId, label, lineCount, pieceCount}.
 */
function loadContainerView(containerId, container, delta = {}) {
  const row = asRow(container);
  const step = asRow(delta);
  const count = (key) => Math.max(0,
      (Number(row[key]) || 0) + (Number(step[key]) || 0));
  return {
    containerId: text(containerId),
    label: text(row.label, 200),
    lineCount: count("lineCount"),
    pieceCount: count("carCount") + count("barrelCount") +
      count("otherCount"),
  };
}

/**
 * Sums tally deltas ({lineCount: 1, ...}) key by key.
 *
 * @param {...object} deltas The deltas.
 * @return {object} Their sum, non-zero keys only.
 */
function addCountDeltas(...deltas) {
  const out = {};
  for (const delta of deltas) {
    for (const [key, value] of Object.entries(asRow(delta))) {
      out[key] = (out[key] || 0) + (Number(value) || 0);
    }
  }
  for (const key of Object.keys(out)) if (!out[key]) delete out[key];
  return out;
}

/**
 * The Done loading summary of a container's lines: packages scanned at
 * least once with pieces still unscanned, and packages never scanned (put
 * on by hand, or before this mode).
 *
 * @param {object[]} entries The container's lines, {id, line}.
 * @return {{incomplete: object[], unscanned: object[]}} loadLineView rows,
 *   in code order.
 */
function loadSummaryOf(entries) {
  const incomplete = [];
  const unscanned = [];
  const rows = (Array.isArray(entries) ? entries : [])
      .map((entry) => loadLineView(entry?.id, entry?.line))
      .sort((a, b) => a.trackingCode.localeCompare(b.trackingCode) ||
        a.lineId.localeCompare(b.lineId));
  for (const row of rows) {
    if (row.scannedPieces === 0) unscanned.push(row);
    else if (row.scannedPieces < row.pieceCount) incomplete.push(row);
  }
  return {incomplete, unscanned};
}

/**
 * The History sentence when a scan puts a package on a container.
 *
 * @param {object} args {what (containerLineTitle), label (the container),
 *   fromLabel (the container it came off, when moved)}.
 * @return {string} The sentence.
 */
function scanLoadAuditSummary(args) {
  const from = text(args?.fromLabel);
  return `Loaded ${text(args?.what)} on ${text(args?.label)} by scan` +
    (from ? ` (moved from ${from})` : "");
}

/**
 * The History sentence when an undone scan moves a package back to the
 * container it came from.
 *
 * @param {object} args {label (this container), toLabel (the origin)}.
 * @return {string} The sentence.
 */
function scanMoveBackAuditSummary(args) {
  return `Scan undone: moved back from ${text(args?.label)} to ` +
    text(args?.toLabel);
}

/**
 * The History sentence when an undone scan sends a package back to waiting.
 *
 * @param {string} label The container.
 * @return {string} The sentence.
 */
function scanUnloadAuditSummary(label) {
  return `Scan undone: taken off ${text(label)}, waiting for a container`;
}

module.exports = {
  LOAD_ACTION,
  LOAD_ACTIONS,
  SCAN_RESULT,
  UNDO_RESULT,
  LOAD_FIELDS,
  ASSIGN_VIA,
  ASSIGN_FIELDS,
  MIN_LOAD_SCAN_IDS,
  MAX_LOAD_SCAN_IDS,
  LOAD_SUMMARY_WAITING_LIMIT,
  LOAD_WARNING,
  loadActionOf,
  senderProblemWarnings,
  loadingProblemRefusal,
  scanCodeFrom,
  scanIdOf,
  linePieceCount,
  scannedPiecesOf,
  scanIdsKept,
  appendScanId,
  repeatedScanResult,
  scanDecision,
  undoScanDecision,
  leaveUnscannedDecision,
  loadLineView,
  loadContainerView,
  addCountDeltas,
  loadSummaryOf,
  scanLoadAuditSummary,
  scanUnloadAuditSummary,
  scanMoveBackAuditSummary,
};
