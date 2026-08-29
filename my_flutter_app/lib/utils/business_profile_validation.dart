bool headquartersAddressNeedsAttention({
  required String addressLine1,
  required String country,
  required String state,
  required String city,
}) {
  final trimmedCountry = country.trim();
  return addressLine1.trim().isEmpty ||
      trimmedCountry.isEmpty ||
      city.trim().isEmpty ||
      (trimmedCountry == 'United States' && state.trim().isEmpty);
}

bool parkingCapacityNeedsAttention({
  required bool offersParking,
  required String addressLine1,
  required String country,
  required String state,
  required String city,
  required int totalSpaces,
  required int blockedSpaces,
  required double dailyRate,
  required int minimumDays,
}) {
  if (!offersParking) return false;

  final trimmedCountry = country.trim();
  final hasRequiredLocation =
      addressLine1.trim().isNotEmpty &&
      trimmedCountry.isNotEmpty &&
      city.trim().isNotEmpty &&
      (trimmedCountry != 'United States' || state.trim().isNotEmpty);

  return !hasRequiredLocation ||
      totalSpaces <= 0 ||
      blockedSpaces < 0 ||
      blockedSpaces > totalSpaces ||
      dailyRate <= 0 ||
      minimumDays < 1;
}

bool parkingLocationChanged({
  required String currentAddressLine1,
  required String currentCountry,
  required String currentState,
  required String currentCity,
  required String nextAddressLine1,
  required String nextCountry,
  required String nextState,
  required String nextCity,
}) {
  return _clean(currentAddressLine1) != _clean(nextAddressLine1) ||
      _clean(currentCountry) != _clean(nextCountry) ||
      _clean(currentState) != _clean(nextState) ||
      _clean(currentCity) != _clean(nextCity);
}

String _clean(String value) => value.trim();
