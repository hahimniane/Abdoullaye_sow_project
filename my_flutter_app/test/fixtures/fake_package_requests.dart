import 'dart:async';
import 'dart:typed_data';

import 'package:my_flutter_app/services/package_request_service.dart';
import 'package:my_flutter_app/services/package_requests.dart';

/// A [PackageRequestService] for widget tests: records every call, answers
/// from what the test set, and refuses with [refuse] when it names a call.
class FakePackageRequests implements PackageRequestService {
  final List<(String, Map<String, Object?>)> calls = [];

  RequestOptions options = const RequestOptions();
  Object? optionsError;
  RequestSubmitted submitted = const RequestSubmitted(
    requestId: 'r1',
    code: 'R-K7M4P',
    token: 'tok_abcdefghijklmnopqrstuvwxyz0123456789ABCDE',
    status: 'new',
  );
  PackageRequest? byToken;
  RequestConfirmed confirmed = const RequestConfirmed(confirmedVersion: 1);
  RequestLockGrant grant = const RequestLockGrant(
    lock: RequestLock(uid: 'me', name: 'Me', untilMs: 1 << 50),
    version: 0,
  );
  EstimateSent sent = const EstimateSent(
    version: 1,
    status: 'estimate_sent',
    totalCents: 0,
  );
  RequestReceived received = const RequestReceived(
    lineId: 'line1',
    trackingCode: 'CL-K7M4P2',
  );
  PackageRequestSettings settings = const PackageRequestSettings();
  RequestLinkQr qr = RequestLinkQr(
    url: 'https://laawoldigital.com/r/conakry',
    png: Uint8List(0),
  );

  /// Refusals by call name.
  final Map<String, RequestFailure> refuse = {};

  /// Calls that wait until the test completes them.
  final Map<String, Completer<void>> hold = {};

  final mine = StreamController<List<PackageRequest>>.broadcast();
  final open = StreamController<List<PackageRequest>>.broadcast();
  final docs = <String, StreamController<PackageRequest?>>{};
  List<PackageRequest>? initialMine;
  List<PackageRequest>? initialOpen;
  final Map<String, PackageRequest?> initialDocs = {};

  StreamController<PackageRequest?> doc(String id) =>
      docs[id] ??= StreamController<PackageRequest?>.broadcast();

  List<Map<String, Object?>> of(String name) => [
    for (final c in calls)
      if (c.$1 == name) c.$2,
  ];

  Future<void> _record(String name, Map<String, Object?> payload) async {
    calls.add((name, payload));
    final wait = hold[name];
    if (wait != null) await wait.future;
    final failure = refuse[name];
    if (failure != null) throw failure;
  }

  static RequestFailure failure(String code, [Map<String, Object?>? details]) =>
      RequestFailure(parseRequestRefusal(code, details));

  @override
  Future<RequestOptions> listOptions({String slug = ''}) async {
    await _record('listPackageRequestOptions', {'slug': slug});
    final error = optionsError;
    if (error != null) throw error;
    return options;
  }

  @override
  Future<RequestSubmitted> submit(Map<String, Object?> payload) async {
    await _record('submitPackageRequest', payload);
    return submitted;
  }

  @override
  Future<PackageRequest> getByToken(String token) async {
    await _record('getPackageRequestByToken', {'token': token});
    final request = byToken;
    if (request == null) {
      throw failure('not-found', {'reason': 'request_not_found'});
    }
    return request;
  }

  @override
  Future<RequestConfirmed> confirmEstimate({
    required String token,
    required int version,
  }) async {
    await _record('confirmPackageEstimate', {'token': token, 'version': version});
    return confirmed;
  }

  @override
  Future<void> declineEstimate({required String token, String reason = ''}) =>
      _record('declinePackageEstimate', {'token': token, 'reason': reason});

  @override
  Stream<List<PackageRequest>> watchMine(String uid) async* {
    calls.add(('watchMine', {'uid': uid}));
    final first = initialMine;
    if (first != null) yield first;
    yield* mine.stream;
  }

  @override
  Stream<PackageRequest?> watchRequest(String requestId) async* {
    if (initialDocs.containsKey(requestId)) yield initialDocs[requestId];
    yield* doc(requestId).stream;
  }

  @override
  Future<String> uploadPhoto({
    required String businessId,
    required Uint8List bytes,
    required String contentType,
  }) async {
    await _record('uploadPhoto', {'businessId': businessId, 'type': contentType});
    return 'packageRequestPhotos/$businessId/me/photo${calls.length}.jpg';
  }

  @override
  Future<String> photoUrl(String path) async => '';

  @override
  Stream<List<PackageRequest>> watchOpen(String businessId) async* {
    final first = initialOpen;
    if (first != null) yield first;
    yield* open.stream;
  }

  @override
  Future<RequestLockGrant> startEstimate({
    required String businessId,
    required String requestId,
    bool takeover = false,
  }) async {
    await _record('startPackageEstimate', {
      'businessId': businessId,
      'requestId': requestId,
      'takeover': takeover,
    });
    return grant;
  }

  @override
  Future<void> releaseEstimate({
    required String businessId,
    required String requestId,
  }) => _record('releasePackageEstimate', {'requestId': requestId});

  @override
  Future<EstimateSent> sendEstimate(Map<String, Object?> payload) async {
    await _record('sendPackageEstimate', payload);
    return sent;
  }

  @override
  Future<RequestConfirmed> confirmByPhone({
    required String businessId,
    required String requestId,
    required int version,
  }) async {
    await _record('confirmPackageRequestByPhone', {
      'requestId': requestId,
      'version': version,
    });
    return RequestConfirmed(confirmedVersion: version);
  }

  @override
  Future<void> decline({
    required String businessId,
    required String requestId,
    required String reason,
  }) => _record('declinePackageRequest', {
    'requestId': requestId,
    'reason': reason,
  });

  @override
  Future<void> cancel({
    required String businessId,
    required String requestId,
    required String reason,
  }) => _record('cancelPackageRequest', {
    'requestId': requestId,
    'reason': reason,
  });

  @override
  Future<RequestReceived> receive(Map<String, Object?> payload) async {
    await _record('receivePackageRequest', payload);
    return received;
  }

  @override
  Stream<PackageRequestSettings> watchSettings(String businessId) =>
      Stream.value(settings);

  @override
  Future<RequestSettingsSaved> saveSettings(Map<String, Object?> payload) async {
    await _record('setPackageRequestSettings', payload);
    return const RequestSettingsSaved(
      requestSlug: 'conakry',
      requestLink: 'https://laawoldigital.com/r/conakry',
    );
  }

  @override
  Future<RequestLinkQr> linkQr(String businessId) async {
    await _record('getPackageRequestLinkQr', {'businessId': businessId});
    return qr;
  }
}
