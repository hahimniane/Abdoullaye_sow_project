import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/business_home.dart';

List<HomeWork> _works({
  bool sell = false,
  bool park = false,
  bool ship = false,
  bool cars = false,
  bool transport = false,
}) => homeWorks(
  canSell: sell,
  canPark: park,
  canShip: ship,
  canSellCars: cars,
  canTransport: transport,
);

void main() {
  group('homeWorks', () {
    test('lists only what the person can do, in the default order', () {
      expect(_works(), isEmpty);
      expect(_works(park: true), [HomeWork.parking]);
      expect(_works(transport: true, ship: true, park: true, sell: true), [
        HomeWork.shop,
        HomeWork.parking,
        HomeWork.shipping,
        HomeWork.transport,
      ]);
      expect(_works(cars: true, park: true), [
        HomeWork.parking,
        HomeWork.carSales,
      ]);
    });
  });

  group('mainHomeWork', () {
    test('nothing to lead with when there is no work', () {
      expect(mainHomeWork(const [], 'parking'), isNull);
      expect(mainHomeWork(const [], null), isNull);
    });

    test('the stored choice wins when the person can do it', () {
      final works = _works(sell: true, park: true, ship: true);
      expect(mainHomeWork(works, 'shipping'), HomeWork.shipping);
      expect(mainHomeWork(works, 'parking'), HomeWork.parking);
      expect(mainHomeWork(works, ' shop '), HomeWork.shop);
    });

    test('before the setting exists the home leads as it always did', () {
      expect(
        mainHomeWork(_works(sell: true, park: true, ship: true), null),
        HomeWork.shop,
      );
      expect(
        mainHomeWork(_works(park: true, ship: true, cars: true), null),
        HomeWork.parking,
      );
      expect(
        mainHomeWork(_works(ship: true, cars: true), ''),
        HomeWork.shipping,
      );
      expect(
        mainHomeWork(_works(cars: true, transport: true), null),
        HomeWork.carSales,
      );
      expect(mainHomeWork(_works(transport: true), null), HomeWork.transport);
    });

    test('a choice the person cannot do, or junk, falls back to the default', () {
      final works = _works(park: true, ship: true);
      // The owner chose shop, but this person has no inventory permission.
      expect(mainHomeWork(works, 'shop'), HomeWork.parking);
      expect(mainHomeWork(works, 'nonsense'), HomeWork.parking);
      expect(mainHomeWork(works, 'Parking'), HomeWork.parking);
    });
  });

  group('homeOtherWorks', () {
    test('every work but the main one, in the default order', () {
      final works = _works(sell: true, park: true, ship: true, cars: true);
      expect(homeOtherWorks(works, HomeWork.shipping), [
        HomeWork.shop,
        HomeWork.parking,
        HomeWork.carSales,
      ]);
      expect(homeOtherWorks(_works(park: true), HomeWork.parking), isEmpty);
      expect(homeOtherWorks(const [], null), isEmpty);
    });
  });

  test('every work has a distinct stored key that reads back', () {
    final keys = {for (final w in HomeWork.values) w.key};
    expect(keys.length, HomeWork.values.length);
    for (final work in HomeWork.values) {
      expect(HomeWork.fromKey(work.key), work);
    }
    expect(HomeWork.fromKey(null), isNull);
    expect(HomeWork.fromKey(7), isNull);
  });
}
