import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/services/parking_discount_service.dart';
import 'package:my_flutter_app/widgets/parking_discount_actions.dart';

/// The discount buttons on a parked car (docs/PARKING_DISCOUNT.md): "Give a
/// discount", "Settle for a lower amount" and Undo, with the website's
/// preview, confirmation and refusals. The rules themselves are pinned by
/// `parking_discount_test.dart` against the shared fixture.
void main() {
  // The shared fixture's open stay: parked since 11/01/2026 at $12 a day,
  // so on 11/15 it owes $180.00.
  final now = DateTime.parse('2026-11-15T15:00:00Z');
  Map<String, dynamic> openStay([Map<String, dynamic> extra = const {}]) => {
    'paymentMethod': 'direct',
    'source': 'business',
    'status': 'parked',
    'paymentStatus': 'awaiting_direct_payment',
    'parkingDate': '2026-11-01',
    'dailyRate': 12,
    ...extra,
  };
  const staff = {'u1': 'Keren', 'u2': 'Ibra'};

  setUpAll(() async {
    await initializeDateFormatting('en');
    await initializeDateFormatting('fr');
  });

  late List<Map<String, Object?>> calls;
  late int changed;
  Object? Function(Map<String, Object?>)? answer;

  ParkingDiscountService service() => ParkingDiscountService(
    caller: (name, payload) async {
      calls.add({'name': name, ...payload});
      final result = answer?.call(payload);
      if (result is Exception) throw result;
      return result ?? {'success': true};
    },
  );

  setUp(() {
    calls = [];
    changed = 0;
    answer = null;
  });

  Future<void> open(
    WidgetTester tester,
    Map<String, dynamic> car, {
    String code = 'en',
    double width = 800,
  }) async {
    tester.view.physicalSize = Size(width, 2400);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(
        locale: Locale(code),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(
          body: SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: ParkingDiscountActions(
              car: car,
              entryId: 'car-1',
              staffNames: staff,
              service: service(),
              now: () => now,
              onChanged: () async => changed++,
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> fill(WidgetTester tester, String key, String value) async {
    await tester.enterText(find.byKey(Key(key)), value);
    await tester.pump();
  }

  testWidgets('a car the business does not record payments for shows nothing', (
    tester,
  ) async {
    await open(tester, openStay({'paymentMethod': 'paymentLink'}));
    expect(find.byKey(const Key('discount-open-give')), findsNothing);
    expect(find.byKey(const Key('parking-discounts')), findsNothing);
  });

  testWidgets('give a discount: preview, confirm, one callable, refresh', (
    tester,
  ) async {
    await open(tester, openStay());
    await tester.tap(find.byKey(const Key('discount-open-give')));
    await tester.pumpAndSettle();
    expect(find.textContaining(r'Owed today: $180.00'), findsOneWidget);
    // Nothing typed: the button waits.
    await fill(tester, 'discount-amount', '50');
    await fill(tester, 'discount-reason', 'Agreed with the owner');
    expect(
      find.text(r'Discount −$50.00 · Left to pay $130.00'),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const Key('discount-save')));
    await tester.pumpAndSettle();
    // The confirmation says what will be recorded.
    expect(find.text(r'Give a $50.00 discount on this car?'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Give discount'));
    await tester.pumpAndSettle();

    expect(calls, [
      {
        'name': 'updateBusinessParkingEntry',
        'action': 'discount_give',
        'entryId': 'car-1',
        'amountCents': 5000,
        'reason': 'Agreed with the owner',
      },
    ]);
    expect(changed, 1);
    expect(find.text('Discount given.'), findsOneWidget);
    // The form closed.
    expect(find.byKey(const Key('discount-amount')), findsNothing);
  });

  testWidgets(
    'settle for a lower amount: what is paid, by whom, the rest off',
    (tester) async {
      await open(tester, openStay());
      await tester.tap(find.byKey(const Key('discount-open-settle')));
      await tester.pumpAndSettle();
      await fill(tester, 'discount-amount', '150');
      await fill(tester, 'discount-reason', 'Long stay');
      // Money taken needs who took it: the preview says so and Save waits.
      expect(find.byKey(const Key('discount-preview-refusal')), findsOneWidget);
      expect(find.text('Say who took the money.'), findsOneWidget);
      await tester.tap(find.byKey(const Key('discount-received-by')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Keren'));
      await tester.pumpAndSettle();
      expect(
        find.text(r'Paid $150.00 · Discount −$30.00 · Left $0.00'),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const Key('discount-save')));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Settle'));
      await tester.pumpAndSettle();

      expect(calls.single, {
        'name': 'updateBusinessParkingEntry',
        'action': 'discount_settle',
        'entryId': 'car-1',
        'paidCents': 15000,
        'receivedVia': 'cash',
        'receivedByStaffId': 'u1',
        'reason': 'Long stay',
        'expectedOwedCents': 18000,
      });
      expect(changed, 1);
      expect(
        find.text('Settled. The discount is on the bill.'),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'more than owed and a missing reason are refused before sending',
    (tester) async {
      await open(tester, openStay());
      await tester.tap(find.byKey(const Key('discount-open-give')));
      await tester.pumpAndSettle();
      await fill(tester, 'discount-amount', '180.01');
      expect(
        find.text(
          'That is more than this car owes. Enter at most what is owed.',
        ),
        findsOneWidget,
      );
      await fill(tester, 'discount-amount', '20');
      expect(find.text('Say why the discount was agreed.'), findsOneWidget);
      await tester.tap(
        find.byKey(const Key('discount-save')),
        warnIfMissed: false,
      );
      await tester.pumpAndSettle();
      expect(calls, isEmpty);
    },
  );

  testWidgets('the server refusing it is shown in words and nothing sticks', (
    tester,
  ) async {
    answer = (_) => FirebaseFunctionsException(
      message: 'x',
      code: 'failed-precondition',
      details: {'reason': 'discount_owed_changed'},
    );
    await open(tester, openStay());
    await tester.tap(find.byKey(const Key('discount-open-give')));
    await tester.pumpAndSettle();
    await fill(tester, 'discount-amount', '20');
    await fill(tester, 'discount-reason', 'Because');
    await tester.tap(find.byKey(const Key('discount-save')));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Give discount'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('discount-error')), findsOneWidget);
    expect(
      find.text(
        'What this car owes has changed. Check the amount and try again.',
      ),
      findsOneWidget,
    );
    // The form stays, ready to try again, and nothing was refreshed.
    expect(find.byKey(const Key('discount-save')), findsOneWidget);
    expect(changed, 0);
  });

  testWidgets('no permission reads as a sentence, not a code', (tester) async {
    answer = (_) => FirebaseFunctionsException(
      message: 'denied',
      code: 'permission-denied',
    );
    await open(tester, openStay());
    await tester.tap(find.byKey(const Key('discount-open-give')));
    await tester.pumpAndSettle();
    await fill(tester, 'discount-amount', '20');
    await fill(tester, 'discount-reason', 'Because');
    await tester.tap(find.byKey(const Key('discount-save')));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Give discount'));
    await tester.pumpAndSettle();
    expect(find.textContaining('not allowed to do this'), findsOneWidget);
  });

  testWidgets(
    'a discount can be undone; an undone one is greyed with its date',
    (tester) async {
      final car = openStay({
        'parkingDiscountCents': 3000,
        'parkingDiscounts': [
          {
            'id': 'd1',
            'amountCents': 3000,
            'reason': 'Long stay',
            'mode': 'discount',
            'givenByUid': 'u1',
            'atMs': DateTime.parse(
              '2026-11-10T15:00:00Z',
            ).millisecondsSinceEpoch,
          },
          {
            'id': 'd2',
            'amountCents': 1000,
            'reason': 'Oops',
            'mode': 'discount',
            'givenByUid': 'u2',
            'atMs': DateTime.parse(
              '2026-11-05T15:00:00Z',
            ).millisecondsSinceEpoch,
            'undone': true,
            'undoneAtMs': DateTime.parse(
              '2026-11-06T15:00:00Z',
            ).millisecondsSinceEpoch,
          },
        ],
      });
      await open(tester, car);
      expect(find.text(r'Discount −$30.00'), findsOneWidget);
      expect(find.byKey(const Key('discount-undo-d1')), findsOneWidget);
      // The undone one has no Undo and says when it was undone.
      expect(find.byKey(const Key('discount-undo-d2')), findsNothing);
      expect(find.byKey(const Key('discount-undone-d2')), findsOneWidget);

      await tester.tap(find.byKey(const Key('discount-undo-d1')));
      await tester.pumpAndSettle();
      expect(find.text('Undo this discount?'), findsOneWidget);
      await tester.tap(find.widgetWithText(FilledButton, 'Undo discount'));
      await tester.pumpAndSettle();
      expect(calls.single, {
        'name': 'updateBusinessParkingEntry',
        'action': 'discount_undo',
        'entryId': 'car-1',
        'discountId': 'd1',
      });
      expect(changed, 1);
      expect(find.text('Discount undone.'), findsOneWidget);
    },
  );

  testWidgets('an undo the server refuses says why', (tester) async {
    answer = (_) => FirebaseFunctionsException(
      message: 'x',
      code: 'failed-precondition',
      details: {'reason': 'discount_already_undone'},
    );
    final car = openStay({
      'parkingDiscounts': [
        {
          'id': 'd1',
          'amountCents': 3000,
          'reason': 'Long stay',
          'givenByUid': 'u1',
          'atMs': 1,
        },
      ],
    });
    await open(tester, car);
    await tester.tap(find.byKey(const Key('discount-undo-d1')));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Undo discount'));
    await tester.pumpAndSettle();
    expect(find.text('That discount was already undone.'), findsOneWidget);
    expect(changed, 0);
  });

  testWidgets('French on a 320 px phone: words, no overflow', (tester) async {
    await open(tester, openStay(), code: 'fr', width: 320);
    expect(find.text('Régler pour un montant inférieur'), findsOneWidget);
    await tester.tap(find.byKey(const Key('discount-open-settle')));
    await tester.pumpAndSettle();
    await fill(tester, 'discount-amount', '150');
    await fill(tester, 'discount-reason', 'Long séjour');
    expect(find.textContaining('Dû aujourd'), findsOneWidget);
    expect(find.text('Dites qui a pris l\'argent.'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  test('every refusal the server names has words in both languages', () {
    for (final code in ['en', 'fr']) {
      final l10n = lookupAppLocalizations(Locale(code));
      for (final reason in [
        'discount_not_direct',
        'discount_reason_required',
        'discount_no_amount',
        'discount_nothing_owed',
        'discount_more_than_owed',
        'discount_paid_not_less',
        'discount_receiver_required',
        'discount_owed_changed',
        'discount_not_found',
        'discount_already_undone',
        'discount_voided',
      ]) {
        expect(
          parkingDiscountRefusalText(l10n, reason),
          isNot(l10n.lotCouldNotSave),
          reason: '$code $reason',
        );
      }
    }
  });
}
