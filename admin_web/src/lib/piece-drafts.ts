/**
 * The pieces editor's pure half: a line's pieces as the forms type them, and
 * the `pieces` a request sends (docs/WAITING_PACKAGES.md "Pieces").
 *
 * One shared editor (`components/business/pieces-editor.tsx`) is used by the
 * register form, the waiting-package edit form and the containers panel's
 * line form; all three read and write pieces through these helpers. The rules
 * are the server's (`line-pieces.ts` mirrors `functions/line_pieces.js`); this
 * module only adds what typing needs: dollars and inches as typed, read with
 * the console's one money reader, and a refusal per piece.
 *
 * Pure: no Firebase, no React. `piece-drafts.test.ts` runs it.
 */

import { centsToInput, moneyText } from "./invoice-ledger.ts";
import {
  MAX_PIECES,
  MAX_PIECE_INCHES,
  PIECE_KINDS,
  PRICE_MODE,
  distributeCents,
  linePieces,
  linePriceMode,
  lineTotalCents,
  pieceErrors,
  piecePriceRequiredErrors,
  type PieceErrorCode,
  type PiecePriceRequiredCode,
  type PieceKind,
  type PieceSize,
  type PriceMode,
} from "./line-pieces.ts";
import { readMoneyInput } from "./money-input.ts";

type Lang = "en" | "fr";

/** One piece as the form holds it: kinds as chosen, inches and dollars as typed. */
export type PieceDraft = {
  /** React's key for the row; never sent. */
  key: string;
  /** The stored piece's id ("" for a new one: the server gives it `p<n>`). */
  id: string;
  kind: PieceKind;
  description: string;
  lengthIn: string;
  widthIn: string;
  heightIn: string;
  /** US dollars as typed; blank is "no price yet", 0 is a price. */
  price: string;
  /**
   * "How many": the identical pieces this row stands for, as typed (blank or
   * unreadable reads as 1, `pieceDraftCount`). Each one is still a piece of
   * its own once saved: its own label, its own scan.
   */
  count: string;
  /** The stored ids of the second, third... of them, so an edit keeps its pieces. */
  moreIds: string[];
};

/**
 * How the package's price is typed (docs/WAITING_PACKAGES.md "One price for
 * all"): a price on each piece, or one `total` (US dollars as typed) for all
 * of them, spread evenly over the pieces when it is sent.
 */
export type PiecesPricing = { mode: PriceMode; total: string };

/** A price on each piece: how every form starts. */
export function eachPricing(): PiecesPricing {
  return { mode: PRICE_MODE.EACH, total: "" };
}

/** A typed "How many" above this is asked about before it is taken (30 typed for 3 prints 30 labels). */
export const COUNT_CONFIRM_ABOVE = 10;

/** A piece as `addWaitingPackage` / `addContainerLine` / `updateContainerLine` take it. */
export type PiecePayload = {
  id: string;
  kind: PieceKind;
  description: string;
  sizeIn: PieceSize | null;
  priceCents: number | null;
};

const text = (value: unknown, max = 200) => String(value ?? "").trim().slice(0, max);

let nextKey = 0;
function freshKey(): string {
  nextKey += 1;
  return `piece-${nextKey}`;
}

const PIECE_KIND_LABELS: Record<"en" | "fr", Record<PieceKind, string>> = {
  en: { barrel: "Barrel", box: "Box", other: "Other" },
  fr: { barrel: "Baril", box: "Carton", other: "Autre" },
};

/** The kind on its segmented control, in the reader's language (a bare "Box" is no dictionary key: it would rewrite a container named "Box 2"). */
export function pieceKindLabel(kind: PieceKind, lang: Lang = "en"): string {
  return PIECE_KIND_LABELS[lang === "fr" ? "fr" : "en"][kind];
}

/** A blank piece (a barrel unless told otherwise: the counter's most common thing). */
export function newPieceDraft(kind: PieceKind = "barrel"): PieceDraft {
  return { key: freshKey(), id: "", kind, description: "", lengthIn: "", widthIn: "", heightIn: "", price: "", count: "1", moreIds: [] };
}

