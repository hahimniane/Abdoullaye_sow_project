// Laawol bills (docs/PLATFORM_BILLING.md): what each business owes the
// platform per month under its own deal. The server is the authority
// (my_flutter_app/functions/platform_billing.js, read through the
// `platformBilling` callable); this module is the screen's pure half - the
// types, the deal form, labels and a mirror of the bill math that the
// preview (`?preview=1`) and the deal editor's hint use. The mirror runs the
// server's shared cases (functions/test/fixtures/platform-billing-cases.json)
// in platform-billing.test.ts, so it cannot drift.

import { moneyText } from "./invoice-ledger.ts";
import { readMoneyInput } from "./money-input.ts";

export const BILLING_CALLABLE = "platformBilling";
export const MAX_UNIT_CENTS = 1000000;
export const MAX_MONTH_CENTS = 100000000;
export const MAX_BPS = 10000;
export const MAX_NOTE = 300;

export type PackageCharge =
  | { mode: "fixed"; centsEach: number }
  | { mode: "percent"; bps: number; minCents: number };
export type ParkingCharge =
  | { mode: "perCar"; centsEach: number }
  | { mode: "percent"; bps: number };

export type Deal = {
  barrel: { centsEach: number } | null;
  package: PackageCharge | null;
  shippedCar: { centsEach: number } | null;
  parking: ParkingCharge | null;
  itemSold: { centsEach: number } | null;
  /** Check bank (docs/ZELLE_BANK_CHECK.md): a month's price when the business had an active bank link. Deals saved before have none. */
  bankConnection: { centsEach: number } | null;
  /** A price per paid bank refresh. */
  bankCheck: { centsEach: number } | null;
  flatCents: number;
  minimumCents: number | null;
  capCents: number | null;
};

export type Usage = {
  barrels: number;
  packages: number;
  cars: number;
  packagePrices?: Array<number | null> | null;
  parkingCars: number | null;
  parkingBilledCents: number | null;
  itemsSold: number | null;
  /** Whether the business had an active bank link in the month; null when not read. */
  bankConnected: boolean | null;
  /** Its paid bank refreshes in the month; null when not read. */
  bankRefreshes: number | null;
  complete?: boolean;
};

export type ChargeKey = "barrels" | "packages" | "shippedCars" | "parking" | "itemsSold" | "bankConnection" | "bankChecks";

/** The server's CHARGE_KEYS, in bill order. */
export const CHARGE_KEYS: readonly ChargeKey[] = ["barrels", "packages", "shippedCars", "parking", "itemsSold", "bankConnection", "bankChecks"];

export type BillLine = {
  key: ChargeKey;
  mode: "fixed" | "percent" | "perCar";
  quantity: number;
  centsEach?: number;
  bps?: number;
  minCents?: number;
  baseCents?: number;
  pricedCents?: number;
  noPriceCount?: number;
  atMinimumCount?: number;
  pricesUnknown?: boolean;
  cents: number;
};

export type Bill = {
  hasDeal: boolean;
  lines: BillLine[];
  chargesCents: number;
  flatCents: number;
  beforeLimitsCents: number;
  minimumCents: number | null;
  minimumAdjustmentCents: number;
  capCents: number | null;
  capAdjustmentCents: number;
  amountCents: number;
  commissionCents: number;
  earnedCents: number;
};

export type DriftKey =
  | "barrels"
  | "packages"
  | "packagesNoPrice"
  | "packagePriceCents"
  | "cars"
  | "parkingCars"
  | "parkingBilledCents"
  | "itemsSold"
  | "bankConnected"
  | "bankRefreshes"
  | "commissionCents";

export type DriftItem = { key: DriftKey; kind: "count" | "cents"; before: number; after: number; delta: number };

export type Drift = {
  changed: boolean;
  items: DriftItem[];
  closedAmountCents?: number;
  amountNowCents: number;
  amountDeltaCents: number;
};

export type Standing = "nothing_owed" | "unpaid" | "partial" | "paid" | "overpaid";

export type MonthRow = {
  businessId: string;
  name: string;
  hasDeal: boolean;
  deal: Deal | null;
  effectiveFrom: string;
  status: "open" | "closed";
  counts: {
    barrels: number;
    packages: number;
    cars: number;
    parkingCars: number | null;
    itemsSold: number | null;
    /** Paid bank refreshes (null when the deal does not charge for the bank, or an older server). */
    bankRefreshes?: number | null;
  };
  amountCents: number;
  paidCents: number;
  unpaidCents: number;
  standing: Standing;
  commissionCents: number;
  earnedCents: number;
  unpaidToDateCents: number;
  drift: Drift | null;
  complete: boolean;
};

