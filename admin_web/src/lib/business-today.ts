// The business Today page: what the server counted (getBusinessOverview ->
// my_flutter_app/functions/business_overview.js) turned into the tiles,
// the "Needs attention" rows and the money breakdown the page renders.
//
// Pure and precomputed once per answer: the component maps these lists and
// never re-derives a figure while rendering. Labels are English; the French
// dictionary (french-dom.ts) translates them on a French page.

import type { BusinessTab } from "./business-sidebar.ts";
import { INVOICE_PAYMENT_METHOD_LABELS } from "./invoice-ledger.ts";

export type TodayActivityMonth = {
  pieces: number;
  packages: number;
  barrels: number;
  carsReceived: number;
  carsShipped: number;
  containersShipped: number;
  piecesShipped: number;
};

export type TodayContainer = {
  id: string;
  name: string;
  status: string;
  destination: string;
  destinationCountryId: string;
  pieces: number;
  barrels: number;
  cars: number;
  packages: number;
  lines: number;
  sailedAtMs: number | null;
};

export type TodayMoneyMonth = {
  totalCents: number;
  payments: number;
  byService: Record<string, number>;
  byMethod: Record<string, number>;
};

export type TodayQueueKey =
  | "packageRequests"
  | "waitingPackages"
  | "containersLoading"
  | "barrelOrders"
  | "freightOrders"
  | "carPurchases"
  | "transportRequests"
  | "supportRequests"
  | "openInvoices";

export type TodayViewer = {
  finance?: boolean;
  containers?: boolean;
  barrels?: boolean;
  freight?: boolean;
  transport?: boolean;
  purchases?: boolean;
  listings?: boolean;
  parking?: boolean;
  invoices?: boolean;
  inventory?: boolean;
  support?: boolean;
};

/** What one viewer may see; a figure they may not see (or that failed) is null. */
export type BusinessToday = {
  month: string;
  previousMonth: string;
  timeZone: string;
  viewer: TodayViewer;
  activity: {
    current: TodayActivityMonth;
    previous: TodayActivityMonth;
    change: Partial<Record<keyof TodayActivityMonth, number | null>>;
  } | null;
  containers: { loading: number; atSea: number; list: TodayContainer[]; more: boolean } | null;
  queues: Partial<Record<TodayQueueKey, number | null>>;
  owed: {
    packagesCents: number | null;
    invoicesCents: number | null;
    parkingCents: number | null;
    shopCreditCents: number | null;
    totalCents: number | null;
  };
  money: { current: TodayMoneyMonth; previous: TodayMoneyMonth; change: number | null } | null;
  shop: { current: number; previous: number; change: number | null } | null;
  parking: { inLot: number; reserved: number; spacesTotal: number } | null;
  listings: { active: number } | null;
  unavailable: string[];
};

export type BusinessTodayResponse = {
  today?: BusinessToday | null;
  complete?: boolean;
  computedAtMs?: number;
  cached?: boolean;
};

// ---------------------------------------------------------------------------
// Tiles.
// ---------------------------------------------------------------------------

export type TodayTileKey =
  | "packages"
  | "barrels"
  | "carsShipped"
  | "containers"
  | "collected"
  | "owed"
  | "shopSales"
  | "inLot"
  | "listings";

export type TodayTile = {
  key: TodayTileKey;
  label: string;
  kind: "count" | "money";
  /** Whole count, or cents for money. */
  value: number;
  /** Change against last month in percent; null when there is nothing to compare. */
  change: number | null;
  /** Whether the tile compares with last month at all (a balance does not). */
  compares: boolean;
  /** One short line under the figure: a label and its own figure. */
  note?: { label: string; value: number; kind: "count" | "money" };
  tone: "neutral" | "good" | "money" | "attention";
};

const n = (value: unknown) => {
  const x = Math.round(Number(value));
  return Number.isFinite(x) && x > 0 ? x : 0;
};

/**
 * The month's headline tiles, in reading order: what came in and went out
 * (Volume), the money (owners), then the shop, the lot and the listings -
 * each only when the business runs that service and the viewer may see it.
 */
