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

export type MissingPickupField = "pickupAddress" | "pickupPhone";

/**
 * What a destination still lacks for the ready-for-pickup message to be
 * right: its address, its phone, or both. Empty when it has both. The city
 * is never asked for: the country alone names the place.
 */
export function missingPickupFields(
  row: Record<string, unknown> | null | undefined,
): MissingPickupField[] {
  const missing: MissingPickupField[] = [];
  if (!oneLine(row?.pickupAddress)) missing.push("pickupAddress");
  if (!e164Phone(row?.pickupPhone)) missing.push("pickupPhone");
  return missing;
}

/**
 * The destination to ask about before a container is marked ready for
 * pickup: the business's own destination the container goes to, when it
 * lacks an address or a phone. Null when there is nothing to ask - it has
 * both, the container names no destination, or the destination is not one
 * of the business's (the callable could not save it).
 */
export function pickupAskFor<T extends Record<string, unknown>>(
  container: Record<string, unknown> | null | undefined,
  destinations: readonly T[],
): T | null {
  const id = oneLine(container?.destinationCountryId);
  if (!id) return null;
  const own = destinations.find((row) => oneLine(row.id) === id);
  if (!own) return null;
  return missingPickupFields(own).length > 0 ? own : null;
}

/**
 * The reasons the ask cannot be saved: the form's own, and the two fields
 * it exists to collect.
 */
export function pickupAskErrors(
  draft: DestinationPickupDraft,
): DestinationPickupErrors {
  const errors = destinationPickupErrors(draft);
  const value = destinationPickupPayload(draft);
  if (!value.pickupAddress) errors.pickupAddress = "Add the pickup address.";
  // A phone typed without its country code keeps the message that says so.
  if (!value.pickupPhone && !errors.pickupPhone) errors.pickupPhone = "Add the pickup phone.";
  return errors;
}

/**
 * How many of the business's active destinations have no pickup address or
 * phone: the "Needs attention" row on Today.
 */
export function destinationsMissingPickup(
  rows: ReadonlyArray<Record<string, unknown>>,
): number {
  let count = 0;
  for (const row of rows) {
    if (row.isActive === false) continue;
    if (missingPickupFields(row).length > 0) count += 1;
  }
  return count;
}

/** The label of that Today row. */
export const PICKUP_ATTENTION_LABEL = "Destinations with no pickup place";
