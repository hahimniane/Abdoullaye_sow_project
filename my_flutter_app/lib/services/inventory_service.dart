import 'dart:async';
import 'dart:math';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:url_launcher/url_launcher.dart';

import '../utils/callable_data.dart';
import 'firestore_query_spec.dart';
import 'inventory.dart';
import 'inventory_credit.dart';
import 'inventory_stores.dart';
import 'inventory_transfers.dart';
import 'lot_ledger.dart' show LotStaff, personDisplayName;
import 'waiting_package_service.dart';

/// Calls one of the inventory callables and hands back its data. Same shape
/// as the container caller, so a widget test answers (or refuses) in place of
/// Firebase; the default is the real callable.
typedef InventoryCallableCaller = ContainerCallableCaller;

Future<Object?> callInventoryCallable(
  String name,
  Map<String, Object?> payload,
) => callContainerCallable(name, payload);

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

/// Whether [error] says the server has no `createInventoryCategory` (an older
/// server): the typed name is then kept as the product's plain category text.
bool inventoryCategoryCreateUnsupported(Object error) =>
    error is FirebaseFunctionsException &&
    inventoryCategoryCallableMissing(code: error.code, details: error.details);

/// Whether [error] says the server has no `createInventoryBrand` (a server
/// from before brands).
bool inventoryBrandCreateUnsupported(Object error) =>
    error is FirebaseFunctionsException &&
    inventoryBrandCallableMissing(code: error.code, details: error.details);

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
///
/// A person who works in one store only reads that store's sales
/// ([storeId]; the rules allow nothing wider), which needs the composite index
/// `inventorySales (businessId ASC, storeId ASC, createdAt DESC)`.
FirestoreQuerySpec inventorySalesSpec(
  String businessId, {
  required int limit,
  String storeId = '',
}) => FirestoreQuerySpec(
  collection: 'inventorySales',
  filters: [
    QueryFilterSpec('businessId', QueryFilterOp.equal, businessId),
    if (storeId.isNotEmpty)
      QueryFilterSpec('storeId', QueryFilterOp.equal, storeId),
  ],
  orderBy: 'createdAt',
  descending: true,
  limit: limit,
);

/// One product's stock history. Equalities only (no composite index); the
/// rows are sorted on the phone.
FirestoreQuerySpec inventoryMovementsSpec(
  String businessId,
  String itemId, {
  String storeId = '',
}) => FirestoreQuerySpec(
  collection: 'inventoryMovements',
  filters: [
    QueryFilterSpec('businessId', QueryFilterOp.equal, businessId),
    QueryFilterSpec('itemId', QueryFilterOp.equal, itemId),
    if (storeId.isNotEmpty)
      QueryFilterSpec('storeId', QueryFilterOp.equal, storeId),
  ],
);

/// The business's categories. Equality on `businessId` only.
FirestoreQuerySpec inventoryCategoriesSpec(String businessId) =>
    FirestoreQuerySpec(
      collection: 'inventoryCategories',
      filters: [QueryFilterSpec('businessId', QueryFilterOp.equal, businessId)],
    );

/// The business's brands. Equality on `businessId` only.
FirestoreQuerySpec inventoryBrandsSpec(String businessId) => FirestoreQuerySpec(
  collection: 'inventoryBrands',
  filters: [QueryFilterSpec('businessId', QueryFilterOp.equal, businessId)],
);

/// The business's stores. Equality on `businessId` only.
FirestoreQuerySpec inventoryStoresSpec(String businessId) => FirestoreQuerySpec(
  collection: 'inventoryStores',
  filters: [QueryFilterSpec('businessId', QueryFilterOp.equal, businessId)],
);

/// The per-store counts: every store's (owner, all-stores staff), or one
/// store's ([storeId] - what the rules allow everyone else to read).
FirestoreQuerySpec inventoryStockSpec(
  String businessId, {
  String storeId = '',
}) => FirestoreQuerySpec(
  collection: 'inventoryStock',
  filters: [
    QueryFilterSpec('businessId', QueryFilterOp.equal, businessId),
    if (storeId.isNotEmpty)
      QueryFilterSpec('storeId', QueryFilterOp.equal, storeId),
  ],
);

