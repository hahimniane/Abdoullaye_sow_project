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
  linePieces,
  lineTotalCents,
  pieceErrors,
  type PieceErrorCode,
  type PieceKind,
  type PieceSize,
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
};

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
  return { key: freshKey(), id: "", kind, description: "", lengthIn: "", widthIn: "", heightIn: "", price: "" };
}

/** 12 -> "12", 12.5 -> "12.5". */
function trimNumber(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/**
 * A stored line's pieces back into the editor, ids kept so an edit keeps its
 * pieces. A legacy line reads through `linePieces` (its count expanded, its
 * price spread). A car has no pieces to edit: one blank barrel.
 */
export function pieceDraftsFromLine(line: unknown): PieceDraft[] {
  const row = line && typeof line === "object" ? (line as Record<string, unknown>) : {};
  if (text(row.kind, 20) === "car") return [newPieceDraft()];
  return linePieces(row).map((piece) => ({
    key: freshKey(),
    id: piece.id,
    kind: piece.kind === "car" ? "other" : piece.kind,
    description: piece.description,
    lengthIn: piece.sizeIn ? trimNumber(piece.sizeIn.l) : "",
    widthIn: piece.sizeIn ? trimNumber(piece.sizeIn.w) : "",
    heightIn: piece.sizeIn ? trimNumber(piece.sizeIn.h) : "",
    price: piece.priceCents === null ? "" : centsToInput(piece.priceCents),
  }));
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

function readPiece(draft: PieceDraft): ReadPiece {
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
  const cents = readPiecePrice(draft.price);
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

/** The `pieces` a request sends, in the order typed. */
export function piecesPayload(drafts: readonly PieceDraft[]): PiecePayload[] {
  return drafts.map((draft) => readPiece(draft).payload);
}

export type PieceDraftProblems = {
  /** Every problem once, as the server names it. */
  codes: PieceErrorCode[];
  /** Each piece's own problems, in the order shown. */
  byPiece: PieceErrorCode[][];
};

/** The server's `pieceErrors` (1-60 pieces), plus what typing can get wrong, per piece. */
export function pieceDraftProblems(drafts: readonly PieceDraft[]): PieceDraftProblems {
  const list = Array.isArray(drafts) ? drafts : [];
  if (list.length === 0) return { codes: ["pieces_required"], byPiece: [] };
  const codes = new Set<PieceErrorCode>();
  if (list.length > MAX_PIECES) codes.add("pieces_too_many");
  const byPiece = list.map((draft) => readPiece(draft).problems);
  for (const own of byPiece) own.forEach((code) => codes.add(code));
  return { codes: [...codes], byPiece };
}

/**
 * The line total the pieces add up to, plus the line's own pickup fee when it
 * has one (null while no piece is priced), as the server computes it
 * (`lineTotalCents`): the fee is never spread into the piece prices.
 */
export function piecesDraftTotalCents(drafts: readonly PieceDraft[], pickupFeeCents = 0): number | null {
  return lineTotalCents(piecesPayload(drafts), pickupFeeCents);
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
export function piecesDifferFromLine(line: unknown, drafts: readonly PieceDraft[]): boolean {
  const shape = (p: { kind: string; description: string; sizeIn: PieceSize | null; priceCents: number | null }) =>
    JSON.stringify([p.kind, p.description, p.sizeIn ? [p.sizeIn.l, p.sizeIn.w, p.sizeIn.h] : null, p.priceCents]);
  const stored = linePieces(line).map(shape);
  const typed = piecesPayload(drafts).map(shape);
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

// ---------------------------------------------------------------------------
// Words built per language (they carry a number, so the dictionary cannot).
// ---------------------------------------------------------------------------

/** "Piece 2" / "Colis 2". */
export function pieceHeading(index: number, lang: Lang = "en"): string {
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
  return lang === "fr" ? `Total : ${moneyText(cents)}` : `Total: ${moneyText(cents)}`;
}
