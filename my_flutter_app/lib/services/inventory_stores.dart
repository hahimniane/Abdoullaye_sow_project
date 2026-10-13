/// Inventory v2, app side: the business's categories and stores, who sees which
/// store, and how a count is read and a sale routed because of it.
///
/// The contract is `docs/INVENTORY.md` ("Categories and stores (v2)"). The
/// rules this module keeps pure, so they are unit-tested without a screen:
///
/// - A business with zero or one ACTIVE store is single-store. Nothing about
///   stores is shown or sent: every function here answers as inventory did
///   before stores existed.
/// - With two or more active stores, stock is counted per store
///   (`inventoryStock`); a product's own `quantity` stays the total.
/// - The owner, and staff marked "works in all stores", see and act on every
///   store. Everyone else is tied to their home store, and without one cannot
///   sell (`home_store_required`).
///
/// No Firebase here.
library;

import '../utils/callable_data.dart';
import 'inventory.dart';

const inventoryMaxStoreName = 80;
const inventoryMaxStoreAddress = 200;
const inventoryMaxStorePhone = 40;

// ---------------------------------------------------------------------------
// Models, read from Firestore documents (every write is a callable).
// ---------------------------------------------------------------------------

/// A category the business keeps for its products, shared by all stores.
class InventoryCategory {
  const InventoryCategory({
    required this.id,
    required this.name,
    this.businessId = '',
    this.archived = false,
  });

  factory InventoryCategory.fromMap(String id, Map<String, dynamic> data) =>
      InventoryCategory(
        id: id,
        businessId: callableString(data['businessId']),
        name: _clip(callableString(data['name']), inventoryMaxCategory),
        archived: data['archived'] == true,
      );

  final String id;
  final String businessId;
  final String name;
  final bool archived;
}

/// A brand the business keeps for its products ("Jordan", "Nike"), shared by
/// all stores. Optional on a product.
class InventoryBrand {
  const InventoryBrand({
    required this.id,
    required this.name,
    this.businessId = '',
    this.archived = false,
  });

  factory InventoryBrand.fromMap(String id, Map<String, dynamic> data) =>
      InventoryBrand(
        id: id,
        businessId: callableString(data['businessId']),
        name: _clip(callableString(data['name']), inventoryMaxBrand),
        archived: data['archived'] == true,
      );

  final String id;
  final String businessId;
  final String name;
  final bool archived;
}

/// A place the business keeps stock and sells from.
class InventoryStore {
  const InventoryStore({
    required this.id,
    required this.name,
    this.businessId = '',
    this.address = '',
    this.phone = '',
    this.archived = false,
    this.isMain = false,
  });

  factory InventoryStore.fromMap(String id, Map<String, dynamic> data) =>
      InventoryStore(
        id: id,
        businessId: callableString(data['businessId']),
        name: _clip(callableString(data['name']), inventoryMaxStoreName),
        address: _clip(
          callableString(data['address']),
          inventoryMaxStoreAddress,
        ),
        phone: _clip(callableString(data['phone']), inventoryMaxStorePhone),
        archived: data['archived'] == true,
        isMain: data['isMain'] == true,
      );

  final String id;
  final String businessId;
  final String name;
  final String address;
  final String phone;
  final bool archived;

  /// The store made when the business first added a second one: it holds the
  /// whole count of any product the server has not yet counted per store.
  final bool isMain;
}

/// One product's count in one store: `inventoryStock/{itemId}__{storeId}`.
class InventoryStockRow {
  const InventoryStockRow({
    required this.itemId,
    required this.storeId,
    required this.quantity,
    this.countWasOff = false,
  });

  factory InventoryStockRow.fromMap(Map<String, dynamic> data) {
    final quantity = callableInt(data['quantity']);
    return InventoryStockRow(
      itemId: callableString(data['itemId']),
      storeId: callableString(data['storeId']),
      quantity: quantity < 0 ? 0 : quantity,
      countWasOff: data['countWasOff'] == true,
    );
  }

  final String itemId;
  final String storeId;
  final int quantity;
  final bool countWasOff;
}

String _clip(String text, int max) =>
    text.length > max ? text.substring(0, max) : text;