/// One page of the sales list.
const inventorySalesPageSize = 25;

/// The credit sales still owed. Equalities only (`creditStatus == open` is
/// its own bound: a credit leaves the list when it is paid), sorted on the
/// phone; staff tied to one store add their store, as for the sales list.
FirestoreQuerySpec inventoryOpenCreditsSpec(
  String businessId, {
  String storeId = '',
}) => FirestoreQuerySpec(
  collection: 'inventorySales',
  filters: [
    QueryFilterSpec('businessId', QueryFilterOp.equal, businessId),
    QueryFilterSpec('creditStatus', QueryFilterOp.equal, 'open'),
    if (storeId.isNotEmpty)
      QueryFilterSpec('storeId', QueryFilterOp.equal, storeId),
  ],
);

/// One credit sale's later payments. Equalities only, sorted on the phone;
/// staff tied to one store add their store (the rules read it).
FirestoreQuerySpec inventoryCreditPaymentsSpec(
  String businessId,
  String saleId, {
  String storeId = '',
}) => FirestoreQuerySpec(
  collection: 'inventoryCreditPayments',
  filters: [
    QueryFilterSpec('businessId', QueryFilterOp.equal, businessId),
    QueryFilterSpec('saleId', QueryFilterOp.equal, saleId),
    if (storeId.isNotEmpty)
      QueryFilterSpec('storeId', QueryFilterOp.equal, storeId),
  ],
);

/// Transfers between stores (docs/INVENTORY.md, store transfers v5): the
/// stages a list still has to act on.
const inventoryTransferOpenStages = ['draft', 'in_transit', 'review'];

/// The newest transfers a list shows besides the open ones: 100 for someone
/// who sees every store, 50 from and 50 to a one-store staff member's store.
const inventoryTransfersRecentLimit = 100;
const inventoryTransfersRecentStoreLimit = 50;

/// The open transfers (draft, in transit, in review), whole. A staff member
/// tied to one store [storeId] reads two queries - from it and to it - and
/// merges them: the rules refuse an unscoped list. Equalities plus
/// `stage in`, served by `inventoryTransfers (businessId, stage)` and the
/// store-field variants.
List<FirestoreQuerySpec> inventoryTransfersOpenSpecs(
  String businessId, {
  String storeId = '',
}) => [
  for (final field in storeId.isEmpty
      ? const ['']
      : const ['fromStoreId', 'toStoreId'])
    FirestoreQuerySpec(
      collection: 'inventoryTransfers',
      filters: [
        QueryFilterSpec('businessId', QueryFilterOp.equal, businessId),
        if (field.isNotEmpty)
          QueryFilterSpec(field, QueryFilterOp.equal, storeId),
        const QueryFilterSpec(
          'stage',
          QueryFilterOp.whereIn,
          inventoryTransferOpenStages,
        ),
      ],
    ),
];

/// The newest transfers, newest first: one page of 100, or 50 from and 50 to
/// a one-store staff member's store. Needs `inventoryTransfers (businessId,
/// createdAt desc)` and the `fromStoreId` / `toStoreId` variants.
List<FirestoreQuerySpec> inventoryTransfersRecentSpecs(
  String businessId, {
  String storeId = '',
}) => [
  for (final field in storeId.isEmpty
      ? const ['']
      : const ['fromStoreId', 'toStoreId'])
    FirestoreQuerySpec(
      collection: 'inventoryTransfers',
      filters: [
        QueryFilterSpec('businessId', QueryFilterOp.equal, businessId),
        if (field.isNotEmpty)
          QueryFilterSpec(field, QueryFilterOp.equal, storeId),
      ],
      orderBy: 'createdAt',
      descending: true,
      limit: field.isEmpty
          ? inventoryTransfersRecentLimit
          : inventoryTransfersRecentStoreLimit,
    ),
];

