import 'business_service_overview.dart'
    show ServiceCategory, businessServiceFinalStatuses;
import 'business_transport_jobs.dart' show transportJobFinalStatuses;
import 'container_manifest.dart'
    show
        containerLineStatusWaiting,
        containerStatusArrived,
        containerStatusLoading,
        containerStatusShipped;
import 'firestore_query_spec.dart';
import 'package_requests.dart' show requestOpenStatuses;

/// Every query a business screen runs against its own records, as data.
///
/// The shape rule, enforced by `test/firestore_query_scope_test.dart`: each
/// one names the business, and each one is bounded - by "still open", by a
/// date window, or by an ordered page. None of them reads a business's whole
/// history just to show today's work. Every composite index a query here
/// needs is in `firestore.indexes.json`, and the test checks the shape
/// against it field by field.

/// One page of a history list. Small on purpose: history is opened on
/// request, and the first page is what answers "the one from last week".
const int businessActivityHistoryPageSize = 25;

/// The newest N records a VIN autocomplete keeps in memory. A VIN older than
/// these is looked up exactly ([knownCarVinSpecs]), never by reading
/// everything.
const int knownCarRecentLimit = 100;

/// One page of the car marketplace.
const int marketplacePageSize = 30;

/// Parking payment states that mean nothing is left to chase. The mirror of
/// [businessParkingPaymentTone]: paid, or nothing was ever owed.
const List<String> parkingSettledPaymentStatuses = <String>[
  'succeeded',
  'paid',
  'not_required',
];

/// The open-box statuses: a car on a loading or sailed container is "in a
/// container"; an arrived box says nothing about the car any more.
const List<String> containerOpenStatuses = <String>[
  containerStatusLoading,
  containerStatusShipped,
];

QueryFilterSpec _business(String businessId) =>
    QueryFilterSpec('businessId', QueryFilterOp.equal, businessId.trim());

// ---------------------------------------------------------------------------
// The business home: open work, live.
// ---------------------------------------------------------------------------

/// Barrel shipments still in flight. The tile counts exactly these.
FirestoreQuerySpec barrelShipmentsOpenSpec(String businessId) =>
    FirestoreQuerySpec(
      collection: 'barrelShipments',
      filters: [
        _business(businessId),
        QueryFilterSpec(
          'status',
          QueryFilterOp.notIn,
          businessServiceFinalStatuses.toList(),
        ),
      ],
    );

/// Freight shipments still in flight.
FirestoreQuerySpec freightShipmentsOpenSpec(String businessId) =>
    FirestoreQuerySpec(
      collection: 'freightShipments',
      filters: [
        _business(businessId),
        QueryFilterSpec(
          'status',
          QueryFilterOp.notIn,
          businessServiceFinalStatuses.toList(),
        ),
      ],
    );

/// Won transport jobs not yet delivered - the jobs half of "needs you".
FirestoreQuerySpec transportRequestsOpenSpec(String businessId) =>
    FirestoreQuerySpec(
      collection: 'transportRequests',
      filters: [
        _business(businessId),
        QueryFilterSpec(
          'status',
          QueryFilterOp.notIn,
          transportJobFinalStatuses.toList(),
        ),
      ],
    );

/// Requests this business may still bid on - the other half of "needs you".
/// Only `open` is counted, so only `open` is read.
FirestoreQuerySpec transportOpportunitiesOpenSpec(String businessId) =>
    FirestoreQuerySpec(
      collection: 'transportOpportunities',
      filters: [
        _business(businessId),
        const QueryFilterSpec('status', QueryFilterOp.equal, 'open'),
      ],
    );

/// Local midnight today, in milliseconds - the floor for "still on the lot".
int parkingTodayFloorMs(DateTime now) =>
    DateTime(now.year, now.month, now.day).millisecondsSinceEpoch;

/// Stays that hold a space today or later: on the lot, booked, or open-ended.
/// `occupancyEndMs` is stamped on every parkedCars write by the
/// `syncParkedCarOccupancy` trigger (its leave date, or the far future for an
/// open-ended stay), so this is the same index the server's availability
/// search reads.
FirestoreQuerySpec parkedCarsOnLotSpec(String businessId, DateTime now) =>
    FirestoreQuerySpec(
      collection: 'parkedCars',
      filters: [
        _business(businessId),
        QueryFilterSpec(
          'occupancyEndMs',
          QueryFilterOp.greaterOrEqual,
          parkingTodayFloorMs(now),
        ),
      ],
    );

