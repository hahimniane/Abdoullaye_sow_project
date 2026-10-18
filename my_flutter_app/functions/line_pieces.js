"use strict";

/**
 * Pieces on a line (docs/PACKAGE_REQUESTS.md section 1 and 7 "Line fields").
 *
 * A line (`containerLines`) is one customer's load: one sender, one
 * receiver, one destination, one tracking code. It holds pieces - each
 * physical thing handed over: a barrel, a box, a loose TV. Several things
 * packed in one box are ONE piece. A car stays a line of its own kind with
 * one implicit piece.
 *
 * Every reader goes through linePieces(), which also reads the lines written
 * before pieces existed: `{kind: "barrels", quantity: 4}` is four barrel
 * pieces, `{kind: "other", quantity: 2, description}` two `other` pieces
 * with that description, a car one car piece. No bulk migration.
 *
 * A line can be split across containers: the pieces that go stay on the
 * line, the rest become a linked part (`CL-K7M4P2-2`, then -3...) with the
 * same people and destination. A group is the root line and its parts
 * (`rootLineId`, `partIndex`); payments stay on the root, and what is paid
 * and owed is read for the whole group.
 *
 * Pure: no Firestore, no clock. The console's `line-pieces.ts` and the app's
 * `line_pieces.dart` are mirrors; `test/fixtures/line-pieces-cases.json` is
 * run by all three suites, so a rule that changes here changes there.
 */

const {MAX_CENTS} = require("./invoice_ledger");

const PIECE_KIND = Object.freeze({
  BARREL: "barrel",
  BOX: "box",
  OTHER: "other",
});
// What a counter can register. "car" is read (a car line's implicit piece)
// but never written as a piece.
const PIECE_KINDS = Object.freeze(Object.values(PIECE_KIND));
const CAR_PIECE_KIND = "car";

// The most pieces one line takes at the counter (and in an edit).
const MAX_PIECES = 60;
// A legacy quantity is capped where the old form capped it.
const MAX_LEGACY_PIECES = 999;
const MAX_PIECE_DESCRIPTION = 120;
// Inches; the same cap as a line's own size.
const MAX_PIECE_INCHES = 600;
const PIECE_ID = /^[A-Za-z0-9_-]{1,40}$/;

const LINE_SOURCES = Object.freeze(["counter", "request", "card_order"]);

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const positiveInt = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};
const given = (value) =>
  value !== null && value !== undefined && String(value).trim() !== "";
const asRow = (value) => value && typeof value === "object" ? value : {};

// -------------------------------------------------------------------------
// One piece.
// -------------------------------------------------------------------------

/**
 * One side in inches: two decimals, or null when blank or unusable.
 *
 * @param {*} value Raw input.
 * @return {number|null} Inches.
 */
function sideOf(value) {
  if (!given(value)) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_PIECE_INCHES) return null;
  return Math.round(n * 100) / 100;
}

/**
 * @param {*} raw A piece's size, {l, w, h}.
 * @return {boolean} Whether any side was typed.
 */
function pieceSizeGiven(raw) {
  const size = asRow(raw);
  return [size.l, size.w, size.h].some(given);
}

/**
 * @param {*} raw A piece's size, {l, w, h}.
 * @return {object|null} {l, w, h} in inches, or null unless all three are
 *   usable.
 */
function pieceSizeOf(raw) {
  const size = asRow(raw);
  const sides = [size.l, size.w, size.h].map(sideOf);
  if (sides.some((side) => side === null)) return null;
  return {l: sides[0], w: sides[1], h: sides[2]};
}

/**
 * @param {*} value A typed piece price in cents.
 * @return {number|null} Whole cents (zero allowed), or null when blank or
 *   not a price.
 */
function piecePriceOf(value) {
  if (!given(value)) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= MAX_CENTS ? n : null;
}

/**
 * @param {*} value A stored or typed kind.
 * @return {string} A piece kind; anything unknown reads as "other".
 */
function pieceKindOf(value) {
  const kind = text(value, 20).toLowerCase();
  if (kind === CAR_PIECE_KIND) return CAR_PIECE_KIND;
  return PIECE_KINDS.includes(kind) ? kind : PIECE_KIND.OTHER;
}