/// What the transfer screens read, behind its own interface (like
/// [InventoryCreditSource]) so a screen without transfers needs none of it
/// and a widget test serves its own rows. Every write is a callable through
/// [InventoryService].
abstract interface class InventoryTransferSource {
  /// Draft, in transit and in review ([storeId]: from or to that store only,
  /// merged).
  Stream<List<InventoryTransfer>> watchOpenTransfers(
    String businessId, {
    String storeId = '',
  });

  /// The newest transfers, whatever their stage ([storeId] as above).
  Stream<List<InventoryTransfer>> watchRecentTransfers(
    String businessId, {
    String storeId = '',
  });

  /// One transfer by id, live: null when there is none. Fails when the rules
  /// do not let this person read it; the caller still checks
  /// `inventoryTransferVisible`.
  Stream<InventoryTransfer?> watchTransfer(String businessId, String transferId);
}

class FirestoreInventoryTransferSource implements InventoryTransferSource {
  FirestoreInventoryTransferSource({FirebaseFirestore? firestore})
    : _override = firestore;

  final FirebaseFirestore? _override;
  FirebaseFirestore get _db => _override ?? FirebaseFirestore.instance;

  Stream<List<InventoryTransfer>> _merged(List<FirestoreQuerySpec> specs) {
    try {
      final streams = [
        for (final spec in specs)
          spec
              .build(_db)
              .snapshots()
              .map(
                (snap) => [
                  for (final d in snap.docs)
                    InventoryTransfer.fromMap(d.id, d.data()),
                ],
              ),
      ];
      return streams.length == 1
          ? streams.single
          : mergeLiveById<InventoryTransfer>(streams, (t) => t.id);
    } catch (error) {
      // No Firebase (a widget test that did not hand a source in): the
      // screens treat it as nothing to show.
      return Stream.error(error);
    }
  }

  @override
  Stream<List<InventoryTransfer>> watchOpenTransfers(
    String businessId, {
    String storeId = '',
  }) => _merged(inventoryTransfersOpenSpecs(businessId, storeId: storeId));

  @override
  Stream<List<InventoryTransfer>> watchRecentTransfers(
    String businessId, {
    String storeId = '',
  }) => _merged(inventoryTransfersRecentSpecs(businessId, storeId: storeId));

  @override
  Stream<InventoryTransfer?> watchTransfer(
    String businessId,
    String transferId,
  ) {
    try {
      return _db
          .collection('inventoryTransfers')
          .doc(transferId)
          .snapshots()
          .map((doc) {
            final data = doc.data();
            return doc.exists && data != null
                ? InventoryTransfer.fromMap(doc.id, data)
                : null;
          });
    } catch (error) {
      return Stream.error(error);
    }
  }
}

/// The signed-in person's id, '' when there is none (or no Firebase, as in
/// a widget test). Screens take it as a parameter and fall back to this.
String inventoryCurrentUserId() {
  try {
    return FirebaseAuth.instance.currentUser?.uid ?? '';
  } catch (_) {
    return '';
  }
}

/// The business's owner as the business document names them: the people
/// pickers add them (`withBusinessOwner`) even when their own profile does
/// not name the business.
typedef InventoryBusinessOwner = ({String uid, String name, String email});

/// What the credit screens read beyond the sales: the open credits, a
/// credit's payments, and the owner. A separate interface from
/// [InventorySource] so a screen that sells nothing on credit needs none of
/// it.
abstract interface class InventoryCreditSource {
  /// The credit sales still owed ([storeId]: one store's only).
  Stream<List<InventorySale>> watchOpenCredits(
    String businessId, {
    String storeId = '',
  });

  /// One credit sale's later payments, newest first.
  Stream<List<InventoryCreditPayment>> watchCreditPayments(
    String businessId,
    String saleId, {
    String storeId = '',
  });

  Stream<InventoryBusinessOwner> watchBusinessOwner(String businessId);
}

class FirestoreInventoryCreditSource implements InventoryCreditSource {
  FirestoreInventoryCreditSource({FirebaseFirestore? firestore})
    : _override = firestore;

  final FirebaseFirestore? _override;
  FirebaseFirestore get _db => _override ?? FirebaseFirestore.instance;

