/**
 * What is inside one box, as a list instead of a single pick.
 *
 * Mirror of my_flutter_app/functions/freight_contents.js - the server is
 * the authority on both validation and price; this module exists so the
 * form can refuse junk before a round trip and show the same estimate the
 * server will charge. The declaration stores FACTS and never a price: each
 * business reads it through its own catalogue.
 */

import {
  STANDARD_FREIGHT_CATEGORIES,
} from "./freight-categories.ts";
import {
  freightItemPricing,
  type PaybackTable,
} from "./freight-payback.ts";

export const MAX_CONTENT_ITEMS = 10;
export const MAX_ITEM_QUANTITY = 99;
export const MAX_CONTENT_LABEL_LENGTH = 60;

export type ContentsItem = {
  categoryId: string;
  itemId: string;
  label: string;
  quantity: number;
};

export type FreightContents = {
  items: ContentsItem[];
  otherGoodsKg: number;
  otherCategoryId: string;
  totalWeightKg: number;
};

const CATEGORY_IDS = new Set<string>(
  STANDARD_FREIGHT_CATEGORIES.map((category) => category.id),
);

export function hasDeclaredContents(contents: FreightContents) {
  return contents.items.length > 0 || contents.otherGoodsKg > 0;
}

/** The callable fields a declaration travels as. */
export function contentsPayloadFields(contents: FreightContents) {
  if (!hasDeclaredContents(contents)) return {};
  return {
    ...(contents.items.length > 0 && {
      contentsItems: contents.items.map((item) => ({
        categoryId: item.categoryId,
        itemId: item.itemId,
        label: item.label,
        quantity: item.quantity,
      })),
    }),
    ...(contents.otherGoodsKg > 0 && {
      otherGoodsKg: contents.otherGoodsKg,
      otherCategoryId: contents.otherCategoryId || "general",
    }),
    ...(contents.totalWeightKg > 0 && {
      totalWeightKg: contents.totalWeightKg,
    }),
  };
}

/** Client-side sanity so a bad row is named beside the row, not after a
 * round trip. The server re-validates everything. */
export function contentsProblem(contents: FreightContents): string | null {
  if (contents.items.length > MAX_CONTENT_ITEMS) {
    return "List at most 10 kinds of item in one box.";
  }
  for (const item of contents.items) {
    if (!CATEGORY_IDS.has(item.categoryId)) {
      return "Pick each item's category from the list.";
    }
    if (!item.label.trim() || item.label.length > MAX_CONTENT_LABEL_LENGTH) {
      return "Name each item in under 60 characters.";
    }
    if (
      !Number.isInteger(item.quantity) ||
      item.quantity < 1 ||
      item.quantity > MAX_ITEM_QUANTITY
    ) {
      return "Item counts must be between 1 and 99.";
    }
  }
  return null;
}

export type ContentsPricedLine = ContentsItem & {
  unitPriceCents: number;
  lineCents: number;
  includedKg: number;
};

export type ContentsPricing =
  | {
      ok: true;
      lines: ContentsPricedLine[];
      flatCents: number;
      includedKg: number;
      weighedKg: number;
      weighedCents: number;
      estimateCents: number;
    }
  | {ok: false; error: string; itemLabel?: string};

/**
 * The declared box priced through ONE business's catalogue - the same rule
 * the server enforces: every listed item must carry a set price from this
 * business, everything else rides in the weighed bucket.
 */
export function priceContentsForBusiness({
  table,
  ratePerKgCents,
  multiplierFor,
  contents,
}: {
  table: PaybackTable | undefined;
  ratePerKgCents: number;
  multiplierFor: (categoryId: string) => number;
  contents: FreightContents;
}): ContentsPricing {
  if (!Number.isFinite(ratePerKgCents) || ratePerKgCents <= 0) {
    return {ok: false, error: "route_rate_missing"};
  }
  const lines: ContentsPricedLine[] = [];
  let flatCents = 0;
  let includedKg = 0;
  for (const item of contents.items) {
    const pricing = freightItemPricing({
      table,
      categoryId: item.categoryId,
      itemId: item.itemId,
    });
    if (!pricing.priced) {
      return {ok: false, error: "contents_item_unpriced", itemLabel: item.label};
    }
    if (pricing.mode !== "flat") {
      return {ok: false, error: "contents_item_weighed", itemLabel: item.label};
    }
    const unitPriceCents = Math.round(pricing.flatPrice * 100);
    const lineCents = unitPriceCents * item.quantity;
    const lineIncludedKg = pricing.includedKg * item.quantity;
    flatCents += lineCents;
    includedKg += lineIncludedKg;
    lines.push({...item, unitPriceCents, lineCents, includedKg: lineIncludedKg});
  }
  const weighedKg = contents.otherGoodsKg;
  const multiplier =
    weighedKg > 0 ? multiplierFor(contents.otherCategoryId) || 1 : 1;
  const weighedCents =
    weighedKg > 0 ? Math.round(weighedKg * ratePerKgCents * multiplier) : 0;
  if (flatCents + weighedCents <= 0) {
    return {ok: false, error: "contents_empty"};
  }
  return {
    ok: true,
    lines,
    flatCents,
    includedKg: Math.round(includedKg * 1000) / 1000,
    weighedKg,
    weighedCents,
    estimateCents: flatCents + weighedCents,
  };
}

