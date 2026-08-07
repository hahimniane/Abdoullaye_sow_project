import type { FirestoreRow } from "@/types/admin";

export type BusinessEarningsSummary = {
  totals: {
    grossReceived: number;
    platformFees: number;
    businessEarnings: number;
    pendingGross: number;
    paidTransactions: number;
    pendingTransactions: number;
  };
  services: BusinessEarningsServiceRow[];
};

export type BusinessEarningsServiceRow = {
  serviceId: string;
  label: string;
  grossReceived: number;
  platformFees: number;
  businessEarnings: number;
  pendingGross: number;
  paidTransactions: number;
  pendingTransactions: number;
};

/**
 * The five services a record can belong to. Exported so the platform-wide
 * aggregation (platform-earnings.ts) speaks the same vocabulary instead of
 * inventing a second set of ids for the same five things.
 */
export const EARNINGS_SERVICE_LABELS: Record<string, string> = {
  barrelShipping: "Barrel shipping",
  freight: "Freight",
  carSales: "Car sales",
  carTransport: "Car transport",
  carParking: "Car parking",
};

const SERVICE_LABELS = EARNINGS_SERVICE_LABELS;

const PAID_STATUSES = new Set([
  "paid",
  "succeeded",
  "completed",
  "collected",
  "released",
]);
const PENDING_STATUSES = new Set([
  "pending",
  "pending_payment",
  "processing",
  "requires_payment_method",
  "requires_confirmation",
]);

function numericValue(value: unknown) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

/**
 * Reads a money field in dollars, preferring the cents variant. Exported so
 * every earnings reader resolves the same field precedence.
 */
export function centsOrDollars(row: FirestoreRow, centFields: string[], dollarFields: string[]) {
  for (const field of centFields) {
    const cents = numericValue(row[field]);
    if (cents > 0) return cents / 100;
  }
  for (const field of dollarFields) {
    const amount = numericValue(row[field]);
    if (amount > 0) return amount;
  }
  return 0;
}