export type MonthBillsResponse = {
  month: string;
  timeZone: string;
  summary: {
    owedCents: number;
    paidCents: number;
    commissionCents: number;
    earnedCents: number;
    unpaidToDateCents: number;
    businesses: number;
    withDeal: number;
    candidates: number;
    partial: boolean;
  };
  rows: MonthRow[];
  nextCursor: number | null;
  complete: boolean;
  canManage: boolean;
  computedAtMs: number;
};

export type PaymentMethod = "zelle" | "cash" | "card" | "bank_transfer" | "check" | "other";

export type Payment = {
  id: string;
  amountCents: number;
  paidOn: string;
  method: PaymentMethod | string;
  note: string;
  recordedBy: string;
  recordedAtMs: number;
  voided: boolean;
  voidedBy: string;
  voidedAtMs: number | null;
  voidReason: string;
};

export type DealVersion = {
  id: string;
  effectiveFrom: string;
  deal: Deal;
  note: string;
  createdAtMs: number;
  createdBy: string;
};

export type BusinessBillResponse = {
  business: { id: string; name: string; exists: boolean; platformFeePct: number | null };
  month: string;
  timeZone: string;
  status: "open" | "closed";
  hasDeal: boolean;
  deal: Deal | null;
  dealVersionId: string;
  effectiveFrom: string;
  bill: Bill;
  usage: Usage;
  liveBill: Bill;
  drift: Drift | null;
  closed: { closedAtMs: number | null; closedBy: string; amountCents: number } | null;
  reopenHistory: Array<{ reopenedAtMs: number; reopenedBy: string; reason: string; closedAmountCents: number }>;
  amountCents: number;
  paidCents: number;
  unpaidCents: number;
  standing: { status: Standing; unpaidCents: number; overpaidCents: number };
  commissionCents: number;
  earnedCents: number;
  payments: Payment[];
  versions: DealVersion[];
  commissionMode: "keep" | "replace";
  months: Array<{ month: string; status: "open" | "closed"; amountCents: number | null; paidCents: number; unpaidCents: number; closedAtMs: number | null }>;
  unpaidToDateCents: number;
  pastOpenMonths: string[];
  people: Record<string, string>;
  /** Check bank in the month, whatever the deal (absent from an older server). */
  bankUsage?: BillBankUsage;
  canManage: boolean;
  complete: boolean;
  computedAtMs: number;
};

/** `getBusinessBill.bankUsage`: bank_check.js usageView plus whether a bank was connected that month. */
export type BillBankUsage = {
  month: string;
  checks: number;
  refreshes: number;
  refreshesFailed: number;
  estimatedCostCents: number;
  refreshLimit: number;
  limitReached: boolean;
  byStaff: Array<{ uid: string; name: string; checks: number; refreshes: number }>;
  connected: boolean;
};

export type WhatIfOneResponse = {
  month: string;
  businessId: string;
  usage: Usage;
  now: Bill;
  alt: Bill;
  deltaCents: number;
  complete: boolean;
};

export type WhatIfRow = {
  businessId: string;
  name: string;
  hasDeal: boolean;
  usage: Usage;
  nowCents: number;
  altCents: number;
  deltaCents: number;
  commissionCents: number;
  altLines: BillLine[];
  complete: boolean;
};

export type WhatIfAllResponse = {
  month: string;
  rows: WhatIfRow[];
  totals: { nowCents: number; altCents: number; deltaCents: number; commissionCents: number; businesses: number };
  nextCursor: number | null;
  candidates: number;
  skipped: number;
  complete: boolean;
};

// ---------------------------------------------------------------------------
// The mirror of the server's math (platform_billing.js).
// ---------------------------------------------------------------------------

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const wholeIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

function count(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n);
}

/** A percentage of an amount, rounded half up to the cent (basis points). */
export function percentOfCents(cents: number, bps: number): number {
  const c = Math.max(0, Math.round(Number(cents) || 0));
  const b = Math.max(0, Math.round(Number(bps) || 0));
  return Math.floor((c * b + 5000) / 10000);
}

export function emptyDeal(): Deal {
  return {
    barrel: null,
    package: null,
    shippedCar: null,
    parking: null,
    itemSold: null,
    bankConnection: null,
    bankCheck: null,
    flatCents: 0,
    minimumCents: null,
    capCents: null,
  };
}

