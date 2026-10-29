import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/business_parking_entry.dart';
import 'package:my_flutter_app/services/business_service_overview.dart'
    show businessParkingUnpaidCount;
import 'package:my_flutter_app/services/container_lot_cars.dart';
import 'package:my_flutter_app/services/known_car_lookup.dart';
import 'package:my_flutter_app/services/lot_ledger.dart';
import 'package:my_flutter_app/services/parking_month_statement.dart';

// A voided parked car or expense line stays on the record but reads, in every
// figure, as though it had been removed. These are the same rules the server
// (`parking_month_statement.js`, `console_summaries.js`) and the console
// (`parking-month-statement.ts`) apply.

DateTime at(String iso) => DateTime.parse('${iso}T12:00:00Z');
final oct1 = DateTime.parse('2026-10-01T13:00:00Z');

Map<String, dynamic> car([Map<String, dynamic> over = const {}]) => {
  'id': 'f150',
  'source': 'business',
  'customerName': 'Diallo',
  'vinNumber': '1FTFW1E50PFA63120',
  'parkingDate': at('2026-09-01'),
  'dailyRate': 15,
  'paymentMethod': 'direct',
  'paymentStatus': 'awaiting_direct_payment',
  'status': 'reserved',
  ...over,
};

Map<String, dynamic> voided([Map<String, dynamic> over = const {}]) => car({
  'id': 'dup',
  'voided': true,
  'voidReason': 'Entered twice',
  'voidedByStaffId': 'staff-1',
  ...over,
});

void main() {
  group('a voided parked car', () {
    test('has no month-end bill, like a cancelled one', () {
      expect(parkingMonthStatement(car(), '2026-09', oct1), isNotNull);
      expect(parkingMonthStatement(voided(), '2026-09', oct1), isNull);
    });

    test('drops out of the month summary entirely', () {
      final withVoid = parkingMonthSummary(
        [
          car(),
          voided({'amountPaidCents': 20000}),
        ],
        '2026-09',
        oct1,
      );
      final without = parkingMonthSummary([car()], '2026-09', oct1);
      expect(withVoid.carsOnLot, without.carsOnLot);
      expect(withVoid.billedCents, without.billedCents);
      expect(withVoid.collectedCents, without.collectedCents);
      expect(withVoid.owedCents, without.owedCents);
    });

    test('counts in no total - money it once took included', () {
      final totals = businessParkingTotals([
        car(),
        voided({'paymentStatus': 'paid', 'amountPaidCents': 30000}),
      ], now: oct1);
      final alone = businessParkingTotals([car()], now: oct1);
      expect(totals.inLot, alone.inLot);
      expect(totals.left, alone.left);
      expect(totals.collected, alone.collected);
      expect(totals.owed, alone.owed);
      expect(totals.spacesUsed, alone.spacesUsed);
    });

    test('is never overdue and owes nothing', () {
      final ended = voided({'parkingEndDate': at('2026-09-10')});
      expect(businessParkingBalance(ended, now: oct1), 0);
      expect(businessParkingOverdue([ended], now: oct1).count, 0);
    });

    test('puts no money on the month-by-month chart', () {
      final paid = voided({
        'paymentStatus': 'paid',
        'amountPaidCents': 30000,
        'paidAt': at('2026-09-15'),
      });
      expect(businessParkingCollectedByMonth([paid], ['2026-09']), [0]);
    });

    test('is its own kind, holds no space and is no car to load', () {
      expect(parkingRowKind(voided(), now: oct1), ParkingKind.voided);
      expect(parkedCarIsInLot(voided(), now: oct1), isFalse);
      expect(parkedCarIsInLot(car(), now: oct1), isTrue);
    });

    test('offers no edit, payment, close, link or second void', () {
      final row = voided({
        'checkoutUrl': 'https://pay.example/x',
        'paymentMethod': 'direct',
      });
      expect(canVoidBusinessParking(car()), isTrue);
      expect(canVoidBusinessParking(row), isFalse);
      expect(canMarkBusinessParkingPaid(row), isFalse);
      expect(canPartPayBusinessParking(row), isFalse);
      expect(canCloseBusinessParkingStay(row), isFalse);
      expect(canBillBusinessParkingThroughToday(row, now: oct1), isFalse);
      expect(canRecordBusinessParkingPaymentReceived(row), isFalse);
      expect(canCancelBusinessParkingPaymentLink(row), isFalse);
      expect(businessParkingPaymentTone(row), BusinessParkingPaymentTone.none);
    });

    test('is not counted on the home tile as unpaid', () {
      expect(businessParkingUnpaidCount([car(), voided()]), 1);
    });

    test('is not suggested as a known car', () {
      expect(knownCarsFromRows([car(), voided()]).length, 1);
    });

    test('reads the server refusals it knows', () {
      expect(
        businessParkingVoidRefusal({'reason': 'car_voided'}),
        'car_voided',
      );
      expect(
        businessParkingVoidRefusal({'reason': 'car_not_found'}),
        'car_not_found',
      );
      expect(businessParkingVoidRefusal({'reason': 'paid'}), '');
      expect(businessParkingVoidRefusal(null), '');
    });
  });

  group('a voided expense line', () {
    LotExpenseLine line(String id, {bool voided = false}) =>
        LotExpenseLine.fromMap(id, {
          'label': 'Royal Waste',
          'kind': lotExpenseKindFixed,
          'recurringCents': 2000,
          'active': !voided,
          'createdAt': DateTime(2026, 1, 1),
          if (voided) 'voided': true,
          if (voided) 'voidReason': 'Test line',
          if (voided) 'voidedByStaffId': 'owner',
        });

    test('reads its void fields', () {
      final l = line('x', voided: true);
      expect(l.voided, isTrue);
      expect(l.live, isFalse);
      expect(l.voidReason, 'Test line');
      expect(l.voidedByStaffId, 'owner');
      expect(line('y').live, isTrue);
    });

    test('adds nothing to any month, even if it stayed switched on', () {
      final stillOn = LotExpenseLine.fromMap('z', {
        'kind': lotExpenseKindFixed,
        'recurringCents': 2000,
        'createdAt': DateTime(2026, 1, 1),
        'voided': true,
      });
      final math = LotLedgerMath(
        activities: const [],
        lines: [line('live'), stillOn],
        entries: const [],
        parkedCarRows: const [],
        nowMonth: '2026-10',
      );
      for (final month in ['2026-01', '2026-06', '2026-10']) {
        expect(math.monthExpenseCents(month), 2000, reason: month);
      }
      expect(math.fixedLineAppliesTo(stillOn, '2026-06'), isFalse);
      expect(math.expenseByLine(2026).map((s) => s.lineId), ['live']);
    });
  });
}
