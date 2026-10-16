import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/services/label_printer.dart';
import 'package:my_flutter_app/services/m221_protocol.dart';
import 'package:my_flutter_app/services/package_codes.dart';
import 'package:my_flutter_app/services/package_labels.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/widgets/label_print_sheet.dart';
import 'package:my_flutter_app/widgets/label_printer_widgets.dart';
import 'package:my_flutter_app/widgets/lot_sheets.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'fixtures/fake_printer.dart';

/// The print-labels sheet's two ways of printing from the phone: straight to
/// the label printer over Bluetooth, and a 4 x 6 PDF through the system print
/// dialog. The callable, the dialog, the printer and the bitmap renderer are
/// all fakes that record what they were handed.

PackageLabel _label(String code, {int number = 1, int count = 1}) =>
    PackageLabel.fromMap({
      'code': code,
      'what': 'Barrel',
      'packageNumber': number,
      'packageCount': count,
      'receiver': 'Mariama Bah',
      'receiverPhone': '+224621234567',
    });

class _Loader {
  _Loader(this.answer);

  PackageLabelSet answer;
  Object? error;
  final requests = <Map<String, Object?>>[];

  Future<PackageLabelSet> call(Map<String, Object?> request) async {
    requests.add(request);
    final e = error;
    if (e != null) throw e;
    return answer;
  }
}

class _Dialog {
  bool answer = true;
  final printed = <(Uint8List, String)>[];

  Future<bool> call(Uint8List bytes, String name) async {
    printed.add((bytes, name));
    return answer;
  }
}

class _Renderer {
  final sizes = <String>[];

  Future<LabelBitmap> call(PackageLabelLayout layout) async {
    sizes.add(layout.size.id);
    final image = LabelBitmap(layout.size.widthDots, layout.size.heightDots);
    image.fill(8, 8, 40, 40);
    return image;
  }
}

class _Opened {
  bool? value;
  bool closed = false;
}

Future<_Opened> _open(
  WidgetTester tester,
  Widget sheet, {
  Locale locale = const Locale('en'),
  double width = 430,
}) async {
  tester.view.physicalSize = Size(width, 2600);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  final opened = _Opened();
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
            onPressed: () async {
              opened.value = await showLotSheet<bool>(context, sheet);
              opened.closed = true;
            },
            child: const Text('open'),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.byKey(const Key('open-sheet')));
  await tester.pumpAndSettle();
  return opened;
}

Future<void> _tap(WidgetTester tester, String key) async {
  await tester.ensureVisible(find.byKey(Key(key)));
  await tester.tap(find.byKey(Key(key)));
  await tester.pumpAndSettle();
}

int _footers(FakePrinterTransport printer) => printer.writes
    .where(
      (w) => w.length == m221Footer.length && w.first == 0x1F && w[1] == 0xF0,
    )
    .length;

const _target = PackageLabelsTarget(businessId: 'b1', lineId: 'w1');

