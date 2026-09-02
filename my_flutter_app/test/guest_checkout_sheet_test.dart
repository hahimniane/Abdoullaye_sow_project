import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/services/guest_checkout_service.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/widgets/guest_checkout_sheet.dart';

Future<void> _openSheet(WidgetTester tester, {String initialName = ''}) async {
  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.light,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(
        body: Builder(
          builder: (context) => Center(
            child: FilledButton(
              onPressed: () => showGuestCheckoutSheet(
                context,
                session: GuestCheckoutSession(),
                initialName: initialName,
              ),
              child: const Text('open'),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('the sheet opens knowing the sender name the form collected', (
    tester,
  ) async {
    // The booking form asks for the sender's name, then this sheet asked
    // for it again from scratch - a guest read that as the screen having
    // lost their work.
    await _openSheet(tester, initialName: '  Mariama Diallo  ');
    expect(
      find.widgetWithText(TextFormField, 'Mariama Diallo'),
      findsOneWidget,
    );
  });

  testWidgets('a form with no sender name opens the sheet blank', (
    tester,
  ) async {
    await _openSheet(tester);
    expect(find.widgetWithText(TextFormField, 'Mariama Diallo'), findsNothing);
  });
}
