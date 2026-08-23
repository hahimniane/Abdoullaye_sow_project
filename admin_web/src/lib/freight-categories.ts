/**
 * What is in the parcel, and who stands behind it.
 *
 * Two separate questions, deliberately kept apart:
 *
 * - **Category** answers "what is it, will you carry it, what does a kilo of
 *   it cost". The platform owns the list so a customer can compare two
 *   businesses on the same words; the business sets what each row is worth to
 *   it.
 * - **Cover** answers "if you lose it, do you make me whole". One yes/no per
 *   business, and the amount is the business's own published payback for that
 *   item. Nothing is charged for it: a business already prices each item
 *   according to what it is worth to carry - which is why freight is priced
 *   per item at all - so the risk is inside the shipping rate, and a separate
 *   percentage billed the same risk twice.
 *
 * The platform is not the insurer: the business pays the customer back. This
 * module's job on the client is to mirror the server's arithmetic exactly, so
 * the number the customer reads before paying is the number they are charged,
 * and to refuse locally only what the server would also refuse (UI convention
 * 4: never show a control the server will reject).
 *
 * Everything here is pure. The server remains the authority - these functions
 * exist so the screen can explain the price, not so the client can set it.
 */

import {
  MAX_INCLUDED_KG,
  MAX_ITEM_FLAT_PRICE,
  type FreightPricingMode,
} from "./freight-payback.ts";
import type { FirestoreRow } from "@/types/admin";

/**
 * The rows every business has, in the order a customer sees them. Mirrors
 * functions/freight_categories.js - do not invent rows here, and do not
 * reorder: the order is the shared vocabulary customers compare with.
 */
export const STANDARD_FREIGHT_CATEGORIES = [
  {
    id: "general",
    label: "General goods",
    hint: "Household items, gifts, anything not listed below",
    defaultMultiplier: 1,
  },
  {
    id: "clothing",
    label: "Clothes and fabric",
    hint: "Clothing, shoes, cloth, bedding",
    defaultMultiplier: 1,
  },
  {
    id: "food",
    label: "Food",
    hint: "Dry and packaged food only",
    defaultMultiplier: 1,
  },
  {
    id: "documents",
    label: "Documents",
    hint: "Papers, certificates, printed matter",
    defaultMultiplier: 1,
  },
  {
    id: "cosmetics",
    label: "Cosmetics and liquids",
    hint: "Creams, perfumes, hair products",
    defaultMultiplier: 1.2,
  },
  {
    id: "electronics",
    label: "Electronics",
    hint: "Phones, laptops, tablets, chargers",
    defaultMultiplier: 2,
  },
  {
    id: "fragile",
    label: "Fragile items",
    hint: "Glass, ceramics, anything breakable",
    defaultMultiplier: 1.5,
  },
] as const;

export const STANDARD_FREIGHT_CATEGORY_IDS: readonly string[] =
  STANDARD_FREIGHT_CATEGORIES.map((category) => category.id);

/** Nothing outside this band. A typo must not make a parcel free or absurd. */
export const MIN_CATEGORY_MULTIPLIER = 0.5;
export const MAX_CATEGORY_MULTIPLIER = 10;

/** A business may not drown the customer in choices. */
export const MAX_CUSTOM_FREIGHT_CATEGORIES = 6;

export type FreightCategoryOption = {
  id: string;
  label: string;
  hint: string;
  multiplier: number;
  custom: boolean;
};

/**
 * One question, one answer. Mirrors what `freightCoveragePolicy` sends from
 * functions/freight_coverage.js: a business either makes good on a parcel it
 * loses or it does not, and what it pays is its own published payback.
 */
export type FreightCoveragePolicy = {
  coversLoss: boolean;
};

/* -------------------------------------------------------------------------
 * Reading what the callable sent (customer side)
 * ---------------------------------------------------------------------- */

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function boundedMultiplier(value: unknown, fallback = 1): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(
    MAX_CATEGORY_MULTIPLIER,
    Math.max(MIN_CATEGORY_MULTIPLIER, parsed),
  );
}

