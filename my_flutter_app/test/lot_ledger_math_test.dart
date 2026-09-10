import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/lot_ledger.dart';

LotActivity activity({
  String id = 'a',
  String typeId = 't1',
  int feeCents = 10000,
  String month = '2026-09',
  String status = lotStatusSucceeded,
  String method = lotPaymentMethodDirect,
  bool voided = false,
  String customer = 'Aissatou',
  String vin = 'VIN1',
  String phone = '',
}) {
  return LotActivity.fromMap(id, {
    'activityTypeId': typeId,
    'activityTypeLabel': 'Dispatch',
    'feeCents': feeCents,
    'customerName': customer,
    'customerPhone': phone,
    'vinNumber': vin,
    'paymentMethod': method,
    'paymentStatus': status,
    'activityDateMonth': month,
    'voided': voided,
  });
}

LotExpenseLine line({
  String id = 'l1',
  String label = 'Rent',
  String kind = lotExpenseKindMetered,
  int recurringCents = 0,
  bool active = true,
  DateTime? createdAt,
}) {
  return LotExpenseLine.fromMap(id, {
    'label': label,
    'kind': kind,
    'recurringCents': recurringCents,
    'active': active,
    'createdAt': createdAt,
  });
}

LotExpenseEntry entry({
  String id = 'e1',
  String lineId = 'l1',
  String month = '2026-09',
  int amountCents = 5000,
  bool voided = false,
}) {
  return LotExpenseEntry.fromMap(id, {
    'lineId': lineId,
    'month': month,
    'amountCents': amountCents,
    'voided': voided,
  });
}

