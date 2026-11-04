import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/label_printer_settings_screen.dart';
import 'package:my_flutter_app/screens/print_tags_sheet.dart';
import 'package:my_flutter_app/services/label_printer.dart';
import 'package:my_flutter_app/services/m221_protocol.dart';
import 'package:my_flutter_app/services/package_labels.dart';
import 'package:my_flutter_app/services/pm241_protocol.dart';
import 'package:my_flutter_app/services/tag_labels.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/widgets/label_print_sheet.dart';
import 'package:my_flutter_app/widgets/label_printer_widgets.dart';
import 'package:my_flutter_app/widgets/lot_sheets.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fixtures/fake_printer.dart';

/// The screens with a Phomemo PM-241 chosen: model shown, the 4 x 6 in test
/// label (asks first), package labels at 4 x 6, product tags refused.

const _pmDevice = PrinterDevice(
  id: 'AA:BB:CC:DD:EE:02',
  name: 'PM-241Z-BT-0470',
  rssi: -50,
);
const _pmSettings = LabelPrinterSettings(
  deviceId: 'AA:BB:CC:DD:EE:02',
  deviceName: 'PM-241Z-BT-0470',
);

FakePrinterTransport _pmTransport() =>
    FakePrinterTransport(pm241: true, devices: const [_pmDevice]);

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  Locale locale = const Locale('en'),
  Size size = const Size(400, 3000),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.light,
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      home: child,
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _tap(WidgetTester tester, String key) async {
  await tester.ensureVisible(find.byKey(Key(key)));
  await tester.tap(find.byKey(Key(key)));
  await tester.pumpAndSettle();
}

