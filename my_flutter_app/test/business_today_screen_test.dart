import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/business_today_screen.dart';
import 'package:my_flutter_app/services/business_today.dart';
import 'package:my_flutter_app/services/business_today_service.dart';
import 'package:my_flutter_app/theme/app_theme.dart';

import 'support/business_today_fixtures.dart';

/// The Today screen, rendered with a fake service: a parking-only business, a
/// shipping-only business and limited staff each see only their own parts; an
/// error offers Try again; a ledger alert can be dismissed; French fits a
/// 320 px phone.

TodayLedgerEvent _event(String id, int minute, {String action = 'paid'}) =>
    TodayLedgerEvent(
      id: id,
      entityType: '',
      action: action,
      summary: 'Entry $id',
      byStaffId: 'staff-1',
      at: DateTime(2026, 10, 21, 12, minute),
    );

Future<void> _pump(
  WidgetTester tester,
  BusinessTodayApi api, {
  Locale locale = const Locale('en'),
  Size size = const Size(390, 1800),
  double textScale = 1,
  bool ledger = false,
  Duration timeout = const Duration(seconds: 20),
  void Function(BuildContext, TodayAttentionItem)? onOpenAttention,
  void Function(BuildContext)? onOpenContainers,
  bool settle = true,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.light,
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      builder: (context, app) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(textScale)),
        child: app!,
      ),
      home: BusinessTodayScreen(
        businessId: 'b1',
        api: api,
        showLedgerAlerts: ledger,
        timeout: timeout,
        onOpenAttention: onOpenAttention,
        onOpenContainers: onOpenContainers,
        onOpenLedger: (_) {},
      ),
    ),
  );
  if (settle) await tester.pumpAndSettle();
}

Finder _tile(TodayTileKey key) => find.byKey(Key('today-tile-${key.name}'));
Finder _row(String key) => find.byKey(Key('today-attention-$key'));