/**
 * Every problem with the pieces a request sends, each code once.
 *
 * @param {*} raw The request's `pieces`.
 * @param {number} [max] The most pieces allowed.
 * @return {string[]} Error codes.
 */
function pieceErrors(raw, max = MAX_PIECES) {
  if (!Array.isArray(raw) || raw.length === 0) return ["pieces_required"];
  const errors = new Set();
  if (raw.length > max) errors.add("pieces_too_many");
  for (const item of raw) {
    const piece = asRow(item);
    const kind = text(piece.kind, 20).toLowerCase();
    if (!PIECE_KINDS.includes(kind)) errors.add("piece_kind_invalid");
    const description = String(piece.description ?? "").trim();
    if (description.length > MAX_PIECE_DESCRIPTION) {
      errors.add("piece_description_too_long");
    }
    // A barrel is a barrel; a box or an item has to say what it is.
    if (kind !== PIECE_KIND.BARREL && PIECE_KINDS.includes(kind) &&
        !description) {
      errors.add("piece_description_required");
    }
    if (pieceSizeGiven(piece.sizeIn) && pieceSizeOf(piece.sizeIn) === null) {
      errors.add("piece_size_invalid");
    }
    if (given(piece.priceCents) && piecePriceOf(piece.priceCents) === null) {
      errors.add("piece_price_invalid");
    }
  }
  return [...errors];
}

/**
 * The pieces as stored: kind, description, size and price cleaned, and an
 * id each. A usable id that is not a repeat is kept (an edit keeps its
 * pieces); any other gets the first free `p<n>`.
 *
 * @param {*} raw Pieces from a request or a stored line.
 * @return {object[]} [{id, kind, description, sizeIn, priceCents}].
 */
function normalizePieces(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const used = new Set();
  const kept = list.map((item) => {
    const id = text(asRow(item).id, 40);
    if (PIECE_ID.test(id) && !used.has(id)) {
      used.add(id);
      return id;
    }
    return "";
  });
  let next = 1;
  const freshId = () => {
    while (used.has(`p${next}`)) next += 1;
    const id = `p${next}`;
    used.add(id);
    return id;
  };
  return list.map((item, i) => {
    const piece = asRow(item);
    return {
      id: kept[i] || freshId(),
      kind: pieceKindOf(piece.kind),
      description: text(piece.description, MAX_PIECE_DESCRIPTION),
      sizeIn: pieceSizeOf(piece.sizeIn),
      priceCents: piecePriceOf(piece.priceCents),
    };
  });
}

/**
 * A total spread over n pieces as evenly as cents allow, the odd cents on
 * the first ones: $100 over 3 is 33.34, 33.33, 33.33.
 *
 * @param {number|null} total Whole cents, or null for no price.
 * @param {number} count The pieces.
 * @return {Array<number|null>} One price per piece.
 */
function distributeCents(total, count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (total === null || total === undefined || !Number.isFinite(total)) {
    return Array.from({length: n}, () => null);
  }
  const base = Math.floor(total / n);
  const rest = total - base * n;
  return Array.from({length: n}, (_, i) => base + (i < rest ? 1 : 0));
}

const lineSize = (line) => pieceSizeOf(
    {l: line.lengthIn, w: line.widthIn, h: line.heightIn});

/**
 * A line's price as stored: whole cents above zero, else null.
 *
 * @param {*} value The stored priceCents.
 * @return {number|null} The price.
 */
function linePriceOf(value) {
  if (!given(value)) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= MAX_CENTS ? n : null;
}

/**
 * @param {object} line A stored or requested line.
 * @return {boolean} Whether it carries its own pieces (not a car, not a
 *   legacy line).
 */
function lineHasPieces(line) {
  const row = asRow(line);
  return text(row.kind, 20) !== "car" && Array.isArray(row.pieces) &&
    row.pieces.length > 0;
}

/**
 * The pieces of any line, old or new. A car is one car piece carrying the
 * line's price; a legacy line expands its quantity, its price spread over
 * the pieces so the total still reads the same.
 *
 * @param {object} line A stored line.
 * @return {object[]} [{id, kind, description, sizeIn, priceCents}].
 */
