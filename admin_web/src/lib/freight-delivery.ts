/**
 * Delivering the parcel to the receiver's own address at the destination,
 * instead of the receiver collecting it from the business there.
 *
 * Mirror of my_flutter_app/functions/freight_delivery.js (the authority)
 * and my_flutter_app/lib/utils/freight_delivery.dart. The server re-prices
 * every booking, so a drifted mirror shows a wrong preview only until the
 * callable answers.
 */

export const MAX_DESTINATION_DELIVERY_FEE = 500;
export const MAX_RECEIVER_ADDRESS_LENGTH = 300;

export type DeliveryPolicy = {
  offered: boolean;
  fee: number;
  feeCents: number;
};

type DeliveryLike = {
  freightDestinationDeliveryAvailable?: unknown;
  freightDestinationDeliveryFee?: unknown;
};

/**
 * What a business publishes about delivering at the destination. Opted in
 * but unpriced is an unfinished setting, not free delivery.
 */
export function freightDeliveryPolicy(
  option: DeliveryLike | null | undefined,
): DeliveryPolicy {
  const offered = option?.freightDestinationDeliveryAvailable === true;
  const fee = Number(option?.freightDestinationDeliveryFee) || 0;
  const live = offered && fee > 0;
  return {
    offered: live,
    fee: live ? fee : 0,
    feeCents: live ? Math.round(fee * 100) : 0,
  };
}

/**
 * Whether a delivery choice is complete enough to book. An address is the
 * whole point of the option, so it is required rather than optional.
 */
export function deliveryChoiceIsComplete({
  wantsDelivery,
  receiverAddress,
}: {
  wantsDelivery: boolean;
  receiverAddress: string;
}): boolean {
  if (!wantsDelivery) return true;
  const address = String(receiverAddress || "").trim();
  return address.length > 0 && address.length <= MAX_RECEIVER_ADDRESS_LENGTH;
}

/** The line a business's own settings error should read as. */
export function deliverySettingsError({
  available,
  fee,
}: {
  available: boolean;
  fee: number;
}): string {
  if (!available) return "";
  if (!Number.isFinite(fee) || fee <= 0) {
    return "Set a delivery fee, or turn destination delivery off.";
  }
  if (fee > MAX_DESTINATION_DELIVERY_FEE) {
    return `The delivery fee must be between $0 and ` +
      `$${MAX_DESTINATION_DELIVERY_FEE}.`;
  }
  return "";
}
