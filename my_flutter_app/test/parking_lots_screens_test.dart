import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/parked_car.dart';
import 'package:my_flutter_app/providers/auth_provider.dart';
import 'package:my_flutter_app/providers/language_provider.dart';
import 'package:my_flutter_app/screens/parked_car_details_screen.dart';
import 'package:my_flutter_app/services/business_parking_entry.dart';
import 'package:my_flutter_app/services/parking_lots.dart';
import 'package:my_flutter_app/services/parking_whatsapp.dart';
import 'package:provider/provider.dart';

/// The lot on a parked car's page, through the real screen: the lot it stands
/// in, and the move.

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

class _Lots implements ParkingLotsService {
  _Lots(this.lots);
  final List<ParkingLot> lots;
  final moves = <String>[];

  @override
  Stream<List<ParkingLot>> watchLots(String businessId) => Stream.value(lots);

  @override
  Future<List<ParkingLotFigures>> readFigures(
    String businessId,
    List<ParkingLot> lots,
  ) async => const [];

  @override
  Future<ParkingLotMoveResult> moveCar({
    required String entryId,
    required String parkingLotId,
  }) async {
    moves.add('$entryId>$parkingLotId');
    return ParkingLotMoveResult(
      moved: true,
      parkingLotId: parkingLotId,
      parkingLotName: lots.firstWhere((l) => l.id == parkingLotId).name,
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('${invocation.memberName}');
}

class _Parking implements BusinessParkingService {
  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('${invocation.memberName}');
}

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

ParkedCar _car({bool voided = false}) => ParkedCar(
  id: 'car1',
  trackingCode: 'TRK123',
  ownerName: 'Awa Camara',
  carMake: 'Toyota',
  carModel: 'Corolla',
  carYear: '2018',
  vinNumber: '',
  parkingDate: DateTime(2026, 10, 1),
  parkingEndDate: DateTime(2026, 10, 5),
  paymentFields: {
    'source': 'business',
    'businessId': 'b1',
    'customerName': 'Awa Camara',
    'customerPhone': '+13475550101',
    'carMake': 'Toyota',
    'carModel': 'Corolla',
    'carYear': '2018',
    'paymentMethod': 'direct',
    'paymentStatus': 'awaiting_direct_payment',
    if (voided) 'voided': true,
  },
);

Future<void> _pump(WidgetTester tester, ParkedCar car, _Lots lots) async {
  final onError = FlutterError.onError;
  FlutterError.onError = (details) {
    if (details.exceptionAsString().contains('ListTile background color')) {
      return;
    }
    onError?.call(details);
  };
  addTearDown(() => FlutterError.onError = onError);
  tester.view.physicalSize = const Size(400, 4200);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MultiProvider(
      providers: [
        ChangeNotifierProvider<AuthProvider>.value(value: _Auth()),
        ChangeNotifierProvider<LanguageProvider>.value(
          value: LanguageProvider()..setLanguage('en'),
        ),
      ],
      child: MaterialApp(
        locale: const Locale('en'),
        supportedLocales: AppLocalizations.supportedLocales,
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        home: ParkedCarDetailsScreen(
          parkedCar: car,
          businessParkingService: _Parking(),
          parkingMessages: Stream.value(const <ParkingMessage>[]),
          parkingWhatsAppEnabled: Stream.value(false),
          parkingWhatsAppService: _NoMessages(),
          parkingLotsService: lots,
        ),
      ),
    ),
  );
  for (var i = 0; i < 20; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

void main() {
  const main = ParkingLot(id: 'b1_main', name: 'Lot 1', totalSpaces: 60);
  const second = ParkingLot(id: 'lot-2', name: 'Lot 2', totalSpaces: 40);

  testWidgets('a car page names its lot and moves it', (tester) async {
    final lots = _Lots([main, second]);
    await _pump(tester, _car(), lots);
    // A car with no lot is read as standing in the first lot.
    expect(find.text('Lot: Lot 1'), findsOneWidget);
    final move = find.byKey(const ValueKey<String>('parking-lot-move'));
    await tester.ensureVisible(move);
    await tester.tap(move);
    await tester.pump();
    await tester.pump();
    expect(lots.moves, ['car1>lot-2']);
    expect(find.text('Moved to Lot 2.'), findsOneWidget);
  });

  testWidgets('a one-lot business sees no lot on the car page', (tester) async {
    await _pump(tester, _car(), _Lots([main]));
    expect(find.textContaining('Lot:'), findsNothing);
    expect(
      find.byKey(const ValueKey<String>('parking-lot-move')),
      findsNothing,
    );
  });

  testWidgets('a voided car cannot be moved', (tester) async {
    await _pump(tester, _car(voided: true), _Lots([main, second]));
    expect(
      find.byKey(const ValueKey<String>('parking-lot-move')),
      findsNothing,
    );
  });
}