  @override
  Stream<List<InventorySale>> watchOpenCredits(
    String businessId, {
    String storeId = '',
  }) => inventoryOpenCreditsSpec(businessId, storeId: storeId)
      .build(_db)
      .snapshots()
      .map(
        (snap) => [
          for (final d in snap.docs) InventorySale.fromMap(d.id, d.data()),
        ],
      );

  @override
  Stream<List<InventoryCreditPayment>> watchCreditPayments(
    String businessId,
    String saleId, {
    String storeId = '',
  }) => inventoryCreditPaymentsSpec(businessId, saleId, storeId: storeId)
      .build(_db)
      .snapshots()
      .map(
        (snap) => sortCreditPaymentsNewestFirst([
          for (final d in snap.docs)
            InventoryCreditPayment.fromMap(d.id, d.data()),
        ]),
      );

  @override
  Stream<InventoryBusinessOwner> watchBusinessOwner(String businessId) => _db
      .collection('businesses')
      .doc(businessId)
      .snapshots()
      .map((doc) {
        final data = doc.data() ?? const <String, dynamic>{};
        return (
          uid: (data['ownerUid'] ?? '').toString(),
          name: (data['ownerName'] ?? '').toString(),
          email: (data['ownerEmail'] ?? '').toString(),
        );
      });
}

/// What the screens read, behind an interface so a widget test serves its own
/// rows. Reads are the business-scoped queries the rules allow; every write is
/// a callable through [InventoryService].
abstract interface class InventorySource {
  /// Every product of the business, archived ones too.
  Stream<List<InventoryItem>> watchItems(String businessId);

  /// The business's own product with [code], or null (a mistyped code, or a
  /// tag from another shop).
  Future<InventoryItem?> findItemByCode(String businessId, String code);

  /// The newest [limit] sales ([storeId]: one store's only).
  Stream<List<InventorySale>> watchSales(
    String businessId, {
    required int limit,
    String storeId = '',
  });

  /// One sale by id, live (a notification tap opens it): null when there is
  /// no such sale. Fails when the rules do not let this person read it - a
  /// sale of another store for staff tied to one. The caller still checks the
  /// sale is of [businessId] and of a store the person may see
  /// (`inventorySaleVisible`).
  Stream<InventorySale?> watchSale(String businessId, String saleId);

  /// One product's stock history, newest first ([storeId]: one store's only).
  Stream<List<InventoryMovement>> watchMovements(
    String businessId,
    String itemId, {
    String storeId = '',
  });

  /// The business's categories (empty before it has any, and on a server
  /// that has none).
  Stream<List<InventoryCategory>> watchCategories(String businessId);

  /// The business's brands (empty before it has any, and on a server that has
  /// none).
  Stream<List<InventoryBrand>> watchBrands(String businessId);

  /// The business's stores (empty or one: a single-store business).
  Stream<List<InventoryStore>> watchStores(String businessId);

  /// The per-store counts the person may read ([storeId]: one store's only).
  Stream<List<InventoryStockRow>> watchStock(
    String businessId, {
    String storeId = '',
  });

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
      inventoryItemsSpec(businessId)
          .build(_db)
          .snapshots()
          .map(
            (snap) => [
              for (final d in snap.docs) InventoryItem.fromMap(d.id, d.data()),
            ],
          );

  @override
  Future<InventoryItem?> findItemByCode(String businessId, String code) async {
    final snap = await inventoryItemByCodeSpec(
      businessId,
      code,
    ).build(_db).get();
    if (snap.docs.isEmpty) return null;
    final d = snap.docs.first;
    return InventoryItem.fromMap(d.id, d.data());
  }

  @override
  Stream<List<InventorySale>> watchSales(
    String businessId, {
    required int limit,
    String storeId = '',
  }) => inventorySalesSpec(businessId, limit: limit, storeId: storeId)
      .build(_db)
      .snapshots()
      .map(
        (snap) => [
          for (final d in snap.docs) InventorySale.fromMap(d.id, d.data()),
        ],
      );

  @override
  Stream<InventorySale?> watchSale(String businessId, String saleId) =>
      _db.collection('inventorySales').doc(saleId).snapshots().map((doc) {
        final data = doc.data();
        return doc.exists && data != null
            ? InventorySale.fromMap(doc.id, data)
            : null;
      });

