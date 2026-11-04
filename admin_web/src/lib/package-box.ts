/**
 * Box sizes on the web (docs/PACKAGE_BOX_SIZES_PAY_NOW.md sections 1, 2 and
 * 4): the size names, pictures and examples, a box line in the customer's
 * basket, the price badge ("Medium · $35"), and how a request's box piece is
 * read back for the request page and the business.
 *
 * The rules themselves (which size typed inches fall in, what a size costs)
 * are `package-price-list.ts`, the mirror of the server's
 * `package_price_list.js`; this module only adds what a screen needs. Pure:
 * no React, no Firebase. `package-box.test.ts` runs it.
 *
 * Words built from data (a name, a price, inches) are produced here in the
 * page's language and rendered `data-no-translate`; static strings live in the
 * components and french-dom.ts.
 */

import { dimsOf, dimsText, type Dims } from "./box-designer.ts";
import { BOX_LABELS, BOX_PRICED_IDS as PRICED_IDS, BOX_SIZES, LIMIT, boxSizeFor, type BoxSize, type BoxSizeId } from "./package-price-list.ts";
import { moneyText, type Lang, type PhotoDraft } from "./package-requests.ts";

export type { BoxSizeId };

const SPECS: readonly BoxSize[] = BOX_SIZES;

export const BOX_SIZE_IDS: readonly BoxSizeId[] = SPECS.map((spec) => spec.id);
/** The sizes a business prices: Extra large is always quoted. */
export const BOX_PRICED_IDS: readonly BoxSizeId[] = PRICED_IDS;
/** Photos on one box line (the website and the app). */
export const BOX_PHOTO_LIMIT = 3;
export const DEFAULT_BOX_SIZE: BoxSizeId = "medium";

export type BoxPrices = Partial<Record<BoxSizeId, number>>;

const specOf = (id: string): BoxSize | null => SPECS.find((spec) => spec.id === id) ?? null;

export function isBoxSizeId(value: unknown): value is BoxSizeId {
  return BOX_SIZE_IDS.includes(value as BoxSizeId);
}

/** "Medium" / "Moyenne". */
export function boxSizeName(id: string, lang: Lang): string {
  const spec = specOf(id);
  return spec ? (lang === "fr" ? spec.fr : spec.en) : "";
}

/** "About a microwave box" / "Environ un carton de micro-ondes". */
export function boxSizeExample(id: string, lang: Lang): string {
  const spec = specOf(id);
  return spec ? (lang === "fr" ? spec.exampleFr : spec.exampleEn) : "";
}

/** "Up to 24 × 18 × 18 in" / "Jusqu’à 24 × 18 × 18 po"; Extra large is "Bigger than Large". */
export function boxSizeLimit(id: string, lang: Lang): string {
  const spec = specOf(id);
  if (!spec) return "";
  if (!spec.maxIn) return lang === "fr" ? "Plus grande que Grande" : "Bigger than Large";
  const [l, w, h] = spec.maxIn;
  return `${lang === "fr" ? "Jusqu’à" : "Up to"} ${dimsText({ l, w, h }, lang)}`;
}

/** The picture of a size, drawn once for the app, the website and WhatsApp. */
export function boxPicture(id: string): string {
  return `/box-sizes/${isBoxSizeId(id) ? id : "medium"}.svg`;
}

/** The size typed inches fall in (the shared rule: turned any way, 1 inch of slack), or null. */
export function sizeForDims(dims: Dims | null): BoxSizeId | null {
  if (!dims) return null;
  const id = boxSizeFor(dims);
  return isBoxSizeId(id) ? id : null;
}

/** Inches a size's picture roughly stands for: where the designer opens when someone taps "Know the inches?". */
const TYPICAL_DIMS: Readonly<Record<BoxSizeId, Dims>> = Object.freeze({
  small: { l: 14, w: 10, h: 8 },
  medium: { l: 20, w: 16, h: 14 },
  large: { l: 28, w: 22, h: 20 },
  xl: { l: 36, w: 28, h: 28 },
});

export function typicalDims(id: BoxSizeId): Dims {
  return { ...TYPICAL_DIMS[id] };
}

// ---------------------------------------------------------------------------
// Prices.
// ---------------------------------------------------------------------------

