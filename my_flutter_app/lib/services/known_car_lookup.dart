import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/foundation.dart';

import 'business_activity_queries.dart';
import 'lot_ledger.dart' show LotKnownCar, lotFindKnownCar;

/// "Have we seen this VIN before?" for a business, without reading its whole
/// history.
///
/// The invoices, ledger and containers screens each listened to every
/// parked car and every ledger activity the business ever recorded - up to a
/// thousand live documents per screen - only so typing a VIN could fill in
/// the car. Now each screen holds the newest [knownCarRecentLimit] of each,
/// read once and shared, and a complete VIN that is not among them is looked
/// up exactly: two equality queries that return that VIN's few records.
///
/// One instance per business for the app session ([forBusiness]), so opening
/// the invoices screen after the ledger costs nothing.
class KnownCarLookup {
  KnownCarLookup._(this.businessId, this._db);

  /// The shared lookup for [businessId].
  factory KnownCarLookup.forBusiness(
    String businessId, {
    FirebaseFirestore? db,
  }) {
    final id = businessId.trim();
    return _byBusiness.putIfAbsent(
      id,
      () => KnownCarLookup._(id, db ?? FirebaseFirestore.instance),
    );
  }

  static final Map<String, KnownCarLookup> _byBusiness = {};

  /// How long an exact answer (including "never seen") is trusted. A car
  /// recorded since then is found by the screen's own live rows anyway.
  static const Duration exactTtl = Duration(minutes: 10);

  final String businessId;
  final FirebaseFirestore _db;

  List<LotKnownCar> _recent = const [];
  Future<List<LotKnownCar>>? _recentLoad;
  final Map<String, ({LotKnownCar? car, DateTime at})> _exact = {};
  final Map<String, Future<LotKnownCar?>> _inFlight = {};

  /// The newest cars on file, once loaded. Empty until [loadRecent] answers.
  List<LotKnownCar> get recent => _recent;

  /// Reads the newest parked cars and ledger jobs once per session. Never
  /// throws: a refused or failed read leaves the list empty, and every form
  /// still works by hand.
  Future<List<LotKnownCar>> loadRecent() {
    if (businessId.isEmpty) return Future.value(const []);
    return _recentLoad ??= () async {
      try {
        final snapshots = await Future.wait([
          for (final spec in knownCarRecentSpecs(businessId))
            spec.build(_db).get().then(
              (snap) => snap.docs,
              onError: (Object _) =>
                  <QueryDocumentSnapshot<Map<String, dynamic>>>[],
            ),
        ]);
        _recent = knownCarsFromRows([
          for (final docs in snapshots)
            for (final doc in docs) doc.data(),
        ]);
      } catch (error) {
        debugPrint('Known-car memory failed for $businessId: $error');
        _recentLoad = null;
      }
      return _recent;
    }();
  }

  /// The best record of [vin] among [extra] (rows the screen already holds)
  /// and the recent memory, without a read.
  LotKnownCar? findLocal(String vin, [List<LotKnownCar> extra = const []]) =>
      lotFindKnownCar(vin, [...extra, ..._recent]);

  /// The best record of a complete [vin]: memory first, then an exact query
  /// of both collections. Cached per VIN for [exactTtl]; concurrent calls
  /// for the same VIN share one read. Null when the business has never
  /// recorded it, or the read failed.
  Future<LotKnownCar?> findExact(String vin, {DateTime? now}) {
    final needle = vin.trim().toUpperCase();
    if (needle.isEmpty || businessId.isEmpty) return Future.value(null);
    final local = findLocal(needle);
    if (local != null && local.hasVehicle) return Future.value(local);
    final at = now ?? DateTime.now();
    final cached = _exact[needle];
    if (cached != null && at.difference(cached.at) < exactTtl) {
      return Future.value(cached.car);
    }
    return _inFlight[needle] ??= () async {
      try {
        final results = await Future.wait([
          for (final spec in knownCarVinSpecs(businessId, needle))
            spec.build(_db).get(),
        ]).timeout(const Duration(seconds: 12));
        final car = lotFindKnownCar(
          needle,
          knownCarsFromRows([
            for (final snap in results)
              for (final doc in snap.docs) doc.data(),
          ]),
        );
        _exact[needle] = (car: car, at: at);
        return car;
      } catch (error) {
        debugPrint('Known-car lookup failed for $needle: $error');
        return null;
      } finally {
        unawaited(_inFlight.remove(needle));
      }
    }();
  }
}

/// Raw parkedCars / lotActivities rows as known cars, skipping rows with no
/// VIN (a car-less ledger activity names no vehicle).
List<LotKnownCar> knownCarsFromRows(Iterable<Map<String, dynamic>> rows) => [
  for (final row in rows)
    if ('${row['vinNumber'] ?? ''}'.trim().isNotEmpty) LotKnownCar.fromMap(row),
];
