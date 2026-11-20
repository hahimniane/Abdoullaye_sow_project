import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/services/fleet.dart';
import 'package:my_flutter_app/widgets/fleet_widgets.dart';

/// Fleet payment claims, payer names, plate fee, "Driver has left" and the
/// month-by-bill rules (docs/FLEET_PAYMENT_PROOF.md), ported from the
/// website's tests (admin_web/src/lib/fleet*.test.ts). Synthetic data only.

FleetClaim claim(String id, Map<String, dynamic> extra) => readFleetClaim(id, {
  'businessId': 'b',
  'driverId': 'd1',
  'fromPhone': '+15550000001',
  'state': 'waiting_bank',
  'amountCents': 40000,
  'createdAtMs': 1000,
  ...extra,
})!;

FleetBill bill(
  String id, {
  String kind = 'rent',
  String status = 'open',
  int amount = 100000,
  int paid = 0,
  String due = '2026-11-01',
  String voidReason = '',
  String driver = 'd1',
}) => FleetBill(
  id: id,
  driverId: driver,
  kind: kind,
  status: status,
  amountCents: amount,
  paidCents: paid,
  dueDayKey: due,
  voidReason: voidReason,
);

void main() {
  const names = {'d1': 'Test Driver One', 'd2': 'Test Driver Two'};

  group('claims', () {
    test(
      'only open claims are listed; paid, closed and unreadable are not',
      () {
        final rows = [
          claim('a', {'state': 'asking_driver', 'driverId': null}),
          claim('b', {'state': 'asking_amount', 'amountCents': null}),
          claim('c', {}),
          claim('d', {'state': 'asking_name'}),
          claim('e', {'state': 'office', 'reason': 'two_claims'}),
          claim('f', {'state': 'paid'}),
          claim('g', {'state': 'closed'}),
          claim('h', {'state': 'something_new'}),
        ];
        final ids = [for (final v in fleetOpenClaimViews(rows, names)) v.id]
          ..sort();
        expect(ids, ['a', 'b', 'c', 'd', 'e']);
        expect(readFleetClaim('', const {}), isNull);
      },
    );

    test('oldest first; the phone stands in when there is no driver yet', () {
      final views = fleetOpenClaimViews([
        claim('late', {'createdAtMs': 5000}),
        claim('old', {
          'createdAtMs': 1000,
          'driverId': null,
          'fromPhone': '+15550000009',
        }),
        claim('mid', {'createdAtMs': 3000, 'driverId': 'd2'}),
      ], names);
      expect([for (final v in views) v.id], ['old', 'mid', 'late']);
      expect(views[0].who, '+15550000009');
      expect(views[0].hasDriver, isFalse);
      expect(views[1].who, 'Test Driver Two');
    });

    test('a claim with no readable amount shows none, never 0', () {
      expect(claim('x', {'amountCents': null}).amountCents, isNull);
      expect(claim('x', {'amountCents': 'x'}).amountCents, isNull);
      expect(claim('x', {'amountCents': 0}).amountCents, isNull);
      expect(claim('x', {'amountCents': 40000}).amountCents, 40000);
    });

    test('every state and office reason has its own sentence', () {
      final seen = <FleetClaimSentence>{};
      for (final s in [
        'asking_driver',
        'asking_amount',
        'asking_name',
        'waiting_bank',
      ]) {
        seen.add(fleetClaimSentence(claim('x', {'state': s})));
      }
      seen.add(fleetClaimSentence(claim('x', {'toldLateAtMs': 9})));
      for (final r in [
        'wrong_recipient',
        'deposit_taken',
        'too_old',
        'not_a_driver',
        'two_claims',
        'no_amount',
        'no_deposit',
        'payment_undone',
        '',
        'new_reason',
      ]) {
        seen.add(
          fleetClaimSentence(claim('x', {'state': 'office', 'reason': r})),
        );
      }
      // Four states, the late one, eight reasons, one fallback.
      expect(seen.length, 14);
      expect(seen, isNot(contains(FleetClaimSentence.none)));
      final en = lookupAppLocalizations(const Locale('en'));
      final fr = lookupAppLocalizations(const Locale('fr'));
      final english = <String>{};
      for (final s in seen) {
        final text = fleetClaimSentenceText(en, s);
        expect(text.length, greaterThan(10));
        expect(fleetClaimSentenceText(fr, s), isNot(text));
        expect(english.add(text), isTrue);
      }
    });

    test(
      'deposits offered to a claim: not pending, same amount first, newest',
      () {
        FleetWaitingDeposit w(
          String id,
          int amount,
          int at, {
          bool pending = false,
        }) => FleetWaitingDeposit(
          id: id,
          amountCents: amount,
          atMs: at,
          pending: pending,
        );
        final waiting = [
          w('w1', 30000, 3000),
          w('w2', 40000, 1000),
          w('w3', 40000, 2000),
          w('w4', 40000, 9000, pending: true),
          w('', 40000, 9000),
        ];
        final offered = fleetDepositsForClaim(40000, waiting);
        expect([for (final o in offered) o.deposit.id], ['w3', 'w2', 'w1']);
        expect([for (final o in offered) o.sameAmount], [true, true, false]);
        expect(
          [for (final o in fleetDepositsForClaim(null, waiting)) o.sameAmount],
          [false, false, false],
        );
        expect(fleetDepositsForClaim(40000, const []), isEmpty);
      },
    );

    test('the requests carry what the server reads', () {
      expect(FleetRequests.claimAssign('b', claimId: 'c1', creditId: 'cr1'), {
        'action': 'claim_assign',
        'businessId': 'b',
        'claimId': 'c1',
        'creditId': 'cr1',
      });
      expect(FleetRequests.claimClose('b', 'c1')['action'], 'claim_close');
      expect(FleetRequests.claimPhoto('b', 'c1')['claimId'], 'c1');
      expect(
        FleetRequests.payerNamesSave('b', driverId: 'd1', names: ['A B']),
        {
          'action': 'payer_names_save',
          'businessId': 'b',
          'driverId': 'd1',
          'names': ['A B'],
        },
      );
      final fee = FleetRequests.assignmentUpdate(
        'b',
        assignmentId: 'a1',
        dueDay: 9,
      );
      expect(fee['action'], 'assignment_update');
      expect(
        fee.containsKey('rentCents'),
        isFalse,
        reason: 'only what changed',
      );
      expect(fee['dueDay'], 9);
      expect(
        FleetRequests.driverLeave('b', driverId: 'd1', endDayKey: '2026-11-11'),
        {
          'action': 'driver_leave',
          'businessId': 'b',
          'driverId': 'd1',
          'endDayKey': '2026-11-11',
        },
      );
    });
  });

  group('payer names', () {
    test('old records read without error, cleaned like a save', () {
      expect(
        FleetDriver.fromMap('d', {'personalCents': 7}).payerNames,
        isEmpty,
      );
      expect(fleetReadPayerNames(null), isEmpty);
      expect(fleetReadPayerNames(['TEST ONE', ' test  one ', '', 'TEST TWO']), [
        'TEST ONE',
        'TEST TWO',
      ]);
      expect(fleetReadPayerNames({'TEST ONE': true, 'TEST TWO': 1}), [
        'TEST ONE',
        'TEST TWO',
      ]);
      expect(fleetCleanPayerNames(['A  B', 'a b', 5, null]), ['A B', '5']);
      expect(
        FleetDriver.fromMap('d', {
          'rememberedSenders': ['AWA SOW'],
        }).payerNames,
        ['AWA SOW'],
      );
    });
  });

  group('no Zelle cents', () {
    test(
      'a record that still carries personalCents is read without a code',
      () {
        final d = FleetDriver.fromMap('d1', {
          'name': 'Amy',
          'personalCents': 7,
        });
        expect(d.name, 'Amy');
        // The driver row has no cents and the sort list has no cents order.
        expect(FleetDriverSort.values.map((s) => s.name), ['name', 'owed']);
      },
    );
  });

  group('driverDisplayName (the website cases)', () {
    const cases = {
      'Fawaz #9': 'Fawaz',
      'ABU HASSAN (25)': 'ABU HASSAN',
      'Amadou Diallo #49 STORAGE 2/14/25': 'Amadou Diallo',
      'Dorjee Tenzin T (26) Drop it 08/25/2025 at 12:55 Pm': 'Dorjee Tenzin T',
      'IDY # 50': 'IDY',
      'KHUSRAV # (26)': 'KHUSRAV',
      'Bako Sy': 'Bako Sy',
      '  Bako   Sy  ': 'Bako Sy',
      'Mamadou voir folder 12': 'Mamadou',
      'Mamadou VOIR  FOLDER': 'Mamadou',
      'Ali drop': 'Ali',
      'Ali storage': 'Ali',
      'Dropo Kone': 'Dropo Kone',
      'Storageman': 'Storageman',
      'Sam (25) Jones': 'Sam (25) Jones',
    };
    cases.forEach((input, expected) {
      test(input, () => expect(driverDisplayName(input), expected));
    });

    test('falls back to the full name when nothing would be left', () {
      expect(driverDisplayName('#46'), '#46');
      expect(driverDisplayName('(25)'), '(25)');
      expect(driverDisplayName('STORAGE 2/14/25'), 'STORAGE 2/14/25');
      expect(driverDisplayName(''), '');
      expect(driverDisplayName(null), '');
    });

    test('the leave and fee confirm texts use it', () {
      final en = lookupAppLocalizations(const Locale('en'));
      final fr = lookupAppLocalizations(const Locale('fr'));
      final name = driverDisplayName('ABU HASSAN (25)');
      expect(
        en.fltDriverLeftConfirmPlate(name, 'Nov 11, 2026', 'T123456C'),
        'Mark ABU HASSAN as having left on Nov 11, 2026? Plate T123456C comes back on that date and bills stop.',
      );
      expect(
        fr.fltDriverLeftConfirmPlate(name, 'Nov 11, 2026', 'T123456C'),
        startsWith('Marquer ABU HASSAN comme parti le Nov 11, 2026'),
      );
      expect(
        en.fltDriverLeftConfirmNoPlate('Bako', 'x'),
        'Mark Bako as having left on x? Bills stop.',
      );
    });
  });

  group('plate fee and leaving', () {
    const current = FleetAssignment(
      id: 'a1',
      carId: 'c1',
      driverId: 'd1',
      startDayKey: '2026-01-01',
      rentCents: 120000,
      dueDay: 5,
    );
    const weekly = FleetAssignment(
      id: 'a1',
      carId: 'c1',
      driverId: 'd1',
      startDayKey: '2026-01-01',
      rentCents: 120000,
      dueDay: 5,
      period: 'weekly',
    );

    test(
      'sends only what changed and refuses nothing-changed or bad numbers',
      () {
        var r = fleetReadPlateFeeInput('1,300', '', current);
        expect([r.ok, r.rentCents, r.dueDay], [true, 130000, null]);
        r = fleetReadPlateFeeInput('1200', '10', current);
        expect([r.ok, r.rentCents, r.dueDay], [true, null, 10]);
        r = fleetReadPlateFeeInput('1300', '10', current);
        expect([r.ok, r.rentCents, r.dueDay], [true, 130000, 10]);
        expect(
          fleetReadPlateFeeInput('1200', '5', current).error,
          FleetPlateFeeError.nothingChanged,
        );
        for (final bad in [
          ('', '5'),
          ('abc', ''),
          ('0', ''),
          ('1300', '29'),
          ('1300', '0'),
          ('1300', '2.5'),
        ]) {
          expect(
            fleetReadPlateFeeInput(bad.$1, bad.$2, current).error,
            FleetPlateFeeError.badInput,
            reason: '$bad',
          );
        }
        expect(fleetReadPlateFeeInput('1300', '7', weekly).ok, isTrue);
        expect(fleetReadPlateFeeInput('1300', '8', weekly).ok, isFalse);
      },
    );

    test('estimates the first period with no bill yet', () {
      const a = FleetAssignment(
        id: 'a1',
        carId: 'c1',
        driverId: 'd1',
        startDayKey: '2026-01-01',
        rentCents: 100,
        dueDay: 5,
      );
      final all = [
        for (var m = 1; m <= 11; m++)
          bill('a1_2026-${m.toString().padLeft(2, '0')}-01'),
      ];
      expect(fleetEstimateFeeEffectiveDay(a, all, '2026-11-11'), '2026-12-01');
      expect(
        fleetEstimateFeeEffectiveDay(a, [
          bill('a1_2026-10-01'),
          bill('a1_2026-11-01'),
        ], '2026-11-11'),
        '2026-01-01',
      );
    });

    test('Driver has left is for a Fleet admin, once, and hidden after', () {
      const active = FleetDriver(id: 'd1');
      const left = FleetDriver(id: 'd1', status: 'left');
      expect(fleetCanMarkLeft(admin: true, driver: active), isTrue);
      expect(fleetCanMarkLeft(admin: false, driver: active), isFalse);
      expect(fleetCanMarkLeft(admin: true, driver: left), isFalse);
    });

    test('every new refusal has its own words in both languages', () {
      final en = lookupAppLocalizations(const Locale('en'));
      final fr = lookupAppLocalizations(const Locale('fr'));
      const expected = {
        'fleet_driver_has_plate':
            'This driver still has a plate. Get it back first, or ask a Fleet admin to use Driver has left.',
        'fleet_already_returned': 'This plate was already returned.',
        'fleet_car_overlap':
            'This plate was with another driver until that day. Pick a later start day.',
        'fleet_claim_closed': 'This report is already closed.',
        'fleet_claim_no_driver':
            'This report has no driver yet. Wait for the sender to say who it is for, or close it.',
        'fleet_deposit_not_waiting':
            'That deposit is no longer waiting. Refresh and try again.',
        'fleet_zelle_missing':
            'Add the Zelle email or phone in Fleet settings first.',
        'fleet_admin_only': 'Only a Fleet admin can do this.',
        'fleet_no_amount': 'Enter an amount.',
        'fleet_note_empty': 'Write a note or attach a file.',
        'fleet_staff_only':
            'This staff account is not allowed to manage Fleet.',
        'fleet_no_bank':
            "Connect the business's bank first (Profile, Bank for Zelle checks).",
      };
      expected.forEach((reason, sentence) {
        final f = FleetFailure(code: 'failed-precondition', reason: reason);
        expect(fleetRefusalText(en, f), sentence);
        expect(fleetRefusalText(fr, f), isNot(sentence));
      });
      // A refused name says which name, and is never translated.
      final named = parseFleetFailure('invalid-argument', {
        'reason': 'fleet_bad_name',
        'name': 'Zelle',
      });
      expect(named.name, 'Zelle');
      expect(
        fleetRefusalText(en, named),
        '"Zelle" cannot be used. Type the person\'s full name as the bank shows it.',
      );
      expect(fleetRefusalText(fr, named), startsWith('"Zelle" ne peut pas'));
      const plain = FleetFailure(
        code: 'invalid-argument',
        reason: 'fleet_bad_name',
      );
      expect(
        fleetRefusalText(en, plain),
        'That name cannot be used. Type the person\'s full name as the bank shows it.',
      );
      for (final reason in [
        'fleet_bad_name',
        'fleet_zelle_missing',
        'fleet_deposit_used',
      ]) {
        final f = FleetFailure(code: 'failed-precondition', reason: reason);
        expect(fleetRefusalText(en, f), isNot(en.fltErrUnknown));
      }
      // The reasons are parsed from the callable's details.
      expect(
        parseFleetFailure('failed-precondition', {
          'reason': 'fleet_claim_closed',
        }).reason,
        'fleet_claim_closed',
      );
    });
  });

  group('a month is its rent bill', () {
    FleetPeriodRow row(
      List<FleetBill> bills,
      List<FleetPayment> payments, {
      FleetDriver driver = const FleetDriver(id: 'd1', name: 'A'),
    }) {
      final data = FleetData(
        drivers: [driver],
        bills: bills,
        payments: payments,
      );
      final p = fleetPeriodContaining(FleetPeriodKind.month, '2026-11-10');
      return fleetPeriodRows(
        data,
        FleetIndex(data),
        p,
        '2026-11-10',
      ).rows.firstWhere((r) => r.driverId == 'd1');
    }

    test('coloured from the rent bill only, even when a payment landed', () {
      final r = row(
        [bill('b')],
        const [
          FleetPayment(
            id: 'p',
            driverId: 'd1',
            amountCents: 40000,
            paidDayKey: '2026-11-04',
          ),
        ],
      );
      expect(r.state, FleetCellState.owed);
      expect(r.paidCents, 40000, reason: 'the number stays what was received');
    });

    test('part by the bill\'s paidCents, full when it covers the amount', () {
      expect(
        row([bill('b', paid: 25000)], const []).state,
        FleetCellState.part,
      );
      expect(
        row([bill('b', status: 'paid', paid: 100000)], const []).state,
        FleetCellState.full,
      );
    });

    test('with no rent bill: paid when payments landed, none otherwise', () {
      expect(
        row(const [], const [
          FleetPayment(
            id: 'p',
            driverId: 'd1',
            amountCents: 5000,
            paidDayKey: '2026-11-04',
          ),
        ]).state,
        FleetCellState.full,
      );
      expect(row(const [], const []).state, FleetCellState.none);
    });

    test('a late fee still owed marks the month, never turns the colour', () {
      final r = row([
        bill('b', status: 'paid', paid: 100000),
        bill('f', kind: 'late_fee', amount: 5000, due: '2026-11-05'),
      ], const []);
      expect(r.state, FleetCellState.full);
      expect(r.extraOwedCents, 5000);
      // It counts as Owes, and not as Paid in full.
      expect(fleetFilterStateOf(r), FleetCellState.owed);
      final counts = fleetPeriodCounts([r], FleetDriverView.active);
      expect([counts.owed, counts.part, counts.paid], [1, 0, 0]);
      expect(
        fleetFilterPeriodRows([
          r,
        ], const FleetPaymentsFilter(state: FleetCellState.full)),
        isEmpty,
      );
      expect(
        fleetFilterPeriodRows([
          r,
        ], const FleetPaymentsFilter(state: FleetCellState.owed)),
        hasLength(1),
      );
    });

    test('a late fee that is paid, or waived, is no marker', () {
      final r = row([
        bill('b', status: 'paid', paid: 100000),
        bill('f', kind: 'late_fee', amount: 5000, paid: 5000, status: 'paid'),
        bill('w', kind: 'charge', amount: 7000, status: 'waived'),
      ], const []);
      expect(r.extraOwedCents, 0);
      expect(fleetFilterStateOf(r), FleetCellState.full);
    });

    test('a left driver with only a fee owed still shows in the period', () {
      final r = row(
        [bill('f', kind: 'charge', amount: 5000)],
        const [],
        driver: const FleetDriver(id: 'd1', name: 'A', status: 'left'),
      );
      expect(r.extraOwedCents, 5000);
    });
  });

  group('this month\'s plate fees paid', () {
    test('the share, with both amounts (the website cases)', () {
      var s = fleetPlateFeesShare(1510000, 1190000);
      expect([s.percent, s.paidCents, s.billedCents], [79, 1190000, 1510000]);
      s = fleetPlateFeesShare(210000, 30050);
      expect(s.percent, 14);
      s = fleetPlateFeesShare(100000, 150000);
      expect([s.percent, s.paidCents], [100, 100000], reason: 'never above');
      expect(fleetPlateFeesShare(0, 500).percent, 0);
    });

    test(
      'the tile counts only the plate fee bills of the month that stand',
      () {
        final data = FleetData(
          drivers: const [FleetDriver(id: 'd1')],
          bills: [
            bill('a', paid: 40000),
            bill('b', amount: 50000, paid: 50000, status: 'paid'),
            bill('late', kind: 'late_fee', amount: 5000, paid: 5000),
            bill('w', status: 'waived'),
            bill('v', status: 'void', voidReason: 'billed_by_mistake'),
            bill('old', due: '2026-10-01', paid: 100000, status: 'paid'),
          ],
          payments: const [
            FleetPayment(
              id: 'p',
              driverId: 'd1',
              amountCents: 999999,
              paidDayKey: '2026-11-02',
            ),
          ],
        );
        final t = fleetTiles(data, FleetIndex(data), '2026-11-10');
        expect(t.plateFeesBilledCents, 150000);
        expect(t.plateFeesPaidCents, 90000);
        expect(t.collectedCents, 999999, reason: 'collected stays money in');
        final en = lookupAppLocalizations(const Locale('en'));
        final fr = lookupAppLocalizations(const Locale('fr'));
        expect(
          en.fltTilePlateFeesPaid(79, r'$11,900', r'$15,100'),
          r"79% of this month’s plate fees paid ($11,900 of $15,100)",
        );
        expect(
          fr.fltTilePlateFeesPaid(79, '11 900 \$', '15 100 \$'),
          contains('79 % des frais de plaque de ce mois payés'),
        );
      },
    );
  });

  group('bills made by mistake', () {
    final bills = [
      bill('open'),
      bill('paid', status: 'paid', paid: 100000),
      bill('mistake', status: 'void', voidReason: 'billed_by_mistake'),
      bill('ontime', status: 'void', voidReason: 'paid_on_time'),
      bill('gone', status: 'void', voidReason: 'rent_bill_gone'),
      bill('w', status: 'waived'),
    ];

    test(
      'appear on no list and in no count; other void reasons are Waived',
      () {
        List<String> ids(FleetBillView v) => [
          for (final b in bills)
            if (fleetBillInView(b, v)) b.id,
        ];
        expect(ids(FleetBillView.all), ['open', 'paid', 'ontime', 'gone', 'w']);
        expect(ids(FleetBillView.waived), ['ontime', 'gone', 'w']);
        expect(ids(FleetBillView.open), ['open']);
        expect(ids(FleetBillView.paid), ['paid']);
      },
    );

    test('the void reason is read from the bill', () {
      final b = FleetBill.fromMap('x', {
        'status': 'void',
        'voidReason': 'billed_by_mistake',
      });
      expect(b.billedByMistake, isTrue);
      expect(
        FleetBill.fromMap('x', {'status': 'open'}).billedByMistake,
        isFalse,
      );
    });
  });

  group('Paperwork scope', () {
    final cars = [
      const FleetCarRow(
        id: 'c1',
        plate: 'A1',
        company: '',
        driverId: 'd1',
        driverName: 'Amy',
        registrationExpiry: '',
        diamondExpiry: '',
        registration: FleetExpiry.expired,
        diamond: FleetExpiry.ok,
        search: '',
      ),
      const FleetCarRow(
        id: 'c2',
        plate: 'B2',
        company: '',
        driverId: '',
        driverName: '',
        registrationExpiry: '',
        diamondExpiry: '',
        registration: FleetExpiry.missing,
        diamond: FleetExpiry.missing,
        search: '',
      ),
    ];

    test(
      'defaults to plates with a driver; Every plate is the other choice',
      () {
        expect(
          [
            for (final c in fleetCarsInPaperworkScope(
              cars,
              FleetPaperworkScope.driver,
            ))
              c.id,
          ],
          ['c1'],
        );
        expect(
          fleetCarsInPaperworkScope(cars, FleetPaperworkScope.all),
          hasLength(2),
        );
        final counts = fleetPaperworkCounts(
          fleetCarsInPaperworkScope(cars, FleetPaperworkScope.driver),
        );
        expect(counts[FleetExpiry.missing], 0);
        expect(counts[FleetExpiry.expired], 1);
      },
    );
  });

  test('the Fleet waiting reasons include the new ones, once each', () {
    expect(fleetWaitingReasons, contains('shared_payer'));
    expect(fleetWaitingReasons, contains('undone'));
    final en = lookupAppLocalizations(const Locale('en'));
    expect(
      fleetWaitingReasonText(en, 'undone'),
      "This deposit's payment was undone. It will not pay anyone by itself: pick the driver.",
    );
    expect(fleetWaitingReasons, isNot(contains('two_drivers')));
  });
}
