/**
 * Pieces on a line, console side (docs/PACKAGE_REQUESTS.md section 1 and 7
 * "Line fields", docs/WAITING_PACKAGES.md "Pieces").
 *
 * A faithful mirror of the server's pure module,
 * `my_flutter_app/functions/line_pieces.js`: the same exported names, the same
 * rules. `line-pieces.test.ts` runs every case of the shared fixture
 * (`functions/test/fixtures/line-pieces-cases.json`) that the server and the
 * app run too, so a rule that changes there fails here until it is mirrored.
 *
 * A line is one customer's load (one sender, one receiver, one destination,
 * one code). It holds pieces - each physical thing handed over. A car stays a
 * line of its own kind with one implicit piece. A line written before pieces
 * existed (`{kind: "barrels", quantity: 4}`) reads through `linePieces`.
 *
 * Pure: no Firebase, no React, no clock.
 */

import { MAX_INVOICE_CENTS } from "./invoice-ledger.ts";

const MAX_CENTS = MAX_INVOICE_CENTS;

export const PIECE_KIND = Object.freeze({
  BARREL: "barrel",
  BOX: "box",
  OTHER: "other",
} as const);
/** What a counter can register. "car" is read (a car line's piece) but never written. */
export const PIECE_KINDS = Object.freeze(["barrel", "box", "other"] as const);
export const CAR_PIECE_KIND = "car";

export type PieceKind = (typeof PIECE_KINDS)[number];
export type StoredPieceKind = PieceKind | typeof CAR_PIECE_KIND;

/** The most pieces one line takes at the counter (and in an edit). */
export const MAX_PIECES = 60;
/** A legacy quantity is capped where the old form capped it. */
export const MAX_LEGACY_PIECES = 999;
export const MAX_PIECE_DESCRIPTION = 120;
/** Inches; the same cap as a line's own size. */
export const MAX_PIECE_INCHES = 600;
const PIECE_ID = /^[A-Za-z0-9_-]{1,40}$/;

export const LINE_SOURCES = Object.freeze(["counter", "request", "card_order"] as const);
export type LineSource = (typeof LINE_SOURCES)[number];

export type PieceSize = { l: number; w: number; h: number };

export type Piece = {
  id: string;
  kind: StoredPieceKind;
  description: string;
  sizeIn: PieceSize | null;
  priceCents: number | null;
};

export type PieceCounts = {
  pieceCount: number;
  barrelPieces: number;
  packagePieces: number;
  carPieces: number;
};

export type PieceErrorCode =
  | "pieces_required"
  | "pieces_too_many"
  | "piece_kind_invalid"
  | "piece_description_required"
  | "piece_description_too_long"
  | "piece_size_invalid"
  | "piece_price_invalid";

type Row = Record<string, unknown>;

const text = (value: unknown, max = 200): string => String(value ?? "").trim().slice(0, max);
const positiveInt = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};
const given = (value: unknown): boolean =>
  value !== null && value !== undefined && String(value).trim() !== "";
const asRow = (value: unknown): Row => (value && typeof value === "object" ? (value as Row) : {});

// ---------------------------------------------------------------------------
// One piece.
// ---------------------------------------------------------------------------

/** One side in inches: two decimals, or null when blank or unusable. */
function sideOf(value: unknown): number | null {
  if (!given(value)) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_PIECE_INCHES) return null;
  return Math.round(n * 100) / 100;
}

/** Whether any side of a piece's size was typed. */
export function pieceSizeGiven(raw: unknown): boolean {
  const size = asRow(raw);
  return [size.l, size.w, size.h].some(given);
}

/** {l, w, h} in inches, or null unless all three are usable. */
export function pieceSizeOf(raw: unknown): PieceSize | null {
  const size = asRow(raw);
  const sides = [size.l, size.w, size.h].map(sideOf);
  if (sides.some((side) => side === null)) return null;
  return { l: sides[0] as number, w: sides[1] as number, h: sides[2] as number };
}

