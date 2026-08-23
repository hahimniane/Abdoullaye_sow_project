/**
 * Delivering the parcel to the receiver's own address at the destination,
 * instead of the receiver collecting it from the business there.
 *
 * The fee is flat and published by the business. It is deliberately NOT
 * distance-priced the way origin pickup is: origin pickup geocodes a US
 * address against a US origin, and the destination addresses this serves
 * (Conakry, Dakar, Bamako) do not resolve well enough to price a radius
 * from. A flat number the business chose is one it can actually honour.
 *
 * Authority module. Mirrored by admin_web/src/lib/freight-delivery.ts and
 * my_flutter_app/lib/utils/freight_delivery.dart - the server re-derives
 * the fee at booking regardless, so a drifted mirror shows a wrong preview
 * only until the callable answers.
 */

/** A delivery nobody would honour is worse than no delivery offered. */
const MAX_DESTINATION_DELIVERY_FEE = 500;

/** Enough to reach a person: a line, a city, and something to call. */
const MAX_RECEIVER_ADDRESS_LENGTH = 300;

/** A price list nobody can read is not a price list. */
const MAX_DELIVERY_AREAS = 40;
const MAX_AREA_NAME_LENGTH = 60;

const FREIGHT_DELIVERY_ERRORS = Object.freeze({
  fee_out_of_range: "A delivery fee must be between $0 and " +
    `$${MAX_DESTINATION_DELIVERY_FEE}`,
  fee_required: "Add somewhere you deliver to, or turn delivery off",
  area_name_required: "Every place you deliver to needs a name",
  too_many_areas: `You can list up to ${MAX_DELIVERY_AREAS} places`,
  area_duplicated: "Two places on the list share the same name",
});

/**
 * A stable id for an area, derived from what the business typed.
 *
 * @param {string} name The place name.
 * @return {string} A slug usable as an id.
 */
