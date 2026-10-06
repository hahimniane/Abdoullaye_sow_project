import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:intl/intl.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/business_profile.dart';
import 'package:my_flutter_app/models/car_purchase.dart';
import 'package:my_flutter_app/screens/staff_purchase_management_screen.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/utils/car_purchase_localization.dart';

/// The purchase screens printed stored codes raw ("hold_review_required",
/// "succeeded") or English only ("Review pending", "Extension: pending").
/// Every code now reads in the viewer's language, on the customer's card and
/// the business's alike, and the business list filters by business and state
/// in the query instead of reading every purchase on the platform.
void main() {
  setUpAll(() => initializeDateFormatting());
  final en = lookupAppLocalizations(const Locale('en'));
  final fr = lookupAppLocalizations(const Locale('fr'));

  group('purchase states', () {
    test('every filterable state has words in both languages', () {
      for (final status in [
        ...carPurchaseStatusFilters,
        ...carViewingStatusFilters,
      ]) {
        for (final l10n in [en, fr]) {
          final label = carPurchaseStatusLabel(l10n, status);
          expect(label, isNotEmpty);
          expect(label, isNot(contains('_')), reason: '$status in ${l10n.localeName}');
          if (status.isNotEmpty) expect(label, isNot(status));
        }
      }
      expect(carPurchaseStatusLabel(en, 'hold_review_required'), 'Review pending');
      expect(carPurchaseStatusLabel(fr, 'hold_review_required'), 'Examen en attente');
      expect(carPurchaseStatusLabel(en, 'no_show'), 'No-show');
      expect(carPurchaseStatusLabel(fr, 'viewing_requested'), fr.viewingStatusRequested);
      // An unknown state is shown as stored, never hidden.
      expect(carPurchaseStatusLabel(en, 'brand_new'), 'brand_new');
    });

    test('payment, extension and forfeiture codes read as words', () {
      expect(carPurchasePaymentStatusLabel(en, 'succeeded'), en.paid);
      expect(carPurchasePaymentStatusLabel(fr, 'succeeded'), 'Payé');
      expect(carPurchasePaymentStatusLabel(fr, 'requires_payment_method'), fr.pending);
      expect(carPurchasePaymentStatusLabel(fr, 'failed'), 'Échoué');
      expect(carPurchaseExtensionStatusLabel(fr, 'rejected'), 'Refusée');
      expect(carPurchaseExtensionStatusLabel(en, 'approved'), en.approved);
      expect(carPurchaseForfeitureStatusLabel(en, 'review_pending'), 'Review pending');
    });

    test('the extension line is one localized sentence', () {
      final purchase = CarPurchase.fromMap('p1', {
        'carTitle': '2014 Toyota Corolla',
        'paymentType': 'reservation_deposit',
        'purchaseStatus': 'reserved',
        'extensionRequestStatus': 'pending',
        'extensionRequestedHoldUntilDate': DateTime(2026, 10, 9),
        'extensionExtraAmount': 40,
        'extensionPaymentStatus': 'succeeded',
      });
      final usd = NumberFormat.simpleCurrency(name: 'USD');
      final english = carPurchaseExtensionLine(en, purchase, usd, 'en');
      expect(english, startsWith('Extension: Pending • Oct 9, 2026'));
      expect(english, contains(r'extra $40.00'));
      expect(english, endsWith('payment Paid'));
      final french = carPurchaseExtensionLine(fr, purchase, usd, 'fr');
      expect(french, startsWith('Prolongation : En attente'));
      expect(french, contains('supplément'));
      expect(french, endsWith('paiement Payé'));
      expect(french, isNot(contains('Extension')));
    });
  });

  group('whose purchases the list reads', () {
    test('a business user only ever reads their own business', () {
      expect(
        purchaseListBusinessId(
          isAdmin: false,
          ownBusinessId: ' biz-1 ',
          chosenBusinessId: 'other',
        ),
        'biz-1',
      );
      expect(
        purchaseListBusinessId(
          isAdmin: false,
          ownBusinessId: null,
          chosenBusinessId: '',
        ),
        isNull,
        reason: 'no business, no read - not the whole platform',
      );
    });

    test('an admin reads every business until one is chosen', () {
      expect(
        purchaseListBusinessId(
          isAdmin: true,
          ownBusinessId: 'biz-1',
          chosenBusinessId: '',
        ),
        '',
      );
      expect(
        purchaseListBusinessId(
          isAdmin: true,
          ownBusinessId: null,
          chosenBusinessId: 'biz-9',
        ),
        'biz-9',
      );
    });
  });

  group('the list filters', () {
    Future<void> pump(
      WidgetTester tester,
      Widget child, {
      Locale locale = const Locale('en'),
    }) async {
      tester.view.physicalSize = const Size(375, 900);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.light,
          locale: locale,
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          home: Scaffold(body: child),
        ),
      );
      await tester.pumpAndSettle();
    }

    const businesses = [
      BusinessProfile(id: 'biz-1', name: 'Dala Shipping'),
      BusinessProfile(id: 'biz-2', name: 'Keren Auto'),
    ];

    testWidgets('an admin picks a business; a state chip filters',
        (tester) async {
      final chosen = <String>[];
      final states = <String>[];
      await pump(
        tester,
        PurchaseListFilters(
          businesses: Stream.value(businesses),
          chosenBusinessId: '',
          onBusiness: chosen.add,
          statuses: carPurchaseStatusFilters,
          status: '',
          onStatus: states.add,
        ),
      );
      expect(find.text('All businesses'), findsOneWidget);
      await tester.tap(find.byKey(const Key('purchase-business-filter')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Keren Auto').last);
      await tester.pumpAndSettle();
      expect(chosen, ['biz-2']);

      expect(find.text('Review pending'), findsOneWidget);
      await tester.tap(
        find.byKey(const ValueKey('purchase-status:reserved')),
      );
      expect(states, ['reserved']);
    });

    testWidgets('a business user sees no business picker', (tester) async {
      await pump(
        tester,
        PurchaseListFilters(
          businesses: null,
          chosenBusinessId: '',
          onBusiness: (_) {},
          statuses: carViewingStatusFilters,
          status: '',
          onStatus: (_) {},
        ),
      );
      expect(find.byKey(const Key('purchase-business-filter')), findsNothing);
      expect(find.byKey(const Key('purchase-status-filter')), findsOneWidget);
    });

    testWidgets('a chosen business no longer approved stays selectable',
        (tester) async {
      await pump(
        tester,
        PurchaseListFilters(
          businesses: Stream.value(businesses),
          chosenBusinessId: 'biz-gone',
          onBusiness: (_) {},
          statuses: carPurchaseStatusFilters,
          status: 'reserved',
          onStatus: (_) {},
        ),
      );
      expect(find.text('biz-gone'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('reads in French', (tester) async {
      final controller = StreamController<List<BusinessProfile>>();
      addTearDown(controller.close);
      await pump(
        tester,
        PurchaseListFilters(
          businesses: controller.stream,
          chosenBusinessId: '',
          onBusiness: (_) {},
          statuses: carPurchaseStatusFilters,
          status: '',
          onStatus: (_) {},
        ),
        locale: const Locale('fr'),
      );
      expect(find.text('Toutes les entreprises'), findsOneWidget);
      expect(find.text('Entreprise'), findsOneWidget);
      expect(find.text('Tous'), findsOneWidget);
      expect(find.text('En attente'), findsOneWidget);
    });

    testWidgets('load more stays busy until the bigger page arrives',
        (tester) async {
      var taps = 0;
      await pump(
        tester,
        PurchaseListLoadMore(loading: false, onTap: () => taps++),
      );
      expect(find.text('Load more'), findsOneWidget);
      await tester.tap(find.byKey(const Key('purchase-load-more')));
      expect(taps, 1);
      await tester.pumpWidget(
        MaterialApp(
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          locale: const Locale('fr'),
          home: Scaffold(
            body: PurchaseListLoadMore(loading: true, onTap: () => taps++),
          ),
        ),
      );
      await tester.pump();
      expect(find.text('Charger plus'), findsOneWidget);
      await tester.tap(find.byKey(const Key('purchase-load-more')));
      expect(taps, 1);
    });
  });
}
