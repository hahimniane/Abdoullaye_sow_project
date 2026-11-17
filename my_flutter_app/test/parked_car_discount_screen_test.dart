import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/parked_car.dart';
import 'package:my_flutter_app/providers/auth_provider.dart';
import 'package:my_flutter_app/providers/language_provider.dart';
import 'package:my_flutter_app/screens/parked_car_details_screen.dart';
import 'package:my_flutter_app/services/business_parking_entry.dart';
import 'package:my_flutter_app/services/parking_whatsapp.dart';
import 'package:provider/provider.dart';

/// The discount buttons are on the parked car's payment card
/// (docs/PARKING_DISCOUNT.md): "Give a discount" and "Settle for a lower
/// amount" for a car the business records payments for, nothing for a
/// payment-link car.

class _Auth extends ChangeNotifier implements AuthProvider {
  @override
  bool get isAdmin => true;
  @override
  bool get isStaff => true;
  @override
  bool get hasContainersAccess => false;
  @override
  bool hasBusinessPermission(String permission) => true;
  @override
  dynamic noSuchMethod(Invocation invocation) {
    if (invocation.isGetter) return null;
    return super.noSuchMethod(invocation);
  }
}

class _FakeParking implements BusinessParkingService {
  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('${invocation.memberName}');
}

/// The "Send on WhatsApp" card's service: no message on any car.
class _NoMessages implements ParkingWhatsAppService {
  @override
  Future<ParkingWhatsAppLastStatus?> lastStatus({
    required String businessId,
    required String carId,
  }) async => null;

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('${invocation.memberName}');
}

ParkedCar _car({String paymentMethod = 'direct'}) => ParkedCar(
  id: 'car1',
  trackingCode: 'TRK123',
  ownerName: 'Awa Camara',
  carMake: 'Toyota',
  carModel: 'Corolla',
  carYear: '2018',
  vinNumber: '',
  parkingDate: DateTime(2026, 10, 1),
  paymentFields: {
    'source': 'business',
    'businessId': 'biz1',
    'customerName': 'Awa Camara',
    'customerPhone': '+13475550101',
    'customerEmail': '',
    'carMake': 'Toyota',
    'carModel': 'Corolla',
    'carYear': '2018',
    'vinNumber': '',
    'parkingDate': DateTime(2026, 10, 1),
    'dailyRate': 12,
    'status': 'parked',
    'paymentMethod': paymentMethod,
    'paymentStatus': paymentMethod == 'direct'
        ? 'awaiting_direct_payment'
        : 'awaiting_link_payment',
  },
);

Future<void> _pump(WidgetTester tester, ParkedCar car, String lang) async {
  final onError = FlutterError.onError;
  FlutterError.onError = (details) {
    if (details.exceptionAsString().contains('ListTile background color')) {
      return;
    }
    onError?.call(details);
  };
  addTearDown(() => FlutterError.onError = onError);
  tester.view.physicalSize = const Size(400, 4000);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>.value(value: _Auth()),
        ChangeNotifierProvider<LanguageProvider>.value(
          value: LanguageProvider()..setLanguage(lang),
        ),
      ],
      child: MaterialApp(
        locale: Locale(lang),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        home: ParkedCarDetailsScreen(
          parkedCar: car,
          businessParkingService: _FakeParking(),
          parkingMessages: Stream.value(const <ParkingMessage>[]),
          parkingWhatsAppEnabled: Stream.value(false),
          parkingWhatsAppService: _NoMessages(),
        ),
      ),
    ),
  );
  for (var i = 0; i < 20; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

void main() {
  testWidgets('a direct car offers both discount actions', (tester) async {
    await _pump(tester, _car(), 'en');
    expect(find.byKey(const Key('discount-open-settle')), findsOneWidget);
    expect(find.byKey(const Key('discount-open-give')), findsOneWidget);
    expect(find.text('Settle for a lower amount'), findsOneWidget);
  });

  testWidgets('a payment-link car offers none', (tester) async {
    await _pump(tester, _car(paymentMethod: 'paymentLink'), 'en');
    expect(find.byKey(const Key('discount-open-give')), findsNothing);
  });

  testWidgets('the same buttons read in French', (tester) async {
    await _pump(tester, _car(), 'fr');
    expect(find.text('Accorder une remise'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