/** The server's validation, code for code. */
export function normalizeDeal(raw: unknown): { deal: Deal | null; errors: string[] } {
  const errors = new Set<string>();
  if (!isObject(raw)) return { deal: null, errors: ["deal_invalid"] };
  const deal = emptyDeal();
  const unit = (value: unknown, min = 1) => {
    if (!wholeIn(value, min, MAX_UNIT_CENTS)) {
      errors.add("amount_invalid");
      return 0;
    }
    return value;
  };
  const rate = (value: unknown) => {
    if (!wholeIn(value, 1, MAX_BPS)) {
      errors.add("rate_invalid");
      return 0;
    }
    return value;
  };
  const charge = (value: unknown): Record<string, unknown> | null => {
    if (value === undefined || value === null) return null;
    if (!isObject(value)) {
      errors.add("deal_invalid");
      return null;
    }
    return value;
  };
  const barrel = charge(raw.barrel);
  if (barrel) deal.barrel = { centsEach: unit(barrel.centsEach) };
  const pkg = charge(raw.package);
  if (pkg) {
    if (pkg.mode === "fixed") {
      deal.package = { mode: "fixed", centsEach: unit(pkg.centsEach) };
    } else if (pkg.mode === "percent") {
      const min = pkg.minCents === undefined || pkg.minCents === null ? 0 : pkg.minCents;
      if (!wholeIn(min, 0, MAX_UNIT_CENTS)) errors.add("minimum_invalid");
      deal.package = { mode: "percent", bps: rate(pkg.bps), minCents: wholeIn(min, 0, MAX_UNIT_CENTS) ? min : 0 };
    } else {
      errors.add("charge_mode_invalid");
    }
  }
  const car = charge(raw.shippedCar);
  if (car) deal.shippedCar = { centsEach: unit(car.centsEach) };
  const parking = charge(raw.parking);
  if (parking) {
    if (parking.mode === "perCar") deal.parking = { mode: "perCar", centsEach: unit(parking.centsEach) };
    else if (parking.mode === "percent") deal.parking = { mode: "percent", bps: rate(parking.bps) };
    else errors.add("charge_mode_invalid");
  }
  const item = charge(raw.itemSold);
  if (item) deal.itemSold = { centsEach: unit(item.centsEach) };
  // Check bank: a monthly price for a connected bank, and a price per paid
  // bank refresh. Deals saved before have neither: they read as no charge.
  const bankConnection = charge(raw.bankConnection);
  if (bankConnection) deal.bankConnection = { centsEach: unit(bankConnection.centsEach) };
  const bankCheck = charge(raw.bankCheck);
  if (bankCheck) deal.bankCheck = { centsEach: unit(bankCheck.centsEach) };
  const flat = raw.flatCents === undefined || raw.flatCents === null ? 0 : raw.flatCents;
  if (!wholeIn(flat, 0, MAX_MONTH_CENTS)) errors.add("amount_invalid");
  else deal.flatCents = flat;
  if (raw.minimumCents !== undefined && raw.minimumCents !== null) {
    if (!wholeIn(raw.minimumCents, 1, MAX_MONTH_CENTS)) errors.add("minimum_invalid");
    else deal.minimumCents = raw.minimumCents;
  }
  if (raw.capCents !== undefined && raw.capCents !== null) {
    if (!wholeIn(raw.capCents, 1, MAX_MONTH_CENTS)) errors.add("cap_invalid");
    else deal.capCents = raw.capCents;
  }
  if (deal.minimumCents !== null && deal.capCents !== null && deal.minimumCents > deal.capCents) {
    errors.add("minimum_above_cap");
  }
  return errors.size > 0 ? { deal: null, errors: [...errors] } : { deal, errors: [] };
}

export function isEmptyDeal(deal: Deal | null | undefined): boolean {
  if (!deal) return true;
  return (
    !deal.barrel &&
    !deal.package &&
    !deal.shippedCar &&
    !deal.parking &&
    !deal.itemSold &&
    !deal.bankConnection &&
    !deal.bankCheck &&
    !(deal.flatCents > 0) &&
    !((deal.minimumCents ?? 0) > 0)
  );
}

export function normalizeUsage(raw: unknown): Usage {
  const row = isObject(raw) ? raw : {};
  const maybe = (value: unknown) => (value === null || value === undefined ? null : count(value));
  const prices = Array.isArray(row.packagePrices)
    ? row.packagePrices.map((price) => (price === null || price === undefined ? null : count(price)))
    : null;
  return {
    barrels: count(row.barrels),
    packages: prices ? prices.length : count(row.packages),
    cars: count(row.cars),
    packagePrices: prices,
    parkingCars: maybe(row.parkingCars),
    parkingBilledCents: maybe(row.parkingBilledCents),
    itemsSold: maybe(row.itemsSold),
    bankConnected: row.bankConnected === null || row.bankConnected === undefined ? null : row.bankConnected === true,
    bankRefreshes: maybe(row.bankRefreshes),
    complete: row.complete !== false,
  };
}

export type DealNeeds = { packagePrices: boolean; parking: boolean; items: boolean; bank: boolean };

/** Which records a deal needs read beyond the Volume rollup (the server's dealNeeds). */
export function dealNeeds(deal: Deal | null | undefined): DealNeeds {
  return {
    packagePrices: deal?.package?.mode === "percent",
    parking: Boolean(deal?.parking),
    items: Boolean(deal?.itemSold),
    bank: Boolean(deal?.bankConnection || deal?.bankCheck),
  };
}