void main() {
  group('money in, money out', () {
    test('revenue counts live entries and ignores voided and cancelled ones',
        () {
      final math = LotLedgerMath(
        activities: [
          activity(id: 'a', feeCents: 12000),
          activity(id: 'b', feeCents: 3000, voided: true),
          activity(id: 'c', feeCents: 4000, status: lotStatusCancelled),
          activity(id: 'd', feeCents: 1000, month: '2026-08'),
        ],
        lines: const [],
        entries: const [],
      );
      expect(math.monthRevenueCents('2026-09'), 12000);
      expect(math.monthRevenueCents('2026-08'), 1000);
    });

    test('a link that has not settled is owed, not earned', () {
      final math = LotLedgerMath(
        activities: [
          activity(
            id: 'a',
            feeCents: 9000,
            method: lotPaymentMethodLink,
            status: lotStatusAwaitingLink,
          ),
          activity(id: 'b', feeCents: 1000),
        ],
        lines: const [],
        entries: const [],
      );
      expect(math.monthAwaitingCents('2026-09'), 9000);
      // It is still revenue booked for the month; it simply has not arrived.
      expect(math.monthRevenueCents('2026-09'), 10000);
    });
  });

  group('which month an expense lands in', () {
    test('the bill month it was logged against wins over the day it was bought',
        () {
      final e = LotExpenseEntry.fromMap('e', {
        'lineId': 'l1',
        'month': '2026-08',
        'amountCents': 2500,
        'spentAt': DateTime(2026, 9, 3),
      });
      expect(e.month, '2026-08');
    });

    test('with no bill month it falls back to the day it was bought', () {
      final e = LotExpenseEntry.fromMap('e', {
        'lineId': 'l1',
        'amountCents': 2500,
        'spentAt': DateTime(2026, 9, 3),
      });
      expect(e.month, '2026-09');
    });
  });

  group('a fixed line and the purchases logged against it', () {
    test('a logged purchase replaces the standing amount, never adds to it',
        () {
      final math = LotLedgerMath(
        nowMonth: '2026-09',
        activities: const [],
        lines: [line(kind: lotExpenseKindFixed, recurringCents: 200000)],
        entries: [entry(amountCents: 180000)],
      );
      expect(math.monthExpenseCents('2026-09'), 180000);
    });

    test('with nothing logged, the standing amount is what the month cost', () {
      final math = LotLedgerMath(
        nowMonth: '2026-09',
        activities: const [],
        lines: [line(kind: lotExpenseKindFixed, recurringCents: 200000)],
        entries: const [],
      );
      expect(math.monthExpenseCents('2026-09'), 200000);
    });

    test('a voided purchase neither counts nor suppresses the standing amount',
        () {
      final math = LotLedgerMath(
        nowMonth: '2026-09',
        activities: const [],
        lines: [line(kind: lotExpenseKindFixed, recurringCents: 200000)],
        entries: [entry(amountCents: 180000, voided: true)],
      );
      expect(math.monthExpenseCents('2026-09'), 200000);
    });

    test('an inactive fixed line stops costing anything', () {
      final math = LotLedgerMath(
        nowMonth: '2026-09',
        activities: const [],
        lines: [
          line(kind: lotExpenseKindFixed, recurringCents: 200000, active: false),
        ],
        entries: const [],
      );
      expect(math.monthExpenseCents('2026-09'), 0);
    });

    test('a metered line costs exactly what was logged', () {
      final math = LotLedgerMath(
        activities: const [],
        lines: [line()],
        entries: [
          entry(id: 'e1', amountCents: 1200),
          entry(id: 'e2', amountCents: 800),
          entry(id: 'e3', amountCents: 500, month: '2026-08'),
        ],
      );
      expect(math.lineMonthCents(line(), '2026-09'), 2000);
      expect(math.monthExpenseCents('2026-09'), 2000);
    });
  });

  test('net and margin read off the same two numbers', () {
    final math = LotLedgerMath(
      nowMonth: '2026-09',
      activities: [activity(feeCents: 100000)],
      lines: [line(kind: lotExpenseKindFixed, recurringCents: 40000)],
      entries: const [],
    );
    expect(math.monthNetCents('2026-09'), 60000);
    expect(lotMarginPercent(100000, 60000), 60);
    expect(lotMarginPercent(0, 0), isNull);
  });

  group('a standing charge is owed only while the line exists', () {
    LotLedgerMath withRent({String now = '2026-09'}) => LotLedgerMath(
          nowMonth: now,
          activities: const [],
          lines: [
            line(
              id: 'rent',
              kind: lotExpenseKindFixed,
              recurringCents: 200000,
              createdAt: DateTime(2026, 9, 4),
            ),
          ],
          entries: const [],
        );

    test('not charged to months before the line was set up', () {
      expect(withRent().monthExpenseCents('2026-08'), 0);
      expect(withRent().monthExpenseCents('2026-01'), 0);
    });

    test('charged to the month it was set up in', () {
      expect(withRent().monthExpenseCents('2026-09'), 200000);
    });

    test('not charged to a month that has not happened yet', () {
      expect(withRent().monthExpenseCents('2026-10'), 0);
      expect(withRent().monthExpenseCents('2026-12'), 0);
    });

    test('the year totals only the months it was actually owed', () {
      // The bug this replaced billed a whole calendar year the moment a line
      // was created: one month of rent read as twelve.
      expect(withRent().yearExpenseCents(2026), 200000);
      expect(withRent(now: '2026-11').yearExpenseCents(2026), 200000 * 3);
    });

    test('a line with no creation date keeps its old open-ended behaviour', () {
      final math = LotLedgerMath(
        nowMonth: '2026-09',
        activities: const [],
        lines: [line(kind: lotExpenseKindFixed, recurringCents: 1000)],
        entries: const [],
      );
      expect(math.monthExpenseCents('2026-01'), 1000);
      expect(math.monthExpenseCents('2026-10'), 0);
    });
  });

  group('which expense costs the most', () {
    LotLedgerMath sandbox() => LotLedgerMath(
          nowMonth: '2026-09',
          activities: const [],
          lines: [
            line(
              id: 'rent',
              label: 'Rent',
              kind: lotExpenseKindFixed,
              recurringCents: 200000,
              createdAt: DateTime(2026, 9, 4),
            ),
            line(id: 'water', label: 'Water', createdAt: DateTime(2026, 9, 4)),
            line(id: 'moving', label: 'moving', createdAt: DateTime(2026, 9, 4)),
          ],
          entries: [
            entry(id: 'e1', lineId: 'water', amountCents: 6000),
            entry(id: 'e2', lineId: 'water', amountCents: 2000),
            entry(id: 'e3', lineId: 'moving', amountCents: 1234),
          ],
        );

    test('lines rank by what they actually cost', () {
      final ranked = sandbox().expenseByLine(2026);
      expect(ranked.map((s) => s.label), ['Rent', 'Water', 'moving']);
      expect(ranked.map((s) => s.cents), [200000, 8000, 1234]);
    });

    test('the parts add up to the total they sit under', () {
      final math = sandbox();
      final parts = math.expenseByLine(2026).fold(0, (a, s) => a + s.cents);
      expect(parts, math.yearExpenseCents(2026));
      expect(parts, 209234);
    });

    test('a voided purchase drops out of the breakdown too', () {
      final math = LotLedgerMath(
        nowMonth: '2026-09',
        activities: const [],
        lines: [line(id: 'water', label: 'Water')],
        entries: [
          entry(id: 'e1', lineId: 'water', amountCents: 6000),
          entry(id: 'e2', lineId: 'water', amountCents: 9900, voided: true),
        ],
      );
      expect(math.expenseByLine(2026).single.cents, 6000);
    });

    test('a purchase against a line that is gone still counts, unnamed', () {
      final math = LotLedgerMath(
        nowMonth: '2026-09',
        activities: const [],
        lines: const [],
        entries: [entry(id: 'e1', lineId: 'deleted', amountCents: 4200)],
      );
      final ranked = math.expenseByLine(2026);
      expect(ranked.single.cents, 4200);
      expect(ranked.single.label, isEmpty);
      expect(math.yearExpenseCents(2026), 4200);
    });

    test('nothing spent means nothing to rank', () {
      final math = LotLedgerMath(
        nowMonth: '2026-09',
        activities: const [],
        lines: const [],
        entries: const [],
      );
      expect(math.expenseByLine(2026), isEmpty);
    });
  });

  group('a VIN the yard already knows', () {
    final cars = [
      const LotKnownCar(vin: 'JH4KA8', make: '', model: '', year: ''),
      const LotKnownCar(
        vin: 'JH4KA8',
        make: 'Toyota',
        model: 'Camry',
        year: '2021',
        customerName: 'Mariama',
        customerPhone: '2015550100',
      ),
      const LotKnownCar(
        vin: 'WBA334',
        make: 'BMW',
        model: '330i',
        year: '2019',
      ),
    ];

    test('a VIN returns the record that actually names the car', () {
      final found = lotFindKnownCar('JH4KA8', cars);
      expect(found?.make, 'Toyota');
      expect(found?.customerName, 'Mariama');
    });

    test('matching ignores case and stray spacing', () {
      expect(lotFindKnownCar('  wba334 ', cars)?.model, '330i');
    });

    test('a VIN nobody has seen returns nothing to fill from', () {
      expect(lotFindKnownCar('ZZZZZZ9', cars), isNull);
    });

    test('too few characters is not a match attempt', () {
      // Five characters would collide across unrelated vehicles.
      expect(lotFindKnownCar('JH4KA', cars), isNull);
    });

    test('a record with only a VIN is not treated as a vehicle', () {
      const bare = LotKnownCar(vin: 'ABC123', make: '', model: '', year: '');
      expect(bare.hasVehicle, isFalse);
      expect(lotFindKnownCar('ABC123', [bare])?.hasVehicle, isFalse);
    });
  });

  group('finding an entry', () {
    final rows = [
      activity(id: 'a', vin: 'JH4KA', customer: 'Mariama', month: '2026-09'),
      activity(id: 'b', vin: 'WBA33', customer: 'Ousmane', month: '2026-08'),
      activity(id: 'c', typeId: lotCustomActivityId, month: '2026-09'),
    ];

    test('with no search it stays inside the month on screen', () {
      final found = lotFilterActivities(rows,
          month: '2026-09', typeFilter: 'all', query: '');
      expect(found.map((a) => a.id), ['a', 'c']);
    });

    test('a search reaches across months, because you are looking for one car',
        () {
      final found = lotFilterActivities(rows,
          month: '2026-09', typeFilter: 'all', query: 'wba');
      expect(found.map((a) => a.id), ['b']);
    });

    test('the one-off filter catches exactly the one-offs', () {
      final found = lotFilterActivities(rows,
          month: '2026-09', typeFilter: lotCustomActivityId, query: '');
      expect(found.map((a) => a.id), ['c']);
    });
  });

  group('what the form refuses before asking the server', () {
    LotActivityDraft draft({
      String typeId = 't1',
      String custom = '',
      int? fee = 1000,
      String name = 'Aissatou',
      String vin = 'VIN123',
      String method = lotPaymentMethodLink,
      String phone = '2015550100',
      String email = '',
      String receivedBy = '',
    }) {
      return LotActivityDraft(
        activityTypeId: typeId,
        customLabel: custom,
        feeCents: fee,
        customerName: name,
        vinNumber: vin,
        paymentMethod: method,
        customerPhone: phone,
        customerEmail: email,
        receivedByStaffId: receivedBy,
      );
    }

    test('a complete link entry passes', () {
      expect(validateLotActivityDraft(draft(), lockedPayment: false), isEmpty);
    });

    test('a link with no way to reach the customer is refused', () {
      expect(
        validateLotActivityDraft(draft(phone: '', email: ''),
            lockedPayment: false),
        contains('payment_link_contact_required'),
      );
    });

    test('money taken by hand has to name who took it', () {
      expect(
        validateLotActivityDraft(
            draft(method: lotPaymentMethodDirect, receivedBy: ''),
            lockedPayment: false),
        contains('received_by_required'),
      );
    });

    test('a one-off has to say what was done', () {
      expect(
        validateLotActivityDraft(draft(typeId: lotCustomActivityId),
            lockedPayment: false),
        contains('custom_label_required'),
      );
    });

    test('a settled entry stops being asked about its payment route', () {
      // The server refuses to change it, so the form must not demand it back.
      expect(
        validateLotActivityDraft(
            draft(method: lotPaymentMethodDirect, receivedBy: ''),
            lockedPayment: true),
        isEmpty,
      );
    });

    test('a purchase asks for a receipt only at the threshold and above', () {
      expect(
        validateLotExpenseDraft(
            amountCents: 7400,
            paidByStaffId: 'staff',
            hasProof: false,
            thresholdCents: 7500),
        isEmpty,
      );
      expect(
        validateLotExpenseDraft(
            amountCents: 7500,
            paidByStaffId: 'staff',
            hasProof: false,
            thresholdCents: 7500),
        contains('expense_proof_required'),
      );
      // A threshold of zero means a receipt is never demanded.
      expect(
        validateLotExpenseDraft(
            amountCents: 999999,
            paidByStaffId: 'staff',
            hasProof: false,
            thresholdCents: 0),
        isEmpty,
      );
    });
  });

  group('money and months as typed and shown', () {
    test('dollars as people type them become cents', () {
      expect(lotDollarsToCents('12'), 1200);
      expect(lotDollarsToCents('12.50'), 1250);
      expect(lotDollarsToCents(r'$1,200.00'), 120000);
      expect(lotDollarsToCents(''), isNull);
      expect(lotDollarsToCents('abc'), isNull);
    });

    test('a negative total keeps its sign in front', () {
      expect(formatLotCents(-2500).startsWith('-'), isTrue);
    });

    test('stepping across a year boundary lands on the right month', () {
      expect(lotShiftMonth('2026-01', -1), '2025-12');
      expect(lotShiftMonth('2026-12', 1), '2027-01');
      expect(lotYearMonths(2026).first, '2026-01');
      expect(lotYearMonths(2026).last, '2026-12');
    });

    test('a date is frozen at midday so no timezone can roll it back a day',
        () {
      expect(lotMiddayIso(DateTime(2026, 9, 9)), '2026-09-09T12:00:00');
    });
  });
}
