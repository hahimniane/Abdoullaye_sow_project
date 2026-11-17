import 'package:cloud_firestore/cloud_firestore.dart';

import 'business_today.dart';
import 'waiting_package_service.dart'
    show ContainerCallableCaller, callContainerCallable;

/// What the Today screen reads and does, behind one interface so a widget test
/// answers (or refuses) in place of Firebase.
abstract interface class BusinessTodayApi {
  /// `getBusinessOverview`: this month's figures, cut to what this viewer may
  /// see. [refresh] skips the server's few-minute cache.
  Future<BusinessTodayResponse> load(String businessId, {bool refresh = false});

  /// The unacknowledged lot-ledger changes, newest first (at most
  /// [todayLedgerAlertLimit]), as the console queries them.
  Future<List<TodayLedgerEvent>> ledgerAlerts(String businessId);

  /// `acknowledgeLotLedgerEvent`: the change stops being listed.
  Future<void> dismissLedgerEvent(String eventId);
}

/// The real thing: the same callable wrapper every container screen uses (one
/// App Check `unauthenticated` refusal is answered with a fresh token and one
/// more try) and the same Firestore query the console runs.
class FirebaseBusinessTodayApi implements BusinessTodayApi {
  FirebaseBusinessTodayApi({
    this.caller = callContainerCallable,
    FirebaseFirestore? firestore,
  }) : _override = firestore;

  final ContainerCallableCaller caller;
  final FirebaseFirestore? _override;
  FirebaseFirestore get _db => _override ?? FirebaseFirestore.instance;

  @override
  Future<BusinessTodayResponse> load(
    String businessId, {
    bool refresh = false,
  }) async => BusinessTodayResponse.fromCallable(
    await caller('getBusinessOverview', {
      'businessId': businessId,
      if (refresh) 'refresh': true,
    }),
  );

  @override
  Future<List<TodayLedgerEvent>> ledgerAlerts(String businessId) async {
    // Scoped by business (the rule authorises by it) and by acknowledged,
    // newest first: the console's own query, so the same index serves both.
    final snap = await _db
        .collection('lotLedgerAudit')
        .where('businessId', isEqualTo: businessId)
        .where('acknowledged', isEqualTo: false)
        .orderBy('at', descending: true)
        .limit(todayLedgerAlertLimit)
        .get();
    return [
      for (final d in snap.docs) TodayLedgerEvent.fromMap(d.id, d.data()),
    ];
  }

  @override
  Future<void> dismissLedgerEvent(String eventId) async {
    await caller('acknowledgeLotLedgerEvent', {'eventId': eventId});
  }
}
