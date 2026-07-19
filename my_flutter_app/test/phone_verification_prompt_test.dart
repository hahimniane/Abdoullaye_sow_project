import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/phone_verification_screen.dart';

Future<void> pumpPrompt(WidgetTester tester, {required Locale locale}) async {
  await tester.pumpWidget(
    MaterialApp(
      locale: locale,
      supportedLocales: const [Locale('en'), Locale('fr')],
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: Builder(
        builder: (context) => Scaffold(
          body: Center(
            child: FilledButton(
              onPressed: () => showDialog<bool>(
                context: context,
                builder: (_) => const PhoneVerificationPromptDialog(),
              ),
              child: const Text('Open'),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('Open'));
  await tester.pumpAndSettle();
}

void main() {
  setUp(() {
    TestWidgetsFlutterBinding.ensureInitialized();
  });

  testWidgets('unverified shared-barrel prompt is friendly in English', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await pumpPrompt(tester, locale: const Locale('en'));

    expect(find.text('Verify your phone to continue'), findsOneWidget);
    expect(
      find.textContaining(
        'Shared barrels are available only to customers with a verified',
      ),
      findsOneWidget,
    );
    expect(find.text('Verify phone'), findsOneWidget);
    expect(find.text('Not now'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('unverified shared-barrel prompt fits a narrow French phone', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await pumpPrompt(tester, locale: const Locale('fr'));

    expect(
      find.text('Vérifiez votre téléphone pour continuer'),
      findsOneWidget,
    );
    expect(find.text('Vérifier le téléphone'), findsOneWidget);
    expect(find.text('Pas maintenant'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