/** Whole cents (zero allowed), or null when blank or not a price. */
export function piecePriceOf(value: unknown): number | null {
  if (!given(value)) return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= MAX_CENTS ? n : null;
}

/** A piece kind; anything unknown reads as "other". */
export function pieceKindOf(value: unknown): StoredPieceKind {
  const kind = text(value, 20).toLowerCase();
  if (kind === CAR_PIECE_KIND) return CAR_PIECE_KIND;
  return (PIECE_KINDS as readonly string[]).includes(kind) ? (kind as PieceKind) : PIECE_KIND.OTHER;
}

/** Every problem with the pieces a request sends, each code once. */
export function pieceErrors(raw: unknown, max = MAX_PIECES): PieceErrorCode[] {
  if (!Array.isArray(raw) || raw.length === 0) return ["pieces_required"];
  const errors = new Set<PieceErrorCode>();
  if (raw.length > max) errors.add("pieces_too_many");
  for (const item of raw) {
    const piece = asRow(item);
    const kind = text(piece.kind, 20).toLowerCase();
    const known = (PIECE_KINDS as readonly string[]).includes(kind);
    if (!known) errors.add("piece_kind_invalid");
    const description = String(piece.description ?? "").trim();
    if (description.length > MAX_PIECE_DESCRIPTION) errors.add("piece_description_too_long");
    // A barrel is a barrel; a box or an item has to say what it is.
    if (kind !== PIECE_KIND.BARREL && known && !description) {
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
 * The pieces as stored: kind, description, size and price cleaned, and an id
 * each. A usable id that is not a repeat is kept (an edit keeps its pieces);
 * any other gets the first free `p<n>`.
 */
export function normalizePieces(raw: unknown): Piece[] {
  const list: unknown[] = Array.isArray(raw) ? raw : [];
  const used = new Set<string>();
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
 * A total spread over n pieces as evenly as cents allow, the odd cents on the
 * first ones: $100 over 3 is 33.34, 33.33, 33.33.
 */
export function distributeCents(total: number | null | undefined, count: unknown): Array<number | null> {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (total === null || total === undefined || !Number.isFinite(total)) {
    return Array.from({ length: n }, () => null);
  }
  const base = Math.floor(total / n);
  const rest = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0));
}

const lineSize = (line: Row) => pieceSizeOf({ l: line.lengthIn, w: line.widthIn, h: line.heightIn });

/** A line's price as stored: whole cents above zero, else null. */
export function linePriceOf(value: unknown): number | null {
  if (!given(value)) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 && n <= MAX_CENTS ? n : null;
}

/** Whether a line carries its own pieces (not a car, not a legacy line). */
export function lineHasPieces(line: unknown): boolean {
  const row = asRow(line);
  return text(row.kind, 20) !== "car" && Array.isArray(row.pieces) && row.pieces.length > 0;
}

/**
 * The pieces of any line, old or new. A car is one car piece carrying the
 * line's price; a legacy line expands its quantity, its price spread over the
 * pieces so the total still reads the same.
 */
export function linePieces(line: unknown): Piece[] {
  const row = asRow(line);
  const kind = text(row.kind, 20);
  if (kind === "car") {
    return [{ id: "car", kind: CAR_PIECE_KIND, description: "", sizeIn: lineSize(row), priceCents: linePriceOf(row.priceCents) }];
  }
  if (lineHasPieces(row)) return normalizePieces(row.pieces);
  const count = Math.min(MAX_LEGACY_PIECES, positiveInt(row.quantity) || 1);
  const pieceKind: PieceKind = kind === "barrels" ? PIECE_KIND.BARREL : PIECE_KIND.OTHER;
  const description = pieceKind === PIECE_KIND.OTHER ? text(row.description, MAX_PIECE_DESCRIPTION) : "";
  const size = lineSize(row);
  const prices = distributeCents(linePriceOf(row.priceCents), count);
  return prices.map((priceCents, i) => ({
    id: `p${i + 1}`,
    kind: pieceKind,
    description,
    sizeIn: size ? { ...size } : null,
    priceCents,
  }));
}

/** The denormalized counts every line carries: all pieces, barrels, packages (box + other), cars. */
export function pieceCounts(pieces: unknown): PieceCounts {
  const out: PieceCounts = { pieceCount: 0, barrelPieces: 0, packagePieces: 0, carPieces: 0 };
  for (const piece of Array.isArray(pieces) ? pieces : []) {
    const kind = text(asRow(piece).kind, 20);
    out.pieceCount += 1;
    if (kind === CAR_PIECE_KIND) out.carPieces += 1;
    else if (kind === PIECE_KIND.BARREL) out.barrelPieces += 1;
    else out.packagePieces += 1;
  }
  return out;
}

/** A stored line's counts (pieceCounts), legacy lines included. */
export function lineCounts(line: unknown): PieceCounts {
  return pieceCounts(linePieces(line));
}

/** The line total: the sum of the priced pieces, or null while none has a price (or they add up to nothing). */
export function piecesTotalCents(pieces: unknown): number | null {
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
 */
export function pickupFeeOf(value: unknown): number {
  if (!given(value)) return 0;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= MAX_CENTS ? n : 0;
}

/** ["pickup_fee_invalid"] unless a typed fee is whole cents >= 0 (absent: no fee, fine). */
export function pickupFeeErrors(value: unknown): Array<"pickup_fee_invalid"> {
  if (value === null || value === undefined) return [];
  const n = typeof value === "string" && value.trim() === "" ? NaN : Number(value);
  return Number.isInteger(n) && n >= 0 && n <= MAX_CENTS ? [] : ["pickup_fee_invalid"];
}

/**
 * A line's own pickup fee (a collected request's): a line with pieces may
 * carry one beside its pieces; a car or a legacy line never does. Never
 * spread into the piece prices; a split never moves it off the root.
 */
export function linePickupFeeCents(line: unknown): number {
  const row = asRow(line);
  return lineHasPieces(row) ? pickupFeeOf(row.pickupFeeCents) : 0;
}

/**
 * Whether a line carries a pickup fee field at all: a line with pieces
 * received from a collected request (the fee may be 0), never a counter
 * line, a car, a legacy line or a part split off. The edit forms show the
 * "Pickup fee" field only for these.
 */
export function lineHasPickupFee(line: unknown): boolean {
  const row = asRow(line);
  return lineHasPieces(row) && given(row.pickupFeeCents);
}

/**
 * The line total: the pieces' prices plus the line's pickup fee. Null while
 * no piece has a price (a fee alone is not a price for the load), or when it
 * all adds up to nothing.
 */
export function lineTotalCents(pieces: unknown, pickupFeeCents: unknown = 0): number | null {
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

const KIND_NAMES: Readonly<Record<string, string>> = Object.freeze({
  barrel: "Barrel",
  box: "Box",
  other: "Item",
  car: "Car",
});

/**
 * The summary fields older app versions read: `kind` "barrels" when every
 * piece is a barrel, else "other"; `quantity` the piece count; and a
 * description naming what is there ("Barrel, Clothes, TV").
 */
export function piecesSummaryFields(pieces: unknown): { kind: "barrels" | "other"; quantity: number; description: string } {
  const list: unknown[] = Array.isArray(pieces) ? pieces : [];
  const allBarrels = list.length > 0 && list.every((p) => asRow(p).kind === PIECE_KIND.BARREL);
  const names: string[] = [];
  for (const piece of list) {
    const row = asRow(piece);
    const name = text(row.description, MAX_PIECE_DESCRIPTION) || KIND_NAMES[String(row.kind)] || KIND_NAMES.other;
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
 * pieces, the counts, the summary for old apps, the pickup fee when the line
 * has one (absent: no such field), the total (pieces + fee, lineTotalCents),
 * and - for a single piece - its size as the line's size.
 */
export function piecesLineFields(raw: unknown, pickupFeeCents: unknown = null) {
  const pieces = normalizePieces(raw);
  const single = pieces.length === 1 ? pieces[0].sizeIn : null;
  const hasFee = pickupFeeCents !== null && pickupFeeCents !== undefined;
  const fee = hasFee ? pickupFeeOf(pickupFeeCents) : 0;
  return {
    pieces,
    ...pieceCounts(pieces),
    ...piecesSummaryFields(pieces),
    ...(hasFee ? { pickupFeeCents: fee } : {}),
    priceCents: lineTotalCents(pieces, fee),
    lengthIn: single ? single.l : null,
    widthIn: single ? single.w : null,
    heightIn: single ? single.h : null,
  };
}

// ---------------------------------------------------------------------------
// Saying what is there.
// ---------------------------------------------------------------------------

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * "2 barrels, 1 box" / "2 barils, 1 carton". Items that all say the same thing
 * are named ("2 × TV"); a mix of items is counted.
 */
export function pieceSummaryText(pieces: unknown, language: "en" | "fr" = "en"): string {
  const fr = language === "fr";
  const list = (Array.isArray(pieces) ? pieces : []).map(asRow);
  const of = (kind: string) => list.filter((p) => p.kind === kind);
  const parts: string[] = [];
  const cars = of(CAR_PIECE_KIND).length;
  if (cars) parts.push(fr ? plural(cars, "véhicule", "véhicules") : plural(cars, "car", "cars"));
  const barrels = of(PIECE_KIND.BARREL).length;
  if (barrels) parts.push(fr ? plural(barrels, "baril", "barils") : plural(barrels, "barrel", "barrels"));
  const boxes = of(PIECE_KIND.BOX).length;
  if (boxes) parts.push(fr ? plural(boxes, "carton", "cartons") : plural(boxes, "box", "boxes"));
  const items = of(PIECE_KIND.OTHER);
  if (items.length) {
    const names = [...new Set(items.map((p) => text(p.description, MAX_PIECE_DESCRIPTION)))];
    if (names.length === 1 && names[0]) {
      parts.push(items.length === 1 ? names[0] : `${items.length} × ${names[0]}`);
    } else {
      parts.push(fr ? plural(items.length, "article", "articles") : plural(items.length, "item", "items"));
    }
  }
  return parts.join(", ");
}

/**
 * The "what" of a message about a line with pieces: when its group has more
 * than one part, which share of the whole this part is ("2 of your 4 pieces" /
 * "2 de vos 4 colis"); otherwise the piece summary.
 */
export function linePiecesWhat(line: unknown, language: "en" | "fr" = "en", group: unknown = null): string {
  const pieces = linePieces(line);
  const g = asRow(group);
  const total = positiveInt(g.pieceCount);
  if (positiveInt(g.partCount) > 1 && total > pieces.length) {
    return language === "fr" ? `${pieces.length} de vos ${total} colis` : `${pieces.length} of your ${total} pieces`;
  }
  return pieceSummaryText(pieces, language);
}

/** A piece as its label names it: "Barrel", "Box", or what it is. */
export function pieceLabelName(piece: unknown): string {
  const row = asRow(piece);
  const description = text(row.description, 80);
  if (row.kind === PIECE_KIND.BARREL) return description ? `Barrel · ${description}` : "Barrel";
  if (row.kind === PIECE_KIND.BOX) return description || "Box";
  return description || "Package";
}

/** "40 × 30 × 20 in", or "" without a full size. */
export function pieceSizeText(piece: unknown): string {
  const size = pieceSizeOf(asRow(piece).sizeIn);
  return size ? `${size.l} × ${size.w} × ${size.h} in` : "";
}

// ---------------------------------------------------------------------------
// Groups: a line and the parts split from it.
// ---------------------------------------------------------------------------

/** The root of a line's group (its own id when it is the root or was never split). */
export function groupRootId(line: unknown, id: unknown): string {
  return text(asRow(line).rootLineId, 200) || text(id, 200);
}

/** A line's place in its group: 1 for the root. */
export function partIndexOf(line: unknown): number {
  return positiveInt(asRow(line).partIndex) || 1;
}

export type LineGroupPart = {
  id: string;
  trackingCode: string;
  partIndex: number;
  pieceCount: number;
  priceCents: number | null;
  containerId: string;
  containerStatus: string;
};

export type LineGroupSummary = {
  rootLineId: string;
  partCount: number;
  pieceCount: number;
  priceCents: number | null;
  /** The part of priceCents that is the pickup fee (on the root). */
  pickupFeeCents: number;
  paidCents: number;
  balanceCents: number;
  payOnArrival: boolean;
  parts: LineGroupPart[];
};

/**
 * What a group adds up to: every part's pieces and price, and what the root
 * has been paid (payments live on the root). Parts in part order.
 */
export function lineGroupSummary(entries: unknown, rootId: unknown): LineGroupSummary {
  const root = text(rootId, 200);
  const rows = (Array.isArray(entries) ? entries : [])
    .map((entry) => ({ id: text(asRow(entry).id, 200), line: asRow(asRow(entry).line) }))
    .filter((entry) => entry.id && groupRootId(entry.line, entry.id) === root);
  const seen = new Set<string>();
  const parts: LineGroupPart[] = [];
  let total = 0;
  let priced = false;
  let paid = 0;
  let fee = 0;
  let payOnArrival = false;
  for (const { id, line } of rows) {
    if (seen.has(id)) continue;
    seen.add(id);
    const price = linePriceOf(line.priceCents);
    if (price !== null) {
      priced = true;
      total += price;
      // Inside that line's price already: told apart, never added again.
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
  parts.sort((a, b) => a.partIndex - b.partIndex || a.trackingCode.localeCompare(b.trackingCode));
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
 * payments, less what the other parts already cover.
 */
export function paidFloorForLine(group: unknown, lineId: unknown): number {
  const g = asRow(group);
  const others = (Array.isArray(g.parts) ? g.parts : [])
    .map(asRow)
    .filter((part) => part.id !== lineId)
    .reduce((sum, part) => sum + ((part.priceCents as number) || 0), 0);
  return Math.max(0, (Number(g.paidCents) || 0) - others);
}

export type PieceSplit = {
  error: "piece_count_invalid" | null;
  split: boolean;
  going: Piece[];
  staying: Piece[];
};

/**
 * How a waiting line splits when only `count` of its pieces go: the first
 * `count` stay on the line (and ride), the rest become a new part.
 */
export function splitPieces(line: unknown, count: unknown): PieceSplit {
  const pieces = linePieces(line);
  if (count === null || count === undefined || count === "") {
    return { error: null, split: false, going: pieces, staying: [] };
  }
  const n = Number(count);
  if (!Number.isInteger(n) || n < 1 || n > pieces.length) {
    return { error: "piece_count_invalid", split: false, going: pieces, staying: [] };
  }
  if (n === pieces.length) return { error: null, split: false, going: pieces, staying: [] };
  return { error: null, split: true, going: pieces.slice(0, n), staying: pieces.slice(n) };
}

/** The next part's number: one past every part the group has had. 2 for the first split. */
export function nextPartIndex(root: unknown, groupLines: unknown): number {
  let highest = Math.max(1, positiveInt(asRow(root).lastPartIndex));
  for (const line of Array.isArray(groupLines) ? groupLines : []) {
    highest = Math.max(highest, partIndexOf(line));
  }
  return highest + 1;
}

/** CL-K7M4P2 and 2 -> CL-K7M4P2-2. */
export function partTrackingCode(rootCode: unknown, index: unknown): string {
  return `${text(rootCode, 40).toUpperCase()}-${positiveInt(index)}`;
}

/** counter, request or card_order (counter by default). */
export function lineSourceOf(value: unknown): LineSource {
  const source = text(value, 20);
  return (LINE_SOURCES as readonly string[]).includes(source) ? (source as LineSource) : "counter";
}