void main() {
  setUpAll(() async {
    await initializeDateFormatting('en');
    await initializeDateFormatting('fr');
  });

  test('the home has one Today row, for business people only', () {
    final home = File('lib/screens/home_menu.dart').readAsStringSync();
    expect(
      '_todayDestination('.allMatches(home).length,
      2,
      reason: 'one definition and one use: a single row',
    );
    expect(home, contains("rowKey: const Key('open-today')"));
    expect(home, contains('auth.hasBusinessDashboardAccess'));
    expect(home, contains('BusinessTodayScreen('));
  });

  testWidgets(
    'a parking lot sees its lot, its money and its alerts - no shipping',
    (tester) async {
      final api = FakeBusinessTodayApi(
        response: todayMap(parking: true),
        events: [
          _event('e1', 1),
          _event('e2', 2, action: 'voided'),
        ],
      );
      await _pump(tester, api, ledger: true);

      expect(find.text('Today'), findsOneWidget);
      expect(find.text('October 2026'), findsOneWidget);
      expect(_tile(TodayTileKey.inLot), findsOneWidget);
      expect(find.text('Cars in the lot'), findsOneWidget);
      expect(find.text('Spaces 60'), findsOneWidget);
      expect(_tile(TodayTileKey.collected), findsOneWidget);
      // Money: whole dollars on the tile, cents in the panel.
      expect(find.byKey(const Key('today-figure-collected')), findsOneWidget);
      expect(find.text('Money collected this month'), findsOneWidget);
      // No shipping anywhere.
      expect(_tile(TodayTileKey.packages), findsNothing);
      expect(_tile(TodayTileKey.containers), findsNothing);
      expect(find.text('Containers in progress'), findsNothing);
      expect(_row('packageRequests'), findsNothing);
      expect(_row('waitingPackages'), findsNothing);
      // What is waiting: open invoices, support, parking balances due.
      expect(_row('openInvoices'), findsOneWidget);
      expect(_row('supportRequests'), findsOneWidget);
      expect(_row('parkingOwed'), findsOneWidget);
      // Ledger alerts, newest first, each with Dismiss.
      expect(find.text('Ledger entry voided'), findsOneWidget);
      expect(find.text('Ledger payment received'), findsOneWidget);
      expect(find.text('Dismiss'), findsNWidgets(2));
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'a shipping business sees volume, containers and requests - no lot',
    (tester) async {
      final api = FakeBusinessTodayApi(
        response: todayMap(shipping: true, barrels: true),
      );
      await _pump(tester, api);

      for (final key in [
        TodayTileKey.packages,
        TodayTileKey.barrels,
        TodayTileKey.carsShipped,
        TodayTileKey.containers,
        TodayTileKey.collected,
        TodayTileKey.owed,
      ]) {
        expect(_tile(key), findsOneWidget, reason: key.name);
      }
      expect(_tile(TodayTileKey.inLot), findsNothing);
      expect(_tile(TodayTileKey.shopSales), findsNothing);
      expect(find.text('+17% vs last month'), findsOneWidget);
      expect(_row('packageRequests'), findsOneWidget);
      expect(_row('waitingPackages'), findsOneWidget);
      expect(_row('barrelOrders'), findsOneWidget);
      expect(_row('parkingOwed'), findsNothing);
      // Containers in progress.
      expect(find.text('Containers in progress'), findsOneWidget);
      expect(find.text('MSKU4820193'), findsOneWidget);
      expect(find.text('Loading'), findsOneWidget);
      expect(find.text('Shipped'), findsOneWidget);
      expect(find.textContaining('Sailed Oct 12, 2026'), findsOneWidget);
      // No ledger alerts without the lot (and none were read).
      expect(find.text('Dismiss'), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('staff with limited permissions see only their work, no money', (
    tester,
  ) async {
    final api = FakeBusinessTodayApi(
      response: todayMap(shipping: true, finance: false),
    );
    await _pump(tester, api);

    expect(_tile(TodayTileKey.collected), findsNothing);
    expect(_tile(TodayTileKey.owed), findsNothing);
    expect(find.text('Money collected this month'), findsNothing);
    expect(find.text('Still owed by customers'), findsNothing);
    expect(_row('packagesOwed'), findsNothing);
    expect(_row('packageRequests'), findsOneWidget);
    expect(_tile(TodayTileKey.packages), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('with nothing waiting the page says so', (tester) async {
    final map = todayMap(finance: false);
    final today = map['today']! as Map<String, Object?>;
    today['queues'] = <String, Object?>{'supportRequests': 0};
    await _pump(tester, FakeBusinessTodayApi(response: map));
    expect(find.text('Nothing is waiting on you right now.'), findsOneWidget);
  });

  testWidgets('a failed load says so and Try again loads it', (tester) async {
    final api = FakeBusinessTodayApi(error: Exception('boom'));
    await _pump(tester, api);

    expect(find.byKey(const Key('today-failed')), findsOneWidget);
    expect(find.byKey(const Key('today-loading')), findsNothing);
    api
      ..error = null
      ..response = todayMap(parking: true);
    await tester.tap(find.byKey(const Key('today-retry')));
    await tester.pumpAndSettle();

    expect(find.byKey(const Key('today-failed')), findsNothing);
    expect(_tile(TodayTileKey.inLot), findsOneWidget);
    expect(api.loads, 2);
  });

  testWidgets('a load that never answers still resolves', (tester) async {
    final api = _NeverApi();
    await _pump(
      tester,
      api,
      timeout: const Duration(milliseconds: 200),
      settle: false,
    );
    expect(find.byKey(const Key('today-loading')), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 400));
    await tester.pump();
    expect(find.byKey(const Key('today-loading')), findsNothing);
    expect(find.byKey(const Key('today-retry')), findsOneWidget);
  });

  testWidgets(
    'Refresh asks the server for a fresh count and keeps the figures on a failure',
    (tester) async {
      final api = FakeBusinessTodayApi(response: todayMap(parking: true));
      await _pump(tester, api);
      expect(api.refreshes, [false]);

      await tester.tap(find.byKey(const Key('today-refresh')));
      await tester.pumpAndSettle();
      expect(api.refreshes, [false, true]);

      api.error = Exception('offline');
      await tester.tap(find.byKey(const Key('today-refresh')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('today-refresh-failed')), findsOneWidget);
      expect(
        _tile(TodayTileKey.inLot),
        findsOneWidget,
        reason: 'last figures stay',
      );
    },
  );

  testWidgets('Dismiss acknowledges the alert and takes it off the list', (
    tester,
  ) async {
    final api = FakeBusinessTodayApi(
      response: todayMap(parking: true),
      events: [
        _event('e1', 1),
        _event('e2', 2, action: 'voided'),
      ],
    );
    await _pump(tester, api, ledger: true);

    await tester.tap(find.byKey(const Key('today-ledger-dismiss-e2')));
    await tester.pumpAndSettle();

    expect(api.dismissed, ['e2']);
    expect(find.text('Ledger entry voided'), findsNothing);
    expect(find.text('Ledger payment received'), findsOneWidget);
  });

  testWidgets('a dismiss that fails keeps the alert and says so', (
    tester,
  ) async {
    final api = FakeBusinessTodayApi(
      response: todayMap(parking: true),
      events: [_event('e1', 1)],
      dismissError: Exception('denied'),
    );
    await _pump(tester, api, ledger: true);

    await tester.tap(find.byKey(const Key('today-ledger-dismiss-e1')));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    expect(find.text('Ledger payment received'), findsOneWidget);
    expect(find.text('Could not dismiss that. Try again.'), findsOneWidget);
  });

  testWidgets('a row opens the place it is about', (tester) async {
    final opened = <String>[];
    var containers = 0;
    final api = FakeBusinessTodayApi(response: todayMap(shipping: true));
    await _pump(
      tester,
      api,
      onOpenAttention: (_, item) => opened.add('${item.key}:${item.view.name}'),
      onOpenContainers: (_) => containers++,
    );

    await tester.tap(_row('packageRequests'));
    await tester.tap(_row('waitingPackages'));
    await tester.tap(_row('openInvoices'));
    await tester.tap(find.byKey(const Key('today-open-containers')));
    await tester.pump();

    expect(opened, [
      'packageRequests:requests',
      'waitingPackages:waiting',
      'openInvoices:none',
    ]);
    expect(containers, 1);
  });

  testWidgets('French on a 320 px phone: no overflow, French words', (
    tester,
  ) async {
    final api = FakeBusinessTodayApi(
      response: todayMap(
        shipping: true,
        parking: true,
        shop: true,
        carSales: true,
        barrels: true,
        freight: true,
        transport: true,
      ),
      events: [
        _event('e1', 1),
        _event('e2', 2, action: 'voided'),
      ],
    );
    await _pump(
      tester,
      api,
      locale: const Locale('fr'),
      size: const Size(320, 6000),
      ledger: true,
    );

    expect(find.text("Aujourd'hui"), findsOneWidget);
    expect(find.text('Argent encaissé'), findsOneWidget);
    expect(find.text('À traiter'), findsOneWidget);
    expect(find.text('Conteneurs en cours'), findsOneWidget);
    expect(find.text('Ignorer'), findsNWidgets(2));
    expect(find.textContaining('Comparé à'), findsOneWidget);
    expect(find.text('Cash'), findsNothing);
    expect(find.byKey(const Key('today-owed-total')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('French at 320 px and a larger text size does not overflow', (
    tester,
  ) async {
    final api = FakeBusinessTodayApi(
      response: todayMap(shipping: true, parking: true, shop: true),
    );
    await _pump(
      tester,
      api,
      locale: const Locale('fr'),
      size: const Size(320, 6000),
      textScale: 1.3,
    );
    expect(tester.takeException(), isNull);
  });
}

class _NeverApi extends FakeBusinessTodayApi {
  @override
  Future<BusinessTodayResponse> load(
    String businessId, {
    bool refresh = false,
  }) => Completer<BusinessTodayResponse>().future;
}
