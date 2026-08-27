/// Best-effort New York borough detection from address text.
///
/// This is a *hint only*: it fills the borough chip while the customer types
/// so the pickup area is not blank. The price always comes from the server's
/// geocoded answer (`quoteBarrelPickup` / `quoteFreightPickup`) — whoever
/// supplies the borough chooses the price, so the client never gets to.
///
/// Extracted from send_barrel_screen so the shared address widget and the
/// screens share one implementation instead of drifting copies.
library;

const _boroughKeywords = <String, List<String>>{
  'Bronx': ['bronx'],
  'Manhattan': ['manhattan', 'new york, ny'],
  'Brooklyn': ['brooklyn'],
  'Queens': ['queens', 'jamaica', 'flushing'],
  'Staten Island': ['staten island'],
};

const _boroughZipRanges = <String, List<List<int>>>{
  'Bronx': [
    [10400, 10499],
  ],
  'Manhattan': [
    [10000, 10299],
  ],
  'Brooklyn': [
    [11200, 11299],
  ],
  'Queens': [
    [11000, 11199],
    [11300, 11699],
  ],
  'Staten Island': [
    [10300, 10399],
  ],
};

// Checked in this order so the more specific keyword wins ("Brooklyn, New
// York, NY" is Brooklyn, not Manhattan).
const _boroughOrder = <String>[
  'Bronx',
  'Manhattan',
  'Brooklyn',
  'Queens',
  'Staten Island',
];

final _zipPattern = RegExp(r'\b\d{5}\b');

bool _zipInRange(String value, int start, int end) {
  for (final match in _zipPattern.allMatches(value)) {
    final zip = int.tryParse(match.group(0)!);
    if (zip != null && zip >= start && zip <= end) return true;
  }
  return false;
}

/// The borough named (or ZIP-implied) by [value], or null when the address is
/// not recognisably in New York City.
String? nycBoroughFromAddress(String value) {
  final lower = value.toLowerCase();
  for (final borough in _boroughOrder) {
    final keywords = _boroughKeywords[borough]!;
    if (keywords.any(lower.contains)) return borough;
    final ranges = _boroughZipRanges[borough]!;
    for (final range in ranges) {
      if (_zipInRange(lower, range[0], range[1])) return borough;
    }
  }
  return null;
}