/** How many pieces a row stands for: 1 to 60; blank or unreadable is 1. */
export function pieceDraftCount(draft: Pick<PieceDraft, "count">): number {
  const raw = text(draft?.count, 6);
  if (!/^\d+$/.test(raw)) return 1;
  return Math.min(MAX_PIECES, Math.max(1, Number(raw)));
}

/** The pieces the rows stand for in all: what is saved, labelled and scanned. */
export function piecesDraftCount(drafts: readonly PieceDraft[]): number {
  return (Array.isArray(drafts) ? drafts : []).reduce((sum, draft) => sum + pieceDraftCount(draft), 0);
}

/** 12 -> "12", 12.5 -> "12.5". */
function trimNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * A stored line's pieces back into the editor, ids kept so an edit keeps its
 * pieces. A legacy line reads through `linePieces` (its count expanded, its
 * price spread). Pieces that follow each other and read the same (kind,
 * description, size, price) come back as one row with its "How many"; in a
 * package priced as one total the shares may differ by a cent, so the price
 * is left out of the comparison (and of the rows: the total holds it,
 * `piecesPricingFromLine`). A car has no pieces to edit: one blank barrel.
 */
export function pieceDraftsFromLine(line: unknown): PieceDraft[] {
  const row = line && typeof line === "object" ? (line as Record<string, unknown>) : {};
  if (text(row.kind, 20) === "car") return [newPieceDraft()];
  const totalMode = linePriceMode(row) === PRICE_MODE.TOTAL;
  const drafts: PieceDraft[] = [];
  let lastShape = "";
  for (const piece of linePieces(row)) {
    const draft: PieceDraft = {
      key: freshKey(),
      id: piece.id,
      kind: piece.kind === "car" ? "other" : piece.kind,
      description: piece.description,
      lengthIn: piece.sizeIn ? trimNumber(piece.sizeIn.l) : "",
      widthIn: piece.sizeIn ? trimNumber(piece.sizeIn.w) : "",
      heightIn: piece.sizeIn ? trimNumber(piece.sizeIn.h) : "",
      price: totalMode || piece.priceCents === null ? "" : centsToInput(piece.priceCents),
      count: "1",
      moreIds: [],
    };
    const shape = JSON.stringify([draft.kind, draft.description, draft.lengthIn, draft.widthIn, draft.heightIn, draft.price]);
    const last = drafts[drafts.length - 1];
    if (last && shape === lastShape) {
      last.count = String(pieceDraftCount(last) + 1);
      last.moreIds.push(piece.id);
    } else {
      drafts.push(draft);
      lastShape = shape;
    }
  }
  return drafts;
}

/** How a stored line is priced, as the editor opens on it: its one total (the pieces' sum, the pickup fee apart) or a price on each piece. */
export function piecesPricingFromLine(line: unknown): PiecesPricing {
  const row = line && typeof line === "object" ? (line as Record<string, unknown>) : {};
  if (linePriceMode(row) !== PRICE_MODE.TOTAL) return eachPricing();
  const sum = linePieces(row).reduce((cents, piece) => cents + (piece.priceCents ?? 0), 0);
  return { mode: PRICE_MODE.TOTAL, total: centsToInput(sum) };
}

// ---------------------------------------------------------------------------
// Inches and dollars as typed.
// ---------------------------------------------------------------------------

/**
 * One typed measurement as a number of inches: blank is null, anything that
 * is not a positive number below the cap is NaN (so the form can tell "not
 * filled in" from "filled in wrong"). A decimal comma is read as a point.
 */
export function parseInches(value: unknown): number | null {
  const raw = text(value, 20).replace(",", ".");
  if (!raw) return null;
  if (!/^\d+(\.\d+)?$/.test(raw)) return Number.NaN;
  const n = Number(raw);
  return n > 0 && n <= MAX_PIECE_INCHES ? Math.round(n * 100) / 100 : Number.NaN;
}

/** A piece's price as cents: null for blank, NaN for unreadable or negative. Zero is a price. */
export function readPiecePrice(value: unknown): number | null {
  const read = readMoneyInput(value);
  if (read.issue === "empty") return null;
  if (read.cents === null || read.cents < 0) return Number.NaN;
  return read.cents;
}

