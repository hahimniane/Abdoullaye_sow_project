import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';

import 'firestore_query_spec.dart';
import 'inventory.dart';
import 'inventory_credit.dart';
import 'sales_history.dart';

/// How many rows one period reads at most, per read. A year of a busy shop
/// can pass it: the screen then says it shows the newest rows only
/// (`truncated`), instead of reading without bound.
const salesHistoryReadLimit = 1500;

/// One read's rows for a period: newest first, and whether the read stopped
/// at [salesHistoryReadLimit].
typedef SalesHistoryRows<T> = ({List<T> rows, bool truncated});

/// `businessId ==` (+ `storeId ==` for one store), [field] in `[start, end)`,
/// newest first. Staff tied to one store always pass their store: the rules
/// read it.
FirestoreQuerySpec _periodSpec(
  String collection,
  String field,
  String businessId, {
  required String storeId,
  required DateTime start,
  required DateTime end,
  required int limit,
}) => FirestoreQuerySpec(
  collection: collection,
  filters: [
    QueryFilterSpec('businessId', QueryFilterOp.equal, businessId),
    if (storeId.isNotEmpty)
      QueryFilterSpec('storeId', QueryFilterOp.equal, storeId),
    QueryFilterSpec(field, QueryFilterOp.greaterOrEqual, start),
    QueryFilterSpec(field, QueryFilterOp.less, end),
  ],
  orderBy: field,
  descending: true,
  limit: limit,
);

/// The sales rung up in a period. Served by the existing indexes
/// `inventorySales (businessId, createdAt desc)` and `(businessId, storeId,
/// createdAt desc)`.
FirestoreQuerySpec inventorySalesBetweenSpec(
  String businessId, {
  String storeId = '',
  required DateTime start,
  required DateTime end,
  int limit = salesHistoryReadLimit,
}) => _periodSpec(
  'inventorySales',
  'createdAt',
  businessId,
  storeId: storeId,
  start: start,
  end: end,
  limit: limit,
);

/// The sales voided in a period, whenever they were rung up, so a void of an
/// older sale still shows in "What happened". Needs `inventorySales
/// (businessId, voidedAt desc)` and `(businessId, storeId, voidedAt desc)`;
/// without them only voids of the period's own sales show.
FirestoreQuerySpec inventorySalesVoidedBetweenSpec(
  String businessId, {
  String storeId = '',
  required DateTime start,
  required DateTime end,
  int limit = salesHistoryReadLimit,
}) => _periodSpec(
  'inventorySales',
  'voidedAt',
  businessId,
  storeId: storeId,
  start: start,
  end: end,
  limit: limit,
);

/// The stock changes of a period: `inventoryMovements (businessId, createdAt
/// desc)` and `(businessId, storeId, createdAt desc)`.
FirestoreQuerySpec inventoryMovementsBetweenSpec(
  String businessId, {
  String storeId = '',
  required DateTime start,
  required DateTime end,
  int limit = salesHistoryReadLimit,
}) => _periodSpec(
  'inventoryMovements',
  'createdAt',
  businessId,
  storeId: storeId,
  start: start,
  end: end,
  limit: limit,
);

/// The credit payments taken in a period: `inventoryCreditPayments
/// (businessId, createdAt desc)` and `(businessId, storeId, createdAt desc)`.
FirestoreQuerySpec inventoryCreditPaymentsBetweenSpec(
  String businessId, {
  String storeId = '',
  required DateTime start,
  required DateTime end,
  int limit = salesHistoryReadLimit,
}) => _periodSpec(
  'inventoryCreditPayments',
  'createdAt',
  businessId,
  storeId: storeId,
  start: start,
  end: end,
  limit: limit,
);

