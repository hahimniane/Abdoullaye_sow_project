import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/parking_month_statement.dart';

// The same cases as the server's and the console's tests, so the three
// copies agree on every number.
DateTime at(String iso) => DateTime.parse('${iso}T12:00:00Z');
final oct1 = DateTime.parse('2026-10-01T13:00:00Z');
Map<String, dynamic> diallo([Map<String, dynamic> over = const {}]) => {
      'id': 'f150',
      'customerName': 'Diallo',
      'carYear': '2024',
      'carMake': 'Ford',
      'carModel': 'F150',
      'vinNumber': '1ftfw1e50pfa63120',
      'parkingDate': at('2026-09-01'),
      'dailyRate': 15,
      'paymentStatus': 'awaiting_direct_payment',
      'status': 'reserved',
      ...over,
    };

void main() {
  test('that month\'s days at the rate', () {
    final b = parkingMonthStatement(diallo(), '2026-09', oct1)!;
    expect(b.days, 30);
    expect(b.monthCents, 45000);
    expect(b.dueCents, 45000);
    expect(b.stillParked, isTrue);
  });

  test('earlier months are their own line, paid oldest first', () {
    final since = diallo({'parkingDate': at('2026-08-22')});
    expect(parkingMonthStatement(since, '2026-09', oct1)!.priorUnpaidCents,
        15000);
    final part = parkingMonthStatement(
        {...since, 'amountPaidCents': 20000}, '2026-09', oct1)!;
    expect(part.priorUnpaidCents, 0);
    expect(part.monthPaidCents, 5000);
    expect(part.dueCents, 40000);
  });

  test('left mid-month, priced stays across months, and the exclusions', () {
    final left = diallo({
      'parkingDate': at('2026-09-05'),
      'parkingEndDate': at('2026-09-20'),
      'amountDueCents': 19200,
    });
    expect(parkingMonthStatement(left, '2026-09', oct1)!.days, 16);
    expect(parkingMonthStatement(left, '2026-10', oct1), isNull);
    final across = diallo({
      'parkingDate': at('2026-09-21'),
      'parkingEndDate': at('2026-10-10'),
      'amountDueCents': 24000,
    });
    expect(parkingMonthStatement(across, '2026-09', oct1)!.monthCents, 12000);
    expect(
        parkingMonthStatement(diallo({'paymentStatus': 'paid'}), '2026-09', oct1)!
            .owes,
        isFalse);
    expect(parkingMonthStatement(diallo({'status': 'cancelled'}), '2026-09', oct1),
        isNull);
  });

  test('the business\'s month adds up and lists who owes, biggest first', () {
    final s = parkingMonthSummary([
      diallo(),
      diallo({'id': 'rogue', 'customerName': 'Djibril', 'dailyRate': 10, 'amountPaidCents': 30000}),
      diallo({'id': 'corolla', 'customerName': 'Amadou', 'dailyRate': 12, 'amountPaidCents': 10000}),
      diallo({'id': 'gone', 'status': 'cancelled'}),
    ], '2026-09', oct1);
    expect(s.carsOnLot, 3);
    expect(s.carsOwing, 2);
    expect(s.billedCents, 111000);
    expect(s.collectedCents, 40000);
    expect(s.owedCents, 71000);
    expect(s.owing.map((b) => b.id).toList(), ['f150', 'corolla']);
  });

  test('months and the WhatsApp text, byte for byte with the server', () {
    expect(previousParkingMonthKey(oct1), '2026-09');
    expect(shiftParkingMonthKey('2026-01', -1), '2025-12');
    final since =
        diallo({'parkingDate': at('2026-08-22'), 'amountPaidCents': 20000});
    expect(
      parkingMonthBillText(
          parkingMonthStatement(since, '2026-09', oct1)!, 'Keren Auto Sales'),
      [
        'Keren Auto Sales — Parking bill, September 2026',
        'For: Diallo',
        '2024 Ford F150 · VIN 1FTFW1E50PFA63120',
        '',
        '2026-09-01 to 2026-09-30: 30 days × \$15.00 — \$450.00',
        'Paid — -\$50.00',
        'BALANCE DUE: \$400.00',
      ].join('\n'),
    );
  });

  test('one bill per phone, every car with its dates; mirrors the server', () {
    Map<String, dynamic> car(Map<String, dynamic> over) => {
          'parkingDate': at('2026-09-18'),
          'dailyRate': 12,
          'paymentStatus': 'awaiting_direct_payment',
          'status': 'reserved',
          ...over,
        };
    final rows = [
      car({'id': 'a', 'customerName': 'abdoulaye sow', 'customerPhone': '347-562-8973', 'carYear': '2014', 'carMake': 'Toyota', 'carModel': 'Corolla'}),
      car({'id': 'b', 'customerName': 'Abdoulaye Sow', 'customerPhone': '+1 (347) 562 8973', 'parkingDate': at('2026-09-21'), 'parkingEndDate': at('2026-09-24'), 'amountDueCents': 4800, 'carYear': '2017', 'carMake': 'Toyota', 'carModel': 'RAV4', 'amountPaidCents': 1000}),
      car({'id': 'c', 'customerName': 'Ministre', 'customerPhone': '3475628973', 'carYear': '2015', 'carMake': 'Toyota', 'carModel': 'RAV4'}),
      diallo({'customerPhone': '6465550000'}),
    ];
    final s = parkingMonthSummary(rows, '2026-09', oct1);
    expect(s.customers.length, 2);
    expect(s.customersOwing.map((c) => c.customerName).toList(), ['Diallo', 'Abdoulaye Sow']);
    final sow = s.customers.firstWhere((c) => c.cars.length == 3);
    expect(sow.registeredTo, ['', 'Ministre', '']);
    expect(sow.dueCents, 35000);
    expect(mostUsedName(['Abd Sow', 'abdoulaye sow', 'Abdoulaye Sow']), 'Abdoulaye Sow');
    expect(
      parkingMonthCustomerText(sow, 'Keren Auto Sales'),
      [
        'Keren Auto Sales — Parking bill, September 2026',
        'For: Abdoulaye Sow · 347-562-8973',
        '',
        '2014 Toyota Corolla',
        '  2026-09-18 to 2026-09-30: 13 days × \$12.00 — \$156.00',
        '2015 Toyota RAV4 (registered to Ministre)',
        '  2026-09-18 to 2026-09-30: 13 days × \$12.00 — \$156.00',
        '2017 Toyota RAV4',
        '  2026-09-21 to 2026-09-24: 4 days × \$12.00 — \$48.00',
        '',
        'Total for September — \$360.00',
        'Paid — -\$10.00',
        'BALANCE DUE: \$350.00',
      ].join('\n'),
    );
  });
}