/** What one business charges per size (a route's `boxPricesCents`), whole cents, priced sizes only. */
export function boxPricesOf(route: { boxPricesCents?: unknown } | null | undefined): BoxPrices {
  const raw = route?.boxPricesCents;
  const out: BoxPrices = {};
  if (!raw || typeof raw !== "object") return out;
  for (const id of BOX_PRICED_IDS) {
    const cents = (raw as Record<string, unknown>)[id];
    if (Number.isInteger(cents) && (cents as number) > 0) out[id] = cents as number;
  }
  return out;
}

/** The lowest price for each size among several businesses (while comparing: "from $X"). */
export function lowestBoxPrices(routes: readonly ({ boxPricesCents?: unknown } | null | undefined)[]): BoxPrices {
  const out: BoxPrices = {};
  for (const route of routes) {
    const prices = boxPricesOf(route);
    for (const id of BOX_PRICED_IDS) {
      const cents = prices[id];
      if (cents !== undefined && (out[id] === undefined || cents < (out[id] as number))) out[id] = cents;
    }
  }
  return out;
}

/** What a card says under a size nobody priced (always Extra large): "Quoted" / "Sur devis". */
export function quotedText(lang: Lang): string {
  return lang === "fr" ? "Sur devis" : "Quoted";
}

/** The price field's name for a screen reader: "Medium box, price in dollars". */
export function boxPriceFieldLabel(id: string, lang: Lang): string {
  return `${boxSizeLabel(id, lang)}, ${lang === "fr" ? "prix en dollars" : "price in dollars"}`;
}

/** "$35" for whole dollars, "$35.50" otherwise ("35 $" / "35,50 $" in French). */
export function shortMoney(cents: number, lang: Lang): string {
  return moneyText(cents, lang).replace(/[.,]00(?!\d)/, "");
}

export type BoxBadge = {
  size: BoxSizeId;
  name: string;
  /** price: this business's price; from: the lowest while comparing; quote: the business sets it; plain: no price to show. */
  kind: "price" | "from" | "quote" | "plain";
  cents: number | null;
  text: string;
};

/**
 * The badge over the box: "Medium · $35" at one business, "Medium · from $30"
 * while comparing, "Extra large · the business will quote" when the size is
 * never priced (or this business did not price it).
 */
export function boxBadge(input: { size: BoxSizeId | null; prices?: BoxPrices | null; comparing?: boolean; lang: Lang }): BoxBadge | null {
  const { size, prices, comparing = false, lang } = input;
  if (!size) return null;
  const name = boxSizeName(size, lang);
  const fr = lang === "fr";
  const quote = fr ? "l’entreprise vous fera un prix" : "the business will quote";
  const cents = size === "xl" || !prices ? null : prices[size] ?? null;
  if (size === "xl") return { size, name, kind: "quote", cents: null, text: `${name} · ${quote}` };
  if (!prices) return { size, name, kind: "plain", cents: null, text: name };
  if (cents === null) return { size, name, kind: "quote", cents: null, text: `${name} · ${quote}` };
  if (comparing) return { size, name, kind: "from", cents, text: `${name} · ${fr ? "dès" : "from"} ${shortMoney(cents, lang)}` };
  return { size, name, kind: "price", cents, text: `${name} · ${shortMoney(cents, lang)}` };
}

// ---------------------------------------------------------------------------
// A box line in the customer's basket.
// ---------------------------------------------------------------------------

export type BoxLine = {
  key: string;
  type: "box";
  /** The size picked on a picture card; typed inches (`dims`) win over it. */
  boxSize: BoxSizeId;
  dims: Dims | null;
  quantity: number;
  photos: PhotoDraft[];
};

export function newBoxLine(key: string): BoxLine {
  return { key, type: "box", boxSize: DEFAULT_BOX_SIZE, dims: null, quantity: 1, photos: [] };
}

/** The size the line is: what its inches say, else the card picked. */
export function boxLineSize(line: Pick<BoxLine, "boxSize" | "dims">): BoxSizeId {
  return sizeForDims(line.dims) ?? line.boxSize;
}

/** Picking a card clears the inches: the size is the customer's own choice again. */
export function pickBoxSize(line: BoxLine, size: BoxSizeId): BoxLine {
  return isBoxSizeId(size) ? { ...line, boxSize: size, dims: null } : line;
}

