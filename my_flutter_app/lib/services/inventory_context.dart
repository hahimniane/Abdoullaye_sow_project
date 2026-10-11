import 'dart:async';

import 'inventory_service.dart';
import 'inventory_stores.dart';

/// What every inventory screen needs to know beyond the products: the
/// business's categories and stores, and - only once there are several stores
/// - the per-store counts the person may read.
///
/// One small owner of those subscriptions, so each screen opens them in
/// `initState` (never in `build`), closes them in `dispose`, and learns of a
/// change through [onChange]. A stream that errors (an older server with no
/// such collection, or a read the rules do not allow) leaves its list empty:
/// no stores means a single-store business, and the screens behave as they did
/// before stores existed.
class InventoryContextWatcher {
  InventoryContextWatcher({
    required this.source,
    required this.businessId,
    required this.onChange,
    this.access = const InventoryAccess.owner(),
    this.watchCategories = true,
    this.safety = const Duration(seconds: 8),
  });

  final InventorySource source;
  final String businessId;
  final InventoryAccess access;
  final void Function() onChange;
  final bool watchCategories;

  /// How long to wait for the stores before treating them as answered.
  final Duration safety;

  List<InventoryCategory> categories = const [];
  List<InventoryStore> stores = const [];
  InventoryStockIndex stock = InventoryStockIndex.empty;

  /// The stores stream answered (or failed, or the safety timer ran out): the
  /// screen knows whether this is a single-store business.
  bool storesLoaded = false;

  StreamSubscription<Object?>? _categoriesSub;
  StreamSubscription<Object?>? _storesSub;
  StreamSubscription<Object?>? _stockSub;
  String? _stockKey;
  Timer? _timer;
  bool _disposed = false;

  InventoryStoreContext get context =>
      InventoryStoreContext(stores: stores, access: access);

  void start() {
    _timer = Timer(safety, () {
      if (_disposed || storesLoaded) return;
      storesLoaded = true;
      onChange();
    });
    if (watchCategories) {
      _categoriesSub = source.watchCategories(businessId).listen((rows) {
        if (_disposed) return;
        categories = rows;
        onChange();
      }, onError: (_) {});
    }
    _storesSub = source
        .watchStores(businessId)
        .listen(
          (rows) {
            if (_disposed) return;
            stores = rows;
            storesLoaded = true;
            _timer?.cancel();
            _syncStock();
            onChange();
          },
          onError: (_) {
            if (_disposed) return;
            storesLoaded = true;
            _timer?.cancel();
            onChange();
          },
        );
  }

  /// Counts are read only for a business with several stores, and only the
  /// store a person may see: their own, or all of them.
  void _syncStock() {
    final ctx = context;
    final String? key = inventoryNeedsStock(ctx)
        ? (ctx.ownStoreId.isEmpty ? '*' : ctx.ownStoreId)
        : null;
    if (key == _stockKey) return;
    _stockKey = key;
    _stockSub?.cancel();
    _stockSub = null;
    stock = InventoryStockIndex.empty;
    if (key == null) return;
    _stockSub = source
        .watchStock(businessId, storeId: key == '*' ? '' : key)
        .listen((rows) {
          if (_disposed) return;
          stock = InventoryStockIndex(rows);
          onChange();
        }, onError: (_) {});
  }

  void dispose() {
    _disposed = true;
    _timer?.cancel();
    _categoriesSub?.cancel();
    _storesSub?.cancel();
    _stockSub?.cancel();
  }
}