function linePieces(line) {
  const row = asRow(line);
  const kind = text(row.kind, 20);
  if (kind === "car") {
    return [{id: "car", kind: CAR_PIECE_KIND, description: "",
      sizeIn: lineSize(row), priceCents: linePriceOf(row.priceCents)}];
  }
  if (lineHasPieces(row)) return normalizePieces(row.pieces);
  const count = Math.min(MAX_LEGACY_PIECES, positiveInt(row.quantity) || 1);
  const pieceKind = kind === "barrels" ? PIECE_KIND.BARREL : PIECE_KIND.OTHER;
  const description = pieceKind === PIECE_KIND.OTHER ?
    text(row.description, MAX_PIECE_DESCRIPTION) : "";
  const size = lineSize(row);
  const prices = distributeCents(linePriceOf(row.priceCents), count);
  return prices.map((priceCents, i) => ({
    id: `p${i + 1}`,
    kind: pieceKind,
    description,
    sizeIn: size ? {...size} : null,
    priceCents,
  }));
}

/**
 * The denormalized counts every line carries, so volume can be counted
 * without reading pieces: all pieces, barrels, packages (box + other), cars.
 *
 * @param {object[]} pieces Pieces (linePieces).
 * @return {object} {pieceCount, barrelPieces, packagePieces, carPieces}.
 */
function pieceCounts(pieces) {
  const out = {pieceCount: 0, barrelPieces: 0, packagePieces: 0,
    carPieces: 0};
  for (const piece of Array.isArray(pieces) ? pieces : []) {
    const kind = text(asRow(piece).kind, 20);
    out.pieceCount += 1;
    if (kind === CAR_PIECE_KIND) out.carPieces += 1;
    else if (kind === PIECE_KIND.BARREL) out.barrelPieces += 1;
    else out.packagePieces += 1;
  }
  return out;
}

/**
 * @param {object} line A stored line.
 * @return {object} Its counts (pieceCounts), legacy lines included.
 */
function lineCounts(line) {
  return pieceCounts(linePieces(line));
}

/**
 * The line total: the sum of the priced pieces, or null while none has a
 * price (or they add up to nothing).
 *
 * @param {object[]} pieces The pieces.
 * @return {number|null} Whole cents.
 */
function piecesTotalCents(pieces) {
  let total = 0;
  let priced = false;
  for (const piece of Array.isArray(pieces) ? pieces : []) {
    const cents = piecePriceOf(asRow(piece).priceCents);
    if (cents === null) continue;
    priced = true;
    total += cents;
  }
  return priced && total > 0 ? Math.min(total, MAX_CENTS) : null;
}

/**
 * A pickup fee as stored on a line or typed by staff: whole cents, zero
 * allowed. Anything else (absent, negative, a fraction) reads as no fee.
 *
 * @param {*} value The stored or typed pickupFeeCents.
 * @return {number} Whole cents, 0 for none.
 */
function pickupFeeOf(value) {
  if (!given(value)) return 0;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= MAX_CENTS ? n : 0;
}

/**
 * @param {*} value A typed pickup fee (absent: no fee).
 * @return {string[]} ["pickup_fee_invalid"] unless it is whole cents >= 0.
 */
function pickupFeeErrors(value) {
  if (value === null || value === undefined) return [];
  const n = typeof value === "string" && value.trim() === "" ? NaN :
    Number(value);
  return Number.isInteger(n) && n >= 0 && n <= MAX_CENTS ? [] :
    ["pickup_fee_invalid"];
}

/**
 * A line's own pickup fee (a collected request's, docs/PACKAGE_REQUESTS.md
 * §8.6): a line with pieces may carry one beside its pieces; a car or a
 * legacy line never does. It is never spread into the piece prices and a
 * split never moves it off the root.
 *
 * @param {object} line A stored line.
 * @return {number} Whole cents, 0 for none.
 */
function linePickupFeeCents(line) {
  const row = asRow(line);
  return lineHasPieces(row) ? pickupFeeOf(row.pickupFeeCents) : 0;
}

/**
 * The line total: the pieces' prices plus the line's pickup fee. Null while
 * no piece has a price (a fee alone is not a price for the load), or when it
 * all adds up to nothing.
 *
 * @param {object[]} pieces The pieces.
 * @param {*} [pickupFeeCents] The line's pickup fee (0 by default).
 * @return {number|null} Whole cents.
 */
