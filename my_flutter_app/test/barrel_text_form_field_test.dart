import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/screens/send_barrel_screen.dart';

void main() {
  testWidgets('a barrel field clears its submitted error while typing', (
    tester,
  ) async {
    final formKey = GlobalKey<FormState>();

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Form(
            key: formKey,
            child: const BarrelTextFormField(
              label: 'Receiver name',
              validator: _required,
            ),
          ),
        ),
      ),
    );

    expect(find.text('Required'), findsNothing);

    formKey.currentState!.validate();
    await tester.pump();
    expect(find.text('Required'), findsOneWidget);

    await tester.enterText(find.byType(TextFormField), 'Mamadou Bah');
    await tester.pump();

    expect(find.text('Required'), findsNothing);
  });
}

String? _required(String? value) {
  return value == null || value.trim().isEmpty ? 'Required' : null;
}