/**
 * The category rows a business offers, as they arrive on a destination
 * option. An unreadable row is dropped rather than shown broken; a business
 * that does not offer freight simply has none.
 */
export function freightCategoryOptionsFrom(
  value: unknown,
): FreightCategoryOption[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const options: FreightCategoryOption[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const id = trimmedString(row.id).toLowerCase();
    const label = trimmedString(row.label);
    if (!id || !label || seen.has(id)) continue;
    seen.add(id);
    options.push({
      id,
      label,
      hint: trimmedString(row.hint),
      multiplier: boundedMultiplier(row.multiplier),
      custom: row.custom === true,
    });
  }
  return options;
}

/**
 * A business's loss policy, or null when it does not offer freight at all.
 *
 * Anything the document carries beyond the flag is ignored rather than
 * merged: the flag is the whole policy, and reading a second field would let
 * a stale document narrow a promise the business is making today.
 */
export function freightCoveragePolicyFrom(
  value: unknown,
): FreightCoveragePolicy | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  return { coversLoss: row.coversLoss === true };
}

/**
 * Which row to start on. "general" is the honest answer for most parcels and
 * nobody should have to hunt for it.
 */
export function defaultFreightCategoryId(
  options: readonly FreightCategoryOption[],
): string {
  if (options.length === 0) return "";
  const general = options.find((option) => option.id === "general");
  return (general ?? options[0]).id;
}

export function freightCategoryById(
  options: readonly FreightCategoryOption[],
  categoryId: string,
): FreightCategoryOption | null {
  const id = trimmedString(categoryId).toLowerCase();
  if (!id) return null;
  return options.find((option) => option.id === id) ?? null;
}

/**
 * What to multiply the per-kg rate by. An unknown or absent category resolves
 * to 1 - the price freight had before categories existed - so a stale screen
 * quotes what it always quoted rather than an error.
 */
export function freightCategoryMultiplier(
  options: readonly FreightCategoryOption[],
  categoryId: string,
): number {
  return freightCategoryById(options, categoryId)?.multiplier ?? 1;
}

/* -------------------------------------------------------------------------
 * The price, exactly as the server computes it
 * ---------------------------------------------------------------------- */

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export type FreightCategoryPricing = {
  baseRatePerKg: number;
  categoryRatePerKg: number;
  multiplier: number;
  /** What the parcel costs to ship, before pickup and coverage. */
  shippingSubtotal: number;
  /** What the category adds over general goods, for the reader to see. */
  categorySurcharge: number;
};

/**
 * The freight line of the bill for one category.
 *
 * The server computes `round(weight * ratePerKg * multiplier)`, so the same
 * rounding happens here rather than rounding the rate first - rounding twice
 * drifts by a cent on exactly the kind of parcel someone would complain about.
 */
export function freightCategoryPricing({
  baseRatePerKg,
  weightKg,
  multiplier,
}: {
  baseRatePerKg: unknown;
  weightKg: unknown;
  multiplier: unknown;
}): FreightCategoryPricing | null {
  const rate = finiteNumber(baseRatePerKg);
  const weight = finiteNumber(weightKg);
  const factor = boundedMultiplier(multiplier);
  if (rate <= 0 || weight <= 0) return null;
  const shippingSubtotal = roundMoney(weight * rate * factor);
  return {
    baseRatePerKg: rate,
    categoryRatePerKg: roundMoney(rate * factor),
    multiplier: factor,
    shippingSubtotal,
    categorySurcharge: roundMoney(shippingSubtotal - roundMoney(weight * rate)),
  };
}

/* -------------------------------------------------------------------------
 * Cover
 * ---------------------------------------------------------------------- */

/** "2" rather than "2.0", and "1.5" rather than "1.50". */
export function formatMultiplier(value: number): string {
  return `${Math.round(value * 100) / 100}`;
}

