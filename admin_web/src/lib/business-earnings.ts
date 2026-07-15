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

const SERVICE_LABELS: Record<string, string> = {
  barrelShipping: "Barrel shipping",
  freight: "Freight",
  carSales: "Car sales",
  carTransport: "Car transport",
  carParking: "Car parking",
};

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

function centsOrDollars(row: FirestoreRow, centFields: string[], dollarFields: string[]) {
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

function platformFeeAmount(row: FirestoreRow, gross: number) {
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

export function summarizeBusinessEarnings({
  purchases,
  shipments,
  freightShipments,
  transports,
  parkedCars,
}: {
  purchases: FirestoreRow[];
  shipments: FirestoreRow[];
  freightShipments: FirestoreRow[];
  transports: FirestoreRow[];
  parkedCars: FirestoreRow[];
}): BusinessEarningsSummary {
  const services = new Map<string, BusinessEarningsServiceRow>();
  for (const serviceId of Object.keys(SERVICE_LABELS)) {
    services.set(serviceId, serviceRow(serviceId));
  }

  const add = (serviceId: string, row: FirestoreRow, gross: number) => {
    if (gross <= 0) return;
    const service = services.get(serviceId) ?? serviceRow(serviceId);
    const platformFee = platformFeeAmount(row, gross);
    addTransaction(
      service,
      row,
      gross,
      platformFee,
      businessPayoutAmount(row, gross, platformFee),
    );
    services.set(serviceId, service);
  };

  purchases.forEach((row) => {
    const gross = centsOrDollars(
      row,
      ["depositAmountCents", "amountCents"],
      ["depositAmount", "amount", "price", "listingPrice"],
    );
    add("carSales", row, gross);
    const extensionGross = centsOrDollars(
      row,
      ["extensionExtraAmountCents"],
      ["extensionExtraAmount"],
    );
    if (extensionGross > 0) {
      const extensionRow = {
        ...row,
        paymentStatus: row.extensionPaymentStatus,
        platformFeeCents: row.extensionPlatformFeeCents,
        businessPayoutCents: row.extensionBusinessPayoutCents,
        platformFeePct: row.extensionPlatformFeePct,
      };
      add("carSales", extensionRow, extensionGross);
    }
  });

  shipments.forEach((row) => {
    add(
      "barrelShipping",
      row,
      centsOrDollars(row, ["totalCents", "priceCents", "amountCents"], ["total", "price", "amount"]),
    );
  });
  freightShipments.forEach((row) => {
    const versionTwo = numericValue(row.freightPricingVersion) >= 2;
    const settled = normalizedStatus(row.priceSettlementStatus) === "settled";
    const freightRow = versionTwo && !settled
      ? { ...row, paymentStatus: "pending", payoutStatus: "pending" }
      : row;
    add(
      "freight",
      freightRow,
      versionTwo
        ? settled
          ? centsOrDollars(row, ["finalTotalCents"], ["finalTotal"])
          : centsOrDollars(row, ["estimatedTotalCents"], ["estimatedTotal"])
        : centsOrDollars(row, ["totalCents", "priceCents", "amountCents"], ["total", "price", "amount"]),
    );
  });
  transports.forEach((row) => {
    add(
      "carTransport",
      row,
      centsOrDollars(row, ["totalCents", "priceCents", "amountCents"], ["totalCost", "price", "quoteAmount", "amount"]),
    );
  });
  parkedCars.forEach((row) => {
    add(
      "carParking",
      row,
      centsOrDollars(row, ["totalCostCents", "totalCents", "amountCents"], ["totalCost", "price", "amount"]),
    );
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
