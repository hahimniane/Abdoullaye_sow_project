import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/models/destination_country.dart';
import 'package:my_flutter_app/screens/add_waiting_packages_sheet.dart';
import 'package:my_flutter_app/screens/containers_screen.dart';
import 'package:my_flutter_app/screens/package_payment_sheet.dart';
import 'package:my_flutter_app/screens/package_result_screen.dart';
import 'package:my_flutter_app/screens/package_scan_screen.dart';
import 'package:my_flutter_app/screens/waiting_packages_screen.dart';
import 'package:my_flutter_app/services/container_manifest.dart';
import 'package:my_flutter_app/services/container_packages.dart';
import 'package:my_flutter_app/services/lot_ledger.dart' show LotStaff;
import 'package:my_flutter_app/services/package_codes.dart';
import 'package:my_flutter_app/services/waiting_package_service.dart';
import 'package:my_flutter_app/services/waiting_packages.dart';
import 'package:my_flutter_app/theme/app_motion.dart';
import 'package:my_flutter_app/theme/app_theme.dart';
import 'package:my_flutter_app/widgets/lot_sheets.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// The waiting-package surfaces as staff meet them: the register sheet and its
/// checks, the payment sheet, the "add waiting packages" sheet with its
/// disabled rows, the package view of a line with no container, the list and
/// the search hit. Firebase is replaced by a fake caller that records what the
/// phone sends and answers (or refuses) the way the callables do.

ContainerLine _waiting([Map<String, dynamic> extra = const {}, String id = 'w1']) =>
    ContainerLine.fromMap(id, {
      'businessId': 'b1',
      'containerId': '',
      'containerStatus': containerLineStatusWaiting,
      'kind': containerLineKindBarrels,
      'quantity': 2,
      'ownerKind': containerOwnerCustomer,
      'customerName': 'Fatou Diallo',
      'customerPhone': '+19175551234',
      'receiverName': 'Mariama Bah',
      'receiverPhone': '+224621234567',
      'trackingCode': 'CL-K7M4P2',
      'destinationCountryId': 'guinea',
      'destinationCountryName': 'Guinea',
      'createdAt': DateTime(2026, 10, 1, 9, 30),
      ...extra,
    });

ShippingContainer _box({
  String? destinationId = 'guinea',
  String? destinationName = 'Guinea',
  String status = containerStatusLoading,
}) =>
    ShippingContainer.fromMap('c1', {
      'businessId': 'b1',
      'label': 'Sailing 10 Oct',
      'containerNumber': 'MSKU1234567',
      'status': status,
      'destinationCountryId': ?destinationId,
      'destinationCountryName': ?destinationName,
    });

/// A fake for the callables: records every call, answers from [answers], and
/// throws what [refuse] says to.
class _Calls {
  final List<(String, Map<String, Object?>)> log = [];
  final Map<String, Object?> answers = {};
  Object? Function(String name)? refuse;

  Future<Object?> call(String name, Map<String, Object?> payload) async {
    log.add((name, payload));
    final error = refuse?.call(name);
    if (error != null) throw error;
    return answers[name];
  }

  List<Map<String, Object?>> of(String name) =>
      [for (final c in log) if (c.$1 == name) c.$2];
}

FirebaseFunctionsException _refusal(String reason,
        {List<String> lineIds = const [], String message = 'refused'}) =>
    FirebaseFunctionsException(
      message: message,
      code: 'failed-precondition',
      details: {'reason': reason, 'lineIds': lineIds},
    );

class _Payments implements LinePaymentsSource {
  _Payments(this.list);

  final List<ContainerLinePayment> list;

  @override
  Stream<List<ContainerLinePayment>> watch(String businessId, String lineId) =>
      Stream.value(list);
}

class _FakeRepo implements ContainerPackageRepository {
  _FakeRepo(this.lines);

  final List<ContainerLine> lines;

  @override
  Future<ContainerLine?> findLineByCode(String businessId, String code) async =>
      lines.where((l) => l.trackingCode == code).firstOrNull;

  @override
  Stream<ContainerLine?> watchLineByCode(String businessId, String code) =>
      Stream.fromFuture(findLineByCode(businessId, code));

  @override
  Stream<ContainerLine?> watchLine(String lineId) =>
      Stream.value(lines.where((l) => l.id == lineId).firstOrNull);

  @override
  Stream<ShippingContainer?> watchContainer(String containerId) =>
      Stream.value(null);

  @override
  Stream<List<ContainerLine>> watchLines(String businessId) =>
      Stream.value(lines);