/**
 * The one line that lets a customer compare two businesses on protection
 * before choosing either. Money is formatted by the caller so this stays
 * pure and the customer's locale still decides how a dollar looks.
 *
 * Whether this business stands behind the parcel, in the sentence a
 * customer reads while it is still in the room. No amount: the business
 * that stands behind nothing is the thing worth knowing here, and a figure
 * on a card turns a rare event into a headline.
 */
export function freightCoverageComparisonLine(
  policy: FreightCoveragePolicy | null,
): string {
  if (!policy || !policy.coversLoss) {
    return "This business does not pay for a lost parcel";
  }
  // No figure. Losing a parcel is rare, and putting a number on the card
  // turns a reassurance into a headline - and into the number a customer
  // expects to argue over. What they need to know is whether this business
  // stands behind the parcel at all; the published amount is what settles a
  // claim on the rare day there is one.
  return "Pays you back if it is lost";
}

/* -------------------------------------------------------------------------
 * The business's own settings
 * ---------------------------------------------------------------------- */

export type FreightCustomCategoryDraft = {
  /** Empty on a row the business just added; derived from the name on save. */
  id: string;
  label: string;
  hint: string;
  multiplier: string;
};

/**
 * How the business charges for one row it carries.
 *
 * Empty is not "unanswered": it is every row saved before pricing moved onto
 * the row, and it keeps being charged at its category's factor. The editor
 * shows it as by-weight and, left alone, saves nothing - so no live price
 * moves the day this ships.
 */
export type FreightPaybackPricingMode = "" | "flat" | "per_kg";

export type FreightPaybackItemDraft = {
  id: string;
  label: string;
  amount: string;
  pricingMode: FreightPaybackPricingMode;
  /** What this item costs to carry, whatever it weighs. */
  flatPrice: string;
  /** How much weight the set price covers. Blank covers any weight. */
  includedKg: string;
};

export type FreightPaybackCategoryDraft = {
  items: FreightPaybackItemDraft[];
  otherAmount: string;
  otherPricingMode: FreightPaybackPricingMode;
  otherFlatPrice: string;
  otherIncludedKg: string;
};

export function emptyFreightPaybackItem(
  id = "",
  label = "",
): FreightPaybackItemDraft {
  return {
    id,
    label,
    amount: "0",
    pricingMode: "per_kg",
    flatPrice: "",
    includedKg: "",
  };
}

export function emptyFreightPaybackCategory(): FreightPaybackCategoryDraft {
  return {
    items: [],
    otherAmount: "0",
    otherPricingMode: "per_kg",
    otherFlatPrice: "",
    otherIncludedKg: "",
  };
}

export type FreightSettingsDraft = {
  /** Only the standard rows the business has actually moved. */
  categoryRates: Record<string, string>;
  customCategories: FreightCustomCategoryDraft[];
  /** Whether this business makes good on a parcel it loses. */
  coversLoss: boolean;
  /** What each item pays back if lost - the business's numbers, per row. */
  payback: Record<string, FreightPaybackCategoryDraft>;
  /**
   * Whether this business accepts being paid after the parcel reaches the
   * destination. Opting in shows customers a pay-on-arrival choice at
   * booking: the card is saved and verified up front, charged on arrival.
   */
  payOnArrival: boolean;
};

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function numberText(value: unknown, fallback = ""): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) && value !== null && value !== ""
    ? String(parsed)
    : fallback;
}

/**
 * An id for a category the business invented, from the name it typed.
 *
 * The business never sees an id, so the name is the identity. Deriving rather
 * than asking keeps one field off the form; an id already stored is kept, so
 * renaming a row does not silently orphan the shipments that reference it.
 */
