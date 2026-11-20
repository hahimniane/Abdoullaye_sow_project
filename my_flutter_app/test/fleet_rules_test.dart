import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/fleet.dart';

/// Fleet's pure rules on the phone (docs/FLEET.md). The billing rules run the
/// same shared fixture the server and the website run, so the three can never
/// drift; the views mirror admin_web/src/lib/fleet.test.ts.

typedef J = Map<String, dynamic>;

final J fixture =
    jsonDecode(
          File(
            'functions/test/fixtures/fleet-billing-cases.json',
          ).readAsStringSync(),
        )
        as J;

List<J> cases(String key) => [for (final c in fixture[key] as List) c as J];

FleetAssignment assignmentOf(J a) =>
    FleetAssignment.fromMap((a['id'] ?? 'x').toString(), a);

List<FleetBill> billsOf(Object? list) => [
  for (final b in list as List) FleetBill.fromMap((b as J)['id'] as String, b),
];

FleetBill bill(
  String id, {
  String kind = 'rent',
  String status = 'open',
  int amount = 90000,
  int paid = 0,
  String due = '2026-11-01',
  String driver = 'd1',
}) => FleetBill(
  id: id,
  kind: kind,
  status: status,
  amountCents: amount,
  paidCents: paid,
  dueDayKey: due,
  driverId: driver,
);