/// Categories by name, the active ones (an archived category is kept for the
/// products already in it, but is not offered to a new one).
List<InventoryCategory> inventoryActiveCategories(
  Iterable<InventoryCategory> categories,
) => [
  for (final category in categories)
    if (!category.archived) category,
]..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));

/// The category with [id], or null.
InventoryCategory? inventoryCategoryById(
  Iterable<InventoryCategory> categories,
  String id,
) {
  if (id.isEmpty) return null;
  for (final category in categories) {
    if (category.id == id) return category;
  }
  return null;
}

/// The category a product sits in: by id, else a category of the same name
/// (a product typed before categories existed), else null.
InventoryCategory? inventoryCategoryOfItem(
  Iterable<InventoryCategory> categories,
  InventoryItem item,
) {
  final byId = inventoryCategoryById(categories, item.categoryId);
  if (byId != null) return byId;
  final name = item.category.trim().toLowerCase();
  if (name.isEmpty || item.categoryId.isNotEmpty) return null;
  for (final category in categories) {
    if (category.name.trim().toLowerCase() == name) return category;
  }
  return null;
}

/// Brands by name, the active ones (an archived brand is kept for the products
/// already carrying it, but is not offered to a new one).
List<InventoryBrand> inventoryActiveBrands(Iterable<InventoryBrand> brands) => [
  for (final brand in brands)
    if (!brand.archived) brand,
]..sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));

