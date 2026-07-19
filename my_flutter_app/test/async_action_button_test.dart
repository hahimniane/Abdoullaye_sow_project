import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/widgets/async_action_button.dart';

void main() {
  testWidgets('shows loading state and prevents repeat activation', (
    tester,
  ) async {
    final completer = Completer<void>();
    var taps = 0;

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: AsyncActionButton.filled(
            label: 'Pay',
            loadingLabel: 'Processing',
            onPressed: () {
              taps += 1;
              return completer.future;
            },
          ),
        ),
      ),
    );

    await tester.tap(find.text('Pay'));
    await tester.pump();

    expect(taps, 1);
    expect(find.text('Processing'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);

    await tester.tap(find.text('Processing'));
    await tester.pump();

    expect(taps, 1);

    completer.complete();
    await tester.pumpAndSettle();

    expect(find.text('Pay'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsNothing);
  });
}
