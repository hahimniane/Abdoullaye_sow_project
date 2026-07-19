import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/customer_order.dart';
import 'package:my_flutter_app/providers/language_provider.dart';
import 'package:my_flutter_app/screens/tracking_screen.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:provider/provider.dart';

class _FakeTrackingRepository implements CustomerTrackingRepository {
  _FakeTrackingRepository(this.shipments);

  final List<CustomerTrackingShipment> shipments;
  String? watchedCustomerUid;

  @override
  Stream<List<CustomerTrackingShipment>> watchCustomerShipments(
    String customerUid,
  ) {
    watchedCustomerUid = customerUid;
    return Stream.value(shipments);
  }
}

Future<void> _pumpTracking(
  WidgetTester tester,
  _FakeTrackingRepository repository, {
  Locale locale = const Locale('en'),
}) async {
  final language = LanguageProvider()..setLanguage(locale.languageCode);
  await tester.pumpWidget(
    ChangeNotifierProvider.value(
      value: language,
      child: MaterialApp(
        theme: AppTheme.light,
        locale: locale,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: TrackingScreen(
          repository: repository,
          customerUidOverride: 'customer-freight',
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  test('tracking sources include both barrel and freight collections', () {
    expect(
      trackingShipmentCollections,
      containsAll(<String>['barrelShipments', 'freightShipments']),
    );
  });

  test('freight tracking data preserves customer-visible tracking fields', () {
    final shipment = CustomerTrackingShipment.fromFreightData('freight-1', {
      'trackingCode': 'FRT-2026-001',
      'receiverName': 'Aissatou Diallo',
      'destinationCountryName': 'Guinea',
      'businessName': 'Laawol Freight',
      'price': 245,
      'status': 'in_transit',
      'paymentStatus': 'succeeded',
      'mode': 'air',
      'weightKg': 18.5,
      'estimatedWeightKg': 18.5,
      'verifiedWeightKg': 20,
      'estimatedTotal': 245,
      'finalTotal': 265,
      'priceSettlementStatus': 'balance_due',
      'balanceDue': 20,
    });

    expect(shipment.isFreight, isTrue);
    expect(shipment.trackingCode, 'FRT-2026-001');
    expect(shipment.receiverName, 'Aissatou Diallo');
    expect(shipment.destinationCountryName, 'Guinea');
    expect(shipment.weightKg, 18.5);
    expect(shipment.estimatedWeightKg, 18.5);
    expect(shipment.verifiedWeightKg, 20);
    expect(shipment.finalTotal, 265);
    expect(shipment.balanceDue, 20);
  });

  testWidgets('freight shipment is visible on tracking in English and French', (
    tester,
  ) async {
    final repository = _FakeTrackingRepository([
      CustomerTrackingShipment.fromFreightData('freight-1', {
        'trackingCode': 'FRT-2026-001',
        'receiverName': 'Aissatou Diallo',
        'destinationCountryName': 'Guinea',
        'businessName': 'Laawol Freight',
        'price': 245,
        'status': 'in_transit',
        'paymentStatus': 'succeeded',
        'mode': 'air',
        'weightKg': 18.5,
      }),
    ]);

    await _pumpTracking(tester, repository);
    expect(tester.takeException(), isNull);
    expect(repository.watchedCustomerUid, 'customer-freight');
    expect(find.text('FRT-2026-001'), findsOneWidget);
    expect(find.textContaining('Air freight'), findsOneWidget);

    await _pumpTracking(tester, repository, locale: const Locale('fr'));
    expect(find.text('FRT-2026-001'), findsOneWidget);
    expect(find.textContaining('Fret aérien'), findsOneWidget);
  });

  testWidgets('freight balance is visible and actionable in tracking', (
    tester,
  ) async {
    final repository = _FakeTrackingRepository([
      CustomerTrackingShipment.fromFreightData('freight-balance', {
        'trackingCode': 'FRT-BALANCE-001',
        'receiverName': 'Aissatou Diallo',
        'destinationCountryName': 'Guinea',
        'businessName': 'Laawol Freight',
        'price': 125,
        'estimatedTotal': 125,
        'finalTotal': 150,
        'status': 'awaiting_balance_payment',
        'paymentStatus': 'succeeded',
        'priceSettlementStatus': 'balance_due',
        'balanceDue': 25,
        'mode': 'air',
        'estimatedWeightKg': 10,
        'verifiedWeightKg': 12,
      }),
    ]);

    await _pumpTracking(tester, repository);
    expect(tester.takeException(), isNull);
    expect(find.text('Additional payment required'), findsWidgets);
    expect(find.textContaining('Pay balance of'), findsOneWidget);
    expect(find.textContaining('Confirmed weight: 12.0 kg'), findsOneWidget);

    await _pumpTracking(tester, repository, locale: const Locale('fr'));
    expect(find.text('Paiement supplémentaire requis'), findsWidgets);
    expect(find.textContaining('Payer le solde de'), findsOneWidget);
  });
}