type ReadPiece = { payload: PiecePayload; problems: PieceErrorCode[] };

function readPiece(draft: PieceDraft, totalMode = false): ReadPiece {
  const problems: PieceErrorCode[] = [];
  const sides = [parseInches(draft.lengthIn), parseInches(draft.widthIn), parseInches(draft.heightIn)];
  let sizeIn: PieceSize | null = null;
  if (sides.some((side) => side !== null)) {
    if (sides.every((side) => side !== null && !Number.isNaN(side))) {
      sizeIn = { l: sides[0] as number, w: sides[1] as number, h: sides[2] as number };
    } else {
      problems.push("piece_size_invalid");
    }
  }
  // With one price for all, a row's own price is neither shown nor read.
  const cents = totalMode ? null : readPiecePrice(draft.price);
  if (cents !== null && Number.isNaN(cents)) problems.push("piece_price_invalid");
  const payload: PiecePayload = {
    id: text(draft.id, 40),
    kind: (PIECE_KINDS as readonly string[]).includes(draft.kind) ? draft.kind : "other",
    description: text(draft.description, 200),
    sizeIn,
    priceCents: cents === null || Number.isNaN(cents) ? null : cents,
  };
  // The server's own rules on what was read (kind, description, the cap).
  for (const code of pieceErrors([{ ...payload, description: String(draft.description ?? "") }])) {
    if (!problems.includes(code)) problems.push(code);
  }
  return { payload, problems };
}

const isTotal = (pricing: PiecesPricing | undefined) => pricing?.mode === PRICE_MODE.TOTAL;

/** The one price for all as cents: null for blank, NaN for unreadable or negative. Zero is a price. */
export function readTotalPrice(pricing: PiecesPricing): number | null {
  return readPiecePrice(pricing.total);
}

/**
 * The `pieces` a request sends, in the order typed: a row with "How many"
 * above 1 is that many pieces, the first keeping the row's id and the others
 * the ids stored beside it. With one price for all, the total is spread over
 * every piece as evenly as cents allow, the odd cents on the first ones
 * (`distributeCents`, the server's rule), so the prices add up to exactly
 * what was typed.
 */
export function piecesPayload(drafts: readonly PieceDraft[], pricing: PiecesPricing = eachPricing()): PiecePayload[] {
  const totalMode = isTotal(pricing);
  const out: PiecePayload[] = [];
  for (const draft of drafts) {
    const base = readPiece(draft, totalMode).payload;
    const count = pieceDraftCount(draft);
    for (let i = 0; i < count; i += 1) {
      out.push({
        ...base,
        id: i === 0 ? base.id : text(draft.moreIds?.[i - 1], 40),
        sizeIn: base.sizeIn ? { ...base.sizeIn } : null,
      });
    }
  }
  if (totalMode) {
    const total = readTotalPrice(pricing);
    const shares = distributeCents(total === null || Number.isNaN(total) ? null : total, out.length);
    out.forEach((piece, i) => {
      piece.priceCents = shares[i] ?? null;
    });
  }
  return out;
}

export type PieceDraftCode = PieceErrorCode | PiecePriceRequiredCode;

export type PieceDraftProblems = {
  /** Every problem once, as the server names it. */
  codes: PieceDraftCode[];
  /** Each row's own problems, in the order shown. */
  byPiece: PieceDraftCode[][];
};

/**
 * The server's `pieceErrors` (1-60 pieces, counting every row's "How many"),
 * plus what typing can get wrong, per row. With `priceRequired` (a customer's
 * package: docs/PACKAGE_PRICE_REQUIRED.md) also the server's
 * `piecePriceRequiredErrors`: a piece with no price typed is its own
 * `piece_price_required`, and pieces that all come to $0 are
 * `package_price_required` (the package's, not one piece's). As on the server,
 * a price typed wrong keeps its own error and adds no "required" on top.
 * With one price for all (`pricing`), the rows have no price of their own: a
 * total that cannot be read - or, when a price is required, is blank or $0 -
 * is `package_price_required`.
 */
