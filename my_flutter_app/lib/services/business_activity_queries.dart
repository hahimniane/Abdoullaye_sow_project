import 'business_service_overview.dart'
    show ServiceCategory, businessServiceFinalStatuses;
import 'business_transport_jobs.dart' show transportJobFinalStatuses;
import 'container_manifest.dart'
    show containerStatusLoading, containerStatusShipped;
import 'firestore_query_spec.dart';

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
