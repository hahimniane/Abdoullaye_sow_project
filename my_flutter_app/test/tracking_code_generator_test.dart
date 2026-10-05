import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/utils/tracking_code_generator.dart';

void main() {
  test('retries until a code is free, then returns it', () async {
    final asked = <String>[];
    final code = await TrackingCodeGenerator.generateUniqueCode(
      prefix: 'PC',
      collectionPath: 'parkedCars',
      businessId: 'lot-1',
      isTaken: (candidate) async {
        asked.add(candidate);
        return asked.length < 3;
      },
    );
    expect(asked, hasLength(3));
    expect(code, asked.last);
    expect(code, startsWith('PC'));
    expect(code, hasLength(2 + 4 + 3));
  });

  test('gives up after the attempts it was given', () async {
    await expectLater(
      TrackingCodeGenerator.generateUniqueCode(
        prefix: 'TR',
        collectionPath: 'transportRequests',
        businessId: 'lot-1',
        maxAttempts: 2,
        isTaken: (_) async => true,
      ),
      throwsException,
    );
  });

  test('the uniqueness query is scoped to the business', () {
    // The regression: unscoped, the query read every business's records,
    // which the rules refuse to anyone but an admin, so non-admin staff could
    // not save a parked car or a transport request at all.
    final source = File(
      'lib/utils/tracking_code_generator.dart',
    ).readAsStringSync();
    final lookup = source.substring(source.indexOf('trackingCodeLookup('));
    expect(lookup, contains(".where('businessId', isEqualTo: businessId)"));
    expect(lookup, contains(".where('trackingCode', isEqualTo: code)"));
  });

  test('both screens pass the business and print best effort', () {
    for (final path in const [
      'lib/screens/park_car_screen.dart',
      'lib/screens/transport_car_screen.dart',
    ]) {
      final source = File(path).readAsStringSync();
      final call = source.substring(
        source.indexOf('TrackingCodeGenerator.generateUniqueCode('),
      );
      expect(
        call.substring(0, call.indexOf(');')),
        contains('businessId: businessId'),
        reason: path,
      );
      // A print failure after the save must not look like a failed save.
      expect(source, contains('runBestEffortPostPaymentAction('), reason: path);
      expect(source, contains('recordSavedReceiptUnavailable('), reason: path);
    }
  });
}
