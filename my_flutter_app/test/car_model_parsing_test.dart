import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/models/car.dart';

void main() {
  test('car parsing accepts numeric year and mileage from Firestore', () {
    final car = Car.fromMap('car-1', {
      'title': '2022 Nissan Rogue SV',
      'make': 'Nissan',
      'model': 'Rogue',
      'year': 2022,
      'mileage': 29000,
      'price': 27000,
      'status': 'active',
    });

    expect(car.year, '2022');
    expect(car.yearNumber, 2022);
    expect(car.mileage, '29000');
    expect(car.mileageNumber, 29000);
  });
}