void main() {
  group('billing rules against the shared fixture', () {
    for (final c in cases('periodCases')) {
      test('periods: ${c['name']}', () {
        final got = fleetRentPeriods(
          assignmentOf(c['assignment'] as J),
          c['through'] as String,
        );
        final want = [
          for (final p in c['expect'] as List)
            FleetRentPeriod(
              (p as J)['periodFrom'] as String,
              p['periodTo'] as String,
              p['dueDayKey'] as String,
            ),
        ];
        expect(got, want);
      });
    }

    for (final c in cases('billCases')) {
      test('rent bills: ${c['name']}', () {
        final bills = fleetRentBillsToCreate(
          assignmentOf(c['assignment'] as J),
          [for (final e in c['existing'] as List) e as Object],
          c['through'] as String,
          FleetBillingSettings.fromMap(c['settings'] as J?),
        );
        if (c['expect'] != null) expect(bills, c['expect']);
        if (c['expectIds'] != null) {
          expect([for (final b in bills) b['id']], c['expectIds']);
        }
        if (c['expectAmounts'] != null) {
          expect([for (final b in bills) b['amountCents']], c['expectAmounts']);
        }
      });
    }

    for (final c in cases('nextPeriodCases')) {
      test('next period: ${c['name']}', () {
        expect(
          fleetNextUnbilledPeriodStart(assignmentOf(c['assignment'] as J), [
            for (final e in c['existing'] as List) e as Object,
          ], c['today'] as String),
          c['expect'],
        );
      });
    }

    for (final c in cases('lateFeeCases')) {
      test('late fees: ${c['name']}', () {
        final got = fleetLateFeesToCreate(
          billsOf(c['bills']),
          FleetBillingSettings.fromMap(c['settings'] as J?),
          c['today'] as String,
        );
        // The fixture names only the keys that matter for each case.
        final want = [for (final w in c['expect'] as List) w as J];
        expect(got.length, want.length);
        for (var i = 0; i < want.length; i++) {
          for (final key in want[i].keys) {
            expect(got[i][key], want[i][key], reason: '${c['name']} $key');
          }
        }
      });
    }

    for (final c in cases('allocationCases')) {
      test('payment: ${c['name']}', () {
        final plan = fleetAllocatePayment(
          billsOf(c['bills']),
          c['amountCents'] as int,
        );
        final want = c['expect'] as J;
        expect(plan.ok, want['ok']);
        if (want['ok'] == true) {
          expect(plan.allocations, [
            for (final a in want['allocations'] as List)
              FleetAllocation((a as J)['billId'] as String, a['cents'] as int),
          ]);
          expect(plan.creditAddedCents, want['creditAddedCents']);
        } else {
          expect(plan.reason, want['reason']);
        }
      });
    }

    for (final c in cases('creditCases')) {
      test('credit: ${c['name']}', () {
        final got = fleetApplyCredit(
          billsOf(c['bills']),
          c['creditCents'] as int,
        );
        final want = c['expect'] as J;
        expect(got.allocations, [
          for (final a in want['allocations'] as List)
            FleetAllocation((a as J)['billId'] as String, a['cents'] as int),
        ]);
        expect(got.creditLeftCents, want['creditLeftCents']);
      });
    }

    for (final c in cases('balanceCases')) {
      test('balance: ${c['name']}', () {
        final got = fleetDriverBalance(
          billsOf(c['bills']),
          c['creditCents'] as int,
          c['today'] as String,
        );
        final want = c['expect'] as J;
        expect(got.owedCents, want['owedCents']);
        expect(got.lateCents, want['lateCents']);
        expect(got.creditCents, want['creditCents']);
        final next = want['nextDue'] as J?;
        expect(got.hasNextDue, next != null);
        if (next != null) {
          expect(got.nextDueDayKey, next['dueDayKey']);
          expect(got.nextDueCents, next['cents']);
        }
      });
    }

    for (final c in cases('personalCases')) {
      test('personal cents: ${c['name']}', () {
        final got = fleetAssignPersonalCents([
          for (final d in c['drivers'] as List)
            (
              id: (d as J)['id'] as String,
              personalCents: d['personalCents'] as num?,
              createdAt: d['createdAt'] as num,
            ),
        ]);
        expect(got, c['expect']);
      });
    }

    for (final c in cases('whoDroveCases')) {
      test('who drove: ${c['name']}', () {
        final got = fleetWhoDroveAt(
          [
            for (final a in c['assignments'] as List)
              FleetAssignment.fromMap('a', a as J),
          ],
          [
            for (final s in c['substitutes'] as List)
              FleetFriend.fromMap((s as J)['id'] as String, s),
          ],
          c['carId'] as String,
          c['dayKey'] as String,
        );
        final want = c['expect'] as J;
        expect(got.driverId, want['driverId']);
        expect(got.substituteId, want['substituteId']);
      });
    }
  });

  group('days, months and money', () {
    test('month window ends at the last month, oldest first', () {
      expect(fleetMonthWindow('2026-02', 4), [
        '2025-11',
        '2025-12',
        '2026-01',
        '2026-02',
      ]);
      expect(fleetShiftMonth('2026-01', -1), '2025-12');
      expect(fleetShiftMonth('2026-12', 1), '2027-01');
    });

    test('labels are month first, French months in French', () {
      expect(fleetMonthLabel('2026-11'), 'Nov 2026');
      expect(fleetMonthLabel('2026-11', language: 'fr'), 'nov. 2026');
      expect(fleetDayLabel('2026-11-03'), 'Nov 3, 2026');
      expect(fleetDayLabel('nope'), '');
    });

    test('weekday and day arithmetic', () {
      expect(fleetWeekday('2026-11-16'), 1); // a Monday
      expect(fleetWeekday('2026-11-22'), 7);
      expect(fleetDaysBetween('2026-11-01', '2026-12-01'), 30);
      expect(fleetAddDays('2026-02-27', 3), '2026-03-02');
    });

    test('typed dollars become cents and back', () {
      expect(fleetDollarsToCents('1,200.50'), 120050);
      expect(fleetDollarsToCents(r'$1200'), 120000);
      expect(fleetDollarsToCents('abc'), isNull);
      expect(fleetCentsToInput(120050), '1200.50');
      expect(fleetCentsToInput(120000), '1200');
      expect(fleetCentsToInput(0), '');
    });

    test('the Zelle amount rounds the dollars up and adds the cents', () {
      expect(fleetZelleAmountText(120000, 7), r'$1,200.07');
      expect(fleetZelleAmountText(120001, 7), r'$1,201.07');
      expect(fleetZelleAmountText(0, 17), r'$0.17');
      expect(fleetZelleAmountText(5000, null), isNull);
      expect(fleetZelleAmountText(5000, 100), isNull);
    });

    test('money reads in the language asked', () {
      expect(fleetMoney(123450, language: 'en'), r'$1,234.50');
      expect(
        fleetMoney(123450, language: 'fr'),
        matches(RegExp(r'^1\s234,50\s\$$')),
      );
    });
  });

  group('periods', () {
    test('a week runs Monday to Sunday, a month the whole month', () {
      final w = fleetPeriodContaining(FleetPeriodKind.week, '2026-11-18');
      expect([w.from, w.to], ['2026-11-16', '2026-11-22']);
      final m = fleetPeriodContaining(FleetPeriodKind.month, '2026-02-10');
      expect([m.from, m.to], ['2026-02-01', '2026-02-28']);
      expect(m.contains('2026-02-28'), isTrue);
      expect(m.contains('2026-03-01'), isFalse);
    });

    test('shifting steps by whole weeks and months', () {
      final w = fleetPeriodContaining(FleetPeriodKind.week, '2026-11-18');
      expect(fleetShiftPeriod(w, -1).from, '2026-11-09');
      final m = fleetPeriodContaining(FleetPeriodKind.month, '2026-01-31');
      final prev = fleetShiftPeriod(m, -1);
      expect([prev.from, prev.to], ['2025-12-01', '2025-12-31']);
      expect(fleetShiftPeriod(m, 1).from, '2026-02-01');
    });
  });

  group('payments by period', () {
    final data = FleetData(
      drivers: const [
        FleetDriver(id: 'd1', name: 'Alpha Bah'),
        FleetDriver(id: 'd2', name: 'Bravo Diallo'),
        FleetDriver(id: 'd3', name: 'Charlie Sow'),
        FleetDriver(id: 'd4', name: 'Old Timer', status: 'left'),
      ],
      cars: const [FleetCar(id: 'c1', plate: 'T123')],
      assignments: const [
        FleetAssignment(
          id: 'a1',
          carId: 'c1',
          driverId: 'd1',
          startDayKey: '2026-01-01',
        ),
      ],
      bills: [
        bill('b1', driver: 'd1', paid: 90000),
        bill('b2', driver: 'd2', paid: 30000),
        bill('b3', driver: 'd3'),
        bill('b3w', driver: 'd3', status: 'waived', due: '2026-11-02'),
        bill(
          'b4',
          driver: 'd1',
          kind: 'late_fee',
          amount: 5000,
          due: '2026-11-05',
        ),
      ],
      payments: const [
        FleetPayment(
          id: 'p1',
          driverId: 'd1',
          amountCents: 90000,
          paidDayKey: '2026-11-02',
        ),
        FleetPayment(
          id: 'p2',
          driverId: 'd2',
          amountCents: 30000,
          paidDayKey: '2026-11-03',
        ),
        FleetPayment(
          id: 'p3',
          driverId: 'd2',
          amountCents: 10000,
          paidDayKey: '2026-11-04',
          status: 'undone',
        ),
        FleetPayment(
          id: 'p4',
          driverId: 'd4',
          amountCents: 5000,
          paidDayKey: '2026-10-05',
        ),
      ],
    );
    final index = FleetIndex(data);
    final nov = fleetPeriodContaining(FleetPeriodKind.month, '2026-11-10');

    test('paid, part and owed read from the rent bills of the period', () {
      final grid = fleetPeriodRows(data, index, nov, '2026-11-10');
      final byId = {for (final r in grid.rows) r.driverId: r};
      expect(byId['d1']!.state, FleetCellState.full);
      expect(byId['d1']!.plate, 'T123');
      expect(byId['d2']!.state, FleetCellState.part);
      expect(byId['d2']!.paidCents, 30000);
      expect(byId['d3']!.state, FleetCellState.owed);
      expect(byId['d3']!.dueCents, 90000);
      expect(grid.paidCents, 120000);
    });

    test('a driver who left shows only with something in the period', () {
      final november = fleetPeriodRows(data, index, nov, '2026-11-10');
      expect(november.rows.map((r) => r.driverId), isNot(contains('d4')));
      final oct = fleetPeriodContaining(FleetPeriodKind.month, '2026-10-10');
      final october = fleetPeriodRows(data, index, oct, '2026-11-10');
      expect(october.rows.map((r) => r.driverId), contains('d4'));
    });

    test('owed now and late come from the balance, late first in the sum', () {
      final grid = fleetPeriodRows(data, index, nov, '2026-11-10');
      final d1 = grid.rows.firstWhere((r) => r.driverId == 'd1');
      expect(d1.owedCents, 5000); // the unpaid late fee
      expect(d1.lateCents, 5000);
    });

    test('filters, search and order', () {
      final rows = fleetPeriodRows(data, index, nov, '2026-11-10').rows;
      List<String> ids(FleetPaymentsFilter f) => [
        for (final r in fleetFilterPeriodRows(rows, f)) r.driverId,
      ];
      expect(ids(const FleetPaymentsFilter()), ['d1', 'd2', 'd3']);
      expect(ids(const FleetPaymentsFilter(state: FleetCellState.owed)), [
        'd3',
      ]);
      expect(ids(const FleetPaymentsFilter(late: true)), ['d1', 'd2', 'd3']);
      expect(ids(const FleetPaymentsFilter(query: 't123')), ['d1']);
      expect(
        ids(const FleetPaymentsFilter(sort: FleetPeriodSort.paid)).first,
        'd1',
      );
      final counts = fleetPeriodCounts(rows, FleetDriverView.active);
      expect(
        [counts.owed, counts.part, counts.paid, counts.late],
        [1, 1, 1, 3],
      );
    });

    test('tiles: collected this month, owed now, late drivers', () {
      final t = fleetTiles(data, index, '2026-11-10');
      expect(t.collectedCents, 120000);
      expect(t.lateDrivers, 3);
      expect(t.owingDrivers, 3);
      expect(t.dueThisMonthCents, 90000 + 90000 + 90000 + 5000);
    });
  });

  group('drivers and their filters', () {
    final data = FleetData(
      drivers: const [
        FleetDriver(id: 'd1', name: 'Zed', personalCents: 5),
        FleetDriver(id: 'd2', name: 'Amy', personalCents: 2, creditCents: 100),
        FleetDriver(id: 'd3', name: 'Bob', status: 'left'),
        FleetDriver(id: 'd4', name: 'Cat'),
      ],
      cars: const [
        FleetCar(id: 'c1', plate: 'A1'),
        FleetCar(id: 'c2', plate: 'B2'),
      ],
      assignments: const [
        FleetAssignment(
          id: 'a1',
          carId: 'c1',
          driverId: 'd1',
          startDayKey: '2026-01-01',
          rentCents: 90000,
        ),
        FleetAssignment(
          id: 'a2',
          carId: 'c2',
          driverId: 'd2',
          startDayKey: '2026-01-01',
          rentCents: 0,
        ),
      ],
      bills: [bill('b1', driver: 'd1', due: '2026-10-01')],
    );
    final index = FleetIndex(data);
    final rows = fleetDriverRows(data, index, '2026-11-10');

    test('active first, then by name', () {
      expect([for (final r in rows) r.name], ['Amy', 'Cat', 'Zed', 'Bob']);
    });

    test('chips: owes, late, credit, no car, no plate fee', () {
      List<String> names(FleetDriverFilter f) => [
        for (final r in fleetFilterDriverRows(rows, f)) r.name,
      ];
      expect(names(const FleetDriverFilter(owes: true)), ['Zed']);
      expect(names(const FleetDriverFilter(late: true)), ['Zed']);
      expect(names(const FleetDriverFilter(credit: false, noCar: true)), [
        'Cat',
      ]);
      expect(names(const FleetDriverFilter(noFee: true)), ['Amy']);
      expect(names(const FleetDriverFilter(view: FleetDriverView.left)), [
        'Bob',
      ]);
      expect(
        names(const FleetDriverFilter(view: FleetDriverView.all)).length,
        4,
      );
      expect(names(const FleetDriverFilter(sort: FleetDriverSort.cents)), [
        'Amy',
        'Zed',
        'Cat',
      ]);
      expect(names(const FleetDriverFilter(query: 'b2')), ['Amy']);
    });

    test('counts follow the view', () {
      final c = fleetDriverCounts(rows, FleetDriverView.active);
      expect(
        [c.active, c.left, c.all, c.owes, c.noCar, c.noFee],
        [3, 1, 4, 1, 1, 1],
      );
    });
  });

  group('cars and paperwork', () {
    test('expiry states', () {
      expect(fleetExpiryState('', '2026-11-10'), FleetExpiry.missing);
      expect(fleetExpiryState('2026-11-09', '2026-11-10'), FleetExpiry.expired);
      expect(fleetExpiryState('2026-12-31', '2026-11-10'), FleetExpiry.soon);
      expect(fleetExpiryState('2027-06-01', '2026-11-10'), FleetExpiry.ok);
    });

    final data = FleetData(
      drivers: const [FleetDriver(id: 'd1', name: 'Amy')],
      cars: const [
        FleetCar(
          id: 'c1',
          plate: 'B2',
          registrationExpiry: '2027-06-01',
          diamondExpiry: '2027-07-01',
        ),
        FleetCar(id: 'c2', plate: 'A1', registrationExpiry: '2026-12-01'),
        FleetCar(id: 'c3', plate: 'C3'),
        FleetCar(id: 'c4', plate: 'D4', diamondExpiry: '2026-01-01'),
      ],
      assignments: const [
        FleetAssignment(
          id: 'a1',
          carId: 'c2',
          driverId: 'd1',
          startDayKey: '2026-01-01',
        ),
      ],
    );
    final index = FleetIndex(data);
    final rows = fleetCarRows(data, index, '2026-11-10');

    test('paperwork lists the soonest paper first and undated cars last', () {
      expect(
        [for (final r in fleetPaperworkRows(rows)) r.plate],
        ['D4', 'A1', 'B2', 'C3'],
      );
      final counts = fleetPaperworkCounts(rows);
      expect(counts[FleetExpiry.expired], 1);
      expect(counts[FleetExpiry.soon], 1);
      expect(counts[FleetExpiry.missing], 1);
      expect(counts[FleetExpiry.ok], 1);
    });

    test('cars filter by who has them and by paper state', () {
      List<String> plates(FleetCarFilter f) => [
        for (final r in fleetFilterCarRows(rows, f)) r.plate,
      ];
      expect(plates(const FleetCarFilter(view: FleetCarView.driver)), ['A1']);
      expect(plates(const FleetCarFilter(view: FleetCarView.free)), [
        'B2',
        'C3',
        'D4',
      ]);
      expect(plates(const FleetCarFilter(paper: FleetExpiry.expired)), ['D4']);
      expect(plates(const FleetCarFilter(query: 'amy')), ['A1']);
    });

    test('free cars are the ones with no open assignment', () {
      expect(
        [for (final c in fleetFreeCars(data, index)) c.plate],
        ['B2', 'C3', 'D4'],
      );
    });

    test('the car timeline puts friends under the driver, newest first', () {
      final d = FleetData(
        drivers: const [
          FleetDriver(id: 'd1', name: 'Amy'),
          FleetDriver(id: 'd2', name: 'Bob'),
        ],
        cars: const [FleetCar(id: 'c1', plate: 'A1')],
        assignments: const [
          FleetAssignment(
            id: 'a1',
            carId: 'c1',
            driverId: 'd1',
            startDayKey: '2025-01-01',
            endDayKey: '2025-12-31',
          ),
          FleetAssignment(
            id: 'a2',
            carId: 'c1',
            driverId: 'd2',
            startDayKey: '2026-02-01',
          ),
        ],
        friends: const [
          FleetFriend(
            id: 'f1',
            driverId: 'd1',
            carId: 'c1',
            name: 'Friend',
            fromDayKey: '2025-03-01',
            toDayKey: '2025-03-05',
          ),
          FleetFriend(
            id: 'f2',
            driverId: 'd1',
            carId: 'c1',
            name: 'Gone',
            fromDayKey: '2025-04-01',
            toDayKey: '2025-04-05',
            voided: true,
          ),
        ],
      );
      final t = fleetCarTimeline('c1', FleetIndex(d));
      expect([for (final e in t) e.driverName], ['Bob', 'Amy']);
      expect([for (final f in t.last.friends) f.name], ['Friend']);
    });

    test('the plate keeps the cars it was on, newest first', () {
      final car = FleetCar.fromMap('c1', {
        'plate': 'A1',
        'vin': 'NEW',
        'vehicleType': 'Camry',
        'vehicleSince': '2026-05-01',
        'vehicleHistory': [
          {'vin': 'OLD1', 'vehicleType': 'Prius', 'toDayKey': '2025-01-01'},
          {'vin': 'OLD2', 'vehicleType': 'Corolla', 'toDayKey': '2026-05-01'},
          {'vin': '', 'vehicleType': ''},
        ],
      });
      final h = fleetPlateCarHistory(car);
      expect([for (final c in h) c.vin], ['NEW', 'OLD2', 'OLD1']);
      expect(h.first.toDayKey, '');
      expect(fleetPlateCarHistory(null), isEmpty);
    });
  });

  group('driver tenure and track record', () {
    test('joined is the first start; days ignore overlaps and gaps', () {
      final t = fleetDriverTenure(const [
        FleetAssignment(
          id: 'a',
          startDayKey: '2026-01-01',
          endDayKey: '2026-01-31',
        ),
        FleetAssignment(
          id: 'b',
          startDayKey: '2026-01-15',
          endDayKey: '2026-02-10',
        ),
        FleetAssignment(
          id: 'c',
          startDayKey: '2026-06-01',
          endDayKey: '2026-06-11',
        ),
      ], '2026-11-10');
      expect(t.joinedDayKey, '2026-01-01');
      expect(t.days, 40 + 10);
      expect(fleetDriverTenure(const [], '2026-11-10').joinedDayKey, '');
    });

    test('tenure parts: years and months from days', () {
      final p = fleetTenureParts(365 * 3 + 70);
      expect([p.years, p.months], [3, 2]);
      expect(fleetTenureParts(12).days, 12);
    });

    test('the track record lists joined, cars, rent changes and left-back', () {
      final data = FleetData(
        drivers: const [FleetDriver(id: 'd1', name: 'Amy')],
        cars: const [
          FleetCar(id: 'c1', plate: 'A1'),
          FleetCar(id: 'c2', plate: 'B2'),
        ],
        assignments: const [
          FleetAssignment(
            id: 'a1',
            carId: 'c1',
            driverId: 'd1',
            startDayKey: '2025-01-01',
            endDayKey: '2025-06-01',
            rentCents: 80000,
          ),
          FleetAssignment(
            id: 'a2',
            carId: 'c2',
            driverId: 'd1',
            startDayKey: '2025-09-01',
            rentCents: 90000,
          ),
        ],
        bills: [
          bill(
            'late',
            kind: 'late_fee',
            amount: 5000,
            due: '2025-10-05',
            driver: 'd1',
          ),
        ],
        friends: const [
          FleetFriend(
            id: 'f',
            driverId: 'd1',
            carId: 'c2',
            name: 'Friend',
            fromDayKey: '2025-10-10',
            toDayKey: '2025-10-12',
          ),
        ],
        notes: const [
          FleetNote(
            id: 'n',
            driverId: 'd1',
            text: 'Called',
            atMs: 1763000000000,
          ),
        ],
      );
      final index = FleetIndex(data);
      final t = fleetDriverTimeline(data.drivers.first, index);
      final kinds = [for (final e in t) e.kind];
      expect(
        kinds,
        containsAll([
          FleetProfileKind.joined,
          FleetProfileKind.carGiven,
          FleetProfileKind.carReturned,
          FleetProfileKind.rentChange,
          FleetProfileKind.leftBack,
          FleetProfileKind.friend,
          FleetProfileKind.lateFee,
          FleetProfileKind.note,
        ]),
      );
      // Newest first.
      final days = [for (final e in t) e.dayKey];
      expect(days, [...days]..sort((a, b) => b.compareTo(a)));
      final left = t.firstWhere((e) => e.kind == FleetProfileKind.leftBack);
      expect(left.leftDayKey, '2025-06-01');
      final change = t.firstWhere((e) => e.kind == FleetProfileKind.rentChange);
      expect([change.fromRentCents, change.rentCents], [80000, 90000]);
    });

    test('bills and payments views', () {
      expect(
        fleetBillInView(bill('a', status: 'waived'), FleetBillView.waived),
        isTrue,
      );
      expect(fleetBillInView(bill('a'), FleetBillView.paid), isFalse);
      const imported = FleetPayment(id: 'p', imported: true, method: 'other');
      expect(fleetPaymentInView(imported, FleetPaymentView.import), isTrue);
      expect(fleetPaymentInView(imported, FleetPaymentView.other), isFalse);
      expect(
        fleetPaymentInView(
          const FleetPayment(id: 'q', method: 'zelle'),
          FleetPaymentView.zelle,
        ),
        isTrue,
      );
    });
  });

  group('who sees Fleet', () {
    test('the owner and full-access staff hold everything', () {
      final a = fleetAccess(isStaff: false, permissions: const []);
      expect([a.staff, a.admin], [true, true]);
    });

    test('Fleet staff cannot do the admin things; a Fleet admin does both', () {
      final s = fleetAccess(isStaff: true, permissions: const ['fleet']);
      expect([s.staff, s.admin], [true, false]);
      final a = fleetAccess(isStaff: true, permissions: const ['fleet_admin']);
      expect([a.staff, a.admin], [true, true]);
      final none = fleetAccess(isStaff: true, permissions: const ['parking']);
      expect([none.staff, none.admin], [false, false]);
    });

    test('the row needs the service, a business and the access', () {
      const yes = FleetAccess(staff: true, admin: false);
      expect(
        showsFleetRow(services: const ['fleet'], businessId: 'b', access: yes),
        isTrue,
      );
      expect(
        showsFleetRow(
          services: const ['carParking'],
          businessId: 'b',
          access: yes,
        ),
        isFalse,
      );
      expect(
        showsFleetRow(services: const ['fleet'], businessId: '', access: yes),
        isFalse,
      );
      expect(
        showsFleetRow(
          services: const ['fleet'],
          businessId: 'b',
          access: FleetAccess.none,
        ),
        isFalse,
      );
    });

    test('Fleet is on when the business doc says so or lists the service', () {
      expect(
        fleetEnabled({
          'fleet': {'enabled': true},
        }),
        isTrue,
      );
      expect(
        fleetEnabled({
          'enabledServices': ['fleet'],
        }),
        isTrue,
      );
      expect(
        fleetEnabled({
          'enabledServices': ['carParking'],
        }),
        isFalse,
      );
      expect(fleetEnabled(null), isFalse);
    });
  });

  group('requests and refusals', () {
    test('every request names its action and the business', () {
      final r = FleetRequests.paymentRecord(
        'b1',
        driverId: 'd1',
        amountCents: 5000,
        method: 'cash',
        paidDayKey: '2026-11-10',
      );
      expect(r['action'], 'payment_record');
      expect(r['businessId'], 'b1');
      expect(r['amountCents'], 5000);
      expect(FleetRequests.paymentUndo('b1', 'p1'), {
        'action': 'payment_undo',
        'businessId': 'b1',
        'paymentId': 'p1',
      });
      expect(
        FleetRequests.assignmentStart(
          'b1',
          driverId: 'd',
          carId: 'c',
          startDayKey: '2026-11-01',
          rentCents: 90000,
          period: 'monthly',
          dueDay: 1,
        )['action'],
        'assignment_start',
      );
      expect(
        FleetRequests.bankAssign(
          'b1',
          creditId: 'x',
          driverId: 'd',
        )['creditId'],
        'x',
      );
    });

    test('a new driver sends no status; an edit does', () {
      final add = FleetRequests.driverSave('b1', name: 'Amy');
      expect((add['driver'] as Map).containsKey('status'), isFalse);
      expect(add.containsKey('driverId'), isFalse);
      final edit = FleetRequests.driverSave(
        'b1',
        driverId: 'd1',
        name: 'Amy',
        status: 'left',
      );
      expect((edit['driver'] as Map)['status'], 'left');
      expect(edit['driverId'], 'd1');
    });

    test('a moved plate says so; a typo does not', () {
      final moved = FleetRequests.carSave(
        'b1',
        carId: 'c',
        plate: 'A1',
        plateMoved: true,
        movedSinceDayKey: '2026-05-01',
      );
      expect(((moved['car'] as Map)['vehicleChange'] as Map)['moved'], true);
      final typo = FleetRequests.carSave('b1', carId: 'c', plate: 'A1');
      expect((typo['car'] as Map).containsKey('vehicleChange'), isFalse);
    });

    test('a refusal reason is kept only when the server names a known one', () {
      expect(
        parseFleetFailure('failed-precondition', {
          'reason': 'fleet_car_taken',
        }).reason,
        'fleet_car_taken',
      );
      expect(
        parseFleetFailure('failed-precondition', {'reason': 'made_up'}).reason,
        '',
      );
      expect(parseFleetFailure('unavailable', null).offline, isTrue);
      expect(parseFleetFailure('permission-denied', null).notAllowed, isTrue);
    });
  });

  group('settings', () {
    test('defaults: day 5, full rule, drivers see only this business', () {
      final s = readFleetSettings(null);
      expect(
        [s.lateFeeDay, s.returnRule, s.driversSeeOnly, s.whatsappEnabled],
        [5, 'full', true, false],
      );
    });

    test('reads what the business saved', () {
      final s = readFleetSettings({
        'fleet': {
          'settings': {
            'lateFee': {
              'cents': 5000,
              'dayOfMonth': 8,
              'firstMonth': '2026-11',
            },
            'returnRule': 'days',
            'driversSeeOnlyThisBusiness': false,
            'zelle': {'name': 'Landa', 'handle': 'pay@landa.test'},
            'whatsapp': {
              'enabled': true,
              'onlyDriverIds': ['d1', '', 7],
            },
          },
        },
      });
      expect(
        [s.lateFeeCents, s.lateFeeDay, s.lateFeeFirstMonth],
        [5000, 8, '2026-11'],
      );
      expect(
        [s.returnRule, s.driversSeeOnly, s.zelleName, s.zelleHandle],
        ['days', false, 'Landa', 'pay@landa.test'],
      );
      expect(s.whatsappEnabled, isTrue);
      expect(s.whatsappOnlyDriverIds, ['d1']);
    });

    test(
      'the settings request carries the late fee, the rule, Zelle and the switch',
      () {
        final r = FleetRequests.settingsSave(
          'b1',
          const FleetSettingsView(
            lateFeeCents: 5000,
            lateFeeDay: 8,
            lateFeeFirstMonth: '2026-11',
            returnRule: 'days',
          ),
        );
        final s = r['settings'] as Map;
        expect((s['lateFee'] as Map)['cents'], 5000);
        expect(s['returnRule'], 'days');
        expect(s['driversSeeOnlyThisBusiness'], true);
      },
    );
  });

  group('bank deposits and the pay-day schedule', () {
    test('the schedule is cleaned like the server cleans it', () {
      final s = cleanFleetBankSchedule({
        'every': 20,
        'fromHour': 9,
        'toHour': 5,
        'monthDays': [3, 1, 1, 40, 0],
        'mondays': true,
      });
      expect(s.every, 0);
      expect([s.fromHour, s.toHour], [7, 23]);
      expect(s.monthDays, [1, 3]);
      expect(s.mondays, isTrue);
    });

    test('the quote matches the documented estimate', () {
      // 15 min, 7 AM-11 PM, the 1st-3rd = 192 checks = $23.04 (FLEET.md 8).
      final q = fleetBankScheduleQuote(
        const FleetBankSchedule(every: 15, monthDays: [1, 2, 3]),
      );
      expect(q.perDay, 64);
      expect(q.perMonth, 192);
      expect(q.monthCents, 2304);
      expect(fleetBankScheduleQuote(const FleetBankSchedule()).perMonth, 0);
    });

    test('the status answer is read defensively', () {
      final s = readFleetBankStatus({
        'schedule': {
          'every': 30,
          'monthDays': [1],
        },
        'quote': {'centsEach': 10},
        'bank': {
          'connected': true,
          'institutionName': 'Chase',
          'accountMask': '1234',
        },
        'waiting': [
          {
            'id': 'c1',
            'amountCents': 35017,
            'senderName': 'AMY',
            'reason': 'two_drivers',
          },
          {'id': '', 'amountCents': 5},
          {'id': 'c2', 'amountCents': 0},
        ],
        'removed': [
          {'paymentId': 'p1', 'driverId': 'd1', 'amountCents': 1000},
        ],
      });
      expect(s.connected, isTrue);
      expect(s.quote.centsEach, 10);
      expect(s.waiting.length, 1);
      expect(s.waiting.first.reason, 'two_drivers');
      expect(s.removed.single.paymentId, 'p1');
      expect(readFleetBankStatus(null).connected, isFalse);
    });

    test('hours read on a 12-hour clock', () {
      expect(fleetHourLabel(7), '7 AM');
      expect(fleetHourLabel(23), '11 PM');
      expect(fleetHourLabel(12), 'noon');
      expect(fleetHourLabel(24), 'midnight');
      expect(fleetHourLabel(7, language: 'fr'), '7 h');
    });
  });
}
