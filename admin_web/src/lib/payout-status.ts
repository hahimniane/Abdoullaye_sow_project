export type BusinessPayoutStatusState =
  | "not_connected"
  | "connected_pending"
  | "ready";

export type BusinessPayoutStatus = {
  state: BusinessPayoutStatusState;
  stripeAccountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  primaryLabel: string;
  chargesLabel: string;
  actionLabel: string;
  refreshLabel: string;
  helperText: string;
};

type PayoutStatusInput = {
  stripeAccountId?: unknown;
  chargesEnabled?: unknown;
  payoutsEnabled?: unknown;
};

function stringValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export function resolveBusinessPayoutStatus(input: PayoutStatusInput): BusinessPayoutStatus {
  const stripeAccountId = stringValue(input.stripeAccountId);
  const chargesEnabled = input.chargesEnabled === true;
  const payoutsEnabled = chargesEnabled && input.payoutsEnabled === true;

  if (!stripeAccountId) {
    return {
      state: "not_connected",
      stripeAccountId,
      chargesEnabled,
      payoutsEnabled,
      primaryLabel: "Payout setup required",
      chargesLabel: chargesEnabled ? "Charges verified" : "Charges not verified",
      actionLabel: "Start Stripe registration",
      refreshLabel: "Refresh status",
      helperText: "Register with Stripe so Laawol can verify the business and send payouts securely.",
    };
  }

  if (!payoutsEnabled) {
    return {
      state: "connected_pending",
      stripeAccountId,
      chargesEnabled,
      payoutsEnabled,
      primaryLabel: "Connected, pending verification",
      chargesLabel: chargesEnabled ? "Charges verified" : "Charges not verified",
      actionLabel: "Continue in Stripe",
      refreshLabel: "Refresh status",
      helperText: "A Stripe payout account is connected. Stripe may still be checking the bank account or requesting more details before payouts can start.",
    };
  }

  return {
    state: "ready",
    stripeAccountId,
    chargesEnabled,
    payoutsEnabled,
    primaryLabel: "Payouts enabled",
    chargesLabel: "Charges verified",
    actionLabel: "Refresh status",
    refreshLabel: "Refresh status",
    helperText: "",
  };
}
