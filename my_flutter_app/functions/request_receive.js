"use strict";

/**
 * The one containerLines line a package request becomes when staff tap
 * "Received" (docs/PACKAGE_REQUESTS.md §7 "Line fields", §8.6
 * receivePackageRequest).
 *
 * The line is built by the counter's own writer (`containerLineRecord` in
 * pieces mode, which runs `piecesLineFields` from line_pieces.js) and gets
 * the same receipt fields as a counter registration (`lineReceiptFields`),
 * so a received request and a counter line holding the same pieces are the
 * same document: pieces normalised, the denormalised counts, the
 * `kind`/`quantity`/`description` summary old apps read, `priceCents` the
 * sum of the pieces plus the line's own `pickupFeeCents` (a collected
 * request's fee, never spread into the pieces), `rootLineId` its own id,
 * `partIndex` 1. Labels ("1 of
 * N"), splitting across containers and monthly volume then treat it like
 * any other line. Only `source` ("request" / "card_order") and `requestId`
 * say where it came from.
 *
 * Pure: no Firestore. index.js reads the request and writes the result in
 * one transaction.
 */

const {containerLineRecord, lineReceiptFields, LINE_STATUS_WAITING} =
  require("./container_manifest");
const {
  lineTotalCents,
  normalizePieces,
  pickupFeeErrors,
  pickupFeeOf,
  pieceErrors,
  piecePriceOf,
} = require("./line_pieces");

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const asRow = (value) => value && typeof value === "object" ? value : {};

// The fields Received adds on top of a waiting line's contacts and price.
// Listed so a test can check nothing is missing.
const REQUEST_LINE_FIELDS = Object.freeze([
  "pieces", "pieceCount", "barrelPieces", "packagePieces", "carPieces",
  "pickupFeeCents", "source", "requestId", "receivedAt", "rootLineId",
  "partIndex",
]);

// The request's own cap (§4 "max 20 pieces per request"); the load that
// arrives is held to it too.
const MAX_RECEIVE_PIECES = 20;

// line_pieces.js names its refusals for the counter; Received keeps the
// request contract's names (§8.6), which both clients already translate.
const RECEIVE_ERROR_CODES = Object.freeze({
  pieces_required: "pieces_required",
  pieces_too_many: "too_many_pieces",
  piece_kind_invalid: "piece_kind_invalid",
  piece_description_required: "piece_description_required",
  piece_description_too_long: "text_too_long",
  piece_size_invalid: "size_invalid",
  piece_price_invalid: "price_invalid",
});

/**
 * What each request piece is priced at before staff touch anything: the
 * estimate's price for it, else the piece's own `estimateCents`. The pickup
 * fee is NOT in here: it is the line's own amount beside the pieces
 * (receivePrefillPickupFeeCents, owner decision 2026-10-18), so the bill
 * reads "Barrel $90 · Box $40 · Pickup fee $20 · Total $150".
 *
 * The console's `receivePrefillCents` (package-requests.ts) and the app's
 * mirror use the same rule, so the Received form opens on these numbers.
 *
 * @param {object} request The stored request.
 * @return {Map<string, ?number>} Piece id -> cents (null: no price).
 */
function receivePrefillCents(request) {
  const row = asRow(request);
  const requested = Array.isArray(row.pieces) ? row.pieces.map(asRow) : [];
  const estimate = new Map((asRow(row.estimate).pieces || [])
      .map((p) => [asRow(p).id, piecePriceOf(asRow(p).cents)]));
  return new Map(requested.map((piece) => [piece.id,
    estimate.has(piece.id) ? estimate.get(piece.id) :
      piecePriceOf(piece.estimateCents)]));
}

/**
 * The pickup fee the Received form opens on: the estimate's, for a
 * collected request; a request brought in has none.
 *
 * @param {object} request The stored request.
 * @return {number} Whole cents, 0 for none.
 */
function receivePrefillPickupFeeCents(request) {
  const row = asRow(request);
  return row.handoff === "collect" ?
    pickupFeeOf(asRow(row.estimate).pickupFeeCents) : 0;
}

/**
 * The pickup fee staff confirm at Received: absent (or null) keeps the
 * prefilled one; a collected request takes any whole cents >= 0; a request
 * brought in takes none but 0.
 *
 * @param {*} raw The callable's `pickupFeeCents`.
 * @param {object} request The stored request.
 * @return {{pickupFeeCents: number, errors: string[]}} The fee and
 *   `pickup_fee_invalid` when it cannot be taken.
 */
function cleanReceivePickupFee(raw, request) {
  if (raw === undefined || raw === null) {
    return {pickupFeeCents: receivePrefillPickupFeeCents(request),
      errors: []};
  }
  const errors = pickupFeeErrors(raw);
  const fee = errors.length ? 0 : pickupFeeOf(raw);
  if (!errors.length && fee > 0 && asRow(request).handoff !== "collect") {
    errors.push("pickup_fee_invalid");
  }
  return {pickupFeeCents: errors.length ? 0 : fee, errors};
}

/**
 * The pieces staff confirm at the counter (§8.6 receivePackageRequest): the
 * request's own pieces by id (a missing field keeps the request's value, a
 * missing `priceCents` the prefilled price; kind, description and size may
 * be corrected to what actually came), pieces the customer brought on top
 * (no id: `{kind, description, sizeIn?, priceCents}`), and the request's
 * pieces left out because they did not come.
 *
 * An absent or empty list keeps every piece of the request at its prefilled
 * price (the payload of a client that predates adding and removing).
 *
 * @param {*} raw [{id, priceCents?, kind?, description?, sizeIn?}] and
 *   [{kind, description, sizeIn?, priceCents}].
 * @param {object} request The stored request.
 * @return {{pieces: object[], added: number, removed: number,
 *   errors: string[]}} The line's pieces in order, normalised by
 *   line_pieces.js (`{id, kind, description, sizeIn, priceCents}`; new ones
 *   get the next free ids after the request's), and every problem:
 *   `estimate_piece_unknown` (an id not on the request, or twice),
 *   `pieces_required`, `too_many_pieces`, `piece_kind_invalid`,
 *   `piece_description_required`, `text_too_long`, `size_invalid`,
 *   `price_invalid`, `price_required` (some priced, some not).
 */