export function mergeNeeds(...needs: Array<DealNeeds | null | undefined>): DealNeeds {
  return {
    packagePrices: needs.some((n) => n?.packagePrices),
    parking: needs.some((n) => n?.parking),
    items: needs.some((n) => n?.items),
    bank: needs.some((n) => n?.bank),
  };
}

/** The usage figures a closed month's drift compares (the server's DRIFT_KEYS, in order). */
export const DRIFT_KEYS: ReadonlyArray<readonly [DriftKey, "count" | "cents"]> = [
  ["barrels", "count"],
  ["packages", "count"],
  ["packagesNoPrice", "count"],
  ["packagePriceCents", "cents"],
  ["cars", "count"],
  ["parkingCars", "count"],
  ["parkingBilledCents", "cents"],
  ["itemsSold", "count"],
  ["bankConnected", "count"],
  ["bankRefreshes", "count"],
  ["commissionCents", "cents"],
];

function packageLine(rule: PackageCharge, usage: Usage): BillLine {
  if (rule.mode === "fixed") {
    return { key: "packages", mode: "fixed", quantity: usage.packages, centsEach: rule.centsEach, cents: usage.packages * rule.centsEach };
  }
  const prices = usage.packagePrices ?? Array.from({ length: usage.packages }, () => null);
  let cents = 0;
  let noPrice = 0;
  let atMinimum = 0;
  let pricedCents = 0;
  for (const price of prices) {
    if (price === null) {
      noPrice += 1;
      cents += rule.minCents;
      if (rule.minCents > 0) atMinimum += 1;
      continue;
    }
    pricedCents += price;
    const share = percentOfCents(price, rule.bps);
    if (share < rule.minCents) {
      atMinimum += 1;
      cents += rule.minCents;
    } else {
      cents += share;
    }
  }
  return {
    key: "packages",
    mode: "percent",
    quantity: prices.length,
    bps: rule.bps,
    minCents: rule.minCents,
    pricedCents,
    noPriceCount: noPrice,
    atMinimumCount: atMinimum,
    pricesUnknown: !usage.packagePrices,
    cents,
  };
}

/** A month's bill under a deal: the server's computeBill. */
export function computeBill({
  deal,
  usage,
  commissionCents = 0,
}: {
  deal: Deal | null;
  usage: unknown;
  commissionCents?: number;
}): Bill {
  const u = normalizeUsage(usage);
  const commission = count(commissionCents);
  const lines: BillLine[] = [];
  if (deal) {
    if (deal.barrel) {
      lines.push({ key: "barrels", mode: "fixed", quantity: u.barrels, centsEach: deal.barrel.centsEach, cents: u.barrels * deal.barrel.centsEach });
    }
    if (deal.package) lines.push(packageLine(deal.package, u));
    if (deal.shippedCar) {
      lines.push({ key: "shippedCars", mode: "fixed", quantity: u.cars, centsEach: deal.shippedCar.centsEach, cents: u.cars * deal.shippedCar.centsEach });
    }
    if (deal.parking) {
      if (deal.parking.mode === "perCar") {
        const cars = u.parkingCars ?? 0;
        lines.push({ key: "parking", mode: "perCar", quantity: cars, centsEach: deal.parking.centsEach, cents: cars * deal.parking.centsEach });
      } else {
        const billed = u.parkingBilledCents ?? 0;
        lines.push({
          key: "parking",
          mode: "percent",
          quantity: u.parkingCars ?? 0,
          bps: deal.parking.bps,
          baseCents: billed,
          cents: percentOfCents(billed, deal.parking.bps),
        });
      }
    }
    if (deal.itemSold) {
      const items = u.itemsSold ?? 0;
      lines.push({ key: "itemsSold", mode: "fixed", quantity: items, centsEach: deal.itemSold.centsEach, cents: items * deal.itemSold.centsEach });
    }
    if (deal.bankConnection) {
      // Charged for the month when the business had an active bank link.
      const months = u.bankConnected ? 1 : 0;
      lines.push({ key: "bankConnection", mode: "fixed", quantity: months, centsEach: deal.bankConnection.centsEach, cents: months * deal.bankConnection.centsEach });
    }
    if (deal.bankCheck) {
      const refreshes = u.bankRefreshes || 0;
      lines.push({ key: "bankChecks", mode: "fixed", quantity: refreshes, centsEach: deal.bankCheck.centsEach, cents: refreshes * deal.bankCheck.centsEach });
    }
  }
  const chargesCents = lines.reduce((sum, line) => sum + line.cents, 0);
  const flatCents = deal ? deal.flatCents || 0 : 0;
  const beforeLimitsCents = chargesCents + flatCents;
  let amount = beforeLimitsCents;
  let minimumAdjustmentCents = 0;
  let capAdjustmentCents = 0;
  const minimumCents = deal?.minimumCents ?? null;
  const capCents = deal?.capCents ?? null;
  if (minimumCents !== null && amount < minimumCents) {
    minimumAdjustmentCents = minimumCents - amount;
    amount = minimumCents;
  }
  if (capCents !== null && amount > capCents) {
    capAdjustmentCents = capCents - amount;
    amount = capCents;
  }
  return {
    hasDeal: Boolean(deal),
    lines,
    chargesCents,
    flatCents,
    beforeLimitsCents,
    minimumCents,
    minimumAdjustmentCents,
    capCents,
    capAdjustmentCents,
    amountCents: amount,
    commissionCents: commission,
    earnedCents: commission + amount,
  };
}

