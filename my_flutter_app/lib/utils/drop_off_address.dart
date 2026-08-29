/// Customer drop-off copy should show a real HQ street when one exists.
/// Extra officeLocations stay optional; HQ on the business doc is enough.
const genericOfficeDropOffSentinels = <String>{
  'the business office',
  'drop-off office',
  'drop off office',
};

bool isGenericOfficeDropOffAddress(String? address) {
  final trimmed = address?.trim() ?? '';
  if (trimmed.isEmpty) return true;
  return genericOfficeDropOffSentinels.contains(trimmed.toLowerCase());
}

String resolveOfficeDropOffAddress({
  required String? officeAddress,
  required String fallbackAddress,
  required String genericLabel,
}) {
  final office = officeAddress?.trim() ?? '';
  if (!isGenericOfficeDropOffAddress(office)) return office;
  final fallback = fallbackAddress.trim();
  if (!isGenericOfficeDropOffAddress(fallback)) return fallback;
  return genericLabel;
}
