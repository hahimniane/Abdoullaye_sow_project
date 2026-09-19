import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/container_lot_cars.dart';
import 'package:my_flutter_app/services/container_manifest.dart';

/// The "Is this car parked in your lot?" picker: which parked cars are
/// offered, which are greyed because a container already has them, and what
/// the filter box matches. Pure, over the same `parkedCars` rows and
/// `containerVinLinks` join the screens hold.
final now = DateTime.utc(2026, 9, 18, 12);

Map<String, dynamic> parked({
  String id = 'p1',
  String vin = '1HGCM82633A004352',
  String make = 'Honda',
  String model = 'Accord',
  String year = '2003',
  String owner = 'Aissatou Diallo',
  String phone = '',
  String status = 'active',
  DateTime? end,
  bool business = true,
}) {
  return {
    'id': id,
    'vinNumber': vin,
    'carMake': make,
    'carModel': model,
    'carYear': year,
    'ownerName': owner,
    'ownerPhone': phone,
    'status': status,
    'parkingEndDate': end,
    if (business) 'source': 'business',
  };
}

ShippingContainer box(String id, String status, {String number = ''}) =>
    ShippingContainer.fromMap(id, {
      'businessId': 'b1',
      'label': 'Box $id',
      'containerNumber': number,
      'status': status,
    });

ContainerLine carLine(String id, String containerId, String vin) =>
    ContainerLine.fromMap(id, {
      'businessId': 'b1',
      'containerId': containerId,
      'kind': containerLineKindCar,
      'vinNumber': vin,
      'ownerKind': containerOwnerStock,
    });

