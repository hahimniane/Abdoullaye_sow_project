/// Which work a business home leads with (docs/APP_NEW_LOOK.md, H1 and H2).
///
/// A business home is its main work (one loud button, three numbers, the few
/// places that work uses every day), then a small block for each other
/// service the person may use. This file is the one decision behind that:
/// pure, so a unit test can drive it. Every gate is passed in as a boolean by
/// the caller, from the rules the home already uses; none is re-derived here.
library;

import '../models/business_service.dart' show BusinessServiceKey;

/// The works a business home can lead with.
enum HomeWork {
  parking('parking'),
  shipping('shipping'),
  shop('shop'),
  carSales('carSales'),
  transport('transport');

  const HomeWork(this.key);

  /// The stored value, `businesses/{id}.mainWork`.
  final String key;

  /// The work a stored value names, or null for anything else (an empty,
  /// missing or unknown value is "never chosen", not an error).
  static HomeWork? fromKey(Object? stored) {
    final text = '${stored ?? ''}'.trim();
    for (final work in values) {
      if (work.key == text) return work;
    }
    return null;
  }
}

/// The order a home led with before the setting existed: whoever may sell
/// first, then parking, shipping, car sales, transport.
const List<HomeWork> homeWorkDefaultOrder = <HomeWork>[
  HomeWork.shop,
  HomeWork.parking,
  HomeWork.shipping,
  HomeWork.carSales,
  HomeWork.transport,
];

/// The works this person can do here, in the default order.
///
/// Each flag is the gate that already guards that work's place on the home:
/// the business has the service switched on AND this person holds its
/// permission. A person never sees a work they cannot do, so a parking lot
/// has no shipping and a shipper has no parking.
List<HomeWork> homeWorks({
  required bool canSell,
  required bool canPark,
  required bool canShip,
  required bool canSellCars,
  required bool canTransport,
}) {
  final allowed = <HomeWork, bool>{
    HomeWork.shop: canSell,
    HomeWork.parking: canPark,
    HomeWork.shipping: canShip,
    HomeWork.carSales: canSellCars,
    HomeWork.transport: canTransport,
  };
  return [
    for (final work in homeWorkDefaultOrder)
      if (allowed[work] == true) work,
  ];
}

/// The work the home leads with: the stored choice when it is one of
/// [works], otherwise the first of [works] in the default order (what the
/// home led with before the setting existed). Null when [works] is empty.
HomeWork? mainHomeWork(List<HomeWork> works, String? stored) {
  if (works.isEmpty) return null;
  final chosen = HomeWork.fromKey(stored);
  if (chosen != null && works.contains(chosen)) return chosen;
  for (final work in homeWorkDefaultOrder) {
    if (works.contains(work)) return work;
  }
  return works.first;
}

/// The works that get a small block under the main one, in the default
/// order.
List<HomeWork> homeOtherWorks(List<HomeWork> works, HomeWork? main) => [
  for (final work in homeWorkDefaultOrder)
    if (works.contains(work) && work != main) work,
];

/// The blocks a business home is made of, top to bottom.
enum HomePart {
  /// The shop block: Sell, today's numbers, quick links.
  shop,

  /// The simple shipping block: Register a package, its places, money rows.
  shipping,

  /// The standard home: the services block (its tiles, the parking action,
  /// the places, the tail) and the activity feed that goes with it.
  services,
}

/// The order of the home's blocks for this person.
///
/// - Main work shop (or none chosen and the person may sell): the shop block
///   first, then the standard services block, exactly as before the setting.
/// - Main work shipping, for a person who may ship at a business that has
///   another work they can do: the simple shipping block first, then the
///   standard services block (which carries the other works, and the shop
///   block inside it when the person may sell).
/// - Any other main work (parking, car sales, transport) or no work at all:
///   the standard services block leads; the shop block, when the person may
///   sell, follows it.
///
/// A shipping-only person never reaches this: the home's own simple-shipping
/// rule answers first. [shop] is always the last part when it is not first,
/// because it is drawn at the end of the services block.
List<HomePart> homeParts({required List<HomeWork> works, String? stored}) {
  final main = mainHomeWork(works, stored);
  if (main == null) return const [HomePart.services];
  final canSell = works.contains(HomeWork.shop);
  if (main == HomeWork.shop) return const [HomePart.shop, HomePart.services];
  if (main == HomeWork.shipping && works.length > 1) {
    return [HomePart.shipping, HomePart.services, if (canSell) HomePart.shop];
  }
  return [HomePart.services, if (canSell) HomePart.shop];
}

/// The works a business has switched on, from its `enabledServices` values,
/// in the default order: what Business profile offers as the main work.
/// Parking is car parking; shipping is the package-shipping services (barrel
/// shipping, the retired freight); shop is inventory; car sales and car
/// transport are their own services.
List<HomeWork> homeWorksOn(Iterable<String> services) {
  final on = services.toSet();
  bool has(BusinessServiceKey key) => on.contains(key.value);
  return [
    for (final work in homeWorkDefaultOrder)
      if (switch (work) {
        HomeWork.shop => has(BusinessServiceKey.inventory),
        HomeWork.parking => has(BusinessServiceKey.carParking),
        HomeWork.shipping =>
          has(BusinessServiceKey.barrelShipping) ||
              has(BusinessServiceKey.freight),
        HomeWork.carSales => has(BusinessServiceKey.carSales),
        HomeWork.transport => has(BusinessServiceKey.carTransport),
      })
        work,
  ];
}

/// The main work to save, or null when nothing valid was chosen: the choice
/// must be one of the works the business has on, and the picker only exists
/// with two or more.
String? mainWorkToSave(String? chosen, Iterable<String> services) {
  final work = HomeWork.fromKey(chosen);
  final on = homeWorksOn(services);
  if (work == null || on.length < 2 || !on.contains(work)) return null;
  return work.key;
}
