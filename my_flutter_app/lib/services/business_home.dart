/// Which work a business home leads with (docs/APP_NEW_LOOK.md, H1 and H2).
///
/// A business home is its main work (one loud button, three numbers, the few
/// places that work uses every day), then a small block for each other
/// service the person may use. This file is the one decision behind that:
/// pure, so a unit test can drive it. Every gate is passed in as a boolean by
/// the caller, from the rules the home already uses; none is re-derived here.
library;

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
