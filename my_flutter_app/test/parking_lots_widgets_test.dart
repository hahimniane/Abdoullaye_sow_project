import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/providers/auth_provider.dart';
import 'package:my_flutter_app/providers/language_provider.dart';
import 'package:my_flutter_app/screens/parking_lots_settings_screen.dart';
import 'package:my_flutter_app/services/business_parking_entry.dart';
import 'package:my_flutter_app/services/parking_lots.dart';
import 'package:my_flutter_app/widgets/parking_lot_widgets.dart';
import 'package:provider/provider.dart';

/// The parking lots on the phone (docs/PARKING_LOTS.md): the picker on the
/// park-a-car form, the move on a car's page, the strip that filters the list
/// and the owner's settings.

class _Auth extends ChangeNotifier implements AuthProvider {
  @override
  bool get isAdmin => false;
  @override
  bool get isBusinessOwner => true;
  @override
  String? get businessId => 'b1';
  @override
  dynamic noSuchMethod(Invocation invocation) {
    if (invocation.isGetter) return null;
    return super.noSuchMethod(invocation);
  }
}

class _FakeLots implements ParkingLotsService {
  _FakeLots(
    this.lots, {
    this.remembered = '',
    this.figures = const [],
    this.settings = const ParkingBusinessSettings(),
  });

  List<ParkingLot> lots;
  String remembered;
  List<ParkingLotFigures> figures;
  ParkingBusinessSettings settings;
  Object? moveError;
  Object? saveError;
  final moves = <String>[];
  final saves = <ParkingLotDraft>[];
  final saveIds = <String>[];
  final bookings = <String>[];

  @override
  Stream<List<ParkingLot>> watchLots(String businessId) => Stream.value(lots);

  @override
  Future<String> rememberedLot(String businessId) async => remembered;

  @override
  Future<List<ParkingLotFigures>> readFigures(
    String businessId,
    List<ParkingLot> lots,
  ) async => figures;

  @override
  Future<ParkingBusinessSettings> readSettings(String businessId) async =>
      settings;

  @override
  Future<ParkingLotMoveResult> moveCar({
    required String entryId,
    required String parkingLotId,
  }) async {
    final error = moveError;
    if (error != null) throw error;
    moves.add(parkingLotId);
    return ParkingLotMoveResult(
      moved: true,
      parkingLotId: parkingLotId,
      parkingLotName: lots.firstWhere((l) => l.id == parkingLotId).name,
    );
  }

  @override
  Future<void> saveLot({
    required String businessId,
    required ParkingLotDraft draft,
    String lotId = '',
  }) async {
    final error = saveError;
    if (error != null) throw error;
    saves.add(draft);
    saveIds.add(lotId);
  }

  @override
  Future<void> setBookingLot({
    required String businessId,
    required String lotId,
  }) async => bookings.add(lotId);

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnimplementedError('${invocation.memberName}');
}

FirebaseFunctionsException _refusal(String reason) =>
    FirebaseFunctionsException(
      message: 'English words from the server',
      code: 'failed-precondition',
      details: <String, Object?>{'reason': reason},
    );

const _main = ParkingLot(
  id: 'b1_main',
  name: 'Lot 1',
  totalSpaces: 60,
  isMain: true,
);
const _second = ParkingLot(id: 'lot-2', name: 'Lot 2', totalSpaces: 40);
const _closed = ParkingLot(
  id: 'lot-3',
  name: 'Lot 3',
  totalSpaces: 7,
  open: false,
);

ParkingLotFigures _told(ParkingLot lot, int used) => ParkingLotFigures(
  lot: lot,
  totals: BusinessParkingTotals(
    inLot: used,
    reserved: 0,
    left: 0,
    collected: 0,
    owed: 0,
    spacesTotal: lot.usableSpaces,
    spacesUsed: used,
  ),
);

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  String lang = 'en',
  double width = 400,
}) async {
  tester.view.physicalSize = Size(width, 1400);
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
        home: Scaffold(body: SingleChildScrollView(child: child)),
      ),
    ),
  );
  await tester.pump();
  await tester.pump();
}

