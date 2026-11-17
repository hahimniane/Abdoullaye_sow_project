/// The listings screen's search, status filter, bulk status change and
/// photo-by-link rules as pure functions. Mirrors the website's
/// `ListingsPanel` (operations-panels.tsx), so the phone and the console
/// read and change the same list the same way.
library;

import '../models/car.dart';

/// Every status a listing can be set to, in the console's order.
const List<String> listingStatuses = <String>[
  'draft',
  'active',
  'reserved',
  'sold',
  'inactive',
];

/// The status a listing counts under: a blank one is "active" (the console's
/// `text(row.status) || "active"`).
String listingStatusOf(Car car) {
  final status = car.status.trim().toLowerCase();
  return status.isEmpty ? 'active' : status;
}

/// The text the search reads for one listing: the console's title, make,
/// model, year, price, status, city, state, stock number and VIN.
String listingSearchText(Car car) {
  final price = car.price == car.price.roundToDouble()
      ? car.price.toStringAsFixed(0)
      : car.price.toString();
  return [
    car.title,
    car.make,
    car.model,
    car.year,
    price,
    listingStatusOf(car),
    car.locationCity,
    car.locationState,
    car.stockNumber,
    car.vin,
  ].join(' ').toLowerCase();
}

/// The listings to show: those matching every word of [query] (any case),
/// and, unless [status] is null or `all`, that status. Keeps the order.
List<Car> filterListings(List<Car> cars, {String query = '', String? status}) {
  final words = query
      .toLowerCase()
      .split(RegExp(r'\s+'))
      .where((word) => word.isNotEmpty)
      .toList();
  final wanted = (status == null || status == 'all') ? null : status;
  if (words.isEmpty && wanted == null) return cars;
  return [
    for (final car in cars)
      if ((wanted == null || listingStatusOf(car) == wanted) &&
          (words.isEmpty || words.every(listingSearchText(car).contains)))
        car,
  ];
}

/// Ticks or unticks [id], returning a new set.
Set<String> toggleListingSelection(Set<String> selected, String id, bool on) {
  final next = {...selected};
  if (on) {
    next.add(id);
  } else {
    next.remove(id);
  }
  return next;
}

/// Keeps only ids that still exist, so a deleted listing cannot stay ticked.
Set<String> pruneListingSelection(Set<String> selected, Iterable<String> ids) {
  final live = ids.toSet();
  return {
    for (final id in selected)
      if (live.contains(id)) id,
  };
}

/// Splits ids into groups no larger than [size] (a Firestore batch takes 500).
List<List<String>> chunkListingIds(List<String> ids, {int size = 400}) {
  final out = <List<String>>[];
  for (var i = 0; i < ids.length; i += size) {
    out.add(ids.sublist(i, i + size > ids.length ? ids.length : i + size));
  }
  return out;
}

/// Why a photo link is refused, or null when it can be added.
enum ListingImageLinkProblem { empty, notHttps, full }

/// Checks a pasted photo link against the photo cap. The console accepts any
/// text; the phone requires a web address (https, or http) so a typo does not
/// leave a broken picture on the listing.
ListingImageLinkProblem? checkListingImageLink(
  String raw, {
  required int count,
  required int max,
}) {
  final link = raw.trim();
  if (link.isEmpty) return ListingImageLinkProblem.empty;
  if (count >= max) return ListingImageLinkProblem.full;
  final uri = Uri.tryParse(link);
  final ok =
      uri != null &&
      (uri.scheme == 'https' || uri.scheme == 'http') &&
      uri.host.contains('.');
  return ok ? null : ListingImageLinkProblem.notHttps;
}
