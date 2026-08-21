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

const FREIGHT_DELIVERY_ERRORS = Object.freeze({
  fee_out_of_range: "The delivery fee must be between $0 and " +
    `$${MAX_DESTINATION_DELIVERY_FEE}`,
  fee_required: "Set a delivery fee, or turn destination delivery off",
});

/**
 * What a business publishes about delivering at the destination.
 *
 * An opted-in business with no fee is not "free delivery" - it is an
 * unfinished setting, and the offer stays off until it is finished.
 *
 * @param {object} business The business document.
 * @return {object} `{offered, fee, feeCents}`.
 */
function freightDeliveryPolicy(business) {
  const offered = business?.freightDestinationDeliveryAvailable === true;
  const fee = Number(business?.freightDestinationDeliveryFee) || 0;
  return {
    offered: offered && fee > 0,
    fee: offered && fee > 0 ? fee : 0,
    feeCents: offered && fee > 0 ? Math.round(fee * 100) : 0,
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
      },
    };
  }
  const fee = Number(raw.fee);
  if (!Number.isFinite(fee) || fee <= 0) {
    return {ok: false, error: "fee_required"};
  }
  if (fee > MAX_DESTINATION_DELIVERY_FEE) {
    return {ok: false, error: "fee_out_of_range"};
  }
  return {
    ok: true,
    changed: true,
    settings: {
      freightDestinationDeliveryAvailable: true,
      freightDestinationDeliveryFee: Math.round(fee * 100) / 100,
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
 * @param {boolean} params.wantsDelivery Whether the customer chose delivery.
 * @param {string} params.receiverAddress Where the parcel should be taken.
 * @return {object} `{ok, delivery, feeCents, address}`, or `{ok: false,
 *   error}` when the business does not offer it.
 */
function quoteFreightDelivery({business, wantsDelivery, receiverAddress}) {
  if (!wantsDelivery) {
    return {ok: true, delivery: false, feeCents: 0, address: ""};
  }
  const policy = freightDeliveryPolicy(business);
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
  return {
    ok: true,
    delivery: true,
    feeCents: policy.feeCents,
    fee: policy.fee,
    address,
  };
}

module.exports = {
  FREIGHT_DELIVERY_ERRORS,
  MAX_DESTINATION_DELIVERY_FEE,
  MAX_RECEIVER_ADDRESS_LENGTH,
  freightDeliveryPolicy,
  quoteFreightDelivery,
  validateFreightDeliverySettings,
};
