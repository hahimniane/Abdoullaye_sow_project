/// A lot's price cards, app side. Mirrors
/// `functions/business_parking_entry.js`: a business can charge more than one
/// price - a bigger space, a long-stay deal, a rate for the dealer who brings
/// six cars at once - and staff pick the card when they record the car.
///
/// The business's own daily rate stays the standard price. A card is an
/// alternative to it, never a replacement, so a customer booking and every
/// existing record price exactly as they always did. Pure Dart, tested
/// without Firebase.
library;

class ParkingRate {
  const ParkingRate({
    required this.id,
    required this.label,
    required this.dailyRate,
    this.weeklyRate = 0,
    this.monthlyRate = 0,
    this.minimumDays = 1,
  });

  final String id;
  final String label;
  final double dailyRate;
  final double weeklyRate;
  final double monthlyRate;
  final int minimumDays;
}

String _text(Object? value, int max) {
  final t = (value ?? '').toString().trim();
  return t.length > max ? t.substring(0, max) : t;
}

double _positive(Object? value) {
  final n = value is num ? value.toDouble() : double.tryParse('$value') ?? 0;
  return n.isFinite && n > 0 ? n : 0;
}

/// Clean cards from whatever the business document holds.
List<ParkingRate> normalizeParkingRates(Object? raw) {
  if (raw is! List) return const [];
  final seen = <String>{};
  final out = <ParkingRate>[];
  for (final entry in raw) {
    if (entry is! Map) continue;
    final id = _text(entry['id'], 60);
    final label = _text(entry['label'], 80);
    final daily = _positive(entry['dailyRate']);
    // A card with no name cannot be chosen, and one with no daily rate cannot
    // price the days a stay is actually billed in.
    if (id.isEmpty || label.isEmpty || daily <= 0) continue;
    if (!seen.add(id)) continue;
    final minimum = int.tryParse('${entry['minimumDays']}'.split('.').first) ?? 0;
    out.add(ParkingRate(
      id: id,
      label: label,
      dailyRate: daily,
      weeklyRate: _positive(entry['weeklyRate']),
      monthlyRate: _positive(entry['monthlyRate']),
      minimumDays: minimum > 0 ? minimum : 1,
    ));
  }
  return out;
}

/// One line in the picker.
class ParkingRateChoice {
  const ParkingRateChoice({
    required this.id,
    required this.label,
    required this.dailyRate,
  });

  final String id;
  final String label;
  final double dailyRate;

  /// "Long stay - $9.00/day", the way a picker names a price.
  String get optionLabel =>
      '$label - \$${dailyRate.toStringAsFixed(2)}/day';
}

/// What the picker shows: the lot's standard price first, then every card.
///
/// The standard price carries an empty id, which is what the server reads as
/// "no card chosen" - so the default costs nothing new to express.
List<ParkingRateChoice> parkingRateChoices(Map<String, dynamic>? business) {
  final source = business ?? const <String, dynamic>{};
  final standard = _positive(source['parkingDailyRate']);
  return [
    if (standard > 0)
      ParkingRateChoice(id: '', label: 'Standard', dailyRate: standard),
    for (final rate in normalizeParkingRates(source['parkingRates']))
      ParkingRateChoice(
        id: rate.id,
        label: rate.label,
        dailyRate: rate.dailyRate,
      ),
  ];
}
