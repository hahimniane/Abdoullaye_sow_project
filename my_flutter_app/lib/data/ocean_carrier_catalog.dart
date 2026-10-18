/// The ocean carriers a container can be booked with: SCAC -> name.
///
/// PORTED from admin_web/src/lib/ocean-carrier-catalog.ts (the source of
/// truth, which functions/ocean_carrier_catalog.js mirrors too); change it
/// there and re-port. test/ocean_carrier_catalog_test.dart fails when the
/// lists drift. Curated, not exhaustive: the server accepts only these as a
/// container's chosen shipping line, and shows any other stored code (one
/// the carrier feed filled in itself) as the code.
class OceanCarrier {
  const OceanCarrier(this.scac, this.name);

  final String scac;
  final String name;

  /// "MSC · MSCU": the code is what is stored, so it is shown beside the
  /// name - a business reading it off a bill of lading matches the code.
  String get label => '$name · $scac';
}

const oceanCarriers = <OceanCarrier>[
  OceanCarrier('ANNU', 'ANL'),
  OceanCarrier('APLU', 'APL'),
  OceanCarrier('ACLU', 'Atlantic Container Line'),
  OceanCarrier('CMDU', 'CMA CGM'),
  OceanCarrier('CHNJ', 'China Navigation'),
  OceanCarrier('COSU', 'COSCO'),
  OceanCarrier('CULU', 'Containerships'),
  OceanCarrier('ESPU', 'Emirates Shipping Line'),
  OceanCarrier('EGLV', 'Evergreen'),
  OceanCarrier('GSLU', 'Gold Star Line'),
  OceanCarrier('HLCU', 'Hapag-Lloyd'),
  OceanCarrier('HDMU', 'HMM'),
  OceanCarrier('KKLU', 'K Line'),
  OceanCarrier('MAEU', 'Maersk'),
  OceanCarrier('MATS', 'Matson'),
  OceanCarrier('MSCU', 'MSC'),
  OceanCarrier('MOLU', 'MOL'),
  OceanCarrier('NYKS', 'NYK Line'),
  OceanCarrier('ONEY', 'ONE'),
  OceanCarrier('OOLU', 'OOCL'),
  OceanCarrier('PABV', 'PIL'),
  OceanCarrier('SAFM', 'Safmarine'),
  OceanCarrier('SEJJ', 'SeaLead Shipping'),
  OceanCarrier('SMLU', 'SM Line'),
  OceanCarrier('TGBU', 'TS Lines'),
  OceanCarrier('WLWH', 'Wallenius Wilhelmsen'),
  OceanCarrier('YMLU', 'Yang Ming'),
  OceanCarrier('ZIMU', 'ZIM'),
];

/// "MSC · MSCU" for a line the catalog knows, the code itself for one it
/// does not, "" for none.
String oceanCarrierLabel(String scac) {
  final code = scac.trim().toUpperCase();
  if (code.isEmpty) return '';
  for (final carrier in oceanCarriers) {
    if (carrier.scac == code) return carrier.label;
  }
  return code;
}
