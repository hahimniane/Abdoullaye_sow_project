import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/utils/business_registration_navigation.dart';

void main() {
  testWidgets(
    'business registration opens on the root navigator from a customer tab',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          routes: {
            businessRegistrationRoute: (_) =>
                const Scaffold(body: Text('Business registration destination')),
          },
          home: Navigator(
            onGenerateRoute: (settings) => MaterialPageRoute<void>(
              settings: settings,
              builder: (context) => Scaffold(
                body: Center(
                  child: FilledButton(
                    onPressed: () => openBusinessRegistration(context),
                    child: const Text('Register business'),
                  ),
                ),
              ),
            ),
          ),
        ),
      );

      await tester.tap(find.text('Register business'));
      await tester.pumpAndSettle();

      expect(find.text('Business registration destination'), findsOneWidget);
    },
  );
}
