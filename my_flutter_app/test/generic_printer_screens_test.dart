import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/label_printer_settings_screen.dart';
import 'package:my_flutter_app/services/generic_label_printer.dart';
import 'package:my_flutter_app/services/label_printer.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/widgets/label_printer_widgets.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fixtures/fake_printer.dart';

/// Printer settings with an "other" 4 x 6 in printer (beta): the kind
/// question for a printer the app does not know by name, the beta note, the
/// test label, and "Send printer details", in English and French.

const _id = 'AA:BB:CC:DD:EE:09';
const _device = PrinterDevice(id: _id, name: 'Test Printer X1', rssi: -50);
const _unknown = LabelPrinterSettings(
  deviceId: _id,
  deviceName: 'Test Printer X1',
);

const _gatt = PrinterGattInfo(
  mtu: 185,
  writeServiceUuid: '0000ff00-0000-1000-8000-00805f9b34fb',
  writeCharUuid: '0000ff02-0000-1000-8000-00805f9b34fb',
  services: [
    GattServiceInfo('0000ff00-0000-1000-8000-00805f9b34fb', [
      GattCharacteristicInfo(
        '0000ff02-0000-1000-8000-00805f9b34fb',
        GattProps(writeWithoutResponse: true),
      ),
    ]),
  ],
);

FakePrinterTransport _transport() =>
    FakePrinterTransport(devices: const [_device], gatt: _gatt);

LabelPrinterSettings get _generic =>
    _unknown.copyWith(deviceModels: {_id: PrinterModel.generic4x6});

