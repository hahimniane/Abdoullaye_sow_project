import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/app_version_config.dart';
import 'package:my_flutter_app/providers/app_gate_provider.dart';
import 'package:my_flutter_app/widgets/app_gate_boundary.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:provider/provider.dart';

void main() {
  test('local Firebase emulator mode bypasses the internet gate', () {
    final gate = AppGateProvider.localEmulator();
    addTearDown(gate.dispose);

    expect(gate.status, AppGateStatus.ready);
    expect(gate.isBlocking, isFalse);
  });

  test(
    'app config fetch failure fails open after confirmed connectivity',
    () async {
      final gate = AppGateProvider(
        connectivityChecker: () async => const [ConnectivityResult.wifi],
        connectivityChanges: const Stream<List<ConnectivityResult>>.empty(),
        packageInfoLoader: () async => PackageInfo(
          appName: 'Test',
          packageName: 'test',
          version: '1.0.0',
          buildNumber: '1',
        ),
        appConfigLoader: () async => throw Exception('app config unavailable'),
      );

      await gate.refresh();

      expect(gate.status, AppGateStatus.ready);
      expect(gate.lastError, isNotNull);
      gate.dispose();
    },
  );

  test('missing connectivity still blocks startup', () async {
    final gate = AppGateProvider(
      connectivityChecker: () async => const [ConnectivityResult.none],
      connectivityChanges: const Stream<List<ConnectivityResult>>.empty(),
      appConfigLoader: () async => const <String, dynamic>{},
    );

    await gate.refresh();

    expect(gate.status, AppGateStatus.offline);
    gate.dispose();
  });

  testWidgets('offline gate blocks app and shows retry', (tester) async {
    final gate = AppGateProvider.test(status: AppGateStatus.offline);

    await tester.pumpWidget(_TestApp(gate: gate));

    expect(find.text('No internet connection'), findsOneWidget);
    expect(find.text('Retry'), findsOneWidget);
    expect(find.text('App content'), findsOneWidget);
  });

  testWidgets('forced update screen has no continue button', (tester) async {
    final gate = AppGateProvider.test(
      status: AppGateStatus.forceUpdate,
      decision: const AppVersionDecision(
        requirement: AppUpdateRequirement.forceUpdate,
        currentBuild: 1,
        latestBuild: 4,
        minSupportedBuild: 3,
        updateUrl: 'https://example.com/update',
      ),
    );

    await tester.pumpWidget(_TestApp(gate: gate));

    expect(find.text('Update required'), findsOneWidget);
    expect(find.text('Update now'), findsOneWidget);
    expect(find.text('Continue'), findsNothing);
  });

  testWidgets('update warning allows continue', (tester) async {
    final gate = AppGateProvider.test(
      status: AppGateStatus.updateAvailable,
      decision: const AppVersionDecision(
        requirement: AppUpdateRequirement.updateAvailable,
        currentBuild: 2,
        latestBuild: 4,
        minSupportedBuild: 1,
        updateUrl: 'https://example.com/update',
      ),
    );

    await tester.pumpWidget(_TestApp(gate: gate));
    await tester.pump();

    expect(find.text('Update available'), findsOneWidget);
    expect(find.text('Continue'), findsOneWidget);

    await tester.tap(find.text('Continue'));
    await tester.pumpAndSettle();

    expect(gate.status, AppGateStatus.ready);
    expect(find.text('Update available'), findsNothing);
  });

  testWidgets('update button calls launcher wrapper', (tester) async {
    Uri? launched;
    final gate = AppGateProvider.test(
      status: AppGateStatus.forceUpdate,
      decision: const AppVersionDecision(
        requirement: AppUpdateRequirement.forceUpdate,
        currentBuild: 1,
        latestBuild: 4,
        minSupportedBuild: 3,
        updateUrl: 'https://example.com/update',
      ),
      urlLauncher: (url) async {
        launched = url;
        return true;
      },
    );

    await tester.pumpWidget(_TestApp(gate: gate));
    await tester.tap(find.text('Update now'));
    await tester.pump();

    expect(launched, Uri.parse('https://example.com/update'));
  });
}

class _TestApp extends StatelessWidget {
  const _TestApp({required this.gate});

  final AppGateProvider gate;

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider<AppGateProvider>.value(
      value: gate,
      child: MaterialApp(
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: const [Locale('en'), Locale('fr')],
        home: const AppGateBoundary(
          child: Scaffold(body: Center(child: Text('App content'))),
        ),
      ),
    );
  }
}
