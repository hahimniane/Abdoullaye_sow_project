"use strict";

// AUTO-PORTED from admin_web/src/lib/ocean-carrier-catalog.ts (the source of
// truth; change it there and re-port). Only the SCAC -> name pairs: the
// public tracking page names the shipping line a container sails with, and
// the container stores only the carrier's SCAC (`carrierScac`). Curated, not
// exhaustive, like its source: an unknown SCAC is shown as the code itself.
// test/ocean-carrier-catalog.test.js fails when the two lists drift.

const OCEAN_CARRIERS = Object.freeze([
  Object.freeze({scac: "ANNU", name: "ANL"}),
  Object.freeze({scac: "APLU", name: "APL"}),
  Object.freeze({scac: "ACLU", name: "Atlantic Container Line"}),
  Object.freeze({scac: "CMDU", name: "CMA CGM"}),
  Object.freeze({scac: "CHNJ", name: "China Navigation"}),
  Object.freeze({scac: "COSU", name: "COSCO"}),
  Object.freeze({scac: "CULU", name: "Containerships"}),
  Object.freeze({scac: "ESPU", name: "Emirates Shipping Line"}),
  Object.freeze({scac: "EGLV", name: "Evergreen"}),
  Object.freeze({scac: "GSLU", name: "Gold Star Line"}),
  Object.freeze({scac: "HLCU", name: "Hapag-Lloyd"}),
  Object.freeze({scac: "HDMU", name: "HMM"}),
  Object.freeze({scac: "KKLU", name: "K Line"}),
  Object.freeze({scac: "MAEU", name: "Maersk"}),
  Object.freeze({scac: "MATS", name: "Matson"}),
  Object.freeze({scac: "MSCU", name: "MSC"}),
  Object.freeze({scac: "MOLU", name: "MOL"}),
  Object.freeze({scac: "NYKS", name: "NYK Line"}),
  Object.freeze({scac: "ONEY", name: "ONE"}),
  Object.freeze({scac: "OOLU", name: "OOCL"}),
  Object.freeze({scac: "PABV", name: "PIL"}),
  Object.freeze({scac: "SAFM", name: "Safmarine"}),
  Object.freeze({scac: "SEJJ", name: "SeaLead Shipping"}),
  Object.freeze({scac: "SMLU", name: "SM Line"}),
  Object.freeze({scac: "TGBU", name: "TS Lines"}),
  Object.freeze({scac: "WLWH", name: "Wallenius Wilhelmsen"}),
  Object.freeze({scac: "YMLU", name: "Yang Ming"}),
  Object.freeze({scac: "ZIMU", name: "ZIM"}),
]);

const NAME_BY_SCAC = new Map(OCEAN_CARRIERS.map((c) => [c.scac, c.name]));

/**
 * @param {string} scac A carrier's SCAC.
 * @return {string} The shipping line's name, the code itself when the
 *   catalog does not know it, or "" for no code.
 */
function oceanCarrierName(scac) {
  const code = String(scac ?? "").trim().toUpperCase()
      .replace(/[^A-Z0-9]/g, "").slice(0, 10);
  if (!code) return "";
  return NAME_BY_SCAC.get(code) || code;
}

module.exports = {OCEAN_CARRIERS, oceanCarrierName};
