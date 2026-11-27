// Pure helpers behind the Fleet form pick lists (docs/FLEET.md section 16),
// mirroring admin_web/src/lib/fleet-pickers.ts and vin-decode.ts. The widgets
// that use them are in widgets/fleet_pickers.dart. No Firebase, no Flutter.

import '../data/us_locations.dart' show normalizeUsState;

/// The distinct values already saved on a business's plates for one field,
/// spelled the first way they were saved, case and spacing folded, sorted A-Z.
List<String> fleetKnownValues(Iterable<String> values) {
  final byLower = <String, String>{};
  for (final raw in values) {
    final v = raw.replaceAll(RegExp(r'\s+'), ' ').trim();
    if (v.isEmpty) continue;
    byLower.putIfAbsent(v.toLowerCase(), () => v);
  }
  final out = byLower.values.toList()
    ..sort((a, b) => a.toLowerCase().compareTo(b.toLowerCase()));
  return out;
}

/// The list a pick-or-add field shows: the known values plus the current one.
List<String> fleetOptionsWith(List<String> known, String current) {
  final v = current.trim();
  if (v.isEmpty || known.any((k) => k.toLowerCase() == v.toLowerCase())) {
    return [...known];
  }
  return [v, ...known];
}

/// The saved spelling of a typed value already in the list ("dala cars inc"
/// becomes "Dala Cars Inc"); anything else is returned trimmed.
String fleetMatchKnown(List<String> known, String typed) {
  final v = typed.replaceAll(RegExp(r'\s+'), ' ').trim();
  for (final k in known) {
    if (k.toLowerCase() == v.toLowerCase()) return k;
  }
  return v;
}

/// Days a monthly bill can fall on: 1 to 28, so every month has the day.
final List<int> fleetMonthDays = List<int>.unmodifiable(
  List<int>.generate(28, (i) => i + 1),
);

/// Weekdays of a weekly bill, 1 = Monday ... 7 = Sunday (the stored number).
const List<int> fleetWeekdayNumbers = [1, 2, 3, 4, 5, 6, 7];

/// "Insurance paid by" fixed choices; stored in English, like the website.
const String fleetPayerCompany = 'The company';
const String fleetPayerDriver = 'The driver';
const List<String> fleetInsurancePayers = [fleetPayerCompany, fleetPayerDriver];

/// Common reasons for a charge; saved in English like the website.
const List<String> fleetChargeReasons = [
  'Ticket',
  'Toll',
  'Damage repair',
  'Insurance deductible',
];

const String _chargeJoin = ' · ';

/// Splits a saved label into a listed reason ('' = something else) and
/// details.
({String reason, String details}) fleetSplitChargeLabel(String label) {
  final value = label.trim();
  final lower = value.toLowerCase();
  for (final reason in fleetChargeReasons) {
    final r = reason.toLowerCase();
    if (lower == r) return (reason: reason, details: '');
    if (lower.startsWith('$r$_chargeJoin')) {
      return (
        reason: reason,
        details: value.substring(reason.length + _chargeJoin.length).trim(),
      );
    }
  }
  return (reason: '', details: value);
}

/// The label saved for a reason and its details ("Ticket · T712000C").
String fleetComposeChargeLabel(String reason, String details) {
  final d = details.trim();
  if (reason.isEmpty) return d;
  return d.isEmpty ? reason : '$reason$_chargeJoin$d';
}

/// The two-letter code for a typed or saved US state ("ny", "New York" ->
/// "NY"); anything that is not a US state comes back as it was.
String fleetStateCode(String raw) => normalizeUsState(raw) ?? '';

class FleetVehicleParts {
  const FleetVehicleParts({this.make = '', this.model = '', this.year = ''});
  final String make, model, year;

  @override
  bool operator ==(Object other) =>
      other is FleetVehicleParts &&
      other.make == make &&
      other.model == model &&
      other.year == year;

  @override
  int get hashCode => Object.hash(make, model, year);
}

/// What the car catalog offers; CarCatalog.instance is adapted in the widget
/// so these helpers stay testable without assets.
class FleetCatalogLookup {
  const FleetCatalogLookup({
    required this.makes,
    required this.models,
    required this.years,
  });
  final List<String> Function() makes;
  final List<String> Function(String make) models;
  final List<String> Function(String make, String model) years;
}