/// Stays the lot is still owed for, however long ago they ended. The parking
/// tile counts money owed, so a car that left last spring unpaid is as much
/// today's work as one in the yard.
FirestoreQuerySpec parkedCarsUnsettledSpec(String businessId) =>
    FirestoreQuerySpec(
      collection: 'parkedCars',
      filters: [
        _business(businessId),
        const QueryFilterSpec(
          'paymentStatus',
          QueryFilterOp.notIn,
          parkingSettledPaymentStatuses,
        ),
      ],
    );

/// Which collection a history page reads, and the date it is ordered by.
enum BusinessHistoryCollection {
  parkedCars('parkedCars', 'parkingDate'),
  barrelShipments('barrelShipments', 'createdAt'),
  freightShipments('freightShipments', 'createdAt'),
  transportRequests('transportRequests', 'createdAt');

  const BusinessHistoryCollection(this.path, this.dateField);

  final String path;
  final String dateField;
}

/// The history lists a feed narrowed to [selected] pages through: that
/// service's, or every enabled one's under "all". Car sales has no feed
/// (see `businessServiceOverviewFeedCategories`) and so no history here.
List<BusinessHistoryCollection> businessHistoryCollectionsFor({
  required ServiceCategory selected,
  required Set<ServiceCategory> enabled,
}) {
  const byCategory = <ServiceCategory, BusinessHistoryCollection>{
    ServiceCategory.parking: BusinessHistoryCollection.parkedCars,
    ServiceCategory.barrels: BusinessHistoryCollection.barrelShipments,
    ServiceCategory.freight: BusinessHistoryCollection.freightShipments,
    ServiceCategory.transport: BusinessHistoryCollection.transportRequests,
  };
  return [
    for (final entry in byCategory.entries)
      if (enabled.contains(entry.key) &&
          (selected == ServiceCategory.all || selected == entry.key))
        entry.value,
  ];
}

/// One ordered page of a business's records, newest first. The cursor
/// (`startAfterDocument`) is added by the caller; the shape - and so the
/// index - is the same for every page.
FirestoreQuerySpec businessHistoryPageSpec(
  BusinessHistoryCollection collection,
  String businessId, {
  int pageSize = businessActivityHistoryPageSize,
}) => FirestoreQuerySpec(
  collection: collection.path,
  filters: [_business(businessId)],
  orderBy: collection.dateField,
  descending: true,
  limit: pageSize,
);

// ---------------------------------------------------------------------------
// Containers: the open boxes, for "this car is on MSKU..." links.
// ---------------------------------------------------------------------------

FirestoreQuerySpec openContainersSpec(String businessId) => FirestoreQuerySpec(
  collection: 'containers',
  filters: [
    _business(businessId),
    const QueryFilterSpec('status', QueryFilterOp.whereIn, containerOpenStatuses),
  ],
);

/// Lines on open boxes. `containerStatus` is kept on each line by the server
/// whenever its box moves, so the arrived history never has to be read to
/// draw a link.
FirestoreQuerySpec openContainerLinesSpec(String businessId) =>
    FirestoreQuerySpec(
      collection: 'containerLines',
      filters: [
        _business(businessId),
        const QueryFilterSpec(
          'containerStatus',
          QueryFilterOp.whereIn,
          containerOpenStatuses,
        ),
      ],
    );

// ---------------------------------------------------------------------------
// The containers screen: open boxes whole, arrived history a page at a time.
// The console's containers panel reads the same shapes.
// ---------------------------------------------------------------------------

/// One page of arrived containers - history that only grows.
const int arrivedContainerPageSize = 25;

/// Firestore's cap on the values of one `in` filter.
const int firestoreWhereInLimit = 30;

/// Packages dropped off and not on a container yet: live and whole, a short
/// list that empties as containers claim them. Equality only, so the
/// existing `businessId, containerStatus` index (or merged single-field
/// indexes) serves it.
FirestoreQuerySpec waitingContainerLinesSpec(String businessId) =>
    FirestoreQuerySpec(
      collection: 'containerLines',
      filters: [
        _business(businessId),
        const QueryFilterSpec(
          'containerStatus',
          QueryFilterOp.equal,
          containerLineStatusWaiting,
        ),
      ],
    );

