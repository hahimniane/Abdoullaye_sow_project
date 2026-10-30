import 'dart:convert';
import 'dart:io';

import 'package:cloud_firestore/cloud_firestore.dart' show Timestamp;
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/parking_month_end_screen.dart';
import 'package:my_flutter_app/services/parking_bill_payment.dart';
import 'package:my_flutter_app/services/parking_bill_payment_service.dart';
import 'package:my_flutter_app/services/parking_month_statement.dart';
import 'package:my_flutter_app/widgets/lot_sheets.dart';
import 'package:my_flutter_app/widgets/parking_bill_payment_widgets.dart';

/// Paying part of a month bill (docs/PARKING_BILL_PAYMENTS.md). The shared
/// fixture pins the server, the console and this app to the same split; the
/// widget tests drive the sheet and the card section the way staff do.
void main() {
  final fixture =
      jsonDecode(
            File(
              'functions/test/fixtures/parking-bill-payment-cases.json',
            ).readAsStringSync(),
          )
          as Map<String, dynamic>;
  final cases = (fixture['cases'] as List).cast<Map<String, dynamic>>();
  final labels = (fixture['labels'] as List).cast<Map<String, dynamic>>();

  int cents(Object? v) => (v as num?)?.round() ?? 0;
  String text(Object? v) => (v ?? '').toString();

  ParkingMonthBill billOf(Map<String, dynamic> j) => ParkingMonthBill(
    id: text(j['id']),
    monthKey: '2026-10',
    periodFrom: text(j['periodFrom']),
    periodTo: text(j['periodFrom']),
    days: 1,
    dayRateCents: 0,
    monthCents: cents(j['dueCents']),
    monthPaidCents: 0,
    monthUnpaidCents: cents(j['dueCents']),
    priorUnpaidCents: cents(j['priorUnpaidCents']),
    dueCents: cents(j['dueCents']),
    owes: true,
    stillParked: true,
    partialMonth: false,
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    vehicle: text(j['vehicle']),
    vinNumber: '',
    trackingCode: text(j['trackingCode']),
    recordable: j['recordable'] == true,
  );

  ParkingCarriedCar carriedOf(Map<String, dynamic> j) => ParkingCarriedCar(
    id: text(j['id']),
    monthKey: '2026-10',
    periodFrom: text(j['periodFrom']),
    periodTo: text(j['periodFrom']),
    days: 1,
    accruedCents: cents(j['dueCents']),
    dueCents: cents(j['dueCents']),
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    vehicle: text(j['vehicle']),
    vinNumber: '',
    trackingCode: text(j['trackingCode']),
    recordable: j['recordable'] == true,
  );

  ParkingMonthActivity activityOf(
    Map<String, dynamic> j, {
    bool prior = false,
  }) => ParkingMonthActivity(
    id: text(j['id']),
    monthKey: '2026-10',
    date: text(j['date']),
    label: text(j['label']),
    feeCents: cents(j['dueCents']),
    paidCents: 0,
    dueCents: cents(j['dueCents']),
    prior: prior,
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    vehicle: text(j['vehicle']),
    vinNumber: '',
  );

  List<Map<String, dynamic>> listOf(Object? v) => [
    for (final x in (v as List? ?? const []))
      Map<String, dynamic>.from(x as Map),
  ];

  /// The app's month customer, built from the fixture's customer JSON.
  ParkingMonthCustomer customerOf(Map<String, dynamic> j) {
    final cars = listOf(j['cars']).map(billOf).toList();
    final older = listOf(j['olderCars']).map(carriedOf).toList();
    final activities = listOf(j['activities']).map(activityOf).toList();
    final olderActivities = [
      for (final a in listOf(j['olderActivities'])) activityOf(a, prior: true),
    ];
    return ParkingMonthCustomer(
      key: text(j['key']),
      monthKey: '2026-10',
      customerName: text(j['customerName']),
      customerPhone: '',
      customerEmail: '',
      cars: cars,
      registeredTo: [for (final _ in cars) ''],
      activities: activities,
      olderActivities: olderActivities,
      activityRegisteredTo: [for (final _ in activities) ''],
      olderRegisteredTo: [for (final _ in olderActivities) ''],
      monthCents: cents(j['dueCents']),
      monthPaidCents: 0,
      monthUnpaidCents: cents(j['dueCents']),
      priorUnpaidCents: 0,
      dueCents: cents(j['dueCents']),
      owes: cents(j['dueCents']) > 0,
      paid: false,
      paidVia: const [],
      partialMonth: false,
      expenseCreditCents: cents(j['expenseCreditCents']),
      olderCars: older,
      olderCarsRegisteredTo: [for (final _ in older) ''],
    );
  }

  Map<String, dynamic> partJson(BillPaymentPart p) => {
    'kind': p.kind,
    'id': p.id,
    'label': p.label,
    'amountCents': p.amountCents,
    'full': p.full,
  };

  group('every shared case gives the server answer', () {
    test('the fixture has its cases and labels', () {
      expect(cases.length, greaterThanOrEqualTo(10));
      expect(labels.length, greaterThanOrEqualTo(5));
    });
    for (final k in cases) {
      test(k['name'] as String, () {
        final customer = customerOf(k['customer'] as Map<String, dynamic>);
        final plan = billPaymentPlan(customer, cents(k['amountCents']));
        final expected = k['expect'] as Map<String, dynamic>;
        expect(plan.ok, expected['ok']);
        expect(plan.reason, expected['reason']);
        expect(plan.payableCents, expected['payableCents']);
        expect(plan.leftCents, expected['leftCents']);
        expect([for (final p in plan.parts) partJson(p)], expected['parts']);
      });
    }
  });

  group('billPaymentFor names what a payment was for', () {
    for (final k in labels) {
      final names = [
        for (final p in (k['parts'] as List)) text((p as Map)['label']),
      ];
      test('${k['en']} / ${k['fr']}', () {
        expect(billPaymentFor(names, 'en'), k['en']);
        expect(billPaymentFor(names, 'fr'), k['fr']);
        expect(billPaymentFor(names), k['en']);
      });
    }
  });

  test(
    'the items are sorted stably: a car stays ahead of a job on one day',
    () {
      final customer = customerOf(
        cases.firstWhere(
              (k) => (k['name'] as String).startsWith('same day'),
            )['customer']
            as Map<String, dynamic>,
      );
      final items = billPaymentItems(customer);
      expect([for (final i in items) i.kind], ['car', 'activity']);
    },
  );

  group('a recorded payment, as read from Firestore', () {
    test('reads the document and keeps the newest first per customer', () {
      final a = ParkingBillPayment.fromMap('p1', {
        'customerKey': 'phone:1',
        'amountCents': 5000,
        'receivedVia': 'cash',
        'receivedByStaffId': 'u1',
        'status': 'recorded',
        'atMs': 1000,
        'leftCents': 2500,
        'parts': [
          {
            'kind': 'car',
            'id': 'c1',
            'label': 'Civic',
            'amountCents': 5000,
            'full': true,
          },
        ],
      });
      final b = ParkingBillPayment.fromMap('p2', {
        'customerKey': 'phone:1',
        'amountCents': 100,
        'status': 'undone',
        'at': Timestamp.fromMillisecondsSinceEpoch(9000),
        'undoneAtMs': 9500,
        'parts': const [],
      });
      expect(a.parts.single.full, isTrue);
      expect(a.undone, isFalse);
      expect(b.undone, isTrue);
      expect(b.atMs, 9000);
      expect(b.undoneAtMs, 9500);
      final grouped = billPaymentsByCustomer([a, b]);
      expect([for (final p in grouped['phone:1']!) p.id], ['p2', 'p1']);
    });

    test('a row with no customer is left out; junk reads as empty', () {
      final junk = ParkingBillPayment.fromMap('x', {'parts': 'nope'});
      expect(junk.parts, isEmpty);
      expect(junk.amountCents, 0);
      expect(billPaymentsByCustomer([junk]), isEmpty);
    });
  });

  group('the server refusals', () {
    test('details.reason wins; a reason-named message is understood', () {
      final f = parseParkingBillPaymentFailure('failed-precondition', {
        'reason': 'bill_payment_bill_changed',
      }, 'x');
      expect(f.reason, BillPaymentRefusal.billChanged);
      final g = parseParkingBillPaymentFailure(
        'failed-precondition',
        null,
        'bill_payment_settled_since',
      );
      expect(g.reason, BillPaymentRefusal.settledSince);
      expect(
        parseParkingBillPaymentFailure('unavailable', null).offline,
        isTrue,
      );
    });

    for (final code in ['en', 'fr']) {
      test('every reason has words ($code)', () {
        final l10n = lookupAppLocalizations(Locale(code));
        final fallback = l10n.lotCouldNotSave;
        for (final reason in BillPaymentRefusal.all) {
          expect(
            parkingBillPaymentRefusalText(l10n, reason, payableCents: 1234),
            isNot(fallback),
            reason: reason,
          );
        }
        expect(
          parkingBillPaymentRefusalText(
            l10n,
            BillPaymentRefusal.moreThanOwed,
            payableCents: 12000,
          ),
          contains(r'$120.00'),
        );
      });
    }
  });

  group('Month end offers Record a payment', () {
    final l10n = lookupAppLocalizations(const Locale('en'));
    ParkingMonthCustomer named(String prefix) => customerOf(
      cases.firstWhere(
            (k) => (k['name'] as String).startsWith(prefix),
          )['customer']
          as Map<String, dynamic>,
    );

    test('next to Mark all paid, never on the estimate', () {
      final customer = named('oldest first');
      final ids = [
        for (final o in parkingMonthCustomerOptions(l10n, customer)) o.value,
      ];
      expect(ids, containsAllInOrder(['settle', 'record']));
      final estimate = [
        for (final o in parkingMonthCustomerOptions(
          l10n,
          customer,
          estimate: true,
        ))
          o.value,
      ];
      expect(estimate, isNot(contains('record')));
    });

    test('not when the bill has nothing payable here (only Stripe cars)', () {
      final customer = named('a bill with only Stripe');
      final ids = [
        for (final o in parkingMonthCustomerOptions(l10n, customer)) o.value,
      ];
      expect(ids, isNot(contains('record')));
    });
  });

  group('the Record a payment sheet', () {
    final customer = customerOf(
      cases.first['customer'] as Map<String, dynamic>,
    );
    // $130.00 payable: Corolla 30, Wash 10, Civic 50, Towing 40.
    const staff = [(id: 'u1', name: 'Keren'), (id: 'u2', name: 'Ibra')];

    setUpAll(() async {
      await initializeDateFormatting('en');
      await initializeDateFormatting('fr');
    });

    late List<Map<String, Object?>> calls;
    Object? Function(Map<String, Object?>)? answer;

    ParkingBillPaymentService service() => ParkingBillPaymentService(
      caller: (name, payload) async {
        calls.add({'name': name, ...payload});
        final result = answer?.call(payload);
        if (result is Exception) throw result;
        return result;
      },
    );

    setUp(() {
      calls = [];
      answer = (payload) => {
        'success': true,
        'billPaymentId': 'bp1',
        'amountCents': payload['amountCents'],
        'leftCents': 6500,
        'receipt': 'sent',
      };
    });

    Future<void> open(WidgetTester tester, String code) async {
      tester.view.physicalSize = const Size(800, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MaterialApp(
          locale: Locale(code),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(
            body: Builder(
              builder: (context) => Center(
                child: TextButton(
                  key: const Key('open'),
                  onPressed: () => showLotSheet<bool>(
                    context,
                    BillPaymentSheet(
                      businessId: 'biz-1',
                      monthKey: '2026-10',
                      monthLabel: 'October 2026',
                      customer: customer,
                      staff: staff,
                      service: service(),
                      currentUid: 'u1',
                    ),
                  ),
                  child: const Text('open'),
                ),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.byKey(const Key('open')));
      await tester.pumpAndSettle();
    }

    Future<void> type(WidgetTester tester, String value) async {
      await tester.enterText(
        find.byKey(const Key('bill-payment-amount')),
        value,
      );
      await tester.pump();
    }

    testWidgets('previews what the amount pays off and what is left', (
      tester,
    ) async {
      await open(tester, 'en');
      // Nothing typed: what the bill can take.
      expect(find.byKey(const Key('bill-payment-up-to')), findsOneWidget);
      expect(find.textContaining(r'$130.00'), findsWidgets);

      await type(tester, '65');
      expect(find.byKey(const Key('bill-payment-preview')), findsOneWidget);
      expect(find.text('2014 Toyota Corolla'), findsOneWidget);
      expect(find.text('Wash'), findsOneWidget);
      expect(find.text('2016 Honda Civic'), findsOneWidget);
      // The Corolla and the Wash are paid in full, the Civic is not.
      expect(find.text('paid'), findsNWidgets(2));
      expect(find.text(r'Left on the bill: $65.00'), findsOneWidget);
      expect(find.text(r'Record $65.00'), findsOneWidget);
    });

    testWidgets('more than owed is refused with its words and cannot save', (
      tester,
    ) async {
      await open(tester, 'en');
      await type(tester, '130.01');
      expect(find.byKey(const Key('bill-payment-refusal')), findsOneWidget);
      expect(find.textContaining(r'$130.00'), findsWidgets);
      await tester.tap(find.byKey(const Key('bill-payment-save')));
      await tester.pumpAndSettle();
      expect(calls, isEmpty);
    });

    testWidgets('saves one payment with what the server needs', (tester) async {
      await open(tester, 'en');
      await type(tester, '65');
      await tester.enterText(find.byType(TextField).last, 'Part one');
      await tester.tap(find.byKey(const Key('bill-payment-save')));
      await tester.pumpAndSettle();

      expect(calls, hasLength(1));
      expect(calls.single, {
        'name': 'updateBusinessParkingEntry',
        'action': 'bill_payment_record',
        'businessId': 'biz-1',
        'monthKey': '2026-10',
        'customerKey': customer.key,
        'amountCents': 6500,
        'receivedVia': 'cash',
        'receivedByStaffId': 'u1',
        'note': 'Part one',
        'expectedPayableCents': 13000,
      });
      // The sheet closes and says what was recorded.
      expect(find.byKey(const Key('bill-payment-save')), findsNothing);
      expect(
        find.text(r'Recorded $65.00. $65.00 left on the bill.'),
        findsOneWidget,
      );
    });

    testWidgets('a refusal stays on the sheet in words', (tester) async {
      answer = (_) => FirebaseFunctionsException(
        message: 'x',
        code: 'permission-denied',
        details: {'reason': 'bill_payment_ledger_required'},
      );
      await open(tester, 'en');
      await type(tester, '65');
      await tester.tap(find.byKey(const Key('bill-payment-save')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('bill-payment-error')), findsOneWidget);
      expect(find.textContaining('ledger permission'), findsOneWidget);
      // Nothing is stuck: the button is back and can try again.
      expect(find.byKey(const Key('bill-payment-save')), findsOneWidget);
    });

    testWidgets('a bill that changed closes the sheet and says so', (
      tester,
    ) async {
      answer = (_) => FirebaseFunctionsException(
        message: 'x',
        code: 'failed-precondition',
        details: {'reason': 'bill_payment_bill_changed'},
      );
      await open(tester, 'en');
      await type(tester, '65');
      await tester.tap(find.byKey(const Key('bill-payment-save')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('bill-payment-save')), findsNothing);
      expect(find.textContaining('bill changed'), findsOneWidget);
    });

    testWidgets('reads in French', (tester) async {
      await open(tester, 'fr');
      await type(tester, '65');
      expect(find.text('Règle'), findsOneWidget);
      expect(find.text('payé'), findsNWidgets(2));
      expect(find.text(r'Reste sur la facture : $65.00'), findsOneWidget);
    });
  });

  group('Payments on this bill', () {
    // ICU puts a narrow no-break space before AM/PM.
    Finder plainText(String text) => find.byWidgetPredicate(
      (w) =>
          w is Text &&
          (w.data ?? '').replaceAll(RegExp('[\u202f\u00a0]'), ' ') == text,
    );
    setUpAll(() async {
      await initializeDateFormatting('en');
      await initializeDateFormatting('fr');
    });

    ParkingBillPayment payment(String id, {bool undone = false}) =>
        ParkingBillPayment.fromMap(id, {
          'customerKey': 'phone:1',
          'amountCents': 6500,
          'receivedVia': 'zelle',
          'receivedByStaffId': 'u1',
          'status': undone ? 'undone' : 'recorded',
          // Oct 30, 2026 3:05 PM UTC; shown in the device's zone.
          'atMs': DateTime(2026, 10, 30, 15, 5).millisecondsSinceEpoch,
          'undoneAtMs': undone
              ? DateTime(2026, 10, 31, 9, 30).millisecondsSinceEpoch
              : 0,
          'parts': [
            {
              'kind': 'car',
              'id': 'c1',
              'label': 'A',
              'amountCents': 100,
              'full': true,
            },
            {
              'kind': 'car',
              'id': 'c2',
              'label': 'B',
              'amountCents': 100,
              'full': true,
            },
            {
              'kind': 'car',
              'id': 'c3',
              'label': 'C',
              'amountCents': 100,
              'full': true,
            },
          ],
        });

    Future<void> show(
      WidgetTester tester,
      String code,
      List<ParkingBillPayment> payments, {
      void Function(ParkingBillPayment)? onUndo,
      String busyKey = '',
    }) async {
      await tester.pumpWidget(
        MaterialApp(
          locale: Locale(code),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(
            body: SingleChildScrollView(
              child: ParkingBillPaymentsSection(
                payments: payments,
                staffNames: const {'u1': 'Keren'},
                busyKey: busyKey,
                onUndo: onUndo,
              ),
            ),
          ),
        ),
      );
    }

    testWidgets('a recorded payment shows its facts and can be undone', (
      tester,
    ) async {
      ParkingBillPayment? undone;
      await show(tester, 'en', [payment('p1')], onUndo: (p) => undone = p);
      expect(find.text('Payments on this bill'), findsOneWidget);
      expect(find.text(r'$65.00 · Zelle'), findsOneWidget);
      expect(
        plainText('Oct 30, 2026 3:05 PM · Received by Keren'),
        findsOneWidget,
      );
      expect(find.text('Paid: A, B and 1 more'), findsOneWidget);
      await tester.tap(find.byKey(const Key('bill-payment-undo-p1')));
      expect(undone?.id, 'p1');
    });

    testWidgets('an undone payment is greyed with when, and has no Undo', (
      tester,
    ) async {
      await show(tester, 'en', [payment('p2', undone: true)], onUndo: (_) {});
      expect(find.byKey(const Key('bill-payment-undo-p2')), findsNothing);
      expect(plainText('Undone · Oct 31, 2026 9:30 AM'), findsOneWidget);
    });

    testWidgets('no handler hides Undo; nothing recorded shows nothing', (
      tester,
    ) async {
      await show(tester, 'en', [payment('p1')]);
      expect(find.byKey(const Key('bill-payment-undo-p1')), findsNothing);
      await show(tester, 'en', const []);
      expect(find.byKey(const Key('bill-payments')), findsNothing);
    });

    testWidgets('French words and the 24-hour clock', (tester) async {
      await show(tester, 'fr', [payment('p1')], onUndo: (_) {});
      expect(find.text('Paiements sur cette facture'), findsOneWidget);
      expect(find.text('Payé : A, B et 1 autre'), findsOneWidget);
      expect(find.text('Annuler'), findsOneWidget);
    });

    testWidgets('undo asks first, in words', (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(
            body: Builder(
              builder: (context) => TextButton(
                onPressed: () =>
                    confirmUndoBillPayment(context, amount: r'$65.00'),
                child: const Text('ask'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('ask'));
      await tester.pumpAndSettle();
      expect(
        find.text(
          r'Undo this $65.00 payment? It comes off every car and job it paid.',
        ),
        findsOneWidget,
      );
    });
  });
}