/** One line saying what is in the box. */
export function contentsSummary(contents: FreightContents) {
  const parts = contents.items.map(
    (item) => `${item.quantity} × ${item.label}`,
  );
  if (contents.otherGoodsKg > 0) {
    parts.push(`${contents.otherGoodsKg} kg other goods`);
  }
  return parts.join(", ");
}

/** A stored request's contents, read tolerantly off a Firestore row. */
export function contentsFromRecord(raw: unknown): FreightContents | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const itemsRaw = Array.isArray(record.items) ? record.items : [];
  const items: ContentsItem[] = [];
  for (const entry of itemsRaw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const quantity = Number(row.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) continue;
    items.push({
      categoryId: String(row.categoryId ?? ""),
      itemId: String(row.itemId ?? ""),
      label: String(row.label ?? ""),
      quantity,
    });
  }
  const otherGoodsKg = Number(record.otherGoodsKg) || 0;
  if (items.length === 0 && otherGoodsKg <= 0) return null;
  return {
    items,
    otherGoodsKg,
    otherCategoryId: String(record.otherCategoryId ?? ""),
    totalWeightKg: Number(record.totalWeightKg) || 0,
  };
}

export type QuoteLensLine = {
  label: string;
  quantity: number;
  hint: string;
  lineCents: number | null;
};

export type QuoteLens = {
  lines: QuoteLensLine[];
  weighedNote: string;
  suggestionCents: number | null;
};

/**
 * The SAME request through one business's price list, leniently: an item
 * this business weighs or never priced is a note beside the row, not an
 * error - the business is here precisely to put a number on the box. The
 * suggestion is arithmetic from their own catalogue and always editable.
 */
export function quoteLensForBusiness({
  table,
  ratePerKgCents,
  multiplierFor,
  contents,
}: {
  table: PaybackTable | undefined;
  ratePerKgCents: number;
  multiplierFor: (categoryId: string) => number;
  contents: FreightContents;
}): QuoteLens {
  const lines: QuoteLensLine[] = [];
  let flatCents = 0;
  let includedKg = 0;
  let anyNonFlat = false;
  for (const item of contents.items) {
    const pricing = freightItemPricing({
      table,
      categoryId: item.categoryId,
      itemId: item.itemId,
    });
    if (pricing.priced && pricing.mode === "flat") {
      const lineCents = Math.round(pricing.flatPrice * 100) * item.quantity;
      flatCents += lineCents;
      includedKg += pricing.includedKg * item.quantity;
      lines.push({
        label: item.label,
        quantity: item.quantity,
        hint: `your price × ${item.quantity}`,
        lineCents,
      });
    } else {
      anyNonFlat = true;
      lines.push({
        label: item.label,
        quantity: item.quantity,
        hint: pricing.priced ? "weighed with the rest" : "no price set",
        lineCents: null,
      });
    }
  }
  const rate = Number(ratePerKgCents) || 0;
  const multiplier =
    contents.otherGoodsKg > 0 || anyNonFlat
      ? multiplierFor(contents.otherCategoryId || "general") || 1
      : 1;
  let weighedKg = 0;
  let weighedNote = "";
  let suggestionCents: number | null = null;
  if (!anyNonFlat) {
    weighedKg = contents.otherGoodsKg;
    if (rate > 0 && (flatCents > 0 || weighedKg > 0)) {
      suggestionCents =
        flatCents + Math.round(weighedKg * rate * multiplier);
    }
  } else if (contents.totalWeightKg > 0 && rate > 0) {
    weighedKg = Math.max(
      contents.otherGoodsKg,
      Math.round((contents.totalWeightKg - includedKg) * 1000) / 1000,
    );
    suggestionCents = flatCents + Math.round(weighedKg * rate * multiplier);
  }
  if (contents.otherGoodsKg > 0 || anyNonFlat) {
    weighedNote =
      weighedKg > 0
        ? `${weighedKg} kg weighed at your rate`
        : "weighed goods - no weight given";
  }
  return {lines, weighedNote, suggestionCents};
}
