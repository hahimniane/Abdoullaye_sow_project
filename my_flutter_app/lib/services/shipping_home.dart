/// How the business home is laid out for someone at a package-shipping
/// business (docs/SHIPPING_SIMPLE_HOME.md, part H).
enum ShippingHomeLayout {
  /// Today's home, whatever it was: services card, tiles, activity.
  standard,

  /// The simple shipping home: Register a package, a few places, money.
  simple,
}

/// The services that make a business a package shipper and nothing else.
/// Shared barrels have their own pool screens, so they are not one. Spelled
/// as the stored values of `BusinessServiceKey.barrelShipping` and `.freight`
/// (a test keeps them equal).
const shippingHomeServices = <String>{'barrelShipping', 'freight'};

/// Who gets the simple home. Only a business whose every enabled service is
/// package shipping, seen by someone who may use Containers and cannot use
/// Inventory, who is not a platform admin. Everything else keeps today's home.
///
/// Ask [shopHomeLayout] first: this is only consulted when it answered
/// `standard`. [canUseContainers] is `auth.hasContainersAccess` with a
/// business, [canUseInventory] the result of `inventoryAvailable` - never
/// re-derived here.
ShippingHomeLayout shippingHomeLayout({
  required bool isAdmin,
  required bool hasBusinessDashboardAccess,
  required bool canUseContainers,
  required bool canUseInventory,
  required Iterable<String> services,
}) {
  if (isAdmin ||
      !hasBusinessDashboardAccess ||
      !canUseContainers ||
      canUseInventory) {
    return ShippingHomeLayout.standard;
  }
  final list = services.toList();
  if (list.isEmpty) return ShippingHomeLayout.standard;
  for (final service in list) {
    if (!shippingHomeServices.contains(service)) {
      return ShippingHomeLayout.standard;
    }
  }
  return ShippingHomeLayout.simple;
}

/// Whether the word "Container" can be kept off the screen: the business
/// ships by air and has never had a container that is not an air shipment.
bool airOnlyBusiness({
  required bool shipsByAir,
  required bool hasSeaContainer,
}) => shipsByAir && !hasSeaContainer;

/// The two facts the simple home's rows depend on.
class ShippingHomeFacts {
  const ShippingHomeFacts({
    required this.shipsByAir,
    required this.hasSeaContainer,
  });

  /// What the home shows when the facts could not be read: today's behaviour
  /// (the Containers row).
  static const unknown = ShippingHomeFacts(
    shipsByAir: false,
    hasSeaContainer: true,
  );

  final bool shipsByAir;
  final bool hasSeaContainer;

  bool get airOnly =>
      airOnlyBusiness(shipsByAir: shipsByAir, hasSeaContainer: hasSeaContainer);

  @override
  bool operator ==(Object other) =>
      other is ShippingHomeFacts &&
      other.shipsByAir == shipsByAir &&
      other.hasSeaContainer == hasSeaContainer;

  @override
  int get hashCode => Object.hash(shipsByAir, hasSeaContainer);
}

/// The places the simple home lists, top to bottom.
enum ShippingHomePlace {
  requests,
  packagesHere,
  onTheWay,
  containers,
  deliveries,
}

/// The rows of the simple home, in order.
///
/// [facts] is null while they load: the row that depends on them (On the
/// way / Containers) is simply not there yet. A failed read arrives as
/// [ShippingHomeFacts.unknown], which gives the Containers row.
/// Requests only while customers have open requests waiting on the business.
List<ShippingHomePlace> shippingHomePlaces({
  required ShippingHomeFacts? facts,
  required int openRequests,
  required bool canUseDeliveries,
}) => [
  if (openRequests > 0) ShippingHomePlace.requests,
  ShippingHomePlace.packagesHere,
  if (facts != null)
    facts.airOnly ? ShippingHomePlace.onTheWay : ShippingHomePlace.containers,
  if (canUseDeliveries) ShippingHomePlace.deliveries,
];
