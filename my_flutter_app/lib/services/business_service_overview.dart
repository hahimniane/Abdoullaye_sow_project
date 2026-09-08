import '../models/business_service.dart' as business_services;
import '../utils/business_permissions.dart';
import 'business_parking_entry.dart';
import 'business_transport_jobs.dart';

/// What a business sees on the phone, and what the activity feed can be
/// narrowed to.
///
/// Lives here rather than in `home_menu.dart` because the whole point of this
/// file is that the overview's decisions can be driven by a unit test:
/// `AuthProvider` builds Firebase in its field initialisers and so cannot be
/// constructed in a widget test.
enum ServiceCategory { all, parking, barrels, freight, transport, sales }

/// The category a notification names (`parking`, `barrels`, ...), or null.
ServiceCategory? serviceCategoryFromKey(String? key) {
  switch (key) {
    case 'parking':
      return ServiceCategory.parking;
    case 'barrels':
      return ServiceCategory.barrels;
    case 'freight':
      return ServiceCategory.freight;
    case 'transport':
      return ServiceCategory.transport;
    case 'sales':
      return ServiceCategory.sales;
    default:
      return null;
  }
}

/// The order the tiles are laid out in.
///
/// Parking leads because it is the only service with a create action on the
/// phone, and so the only one whose tile sits above the button that feeds it.
/// The rest follow the order the old filter chips used, so a lot that learned
/// the chips does not have to relearn the grid.
const List<ServiceCategory> businessServiceOverviewOrder = <ServiceCategory>[
  ServiceCategory.parking,
  ServiceCategory.barrels,
  ServiceCategory.freight,
  ServiceCategory.transport,
  ServiceCategory.sales,
];

/// The services whose records actually reach this screen.
///
/// Car sales is deliberately absent. Nothing subscribes to listings or
/// purchases here - they live in the mobile tabs, which is what
/// `businessCarsMobileNote` already says - so a sales tile would carry a
/// meaningless count and open an always-empty list. A tile that cannot answer
/// "does this need me today" is a filter wearing a button's clothes, which is
/// worse than no tile.
const Set<ServiceCategory> businessServiceOverviewFeedCategories =
    <ServiceCategory>{
      ServiceCategory.parking,
      ServiceCategory.barrels,
      ServiceCategory.freight,
      ServiceCategory.transport,
    };

/// Which categories this business may see records for at all.
///
/// Two gates, both of which must pass: the business has to have switched the
/// service on (`businessServices`), and the signed-in person has to hold the
/// permission that scopes it. An empty service list is legacy data rather than
/// a business with no services, so it reads as the full catalogue - the same
/// compatibility rule `normalizeBusinessServices` applies.
Set<ServiceCategory> businessActivityCategories({
  required Iterable<String> services,
  required bool Function(String permission) hasPermission,
}) {
  final enabled = services.isEmpty
      ? business_services.defaultBusinessServiceValues
      : services;
  bool offers(business_services.BusinessServiceKey key) =>
      business_services.hasBusinessService(enabled, key);

  return <ServiceCategory>{
    if (offers(business_services.BusinessServiceKey.carParking) &&
        hasPermission(BusinessPermission.parking))
      ServiceCategory.parking,
    if (offers(business_services.BusinessServiceKey.barrelShipping) &&
        hasPermission(BusinessPermission.barrels))
      ServiceCategory.barrels,
    if (offers(business_services.BusinessServiceKey.freight) &&
        hasPermission(BusinessPermission.freight))
      ServiceCategory.freight,
    if (offers(business_services.BusinessServiceKey.carTransport) &&
        hasPermission(BusinessPermission.transport))
      ServiceCategory.transport,
    if (offers(business_services.BusinessServiceKey.carSales) &&
        (hasPermission(BusinessPermission.listings) ||
            hasPermission(BusinessPermission.purchases)))
      ServiceCategory.sales,
  };
}

/// The statuses that mean a record is done with.
///
/// A deliberate mirror of the console's `isFinalStatus`
/// (`admin_web/src/components/customer-console.tsx`), so a shipment the
/// console counts as closed is not counted as open here. Expressed as
/// "everything else is open" rather than as a list of open statuses because
/// barrels, freight and transport each have their own in-flight vocabulary
/// (`pending_payment`, `not_started`, `scheduled`, ...) and a new one must not
/// silently drop out of the count.
const Set<String> businessServiceFinalStatuses = <String>{
  'completed',
  'cancelled',
  'refunded',
  'sold',
  'delivered',
};