/** The version in effect for a month (the server's dealInEffect). */
export function dealInEffect<T extends { effectiveFrom: string; createdAtMs: number }>(
  versions: readonly T[],
  month: string,
): T | null {
  let best: T | null = null;
  for (const version of versions) {
    const from = version.effectiveFrom;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(from) || from > month) continue;
    if (!best || from > best.effectiveFrom || (from === best.effectiveFrom && version.createdAtMs >= best.createdAtMs)) {
      best = version;
    }
  }
  return best;
}

export function monthStanding(amountCents: number, paidCents: number): { status: Standing; unpaidCents: number; overpaidCents: number } {
  const owed = count(amountCents);
  const paid = count(paidCents);
  let status: Standing;
  if (paid > owed) status = "overpaid";
  else if (owed === 0) status = "nothing_owed";
  else if (paid === owed) status = "paid";
  else if (paid > 0) status = "partial";
  else status = "unpaid";
  return { status, unpaidCents: Math.max(0, owed - paid), overpaidCents: Math.max(0, paid - owed) };
}

// ---------------------------------------------------------------------------
// The deal form.
// ---------------------------------------------------------------------------

export type DealDraft = {
  barrelMode: "none" | "fixed";
  barrel: string;
  packageMode: "none" | "fixed" | "percent";
  packageCents: string;
  packagePct: string;
  packageMin: string;
  shippedCarMode: "none" | "fixed";
  shippedCar: string;
  parkingMode: "none" | "perCar" | "percent";
  parkingCents: string;
  parkingPct: string;
  itemMode: "none" | "fixed";
  item: string;
  bankConnectionMode: "none" | "fixed";
  bankConnection: string;
  bankCheckMode: "none" | "fixed";
  bankCheck: string;
  flat: string;
  minimum: string;
  cap: string;
};

export type DraftField = Exclude<keyof DealDraft, `${string}Mode`>;

/** Whole cents as the text a field shows: "5", "0.25", "1,200.50" is not used (plain). */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "";
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/** Basis points as the percent a field shows: 500 -> "5", 250 -> "2.5". */
export function bpsToInput(bps: number | null | undefined): string {
  if (bps === null || bps === undefined || !Number.isFinite(bps)) return "";
  return String(Math.round(bps) / 100);
}

/**
 * A typed percentage as basis points. A percentage with up to two decimals
 * reads exactly like money (hundredths), so it goes through the console's
 * one money reader: "5" -> 500, "2,5" -> 250, "2.555" is refused.
 */
export function percentToBps(input: string): number | null {
  const read = readMoneyInput(input);
  return read.cents === null ? null : read.cents;
}

export function emptyDealDraft(): DealDraft {
  return {
    barrelMode: "none",
    barrel: "",
    packageMode: "none",
    packageCents: "",
    packagePct: "",
    packageMin: "",
    shippedCarMode: "none",
    shippedCar: "",
    parkingMode: "none",
    parkingCents: "",
    parkingPct: "",
    itemMode: "none",
    item: "",
    bankConnectionMode: "none",
    bankConnection: "",
    bankCheckMode: "none",
    bankCheck: "",
    flat: "",
    minimum: "",
    cap: "",
  };
}