  @override
  Stream<List<ShippingContainer>> watchContainers(String businessId) =>
      Stream.value(const []);

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
  double width = 430,
}) async {
  tester.view.physicalSize = Size(width, 3200);
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

/// Opens [sheet] the way the app does, over a page, and keeps what it closes
/// with in [result].
class _Opened<T> {
  T? value;
  bool closed = false;
}

Future<_Opened<T>> _openSheet<T>(
  WidgetTester tester,
  Widget sheet, {
  Locale locale = const Locale('en'),
  double width = 430,
}) async {
  final opened = _Opened<T>();
  await _pump(
    tester,
    Builder(
      builder: (context) => TextButton(
        key: const Key('open-sheet'),
        onPressed: () async {
          opened.value = await showLotSheet<T>(context, sheet);
          opened.closed = true;
        },
        child: const Text('open'),
      ),
    ),
    locale: locale,
    width: width,
  );
  await tester.tap(find.byKey(const Key('open-sheet')));
  await tester.pumpAndSettle();
  return opened;
}

Future<void> _type(WidgetTester tester, String key, String text) async {
  await tester.enterText(find.byKey(Key(key)), text);
  await tester.pump();
}

Future<void> _tap(WidgetTester tester, String key) async {
  await tester.ensureVisible(find.byKey(Key(key)));
  await tester.tap(find.byKey(Key(key)));
  await tester.pumpAndSettle();
}

/// The tap handler of the button keyed [key]: null when it is switched off.
VoidCallback? _onTapOf(WidgetTester tester, String key) => tester
    .widget<PressableScale>(find.descendant(
        of: find.byKey(Key(key)), matching: find.byType(PressableScale)))
    .onTap;

String _field(WidgetTester tester, String key) =>
    tester.widget<TextField>(find.byKey(Key(key))).controller!.text;

final _guinea = DestinationCountry(id: 'guinea', name: 'Guinea', code: 'GN', isMain: true);
final _senegal = DestinationCountry(id: 'senegal', name: 'Senegal', code: 'SN');

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  group('register sheet', () {
    Widget sheet(_Calls calls, {ContainerLine? existing, List<ContainerLine> lines = const []}) =>
        waitingPackageSheetForTesting(
          caller: calls.call,
          destinations: [_guinea, _senegal],
          defaultDestination: const DestinationRef('guinea', 'Guinea'),
          existing: existing,
          lines: lines,
        );

    testWidgets('opens on the main destination and says nobody is messaged',
        (tester) async {
      await _openSheet<WaitingPackageSaved>(tester, sheet(_Calls()));
      expect(find.text('Register a package'), findsOneWidget);
      await _tap(tester, 'line-lot-no');
      expect(find.byKey(const Key('wpk-destination')), findsOneWidget);
      expect(find.text('Guinea'), findsOneWidget);
      expect(find.byKey(const Key('wpk-no-notice')), findsOneWidget);
      // Always a customer's: no stock to choose.
      expect(find.text('Stock'), findsNothing);
      expect(find.byKey(const Key('line-save-and-another')), findsOneWidget);
      expect(find.byKey(const Key('line-save-and-print')), findsOneWidget);
    });

    testWidgets('saving an empty form names each missing field and sends nothing',
        (tester) async {
      final calls = _Calls();
      await _openSheet<WaitingPackageSaved>(tester, sheet(calls));
      await _tap(tester, 'line-lot-no');
      await _tap(tester, 'line-save');
      expect(find.text('Enter the VIN.'), findsOneWidget);
      expect(find.text("Enter the customer's name."), findsOneWidget);
      expect(calls.log, isEmpty);

      // A barrel needs a count and a customer; the destination is already set.
      await tester.tap(find.text('Barrels'));
      await tester.pumpAndSettle();
      await _tap(tester, 'line-save');
      expect(find.text('Enter how many.'), findsOneWidget);
      expect(find.text("Enter the customer's name."), findsOneWidget);
      expect(find.text('Choose where this package is going.'), findsNothing);
      expect(calls.log, isEmpty);
    });

    testWidgets('size needs all three sides, and shows the volume as it is typed',
        (tester) async {
      final calls = _Calls();
      await _openSheet<WaitingPackageSaved>(tester, sheet(calls));
      await tester.tap(find.text('Barrels'));
      await tester.pumpAndSettle();
      await _type(tester, 'line-quantity', '2');
      await _type(tester, 'line-customer', 'Fatou Diallo');
      await _type(tester, 'wpk-length', '40');
      await _tap(tester, 'line-save');
      expect(
        find.text(
            'Enter the length, width and height in inches, or leave all three empty.'),
        findsOneWidget,
      );
      expect(calls.log, isEmpty, reason: 'refused at the field, no round trip');

      await _type(tester, 'wpk-width', '30');
      await _type(tester, 'wpk-height', '20');
      expect(find.text('13.89 ft³'), findsOneWidget);
    });

    testWidgets('a price that cannot be read is refused at the field',
        (tester) async {
      final calls = _Calls();
      await _openSheet<WaitingPackageSaved>(tester, sheet(calls));
      await tester.tap(find.text('Barrels'));
      await tester.pumpAndSettle();
      await _type(tester, 'line-quantity', '2');
      await _type(tester, 'line-customer', 'Fatou Diallo');
      await _type(tester, 'wpk-price', 'free');
      await _tap(tester, 'line-save');
      expect(find.text('Enter the price in dollars, more than zero.'),
          findsOneWidget);
      expect(calls.log, isEmpty);
    });

    testWidgets('registers a waiting barrel with its size, price and country',
        (tester) async {
      final calls = _Calls()
        ..answers['addWaitingPackage'] = {
          'success': true,
          'lineId': 'l9',
          'trackingCode': 'CL-ABCDEF',
        };
      final opened = await _openSheet<WaitingPackageSaved>(tester, sheet(calls));
      await tester.tap(find.text('Barrels'));
      await tester.pumpAndSettle();
      await _type(tester, 'line-quantity', '2');
      await _type(tester, 'line-customer', 'Fatou Diallo');
      await _type(tester, 'line-receiver', 'Mariama Bah');
      await _type(tester, 'wpk-length', '40');
      await _type(tester, 'wpk-width', '30');
      await _type(tester, 'wpk-height', '20');
      await _type(tester, 'wpk-price', '45,50');
      await _tap(tester, 'wpk-pay-on-arrival');
      await _tap(tester, 'line-save');

      final sent = calls.of('addWaitingPackage').single;
      expect(sent['businessId'], 'b1');
      expect(sent['kind'], 'barrels');
      expect(sent['quantity'], 2);
      expect(sent['ownerKind'], 'customer');
      expect(sent['customerName'], 'Fatou Diallo');
      expect(sent['receiverName'], 'Mariama Bah');
      expect(sent['destinationCountryId'], 'guinea');
      expect(sent['destinationCountryName'], 'Guinea');
      expect(sent['lengthIn'], 40);
      expect(sent['widthIn'], 30);
      expect(sent['heightIn'], 20);
      expect(sent['priceCents'], 4550);
      expect(sent['payOnArrival'], isTrue);
      expect(sent.containsKey('containerId'), isFalse,
          reason: 'there is no container yet');

      expect(opened.closed, isTrue);
      expect(opened.value!.lineId, 'l9');
      expect(opened.value!.trackingCode, 'CL-ABCDEF');
      expect(opened.value!.printLabel, isFalse);
      // Named enough for the label sheet before the live list catches up.
      expect(opened.value!.line!.isWaiting, isTrue);
      expect(opened.value!.line!.trackingCode, 'CL-ABCDEF');
      expect(find.text('Package saved: CL-ABCDEF'), findsOneWidget);
    });

    testWidgets('another destination is picked from the business list first',
        (tester) async {
      final calls = _Calls()
        ..answers['addWaitingPackage'] = {'lineId': 'l1', 'trackingCode': 'CL-AAAAAA'};
      await _openSheet<WaitingPackageSaved>(tester, sheet(calls));
      await tester.tap(find.text('Barrels'));
      await tester.pumpAndSettle();
      await _type(tester, 'line-quantity', '1');
      await _type(tester, 'line-customer', 'Fatou');
      await _tap(tester, 'wpk-destination');
      expect(find.text('Your destinations'), findsOneWidget);
      await tester.tap(find.text('Senegal').first);
      await tester.pumpAndSettle();
      await _tap(tester, 'line-save');
      final sent = calls.of('addWaitingPackage').single;
      expect(sent['destinationCountryId'], 'senegal');
      expect(sent['destinationCountryName'], 'Senegal');
    });

    testWidgets('save & add another keeps the customer and the country, '
        'starts the box over', (tester) async {
      final calls = _Calls()
        ..answers['addWaitingPackage'] = {'lineId': 'l1', 'trackingCode': 'CL-AAAAAA'};
      final opened = await _openSheet<WaitingPackageSaved>(tester, sheet(calls));
      await tester.tap(find.text('Barrels'));
      await tester.pumpAndSettle();
      await _type(tester, 'line-quantity', '2');
      await _type(tester, 'line-customer', 'Fatou Diallo');
      await _type(tester, 'line-receiver', 'Mariama Bah');
      await _type(tester, 'wpk-length', '40');
      await _type(tester, 'wpk-width', '30');
      await _type(tester, 'wpk-height', '20');
      await _type(tester, 'wpk-price', '45');
      await _tap(tester, 'line-save-and-another');

      expect(calls.of('addWaitingPackage'), hasLength(1));
      expect(opened.closed, isFalse, reason: 'the sheet stays open');
      expect(_field(tester, 'line-customer'), 'Fatou Diallo');
      expect(_field(tester, 'line-receiver'), 'Mariama Bah');
      expect(find.text('Guinea'), findsOneWidget);
      expect(_field(tester, 'line-quantity'), '');
      expect(_field(tester, 'wpk-length'), '');
      expect(_field(tester, 'wpk-price'), '');
      expect(find.byKey(const Key('line-added-so-far')), findsOneWidget);
      expect(find.textContaining('CL-AAAAAA'), findsOneWidget);

      // The next box goes through the same checks, then the same callable.
      await _tap(tester, 'line-save-and-another');
      expect(find.text('Enter how many.'), findsOneWidget);
      expect(calls.of('addWaitingPackage'), hasLength(1));
      await _type(tester, 'line-quantity', '1');
      await _tap(tester, 'line-save');
      expect(calls.of('addWaitingPackage'), hasLength(2));
      expect(calls.of('addWaitingPackage').last['customerName'], 'Fatou Diallo');
      expect(opened.closed, isTrue);
    });

    testWidgets('save & print label closes with the package, asking for its label',
        (tester) async {
      final calls = _Calls()
        ..answers['addWaitingPackage'] = {'lineId': 'l5', 'trackingCode': 'CL-PRINT2'};
      final opened = await _openSheet<WaitingPackageSaved>(tester, sheet(calls));
      await tester.tap(find.text('Barrels'));
      await tester.pumpAndSettle();
      await _type(tester, 'line-quantity', '1');
      await _type(tester, 'line-customer', 'Fatou');
      await _tap(tester, 'line-save-and-print');
      expect(opened.value!.printLabel, isTrue);
      expect(opened.value!.lineId, 'l5');
    });

    testWidgets('a server refusal lands in words, and the sheet stays open',
        (tester) async {
      final calls = _Calls()
        ..refuse = (_) => _refusal('destination_mismatch');
      final opened = await _openSheet<WaitingPackageSaved>(tester, sheet(calls));
      await tester.tap(find.text('Barrels'));
      await tester.pumpAndSettle();
      await _type(tester, 'line-quantity', '1');
      await _type(tester, 'line-customer', 'Fatou');
      await _tap(tester, 'line-save');
      expect(find.text('A package can only go on a container headed to the same country.'),
          findsOneWidget);
      expect(opened.closed, isFalse);
      // The button is released: a second try is possible.
      calls.refuse = null;
      calls.answers['addWaitingPackage'] = {'lineId': 'l1', 'trackingCode': 'CL-AAAAAA'};
      await _tap(tester, 'line-save');
      expect(opened.closed, isTrue);
    });

    testWidgets('a car already waiting for a container is refused at the VIN',
        (tester) async {
      final other = _waiting({
        'kind': containerLineKindCar,
        'vinNumber': 'ABC1234567',
      }, 'w2');
      await _openSheet<WaitingPackageSaved>(
          tester, sheet(_Calls(), lines: [other]));
      await _tap(tester, 'line-lot-no');
      await _type(tester, 'line-vin', 'ABC1234567');
      await tester.pumpAndSettle();
      expect(find.text('This car is already waiting for a container.'),
          findsOneWidget);
    });

    testWidgets('editing opens pre-filled; the price goes through its own call, '
        'an emptied size is cleared', (tester) async {
      final calls = _Calls();
      final line = _waiting({
        'lengthIn': 40,
        'widthIn': 30,
        'heightIn': 20,
        'priceCents': 4550,
      });
      final opened =
          await _openSheet<WaitingPackageSaved>(tester, sheet(calls, existing: line));
      expect(find.text('Edit package'), findsOneWidget);
      expect(_field(tester, 'line-quantity'), '2');
      expect(_field(tester, 'line-customer'), 'Fatou Diallo');
      expect(_field(tester, 'wpk-length'), '40');
      expect(_field(tester, 'wpk-price'), '45.50');
      expect(find.text('13.89 ft³'), findsOneWidget);
      // Edited, not added: no "add another".
      expect(find.byKey(const Key('line-save-and-another')), findsNothing);
      expect(find.byKey(const Key('wpk-no-notice')), findsNothing);

      await _type(tester, 'wpk-length', '');
      await _type(tester, 'wpk-width', '');
      await _type(tester, 'wpk-height', '');
      await _type(tester, 'wpk-price', '50');
      await _tap(tester, 'line-save-edit');

      final update = calls.of('updateContainerLine').single;
      expect(update['lineId'], 'w1');
      expect(update['containerId'], '');
      final sent = update['line'] as Map<String, Object?>;
      expect(sent['lengthIn'], isNull);
      expect(sent.containsKey('lengthIn'), isTrue);
      expect(sent.containsKey('priceCents'), isFalse);
      final price = calls.of('setContainerLinePrice').single;
      expect(price['priceCents'], 5000);
      expect(price['lineId'], 'w1');
      expect(calls.log.map((c) => c.$1),
          ['updateContainerLine', 'setContainerLinePrice']);
      expect(opened.value!.edited, isTrue);
      expect(find.text('Package updated.'), findsOneWidget);
    });

    testWidgets('an edit that leaves the price alone does not touch it',
        (tester) async {
      final calls = _Calls();
      final line = _waiting({'priceCents': 4550});
      await _openSheet<WaitingPackageSaved>(tester, sheet(calls, existing: line));
      await _type(tester, 'line-quantity', '3');
      await _tap(tester, 'line-save-edit');
      expect(calls.of('updateContainerLine'), hasLength(1));
      expect(calls.of('setContainerLinePrice'), isEmpty);
    });

    testWidgets('renders in French', (tester) async {
      await _openSheet<WaitingPackageSaved>(tester, sheet(_Calls()),
          locale: const Locale('fr'));
      expect(find.text('Enregistrer un colis'), findsOneWidget);
      await tester.tap(find.text('Des barils'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Dimensions en pouces'), findsOneWidget);
      expect(find.text('Paiement à l\'arrivée'), findsOneWidget);
      expect(find.text('Enregistrer et imprimer l\'étiquette'), findsOneWidget);
      expect(find.textContaining('même client'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('price and payments sheet', () {
    final staff = [const LotStaff(id: 's1', name: 'Awa Camara')];

    Widget sheet(
      _Calls calls, {
      ContainerLine? line,
      List<ContainerLinePayment> payments = const [],
    }) =>
        PackagePaymentSheet(
          businessId: 'b1',
          line: line ?? _waiting({'priceCents': 10000, 'paidCents': 2500}),
          staff: staff,
          caller: calls.call,
          payments: _Payments(payments),
        );

    testWidgets('shows where it stands: chip, paid of price, still owed',
        (tester) async {
      await _openSheet<void>(tester, sheet(_Calls()));
      expect(find.text('Price & payments'), findsOneWidget);
      expect(find.text('Partial'), findsOneWidget);
      expect(find.text(r'$25.00 of $100.00'), findsOneWidget);
      expect(find.text(r'$75.00 still owed'), findsOneWidget);
      expect(find.text('No payments recorded yet.'), findsOneWidget);
    });

    testWidgets('"pay the whole balance" fills it, recording follows the answer',
        (tester) async {
      final calls = _Calls()
        ..answers['recordContainerLinePayment'] = {
          'success': true,
          'paymentId': 'p1',
          'paidCents': 10000,
        };
      await _openSheet<void>(tester, sheet(calls));
      await _tap(tester, 'pay-whole-balance');
      expect(_field(tester, 'pay-amount'), '75');
      await _tap(tester, 'pay-record');

      final sent = calls.of('recordContainerLinePayment').single;
      expect(sent['lineId'], 'w1');
      expect(sent['amountCents'], 7500);
      expect(sent['method'], 'cash');
      // The server's total drives the screen: paid in full.
      expect(find.text('Paid'), findsOneWidget);
      expect(find.text(r'$100.00 of $100.00'), findsOneWidget);
      expect(find.text('Payment recorded.'), findsOneWidget);
      expect(_field(tester, 'pay-amount'), '');
      // Nothing left to record.
      expect(find.text('Record a payment'), findsOneWidget);
      final button = find.byKey(const Key('pay-record'));
      await tester.tap(button);
      await tester.pump();
      expect(calls.of('recordContainerLinePayment'), hasLength(1));
    });

    testWidgets('more than is owed is refused before the round trip',
        (tester) async {
      final calls = _Calls();
      await _openSheet<void>(tester, sheet(calls));
      await _type(tester, 'pay-amount', '75.01');
      await _tap(tester, 'pay-record');
      expect(find.text('That is more than what is still owed.'), findsOneWidget);
      await _type(tester, 'pay-amount', '');
      await _tap(tester, 'pay-record');
      expect(find.text('Enter the amount received.'), findsOneWidget);
      expect(calls.log, isEmpty);
    });

    testWidgets('how it arrived is chosen from the shared list', (tester) async {
      final calls = _Calls()
        ..answers['recordContainerLinePayment'] = {'paidCents': 3500};
      await _openSheet<void>(tester, sheet(calls));
      await _tap(tester, 'pay-method');
      await tester.tap(find.text('Zelle'));
      await tester.pumpAndSettle();
      await _type(tester, 'pay-amount', '10');
      await _type(tester, 'pay-note', 'at the counter');
      await _tap(tester, 'pay-record');
      final sent = calls.of('recordContainerLinePayment').single;
      expect(sent['method'], 'zelle');
      expect(sent['note'], 'at the counter');
      expect(sent['amountCents'], 1000);
    });

    testWidgets('a refusal from the server is said in words', (tester) async {
      final calls = _Calls()
        ..refuse = (_) => _refusal('payment_exceeds_balance');
      await _openSheet<void>(tester, sheet(calls));
      await _type(tester, 'pay-amount', '10');
      await _tap(tester, 'pay-record');
      expect(find.text('That is more than what is still owed.'), findsOneWidget);
      // Released: the paid total did not move.
      expect(find.text(r'$25.00 of $100.00'), findsOneWidget);
    });

    testWidgets('the history says who took what and when, and a payment reverts',
        (tester) async {
      final calls = _Calls()
        ..answers['revertContainerLinePayment'] = {'success': true, 'paidCents': 0};
      final payments = [
        ContainerLinePayment.fromMap('p1', {
          'lineId': 'w1',
          'amountCents': 2500,
          'method': 'zelle',
          'note': 'deposit',
          'receivedByStaffId': 's1',
          'createdAt': DateTime(2026, 10, 3, 14, 15),
        }),
        ContainerLinePayment.fromMap('p0', {
          'lineId': 'w1',
          'amountCents': 1000,
          'method': 'cash',
          'receivedByStaffId': 's1',
          'reverted': true,
          'revertedByStaffId': 's1',
          'createdAt': DateTime(2026, 10, 2, 9, 5),
        }),
      ];
      await _openSheet<void>(tester, sheet(calls, payments: payments));
      expect(find.byKey(const Key('pay-history')), findsOneWidget);
      expect(find.text(r'$25.00'), findsOneWidget);
      expect(find.textContaining('Oct 3, 2026 2:15'), findsOneWidget);
      expect(find.textContaining('recorded by Awa Camara'), findsNWidgets(2));
      expect(find.text('deposit'), findsOneWidget);
      // A reverted payment stays, marked, with who reverted it, and offers no
      // second revert.
      expect(find.byKey(const Key('pay-reverted:p0')), findsOneWidget);
      expect(find.text('Reverted by Awa Camara'), findsOneWidget);
      expect(find.byKey(const Key('pay-revert:p0')), findsNothing);

      await _tap(tester, 'pay-revert:p1');
      expect(find.text('Revert this payment?'), findsOneWidget);
      await tester.tap(find.descendant(
          of: find.byType(AlertDialog), matching: find.text('Revert')));
      await tester.pumpAndSettle();
      final sent = calls.of('revertContainerLinePayment').single;
      expect(sent['paymentId'], 'p1');
      expect(find.text('Payment reverted.'), findsOneWidget);
      expect(find.text('Unpaid'), findsOneWidget);
    });

    testWidgets('without a price there is nothing to pay against yet',
        (tester) async {
      final calls = _Calls()
        ..answers['setContainerLinePrice'] = {
          'success': true,
          'priceCents': 12000,
          'payOnArrival': true,
        };
      await _openSheet<void>(tester, sheet(calls, line: _waiting()));
      expect(find.text('No price yet'), findsOneWidget);
      expect(find.byKey(const Key('pay-amount')), findsNothing);
      expect(_onTapOf(tester, 'pay-record'), isNull);

      await _type(tester, 'pay-price', '120');
      await _tap(tester, 'pay-on-arrival');
      await _tap(tester, 'pay-save-price');
      final sent = calls.of('setContainerLinePrice').single;
      expect(sent['priceCents'], 12000);
      expect(sent['payOnArrival'], isTrue);
      expect(sent['lineId'], 'w1');
      expect(find.text('Price saved.'), findsOneWidget);
      // Now there is a price: the payment form appears and the chip says so.
      expect(find.byKey(const Key('pay-amount')), findsOneWidget);
      expect(find.text('Pay on arrival'), findsWidgets);
    });

    testWidgets('a price below what was paid is refused, and so is rubbish',
        (tester) async {
      final calls = _Calls();
      await _openSheet<void>(tester, sheet(calls));
      await _type(tester, 'pay-price', '20');
      await _tap(tester, 'pay-save-price');
      expect(find.text("The price can't be less than what has been paid."),
          findsOneWidget);
      await _type(tester, 'pay-price', 'lots');
      await _tap(tester, 'pay-save-price');
      expect(find.text('Enter the price in dollars, more than zero.'),
          findsOneWidget);
      expect(calls.log, isEmpty);
    });

    testWidgets('renders in French', (tester) async {
      await _openSheet<void>(tester, sheet(_Calls()),
          locale: const Locale('fr'));
      expect(find.text('Prix et paiements'), findsOneWidget);
      expect(find.text('Partiel'), findsOneWidget);
      expect(find.text(r'$25.00 sur $100.00'), findsOneWidget);
      expect(find.text('Payer tout le solde'), findsOneWidget);
      expect(find.text('Aucun paiement enregistré.'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });

  group('add waiting packages to a container', () {
    ContainerLine pkg(String id, String dest, String destName, String name) =>
        _waiting({
          'destinationCountryId': dest,
          'destinationCountryName': destName,
          'customerName': name,
          'trackingCode': 'CL-${id.toUpperCase()}AAAAA',
        }, id);

    final packages = [
      pkg('a', 'guinea', 'Guinea', 'Fatou Diallo'),
      pkg('b', 'senegal', 'Senegal', 'Moussa Bah'),
      pkg('c', '', '', 'Aissatou Sow'),
    ];

    Widget sheet(_Calls calls, {ShippingContainer? container}) =>
        AddWaitingPackagesSheet(
          businessId: 'b1',
          container: container ?? _box(),
          packages: packages,
          caller: calls.call,
        );

    testWidgets('a package for another country is disabled with the reason',
        (tester) async {
      await _openSheet<int>(tester, sheet(_Calls()));
      expect(find.text('Add waiting packages'), findsOneWidget);
      expect(find.byKey(const Key('assign-row:a')), findsOneWidget);
      final blocked = tester.widget<CheckboxListTile>(
          find.descendant(
              of: find.byKey(const Key('assign-row:b')),
              matching: find.byType(CheckboxListTile)));
      expect(blocked.onChanged, isNull);
      expect(find.text('For Senegal, this container goes to Guinea.'),
          findsOneWidget);
      // One that names none rides anywhere; one for the same country too.
      for (final id in ['a', 'c']) {
        final row = tester.widget<CheckboxListTile>(find.descendant(
            of: find.byKey(Key('assign-row:$id')),
            matching: find.byType(CheckboxListTile)));
        expect(row.onChanged, isNotNull, reason: id);
      }
    });

    testWidgets('select all matching ticks what the box can take, then adds them',
        (tester) async {
      final calls = _Calls()
        ..answers['assignContainerLines'] = {'success': true, 'assigned': 2};
      final opened = await _openSheet<int>(tester, sheet(calls));
      await _tap(tester, 'assign-select-all');
      expect(find.text('2 selected'), findsOneWidget);
      await _tap(tester, 'assign-submit');
      final sent = calls.of('assignContainerLines').single;
      expect(sent['containerId'], 'c1');
      expect(sent['lineIds'], ['a', 'c']);
      expect(opened.value, 2);
    });

    testWidgets('the search narrows the list, and select all follows it',
        (tester) async {
      final calls = _Calls();
      await _openSheet<int>(tester, sheet(calls));
      await _type(tester, 'assign-search', 'aissatou');
      expect(find.byKey(const Key('assign-row:a')), findsNothing);
      expect(find.byKey(const Key('assign-row:c')), findsOneWidget);
      await _tap(tester, 'assign-select-all');
      expect(find.text('1 selected'), findsOneWidget);
      await _type(tester, 'assign-search', 'zzzz');
      expect(find.text('No waiting package matches that search.'), findsOneWidget);
    });

    testWidgets('Add is off until something is ticked; Clear empties the ticks',
        (tester) async {
      await _openSheet<int>(tester, sheet(_Calls()));
      expect(_onTapOf(tester, 'assign-submit'), isNull);
      await _tap(tester, 'assign-select-all');
      expect(find.byKey(const Key('assign-clear')), findsOneWidget);
      await _tap(tester, 'assign-clear');
      expect(find.text('0 selected'), findsOneWidget);
    });

    testWidgets('a container with no destination says so, and takes none that name one',
        (tester) async {
      await _openSheet<int>(
          tester, sheet(_Calls(), container: _box(destinationId: null, destinationName: null)));
      expect(find.byKey(const Key('assign-no-destination')), findsOneWidget);
      for (final id in ['a', 'b']) {
        final row = tester.widget<CheckboxListTile>(find.descendant(
            of: find.byKey(Key('assign-row:$id')),
            matching: find.byType(CheckboxListTile)));
        expect(row.onChanged, isNull, reason: id);
      }
      final free = tester.widget<CheckboxListTile>(find.descendant(
          of: find.byKey(const Key('assign-row:c')),
          matching: find.byType(CheckboxListTile)));
      expect(free.onChanged, isNotNull);
    });

    testWidgets('the server\'s refusal is said in words and the sheet stays',
        (tester) async {
      final calls = _Calls()
        ..refuse = (_) => _refusal('destination_mismatch', lineIds: ['a']);
      final opened = await _openSheet<int>(tester, sheet(calls));
      await _tap(tester, 'assign-select-all');
      await _tap(tester, 'assign-submit');
      expect(
        find.text('A package can only go on a container headed to the same country.'),
        findsOneWidget,
      );
      expect(opened.closed, isFalse);
      expect(find.byKey(const Key('assign-submit')), findsOneWidget);
    });

    testWidgets('nothing waiting says so; French reads', (tester) async {
      await _openSheet<int>(
        tester,
        AddWaitingPackagesSheet(
            businessId: 'b1', container: _box(), packages: const []),
        locale: const Locale('fr'),
      );
      expect(find.text('Ajouter des colis en attente'), findsOneWidget);
      expect(find.byKey(const Key('assign-empty')), findsOneWidget);
      expect(find.text("Aucun colis n'attend de conteneur."), findsOneWidget);
    });
  });

  group('a package with no container', () {
    testWidgets('the view says it waits, with price, paid and balance',
        (tester) async {
      var payments = 0, prints = 0, edits = 0;
      await _pump(
        tester,
        packageResultViewForTesting(
          line: _waiting({
            'lengthIn': 40,
            'widthIn': 30,
            'heightIn': 20,
            'priceCents': 10000,
            'paidCents': 2500,
            'payOnArrival': true,
          }),
          container: null,
          onPricePayments: () => payments++,
          onPrintLabels: () => prints++,
          onEditLine: () => edits++,
        ),
      );
      expect(find.byKey(const Key('pkg-waiting')), findsOneWidget);
      expect(find.text('Waiting for a container'), findsOneWidget);
      expect(find.text('Container not found.'), findsNothing);
      expect(find.text('Destination: Guinea'), findsOneWidget);
      expect(find.text('Dropped off Oct 1, 2026'), findsOneWidget);
      expect(find.byKey(const Key('pkg-size')), findsOneWidget);
      expect(find.text('Size: 40 × 30 × 20 in · 13.89 ft³'), findsOneWidget);
      // Money: the standing, paid of price, and what is still owed.
      expect(find.byKey(const Key('pkg-money')), findsOneWidget);
      expect(find.text('Partial'), findsOneWidget);
      expect(find.text(r'$25.00 of $100.00'), findsOneWidget);
      expect(find.text(r'$75.00 still owed'), findsOneWidget);
      // Nobody has been messaged: the line says an update is not out yet.
      expect(find.byKey(const Key('pkg-no-update-yet')), findsOneWidget);
      // No container to open, but the label prints and the package edits.
      expect(_onTapOf(tester, 'pkg-open-container'), isNull);
      await tester.ensureVisible(find.byKey(const Key('pkg-print-labels')));
      await tester.tap(find.byKey(const Key('pkg-print-labels')));
      await tester.tap(find.byKey(const Key('pkg-edit-line')));
      await tester.ensureVisible(find.byKey(const Key('pkg-price-payments')));
      await tester.tap(find.byKey(const Key('pkg-price-payments')));
      await tester.pump();
      expect([payments, prints, edits], [1, 1, 1]);
      expect(find.text('Edit package'), findsOneWidget);
    });

    testWidgets('an unpriced waiting package says there is no price yet',
        (tester) async {
      await _pump(
        tester,
        packageResultViewForTesting(
          line: _waiting(),
          container: null,
          onPricePayments: () {},
        ),
      );
      expect(find.text('No price set yet.'), findsOneWidget);
      expect(find.text('No price yet'), findsOneWidget);
    });

    testWidgets('an old line on a box shows no money, but can still be priced',
        (tester) async {
      final onBox = _waiting({
        'containerId': 'c1',
        'containerStatus': containerStatusShipped,
      });
      await _pump(
        tester,
        packageResultViewForTesting(
          line: onBox,
          container: _box(status: containerStatusShipped),
          onPricePayments: () {},
        ),
      );
      expect(find.byKey(const Key('pkg-money')), findsNothing);
      expect(find.byKey(const Key('pkg-waiting')), findsNothing);
      expect(find.byKey(const Key('pkg-price-payments')), findsOneWidget);
    });

    testWidgets('French reads', (tester) async {
      await _pump(
        tester,
        packageResultViewForTesting(
          line: _waiting({'priceCents': 5000}),
          container: null,
          onPricePayments: () {},
        ),
        locale: const Locale('fr'),
      );
      expect(find.text("En attente d'un conteneur"), findsOneWidget);
      expect(find.text('Prix et paiements'), findsWidgets);
      expect(find.text('Impayé'), findsOneWidget);
      expect(find.textContaining('Déposé le'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the screen finds a waiting line by its code and does not fail',
        (tester) async {
      final repo = _FakeRepo([_waiting()]);
      await _pump(
        tester,
        PackageResultScreen(
            businessId: 'b1', code: 'CL-K7M4P2', repository: repo),
        scaffold: false,
      );
      expect(find.text('CL-K7M4P2'), findsWidgets);
      expect(find.byKey(const Key('pkg-waiting')), findsOneWidget);
      expect(find.byKey(const Key('pkg-not-found')), findsNothing);
      expect(find.text('Fatou Diallo'), findsOneWidget);
      // The label prints with no container; the packaging edits too.
      expect(_onTapOf(tester, 'pkg-print-labels'), isNotNull);
      expect(find.byKey(const Key('pkg-edit-line')), findsOneWidget);
    });

    testWidgets('the label of a waiting package is asked for by line id',
        (tester) async {
      final calls = <Map<String, Object?>>[];
      Future<void> opener({
        required String businessId,
        required String containerId,
        required LabelPrintChoice choice,
        String lineId = '',
      }) async {
        calls.add({'containerId': containerId, 'lineId': lineId});
      }

      await _pump(
        tester,
        PackageResultScreen(
          businessId: 'b1',
          code: 'CL-K7M4P2',
          repository: _FakeRepo([_waiting()]),
          labelOpener: opener,
        ),
        scaffold: false,
      );
      await tester.ensureVisible(find.byKey(const Key('pkg-print-labels')));
      await tester.tap(find.byKey(const Key('pkg-print-labels')));
      await tester.pumpAndSettle();
      // The print sheet is up; printing sends no container.
      await tester.tap(find.byKey(const Key('labels-print')));
      await tester.pumpAndSettle();
      expect(calls, [
        {'containerId': '', 'lineId': 'w1'},
      ]);
    });
  });

  group('the waiting list', () {
    testWidgets('a card names the package, whose, where, how big and the money',
        (tester) async {
      ContainerLine? tapped, printed;
      await _pump(
        tester,
        waitingPackagesListForTesting(
          lines: [
            _waiting({
              'lengthIn': 40,
              'widthIn': 30,
              'heightIn': 20,
              'priceCents': 10000,
              'paidCents': 10000,
              'addedByStaffId': 's1',
            }),
            _waiting({'trackingCode': 'CL-SECOND'}, 'w2'),
          ],
          staff: const [LotStaff(id: 's1', name: 'Awa Camara')],
          onTap: (l) => tapped = l,
          onPrint: (l) => printed = l,
        ),
      );
      expect(find.text('2 barrels'), findsNWidgets(2));
      expect(find.textContaining('Fatou Diallo · +19175551234'), findsNWidgets(2));
      expect(find.text('→ Mariama Bah · +224621234567'), findsNWidgets(2));
      expect(find.text('Guinea · 40 × 30 × 20 in · 13.89 ft³'), findsOneWidget);
      expect(find.text('Paid'), findsOneWidget);
      expect(find.text('No price yet'), findsOneWidget);
      expect(find.textContaining('Dropped off Oct 1, 2026'), findsNWidgets(2));
      expect(find.textContaining('Awa Camara'), findsOneWidget);

      await tester.tap(find.text('2 barrels').first);
      await tester.pump();
      expect(tapped!.id, 'w1');
      await tester.tap(find.byKey(const ValueKey('waiting-print-labels:w2')));
      await tester.pump();
      expect(printed!.id, 'w2');
    });

    testWidgets('empty says so; a search with no match says that instead',
        (tester) async {
      await _pump(
        tester,
        waitingPackagesListForTesting(lines: const [], anyAtAll: false),
      );
      expect(find.text('No packages are waiting.'), findsOneWidget);
      expect(find.text('Register one when a customer drops it off.'),
          findsOneWidget);
      await _pump(
        tester,
        waitingPackagesListForTesting(
            lines: const [], anyAtAll: true, searching: true),
      );
      expect(find.text('No waiting package matches that search.'),
          findsOneWidget);
    });

    testWidgets('the entry on the containers screen counts them', (tester) async {
      var taps = 0;
      await _pump(tester, WaitingEntryRow(count: 0, onTap: () => taps++));
      expect(find.text('Waiting for a container'), findsOneWidget);
      expect(find.text('Dropped off, no container yet'), findsOneWidget);
      await _pump(tester, WaitingEntryRow(count: 3, onTap: () => taps++));
      expect(find.text('3 packages waiting'), findsOneWidget);
      await tester.tap(find.byKey(const Key('containers-open-waiting')));
      await tester.pump();
      expect(taps, 1);
      await _pump(tester, WaitingEntryRow(count: 1, onTap: () {}),
          locale: const Locale('fr'));
      expect(find.text('1 colis en attente'), findsOneWidget);
    });
  });

  group('lines on a container', () {
    ContainerLine onBox() => _waiting({
          'containerId': 'c1',
          'containerStatus': containerStatusLoading,
        });

    testWidgets('price & payments stay open in every state; send back only while loading',
        (tester) async {
      await _pump(
        tester,
        containerLineActionsSheetForTesting(line: onBox(), open: true),
      );
      expect(find.byKey(const Key('line-price-payments')), findsOneWidget);
      expect(find.byKey(const Key('line-send-back')), findsOneWidget);
      expect(find.text('Send back to waiting'), findsOneWidget);

      await _pump(
        tester,
        containerLineActionsSheetForTesting(line: onBox(), open: false),
      );
      expect(find.byKey(const Key('line-price-payments')), findsOneWidget);
      expect(find.byKey(const Key('line-send-back')), findsNothing);
      expect(find.byKey(const Key('line-edit-contacts')), findsOneWidget);
    });

    testWidgets('a priced line shows its size and standing on the container',
        (tester) async {
      await _pump(
        tester,
        containerLineActionsSheetForTesting(
          line: _waiting({
            'containerId': 'c1',
            'containerStatus': containerStatusLoading,
            'lengthIn': 40,
            'widthIn': 30,
            'heightIn': 20,
            'priceCents': 10000,
          }),
          open: true,
        ),
      );
      expect(find.byKey(const Key('line-size')), findsOneWidget);
      expect(find.text('Unpaid'), findsOneWidget);
      expect(find.text(r'$0.00 of $100.00'), findsOneWidget);
    });
  });

  group('search', () {
    testWidgets('a waiting package is found by name and says it is waiting',
        (tester) async {
      await _pump(
        tester,
        PackageScanScreen(
          businessId: 'b1',
          repository: _FakeRepo([_waiting()]),
          cameraEnabled: false,
        ),
        scaffold: false,
      );
      await tester.enterText(find.byKey(const Key('pkg-query')), 'fatou');
      await tester.pumpAndSettle();
      expect(find.byKey(const ValueKey('pkg-hit-w1')), findsOneWidget);
      expect(find.byKey(const Key('pkg-hit-waiting')), findsOneWidget);
      expect(find.text('Waiting'), findsOneWidget);
      expect(find.textContaining('CL-K7M4P2 · Guinea'), findsOneWidget);
    });
  });

  group('a narrow French phone', () {
    // 320 logical pixels is the smallest phone still in use; French labels are
    // the longest. Overflow is an exception in a test, so a clean run is the
    // proof that nothing is clipped or pushed off screen.
    testWidgets('the register sheet, a barrel, with every field and error',
        (tester) async {
      await _openSheet<WaitingPackageSaved>(
        tester,
        waitingPackageSheetForTesting(
          caller: _Calls().call,
          destinations: [_guinea, _senegal],
          defaultDestination: const DestinationRef('guinea', 'Guinea'),
        ),
        locale: const Locale('fr'),
        width: 320,
      );
      await tester.tap(find.text('Des barils'));
      await tester.pumpAndSettle();
      await _type(tester, 'wpk-length', '40');
      await _tap(tester, 'line-save');
      expect(find.textContaining('longueur, la largeur'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the payment sheet with its history', (tester) async {
      await _openSheet<void>(
        tester,
        PackagePaymentSheet(
          businessId: 'b1',
          line: _waiting({'priceCents': 1234567, 'paidCents': 250000}),
          staff: const [LotStaff(id: 's1', name: 'Awa Camara-Diallo')],
          caller: _Calls().call,
          payments: _Payments([
            ContainerLinePayment.fromMap('p1', {
              'amountCents': 250000,
              'method': 'card_in_person',
              'note': 'a long note that wraps over more than one line, easily',
              'receivedByStaffId': 's1',
              'createdAt': DateTime(2026, 10, 3, 14, 15),
            }),
          ]),
        ),
        locale: const Locale('fr'),
        width: 320,
      );
      expect(find.text(r'$2,500.00 sur $12,345.67'), findsOneWidget);
      expect(find.textContaining('enregistré par Awa Camara-Diallo'),
          findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the add sheet, a blocked row and a long reason', (tester) async {
      await _openSheet<int>(
        tester,
        AddWaitingPackagesSheet(
          businessId: 'b1',
          container: _box(destinationId: 'cote-divoire', destinationName: "Côte d'Ivoire"),
          packages: [
            _waiting({
              'destinationCountryId': 'senegal',
              'destinationCountryName': 'Sénégal',
              'lengthIn': 48,
              'widthIn': 40,
              'heightIn': 36.5,
            }),
          ],
        ),
        locale: const Locale('fr'),
        width: 320,
      );
      expect(find.text("Pour Sénégal ; ce conteneur va vers Côte d'Ivoire."),
          findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('the waiting card and the package view', (tester) async {
      await _pump(
        tester,
        waitingPackagesListForTesting(lines: [
          _waiting({
            'lengthIn': 48,
            'widthIn': 40,
            'heightIn': 36.5,
            'priceCents': 1234567,
            'paidCents': 250000,
            'customerName': 'Aïssatou Camara-Diallo de la Marina',
            'receiverName': 'Mariama Bah-Sow',
          }),
        ]),
        locale: const Locale('fr'),
        width: 320,
      );
      expect(find.text('Partiel'), findsOneWidget);
      expect(tester.takeException(), isNull);
      await _pump(
        tester,
        packageResultViewForTesting(
          line: _waiting({'priceCents': 1234567, 'payOnArrival': true}),
          container: null,
          onPricePayments: () {},
        ),
        locale: const Locale('fr'),
        width: 320,
      );
      expect(find.byKey(const Key('pkg-waiting')), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  });
}