/// Whether a record still needs someone.
///
/// A record with no status recorded is open: it has certainly not been
/// completed, and under-counting work is the direction that loses money.
bool businessServiceStatusIsOpen(String status) =>
    !businessServiceFinalStatuses.contains(status.trim().toLowerCase());

/// How many of these records are still open.
int businessServiceOpenCount(Iterable<String> statuses) =>
    statuses.where(businessServiceStatusIsOpen).length;

/// How many parked cars the lot is still owed for.
///
/// Parking's number is money, not volume - "you have 40 cars" is not an
/// instruction, "4 unpaid" is. [businessParkingPaymentTone] already carries
/// the precedence rule the console uses, paid before cancelled, so a
/// cancelled-but-paid car is never chased and a customer's own booking is
/// never counted against the lot.
int businessParkingUnpaidCount(Iterable<Map<String, dynamic>> rows) => rows
    .where(
      (row) =>
          businessParkingPaymentTone(row) ==
          BusinessParkingPaymentTone.awaiting,
    )
    .length;

/// What a tile's number is counting.
///
/// The same digit means entirely different things per service, and the caption
/// under it is the only thing that says which - so the caption is chosen here
/// rather than guessed from the category at the call site.
enum BusinessServiceCountMeaning {
  /// Money the lot is still owed.
  unpaid,

  /// Records still open.
  open,

  /// Work waiting on this business specifically: transport requests it has not
  /// bid on yet, plus won jobs it has not delivered. Not a record count - a
  /// business with nothing to do reads zero even with a full history.
  needsYou,
}

/// One service, and the one number that says whether it needs attention.
class BusinessServiceTile {
  const BusinessServiceTile({
    required this.category,
    required this.count,
    required this.meaning,
  });

  final ServiceCategory category;

  final int count;

  /// What [count] is counting, and so which caption sits under it.
  final BusinessServiceCountMeaning meaning;

  /// True when [count] is money still owed rather than work still open.
  bool get countIsUnpaid => meaning == BusinessServiceCountMeaning.unpaid;

  @override
  bool operator ==(Object other) =>
      other is BusinessServiceTile &&
      other.category == category &&
      other.count == count &&
      other.meaning == meaning;

  @override
  int get hashCode => Object.hash(category, count, meaning);

  @override
  String toString() =>
      'BusinessServiceTile(${category.name}, $count, ${meaning.name})';
}

/// The whole grid: one tile per service this business actually offers, in
/// display order, each carrying a live count taken from the lists the screen
/// has already subscribed to. Nothing here reads Firestore.
List<BusinessServiceTile> businessServiceOverviewTiles({
  required Iterable<String> services,
  required bool Function(String permission) hasPermission,
  required Iterable<Map<String, dynamic>> parkedCarFields,
  required Iterable<String> barrelStatuses,
  required Iterable<String> freightStatuses,
  required Iterable<String> transportStatuses,
  Iterable<String> transportOpportunityStatuses = const <String>[],
}) {
  final enabled = businessActivityCategories(
    services: services,
    hasPermission: hasPermission,
  );
  return <BusinessServiceTile>[
    for (final category in businessServiceOverviewOrder)
      if (enabled.contains(category) &&
          businessServiceOverviewFeedCategories.contains(category))
        BusinessServiceTile(
          category: category,
          count: switch (category) {
            ServiceCategory.parking => businessParkingUnpaidCount(
              parkedCarFields,
            ),
            ServiceCategory.barrels => businessServiceOpenCount(barrelStatuses),
            ServiceCategory.freight => businessServiceOpenCount(
              freightStatuses,
            ),
            // Transport is the one service where the business is bidding for
            // work as well as doing it, so "still open" alone would miss half
            // the day: a request nobody has quoted is the most urgent thing on
            // the screen and lives in a different collection entirely.
            ServiceCategory.transport => businessTransportNeedsYouCount(
              opportunityStatuses: transportOpportunityStatuses,
              jobStatuses: transportStatuses,
            ),
            ServiceCategory.sales || ServiceCategory.all => 0,
          },
          meaning: switch (category) {
            ServiceCategory.parking => BusinessServiceCountMeaning.unpaid,
            ServiceCategory.transport => BusinessServiceCountMeaning.needsYou,
            _ => BusinessServiceCountMeaning.open,
          },
        ),
  ];
}

/// What tapping a tile selects.
///
/// Tapping the tile that is already narrowing the feed clears the narrowing.
/// With the filter chips gone the tiles are the only control, so each one has
/// to be its own way back to everything - a selected tile with no way out is
/// how records read as missing.
ServiceCategory businessServiceOverviewSelection(
  ServiceCategory current,
  ServiceCategory tapped,
) => current == tapped ? ServiceCategory.all : tapped;