bool _isJob(List<int> bytes) =>
    utf8.decode(bytes, allowMalformed: true).startsWith('SIZE 100 mm');

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({labelPrinterExplainedKey: true});
  });

  group('settings with a PM-241', () {
    testWidgets('shows the model, a test label, and no M221 controls', (
      tester,
    ) async {
      final c = fakeController(_pmTransport(), settings: _pmSettings);
      await _pump(tester, LabelPrinterSettingsScreen(printer: c));
      expect(find.text('Phomemo PM-241 · 4×6 labels'), findsOneWidget);
      expect(find.byKey(const Key('label-printer-test-label')), findsOneWidget);
      expect(find.text('Print a test label (4 × 6 in)'), findsOneWidget);
      for (final gone in [
        'label-printer-test-frame',
        'label-printer-test-tag',
        'label-printer-status',
        'label-printer-size',
        'label-printer-package-size',
      ]) {
        expect(find.byKey(Key(gone)), findsNothing, reason: gone);
      }
    });

    testWidgets('an M221 shows its own model and keeps its controls', (
      tester,
    ) async {
      final c = fakeController(FakePrinterTransport());
      await _pump(tester, LabelPrinterSettingsScreen(printer: c));
      expect(find.text('Phomemo M221 · tags and small labels'), findsOneWidget);
      expect(find.byKey(const Key('label-printer-test-tag')), findsOneWidget);
      expect(find.byKey(const Key('label-printer-test-label')), findsNothing);
    });

    testWidgets('the test label asks first: cancel sends nothing', (
      tester,
    ) async {
      final t = _pmTransport();
      final c = fakeController(t, settings: _pmSettings);
      await _pump(tester, LabelPrinterSettingsScreen(printer: c));
      await _tap(tester, 'label-printer-test-label');
      expect(find.text('Print a test label?'), findsOneWidget);
      expect(
        find.text('This uses one 4 × 6 in label from the printer.'),
        findsOneWidget,
      );
      await _tap(tester, 'label-printer-test-label-cancel');
      expect(t.writes, isEmpty);
      expect(t.connects, 0);
    });

    testWidgets('confirming prints one 4 x 6 TSPL label', (tester) async {
      final t = _pmTransport();
      final c = fakeController(t, settings: _pmSettings);
      await _pump(tester, LabelPrinterSettingsScreen(printer: c));
      await _tap(tester, 'label-printer-test-label');
      await _tap(tester, 'label-printer-test-label-go');
      expect(find.text('Printed.'), findsOneWidget);
      final job = pm241LabelJob(
        pm241TestLabel(tagQrMatrix(inventoryTagLink(labelPrinterTestCode))),
      );
      expect(t.allBytes, job.bytes);
      expect(_isJob(t.allBytes), isTrue);
      expect(c.log.text(), contains('model: Phomemo PM-241 (TSPL)'));
    });

    testWidgets('with no printer chosen it says where to choose one', (
      tester,
    ) async {
      final c = fakeController(
        _pmTransport(),
        settings: const LabelPrinterSettings(),
      );
      await _pump(tester, LabelPrinterSettingsScreen(printer: c));
      // No device: the M221 screen (and its buttons) is shown.
      expect(find.byKey(const Key('label-printer-test-label')), findsNothing);
    });

    testWidgets('renders in French', (tester) async {
      final c = fakeController(_pmTransport(), settings: _pmSettings);
      await _pump(
        tester,
        LabelPrinterSettingsScreen(printer: c),
        locale: const Locale('fr'),
        size: const Size(320, 3000),
      );
      expect(find.text('Phomemo PM-241 · étiquettes 4×6'), findsOneWidget);
      expect(
        find.text('Imprimer une étiquette de test (4 × 6 po)'),
        findsOneWidget,
      );
      await _tap(tester, 'label-printer-test-label');
      expect(find.text('Imprimer une étiquette de test ?'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('product tags with a PM-241', () {
    Future<void> openTags(
      WidgetTester tester,
      LabelPrinterController c, {
      Locale locale = const Locale('en'),
    }) async {
      await _pump(
        tester,
        Builder(
          builder: (context) => Scaffold(
            body: TextButton(
              key: const Key('open-sheet'),
              onPressed: () => showPrintTagsSheet(
                context,
                businessId: 'b1',
                itemId: 'i1',
                code: 'IT-K7M4P2',
                title: 'Jordan 11',
                printer: c,
              ),
              child: const Text('open'),
            ),
          ),
        ),
        locale: locale,
        size: const Size(400, 2400),
      );
      await tester.tap(find.byKey(const Key('open-sheet')));
      await tester.pumpAndSettle();
    }

    testWidgets('say so clearly and send nothing', (tester) async {
      final t = _pmTransport();
      final c = fakeController(t, settings: _pmSettings);
      await openTags(tester, c);
      await _tap(tester, 'inv-tags-print');
      expect(
        find.textContaining('only prints 4 × 6 in package labels'),
        findsOneWidget,
      );
      expect(t.writes, isEmpty);
      expect(t.connects, 0);
    });

    testWidgets('the message is in French too', (tester) async {
      final t = _pmTransport();
      final c = fakeController(t, settings: _pmSettings);
      await openTags(tester, c, locale: const Locale('fr'));
      await _tap(tester, 'inv-tags-print');
      expect(
        find.textContaining('n’imprime que les étiquettes de colis 4 × 6 po'),
        findsOneWidget,
      );
      expect(t.writes, isEmpty);
    });

    testWidgets('an M221 still prints tags', (tester) async {
      final t = FakePrinterTransport();
      final c = fakeController(t);
      await openTags(tester, c);
      await _tap(tester, 'inv-tags-print');
      expect(find.text('1 tag printed.'), findsOneWidget);
    });
  });

  group('package labels with a PM-241', () {
    Future<void> openSheet(
      WidgetTester tester,
      LabelPrintSheet sheet, {
      Locale locale = const Locale('en'),
    }) async {
      tester.view.physicalSize = const Size(430, 2600);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.light,
          locale: locale,
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          home: Scaffold(
            body: Builder(
              builder: (context) => TextButton(
                key: const Key('open-sheet'),
                onPressed: () => showLotSheet<bool>(context, sheet),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.byKey(const Key('open-sheet')));
      await tester.pumpAndSettle();
    }

    final labelSet = PackageLabelSet(
      labels: [
        PackageLabel.fromMap({
          'code': 'CL-K7M4P2',
          'what': 'Barrel',
          'receiver': 'Mariama Bah',
          'receiverPhone': '+224621234567',
        }),
      ],
      businessName: 'Nensona',
    );

    LabelPrintSheet sheet(
      FakePrinterTransport t,
      List<String> sizes, {
      LabelPrinterSettings settings = _pmSettings,
    }) => LabelPrintSheet(
      subtitle: 'x',
      rememberFormat: false,
      onPrint: (_) async {},
      target: const PackageLabelsTarget(businessId: 'b1', lineId: 'w1'),
      loader: (_) async => labelSet,
      printer: fakeController(t, settings: settings),
      renderer: (layout) async {
        sizes.add(layout.size.id);
        return LabelBitmap(layout.size.widthDots, layout.size.heightDots)
          ..fill(8, 8, 200, 200);
      },
    );

    testWidgets('prints at 4 x 6 by itself, with no size to choose', (
      tester,
    ) async {
      final t = _pmTransport();
      final sizes = <String>[];
      await openSheet(tester, sheet(t, sizes));
      await _tap(tester, 'labels-method-printer');
      expect(find.byKey(const Key('labels-package-size')), findsNothing);
      expect(
        find.text(
          'Straight to PM-241Z-BT-0470 from this phone, on 4 × 6 in labels.',
        ),
        findsOneWidget,
      );
      expect(
        find.textContaining('Each 4 × 6 in label carries'),
        findsOneWidget,
      );
      await _tap(tester, 'labels-print');
      expect(sizes, [packageSizePm241]);
      expect(find.text('1 label printed.'), findsOneWidget);
      expect(_isJob(t.allBytes), isTrue);
      expect(t.creditViolations, 0);
    });

    testWidgets('an M221 keeps its size picker and its own size', (
      tester,
    ) async {
      final t = FakePrinterTransport();
      final sizes = <String>[];
      await openSheet(
        tester,
        sheet(
          t,
          sizes,
          settings: const LabelPrinterSettings(
            deviceId: 'AA:BB:CC:DD:EE:01',
            deviceName: 'Q2A1',
          ),
        ),
      );
      await _tap(tester, 'labels-method-printer');
      expect(find.byKey(const Key('labels-package-size')), findsOneWidget);
      await _tap(tester, 'labels-print');
      expect(sizes, [packageSize70x80mm]);
      expect(_isJob(t.allBytes), isFalse);
    });

    testWidgets('in French at 320 wide', (tester) async {
      tester.view.physicalSize = const Size(320, 2600);
      final t = _pmTransport();
      await openSheet(tester, sheet(t, []), locale: const Locale('fr'));
      await _tap(tester, 'labels-method-printer');
      expect(find.textContaining('étiquettes de 4 × 6 po'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