/** Typing or sliding inches: the size follows them; null forgets the inches and keeps the size they gave. */
export function setBoxDims(line: BoxLine, dims: Dims | null): BoxLine {
  if (!dims) return { ...line, dims: null };
  return { ...line, dims, boxSize: sizeForDims(dims) ?? line.boxSize };
}

export function setBoxQuantity(line: BoxLine, quantity: number): BoxLine {
  const n = Math.max(1, Math.min(LIMIT.QUANTITY, Math.floor(Number(quantity) || 1)));
  return { ...line, quantity: n };
}

/** What is wrong with a box line, as the server's codes. */
export function boxLineProblems(line: BoxLine): string[] {
  const errors: string[] = [];
  const add = (code: string) => {
    if (!errors.includes(code)) errors.push(code);
  };
  if (!isBoxSizeId(line.boxSize) && !line.dims) add("box_size_invalid");
  if (!(Number.isInteger(line.quantity) && line.quantity >= 1 && line.quantity <= LIMIT.QUANTITY)) add("quantity_invalid");
  if (line.photos.length > BOX_PHOTO_LIMIT) add("too_many_photos");
  if (line.photos.some((photo) => photo.status === "error")) add("photo_invalid");
  return errors;
}

/** The piece `submitPackageRequest` takes: `{kind: "box", boxSize, dimsIn?, quantity, photoPaths?}`. */
export function boxPieceFor(line: BoxLine): {
  kind: "box";
  boxSize: BoxSizeId;
  dimsIn?: Dims;
  quantity: number;
  photoPaths?: string[];
} {
  const paths = line.photos.filter((photo) => photo.status === "ready" && photo.path).map((photo) => photo.path);
  return {
    kind: "box",
    boxSize: boxLineSize(line),
    ...(line.dims ? { dimsIn: line.dims } : {}),
    quantity: line.quantity,
    ...(paths.length ? { photoPaths: paths } : {}),
  };
}

/** "2 × Medium box" / "2 × Boîte moyenne": a box line named for the sent screen and the summary. */
export function boxLineText(line: Pick<BoxLine, "boxSize" | "dims" | "quantity">, lang: Lang): string {
  const name = boxSizeLabel(boxLineSize(line), lang);
  return line.quantity > 1 ? `${line.quantity} × ${name}` : name;
}

/** "Medium box" / "Boîte moyenne": the same words the server stores on the piece. */
export function boxSizeLabel(id: string, lang: Lang): string {
  return isBoxSizeId(id) ? BOX_LABELS[id][lang === "fr" ? "fr" : "en"] : "";
}

// ---------------------------------------------------------------------------
// A request's box piece, read back (the request page and the business).
// ---------------------------------------------------------------------------

export type RequestBox = {
  size: BoxSizeId;
  /** "Medium box". */
  label: string;
  dims: Dims | null;
  quantity: number;
};

/** The box a stored or public request piece describes, or null when it is not a sized box. */
export function requestBoxOf(piece: unknown, lang: Lang): RequestBox | null {
  if (!piece || typeof piece !== "object") return null;
  const row = piece as Record<string, unknown>;
  const price = row.price && typeof row.price === "object" ? (row.price as Record<string, unknown>) : {};
  const size = String(row.boxSize ?? price.boxSize ?? "");
  if (!isBoxSizeId(size)) return null;
  const fromPrice = Number(price.quantity);
  const fromText = /^(\d{1,2}) ×/.exec(String(row.description ?? ""));
  const quantity = Number.isInteger(fromPrice) && fromPrice >= 1 ? fromPrice : fromText ? Number(fromText[1]) : 1;
  return { size, label: boxSizeLabel(size, lang), dims: dimsOf(row.dimsIn), quantity };
}

/** "Medium box · 20 × 16 × 14 in" (the inches only when the customer typed them). */
export function requestBoxText(box: RequestBox, lang: Lang): string {
  const label = boxSizeLabel(box.size, lang);
  const name = box.quantity > 1 ? `${box.quantity} × ${label}` : label;
  return box.dims ? `${name} · ${dimsText(box.dims, lang)}` : name;
}
