import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/staff_expense_credit.dart';

/// The app's mirror of `functions/staff_expense_credit.js`. The server, the
/// console and the app each run every case of the shared fixture
/// (`functions/test/fixtures/staff-expense-credit-cases.json`) and must
/// produce exactly its `expect` - so a rule changed in one place and not the
/// others fails here.
void main() {
  final fixture =
      jsonDecode(
            File(
              'functions/test/fixtures/staff-expense-credit-cases.json',
            ).readAsStringSync(),
          )
          as Map<String, dynamic>;
  final cases = (fixture['cases'] as List).cast<Map<String, dynamic>>();
  final itemCases = (fixture['itemsAfterCredit'] as List)
      .cast<Map<String, dynamic>>();

  List<Map<String, dynamic>> rows(Object? list) => [
    for (final r in (list as List? ?? const []))
      (r as Map).cast<String, dynamic>(),
  ];

  test('the fixture has its cases', () {
    expect(cases.length, greaterThanOrEqualTo(5));
    expect(itemCases.length, greaterThanOrEqualTo(3));
  });

  group('netStaffExpenses, the shared cases', () {
    for (final c in cases) {
      test(c['name'], () {
        final got = netStaffExpenses(
          [
            for (final x in rows(c['customers']))
              (
                key: x['key'] as String,
                dueCents: (x['dueCents'] as num).toInt(),
              ),
          ],
          entries: rows(c['entries']),
          repayments: rows(c['repayments']),
          links: (c['links'] as Map).cast<String, dynamic>(),
          monthKey: c['monthKey'] as String,
          staffNames: (c['staffNames'] as Map).cast<String, String>(),
        );
        final json = {
          'customers': [
            for (final x in got.customers)
              {
                'key': x.key,
                'dueBeforeExpensesCents': x.dueBeforeExpensesCents,
                'expenseCreditCents': x.expenseCreditCents,
                'dueCents': x.dueCents,
                'linkedStaffIds': x.linkedStaffIds,
              },
          ],
          'businessOwes': [
            for (final x in got.businessOwes)
              {
                'staffId': x.staffId,
                'staffName': x.staffName,
                'customerKey': x.customerKey,
                'owedCents': x.owedCents,
              },
          ],
          'businessOwesCents': got.businessOwesCents,
          'expenseCreditCents': got.expenseCreditCents,
        };
        expect(json, c['expect']);
      });
    }
  });

  group('bill lines, the shared cases', () {
    final bills = (fixture['bills'] as List).cast<Map<String, dynamic>>();
    test(
      'there are bill cases',
      () => expect(bills.length, greaterThanOrEqualTo(3)),
    );
    for (final c in bills) {
      test(c['name'], () {
        final want = (c['expect'] as Map).cast<String, dynamic>();
        final net = netStaffExpenses(
          [
            for (final x in rows(c['customers']))
              (
                key: x['key'] as String,
                dueCents: (x['dueCents'] as num).toInt(),
              ),
          ],
          entries: rows(c['entries']),
          repayments: rows(c['repayments']),
          links: (c['links'] as Map).cast<String, dynamic>(),
          monthKey: c['monthKey'] as String,
          staffNames: (c['staffNames'] as Map).cast<String, String>(),
        ).customers.first;
        final lines = monthExpenseLines(
          rows(c['entries']),
          c['monthKey'] as String,
          net.linkedStaffIds,
          expenseLineLabels(rows(c['lines'])),
        );
        expect([
          for (final l in lines)
            {'id': l.id, 'label': l.label, 'amountCents': l.amountCents},
        ], want['lines']);
        final listed = lines.fold<int>(0, (s, l) => s + l.amountCents);
        expect(listed, want['linesCents']);
        expect(net.expenseCreditCents, want['expenseCreditCents']);
        expect(net.dueCents, want['dueCents']);
        final earlier = earlierExpenseCents(
          net.expenseCreditCents,
          lines.map((l) => l.amountCents),
        );
        expect(earlier, want['earlierExpenseCents']);
        if (listed <= net.expenseCreditCents) {
          expect(
            listed + earlier,
            net.expenseCreditCents,
            reason: 'the lines add up to Less expenses',
          );
        }
      });
    }
    test('an expense reads as its line, then its note', () {
      expect(
        expenseLabel('grosseries', 'tissu, cups'),
        'grosseries · tissu, cups',
      );
      expect(expenseLabel('grosseries', ''), 'grosseries');
      expect(expenseLabel('', ' tissu '), 'tissu');
      expect(expenseLabel('Grosseries', 'grosseries'), 'Grosseries');
      expect(expenseLabel(null, null), '');
    });
  });

  group('itemsAfterCredit, the shared cases', () {
    for (var i = 0; i < itemCases.length; i++) {
      final c = itemCases[i];
      test('case ${i + 1}: credit ${c['creditCents']}', () {
        final got = itemsAfterCredit<Map<String, dynamic>>(
          rows(c['items']),
          (c['creditCents'] as num).toInt(),
          amountOf: (x) => (x['amountCents'] as num).toInt(),
          withAmount: (x, cents) => {...x, 'amountCents': cents},
        );
        expect(got, c['expect']);
      });
    }
  });

  group('the pieces', () {
    test('staffCredits: only months up to the one shown, voided left out', () {
      final credits = staffCredits(
        [
          {'paidByStaffId': 'a', 'amountCents': 1000, 'month': '2026-09'},
          {'paidByStaffId': 'a', 'amountCents': 500, 'month': '2026-11'},
          {
            'paidByStaffId': 'a',
            'amountCents': 700,
            'month': '2026-10',
            'voided': true,
          },
          {'paidByStaffId': '', 'amountCents': 900, 'month': '2026-10'},
        ],
        [
          {'staffId': 'a', 'amountCents': 1500, 'month': '2026-10'},
        ],
        '2026-10',
      );
      expect(credits.keys, ['a']);
      expect(credits['a']!.expensesCents, 1000);
      expect(credits['a']!.repaidCents, 1500);
      expect(credits['a']!.creditCents, 0, reason: 'never below zero');
      expect(staffCredits(const [], const [], 'not a month'), isEmpty);
    });

    test('splitByCredit gives the rounding remainder to the first', () {
      const credits = {
        'a': StaffCredit(creditCents: 1),
        'b': StaffCredit(creditCents: 1),
        'c': StaffCredit(creditCents: 1),
      };
      expect(splitByCredit(100, ['a', 'b', 'c'], credits), {
        'a': 34,
        'b': 33,
        'c': 33,
      });
      expect(splitByCredit(0, ['a'], credits), {'a': 0});
    });

    test(
      'monthExpenseLines: the month only, the linked staff only, oldest first',
      () {
        final lines = monthExpenseLines(
          [
            {
              'id': 'late',
              'paidByStaffId': 'a',
              'amountCents': 300,
              'month': '2026-10',
              'spentAtMs': 20,
              'note': ' Salt ',
            },
            {
              'id': 'early',
              'paidByStaffId': 'a',
              'amountCents': 200,
              'month': '2026-10',
              'spentAtMs': 10,
            },
            {
              'id': 'sep',
              'paidByStaffId': 'a',
              'amountCents': 200,
              'month': '2026-09',
            },
            {
              'id': 'void',
              'paidByStaffId': 'a',
              'amountCents': 200,
              'month': '2026-10',
              'voided': true,
            },
            {
              'id': 'other',
              'paidByStaffId': 'b',
              'amountCents': 200,
              'month': '2026-10',
            },
          ],
          '2026-10',
          ['a'],
        );
        expect(lines.map((l) => l.id), ['early', 'late']);
        expect(lines.last.note, 'Salt');
        expect(lines.last.amountCents, 300);
      },
    );
  });
}
