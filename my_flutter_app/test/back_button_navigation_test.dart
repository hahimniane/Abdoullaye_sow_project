import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
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

  test('named root-tab routes request visible back buttons', () {
    final mainSource = File('lib/main.dart').readAsStringSync();

    expect(mainSource, contains("const SellCarsScreen(showBackButton: true)"));
    expect(mainSource, contains("const TrackingScreen(showBackButton: true)"));
    expect(
      mainSource,
      contains("const MyPurchasesScreen(showBackButton: true)"),
    );
  });

  test('bottom-tab shell keeps root pages back-button free', () {
    final shellSource = File(
      'lib/screens/customer_home_screen.dart',
    ).readAsStringSync();

    expect(shellSource, contains('const SellCarsScreen()'));
    expect(shellSource, contains('const MyPurchasesScreen()'));
    expect(shellSource, contains('const TrackingScreen()'));
  });

  test('embedded settings detail screens keep callback back behavior', () {
    final shellSource = File(
      'lib/screens/customer_home_screen.dart',
    ).readAsStringSync();
    final accountSource = File(
      'lib/screens/account_profile_screen.dart',
    ).readAsStringSync();
    final walletSource = File(
      'lib/screens/wallet_screen.dart',
    ).readAsStringSync();

    expect(shellSource, contains('WalletScreen(onBack: () => _selectTab(4))'));
    expect(
      shellSource,
      contains('AccountProfileScreen(onBack: () => _selectTab(4))'),
    );
    expect(accountSource, contains('AppBackButton(onPressed: _close)'));
    expect(walletSource, contains('_WalletHeader(onBack: _back)'));
  });
}
