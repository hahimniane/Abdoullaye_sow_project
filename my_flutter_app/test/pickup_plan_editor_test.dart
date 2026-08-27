import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/widgets/pickup_plan_editor.dart';

/// The business profile's Save button calls
/// `PickupPlanEditorState.validate()` BEFORE it shows any progress, and
/// returns early when it gets a message back. So a validate() that reports a
/// problem for a plan that is actually complete makes Save look dead: no
/// spinner, no write, and only a snackbar the user may never see.
///
/// These tests pin that boundary down without a device or an emulator.
Future<PickupPlanEditorState> pumpEditor(
  WidgetTester tester, {
  required Map<String, dynamic>? plan,
  List<String> enabledServices = const [
    'barrelShipping',
    'freight',
    'carTransport',
  ],
  bool isNewYorkBased = false,
}) async {
  final key = GlobalKey<PickupPlanEditorState>();
  await tester.pumpWidget(
    MaterialApp(
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(
        body: SingleChildScrollView(
          child: PickupPlanEditor(
            key: key,
            canEdit: true,
            isNewYorkBased: isNewYorkBased,
            initialPlan: plan,
            enabledServices: enabledServices,
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return key.currentState!;
}

AppLocalizations l10nOf(WidgetTester tester) {
  final context = tester.element(find.byType(PickupPlanEditor));
  return AppLocalizations.of(context)!;
}

void main() {
  testWidgets('a complete stored flat plan validates clean', (tester) async {
    // Exactly the shape Business 1 has on file: pickup on, flat 20/100,
    // every service explicitly set to "No pickup".
    final state = await pumpEditor(tester, plan: {
      'version': 1,
      'shared': {
        'enabled': true,
        'mode': 'flat',
        'flatFee': 20,
        'maxPickupMiles': 100,
      },
      'services': {
        'barrels': {'inherit': false, 'enabled': false},
        'freight': {'inherit': false, 'enabled': false},
        'carTransport': {'inherit': false, 'enabled': false},
      },
    });

    expect(state.validate(l10nOf(tester)), isNull,
        reason: 'a complete plan must not block Save');
  });

  testWidgets('a plan a business has never configured validates clean',
      (tester) async {
    // Save must work for a business that simply does not offer pickup.
    final state = await pumpEditor(tester, plan: null);
    expect(state.validate(l10nOf(tester)), isNull);
    expect(state.buildPlan(), isNull,
        reason: 'nothing configured means nothing to send');
  });

  testWidgets('an incomplete custom override reports its own service',
      (tester) async {
    final state = await pumpEditor(tester, plan: {
      'version': 1,
      'shared': {
        'enabled': true,
        'mode': 'flat',
        'flatFee': 20,
        'maxPickupMiles': 100,
      },
      'services': {
        // Enabled custom override with NO travel cap - the real mistake.
        'barrels': {'inherit': false, 'enabled': true, 'mode': 'flat',
          'flatFee': 10},
      },
    });

    final error = state.validate(l10nOf(tester));
    expect(error, isNotNull);
    expect(error, contains('Barrel shipping'));
  });

  testWidgets('editing the shared fee still validates and is carried through',
      (tester) async {
    final state = await pumpEditor(tester, plan: {
      'version': 1,
      'shared': {
        'enabled': true,
        'mode': 'flat',
        'flatFee': 20,
        'maxPickupMiles': 100,
      },
      'services': const {},
    });

    // Reproduces the reported flow: change only the flat fee, then save.
    final feeField = find.widgetWithText(TextField, '20');
    expect(feeField, findsOneWidget);
    await tester.enterText(feeField, '30');
    await tester.pump();

    expect(state.validate(l10nOf(tester)), isNull,
        reason: 'a simple fee edit must not block Save');
    final plan = state.buildPlan();
    expect(plan?['shared'], containsPair('flatFee', 30));
  });

  /// The editor has to describe what the SERVER will do, not what its own
  /// switch appears to say. A service with its own fees keeps taking pickups
  /// when the shared plan is off, because `resolveServicePickup` reads the
  /// override first and never consults the shared flag - so a screen that
  /// called that "off" would be describing a business that is still
  /// collecting parcels.
  testWidgets('says who is taking pickups when only one service is set up', (
    tester,
  ) async {
    await pumpEditor(
      tester,
      plan: {
        'shared': {'enabled': false},
        'services': {
          'barrels': {
            'inherit': false,
            'enabled': true,
            'mode': 'distance',
            'maxPickupMiles': 30,
            'baseFee': 10,
            'perMileFee': 2,
            'minimumFee': 15,
            'originAddress': '100 Test Avenue, Bronx, NY',
          },
        },
      },
    );

    expect(find.textContaining('Taking pickups: Barrel shipping'), findsOne);
    expect(
      find.textContaining('Customers bring these to you'),
      findsOne,
    );
  });

  testWidgets('warns a service that follows a switched-off shared plan', (
    tester,
  ) async {
    await pumpEditor(tester, plan: {
      'shared': {'enabled': false},
      'services': const <String, dynamic>{},
    });

    // The silent dead end: the dropdown reads "follow the shared plan" and
    // means no pickup at all while that plan is off.
    expect(
      find.textContaining('the shared plan above is off'),
      findsWidgets,
    );
    expect(find.textContaining('No service is taking pickups'), findsOne);
  });

  testWidgets('never labels the shared switch as if it governed everything', (
    tester,
  ) async {
    await pumpEditor(tester, plan: null);
    expect(find.text('Use one shared plan'), findsOne);
    expect(find.text('Offer home pickup'), findsNothing);
  });
}
