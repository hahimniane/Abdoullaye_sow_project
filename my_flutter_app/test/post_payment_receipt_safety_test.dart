import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/payment_flow_safety.dart';

void main() {
  test('receipt success is reported after a completed payment', () async {
    final completed = await runBestEffortPostPaymentAction(() async {});

    expect(completed, isTrue);
  });

  test(
    'receipt failure never turns a completed payment into an error',
    () async {
      final completed = await runBestEffortPostPaymentAction(
        () async => throw StateError('printer unavailable'),
      );

      expect(completed, isFalse);
    },
  );
}
