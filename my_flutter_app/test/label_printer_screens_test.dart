import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/label_printer_settings_screen.dart';
import 'package:my_flutter_app/screens/print_tags_sheet.dart';
import 'package:my_flutter_app/services/label_printer.dart';
import 'package:my_flutter_app/services/m221_protocol.dart';
import 'package:my_flutter_app/services/tag_labels.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/widgets/label_printer_widgets.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fixtures/fake_printer.dart';

const _chosen = LabelPrinterSettings(
  deviceId: 'AA:BB:CC:DD:EE:01',
  deviceName: 'Q2A1',
);

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  Locale locale = const Locale('en'),
  Size size = const Size(400, 2400),
  double textScale = 1,
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
      builder: (context, inner) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(textScale)),
        child: inner!,
      ),
      home: child,
    ),
  );
  await tester.pumpAndSettle();
}

class _Shared {
  final calls = <(Uint8List, String)>[];
  Future<void> call(Uint8List bytes, String name, Rect origin) async =>
      calls.add((bytes, name));
}

Future<void> _openTags(
  WidgetTester tester,
  LabelPrinterController printer, {
  _Shared? shared,
  Locale locale = const Locale('en'),
  Size size = const Size(400, 2400),
  double textScale = 1,
  List<int>? opened,
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
            printer: printer,
            sharer: (shared ?? _Shared()).call,
            opener:
                ({
                  required businessId,
                  required itemId,
                  required copies,
                }) async => opened?.add(copies),
          ),
          child: const Text('open'),
        ),
      ),
    ),
    locale: locale,
    size: size,
    textScale: textScale,
  );
  await tester.tap(find.byKey(const Key('open-sheet')));
  await tester.pumpAndSettle();
}