export function draftFromDeal(deal: Deal | null | undefined): DealDraft {
  const draft = emptyDealDraft();
  if (!deal) return draft;
  if (deal.barrel) {
    draft.barrelMode = "fixed";
    draft.barrel = centsToInput(deal.barrel.centsEach);
  }
  if (deal.package?.mode === "fixed") {
    draft.packageMode = "fixed";
    draft.packageCents = centsToInput(deal.package.centsEach);
  } else if (deal.package?.mode === "percent") {
    draft.packageMode = "percent";
    draft.packagePct = bpsToInput(deal.package.bps);
    draft.packageMin = deal.package.minCents > 0 ? centsToInput(deal.package.minCents) : "";
  }
  if (deal.shippedCar) {
    draft.shippedCarMode = "fixed";
    draft.shippedCar = centsToInput(deal.shippedCar.centsEach);
  }
  if (deal.parking?.mode === "perCar") {
    draft.parkingMode = "perCar";
    draft.parkingCents = centsToInput(deal.parking.centsEach);
  } else if (deal.parking?.mode === "percent") {
    draft.parkingMode = "percent";
    draft.parkingPct = bpsToInput(deal.parking.bps);
  }
  if (deal.itemSold) {
    draft.itemMode = "fixed";
    draft.item = centsToInput(deal.itemSold.centsEach);
  }
  if (deal.bankConnection) {
    draft.bankConnectionMode = "fixed";
    draft.bankConnection = centsToInput(deal.bankConnection.centsEach);
  }
  if (deal.bankCheck) {
    draft.bankCheckMode = "fixed";
    draft.bankCheck = centsToInput(deal.bankCheck.centsEach);
  }
  draft.flat = deal.flatCents > 0 ? centsToInput(deal.flatCents) : "";
  draft.minimum = deal.minimumCents ? centsToInput(deal.minimumCents) : "";
  draft.cap = deal.capCents ? centsToInput(deal.capCents) : "";
  return draft;
}

export type DraftErrors = Partial<Record<DraftField, string>>;

/** English messages; the French come from french-dom.ts. */
export const DRAFT_MESSAGES = {
  amount: "Enter an amount greater than $0.",
  amountOrZero: "Enter an amount of $0 or more.",
  percent: "Enter a percentage above 0 and up to 100.",
  minimumAboveCap: "The monthly minimum cannot be above the cap.",
} as const;

/**
 * The deal a form describes, or the field errors. Blank optional amounts
 * (flat, minimum, cap, the package minimum) mean none.
 */
export function dealFromDraft(draft: DealDraft): { deal: Deal | null; errors: DraftErrors } {
  const errors: DraftErrors = {};
  const deal = emptyDeal();
  const money = (field: DraftField, { optional = false, zero = false } = {}): number | null => {
    const value = String(draft[field] ?? "").trim();
    if (!value && optional) return null;
    const read = readMoneyInput(value);
    const min = zero ? 0 : 1;
    const max = field === "flat" || field === "minimum" || field === "cap" ? MAX_MONTH_CENTS : MAX_UNIT_CENTS;
    if (read.cents === null || read.cents < min || read.cents > max) {
      errors[field] = zero ? DRAFT_MESSAGES.amountOrZero : DRAFT_MESSAGES.amount;
      return null;
    }
    return read.cents;
  };
  const percent = (field: DraftField): number => {
    const bps = percentToBps(String(draft[field] ?? "").trim());
    if (bps === null || bps < 1 || bps > MAX_BPS) {
      errors[field] = DRAFT_MESSAGES.percent;
      return 0;
    }
    return bps;
  };
  if (draft.barrelMode === "fixed") deal.barrel = { centsEach: money("barrel") ?? 0 };
  if (draft.packageMode === "fixed") deal.package = { mode: "fixed", centsEach: money("packageCents") ?? 0 };
  if (draft.packageMode === "percent") {
    deal.package = { mode: "percent", bps: percent("packagePct"), minCents: money("packageMin", { optional: true, zero: true }) ?? 0 };
  }
  if (draft.shippedCarMode === "fixed") deal.shippedCar = { centsEach: money("shippedCar") ?? 0 };
  if (draft.parkingMode === "perCar") deal.parking = { mode: "perCar", centsEach: money("parkingCents") ?? 0 };
  if (draft.parkingMode === "percent") deal.parking = { mode: "percent", bps: percent("parkingPct") };
  if (draft.itemMode === "fixed") deal.itemSold = { centsEach: money("item") ?? 0 };
  if (draft.bankConnectionMode === "fixed") deal.bankConnection = { centsEach: money("bankConnection") ?? 0 };
  if (draft.bankCheckMode === "fixed") deal.bankCheck = { centsEach: money("bankCheck") ?? 0 };
  deal.flatCents = money("flat", { optional: true, zero: true }) ?? 0;
  deal.minimumCents = money("minimum", { optional: true });
  deal.capCents = money("cap", { optional: true });
  if (deal.minimumCents !== null && deal.capCents !== null && deal.minimumCents > deal.capCents && !errors.minimum) {
    errors.minimum = DRAFT_MESSAGES.minimumAboveCap;
  }
  return Object.keys(errors).length > 0 ? { deal: null, errors } : { deal, errors };
}

// ---------------------------------------------------------------------------
// Words. English here; french-dom.ts carries the French.
// ---------------------------------------------------------------------------

export const CHARGE_LABELS: Record<ChargeKey, string> = {
  barrels: "Barrels received",
  packages: "Packages received",
  shippedCars: "Shipped cars",
  parking: "Parked cars",
  itemsSold: "Shop items sold",
  bankConnection: "Bank connection",
  bankChecks: "Bank checks",
};

