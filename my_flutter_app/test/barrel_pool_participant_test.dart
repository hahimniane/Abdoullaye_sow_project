import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/models/barrel_pool.dart';

void main() {
  test('parses a pending shared-barrel join request', () {
    final participant = BarrelPoolParticipant.fromMap('customer-b', {
      'senderName': 'Customer B',
      'receiverName': 'Mamadou Bah',
      'receiverPhone': '+224620000099',
      'contentsDescription': 'Clothes and shoes',
      'sharesClaimed': 1,
      'joinStatus': 'requested',
      'paymentStatus': 'succeeded',
      'depositAmountCents': 3375,
    });

    expect(participant.uid, 'customer-b');
    expect(participant.joinStatus, 'requested');
    expect(participant.paymentStatus, 'succeeded');
    expect(participant.depositAmount, 33.75);
  });
}
