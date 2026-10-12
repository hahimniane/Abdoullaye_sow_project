import 'inventory.dart';

/// How the business home is laid out for the signed-in person.
///
/// The Sell action is the thing a shop does all day, so whoever may sell gets
/// it first. Everyone else keeps the home exactly as it was.
enum ShopHomeLayout {
  /// Today's home: services, tools and the activity feed. Customers, platform
  /// admins, and staff without the inventory permission.
  standard,

  /// The Sell hero and today's numbers on top, then the business's other
  /// service sections unchanged (Inventory alongside parking, shipping...).
  sellFirst,

  /// A shop: the Sell hero, today's numbers, quick links and today's sales,
  /// then a quiet "More" list. Nothing about services that are not there.
  shopOnly,
}

/// The one decision behind the layout. [canUseInventory] is the result of
/// [inventoryAvailable] (the service is on, the person holds the inventory
/// permission, there is a business) - never re-derived here.
/// [hasServiceSections] is whether any other service gives this person a
/// section on the home (parking, barrels, freight, transport, car sales).
ShopHomeLayout shopHomeLayout({
  required bool isAdmin,
  required bool hasBusinessDashboardAccess,
  required bool canUseInventory,
  required bool hasServiceSections,
}) {
  if (isAdmin || !hasBusinessDashboardAccess || !canUseInventory) {
    return ShopHomeLayout.standard;
  }
  return hasServiceSections
      ? ShopHomeLayout.sellFirst
      : ShopHomeLayout.shopOnly;
}

/// Whether the staff shell offers Sell as its raised centre action: the same
/// gate as the hero, for staff and owners only. [tabCount] keeps a crowded
/// bar (car sales adds two tabs) as it is: the centre button needs room.
bool shopSellActionAvailable({
  required bool isAdmin,
  required Iterable<String> services,
  required bool hasInventoryPermission,
  required String businessId,
  required int tabCount,
}) =>
    !isAdmin &&
    tabCount <= shopSellActionMaxTabs &&
    inventoryAvailable(
      services: services,
      hasPermission: hasInventoryPermission,
      businessId: businessId,
    );

/// The most tabs the bar carries alongside the raised Sell button.
const shopSellActionMaxTabs = 4;

/// How many of the newest sales the home reads to find today's.
const shopHomeRecentSalesRead = 10;

/// How many of today's sales the home lists.
const shopHomeRecentSalesShown = 5;

/// The sales made on [now]'s calendar day (device time), newest first, at
/// most [max]. Sales with no time yet (a write still in flight) count as now.
List<InventorySale> inventorySalesToday(
  Iterable<InventorySale> sales,
  DateTime now, {
  int max = shopHomeRecentSalesShown,
}) {
  bool sameDay(DateTime d) =>
      d.year == now.year && d.month == now.month && d.day == now.day;
  final today = [
    for (final sale in sales)
      if (sameDay((sale.createdAt ?? now).toLocal())) sale,
  ]..sort((a, b) => (b.createdAt ?? now).compareTo(a.createdAt ?? now));
  return today.length > max ? today.sublist(0, max) : today;
}

/// What the home's today numbers depend on: which sales exist and which were
/// voided. When it changes (a sale made from the bottom bar, a void on the
/// sales screen) the numbers are read again; when it does not, they are not.
String inventorySalesSignature(Iterable<InventorySale> sales) =>
    [for (final sale in sales) '${sale.id}:${sale.voided ? 1 : 0}'].join(',');