export const PAYMENT_METHODS: PaymentMethod[] = ["zelle", "cash", "card", "bank_transfer", "check", "other"];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  zelle: "Zelle",
  cash: "Cash",
  card: "Card",
  bank_transfer: "Bank transfer",
  check: "Check",
  other: "Other",
};

export function paymentMethodLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method as PaymentMethod] ?? method;
}

export const STANDING_LABELS: Record<Standing, string> = {
  nothing_owed: "Nothing owed",
  unpaid: "Unpaid",
  partial: "Part paid",
  paid: "Paid",
  overpaid: "Overpaid",
};

export function standingTone(status: Standing): "ok" | "warning" | "danger" | "muted" {
  if (status === "paid") return "ok";
  if (status === "partial" || status === "overpaid") return "warning";
  if (status === "unpaid") return "danger";
  return "muted";
}

export const DRIFT_LABELS: Record<DriftKey, string> = {
  barrels: "Barrels",
  packages: "Packages",
  packagesNoPrice: "Packages with no price",
  packagePriceCents: "Package prices",
  cars: "Shipped cars",
  parkingCars: "Parked cars",
  parkingBilledCents: "Parking billed",
  itemsSold: "Items sold",
  bankConnected: "Bank connected",
  bankRefreshes: "Paid bank refreshes",
  commissionCents: "Commission taken",
};

/** What the server's refusal codes say to a person (English; French in french-dom.ts). */
export const REFUSAL_TEXT: Record<string, string> = {
  billing_view_required: "Only finance admins can read bills.",
  billing_manage_required: "Only super admins can change bills.",
  business_invalid: "Choose a business.",
  business_not_found: "Unknown business.",
  month_invalid: "Choose a month.",
  deal_invalid: "Check the deal and try again.",
  charge_mode_invalid: "Choose how the charge is counted.",
  amount_invalid: "Enter an amount greater than $0.",
  rate_invalid: "Enter a percentage above 0 and up to 100.",
  minimum_invalid: "Enter a minimum of $0 or more.",
  cap_invalid: "Enter a cap greater than $0.",
  minimum_above_cap: "The monthly minimum cannot be above the cap.",
  effective_month_invalid: "Choose the month the deal starts.",
  effective_month_out_of_range: "A deal can start up to 24 months back or 12 months ahead.",
  effective_month_closed: "That month is closed. Start the deal in an open month.",
  deal_history_full: "This business has too many deal changes.",
  note_too_long: "Keep the note under 300 characters.",
  commission_mode_invalid: "Choose keep or replace.",
  paid_on_invalid: "Choose the day it was paid (not in the future).",
  method_invalid: "Choose how it was paid.",
  reason_required: "Say why.",
  month_not_over: "A month can be closed once it is over.",
  month_already_closed: "This month is already closed.",
  month_not_closed: "This month is not closed.",
  payment_exceeds_balance: "That is more than this month still owes.",
  payments_full: "This month has too many payments.",
  bill_incomplete: "Some records are still being counted. Try again in a moment.",
  payment_already_voided: "That payment was already voided.",
  payment_not_found: "Unknown payment.",
};

export const GENERIC_FAILURE = "That did not work. Try again.";

/** A person's message for a failed call: the first refusal code the server named. */
export function refusalMessage(error: unknown): string {
  const details = (error as { details?: { reasons?: unknown } } | null)?.details;
  const reasons = Array.isArray(details?.reasons) ? details.reasons : [];
  for (const code of reasons) {
    const message = REFUSAL_TEXT[String(code)];
    if (message) return message;
  }
  return GENERIC_FAILURE;
}

/** "Barrels" and its terms, as segments a component renders (amounts never translated). */
export type DealSegment = {
  key: ChargeKey | "flat" | "minimum" | "cap";
  label: string;
  cents?: number;
  bps?: number;
  /** Words after the amount: "per barrel", "per car", "of the price", "of parking billed", "a month", "per paid refresh". */
  unit?: string;
  minCents?: number;
};

export const DEAL_LABELS = {
  barrels: "Barrels",
  packages: "Packages",
  shippedCars: "Shipped cars",
  parking: "Parking",
  itemsSold: "Shop items",
  bankConnection: "Bank connection",
  bankChecks: "Bank checks",
  flat: "Flat fee",
  minimum: "Monthly minimum",
  cap: "Monthly cap",
} as const;