void main() {
  group('the lot picker on the park-a-car form', () {
    Future<List<ParkingLotChoice>> pumpChooser(
      WidgetTester tester,
      _FakeLots service, {
      String lang = 'en',
      double width = 400,
    }) async {
      final heard = <ParkingLotChoice>[];
      await _pump(
        tester,
        Form(
          child: ParkingLotChooser(
            businessId: 'b1',
            service: service,
            onChanged: heard.add,
          ),
        ),
        lang: lang,
        width: width,
      );
      return heard;
    }

    testWidgets('is hidden for a one-lot business and asks for nothing', (
      tester,
    ) async {
      final heard = await pumpChooser(tester, _FakeLots([_main]));
      expect(find.byType(ParkingLotPicker), findsNothing);
      expect(heard.last, const ParkingLotChoice());
    });

    testWidgets('is hidden when only one lot is open', (tester) async {
      final heard = await pumpChooser(tester, _FakeLots([_main, _closed]));
      expect(find.byType(ParkingLotPicker), findsNothing);
      expect(heard.last.asks, isFalse);
    });

    testWidgets('is required with two open lots: one is always chosen', (
      tester,
    ) async {
      final heard = await pumpChooser(tester, _FakeLots([_main, _second]));
      expect(find.byType(ParkingLotPicker), findsOneWidget);
      expect(find.text('Which lot?'), findsOneWidget);
      expect(heard.last, const ParkingLotChoice(asks: true, lotId: 'b1_main'));
      // There is no way to leave it empty: a picker with no value says so.
      final formKey = GlobalKey<FormState>();
      await tester.pumpWidget(
        MaterialApp(
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(
            body: Form(
              key: formKey,
              child: ParkingLotPicker(
                lots: const [_main, _second],
                value: '',
                onChanged: (_) {},
              ),
            ),
          ),
        ),
      );
      expect(formKey.currentState!.validate(), isFalse);
      await tester.pump();
      expect(
        find.text('Choose which lot the car is parked in.'),
        findsOneWidget,
      );
    });

    testWidgets('opens on the lot this person used last, when it has room', (
      tester,
    ) async {
      final heard = await pumpChooser(
        tester,
        _FakeLots(
          [_main, _second],
          remembered: 'lot-2',
          figures: [_told(_main, 3), _told(_second, 10)],
        ),
      );
      expect(heard.last.lotId, 'lot-2');
      expect(find.text('Lot 2 · 30 free'), findsOneWidget);
    });

    testWidgets('skips a remembered lot that is full', (tester) async {
      final heard = await pumpChooser(
        tester,
        _FakeLots(
          [_main, _second],
          remembered: 'lot-2',
          figures: [_told(_main, 3), _told(_second, 40)],
        ),
      );
      expect(heard.last.lotId, 'b1_main');
    });

    testWidgets('a full lot is marked and cannot be picked', (tester) async {
      await pumpChooser(
        tester,
        _FakeLots(
          [_main, _second],
          figures: [_told(_main, 3), _told(_second, 40)],
        ),
      );
      await tester.tap(find.byType(DropdownButtonFormField<String>));
      await tester.pumpAndSettle();
      expect(find.text('Lot 2 · full'), findsOneWidget);
      await tester.tap(find.text('Lot 2 · full').last);
      await tester.pumpAndSettle();
      // Still on the first lot.
      expect(find.text('Lot 1 · 57 free'), findsWidgets);
    });

    testWidgets('picking another lot is reported to the form', (tester) async {
      final heard = await pumpChooser(tester, _FakeLots([_main, _second]));
      await tester.tap(find.byType(DropdownButtonFormField<String>));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Lot 2').last);
      await tester.pumpAndSettle();
      expect(heard.last, const ParkingLotChoice(asks: true, lotId: 'lot-2'));
    });
  });

  group('moving a car to another lot', () {
    Future<_FakeLots> pumpMove(
      WidgetTester tester, {
      Object? error,
      String lang = 'en',
      double width = 400,
      Map<String, dynamic>? car,
    }) async {
      final service = _FakeLots([_main, _second])..moveError = error;
      await _pump(
        tester,
        ParkingLotMove(
          businessId: 'b1',
          carId: 'car1',
          car: car ?? const {'businessId': 'b1'},
          service: service,
        ),
        lang: lang,
        width: width,
      );
      return service;
    }

    testWidgets('shows the lot the car is in and moves it', (tester) async {
      final service = await pumpMove(tester);
      expect(find.text('Lot: Lot 1'), findsOneWidget);
      expect(find.text('Move to another lot'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey<String>('parking-lot-move')));
      await tester.pump();
      await tester.pump();
      expect(service.moves, ['lot-2']);
      expect(find.text('Moved to Lot 2.'), findsOneWidget);
      // Now in Lot 2: the only other lot is Lot 1.
      expect(find.text('Lot: Lot 2'), findsOneWidget);
    });

    testWidgets('says the server refusal in words, not the server text', (
      tester,
    ) async {
      await pumpMove(tester, error: _refusal('lot_full'));
      await tester.tap(find.byKey(const ValueKey<String>('parking-lot-move')));
      await tester.pump();
      await tester.pump();
      expect(
        find.text('That lot is full. Choose another lot.'),
        findsOneWidget,
      );
      expect(find.textContaining('English words'), findsNothing);
      // The button is usable again (the loading state resolved).
      final button = tester.widget<OutlinedButton>(
        find.byKey(const ValueKey<String>('parking-lot-move')),
      );
      expect(button.onPressed, isNotNull);
    });

    testWidgets('an unknown failure still resolves with a plain sentence', (
      tester,
    ) async {
      await pumpMove(tester, error: StateError('network'));
      await tester.tap(find.byKey(const ValueKey<String>('parking-lot-move')));
      await tester.pump();
      await tester.pump();
      expect(
        find.text('The car could not be moved. Try again.'),
        findsOneWidget,
      );
    });

    testWidgets('a car carrying a lot id is read in that lot', (tester) async {
      await pumpMove(
        tester,
        car: const {'businessId': 'b1', 'parkingLotId': 'lot-2'},
      );
      expect(find.text('Lot: Lot 2'), findsOneWidget);
    });

    testWidgets('is hidden for a one-lot business', (tester) async {
      await _pump(
        tester,
        ParkingLotMove(
          businessId: 'b1',
          carId: 'car1',
          car: const {'businessId': 'b1'},
          service: _FakeLots([_main]),
        ),
      );
      expect(find.text('Move to another lot'), findsNothing);
      expect(find.textContaining('Lot:'), findsNothing);
    });
  });

  group('the lot strip on the parking list', () {
    testWidgets('lists each lot and filters on a tap', (tester) async {
      final picked = <String>[];
      var selected = '';
      late StateSetter set;
      await _pump(
        tester,
        StatefulBuilder(
          builder: (context, setState) {
            set = setState;
            return ParkingLotStrip(
              figures: [_told(_main, 12), _told(_second, 40)],
              selected: selected,
              onSelect: (id) {
                picked.add(id);
                set(() => selected = id);
              },
            );
          },
        ),
      );
      expect(find.text('All lots'), findsOneWidget);
      expect(find.text('12 cars'), findsOneWidget);
      expect(find.text('48 spaces free'), findsOneWidget);
      expect(find.text('Lot 1'), findsOneWidget);
      expect(find.text('Full'), findsOneWidget); // Lot 2 holds its 40.
      await tester.tap(find.byKey(const ValueKey<String>('parking-lot-lot-2')));
      await tester.pump();
      expect(picked, ['lot-2']);
      // Tapping the chosen lot again shows every lot.
      await tester.tap(find.byKey(const ValueKey<String>('parking-lot-lot-2')));
      await tester.pump();
      expect(picked, ['lot-2', '']);
      await tester.tap(find.byKey(const ValueKey<String>('parking-lot-lot-2')));
      await tester.pump();
      await tester.tap(find.text('All lots'));
      await tester.pump();
      expect(picked.last, '');
    });

    testWidgets('the free spaces are said per lot', (tester) async {
      await _pump(
        tester,
        ParkingLotStrip(
          figures: [_told(_main, 12), _told(_second, 39)],
          selected: '',
          onSelect: (_) {},
        ),
      );
      expect(find.text('48 spaces free'), findsOneWidget);
      expect(find.text('1 space free'), findsOneWidget);
    });

    testWidgets('is hidden with fewer than two lots', (tester) async {
      await _pump(
        tester,
        ParkingLotStrip(
          figures: [_told(_main, 12)],
          selected: '',
          onSelect: (_) {},
        ),
      );
      expect(find.text('All lots'), findsNothing);
    });
  });

  group('the owner settings', () {
    Future<_FakeLots> pumpSettings(
      WidgetTester tester, {
      List<ParkingLot> lots = const [_main],
      Object? saveError,
      String lang = 'en',
      double width = 400,
      ParkingBusinessSettings settings = const ParkingBusinessSettings(),
    }) async {
      final service = _FakeLots(lots, settings: settings)
        ..saveError = saveError;
      tester.view.physicalSize = Size(width, 1600);
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
            home: ParkingLotsSettingsScreen(businessId: 'b1', service: service),
          ),
        ),
      );
      await tester.pump();
      await tester.pump();
      return service;
    }

    Future<void> fill(
      WidgetTester tester, {
      String name = 'Lot 2',
      String spaces = '40',
      String blocked = '',
    }) async {
      await tester.tap(find.byKey(const ValueKey<String>('parking-lot-add')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const ValueKey<String>('lot-name')),
        name,
      );
      await tester.enterText(
        find.byKey(const ValueKey<String>('lot-spaces')),
        spaces,
      );
      if (blocked.isNotEmpty) {
        await tester.enterText(
          find.byKey(const ValueKey<String>('lot-blocked')),
          blocked,
        );
      }
    }

    testWidgets('lists the lots with their spaces and address', (tester) async {
      await pumpSettings(tester, lots: const [_main, _second, _closed]);
      expect(find.text('Lot 1'), findsWidgets);
      expect(find.text('60 spaces'), findsOneWidget);
      expect(find.text('Lot 3 · Closed'), findsOneWidget);
      expect(find.text('Online bookings go to'), findsOneWidget);
    });

    testWidgets('a business with no stored lots shows its one lot', (
      tester,
    ) async {
      await pumpSettings(
        tester,
        lots: const [],
        settings: const ParkingBusinessSettings(
          totalSpaces: 30,
          blockedSpaces: 2,
        ),
      );
      expect(find.text('Lot 1'), findsOneWidget);
      expect(find.text('30 spaces · 2 blocked'), findsOneWidget);
      expect(find.text('At the business’s parking address'), findsOneWidget);
    });

    testWidgets('adds a lot', (tester) async {
      final service = await pumpSettings(tester);
      await fill(tester, name: 'Lot 2', spaces: '40', blocked: '3');
      await tester.tap(find.byKey(const ValueKey<String>('lot-save')));
      await tester.pumpAndSettle();
      expect(service.saves, hasLength(1));
      expect(service.saves.single.name, 'Lot 2');
      expect(service.saves.single.totalSpaces, '40');
      expect(service.saves.single.blockedSpaces, '3');
      expect(service.saveIds.single, '');
      // The sheet closed and the owner is told.
      expect(find.byKey(const ValueKey<String>('lot-save')), findsNothing);
      expect(find.text('Saved.'), findsOneWidget);
    });

    testWidgets(
      'a refusal from the server is shown in words and the sheet stays',
      (tester) async {
        final service = await pumpSettings(
          tester,
          saveError: _refusal('lot_limit'),
        );
        await fill(tester);
        await tester.tap(find.byKey(const ValueKey<String>('lot-save')));
        await tester.pumpAndSettle();
        expect(service.saves, isEmpty);
        expect(
          find.text('That is the most lots a business can have.'),
          findsOneWidget,
        );
        expect(find.textContaining('English words'), findsNothing);
        // The save button is back, so the owner can correct and try again.
        final button = tester.widget<FilledButton>(
          find.byKey(const ValueKey<String>('lot-save')),
        );
        expect(button.onPressed, isNotNull);
      },
    );

    testWidgets('closing a lot that still has cars is said in words', (
      tester,
    ) async {
      await pumpSettings(
        tester,
        lots: const [_main, _second],
        saveError: _refusal('lot_has_cars'),
      );
      await tester.tap(find.byKey(const ValueKey<String>('lot-edit-lot-2')));
      await tester.pumpAndSettle();
      await tester.tap(find.byKey(const ValueKey<String>('lot-open')));
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey<String>('lot-save')));
      await tester.pumpAndSettle();
      expect(
        find.text(
          'There are still cars in that lot. Move them to another lot first.',
        ),
        findsOneWidget,
      );
    });

    testWidgets('a name another lot has is refused before the trip', (
      tester,
    ) async {
      final service = await pumpSettings(tester);
      await fill(tester, name: 'lot 1');
      await tester.tap(find.byKey(const ValueKey<String>('lot-save')));
      await tester.pumpAndSettle();
      expect(service.saves, isEmpty);
      expect(find.text('Another lot already has that name.'), findsOneWidget);
    });

    testWidgets('chooses where online bookings go', (tester) async {
      final service = await pumpSettings(tester, lots: const [_main, _second]);
      await tester.tap(find.byType(DropdownButtonFormField<String>));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Lot 2').last);
      await tester.pumpAndSettle();
      expect(service.bookings, ['lot-2']);
    });

    testWidgets(
      'the first lot of a business with none stored is made real first',
      (tester) async {
        final service = await pumpSettings(
          tester,
          lots: const [],
          settings: const ParkingBusinessSettings(totalSpaces: 30),
        );
        await tester.tap(find.byKey(const ValueKey<String>('lot-edit-')));
        await tester.pumpAndSettle();
        await tester.tap(find.byKey(const ValueKey<String>('lot-save')));
        await tester.pumpAndSettle();
        expect(service.bookings, ['b1_main']);
        expect(service.saveIds, ['b1_main']);
      },
    );
  });

  group('French at a 320 px phone', () {
    testWidgets('the picker, the move and the strip do not overflow', (
      tester,
    ) async {
      final service = _FakeLots(
        [_main, _second],
        figures: [_told(_main, 12), _told(_second, 40)],
      );
      await _pump(
        tester,
        Column(
          children: [
            ParkingLotChooser(
              businessId: 'b1',
              service: service,
              onChanged: (_) {},
            ),
            ParkingLotStrip(
              figures: [_told(_main, 12), _told(_second, 40)],
              selected: '',
              onSelect: (_) {},
            ),
            ParkingLotMove(
              businessId: 'b1',
              carId: 'car1',
              car: const {'businessId': 'b1'},
              service: service,
            ),
          ],
        ),
        lang: 'fr',
        width: 320,
      );
      expect(find.text('Quel parc ?'), findsWidgets);
      expect(find.text('Tous les parcs'), findsOneWidget);
      expect(find.text('Déplacer vers un autre parc'), findsOneWidget);
      expect(find.text('Déplacer la voiture'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the settings and its form do not overflow', (tester) async {
      final service = _FakeLots([
        _main,
        _second,
        _closed,
      ], settings: const ParkingBusinessSettings());
      tester.view.physicalSize = const Size(320, 1600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);
      await tester.pumpWidget(
        MultiProvider(
          providers: [
            ChangeNotifierProvider<AuthProvider>.value(value: _Auth()),
            ChangeNotifierProvider<LanguageProvider>.value(
              value: LanguageProvider()..setLanguage('fr'),
            ),
          ],
          child: MaterialApp(
            locale: const Locale('fr'),
            supportedLocales: AppLocalizations.supportedLocales,
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            home: ParkingLotsSettingsScreen(businessId: 'b1', service: service),
          ),
        ),
      );
      await tester.pump();
      await tester.pump();
      expect(find.text('Parcs de stationnement'), findsWidgets);
      expect(find.text('Les réservations en ligne vont à'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await tester.tap(find.byKey(const ValueKey<String>('parking-lot-add')));
      await tester.pumpAndSettle();
      expect(find.text('Ajouter un parc'), findsWidgets);
      expect(find.text('Enregistrer le parc'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
