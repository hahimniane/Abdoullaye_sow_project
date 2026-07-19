import 'country_catalog.dart';

// Common countries pinned to the top of the address picker for convenience.
// These names match the keys in [businessCitiesByCountry] so preset cities keep
// resolving. The FULL country list comes from the canonical [CountryCatalog] —
// see [businessCountryOptions]. Do NOT treat this short list as the set of
// selectable countries; an address picker must offer every country.
const businessCountries = <String>[
  'United States',
  'Guinea',
  'Senegal',
  'Mali',
  "Côte d'Ivoire",
  'Gambia',
  'Sierra Leone',
  'Liberia',
];

// ISO codes of the pinned countries above, so we can exclude their duplicates
// when appending the rest of the canonical catalog.
const _pinnedCountryCodes = <String>{
  'US', 'GN', 'SN', 'ML', 'CI', 'GM', 'SL', 'LR',
};

const businessCitiesByCountry = <String, List<String>>{
  'United States': [
    'New York',
    'Bronx',
    'Brooklyn',
    'Manhattan',
    'Queens',
    'Newark',
    'Jersey City',
    'Philadelphia',
    'Atlanta',
  ],
  'Guinea': ['Conakry', 'Kankan', 'Labe', 'Nzerekore', 'Kindia', 'Mamou'],
  'Senegal': [
    'Dakar',
    'Touba',
    'Thies',
    'Saint-Louis',
    'Kaolack',
    'Ziguinchor',
  ],
  'Mali': ['Bamako', 'Sikasso', 'Mopti', 'Segou', 'Kayes', 'Koutiala'],
  "Côte d'Ivoire": [
    'Abidjan',
    'Bouake',
    'Yamoussoukro',
    'Daloa',
    'San-Pedro',
    'Korhogo',
  ],
  'Gambia': ['Banjul', 'Serekunda', 'Brikama', 'Bakau', 'Farafenni'],
  'Sierra Leone': ['Freetown', 'Bo', 'Kenema', 'Makeni', 'Koidu'],
  'Liberia': ['Monrovia', 'Gbarnga', 'Buchanan', 'Ganta', 'Kakata'],
};

/// Every country, sourced from the canonical [CountryCatalog], with the common
/// US + West-Africa countries pinned on top. An address picker must always be
/// able to select any country — never a hand-picked subset.
List<String> businessCountryOptions(String? selected) {
  final rest = CountryCatalog.all
      .where(
        (country) =>
            !_pinnedCountryCodes.contains((country.code ?? '').toUpperCase()),
      )
      .map((country) => country.name)
      .toList()
    ..sort();
  return _valuesWithLegacy([...businessCountries, ...rest], selected);
}

List<String> businessCityOptions(String? country, String? selected) {
  final cities = businessCitiesByCountry[country?.trim()] ?? const <String>[];
  return _valuesWithLegacy(cities, selected);
}

String? defaultBusinessCountry({String? country, String? state}) {
  final trimmedCountry = country?.trim();
  if (trimmedCountry != null && trimmedCountry.isNotEmpty) {
    return trimmedCountry;
  }
  final trimmedState = state?.trim();
  if (trimmedState != null && trimmedState.isNotEmpty) {
    return 'United States';
  }
  return null;
}

List<String> _valuesWithLegacy(List<String> values, String? selected) {
  final result = List<String>.from(values);
  final trimmed = selected?.trim();
  if (trimmed != null && trimmed.isNotEmpty && !result.contains(trimmed)) {
    result.insert(0, trimmed);
  }
  return result;
}