export function freightCategorySlug(label: string): string {
  return trimmedString(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function freightSettingsFromRow(
  business?: FirestoreRow | null,
): FreightSettingsDraft {
  const rates = recordValue(business?.freightCategoryRates);
  const stored = Array.isArray(business?.freightCustomCategories)
    ? business.freightCustomCategories
    : [];
  return {
    categoryRates: Object.fromEntries(
      STANDARD_FREIGHT_CATEGORIES.map((category) => [
        category.id,
        numberText(
          rates[category.id],
          String(category.defaultMultiplier),
        ),
      ]),
    ),
    customCategories: stored
      .slice(0, MAX_CUSTOM_FREIGHT_CATEGORIES)
      .map((raw) => {
        const row = recordValue(raw);
        return {
          id: trimmedString(row.id).toLowerCase(),
          label: trimmedString(row.label),
          hint: trimmedString(row.hint),
          multiplier: numberText(row.multiplier, "1"),
        };
      }),
    coversLoss: business?.freightCoverageEnabled === true,
    payback: paybackDraftFrom(business?.freightPaybackTable),
    payOnArrival: business?.freightPayOnArrival === true,
  };
}

/**
 * The stored mode, or empty for a row that predates per-row pricing.
 *
 * Empty is carried through the form untouched so saving an untouched row
 * writes no pricing keys at all - the one guarantee that stops this from
 * repricing parcels a business already quoted.
 */
function pricingModeText(value: unknown): FreightPaybackPricingMode {
  const mode = trimmedString(value);
  return mode === "flat" || mode === "per_kg" ? mode : "";
}

function paybackDraftFrom(
  table: unknown,
): Record<string, FreightPaybackCategoryDraft> {
  const source = recordValue(table);
  const draft: Record<string, FreightPaybackCategoryDraft> = {};
  for (const [categoryId, raw] of Object.entries(source)) {
    const entry = recordValue(raw);
    const items = Array.isArray(entry.items) ? entry.items : [];
    draft[categoryId] = {
      items: items.map((item) => {
        const row = recordValue(item);
        return {
          id: trimmedString(row.id),
          label: trimmedString(row.label),
          amount: numberText(row.paybackAmount, "0"),
          pricingMode: pricingModeText(row.pricingMode),
          flatPrice: numberText(row.flatPrice, ""),
          includedKg: numberText(row.includedKg, ""),
        };
      }),
      otherAmount: numberText(entry.otherPaybackAmount, "0"),
      otherPricingMode: pricingModeText(entry.otherPricingMode),
      otherFlatPrice: numberText(entry.otherFlatPrice, ""),
      otherIncludedKg: numberText(entry.otherIncludedKg, ""),
    };
  }
  return draft;
}

export function emptyFreightCustomCategory(): FreightCustomCategoryDraft {
  return { id: "", label: "", hint: "", multiplier: "1" };
}

/** The id a row will be saved under. */
export function resolvedFreightCategoryId(
  row: FreightCustomCategoryDraft,
): string {
  return row.id.trim() || freightCategorySlug(row.label);
}

/**
 * The name of every category the payback editor can show a row under, so a
 * refusal names the row the owner is looking at rather than an id.
 */
function paybackCategoryLabels(
  draft: FreightSettingsDraft,
): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const category of STANDARD_FREIGHT_CATEGORIES) {
    labels[category.id] = category.label;
  }
  for (const row of draft.customCategories) {
    const id = resolvedFreightCategoryId(row);
    if (id) labels[id] = row.label.trim() || id;
  }
  return labels;
}

/** Blank is an answer here: it means "however heavy" or "whatever the
 * category charges", so it is checked separately from a typo. */
function blankNumber(value: string): boolean {
  return value.trim() === "";
}

/**
 * Refuses a priced row the callable would refuse, in the owner's own words.
 *
 * The bands are the server's (`freight_payback.js`): a set price above zero
 * and no higher than $10,000, and an allowance of at most 200 kg. A row
 * priced by weight states nothing to refuse - it is charged at this
 * business's own per-kg rate for the route.
 */