Future<void> _pump(
  WidgetTester tester,
  LabelPrinterController c, {
  Locale locale = const Locale('en'),
  Future<void> Function(String, String)? share,
}) async {
  tester.view.physicalSize = const Size(400, 3600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.light,
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      home: LabelPrinterSettingsScreen(
        printer: c,
        shareText: share,
        appVersionLoader: () async => '1.0.25+60',
      ),
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

  group('the kind of printer', () {
    testWidgets('is asked for a printer the app does not know by name', (
      tester,
    ) async {
      final c = fakeController(_transport(), settings: _unknown);
      await _pump(tester, c);
      expect(find.text('What kind of printer is this?'), findsOneWidget);
      expect(find.byKey(const Key('label-printer-kind-m221')), findsOneWidget);
      expect(
        find.byKey(const Key('label-printer-kind-generic')),
        findsOneWidget,
      );
      // Until the shop says otherwise it is treated as before: an M221.
      expect(find.byKey(const Key('label-printer-test-tag')), findsOneWidget);
      expect(find.byKey(const Key('label-printer-send-details')), findsNothing);
    });

    testWidgets('is not asked for a Phomemo the app recognises', (
      tester,
    ) async {
      for (final name in ['Q2A1', 'PM-241Z-BT-0470']) {
        final c = fakeController(
          _transport(),
          settings: LabelPrinterSettings(deviceId: _id, deviceName: name),
        );
        await _pump(tester, c);
        expect(
          find.byKey(const Key('label-printer-kind-generic')),
          findsNothing,
          reason: name,
        );
      }
    });

    testWidgets('is not asked when no printer is chosen', (tester) async {
      final c = fakeController(
        _transport(),
        settings: const LabelPrinterSettings(),
      );
      await _pump(tester, c);
      expect(find.byKey(const Key('label-printer-kind-generic')), findsNothing);
    });

    testWidgets('choosing "Other 4 x 6" shows the beta note and the tools', (
      tester,
    ) async {
      final store = MemoryPrinterStore(_unknown);
      final c = fakeController(_transport(), settings: _unknown, store: store);
      await _pump(tester, c);
      await _tap(tester, 'label-printer-kind-generic');
      expect(c.model, PrinterModel.generic4x6);
      expect(store.value.deviceModels, {_id: PrinterModel.generic4x6});
      expect(
        find.text('Other 4 × 6 in Bluetooth printer (beta)'),
        findsWidgets,
      );
      expect(
        find.textContaining('Beta: this sends 4 × 6 in labels'),
        findsOneWidget,
      );
      expect(find.byKey(const Key('label-printer-test-label')), findsOneWidget);
      expect(
        find.byKey(const Key('label-printer-send-details')),
        findsOneWidget,
      );
      // No M221 tuning for it.
      for (final gone in [
        'label-printer-test-tag',
        'label-printer-size',
        'label-printer-package-size',
        'label-printer-status',
      ]) {
        expect(find.byKey(Key(gone)), findsNothing, reason: gone);
      }
      // And the question stays, so the answer can be changed back.
      await _tap(tester, 'label-printer-kind-m221');
      expect(c.model, PrinterModel.m221);
      expect(find.byKey(const Key('label-printer-test-tag')), findsOneWidget);
    });
  });

  group('printing on it', () {
    testWidgets('the test label asks first, then sends the TSPL job', (
      tester,
    ) async {
      final t = _transport();
      final c = fakeController(t, settings: _generic);
      await _pump(tester, c);
      await _tap(tester, 'label-printer-test-label');
      expect(find.text('Print a test label?'), findsOneWidget);
      await _tap(tester, 'label-printer-test-label-go');
      expect(find.text('Printed.'), findsOneWidget);
      expect(t.lastConnectGeneric, isTrue);
      expect(String.fromCharCodes(t.allBytes.take(19)), 'SIZE 100 mm, 150 mm');
    });

    testWidgets('a failed label points to Send printer details', (
      tester,
    ) async {
      final t = _transport()
        ..connectError = const PrinterException(
          PrintFailure.notAPrinter,
          'no writable characteristic',
          _gatt,
        );
      final c = fakeController(t, settings: _generic);
      await _pump(tester, c);
      await _tap(tester, 'label-printer-test-label');
      await _tap(tester, 'label-printer-test-label-go');
      final error = find.byKey(const Key('label-printer-error'));
      expect(error, findsOneWidget);
      expect(
        find.descendant(
          of: error,
          matching: find.textContaining('Send printer details'),
        ),
        findsOneWidget,
      );
    });
  });

  group('Send printer details', () {
    testWidgets('shares the printer\'s details as text', (tester) async {
      final t = _transport();
      final shared = <(String, String)>[];
      final c = fakeController(t, settings: _generic);
      await _pump(
        tester,
        c,
        share: (text, subject) async => shared.add((text, subject)),
      );
      await _tap(tester, 'label-printer-send-details');
      expect(shared, hasLength(1));
      final (text, subject) = shared.single;
      expect(subject, 'Laawol printer details');
      expect(text, contains('printer name: "Test Printer X1"'));
      expect(text, contains('app: 1.0.25+60'));
      expect(text, contains('0000ff02-0000-1000-8000-00805f9b34fb'));
      // It only looked: nothing was printed.
      expect(t.writes, isEmpty);
      expect(find.byKey(const Key('label-printer-error')), findsNothing);
    });

    testWidgets('a share that fails says so', (tester) async {
      final c = fakeController(_transport(), settings: _generic);
      await _pump(
        tester,
        c,
        share: (text, subject) async => throw StateError('no share sheet'),
      );
      await _tap(tester, 'label-printer-send-details');
      expect(
        find.text('We could not collect the printer details. Try again.'),
        findsOneWidget,
      );
    });

    testWidgets('is not offered while no printer is chosen', (tester) async {
      final c = fakeController(
        _transport(),
        settings: const LabelPrinterSettings().copyWith(
          deviceModels: {_id: PrinterModel.generic4x6},
        ),
      );
      await _pump(tester, c);
      // No printer chosen: the section is the M221's, not the beta's.
      expect(find.byKey(const Key('label-printer-send-details')), findsNothing);
    });
  });

  group('in French', () {
    testWidgets('the question, the beta note and the button are translated', (
      tester,
    ) async {
      final c = fakeController(_transport(), settings: _unknown);
      await _pump(tester, c, locale: const Locale('fr'));
      expect(
        find.text('De quel type d’imprimante s’agit-il ?'),
        findsOneWidget,
      );
      await _tap(tester, 'label-printer-kind-generic');
      expect(
        find.text('Autre imprimante Bluetooth 4 × 6 po (bêta)'),
        findsWidgets,
      );
      expect(find.textContaining('Bêta : l’app envoie'), findsOneWidget);
      expect(find.text('Envoyer les détails de l’imprimante'), findsOneWidget);
    });
  });
}