function normalizedStatus(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function paymentState(row: FirestoreRow) {
  const statuses = [
    row.paymentStatus,
    row.status,
    row.purchaseStatus,
    row.payoutStatus,
  ].map(normalizedStatus).filter(Boolean);
  if (statuses.some((status) => PAID_STATUSES.has(status))) return "paid";
  if (statuses.some((status) => PENDING_STATUSES.has(status))) return "pending";
  return "unpaid";
}

function serviceRow(serviceId: string): BusinessEarningsServiceRow {
  return {
    serviceId,
    label: SERVICE_LABELS[serviceId] ?? serviceId,
    grossReceived: 0,
    platformFees: 0,
    businessEarnings: 0,
    pendingGross: 0,
    paidTransactions: 0,
    pendingTransactions: 0,
  };
}

function addTransaction(
  service: BusinessEarningsServiceRow,
  row: FirestoreRow,
  gross: number,
  platformFee: number,
  businessEarning: number,
) {
  const state = paymentState(row);
  if (state === "paid") {
    service.grossReceived += gross;
    service.platformFees += platformFee;
    service.businessEarnings += businessEarning;
    service.paidTransactions += 1;
    return;
  }
  if (state === "pending") {
    service.pendingGross += gross;
    service.pendingTransactions += 1;
  }
}

function businessPayoutAmount(row: FirestoreRow, gross: number, platformFee: number) {
  const explicit = centsOrDollars(
    row,
    ["businessPayoutCents", "businessPayoutAmountCents"],
    ["businessPayoutAmount"],
  );
  if (explicit > 0) return explicit;
  return Math.max(0, gross - platformFee);
}

/**
 * The platform's cut on one record, in dollars.
 *
 * Precedence, in order: an explicit fee in cents (`platformFeeCents`, or the
 * legacy `platformCommissionCents`), an explicit fee in dollars, then a rate
 * (`platformFeePct` / legacy `platformCommissionRate`) applied to the gross.
 * Exported so the platform-wide roll-up cannot drift from this rule.
 *
 * @param row The record.
 * @param gross The record's gross, in dollars.
 * @return The platform fee in dollars; 0 when the record carries none.
 */
export function platformFeeAmount(row: FirestoreRow, gross: number) {
  const explicit = centsOrDollars(
    row,
    ["platformFeeCents", "platformCommissionCents"],
    ["platformFeeAmount", "platformCommissionAmount"],
  );
  if (explicit > 0) return explicit;
  const pct = numericValue(row.platformFeePct ?? row.platformCommissionRate);
  if (pct > 0 && pct < 1) return gross * pct;
  return 0;
}

/** One billable line: a service, the row whose money fields describe it, and its gross in dollars. */
export type EarningsLineItem = {
  serviceId: string;
  /**
   * The row to read money and payment status from. For most records this is
   * the stored document; for a hold extension and for unsettled v2 freight it
   * is a derived view of it (see earningsLineItems).
   */
  row: FirestoreRow;
  /** The stored document the line came from — its id, business and dates. */
  source: FirestoreRow;
  /** Gross in dollars. */
  gross: number;
};

export type EarningsRecordInput = {
  purchases: FirestoreRow[];
  shipments: FirestoreRow[];
  freightShipments: FirestoreRow[];
  transports: FirestoreRow[];
  parkedCars: FirestoreRow[];
};

/**
 * Flattens the raw record arrays into billable lines.
 *
 * This is the single place that knows which money field belongs to which
 * service, that a paid hold extension is a second car-sales line on the same
 * purchase, and that v2 freight is only real money once its price is settled.
 * Both the per-business summary and the platform-wide roll-up fold over this
 * so they cannot disagree about what a record is worth.
 *
 * @param input The record arrays, each optional-safe.
 * @return Every line with a positive gross.
 */
export function earningsLineItems(input: Partial<EarningsRecordInput>): EarningsLineItem[] {
  const items: EarningsLineItem[] = [];
  const push = (serviceId: string, source: FirestoreRow, row: FirestoreRow, gross: number) => {
    if (!Number.isFinite(gross) || gross <= 0) return;
    items.push({ serviceId, row, source, gross });
  };
  const list = (rows: FirestoreRow[] | undefined) =>
    Array.isArray(rows) ? rows.filter((row): row is FirestoreRow => Boolean(row) && typeof row === "object") : [];

  list(input.purchases).forEach((row) => {
    push(
      "carSales",
      row,
      row,
      centsOrDollars(
        row,
        ["depositAmountCents", "amountCents"],
        ["depositAmount", "amount", "price", "listingPrice"],
      ),
    );
    const extensionGross = centsOrDollars(
      row,
      ["extensionExtraAmountCents"],
      ["extensionExtraAmount"],
    );
    if (extensionGross > 0) {
      push("carSales", row, {
        ...row,
        paymentStatus: row.extensionPaymentStatus,
        platformFeeCents: row.extensionPlatformFeeCents,
        businessPayoutCents: row.extensionBusinessPayoutCents,
        platformFeePct: row.extensionPlatformFeePct,
      }, extensionGross);
    }
  });

  list(input.shipments).forEach((row) => {
    push(
      "barrelShipping",
      row,
      row,
      centsOrDollars(row, ["totalCents", "priceCents", "amountCents"], ["total", "price", "amount"]),
    );
  });

  list(input.freightShipments).forEach((row) => {
    const versionTwo = numericValue(row.freightPricingVersion) >= 2;
    const settled = normalizedStatus(row.priceSettlementStatus) === "settled";
    const freightRow = versionTwo && !settled
      ? { ...row, paymentStatus: "pending", payoutStatus: "pending" }
      : row;
    push(
      "freight",
      row,
      freightRow,
      versionTwo
        ? settled
          ? centsOrDollars(row, ["finalTotalCents"], ["finalTotal"])
          : centsOrDollars(row, ["estimatedTotalCents"], ["estimatedTotal"])
        : centsOrDollars(row, ["totalCents", "priceCents", "amountCents"], ["total", "price", "amount"]),
    );
  });

  list(input.transports).forEach((row) => {
    push(
      "carTransport",
      row,
      row,
      centsOrDollars(row, ["totalCents", "priceCents", "amountCents"], ["totalCost", "price", "quoteAmount", "amount"]),
    );
  });

  list(input.parkedCars).forEach((row) => {
    push(
      "carParking",
      row,
      row,
      centsOrDollars(row, ["totalCostCents", "totalCents", "amountCents"], ["totalCost", "price", "amount"]),
    );
  });

  return items;
}

export function summarizeBusinessEarnings(input: EarningsRecordInput): BusinessEarningsSummary {
  const services = new Map<string, BusinessEarningsServiceRow>();
  for (const serviceId of Object.keys(SERVICE_LABELS)) {
    services.set(serviceId, serviceRow(serviceId));
  }

  earningsLineItems(input).forEach((item) => {
    const service = services.get(item.serviceId) ?? serviceRow(item.serviceId);
    const platformFee = platformFeeAmount(item.row, item.gross);
    addTransaction(
      service,
      item.row,
      item.gross,
      platformFee,
      businessPayoutAmount(item.row, item.gross, platformFee),
    );
    services.set(item.serviceId, service);
  });

  const rows = Array.from(services.values());
  const totals = rows.reduce(
    (sum, row) => ({
      grossReceived: sum.grossReceived + row.grossReceived,
      platformFees: sum.platformFees + row.platformFees,
      businessEarnings: sum.businessEarnings + row.businessEarnings,
      pendingGross: sum.pendingGross + row.pendingGross,
      paidTransactions: sum.paidTransactions + row.paidTransactions,
      pendingTransactions: sum.pendingTransactions + row.pendingTransactions,
    }),
    {
      grossReceived: 0,
      platformFees: 0,
      businessEarnings: 0,
      pendingGross: 0,
      paidTransactions: 0,
      pendingTransactions: 0,
    },
  );
  return {totals, services: rows};
}
