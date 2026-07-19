import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/utils/auth_navigation.dart';

void main() {
  testWidgets('forgot password opens on root from a customer tab', (
    tester,
  ) async {
    await tester.pumpWidget(
      _NestedNavigationHarness(
        onPressed: (context) => openForgotPassword(context),
        destinationRoutes: {
          forgotPasswordRoute: (_) =>
              const Scaffold(body: Text('Forgot password destination')),
        },
      ),
    );

    await tester.tap(find.text('Navigate'));
    await tester.pumpAndSettle();

    expect(find.text('Forgot password destination'), findsOneWidget);
  });

  testWidgets('business login clears root stack and opens staff home', (
    tester,
  ) async {
    await tester.pumpWidget(
      _NestedNavigationHarness(
        onPressed: (context) =>
            navigateAfterLogin(context, hasBusinessDashboardAccess: true),
        destinationRoutes: {
          staffHomeRoute: (_) =>
              const Scaffold(body: Text('Staff home destination')),
        },
      ),
    );

    await tester.tap(find.text('Navigate'));
    await tester.pumpAndSettle();

    expect(find.text('Staff home destination'), findsOneWidget);
    expect(find.text('Nested tab root'), findsNothing);
  });
}

class _NestedNavigationHarness extends StatelessWidget {
  const _NestedNavigationHarness({
    required this.onPressed,
    required this.destinationRoutes,
  });

  final void Function(BuildContext context) onPressed;
  final Map<String, WidgetBuilder> destinationRoutes;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      routes: destinationRoutes,
      home: Navigator(
        onGenerateRoute: (settings) => MaterialPageRoute<void>(
          settings: settings,
          builder: (context) => Scaffold(
            body: Column(
              children: [
                const Text('Nested tab root'),
                FilledButton(
                  onPressed: () => onPressed(context),
                  child: const Text('Navigate'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