  @override
  Stream<List<InventoryMovement>> watchMovements(
    String businessId,
    String itemId, {
    String storeId = '',
  }) => inventoryMovementsSpec(businessId, itemId, storeId: storeId)
      .build(_db)
      .snapshots()
      .map(
        (snap) => sortMovementsNewestFirst([
          for (final d in snap.docs) InventoryMovement.fromMap(d.id, d.data()),
        ]),
      );

  @override
  Stream<List<InventoryCategory>> watchCategories(String businessId) =>
      inventoryCategoriesSpec(businessId)
          .build(_db)
          .snapshots()
          .map(
            (snap) => [
              for (final d in snap.docs)
                InventoryCategory.fromMap(d.id, d.data()),
            ],
          );

  @override
  Stream<List<InventoryBrand>> watchBrands(String businessId) =>
      inventoryBrandsSpec(businessId)
          .build(_db)
          .snapshots()
          .map(
            (snap) => [
              for (final d in snap.docs) InventoryBrand.fromMap(d.id, d.data()),
            ],
          );

  @override
  Stream<List<InventoryStore>> watchStores(String businessId) =>
      inventoryStoresSpec(businessId)
          .build(_db)
          .snapshots()
          .map(
            (snap) => [
              for (final d in snap.docs) InventoryStore.fromMap(d.id, d.data()),
            ],
          );

  @override
  Stream<List<InventoryStockRow>> watchStock(
    String businessId, {
    String storeId = '',
  }) => inventoryStockSpec(businessId, storeId: storeId)
      .build(_db)
      .snapshots()
      .map(
        (snap) => [
          for (final d in snap.docs) InventoryStockRow.fromMap(d.data()),
        ],
      );

  @override
  Stream<List<LotStaff>> watchStaff(String businessId) => _db
      .collection('users')
      .where('businessId', isEqualTo: businessId)
      .snapshots()
      .map(
        (snap) => [
          for (final d in snap.docs)
            // No name at all reads as the screen's "Team member"
            // (InventoryTeamWatcher), never as the uid.
            LotStaff(id: d.id, name: personDisplayName(d.data())),
        ],
      );
}

// ---------------------------------------------------------------------------
// The callables.
// ---------------------------------------------------------------------------