function deliveryAreaId(name) {
  return String(name || "").trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

/**
 * The places a business delivers to at one destination, and what each
 * costs.
 *
 * Named areas rather than one number per country, because that is how this
 * trade quotes it: Cosa is $20, Koloma is $10. A single fee per country
 * either overcharges the neighbourhood next door to the office or loses
 * money on the one an hour away. The platform cannot own the list - only
 * the business knows the quartiers it serves - so the business types them.
 *
 * @param {object} country The destination country document.
 * @return {Array<object>} `{id, name, fee, feeCents}` per area.
 */
function freightDeliveryAreas(country) {
  const raw = Array.isArray(country?.freightDestinationDeliveryAreas) ?
    country.freightDestinationDeliveryAreas :
    [];
  const areas = [];
  const seen = new Set();
  for (const entry of raw) {
    const name = String(entry?.name || "").trim();
    const id = String(entry?.id || "").trim() || deliveryAreaId(name);
    const fee = Number(entry?.fee) || 0;
    if (!id || !name || fee <= 0 || seen.has(id)) continue;
    seen.add(id);
    areas.push({id, name, fee, feeCents: Math.round(fee * 100)});
  }
  return areas;
}

/**
 * What is published about delivering at one destination.
 *
 * Per destination, not per business: taking a parcel across Dakar and
 * taking one across Conakry are different jobs at different costs, and a
 * business may do one and not the other. The setting therefore lives on
 * the destination country alongside that route's rates.
 *
 * A business-level value is still honoured when the destination says
 * nothing, so a business that set this before it moved keeps offering
 * delivery until it edits the route.
 *
 * An opted-in destination with no fee is not "free delivery" - it is an
 * unfinished setting, and the offer stays off until it is finished.
 *
 * @param {object} country The destination country document.
 * @param {object} [business] The business document, for settings saved
 *   before this moved onto the destination.
 * @return {object} `{offered, fee, feeCents}`.
 */
function freightDeliveryPolicy(country, business) {
  const hasOwnAnswer =
    country?.freightDestinationDeliveryAvailable !== undefined ||
    country?.freightDestinationDeliveryFee !== undefined ||
    Array.isArray(country?.freightDestinationDeliveryAreas);
  const source = hasOwnAnswer ? country : business || {};
  const enabled = source?.freightDestinationDeliveryAvailable === true;
  const areas = freightDeliveryAreas(source);
  // One flat fee is what a destination priced before areas existed. It
  // still works, as a single unnamed price for anywhere in that country.
  const flatFee = Number(source?.freightDestinationDeliveryFee) || 0;
  const offered = enabled && (areas.length > 0 || flatFee > 0);
  return {
    offered,
    areas: offered ? areas : [],
    fee: offered && areas.length === 0 ? flatFee : 0,
    feeCents: offered && areas.length === 0 ? Math.round(flatFee * 100) : 0,
  };
}

/**
 * Validates what the business console sends. Refuses rather than clamps:
 * a silently corrected fee is one the business never agreed to charge.
 *
 * @param {object} raw The `{available, fee}` payload from the console.
 * @return {object} `{ok, changed, settings}`, or `{ok: false, error}`.
 */
function validateFreightDeliverySettings(raw) {
  if (raw === undefined || raw === null) return {ok: true, changed: false};
  const available = raw.available === true;
  if (!available) {
    return {
      ok: true,
      changed: true,
      settings: {
        freightDestinationDeliveryAvailable: false,
        freightDestinationDeliveryFee: 0,
        freightDestinationDeliveryAreas: [],
      },
    };
  }
  const rawAreas = Array.isArray(raw.areas) ? raw.areas : [];
  if (rawAreas.length > MAX_DELIVERY_AREAS) {
    return {ok: false, error: "too_many_areas"};
  }
  const areas = [];
  const seen = new Set();
  for (const entry of rawAreas) {
    const name = String(entry?.name || "").trim()
        .slice(0, MAX_AREA_NAME_LENGTH);
    if (!name) return {ok: false, error: "area_name_required"};
    const id = deliveryAreaId(entry?.id || name);
    if (!id) return {ok: false, error: "area_name_required"};
    if (seen.has(id)) return {ok: false, error: "area_duplicated"};
    seen.add(id);
    const fee = Number(entry?.fee);
    if (!Number.isFinite(fee) || fee <= 0 ||
        fee > MAX_DESTINATION_DELIVERY_FEE) {
      return {ok: false, error: "fee_out_of_range"};
    }
    areas.push({id, name, fee: Math.round(fee * 100) / 100});
  }
  // A destination priced as one number for the whole country, which is
  // still a legitimate answer - "anywhere in Conakry, $15".
  const flatFee = Number(raw.fee);
  const hasFlat = Number.isFinite(flatFee) && flatFee > 0;
  if (hasFlat && flatFee > MAX_DESTINATION_DELIVERY_FEE) {
    return {ok: false, error: "fee_out_of_range"};
  }
  if (areas.length === 0 && !hasFlat) {
    return {ok: false, error: "fee_required"};
  }
  return {
    ok: true,
    changed: true,
    settings: {
      freightDestinationDeliveryAvailable: true,
      freightDestinationDeliveryFee: areas.length > 0 ?
        0 :
        Math.round(flatFee * 100) / 100,
      freightDestinationDeliveryAreas: areas,
    },
  };
}

/**
 * Prices one booking's delivery choice against the business's live policy.
 *
 * Returns an error rather than quietly falling back to office collection:
 * a customer who asked for delivery and silently got none would only find
 * out when nothing arrived.
 *
 * @param {object} params The booking's delivery request.
 * @param {object} params.business The business document.
 * @param {object} params.country The destination country document.
 * @param {boolean} params.wantsDelivery Whether the customer chose delivery.
 * @param {string} params.receiverAddress Where the parcel should be taken.
 * @return {object} `{ok, delivery, feeCents, address}`, or `{ok: false,
 *   error}` when the business does not offer it.
 */
function quoteFreightDelivery({
  business,
  country,
  wantsDelivery,
  receiverAddress,
  deliveryAreaId: wantedAreaId,
}) {
  if (!wantsDelivery) {
    return {
      ok: true, delivery: false, feeCents: 0, address: "",
      areaId: "", areaName: "",
    };
  }
  const policy = freightDeliveryPolicy(country, business);
  if (!policy.offered) {
    return {ok: false, error: "delivery_not_offered"};
  }
  const address = String(receiverAddress || "").trim();
  if (!address) {
    return {ok: false, error: "receiver_address_required"};
  }
  if (address.length > MAX_RECEIVER_ADDRESS_LENGTH) {
    return {ok: false, error: "receiver_address_too_long"};
  }
  // Where the parcel is going decides the fee, so an unnamed area on a
  // destination priced by area is a booking that cannot be priced - not one
  // to guess a number for.
  if (policy.areas.length > 0) {
    const wanted = String(wantedAreaId || "").trim();
    const area = policy.areas.find((row) => row.id === wanted);
    if (!area) return {ok: false, error: "delivery_area_required"};
    return {
      ok: true,
      delivery: true,
      feeCents: area.feeCents,
      fee: area.fee,
      address,
      areaId: area.id,
      areaName: area.name,
    };
  }
  return {
    ok: true,
    delivery: true,
    feeCents: policy.feeCents,
    fee: policy.fee,
    address,
    areaId: "",
    areaName: "",
  };
}

module.exports = {
  FREIGHT_DELIVERY_ERRORS,
  MAX_DESTINATION_DELIVERY_FEE,
  MAX_RECEIVER_ADDRESS_LENGTH,
  MAX_DELIVERY_AREAS,
  deliveryAreaId,
  freightDeliveryAreas,
  freightDeliveryPolicy,
  quoteFreightDelivery,
  validateFreightDeliverySettings,
};