function cleanReceivePieces(raw, request) {
  const errors = [];
  const add = (code) => {
    if (!errors.includes(code)) errors.push(code);
  };
  const requested = Array.isArray(request?.pieces) ?
    request.pieces.map(asRow) : [];
  const byId = new Map(requested.map((p) => [text(p.id, 40), p]));
  const prefill = receivePrefillCents(request);
  const has = (row, key) => Object.prototype.hasOwnProperty.call(row, key);
  const list = Array.isArray(raw) ? raw : [];
  const typed = [];
  if (list.length === 0) {
    for (const piece of requested) {
      typed.push({id: text(piece.id, 40), kind: piece.kind,
        description: piece.description, sizeIn: piece.sizeIn || null,
        priceCents: prefill.get(piece.id) ?? null});
    }
  } else {
    let next = requested.reduce((max, p) =>
      Math.max(max, Number(String(p.id).replace(/\D/g, "")) || 0), 0);
    const seen = new Set();
    for (const value of list) {
      const row = asRow(value);
      const id = text(row.id, 40);
      if (id) {
        if (!byId.has(id) || seen.has(id)) {
          add("estimate_piece_unknown");
          continue;
        }
        seen.add(id);
        const base = byId.get(id);
        typed.push({
          id,
          kind: has(row, "kind") ? row.kind : base.kind,
          description: has(row, "description") ? row.description :
            base.description,
          sizeIn: has(row, "sizeIn") ? row.sizeIn : base.sizeIn || null,
          priceCents: has(row, "priceCents") ? row.priceCents :
            prefill.get(id) ?? null,
        });
        continue;
      }
      next += 1;
      typed.push({id: `p${next}`, kind: row.kind,
        description: row.description, sizeIn: row.sizeIn || null,
        priceCents: row.priceCents, added: true});
    }
  }
  if (typed.length > 0 || errors.length === 0) {
    for (const code of pieceErrors(typed, MAX_RECEIVE_PIECES)) {
      add(RECEIVE_ERROR_CODES[code] || code);
    }
  }
  const priced = typed.filter((p) => piecePriceOf(p.priceCents) !== null);
  if (priced.length > 0 && priced.length < typed.length) {
    add("price_required");
  }
  const pieces = normalizePieces(typed);
  const kept = new Set(pieces.map((p) => p.id));
  return {
    pieces,
    added: typed.filter((p) => p.added === true).length,
    removed: requested.filter((p) => !kept.has(text(p.id, 40))).length,
    errors,
  };
}

/**
 * @param {object[]} pieces From cleanReceivePieces.
 * @param {number} [pickupFeeCents] From cleanReceivePickupFee.
 * @return {?number} The line's price: the pieces' sum plus the pickup fee,
 *   as the line writer computes it (null when no piece is priced).
 */
function receivedTotalCents(pieces, pickupFeeCents = 0) {
  return lineTotalCents(pieces, pickupFeeCents);
}

/**
 * The line body for a received request.
 *
 * @param {object} request The stored request.
 * @param {object} args {lineId, requestId, pieces (from cleanReceivePieces;
 *   default: the request's at their prefilled prices), pickupFeeCents
 *   (default: the prefilled one), payOnArrival, staffUid, receivedAt (a
 *   Timestamp or server-timestamp sentinel)}.
 * @return {object} The line, ready to write (the caller adds trackingCode,
 *   paidCents, createdAt, updatedAt and businessId).
 */
function requestLineRecord(request, args) {
  const pieces = Array.isArray(args.pieces) ? args.pieces :
    cleanReceivePieces([], request).pieces;
  const pickupFeeCents = args.pickupFeeCents === undefined ||
    args.pickupFeeCents === null ? receivePrefillPickupFeeCents(request) :
    pickupFeeOf(args.pickupFeeCents);
  const record = containerLineRecord({
    // In pieces mode the pieces decide the kind; "other" only says "not a
    // car".
    kind: "other",
    pieces,
    pickupFeeCents,
    ownerKind: "customer",
    customerName: request?.sender?.name,
    customerPhone: request?.sender?.phoneE164,
    receiverName: request?.receiver?.name,
    receiverPhone: request?.receiver?.phoneE164,
    notifyCustomer: true,
    notifyReceiver: true,
    destinationCountryId: request?.destinationCountryId,
    destinationCountryName: request?.destinationCountryName,
    payOnArrival: args.payOnArrival === true,
  }, {
    containerId: "",
    containerStatus: LINE_STATUS_WAITING,
    addedByStaffId: args.staffUid,
  });
  return {
    ...record,
    ...lineReceiptFields({
      lineId: args.lineId,
      source: request?.payment?.timing === "card" ? "card_order" : "request",
      requestId: args.requestId,
      receivedAt: args.receivedAt,
    }),
  };
}

module.exports = {
  REQUEST_LINE_FIELDS,
  MAX_RECEIVE_PIECES,
  receivePrefillCents,
  receivePrefillPickupFeeCents,
  cleanReceivePickupFee,
  cleanReceivePieces,
  receivedTotalCents,
  requestLineRecord,
};