int _footers(FakePrinterTransport printer) => printer.writes
    .where(
      (w) => w.length == m221Footer.length && w.first == 0x1F && w[1] == 0xF0,
    )
    .length;

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({labelPrinterExplainedKey: true});
  });

  group('print tags sheet', () {
    testWidgets('prints the copies straight to the printer', (tester) async {
      final printer = FakePrinterTransport();
      final c = fakeController(printer, settings: _chosen);
      await _openTags(tester, c);
      expect(find.text('Printer: Q2A1'), findsOneWidget);
      await tester.enterText(find.byKey(const Key('inv-tags-copies')), '3');
      await tester.tap(find.byKey(const Key('inv-tags-print')));
      await tester.pumpAndSettle();
      expect(find.text('3 tags printed.'), findsOneWidget);
      expect(_footers(printer), 3);
      expect(
        printer.events.indexOf('subscribe'),
        lessThan(printer.events.indexWhere((e) => e.startsWith('write'))),
      );
    });

    testWidgets('quick chips set the copies', (tester) async {
      final c = fakeController(FakePrinterTransport(), settings: _chosen);
      await _openTags(tester, c);
      await tester.tap(find.byKey(const Key('inv-tags-chip-25')));
      await tester.pump();
      final field = tester.widget<TextField>(
        find.byKey(const Key('inv-tags-copies')),
      );
      expect(field.controller!.text, '25');
    });

    testWidgets('shows "n of N", stops after the current tag when asked', (
      tester,
    ) async {
      final printer = FakePrinterTransport(answerDone: false);
      final c = fakeController(
        printer,
        settings: _chosen,
        doneTimeout: const Duration(seconds: 30),
      );
      await _openTags(tester, c);
      await tester.tap(find.byKey(const Key('inv-tags-chip-10')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('inv-tags-print')));
      for (var i = 0; i < 20; i++) {
        await tester.pump();
      }
      expect(find.text('Printing 1 of 10…'), findsOneWidget);
      expect(find.byKey(const Key('inv-tags-stop')), findsOneWidget);
      await tester.tap(find.byKey(const Key('inv-tags-stop')));
      await tester.pump();
      expect(find.text('Stopping after this tag…'), findsOneWidget);
      // The printer finishes the label it was on.
      printer.link!.reply([0x1A, 0x0F, 0x0C]);
      await tester.pumpAndSettle();
      expect(find.text('Stopped after 1 of 10.'), findsOneWidget);
      expect(_footers(printer), 1);
    });

    testWidgets('a printer that never answers ends in a clear failure', (
      tester,
    ) async {
      final printer = FakePrinterTransport(answerDone: false);
      final c = fakeController(
        printer,
        settings: _chosen,
        doneTimeout: const Duration(seconds: 10),
      );
      await _openTags(tester, c);
      await tester.tap(find.byKey(const Key('inv-tags-print')));
      await tester.pump();
      await tester.pump(const Duration(seconds: 11));
      await tester.pumpAndSettle();
      expect(
        find.textContaining('The printer did not confirm the tag'),
        findsOneWidget,
      );
      expect(find.text('Print to printer'), findsOneWidget);
    });

    testWidgets('without a chosen printer it says where to choose one', (
      tester,
    ) async {
      final printer = FakePrinterTransport();
      final c = fakeController(printer, settings: const LabelPrinterSettings());
      await _openTags(tester, c);
      expect(find.text('No printer chosen yet.'), findsOneWidget);
      await tester.tap(find.byKey(const Key('inv-tags-print')));
      await tester.pumpAndSettle();
      expect(
        find.text('Choose your printer first in the label printer settings.'),
        findsOneWidget,
      );
      expect(printer.events, isEmpty);
    });

    testWidgets('explains Bluetooth once before the first print', (
      tester,
    ) async {
      SharedPreferences.setMockInitialValues({});
      final printer = FakePrinterTransport();
      final c = fakeController(printer, settings: _chosen);
      await _openTags(tester, c);
      await tester.tap(find.byKey(const Key('inv-tags-print')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('label-printer-explain')), findsOneWidget);
      await tester.tap(find.byKey(const Key('label-printer-explain-continue')));
      await tester.pumpAndSettle();
      expect(find.text('1 tag printed.'), findsOneWidget);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getBool(labelPrinterExplainedKey), isTrue);
    });

    testWidgets('shares an exact-size PDF, one page per copy', (tester) async {
      final shared = _Shared();
      final c = fakeController(FakePrinterTransport(), settings: _chosen);
      await _openTags(tester, c, shared: shared);
      await tester.tap(find.byKey(const Key('inv-tags-chip-5')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('inv-tags-share')));
      await tester.runAsync(
        () => Future<void>.delayed(const Duration(milliseconds: 300)),
      );
      await tester.pumpAndSettle();
      expect(shared.calls, hasLength(1));
      final (bytes, name) = shared.calls.single;
      expect(name, 'tag-IT-K7M4P2-2x1in.pdf');
      expect(String.fromCharCodes(bytes.take(8)), '%PDF-1.4');
      final text = latin1.decode(bytes);
      expect(text, contains('/Count 5'));
      // Page = label: 2 x 1 inch = 144 x 72 points.
      expect(RegExp(r'/MediaBox\s*\[0 0 144 72\]').allMatches(text).length, 5);
    });

    testWidgets('a custom size must be a printable size', (tester) async {
      final c = fakeController(FakePrinterTransport(), settings: _chosen);
      await _openTags(tester, c);
      await tester.tap(find.byKey(const Key('label-size-custom')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const Key('label-size-width')), '90');
      await tester.pump();
      expect(find.byKey(const Key('label-size-error')), findsOneWidget);
      await tester.enterText(find.byKey(const Key('label-size-width')), '45');
      await tester.enterText(find.byKey(const Key('label-size-height')), '28');
      await tester.pump();
      expect(find.byKey(const Key('label-size-error')), findsNothing);
      expect(c.settings.sizeId, tagSizeCustom);
      expect(c.settings.size.widthDots, 360);
      expect(c.settings.size.heightDots, 224);
    });

    testWidgets('the tag page is still one tap away', (tester) async {
      final opened = <int>[];
      final c = fakeController(FakePrinterTransport(), settings: _chosen);
      await _openTags(tester, c, opened: opened);
      await tester.tap(find.byKey(const Key('inv-tags-chip-10')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('inv-tags-open')));
      await tester.pumpAndSettle();
      expect(opened, [10]);
    });

    testWidgets('fits a 320-wide phone in French at 1.3x text', (tester) async {
      final c = fakeController(FakePrinterTransport(), settings: _chosen);
      await _openTags(
        tester,
        c,
        locale: const Locale('fr'),
        size: const Size(320, 900),
        textScale: 1.3,
      );
      expect(tester.takeException(), isNull);
      expect(find.text('Imprimer sur l’imprimante'), findsOneWidget);
      expect(find.text('Partager en PDF'), findsOneWidget);
      expect(find.text('Imprimante : Q2A1'), findsOneWidget);
      await tester.tap(find.byKey(const Key('inv-tags-print')));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
      expect(find.text('1 étiquette imprimée.'), findsOneWidget);
    });

    testWidgets('fits a 320-wide phone in English at 1.3x text', (
      tester,
    ) async {
      final c = fakeController(FakePrinterTransport(), settings: _chosen);
      await _openTags(tester, c, size: const Size(320, 900), textScale: 1.3);
      expect(tester.takeException(), isNull);
      expect(find.text('Print to printer'), findsOneWidget);
    });
  });

  group('label printer settings', () {
    Future<LabelPrinterController> openSettings(
      WidgetTester tester, {
      FakePrinterTransport? printer,
      LabelPrinterSettings settings = _chosen,
      Locale locale = const Locale('en'),
      Size size = const Size(400, 3000),
      double textScale = 1,
    }) async {
      final c = fakeController(
        printer ?? FakePrinterTransport(),
        settings: settings,
      );
      await _pump(
        tester,
        LabelPrinterSettingsScreen(printer: c),
        locale: locale,
        size: size,
        textScale: textScale,
      );
      return c;
    }

    testWidgets('finds printers and remembers the one picked', (tester) async {
      final printer = FakePrinterTransport(
        devices: const [
          PrinterDevice(id: 'P1', name: 'Q2A1B2', rssi: -48),
          PrinterDevice(id: 'P2', name: 'Q2FAR', rssi: -88),
        ],
      );
      final c = await openSettings(
        tester,
        printer: printer,
        settings: const LabelPrinterSettings(),
      );
      expect(
        find.text('No printer chosen yet. Find it below.'),
        findsOneWidget,
      );
      await tester.tap(find.byKey(const Key('label-printer-scan')));
      await tester.pumpAndSettle();
      expect(find.text('Q2A1B2'), findsOneWidget);
      expect(find.text('Signal -48 dBm'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('label-printer-use-P1')));
      await tester.pumpAndSettle();
      expect(c.settings.deviceId, 'P1');
      expect(find.text('In use'), findsOneWidget);
      expect(find.textContaining('scan: found "Q2A1B2"'), findsOneWidget);
    });

    testWidgets('Bluetooth off is said plainly', (tester) async {
      await openSettings(
        tester,
        printer: FakePrinterTransport(adapter: PrinterAdapterState.off),
      );
      await tester.tap(find.byKey(const Key('label-printer-scan')));
      await tester.pumpAndSettle();
      expect(
        find.text(
          'Bluetooth is off. Turn it on in the phone’s settings, then try again.',
        ),
        findsOneWidget,
      );
    });

    testWidgets('density, speed and position step and are kept', (
      tester,
    ) async {
      final c = await openSettings(tester);
      await tester.tap(find.byKey(const Key('label-printer-density-less')));
      await tester.tap(find.byKey(const Key('label-printer-speed-less')));
      await tester.tap(find.byKey(const Key('label-printer-x-more')));
      await tester.tap(find.byKey(const Key('label-printer-x-more')));
      await tester.tap(find.byKey(const Key('label-printer-y-less')));
      await tester.pumpAndSettle();
      expect(c.settings.density, 5);
      expect(c.settings.speed, 4);
      expect(c.settings.xOffset, 8);
      expect(c.settings.yOffset, -4);
      expect(find.text('8 dots'), findsOneWidget);
      expect(find.text('-4 dots'), findsOneWidget);
      // Kept on the phone (the store the controller saves to).
      expect((await c.store.load()).xOffset, 8);
    });

    testWidgets('the test frame prints the border at the calibrated spot', (
      tester,
    ) async {
      final printer = FakePrinterTransport();
      final c = await openSettings(
        tester,
        printer: printer,
        settings: _chosen.copyWith(xOffset: 8, yOffset: 4),
      );
      await tester.ensureVisible(
        find.byKey(const Key('label-printer-test-frame')),
      );
      await tester.tap(find.byKey(const Key('label-printer-test-frame')));
      await tester.pumpAndSettle();
      expect(find.text('Printed.'), findsOneWidget);
      final expected = m221LabelSteps(
        packRaster(renderTestFrame(406, 203), 8, 4),
        density: c.settings.density,
        speed: c.settings.speed,
      ).expand((s) => s.bytes).toList();
      expect(printer.allBytes, expected);
    });

    testWidgets('the test tag prints a QR, never a real product code', (
      tester,
    ) async {
      final printer = FakePrinterTransport();
      await openSettings(tester, printer: printer);
      await tester.ensureVisible(
        find.byKey(const Key('label-printer-test-tag')),
      );
      await tester.tap(find.byKey(const Key('label-printer-test-tag')));
      await tester.pumpAndSettle();
      expect(find.text('Printed.'), findsOneWidget);
      expect(_footers(printer), 1);
      expect(labelPrinterTestCode, 'IT-TEST00');
    });

    testWidgets('the log can be copied for the developer', (tester) async {
      String? copied;
      tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
        SystemChannels.platform,
        (call) async {
          if (call.method == 'Clipboard.setData') {
            copied = (call.arguments as Map)['text'] as String?;
          }
          return null;
        },
      );
      addTearDown(
        () => tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          SystemChannels.platform,
          null,
        ),
      );
      final c = await openSettings(tester);
      c.log.add('connect: …EE:01');
      await tester.pump();
      await tester.ensureVisible(
        find.byKey(const Key('label-printer-copy-log')),
      );
      await tester.tap(find.byKey(const Key('label-printer-copy-log')));
      await tester.pumpAndSettle();
      expect(copied, contains('Laawol label printer log'));
      expect(copied, contains('printer: "Q2A1"'));
      expect(copied, contains('connect: …EE:01'));
      expect(find.text('Print log copied.'), findsOneWidget);
    });

    for (final locale in const [Locale('en'), Locale('fr')]) {
      testWidgets(
        'fits a 320-wide phone at 1.3x text (${locale.languageCode})',
        (tester) async {
          await openSettings(
            tester,
            locale: locale,
            size: const Size(320, 4000),
            textScale: 1.3,
          );
          expect(tester.takeException(), isNull);
          final l10n = locale.languageCode == 'fr'
              ? 'Imprimer le cadre de test'
              : 'Print test frame';
          expect(find.text(l10n), findsOneWidget);
        },
      );
    }
  });
}