/// The arrived containers, newest arrival first, one growing page at a time.
/// `arrivedAt` is stamped by the server on every arrival.
FirestoreQuerySpec arrivedContainersPageSpec(
  String businessId, {
  required int pages,
}) => FirestoreQuerySpec(
  collection: 'containers',
  filters: [
    _business(businessId),
    const QueryFilterSpec('status', QueryFilterOp.equal, containerStatusArrived),
  ],
  orderBy: 'arrivedAt',
  descending: true,
  limit: arrivedContainerPageSize * (pages < 1 ? 1 : pages),
);

/// Every arrived container, for a `count()` only: the Arrived chip counts
/// the whole history while the list holds a page of it.
FirestoreQuerySpec arrivedContainersCountSpec(String businessId) =>
    FirestoreQuerySpec(
      collection: 'containers',
      filters: [
        _business(businessId),
        const QueryFilterSpec(
          'status',
          QueryFilterOp.equal,
          containerStatusArrived,
        ),
      ],
    );

/// The lines of up to [firestoreWhereInLimit] named containers: the arrived
/// boxes on screen, or one opened from a link. Equality only.
FirestoreQuerySpec containerLinesOfContainersSpec(
  String businessId,
  List<String> containerIds,
) {
  assert(
    containerIds.isNotEmpty && containerIds.length <= firestoreWhereInLimit,
    'an in filter takes 1 to $firestoreWhereInLimit values',
  );
  return FirestoreQuerySpec(
    collection: 'containerLines',
    filters: [
      _business(businessId),
      QueryFilterSpec('containerId', QueryFilterOp.whereIn, containerIds),
    ],
  );
}

/// Every part of up to [firestoreWhereInLimit] split packages, by root id:
/// a package's money lives on its root, so a part on screen needs the whole
/// group even when the rest of it sailed long ago. Equality only.
FirestoreQuerySpec containerLineGroupsSpec(
  String businessId,
  List<String> rootIds,
) {
  assert(
    rootIds.isNotEmpty && rootIds.length <= firestoreWhereInLimit,
    'an in filter takes 1 to $firestoreWhereInLimit values',
  );
  return FirestoreQuerySpec(
    collection: 'containerLines',
    filters: [
      _business(businessId),
      QueryFilterSpec('rootLineId', QueryFilterOp.whereIn, rootIds),
    ],
  );
}

// ---------------------------------------------------------------------------
// Package requests (docs/PACKAGE_REQUESTS.md §8.3).
// ---------------------------------------------------------------------------

/// The business's open requests: the Requests tab and the Waiting list's
/// Expected section. Equality filters only, sorted newest first on the
/// phone, so it needs no composite index (the contract's
/// `orderBy createdAt` form needs `businessId, status, createdAt desc`).
FirestoreQuerySpec packageRequestsOpenSpec(String businessId) =>
    FirestoreQuerySpec(
      collection: 'packageRequests',
      filters: [
        _business(businessId),
        const QueryFilterSpec(
          'status',
          QueryFilterOp.whereIn,
          requestOpenStatuses,
        ),
      ],
    );

/// A signed-in customer's own requests ("My requests"): the rule lets the
/// sender read them by `sender.uid`. A customer has few, so the phone sorts
/// them and no composite index is needed.
FirestoreQuerySpec packageRequestsMineSpec(String uid) => FirestoreQuerySpec(
  collection: 'packageRequests',
  filters: [QueryFilterSpec('sender.uid', QueryFilterOp.equal, uid.trim())],
);

// ---------------------------------------------------------------------------
// VIN memory: the recent cars, then an exact lookup.
// ---------------------------------------------------------------------------

/// The newest parked cars and ledger jobs, for the in-memory VIN match.
List<FirestoreQuerySpec> knownCarRecentSpecs(String businessId) => [
  FirestoreQuerySpec(
    collection: 'parkedCars',
    filters: [_business(businessId)],
    orderBy: 'parkingDate',
    descending: true,
    limit: knownCarRecentLimit,
  ),
  FirestoreQuerySpec(
    collection: 'lotActivities',
    filters: [_business(businessId)],
    orderBy: 'activityDate',
    descending: true,
    limit: knownCarRecentLimit,
  ),
];

/// Every record of one VIN, in both collections. Equality-only, so no
/// composite index; a VIN's records are a handful, so no limit is needed.
List<FirestoreQuerySpec> knownCarVinSpecs(String businessId, String vin) => [
  for (final collection in const ['parkedCars', 'lotActivities'])
    FirestoreQuerySpec(
      collection: collection,
      filters: [
        _business(businessId),
        QueryFilterSpec('vinNumber', QueryFilterOp.equal, vin.trim().toUpperCase()),
      ],
    ),
];