export function todayTiles(today: BusinessToday | null | undefined): TodayTile[] {
  if (!today) return [];
  const tiles: TodayTile[] = [];
  const activity = today.activity;
  if (activity) {
    tiles.push(
      {
        key: "packages", label: "Packages received", kind: "count", tone: "neutral", compares: true,
        value: n(activity.current.packages), change: activity.change.packages ?? null,
      },
      {
        key: "barrels", label: "Barrels received", kind: "count", tone: "neutral", compares: true,
        value: n(activity.current.barrels), change: activity.change.barrels ?? null,
      },
      {
        key: "carsShipped", label: "Cars shipped", kind: "count", tone: "neutral", compares: true,
        value: n(activity.current.carsShipped), change: activity.change.carsShipped ?? null,
      },
      {
        key: "containers", label: "Containers sailed", kind: "count", tone: "neutral", compares: true,
        value: n(activity.current.containersShipped), change: activity.change.containersShipped ?? null,
        note: today.containers
          ? { label: "Open now", value: n(today.containers.loading) + n(today.containers.atSea), kind: "count" }
          : undefined,
      },
    );
  }
  if (today.money) {
    tiles.push({
      key: "collected", label: "Money collected", kind: "money", tone: "good", compares: true,
      value: n(today.money.current.totalCents), change: today.money.change ?? null,
      note: { label: "Payments", value: n(today.money.current.payments), kind: "count" },
    });
  }
  if (today.owed.totalCents !== null && today.owed.totalCents !== undefined) {
    tiles.push({
      key: "owed", label: "Still owed", kind: "money", tone: "attention", compares: false,
      value: n(today.owed.totalCents), change: null,
    });
  }
  if (today.shop) {
    tiles.push({
      key: "shopSales", label: "Shop sales", kind: "count", tone: "neutral", compares: true,
      value: n(today.shop.current), change: today.shop.change ?? null,
    });
  }
  if (today.parking) {
    tiles.push({
      key: "inLot", label: "Cars in the lot", kind: "count", tone: "neutral", compares: false,
      value: n(today.parking.inLot), change: null,
      note: today.parking.spacesTotal > 0
        ? { label: "Spaces", value: n(today.parking.spacesTotal), kind: "count" }
        : undefined,
    });
  }
  if (today.listings) {
    tiles.push({
      key: "listings", label: "Active listings", kind: "count", tone: "neutral", compares: false,
      value: n(today.listings.active), change: null,
    });
  }
  return tiles;
}

// ---------------------------------------------------------------------------
// Needs attention.
// ---------------------------------------------------------------------------

/** Which list of the Containers tab a row opens on. */
export type TodayContainersView = "requests" | "waiting" | "";

export type TodayAttentionItem = {
  key: string;
  label: string;
  /** How many; null for a balance that is only an amount. */
  count: number | null;
  /** What is owed on it, in cents, when the viewer may see that. */
  amountCents: number | null;
  tab: BusinessTab;
  view: TodayContainersView;
};

type AttentionSpec = {
  key: string;
  label: string;
  tab: BusinessTab;
  view?: TodayContainersView;
  count?: TodayQueueKey;
  amount?: keyof BusinessToday["owed"];
};

// Work first (it has a customer waiting), then money to collect.
const ATTENTION: AttentionSpec[] = [
  { key: "packageRequests", label: "Package requests to answer", tab: "containers", view: "requests", count: "packageRequests" },
  { key: "waitingPackages", label: "Packages waiting for a container", tab: "containers", view: "waiting", count: "waitingPackages" },
  { key: "containersLoading", label: "Containers loading", tab: "containers", count: "containersLoading" },
  { key: "barrelOrders", label: "Open barrel orders", tab: "barrels", count: "barrelOrders" },
  { key: "freightOrders", label: "Open freight orders", tab: "freight", count: "freightOrders" },
  { key: "carPurchases", label: "Car purchases in progress", tab: "purchases", count: "carPurchases" },
  { key: "transportRequests", label: "Open transport requests", tab: "transport", count: "transportRequests" },
  { key: "supportRequests", label: "Support requests", tab: "cases", count: "supportRequests" },
  { key: "packagesOwed", label: "Unpaid package balances", tab: "containers", amount: "packagesCents" },
  { key: "openInvoices", label: "Open invoices", tab: "invoices", count: "openInvoices", amount: "invoicesCents" },
  { key: "parkingOwed", label: "Parking balances due", tab: "parking", amount: "parkingCents" },
  { key: "shopCredit", label: "Shop credit to collect", tab: "inventory", amount: "shopCreditCents" },
];

