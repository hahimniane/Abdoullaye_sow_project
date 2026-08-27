import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/saved_recipient_service.dart';

/// Typing a NAME used to match every saved recipient: the matcher stripped
/// non-digits from the query to compare phone numbers, and a letters-only
/// query strips to "" — which `contains("")` answers true for everyone. The
/// customer saw their four most recent recipients no matter what they typed.
void main() {
  const amadou = SavedRecipient(
    id: '224622334455',
    name: 'Amadou Diallo',
    phone: '+224 622 33 44 55',
  );
  const fatou = SavedRecipient(
    id: '17705550148',
    name: 'Fatou Sow',
    phone: '+1 770 555 0148',
  );

  test('a name query matches only that recipient', () {
    expect(amadou.matches('ama'), isTrue);
    expect(fatou.matches('ama'), isFalse);
  });

  test('a digit query matches on the phone, ignoring formatting', () {
    expect(fatou.matches('7705'), isTrue);
    expect(amadou.matches('7705'), isFalse);
  });

  test('an empty query offers everyone', () {
    expect(amadou.matches('   '), isTrue);
    expect(fatou.matches(''), isTrue);
  });

  test('a name that matches nobody matches nobody', () {
    expect(amadou.matches('Mariama'), isFalse);
    expect(fatou.matches('Mariama'), isFalse);
  });
}
