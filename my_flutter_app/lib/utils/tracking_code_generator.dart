import 'dart:math';

import 'package:cloud_firestore/cloud_firestore.dart';

class TrackingCodeGenerator {
  const TrackingCodeGenerator._();

  static final Random _random = Random.secure();
  static const String _alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

  /// A tracking code not yet used by [businessId] in [collectionPath].
  ///
  /// The uniqueness check is scoped to the business the record is being
  /// written for. Unscoped, the query asked for every business's records,
  /// which Firestore rules only let an admin do: for every other staff member
  /// the check failed with permission-denied and the car could not be saved.
  /// Rules can prove `businessId == <their business>` from the filter, and an
  /// equality-only query needs no composite index.
  ///
  /// [isTaken] replaces the Firestore lookup in tests.
  static Future<String> generateUniqueCode({
    required String prefix,
    required String collectionPath,
    required String businessId,
    int randomLength = 3,
    int maxAttempts = 12,
    Future<bool> Function(String code)? isTaken,
  }) async {
    final taken =
        isTaken ??
        (String code) async {
          final snapshot = await trackingCodeLookup(
            FirebaseFirestore.instance,
            collectionPath: collectionPath,
            businessId: businessId,
            code: code,
          ).get();
          return snapshot.docs.isNotEmpty;
        };

    for (int attempt = 0; attempt < maxAttempts; attempt++) {
      final code = '$prefix${_timeSegment()}${_randomSegment(randomLength)}';
      if (!await taken(code)) return code;
    }

    throw Exception('Unable to generate unique tracking code');
  }

  /// The uniqueness query: within one business, by code.
  static Query<Map<String, dynamic>> trackingCodeLookup(
    FirebaseFirestore firestore, {
    required String collectionPath,
    required String businessId,
    required String code,
  }) {
    return firestore
        .collection(collectionPath)
        .where('businessId', isEqualTo: businessId)
        .where('trackingCode', isEqualTo: code)
        .limit(1);
  }

  static String _timeSegment() {
    final seconds = DateTime.now().toUtc().millisecondsSinceEpoch ~/ 1000;
    final base36 = seconds.toRadixString(36).toUpperCase();
    if (base36.length >= 4) {
      return base36.substring(base36.length - 4);
    }
    return base36.padLeft(4, '0');
  }

  static String _randomSegment(int length) {
    return List<String>.generate(
      length,
      (_) => _alphabet[_random.nextInt(_alphabet.length)],
    ).join();
  }
}
