"use strict";

// Fleet in every team member's copy of the business's services
// (docs/FLEET.md section 17). The app reads a person's own copy,
// users/{uid}.businessServices, to decide whether Fleet leads their home;
// the website reads the business. The switch only wrote the business, so
// Landa's team never saw Fleet in the app (2026-11-27). These pure helpers
// say what each copy should hold; fleet_handlers.js writes it.

/**
 * The business's services with Fleet exactly as its switch says.
 *
 * @param {Array<string>} services The business's normalized services.
 * @param {boolean} fleetOn Whether businesses/{id}.fleet.enabled is true.
 * @return {Array<string>} The services, "fleet" last when on.
 */
function servicesWithFleet(services, fleetOn) {
  const out = (Array.isArray(services) ? services : [])
      .filter((s) => s !== "fleet");
  if (fleetOn === true) out.push("fleet");
  return out;
}

/**
 * Whether a person's copy differs from what it should hold (order ignored).
 *
 * @param {*} have The person's businessServices.
 * @param {Array<string>} want What it should hold.
 * @return {boolean} True when it must be rewritten.
 */
function memberServicesStale(have, want) {
  if (!Array.isArray(have)) return true;
  const a = new Set(have.map(String));
  const b = new Set(want);
  if (a.size !== b.size) return true;
  for (const s of b) if (!a.has(s)) return true;
  return false;
}

/**
 * What an owner's profile save keeps: Fleet is a platform-admin switch, so
 * a profile form that does not list it can neither add nor drop it.
 *
 * @param {Array<string>} requested The services the save asks for.
 * @param {object} current The business doc before the save.
 * @return {Array<string>} The services to save.
 */
function keepFleetOnProfileSave(requested, current) {
  return servicesWithFleet(requested, current?.fleet?.enabled === true);
}

module.exports = {servicesWithFleet, memberServicesStale,
  keepFleetOnProfileSave};