export function pieceDraftProblems(
  drafts: readonly PieceDraft[],
  options: { priceRequired?: boolean; pricing?: PiecesPricing } = {},
): PieceDraftProblems {
  const list = Array.isArray(drafts) ? drafts : [];
  if (list.length === 0) return { codes: ["pieces_required"], byPiece: [] };
  const totalMode = isTotal(options.pricing);
  const codes = new Set<PieceDraftCode>();
  if (piecesDraftCount(list) > MAX_PIECES) codes.add("pieces_too_many");
  const byPiece: PieceDraftCode[][] = list.map((draft) => readPiece(draft, totalMode).problems);
  for (const own of byPiece) own.forEach((code) => codes.add(code));
  if (totalMode) {
    const total = readTotalPrice(options.pricing as PiecesPricing);
    const unreadable = total !== null && Number.isNaN(total);
    if (unreadable || (options.priceRequired && (total === null || total <= 0))) codes.add("package_price_required");
  } else if (options.priceRequired && !codes.has("piece_price_invalid")) {
    list.forEach((draft, i) => {
      if (readPiecePrice(draft.price) === null) byPiece[i].push("piece_price_required");
    });
    for (const code of piecePriceRequiredErrors(piecesPayload(list))) codes.add(code);
  }
  return { codes: [...codes], byPiece };
}

/**
 * The line total the pieces add up to, plus the line's own pickup fee when it
 * has one (null while no piece is priced), as the server computes it
 * (`lineTotalCents`): the fee is never spread into the piece prices.
 */
export function piecesDraftTotalCents(drafts: readonly PieceDraft[], pickupFeeCents = 0, pricing: PiecesPricing = eachPricing()): number | null {
  return lineTotalCents(piecesPayload(drafts, pricing), pickupFeeCents);
}

/**
 * A typed pickup fee (US dollars; blank is no fee) as whole cents, or the
 * refusal the server gives (`pickup_fee_invalid`): zero is fine, negative or
 * unreadable is not. The console's one money reader, so "20,00" is $20.
 */
export function readPickupFeeInput(value: unknown): { cents: number; error: "pickup_fee_invalid" | null } {
  const read = readMoneyInput(value);
  if (read.issue === "empty") return { cents: 0, error: null };
  if (read.cents === null || read.cents < 0) return { cents: 0, error: "pickup_fee_invalid" };
  return { cents: read.cents, error: null };
}

/**
 * Whether the pieces typed differ from what the line holds (kind,
 * description, size or price; ids aside), or are priced another way (one
 * price for all against a price on each). A legacy line saved unchanged is
 * sent in its old form, so an edit to its contacts does not rewrite it.
 */
export function piecesDifferFromLine(line: unknown, drafts: readonly PieceDraft[], pricing: PiecesPricing = eachPricing()): boolean {
  const shape = (p: { kind: string; description: string; sizeIn: PieceSize | null; priceCents: number | null }) =>
    JSON.stringify([p.kind, p.description, p.sizeIn ? [p.sizeIn.l, p.sizeIn.w, p.sizeIn.h] : null, p.priceCents]);
  if (pricing.mode !== linePriceMode(line)) return true;
  const stored = linePieces(line).map(shape);
  const typed = piecesPayload(drafts, pricing).map(shape);
  return stored.length !== typed.length || stored.some((value, i) => value !== typed[i]);
}

// ---------------------------------------------------------------------------
// Editing the list.
// ---------------------------------------------------------------------------

/** "+ Add another piece": a new piece of the same kind as the last one. */
export function addPieceDraft(drafts: readonly PieceDraft[]): PieceDraft[] {
  const last = drafts[drafts.length - 1];
  return [...drafts, newPieceDraft(last ? last.kind : "barrel")];
}

/** Removes a piece; the last one stays (a line has at least one). */
export function removePieceDraft(drafts: readonly PieceDraft[], key: string): PieceDraft[] {
  if (drafts.length <= 1) return [...drafts];
  return drafts.filter((draft) => draft.key !== key);
}

export function updatePieceDraft(drafts: readonly PieceDraft[], key: string, patch: Partial<Omit<PieceDraft, "key">>): PieceDraft[] {
  return drafts.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft));
}

