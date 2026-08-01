import type { SearchableOption } from "./searchable-options.ts";

// SCAC (Standard Carrier Alpha Code) is a 4-letter carrier identifier. Getting
// it wrong does not fail loudly - the carrier lookup simply never resolves and
// tracking silently never starts - so it must not be hand-typed when it can be
// picked instead.
//
// Unlike the country and calling-code catalogs, this one is deliberately NOT
// exhaustive: NMFTA has issued thousands of SCACs across every mode of freight.
// These are the ocean carriers and major NVOCCs that move the overwhelming
// majority of container traffic. Anything outside the list stays reachable
// through the "not listed" option, which reveals a free-text field - so a rare
// carrier is never untrackable, it just is not typo-proof.
//
// Keep alphabetical by name. `keywords` carries alternate names and former
// identities so people can find a carrier by whatever they call it locally.
export const OCEAN_CARRIERS: ReadonlyArray<{
  scac: string;
  name: string;
  keywords?: string;
}> = [
  {scac: "ANNU", name: "ANL", keywords: "australia national line cma"},
  {scac: "APLU", name: "APL", keywords: "american president lines cma"},
  {scac: "ACLU", name: "Atlantic Container Line", keywords: "acl"},
  {scac: "CMDU", name: "CMA CGM", keywords: "cma cgm delmas"},
  {scac: "CHNJ", name: "China Navigation", keywords: "swire"},
  {scac: "COSU", name: "COSCO", keywords: "cosco shipping china ocean"},
  {scac: "CULU", name: "Containerships", keywords: "cma"},
  {scac: "ESPU", name: "Emirates Shipping Line", keywords: "esl"},
  {scac: "EGLV", name: "Evergreen", keywords: "evergreen marine taiwan"},
  {scac: "GSLU", name: "Gold Star Line", keywords: "zim"},
  {scac: "HLCU", name: "Hapag-Lloyd", keywords: "hapag lloyd uasc"},
  {scac: "HDMU", name: "HMM", keywords: "hyundai merchant marine korea"},
  {scac: "KKLU", name: "K Line", keywords: "kawasaki kisen one"},
  {scac: "MAEU", name: "Maersk", keywords: "maersk line ap moller sealand"},
  {scac: "MATS", name: "Matson", keywords: "matson navigation pacific"},
  {scac: "MSCU", name: "MSC", keywords: "mediterranean shipping company"},
  {scac: "MOLU", name: "MOL", keywords: "mitsui osk lines one"},
  {scac: "NYKS", name: "NYK Line", keywords: "nippon yusen kaisha one"},
  {scac: "ONEY", name: "ONE", keywords: "ocean network express nyk mol k line"},
  {scac: "OOLU", name: "OOCL", keywords: "orient overseas cosco"},
  {scac: "PABV", name: "PIL", keywords: "pacific international lines"},
  {scac: "SAFM", name: "Safmarine", keywords: "maersk africa"},
  {scac: "SEJJ", name: "SeaLead Shipping", keywords: "sea lead"},
  {scac: "SMLU", name: "SM Line", keywords: "korea hanjin"},
  {scac: "TGBU", name: "TS Lines", keywords: "ts line taiwan"},
  {scac: "WLWH", name: "Wallenius Wilhelmsen", keywords: "roro vehicles"},
  {scac: "YMLU", name: "Yang Ming", keywords: "yangming taiwan"},
  {scac: "ZIMU", name: "ZIM", keywords: "zim integrated israel"},
];

/** Sentinel for a carrier outside the catalog; reveals a free-text field. */
export const OTHER_CARRIER_VALUE = "__other__";

export function oceanCarrierOptions(otherLabel: string): SearchableOption[] {
  return [
    ...OCEAN_CARRIERS.map((carrier) => ({
      value: carrier.scac,
      // The code is what actually gets submitted, so show it alongside the
      // name - a business reading it off a bill of lading is matching the code.
      label: `${carrier.name} · ${carrier.scac}`,
      selectedLabel: `${carrier.name} · ${carrier.scac}`,
      keywords: [carrier.scac, carrier.name, carrier.keywords ?? ""].join(" "),
    })),
    {value: OTHER_CARRIER_VALUE, label: otherLabel, keywords: "other manual"},
  ];
}

/** True when `value` is a SCAC this catalog knows. */
export function isKnownCarrierScac(value: string): boolean {
  const scac = value.trim().toUpperCase();
  return OCEAN_CARRIERS.some((carrier) => carrier.scac === scac);
}