/// Fetches the printable tag page for a product and opens it in the browser,
/// where the system print dialog takes over. Throws when the server refuses or
/// nothing could open the page; the caller says so.
typedef InventoryTagOpener =
    Future<void> Function({
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

  /// Creates a product. [InventoryItemDraft.stock] carries a business with
  /// several stores' starting counts; without it the count is `quantity`.
  Future<({String itemId, String code})> createItem(
    String businessId,
    InventoryItemDraft draft,
  ) async {
    final data = callableMap(
      await caller(
        'createInventoryItem',
        createInventoryItemRequest(businessId, draft),
      ),
    );
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
    String storeId = '',
  }) async {
    final data = callableMap(
      await caller(
        'adjustInventoryStock',
        adjustInventoryStockRequest(
          businessId: businessId,
          itemId: itemId,
          add: add,
          quantity: quantity,
          note: note,
          storeId: storeId,
        ),
      ),
    );
    return data.containsKey('quantity') ? callableInt(data['quantity']) : null;
  }

  Future<void> setArchived(
    String businessId,
    String itemId, {
    required bool archived,
  }) => caller(
    'archiveInventoryItem',
    archiveInventoryItemRequest(businessId, itemId, archived: archived),
  );

  Future<void> deleteItem(String businessId, String itemId) => caller(
    'deleteInventoryItem',
    deleteInventoryItemRequest(businessId, itemId),
  );

  /// Records the sale. The same [clientRequestId] answers with the same sale,
  /// so a retry after a lost answer never sells twice. [receivedByStaffId]
  /// and [credit] (`inventoryCreditRequest`) say who took the money and what
  /// is left owed.
  Future<InventorySaleResult> recordSale({
    required String businessId,
    required String clientRequestId,
    required String paymentMethod,
    required Basket basket,
    String storeId = '',
    String receivedByStaffId = '',
    Map<String, Object?>? credit,
  }) async {
    final result = InventorySaleResult.fromCallable(
      await caller(
        'recordInventorySale',
        recordInventorySaleRequest(
          businessId: businessId,
          clientRequestId: clientRequestId,
          paymentMethod: paymentMethod,
          basket: basket,
          storeId: storeId,
          receivedByStaffId: receivedByStaffId,
          credit: credit,
        ),
      ),
    );
    if (result == null) throw StateError('sale not recorded');
    return result;
  }

  // ----- credit ------------------------------------------------------------

  /// Money that came in later against a credit sale (part of it is fine).
  Future<InventoryCreditPaymentResult> recordCreditPayment({
    required String businessId,
    required String saleId,
    required int amountCents,
    required String method,
    required String receivedByStaffId,
    String note = '',
  }) async => InventoryCreditPaymentResult.fromCallable(
    await caller(
      'recordInventoryCreditPayment',
      recordInventoryCreditPaymentRequest(
        businessId: businessId,
        saleId: saleId,
        amountCents: amountCents,
        method: method,
        receivedByStaffId: receivedByStaffId,
        note: note,
      ),
    ),
  );

  /// A mistaken payment is struck through; the balance goes back up.
  Future<InventoryCreditPaymentResult> revertCreditPayment(
    String businessId,
    String paymentId,
  ) async => InventoryCreditPaymentResult.fromCallable(
    await caller(
      'revertInventoryCreditPayment',
      revertInventoryCreditPaymentRequest(businessId, paymentId),
    ),
  );

  /// Hands the collecting to someone else, and moves the due date when
  /// [dueDate] is given ('' clears it).
  Future<void> setCreditCollector({
    required String businessId,
    required String saleId,
    required String collectorStaffId,
    String? dueDate,
  }) => caller(
    'setInventoryCreditCollector',
    setInventoryCreditCollectorRequest(
      businessId: businessId,
      saleId: saleId,
      collectorStaffId: collectorStaffId,
      dueDate: dueDate,
    ),
  );

  Future<void> voidSale(
    String businessId,
    String saleId, {
    String reason = '',
  }) => caller(
    'voidInventorySale',
    voidInventorySaleRequest(businessId, saleId, reason: reason),
  );

  /// Today's (or the month's) numbers, read on the server.
  Future<InventorySummary> summary(
    String businessId, {
    String range = 'today',
    DateTime? now,
    String storeId = '',
  }) async => InventorySummary.fromCallable(
    await caller(
      'getInventorySummary',
      inventorySummaryRequest(
        businessId,
        range: range,
        timeZone: inventoryTimeZoneName(now ?? DateTime.now()),
        storeId: storeId,
      ),
    ),
  );

  // ----- categories ----------------------------------------------------------

  /// Adds a category to the business's list; answers its id.
  Future<String> createCategory(String businessId, String name) async {
    final data = callableMap(
      await caller(
        'createInventoryCategory',
        createInventoryCategoryRequest(businessId, name),
      ),
    );
    return callableString(data['categoryId']);
  }

  Future<void> renameCategory(
    String businessId,
    String categoryId,
    String name,
  ) => caller(
    'renameInventoryCategory',
    renameInventoryCategoryRequest(businessId, categoryId, name),
  );

  /// Categories are archived, never deleted; products keep their category.
  Future<void> setCategoryArchived(
    String businessId,
    String categoryId, {
    required bool archived,
  }) => caller(
    'archiveInventoryCategory',
    archiveInventoryCategoryRequest(businessId, categoryId, archived: archived),
  );

  // ----- brands --------------------------------------------------------------

  /// Adds a brand to the business's list; answers its id.
  Future<String> createBrand(String businessId, String name) async {
    final data = callableMap(
      await caller(
        'createInventoryBrand',
        createInventoryBrandRequest(businessId, name),
      ),
    );
    return callableString(data['brandId']);
  }

  Future<void> renameBrand(String businessId, String brandId, String name) =>
      caller(
        'renameInventoryBrand',
        renameInventoryBrandRequest(businessId, brandId, name),
      );

  /// Brands are archived, never deleted; products keep their brand.
  Future<void> setBrandArchived(
    String businessId,
    String brandId, {
    required bool archived,
  }) => caller(
    'archiveInventoryBrand',
    archiveInventoryBrandRequest(businessId, brandId, archived: archived),
  );

  // ----- stores (owner only, except the transfer) ----------------------------

  Future<String> createStore(
    String businessId,
    InventoryStoreDraft draft,
  ) async {
    final data = callableMap(
      await caller(
        'createInventoryStore',
        createInventoryStoreRequest(businessId, draft),
      ),
    );
    return callableString(data['storeId']);
  }

  /// Saves what changed; nothing is sent when nothing did.
  Future<void> updateStore(
    String businessId,
    InventoryStore existing,
    InventoryStoreDraft draft,
  ) async {
    final request = updateInventoryStoreRequest(businessId, existing, draft);
    if (inventoryStoreUpdateIsEmpty(request)) return;
    await caller('updateInventoryStore', request);
  }

  /// A store with stock cannot be archived (`store_has_stock`): move it first.
  Future<void> setStoreArchived(
    String businessId,
    String storeId, {
    required bool archived,
  }) => caller(
    'archiveInventoryStore',
    archiveInventoryStoreRequest(businessId, storeId, archived: archived),
  );

  /// A staff member's home store ('' for none) and "works in all stores".
  Future<void> setStaffAccess({
    required String businessId,
    required String userId,
    required String homeStoreId,
    required bool allStores,
  }) => caller(
    'setInventoryStaffAccess',
    setInventoryStaffAccessRequest(
      businessId: businessId,
      userId: userId,
      homeStoreId: homeStoreId,
      allStores: allStores,
    ),
  );

  // ----- store transfers (v5) -----------------------------------------------

  /// Saves the composer as a draft (the same key updates the same draft). A
  /// draft reserves nothing.
  Future<InventoryTransferSendResult> saveTransferDraft(
    String businessId,
    InventoryTransferComposer composer,
  ) async => InventoryTransferSendResult.fromCallable(
    await caller('saveInventoryTransferDraft', composer.request(businessId)),
  );

  /// Sends it: the pieces leave the source store and are in transit. The
  /// same key answers the stored transfer (`replayed`), never a second one.
  Future<InventoryTransferSendResult> sendTransfer(
    String businessId,
    InventoryTransferComposer composer,
  ) async => InventoryTransferSendResult.fromCallable(
    await caller('sendInventoryTransfer', composer.request(businessId)),
  );

  /// Cancels a transfer in transit (its pieces go back to the source) or
  /// discards a draft.
  Future<void> cancelTransfer({
    required String businessId,
    required String transferId,
    required String requestId,
  }) => caller(
    'cancelInventoryTransfer',
    cancelInventoryTransferRequest(
      businessId: businessId,
      transferId: transferId,
      requestId: requestId,
    ),
  );

  /// Confirms what arrived ([counted]: pieces per product).
  Future<InventoryTransferReceiveResult> receiveTransfer({
    required String businessId,
    required InventoryTransfer transfer,
    required Map<String, int> counted,
    required String requestId,
    String note = '',
  }) async => InventoryTransferReceiveResult.fromCallable(
    await caller(
      'receiveInventoryTransfer',
      receiveInventoryTransferRequest(
        businessId: businessId,
        transfer: transfer,
        counted: counted,
        requestId: requestId,
        note: note,
      ),
    ),
  );

  /// The owner's decision on one missing line: return it to the source
  /// store, or write it off with a reason.
  Future<void> resolveTransferLine({
    required String businessId,
    required String transferId,
    required String itemId,
    required bool writeOff,
    required String requestId,
    String reason = '',
    String note = '',
  }) => caller(
    'resolveInventoryTransferLine',
    resolveInventoryTransferLineRequest(
      businessId: businessId,
      transferId: transferId,
      itemId: itemId,
      writeOff: writeOff,
      requestId: requestId,
      reason: reason,
      note: note,
    ),
  );
}
