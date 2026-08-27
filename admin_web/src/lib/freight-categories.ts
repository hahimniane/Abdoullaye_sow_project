/**
 * What is in the parcel, and who stands behind it.
 *
 * Two separate questions, deliberately kept apart:
 *
 * - **Category** answers "what is it, and will you carry it". It is how a
 *   customer finds the thing they are sending; the platform owns the list so
 *   two businesses can be compared on the same words. It carries no price of
 *   its own - what a thing costs is set on the item row, by the business.
 * - **Cover** answers "if you lose it, do you make me whole". One yes/no per
 *   business, and no figure anywhere: a business either stands behind the
 *   parcel or it does not. Nothing is charged for it either, because a
 *   business already prices each item according to what it is worth to carry
 *   - which is why freight is priced per item at all - so the risk is inside
 *   the shipping rate, and a separate percentage billed the same risk twice.
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
 *
 * A label and a hint, and nothing else. A category is how a customer finds
 * the thing they are sending, not what it costs.
 */
export const STANDARD_FREIGHT_CATEGORIES = [
  {
    id: "general",
    label: "General goods",
    hint: "Household items, gifts, anything not listed below",
  },
  {
    id: "clothing",
    label: "Clothes and fabric",
    hint: "Clothing, shoes, cloth, bedding",
  },
  {
    id: "food",
    label: "Food",
    hint: "Dry and packaged food only",
  },
  {
    id: "documents",
    label: "Documents",
    hint: "Papers, certificates, printed matter",
  },
  {
    id: "cosmetics",
    label: "Cosmetics and liquids",
    hint: "Creams, perfumes, hair products",
  },
  {
    id: "electronics",
    label: "Electronics",
    hint: "Phones, laptops, tablets, chargers",
  },
  {
    id: "fragile",
    label: "Fragile items",
    hint: "Glass, ceramics, anything breakable",
  },
] as const;

export const STANDARD_FREIGHT_CATEGORY_IDS: readonly string[] =
  STANDARD_FREIGHT_CATEGORIES.map((category) => category.id);

/** A business may not drown the customer in choices. */
export const MAX_CUSTOM_FREIGHT_CATEGORIES = 6;

export type FreightCategoryOption = {
  id: string;
  label: string;
  hint: string;
  custom: boolean;
};

/**
 * One question, one answer. Mirrors what `freightCoveragePolicy` sends from
 * functions/freight_coverage.js: a business either makes good on a parcel it
 * loses or it does not.
 */
export type FreightCoveragePolicy = {
  coversLoss: boolean;
};

/* -------------------------------------------------------------------------
 * Reading what the callable sent (customer side)
 * ---------------------------------------------------------------------- */

function trimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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

/* -------------------------------------------------------------------------
 * The price, exactly as the server computes it
 * ---------------------------------------------------------------------- */

/**
 * What a by-weight parcel costs to ship with this business.
 *
 * The server computes `round(weight * ratePerKg)` in one step, so the same
 * rounding happens here rather than rounding the rate first - rounding twice
 * drifts by a cent on exactly the kind of parcel someone would complain
 * about. Null when either side of the multiplication is missing, which is a
 * route this business has not rated.
 */
export function freightWeightPricing({
  ratePerKg,
  weightKg,
}: {
  ratePerKg: unknown;
  weightKg: unknown;
}): {ratePerKg: number; shippingSubtotal: number} | null {
  const rate = Number(ratePerKg);
  const weight = Number(weightKg);
  if (!Number.isFinite(rate) || !Number.isFinite(weight)) return null;
  if (rate <= 0 || weight <= 0) return null;
  return {
    ratePerKg: rate,
    shippingSubtotal: Math.round(weight * rate * 100) / 100,
  };
}

/* -------------------------------------------------------------------------
 * Cover
 * ---------------------------------------------------------------------- */

/**
 * The one line that lets a customer compare two businesses on protection
 * before choosing either.
 *
 * Whether this business stands behind the parcel, in the sentence a customer
 * reads while it is still in the room. There is no figure to show and none to
 * format: cover is a yes or a no, and the business that stands behind nothing
 * is the thing worth knowing here.
 */
export function freightCoverageComparisonLine(
  policy: FreightCoveragePolicy | null,
): string {
  if (!policy || !policy.coversLoss) {
    return "This business does not pay for a lost parcel";
  }
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
};

/**
 * How the business charges for one row it carries.
 *
 * Empty is unanswered, and unanswered is a real state: an item this business
 * has never put a number on. It cannot be booked on the spot - the customer
 * asks for a price and this business answers with one.
 */
export type FreightPaybackPricingMode = "" | "flat" | "per_kg";

export type FreightPaybackItemDraft = {
  id: string;
  label: string;
  pricingMode: FreightPaybackPricingMode;
  /** What this item costs to carry, whatever it weighs. */
  flatPrice: string;
  /** How much weight the set price covers. Blank covers any weight. */
  includedKg: string;
};