function lineTotalCents(pieces, pickupFeeCents = 0) {
  let total = 0;
  let priced = false;
  for (const piece of Array.isArray(pieces) ? pieces : []) {
    const cents = piecePriceOf(asRow(piece).priceCents);
    if (cents === null) continue;
    priced = true;
    total += cents;
  }
  if (!priced) return null;
  total += pickupFeeOf(pickupFeeCents);
  return total > 0 ? Math.min(total, MAX_CENTS) : null;
}

const KIND_NAMES = Object.freeze({
  barrel: "Barrel",
  box: "Box",
  other: "Item",
  car: "Car",
});

/**
 * The summary fields older app versions read: `kind` "barrels" when every
 * piece is a barrel, else "other"; `quantity` the piece count; and a
 * description naming what is there ("Barrel, Clothes, TV").
 *
 * @param {object[]} pieces The pieces.
 * @return {object} {kind, quantity, description}.
 */
function piecesSummaryFields(pieces) {
  const list = Array.isArray(pieces) ? pieces : [];
  const allBarrels = list.length > 0 &&
    list.every((p) => asRow(p).kind === PIECE_KIND.BARREL);
  const names = [];
  for (const piece of list) {
    const row = asRow(piece);
    const name = text(row.description, MAX_PIECE_DESCRIPTION) ||
      KIND_NAMES[row.kind] || KIND_NAMES.other;
    if (!names.includes(name)) names.push(name);
  }
  return {
    kind: allBarrels ? "barrels" : "other",
    quantity: list.length,
    description: allBarrels ? "" : text(names.join(", "), 120),
  };
}

/**
 * Everything a line stores about its pieces, from validated pieces: the
 * pieces, the counts, the summary for old apps, the pickup fee, the total
 * (pieces + fee, lineTotalCents), and - for a single piece - its size as
 * the line's size.
 *
 * @param {*} raw Validated request pieces.
 * @param {*} [pickupFeeCents] The line's pickup fee (0 by default).
 * @return {object} The fields to merge into the line.
 */
function piecesLineFields(raw, pickupFeeCents = 0) {
  const pieces = normalizePieces(raw);
  const single = pieces.length === 1 ? pieces[0].sizeIn : null;
  const fee = pickupFeeOf(pickupFeeCents);
  return {
    pieces,
    ...pieceCounts(pieces),
    ...piecesSummaryFields(pieces),
    pickupFeeCents: fee,
    priceCents: lineTotalCents(pieces, fee),
    lengthIn: single ? single.l : null,
    widthIn: single ? single.w : null,
    heightIn: single ? single.h : null,
  };
}

// -------------------------------------------------------------------------
// Saying what is there.
// -------------------------------------------------------------------------

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * "2 barrels, 1 box" / "2 fûts, 1 colis". Items that all say the same
 * thing are named ("2 × TV"); a mix of items is counted.
 *
 * @param {object[]} pieces The pieces.
 * @param {"en"|"fr"} language The language.
 * @return {string} The phrase.
 */
function pieceSummaryText(pieces, language = "en") {
  const fr = language === "fr";
  const list = (Array.isArray(pieces) ? pieces : []).map(asRow);
  const of = (kind) => list.filter((p) => p.kind === kind);
  const parts = [];
  const cars = of(CAR_PIECE_KIND).length;
  if (cars) {
    parts.push(fr ? plural(cars, "véhicule", "véhicules") :
      plural(cars, "car", "cars"));
  }
  const barrels = of(PIECE_KIND.BARREL).length;
  if (barrels) {
    parts.push(fr ? plural(barrels, "fût", "fûts") :
      plural(barrels, "barrel", "barrels"));
  }
  const boxes = of(PIECE_KIND.BOX).length;
  if (boxes) {
    parts.push(fr ? `${boxes} colis` : plural(boxes, "box", "boxes"));
  }
  const items = of(PIECE_KIND.OTHER);
  if (items.length) {
    const names = [...new Set(items.map((p) =>
      text(p.description, MAX_PIECE_DESCRIPTION)))];
    if (names.length === 1 && names[0]) {
      parts.push(items.length === 1 ? names[0] :
        `${items.length} × ${names[0]}`);
    } else {
      parts.push(fr ? plural(items.length, "article", "articles") :
        plural(items.length, "item", "items"));
    }
  }
  return parts.join(", ");
}

