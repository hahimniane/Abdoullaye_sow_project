import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/utils/root_navigation.dart';
import 'package:my_flutter_app/widgets/app_back_button.dart';

void main() {
  testWidgets('AppBackButton calls its local back callback', (tester) async {
    var tapped = false;

    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: AppBackButton(onPressed: () => tapped = true)),
      ),
    );

    expect(find.byTooltip('Back'), findsOneWidget);
    await tester.tap(find.byType(AppBackButton));

    expect(tapped, isTrue);
  });

  testWidgets('root named navigation preserves typed pop results', (
    tester,
  ) async {
    bool? result;

    await tester.pumpWidget(
      MaterialApp(
        routes: {
          '/verify': (context) => Scaffold(
            body: TextButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Verified'),
            ),
          ),
        },
        home: Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              onPressed: () async {
                result = await pushRootNamed<bool>(context, '/verify');
              },
              child: const Text('Open verification'),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('Open verification'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Verified'));
    await tester.pumpAndSettle();

    expect(result, isTrue);
    expect(tester.takeException(), isNull);
  });

  test('named root-tab routes request visible back buttons', () {
    final mainSource = File('lib/main.dart').readAsStringSync();

    expect(mainSource, contains("const SellCarsScreen(showBackButton: true)"));
    expect(mainSource, contains("TrackingScreen("));
    expect(mainSource, contains("showBackButton: true"));
    expect(
      mainSource,
      contains("const MyPurchasesScreen(showBackButton: true)"),
    );
  });

  test('bottom-tab shell keeps tab roots back-button free', () {
    final shellSource = File(
      'lib/screens/customer_home_screen.dart',
    ).readAsStringSync();

    expect(shellSource, contains('return const HomeTab();'));
    expect(shellSource, contains('return const ShippingTab();'));
    expect(shellSource, contains('return const CarsTab();'));
    expect(shellSource, contains('return const ActivityTab();'));
  });

  test('settings detail screens open inside the nested settings navigator', () {
    final shellSource = File(
      'lib/screens/customer_home_screen.dart',
    ).readAsStringSync();
    final accountSource = File(
      'lib/screens/account_profile_screen.dart',
    ).readAsStringSync();
    expect(
      shellSource,
      contains("Navigator.of(context).pushNamed('/account-profile')"),
    );
    expect(accountSource, contains('AppBackButton(onPressed: _close)'));
    // The wallet screen and its /wallet route are gone with the wallet
    // itself (docs/PLAN-2026-08-backlog.md #3) - guard that they stay gone.
    expect(File('lib/screens/wallet_screen.dart').existsSync(), isFalse);
    expect(shellSource, isNot(contains("pushNamed('/wallet')")));
  });

  test('freight orders pass their shipment id into focused tracking', () {
    final ordersSource = File(
      'lib/screens/orders_screen.dart',
    ).readAsStringSync();
    final trackingSource = File(
      'lib/screens/tracking_screen.dart',
    ).readAsStringSync();

    expect(ordersSource, contains('TrackingScreenArguments'));
    expect(ordersSource, contains('shipmentId: order.relatedId'));
    expect(trackingSource, contains('focusShipmentId'));
  });
}
