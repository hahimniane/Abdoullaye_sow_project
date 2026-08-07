import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/business_parking_entry.dart';

/// Finding one car among a lot's records.
///
/// The console searches, narrows by where the car is in its stay, and says so
/// when a filter is what emptied the list. The app did none of the three: the
/// only way to find a windscreen slip's tracking code was to scroll, and an
/// empty list said "no records yet" whether the lot had none or had simply
/// asked for something no car matched.

Map<String, dynamic> car({
  String trackingCode = 'PK-1042',
  String ownerName = 'Mariama Diallo',
  String customerName = '',
  String carMake = 'Toyota',
  String carModel = 'Camry',
  String carYear = '2019',
  String vinNumber = '1HGCM82633A004352',
  String status = 'active',
}) => <String, dynamic>{
  'trackingCode': trackingCode,
  'ownerName': ownerName,
  'customerName': customerName,
  'carMake': carMake,
  'carModel': carModel,
  'carYear': carYear,
  'vinNumber': vinNumber,
  'status': status,
};

void main() {
  group('businessParkingMatchesSearch', () {
    test('an empty query narrows nothing', () {
      expect(businessParkingMatchesSearch(car(), ''), isTrue);
      expect(businessParkingMatchesSearch(car(), '   '), isTrue);
    });

    test('it finds a car by its tracking code, whatever the case', () {
      expect(businessParkingMatchesSearch(car(), 'pk-1042'), isTrue);
      expect(businessParkingMatchesSearch(car(), 'PK-1042'), isTrue);
      expect(businessParkingMatchesSearch(car(), '1042'), isTrue);
    });

    test('it finds a car by owner, make, model, year, VIN and status', () {
      expect(businessParkingMatchesSearch(car(), 'mariama'), isTrue);
      expect(businessParkingMatchesSearch(car(), 'toyota'), isTrue);
      expect(businessParkingMatchesSearch(car(), 'camry'), isTrue);
      expect(businessParkingMatchesSearch(car(), '2019'), isTrue);
      expect(businessParkingMatchesSearch(car(), '004352'), isTrue);
      expect(businessParkingMatchesSearch(car(), 'active'), isTrue);
    });

    test('a walk-up is found by the customer name the callable stored', () {
      // A business-entered record carries customerName; a customer's own
      // booking carries ownerName. Both are searched, as on the console.
      expect(
        businessParkingMatchesSearch(
          car(ownerName: '', customerName: 'Ibrahima Sow'),
          'ibrahima',
        ),
        isTrue,
      );
    });

    test('a query may run across two adjacent fields', () {
      // The console joins the searchable fields with a space before matching,
      // so "toyota camry" finds a car whose make and model are two fields.
      expect(businessParkingMatchesSearch(car(), 'toyota camry'), isTrue);
    });

    test('a query nothing holds finds nothing', () {
      expect(businessParkingMatchesSearch(car(), 'peugeot'), isFalse);
    });
  });

  group('businessParkingMatchesStatusFilter', () {
    test('"all" is "do not narrow", not a status', () {
      expect(
        businessParkingMatchesStatusFilter(car(status: 'cancelled'), 'all'),
        isTrue,
      );
      expect(businessParkingMatchesStatusFilter(car(), ''), isTrue);
    });

    test('a narrowing keeps only that status', () {
      expect(businessParkingMatchesStatusFilter(car(), 'active'), isTrue);
      expect(businessParkingMatchesStatusFilter(car(), 'completed'), isFalse);
      expect(
        businessParkingMatchesStatusFilter(
          car(status: 'completed'),
          'completed',
        ),
        isTrue,
      );
      expect(
        businessParkingMatchesStatusFilter(
          car(status: 'cancelled'),
          'cancelled',
        ),
        isTrue,
      );
    });

    test('a record with no status recorded matches no narrowing', () {
      // Mirrors the console's `text(row.status, "") === filter`.
      expect(
        businessParkingMatchesStatusFilter(<String, dynamic>{}, 'active'),
        isFalse,
      );
      expect(
        businessParkingMatchesStatusFilter(<String, dynamic>{}, 'all'),
        isTrue,
      );
    });
  });

  group('businessParkingListIsNarrowed', () {
    test('nothing asked for is not a narrowing', () {
      expect(businessParkingListIsNarrowed(), isFalse);
      expect(
        businessParkingListIsNarrowed(
          search: '  ',
          statusFilter: businessParkingStatusFilterAll,
        ),
        isFalse,
      );
    });

    test('any one control alone counts', () {
      expect(businessParkingListIsNarrowed(search: 'pk'), isTrue);
      expect(businessParkingListIsNarrowed(statusFilter: 'completed'), isTrue);
      expect(
        businessParkingListIsNarrowed(
          paymentFilter: BusinessParkingPaymentFilter.notPaid,
        ),
        isTrue,
      );
      expect(
        businessParkingListIsNarrowed(from: DateTime(2026, 8, 1)),
        isTrue,
      );
      expect(businessParkingListIsNarrowed(to: DateTime(2026, 8, 9)), isTrue);
    });
  });

  group('the list screen spends the decisions it is given', () {
    final source = File('lib/screens/home_menu.dart').readAsStringSync();

    test('the parked-car list is searched and narrowed by status', () {
      expect(source, contains('businessParkingMatchesSearch('));
      expect(source, contains('businessParkingMatchesStatusFilter('));
      expect(source, contains("Key('parking-search')"));
      expect(source, contains("Key('parking-status-filter')"));
      expect(source, contains('l10n.searchParkedCars'));
    });

    test('an empty list says which kind of empty it is', () {
      expect(source, contains('businessParkingListIsNarrowed('));
      expect(source, contains('l10n.noParkingRecordsMatchFilter'));
      expect(source, contains('l10n.noRecordsYet'));
    });

    test('leaving parking clears the new narrowings with the old ones', () {
      // An invisible filter reads as missing records.
      final handler = source.substring(
        source.indexOf('onCategoryChanged: (category) {'),
        source.indexOf('onPaymentFilterChanged: (filter) {'),
      );
      expect(handler, contains('_parkingStatusFilter = businessParkingStatusFilterAll'));
      expect(handler, contains("_parkingSearch = ''"));
      expect(handler, contains('_parkedFrom = null'));
    });

    test('the search controller is disposed', () {
      final dispose = source.substring(
        source.indexOf('void dispose() {'),
        source.indexOf('Widget build(BuildContext context) {'),
      );
      expect(dispose, contains('_parkingSearchController.dispose()'));
    });
  });
}