/**
 * The "what" of a message about a line with pieces: when its group has more
 * than one part, which share of the whole this part is ("2 of your 4
 * pieces" / "2 de vos 4 colis"); otherwise the piece summary.
 *
 * @param {object} line The line.
 * @param {"en"|"fr"} language The language.
 * @param {object|null} group lineGroupSummary of its group, or null.
 * @return {string} The phrase.
 */
function linePiecesWhat(line, language = "en", group = null) {
  const pieces = linePieces(line);
  const g = asRow(group);
  const total = positiveInt(g.pieceCount);
  if (positiveInt(g.partCount) > 1 && total > pieces.length) {
    return language === "fr" ?
      `${pieces.length} de vos ${total} colis` :
      `${pieces.length} of your ${total} pieces`;
  }
  return pieceSummaryText(pieces, language);
}

/**
 * A piece as its label names it: "Barrel", "Box", or what it is.
 *
 * @param {object} piece A piece.
 * @return {string} The name.
 */
function pieceLabelName(piece) {
  const row = asRow(piece);
  const description = text(row.description, 80);
  if (row.kind === PIECE_KIND.BARREL) {
    return description ? `Barrel · ${description}` : "Barrel";
  }
  if (row.kind === PIECE_KIND.BOX) return description || "Box";
  return description || "Package";
}

/**
 * "40 × 30 × 20 in", or "" without a full size.
 *
 * @param {object} piece A piece.
 * @return {string} The size.
 */
function pieceSizeText(piece) {
  const size = pieceSizeOf(asRow(piece).sizeIn);
  return size ? `${size.l} × ${size.w} × ${size.h} in` : "";
}

// -------------------------------------------------------------------------
// Groups: a line and the parts split from it.
// -------------------------------------------------------------------------

/**
 * @param {object} line A stored line.
 * @param {string} id Its document id.
 * @return {string} The root of its group (its own id when it is the root
 *   or was never split).
 */
function groupRootId(line, id) {
  return text(asRow(line).rootLineId, 200) || text(id, 200);
}

/**
 * @param {object} line A stored line.
 * @return {number} Its place in its group: 1 for the root.
 */
function partIndexOf(line) {
  return positiveInt(asRow(line).partIndex) || 1;
}

/**
 * What a group adds up to: every part's pieces and price, and what the root
 * has been paid (payments live on the root). Parts in part order.
 *
 * @param {object[]} entries The group's lines, [{id, line}].
 * @param {string} rootId The root's id.
 * @return {object} {rootLineId, partCount, pieceCount, priceCents,
 *   pickupFeeCents (the part of priceCents that is the pickup fee),
 *   paidCents, balanceCents, payOnArrival, parts: [{id, trackingCode,
 *   partIndex, pieceCount, priceCents, containerId, containerStatus}]}.
 */
function lineGroupSummary(entries, rootId) {
  const root = text(rootId, 200);
  const rows = (Array.isArray(entries) ? entries : [])
      .map((entry) => ({id: text(asRow(entry).id, 200),
        line: asRow(asRow(entry).line)}))
      .filter((entry) => entry.id &&
        groupRootId(entry.line, entry.id) === root);
  const seen = new Set();
  const parts = [];
  let total = 0;
  let priced = false;
  let paid = 0;
  let fee = 0;
  let payOnArrival = false;
  for (const {id, line} of rows) {
    if (seen.has(id)) continue;
    seen.add(id);
    const price = linePriceOf(line.priceCents);
    if (price !== null) {
      priced = true;
      total += price;
      // Inside that line's price already (it stays on the root): told
      // apart, never added again.
      fee += Math.min(linePickupFeeCents(line), price);
    }
    if (id === root) {
      const p = Math.round(Number(line.paidCents));
      paid = Number.isFinite(p) && p > 0 ? Math.min(p, MAX_CENTS) : 0;
      payOnArrival = line.payOnArrival === true;
    }
    parts.push({
      id,
      trackingCode: text(line.trackingCode, 40),
      partIndex: id === root ? 1 : partIndexOf(line),
      pieceCount: lineCounts(line).pieceCount,
      priceCents: price,
      containerId: text(line.containerId, 200),
      containerStatus: text(line.containerStatus, 20),
    });
  }
  parts.sort((a, b) => a.partIndex - b.partIndex ||
    a.trackingCode.localeCompare(b.trackingCode));
  const priceCents = priced && total > 0 ? Math.min(total, MAX_CENTS) : null;
  return {
    rootLineId: root,
    partCount: parts.length,
    pieceCount: parts.reduce((sum, part) => sum + part.pieceCount, 0),
    priceCents,
    pickupFeeCents: priceCents === null ? 0 : Math.min(fee, priceCents),
    paidCents: paid,
    balanceCents: priceCents === null ? 0 : Math.max(0, priceCents - paid),
    payOnArrival,
    parts,
  };
}