// ---------------------------------------------------------------------------
// Month and year windows: the parking bills and the lot ledger.
// ---------------------------------------------------------------------------

/// Stays that can appear on a bill for a window starting at [startMs]: those
/// that end on or after it. The same read the server's month-end job does.
FirestoreQuerySpec parkedCarsEndingFromSpec(String businessId, int startMs) =>
    FirestoreQuerySpec(
      collection: 'parkedCars',
      filters: [
        _business(businessId),
        QueryFilterSpec('occupancyEndMs', QueryFilterOp.greaterOrEqual, startMs),
      ],
    );

/// Stays not paid up, however long ago they ended: the month end merges them
/// with [parkedCarsEndingFromSpec] so a car that left before the month still
/// owing comes along as "unpaid from before" (docs/PARKING_CARRYOVER.md).
/// On the existing `(businessId, paymentStatus)` index, exactly the server's
/// `parkingMonthEndData` query: `paymentStatus not-in [paid, succeeded]`.
/// Not [parkedCarsUnsettledSpec] (the home tile), which also leaves out
/// `not_required`: a bill still counts the days of a stay saved that way by
/// mistake, so month end must read it.
FirestoreQuerySpec parkedCarsUnpaidCarriedSpec(String businessId) =>
    FirestoreQuerySpec(
      collection: 'parkedCars',
      filters: [
        _business(businessId),
        const QueryFilterSpec(
          'paymentStatus',
          QueryFilterOp.notIn,
          parkingCarriedExcludedPaymentStatuses,
        ),
      ],
    );

/// The payment statuses a stay owes nothing under; every other stay is read
/// by [parkedCarsUnpaidCarriedSpec].
const List<String> parkingCarriedExcludedPaymentStatuses = <String>[
  'paid',
  'succeeded',
];

/// The ledger's activities collection, for reading ONE record by id - the one
/// a notification or a duplicate refusal names. A single document, never a
/// query: lists of activities go through the specs below.
const lotActivitiesCollection = 'lotActivities';

/// Ledger activities dated in [from, to). The date bounds are passed as the
/// SDK's own values (Timestamps) by the caller.
FirestoreQuerySpec lotActivitiesBetweenSpec(
  String businessId,
  Object from,
  Object to,
) => FirestoreQuerySpec(
  collection: 'lotActivities',
  filters: [
    _business(businessId),
    QueryFilterSpec('activityDate', QueryFilterOp.greaterOrEqual, from),
    QueryFilterSpec('activityDate', QueryFilterOp.less, to),
  ],
  orderBy: 'activityDate',
  descending: true,
);

/// Older activities not yet settled: they ride along on a month's bill as
/// "unpaid from before".
FirestoreQuerySpec lotActivitiesUnsettledSpec(String businessId) =>
    FirestoreQuerySpec(
      collection: 'lotActivities',
      filters: [
        _business(businessId),
        const QueryFilterSpec(
          'paymentStatus',
          QueryFilterOp.notEqual,
          'succeeded',
        ),
      ],
    );

/// The rare activity with no date, which the statement dates by createdAt.
FirestoreQuerySpec lotActivitiesUndatedSpec(String businessId) =>
    FirestoreQuerySpec(
      collection: 'lotActivities',
      filters: [
        _business(businessId),
        const QueryFilterSpec('activityDate', QueryFilterOp.isNull),
      ],
    );

/// Expense entries for the months [startMonth]..[endMonth], inclusive.
/// `month` is a "yyyy-MM" string, which sorts chronologically.
FirestoreQuerySpec lotExpenseEntriesForMonthsSpec(
  String businessId,
  String startMonth,
  String endMonth,
) => FirestoreQuerySpec(
  collection: 'lotExpenseEntries',
  filters: [
    _business(businessId),
    QueryFilterSpec('month', QueryFilterOp.greaterOrEqual, startMonth),
    QueryFilterSpec('month', QueryFilterOp.less, nextMonthKey(endMonth)),
  ],
  orderBy: 'month',
);

/// Every expense entry of the business, for month end's staff expense credit
/// (docs/STAFF_EXPENSE_CREDIT.md §3). The credit is cumulative - every
/// expense up to the month shown, September included - so this is the whole
/// history on purpose: equality only, no index, the months filtered on the
/// phone as the server does.
FirestoreQuerySpec lotExpenseEntriesAllSpec(String businessId) =>
    FirestoreQuerySpec(
      collection: 'lotExpenseEntries',
      filters: [_business(businessId)],
    );