/**
 * The rows of "Needs attention": only what has something waiting (a count
 * or an amount above zero), each with the tab - and the list on it - that
 * can act on it. Figures the viewer may not see arrive as null and are left
 * out, so a row never links to a tab the viewer cannot open.
 */
export function todayAttention(today: BusinessToday | null | undefined): TodayAttentionItem[] {
  if (!today) return [];
  const items: TodayAttentionItem[] = [];
  for (const spec of ATTENTION) {
    const rawCount = spec.count ? today.queues[spec.count] : undefined;
    const rawAmount = spec.amount ? today.owed[spec.amount] : undefined;
    const count = rawCount === null || rawCount === undefined ? null : n(rawCount);
    const amountCents = rawAmount === null || rawAmount === undefined ? null : n(rawAmount);
    if (!(count && count > 0) && !(amountCents && amountCents > 0)) continue;
    items.push({ key: spec.key, label: spec.label, count, amountCents, tab: spec.tab, view: spec.view ?? "" });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Money.
// ---------------------------------------------------------------------------

export const TODAY_SERVICE_LABELS: Record<string, string> = {
  packages: "Barrels & packages",
  invoices: "Invoices",
  lot: "Lot jobs",
  parking: "Parking",
  shop: "Shop sales",
  online: "Online orders",
};

export const TODAY_METHOD_LABELS: Record<string, string> = {
  ...INVOICE_PAYMENT_METHOD_LABELS,
  online: "Online (card)",
};

export type TodayMoneyRow = {
  key: string;
  label: string;
  cents: number;
  /** Share of the month's total, 0..100 (whole percent, for the bar). */
  percent: number;
};

function moneyRows(values: Record<string, number> | undefined, labels: Record<string, string>, total: number): TodayMoneyRow[] {
  return Object.entries(values ?? {})
    .map(([key, cents]) => ({ key, label: labels[key] ?? labels.other ?? key, cents: n(cents) }))
    .filter((row) => row.cents > 0)
    .sort((a, b) => b.cents - a.cents || a.key.localeCompare(b.key))
    .map((row) => ({ ...row, percent: total > 0 ? Math.max(1, Math.round((row.cents / total) * 100)) : 0 }));
}

/** The month's money by service and by method: non-empty rows, largest first. */
export function todayMoneyBreakdown(month: TodayMoneyMonth | null | undefined) {
  const total = n(month?.totalCents);
  return {
    totalCents: total,
    services: moneyRows(month?.byService, TODAY_SERVICE_LABELS, total),
    methods: moneyRows(month?.byMethod, TODAY_METHOD_LABELS, total),
  };
}

export const TODAY_OWED_ROWS: ReadonlyArray<{
  key: "packagesCents" | "invoicesCents" | "parkingCents" | "shopCreditCents";
  label: string;
}> = [
  { key: "packagesCents", label: "Barrels & packages" },
  { key: "invoicesCents", label: "Invoices" },
  { key: "parkingCents", label: "Parking" },
  { key: "shopCreditCents", label: "Shop credit" },
];

/** What customers owe, by where: only the parts read and above zero. */
export function todayOwedRows(today: BusinessToday | null | undefined): Array<{ key: string; label: string; cents: number }> {
  if (!today) return [];
  return TODAY_OWED_ROWS.map((row) => ({ key: row.key, label: row.label, cents: n(today.owed[row.key]) }))
    .filter((row) => row.cents > 0);
}

/** Whether a money figure was shown with every source read. */
export function todayMoneyComplete(today: BusinessToday | null | undefined): boolean {
  const moneyReads = ["packagePayments", "invoicePayments", "lotPayments", "shopSales", "shopCreditPayments",
    "parking", "barrels", "freight", "transport", "purchases"];
  return !(today?.unavailable ?? []).some((name) => moneyReads.includes(name));
}

/**
 * Cents as US dollars in the page's language: "$1,284" on a tile (whole
 * dollars), "$1,284.50" in a breakdown row. Today's money is always US cents.
 */
export function formatTodayMoney(cents: unknown, language: "en" | "fr" = "en", whole = false): string {
  return new Intl.NumberFormat(language === "fr" ? "fr-FR" : "en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(n(cents) / 100);
}