export type FreightPaybackCategoryDraft = {
  items: FreightPaybackItemDraft[];
  /**
   * How anything else in this category is priced, or empty for "ask me".
   *
   * The mode is the whole switch: a catch-all exists because the business
   * priced one, and a category that never did sends the customer to a
   * request instead.
   */
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
    pricingMode: "per_kg",
    flatPrice: "",
    includedKg: "",
  };
}

export function emptyFreightPaybackCategory(): FreightPaybackCategoryDraft {
  return {
    items: [],
    otherPricingMode: "",
    otherFlatPrice: "",
    otherIncludedKg: "",
  };
}

export type FreightSettingsDraft = {
  /**
   * Whatever `freightCategoryRates` already holds, carried untouched.
   *
   * Nothing reads it and no field writes it - it rides through so that saving
   * from this form does not erase what a document already stored.
   */
  categoryRates: Record<string, number>;
  customCategories: FreightCustomCategoryDraft[];
  /** Whether this business makes good on a parcel it loses. */
  coversLoss: boolean;
  /** What this business carries, and how each row is priced. */
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
      Object.entries(rates)
        .map(([id, value]) => [id, Number(value)])
        .filter(([, value]) => Number.isFinite(value as number)),
    ) as Record<string, number>,
    customCategories: stored
      .slice(0, MAX_CUSTOM_FREIGHT_CATEGORIES)
      .map((raw) => {
        const row = recordValue(raw);
        return {
          id: trimmedString(row.id).toLowerCase(),
          label: trimmedString(row.label),
          hint: trimmedString(row.hint),
        };
      }),
    coversLoss: business?.freightCoverageEnabled === true,
    payback: paybackDraftFrom(business?.freightPaybackTable),
    payOnArrival: business?.freightPayOnArrival === true,
  };
}

/**
 * The stored mode, or empty when the row names none.
 *
 * Empty is carried through the form rather than defaulted, so a row this
 * business has never priced is saved back exactly as unpriced. Inventing a
 * mode here would put a number on the customer's screen that nobody chose.
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
          pricingMode: pricingModeText(row.pricingMode),
          flatPrice: numberText(row.flatPrice, ""),
          includedKg: numberText(row.includedKg, ""),
        };
      }),
      otherPricingMode: pricingModeText(entry.otherPricingMode),
      otherFlatPrice: numberText(entry.otherFlatPrice, ""),
      otherIncludedKg: numberText(entry.otherIncludedKg, ""),
    };
  }
  return draft;
}

export function emptyFreightCustomCategory(): FreightCustomCategoryDraft {
  return { id: "", label: "", hint: "" };
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

/** Blank is an answer here: it means "however heavy", so it is checked
 * separately from a typo. */
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
    // A catch-all exists only once the business has priced one; a category
    // that named no mode sends every unlisted item to a request instead.
    if (entry.otherPricingMode) {
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
  }

  const pricingError = paybackPricingError(draft);
  if (pricingError) return pricingError;

  // Cover has nothing to validate: it is one yes/no, with no figure attached
  // to any row for it to disagree with.
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
  /** Carried through from the document, not composed from any field. */
  freightCategoryRates: Record<string, number>;
  freightCustomCategories: Array<{
    id: string;
    label: string;
    hint: string;
  }>;
  freightCoverage: { coversLoss: boolean };
  freightPaybackTable: Record<
    string,
    {
      items: Array<{id: string; label: string} & FreightItemPricingPayload>;
    } & FreightOtherPricingPayload
  >;
  freightPayOnArrival: boolean;
};

/**
 * The pricing keys for one row, cleaned the way the callable cleans them.
 *
 * A row with no mode answers with nothing at all, and the absence is the
 * point: it is how the server knows this business has never put a number on
 * this item, and routes the customer to ask for one.
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
 * `freightCategoryRates` goes back exactly as it came: no field composes it,
 * so rebuilding it from the form would silently drop whatever a document is
 * already carrying.
 */
export function buildFreightSettingsPayload(
  draft: FreightSettingsDraft,
): FreightSettingsPayload {
  return {
    freightCategoryRates: {...draft.categoryRates},
    freightCustomCategories: draft.customCategories
      .slice(0, MAX_CUSTOM_FREIGHT_CATEGORIES)
      .map((row) => ({
        id: resolvedFreightCategoryId(row),
        label: row.label.trim(),
        hint: row.hint.trim(),
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
                ...pricingPayload(item),
              })),
            ...otherPricingPayload(entry),
          },
        ])
        // An untouched category is not sent as an empty row.
        .filter(
          ([, entry]) =>
            (entry as {items: unknown[]}).items.length > 0 ||
            Boolean(
              (entry as FreightOtherPricingPayload).otherPricingMode,
            ),
        ),
    ),
    freightPayOnArrival: draft.payOnArrival,
  };
}
