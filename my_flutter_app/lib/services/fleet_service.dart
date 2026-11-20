// Fleet's calls and reads (docs/FLEET.md): one callable, `fleetAction`, and one
// live read of each of the Fleet collections for the business (equality on
// `businessId` only, so no composite index; the rules let the business's own
// people with `fleet` read them). Behind interfaces, so the screens are tested
// with fakes.

import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/foundation.dart';

import '../utils/callable_data.dart' show callableMap;
import 'fleet_claims.dart';
import 'fleet_models.dart';
import 'fleet_requests.dart';
import 'fleet_views.dart';
import 'waiting_package_service.dart'
    show ContainerCallableCaller, callContainerCallable;

/// `fleetAction` through the caller the container and phone-account sheets use
/// (a stale device token is retried once), so widget tests hand in their own.
/// Refusals arrive as [FleetFailure] carrying `details.reason`.
class FleetService {
  const FleetService({this.caller = callContainerCallable});

  final ContainerCallableCaller caller;

  /// Runs one request from [FleetRequests]; the server's answer as a map.
  Future<Map<String, dynamic>> call(Map<String, Object?> payload) async {
    try {
      final answer = await caller(
        fleetCallable,
        payload,
      ).timeout(const Duration(seconds: 60));
      return callableMap(answer);
    } on FirebaseFunctionsException catch (error) {
      throw parseFleetFailure(error.code, error.details);
    } on FleetFailure {
      rethrow;
    } on TimeoutException {
      throw const FleetFailure(code: 'unavailable');
    } catch (error) {
      final text = error.toString().toLowerCase();
      final offline =
          text.contains('socket') ||
          text.contains('network') ||
          text.contains('connection');
      throw FleetFailure(code: offline ? 'unavailable' : 'unknown');
    }
  }

  /// `claim_photo`: the screenshot's download link; [url] is null when there
  /// is none, and [deleted] true when it was deleted after 12 months.
  Future<({String? url, bool deleted})> claimPhoto(
    String businessId,
    String claimId,
  ) async {
    final answer = await call(FleetRequests.claimPhoto(businessId, claimId));
    final url = answer['url'];
    return (
      url: url is String && url.trim().isNotEmpty ? url.trim() : null,
      deleted: answer['deleted'] == true,
    );
  }

  /// `bank_status`, read into its model.
  Future<FleetBankStatus> bankStatus(String businessId) async =>
      readFleetBankStatus(await call(FleetRequests.bankStatus(businessId)));
}

/// The Fleet collections and the business document, live.
abstract interface class FleetSource {
  /// All seven collections; emits once every one has answered, then on every
  /// change. A failed read is an error on the stream.
  Stream<FleetData> watch(String businessId);

  /// The business document (settings live in `fleet.settings`).
  Stream<Map<String, dynamic>> watchBusiness(String businessId);

  /// The open payment claims drivers reported on WhatsApp (`fleetClaims`).
  /// Read apart from the rest of Fleet: a failure here is an error on this
  /// stream only and never blanks the other screens.
  Stream<List<FleetClaim>> watchClaims(String businessId);
}

class FirestoreFleetSource implements FleetSource {
  FirestoreFleetSource({FirebaseFirestore? firestore}) : _override = firestore;

  final FirebaseFirestore? _override;
  FirebaseFirestore get _db => _override ?? FirebaseFirestore.instance;

  @override
  Stream<FleetData> watch(String businessId) {
    late final StreamController<FleetData> controller;
    final subs = <StreamSubscription<Object?>>[];
    var drivers = const <FleetDriver>[];
    var cars = const <FleetCar>[];
    var assignments = const <FleetAssignment>[];
    var bills = const <FleetBill>[];
    var payments = const <FleetPayment>[];
    var notes = const <FleetNote>[];
    var friends = const <FleetFriend>[];
    final seen = <String>{};
    const collections = [
      'fleetDrivers',
      'fleetCars',
      'fleetAssignments',
      'fleetBills',
      'fleetPayments',
      'fleetNotes',
      'fleetSubstitutes',
    ];

    void emit() {
      if (seen.length < collections.length || controller.isClosed) return;
      controller.add(
        FleetData(
          drivers: drivers,
          cars: cars,
          assignments: assignments,
          bills: bills,
          payments: payments,
          notes: notes,
          friends: friends,
        ),
      );
    }

    void listen<T>(
      String collection,
      T Function(String id, Map<String, dynamic> data) parse,
      void Function(List<T> rows) keep,
    ) {
      subs.add(
        _db
            .collection(collection)
            .where('businessId', isEqualTo: businessId)
            .snapshots()
            .listen((snap) {
              keep([for (final d in snap.docs) parse(d.id, d.data())]);
              seen.add(collection);
              emit();
            }, onError: controller.addError),
      );
    }

    controller = StreamController<FleetData>(
      onListen: () {
        listen('fleetDrivers', FleetDriver.fromMap, (r) => drivers = r);
        listen('fleetCars', FleetCar.fromMap, (r) => cars = r);
        listen(
          'fleetAssignments',
          FleetAssignment.fromMap,
          (r) => assignments = r,
        );
        listen('fleetBills', FleetBill.fromMap, (r) => bills = r);
        listen('fleetPayments', FleetPayment.fromMap, (r) => payments = r);
        listen('fleetNotes', FleetNote.fromMap, (r) => notes = r);
        listen('fleetSubstitutes', FleetFriend.fromMap, (r) => friends = r);
      },
      onCancel: () async {
        for (final s in subs) {
          await s.cancel();
        }
      },
    );
    return controller.stream;
  }