/// The credit payments reverted in a period, whenever they were taken.
/// Needs `inventoryCreditPayments (businessId, revertedAt desc)` and
/// `(businessId, storeId, revertedAt desc)`; without them only reverts of
/// the period's own payments show.
FirestoreQuerySpec inventoryCreditPaymentsRevertedBetweenSpec(
  String businessId, {
  String storeId = '',
  required DateTime start,
  required DateTime end,
  int limit = salesHistoryReadLimit,
}) => _periodSpec(
  'inventoryCreditPayments',
  'revertedAt',
  businessId,
  storeId: storeId,
  start: start,
  end: end,
  limit: limit,
);

/// What the history screen reads, one period at a time (not live: a past
/// period does not change, and today's is read again with Refresh).
abstract interface class SalesHistorySource {
  Future<SalesHistoryRows<InventorySale>> sales(
    String businessId, {
    String storeId = '',
    required DateTime start,
    required DateTime end,
  });

  Future<SalesHistoryRows<InventorySale>> voidedSales(
    String businessId, {
    String storeId = '',
    required DateTime start,
    required DateTime end,
  });

  Future<SalesHistoryRows<InventoryMovement>> movements(
    String businessId, {
    String storeId = '',
    required DateTime start,
    required DateTime end,
  });

  Future<SalesHistoryRows<InventoryCreditPayment>> creditPayments(
    String businessId, {
    String storeId = '',
    required DateTime start,
    required DateTime end,
  });

  Future<SalesHistoryRows<InventoryCreditPayment>> revertedPayments(
    String businessId, {
    String storeId = '',
    required DateTime start,
    required DateTime end,
  });
}

class FirestoreSalesHistorySource implements SalesHistorySource {
  FirestoreSalesHistorySource({FirebaseFirestore? firestore})
    : _override = firestore;

  final FirebaseFirestore? _override;
  FirebaseFirestore get _db => _override ?? FirebaseFirestore.instance;

  Future<SalesHistoryRows<T>> _read<T>(
    FirestoreQuerySpec spec,
    T Function(String id, Map<String, dynamic> data) parse,
  ) async {
    final snap = await spec.build(_db).get();
    final rows = [for (final d in snap.docs) parse(d.id, d.data())];
    return (rows: rows, truncated: rows.length >= (spec.limit ?? 1 << 30));
  }

  @override
  Future<SalesHistoryRows<InventorySale>> sales(
    String businessId, {
    String storeId = '',
    required DateTime start,
    required DateTime end,
  }) => _read(
    inventorySalesBetweenSpec(
      businessId,
      storeId: storeId,
      start: start,
      end: end,
    ),
    InventorySale.fromMap,
  );

  @override
  Future<SalesHistoryRows<InventorySale>> voidedSales(
    String businessId, {
    String storeId = '',
    required DateTime start,
    required DateTime end,
  }) => _read(
    inventorySalesVoidedBetweenSpec(
      businessId,
      storeId: storeId,
      start: start,
      end: end,
    ),
    InventorySale.fromMap,
  );

  @override
  Future<SalesHistoryRows<InventoryMovement>> movements(
    String businessId, {
    String storeId = '',
    required DateTime start,
    required DateTime end,
  }) => _read(
    inventoryMovementsBetweenSpec(
      businessId,
      storeId: storeId,
      start: start,
      end: end,
    ),
    InventoryMovement.fromMap,
  );

  @override
  Future<SalesHistoryRows<InventoryCreditPayment>> creditPayments(
    String businessId, {
    String storeId = '',
    required DateTime start,
    required DateTime end,
  }) => _read(
    inventoryCreditPaymentsBetweenSpec(
      businessId,
      storeId: storeId,
      start: start,
      end: end,
    ),
    InventoryCreditPayment.fromMap,
  );

  @override
  Future<SalesHistoryRows<InventoryCreditPayment>> revertedPayments(
    String businessId, {
    String storeId = '',
    required DateTime start,
    required DateTime end,
  }) => _read(
    inventoryCreditPaymentsRevertedBetweenSpec(
      businessId,
      storeId: storeId,
      start: start,
      end: end,
    ),
    InventoryCreditPayment.fromMap,
  );
}

