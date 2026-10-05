import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/destination_country.dart';
import 'package:my_flutter_app/screens/containers_screen.dart';
import 'package:my_flutter_app/screens/package_result_screen.dart';
import 'package:my_flutter_app/screens/package_scan_screen.dart';
import 'package:my_flutter_app/services/container_manifest.dart';
import 'package:my_flutter_app/services/container_packages.dart';
import 'package:my_flutter_app/services/package_codes.dart';
import 'package:my_flutter_app/services/package_link_service.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/widgets/label_print_sheet.dart';
import 'package:my_flutter_app/widgets/lot_sheets.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The package screens as staff meet them after scanning a label: the
/// package view (whose, who collects, what, which box, did WhatsApp reach
/// anyone, and the next actions), the print-labels sheet, and the scan
/// screen's typed-code and name/phone search. The camera and Firebase are
/// replaced: the camera is switched off and the data comes from a fake
/// repository, so every state renders deterministically.

final _box = ShippingContainer.fromMap('c1', {
  'businessId': 'b1',
  'label': 'Sailing 3 Oct, box 2',
  'containerNumber': 'MSKU1234567',
  'status': containerStatusShipped,
  'destinationCountryId': 'guinea',
  'destinationCountryName': 'Guinea',
  'sailedAt': DateTime(2026, 10, 3, 14, 15),
});

ContainerLine _line([Map<String, dynamic> extra = const {}]) =>
    ContainerLine.fromMap('l1', {
      'businessId': 'b1',
      'containerId': 'c1',
      'containerStatus': containerStatusShipped,
      'kind': containerLineKindBarrels,
      'quantity': 3,
      'ownerKind': containerOwnerCustomer,
      'customerName': 'Fatou Diallo',
      'customerPhone': '+19175551234',
      'receiverName': 'Mariama Bah',
      'receiverPhone': '+224621234567',
      'trackingCode': 'CL-K7M4P2',
      ...extra,
    });

class _FakeRepo implements ContainerPackageRepository {
  _FakeRepo({this.lines = const [], this.containers = const []});

  final List<ContainerLine> lines;
  final List<ShippingContainer> containers;
  final List<String> codesWatched = [];

  @override
  Future<ContainerLine?> findLineByCode(String businessId, String code) async =>
      lines
          .where((l) => l.businessId == businessId && l.trackingCode == code)
          .firstOrNull;

  @override
  Stream<ContainerLine?> watchLineByCode(String businessId, String code) {
    codesWatched.add(code);
    return Stream.fromFuture(findLineByCode(businessId, code));
  }

  @override
  Stream<ContainerLine?> watchLine(String lineId) =>
      Stream.value(lines.where((l) => l.id == lineId).firstOrNull);

  @override
  Stream<ShippingContainer?> watchContainer(String containerId) =>
      Stream.value(containers.where((c) => c.id == containerId).firstOrNull);

  @override
  Stream<List<ContainerLine>> watchLines(String businessId) =>
      Stream.value(lines.where((l) => l.businessId == businessId).toList());

  @override
  Stream<List<ShippingContainer>> watchContainers(String businessId) =>
      Stream.value(containers);

  @override
  Future<String> businessCountryCode(String businessId) async => 'US';

  @override
  Future<List<DestinationCountry>> destinations(String businessId) async =>
      const [];
}

Future<void> _pump(
  WidgetTester tester,
  Widget child, {
  Locale locale = const Locale('en'),
  bool scaffold = true,
}) async {
  tester.view.physicalSize = const Size(400, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);
  await tester.pumpWidget(
    MaterialApp(
      theme: AppTheme.light,
      locale: locale,
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      home: scaffold ? Scaffold(body: SafeArea(child: child)) : child,
    ),
  );
  await tester.pumpAndSettle();
}

