import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/screens/login_screen.dart';

void main() {
  test('login accepts email addresses and rejects phone identifiers', () {
    expect(isValidLoginEmail('person@example.com'), isTrue);
    expect(isValidLoginEmail(' PERSON@EXAMPLE.COM '), isTrue);
    expect(isValidLoginEmail('+1 202-555-0184'), isFalse);
    expect(isValidLoginEmail('2025550184'), isFalse);
  });
}