function paybackPricingError(draft: FreightSettingsDraft): string | null {
  const labels = paybackCategoryLabels(draft);
  for (const [categoryId, entry] of Object.entries(draft.payback)) {
    const categoryLabel = labels[categoryId] ?? categoryId;
    const rows: Array<{
      name: string;
      mode: FreightPaybackPricingMode;
      flatPrice: string;
      includedKg: string;
    }> = entry.items
      .filter((item) => item.label.trim())
      .map((item) => ({
        name: item.label.trim(),
        mode: item.pricingMode,
        flatPrice: item.flatPrice,
        includedKg: item.includedKg,
      }));
    // The catch-all only prices what it can also carry: a category that pays
    // back nothing for an unlisted item cannot be instant-booked at all.
    if ((Number(entry.otherAmount || 0) || 0) > 0) {
      rows.push({
        name: `${categoryLabel} · anything else`,
        mode: entry.otherPricingMode,
        flatPrice: entry.otherFlatPrice,
        includedKg: entry.otherIncludedKg,
      });
    }
    for (const row of rows) {
      if (row.mode === "flat") {
        const price = Number(row.flatPrice);
        if (
          blankNumber(row.flatPrice) ||
          !Number.isFinite(price) ||
          price <= 0 ||
          price > MAX_ITEM_FLAT_PRICE
        ) {
          return `${row.name}: enter a set price between $0.01 and $10,000.`;
        }
        if (!blankNumber(row.includedKg)) {
          const included = Number(row.includedKg);
          if (
            !Number.isFinite(included) ||
            included < 0 ||
            included > MAX_INCLUDED_KG
          ) {
            return `${row.name}: the weight the price covers must be between 0 and 200 kg.`;
          }
        }
      }
    }
  }
  return null;
}

/**
 * Refuses what the server would refuse, in sentences written for the owner.
 *
 * Returns null when the settings are savable.
 */
export function validateFreightSettings(
  draft: FreightSettingsDraft,
): string | null {
  for (const category of STANDARD_FREIGHT_CATEGORIES) {
    const value = Number(draft.categoryRates[category.id]);
    if (
      !Number.isFinite(value) ||
      value < MIN_CATEGORY_MULTIPLIER ||
      value > MAX_CATEGORY_MULTIPLIER
    ) {
      return `${category.label}: enter a price multiplier between 0.5 and 10.`;
    }
  }

  if (draft.customCategories.length > MAX_CUSTOM_FREIGHT_CATEGORIES) {
    return "You can add up to 6 categories of your own.";
  }

  const seen = new Set<string>();
  for (const row of draft.customCategories) {
    const id = resolvedFreightCategoryId(row);
    if (!row.label.trim() || !id) {
      return "Give every item category you add a name.";
    }
    if (STANDARD_FREIGHT_CATEGORY_IDS.includes(id)) {
      return "A category you add cannot reuse the name of a standard category.";
    }
    if (seen.has(id)) {
      return "Two of the categories you added have the same name. Give each one its own.";
    }
    seen.add(id);
    const value = Number(row.multiplier);
    if (
      !Number.isFinite(value) ||
      value < MIN_CATEGORY_MULTIPLIER ||
      value > MAX_CATEGORY_MULTIPLIER
    ) {
      return `${row.label.trim()}: enter a price multiplier between 0.5 and 10.`;
    }
  }

  const pricingError = paybackPricingError(draft);
  if (pricingError) return pricingError;

  // Cover has nothing left to validate: it is one yes/no, and the amount it
  // promises comes from the payback rows this business already priced.
  return null;
}

export type FreightItemPricingPayload = {
  pricingMode?: FreightPricingMode;
  flatPrice?: number;
  includedKg?: number;
};

export type FreightOtherPricingPayload = {
  otherPricingMode?: FreightPricingMode;
  otherFlatPrice?: number;
  otherIncludedKg?: number;
};

