import 'dart:async';

import 'firestore_query_spec.dart' show mergeById;
import 'inventory_service.dart';
import 'inventory_stores.dart';
import 'inventory_transfers.dart';

/// The transfers one screen reads, owned in one place so a screen opens the
/// subscriptions in `initState` (never in `build`), closes them in
/// `dispose`, and hears of a change through [onChange].
///
/// It reads nothing until the stores are known, and nothing at all in a
/// business with fewer than two active stores or for a staff member who has
/// no store yet (the rules would refuse it). A staff member tied to one
/// store reads only what goes from or to it ([InventoryTransferSource] makes
/// the two queries and merges them).
class InventoryTransferFeed {
  InventoryTransferFeed({
    required this.source,
    required this.businessId,
    required this.onChange,
    this.withRecent = false,
  });

  final InventoryTransferSource source;
  final String businessId;
  final void Function() onChange;

  /// Also read the newest finished transfers (the list screen; the entry
  /// tile needs only the open ones).
  final bool withRecent;

  List<InventoryTransfer> open = const [];
  List<InventoryTransfer> recent = const [];

  /// Every read answered (or failed, or there is nothing to read).
  bool loaded = false;
  bool failed = false;

  /// Whether the business reads transfers at all (two or more active
  /// stores and a person with a store).
  bool active = false;

  StreamSubscription<Object?>? _openSub;
  StreamSubscription<Object?>? _recentSub;
  String? _key;
  bool _openAnswered = false;
  bool _recentAnswered = false;
  bool _disposed = false;

  /// The open transfers and the recent ones, each once (the open copy wins).
  List<InventoryTransfer> get all =>
      mergeById<InventoryTransfer>([open, recent], (t) => t.id);

  /// Opens (or moves) the reads for [stores]; does nothing while the stores
  /// are not known yet or when nothing changed. [force] reads again (Retry).
  void sync(
    InventoryStoreContext stores, {
    required bool storesLoaded,
    bool force = false,
  }) {
    if (_disposed || !storesLoaded) return;
    final reads = stores.multi && !stores.homeStoreMissing;
    final key = reads ? stores.ownStoreId : '!';
    if (!force && key == _key) return;
    _key = key;
    _cancel();
    active = reads;
    failed = false;
    open = const [];
    recent = const [];
    if (!reads) {
      loaded = true;
      onChange();
      return;
    }
    loaded = false;
    _openAnswered = false;
    _recentAnswered = !withRecent;
    _openSub = source.watchOpenTransfers(businessId, storeId: key).listen((
      rows,
    ) {
      if (_disposed) return;
      open = rows;
      _openAnswered = true;
      _settle();
    }, onError: (_) => _fail());
    if (withRecent) {
      _recentSub = source.watchRecentTransfers(businessId, storeId: key).listen(
        (rows) {
          if (_disposed) return;
          recent = rows;
          _recentAnswered = true;
          _settle();
        },
        onError: (_) => _fail(),
      );
    }
  }

  void _settle() {
    if (_openAnswered && _recentAnswered) {
      loaded = true;
      failed = false;
    }
    onChange();
  }

  void _fail() {
    if (_disposed) return;
    loaded = true;
    failed = true;
    onChange();
  }

  void _cancel() {
    _openSub?.cancel();
    _recentSub?.cancel();
    _openSub = null;
    _recentSub = null;
  }

  void dispose() {
    _disposed = true;
    _cancel();
  }
}
