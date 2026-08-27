// Per-service platform commission, as the admin console must present it.
//
// This is the browser-side mirror of functions/platform_fees.js. The backend
// resolves a commission from three levels, most specific first:
//
//   1. businesses/{id}.servicePlatformFeePct[<key>]  - this business, this service
//   2. businesses/{id}.platformFeePct                - this business, everything
//   3. shipmentPricing/serviceFees[<key>]            - the platform's own rate
//
// The console must show which of those three is actually in force, not just
// the number: an admin who cannot see the level is one who "fixes" a rate at
// the wrong level and watches nothing change.
//
// The validation rule is the server's, deliberately: a rate is used only when
// it is a number >= 0 and < 1. Anything else is IGNORED and falls through to
// the next level - never clamped. So the editor must refuse to store an
// out-of-range value rather than write something the backend will skip.

/** The business field holding the per-service overrides. */
export const SERVICE_PLATFORM_FEE_FIELD = "servicePlatformFeePct";

/**
 * The seven services that can carry their own rate. These are the same
 * `<service>PlatformFeePct` names the pricing document uses at every level -
 * there is no translation table to drift.
 */
export const SERVICE_FEE_KEYS = [
  "parkingPlatformFeePct",
  "freightPlatformFeePct",
  "barrelPlatformFeePct",
  "sharedBarrelPlatformFeePct",
  "carPurchasePlatformFeePct",
  "carDepositPlatformFeePct",
  "holdExtensionPlatformFeePct",
] as const;

export type ServiceFeeKey = (typeof SERVICE_FEE_KEYS)[number];

/** English labels; French comes from the runtime dictionary. */
export const SERVICE_FEE_LABELS: Record<ServiceFeeKey, string> = {
  parkingPlatformFeePct: "Parking",
  freightPlatformFeePct: "Freight",
  barrelPlatformFeePct: "Barrels",
  sharedBarrelPlatformFeePct: "Shared barrels",
  carPurchasePlatformFeePct: "Car purchase",
  carDepositPlatformFeePct: "Car deposit",
  holdExtensionPlatformFeePct: "Hold extension",
};

/** The platform's own default when nothing at all is configured. */
export const DEFAULT_PLATFORM_SERVICE_FEE_PCT = 0.1;

/**
 * The lookup order for one service, most specific first. Shared barrels fall
 * back to barrels at EVERY level, so the chain - not the single key - is what
 * gets resolved.
 */
export function serviceFeeKeyChain(key: ServiceFeeKey): ServiceFeeKey[] {
  return key === "sharedBarrelPlatformFeePct" ?
    ["sharedBarrelPlatformFeePct", "barrelPlatformFeePct"] :
    [key];
}

type FeeDoc = Record<string, unknown> | null | undefined;

/** A rate the backend is willing to charge, or null when it would be ignored. */
export function usableFeeRate(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const pct = Number(raw);
  // >= 1 is refused rather than clamped: a rate of 1 leaves the business
  // nothing, and anything above it is certainly a typo (5 meaning "5%").
  if (!Number.isFinite(pct) || pct < 0 || pct >= 1) return null;
  return pct;
}

function serviceOverrides(business: FeeDoc): Record<string, unknown> | null {
  const overrides = business?.[SERVICE_PLATFORM_FEE_FIELD];
  return overrides && typeof overrides === "object" ?
    (overrides as Record<string, unknown>) :
    null;
}

/** Level 1 - this business's rate for this specific service. */
export function businessServiceFeeRate(
  business: FeeDoc,
  keys: readonly string[],
): { pct: number; key: string } | null {
  const overrides = serviceOverrides(business);
  if (!overrides) return null;
  for (const key of keys) {
    const pct = usableFeeRate(overrides[key]);
    if (pct !== null) return { pct, key };
  }
  return null;
}

/** Level 2 - this business's blanket rate for everything it sells. */
export function businessBlanketFeeRate(business: FeeDoc): number | null {
  return usableFeeRate(
    business?.platformFeePct ?? business?.platformCommissionPct,
  );
}

/**
 * Level 3 - the platform's own rate for this service.
 *
 * Mirrors the backend including two quirks worth restating: the FIRST key that
 * is PRESENT wins even when its value turns out to be unusable (an admin who
 * set it meant to set it, so a typo reads as zero rather than silently
 * charging the next service's rate), while an explicit null ends the key
 * search too but then reads as "not set", falling through to the document's
 * blanket rate rather than to the next service key.
 */
