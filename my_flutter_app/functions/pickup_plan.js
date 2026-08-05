"use strict";

/**
 * Business-owned pickup plans (docs/PLAN-business-pickup.md).
 *
 * One plan per business, shared across its services by default, overridable
 * per service. Three modes: flat (one price within the travel cap), distance
 * (base + per-mile within the cap), borough (NY businesses only). The
 * platform holds no default prices.
 *
 * This module is pure: it validates plans, resolves the effective config for
 * a service, and turns a measurement (borough or miles, derived server-side
 * from the geocoded address - never from customer input) into a fee. All
 * Firestore and geocoding stays with the callers.
 */

const PICKUP_MODES = Object.freeze(["flat", "distance", "borough"]);

const PICKUP_SERVICES = Object.freeze([
  "barrels",
  "freight",
  "parking",
  "carTransport",
]);

const NYC_BOROUGHS = Object.freeze([
  "Bronx",
  "Manhattan",
  "Brooklyn",
  "Queens",
  "Staten Island",
]);

/**
 * Parses a non-negative dollar amount. Presence is deliberate: a missing fee
 * is a configuration error, not a free pickup - "accidentally $0 forever" is
 * one of the leaks this model exists to close.
 *
 * @param {*} value Raw value from the client.
 * @return {number|null} Dollars, or null when absent/invalid.
 */
function parseFee(value) {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100) / 100;
}

/**
 * Validates one pickup configuration (the shared plan or one service
 * override).
 *
 * @param {*} raw Client-supplied config.
 * @param {{isNewYork: boolean}} context Whether this business qualifies for
 *   borough mode.
 * @return {{config: ?Object, errors: !Array<string>}} Normalized config and
 *   every problem found (empty errors means valid).
 */
function normalizePickupConfig(raw, context) {
  const errors = [];
  const source = raw && typeof raw === "object" ? raw : {};
  if (source.enabled !== true) {
    return {config: {enabled: false}, errors};
  }

  const mode = String(source.mode || "").trim();
  if (!PICKUP_MODES.includes(mode)) {
    errors.push("pickup_mode_invalid");
    return {config: null, errors};
  }
  if (mode === "borough" && !context.isNewYork) {
    // Borough pricing only means something inside New York.
    errors.push("pickup_borough_requires_new_york");
  }

  const config = {enabled: true, mode};

  if (mode === "flat" || mode === "distance") {
    const cap = Number(source.maxPickupMiles);
    if (!Number.isFinite(cap) || cap <= 0) {
      // The cap is what makes "one price anywhere in my area" safe - an
      // uncapped radius is how a Los Angeles address once quoted ~$11,000.
      errors.push("pickup_travel_cap_required");
    } else {
      config.maxPickupMiles = cap;
    }
  }

  if (mode === "flat") {
    const flatFee = parseFee(source.flatFee);
    if (flatFee === null) errors.push("pickup_flat_fee_required");
    else config.flatFee = flatFee;
  }

  if (mode === "distance") {
    const baseFee = parseFee(source.baseFee);
    const perMileFee = parseFee(source.perMileFee);
    const minimumFee = parseFee(source.minimumFee);
    if (baseFee === null) errors.push("pickup_base_fee_required");
    if (perMileFee === null) errors.push("pickup_per_mile_fee_required");
    if (minimumFee === null) errors.push("pickup_minimum_fee_required");
    if (!errors.length) {
      config.baseFee = baseFee;
      config.perMileFee = perMileFee;
      config.minimumFee = minimumFee;
    }
  }

  if (mode === "borough") {
    const prices = {};
    const rawPrices = source.boroughPrices &&
      typeof source.boroughPrices === "object" ? source.boroughPrices : {};
    Object.keys(rawPrices).forEach((key) => {
      const borough = NYC_BOROUGHS.find(
          (name) => name.toLowerCase() === String(key).trim().toLowerCase(),
      );
      if (!borough) {
        errors.push(`pickup_unknown_borough:${key}`);
        return;
      }
      const fee = parseFee(rawPrices[key]);
      if (fee === null) {
        errors.push(`pickup_borough_fee_invalid:${borough}`);
        return;
      }
      prices[borough] = fee;
    });
    if (Object.keys(prices).length === 0) {
      errors.push("pickup_borough_prices_required");
    }
    config.boroughPrices = prices;
  }

  const origin = String(source.originAddress || "").trim();
  if (mode === "distance" && !origin) {
    errors.push("pickup_origin_address_required");
  }
  if (origin) config.originAddress = origin;
  if (Number.isFinite(Number(source.originLat)) &&
      Number.isFinite(Number(source.originLng))) {
    config.originLat = Number(source.originLat);
    config.originLng = Number(source.originLng);
  }

  return {config: errors.length ? null : config, errors};
}

