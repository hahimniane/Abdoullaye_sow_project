/**
 * Subscription billing, console side — the flat-monthly-fee alternative to
 * per-transaction commission. A deliberate mirror of the server's pure module
 * `my_flutter_app/functions/business_billing_plan.js`; the admin settings panel
 * uses it to resolve, preview, and edit a business's plan. Validated by
 * business-billing-plan.test.ts. No Firebase or React imports.
 */

export const BILLING_MODES = ["commission", "subscription"] as const;
export type BillingMode = (typeof BILLING_MODES)[number];
export const DEFAULT_BILLING_MODE: BillingMode = "commission";

export const STRIPE_PCT = 0.029;
export const STRIPE_FIXED_CENTS = 30;

export type BillingPlan = { mode: BillingMode; monthlyFeeCents: number };
export type ResolvedBillingPlan = BillingPlan & {
  source: "service" | "business" | "default";
};

type BusinessDoc = {
  billingPlan?: unknown;
  serviceBillingPlan?: Record<string, unknown>;
};

/** Dollars as typed ("50", "$1,200.00") to whole cents, or null. */
export function feeDollarsToCents(value: unknown): number | null {
  const raw = String(value ?? "").trim().replace(/[$,\s]/g, "");
  if (raw === "") return null;
  if (!/^\d*(\.\d{0,2})?$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function formatCents(cents: number): string {
  const n = Number(cents) || 0;
  return `$${(Math.abs(n) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function estimateStripeFeeCents(grossCents: number): number {
  const gross = Math.max(0, Math.round(Number(grossCents) || 0));
  if (gross === 0) return 0;
  return Math.round(gross * STRIPE_PCT) + STRIPE_FIXED_CENTS;
}

/** Normalize a stored plan; a subscription with no positive fee is invalid. */
export function normalizeBillingPlan(raw: unknown): BillingPlan | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { mode?: unknown; monthlyFeeCents?: unknown };
  const mode = String(r.mode ?? "").trim();
  if (!(BILLING_MODES as readonly string[]).includes(mode)) return null;
  if (mode === "commission") return { mode: "commission", monthlyFeeCents: 0 };
  const fee = Math.round(Number(r.monthlyFeeCents) || 0);
  if (!Number.isFinite(fee) || fee <= 0) return null;
  return { mode: "subscription", monthlyFeeCents: fee };
}

/** Per-service plan → business-wide plan → plain commission. */
export function resolveBillingPlan(
  business: BusinessDoc | null | undefined,
  serviceKey = "",
): ResolvedBillingPlan {
  const perService = business?.serviceBillingPlan;
  if (perService && typeof perService === "object" && serviceKey) {
    const plan = normalizeBillingPlan(perService[serviceKey]);
    if (plan) return { ...plan, source: "service" };
  }
  const wide = normalizeBillingPlan(business?.billingPlan);
  if (wide) return { ...wide, source: "business" };
  return { mode: DEFAULT_BILLING_MODE, monthlyFeeCents: 0, source: "default" };
}

export function isSubscriptionBilled(
  business: BusinessDoc | null | undefined,
  serviceKey = "",
): boolean {
  return resolveBillingPlan(business, serviceKey).mode === "subscription";
}

/** The month-end amount and which side won — "pay whichever is smaller". */
export function monthEndBillingAmount(params: {
  accruedCommissionCents: number;
  accruedStripeFeeCents: number;
  monthlyFeeCents: number;
}): {
  amountCents: number;
  basis: "accrued" | "monthly_fee";
  accruedCents: number;
  monthlyFeeCents: number;
} {
  const accrued =
    Math.max(0, Math.round(Number(params.accruedCommissionCents) || 0)) +
    Math.max(0, Math.round(Number(params.accruedStripeFeeCents) || 0));
  const monthly = Math.max(0, Math.round(Number(params.monthlyFeeCents) || 0));
  const useAccrued = accrued < monthly;
  return {
    amountCents: useAccrued ? accrued : monthly,
    basis: useAccrued ? "accrued" : "monthly_fee",
    accruedCents: accrued,
    monthlyFeeCents: monthly,
  };
}

export type BillingPlanError = "billing_fee_required";

/** A subscription plan draft must carry a positive fee. */
export function validateBillingPlanDraft(
  mode: BillingMode,
  feeInput: string,
): BillingPlanError[] {
  if (mode !== "subscription") return [];
  const cents = feeDollarsToCents(feeInput);
  return cents !== null && cents > 0 ? [] : ["billing_fee_required"];
}

/** The object stored on the business doc for a plan (or null to clear it). */
export function billingPlanPayload(
  mode: BillingMode,
  feeInput: string,
): BillingPlan | null {
  if (mode !== "subscription") return { mode: "commission", monthlyFeeCents: 0 };
  const cents = feeDollarsToCents(feeInput) ?? 0;
  return { mode: "subscription", monthlyFeeCents: cents };
}
