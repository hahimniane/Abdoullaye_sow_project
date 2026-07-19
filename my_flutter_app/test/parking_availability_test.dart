import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/models/parking_availability.dart';

void main() {
  group('parking availability', () {
    test(
      'subtracts only overlapping active reservations and blocked spaces',
      () {
        final requested = ParkingDateRange(
          start: DateTime(2026, 7, 1),
          end: DateTime(2026, 7, 10),
        );
        final reservations = [
          ParkingReservationWindow(
            businessId: 'business-a',
            range: ParkingDateRange(
              start: DateTime(2026, 6, 28),
              end: DateTime(2026, 7, 2),
            ),
            status: 'reserved',
          ),
          ParkingReservationWindow(
            businessId: 'business-a',
            range: ParkingDateRange(
              start: DateTime(2026, 7, 8),
              end: DateTime(2026, 7, 12),
            ),
            status: 'parked',
          ),
          ParkingReservationWindow(
            businessId: 'business-a',
            range: ParkingDateRange(
              start: DateTime(2026, 8, 1),
              end: DateTime(2026, 8, 4),
            ),
            status: 'reserved',
          ),
          ParkingReservationWindow(
            businessId: 'business-a',
            range: ParkingDateRange(
              start: DateTime(2026, 7, 3),
              end: DateTime(2026, 7, 5),
            ),
            status: 'cancelled',
          ),
        ];

        expect(
          availableParkingSpots(
            totalSpaces: 10,
            blockedSpaces: 2,
            requestedRange: requested,
            reservations: reservations,
          ),
          6,
        );
      },
    );

    test('never returns negative availability', () {
      final requested = ParkingDateRange(
        start: DateTime(2026, 7, 1),
        end: DateTime(2026, 7, 2),
      );

      expect(
        availableParkingSpots(
          totalSpaces: 1,
          blockedSpaces: 2,
          requestedRange: requested,
          reservations: const [],
        ),
        0,
      );
    });
  });

  group('parking pricing', () {
    test('uses monthly weekly and daily rates for estimates', () {
      const pricing = ParkingPricing(
        dailyRate: 15,
        weeklyRate: 90,
        monthlyRate: 300,
        pickupFee: 40,
      );
      final range = ParkingDateRange(
        start: DateTime(2026, 7, 1, 9),
        end: DateTime(2026, 8, 10, 9),
      );

      expect(pricing.estimate(range, pickupRequested: true), 475);
    });
  });

  group('parking option parsing', () {
    test('parses optional distance from function data', () {
      final option = ParkingBusinessOption.fromFunctionData({
        'businessId': 'business-a',
        'businessName': 'Abdoullaye Parking',
        'city': 'New York',
        'address': '12 Port Road',
        'totalSpaces': 10,
        'blockedSpaces': 1,
        'availableSpaces': 5,
        'dailyRate': 15,
        'weeklyRate': 90,
        'monthlyRate': 300,
        'pickupFee': 40,
        'estimatedTotal': 180,
        'minimumDays': 2,
        'pickupAvailable': true,
        'instructions': 'Call before drop off.',
        'distanceMiles': 3.25,
      });

      expect(option.distanceMiles, 3.25);
      expect(option.hasAvailability, isTrue);
    });
  });
}
