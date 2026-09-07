import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/lot_customers.dart';

void main() {
  final rows = [
    LotCustomer.fromMap('1', {
      'name': 'Amadou Ba', 'phone': '2015550100', 'email': '',
      'cars': [{'vin': '1hgcm8', 'make': 'Honda', 'model': 'Accord', 'year': '2003'}],
      'lastSeenAt': null,
    }),
    LotCustomer.fromMap('2', {'name': 'Fatou Diallo', 'phone': '9175550123', 'email': 'fatou@x.co', 'cars': []}),
    LotCustomer.fromMap('3', {'name': 'Ibrahima Amadou', 'phone': '', 'email': ''}),
  ];

  test('customers come back as staff type: name prefix first, then word prefix', () {
    expect(matchLotCustomers(rows, 'a'), isEmpty);
    expect(matchLotCustomers(rows, 'am').map((r) => r.name), ['Amadou Ba', 'Ibrahima Amadou']);
  });

  test('phone digits, email and a car VIN find the customer too', () {
    expect(matchLotCustomers(rows, '917-555').first.name, 'Fatou Diallo');
    expect(matchLotCustomers(rows, 'fatou@').first.name, 'Fatou Diallo');
    expect(matchLotCustomers(rows, '1HGCM').first.name, 'Amadou Ba');
    expect(rows[0].cars.first.vin, '1HGCM8');
    expect(rows[0].cars.first.label, '2003 Honda Accord · 1HGCM8');
  });
}
