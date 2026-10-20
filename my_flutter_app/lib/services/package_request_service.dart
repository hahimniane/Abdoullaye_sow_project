import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';

import 'business_activity_queries.dart'
    show packageRequestsMineSpec, packageRequestsOpenSpec;
import 'package_requests.dart';
import 'waiting_package_service.dart'
    show ContainerCallableCaller, callContainerCallable;

/// A request callable refused, or the call never got through. Screens map
/// [refusal] to their own words in both languages (`requestRefusalText`);
/// the server's English `message` is never shown.
class RequestFailure implements Exception {
  const RequestFailure(this.refusal);

  final RequestRefusal refusal;

  @override
  String toString() => 'RequestFailure(${refusal.code} ${refusal.reasons})';
}

/// The estimate lock as `startPackageEstimate` granted it.
class RequestLockGrant {
  const RequestLockGrant({required this.lock, required this.version});

  final RequestLock lock;

  /// The estimate's current version (0 when none).
  final int version;
}

class RequestConfirmed {
  const RequestConfirmed({
    required this.confirmedVersion,
    this.alreadyConfirmed = false,
  });

  final int confirmedVersion;
  final bool alreadyConfirmed;
}

class RequestSettingsSaved {
  const RequestSettingsSaved({
    required this.requestSlug,
    required this.requestLink,
  });

  final String requestSlug;
  final String requestLink;
}

class RequestLinkQr {
  const RequestLinkQr({required this.url, this.png});

  final String url;

  /// The 1024 px QR the server drew, or null when it sent none.
  final Uint8List? png;
}

/// Every call a request screen makes, behind one interface so each screen is
/// widget-tested with a fake (`test/fixtures/fake_package_requests.dart`).
abstract interface class PackageRequestService {
  // The customer.
  Future<RequestOptions> listOptions({String slug = ''});
  Future<RequestSubmitted> submit(Map<String, Object?> payload);
  Future<PackageRequest> getByToken(String token);
  Future<RequestConfirmed> confirmEstimate({
    required String token,
    required int version,
  });
  Future<void> declineEstimate({required String token, String reason = ''});

  /// The signed-in customer's own requests, newest first.
  Stream<List<PackageRequest>> watchMine(String uid);

  /// One request document (the sender, or the business's staff).
  Stream<PackageRequest?> watchRequest(String requestId);

  /// Uploads one compressed photo to the caller's own folder and answers its
  /// Storage path.
  Future<String> uploadPhoto({
    required String businessId,
    required Uint8List bytes,
    required String contentType,
  });

  /// A download URL for a photo path (staff, or its uploader).
  Future<String> photoUrl(String path);

  // The business.
  Stream<List<PackageRequest>> watchOpen(String businessId);
  Future<RequestLockGrant> startEstimate({
    required String businessId,
    required String requestId,
    bool takeover = false,
  });
  Future<void> releaseEstimate({
    required String businessId,
    required String requestId,
  });
  Future<EstimateSent> sendEstimate(Map<String, Object?> payload);
  Future<RequestConfirmed> confirmByPhone({
    required String businessId,
    required String requestId,
    required int version,
  });
  Future<void> decline({
    required String businessId,
    required String requestId,
    required String reason,
  });
  Future<void> cancel({
    required String businessId,
    required String requestId,
    required String reason,
  });
  Future<RequestReceived> receive(Map<String, Object?> payload);
  Stream<PackageRequestSettings> watchSettings(String businessId);
  Future<RequestSettingsSaved> saveSettings(Map<String, Object?> payload);
  Future<RequestLinkQr> linkQr(String businessId);
}

/// The real thing: the callables of §8.5 / §8.6 (through
/// [callContainerCallable], which retries one App Check refusal with a fresh
/// token), Firestore for live documents, Storage for photos.
class FirebasePackageRequestService implements PackageRequestService {
  FirebasePackageRequestService({
    ContainerCallableCaller? caller,
    FirebaseFirestore? firestore,
    FirebaseStorage? storage,
    FirebaseAuth? auth,
  }) : _caller = caller ?? callContainerCallable,
       _firestoreOverride = firestore,
       _storageOverride = storage,
       _authOverride = auth;

  final ContainerCallableCaller _caller;
  final FirebaseFirestore? _firestoreOverride;
  final FirebaseStorage? _storageOverride;
  final FirebaseAuth? _authOverride;

  FirebaseFirestore get _db => _firestoreOverride ?? FirebaseFirestore.instance;
  FirebaseStorage get _storage => _storageOverride ?? FirebaseStorage.instance;
  FirebaseAuth get _auth => _authOverride ?? FirebaseAuth.instance;

