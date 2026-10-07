import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/containers_screen.dart';
import 'package:my_flutter_app/screens/package_result_screen.dart';
import 'package:my_flutter_app/services/container_manifest.dart';
import 'package:my_flutter_app/theme/app_theme.dart';

/// Editing a line already on a container: the same add-line form, opened
/// pre-filled, offered from the line's actions and from the package view -
/// and only while the container is still loading. The sheets touch Firebase
/// only when a valid form is saved, so they are pumped on their own.
ShippingContainer _box(String status) => ShippingContainer.fromMap('c1', {
      'businessId': 'b1',
      'label': 'Sailing 3 Oct, box 2',
      'status': status,
      'destinationCountryId': 'guinea',
      'destinationCountryName': 'Guinea',
    });

ContainerLine _line(String id, Map<String, dynamic> extra) =>
    ContainerLine.fromMap(id, {
      'businessId': 'b1',
      'containerId': 'c1',
      'containerStatus': containerStatusLoading,
      'kind': containerLineKindBarrels,
      'quantity': 3,
      'ownerKind': containerOwnerCustomer,
      'customerName': 'Fatou Diallo',
      'customerPhone': '+16465550100',
      'receiverName': 'Mariama Bah',
      'receiverPhone': '+224620000000',
      'trackingCode': 'CL-K7M4P2',
      ...extra,
    });

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  Locale locale = const Locale('en'),
}) async {
  tester.view.physicalSize = const Size(430, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.light,
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      home: Scaffold(body: SafeArea(child: child)),
    ),
  );
  await tester.pumpAndSettle();
}

String _field(WidgetTester tester, String key) =>
    tester.widget<TextField>(find.byKey(Key(key))).controller!.text;

void main() {
  testWidgets('a loading line offers Edit; a shipped one does not',
      (tester) async {
    final line = _line('l1', const {});
    await _pump(
      tester,
      containerLineActionsSheetForTesting(line: line, open: true),
    );
    expect(find.byKey(const Key('line-edit')), findsOneWidget);
    expect(find.text('Edit line'), findsOneWidget);

    await _pump(
      tester,
      containerLineActionsSheetForTesting(line: line, open: false),
    );
    expect(find.byKey(const Key('line-edit')), findsNothing);
    // Contacts stay correctable after the box ships.
    expect(find.byKey(const Key('line-edit-contacts')), findsOneWidget);
  });

  testWidgets('the add-line form opens pre-filled to edit barrels',
      (tester) async {
    await _pump(
      tester,
      containerLineFormSheetForTesting(
        container: _box(containerStatusLoading),
        existing: _line('l1', const {}),
      ),
    );
    expect(find.text('Edit line'), findsOneWidget);
    expect(find.byKey(const Key('line-edit-note')), findsOneWidget);
    expect(_field(tester, 'line-quantity'), '3');
    expect(_field(tester, 'line-customer'), 'Fatou Diallo');
    expect(_field(tester, 'line-receiver'), 'Mariama Bah');
    // One line is saved and closed: no "add another", no split hint.
    expect(find.byKey(const Key('line-save-and-another')), findsNothing);
    expect(find.byKey(const Key('line-save-edit')), findsOneWidget);
    expect(find.text('Save'), findsOneWidget);

    // The form's own checks still run before anything is sent.
    await tester.enterText(find.byKey(const Key('line-quantity')), '');
    await tester.tap(find.byKey(const Key('line-save-edit')));
    await tester.pumpAndSettle();
    expect(find.text('Enter how many.'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a car opens on its VIN, which never conflicts with itself',
      (tester) async {
    final car = _line('l1', {
      'kind': containerLineKindCar,
      'quantity': 1,
      'vinNumber': 'ABC1234567',
      'carMake': 'Honda',
      'carModel': 'Accord',
      'carYear': '2003',
    });
    final other = _line('l2', {
      'containerId': 'c2',
      'kind': containerLineKindCar,
      'quantity': 1,
      'vinNumber': 'XYZ7654321',
    });
    await _pump(
      tester,
      containerLineFormSheetForTesting(
        container: _box(containerStatusLoading),
        existing: car,
        lines: [car, other],
      ),
    );
    // The lot question is already answered: the car fields show at once.
    expect(find.byKey(const Key('line-lot-answered')), findsOneWidget);
    expect(_field(tester, 'line-vin'), 'ABC1234567');
    expect(find.text('Honda'), findsOneWidget);

    await tester.enterText(find.byKey(const Key('line-vin')), 'ABC1234567');
    await tester.pumpAndSettle();
    expect(find.textContaining('already on'), findsNothing);

    await tester.enterText(find.byKey(const Key('line-vin')), 'XYZ7654321');
    await tester.pumpAndSettle();
    expect(find.textContaining('already on another container'),
        findsOneWidget);
  });

  testWidgets('renders in French', (tester) async {
    await _pump(
      tester,
      containerLineFormSheetForTesting(
        container: _box(containerStatusLoading),
        existing: _line('l1', const {}),
      ),
      locale: const Locale('fr'),
    );
    expect(find.text('Modifier la ligne'), findsOneWidget);
    expect(find.text('Enregistrer'), findsOneWidget);
    expect(find.textContaining('seuls les contacts'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the package view offers Edit only while the box is loading',
      (tester) async {
    var edits = 0;
    await _pump(
      tester,
      packageResultViewForTesting(
        line: _line('l1', const {}),
        container: _box(containerStatusLoading),
        onEditLine: () => edits++,
      ),
    );
    await tester.ensureVisible(find.byKey(const Key('pkg-edit-line')));
    await tester.tap(find.byKey(const Key('pkg-edit-line')));
    await tester.pump();
    expect(edits, 1);

    for (final status in [containerStatusShipped, containerStatusArrived]) {
      await _pump(
        tester,
        packageResultViewForTesting(
          line: _line('l1', {'containerStatus': status}),
          container: _box(status),
          onEditLine: () => edits++,
        ),
      );
      expect(find.byKey(const Key('pkg-edit-line')), findsNothing,
          reason: status);
      expect(find.byKey(const Key('pkg-edit-contacts')), findsOneWidget);
    }
  });
}
