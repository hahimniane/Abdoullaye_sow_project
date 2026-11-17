import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/car_purchase.dart';
import 'package:my_flutter_app/services/purchase_filters.dart';
import 'package:my_flutter_app/utils/car_purchase_localization.dart';
import 'package:my_flutter_app/widgets/purchase_quick_filters.dart';

CarPurchase _p(
  String id, {
  String car = '2019 Honda Civic',
  String buyer = 'Fatou Diallo',
  String phone = '+12125550100',
  String status = 'reserved',
  String? paymentType,
  Object? holdReview,
  String? extension,
}) => CarPurchase.fromMap(id, {
  'carTitle': car,
  'buyerName': buyer,
  'buyerPhone': phone,
  'purchaseStatus': status,
  'paymentStatus': 'succeeded',
  'destinationCountryName': 'Guinea',
  'depositAmount': 500,
  'depositCurrency': 'USD',
  'createdAt': DateTime(2026, 11, 1),
  'paymentType': ?paymentType,
  'holdReviewRequiredAt': ?holdReview,
  'extensionRequestStatus': ?extension,
});

void main() {
  final list = [
    _p('hold', paymentType: 'reservation_deposit'),
    _p(
      'review',
      status: 'hold_review_required',
      holdReview: DateTime(2026, 11, 2),
    ),
    _p(
      'ext',
      buyer: 'Kofi Mensah',
      extension: 'pending',
      paymentType: 'reservation_deposit',
    ),
    _p(
      'view-new',
      status: 'viewing_requested',
      paymentType: 'viewing_reservation',
    ),
    _p(
      'view-counter',
      status: 'viewing_countered',
      paymentType: 'viewing_reservation',
    ),
    _p('done', status: 'completed', car: '2015 Ford F-150'),
  ];

  List<String> ids(List<CarPurchase> l) => l.map((p) => p.id).toList();

  test('needs action: hold review, pending extension, unanswered viewing', () {
    expect(ids(list.where(purchaseNeedsAction).toList()), [
      'review',
      'ext',
      'view-new',
    ]);
    expect(purchaseNeedsActionCount(list), 3);
  });

  test('a viewing countered by the business waits on the customer, not us', () {
    expect(purchaseNeedsAction(list[4]), isFalse);
  });

  test('paid holds are reservation deposits only', () {
    expect(ids(filterPurchases(list, quick: PurchaseQuickFilter.paidHolds)), [
      'hold',
      'ext',
    ]);
  });

  test('search reads car, buyer, phone, status and country', () {
    expect(ids(filterPurchases(list, query: 'ford')), ['done']);
    expect(ids(filterPurchases(list, query: 'KOFI')), ['ext']);
    expect(ids(filterPurchases(list, query: '5550100 civic')).length, 5);
    expect(ids(filterPurchases(list, query: 'hold_review')), ['review']);
    expect(ids(filterPurchases(list, query: 'guinea')).length, 6);
    expect(filterPurchases(list, query: 'zzz'), isEmpty);
  });

  test('search and a quick filter combine; no filter returns the list', () {
    expect(
      ids(
        filterPurchases(
          list,
          query: 'kofi',
          quick: PurchaseQuickFilter.needsAction,
        ),
      ),
      ['ext'],
    );
    expect(identical(filterPurchases(list), list), isTrue);
  });

  test('no_show is a viewings filter', () {
    expect(carViewingStatusFilters, contains('no_show'));
  });

  group('bar', () {
    Widget app(Widget child, {String lang = 'en'}) => MaterialApp(
      locale: Locale(lang),
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      home: Scaffold(body: SingleChildScrollView(child: child)),
    );

    testWidgets('chips toggle and the search reports what is typed', (
      tester,
    ) async {
      PurchaseQuickFilter quick = PurchaseQuickFilter.all;
      String query = '';
      await tester.pumpWidget(
        app(
          StatefulBuilder(
            builder: (context, setState) => PurchaseQuickFilterBar(
              query: query,
              quick: quick,
              showPaidHolds: true,
              needsActionCount: 3,
              onQueryChanged: (v) => setState(() => query = v),
              onQuickChanged: (v) => setState(() => quick = v),
            ),
          ),
        ),
      );
      expect(find.text('Needs action (3)'), findsOneWidget);
      await tester.tap(find.byKey(const Key('purchase-quick:paidHolds')));
      await tester.pump();
      expect(quick, PurchaseQuickFilter.paidHolds);
      await tester.tap(find.byKey(const Key('purchase-quick:needsAction')));
      await tester.pump();
      expect(quick, PurchaseQuickFilter.needsAction);
      await tester.tap(find.byKey(const Key('purchase-quick:needsAction')));
      await tester.pump();
      expect(quick, PurchaseQuickFilter.all);
      await tester.enterText(find.byKey(const Key('purchase-search')), 'kofi');
      expect(query, 'kofi');
    });

    testWidgets('viewings queue offers no Paid holds chip', (tester) async {
      await tester.pumpWidget(
        app(
          PurchaseQuickFilterBar(
            query: '',
            quick: PurchaseQuickFilter.all,
            showPaidHolds: false,
            onQueryChanged: (_) {},
            onQuickChanged: (_) {},
          ),
        ),
      );
      expect(find.byKey(const Key('purchase-quick:paidHolds')), findsNothing);
      expect(find.text('Needs action'), findsOneWidget);
    });

    testWidgets('French at 320 px wide: no overflow', (tester) async {
      tester.view.physicalSize = const Size(320, 700);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        app(
          PurchaseQuickFilterBar(
            query: '',
            quick: PurchaseQuickFilter.all,
            showPaidHolds: true,
            needsActionCount: 12,
            onQueryChanged: (_) {},
            onQuickChanged: (_) {},
          ),
          lang: 'fr',
        ),
      );
      expect(find.text('À traiter (12)'), findsOneWidget);
      expect(find.text('Réservations payées'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