/**
 * "How many" set on a row: 1 up to what the package still has room for (60
 * pieces in all, never below 1). The stored ids stay on the row - fewer
 * pieces simply send fewer of them (`piecesPayload`) - so lowering the count
 * and raising it again loses nothing.
 */
export function setPieceDraftCount(drafts: readonly PieceDraft[], key: string, count: number): PieceDraft[] {
  const others = drafts.reduce((sum, draft) => sum + (draft.key === key ? 0 : pieceDraftCount(draft)), 0);
  const room = Math.max(1, MAX_PIECES - others);
  const next = Math.min(room, Math.max(1, Math.floor(Number(count)) || 1));
  return drafts.map((draft) => (draft.key === key ? { ...draft, count: String(next) } : draft));
}

/**
 * The price switch flipped. To one price for all: the total opens on what the
 * rows add up to (blank while none is priced). Back to a price on each piece:
 * every row takes its share of the total - a row whose pieces straddle the
 * odd cent is cut in two, so the prices still add up to exactly the total; a
 * blank or unreadable total leaves the rows' own prices as they were.
 */
export function switchPricingMode(
  drafts: readonly PieceDraft[],
  pricing: PiecesPricing,
  mode: PriceMode,
): { pieces: PieceDraft[]; pricing: PiecesPricing } {
  if (mode === pricing.mode) return { pieces: [...drafts], pricing };
  if (mode === PRICE_MODE.TOTAL) {
    const sum = piecesDraftTotalCents(drafts);
    const anyPriced = drafts.some((draft) => {
      const cents = readPiecePrice(draft.price);
      return cents !== null && !Number.isNaN(cents);
    });
    return { pieces: [...drafts], pricing: { mode, total: anyPriced ? centsToInput(sum ?? 0) : "" } };
  }
  const total = readTotalPrice(pricing);
  if (total === null || Number.isNaN(total)) return { pieces: [...drafts], pricing: eachPricing() };
  const shares = distributeCents(total, piecesDraftCount(drafts));
  const pieces: PieceDraft[] = [];
  let at = 0;
  for (const draft of drafts) {
    const count = pieceDraftCount(draft);
    const ids = [draft.id, ...(draft.moreIds ?? [])];
    let start = 0;
    while (start < count) {
      let end = start + 1;
      while (end < count && shares[at + end] === shares[at + start]) end += 1;
      pieces.push({
        ...draft,
        key: start === 0 ? draft.key : freshKey(),
        id: ids[start] ?? "",
        moreIds: ids.slice(start + 1, end),
        count: String(end - start),
        price: centsToInput(shares[at + start] ?? 0),
      });
      start = end;
    }
    at += count;
  }
  return { pieces, pricing: eachPricing() };
}

// ---------------------------------------------------------------------------
// Words built per language (they carry a number, so the dictionary cannot).
// ---------------------------------------------------------------------------

/** "Piece 2" / "Colis 2"; a row of several, by the numbers their labels carry: "Pieces 2-4" / "Colis 2-4". */
export function pieceHeading(index: number, lang: Lang = "en", count = 1): string {
  if (count > 1) return `${lang === "fr" ? "Colis" : "Pieces"} ${index + 1}\u2013${index + count}`;
  return lang === "fr" ? `Colis ${index + 1}` : `Piece ${index + 1}`;
}

/** "3 pieces" / "3 colis". */
export function piecesCountText(count: number, lang: Lang = "en"): string {
  if (lang === "fr") return `${count} colis`;
  return `${count} ${count === 1 ? "piece" : "pieces"}`;
}

/** "Save and print 3 labels" / "Enregistrer et imprimer 3 étiquettes". */
export function savePrintLabelsText(count: number, lang: Lang = "en"): string {
  if (lang === "fr") return `Enregistrer et imprimer ${count} ${count === 1 ? "étiquette" : "étiquettes"}`;
  return `Save and print ${count} ${count === 1 ? "label" : "labels"}`;
}

/** "Total: $245.00" / "Total : 245,00 $" - the money in the console's one format. */
export function piecesTotalText(cents: number | null, lang: Lang = "en"): string {
  if (cents === null) return lang === "fr" ? "Total : pas encore de prix" : "Total: no price yet";
  return lang === "fr" ? `Total : ${moneyText(cents, "fr")}` : `Total: ${moneyText(cents)}`;
}