void main() {
  group('parkedCarIsInLot', () {
    test('a live walk-up is in the lot', () {
      expect(parkedCarIsInLot(parked(), now: now), isTrue);
    });

    test('a customer booking that is live counts too', () {
      expect(parkedCarIsInLot(parked(business: false), now: now), isTrue);
    });

    test('cancelled is out', () {
      expect(
        parkedCarIsInLot(parked(status: 'cancelled'), now: now),
        isFalse,
      );
    });

    test('a stay whose end date has passed is out', () {
      expect(
        parkedCarIsInLot(parked(end: DateTime.utc(2026, 9, 1)), now: now),
        isFalse,
      );
    });

    test('a stay ending today or later is still in', () {
      expect(
        parkedCarIsInLot(parked(end: DateTime.utc(2026, 9, 18)), now: now),
        isTrue,
      );
      expect(
        parkedCarIsInLot(parked(end: DateTime.utc(2026, 10, 1)), now: now),
        isTrue,
      );
    });

    test('a booking still in checkout has no car in the yard', () {
      expect(
        parkedCarIsInLot(parked(status: 'pending_payment', business: false),
            now: now),
        isFalse,
      );
    });
  });

  group('lotCarChoices', () {
    test('only rows in the lot with a VIN are offered', () {
      final rows = [
        parked(id: 'a'),
        parked(id: 'b', vin: '', owner: 'No VIN'),
        parked(id: 'c', vin: 'JH4KA7561PC008269', status: 'cancelled'),
        parked(id: 'd', vin: 'WBA3A5C55CF256987', end: DateTime.utc(2026, 1, 1)),
      ];
      final choices = lotCarChoices(rows, const {}, now: now);
      expect(choices.map((c) => c.id), ['a']);
    });

    test('carries the vehicle, the owner and the VIN, uppercased', () {
      final choice = lotCarChoices(
        [parked(vin: '1hgcm82633a004352', phone: '917 555 0100')],
        const {},
        now: now,
      ).single;
      expect(choice.vin, '1HGCM82633A004352');
      expect(choice.vehicleLabel, '2003 Honda Accord');
      expect(choice.ownerName, 'Aissatou Diallo');
      expect(choice.ownerPhone, '917 555 0100');
      expect(choice.isTaken, isFalse);
    });

    test('a row that never said what the car is has an empty label', () {
      final choice = lotCarChoices(
        [parked(make: '', model: '', year: '')],
        const {},
        now: now,
      ).single;
      expect(choice.hasVehicle, isFalse);
      expect(choice.vehicleLabel, '');
    });

    test('falls back to the VIN as id when the row carries none', () {
      final row = parked()..remove('id');
      expect(lotCarChoices([row], const {}, now: now).single.id,
          '1HGCM82633A004352');
    });

    test('a car on an open container is offered but taken, naming the box',
        () {
      const loadingVin = '1HGCM82633A004352';
      const shippedVin = 'JH4KA7561PC008269';
      const arrivedVin = 'WBA3A5C55CF256987';
      final links = containerVinLinks(
        [
          carLine('l1', 'c1', loadingVin),
          carLine('l2', 'c2', shippedVin),
          carLine('l3', 'c3', arrivedVin),
        ],
        [
          box('c1', containerStatusLoading),
          box('c2', containerStatusShipped, number: 'MSKU1234567'),
          box('c3', containerStatusArrived),
        ],
      );
      final choices = lotCarChoices(
        [
          parked(id: 'x', vin: loadingVin),
          parked(id: 'y', vin: shippedVin),
          parked(id: 'z', vin: arrivedVin),
        ],
        links,
        now: now,
      );
      final byId = {for (final c in choices) c.id: c};
      expect(byId['x']!.isTaken, isTrue);
      expect(byId['x']!.onContainer!.containerName, 'Box c1');
      expect(byId['y']!.isTaken, isTrue);
      expect(byId['y']!.onContainer!.containerName, 'MSKU1234567');
      // An arrived box says nothing about the car any more.
      expect(byId['z']!.isTaken, isFalse);
    });

    test('free cars come first, then taken, each by vehicle then VIN', () {
      final links = containerVinLinks(
        [carLine('l1', 'c1', 'AAAAAAAAAAAAAAAAA')],
        [box('c1', containerStatusLoading)],
      );
      final choices = lotCarChoices(
        [
          parked(id: 'taken', vin: 'AAAAAAAAAAAAAAAAA', make: 'Acura'),
          parked(id: 'toyota', vin: 'CCCCCCCCCCCCCCCCC', make: 'Toyota',
              model: 'Camry', year: '2019'),
          parked(id: 'honda2', vin: 'BBBBBBBBBBBBBBBBB'),
          parked(id: 'honda1', vin: '1HGCM82633A004352'),
        ],
        links,
        now: now,
      );
      expect(choices.map((c) => c.id), ['honda1', 'honda2', 'toyota', 'taken']);
    });
  });

  group('filterLotCarChoices', () {
    final choices = lotCarChoices(
      [
        parked(id: 'honda', vin: '1HGCM82633A004352', owner: 'Aissatou Diallo'),
        parked(id: 'toyota', vin: 'JT2BF22K1W0123456', make: 'Toyota',
            model: 'Camry', year: '2019', owner: 'Mamadou Bah'),
      ],
      const {},
      now: now,
    );

    test('blank shows everything', () {
      expect(filterLotCarChoices(choices, '').length, 2);
      expect(filterLotCarChoices(choices, '   ').length, 2);
    });

    test('matches a VIN fragment in any case', () {
      expect(filterLotCarChoices(choices, 'jt2bf').map((c) => c.id), ['toyota']);
      expect(filterLotCarChoices(choices, '4352').map((c) => c.id), ['honda']);
    });

    test('matches part of the owner name', () {
      expect(filterLotCarChoices(choices, 'mamadou').map((c) => c.id),
          ['toyota']);
      expect(filterLotCarChoices(choices, 'DIALLO').map((c) => c.id), ['honda']);
    });

    test('matches the make, model or year', () {
      expect(filterLotCarChoices(choices, 'toy').map((c) => c.id), ['toyota']);
      expect(filterLotCarChoices(choices, 'accord').map((c) => c.id), ['honda']);
      expect(filterLotCarChoices(choices, '2019').map((c) => c.id), ['toyota']);
    });

    test('nothing matches nonsense', () {
      expect(filterLotCarChoices(choices, 'zzz'), isEmpty);
    });
  });
}
