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
  distributeCents,
  linePieces,
  lineTotalCents,
  pieceErrors,
  piecePriceRequiredErrors,
  type PieceErrorCode,
  type PiecePriceRequiredCode,
  type PieceKind,
  type PieceSize,
} from "./line-pieces.ts";
import { readMoneyInput } from "./money-input.ts";
import { PRICE_MODE, packagePiecePrices, type PriceMode, type StoredPiecePrice } from "./package-price-mode.ts";

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
  /**
   * US dollars as typed; blank is "no price yet", 0 is a price. The price of
   * one piece, or - `priceFor: "all"` on a row of several - of all the row's
   * pieces together.
   */
  price: string;
  /**
   * "How many": the identical pieces this row stands for, as typed (blank or
   * unreadable reads as 1, `pieceDraftCount`). Each one is still a piece of
   * its own once saved: its own label, its own scan.
   */
  count: string;
  /** The stored ids of the second, third... of them, so an edit keeps its pieces. */
  moreIds: string[];
  /**
   * How a row of several is priced (owner, 2026-11-16): `each` piece at
   * `price`, or `all` of them together for `price`, shared among this row's
   * pieces only - never with another row's. One piece is always `each`.
   */
  priceFor: PriceFor;
};

export type PriceFor = "each" | "all";

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
  return { key: freshKey(), id: "", kind, description: "", lengthIn: "", widthIn: "", heightIn: "", price: "", count: "1", moreIds: [], priceFor: "each" };
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

/** Whether the row's price is one amount for all its pieces (a row of one is always priced each). */
export function pieceDraftPricedTogether(draft: Pick<PieceDraft, "count" | "priceFor">): boolean {
  return draft.priceFor === "all" && pieceDraftCount(draft) > 1;
}

/**
 * A stored line's pieces back into the editor, ids kept so an edit keeps its
 * pieces. A legacy line reads through `linePieces` (its count expanded, its
 * price spread). Pieces that follow each other, read the same (kind,
 * description, size) and whose prices are one amount shared evenly come back
 * as one row with its "How many": the same price on each is "each piece at
 * that price"; prices a cent apart (an amount that did not divide) are "all
 * together for their sum". Nothing is stored to say which was typed - the
 * prices say it. The same piece further down stays its own row, so the order
 * (and the labels' numbers) never changes. A car has no pieces to edit: one
 * blank barrel.
 */
