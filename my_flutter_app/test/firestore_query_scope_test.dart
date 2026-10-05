import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:cloud_firestore/cloud_firestore.dart' show Timestamp;
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/business_activity_queries.dart';
import 'package:my_flutter_app/services/business_parking_entry.dart';
import 'package:my_flutter_app/services/business_service_overview.dart';
import 'package:my_flutter_app/services/business_transport_jobs.dart';
import 'package:my_flutter_app/services/firestore_query_spec.dart';
import 'package:my_flutter_app/services/known_car_lookup.dart';
import 'package:my_flutter_app/services/parking_month_statement.dart';

/// The business screens used to listen to whole collections - every parked
/// car, barrel, freight shipment, transport job, ledger activity and expense
/// the business ever had - and the ledger capped some of them with an
/// unordered `limit`, which made its totals wrong past the cap. These tests
/// hold the replacement queries to three rules:
///
///  1. each names the business (the marketplace is the one public read);
///  2. each is bounded - open work, a date window, or an ordered page - and
///     never a `limit` without an `orderBy`;
///  3. `firestore.indexes.json` holds the composite index its exact shape
///     needs, field for field.
///
/// And, the way `functions/test/parking-month-scope.test.js` does for the
/// server, they replay the narrow queries in memory and require the SAME
/// answer the whole history gave: the tile counts, and a month's bills.

/// What Firestore would answer for [spec] over [rows], in memory. Mirrors
/// Firestore's own rules: an inequality or `not-in` skips rows that lack the
/// field (or hold null), and values compare within their own type.
bool specMatches(FirestoreQuerySpec spec, Map<String, dynamic> row) {
  Object? norm(Object? v) => switch (v) {
    Timestamp t => t.millisecondsSinceEpoch,
    DateTime d => d.millisecondsSinceEpoch,
    _ => v,
  };
  int? compare(Object? a, Object? b) {
    if (a is num && b is num) return a.compareTo(b);
    if (a is String && b is String) return a.compareTo(b);
    return null;
  }

  for (final f in spec.filters) {
    final has = row.containsKey(f.field);
    final value = norm(row[f.field]);
    final target = norm(f.value);
    final ok = switch (f.op) {
      QueryFilterOp.equal => has && value == target,
      QueryFilterOp.whereIn =>
        has && (f.value as Iterable).map(norm).contains(value),
      QueryFilterOp.notIn =>
        has && value != null && !(f.value as Iterable).map(norm).contains(value),
      QueryFilterOp.notEqual => has && value != null && value != target,
      QueryFilterOp.greaterOrEqual => (compare(value, target) ?? -1) >= 0,
      QueryFilterOp.less => (compare(value, target) ?? 1) < 0,
      QueryFilterOp.isNull => has && value == null,
    };
    if (!ok) return false;
  }
  return true;
}

List<Map<String, dynamic>> run(
  FirestoreQuerySpec spec,
  List<Map<String, dynamic>> rows,
) => [
  for (final row in rows)
    if (specMatches(spec, row)) row,
];

/// `functions/parking_occupancy.js` occupancyEndMs, which the
/// syncParkedCarOccupancy trigger stamps on every parkedCars row.
int occupancyEndMs(Map<String, dynamic> row) {
  DateTime? at(Object? v) => v is Timestamp ? v.toDate() : v as DateTime?;
  final start = at(row['parkingDate']);
  if (start == null) return 0;
  final end = at(row['parkingEndDate']);
  if (end == null) return 8640000000000000;
  return end.millisecondsSinceEpoch;
}

Timestamp ts(String iso) =>
    Timestamp.fromDate(DateTime.parse('${iso}T12:00:00Z'));

const _business = 'biz-1';

