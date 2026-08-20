/**
 * What is in the parcel, what it is worth, and who stands behind it.
 *
 * Two separate questions, deliberately kept apart:
 *
 * - **Category** answers "what is it, will you carry it, how likely is it to
 *   go missing". The platform owns the list so a customer can compare two
 *   businesses on the same words; the business sets what each row is worth to
 *   it.
 * - **Declared value** answers "what does it cost to replace". Only the sender
 *   knows - an iPhone 17 and an old Samsung are the same category and the same
 *   weight. The declared value is also the cap on any payout, which is what
 *   makes the answer trustworthy without anyone checking it.
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

/** Coverage priced above this would be a business nobody should be running. */
export const MAX_COVERAGE_RATE_PCT = 10;

/** Most any business may accept, whatever it sets for itself. */
export const PLATFORM_MAX_DECLARED_VALUE = 10000;

/** Below this the value question is not worth asking. */
export const DECLARATION_THRESHOLD = 200;

export type FreightCategoryOption = {
  id: string;
  label: string;
  hint: string;
  multiplier: number;
  custom: boolean;
};

export type FreightCoveragePolicy = {
  coversLoss: boolean;
  ratePct: number;
  /** 0 means "no stated ceiling", not "unlimited". */
  maxDeclaredValue: number;
  declarationThreshold: number;
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
 * Mirrors the server's guard that ticking "covers loss" without a rate is not
 * coverage: otherwise a business appears to stand behind a parcel it never
 * charged to stand behind.
 */
export function freightCoveragePolicyFrom(
  value: unknown,
): FreightCoveragePolicy | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const rawRate = finiteNumber(row.ratePct);
  const ratePct = rawRate > 0 ? Math.min(MAX_COVERAGE_RATE_PCT, rawRate) : 0;
  const rawMax = finiteNumber(row.maxDeclaredValue);
  const maxDeclaredValue =
    rawMax > 0 ? Math.min(PLATFORM_MAX_DECLARED_VALUE, rawMax) : 0;
  const threshold = finiteNumber(row.declarationThreshold);
  return {
    coversLoss: row.coversLoss === true && ratePct > 0,
    ratePct,
    maxDeclaredValue,
    declarationThreshold:
      threshold > 0 ? threshold : DECLARATION_THRESHOLD,
  };
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
 * Declared value and cover
 * ---------------------------------------------------------------------- */

export type FreightCoverageQuote =
  | {
      ok: true;
      declaredValue: number;
      coverageFee: number;
      covered: boolean;
      /** The most that can be paid back. Never more than what was declared. */
      payoutCap: number;
    }
  | { ok: false; message: string };

/**
 * Prices a declared value against a business's policy.
 *
 * The refusal sentences are the server's, word for word, so a customer who
 * trips the same rule twice reads the same sentence both times.
 */
export function quoteFreightCoverage({
  policy,
  declaredValue,
}: {
  policy: FreightCoveragePolicy | null;
  declaredValue: unknown;
}): FreightCoverageQuote {
  const raw = finiteNumber(declaredValue);
  const declared = raw > 0 ? raw : 0;
  const nothingDeclared = {
    ok: true as const,
    declaredValue: 0,
    coverageFee: 0,
    covered: false,
    payoutCap: 0,
  };
  if (declared <= 0 || !policy) return nothingDeclared;

  // The ceiling applies whether or not the business sells cover: it is a
  // statement about what it is willing to carry, not about what it insures.
  if (policy.maxDeclaredValue > 0 && declared > policy.maxDeclaredValue) {
    return {
      ok: false,
      message: "This business does not carry parcels worth that much",
    };
  }
  if (declared > PLATFORM_MAX_DECLARED_VALUE) {
    return { ok: false, message: "That declared value is too high to ship" };
  }
  if (!policy.coversLoss) {
    // The value is still recorded - it is what the business agreed to carry -
    // but nothing is charged and nothing is promised.
    return {
      ok: true,
      declaredValue: declared,
      coverageFee: 0,
      covered: false,
      payoutCap: 0,
    };
  }
  return {
    ok: true,
    declaredValue: declared,
    coverageFee: roundMoney(declared * (policy.ratePct / 100)),
    covered: true,
    payoutCap: declared,
  };
}

/** "2" rather than "2.0", and "1.5" rather than "1.50". */
export function formatMultiplier(value: number): string {
  return `${Math.round(value * 100) / 100}`;
}

/**
 * The one line that lets a customer compare two businesses on protection
 * before choosing either. Money is formatted by the caller so this stays
 * pure and the customer's locale still decides how a dollar looks.
 *
 * A business with a payback table protects at ITS published amounts - the
 * customer declares nothing, so "covers what you declare" would describe a
 * flow that no longer exists for them. The declared-value wording survives
 * only for businesses still on the old model.
 */
export function freightCoverageComparisonLine(
  policy: FreightCoveragePolicy | null,
  money: (value: number) => string,
  hasPaybackTable = false,
): string {
  if (!policy || !policy.coversLoss) return "No protection offered";
  const rate = `${formatMultiplier(policy.ratePct)}%`;
  if (hasPaybackTable) {
    return `Protection included · ${rate} of the item's covered amount`;
  }
  return policy.maxDeclaredValue > 0
    ? `Covers up to ${money(policy.maxDeclaredValue)} · ${rate}`
    : `Covers what you declare · ${rate}`;
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

export type FreightPaybackItemDraft = {
  id: string;
  label: string;
  amount: string;
};

export type FreightPaybackCategoryDraft = {
  items: FreightPaybackItemDraft[];
  otherAmount: string;
};

export type FreightSettingsDraft = {
  /** Only the standard rows the business has actually moved. */
  categoryRates: Record<string, string>;
  customCategories: FreightCustomCategoryDraft[];
  coversLoss: boolean;
  coverageRatePct: string;
  maxDeclaredValue: string;
  /** What each item pays back if lost - the business's numbers, per row. */
  payback: Record<string, FreightPaybackCategoryDraft>;
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
    coverageRatePct: numberText(business?.freightCoverageRatePct, "0"),
    maxDeclaredValue: numberText(business?.freightMaxDeclaredValue, "0"),
    payback: paybackDraftFrom(business?.freightPaybackTable),
  };
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
        };
      }),
      otherAmount: numberText(entry.otherPaybackAmount, "0"),
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

  const ratePct = Number(draft.coverageRatePct || 0);
  if (!Number.isFinite(ratePct) || ratePct < 0 || ratePct > MAX_COVERAGE_RATE_PCT) {
    return "The coverage rate must be between 0% and 10%.";
  }
  const maxValue = Number(draft.maxDeclaredValue || 0);
  if (
    !Number.isFinite(maxValue) ||
    maxValue < 0 ||
    maxValue > PLATFORM_MAX_DECLARED_VALUE
  ) {
    return "The most you will carry must be between $0 and $10,000.";
  }
  if (draft.coversLoss && ratePct <= 0) {
    return "Set a coverage rate above 0%, or turn off cover for lost parcels. Cover at no price is money you never collected for.";
  }
  return null;
}

export type FreightSettingsPayload = {
  freightCategoryRates: Record<string, number>;
  freightCustomCategories: Array<{
    id: string;
    label: string;
    hint: string;
    multiplier: number;
  }>;
  freightCoverage: {
    coversLoss: boolean;
    ratePct: number;
    maxDeclaredValue: number;
  };
  freightPaybackTable: Record<
    string,
    {
      items: Array<{id: string; label: string; paybackAmount: number}>;
      otherPaybackAmount: number;
    }
  >;
};

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
    freightCoverage: {
      coversLoss: draft.coversLoss,
      ratePct: Number(draft.coverageRatePct || 0) || 0,
      maxDeclaredValue: Number(draft.maxDeclaredValue || 0) || 0,
    },
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
              })),
            otherPaybackAmount: Number(entry.otherAmount || 0) || 0,
          },
        ])
        // An untouched category is not sent as an empty promise.
        .filter(
          ([, entry]) =>
            (entry as {items: unknown[]}).items.length > 0 ||
            (entry as {otherPaybackAmount: number}).otherPaybackAmount > 0,
        ),
    ),
  };
}