  Future<Object?> _call(String name, Map<String, Object?> payload) async {
    try {
      return await _caller(name, payload);
    } on FirebaseFunctionsException catch (error) {
      throw RequestFailure(parseRequestRefusal(error.code, error.details));
    } on RequestFailure {
      rethrow;
    } on TimeoutException {
      throw const RequestFailure(RequestRefusal(code: 'unavailable'));
    } catch (error) {
      // A socket that never connected is the commonest case.
      final text = error.toString().toLowerCase();
      final offline =
          text.contains('socket') ||
          text.contains('network') ||
          text.contains('connection');
      throw RequestFailure(
        RequestRefusal(code: offline ? 'unavailable' : 'unknown'),
      );
    }
  }

  // The token callables (get / confirm / decline) need no sign-in: the
  // token is the capability (§8.1), so a phone with no session calls them
  // as it is.

  @override
  Future<RequestOptions> listOptions({String slug = ''}) async =>
      RequestOptions.fromResponse(
        await _call('listPackageRequestOptions', {
          if (slug.trim().isNotEmpty) 'slug': slug.trim(),
        }),
      );

  /// A signed-out phone gets a guest (anonymous) session before its first
  /// photo or its Send, so asking for an estimate never needs an account.
  Future<void> _ensureSession() async {
    if (_auth.currentUser == null) await _auth.signInAnonymously();
  }

  @override
  Future<RequestSubmitted> submit(Map<String, Object?> payload) async {
    await _ensureSession();
    return RequestSubmitted.fromResponse(
      await _call('submitPackageRequest', payload),
    );
  }

  @override
  Future<PackageRequest> getByToken(String token) async {
    final data = await _call('getPackageRequestByToken', {'token': token});
    final m = data is Map ? data : const {};
    final request = m['request'];
    if (request is! Map) {
      throw const RequestFailure(
        RequestRefusal(code: 'not-found', reasons: ['request_not_found']),
      );
    }
    return PackageRequest.fromMap('', {
      for (final e in request.entries) e.key.toString(): e.value,
    });
  }

  @override
  Future<RequestConfirmed> confirmEstimate({
    required String token,
    required int version,
  }) async {
    final data = await _call('confirmPackageEstimate', {
      'token': token,
      'version': version,
    });
    final m = data is Map ? data : const {};
    return RequestConfirmed(
      confirmedVersion: (m['confirmedVersion'] as num?)?.toInt() ?? version,
      alreadyConfirmed: m['alreadyConfirmed'] == true,
    );
  }

  @override
  Future<void> declineEstimate({
    required String token,
    String reason = '',
  }) async {
    await _call('declinePackageEstimate', {
      'token': token,
      if (reason.trim().isNotEmpty) 'reason': reason.trim(),
    });
  }

  List<PackageRequest> _rows(QuerySnapshot<Map<String, dynamic>> snap) =>
      sortRequestsNewestFirst([
        for (final d in snap.docs) PackageRequest.fromMap(d.id, d.data()),
      ]);

  @override
  Stream<List<PackageRequest>> watchMine(String uid) =>
      packageRequestsMineSpec(uid).build(_db).snapshots().map(_rows);

  @override
  Stream<PackageRequest?> watchRequest(String requestId) =>
      _db.collection('packageRequests').doc(requestId).snapshots().map((doc) {
        final data = doc.data();
        return data == null ? null : PackageRequest.fromMap(doc.id, data);
      });

  @override
  Future<String> uploadPhoto({
    required String businessId,
    required Uint8List bytes,
    required String contentType,
  }) async {
    await _ensureSession();
    final uid = _auth.currentUser?.uid ?? '';
    if (uid.isEmpty) {
      throw const RequestFailure(RequestRefusal(code: 'unauthenticated'));
    }
    final path = requestPhotoPath(
      businessId: businessId,
      uploaderUid: uid,
      fileId: newRequestPhotoId(),
      contentType: contentType,
    );
    try {
      await _storage
          .ref(path)
          .putData(bytes, SettableMetadata(contentType: contentType))
          .timeout(const Duration(seconds: 60));
    } on TimeoutException {
      throw const RequestFailure(RequestRefusal(code: 'unavailable'));
    } on FirebaseException catch (error) {
      throw RequestFailure(
        RequestRefusal(
          code: error.code == 'unauthorized'
              ? 'permission-denied'
              : 'unavailable',
          reasons: const ['photo_invalid'],
        ),
      );
    }
    return path;
  }

  /// One lookup per photo path for the whole app session: every screen
  /// makes its own service, and the thumbnails were asking Storage for the
  /// same path's metadata again on every rebuild (~8 times per screen).
  static final RequestPhotoUrlCache _photoUrls = RequestPhotoUrlCache(
    (path) => FirebaseStorage.instance.ref(path).getDownloadURL(),
  );

  @override
  Future<String> photoUrl(String path) => _storageOverride == null
      ? _photoUrls.get(path)
      : _storage.ref(path).getDownloadURL();