/// The brand with [id], or null.
InventoryBrand? inventoryBrandById(Iterable<InventoryBrand> brands, String id) {
  if (id.isEmpty) return null;
  for (final brand in brands) {
    if (brand.id == id) return brand;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Who sees which store.
// ---------------------------------------------------------------------------

/// What the signed-in person may do across stores. The owner always has every
/// store; a staff member has every store only when the owner marked them
/// "works in all stores", and otherwise one [homeStoreId].
class InventoryAccess {
  const InventoryAccess({
    this.isOwner = false,
    this.allStores = false,
    this.homeStoreId = '',
  });

  /// The owner: every store, and the only person who manages stores.
  const InventoryAccess.owner()
    : isOwner = true,
      allStores = true,
      homeStoreId = '';

  final bool isOwner;
  final bool allStores;
  final String homeStoreId;

  /// Sees and works in every store (owner, or "works in all stores").
  bool get seesAllStores => isOwner || allStores;

  /// Moves stock between stores: the same people.
  bool get canTransfer => seesAllStores;

  /// Creates, edits and archives stores, and assigns staff to them.
  bool get canManageStores => isOwner;
}

/// The stores of a business as one person sees them: every store (so a name
/// is always found, archived ones too) and what they may do.
class InventoryStoreContext {
  InventoryStoreContext({
    Iterable<InventoryStore> stores = const [],
    this.access = const InventoryAccess.owner(),
  }) : stores = List.unmodifiable(stores),
       active = List.unmodifiable(
         [
           for (final store in stores)
             if (!store.archived) store,
         ]..sort(
           (a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()),
         ),
       );

  /// The single-store view: nothing about stores shows.
  static final InventoryStoreContext single = InventoryStoreContext();

  final List<InventoryStore> stores;
  final List<InventoryStore> active;
  final InventoryAccess access;

  /// Two or more active stores: counts are per store and stores show.
  bool get multi => active.length >= 2;

  /// A multi-store business, seen by someone who works in every store: the
  /// store filter, the per-store counts, the transfer and the By store block.
  bool get viewerSeesAll => multi && access.seesAllStores;

  /// The person's home store when it is one of the active stores, else ''.
  String get homeStoreId =>
      active.any((s) => s.id == access.homeStoreId) ? access.homeStoreId : '';

  /// A staff member of a multi-store business with no (usable) home store:
  /// they see no stock and cannot sell until the owner assigns one.
  bool get homeStoreMissing =>
      multi && !access.seesAllStores && homeStoreId.isEmpty;

  /// The one store a person without every store works in; '' when this is not
  /// a multi-store business or they work in all of them.
  String get ownStoreId => multi && !access.seesAllStores ? homeStoreId : '';

  /// The store shown first to someone who picks: their home store, else the
  /// first active store.
  String get defaultStoreId {
    if (homeStoreId.isNotEmpty) return homeStoreId;
    return active.isEmpty ? '' : active.first.id;
  }

  /// The Main store's id, '' when none is marked.
  String get mainStoreId {
    for (final store in stores) {
      if (store.isMain) return store.id;
    }
    return '';
  }

  /// What [storeId] holds of [item]: its row, or - for a product the server
  /// has not yet counted per store - the whole count at the Main store and 0
  /// anywhere else (docs/INVENTORY.md, stock rows).
  InventoryStockRow? countAt(
    InventoryItem item,
    InventoryStockIndex stock,
    String storeId,
  ) {
    final row = stock.row(item.id, storeId);
    if (row != null) return row;
    if (!item.storeStock && storeId.isNotEmpty && storeId == mainStoreId) {
      return InventoryStockRow(
        itemId: item.id,
        storeId: storeId,
        quantity: item.quantity,
        countWasOff: item.countWasOff,
      );
    }
    return null;
  }

  /// A store's name by id, '' when unknown.
  String storeName(String id) {
    if (id.isEmpty) return '';
    for (final store in stores) {
      if (store.id == id) return store.name;
    }
    return '';
  }
}

// ---------------------------------------------------------------------------
// Selling: which store a sale goes to.
// ---------------------------------------------------------------------------

enum InventorySellStoreMode {
  /// One store (or none): the sale carries no store.
  single,

  /// Staff with a home store: the sale goes there, nothing to pick.
  home,

  /// The owner / all-stores staff: they choose the store.
  pick,

  /// Staff in a multi-store business with no home store: cannot sell.
  missing,
}

class InventorySellStore {
  const InventorySellStore(this.mode, this.defaultStoreId);

  final InventorySellStoreMode mode;

  /// The store a picker starts on, or the home store for [InventorySellStoreMode.home].
  final String defaultStoreId;

  bool get canSell => mode != InventorySellStoreMode.missing;
}

InventorySellStore inventorySellStore(InventoryStoreContext context) {
  if (!context.multi) {
    return const InventorySellStore(InventorySellStoreMode.single, '');
  }
  if (context.access.seesAllStores) {
    return InventorySellStore(
      InventorySellStoreMode.pick,
      context.defaultStoreId,
    );
  }
  final home = context.homeStoreId;
  return home.isEmpty
      ? const InventorySellStore(InventorySellStoreMode.missing, '')
      : InventorySellStore(InventorySellStoreMode.home, home);
}

/// Which sales a person may read. Someone who sees every store reads them
/// all at once (`storeId` ''); anyone else waits until the stores are known
/// ([ready] false), then reads their own store's only - or nothing at all
/// ([none]) when a business with several stores has not given them one yet.
/// The rules allow nothing wider, so nobody ever asks for more.
({bool ready, bool none, String storeId}) inventorySalesScope(
  InventoryAccess access,
  InventoryStoreContext context, {
  required bool storesLoaded,
}) {
  if (!access.seesAllStores && !storesLoaded) {
    return (ready: false, none: false, storeId: '');
  }
  if (context.homeStoreMissing) return (ready: true, none: true, storeId: '');
  return (ready: true, none: false, storeId: context.ownStoreId);
}

/// The `storeId` a sale (or a stock change) is sent with. Only someone who
/// picked a store sends one: in a single-store business and for staff with a
/// home store it is left out and the server routes it, so an old app and a
/// v1-shaped request behave the same.
String inventoryRequestStoreId(InventorySellStore sell, String picked) {
  if (sell.mode != InventorySellStoreMode.pick) return '';
  return picked.isNotEmpty ? picked : sell.defaultStoreId;
}

// ---------------------------------------------------------------------------
// Counts per store.
// ---------------------------------------------------------------------------

/// The stock rows the person may read, indexed by product and store. A
/// product with no row in a store has none there.
class InventoryStockIndex {
  InventoryStockIndex([Iterable<InventoryStockRow> rows = const []])
    : _rows = {for (final row in rows) '${row.itemId}__${row.storeId}': row};

  static final InventoryStockIndex empty = InventoryStockIndex();

  final Map<String, InventoryStockRow> _rows;

  InventoryStockRow? row(String itemId, String storeId) =>
      _rows['${itemId}__$storeId'];

  /// The count of [itemId] in [storeId], 0 when it has no row there.
  int at(String itemId, String storeId) => row(itemId, storeId)?.quantity ?? 0;

  bool get isEmpty => _rows.isEmpty;
}

/// How one product reads for one viewer.
class InventoryItemStockView {
  const InventoryItemStockView({
    required this.quantity,
    required this.status,
    this.countWasOff = false,
    this.perStore = const [],
    this.lowStoreIds = const [],
  });

  /// The count shown: the total, or the one store's count.
  final int quantity;
  final InventoryStock status;
  final bool countWasOff;

  /// Every active store's count, for someone who sees all stores and has not
  /// narrowed to one.
  final List<({String storeId, int quantity})> perStore;

  /// The stores (with a count row) where this product is low or out.
  final List<String> lowStoreIds;
}

/// Reads [item] for the viewer: a single-store business and a v1 server give
/// the product's own count; a person with one store gets that store's count;
/// someone who sees all stores gets the total with each store's count, or one
/// store's count when [storeFilter] names it.
InventoryItemStockView inventoryStockView(
  InventoryItem item,
  InventoryStoreContext context,
  InventoryStockIndex stock, {
  String storeFilter = '',
}) {
  if (!context.multi) {
    return InventoryItemStockView(
      quantity: item.quantity,
      status: item.stock,
      countWasOff: item.countWasOff,
    );
  }
  var storeId = context.ownStoreId;
  if (storeId.isEmpty &&
      context.access.seesAllStores &&
      context.active.any((s) => s.id == storeFilter)) {
    storeId = storeFilter;
  }
  if (storeId.isNotEmpty) {
    final row = context.countAt(item, stock, storeId);
    final quantity = row?.quantity ?? 0;
    return InventoryItemStockView(
      quantity: quantity,
      status: stockStatus(quantity: quantity, lowStockAt: item.lowStockAt),
      countWasOff: row?.countWasOff ?? false,
    );
  }
  if (context.homeStoreMissing) {
    // A staff member with no store sees no stock at all.
    return const InventoryItemStockView(
      quantity: 0,
      status: InventoryStock.out,
    );
  }
  // Every store: the total, plus where it is low (a store with no row has
  // never held the product and is not flagged).
  final low = <String>[];
  final perStore = <({String storeId, int quantity})>[];
  for (final store in context.active) {
    // Flagged low only on a count the server recorded there, never on the
    // implied Main-store count of a product not yet counted per store.
    final recorded = stock.row(item.id, store.id);
    final row = recorded ?? context.countAt(item, stock, store.id);
    perStore.add((storeId: store.id, quantity: row?.quantity ?? 0));
    if (recorded != null &&
        stockStatus(quantity: recorded.quantity, lowStockAt: item.lowStockAt) !=
            InventoryStock.ok) {
      low.add(store.id);
    }
  }
  var status = item.stock;
  if (status == InventoryStock.ok && low.isNotEmpty) {
    status = InventoryStock.low;
  }
  return InventoryItemStockView(
    quantity: item.quantity,
    status: status,
    countWasOff: item.countWasOff,
    perStore: perStore,
    lowStoreIds: low,
  );
}

/// The products as the viewer's lists and sale should read them: in a
/// multi-store business a person tied to one store (or looking at one store)
/// sees that store's count in place of the total. Otherwise the same items.
List<InventoryItem> inventoryViewItems(
  Iterable<InventoryItem> items,
  InventoryStoreContext context,
  InventoryStockIndex stock, {
  String storeFilter = '',
}) {
  if (!context.multi) return items.toList();
  final scoped =
      context.ownStoreId.isNotEmpty ||
      (context.access.seesAllStores &&
          context.active.any((s) => s.id == storeFilter));
  if (!scoped && !context.homeStoreMissing) return items.toList();
  return [
    for (final item in items)
      () {
        final view = inventoryStockView(
          item,
          context,
          stock,
          storeFilter: storeFilter,
        );
        return item.withQuantity(view.quantity, countWasOff: view.countWasOff);
      }(),
  ];
}

/// Whether "stock" should be read for this person at all: a business with
/// several stores, and a person who has one (or sees every one).
bool inventoryNeedsStock(InventoryStoreContext context) =>
    context.multi && !context.homeStoreMissing;

// ---------------------------------------------------------------------------
// Sales of one store.
// ---------------------------------------------------------------------------

/// The sales of [storeId] (blank: all of them). A sale from before stores
/// existed has no store and belongs to whichever store was the only one, so it
/// shows under every store rather than vanishing.
List<InventorySale> inventorySalesForStore(
  Iterable<InventorySale> sales,
  String storeId,
) => [
  for (final sale in sales)
    if (storeId.isEmpty || sale.storeId.isEmpty || sale.storeId == storeId)
      sale,
];

/// Whether [sale] - opened by id, from a notification - may be shown to this
/// viewer: the same reach as the sales list ([inventorySalesScope]) and the
/// rules. Not a sale of another business; for staff tied to one store of a
/// multi-store business, only that store's sales; for staff of a multi-store
/// business with no store yet, nothing. Call it once the stores are known.
bool inventorySaleVisible(
  InventorySale sale, {
  required String businessId,
  required InventoryStoreContext context,
}) {
  if (businessId.isEmpty || sale.businessId != businessId) return false;
  if (context.homeStoreMissing) return false;
  final own = context.ownStoreId;
  return own.isEmpty || sale.storeId == own;
}

// ---------------------------------------------------------------------------
// Request builders.
// ---------------------------------------------------------------------------

/// Category names: 1..[inventoryMaxCategory] characters.
List<String> validateInventoryCategoryName(String raw) {
  final name = raw.trim();
  if (name.isEmpty) return const ['category_name_required'];
  if (name.length > inventoryMaxCategory) {
    return const ['category_name_too_long'];
  }
  return const [];
}

/// Brand names: 1..[inventoryMaxBrand] characters.
List<String> validateInventoryBrandName(String raw) {
  final name = raw.trim();
  if (name.isEmpty) return const ['brand_name_required'];
  if (name.length > inventoryMaxBrand) return const ['brand_too_long'];
  return const [];
}

Map<String, Object?> createInventoryBrandRequest(
  String businessId,
  String name,
) => {'businessId': businessId, 'name': name.trim()};

Map<String, Object?> renameInventoryBrandRequest(
  String businessId,
  String brandId,
  String name,
) => {'businessId': businessId, 'brandId': brandId, 'name': name.trim()};

Map<String, Object?> archiveInventoryBrandRequest(
  String businessId,
  String brandId, {
  required bool archived,
}) => {'businessId': businessId, 'brandId': brandId, 'archived': archived};

Map<String, Object?> createInventoryCategoryRequest(
  String businessId,
  String name,
) => {'businessId': businessId, 'name': name.trim()};

Map<String, Object?> renameInventoryCategoryRequest(
  String businessId,
  String categoryId,
  String name,
) => {'businessId': businessId, 'categoryId': categoryId, 'name': name.trim()};

Map<String, Object?> archiveInventoryCategoryRequest(
  String businessId,
  String categoryId, {
  required bool archived,
}) => {
  'businessId': businessId,
  'categoryId': categoryId,
  'archived': archived,
};

/// What the store form holds, as typed.
class InventoryStoreDraft {
  const InventoryStoreDraft({
    this.name = '',
    this.address = '',
    this.phone = '',
  });

  factory InventoryStoreDraft.fromStore(InventoryStore store) =>
      InventoryStoreDraft(
        name: store.name,
        address: store.address,
        phone: store.phone,
      );

  final String name;
  final String address;
  final String phone;
}

/// `store_name_required`, `store_name_too_long`, `store_address_too_long`,
/// `store_phone_too_long`.
List<String> validateInventoryStoreDraft(InventoryStoreDraft draft) {
  final codes = <String>[];
  final name = draft.name.trim();
  if (name.isEmpty) {
    codes.add('store_name_required');
  } else if (name.length > inventoryMaxStoreName) {
    codes.add('store_name_too_long');
  }
  if (draft.address.trim().length > inventoryMaxStoreAddress) {
    codes.add('store_address_too_long');
  }
  if (draft.phone.trim().length > inventoryMaxStorePhone) {
    codes.add('store_phone_too_long');
  }
  return codes;
}

Map<String, Object?> createInventoryStoreRequest(
  String businessId,
  InventoryStoreDraft draft,
) {
  final address = draft.address.trim();
  final phone = draft.phone.trim();
  return {
    'businessId': businessId,
    'name': draft.name.trim(),
    if (address.isNotEmpty) 'address': address,
    if (phone.isNotEmpty) 'phone': phone,
  };
}

/// `updateInventoryStore`: only what changed ("" clears an address or phone).
Map<String, Object?> updateInventoryStoreRequest(
  String businessId,
  InventoryStore existing,
  InventoryStoreDraft draft,
) {
  final name = draft.name.trim();
  final address = draft.address.trim();
  final phone = draft.phone.trim();
  return {
    'businessId': businessId,
    'storeId': existing.id,
    if (name != existing.name) 'name': name,
    if (address != existing.address) 'address': address,
    if (phone != existing.phone) 'phone': phone,
  };
}

bool inventoryStoreUpdateIsEmpty(Map<String, Object?> request) =>
    request.keys.every((key) => key == 'businessId' || key == 'storeId');

Map<String, Object?> archiveInventoryStoreRequest(
  String businessId,
  String storeId, {
  required bool archived,
}) => {'businessId': businessId, 'storeId': storeId, 'archived': archived};

/// `setInventoryStaffAccess` (owner only): a staff member's home store ('' for
/// none) and whether they work in all stores.
Map<String, Object?> setInventoryStaffAccessRequest({
  required String businessId,
  required String userId,
  required String homeStoreId,
  required bool allStores,
}) => {
  'businessId': businessId,
  'userId': userId,
  'homeStoreId': homeStoreId,
  'allStores': allStores,
};

/// What the transfer sheet holds.
class InventoryTransferDraft {
  const InventoryTransferDraft({
    this.fromStoreId = '',
    this.toStoreId = '',
    this.quantity = '',
    this.note = '',
  });

  final String fromStoreId;
  final String toStoreId;
  final String quantity;
  final String note;
}

/// `store_required` (a side is not chosen), `same_store`, `quantity_invalid`
/// (a whole number of at least 1). The source's own count is the server's to
/// judge (`insufficient_stock`); the phone's count may be a moment old.
List<String> validateInventoryTransfer(InventoryTransferDraft draft) {
  final codes = <String>[];
  if (draft.fromStoreId.isEmpty || draft.toStoreId.isEmpty) {
    codes.add('store_required');
  } else if (draft.fromStoreId == draft.toStoreId) {
    codes.add('same_store');
  }
  final quantity = readWholeNumber(draft.quantity);
  if (quantity == null || quantity < 1 || quantity > inventoryMaxStock) {
    codes.add('quantity_invalid');
  }
  return codes;
}

Map<String, Object?> transferInventoryStockRequest(
  String businessId,
  String itemId,
  InventoryTransferDraft draft,
) {
  final note = draft.note.trim();
  return {
    'businessId': businessId,
    'itemId': itemId,
    'fromStoreId': draft.fromStoreId,
    'toStoreId': draft.toStoreId,
    'quantity': readWholeNumber(draft.quantity) ?? 0,
    if (note.isNotEmpty)
      'note': note.length > inventoryMaxNote
          ? note.substring(0, inventoryMaxNote)
          : note,
  };
}

/// Whether a failed `createInventoryBrand` means the server has no such
/// callable (a server from before brands): the product is then saved without
/// the brand rather than refused.
bool inventoryBrandCallableMissing({String? code, Object? details}) =>
    inventoryCategoryCallableMissing(code: code, details: details);

/// Whether a failed `createInventoryCategory` means the server has no such
/// callable (an older server): the typed name is then kept as the product's
/// plain category text, as before categories existed.
bool inventoryCategoryCallableMissing({String? code, Object? details}) {
  if (code == 'unimplemented') return true;
  if (code != 'not-found') return false;
  final reason = details is Map ? '${details['reason'] ?? ''}' : '';
  return reason.isEmpty;
}
