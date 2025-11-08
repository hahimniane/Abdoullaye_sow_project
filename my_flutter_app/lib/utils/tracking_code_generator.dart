import 'dart:math';

import 'package:cloud_firestore/cloud_firestore.dart';

class TrackingCodeGenerator {
  const TrackingCodeGenerator._();

  static final Random _random = Random.secure();
  static const String _alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

  static Future<String> generateUniqueCode({
    required String prefix,
    required String collectionPath,
    int randomLength = 3,
    int maxAttempts = 12,
  }) async {
    final firestore = FirebaseFirestore.instance;

    for (int attempt = 0; attempt < maxAttempts; attempt++) {
      final code = '$prefix${_timeSegment()}${_randomSegment(randomLength)}';

      final snapshot = await firestore
          .collection(collectionPath)
          .where('trackingCode', isEqualTo: code)
          .limit(1)
          .get();

      if (snapshot.docs.isEmpty) {
        return code;
      }
    }

    throw Exception('Unable to generate unique tracking code');
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