  @override
  Stream<List<PackageRequest>> watchOpen(String businessId) =>
      packageRequestsOpenSpec(businessId).build(_db).snapshots().map(_rows);

  @override
  Future<RequestLockGrant> startEstimate({
    required String businessId,
    required String requestId,
    bool takeover = false,
  }) async {
    final data = await _call('startPackageEstimate', {
      'businessId': businessId,
      'requestId': requestId,
      if (takeover) 'takeover': true,
    });
    final m = data is Map ? data : const {};
    final lock =
        RequestLock.fromMap(m['lock']) ??
        const RequestLock(uid: '', name: '', untilMs: 0);
    return RequestLockGrant(
      lock: lock,
      version: (m['version'] as num?)?.toInt() ?? 0,
    );
  }

  @override
  Future<void> releaseEstimate({
    required String businessId,
    required String requestId,
  }) async {
    await _call('releasePackageEstimate', {
      'businessId': businessId,
      'requestId': requestId,
    });
  }

  @override
  Future<EstimateSent> sendEstimate(Map<String, Object?> payload) async =>
      EstimateSent.fromResponse(await _call('sendPackageEstimate', payload));

  @override
  Future<RequestConfirmed> confirmByPhone({
    required String businessId,
    required String requestId,
    required int version,
  }) async {
    final data = await _call('confirmPackageRequestByPhone', {
      'businessId': businessId,
      'requestId': requestId,
      'version': version,
    });
    final m = data is Map ? data : const {};
    return RequestConfirmed(
      confirmedVersion: version,
      alreadyConfirmed: m['alreadyConfirmed'] == true,
    );
  }

  @override
  Future<void> decline({
    required String businessId,
    required String requestId,
    required String reason,
  }) async {
    await _call('declinePackageRequest', {
      'businessId': businessId,
      'requestId': requestId,
      'reason': reason.trim(),
    });
  }

  @override
  Future<void> cancel({
    required String businessId,
    required String requestId,
    required String reason,
  }) async {
    await _call('cancelPackageRequest', {
      'businessId': businessId,
      'requestId': requestId,
      'reason': reason.trim(),
    });
  }

  @override
  Future<RequestReceived> receive(Map<String, Object?> payload) async =>
      RequestReceived.fromResponse(
        await _call('receivePackageRequest', payload),
      );

  @override
  Stream<PackageRequestSettings> watchSettings(String businessId) => _db
      .collection('businesses')
      .doc(businessId)
      .snapshots()
      .map(
        (doc) => PackageRequestSettings.fromBusiness(doc.data() ?? const {}),
      );

  @override
  Future<RequestSettingsSaved> saveSettings(
    Map<String, Object?> payload,
  ) async {
    final data = await _call('setPackageRequestSettings', payload);
    final m = data is Map ? data : const {};
    return RequestSettingsSaved(
      requestSlug: (m['requestSlug'] ?? '').toString(),
      requestLink: (m['requestLink'] ?? '').toString(),
    );
  }

  @override
  Future<RequestLinkQr> linkQr(String businessId) async {
    final data = await _call('getPackageRequestLinkQr', {
      'businessId': businessId,
    });
    final m = data is Map ? data : const {};
    return RequestLinkQr(
      url: (m['url'] ?? '').toString(),
      png: decodePngDataUrl((m['pngDataUrl'] ?? '').toString()),
    );
  }
}

/// The bytes of a `data:image/png;base64,...` URL, or null.
Uint8List? decodePngDataUrl(String dataUrl) {
  final comma = dataUrl.indexOf(',');
  if (!dataUrl.startsWith('data:image/') || comma < 0) return null;
  try {
    return base64Decode(dataUrl.substring(comma + 1));
  } catch (_) {
    return null;
  }
}

/// Download URLs of request photos by Storage path, each looked up once:
/// the same path asked again shares the first lookup. A failed lookup is
/// forgotten so the next ask tries again. Holds at most [maxEntries] paths,
/// dropping the oldest.
class RequestPhotoUrlCache {
  RequestPhotoUrlCache(this._fetch, {this.maxEntries = 300});

  final Future<String> Function(String path) _fetch;
  final int maxEntries;
  final Map<String, Future<String>> _byPath = {};

  /// Paths looked up (or being looked up) right now.
  int get length => _byPath.length;

  Future<String> get(String path) {
    final known = _byPath[path];
    if (known != null) return known;
    while (_byPath.length >= maxEntries && _byPath.isNotEmpty) {
      _byPath.remove(_byPath.keys.first);
    }
    final lookup = _fetch(path).catchError((Object error, StackTrace stack) {
      _byPath.remove(path);
      Error.throwWithStackTrace(error, stack);
    });
    _byPath[path] = lookup;
    return lookup;
  }
}
