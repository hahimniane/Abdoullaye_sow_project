import '../data/country_catalog.dart';
import '../models/destination_country.dart';
import 'waiting_package_service.dart';

/// Which destination records the Services & coverage list shows.
///
/// A business can hold a record for every country (the platform's seed action
/// writes the whole catalog), nearly all of them empty and paused. The list
/// shows the ones the business actually uses: active, the main destination, or
/// with a service switched on. Mirrors `destinationIsInUse` in the web console
/// (`admin_web/src/lib/destination-visibility.ts`).
bool destinationIsInUse(DestinationCountry country) =>
    country.isActive ||
    country.isMain ||
    country.serviceAvailability.values.any((on) => on);

/// The records worth listing, in use only. Order is kept.
List<DestinationCountry> listedDestinations(
  Iterable<DestinationCountry> stored,
) => [
  for (final country in stored)
    if (destinationIsInUse(country)) country,
];

/// The countries "Add country" offers: every country in the catalog that is
/// not listed, by name. A country whose record exists but is unused is
/// offered with its stored record (so nothing already saved is lost); one the
/// business never held comes from the catalog. A stored record outside the
/// catalog that is unused is offered too.
List<DestinationCountry> destinationsToAdd(
  Iterable<DestinationCountry> stored, {
  Iterable<DestinationCountry> catalog = CountryCatalog.all,
}) {
  final storedById = {for (final country in stored) country.id: country};
  final listedIds = {
    for (final country in storedById.values)
      if (destinationIsInUse(country)) country.id,
  };
  final offered = <String, DestinationCountry>{};
  for (final country in catalog) {
    if (listedIds.contains(country.id)) continue;
    offered[country.id] = storedById[country.id] ?? country;
  }
  for (final country in storedById.values) {
    if (listedIds.contains(country.id)) continue;
    offered.putIfAbsent(country.id, () => country);
  }
  return offered.values.toList()
    ..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
}

/// Whether [country] matches the search box: name, code or flag.
bool destinationMatchesSearch(DestinationCountry country, String query) {
  final text = query.trim();
  if (text.isEmpty) return true;
  final lower = text.toLowerCase();
  return country.name.toLowerCase().contains(lower) ||
      (country.code ?? '').toLowerCase().contains(lower) ||
      country.flagEmoji.contains(text);
}

/// Makes [country] the main destination, or clears it when it already is.
/// A server call, never a client write: the destination security rule checks
/// the whole document, so a fully set-up destination would be refused.
/// Returns true when this call set it, false when it cleared it.
Future<bool> setMainDestination({
  required String businessId,
  required DestinationCountry country,
  ContainerCallableCaller caller = callContainerCallable,
}) async {
  await caller('setMainDestination', {
    'businessId': businessId,
    'countryId': country.isMain ? '' : country.id,
  });
  return !country.isMain;
}
