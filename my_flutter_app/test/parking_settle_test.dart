import 'dart:convert';
import 'dart:io';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/services/parking_bill_payment.dart';
import 'package:my_flutter_app/services/parking_bill_payment_service.dart';
import 'package:my_flutter_app/services/parking_month_statement.dart';
import 'package:my_flutter_app/widgets/lot_sheets.dart';
import 'package:my_flutter_app/widgets/parking_bill_payment_widgets.dart';

/// Month end: "Settle for a lower amount" on a customer's bill
/// (docs/PARKING_DISCOUNT.md, docs/PARKING_BILL_PAYMENTS.md). The shared
/// fixture pins the split to the server and the console; the widget tests
/// drive the second mode of the "Record a payment" sheet the way staff do.
void main() {
  final fixture =
      jsonDecode(
            File(
              'functions/test/fixtures/parking-settle-cases.json',
            ).readAsStringSync(),
          )
          as Map<String, dynamic>;
  final cases = (fixture['cases'] as List).cast<Map<String, dynamic>>();

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

  ParkingMonthActivity activityOf(Map<String, dynamic> j) =>
      ParkingMonthActivity(
        id: text(j['id']),
        monthKey: '2026-10',
        date: text(j['date']),
        label: text(j['label']),
        feeCents: cents(j['dueCents']),
        paidCents: 0,
        dueCents: cents(j['dueCents']),
        prior: false,
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

  ParkingMonthCustomer customerOf(Map<String, dynamic> j) {
    final cars = listOf(j['cars']).map(billOf).toList();
    final older = listOf(j['olderCars']).map(carriedOf).toList();
    final activities = listOf(j['activities']).map(activityOf).toList();
    return ParkingMonthCustomer(
      key: 'phone:2015550142',
      monthKey: '2026-10',
      customerName: 'Customer A',
      customerPhone: '',
      customerEmail: '',
      cars: cars,
      registeredTo: [for (final _ in cars) ''],
      activities: activities,
      olderActivities: const [],
      activityRegisteredTo: [for (final _ in activities) ''],
      olderRegisteredTo: const [],
      monthCents: cents(j['dueCents']),
      monthPaidCents: 0,
      monthUnpaidCents: cents(j['dueCents']),
      priorUnpaidCents: 0,
      dueCents: cents(j['dueCents']),
      owes: true,
      paid: false,
      paidVia: const [],
      partialMonth: false,
      olderCars: older,
      olderCarsRegisteredTo: [for (final _ in older) ''],
    );
  }

  group('every shared case gives the server answer', () {
    test('the fixture has its cases', () {
      expect(cases.length, greaterThanOrEqualTo(6));
    });
    for (final k in cases) {
      test(k['name'] as String, () {
        final plan = billSettlePlan(
          customerOf(k['customer'] as Map<String, dynamic>),
          cents(k['paidCents']),
        );
        final expected = k['expect'] as Map<String, dynamic>;
        expect(plan.ok, expected['ok']);
        if (expected['ok'] != true) {
          expect(plan.reason, expected['reason']);
          return;
        }
        expect(plan.payableCents, expected['payableCents']);
        expect(plan.discountCents, expected['discountCents']);
        expect([
          for (final p in plan.parts) [p.kind, p.id, p.amountCents, p.full],
        ], expected['parts']);
        expect([
          for (final d in plan.discountParts) [d.id, d.amountCents],
        ], expected['discountParts']);
      });
    }
  });

  test('a negative amount is no amount', () {
    final customer = customerOf(
      cases.first['customer'] as Map<String, dynamic>,
    );
    expect(billSettlePlan(customer, -1).reason, BillPaymentRefusal.noAmount);
  });

  test('a recorded settle reads its discount and settlement id', () {
    final p = ParkingBillPayment.fromMap('p1', {
      'customerKey': 'phone:1',
      'amountCents': 30000,
      'discountCents': 16800,
      'settlementId': 's1',
      'status': 'recorded',
    });
    expect(p.discountCents, 16800);
    expect(p.settlementId, 's1');
    final plain = ParkingBillPayment.fromMap('p2', {'customerKey': 'phone:1'});
    expect(plain.discountCents, 0);
    expect(plain.settlementId, '');
  });

  test('the service sends bill_settle with the reason', () async {
    Map<String, Object?>? sent;
    final service = ParkingBillPaymentService(
      caller: (name, payload) async {
        sent = {'name': name, ...payload};
        return {'billPaymentId': 'bp', 'amountCents': 100, 'leftCents': 0};
      },
    );
    await service.settle(
      businessId: 'b',
      monthKey: '2026-10',
      customerKey: 'phone:1',
      amountCents: 100,
      receivedVia: 'cash',
      receivedByStaffId: 'u1',
      expectedPayableCents: 500,
      reason: '  Long stay ',
    );
    expect(sent, {
      'name': 'updateBusinessParkingEntry',
      'action': 'bill_settle',
      'businessId': 'b',
      'monthKey': '2026-10',
      'customerKey': 'phone:1',
      'amountCents': 100,
      'receivedVia': 'cash',
      'receivedByStaffId': 'u1',
      'note': '',
      'expectedPayableCents': 500,
      'reason': 'Long stay',
    });
  });

  test('every settle refusal has words in both languages', () {
    for (final code in ['en', 'fr']) {
      final l10n = lookupAppLocalizations(Locale(code));
      for (final reason in [
        BillPaymentRefusal.settleNotLess,
        BillPaymentRefusal.settleJobsFirst,
        BillPaymentRefusal.settleReasonRequired,
        BillPaymentRefusal.fromSettlement,
      ]) {
        expect(
          parkingBillPaymentRefusalText(l10n, reason),
          isNot(l10n.lotCouldNotSave),
          reason: '$code $reason',
        );
      }
    }
  });

  group('the Settle for a lower amount mode of the sheet', () {
    // Corolla-like cars a ($240.00) and b ($228.00): $468.00 payable.
    final customer = customerOf(
      cases.first['customer'] as Map<String, dynamic>,
    );
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
        'leftCents': 0,
        'receipt': 'sent',
      };
    });

    Future<void> open(
      WidgetTester tester,
      String code, {
      double width = 800,
      String currentUid = 'u1',
    }) async {
      tester.view.physicalSize = Size(width, 2000);
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
                      currentUid: currentUid,
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

    Future<void> settleMode(WidgetTester tester, String label) async {
      await tester.tap(find.text(label));
      await tester.pumpAndSettle();
    }

    Future<void> type(WidgetTester tester, String key, String value) async {
      await tester.enterText(find.byKey(Key(key)), value);
      await tester.pump();
    }

    testWidgets('previews what is paid and what is taken off each car', (
      tester,
    ) async {
      await open(tester, 'en');
      expect(find.byKey(const Key('bill-payment-reason')), findsNothing);
      await settleMode(tester, 'Settle for a lower amount');
      expect(find.textContaining(r'The bill is $468.00'), findsOneWidget);
      await type(tester, 'bill-payment-amount', '300');
      expect(find.byKey(const Key('bill-settle-preview')), findsOneWidget);
      expect(find.text('Paid · Car a'), findsOneWidget);
      expect(find.text(r'$240.00'), findsOneWidget);
      expect(find.text('Paid · Car b'), findsOneWidget);
      expect(find.text('Discount · Car b'), findsOneWidget);
      expect(find.text(r'−$168.00'), findsOneWidget);
      expect(find.text(r'Left on the bill: $0.00'), findsOneWidget);
      expect(find.text(r'Settle for $300.00'), findsOneWidget);
    });

    testWidgets('saves one bill_settle with the reason and the bill total', (
      tester,
    ) async {
      await open(tester, 'en');
      await settleMode(tester, 'Settle for a lower amount');
      await type(tester, 'bill-payment-amount', '300');
      await type(tester, 'bill-payment-reason', 'Agreed with the owner');
      await tester.tap(find.byKey(const Key('bill-payment-save')));
      await tester.pumpAndSettle();
      expect(calls, hasLength(1));
      expect(calls.single, {
        'name': 'updateBusinessParkingEntry',
        'action': 'bill_settle',
        'businessId': 'biz-1',
        'monthKey': '2026-10',
        'customerKey': customer.key,
        'amountCents': 30000,
        'receivedVia': 'cash',
        'receivedByStaffId': 'u1',
        'note': '',
        'expectedPayableCents': 46800,
        'reason': 'Agreed with the owner',
      });
      expect(find.byKey(const Key('bill-payment-save')), findsNothing);
      expect(
        find.text(r'Settled for $300.00. $168.00 recorded as a discount.'),
        findsOneWidget,
      );
    });

    testWidgets('no reason: refused in words before anything is sent', (
      tester,
    ) async {
      await open(tester, 'en');
      await settleMode(tester, 'Settle for a lower amount');
      await type(tester, 'bill-payment-amount', '300');
      await tester.tap(find.byKey(const Key('bill-payment-save')));
      await tester.pumpAndSettle();
      expect(calls, isEmpty);
      expect(
        find.text('Say why the bill was settled for less.'),
        findsOneWidget,
      );
    });

    testWidgets('the full bill or more is not a settle', (tester) async {
      await open(tester, 'en');
      await settleMode(tester, 'Settle for a lower amount');
      await type(tester, 'bill-payment-amount', '468');
      expect(find.byKey(const Key('bill-settle-refusal')), findsOneWidget);
      expect(find.textContaining('must be less than the bill'), findsOneWidget);
    });

    testWidgets('nothing paid needs no receiver: all of it a discount', (
      tester,
    ) async {
      await open(tester, 'en', currentUid: '');
      await settleMode(tester, 'Settle for a lower amount');
      await type(tester, 'bill-payment-amount', '0');
      await type(tester, 'bill-payment-reason', 'Waived');
      expect(find.text(r'−$468.00'), findsNothing);
      await tester.tap(find.byKey(const Key('bill-payment-save')));
      await tester.pumpAndSettle();
      expect(calls.single['action'], 'bill_settle');
      expect(calls.single['amountCents'], 0);
      expect(calls.single['receivedByStaffId'], '');
    });

    testWidgets('money taken with nobody named is refused', (tester) async {
      await open(tester, 'en', currentUid: '');
      await settleMode(tester, 'Settle for a lower amount');
      await type(tester, 'bill-payment-amount', '300');
      await type(tester, 'bill-payment-reason', 'Because');
      await tester.tap(find.byKey(const Key('bill-payment-save')));
      await tester.pumpAndSettle();
      expect(calls, isEmpty);
      expect(find.text('Say who received the money.'), findsWidgets);
    });

    testWidgets('a refusal from the server stays on the sheet in words', (
      tester,
    ) async {
      answer = (_) => FirebaseFunctionsException(
        message: 'x',
        code: 'failed-precondition',
        details: {'reason': 'bill_settle_jobs_first'},
      );
      await open(tester, 'en');
      await settleMode(tester, 'Settle for a lower amount');
      await type(tester, 'bill-payment-amount', '300');
      await type(tester, 'bill-payment-reason', 'Because');
      await tester.tap(find.byKey(const Key('bill-payment-save')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('bill-payment-error')), findsOneWidget);
      expect(find.textContaining('at least pay the lot jobs'), findsOneWidget);
      // Nothing is stuck: the button is back.
      expect(find.byKey(const Key('bill-payment-save')), findsOneWidget);
    });

    testWidgets('French on a 320 px phone: words, no overflow', (tester) async {
      await open(tester, 'fr', width: 320);
      await settleMode(tester, 'Régler pour un montant inférieur');
      await type(tester, 'bill-payment-amount', '300');
      await type(tester, 'bill-payment-reason', 'Long séjour');
      expect(find.textContaining('Remise'), findsWidgets);
      expect(find.textContaining('Régler pour'), findsWidgets);
      expect(tester.takeException(), isNull);
    });
  });

  testWidgets(
    'a settled payment shows its discount and cannot be undone alone',
    (tester) async {
      final settle = ParkingBillPayment.fromMap('p1', {
        'customerKey': 'phone:1',
        'amountCents': 30000,
        'receivedVia': 'cash',
        'discountCents': 16800,
        'status': 'recorded',
        'atMs': 1000,
        'parts': const [],
      });
      final fromSettlement = ParkingBillPayment.fromMap('p2', {
        'customerKey': 'phone:1',
        'amountCents': 5000,
        'receivedVia': 'cash',
        'settlementId': 's1',
        'status': 'recorded',
        'atMs': 500,
        'parts': const [],
      });
      await initializeDateFormatting('en');
      await tester.pumpWidget(
        MaterialApp(
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(
            body: ParkingBillPaymentsSection(
              payments: [settle, fromSettlement],
              staffNames: const {},
              onUndo: (_) {},
            ),
          ),
        ),
      );
      expect(find.byKey(const Key('bill-payment-discount-p1')), findsOneWidget);
      expect(find.text(r'Discount −$168.00'), findsOneWidget);
      expect(find.byKey(const Key('bill-payment-undo-p1')), findsOneWidget);
      // Part of a team settlement: undone with it, never alone.
      expect(find.byKey(const Key('bill-payment-undo-p2')), findsNothing);
      expect(
        find.byKey(const Key('bill-payment-settlement-p2')),
        findsOneWidget,
      );
    },
  );
}