/** What the editor says that carries no number, per language (short words are no dictionary keys: they would rewrite names). */
const EDITOR_TEXT = {
  en: {
    howMany: "How many",
    fewer: "One fewer",
    more: "One more",
    priceSwitch: "Price",
    priceSwitchAria: "How this package is priced",
    each: "Each piece",
    total: "One price for all",
    totalField: "Price for all ($)",
    yes: "Yes",
    no: "No",
  },
  fr: {
    howMany: "Combien",
    fewer: "Un de moins",
    more: "Un de plus",
    priceSwitch: "Prix",
    priceSwitchAria: "Comment le prix de cet envoi est saisi",
    each: "Par colis",
    total: "Un prix pour tout",
    totalField: "Prix pour tout ($)",
    yes: "Oui",
    no: "Non",
  },
} as const;

export type PiecesEditorTextKey = keyof (typeof EDITOR_TEXT)["en"];

export function piecesEditorText(key: PiecesEditorTextKey, lang: Lang = "en"): string {
  return EDITOR_TEXT[lang === "fr" ? "fr" : "en"][key];
}

/** Under a row of several, priced: "3 × $45.00 = $135.00". "" for one piece or no readable price. */
export function pieceRowSumText(draft: PieceDraft, lang: Lang = "en"): string {
  const count = pieceDraftCount(draft);
  const cents = readPiecePrice(draft.price);
  if (count < 2 || cents === null || Number.isNaN(cents)) return "";
  const money = (value: number) => (lang === "fr" ? moneyText(value, "fr") : moneyText(value));
  return `${count} \u00d7 ${money(cents)} = ${money(cents * count)}`;
}

/**
 * Under the one price for all, how it is spread: "3 pieces, $50.00 each", or
 * "3 pieces: 2 at $66.67, 1 at $66.66" when cents do not divide. "" while the
 * total is blank or unreadable.
 */
export function totalSplitText(pricing: PiecesPricing, count: number, lang: Lang = "en"): string {
  const total = readTotalPrice(pricing);
  if (total === null || Number.isNaN(total) || count < 1) return "";
  const fr = lang === "fr";
  const money = (value: number) => (fr ? moneyText(value, "fr") : moneyText(value));
  const shares = distributeCents(total, count) as number[];
  const high = shares.filter((cents) => cents === shares[0]).length;
  const pieces = piecesCountText(count, lang);
  if (high === count) return fr ? `${pieces}, ${money(shares[0])} chacun` : `${pieces}, ${money(shares[0])} each`;
  const low = shares[count - 1];
  return fr
    ? `${pieces} : ${high} \u00e0 ${money(shares[0])}, ${count - high} \u00e0 ${money(low)}`
    : `${pieces}: ${high} at ${money(shares[0])}, ${count - high} at ${money(low)}`;
}

/** A stored one-price package whose piece count changed: "The total stays $200.00. Change it if the price changed." */
export function totalStaysText(pricing: PiecesPricing, lang: Lang = "en"): string {
  const total = readTotalPrice(pricing);
  if (total === null || Number.isNaN(total)) return "";
  return lang === "fr"
    ? `Le total reste ${moneyText(total, "fr")}. Modifiez-le si le prix a chang\u00e9.`
    : `The total stays ${moneyText(total)}. Change it if the price changed.`;
}

/** A stored package whose piece count changed: its labels say "of 3" and must be printed again. */
export function reprintLabelsText(before: number, after: number, lang: Lang = "en"): string {
  return lang === "fr"
    ? `Le nombre de colis passe de ${before} \u00e0 ${after} : r\u00e9imprimez les \u00e9tiquettes.`
    : `The number of pieces changes from ${before} to ${after}: print the labels again.`;
}

/** A large "How many" typed, asked about before it is taken: "Make this 30 pieces? It prints 30 labels." */
export function countConfirmText(count: number, lang: Lang = "en"): string {
  return lang === "fr"
    ? `Passer \u00e0 ${count} colis ? Cela imprime ${count} \u00e9tiquettes.`
    : `Make this ${count} pieces? It prints ${count} labels.`;
}