  @override
  Stream<List<FleetClaim>> watchClaims(String businessId) => _db
      .collection('fleetClaims')
      .where('businessId', isEqualTo: businessId)
      .where('open', isEqualTo: true)
      .snapshots()
      .map(
        (snap) => [for (final d in snap.docs) ?readFleetClaim(d.id, d.data())],
      );

  @override
  Stream<Map<String, dynamic>> watchBusiness(String businessId) => _db
      .collection('businesses')
      .doc(businessId)
      .snapshots()
      .map((d) => d.data() ?? <String, dynamic>{});
}

/// One snapshot of Fleet, with what the screens derive from it computed once
/// (lazily, on first use), never per build or per row.
class FleetState {
  FleetState({
    required this.data,
    required this.business,
    required this.todayKey,
    this.loading = false,
    this.error = false,
  }) : index = FleetIndex(data);

  final FleetData data;
  final FleetIndex index;
  final Map<String, dynamic> business;
  final String todayKey;

  /// True until the first answer (or the safety timeout).
  final bool loading;

  /// A read failed.
  final bool error;

  late final FleetSettingsView settings = readFleetSettings(business);
  late final List<FleetDriverRow> driverRows = fleetDriverRows(
    data,
    index,
    todayKey,
  );
  late final List<FleetCarRow> carRows = fleetCarRows(data, index, todayKey);
  late final FleetTiles tiles = fleetTiles(data, index, todayKey);

  FleetPeriod? _gridPeriod;
  FleetPeriodGrid? _grid;

  /// The payments of one period, remembered for the last period asked.
  FleetPeriodGrid periodGrid(FleetPeriod period) {
    if (_gridPeriod != period || _grid == null) {
      _grid = fleetPeriodRows(data, index, period, todayKey);
      _gridPeriod = period;
    }
    return _grid!;
  }
}

/// Holds the live [FleetState] for the Fleet screens. Loading always resolves:
/// an answer, an error, or [loadTimeout].
class FleetController extends ChangeNotifier {
  FleetController({
    required this.businessId,
    required this.source,
    this.service = const FleetService(),
    this.access = FleetAccess.none,
    this.loadTimeout = const Duration(seconds: 25),
    DateTime Function()? clock,
  }) : _clock = clock ?? DateTime.now,
       _state = FleetState(
         data: FleetData.empty,
         business: const {},
         todayKey: fleetTodayKey((clock ?? DateTime.now)()),
         loading: true,
       );

  final String businessId;
  final FleetSource source;
  final FleetService service;
  final FleetAccess access;
  final Duration loadTimeout;
  final DateTime Function() _clock;

  FleetState _state;
  FleetState get state => _state;

  List<FleetClaim> _claims = const [];

  /// The open payment claims. Read apart from [state]: its own loading and
  /// error flags, so a claims failure never blanks the rest of Fleet.
  List<FleetClaim> get claims => _claims;
  bool _claimsLoading = true;
  bool _claimsError = false;
  bool get claimsLoading => _claimsLoading;
  bool get claimsError => _claimsError;

  StreamSubscription<List<FleetClaim>>? _claimsSub;
  Timer? _claimsTimer;
  StreamSubscription<FleetData>? _dataSub;
  StreamSubscription<Map<String, dynamic>>? _businessSub;
  Timer? _timer;
  bool _disposed = false;

  void start() {
    if (_dataSub != null) return;
    _timer = Timer(loadTimeout, () {
      if (_state.loading) _set(loading: false, error: true);
    });
    _dataSub = source
        .watch(businessId)
        .listen(
          (data) => _set(data: data, loading: false, error: false),
          onError: (Object _) => _set(loading: false, error: true),
        );
    _businessSub = source
        .watchBusiness(businessId)
        .listen((business) => _set(business: business), onError: (Object _) {});
    _startClaims();
  }

  /// The claims read always resolves: an answer, an error, or [loadTimeout].
  void _startClaims() {
    _claimsTimer?.cancel();
    _claimsTimer = Timer(loadTimeout, () {
      if (_claimsLoading) _setClaims(loading: false, error: true);
    });
    unawaited(_claimsSub?.cancel());
    _claimsSub = source
        .watchClaims(businessId)
        .listen(
          (rows) => _setClaims(claims: rows, loading: false, error: false),
          onError: (Object _) => _setClaims(loading: false, error: true),
        );
  }

  void _setClaims({List<FleetClaim>? claims, bool? loading, bool? error}) {
    if (_disposed) return;
    _claims = claims ?? _claims;
    _claimsLoading = loading ?? _claimsLoading;
    _claimsError = error ?? _claimsError;
    if (!_claimsLoading) _claimsTimer?.cancel();
    notifyListeners();
  }

  /// Reads the claims again after a failure.
  void retryClaims() {
    _setClaims(loading: true, error: false);
    _startClaims();
  }

  /// Reads again after a failure.
  void retry() {
    unawaited(_dataSub?.cancel());
    unawaited(_businessSub?.cancel());
    _dataSub = null;
    _businessSub = null;
    _timer?.cancel();
    _set(loading: true, error: false);
    start();
  }

  void _set({
    FleetData? data,
    Map<String, dynamic>? business,
    bool? loading,
    bool? error,
  }) {
    if (_disposed) return;
    _state = FleetState(
      data: data ?? _state.data,
      business: business ?? _state.business,
      todayKey: fleetTodayKey(_clock()),
      loading: loading ?? _state.loading,
      error: error ?? _state.error,
    );
    if (loading == false) _timer?.cancel();
    notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _timer?.cancel();
    _claimsTimer?.cancel();
    unawaited(_dataSub?.cancel());
    unawaited(_businessSub?.cancel());
    unawaited(_claimsSub?.cancel());
    super.dispose();
  }
}