export function dealSegments(deal: Deal | null | undefined): DealSegment[] {
  if (!deal) return [];
  const out: DealSegment[] = [];
  if (deal.barrel) out.push({ key: "barrels", label: DEAL_LABELS.barrels, cents: deal.barrel.centsEach, unit: "per barrel" });
  if (deal.package?.mode === "fixed") {
    out.push({ key: "packages", label: DEAL_LABELS.packages, cents: deal.package.centsEach, unit: "per package" });
  } else if (deal.package?.mode === "percent") {
    out.push({
      key: "packages",
      label: DEAL_LABELS.packages,
      bps: deal.package.bps,
      unit: "of the price",
      minCents: deal.package.minCents > 0 ? deal.package.minCents : undefined,
    });
  }
  if (deal.shippedCar) out.push({ key: "shippedCars", label: DEAL_LABELS.shippedCars, cents: deal.shippedCar.centsEach, unit: "per car" });
  if (deal.parking?.mode === "perCar") {
    out.push({ key: "parking", label: DEAL_LABELS.parking, cents: deal.parking.centsEach, unit: "per car" });
  } else if (deal.parking?.mode === "percent") {
    out.push({ key: "parking", label: DEAL_LABELS.parking, bps: deal.parking.bps, unit: "of parking billed" });
  }
  if (deal.itemSold) out.push({ key: "itemsSold", label: DEAL_LABELS.itemsSold, cents: deal.itemSold.centsEach, unit: "per item" });
  if (deal.bankConnection) {
    out.push({ key: "bankConnection", label: DEAL_LABELS.bankConnection, cents: deal.bankConnection.centsEach, unit: "a month with a connected bank" });
  }
  if (deal.bankCheck) out.push({ key: "bankChecks", label: DEAL_LABELS.bankChecks, cents: deal.bankCheck.centsEach, unit: "per paid refresh" });
  if (deal.flatCents > 0) out.push({ key: "flat", label: DEAL_LABELS.flat, cents: deal.flatCents, unit: "a month" });
  if (deal.minimumCents) out.push({ key: "minimum", label: DEAL_LABELS.minimum, cents: deal.minimumCents });
  if (deal.capCents) out.push({ key: "cap", label: DEAL_LABELS.cap, cents: deal.capCents });
  return out;
}

/** "5%" / "2.5%" (French "5 %" / "2,5 %"). */
export function formatBps(bps: number, language: "en" | "fr" = "en"): string {
  const digits = new Intl.NumberFormat(language === "fr" ? "fr-FR" : "en-US", { maximumFractionDigits: 2 }).format(
    Math.round(bps) / 100,
  );
  return language === "fr" ? `${digits} %` : `${digits}%`;
}

/** Whole cents as money in the page's language: "$1,234.50" / "1 234,50 $" (invoice-ledger.ts). */
export function formatCents(cents: number, language: "en" | "fr" = "en"): string {
  return moneyText(cents, language);
}

/** A signed change: "+$12.00" / "−$3.00" / "+3" / "−1". */
export function formatDelta(value: number, kind: "count" | "cents", language: "en" | "fr" = "en"): string {
  const n = Math.round(Number(value) || 0);
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  const body =
    kind === "cents"
      ? formatCents(Math.abs(n), language)
      : new Intl.NumberFormat(language === "fr" ? "fr-FR" : "en-US").format(Math.abs(n));
  return `${sign}${body}`;
}

/** Months a deal may start in, newest last: 24 back to 12 ahead of `current`. */
export function effectiveMonthOptions(current: string, back = 24, ahead = 12): string[] {
  const match = /^(\d{4})-(\d{2})$/.exec(current);
  if (!match) return [];
  const index = Number(match[1]) * 12 + Number(match[2]) - 1;
  const out: string[] = [];
  for (let at = index - back; at <= index + ahead; at += 1) {
    const year = Math.floor(at / 12);
    out.push(`${String(year).padStart(4, "0")}-${String(at - year * 12 + 1).padStart(2, "0")}`);
  }
  return out;
}

/** Whether a month has ended (it can be closed): strictly before the current one. */
export function monthIsOver(month: string, current: string): boolean {
  return /^\d{4}-\d{2}$/.test(month) && /^\d{4}-\d{2}$/.test(current) && month < current;
}

/** Today in New York as "yyyy-mm-dd" (the payment form's default and limit). */
export function todayInNewYork(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

/** The record-payment form's checks (the server repeats them). */
export function paymentDraftErrors(
  draft: { amount: string; paidOn: string; method: string; note: string },
  today: string,
): { amount?: string; paidOn?: string; method?: string; note?: string } {
  const errors: { amount?: string; paidOn?: string; method?: string; note?: string } = {};
  const read = readMoneyInput(draft.amount);
  if (read.cents === null || read.cents < 1 || read.cents > MAX_MONTH_CENTS) errors.amount = DRAFT_MESSAGES.amount;
  const day = draft.paidOn;
  const date = new Date(`${day}T00:00:00Z`);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day;
  if (!valid || day < "2020-01-01" || day > today) errors.paidOn = REFUSAL_TEXT.paid_on_invalid;
  if (!PAYMENT_METHODS.includes(draft.method as PaymentMethod)) errors.method = REFUSAL_TEXT.method_invalid;
  if (draft.note.trim().length > MAX_NOTE) errors.note = REFUSAL_TEXT.note_too_long;
  return errors;
}