export type FreightSettingsPayload = {
  freightCategoryRates: Record<string, number>;
  freightCustomCategories: Array<{
    id: string;
    label: string;
    hint: string;
    multiplier: number;
  }>;
  freightCoverage: { coversLoss: boolean };
  freightPaybackTable: Record<
    string,
    {
      items: Array<
        {id: string; label: string; paybackAmount: number} &
          FreightItemPricingPayload
      >;
      otherPaybackAmount: number;
    } & FreightOtherPricingPayload
  >;
  freightPayOnArrival: boolean;
};

/**
 * The pricing keys for one row, cleaned the way the callable cleans them.
 *
 * An untouched legacy row answers with nothing at all: no `pricingMode`
 * means the category multiplier still prices it, which is what every parcel
 * booked before this existed was charged.
 */
function pricingPayload(row: {
  pricingMode: FreightPaybackPricingMode;
  flatPrice: string;
  includedKg: string;
}): FreightItemPricingPayload {
  if (row.pricingMode === "flat") {
    const included = Number(row.includedKg);
    return {
      pricingMode: "flat",
      flatPrice: Number(row.flatPrice) || 0,
      ...(!blankNumber(row.includedKg) &&
        Number.isFinite(included) &&
        included > 0 && {includedKg: included}),
    };
  }
  if (row.pricingMode === "per_kg") {
    return {pricingMode: "per_kg"};
  }
  return {};
}

function otherPricingPayload(
  entry: FreightPaybackCategoryDraft,
): FreightOtherPricingPayload {
  const pricing = pricingPayload({
    pricingMode: entry.otherPricingMode,
    flatPrice: entry.otherFlatPrice,
    includedKg: entry.otherIncludedKg,
  });
  return {
    ...(pricing.pricingMode && {otherPricingMode: pricing.pricingMode}),
    ...(pricing.flatPrice !== undefined && {otherFlatPrice: pricing.flatPrice}),
    ...(pricing.includedKg !== undefined && {
      otherIncludedKg: pricing.includedKg,
    }),
  };
}

/**
 * What updateBusinessProfile receives.
 *
 * A standard row left at the platform's starting number is not sent at all.
 * Storing it would pin this business to today's default forever, and "set
 * nothing, change nothing" is the promise that made categories safe to ship.
 */
export function buildFreightSettingsPayload(
  draft: FreightSettingsDraft,
): FreightSettingsPayload {
  const freightCategoryRates: Record<string, number> = {};
  for (const category of STANDARD_FREIGHT_CATEGORIES) {
    const value = Number(draft.categoryRates[category.id]);
    if (!Number.isFinite(value)) continue;
    if (value === category.defaultMultiplier) continue;
    freightCategoryRates[category.id] = value;
  }
  return {
    freightCategoryRates,
    freightCustomCategories: draft.customCategories
      .slice(0, MAX_CUSTOM_FREIGHT_CATEGORIES)
      .map((row) => ({
        id: resolvedFreightCategoryId(row),
        label: row.label.trim(),
        hint: row.hint.trim(),
        multiplier: Number(row.multiplier) || 1,
      })),
    freightCoverage: { coversLoss: draft.coversLoss },
    freightPaybackTable: Object.fromEntries(
      Object.entries(draft.payback)
        .map(([categoryId, entry]) => [
          categoryId,
          {
            items: entry.items
              .filter((item) => item.label.trim())
              .map((item) => ({
                id:
                  item.id.trim() ||
                  item.label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"),
                label: item.label.trim(),
                paybackAmount: Number(item.amount || 0) || 0,
                ...pricingPayload(item),
              })),
            otherPaybackAmount: Number(entry.otherAmount || 0) || 0,
            ...otherPricingPayload(entry),
          },
        ])
        // An untouched category is not sent as an empty promise.
        .filter(
          ([, entry]) =>
            (entry as {items: unknown[]}).items.length > 0 ||
            (entry as {otherPaybackAmount: number}).otherPaybackAmount > 0,
        ),
    ),
    freightPayOnArrival: draft.payOnArrival,
  };
}
