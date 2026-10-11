import 'dart:async';
import 'dart:math';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:url_launcher/url_launcher.dart';

import '../utils/callable_data.dart';
import 'firestore_query_spec.dart';
import 'inventory.dart';
import 'lot_ledger.dart' show LotStaff;
import 'waiting_package_service.dart';

/// Calls one of the inventory callables and hands back its data. Same shape
/// as the container caller, so a widget test answers (or refuses) in place of
/// Firebase; the default is the real callable.
typedef InventoryCallableCaller = ContainerCallableCaller;

Future<Object?> callInventoryCallable(
  String name,
  Map<String, Object?> payload,
) =>
    callContainerCallable(name, payload);

/// How a thrown error reads to the screens. A callable that could not be
/// reached (`unavailable`, `deadline-exceeded`, a timeout) is [InventoryFailure.network];
/// the codes the callables send in `details.reason` map to their own failure.
InventoryFailure inventoryFailureFromError(Object error) {
  if (error is FirebaseFunctionsException) {
    return inventoryFailureOf(
      code: error.code,
      details: error.details,
      message: error.message,
    );
  }
  if (error is TimeoutException) return InventoryFailure.network;
  return InventoryFailure.unknown;
}

/// A fresh, hard-to-collide id for one sale attempt (`clientRequestId`).
/// Retries of the same sale reuse it; the server answers with the same sale.
String newInventoryRequestId([Random? random]) {
  final rng = random ?? Random.secure();
  final bytes = [for (var i = 0; i < 12; i++) rng.nextInt(256)];
  final hex = bytes.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
  return 'sale-${DateTime.now().millisecondsSinceEpoch.toRadixString(36)}-$hex';
}

// ---------------------------------------------------------------------------
// The queries, written down as data (see firestore_query_spec.dart).
// ---------------------------------------------------------------------------

/// Every product of the business, archived ones included (the list filters
/// them). Equality on `businessId` only, so the read rule can prove the
/// business and no composite index is needed.
FirestoreQuerySpec inventoryItemsSpec(String businessId) => FirestoreQuerySpec(
      collection: 'inventoryItems',
      filters: [QueryFilterSpec('businessId', QueryFilterOp.equal, businessId)],
    );

/// One product by its tag code, inside the business. Both equalities; a code
/// is unique, so the answer is at most one document.
FirestoreQuerySpec inventoryItemByCodeSpec(String businessId, String code) =>
    FirestoreQuerySpec(
      collection: 'inventoryItems',
      filters: [
        QueryFilterSpec('businessId', QueryFilterOp.equal, businessId),
        QueryFilterSpec('code', QueryFilterOp.equal, code),
      ],
    );

/// The newest [limit] sales, by time: one growing page at a time. Needs the
/// composite index `inventorySales (businessId ASC, createdAt DESC)`.
FirestoreQuerySpec inventorySalesSpec(String businessId, {required int limit}) =>
    FirestoreQuerySpec(
      collection: 'inventorySales',
      filters: [QueryFilterSpec('businessId', QueryFilterOp.equal, businessId)],
      orderBy: 'createdAt',
      descending: true,
      limit: limit,
    );

/// One product's stock history. Equalities only (no composite index); the
/// rows are sorted on the phone.
FirestoreQuerySpec inventoryMovementsSpec(String businessId, String itemId) =>
    FirestoreQuerySpec(
      collection: 'inventoryMovements',
      filters: [
        QueryFilterSpec('businessId', QueryFilterOp.equal, businessId),
        QueryFilterSpec('itemId', QueryFilterOp.equal, itemId),
      ],
    );

/// One page of the sales list.
const inventorySalesPageSize = 25;

/// What the screens read, behind an interface so a widget test serves its own
/// rows. Reads are the business-scoped queries the rules allow; every write is
/// a callable through [InventoryService].
abstract interface class InventorySource {
  /// Every product of the business, archived ones too.
  Stream<List<InventoryItem>> watchItems(String businessId);

  /// The business's own product with [code], or null (a mistyped code, or a
  /// tag from another shop).
  Future<InventoryItem?> findItemByCode(String businessId, String code);

  /// The newest [limit] sales.
  Stream<List<InventorySale>> watchSales(String businessId, {required int limit});

  /// One product's stock history, newest first.
  Stream<List<InventoryMovement>> watchMovements(
    String businessId,
    String itemId,
  );

  /// The team's names, for "sold by" and "who changed it". Empty when the
  /// person may not read the team (the names then stay blank).
  Stream<List<LotStaff>> watchStaff(String businessId);
}

class FirestoreInventorySource implements InventorySource {
  FirestoreInventorySource({FirebaseFirestore? firestore})
      : _override = firestore;

  final FirebaseFirestore? _override;
  FirebaseFirestore get _db => _override ?? FirebaseFirestore.instance;

  @override
  Stream<List<InventoryItem>> watchItems(String businessId) =>
      inventoryItemsSpec(businessId).build(_db).snapshots().map((snap) => [
            for (final d in snap.docs) InventoryItem.fromMap(d.id, d.data()),
          ]);

  @override
  Future<InventoryItem?> findItemByCode(String businessId, String code) async {
    final snap = await inventoryItemByCodeSpec(businessId, code).build(_db).get();
    if (snap.docs.isEmpty) return null;
    final d = snap.docs.first;
    return InventoryItem.fromMap(d.id, d.data());
  }

