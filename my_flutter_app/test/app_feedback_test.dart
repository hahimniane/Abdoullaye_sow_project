import 'package:flutter/services.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/utils/app_feedback.dart';
import 'package:my_flutter_app/widgets/app_snackbars.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, null);
  });

  test('success feedback requests haptic and subtle system sound', () async {
    final calls = <MethodCall>[];
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, (call) async {
          calls.add(call);
          return null;
        });

    await AppFeedback.success();

    expect(
      calls.map((call) => call.method),
      containsAll(<String>['HapticFeedback.vibrate', 'SystemSound.play']),
    );
  });

  test('feedback never throws when platform feedback is unavailable', () async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, (call) {
          throw PlatformException(code: 'unavailable');
        });

    await expectLater(AppFeedback.success(), completes);
    await expectLater(AppFeedback.error(), completes);
  });

  testWidgets('success snackbar helper shows visible feedback', (tester) async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, (call) async {
          return null;
        });

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: Builder(
            builder: (context) {
              return ElevatedButton(
                onPressed: () => showSuccessSnackBar(context, 'Saved.'),
                child: const Text('Save'),
              );
            },
          ),
        ),
      ),
    );

    await tester.tap(find.text('Save'));
    await tester.pump();

    expect(find.text('Saved.'), findsOneWidget);
  });
}
