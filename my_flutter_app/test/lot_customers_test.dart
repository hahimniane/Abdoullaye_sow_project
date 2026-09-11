import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/lot_customers.dart';

void main() {
  final rows = [
    // A legacy row may still carry a `cars` array on disk; it is ignored - a
    // customer is a name and a phone number.
    LotCustomer.fromMap('1', {
      'name': 'Amadou Ba', 'phone': '2015550100', 'email': '',
      'cars': [{'vin': '1hgcm8', 'make': 'Honda', 'model': 'Accord', 'year': '2003'}],
      'lastSeenAt': null,
    }),
    LotCustomer.fromMap('2', {'name': 'Fatou Diallo', 'phone': '9175550123', 'email': 'fatou@x.co'}),
    LotCustomer.fromMap('3', {'name': 'Ibrahima Amadou', 'phone': '', 'email': ''}),
  ];

  test('customers come back as staff type: name prefix first, then word prefix', () {
    expect(matchLotCustomers(rows, 'a'), isEmpty);
    expect(matchLotCustomers(rows, 'am').map((r) => r.name), ['Amadou Ba', 'Ibrahima Amadou']);
  });

  test('phone digits and email find the customer; a car never does', () {
    expect(matchLotCustomers(rows, '917-555').first.name, 'Fatou Diallo');
    expect(matchLotCustomers(rows, 'fatou@').first.name, 'Fatou Diallo');
    // A car's VIN is not part of a customer any more, so it finds no one.
    expect(matchLotCustomers(rows, '1HGCM'), isEmpty);
  });

  group('the lot own people can be the customer', () {
    test('a staff row becomes someone the picker can offer', () {
      final staff = LotCustomer.fromStaff('u1', {
        'fullName': 'Mariama Bah',
        'email': 'M.Bah@Example.com',
        'phone': '917-555-0100',
      });
      expect(staff, isNotNull);
      expect(staff!.name, 'Mariama Bah');
      expect(staff.email, 'm.bah@example.com');
      expect(staff.staff, isTrue);

      // Nothing to show, nothing to offer.
      expect(LotCustomer.fromStaff('u2', {'phone': '917-555-0101'}), isNull);
      // A colleague with only a name is still worth offering.
      expect(LotCustomer.fromStaff('u3', {'fullName': 'Sekou'})?.name, 'Sekou');
    });

    test('the same person is never offered twice', () {
      final saved = LotCustomer.fromMap('c1', {
        'name': 'Mariama Bah',
        'phone': '(917) 555-0100',
        'email': 'm.bah@example.com',
      });
      final asStaff = LotCustomer.fromStaff('u1', {
        'fullName': 'Mariama Bah',
        'email': 'm.bah@example.com',
        'phone': '917-555-0100',
      })!;
      final other = LotCustomer.fromStaff('u2', {
        'fullName': 'Sekou Camara',
        'email': 'sekou@example.com',
      })!;

      final merged = lotCustomerSources([saved], [asStaff, other]);
      expect(merged.length, 2, reason: 'one phone number is one person');
      // The remembered record wins the tie: it carries a real last seen.
      expect(merged.first.staff, isFalse);
      expect(merged.last.name, 'Sekou Camara');

      // A colleague nobody has parked for yet is still findable.
      expect(matchLotCustomers(merged, 'sek').first.name, 'Sekou Camara');
    });

    test('someone with no phone, email or name is not a person to offer', () {
      expect(
        lotCustomerSources(const [], [
          const LotCustomer(
            id: 'x', name: '', phone: '', email: '', lastSeenMs: 0,
          ),
        ]),
        isEmpty,
      );
    });
  });
}