LabelPrintSheet _sheet({
  required _Loader loader,
  _Dialog? dialog,
  LabelPrinterController? printer,
  _Renderer? renderer,
  List<LabelPrintChoice>? opened,
  bool remember = false,
}) =>
    LabelPrintSheet(
      subtitle: 'Labels for 2 barrels only',
      rememberFormat: remember,
      onPrint: (choice) async => opened?.add(choice),
      target: _target,
      loader: loader.call,
      pdfPrinter: (dialog ?? _Dialog()).call,
      printer: printer ?? fakeController(FakePrinterTransport()),
      renderer: (renderer ?? _Renderer()).call,
    );

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({labelPrinterExplainedKey: true});
  });

  testWidgets('offers the phone ways first, and the browser page as before',
      (tester) async {
    await _open(tester, _sheet(loader: _Loader(const PackageLabelSet(labels: []))));
    expect(find.text('How to print'), findsOneWidget);
    expect(find.byKey(const Key('labels-method-printer')), findsOneWidget);
    expect(find.byKey(const Key('labels-method-system')), findsOneWidget);
    expect(find.byKey(const Key('labels-format-sheet')), findsOneWidget);
    expect(find.byKey(const Key('labels-format-thermal')), findsOneWidget);
    // Nothing remembered: letter sheets, as before.
    expect(find.text('Open labels to print'), findsOneWidget);
  });

  testWidgets('a sheet with no target is the browser page alone',
      (tester) async {
    await _open(
      tester,
      LabelPrintSheet(
        subtitle: 'x',
        rememberFormat: false,
        onPrint: (_) async {},
      ),
    );
    expect(find.byKey(const Key('labels-method-printer')), findsNothing);
    expect(find.byKey(const Key('labels-method-system')), findsNothing);
    expect(find.text('Paper'), findsOneWidget);
  });

  group('print 4 x 6 through the system dialog', () {
    testWidgets('two per package, a 4 x 6 PDF to the dialog, then closes',
        (tester) async {
      final loader = _Loader(PackageLabelSet(
        labels: [_label('CL-K7M4P2'), _label('CL-K7M4P2')],
        businessName: 'Conakry Express',
      ));
      final dialog = _Dialog();
      final opened = await _open(tester, _sheet(loader: loader, dialog: dialog));
      await _tap(tester, 'labels-method-system');
      expect(find.text('Print'), findsOneWidget);
      await _tap(tester, 'labels-print');

      expect(loader.requests.single, {
        'businessId': 'b1',
        'containerId': '',
        'copies': 2,
        'lineIds': ['w1'],
      });
      final (bytes, name) = dialog.printed.single;
      expect(String.fromCharCodes(bytes.take(4)), '%PDF');
      expect(name, 'labels-CL-K7M4P2.pdf');
      expect(opened.closed, isTrue);
    });

    testWidgets('one per package when asked', (tester) async {
      final loader = _Loader(PackageLabelSet(labels: [_label('CL-K7M4P2')]));
      await _open(tester, _sheet(loader: loader));
      await _tap(tester, 'labels-method-system');
      await _tap(tester, 'labels-copies-1');
      await _tap(tester, 'labels-print');
      expect(loader.requests.single['copies'], 1);
    });

    testWidgets('cancelled in the dialog: the sheet stays, nothing is wrong',
        (tester) async {
      final loader = _Loader(PackageLabelSet(labels: [_label('CL-K7M4P2')]));
      final dialog = _Dialog()..answer = false;
      final opened = await _open(tester, _sheet(loader: loader, dialog: dialog));
      await _tap(tester, 'labels-method-system');
      await _tap(tester, 'labels-print');
      expect(dialog.printed, hasLength(1));
      expect(opened.closed, isFalse);
      expect(find.byKey(const Key('labels-error')), findsNothing);
    });

    testWidgets('the server refuses: said in place, the button comes back',
        (tester) async {
      final loader = _Loader(const PackageLabelSet(labels: []))
        ..error = StateError('permission-denied');
      final dialog = _Dialog();
      await _open(tester, _sheet(loader: loader, dialog: dialog));
      await _tap(tester, 'labels-method-system');
      await _tap(tester, 'labels-print');
      expect(find.text('The labels could not be loaded. Try again in a moment.'),
          findsOneWidget);
      expect(dialog.printed, isEmpty);
      expect(find.text('Print'), findsOneWidget);
    });

    testWidgets('nothing to print says so', (tester) async {
      final dialog = _Dialog();
      await _open(
        tester,
        _sheet(loader: _Loader(const PackageLabelSet(labels: [])), dialog: dialog),
      );
      await _tap(tester, 'labels-method-system');
      await _tap(tester, 'labels-print');
      expect(find.text('No packages to print.'), findsOneWidget);
      expect(dialog.printed, isEmpty);
    });

    testWidgets('shows progress and ignores a second tap', (tester) async {
      final gate = Completer<PackageLabelSet>();
      var calls = 0;
      await _open(
        tester,
        LabelPrintSheet(
          subtitle: 'x',
          rememberFormat: false,
          onPrint: (_) async {},
          target: _target,
          loader: (_) {
            calls++;
            return gate.future;
          },
          pdfPrinter: _Dialog().call,
          printer: fakeController(FakePrinterTransport()),
        ),
      );
      await _tap(tester, 'labels-method-system');
      await tester.tap(find.byKey(const Key('labels-print')));
      await tester.pump();
      expect(find.text('Preparing labels…'), findsOneWidget);
      await tester.tap(find.byKey(const Key('labels-print')));
      await tester.pump();
      expect(calls, 1);
      gate.complete(const PackageLabelSet(labels: []));
      await tester.pumpAndSettle();
    });
  });

  group('the label printer', () {
    testWidgets('one per package by default, straight to the printer',
        (tester) async {
      final transport = FakePrinterTransport();
      final printer = fakeController(transport);
      final renderer = _Renderer();
      final loader = _Loader(PackageLabelSet(labels: [
        _label('CL-K7M4P2', number: 1, count: 2),
        _label('CL-K7M4P2', number: 2, count: 2),
      ]));
      final opened = await _open(
        tester,
        _sheet(loader: loader, printer: printer, renderer: renderer),
      );
      await _tap(tester, 'labels-method-printer');
      expect(find.text('Printer: Q2A1'), findsOneWidget);
      expect(find.byKey(const Key('labels-package-size')), findsOneWidget);
      expect(find.text('Print to printer'), findsOneWidget);
      await _tap(tester, 'labels-print');

      expect(loader.requests.single['copies'], 1);
      expect(renderer.sizes, [packageSize70x80mm, packageSize70x80mm],
          reason: 'drawn at the package label size, not the tag size');
      expect(_footers(transport), 2);
      expect(find.text('2 labels printed.'), findsOneWidget);
      expect(opened.closed, isFalse, reason: 'stays open for a reprint');
    });

    testWidgets('two copies of one package are one picture printed twice',
        (tester) async {
      final transport = FakePrinterTransport();
      final renderer = _Renderer();
      final loader = _Loader(PackageLabelSet(
        labels: [_label('CL-K7M4P2'), _label('CL-K7M4P2')],
      ));
      await _open(
        tester,
        _sheet(
          loader: loader,
          printer: fakeController(transport),
          renderer: renderer,
        ),
      );
      await _tap(tester, 'labels-method-printer');
      await _tap(tester, 'labels-copies-2');
      await _tap(tester, 'labels-print');
      expect(loader.requests.single['copies'], 2);
      expect(renderer.sizes, hasLength(1));
      expect(_footers(transport), 2);
      expect(find.text('2 labels printed.'), findsOneWidget);
    });

    testWidgets('the package size is its own, saved apart from the tag size',
        (tester) async {
      final printer = fakeController(FakePrinterTransport());
      final renderer = _Renderer();
      final loader = _Loader(PackageLabelSet(labels: [_label('CL-K7M4P2')]));
      await _open(
        tester,
        _sheet(loader: loader, printer: printer, renderer: renderer),
      );
      await _tap(tester, 'labels-method-printer');
      await _tap(tester, 'package-size-$packageSize62x100mm');
      expect(printer.settings.packageSizeId, packageSize62x100mm);
      expect(printer.settings.sizeId, const LabelPrinterSettings().sizeId);
      await _tap(tester, 'labels-print');
      expect(renderer.sizes, [packageSize62x100mm]);
    });

    testWidgets('no printer chosen yet says so before asking the server',
        (tester) async {
      final loader = _Loader(PackageLabelSet(labels: [_label('CL-K7M4P2')]));
      await _open(
        tester,
        _sheet(
          loader: loader,
          printer: fakeController(
            FakePrinterTransport(),
            settings: const LabelPrinterSettings(),
          ),
        ),
      );
      await _tap(tester, 'labels-method-printer');
      expect(find.text('No printer chosen yet.'), findsOneWidget);
      await _tap(tester, 'labels-print');
      expect(find.byKey(const Key('labels-error')), findsOneWidget);
      expect(loader.requests, isEmpty);
    });

    testWidgets('a printer that does not answer is said, with what printed',
        (tester) async {
      final transport = FakePrinterTransport(answerDone: false);
      final loader = _Loader(PackageLabelSet(labels: [_label('CL-K7M4P2')]));
      await _open(
        tester,
        _sheet(loader: loader, printer: fakeController(transport)),
      );
      await _tap(tester, 'labels-method-printer');
      await tester.tap(find.byKey(const Key('labels-print')));
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('labels-error')), findsOneWidget);
      expect(find.byKey(const Key('labels-done')), findsNothing);
      expect(find.text('Print to printer'), findsOneWidget);
    });

    testWidgets('remembers the label printer next time', (tester) async {
      SharedPreferences.setMockInitialValues({labelPrinterExplainedKey: true});
      final loader = _Loader(PackageLabelSet(labels: [_label('CL-K7M4P2')]));
      await _open(tester, _sheet(loader: loader, remember: true));
      await _tap(tester, 'labels-method-printer');
      await _tap(tester, 'labels-print');
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString(labelFormatPreferenceKey), 'printer');

      await tester.pumpWidget(const SizedBox());
      await _open(tester, _sheet(loader: loader, remember: true));
      expect(find.text('Print to printer'), findsOneWidget);
    });
  });

  testWidgets('renders in French on a narrow phone', (tester) async {
    await _open(
      tester,
      _sheet(loader: _Loader(PackageLabelSet(labels: [_label('CL-K7M4P2')]))),
      locale: const Locale('fr'),
      width: 320,
    );
    expect(find.text('Comment imprimer'), findsOneWidget);
    expect(find.text('Imprimante d’étiquettes (Bluetooth)'), findsOneWidget);
    expect(find.text('Imprimer en 4 × 6 (toute imprimante)'), findsOneWidget);
    await _tap(tester, 'labels-method-printer');
    expect(find.text('Taille des étiquettes de colis'), findsOneWidget);
    await _tap(tester, 'labels-method-system');
    expect(find.text('Imprimer'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  test('the browser formats keep their saved names', () {
    expect(LabelPrintMethod.fromSaved(labelFormatSheet),
        LabelPrintMethod.browserSheet);
    expect(LabelPrintMethod.fromSaved(labelFormatThermal),
        LabelPrintMethod.browserThermal);
    expect(LabelPrintMethod.fromSaved('nonsense'), isNull);
    expect(LabelPrintMethod.labelPrinter.defaultCopies, 1);
    expect(LabelPrintMethod.systemPrint.defaultCopies, 2);
  });
}
