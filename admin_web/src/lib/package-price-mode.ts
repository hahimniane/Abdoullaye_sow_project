/**
 * How a business prices a package (docs/PACKAGE_ONE_PRICE.md): a price on each
 * row of pieces (`piece`, the default), or ONE price for the whole package
 * (`package`), shared equally among the pieces behind the form so every
 * reader of piece prices keeps working on the same numbers.
 *
 * Mirrors `functions/package_price_mode.js`; the shared cases in
 * `functions/test/fixtures/package-price-cases.json` run here too. Pure: no
 * React, no Firebase.
 */

import { distributeCents } from "./line-pieces.ts";

export const PRICE_MODE = { PIECE: "piece", PACKAGE: "package" } as const;
export type PriceMode = (typeof PRICE_MODE)[keyof typeof PRICE_MODE];

/** The business's choice (`packagePriceSettings.mode`); anything missing or unknown is `piece`. */
export function packagePriceModeOf(business: unknown): PriceMode {
  const row = business && typeof business === "object" ? (business as Record<string, unknown>) : {};
  const settings = row.packagePriceSettings && typeof row.packagePriceSettings === "object"
    ? (row.packagePriceSettings as Record<string, unknown>)
    : {};
  return settings.mode === PRICE_MODE.PACKAGE ? PRICE_MODE.PACKAGE : PRICE_MODE.PIECE;
}

/** A piece as saved, as far as the one price needs it. */
export type StoredPiecePrice = { id: string; priceCents: number | null };

const wholeCents = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

/**
 * Each piece's price when one price was typed for the whole package: the
 * total shared equally in order (odd cents on the first ones), except that a
 * package saved with the very same pieces (ids, order, each priced) and the
 * very same total keeps its stored prices untouched. No usable total (blank,
 * not whole cents, negative): every piece null. Same rule as the server's.
 */
export function packagePiecePrices(
  totalCents: number | null,
  ids: readonly string[],
  stored: readonly StoredPiecePrice[] | null = null,
): Array<number | null> {
  const list = Array.isArray(ids) ? ids.map((id) => String(id ?? "")) : [];
  if (list.length === 0) return [];
  if (!wholeCents(totalCents)) return list.map(() => null);
  const saved = Array.isArray(stored) ? stored : [];
  const same =
    saved.length === list.length &&
    saved.every((piece, i) => list[i] !== "" && String(piece?.id ?? "") === list[i] && wholeCents(piece?.priceCents));
  if (same && saved.reduce((sum, piece) => sum + (piece.priceCents as number), 0) === totalCents) {
    return saved.map((piece) => piece.priceCents);
  }
  return distributeCents(totalCents, list.length);
}

// ---------------------------------------------------------------------------
// The setting's words (the radio pair beside "Package receipts").
// ---------------------------------------------------------------------------

export const PRICE_MODE_OPTIONS: ReadonlyArray<{ value: PriceMode; label: string }> = [
  { value: PRICE_MODE.PIECE, label: "A price for each item" },
  { value: PRICE_MODE.PACKAGE, label: "One price for the whole package" },
];

export const PRICE_MODE_HINT =
  "With one price, staff type a single amount for everything the customer drops off. It is shared equally among the pieces.";