/// Opens [sheet] the way the app does, over a page, so its closing pops the
/// sheet and not the app.
Future<void> _openSheet(
  WidgetTester tester,
  Widget sheet, {
  Locale locale = const Locale('en'),
}) async {
  await _pump(
    tester,
    Builder(
      builder: (context) => TextButton(
        key: const Key('open-sheet'),
        onPressed: () => showLotSheet<bool>(context, sheet),
        child: const Text('open'),
      ),
    ),
    locale: locale,
  );
  await tester.tap(find.byKey(const Key('open-sheet')));
  await tester.pumpAndSettle();
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('package view', () {
    testWidgets('says whose it is, who collects it, what it is and where',
        (tester) async {
      await _pump(
        tester,
        packageResultViewForTesting(
          line: _line({
            'lastCustomerUpdate': {
              'update': 'shipped',
              'results': [
                {'role': 'sender', 'status': 'sent'},
                {
                  'role': 'receiver',
                  'status': 'skipped',
                  'reason': 'needs_country_code'
                },
              ],
              'atMs': DateTime(2026, 10, 3, 14, 15).millisecondsSinceEpoch,
            },
          }),
          container: _box,
        ),
      );

      expect(find.byKey(const Key('pkg-code')), findsOneWidget);
      expect(find.text('CL-K7M4P2'), findsOneWidget);
      expect(find.text('3 barrels'), findsOneWidget);
      expect(find.text('Barrels · Quantity: 3'), findsOneWidget);
      expect(find.text('Fatou Diallo'), findsOneWidget);
      expect(find.text('+19175551234'), findsOneWidget);
      expect(find.text('Mariama Bah'), findsOneWidget);
      expect(find.text('+224621234567'), findsOneWidget);
      // The box, where it is going, and when it sailed - US date style.
      expect(find.text('MSKU1234567'), findsOneWidget);
      expect(find.text('Sailing 3 Oct, box 2'), findsOneWidget);
      expect(find.text('Destination: Guinea'), findsOneWidget);
      expect(find.text('Sailed Oct 3, 2026'), findsOneWidget);
      expect(find.text('Shipped'), findsWidgets);
      // WhatsApp: who hears, and what happened last time.
      expect(find.text('WhatsApp updates to Fatou Diallo, Mariama Bah'),
          findsOneWidget);
      // intl may put a narrow no-break space before PM; match up to the time.
      expect(find.textContaining('Last update: left port, Oct 3, 2026 2:15'),
          findsOneWidget);
      expect(find.text('Customer: sent'), findsOneWidget);
      expect(find.text('Receiver: not sent, the phone has no country code'),
          findsOneWidget);
      // The three next actions.
      expect(find.byKey(const Key('pkg-edit-contacts')), findsOneWidget);
      expect(find.byKey(const Key('pkg-print-labels')), findsOneWidget);
      expect(find.byKey(const Key('pkg-open-container')), findsOneWidget);
    });

    testWidgets('renders in French', (tester) async {
      await _pump(
        tester,
        packageResultViewForTesting(line: _line(), container: _box),
        locale: const Locale('fr'),
      );
      expect(find.text('Propriétaire'), findsOneWidget);
      expect(find.text('Conteneur'), findsOneWidget);
      expect(find.text('Appeler'), findsNWidgets(2));
      expect(find.text('Réimprimer les étiquettes'), findsOneWidget);
      expect(find.text('Ouvrir le conteneur'), findsOneWidget);
      expect(find.textContaining('Aucune mise à jour envoyée'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('Call and WhatsApp hand over the right number', (tester) async {
      final called = <String>[];
      final messaged = <String>[];
      await _pump(
        tester,
        packageResultViewForTesting(
          line: _line(),
          container: _box,
          onCall: called.add,
          onWhatsApp: messaged.add,
        ),
      );
      await tester.tap(find.byKey(const Key('pkg-call-customer')));
      await tester.tap(find.byKey(const Key('pkg-whatsapp-receiver')));
      await tester.pump();
      expect(called, ['+19175551234']);
      expect(messaged, ['+224621234567']);
    });

    testWidgets('a number without a country code can be called, not messaged',
        (tester) async {
      final messaged = <String>[];
      final called = <String>[];
      await _pump(
        tester,
        packageResultViewForTesting(
          line: _line({'customerPhone': '9175551234'}),
          container: _box,
          onCall: called.add,
          onWhatsApp: messaged.add,
        ),
      );
      await tester.tap(find.byKey(const Key('pkg-whatsapp-customer')));
      await tester.tap(find.byKey(const Key('pkg-call-customer')));
      await tester.pump();
      expect(messaged, isEmpty);
      expect(called, ['9175551234']);
      final l10n = await AppLocalizations.delegate.load(const Locale('en'));
      expect(find.text(l10n.ctrPhoneNeedsCountryCode), findsOneWidget);
    });

    testWidgets('stock and a missing receiver say so instead of going blank',
        (tester) async {
      await _pump(
        tester,
        packageResultViewForTesting(
          line: _line({
            'ownerKind': containerOwnerStock,
            'customerName': '',
            'customerPhone': '',
            'receiverName': '',
            'receiverPhone': '',
            'kind': containerLineKindCar,
            'vinNumber': '1HGCM82633A004352',
            'carYear': '2019',
            'carMake': 'Toyota',
            'carModel': 'Camry',
          }),
          container: _box,
        ),
      );
      expect(find.text('Stock'), findsOneWidget);
      expect(find.byKey(const Key('pkg-no-receiver')), findsOneWidget);
      expect(find.text('2019 Toyota Camry'), findsOneWidget);
      expect(find.text('VIN 1HGCM82633A004352'), findsOneWidget);
      expect(find.byKey(const Key('pkg-call-customer')), findsNothing);
    });

    testWidgets('the actions call back; reprint waits for the container',
        (tester) async {
      var edits = 0, prints = 0, opens = 0;
      await _pump(
        tester,
        packageResultViewForTesting(
          line: _line(),
          container: _box,
          onEditContacts: () => edits++,
          onPrintLabels: () => prints++,
          onOpenContainer: () => opens++,
        ),
      );
      await tester.tap(find.byKey(const Key('pkg-edit-contacts')));
      await tester.tap(find.byKey(const Key('pkg-print-labels')));
      await tester.tap(find.byKey(const Key('pkg-open-container')));
      await tester.pump();
      expect([edits, prints, opens], [1, 1, 1]);

      await _pump(
        tester,
        packageResultViewForTesting(line: _line(), container: null),
      );
      expect(find.text('Container not found.'), findsOneWidget);
    });
  });

  group('package screen', () {
    testWidgets('finds the line by code and offers the shared contacts sheet',
        (tester) async {
      final repo = _FakeRepo(lines: [_line()], containers: [_box]);
      await _pump(
        tester,
        PackageResultScreen(businessId: 'b1', code: 'CL-K7M4P2', repository: repo),
        scaffold: false,
      );
      expect(repo.codesWatched, ['CL-K7M4P2']);
      expect(find.text('Fatou Diallo'), findsOneWidget);
      expect(find.text('MSKU1234567'), findsOneWidget);

      await tester.tap(find.byKey(const Key('pkg-edit-contacts')));
      await tester.pumpAndSettle();
      // The same sheet the container detail opens.
      expect(find.byKey(const Key('contacts-save')), findsOneWidget);
      expect(find.byKey(const Key('contacts-receiver')), findsOneWidget);
    });

    testWidgets('reprint asks for one line\'s labels of its container',
        (tester) async {
      final calls = <Map<String, Object>>[];
      Future<void> opener({
        required String businessId,
        required String containerId,
        required LabelPrintChoice choice,
        String lineId = '',
      }) async {
        calls.add(containerLabelsRequest(
          businessId: businessId,
          containerId: containerId,
          choice: choice,
          lineId: lineId,
        ));
      }

      await _pump(
        tester,
        PackageResultScreen(
          businessId: 'b1',
          code: 'CL-K7M4P2',
          repository: _FakeRepo(lines: [_line()], containers: [_box]),
          labelOpener: opener,
        ),
        scaffold: false,
      );
      await tester.tap(find.byKey(const Key('pkg-print-labels')));
      await tester.pumpAndSettle();
      expect(find.text('Labels for 3 barrels only'), findsOneWidget);
      await tester.tap(find.byKey(const Key('labels-copies-1')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('labels-print')));
      await tester.pumpAndSettle();
      expect(calls, hasLength(1));
      expect(calls.single['lineId'], 'l1');
      expect(calls.single['containerId'], 'c1');
      expect(calls.single['view'], 'labels');
      expect(calls.single['copies'], 1);
      expect(find.byKey(const Key('labels-print')), findsNothing,
          reason: 'the sheet closes once the labels opened');
    });

    testWidgets("another business's code says so and offers the public page",
        (tester) async {
      await _pump(
        tester,
        PackageResultScreen(
          businessId: 'b1',
          code: 'CL-BBBBBB',
          repository: _FakeRepo(lines: [_line()], containers: [_box]),
        ),
        scaffold: false,
      );
      expect(find.byKey(const Key('pkg-not-found')), findsOneWidget);
      expect(find.text('CL-BBBBBB is not on any of your containers'),
          findsOneWidget);
      expect(find.byKey(const Key('pkg-look-up-publicly')), findsOneWidget);
    });

    testWidgets('a line read by id from another business is not shown',
        (tester) async {
      final foreign = ContainerLine.fromMap('l9', {
        'businessId': 'b2',
        'containerId': 'c9',
        'kind': containerLineKindBarrels,
        'quantity': 1,
        'customerName': 'Someone Else',
      });
      await _pump(
        tester,
        PackageResultScreen(
          businessId: 'b1',
          lineId: 'l9',
          repository: _FakeRepo(lines: [foreign]),
        ),
        scaffold: false,
      );
      expect(find.text('Someone Else'), findsNothing);
      expect(find.byKey(const Key('pkg-not-found')), findsOneWidget);
    });
  });

  group('print labels sheet', () {
    testWidgets('defaults to letter sheets, two per package, and hands back '
        'the choice', (tester) async {
      LabelPrintChoice? printed;
      await _openSheet(
        tester,
        LabelPrintSheet(
          subtitle: 'Labels for every package on MSKU1234567',
          rememberFormat: false,
          onPrint: (choice) async => printed = choice,
        ),
      );
      expect(find.text('Print labels'), findsOneWidget);
      expect(find.text('Labels for every package on MSKU1234567'), findsOneWidget);
      expect(find.text('Letter sheet'), findsOneWidget);
      expect(find.text('4 × 6 thermal'), findsOneWidget);

      await tester.tap(find.byKey(const Key('labels-print')));
      await tester.pumpAndSettle();
      expect(printed, const LabelPrintChoice());
      expect(find.byKey(const Key('labels-print')), findsNothing,
          reason: 'the sheet closes once the labels opened');

      await _openSheet(
        tester,
        LabelPrintSheet(
          subtitle: 'x',
          rememberFormat: false,
          onPrint: (choice) async => printed = choice,
        ),
      );
      await tester.tap(find.byKey(const Key('labels-format-thermal')));
      await tester.tap(find.byKey(const Key('labels-copies-1')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('labels-print')));
      await tester.pumpAndSettle();
      expect(printed,
          const LabelPrintChoice(format: labelFormatThermal, copies: 1));
    });

    testWidgets('shows progress, ignores a second tap, and says when it failed',
        (tester) async {
      final gate = Completer<void>();
      var calls = 0;
      await _openSheet(
        tester,
        LabelPrintSheet(
          subtitle: 'x',
          rememberFormat: false,
          onPrint: (_) {
            calls++;
            return gate.future;
          },
        ),
      );
      await tester.tap(find.byKey(const Key('labels-print')));
      await tester.pump();
      expect(find.text('Opening…'), findsOneWidget);
      await tester.tap(find.byKey(const Key('labels-print')));
      await tester.pump();
      expect(calls, 1);

      gate.completeError(StateError('refused'));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('labels-error')), findsOneWidget);
      expect(find.text('Open labels to print'), findsOneWidget,
          reason: 'the button is usable again');
    });

    testWidgets('renders in French', (tester) async {
      await _openSheet(
        tester,
        LabelPrintSheet(
          subtitle: 'x',
          rememberFormat: false,
          onPrint: (_) async {},
        ),
        locale: const Locale('fr'),
      );
      expect(find.text('Imprimer les étiquettes'), findsOneWidget);
      expect(find.text('Feuille Letter'), findsOneWidget);
      expect(find.text('Thermique 4 × 6'), findsOneWidget);
      expect(find.text('Étiquettes par colis'), findsOneWidget);
      expect(find.text('Ouvrir les étiquettes à imprimer'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('print labels sheet, remembered paper', () {
    testWidgets('the paper chosen last time is chosen again', (tester) async {
      SharedPreferences.setMockInitialValues(
          {labelFormatPreferenceKey: labelFormatThermal});
      LabelPrintChoice? printed;
      await _openSheet(
        tester,
        LabelPrintSheet(subtitle: 'x', onPrint: (c) async => printed = c),
      );
      await tester.tap(find.byKey(const Key('labels-print')));
      await tester.pumpAndSettle();
      expect(printed?.format, labelFormatThermal);

      SharedPreferences.setMockInitialValues({});
      await _openSheet(
        tester,
        LabelPrintSheet(subtitle: 'x', onPrint: (c) async => printed = c),
      );
      await tester.tap(find.byKey(const Key('labels-format-thermal')));
      await tester.pump();
      await tester.tap(find.byKey(const Key('labels-print')));
      await tester.pumpAndSettle();
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString(labelFormatPreferenceKey), labelFormatThermal);
    });
  });

  group('container detail hooks', () {
    testWidgets('every line offers its own labels, in every container state',
        (tester) async {
      for (final open in [true, false]) {
        await _pump(
          tester,
          containerLineActionsSheetForTesting(line: _line(), open: open),
        );
        expect(find.byKey(const Key('line-print-labels')), findsOneWidget,
            reason: open ? 'loading' : 'shipped');
        expect(find.byKey(const Key('line-edit-contacts')), findsOneWidget);
      }
    });

    test('phone pickers start where the shared helpers say', () {
      expect(containerCustomerCountryCode(''), 'US');
      expect(containerCustomerCountryCode('SN'), 'SN');
      expect(containerReceiverCountryCode(_box), 'GN');
      expect(containerReceiverCountryCode(null, businessCountryCode: 'SN'),
          'SN');
    });
  });

  group('app links', () {
    setUp(PackageLinkService.instance.resetForTesting);
    tearDown(PackageLinkService.instance.resetForTesting);

    test('a link that arrives before the app is ready waits for it', () {
      final service = PackageLinkService.instance;
      service.handleLink(
          Uri.parse('https://customer.laawoldigital.com/t/cl-k7m4p2'));
      expect(service.pendingCode, 'CL-K7M4P2');
      // Not ours: ignored, and the parked code stays.
      service.handleLink(Uri.parse('https://customer.laawoldigital.com/pay/return'));
      service.handleLink(Uri.parse('https://example.com/t/CL-BBBBBB'));
      expect(service.pendingCode, 'CL-K7M4P2');
      // The newest tracking link wins.
      service.handleLink(Uri.parse(
          'https://customer.laawoldigital.com/?service=tracking&code=CL-BBBBBB'));
      expect(service.pendingCode, 'CL-BBBBBB');
    });

    test('start listens to the link stream it is given', () async {
      final links = StreamController<Uri>();
      PackageLinkService.instance.start(links: links.stream);
      links.add(Uri.parse('https://customer.laawoldigital.com/t/CL-K7M4P2'));
      await Future<void>.delayed(Duration.zero);
      expect(PackageLinkService.instance.pendingCode, 'CL-K7M4P2');
      await links.close();
    });
  });

  group('scan screen', () {
    Widget scan(_FakeRepo repo) => PackageScanScreen(
          businessId: 'b1',
          repository: repo,
          cameraEnabled: false,
        );

    testWidgets('a typed code, however written, opens that package',
        (tester) async {
      final repo = _FakeRepo(lines: [_line()], containers: [_box]);
      await _pump(tester, scan(repo), scaffold: false);
      await tester.enterText(find.byKey(const Key('pkg-query')), 'cl k7m4p2');
      await tester.pump();
      expect(find.text('Open CL-K7M4P2'), findsOneWidget);
      await tester.tap(find.byKey(const Key('pkg-open-code')));
      await tester.pumpAndSettle();
      expect(repo.codesWatched, ['CL-K7M4P2']);
      expect(find.text('Fatou Diallo'), findsOneWidget);
    });

    testWidgets('a pasted label link opens it too', (tester) async {
      final repo = _FakeRepo(lines: [_line()], containers: [_box]);
      await _pump(tester, scan(repo), scaffold: false);
      await tester.enterText(find.byKey(const Key('pkg-query')),
          'https://customer.laawoldigital.com/t/CL-K7M4P2');
      await tester.testTextInput.receiveAction(TextInputAction.search);
      await tester.pumpAndSettle();
      expect(repo.codesWatched, ['CL-K7M4P2']);
    });

    testWidgets('a receiver phone or name finds the package', (tester) async {
      final repo = _FakeRepo(lines: [_line()], containers: [_box]);
      await _pump(tester, scan(repo), scaffold: false);
      await tester.enterText(find.byKey(const Key('pkg-query')), '621 23');
      await tester.pump();
      expect(find.byKey(const ValueKey('pkg-hit-l1')), findsOneWidget);
      expect(find.text('CL-K7M4P2 · MSKU1234567'), findsOneWidget);

      await tester.enterText(find.byKey(const Key('pkg-query')), 'mariama');
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('pkg-hit-l1')));
      await tester.pumpAndSettle();
      expect(repo.codesWatched, ['CL-K7M4P2']);
    });

    testWidgets('no match says what search covers', (tester) async {
      await _pump(tester, scan(_FakeRepo(lines: [_line()])), scaffold: false);
      await tester.enterText(find.byKey(const Key('pkg-query')), 'zzzz');
      await tester.pump();
      expect(find.byKey(const Key('pkg-no-match')), findsOneWidget);
    });

    testWidgets('renders in French', (tester) async {
      await _pump(tester, scan(_FakeRepo()),
          scaffold: false, locale: const Locale('fr'));
      expect(find.text('Trouver un colis'), findsOneWidget);
      expect(find.text('Saisir le code'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