/**
 * What a price check on one line of a group compares against: the root's
 * payments, less what the other parts already cover. A line alone (or a
 * part of an unpaid group) has its own paid amount.
 *
 * @param {object} group lineGroupSummary.
 * @param {string} lineId The line being priced.
 * @return {number} Cents this line's price may not go below.
 */
function paidFloorForLine(group, lineId) {
  const g = asRow(group);
  const others = (Array.isArray(g.parts) ? g.parts : [])
      .filter((part) => part.id !== lineId)
      .reduce((sum, part) => sum + (part.priceCents || 0), 0);
  return Math.max(0, (Number(g.paidCents) || 0) - others);
}

/**
 * How a waiting line splits when only `count` of its pieces go: the first
 * `count` stay on the line (and ride), the rest become a new part.
 *
 * @param {object} line The stored line.
 * @param {*} count The pieces going; null/undefined for all of them.
 * @return {object} {error: "piece_count_invalid"|null, split: boolean,
 *   going: object[], staying: object[]}.
 */
function splitPieces(line, count) {
  const pieces = linePieces(line);
  if (count === null || count === undefined || count === "") {
    return {error: null, split: false, going: pieces, staying: []};
  }
  const n = Number(count);
  if (!Number.isInteger(n) || n < 1 || n > pieces.length) {
    return {error: "piece_count_invalid", split: false, going: pieces,
      staying: []};
  }
  if (n === pieces.length) {
    return {error: null, split: false, going: pieces, staying: []};
  }
  return {error: null, split: true, going: pieces.slice(0, n),
    staying: pieces.slice(n)};
}

/**
 * The next part's number: one past every part the group has had (the root
 * remembers the highest, so a cancelled part's code is never reused).
 *
 * @param {object} root The root line.
 * @param {object[]} groupLines The group's lines.
 * @return {number} 2 for the first split.
 */
function nextPartIndex(root, groupLines) {
  let highest = Math.max(1, positiveInt(asRow(root).lastPartIndex));
  for (const line of Array.isArray(groupLines) ? groupLines : []) {
    highest = Math.max(highest, partIndexOf(line));
  }
  return highest + 1;
}

/**
 * @param {string} rootCode The root's tracking code (CL-K7M4P2).
 * @param {number} index The part's number.
 * @return {string} CL-K7M4P2-2.
 */
function partTrackingCode(rootCode, index) {
  return `${text(rootCode, 40).toUpperCase()}-${positiveInt(index)}`;
}

/**
 * @param {*} value A requested source.
 * @return {string} counter, request or card_order (counter by default).
 */
function lineSourceOf(value) {
  const source = text(value, 20);
  return LINE_SOURCES.includes(source) ? source : "counter";
}

module.exports = {
  PIECE_KIND,
  PIECE_KINDS,
  CAR_PIECE_KIND,
  MAX_PIECES,
  MAX_LEGACY_PIECES,
  MAX_PIECE_DESCRIPTION,
  MAX_PIECE_INCHES,
  LINE_SOURCES,
  pieceSizeOf,
  pieceSizeGiven,
  piecePriceOf,
  pieceKindOf,
  pieceErrors,
  normalizePieces,
  distributeCents,
  linePriceOf,
  lineHasPieces,
  linePieces,
  pieceCounts,
  lineCounts,
  piecesTotalCents,
  pickupFeeOf,
  pickupFeeErrors,
  linePickupFeeCents,
  lineTotalCents,
  piecesSummaryFields,
  piecesLineFields,
  pieceSummaryText,
  linePiecesWhat,
  pieceLabelName,
  pieceSizeText,
  groupRootId,
  partIndexOf,
  lineGroupSummary,
  paidFloorForLine,
  splitPieces,
  nextPartIndex,
  partTrackingCode,
  lineSourceOf,
};