void main() {
  group('the query spec', () {
    test('finds its business and refuses an empty one', () {
      expect(barrelShipmentsOpenSpec(' biz-1 ').businessId, 'biz-1');
      expect(barrelShipmentsOpenSpec('').isBusinessScoped, isFalse);
      expect(marketplaceCarsSpec(pages: 1).isBusinessScoped, isFalse);
    });

    test('a limit without an orderBy is not a bound', () {
      const random = FirestoreQuerySpec(
        collection: 'lotExpenseEntries',
        filters: [QueryFilterSpec('businessId', QueryFilterOp.equal, 'b')],
        limit: 2000,
      );
      expect(random.isBounded, isFalse);
      const whole = FirestoreQuerySpec(
        collection: 'parkedCars',
        filters: [QueryFilterSpec('businessId', QueryFilterOp.equal, 'b')],
      );
      expect(whole.isBounded, isFalse);
      expect(random.copyWith().isBounded, isFalse);
    });

    test('derives the composite index Firestore asks for', () {
      // Equalities alone are served by merged single-field indexes.
      expect(transportOpportunitiesOpenSpec(_business).compositeIndex, isNull);
      expect(knownCarVinSpecs(_business, 'v').first.compositeIndex, isNull);
      // Equality + not-in: the inequality field last, ascending.
      expect(barrelShipmentsOpenSpec(_business).compositeIndex, const [
        IndexFieldSpec('businessId'),
        IndexFieldSpec('status'),
      ]);
      // Equality + orderBy: the order's direction.
      expect(
        businessHistoryPageSpec(
          BusinessHistoryCollection.parkedCars,
          _business,
        ).compositeIndex,
        const [
          IndexFieldSpec('businessId'),
          IndexFieldSpec('parkingDate', descending: true),
        ],
      );
      // A range ordered by its own field.
      expect(
        lotActivitiesBetweenSpec(_business, 1, 2).compositeIndex,
        const [
          IndexFieldSpec('businessId'),
          IndexFieldSpec('activityDate', descending: true),
        ],
      );
    });

    test('merges rows from several queries, each once, first copy kept', () {
      final merged = mergeById<Map<String, Object>>(
        [
          [
            {'id': 'a', 'n': 1},
          ],
          [
            {'id': 'a', 'n': 2},
            {'id': 'b', 'n': 3},
          ],
          [
            {'id': '', 'n': 4},
          ],
        ],
        (row) => '${row['id']}',
      );
      expect(merged, [
        {'id': 'a', 'n': 1},
        {'id': 'b', 'n': 3},
      ]);
    });
  });

  group('every business-screen query', () {
    final indexes =
        (jsonDecode(File('firestore.indexes.json').readAsStringSync())
                as Map<String, dynamic>)['indexes']
            as List;
    final now = DateTime(2026, 10, 5, 9);
    final specs = <String, FirestoreQuerySpec>{
      'home: parking on the lot': parkedCarsOnLotSpec(_business, now),
      'home: parking still owed': parkedCarsUnsettledSpec(_business),
      'home: open barrels': barrelShipmentsOpenSpec(_business),
      'home: open freight': freightShipmentsOpenSpec(_business),
      'home: open transport jobs': transportRequestsOpenSpec(_business),
      'home: open opportunities': transportOpportunitiesOpenSpec(_business),
      for (final c in BusinessHistoryCollection.values)
        'home: ${c.path} history page': businessHistoryPageSpec(c, _business),
      'open containers': openContainersSpec(_business),
      'open container lines': openContainerLinesSpec(_business),
      for (final spec in knownCarRecentSpecs(_business))
        'VIN memory: recent ${spec.collection}': spec,
      for (final spec in knownCarVinSpecs(_business, '1HGCM82633A004352'))
        'VIN memory: exact ${spec.collection}': spec,
      'month end: stays': parkedCarsEndingFromSpec(_business, 1),
      'ledger: activities in a window': lotActivitiesBetweenSpec(
        _business,
        Timestamp.fromMillisecondsSinceEpoch(1),
        Timestamp.fromMillisecondsSinceEpoch(2),
      ),
      'month end: unsettled activities': lotActivitiesUnsettledSpec(_business),
      'month end: undated activities': lotActivitiesUndatedSpec(_business),
      'ledger: expenses in a window': lotExpenseEntriesForMonthsSpec(
        _business,
        '2026-01',
        '2026-12',
      ),
    };

    bool hasIndex(FirestoreQuerySpec spec, List<IndexFieldSpec> fields) {
      // Equality fields may sit in any order ahead of the last field, which
      // must match exactly; Firestore matches the same way.
      final equalities = fields.sublist(0, fields.length - 1);
      final last = fields.last;
      return indexes.any((raw) {
        final index = raw as Map<String, dynamic>;
        if (index['collectionGroup'] != spec.collection ||
            index['queryScope'] != 'COLLECTION') {
          return false;
        }
        final got = [
          for (final f in index['fields'] as List)
            if ((f as Map)['fieldPath'] != '__name__')
              IndexFieldSpec(
                f['fieldPath'] as String,
                descending: f['order'] == 'DESCENDING',
              ),
        ];
        if (got.length != fields.length || got.last != last) return false;
        final head = got.sublist(0, got.length - 1).map((f) => f.fieldPath);
        return head.toSet().containsAll(equalities.map((f) => f.fieldPath));
      });
    }

    for (final entry in specs.entries) {
      test('${entry.key} names the business and is bounded', () {
        expect(entry.value.isBusinessScoped, isTrue, reason: '${entry.value}');
        expect(entry.value.isBounded, isTrue, reason: '${entry.value}');
      });
      test('${entry.key} has its composite index', () {
        final fields = entry.value.compositeIndex;
        if (fields == null) return;
        expect(
          hasIndex(entry.value, fields),
          isTrue,
          reason: 'firestore.indexes.json needs ${entry.value.collection} '
              '$fields for ${entry.value}',
        );
      });
    }

    test('the marketplace pages, and its narrowed pages are indexed too', () {
      for (final spec in [
        marketplaceCarsSpec(pages: 1),
        marketplaceCarsSpec(pages: 3, make: 'Toyota'),
        marketplaceCarsSpec(pages: 2, make: 'Toyota', model: 'Corolla'),
      ]) {
        expect(spec.isBounded, isTrue);
        expect(spec.orderBy, 'createdAt');
        expect(hasIndex(spec, spec.compositeIndex!), isTrue, reason: '$spec');
      }
      expect(marketplaceCarsSpec(pages: 3).limit, marketplacePageSize * 3);
      expect(marketplaceCarsSpec(pages: 0).limit, marketplacePageSize);
      // A model without a make is not a query anyone can ask from the sheet.
      expect(
        marketplaceCarsSpec(pages: 1, model: 'Corolla').filters.length,
        1,
      );
    });

    test('the index file is valid JSON in the shape the CLI deploys', () {
      for (final raw in indexes) {
        final index = raw as Map<String, dynamic>;
        expect(index.keys, containsAll(['collectionGroup', 'queryScope', 'fields']));
        expect(['COLLECTION', 'COLLECTION_GROUP'], contains(index['queryScope']));
        final fields = index['fields'] as List;
        expect(fields.length, greaterThanOrEqualTo(2));
        for (final f in fields) {
          final field = f as Map<String, dynamic>;
          expect(field['fieldPath'], isA<String>());
          expect(
            field.containsKey('order') || field.containsKey('arrayConfig'),
            isTrue,
          );
        }
      }
      final shapes = [for (final i in indexes) jsonEncode(i)];
      expect(shapes.toSet().length, shapes.length, reason: 'no duplicates');
    });
  });

  group('the home tiles count the same from open work as from history', () {
    // A business's whole history, randomised but reproducible. Every status
    // vocabulary the tiles know, plus ones they do not.
    final random = Random(7);
    final now = DateTime(2026, 10, 5, 9);
    T pick<T>(List<T> from) => from[random.nextInt(from.length)];
    const shippingStatuses = [
      'pending_payment',
      'not_started',
      'in_transit',
      'arrived',
      'completed',
      'cancelled',
      'refunded',
      'delivered',
      'sold',
      'brand_new_status',
    ];
    final barrels = [
      for (var i = 0; i < 400; i++)
        {'id': 'b$i', 'businessId': _business, 'status': pick(shippingStatuses)},
      // Someone else's barrels never count.
      for (var i = 0; i < 50; i++)
        {'id': 'x$i', 'businessId': 'other', 'status': 'in_transit'},
    ];
    final jobs = [
      for (var i = 0; i < 300; i++)
        {
          'id': 't$i',
          'businessId': _business,
          'status': pick([
            'scheduled',
            'picked_up',
            'in_transit',
            'delivered',
            'cancelled',
            'completed',
            'refunded',
          ]),
        },
    ];
    final opportunities = [
      for (var i = 0; i < 200; i++)
        {
          'id': 'o$i',
          'businessId': _business,
          'status': pick(['open', 'quoted', 'selected', 'expired', 'withdrawn']),
        },
    ];
    final cars = <Map<String, dynamic>>[
      for (var i = 0; i < 600; i++)
        () {
          final start = now.subtract(Duration(days: random.nextInt(900)));
          final row = <String, dynamic>{
            'id': 'p$i',
            'businessId': _business,
            'source': random.nextBool() ? 'business' : 'customer',
            'status': pick(['parked', 'active', 'released', 'cancelled']),
            'paymentStatus': pick([
              'succeeded',
              'paid',
              'not_required',
              'awaiting_direct_payment',
              'awaiting_payment_link',
              'pending',
            ]),
            'parkingDate': Timestamp.fromDate(start),
            if (random.nextInt(4) > 0)
              'parkingEndDate': Timestamp.fromDate(
                start.add(Duration(days: random.nextInt(60))),
              ),
          };
          return {...row, 'occupancyEndMs': occupancyEndMs(row)};
        }(),
    ];

    test('barrels and freight: open = not final, exactly', () {
      final full = businessServiceOpenCount([
        for (final row in barrels)
          if (row['businessId'] == _business) '${row['status']}',
      ]);
      final open = run(barrelShipmentsOpenSpec(_business), barrels);
      expect(businessServiceOpenCount(open.map((r) => '${r['status']}')), full);
      expect(open.length, full, reason: 'nothing closed is read');
      expect(full, greaterThan(0));
      expect(full, lessThan(400));
      expect(
        freightShipmentsOpenSpec(_business).filters.last.value,
        barrelShipmentsOpenSpec(_business).filters.last.value,
      );
    });

    test('transport: open bids + undelivered jobs, exactly', () {
      final full = businessTransportNeedsYouCount(
        opportunityStatuses: opportunities.map((r) => '${r['status']}'),
        jobStatuses: jobs.map((r) => '${r['status']}'),
      );
      final narrow = businessTransportNeedsYouCount(
        opportunityStatuses: run(
          transportOpportunitiesOpenSpec(_business),
          opportunities,
        ).map((r) => '${r['status']}'),
        jobStatuses: run(
          transportRequestsOpenSpec(_business),
          jobs,
        ).map((r) => '${r['status']}'),
      );
      expect(narrow, full);
      expect(full, greaterThan(0));
    });

    test('parking: money owed, exactly - however old the stay', () {
      final full = businessParkingUnpaidCount(cars);
      final narrow = mergeById<Map<String, dynamic>>([
        run(parkedCarsOnLotSpec(_business, now), cars),
        run(parkedCarsUnsettledSpec(_business), cars),
      ], (row) => '${row['id']}');
      expect(businessParkingUnpaidCount(narrow), full);
      expect(full, greaterThan(0));
      // And it reads a fraction of the lot's history.
      expect(narrow.length, lessThan(cars.length));
    });

    test('parking: every car still on the lot is in the open work', () {
      final onLot = run(parkedCarsOnLotSpec(_business, now), cars);
      for (final row in cars) {
        if (businessParkingEndLabel(row, now: now) !=
                BusinessParkingEndLabel.ended &&
            row['status'] != 'cancelled') {
          expect(onLot, contains(row), reason: '${row['id']} is on the lot');
        }
      }
    });

    test('the floor for "on the lot" is local midnight today', () {
      expect(
        parkingTodayFloorMs(DateTime(2026, 10, 5, 23, 59)),
        DateTime(2026, 10, 5).millisecondsSinceEpoch,
      );
    });
  });

  group('a month\'s bills come out the same from the month\'s reads', () {
    // The fixture `functions/test/parking-month-scope.test.js` replays for
    // the server's month-end job, replayed here through the app's queries.
    final nowUtc = DateTime.utc(2026, 10, 1, 13);
    const month = '2026-09';
    Map<String, dynamic> car(String id, Map<String, dynamic> fields) {
      final row = <String, dynamic>{
        'id': id,
        'businessId': _business,
        'customerPhone': '555000${id.length}$id',
        'customerName': id,
        'dailyRate': 10,
        'totalCostCents': 9000,
        'status': 'parked',
        ...fields,
      };
      return {...row, 'occupancyEndMs': occupancyEndMs(row)};
    }

    final cars = [
      car('old-closed-paid', {
        'parkingDate': ts('2025-01-01'),
        'parkingEndDate': ts('2025-02-01'),
        'paymentStatus': 'succeeded',
        'amountPaidCents': 31000,
      }),
      car('old-open', {'parkingDate': ts('2024-05-01')}),
      car('ends-in-month', {
        'parkingDate': ts('2026-08-20'),
        'parkingEndDate': ts('2026-09-05'),
      }),
      car('ended-day-before', {
        'parkingDate': ts('2026-08-01'),
        'parkingEndDate': ts('2026-08-31'),
      }),
      car('ends-first-day', {
        'parkingDate': ts('2026-08-25'),
        'parkingEndDate': ts('2026-09-01'),
      }),
      car('in-month', {
        'parkingDate': ts('2026-09-10'),
        'parkingEndDate': ts('2026-09-12'),
      }),
      car('after-month', {'parkingDate': ts('2026-10-03')}),
      car('cancelled', {'parkingDate': ts('2026-09-02'), 'status': 'cancelled'}),
      car('released-open', {
        'parkingDate': ts('2026-07-01'),
        'status': 'released',
      }),
    ];
    Map<String, dynamic> activity(String id, Map<String, dynamic> fields) => {
      'id': id,
      'businessId': _business,
      'feeCents': 5000,
      'customerPhone': '5559990000',
      'customerName': 'Activity customer',
      'paymentStatus': 'awaiting_direct_payment',
      ...fields,
    };
    final activities = [
      activity('old-paid', {
        'activityDate': ts('2025-03-01'),
        'paymentStatus': 'succeeded',
      }),
      activity('old-unpaid', {'activityDate': ts('2026-06-15')}),
      activity('old-part-paid', {
        'activityDate': ts('2026-07-15'),
        'amountPaidCents': 2000,
      }),
      activity('in-month-paid', {
        'activityDate': ts('2026-09-03'),
        'paymentStatus': 'succeeded',
      }),
      activity('in-month-unpaid', {'activityDate': ts('2026-09-30')}),
      activity('first-day', {'activityDate': ts('2026-09-01')}),
      activity('future', {'activityDate': ts('2026-10-02')}),
      activity('voided', {'activityDate': ts('2026-09-04'), 'voided': true}),
      activity('undated', {
        'activityDate': null,
        'createdAt': ts('2026-09-08'),
      }),
    ];

    // The screen's own bounds: the month's UTC days, end exclusive.
    final days = parkingMonthDays(month)!;
    const dayMs = 24 * 60 * 60 * 1000;
    final startMs = days.first * dayMs;
    final endMs = (days.last + 1) * dayMs;

    List<Map<String, dynamic>> narrowActivities() => mergeById<Map<String, dynamic>>([
      run(
        lotActivitiesBetweenSpec(
          _business,
          Timestamp.fromMillisecondsSinceEpoch(startMs),
          Timestamp.fromMillisecondsSinceEpoch(endMs),
        ),
        activities,
      ),
      run(lotActivitiesUnsettledSpec(_business), activities),
      run(lotActivitiesUndatedSpec(_business), activities),
    ], (row) => '${row['id']}');

    ({int billed, int collected, int owed, int older, int due, int cars,
        int owing, int acts, String bills}) shape(ParkingMonthSummary s) => (
      billed: s.billedCents,
      collected: s.collectedCents,
      owed: s.owedCents,
      older: s.olderOwedCents,
      due: s.dueCents,
      cars: s.carsOnLot,
      owing: s.carsOwing,
      acts: s.activitiesInMonth,
      bills: ([for (final b in s.bills) b.id]..sort()).join(','),
    );

    test('the narrow reads give exactly the whole-history summary', () {
      final full = parkingMonthSummary(cars, month, nowUtc, activities);
      final narrow = parkingMonthSummary(
        run(parkedCarsEndingFromSpec(_business, startMs), cars),
        month,
        nowUtc,
        narrowActivities(),
      );
      expect(shape(narrow), shape(full));
      expect(full.customersOwing, isNotEmpty);
      expect(full.bills.map((b) => b.id), contains('old-open'));
      expect(full.bills.map((b) => b.id), contains('ends-first-day'));
    });

    test('while reading far less than the history', () {
      final read = run(parkedCarsEndingFromSpec(_business, startMs), cars)
          .map((r) => r['id']);
      expect(read, isNot(contains('old-closed-paid')));
      expect(read, isNot(contains('ended-day-before')));
      expect(narrowActivities().map((r) => r['id']), isNot(contains('old-paid')));
    });
  });

  group('the lot ledger reads the period on screen', () {
    test('the window is the report year, widened to the activity range', () {
      expect(
        lotLedgerWindow(
          month: '2026-10',
          activityStart: '2026-10',
          activityEnd: '2026-10',
        ),
        (start: '2026-01', end: '2026-12'),
      );
      // "Last three months" in January reaches back into last year.
      expect(
        lotLedgerWindow(
          month: '2027-01',
          activityStart: '2026-11',
          activityEnd: '2027-01',
        ),
        (start: '2026-11', end: '2027-12'),
      );
      // Looking at an old year's report with this month's activity tab.
      expect(
        lotLedgerWindow(
          month: '2024-03',
          activityStart: '2026-10',
          activityEnd: '2026-10',
        ),
        (start: '2024-01', end: '2026-10'),
      );
    });

    test('expense months are an inclusive, exact string range', () {
      final spec = lotExpenseEntriesForMonthsSpec(_business, '2026-01', '2026-12');
      final rows = [
        for (final m in ['2025-12', '2026-01', '2026-07', '2026-12', '2027-01'])
          {'id': m, 'businessId': _business, 'month': m},
      ];
      expect(run(spec, rows).map((r) => r['id']), [
        '2026-01',
        '2026-07',
        '2026-12',
      ]);
      expect(nextMonthKey('2026-12'), '2027-01');
      expect(nextMonthKey('2026-09'), '2026-10');
      expect(nextMonthKey('bad'), 'bad');
    });

    test('the expense limit that sampled a random 2,000 rows is gone', () {
      final screen = File('lib/screens/lot_ledger_screen.dart').readAsStringSync();
      expect(screen, isNot(contains('.limit(2000)')));
      expect(screen, isNot(contains("scoped('parkedCars').limit(")));
      expect(screen, isNot(contains("scoped('lotExpenseEntries').limit(")));
      expect(screen, contains('_syncWindow()'));
    });
  });

  group('the home menu history', () {
    test('pages the selected service, or every enabled one', () {
      final enabled = {
        ServiceCategory.parking,
        ServiceCategory.barrels,
        ServiceCategory.sales,
      };
      expect(
        businessHistoryCollectionsFor(
          selected: ServiceCategory.all,
          enabled: enabled,
        ),
        [
          BusinessHistoryCollection.parkedCars,
          BusinessHistoryCollection.barrelShipments,
        ],
      );
      expect(
        businessHistoryCollectionsFor(
          selected: ServiceCategory.barrels,
          enabled: enabled,
        ),
        [BusinessHistoryCollection.barrelShipments],
      );
      // A service the business does not offer has no history to page.
      expect(
        businessHistoryCollectionsFor(
          selected: ServiceCategory.freight,
          enabled: enabled,
        ),
        isEmpty,
      );
    });
  });

  group('the VIN memory', () {
    test('keeps only rows that name a VIN, uppercased', () {
      final cars = knownCarsFromRows([
        {'vinNumber': '1hgcm82633a004352', 'carMake': 'Honda'},
        {'vinNumber': '', 'carMake': 'Nothing'},
        {'carMake': 'No VIN'},
      ]);
      expect(cars.map((c) => c.vin), ['1HGCM82633A004352']);
    });

    test('looks an old VIN up exactly, both collections, no index needed', () {
      final specs = knownCarVinSpecs(_business, ' 1hgcm82633a004352 ');
      expect(specs.map((s) => s.collection), ['parkedCars', 'lotActivities']);
      for (final spec in specs) {
        expect(spec.filters.last.value, '1HGCM82633A004352');
        expect(spec.compositeIndex, isNull);
      }
      expect(
        knownCarRecentSpecs(_business).map((s) => s.limit),
        everyElement(knownCarRecentLimit),
      );
    });
  });
}
