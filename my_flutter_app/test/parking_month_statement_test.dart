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
        'Sep 1, 2026 to Sep 30, 2026: 30 days × \$15.00 — \$450.00',
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
    expect(sow.registeredTo, ['abdoulaye sow', 'Ministre', 'Abdoulaye Sow']);
    expect(sow.dueCents, 35000);
    expect(mostUsedName(['Abd Sow', 'abdoulaye sow', 'Abdoulaye Sow']), 'Abdoulaye Sow');
    expect(
      parkingMonthCustomerText(sow, 'Keren Auto Sales'),
      [
        'Keren Auto Sales — Monthly bill, September 2026',
        'For: Abdoulaye Sow · 347-562-8973',
        '',
        'Parking',
        '2014 Toyota Corolla (registered to abdoulaye sow)',
        '  Sep 18, 2026 to Sep 30, 2026: 13 days × \$12.00 — \$156.00',
        '2015 Toyota RAV4 (registered to Ministre)',
        '  Sep 18, 2026 to Sep 30, 2026: 13 days × \$12.00 — \$156.00',
        '2017 Toyota RAV4 (registered to Abdoulaye Sow)',
        '  Sep 21, 2026 to Sep 24, 2026: 4 days × \$12.00 — \$48.00',
        '  Paid — -\$10.00',
        '',
        'Total for September — \$360.00',
        'Paid — -\$10.00',
        'BALANCE DUE: \$350.00',
      ].join('\n'),
    );
  });

  test('activities join the month: dated in it, older unpaid carried, void and free dropped', () {
    Map<String, dynamic> act(Map<String, dynamic> over) => {
          'businessId': 'k',
          'activityTypeLabel': 'title',
          'feeCents': 10000,
          'customerName': 'Abdoulaye Sow',
          'customerPhone': '3475628973',
          'carYear': '2013',
          'carMake': 'Toyota',
          'carModel': 'RAV4',
          'paymentStatus': 'awaiting_direct_payment',
          ...over,
        };
    final cars = [
      {
        'parkingDate': at('2026-09-18'), 'dailyRate': 12, 'paymentStatus': 'awaiting_direct_payment',
        'status': 'reserved', 'id': 'car', 'customerName': 'abdoulaye sow', 'customerPhone': '347-562-8973',
        'carYear': '2014', 'carMake': 'Toyota', 'carModel': 'Corolla',
      }
    ];
    final acts = [
      act({'id': 'sep', 'activityDate': at('2026-09-14'), 'amountPaidCents': 4000}),
      act({'id': 'aug', 'activityDate': at('2026-08-20'), 'feeCents': 9000}),
      act({'id': 'augPaid', 'activityDate': at('2026-08-02'), 'paymentStatus': 'succeeded'}),
      act({'id': 'void', 'activityDate': at('2026-09-15'), 'voided': true}),
      act({'id': 'free', 'activityDate': at('2026-09-16'), 'feeCents': 0}),
      act({'id': 'oct', 'activityDate': at('2026-10-01')}),
      act({'id': 'other', 'activityDate': at('2026-09-03'), 'customerName': 'Fatou', 'customerPhone': '6465550199', 'paymentStatus': 'succeeded'}),
    ];
    final s = parkingMonthSummary(cars, '2026-09', oct1, acts);
    final sow = s.customers.firstWhere((c) => c.customerName == 'Abdoulaye Sow');
    expect(sow.activities.map((a) => a.id).toList(), ['sep']);
    expect(sow.olderActivities.map((a) => a.id).toList(), ['aug']);
    expect(sow.dueCents, 15600 + 6000 + 9000);
    expect(s.billedCents, 15600 + 10000 + 10000);
    expect(s.collectedCents, 14000);
    expect(s.customersOwing.map((c) => c.customerName).toList(), ['Abdoulaye Sow']);
    expect(
      parkingMonthCustomerText(sow, 'Keren'),
      [
        'Keren — Monthly bill, September 2026',
        'For: Abdoulaye Sow · 347-562-8973',
        '',
        'Parking',
        '2014 Toyota Corolla (registered to abdoulaye sow)',
        '  Sep 18, 2026 to Sep 30, 2026: 13 days × \$12.00 — \$156.00',
        '',
        'Activities',
        'Sep 14, 2026 · Title · 2013 Toyota RAV4 (registered to Abdoulaye Sow) — \$100.00',
        '  Paid — -\$40.00',
        '',
        'Unpaid from before',
        'Aug 20, 2026 · Title · 2013 Toyota RAV4 (registered to Abdoulaye Sow) — \$90.00',
        '',
        'Total for September — \$256.00',
        'Unpaid from before — \$90.00',
        'Paid — -\$40.00',
        'BALANCE DUE: \$306.00',
      ].join('\n'),
    );
  });

  test('mark all paid: each line through its own payment; link cars skipped', () {
    Map<String, dynamic> car(Map<String, dynamic> over) => {
          'dailyRate': 12, 'status': 'reserved', 'customerName': 'Sow', 'customerPhone': '3475628973', ...over,
        };
    final cars = [
      car({'id': 'open', 'parkingDate': at('2026-09-18'), 'paymentStatus': 'awaiting_direct_payment', 'paymentMethod': 'direct', 'source': 'business', 'amountPaidCents': 6000, 'carYear': '2014', 'carMake': 'Toyota', 'carModel': 'Corolla'}),
      car({'id': 'link', 'parkingDate': at('2026-09-20'), 'paymentStatus': 'awaiting_payment_link', 'paymentMethod': 'payment_link', 'carYear': '2015', 'carMake': 'Toyota', 'carModel': 'RAV4'}),
      car({'id': 'paid', 'parkingDate': at('2026-09-01'), 'paymentStatus': 'paid', 'paymentMethod': 'direct'}),
    ];
    final acts = [
      {'id': 'sep', 'activityDate': at('2026-09-14'), 'feeCents': 10000, 'amountPaidCents': 4000, 'activityTypeLabel': 'title', 'customerName': 'Sow', 'customerPhone': '3475628973'},
      {'id': 'aug', 'activityDate': at('2026-08-20'), 'feeCents': 9000, 'activityTypeLabel': 'reassignment', 'customerName': 'Sow', 'customerPhone': '3475628973'},
    ];
    final plan = monthBillPaymentPlan(parkingMonthSummary(cars, '2026-09', oct1, acts).customers.first);
    expect(plan.items.map((x) => '${x.kind}:${x.id}:${x.amountCents}').toList(),
        ['car:open:9600', 'activity:sep:6000', 'activity:aug:9000']);
    expect(plan.items.skip(1).map((x) => x.label).toList(),
        ['Title (Sep 14, 2026)', 'Reassignment (Aug 20, 2026)']);
    expect(plan.skipped.map((x) => x.id).toList(), ['link']);
    expect(plan.totalCents, 24600);
  });

  test('an open stay mislabelled "nothing to collect" still owes its days', () {
    expect(parkingMonthStatement(diallo({'paymentStatus': 'not_required'}), '2026-09', oct1)!.dueCents, 45000);
    expect(parkingMonthStatement(diallo({'paymentStatus': 'not_required', 'dailyRate': 0}), '2026-09', oct1), isNull);
  });

  test('a day reads US style, the same as the server', () {
    expect(dayLabel('2026-09-01'), 'Sep 1, 2026');
    expect(dayLabel('2026-12-31'), 'Dec 31, 2026');
    expect(dayLabel(' 2027-01-09 '), 'Jan 9, 2027');
    expect(dayLabel('2026-13-01'), '2026-13-01');
    expect(dayLabel('2026-00-05'), '2026-00-05');
    // The server only checks the shape and the month; so does the phone.
    expect(dayLabel('2026-09-00'), 'Sep 0, 2026');
    expect(dayLabel('2026-02-30'), 'Feb 30, 2026');
    expect(dayLabel('2026-10-05T12:00:00'), 'Oct 5, 2026');
    expect(dayLabel('not a day'), 'not a day');
    expect(dayLabel(''), '');
  });

  // "Paid" at month end: billed for the month and nothing left owing - for
  // the month or carried in from before. Nothing billed is neither paid nor
  // owing. The same cases as the server's and the console's tests.
  group('who has paid for the month', () {
    final cars = [
      diallo({'id': 'unpaid'}),
      diallo({
        'id': 'paid', 'customerName': 'Barry', 'customerPhone': '6465550101',
        'amountPaidCents': 45000,
        'parkingPayments': [
          {'receivedVia': 'cash'},
          {'receivedVia': 'Zelle'},
        ],
      }),
      diallo({
        'id': 'part', 'customerName': 'Camara', 'customerPhone': '6465550102',
        'amountPaidCents': 20000,
        'parkingPayments': [
          {'receivedVia': 'cash'},
        ],
      }),
      diallo({
        'id': 'credit', 'customerName': 'Keita', 'customerPhone': '6465550103',
        'amountPaidCents': 60000, 'paymentMethod': 'direct',
        'directPaymentMethod': 'venmo',
      }),
      diallo({
        'id': 'link', 'customerName': 'Sylla', 'customerPhone': '6465550104',
        'paymentMethod': 'payment_link', 'paymentStatus': 'succeeded',
      }),
      diallo({
        'id': 'online', 'customerName': 'Bah', 'customerPhone': '6465550105',
        'paymentStatus': 'paid',
      }),
      diallo({
        'id': 'carried', 'customerName': 'Sow', 'customerPhone': '6465550106',
        'amountPaidCents': 45000,
        'parkingPayments': [
          {'receivedVia': 'cash'},
        ],
      }),
    ];
    Map<String, dynamic> act(Map<String, dynamic> over) => {
          'businessId': 'k',
          'activityTypeLabel': 'title',
          'feeCents': 10000,
          'paymentStatus': 'awaiting_direct_payment',
          ...over,
        };
    final acts = [
      act({
        'id': 'sowAug', 'activityDate': at('2026-08-20'), 'feeCents': 9000,
        'customerName': 'Sow', 'customerPhone': '6465550106',
      }),
      act({
        'id': 'fatou', 'activityDate': at('2026-09-03'), 'customerName': 'Fatou',
        'customerPhone': '6465550107', 'paymentStatus': 'succeeded',
        'paymentMethod': 'direct', 'receivedVia': 'cashapp',
      }),
      act({
        'id': 'diopAug', 'activityDate': at('2026-08-10'), 'feeCents': 5000,
        'customerName': 'Diop', 'customerPhone': '6465550108',
      }),
    ];
    final s = parkingMonthSummary(cars, '2026-09', oct1, acts);
    ParkingMonthCustomer by(String name) =>
        s.customers.firstWhere((c) => c.customerName == name);

    test('is billed and nothing left owing - one definition', () {
      expect(parkingMonthCustomerPaid(monthCents: 100, dueCents: 0), isTrue);
      expect(parkingMonthCustomerPaid(monthCents: 100, dueCents: 1), isFalse);
      expect(parkingMonthCustomerPaid(monthCents: 0, dueCents: 0), isFalse,
          reason: 'nothing billed is not paid');
    });

    test('splits the month into who owes, who paid, and everyone', () {
      expect(s.customersPaid.map((c) => c.customerName),
          ['Bah', 'Barry', 'Fatou', 'Keita', 'Sylla']);
      expect(s.customersOwing.map((c) => c.customerName),
          ['Diallo', 'Camara', 'Sow', 'Diop']);
      expect(s.customers, hasLength(9));
      for (final c in s.customers) {
        expect(c.paid,
            parkingMonthCustomerPaid(monthCents: c.monthCents, dueCents: c.dueCents));
        expect(c.paid && c.owes, isFalse, reason: '${c.customerName} is not both');
      }
    });

    test('fully paid shows what came in and how', () {
      expect(by('Barry').paid, isTrue);
      expect(by('Barry').owes, isFalse);
      expect(by('Barry').monthPaidCents, 45000);
      expect(by('Barry').paidVia, ['cash', 'zelle']);
      expect(by('Sylla').paidVia, ['card_link']);
      expect(by('Bah').paidVia, ['online']);
      expect(by('Fatou').paidVia, ['cashapp']);
    });

    test('partly paid still owes', () {
      expect(by('Camara').paid, isFalse);
      expect(by('Camara').owes, isTrue);
      expect(by('Camara').monthPaidCents, 20000);
      expect(by('Camara').dueCents, 25000);
      expect(by('Camara').paidVia, ['cash']);
      expect(by('Diallo').paidVia, isEmpty, reason: 'nothing paid, no method');
    });

    test('overpaid is paid, the month capped at its total', () {
      expect(by('Keita').paid, isTrue);
      expect(by('Keita').monthPaidCents, 45000);
      expect(by('Keita').dueCents, 0);
      expect(by('Keita').paidVia, ['venmo']);
    });

    test('the month paid but older still unpaid is not paid', () {
      expect(by('Sow').monthPaidCents, 45000);
      expect(by('Sow').priorUnpaidCents, 9000);
      expect(by('Sow').paid, isFalse);
      expect(by('Sow').owes, isTrue);
    });

    test('nothing billed for the month is neither', () {
      expect(by('Diop').monthCents, 0);
      expect(by('Diop').paid, isFalse);
      expect(by('Diop').owes, isTrue, reason: 'only the older unpaid job');
    });
  });
}