export function pieceDraftsFromLine(line: unknown, options: { priceMode?: PriceMode } = {}): PieceDraft[] {
  // One price for the whole package (docs/PACKAGE_ONE_PRICE.md): rows are
  // grouped by shape only; the prices play no part and none is put on a row.
  const shapeOnly = options.priceMode === PRICE_MODE.PACKAGE;
  const row = line && typeof line === "object" ? (line as Record<string, unknown>) : {};
  if (text(row.kind, 20) === "car") return [newPieceDraft()];
  type Run = { draft: PieceDraft; shape: string; prices: Array<number | null> };
  const runs: Run[] = [];
  // Still one amount shared evenly: every piece priced and the prices are
  // their sum spread as the form spreads it, or none priced at all.
  const shared = (prices: Array<number | null>) => {
    if (prices.every((cents) => cents === null)) return true;
    if (prices.some((cents) => cents === null)) return false;
    const cents = prices as number[];
    const even = distributeCents(cents.reduce((sum, value) => sum + value, 0), cents.length);
    return cents.every((value, i) => value === even[i]);
  };
  for (const piece of linePieces(row)) {
    const draft: PieceDraft = {
      key: freshKey(),
      id: piece.id,
      kind: piece.kind === "car" ? "other" : piece.kind,
      description: piece.description,
      lengthIn: piece.sizeIn ? trimNumber(piece.sizeIn.l) : "",
      widthIn: piece.sizeIn ? trimNumber(piece.sizeIn.w) : "",
      heightIn: piece.sizeIn ? trimNumber(piece.sizeIn.h) : "",
      price: "",
      count: "1",
      moreIds: [],
      priceFor: "each",
    };
    const shape = JSON.stringify([draft.kind, draft.description, draft.lengthIn, draft.widthIn, draft.heightIn]);
    const last = runs[runs.length - 1];
    if (last && last.shape === shape && (shapeOnly || shared([...last.prices, piece.priceCents]))) {
      last.prices.push(piece.priceCents);
      last.draft.moreIds.push(piece.id);
    } else {
      runs.push({ draft, shape, prices: [piece.priceCents] });
    }
  }
  if (shapeOnly) return runs.map(({ draft, prices }) => ({ ...draft, count: String(prices.length) }));
  return runs.map(({ draft, prices }) => {
    const first = prices[0];
    const same = prices.every((cents) => cents === first);
    const sum = prices.reduce<number>((total, cents) => total + (cents ?? 0), 0);
    return {
      ...draft,
      count: String(prices.length),
      priceFor: same ? "each" : "all",
      price: first === null ? "" : centsToInput(same ? first : sum),
    };
  });
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

function readPiece(draft: PieceDraft, ignorePrice = false): ReadPiece {
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
  // One price for the whole package: a row has no price of its own.
  const cents = ignorePrice ? null : readPiecePrice(draft.price);
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

/**
 * The `pieces` a request sends, in the order typed: a row with "How many"
 * above 1 is that many pieces, the first keeping the row's id and the others
 * the ids stored beside it. A row priced all together spreads its amount
 * over its own pieces as evenly as cents allow, the odd cents on the first
 * ones (`distributeCents`, the server's rule), so they add up to exactly
 * what was typed; another row's pieces never take part.
 */
export function piecesPayload(drafts: readonly PieceDraft[], pricing?: PiecePricing): PiecePayload[] {
  const out: PiecePayload[] = [];
  for (const draft of drafts) {
    const base = readPiece(draft, !!pricing).payload;
    const count = pieceDraftCount(draft);
    const shares = !pricing && pieceDraftPricedTogether(draft) ? distributeCents(base.priceCents, count) : null;
    for (let i = 0; i < count; i += 1) {
      out.push({
        ...base,
        id: i === 0 ? base.id : text(draft.moreIds?.[i - 1], 40),
        sizeIn: base.sizeIn ? { ...base.sizeIn } : null,
        priceCents: shares ? (shares[i] ?? null) : base.priceCents,
      });
    }
  }
  if (!pricing) return out;
  // One price for the whole package: shared among the pieces by the one rule
  // (`packagePiecePrices`), every piece still carries its own price.
  const shares = packagePiecePrices(onePriceCents(pricing), out.map((piece) => piece.id), pricing.stored);
  return out.map((piece, i) => ({ ...piece, priceCents: shares[i] ?? null }));
}

/**
 * Pricing a package with one price (docs/PACKAGE_ONE_PRICE.md): the price
 * typed (US dollars as typed, the pickup fee never part of it) and, when the
 * form edits a saved package, its pieces as saved. Passed beside the drafts;
 * absent means today's price on each row.
 */
export type PiecePricing = {
  onePrice: string;
  stored: readonly StoredPiecePrice[] | null;
};

/** What a form draft carries to say how its package is priced. */
export type PricingFields = {
  priceMode?: PriceMode;
  onePrice?: string;
  storedPieces?: readonly StoredPiecePrice[] | null;
};

/** The draft's one-price pricing, or undefined when the business prices each item. */
export function packagePricingOf(draft: PricingFields | null | undefined): PiecePricing | undefined {
  if (!draft || draft.priceMode !== PRICE_MODE.PACKAGE) return undefined;
  return { onePrice: String(draft.onePrice ?? ""), stored: draft.storedPieces ?? null };
}

/** The one price as whole cents: null when blank, unreadable or negative. Zero is a price. */
export function onePriceCents(pricing: Pick<PiecePricing, "onePrice">): number | null {
  const cents = readPiecePrice(pricing.onePrice);
  return cents === null || Number.isNaN(cents) ? null : cents;
}

/** A saved line's pieces as the one rule reads them. */
export function storedPiecePrices(line: unknown): StoredPiecePrice[] {
  return linePieces(line).map((piece) => ({ id: piece.id, priceCents: piece.priceCents }));
}

/** The saved pieces' prices added up: null when none has one. */
export function storedPiecesTotalCents(stored: readonly StoredPiecePrice[] | null | undefined): number | null {
  const prices = (stored ?? []).map((piece) => piece.priceCents);
  if (prices.every((cents) => cents === null)) return null;
  return prices.reduce<number>((sum, cents) => sum + (cents ?? 0), 0);
}

/**
 * The price field a saved package opens on: the sum of its pieces' prices,
 * blank when none has one (a car has no pieces to price).
 */
export function onePriceFromLine(line: unknown): string {
  const row = line && typeof line === "object" ? (line as Record<string, unknown>) : {};
  if (text(row.kind, 20) === "car") return "";
  const prices = storedPiecePrices(row).map((piece) => piece.priceCents);
  if (prices.every((cents) => cents === null)) return "";
  return centsToInput(prices.reduce<number>((sum, cents) => sum + (cents ?? 0), 0));
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
 * `piecePriceRequiredErrors`: a row with no price typed is its own
 * `piece_price_required` (whether its price is for each piece or for all of
 * them), and pieces that all come to $0 are `package_price_required` (the
 * package's, not one row's). As on the server, a price typed wrong keeps its
 * own error and adds no "required" on top.
 */
export function pieceDraftProblems(
  drafts: readonly PieceDraft[],
  options: { priceRequired?: boolean; pricing?: PiecePricing } = {},
): PieceDraftProblems {
  const list = Array.isArray(drafts) ? drafts : [];
  if (list.length === 0) return { codes: ["pieces_required"], byPiece: [] };
  const codes = new Set<PieceDraftCode>();
  if (piecesDraftCount(list) > MAX_PIECES) codes.add("pieces_too_many");
  const byPiece: PieceDraftCode[][] = list.map((draft) => readPiece(draft, !!options.pricing).problems);
  for (const own of byPiece) own.forEach((code) => codes.add(code));
  if (options.pricing) {
    // One price for the whole package: shown at its own field. A customer's
    // package needs more than $0; the business's own stock may have none.
    const typed = readPiecePrice(options.pricing.onePrice);
    if (typed !== null && Number.isNaN(typed)) codes.add("piece_price_invalid");
    else if (options.priceRequired && (typed === null || typed <= 0)) codes.add("package_price_required");
    return { codes: [...codes], byPiece };
  }
  if (options.priceRequired && !codes.has("piece_price_invalid")) {
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
export function piecesDraftTotalCents(drafts: readonly PieceDraft[], pickupFeeCents = 0, pricing?: PiecePricing): number | null {
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
 * description, size or price; ids aside). A legacy line saved unchanged is
 * sent in its old form, so an edit to its contacts does not rewrite it.
 */
export function piecesDifferFromLine(line: unknown, drafts: readonly PieceDraft[], pricing?: PiecePricing): boolean {
  const shape = (p: { kind: string; description: string; sizeIn: PieceSize | null; priceCents: number | null }) =>
    JSON.stringify([p.kind, p.description, p.sizeIn ? [p.sizeIn.l, p.sizeIn.w, p.sizeIn.h] : null, p.priceCents]);
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
 * A row's price switch flipped: the number typed stays as it is and only
 * what it stands for changes (the price of each piece, or of all the row's
 * pieces together). Staff type the amount and then say what it is for, in
 * either order; the line under the row shows at once what it comes to.
 */
export function setPieceDraftPriceFor(drafts: readonly PieceDraft[], key: string, priceFor: PriceFor): PieceDraft[] {
  return drafts.map((draft) => (draft.key === key ? { ...draft, priceFor } : draft));
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
    priceForAria: "What this row's price is for",
    each: "Each piece",
    priceEach: "Price each ($)",
    yes: "Yes",
    no: "No",
  },
  fr: {
    howMany: "Combien",
    fewer: "Un de moins",
    more: "Un de plus",
    priceForAria: "Ce que couvre le prix de cette ligne",
    each: "Par colis",
    priceEach: "Prix par colis ($)",
    yes: "Oui",
    no: "Non",
  },
} as const;

export type PiecesEditorTextKey = keyof (typeof EDITOR_TEXT)["en"];

export function piecesEditorText(key: PiecesEditorTextKey, lang: Lang = "en"): string {
  return EDITOR_TEXT[lang === "fr" ? "fr" : "en"][key];
}

/** The other side of a row's price switch: "All 3 together" / "Les 3 ensemble". */
export function priceTogetherText(count: number, lang: Lang = "en"): string {
  return lang === "fr" ? `Les ${count} ensemble` : `All ${count} together`;
}

/** The price field of a row priced all together: "Price for all 3 ($)" / "Prix pour les 3 ($)". */
export function priceForAllLabel(count: number, lang: Lang = "en"): string {
  return lang === "fr" ? `Prix pour les ${count} ($)` : `Price for all ${count} ($)`;
}

/**
 * Under a row of several, what its price comes to. Priced each:
 * "3 × $45.00 = $135.00". Priced all together: "$50.00 each", or
 * "2 at $66.67, 1 at $66.66" when the amount does not divide. "" for one
 * piece or no readable price.
 */
export function pieceRowSumText(draft: PieceDraft, lang: Lang = "en"): string {
  const count = pieceDraftCount(draft);
  const cents = readPiecePrice(draft.price);
  if (count < 2 || cents === null || Number.isNaN(cents)) return "";
  const fr = lang === "fr";
  const money = (value: number) => (fr ? moneyText(value, "fr") : moneyText(value));
  if (!pieceDraftPricedTogether(draft)) return `${count} \u00d7 ${money(cents)} = ${money(cents * count)}`;
  const shares = distributeCents(cents, count) as number[];
  const high = shares.filter((value) => value === shares[0]).length;
  if (high === count) return fr ? `${money(shares[0])} chacun` : `${money(shares[0])} each`;
  const low = shares[count - 1];
  return fr
    ? `${high} \u00e0 ${money(shares[0])}, ${count - high} \u00e0 ${money(low)}`
    : `${high} at ${money(shares[0])}, ${count - high} at ${money(low)}`;
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

// ---------------------------------------------------------------------------
// One price for the whole package: the words (docs/PACKAGE_ONE_PRICE.md).
// ---------------------------------------------------------------------------

/** The price field's label: "Price for everything ($)" / "Prix pour le tout ($)". */
export function onePriceLabel(lang: Lang = "en"): string {
  return lang === "fr" ? "Prix pour le tout ($)" : "Price for everything ($)";
}

/** Under the label: "3 pieces, one price" / "3 pièces, un seul prix"; one piece is "1 piece" / "1 pièce". */
export function onePriceCountText(count: number, lang: Lang = "en"): string {
  const n = Math.max(1, Math.floor(Number(count) || 1));
  if (lang === "fr") return `${n} ${n === 1 ? "pièce" : "pièces"}, un seul prix`;
  return `${n} ${n === 1 ? "piece" : "pieces"}, one price`;
}

/**
 * When the number of pieces differs from what is saved and a price is typed:
 * "You added 1 piece. Still $300.00 for all 4? Change it here if not." /
 * "You removed 1 piece. Still $300.00 for the 2 left? Change it here if
 * not."; "" when the count is the same, nothing is saved yet or no price is
 * typed - or, given the saved package's price, once another price is typed.
 * The money is in the language's format (the console's one formatter).
 */
export function onePriceChangeNote(
  storedCount: number | undefined,
  count: number,
  priceCents: number | null,
  lang: Lang = "en",
  storedPriceCents?: number | null,
): string {
  if (storedCount === undefined || !(storedCount > 0) || storedCount === count || priceCents === null) return "";
  // The question is "still the same price?": once staff typed another price
  // they have answered it (seen in the browser check, 2026-11-23).
  if (typeof storedPriceCents === "number" && storedPriceCents !== priceCents) return "";
  const fr = lang === "fr";
  const money = moneyText(priceCents, fr ? "fr" : "en");
  if (count > storedCount) {
    const added = count - storedCount;
    return fr
      ? `Vous avez ajouté ${added} ${added === 1 ? "pièce" : "pièces"}. Toujours ${money} pour les ${count} ? Sinon, modifiez-le ici.`
      : `You added ${added} ${added === 1 ? "piece" : "pieces"}. Still ${money} for all ${count}? Change it here if not.`;
  }
  const removed = storedCount - count;
  if (fr) {
    const left = count === 1 ? "la pièce restante" : `les ${count} restantes`;
    return `Vous avez retiré ${removed} ${removed === 1 ? "pièce" : "pièces"}. Toujours ${money} pour ${left} ? Sinon, modifiez-le ici.`;
  }
  const left = count === 1 ? "the piece left" : `the ${count} left`;
  return `You removed ${removed} ${removed === 1 ? "piece" : "pieces"}. Still ${money} for ${left}? Change it here if not.`;
}
