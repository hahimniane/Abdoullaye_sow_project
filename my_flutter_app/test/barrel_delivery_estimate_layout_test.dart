import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/send_barrel_screen.dart';

void main() {
  for (final locale in const [Locale('en'), Locale('fr')]) {
    testWidgets(
      'delivery estimate fits a narrow business card in ${locale.languageCode}',
      (tester) async {
        await tester.pumpWidget(
          MaterialApp(
            locale: locale,
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            home: const Scaffold(
              body: Center(
                child: SizedBox(
                  width: 96,
                  child: BarrelDeliveryEstimateChip(label: '10–20 days'),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();

        expect(tester.takeException(), isNull);
        expect(find.byType(BarrelDeliveryEstimateChip), findsOneWidget);
      },
    );
  }
}
