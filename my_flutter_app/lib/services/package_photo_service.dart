import 'dart:async';
import 'dart:math';
import 'dart:typed_data';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';

import 'package_requests.dart'
    show requestPhotoExtension, requestPhotoMaxBytes, sniffRequestPhotoType;

/// Staff photos on a package (docs/AIR_PACKAGES.md §2 "Storage"): drop-off
/// photos and the delivered-without-code photo. They go to the signed-in
/// staff member's own folder, `packagePhotos/{businessId}/{uid}/{fileId}.ext`;
/// the server applies the same rule (package_proof.photoPathAllowed) when the
/// path is attached to a line.
const packagePhotoRoot = 'packagePhotos';
const maxPackagePhotos = 5;

final RegExp _fileId = RegExp(r'^[A-Za-z0-9_-]{8,64}\.(jpg|jpeg|png|webp)$');

String packagePhotoPath({
  required String businessId,
  required String uploaderUid,
  required String fileId,
}) {
  if (businessId.isEmpty || uploaderUid.isEmpty || !_fileId.hasMatch(fileId)) {
    return '';
  }
  return '$packagePhotoRoot/$businessId/$uploaderUid/$fileId';
}

String newPackagePhotoId(String contentType, [Random? random]) {
  const alphabet =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  final r = random ?? Random.secure();
  final id = List.generate(20, (_) => alphabet[r.nextInt(alphabet.length)])
      .join();
  return '$id.${requestPhotoExtension(contentType)}';
}

/// `photo_invalid` / `photo_too_large` / null, the same checks as request
/// photos (jpeg, png, webp; under 2 MB).
String? packagePhotoProblem(List<int> bytes) {
  if (sniffRequestPhotoType(bytes) == null) return 'photo_invalid';
  if (bytes.length >= requestPhotoMaxBytes) return 'photo_too_large';
  return null;
}

class PackagePhotoFailure implements Exception {
  const PackagePhotoFailure(this.code);
  final String code;
  @override
  String toString() => 'PackagePhotoFailure($code)';
}

class PackagePhotoService {
  PackagePhotoService({FirebaseAuth? auth, FirebaseStorage? storage})
      : _auth = auth ?? FirebaseAuth.instance,
        _storage = storage ?? FirebaseStorage.instance;

  final FirebaseAuth _auth;
  final FirebaseStorage _storage;

  /// Uploads one photo (already resized by the picker) to the signed-in
  /// staff member's folder and returns the Storage path to put on the line.
  Future<String> upload({
    required String businessId,
    required List<int> bytes,
  }) async {
    final problem = packagePhotoProblem(bytes);
    if (problem != null) throw PackagePhotoFailure(problem);
    final contentType = sniffRequestPhotoType(bytes)!;
    final uid = _auth.currentUser?.uid ?? '';
    if (uid.isEmpty) throw const PackagePhotoFailure('unauthenticated');
    final path = packagePhotoPath(
      businessId: businessId,
      uploaderUid: uid,
      fileId: newPackagePhotoId(contentType),
    );
    try {
      await _storage
          .ref(path)
          .putData(Uint8List.fromList(bytes),
              SettableMetadata(contentType: contentType))
          .timeout(const Duration(seconds: 60));
    } on TimeoutException {
      throw const PackagePhotoFailure('unavailable');
    } on FirebaseException catch (error) {
      throw PackagePhotoFailure(
        error.code == 'unauthorized' ? 'permission-denied' : 'unavailable',
      );
    }
    return path;
  }

  static final Map<String, Future<String>> _urls = {};

  /// One download URL lookup per path for the app session.
  Future<String> url(String path) =>
      _urls.putIfAbsent(path, () => _storage.ref(path).getDownloadURL());
}
