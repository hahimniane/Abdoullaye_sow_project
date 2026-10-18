import 'dart:async';

import 'inventory_service.dart';
import 'lot_ledger.dart' show LotStaff, withBusinessOwner;

/// Everyone in the business who can take money or collect a credit: the
/// profiles that name the business plus its owner (the same set the server
/// accepts as "received by" / collector, `withBusinessOwner`).
///
/// One small owner of the two subscriptions, opened in `initState` and closed
/// in `dispose` like [InventoryContextWatcher]. Either stream failing (no
/// permission, no Firebase in a widget test) leaves its half empty.
class InventoryTeamWatcher {
  InventoryTeamWatcher({
    required this.source,
    required this.businessId,
    required this.onChange,
    this.creditSource,
  });

  final InventorySource source;

  /// Where the owner is read from; null uses Firestore, and a test that gives
  /// none simply has no owner added.
  final InventoryCreditSource? creditSource;
  final String businessId;
  final void Function() onChange;

  List<LotStaff> _people = const [];

  /// What a person or owner with no name at all reads as ("Team member",
  /// "Business owner"), set by the screen in its language; never the uid.
  String unnamedPersonLabel = '';
  String unnamedOwnerLabel = '';
  InventoryBusinessOwner? _owner;
  final List<StreamSubscription<Object?>> _subs = [];
  bool _disposed = false;

  /// The pickers' list: the owner first when their profile is not among the
  /// people.
  List<LotStaff> get people {
    final named = [
      for (final p in _people)
        p.name.trim().isEmpty && unnamedPersonLabel.isNotEmpty
            ? LotStaff(id: p.id, name: unnamedPersonLabel)
            : p,
    ];
    final owner = _owner;
    if (owner == null) return named;
    return withBusinessOwner(
      named,
      ownerUid: owner.uid,
      ownerName: owner.name,
      fallbackName: owner.email,
      unnamedLabel: unnamedOwnerLabel,
    );
  }

  void start() {
    _subs.add(
      source.watchStaff(businessId).listen((rows) {
        if (_disposed) return;
        _people = rows;
        onChange();
      }, onError: (_) {}),
    );
    try {
      final owners = (creditSource ?? FirestoreInventoryCreditSource())
          .watchBusinessOwner(businessId);
      _subs.add(
        owners.listen((owner) {
          if (_disposed) return;
          _owner = owner;
          onChange();
        }, onError: (_) {}),
      );
    } catch (_) {
      // No Firebase (a widget test without a credit source): no owner row.
    }
  }

  void dispose() {
    _disposed = true;
    for (final s in _subs) {
      s.cancel();
    }
  }
}
