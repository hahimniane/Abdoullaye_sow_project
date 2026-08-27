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

/** A price list nobody can read is not a price list. */
export const MAX_DELIVERY_AREAS = 40;
export const MAX_AREA_NAME_LENGTH = 60;

export type DeliveryArea = {
  id: string;
  name: string;
  fee: number;
  feeCents: number;
};

export type DeliveryPolicy = {
  offered: boolean;
  areas: DeliveryArea[];
  fee: number;
  feeCents: number;
};

type DeliveryLike = {
  freightDestinationDeliveryAvailable?: unknown;
  freightDestinationDeliveryFee?: unknown;
  freightDestinationDeliveryAreas?: unknown;
};

/** A stable id for an area, derived from what the business typed. */
export function deliveryAreaId(name: string): string {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * The places a business delivers to at one destination, and what each costs.
 *
 * Named areas rather than one number per country, because that is how this
 * trade quotes it: Cosa is $20, Koloma is $10. A single fee per country
 * either overcharges the neighbourhood next door to the office or loses
 * money on the one an hour away.
 */
export function freightDeliveryAreas(
  option: DeliveryLike | null | undefined,
): DeliveryArea[] {
  const raw = Array.isArray(option?.freightDestinationDeliveryAreas)
    ? option.freightDestinationDeliveryAreas
    : [];
  const areas: DeliveryArea[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const row = (entry ?? {}) as {id?: unknown; name?: unknown; fee?: unknown};
    const name = String(row.name || "").trim();
    const id = String(row.id || "").trim() || deliveryAreaId(name);
    const fee = Number(row.fee) || 0;
    if (!id || !name || fee <= 0 || seen.has(id)) continue;
    seen.add(id);
    areas.push({id, name, fee, feeCents: Math.round(fee * 100)});
  }
  return areas;
}

/**
 * What is published about delivering at one destination. Opted in but
 * priced nowhere is an unfinished setting, not free delivery.
 *
 * One flat fee is what a destination priced before areas existed. It still
 * works, as a single unnamed price for anywhere in that country; a named
 * list wins over it whenever there is one.
 */
export function freightDeliveryPolicy(
  option: DeliveryLike | null | undefined,
): DeliveryPolicy {
  const enabled = option?.freightDestinationDeliveryAvailable === true;
  const areas = freightDeliveryAreas(option);
  const flatFee = Number(option?.freightDestinationDeliveryFee) || 0;
  const offered = enabled && (areas.length > 0 || flatFee > 0);
  return {
    offered,
    areas: offered ? areas : [],
    fee: offered && areas.length === 0 ? flatFee : 0,
    feeCents: offered && areas.length === 0 ? Math.round(flatFee * 100) : 0,
  };
}

/** What one booking's delivery costs, once a place has been picked. */
export function deliveryFeeFor(
  policy: DeliveryPolicy,
  areaId: string,
): number {
  if (!policy.offered) return 0;
  if (policy.areas.length === 0) return policy.fee;
  return policy.areas.find((area) => area.id === areaId)?.fee ?? 0;
}

/**
 * Whether a delivery choice is complete enough to book. An address is the
 * whole point of the option, so it is required rather than optional, and a
 * destination that prices by place needs to know which one.
 */
export function deliveryChoiceIsComplete({
  wantsDelivery,
  receiverAddress,
  areas = [],
  areaId = "",
}: {
  wantsDelivery: boolean;
  receiverAddress: string;
  areas?: readonly DeliveryArea[];
  areaId?: string;
}): boolean {
  if (!wantsDelivery) return true;
  const address = String(receiverAddress || "").trim();
  if (address.length === 0 || address.length > MAX_RECEIVER_ADDRESS_LENGTH) {
    return false;
  }
  // Where the parcel is going decides the fee, so an unnamed place on a
  // destination priced by place is a booking that cannot be priced.
  if (areas.length === 0) return true;
  return areas.some((area) => area.id === areaId);
}

/**
 * Why the callable would refuse a delivery, in the reader's own words.
 *
 * Mirrors FREIGHT_DELIVERY_ERRORS in the authority module, so a refusal
 * reads the same whether this console caught it or the server did.
 */
export const FREIGHT_DELIVERY_ERRORS: Record<string, string> = {
  fee_out_of_range:
    `A delivery fee must be between $0 and $${MAX_DESTINATION_DELIVERY_FEE}.`,
  fee_required: "Add somewhere you deliver to, or turn delivery off.",
  area_name_required: "Every place you deliver to needs a name.",
  too_many_areas: `You can list up to ${MAX_DELIVERY_AREAS} places.`,
  area_duplicated: "Two places on the list share the same name.",
  delivery_area_required: "Choose where the parcel is being delivered to.",
};

export function freightDeliveryErrorMessage(code: unknown): string {
  const key = String(code || "");
  return FREIGHT_DELIVERY_ERRORS[key] ?? FREIGHT_DELIVERY_ERRORS.fee_required;
}

export type DeliveryAreaDraft = {
  id: string;
  name: string;
  fee: string;
};

export function emptyDeliveryArea(): DeliveryAreaDraft {
  return {id: "", name: "", fee: ""};
}

/**
 * The line a business's own settings error should read as.
 *
 * The order is the server's: the list is judged first, then the single price
 * that stands in for it, then the case where neither says anything.
 */
export function deliverySettingsError({
  available,
  areas = [],
  fee,
}: {
  available: boolean;
  areas?: readonly DeliveryAreaDraft[];
  fee: number;
}): string {
  if (!available) return "";
  const listed = areas.filter(
    (area) => area.name.trim() || area.fee.trim(),
  );
  if (listed.length > MAX_DELIVERY_AREAS) {
    return FREIGHT_DELIVERY_ERRORS.too_many_areas;
  }
  const seen = new Set<string>();
  for (const area of listed) {
    const name = area.name.trim().slice(0, MAX_AREA_NAME_LENGTH);
    const id = deliveryAreaId(area.id || name);
    if (!name || !id) return FREIGHT_DELIVERY_ERRORS.area_name_required;
    if (seen.has(id)) return FREIGHT_DELIVERY_ERRORS.area_duplicated;
    seen.add(id);
    const amount = Number(area.fee);
    if (
      area.fee.trim() === "" ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      amount > MAX_DESTINATION_DELIVERY_FEE
    ) {
      return FREIGHT_DELIVERY_ERRORS.fee_out_of_range;
    }
  }
  const hasFlat = Number.isFinite(fee) && fee > 0;
  if (hasFlat && fee > MAX_DESTINATION_DELIVERY_FEE) {
    return FREIGHT_DELIVERY_ERRORS.fee_out_of_range;
  }
  if (listed.length === 0 && !hasFlat) {
    return FREIGHT_DELIVERY_ERRORS.fee_required;
  }
  return "";
}

/**
 * The cleaned list to write onto the destination document. Only called once
 * `deliverySettingsError` has already passed, so nothing here is refused -
 * it rounds and slugs what the business typed.
 */
export function deliveryAreasPayload(
  areas: readonly DeliveryAreaDraft[],
): Array<{id: string; name: string; fee: number}> {
  const cleaned: Array<{id: string; name: string; fee: number}> = [];
  const seen = new Set<string>();
  for (const area of areas) {
    const name = area.name.trim().slice(0, MAX_AREA_NAME_LENGTH);
    const id = deliveryAreaId(area.id || name);
    const fee = Number(area.fee);
    if (!id || !name || !Number.isFinite(fee) || fee <= 0) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    cleaned.push({id, name, fee: Math.round(fee * 100) / 100});
  }
  return cleaned.slice(0, MAX_DELIVERY_AREAS);
}

/** The stored list, back into rows the destination editor can hold. */
export function deliveryAreaDraftsFrom(value: unknown): DeliveryAreaDraft[] {
  return freightDeliveryAreas({
    freightDestinationDeliveryAreas: value,
  }).map((area) => ({
    id: area.id,
    name: area.name,
    fee: String(area.fee),
  }));
}