/// "Toyota Camry 2021": the one line a plate's car is saved as.
String fleetComposeVehicleType(FleetVehicleParts p) => [
  p.make,
  p.model,
  p.year,
].map((e) => e.trim()).where((e) => e.isNotEmpty).join(' ');

/// Reads a saved car line back into make, model and year ("Toyota Camry
/// 2021", "2021 toyota camry", "Toyota RAV4"). Null when the make is not in
/// the catalog, so the form keeps the old text.
FleetVehicleParts? fleetSplitVehicleType(
  String text,
  FleetCatalogLookup catalog,
) {
  var rest = text.replaceAll(RegExp(r'\s+'), ' ').trim();
  if (rest.isEmpty) return const FleetVehicleParts();
  var year = '';
  final yearMatch = RegExp(r'^(19|20)\d\d\b|\b(19|20)\d\d$').firstMatch(rest);
  if (yearMatch != null) {
    year = yearMatch.group(0)!;
    rest =
        (rest.substring(0, yearMatch.start) + rest.substring(yearMatch.end))
            .trim();
  }
  final lower = rest.toLowerCase();
  final makes = [...catalog.makes()]
    ..sort((a, b) => b.length.compareTo(a.length));
  String? make;
  for (final m in makes) {
    final ml = m.toLowerCase();
    if (lower == ml || lower.startsWith('$ml ')) {
      make = m;
      break;
    }
  }
  if (make == null) return null;
  final modelText = rest.substring(make.length).trim().toLowerCase();
  var model = '';
  if (modelText.isNotEmpty) {
    for (final m in catalog.models(make)) {
      if (m.toLowerCase() == modelText) {
        model = m;
        break;
      }
    }
    if (model.isEmpty) return null;
  }
  var knownYear = '';
  if (year.isNotEmpty && model.isNotEmpty) {
    for (final y in catalog.years(make, model)) {
      if (y == year) {
        knownYear = y;
        break;
      }
    }
    if (knownYear.isEmpty) return null;
  }
  return FleetVehicleParts(make: make, model: model, year: knownYear);
}

// ---- VIN decode (NHTSA vPIC) ------------------------------------------------

/// The VIN as the database wants it, or '' when it is not 17 characters yet.
String fleetCleanVin(String raw) {
  final vin = raw.toUpperCase().replaceAll(RegExp(r'[^A-Z0-9]'), '');
  return vin.length == 17 ? vin : '';
}

enum FleetVinKind { filled, unknownMake, unreadable, offline }

class FleetVinResult {
  const FleetVinResult(this.kind, {this.parts = const FleetVehicleParts()});
  final FleetVinKind kind;
  final FleetVehicleParts parts;
}

/// Matches an NHTSA `Results[0]` row to the catalog; null [row] = offline.
FleetVinResult fleetVinResultFrom(
  Map<String, dynamic>? row,
  FleetCatalogLookup catalog,
  String Function(String make, String model) canonicalModel,
) {
  if (row == null) return const FleetVinResult(FleetVinKind.offline);
  String s(String k) => '${row[k] ?? ''}'.trim();
  final dMake = s('Make'), dModel = s('Model'), dYear = s('ModelYear');
  String make = '';
  for (final m in catalog.makes()) {
    if (m.toLowerCase() == dMake.toLowerCase()) {
      make = m;
      break;
    }
  }
  if (make.isEmpty) {
    return [dYear, dMake, dModel].any((e) => e.isNotEmpty)
        ? const FleetVinResult(FleetVinKind.unknownMake)
        : const FleetVinResult(FleetVinKind.unreadable);
  }
  final canon = canonicalModel(make, dModel);
  final wanted = (canon.isEmpty ? dModel : canon).toLowerCase();
  var model = '';
  for (final m in catalog.models(make)) {
    if (m.toLowerCase() == wanted) {
      model = m;
      break;
    }
  }
  var year = '';
  if (model.isNotEmpty) {
    for (final y in catalog.years(make, model)) {
      if (y == dYear) {
        year = y;
        break;
      }
    }
  }
  return FleetVinResult(
    FleetVinKind.filled,
    parts: FleetVehicleParts(make: make, model: model, year: year),
  );
}