/**
 * Validates a whole pickup plan: the shared config plus per-service entries,
 * where each service entry is either {inherit: true} or a full config.
 *
 * @param {*} raw Client-supplied plan.
 * @param {{isNewYork: boolean}} context Borough-mode eligibility.
 * @return {{plan: ?Object, errors: !Array<string>}} Normalized plan or every
 *   problem found.
 */
function normalizePickupPlan(raw, context) {
  const errors = [];
  const source = raw && typeof raw === "object" ? raw : {};

  const shared = normalizePickupConfig(source.shared, context);
  errors.push(...shared.errors);

  const services = {};
  const rawServices = source.services &&
    typeof source.services === "object" ? source.services : {};
  Object.keys(rawServices).forEach((key) => {
    if (!PICKUP_SERVICES.includes(key)) {
      errors.push(`pickup_unknown_service:${key}`);
      return;
    }
    const entry = rawServices[key];
    if (entry && entry.inherit === true) {
      services[key] = {inherit: true};
      return;
    }
    const override = normalizePickupConfig(entry, context);
    errors.push(...override.errors.map((code) => `${key}.${code}`));
    if (override.config) {
      services[key] = {inherit: false, ...override.config};
    }
  });

  if (errors.length) return {plan: null, errors};
  return {
    plan: {version: 1, shared: shared.config, services},
    errors,
  };
}

/**
 * The effective pickup config a given service runs under.
 *
 * Resolution order: an explicit non-inheriting override, then the shared
 * plan. A service key that is absent inherits the shared plan too - the
 * explicit {inherit: true} entry exists so the "keep or configure
 * separately?" prompt has somewhere to record the business's answer.
 *
 * @param {*} plan A normalized pickupPlan (or anything falsy).
 * @param {string} service One of PICKUP_SERVICES.
 * @return {?Object} The config, or null when the plan is absent/disabled.
 */
function resolveServicePickup(plan, service) {
  if (!plan || typeof plan !== "object") return null;
  const entry = plan.services && plan.services[service];
  if (entry && entry.inherit === false) {
    return entry.enabled ? entry : null;
  }
  const shared = plan.shared;
  if (!shared || shared.enabled !== true) return null;
  return shared;
}

/**
 * Turns a server-derived measurement into a pickup fee.
 *
 * The measurement comes from geocoding the customer's address - the borough
 * and mileage are never customer input, because whoever supplies the borough
 * chooses the price.
 *
 * @param {!Object} config An enabled config from resolveServicePickup.
 * @param {{borough: (string|undefined), miles: (number|undefined)}}
 *   measurement What the server derived from the address.
 * @return {{ok: boolean, feeCents: (number|undefined),
 *   reason: (string|undefined)}} The fee in integer cents, or the refusal
 *   reason ("out_of_area" | "measurement_missing").
 */
function computePickupFeeCents(config, measurement) {
  const miles = Number(measurement && measurement.miles);
  const borough = String((measurement && measurement.borough) || "").trim();

  if (config.mode === "borough") {
    const match = Object.keys(config.boroughPrices).find(
        (name) => name.toLowerCase() === borough.toLowerCase(),
    );
    if (!borough) return {ok: false, reason: "measurement_missing"};
    if (!match) return {ok: false, reason: "out_of_area"};
    return {ok: true, feeCents: Math.round(config.boroughPrices[match] * 100)};
  }

  if (!Number.isFinite(miles) || miles < 0) {
    return {ok: false, reason: "measurement_missing"};
  }
  if (miles > config.maxPickupMiles) {
    return {ok: false, reason: "out_of_area"};
  }
  if (config.mode === "flat") {
    return {ok: true, feeCents: Math.round(config.flatFee * 100)};
  }
  const fee = Math.max(
      config.minimumFee,
      config.baseFee + miles * config.perMileFee,
  );
  return {ok: true, feeCents: Math.round(fee * 100)};
}

module.exports = {
  PICKUP_MODES,
  PICKUP_SERVICES,
  NYC_BOROUGHS,
  normalizePickupConfig,
  normalizePickupPlan,
  resolveServicePickup,
  computePickupFeeCents,
};