/// Every "Paid back" of the business (`staffExpenseRepayments`), the other
/// side of the same cumulative credit. Equality only, no index.
FirestoreQuerySpec staffExpenseRepaymentsSpec(String businessId) =>
    FirestoreQuerySpec(
      collection: 'staffExpenseRepayments',
      filters: [_business(businessId)],
    );

/// The business's expense lines (`lotExpenseLines`, a short list): their
/// names label each expense on a staff member's bill. Equality only, no
/// index.
FirestoreQuerySpec lotExpenseLinesSpec(String businessId) =>
    FirestoreQuerySpec(
      collection: 'lotExpenseLines',
      filters: [_business(businessId)],
    );

/// "2026-12" -> "2027-01". Unparsable keys come back unchanged.
String nextMonthKey(String monthKey) {
  final m = RegExp(r'^(\d{4})-(\d{2})$').firstMatch(monthKey.trim());
  if (m == null) return monthKey;
  final year = int.parse(m[1]!);
  final month = int.parse(m[2]!);
  final next = month == 12 ? (year + 1, 1) : (year, month + 1);
  return '${next.$1.toString().padLeft(4, '0')}-'
      '${next.$2.toString().padLeft(2, '0')}';
}

/// The months a lot ledger screen needs loaded: the whole report year of the
/// month in view, widened to cover the activity tab's range. Month keys sort
/// as strings, so min/max is a string compare.
({String start, String end}) lotLedgerWindow({
  required String month,
  required String activityStart,
  required String activityEnd,
}) {
  final year = month.length >= 4 ? month.substring(0, 4) : month;
  var start = '$year-01';
  var end = '$year-12';
  for (final key in [month, activityStart, activityEnd]) {
    if (key.compareTo(start) < 0) start = key;
    if (key.compareTo(end) > 0) end = key;
  }
  return (start: start, end: end);
}

// ---------------------------------------------------------------------------
// The car marketplace.
// ---------------------------------------------------------------------------

/// Active listings, newest first, one growing page at a time. Make and model
/// are filtered in the query when chosen, so a narrow search does not page
/// through the whole marketplace to find its cars.
FirestoreQuerySpec marketplaceCarsSpec({
  required int pages,
  String? make,
  String? model,
}) => FirestoreQuerySpec(
  collection: 'cars',
  filters: [
    const QueryFilterSpec('status', QueryFilterOp.equal, 'active'),
    if ((make ?? '').isNotEmpty)
      QueryFilterSpec('make', QueryFilterOp.equal, make),
    if ((make ?? '').isNotEmpty && (model ?? '').isNotEmpty)
      QueryFilterSpec('model', QueryFilterOp.equal, model),
  ],
  orderBy: 'createdAt',
  descending: true,
  limit: marketplacePageSize * (pages < 1 ? 1 : pages),
);

/// One page of the platform admin's listings screen, every business's.
const int adminCarListingsPageSize = 30;

/// The listing states the listings screen's banner counts.
const List<String> carListingCountStatuses = <String>[
  'active',
  'inactive',
  'sold',
  'reserved',
];

/// Every business's listings, newest first, one growing page at a time: the
/// admin's listings screen. The single-field `createdAt` index serves it.
FirestoreQuerySpec adminCarListingsPageSpec({required int pages}) =>
    FirestoreQuerySpec(
      collection: 'cars',
      orderBy: 'createdAt',
      descending: true,
      limit: adminCarListingsPageSize * (pages < 1 ? 1 : pages),
    );

/// The listings the admin's banner counts with `count()`: all of them, or
/// one [status]. Never listened to - an aggregate reads one document per
/// thousand counted.
FirestoreQuerySpec carListingsCountSpec({String? status}) {
  final state = (status ?? '').trim();
  return FirestoreQuerySpec(
    collection: 'cars',
    filters: [
      if (state.isNotEmpty) QueryFilterSpec('status', QueryFilterOp.equal, state),
    ],
  );
}

