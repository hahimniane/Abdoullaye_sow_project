"use strict";

/**
 * The one containerLines line a package request becomes when staff tap
 * "Received" (docs/PACKAGE_REQUESTS.md §7 "Line fields", §8.6
 * receivePackageRequest).
 *
 * Deliberately one isolated builder: the pieces-on-lines work (phase 1,
 * branch feat/pieces) adds `pieces[]` to the counter's own line writers in
 * parallel. At merge, `requestLineRecord` is the single place to point at
 * that builder; until then it writes exactly the §7 fields itself, on top of
 * the counter's legacy line body (containerLineRecord), so every existing
 * reader keeps working: `kind`/`quantity` summary fields for old app
 * versions, `pieces[]` and the denormalized counts for new ones.
 *
 * Pure: no Firestore. index.js reads the request and writes the result in
 * one transaction.
 */

const {containerLineRecord, LINE_STATUS_WAITING} =
  require("./container_manifest");
const {MAX_CENTS} = require("./container_payments");

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);

// The fields this builder adds to a counter line. Listed so a test (and the
// phase 1 merge) can check nothing is missing.
const REQUEST_LINE_FIELDS = Object.freeze([
  "pieces", "pieceCount", "barrelPieces", "packagePieces", "carPieces",
  "source", "requestId", "receivedAt", "rootLineId", "partIndex",
]);

/**
 * The final per-piece prices staff confirmed at the counter.
 *
 * @param {*} raw [{id, priceCents: int|null}] from the callable.
 * @param {object} request The stored request.
 * @return {{prices: Map<string, ?number>, errors: string[]}} Every piece of
 *   the request gets an entry (a missing one falls back to the estimate,
 *   then to null); `errors`: `price_invalid`, `estimate_piece_unknown`,
 *   `price_required` (some priced, some not).
 */
function cleanReceivePrices(raw, request) {
  const errors = [];
  const add = (code) => {
    if (!errors.includes(code)) errors.push(code);
  };
  const pieces = Array.isArray(request?.pieces) ? request.pieces : [];
  const ids = new Set(pieces.map((p) => p.id));
  const given = new Map();
  for (const row of Array.isArray(raw) ? raw : []) {
    const id = text(row?.id, 10);
    if (!ids.has(id)) {
      add("estimate_piece_unknown");
      continue;
    }
    if (row.priceCents === null || row.priceCents === undefined) {
      given.set(id, null);
    } else if (Number.isInteger(row.priceCents) && row.priceCents >= 0 &&
        row.priceCents <= MAX_CENTS) {
      given.set(id, row.priceCents);
    } else {
      add("price_invalid");
    }
  }
  const estimate = new Map((request?.estimate?.pieces || [])
      .map((row) => [row.id, Number.isInteger(row.cents) ? row.cents : null]));
  const prices = new Map();
  for (const piece of pieces) {
    if (given.has(piece.id)) prices.set(piece.id, given.get(piece.id));
    else if (estimate.has(piece.id)) {
      prices.set(piece.id, estimate.get(piece.id));
    } else {
      prices.set(piece.id, Number.isInteger(piece.estimateCents) ?
        piece.estimateCents : null);
    }
  }
  const values = [...prices.values()];
  if (values.some((v) => v === null) && values.some((v) => v !== null)) {
    add("price_required");
  }
  return {prices, errors};
}

/**
 * @param {Map<string, ?number>} prices From cleanReceivePrices.
 * @param {object} request The stored request.
 * @return {?number} The line's price: the pieces' sum (plus the estimate's
 *   pickup fee for a collected request), or null when nothing is priced.
 */
function receivedTotalCents(prices, request) {
  const values = [...prices.values()];
  if (values.length === 0 || values.every((v) => v === null)) return null;
  const pickupFee = request?.handoff === "collect" ?
    Math.max(0, Number(request?.estimate?.pickupFeeCents) || 0) : 0;
  return values.reduce((sum, v) => sum + (v || 0), 0) + pickupFee;
}

/**
 * What the counter's legacy summary calls the load: "barrels" when every
 * piece is a barrel, else "other" with the descriptions joined.
 *
 * @param {object[]} pieces The request's pieces.
 * @return {{kind: string, quantity: number, description: string}}
 */
function legacySummary(pieces) {
  const list = Array.isArray(pieces) ? pieces : [];
  const allBarrels = list.length > 0 && list.every((p) => p.kind === "barrel");
  const descriptions = [...new Set(list
      .filter((p) => p.kind !== "barrel")
      .map((p) => text(p.description, 120) ||
        (p.kind === "box" ? "box" : "item")))];
  const barrels = list.filter((p) => p.kind === "barrel").length;
  const words = [...(barrels ? [`${barrels} barrel${barrels === 1 ? "" :
    "s"}`] : []), ...descriptions];
  return {
    kind: allBarrels ? "barrels" : "other",
    quantity: Math.max(1, list.length),
    description: allBarrels ? "" : words.join(", ").slice(0, 120),
  };
}

/**
 * The line body for a received request.
 *
 * @param {object} request The stored request.
 * @param {object} args {lineId, prices (Map from cleanReceivePrices),
 *   payOnArrival, staffUid, receivedAt (a server timestamp sentinel or
 *   Timestamp), receivedAtMs}.
 * @return {object} The line, ready to write (the caller adds trackingCode,
 *   paidCents, createdAt, updatedAt and businessId).
 */
function requestLineRecord(request, args) {
  const pieces = Array.isArray(request?.pieces) ? request.pieces : [];
  const summary = legacySummary(pieces);
  const priceCents = receivedTotalCents(args.prices, request);
  const legacy = containerLineRecord({
    kind: summary.kind,
    quantity: summary.quantity,
    description: summary.description,
    ownerKind: "customer",
    customerName: request?.sender?.name,
    customerPhone: request?.sender?.phoneE164,
    receiverName: request?.receiver?.name,
    receiverPhone: request?.receiver?.phoneE164,
    notifyCustomer: true,
    notifyReceiver: true,
    destinationCountryId: request?.destinationCountryId,
    destinationCountryName: request?.destinationCountryName,
    priceCents,
    payOnArrival: args.payOnArrival === true,
  }, {
    containerId: "",
    containerStatus: LINE_STATUS_WAITING,
    addedByStaffId: args.staffUid,
  });
  const barrelPieces = pieces.filter((p) => p.kind === "barrel").length;
  return {
    ...legacy,
    pieces: pieces.map((p) => ({
      id: text(p.id, 10),
      kind: text(p.kind, 20),
      description: text(p.description, 120),
      sizeIn: p.sizeIn || null,
      priceCents: args.prices.has(p.id) ? args.prices.get(p.id) : null,
    })),
    pieceCount: pieces.length,
    barrelPieces,
    packagePieces: pieces.length - barrelPieces,
    carPieces: 0,
    source: request?.payment?.timing === "card" ? "card_order" : "request",
    requestId: text(args.requestId, 128),
    receivedAt: args.receivedAt,
    receivedAtMs: Number(args.receivedAtMs) || 0,
    rootLineId: text(args.lineId, 128),
    partIndex: 1,
  };
}

module.exports = {
  REQUEST_LINE_FIELDS,
  cleanReceivePrices,
  receivedTotalCents,
  legacySummary,
  requestLineRecord,
};
