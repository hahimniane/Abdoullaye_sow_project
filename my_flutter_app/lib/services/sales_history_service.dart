import 'package:cloud_firestore/cloud_firestore.dart';

import 'firestore_query_spec.dart';
import 'inventory.dart';
import 'inventory_credit.dart';

/// How many rows one period reads at most, per collection. A year of a busy
/// shop can pass it: the screen then says the figures cover the newest rows
/// only (`truncated`), instead of reading without bound.
const salesHistoryReadLimit = 1500;

/// One collection's rows for a period: newest first, and whether the read
/// stopped at [salesHistoryReadLimit].
typedef SalesHistoryRows<T> = ({List<T> rows, bool truncated});

/// The sales of a period: `businessId ==` (+ `storeId ==` for staff tied to
/// one store), `createdAt` in `[start, end)`, newest first. Served by the
/// existing indexes `inventorySales (businessId, createdAt desc)` and
/// `(businessId, storeId, createdAt desc)`.
FirestoreQuerySpec inventorySalesBetweenSpec(
  String businessId, {
  String storeId = '',
  required DateTime start,
  required DateTime end,
  int limit = salesHistoryReadLimit,
}) => FirestoreQuerySpec(
  collection: 'inventorySales',
  filters: [
    QueryFilterSpec('businessId', QueryFilterOp.equal, businessId),
    if (storeId.isNotEmpty)
      QueryFilterSpec('storeId', QueryFilterOp.equal, storeId),
    QueryFilterSpec('createdAt', QueryFilterOp.greaterOrEqual, start),
    QueryFilterSpec('createdAt', QueryFilterOp.less, end),
  ],
  orderBy: 'createdAt',
  descending: true,
  limit: limit,
);

/// The stock changes of a period, same shape. The store-scoped read has its
/// index (`inventoryMovements (businessId, storeId, createdAt desc)`); the
/// whole-business read needs `inventoryMovements (businessId ASC, createdAt
/// DESC)`, which the server side adds - until then it fails and the
/// timeline simply shows no stock rows.
FirestoreQuerySpec inventoryMovementsBetweenSpec(
  String businessId, {
  String storeId = '',
  required DateTime start,
  required DateTime end,
  int limit = salesHistoryReadLimit,
}) => FirestoreQuerySpec(
  collection: 'inventoryMovements',
  filters: [
    QueryFilterSpec('businessId', QueryFilterOp.equal, businessId),
    if (storeId.isNotEmpty)
      QueryFilterSpec('storeId', QueryFilterOp.equal, storeId),
    QueryFilterSpec('createdAt', QueryFilterOp.greaterOrEqual, start),
    QueryFilterSpec('createdAt', QueryFilterOp.less, end),
  ],
  orderBy: 'createdAt',
  descending: true,
  limit: limit,
);

/// The credit payments of a period. Needs `inventoryCreditPayments
/// (businessId ASC, createdAt DESC)` and `(businessId ASC, storeId ASC,
/// createdAt DESC)`; without them the figures show no "collected" amount.
FirestoreQuerySpec inventoryCreditPaymentsBetweenSpec(
  String businessId, {
  String storeId = '',
  required DateTime start,
  required DateTime end,
  int limit = salesHistoryReadLimit,
}) => FirestoreQuerySpec(
  collection: 'inventoryCreditPayments',
  filters: [
    QueryFilterSpec('businessId', QueryFilterOp.equal, businessId),
    if (storeId.isNotEmpty)
      QueryFilterSpec('storeId', QueryFilterOp.equal, storeId),
    QueryFilterSpec('createdAt', QueryFilterOp.greaterOrEqual, start),
    QueryFilterSpec('createdAt', QueryFilterOp.less, end),
  ],
  orderBy: 'createdAt',
  descending: true,
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
}
