import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/marketplace_disclosure_acceptance.dart';
import 'package:my_flutter_app/widgets/marketplace_transaction_disclosure.dart';

Widget _testApp({required Locale locale}) {
  return MaterialApp(
    locale: locale,
    localizationsDelegates: AppLocalizations.localizationsDelegates,
    supportedLocales: AppLocalizations.supportedLocales,
    home: Builder(
      builder: (context) => Scaffold(
        body: FilledButton(
          onPressed: () async {
            final result = await confirmMarketplaceTransaction(
              context,
              providerNames: 'Example Business',
              transactionSummary: 'Freight payment',
            );
            if (context.mounted && result != null) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text('${result.version}:${result.locale}')),
              );
            }
          },
          child: const Text('Open'),
        ),
      ),
    ),
  );
}

void main() {
  testWidgets('requires an unchecked explicit acceptance before continuing', (
    tester,
  ) async {
    await tester.pumpWidget(_testApp(locale: const Locale('en')));
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();

    expect(find.text('Understand who provides this service'), findsOneWidget);
    expect(
      find.textContaining('Example Business is an independent'),
      findsOneWidget,
    );
    FilledButton continueButton = tester.widget(
      find.widgetWithText(FilledButton, 'Continue to payment'),
    );
    expect(continueButton.onPressed, isNull);

    final acceptanceText = find.text(
      'I understand the business’s responsibility and want to continue.',
    );
    await tester.ensureVisible(acceptanceText);
    await tester.pumpAndSettle();
    await tester.tap(acceptanceText);
    await tester.pump();
    continueButton = tester.widget(
      find.widgetWithText(FilledButton, 'Continue to payment'),
    );
    expect(continueButton.onPressed, isNotNull);

    await tester.tap(find.widgetWithText(FilledButton, 'Continue to payment'));
    await tester.pumpAndSettle();
    expect(
      find.text('${MarketplaceDisclosureAcceptance.currentVersion}:en'),
      findsOneWidget,
    );
  });

  testWidgets('renders the responsibility disclosure in French', (
    tester,
  ) async {
    await tester.pumpWidget(_testApp(locale: const Locale('fr')));
    await tester.tap(find.text('Open'));
    await tester.pumpAndSettle();

    expect(find.text('Comprendre qui fournit ce service'), findsOneWidget);
    expect(
      find.textContaining('est une entreprise indépendante'),
      findsOneWidget,
    );
    expect(find.textContaining('Laawol n’est ni le vendeur'), findsOneWidget);
  });
}