export function platformServiceFeeRate(
  pricingDoc: FeeDoc,
  keys: readonly string[],
): number {
  let raw: unknown;
  for (const key of keys) {
    if (pricingDoc?.[key] !== undefined) {
      raw = pricingDoc[key];
      break;
    }
  }
  if (raw === undefined || raw === null) {
    // The backend also consults PLATFORM_SERVICE_FEE_PCT here; that is a
    // server-only environment variable the browser cannot read, so the console
    // shows the compiled-in default it falls back to.
    raw = pricingDoc?.platformFeePct ?? DEFAULT_PLATFORM_SERVICE_FEE_PCT;
  }
  const pct = usableFeeRate(raw);
  return pct === null ? 0 : pct;
}

/** Which of the three levels decided a rate. */
export type PlatformFeeSource = "business_service" | "business" | "platform";

export type ResolvedPlatformFee = {
  pct: number;
  source: PlatformFeeSource;
  /** The key that actually matched - differs from the asked-for key when a
   * service inherits another's rate (shared barrels -> barrels). */
  key: string;
};

/**
 * The rate that will actually be charged, and where it came from. Mirrors
 * `resolvePlatformFeePct` in functions/platform_fees.js.
 */
export function resolveServicePlatformFee(
  pricingDoc: FeeDoc,
  business: FeeDoc,
  keys: readonly string[],
): ResolvedPlatformFee {
  const serviceRate = businessServiceFeeRate(business, keys);
  if (serviceRate) {
    return { pct: serviceRate.pct, source: "business_service", key: serviceRate.key };
  }
  const blanket = businessBlanketFeeRate(business);
  if (blanket !== null) return { pct: blanket, source: "business", key: "" };
  return {
    pct: platformServiceFeeRate(pricingDoc, keys),
    source: "platform",
    key: keys[0] ?? "",
  };
}

/** Resolves one service key, expanding its fallback chain for the caller. */
export function resolveServiceFeeForKey(
  pricingDoc: FeeDoc,
  business: FeeDoc,
  key: ServiceFeeKey,
): ResolvedPlatformFee {
  return resolveServicePlatformFee(pricingDoc, business, serviceFeeKeyChain(key));
}

/** The stored (raw) per-service override for one key, exactly as written. */
export function storedServiceFeeRate(
  business: FeeDoc,
  key: ServiceFeeKey,
): number | null {
  return usableFeeRate(serviceOverrides(business)?.[key]);
}

/**
 * Whether the field is written at all - which is NOT the same as having a
 * usable rate. A stored typo (`5`) resolves to nothing but is still there, and
 * the admin has to be able to clear it.
 */
export function hasStoredServiceFeeOverride(
  business: FeeDoc,
  key: ServiceFeeKey,
): boolean {
  const overrides = serviceOverrides(business);
  return !!overrides && overrides[key] !== undefined;
}

export const SERVICE_FEE_RANGE_ERROR =
  "Enter a commission of at least 0% and under 100%, or leave it empty to inherit.";

export type ServiceFeeEdit =
  | { ok: true; action: "clear" }
  | { ok: true; action: "set"; rate: number }
  | { ok: false; error: string };

/**
 * Reads what the admin typed into a per-service box.
 *
 * Empty means "no override - inherit", which must REMOVE the field. It is not
 * the same as 0: 0 is a real rate meaning the platform takes nothing, and
 * writing 0 to mean "inherit" would silently make every such service free.
 *
 * Out of range is refused outright, because the backend ignores rather than
 * clamps such a value - saving it would look like it worked and change
 * nothing.
 */
export function parseServiceFeePercent(value: string): ServiceFeeEdit {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return { ok: true, action: "clear" };
  const percent = Number(trimmed);
  if (!Number.isFinite(percent)) {
    return { ok: false, error: SERVICE_FEE_RANGE_ERROR };
  }
  // Same 6-decimal quantisation the blanket-rate editor uses, applied BEFORE
  // the range check so a value that only rounds up into the ignored range
  // (99.99999% -> 1) is refused rather than stored and skipped.
  const rate = Math.round(percent * 10000) / 1000000;
  if (usableFeeRate(rate) === null) {
    return { ok: false, error: SERVICE_FEE_RANGE_ERROR };
  }
  return { ok: true, action: "set", rate };
}
