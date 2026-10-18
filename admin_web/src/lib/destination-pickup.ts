/**
 * Where customers collect their goods in one destination country: the
 * optional pickup city, address and phone on a business destination
 * (businesses/{id}/destinationCountries/{country}). The ready-for-pickup
 * WhatsApp message gives them.
 *
 * Mirrors my_flutter_app/functions/destination_pickup.js, which is the
 * authority: the console checks first so the owner sees the reason next to
 * the field, then saves through the `setDestinationPickup` callable. The app
 * has the same rules in lib/services/destination_pickup.dart.
 */

export const PICKUP_LIMITS = {
  pickupCity: 80,
  pickupAddress: 200,
} as const;

export type DestinationPickupDraft = {
  pickupCity: string;
  pickupAddress: string;
  pickupPhone: string;
};

export const emptyDestinationPickupDraft: DestinationPickupDraft = {
  pickupCity: "",
  pickupAddress: "",
  pickupPhone: "",
};

const PHONE_FORMATTING = /[\s().-]/g;
// E.164, the form the shared phone picker stores and WhatsApp can reach.
const E164 = /^\+[1-9]\d{7,14}$/;

function oneLine(value: unknown): string {
  return String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

/** The E.164 form of a phone, or "" when it is not one. */
export function e164Phone(value: unknown): string {
  const compact = oneLine(value).replace(PHONE_FORMATTING, "");
  return E164.test(compact) ? compact : "";
}

/** The form's starting values for a stored destination. */
export function destinationPickupDraft(
  row: Record<string, unknown> | null | undefined,
): DestinationPickupDraft {
  return {
    pickupCity: oneLine(row?.pickupCity),
    pickupAddress: oneLine(row?.pickupAddress),
    pickupPhone: oneLine(row?.pickupPhone),
  };
}

/** What the callable is sent: each field on one line, the phone in E.164. */
export function destinationPickupPayload(
  draft: DestinationPickupDraft,
): DestinationPickupDraft {
  const phone = oneLine(draft.pickupPhone);
  return {
    pickupCity: oneLine(draft.pickupCity),
    pickupAddress: oneLine(draft.pickupAddress),
    pickupPhone: phone ? e164Phone(phone) || phone : "",
  };
}

export type DestinationPickupErrors = Partial<
  Record<keyof DestinationPickupDraft, string>
>;

/** Each field's reason, in the server's words; empty when it can be saved. */
export function destinationPickupErrors(
  draft: DestinationPickupDraft,
): DestinationPickupErrors {
  const value = destinationPickupPayload(draft);
  const errors: DestinationPickupErrors = {};
  if (value.pickupCity.length > PICKUP_LIMITS.pickupCity) {
    errors.pickupCity =
      `The pickup city can be at most ${PICKUP_LIMITS.pickupCity} characters.`;
  }
  if (value.pickupAddress.length > PICKUP_LIMITS.pickupAddress) {
    errors.pickupAddress =
      `The pickup address can be at most ${PICKUP_LIMITS.pickupAddress} characters.`;
  }
  if (value.pickupPhone && !e164Phone(value.pickupPhone)) {
    errors.pickupPhone =
      "The pickup phone needs its country code, like +224 620 00 00 00.";
  }
  return errors;
}

/** Whether the form changed what is stored (so the callable is needed). */
export function destinationPickupChanged(
  row: Record<string, unknown> | null | undefined,
  draft: DestinationPickupDraft,
): boolean {
  const before = destinationPickupPayload(destinationPickupDraft(row));
  const after = destinationPickupPayload(draft);
  return (
    before.pickupCity !== after.pickupCity ||
    before.pickupAddress !== after.pickupAddress ||
    before.pickupPhone !== after.pickupPhone
  );
}

/** "Conakry · Madina, near the market · +224620000000", or "" for none. */
export function destinationPickupSummary(
  row: Record<string, unknown> | null | undefined,
): string {
  const value = destinationPickupDraft(row);
  return [value.pickupCity, value.pickupAddress, value.pickupPhone]
    .filter(Boolean)
    .join(" · ");
}
