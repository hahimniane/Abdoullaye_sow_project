import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/utils/parking_status_options.dart';

void main() {
  test('parked car status options include reserved once', () {
    final options = parkedCarStatusOptions('reserved');

    expect(options, contains('reserved'));
    expect(options.where((status) => status == 'reserved'), hasLength(1));
  });

  test(
    'parked car status options preserve unknown persisted statuses once',
    () {
      final options = parkedCarStatusOptions('cancelled');

      expect(options.last, 'cancelled');
      expect(options.where((status) => status == 'cancelled'), hasLength(1));
    },
  );
}
