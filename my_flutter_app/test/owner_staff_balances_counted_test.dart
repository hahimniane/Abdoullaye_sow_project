import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/staff_balances_screen.dart';
import 'package:my_flutter_app/services/staff_balances.dart';

/// "What counts as the business's money" (docs/STAFF_BALANCES.md §7): the
/// owner's switches on Staff balances. Callables are a recorder.

Map<String, Object?> _answer({Map<String, Object?>? counted}) => {
  'asOfMs': DateTime(2026, 11, 16, 9).millisecondsSinceEpoch,
  'staff': [
    {'staffId': 'ama', 'name': 'Ama', 'heldCents': 20000, 'netCents': 20000},
  ],
  'businessAccount': {'receivedCents': 0, 'pendingInCents': 0},
  'pending': <Object?>[],
  'counted': ?counted,
};

class _Calls {
  final log = <Map<String, Object?>>[];
  Map<String, Object?> counted = {};
  Object? refusal;

  Future<Object?> call(String name, Map<String, Object?> payload) async {
    log.add(payload);
    if (payload['action'] == 'set_counted_sources') {
      if (refusal != null) throw refusal!;
      counted = Map<String, Object?>.from(payload['sources']! as Map);
      return {'success': true};
    }
    return _answer(counted: counted.isEmpty ? null : counted);
  }

  List<Map<String, Object?>> sent() => [
    for (final p in log)
      if (p['action'] == 'set_counted_sources') p,
  ];
}

class _NoFeed implements StaffHandoverFeed {
  @override
  Stream<List<StaffHandover>> watch(
    String businessId, {
    bool pendingOnly = false,
  }) => const Stream.empty();
}

Future<void> _pump(
  WidgetTester tester,
  _Calls calls, {
  required bool owner,
  Locale locale = const Locale('en'),
  Size size = const Size(800, 2400),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      locale: locale,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: StaffBalancesScreen(
        businessId: 'b1',
        currentUid: 'ama',
        isOwner: owner,
        service: StaffBalancesService(caller: calls.call),
        feed: _NoFeed(),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  setUpAll(() async {
    await initializeDateFormatting('en');
    await initializeDateFormatting('fr');
  });

  group('the rules', () {
    test('every key is filled from the defaults; invoices are off', () {
      expect(countedSourcesFrom(null), {
        'parking': true,
        'activity': true,
        'package': true,
        'shop': true,
        'invoice': false,
      });
    });

    test('the business choice wins; a non-boolean is ignored', () {
      final c = countedSourcesFrom({
        'parking': false,
        'invoice': true,
        'shop': 'yes',
        'unknown': true,
      });
      expect(c['parking'], isFalse);
      expect(c['invoice'], isTrue);
      expect(c['shop'], isTrue);
      expect(c.containsKey('unknown'), isFalse);
    });

    test('the snapshot reads the answer and defaults when it is missing', () {
      final with_ = StaffBalancesSnapshot.fromCallable(
        _answer(counted: {'package': false}),
      );
      expect(with_.counted['package'], isFalse);
      expect(with_.counted['parking'], isTrue);
      expect(StaffBalancesSnapshot.fromCallable(_answer()).counted, {
        ...countedSourceDefaults,
      });
    });

    test('the service sends the whole choice', () async {
      final calls = _Calls();
      await StaffBalancesService(
        caller: calls.call,
      ).setCountedSources('b1', {'parking': false});
      expect(calls.sent().single, {
        'action': 'set_counted_sources',
        'businessId': 'b1',
        'sources': {
          'parking': false,
          'activity': true,
          'package': true,
          'shop': true,
          'invoice': false,
        },
      });
    });

    test('a refusal carries its reason', () async {
      final calls = _Calls()
        ..refusal = FirebaseFunctionsException(
          message: 'x',
          code: 'permission-denied',
          details: {'reason': 'counted_sources_owner_only'},
        );
      await expectLater(
        StaffBalancesService(
          caller: calls.call,
        ).setCountedSources('b1', countedSourceDefaults),
        throwsA(
          isA<StaffBalancesFailure>().having(
            (f) => f.reason,
            'reason',
            'counted_sources_owner_only',
          ),
        ),
      );
    });
  });

  group('the screen', () {
    testWidgets('the owner sees five switches and invoices off', (
      tester,
    ) async {
      await _pump(tester, _Calls(), owner: true);
      for (final key in countedSourceKeys) {
        await tester.ensureVisible(find.byKey(Key('sbal-counted-$key')));
        final tile = tester.widget<SwitchListTile>(
          find.byKey(Key('sbal-counted-$key')),
        );
        expect(tile.value, key != 'invoice', reason: key);
      }
      expect(find.text("What counts as the business's money"), findsOneWidget);
    });

    testWidgets('turning invoices on sends the whole choice and re-reads', (
      tester,
    ) async {
      final calls = _Calls();
      await _pump(tester, calls, owner: true);
      await tester.ensureVisible(find.byKey(const Key('sbal-counted-invoice')));
      await tester.tap(find.byKey(const Key('sbal-counted-invoice')));
      await tester.pumpAndSettle();
      expect(calls.sent().single['sources'], {
        'parking': true,
        'activity': true,
        'package': true,
        'shop': true,
        'invoice': true,
      });
      expect(
        find.text('Saved. The balances now count only what is ticked.'),
        findsOneWidget,
      );
      await tester.pumpAndSettle(const Duration(seconds: 5));
      await tester.ensureVisible(find.byKey(const Key('sbal-counted-invoice')));
      expect(
        tester
            .widget<SwitchListTile>(
              find.byKey(const Key('sbal-counted-invoice')),
            )
            .value,
        isTrue,
      );
    });

    testWidgets('a server refusal is said in words', (tester) async {
      final calls = _Calls()
        ..refusal = FirebaseFunctionsException(
          message: 'x',
          code: 'permission-denied',
          details: {'reason': 'counted_sources_owner_only'},
        );
      await _pump(tester, calls, owner: true);
      await tester.ensureVisible(find.byKey(const Key('sbal-counted-shop')));
      await tester.tap(find.byKey(const Key('sbal-counted-shop')));
      await tester.pumpAndSettle();
      expect(
        find.text(
          "Only the business owner can choose what counts as the business's money.",
        ),
        findsOneWidget,
      );
    });

    testWidgets('staff only read the choice: no switches', (tester) async {
      await _pump(tester, _Calls(), owner: false);
      await tester.ensureVisible(find.byKey(const Key('sbal-counted')));
      expect(find.byType(Switch), findsNothing);
      expect(find.byType(SwitchListTile), findsNothing);
      expect(
        find.text(
          'Counted: Parking, Lot jobs, Packages and containers, Shop sales',
        ),
        findsOneWidget,
      );
      expect(
        find.text('The business owner chooses what counts.'),
        findsOneWidget,
      );
    });

    testWidgets('French at 320 px wide does not overflow', (tester) async {
      for (final owner in [true, false]) {
        await _pump(
          tester,
          _Calls(),
          owner: owner,
          locale: const Locale('fr'),
          size: const Size(320, 3200),
        );
        await tester.ensureVisible(find.byKey(const Key('sbal-counted')));
        expect(
          find.text("Ce qui compte comme l'argent de l'entreprise"),
          findsOneWidget,
        );
        expect(tester.takeException(), isNull);
      }
    });
  });
}
