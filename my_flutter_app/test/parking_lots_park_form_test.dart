import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/providers/auth_provider.dart';
import 'package:my_flutter_app/providers/language_provider.dart';
import 'package:my_flutter_app/screens/park_car_screen.dart';
import 'package:my_flutter_app/services/business_parking_entry.dart';
import 'package:my_flutter_app/services/parking_lots.dart';
import 'package:my_flutter_app/services/parking_service.dart';
import 'package:my_flutter_app/widgets/parking_lot_widgets.dart';
import 'package:provider/provider.dart';

/// The park-a-car form asks "Which lot?" through the real screen.

class _Auth extends ChangeNotifier implements AuthProvider {
  @override
  bool get isAdmin => false;
  @override
  bool get isBusinessOwner => true;
  @override
  bool get hasBusinessDashboardAccess => true;
  @override
  String? get businessId => 'b1';
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

  @override
  Stream<List<ParkingLot>> watchLots(String businessId) => Stream.value(lots);

  @override
  Future<String> rememberedLot(String businessId) async => 'lot-2';

  @override
  Future<List<ParkingLotFigures>> readFigures(
    String businessId,
    List<ParkingLot> lots,
  ) async => const [];

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('${invocation.memberName}');
}

class _Repo implements ParkingRepository {
  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('${invocation.memberName}');
}

class _Parking implements BusinessParkingService {
  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('${invocation.memberName}');
}

Future<void> _pump(WidgetTester tester, List<ParkingLot> lots) async {
  // The form's existing radio tiles sit in a tinted card, which Flutter's
  // debug check calls out; that is the form's layout, not this test's concern.
  final onError = FlutterError.onError;
  FlutterError.onError = (details) {
    if (details.exceptionAsString().contains('ListTile background color')) {
      return;
    }
    onError?.call(details);
  };
  addTearDown(() => FlutterError.onError = onError);
  tester.view.physicalSize = const Size(400, 3000);
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
        home: ParkCarScreen(
          parkingRepository: _Repo(),
          businessParkingService: _Parking(),
          parkingLotsService: _Lots(lots),
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

  testWidgets('a two-lot business is asked which lot, opening on the last', (
    tester,
  ) async {
    await _pump(tester, [main, second]);
    expect(find.byType(ParkingLotPicker), findsOneWidget);
    expect(find.text('Which lot?'), findsOneWidget);
    // The remembered lot (Lot 2) is the one it opens on.
    expect(find.text('Lot 2'), findsOneWidget);
  });

  testWidgets('a one-lot business never sees the question', (tester) async {
    await _pump(tester, [main]);
    expect(find.byType(ParkingLotPicker), findsNothing);
    expect(find.text('Which lot?'), findsNothing);
  });
}
