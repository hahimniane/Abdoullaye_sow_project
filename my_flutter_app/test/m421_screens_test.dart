import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/label_printer_settings_screen.dart';
import 'package:my_flutter_app/services/label_printer.dart';
import 'package:my_flutter_app/services/m221_protocol.dart';
import 'package:my_flutter_app/services/pm241_protocol.dart';
import 'package:my_flutter_app/services/tag_labels.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/widgets/label_printer_widgets.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fixtures/fake_printer.dart';

/// Printer settings with a Phomemo M421 chosen: its own name, the 4 x 6 in
/// test label (asks first) sent as one raster, and no M221 tag controls.

const _device = PrinterDevice(id: 'AA:BB:CC:DD:EE:03', name: 'M421', rssi: -48);
const _settings = LabelPrinterSettings(
  deviceId: 'AA:BB:CC:DD:EE:03',
  deviceName: 'M421',
);

FakePrinterTransport _transport() => FakePrinterTransport(
  m421: true,
  devices: const [_device],
  maxWrite: 197,
  maxPacketReply: 182,
);

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

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({labelPrinterExplainedKey: true});
  });

  testWidgets('shows the M421, a 4 x 6 test label, and no tag controls', (
    tester,
  ) async {
    final c = fakeController(_transport(), settings: _settings);
    await _pump(tester, LabelPrinterSettingsScreen(printer: c));
    expect(find.text('Phomemo M421 · 4×6 labels'), findsOneWidget);
    expect(find.byKey(const Key('label-printer-test-label')), findsOneWidget);
    for (final gone in [
      'label-printer-test-frame',
      'label-printer-test-tag',
      'label-printer-size',
      'label-printer-package-size',
    ]) {
      expect(find.byKey(Key(gone)), findsNothing, reason: gone);
    }
    // The app knows this printer: it does not ask which kind it is.
    expect(find.text('Phomemo M221'), findsNothing);
  });

  testWidgets('the test label asks first; confirming sends one raster', (
    tester,
  ) async {
    final t = _transport();
    final c = fakeController(t, settings: _settings);
    await _pump(tester, LabelPrinterSettingsScreen(printer: c));
    await _tap(tester, 'label-printer-test-label');
    expect(find.text('Print a test label?'), findsOneWidget);
    await _tap(tester, 'label-printer-test-label-cancel');
    expect(t.writes, isEmpty);
    await _tap(tester, 'label-printer-test-label');
    await _tap(tester, 'label-printer-test-label-go');
    expect(find.text('Printed.'), findsOneWidget);
    final raster = m421Raster(
      pm241TestLabel(tagQrMatrix(inventoryTagLink(labelPrinterTestCode))),
    );
    expect(t.allBytes, [
      for (final step in m221LabelSteps(raster)) ...step.bytes,
    ]);
    expect(t.creditViolations, 0);
    expect(c.log.text(), contains('model: Phomemo M421'));
  });

  testWidgets('renders in French at 320 wide', (tester) async {
    final c = fakeController(_transport(), settings: _settings);
    await _pump(
      tester,
      LabelPrinterSettingsScreen(printer: c),
      locale: const Locale('fr'),
      size: const Size(320, 3000),
    );
    expect(find.text('Phomemo M421 · étiquettes 4×6'), findsOneWidget);
    expect(
      find.text('Imprimer une étiquette de test (4 × 6 po)'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });
}