  @override
  Stream<List<InventorySale>> watchSales(
    String businessId, {
    required int limit,
  }) =>
      inventorySalesSpec(businessId, limit: limit)
          .build(_db)
          .snapshots()
          .map((snap) => [
                for (final d in snap.docs) InventorySale.fromMap(d.id, d.data()),
              ]);

  @override
  Stream<List<InventoryMovement>> watchMovements(
    String businessId,
    String itemId,
  ) =>
      inventoryMovementsSpec(businessId, itemId)
          .build(_db)
          .snapshots()
          .map((snap) => sortMovementsNewestFirst([
                for (final d in snap.docs)
                  InventoryMovement.fromMap(d.id, d.data()),
              ]));

  @override
  Stream<List<LotStaff>> watchStaff(String businessId) => _db
      .collection('users')
      .where('businessId', isEqualTo: businessId)
      .snapshots()
      .map((snap) => [
            for (final d in snap.docs)
              LotStaff(
                id: d.id,
                name: (d.data()['fullName'] ??
                        d.data()['name'] ??
                        d.data()['email'] ??
                        d.id)
                    .toString(),
              ),
          ]);
}

// ---------------------------------------------------------------------------
// The callables.
// ---------------------------------------------------------------------------

/// Fetches the printable tag page for a product and opens it in the browser,
/// where the system print dialog takes over. Throws when the server refuses or
/// nothing could open the page; the caller says so.
typedef InventoryTagOpener = Future<void> Function({
  required String businessId,
  required String itemId,
  required int copies,
});

Future<void> openInventoryTags({
  required String businessId,
  required String itemId,
  required int copies,
}) async {
  final response = await FirebaseFunctions.instance
      .httpsCallable('getInventoryLabelsUrl')
      .call<Object?>(inventoryLabelsRequest(businessId, itemId, copies));
  final data = response.data;
  final url = data is Map ? (data['url'] ?? '').toString() : '';
  final uri = url.isEmpty ? null : Uri.tryParse(url);
  if (uri == null) throw StateError('no url');
  final opened = await launchUrl(uri, mode: LaunchMode.externalApplication);
  if (!opened) throw StateError('not opened');
}

/// Every inventory write, each one callable. Errors propagate as thrown;
/// screens read them with [inventoryFailureFromError].
class InventoryService {
  const InventoryService({this.caller = callInventoryCallable});

  final InventoryCallableCaller caller;

  Future<({String itemId, String code})> createItem(
    String businessId,
    InventoryItemDraft draft,
  ) async {
    final data = callableMap(await caller(
      'createInventoryItem',
      createInventoryItemRequest(businessId, draft),
    ));
    return (
      itemId: callableString(data['itemId']),
      code: callableString(data['code']),
    );
  }

  /// Saves what changed; nothing is sent when nothing did.
  Future<void> updateItem(
    String businessId,
    InventoryItem existing,
    InventoryItemDraft draft,
  ) async {
    final request = updateInventoryItemRequest(businessId, existing, draft);
    if (inventoryUpdateIsEmpty(request)) return;
    await caller('updateInventoryItem', request);
  }

  /// Adds stock, or sets the count; answers the count after.
  Future<int?> adjustStock({
    required String businessId,
    required String itemId,
    required bool add,
    required int quantity,
    String note = '',
  }) async {
    final data = callableMap(await caller(
      'adjustInventoryStock',
      adjustInventoryStockRequest(
        businessId: businessId,
        itemId: itemId,
        add: add,
        quantity: quantity,
        note: note,
      ),
    ));
    return data.containsKey('quantity') ? callableInt(data['quantity']) : null;
  }

  Future<void> setArchived(
    String businessId,
    String itemId, {
    required bool archived,
  }) =>
      caller(
        'archiveInventoryItem',
        archiveInventoryItemRequest(businessId, itemId, archived: archived),
      );

  Future<void> deleteItem(String businessId, String itemId) => caller(
        'deleteInventoryItem',
        deleteInventoryItemRequest(businessId, itemId),
      );

  /// Records the sale. The same [clientRequestId] answers with the same sale,
  /// so a retry after a lost answer never sells twice.
  Future<InventorySaleResult> recordSale({
    required String businessId,
    required String clientRequestId,
    required String paymentMethod,
    required Basket basket,
  }) async {
    final result = InventorySaleResult.fromCallable(await caller(
      'recordInventorySale',
      recordInventorySaleRequest(
        businessId: businessId,
        clientRequestId: clientRequestId,
        paymentMethod: paymentMethod,
        basket: basket,
      ),
    ));
    if (result == null) throw StateError('sale not recorded');
    return result;
  }

  Future<void> voidSale(String businessId, String saleId, {String reason = ''}) =>
      caller(
        'voidInventorySale',
        voidInventorySaleRequest(businessId, saleId, reason: reason),
      );

  /// Today's (or the month's) numbers, read on the server.
  Future<InventorySummary> summary(
    String businessId, {
    String range = 'today',
    DateTime? now,
  }) async =>
      InventorySummary.fromCallable(await caller(
        'getInventorySummary',
        inventorySummaryRequest(
          businessId,
          range: range,
          timeZone: inventoryTimeZoneName(now ?? DateTime.now()),
        ),
      ));
}