/// The banner's numbers from listings already in hand: `total` and one entry
/// per [carListingCountStatuses]. Exact only when the hand holds every
/// listing - a business's own, or an admin's last page that came back short.
Map<String, int> carListingCounts(Iterable<String> statuses) {
  final out = <String, int>{
    'total': 0,
    for (final status in carListingCountStatuses) status: 0,
  };
  for (final status in statuses) {
    out['total'] = out['total']! + 1;
    if (out.containsKey(status)) out[status] = out[status]! + 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The platform admin dashboard: previews and open queues across businesses.
// ---------------------------------------------------------------------------

/// How many businesses the dashboard's management preview shows; "Open full
/// list" has the rest.
const int adminBusinessPreviewSize = 10;

/// One page of the dashboard's open-shipments sheet.
const int adminShipmentPageSize = 25;

/// The first [adminBusinessPreviewSize] businesses in the preview's order -
/// by status, then name - instead of every business on the platform sorted
/// on the phone. Needs `businesses (status, name)`.
const FirestoreQuerySpec adminBusinessPreviewSpec = FirestoreQuerySpec(
  collection: 'businesses',
  orderBy: 'status',
  thenOrderBy: 'name',
  limit: adminBusinessPreviewSize,
);

/// Shipments in one [status] across every business, newest first, one
/// growing page at a time. The tile above it counts them with `count()`.
FirestoreQuerySpec adminShipmentsByStatusPageSpec(
  String status, {
  required int pages,
}) => FirestoreQuerySpec(
  collection: 'barrelShipments',
  filters: [QueryFilterSpec('status', QueryFilterOp.equal, status.trim())],
  orderBy: 'createdAt',
  descending: true,
  limit: adminShipmentPageSize * (pages < 1 ? 1 : pages),
);

// ---------------------------------------------------------------------------
// Invoices: the open tab live, history one page at a time.
// ---------------------------------------------------------------------------

/// One page of the invoice list.
const int invoicePageSize = 25;

/// The newest invoices, by invoice day, one growing page at a time. Open
/// invoices are read whole by [invoicesOpenSpec], so paging only ever hides
/// paid history, and "Load more" brings it in.
FirestoreQuerySpec invoicesPageSpec(String businessId, {required int pages}) =>
    FirestoreQuerySpec(
      collection: 'invoices',
      filters: [_business(businessId)],
      orderBy: 'issuedOn',
      descending: true,
      limit: invoicePageSize * (pages < 1 ? 1 : pages),
    );

/// Every invoice still owed on. The board's Open count, Overdue count and
/// "Owed to you" are exact from these alone - a paid invoice never moves
/// them. Equality only, so merged single-field indexes serve it.
FirestoreQuerySpec invoicesOpenSpec(String businessId) => FirestoreQuerySpec(
  collection: 'invoices',
  filters: [
    _business(businessId),
    const QueryFilterSpec('status', QueryFilterOp.equal, 'open'),
  ],
);

/// Payments dated in the month of [monthKey] ("yyyy-MM"): the board's
/// collected figure while the server's board totals cannot be reached.
/// `paidOn` is a "yyyy-MM-dd" string, which sorts by day.
FirestoreQuerySpec invoicePaymentsInMonthSpec(
  String businessId,
  String monthKey,
) => FirestoreQuerySpec(
  collection: 'invoicePayments',
  filters: [
    _business(businessId),
    QueryFilterSpec('paidOn', QueryFilterOp.greaterOrEqual, '$monthKey-01'),
    QueryFilterSpec(
      'paidOn',
      QueryFilterOp.less,
      '${nextMonthKey(monthKey)}-01',
    ),
  ],
  orderBy: 'paidOn',
);

// ---------------------------------------------------------------------------
// Car purchases and viewings: the purchase-management screen.
// ---------------------------------------------------------------------------

/// One page of the purchase-management list.
const int carPurchasePageSize = 25;

/// The newest purchases and viewings, one growing page at a time, scoped to
/// [businessId] when one is chosen and to [status] when filtered. A platform
/// admin with no business chosen reads across businesses - the one unscoped
/// shape, and still an ordered page.
FirestoreQuerySpec carPurchasesPageSpec({
  String? businessId,
  String? status,
  required int pages,
}) {
  final business = (businessId ?? '').trim();
  final state = (status ?? '').trim();
  return FirestoreQuerySpec(
    collection: 'carPurchases',
    filters: [
      if (business.isNotEmpty) _business(business),
      if (state.isNotEmpty)
        QueryFilterSpec('purchaseStatus', QueryFilterOp.equal, state),
    ],
    orderBy: 'createdAt',
    descending: true,
    limit: carPurchasePageSize * (pages < 1 ? 1 : pages),
  );
}
