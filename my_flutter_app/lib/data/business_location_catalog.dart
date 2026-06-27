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

List<String> businessCountryOptions(String? selected) {
  return _valuesWithLegacy(businessCountries, selected);
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