// ---------------------------------------------------------------------------
// One period, read and added up once.
// ---------------------------------------------------------------------------

/// A period as the screen shows it, computed once per read (never per
/// frame): the figures, the period before's figures, and the timeline.
class SalesHistoryData {
  const SalesHistoryData({
    required this.period,
    required this.summary,
    required this.previous,
    required this.days,
    this.truncated = false,
    this.partial = false,
  });

  final SalesPeriod period;
  final SalesHistorySummary summary;

  /// The period before, for the comparison; null when it could not be read.
  final SalesHistorySummary? previous;
  final List<({DateTime day, List<SalesEvent> events})> days;

  /// A read stopped at [salesHistoryReadLimit]: the newest rows only.
  final bool truncated;

  /// Something besides the sales could not be read (stock changes, credit
  /// payments, older voids): the timeline may be missing rows.
  final bool partial;

  int get eventCount => days.fold(0, (n, d) => n + d.events.length);
}

List<T> _byId<T>(Iterable<List<T>> lists, String Function(T) id) {
  final seen = <String>{};
  return [
    for (final list in lists)
      for (final row in list)
        if (seen.add(id(row))) row,
  ];
}

/// Reads [period] (and the sales of the period before) for [storeId] ('':
/// the whole business), then adds it all up. The sales read failing fails
/// the whole load (rethrown); any other read failing leaves its rows out and
/// marks the result [SalesHistoryData.partial]. Every read gives up after
/// [timeout], so the screen always resolves.
Future<SalesHistoryData> loadSalesHistory(
  SalesHistorySource source,
  String businessId,
  SalesPeriod period, {
  String storeId = '',
  Duration timeout = const Duration(seconds: 20),
}) async {
  final start = period.startUtc, end = period.endUtc;
  final before = period.previous;
  var partial = false;

  Future<SalesHistoryRows<T>> optional<T>(
    Future<SalesHistoryRows<T>> Function() read,
  ) async {
    try {
      return await read().timeout(timeout);
    } catch (_) {
      partial = true;
      return (rows: <T>[], truncated: false);
    }
  }

  final salesF = source
      .sales(businessId, storeId: storeId, start: start, end: end)
      .timeout(timeout);
  final previousF = source
      .sales(
        businessId,
        storeId: storeId,
        start: before.startUtc,
        end: before.endUtc,
      )
      .timeout(timeout)
      .then<SalesHistoryRows<InventorySale>?>((r) => r)
      .catchError((Object _) => null);
  final voidedF = optional(
    () => source.voidedSales(
      businessId,
      storeId: storeId,
      start: start,
      end: end,
    ),
  );
  final movementsF = optional(
    () =>
        source.movements(businessId, storeId: storeId, start: start, end: end),
  );
  final paymentsF = optional(
    () => source.creditPayments(
      businessId,
      storeId: storeId,
      start: start,
      end: end,
    ),
  );
  final revertedF = optional(
    () => source.revertedPayments(
      businessId,
      storeId: storeId,
      start: start,
      end: end,
    ),
  );

  // Every read is under way before the first await: one round trip.
  final sales = await salesF;
  final previous = await previousF;
  final voided = await voidedF;
  final movements = await movementsF;
  final payments = await paymentsF;
  final reverted = await revertedF;

  final allSales = _byId([sales.rows, voided.rows], (s) => s.id);
  final allPayments = _byId([payments.rows, reverted.rows], (p) => p.id);
  final timeline = salesTimeline(
    period,
    sales: allSales,
    payments: allPayments,
    movements: movements.rows,
  );
  return SalesHistoryData(
    period: period,
    summary: summarizeSales(period, allSales, payments: allPayments),
    previous: previous == null
        ? null
        : summarizeSales(before, previous.rows),
    days: salesTimelineByDay(timeline),
    truncated:
        sales.truncated ||
        voided.truncated ||
        movements.truncated ||
        payments.truncated ||
        reverted.truncated,
    partial: partial,
  );
}
