import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/customer_order.dart';
import 'package:my_flutter_app/models/business_review.dart';
import 'package:my_flutter_app/models/shipment_tracking_event.dart';
import 'package:my_flutter_app/providers/language_provider.dart';
import 'package:my_flutter_app/screens/tracking_screen.dart';
import 'package:my_flutter_app/services/business_review_service.dart';
import 'package:my_flutter_app/services/shipment_tracking_service.dart';
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

class _FakeTrackingService extends ShipmentTrackingService {
  @override
  Stream<List<ShipmentTrackingEvent>> eventsForShipment({
    required String relatedCollection,
    required String relatedId,
  }) => Stream.value(const []);

  @override
  Future<void> addMilestone({
    required String relatedCollection,
    required String relatedId,
    required String label,
    String description = '',
    String location = '',
  }) async {}
}

class _FakeReviewService extends BusinessReviewService {
  @override
  Stream<Set<String>> reviewedOrderKeysForCurrentUser() =>
      Stream.value(const <String>{});

  @override
  Stream<List<BusinessReview>> reviewsForBusiness(String businessId) =>
      Stream.value(const []);
}

Future<void> _pumpTracking(
  WidgetTester tester,
  _FakeTrackingRepository repository, {
  Locale locale = const Locale('en'),
  String? focusShipmentId,
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
          focusShipmentId: focusShipmentId,
          trackingService: _FakeTrackingService(),
          reviewService: _FakeReviewService(),
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
    // A shipment booked by weight says nothing about the scale, and the
    // scale is exactly where it is going.
    expect(shipment.weighsAtDropOff, isTrue);
  });

  test('a set price with no allowance is not waiting on a scale', () {
    final setPrice = CustomerTrackingShipment.fromFreightData('freight-flat', {
      'trackingCode': 'FRT-FLAT-001',
      'status': 'pending',
      'paymentStatus': 'succeeded',
      'price': 50,
      'weightVerificationRequired': false,
    });
    expect(setPrice.weighsAtDropOff, isFalse);
    // An allowance puts it back on the scale: the counter checks whether the
    // parcel outgrew what the price covers.
    final withAllowance = CustomerTrackingShipment.fromFreightData(
      'freight-allowance',
      {'status': 'pending', 'weightVerificationRequired': true},
    );
    expect(withAllowance.weighsAtDropOff, isTrue);
  });

  testWidgets('a set-price parcel is never promised a weight confirmation', (
    tester,
  ) async {
    final repository = _FakeTrackingRepository([
      CustomerTrackingShipment.fromFreightData('freight-flat', {
        'trackingCode': 'FRT-FLAT-001',
        'receiverName': 'Aissatou Diallo',
        'destinationCountryName': 'Guinea',
        'businessName': 'Laawol Freight',
        'price': 50,
        'estimatedTotal': 50,
        'status': 'pending',
        'paymentStatus': 'succeeded',
        'priceSettlementStatus': 'settled',
        'mode': 'air',
        'weightVerificationRequired': false,
      }),
    ]);

    await _pumpTracking(tester, repository, focusShipmentId: 'freight-flat');
    expect(tester.takeException(), isNull);
    expect(
      find.textContaining('The price for this item is set'),
      findsOneWidget,
    );
    expect(
      find.textContaining('will confirm the weight after drop-off'),
      findsNothing,
    );

    await _pumpTracking(
      tester,
      repository,
      locale: const Locale('fr'),
      focusShipmentId: 'freight-flat',
    );
    expect(
      find.textContaining('Le prix de cet article est fixé'),
      findsOneWidget,
    );
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

  testWidgets('freight order opens focused with plain next steps', (
    tester,
  ) async {
    final repository = _FakeTrackingRepository([
      CustomerTrackingShipment.fromFreightData('freight-1', {
        'trackingCode': 'FRT-2026-001',
        'receiverName': 'Aissatou Diallo',
        'destinationCountryName': 'Guinea',
        'businessName': 'Laawol Freight',
        'price': 125,
        'estimatedTotal': 125,
        'status': 'pending',
        'paymentStatus': 'succeeded',
        'mode': 'air',
        'estimatedWeightKg': 10,
      }),
      CustomerTrackingShipment.fromFreightData('freight-2', {
        'trackingCode': 'FRT-OTHER-002',
        'receiverName': 'Mamadou Diallo',
        'destinationCountryName': 'Senegal',
        'businessName': 'Other Freight',
        'price': 90,
        'status': 'pending',
        'mode': 'sea',
        'estimatedWeightKg': 8,
      }),
    ]);

    await _pumpTracking(tester, repository, focusShipmentId: 'freight-1');

    expect(tester.takeException(), isNull);
    expect(find.text('Freight order'), findsOneWidget);
    expect(find.text('Next step'), findsOneWidget);
    expect(find.text('Estimate paid'), findsOneWidget);
    expect(
      find.text(
        'Drop off your parcel at Laawol Freight. The business will confirm the weight after drop-off.',
      ),
      findsOneWidget,
    );
    expect(find.text('Paid estimate: \$125.00'), findsOneWidget);
    expect(find.text('Estimated weight: 10.0 kg'), findsOneWidget);
    expect(find.text('FRT-2026-001'), findsOneWidget);
    expect(find.text('FRT-OTHER-002'), findsNothing);
    expect(find.text('Search tracking, receiver, country'), findsNothing);
    expect(find.text('View all shipments'), findsOneWidget);
  });

  testWidgets('arrival copy follows how the receiver gets the parcel', (
    tester,
  ) async {
    Map<String, dynamic> arrived({required bool delivery}) => {
      'trackingCode': 'FRT-ARRIVED-001',
      'receiverName': 'Aissatou Diallo',
      'destinationCountryName': 'Guinea',
      'businessName': 'Laawol Freight',
      'price': 125,
      'estimatedTotal': 125,
      'status': 'ready_for_pickup',
      'paymentStatus': 'succeeded',
      'mode': 'air',
      'estimatedWeightKg': 10,
      'destinationDelivery': delivery,
    };

    // Collected from the business at the destination.
    await _pumpTracking(
      tester,
      _FakeTrackingRepository([
        CustomerTrackingShipment.fromFreightData(
          'freight-collect',
          arrived(delivery: false),
        ),
      ]),
    );
    expect(find.text('Ready for pickup'), findsWidgets);
    expect(find.text('Your parcel is ready for pickup.'), findsOneWidget);
    expect(find.text('Out for delivery'), findsNothing);

    // Nobody is collecting a parcel the business is driving to an address.
    await _pumpTracking(
      tester,
      _FakeTrackingRepository([
        CustomerTrackingShipment.fromFreightData(
          'freight-deliver',
          arrived(delivery: true),
        ),
      ]),
    );
    expect(find.text('Out for delivery'), findsWidgets);
    expect(
      find.text(
        "Your parcel has arrived and is on its way to the receiver's address.",
      ),
      findsOneWidget,
    );
    expect(find.text('Ready for pickup'), findsNothing);
    expect(find.text('Your parcel is ready for pickup.'), findsNothing);
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
