import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/containers_screen.dart';
import 'package:my_flutter_app/screens/send_packages_sheet.dart';
import 'package:my_flutter_app/screens/waiting_packages_screen.dart';
import 'package:my_flutter_app/services/container_manifest.dart';
import 'package:my_flutter_app/services/package_requests.dart'
    show PackageProofSettings;
import 'package:my_flutter_app/services/send_packages.dart';
import 'package:my_flutter_app/theme/app_theme.dart';

/// Send packages (docs/SHIPPING_SIMPLE_HOME.md, part S): several waiting air
/// packages leave together on one flight. The plan and the runner are pure
/// and tested with a fake caller; the sheet is rendered with the same fake,
/// in English and French. The rule that matters most: a retry continues with
/// the shipment already made and never calls `createContainer` twice.

ContainerLine _pkg(
  String id, {
  String country = 'guinea',
  String countryName = 'Guinea',
  String mode = 'air',
  String code = '',
  double? weight,
  String sender = 'Test Sender',
  String receiver = 'Test Receiver',
  int? hoursAgo,
  Map<String, dynamic> extra = const {},
}) => ContainerLine.fromMap(id, {
  'businessId': 'b1',
  'containerId': '',
  'containerStatus': containerLineStatusWaiting,
  'kind': containerLineKindBarrels,
  'quantity': 2,
  'ownerKind': containerOwnerCustomer,
  'customerName': sender,
  'customerPhone': '+15555550101',
  'receiverName': receiver,
  'receiverPhone': '+15555550102',
  'trackingCode': code.isEmpty ? 'CL-${id.toUpperCase()}' : code,
  'destinationCountryId': country,
  'destinationCountryName': countryName,
  'shipMode': mode,
  'weightLb': ?weight,
  'createdAt': DateTime(2026, 11, 1, 12).subtract(Duration(hours: hoursAgo ?? 0)),
  ...extra,
});

ShippingContainer _box(
  String id, {
  String status = 'loading',
  String mode = 'air',
  String country = 'guinea',
  String day = '2026-11-14',
  String label = 'Flight 11/14/2026',
  String waybill = '',
  int lineCount = 0,
  String business = 'b1',
}) => ShippingContainer.fromMap(id, {
  'businessId': business,
  'label': label,
  'status': status,
  'shipMode': mode,
  'airWaybill': waybill,
  'destinationCountryId': country,
  'destinationCountryName': 'Guinea',
  'plannedDepartureDate': day,
  'lineCount': lineCount,
});

SendPlan _plan({
  String waybill = '',
  DateTime? date,
  List<String> ids = const ['a', 'b'],
}) => SendPlan(
  businessId: 'b1',
  countryId: 'guinea',
  countryName: 'Guinea',
  flightDate: date ?? DateTime(2026, 11, 14),
  lineIds: ids,
  flightWord: 'Flight',
  airWaybill: waybill,
);

FirebaseFunctionsException _refusal(
  String message, {
  Map<String, Object?> details = const {},
}) => FirebaseFunctionsException(
  message: message,
  code: 'failed-precondition',
  details: details,
);

/// A fake for the callables: records every call, answers from [answers], and
/// throws what [refuse] says to (and for how many tries).
class _Calls {
  final List<(String, Map<String, Object?>)> log = [];
  final Map<String, Object?> answers = {
    'createContainer': {'success': true, 'containerId': 'box1'},
    'assignContainerLines': {'success': true, 'assigned': 2},
    'setContainerStatus': {'success': true, 'status': 'shipped'},
  };

  /// Errors to throw on the next calls of a name, one per call.
  final Map<String, List<Object>> failures = {};

  /// Calls that wait until the test completes them.
  final Map<String, Completer<void>> hold = {};

  Future<Object?> call(String name, Map<String, Object?> payload) async {
    log.add((name, payload));
    final wait = hold[name];
    if (wait != null) await wait.future;
    final queue = failures[name];
    if (queue != null && queue.isNotEmpty) throw queue.removeAt(0);
    return answers[name];
  }

  List<Map<String, Object?>> of(String name) => [
    for (final c in log)
      if (c.$1 == name) c.$2,
  ];

  List<String> get names => [for (final c in log) c.$1];
}

void main() {
  group('which packages can go', () {
    test('waiting air packages of customers, newest first', () {
      final lines = [
        _pkg('old', hoursAgo: 5),
        _pkg('new'),
        _pkg('sea', mode: 'sea'),
        _pkg('loaded', extra: {
          'containerId': 'c1',
          'containerStatus': 'loading',
        }),
        _pkg('stock', extra: {'ownerKind': 'stock'}),
        _pkg('nowhere', country: ''),
      ];
      expect(sendablePackages(lines).map((l) => l.id), ['new', 'old']);
    });

    test('countries by name, with how many each', () {
      final countries = sendCountries([
        _pkg('a'),
        _pkg('b'),
        _pkg('c', country: 'senegal', countryName: 'Senegal'),
        _pkg('d', country: 'mali', countryName: ''),
      ]);
      expect([for (final c in countries) (c.id, c.name, c.count)], [
        ('guinea', 'Guinea', 2),
        ('mali', 'mali', 1),
        ('senegal', 'Senegal', 1),
      ]);
    });

    test('the packages going to one country', () {
      final lines = [_pkg('a'), _pkg('b', country: 'senegal')];
      expect(packagesToCountry(lines, 'senegal').map((l) => l.id), ['b']);
      expect(packagesToCountry(lines, 'peru'), isEmpty);
    });
  });

  group('the flight\'s date, name and airway bill', () {
    test('the day key is YYYY-MM-DD', () {
      expect(flightDayKey(DateTime(2026, 1, 5)), '2026-01-05');
      expect(flightDayKey(DateTime(2026, 11, 14, 23, 59)), '2026-11-14');
    });

    test('the name is month first', () {
      expect(flightLabel('Flight', DateTime(2026, 11, 4)), 'Flight 11/04/2026');
      expect(flightLabel('Vol', DateTime(2026, 1, 25)), 'Vol 01/25/2026');
    });

    test('an airway bill is optional, then 6 to 20 letters, digits, dashes', () {
      expect(sendWaybillRefusal(''), isNull);
      expect(sendWaybillRefusal('   '), isNull);
      expect(sendWaybillRefusal('176-12345678'), isNull);
      expect(sendWaybillRefusal(' ab 1234 56 '), isNull);
      expect(sendWaybillRefusal('abc12'), 'air_waybill_invalid');
      expect(sendWaybillRefusal('a' * 21), 'air_waybill_invalid');
      expect(sendWaybillRefusal('abc_12345'), 'air_waybill_invalid');
    });
  });

  group('the plan', () {
    test('without an airway bill the shipment is named by its date', () {
      final create = _plan().createRequest();
      expect(create, {
        'businessId': 'b1',
        'shipMode': 'air',
        'label': 'Flight 11/14/2026',
        'destinationCountryId': 'guinea',
        'destinationCountryName': 'Guinea',
        'plannedDepartureDate': '2026-11-14',
      });
      expect(create.containsKey('airWaybill'), isFalse);
    });

    test('with an airway bill it names the shipment and no label is sent', () {
      final create = _plan(waybill: ' 176 12345678 ').createRequest();
      expect(create['airWaybill'], '176 12345678'.replaceAll(' ', ''));
      expect(create.containsKey('label'), isFalse);
      expect(create['plannedDepartureDate'], '2026-11-14');
      expect(create['shipMode'], 'air');
    });

    test('a French name starts with Vol', () {
      final plan = SendPlan(
        businessId: 'b1',
        countryId: 'guinea',
        countryName: 'Guinée',
        flightDate: DateTime(2026, 11, 4),
        lineIds: const ['a'],
        flightWord: 'Vol',
      );
      expect(plan.createRequest()['label'], 'Vol 11/04/2026');
    });

    test('the other two requests carry the shipment and the packages', () {
      final plan = _plan();
      expect(plan.assignRequest('box1'), {
        'businessId': 'b1',
        'containerId': 'box1',
        'lineIds': ['a', 'b'],
      });
      expect(plan.assignRequest('box1', acknowledgeProblems: true), {
        'businessId': 'b1',
        'containerId': 'box1',
        'lineIds': ['a', 'b'],
        'acknowledgeProblems': true,
      });
      expect(plan.statusRequest('box1'), {
        'businessId': 'b1',
        'containerId': 'box1',
        'status': 'shipped',
      });
    });
  });

  group('an empty shipment from an earlier Send', () {
    test('is picked up for the same country, day and name', () {
      final earlier = _box('e1');
      expect(
        reusableEmptyShipment(_plan(), [earlier], const [])?.id,
        'e1',
      );
    });

    test('by airway bill when one is typed', () {
      final named = _box('e1', waybill: '17612345678', label: '');
      expect(
        reusableEmptyShipment(_plan(waybill: '176-12345678'), [named], const []),
        isNull,
      );
      expect(
        reusableEmptyShipment(_plan(waybill: '17612345678'), [named], const [])
            ?.id,
        'e1',
      );
      // A named shipment is not the one for a send with no airway bill.
      expect(reusableEmptyShipment(_plan(), [named], const []), isNull);
    });

    test('never one that holds packages, has left, or is another\'s', () {
      final plan = _plan();
      expect(reusableEmptyShipment(plan, [_box('e', lineCount: 1)], []), isNull);
      expect(
        reusableEmptyShipment(plan, [_box('e')], [
          _pkg('x', extra: {'containerId': 'e'}),
        ]),
        isNull,
      );
      for (final other in [
        _box('e', status: 'shipped'),
        _box('e', status: 'arrived'),
        _box('e', mode: 'sea'),
        _box('e', country: 'senegal'),
        _box('e', day: '2026-11-15'),
        _box('e', label: 'Flight 11/15/2026'),
        _box('e', business: 'b2'),
      ]) {
        expect(reusableEmptyShipment(plan, [other], []), isNull);
      }
    });
  });

  group('the runner', () {
    test('creates, assigns, then ships, in that order', () async {
      final calls = _Calls();
      final runner = SendRunner(plan: _plan(), caller: calls.call);
      await runner.run();
      expect(calls.names, [
        'createContainer',
        'assignContainerLines',
        'setContainerStatus',
      ]);
      expect(calls.of('assignContainerLines').single['containerId'], 'box1');
      expect(calls.of('setContainerStatus').single['containerId'], 'box1');
      expect(runner.isDone, isTrue);
      expect(runner.count, 2);
      expect(runner.assigned?.assigned, 2);
    });

    test('a failure at assign keeps the shipment; retry never creates again', () async {
      final calls = _Calls()
        ..failures['assignContainerLines'] = [_refusal('container_locked')];
      final runner = SendRunner(plan: _plan(), caller: calls.call);
      await expectLater(
        runner.run(),
        throwsA(isA<FirebaseFunctionsException>()),
      );
      expect(runner.step, SendStep.assign);
      expect(runner.containerId, 'box1');
      expect(runner.startedShipment, isTrue);
      await runner.run();
      expect(calls.of('createContainer'), hasLength(1));
      expect(calls.of('assignContainerLines'), hasLength(2));
      expect(calls.of('setContainerStatus'), hasLength(1));
      expect(runner.isDone, isTrue);
    });

    test('a failure at ship repeats only the status', () async {
      final calls = _Calls()
        ..failures['setContainerStatus'] = [
          _refusal('container_transition_invalid'),
        ];
      final runner = SendRunner(plan: _plan(), caller: calls.call);
      await expectLater(
        runner.run(),
        throwsA(isA<FirebaseFunctionsException>()),
      );
      expect(runner.step, SendStep.ship);
      await runner.run();
      expect(calls.of('createContainer'), hasLength(1));
      expect(calls.of('assignContainerLines'), hasLength(1));
      expect(calls.of('setContainerStatus'), hasLength(2));
    });

    test('three failures in a row still make one shipment', () async {
      final calls = _Calls()
        ..failures['assignContainerLines'] = [
          _refusal('a'),
          _refusal('b'),
        ]
        ..failures['setContainerStatus'] = [_refusal('c')];
      final runner = SendRunner(plan: _plan(), caller: calls.call);
      for (var i = 0; i < 3; i++) {
        await expectLater(runner.run(), throwsA(anything));
      }
      await runner.run();
      expect(calls.of('createContainer'), hasLength(1));
    });

    test('a failure at create has no shipment, so a retry creates', () async {
      final calls = _Calls()..failures['createContainer'] = [_refusal('nope')];
      final runner = SendRunner(plan: _plan(), caller: calls.call);
      await expectLater(runner.run(), throwsA(anything));
      expect(runner.startedShipment, isFalse);
      expect(runner.step, SendStep.create);
      await runner.run();
      expect(calls.of('createContainer'), hasLength(2));
      expect(runner.isDone, isTrue);
    });

    test('a shipment taken over skips creating', () async {
      final calls = _Calls();
      final runner = SendRunner(
        plan: _plan(),
        caller: calls.call,
        reuseContainerId: 'earlier',
      );
      await runner.run();
      expect(calls.names, ['assignContainerLines', 'setContainerStatus']);
      expect(calls.of('assignContainerLines').single['containerId'], 'earlier');
    });

    test('confirmed, the assign call is repeated with the acknowledgement', () async {
      final calls = _Calls()
        ..failures['assignContainerLines'] = [
          _refusal('sender', details: {
            'reason': 'sender_problem',
            'lineIds': ['a'],
          }),
        ];
      final runner = SendRunner(plan: _plan(), caller: calls.call);
      await expectLater(runner.run(), throwsA(anything));
      await runner.run(acknowledgeProblems: true);
      final assigns = calls.of('assignContainerLines');
      expect(assigns, hasLength(2));
      expect(assigns.first.containsKey('acknowledgeProblems'), isFalse);
      expect(assigns.last['acknowledgeProblems'], isTrue);
      expect(calls.of('createContainer'), hasLength(1));
    });

    test('an answer with no shipment id is an error, not a made shipment', () async {
      final calls = _Calls()..answers['createContainer'] = {'success': true};
      final runner = SendRunner(plan: _plan(), caller: calls.call);
      await expectLater(runner.run(), throwsA(isA<StateError>()));
      expect(runner.startedShipment, isFalse);
    });
  });

  group('the sheet', () {
    final now = DateTime(2026, 11, 10, 15, 30);
    final two = [_pkg('a', code: 'CL-AAAAAA', weight: 22), _pkg('b', code: 'CL-BBBBBB')];

    /// Opens the sheet over a page the way the waiting list does; [result]
    /// gets what it closes with.
    Future<_Result> open(
      WidgetTester tester,
      _Calls calls, {
      List<ContainerLine>? packages,
      List<ShippingContainer> containers = const [],
      Locale locale = const Locale('en'),
      double width = 430,
    }) async {
      tester.view.physicalSize = Size(width, 3200);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final result = _Result();
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.light,
          locale: locale,
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          home: Scaffold(
            body: Builder(
              builder: (context) => TextButton(
                key: const Key('open-send'),
                onPressed: () async {
                  result.value = await showSendPackagesSheet(
                    context,
                    businessId: 'b1',
                    packages: packages ?? two,
                    containers: () => containers,
                    lines: () => const [],
                    caller: calls.call,
                    clock: () => now,
                  );
                  result.closed = true;
                },
                child: const Text('open'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.byKey(const Key('open-send')));
      await tester.pumpAndSettle();
      return result;
    }

    Future<void> tapKey(WidgetTester tester, String key) async {
      final finder = find.byKey(Key(key));
      await tester.ensureVisible(finder);
      await tester.pumpAndSettle();
      await tester.tap(finder);
      await tester.pumpAndSettle();
    }

    testWidgets('one country: no question, all ticked, today, send', (
      tester,
    ) async {
      final calls = _Calls();
      final result = await open(tester, calls);
      expect(find.text('Where are they going?'), findsNothing);
      expect(find.byKey(const ValueKey('send-row:a')), findsOneWidget);
      expect(find.byKey(const ValueKey('send-row:b')), findsOneWidget);
      // sender → receiver, the code, the pieces, the weight.
      expect(find.text('Test Sender → Test Receiver'), findsNWidgets(2));
      expect(find.textContaining('CL-AAAAAA'), findsOneWidget);
      expect(find.textContaining('22 lb'), findsOneWidget);
      expect(find.text('Send 2 packages'), findsOneWidget);
      // Today, month first.
      expect(find.byKey(const Key('send-date-text')), findsOneWidget);
      expect(find.text('Nov 10, 2026'), findsOneWidget);
      await tapKey(tester, 'send-submit');
      expect(calls.names, [
        'createContainer',
        'assignContainerLines',
        'setContainerStatus',
      ]);
      final create = calls.of('createContainer').single;
      expect(create['label'], 'Flight 11/10/2026');
      expect(create['plannedDepartureDate'], '2026-11-10');
      expect(create['shipMode'], 'air');
      expect(create['destinationCountryId'], 'guinea');
      expect(calls.of('assignContainerLines').single['lineIds'], ['a', 'b']);
      expect(calls.of('setContainerStatus').single['status'], 'shipped');
      expect(result.closed, isTrue);
      expect(result.value, 2);
    });

    testWidgets('several countries: pick one first, then they are all ticked', (
      tester,
    ) async {
      final calls = _Calls();
      await open(
        tester,
        calls,
        packages: [
          _pkg('a'),
          _pkg('b'),
          _pkg('s', country: 'senegal', countryName: 'Senegal'),
        ],
      );
      expect(find.text('Where are they going?'), findsOneWidget);
      expect(find.text('Guinea · 2 packages'), findsOneWidget);
      expect(find.text('Senegal · 1 package'), findsOneWidget);
      // Nothing to tick until a country is chosen.
      expect(find.byKey(const ValueKey('send-row:a')), findsNothing);
      expect(
        tester
            .widget<ChoiceChip>(find.byKey(const Key('send-country:guinea')))
            .selected,
        isFalse,
      );
      await tapKey(tester, 'send-country:senegal');
      expect(find.byKey(const ValueKey('send-row:s')), findsOneWidget);
      expect(find.byKey(const ValueKey('send-row:a')), findsNothing);
      expect(find.text('Send 1 package'), findsOneWidget);
      await tapKey(tester, 'send-submit');
      expect(calls.of('createContainer').single['destinationCountryId'],
          'senegal');
      expect(calls.of('assignContainerLines').single['lineIds'], ['s']);
    });

    testWidgets('select none, tick one, select all', (tester) async {
      final calls = _Calls();
      await open(tester, calls);
      await tapKey(tester, 'send-select-none');
      expect(find.text('Send 0 packages'), findsOneWidget);
      // Nothing ticked: the button does nothing.
      await tapKey(tester, 'send-submit');
      expect(calls.log, isEmpty);
      await tester.tap(find.byKey(const ValueKey('send-row:b')));
      await tester.pumpAndSettle();
      expect(find.text('Send 1 package'), findsOneWidget);
      await tapKey(tester, 'send-select-all');
      expect(find.text('Send 2 packages'), findsOneWidget);
      await tester.tap(find.byKey(const ValueKey('send-row:a')));
      await tester.pumpAndSettle();
      await tapKey(tester, 'send-submit');
      expect(calls.of('assignContainerLines').single['lineIds'], ['b']);
    });

    testWidgets('an airway bill names the shipment; no label is sent', (
      tester,
    ) async {
      final calls = _Calls();
      await open(tester, calls);
      await tester.enterText(
        find.byKey(const Key('send-waybill')),
        '176-12345678',
      );
      await tapKey(tester, 'send-submit');
      final create = calls.of('createContainer').single;
      expect(create['airWaybill'], '176-12345678');
      expect(create.containsKey('label'), isFalse);
    });

    testWidgets('a bad airway bill is said at the field and nothing is sent', (
      tester,
    ) async {
      final calls = _Calls();
      await open(tester, calls);
      await tester.enterText(find.byKey(const Key('send-waybill')), 'ab');
      await tapKey(tester, 'send-submit');
      expect(
        find.text('Use 6 to 20 letters or numbers. Dashes are fine.'),
        findsOneWidget,
      );
      expect(calls.log, isEmpty);
      // Typing again clears it.
      await tester.enterText(find.byKey(const Key('send-waybill')), 'abc123');
      await tester.pumpAndSettle();
      expect(
        find.text('Use 6 to 20 letters or numbers. Dashes are fine.'),
        findsNothing,
      );
    });

    testWidgets('a sender\'s problem asks, and Send anyway repeats confirmed', (
      tester,
    ) async {
      final calls = _Calls()
        ..failures['assignContainerLines'] = [
          _refusal('sender', details: {
            'reason': 'sender_problem',
            'lineIds': ['a'],
          }),
        ];
      final result = await open(tester, calls);
      await tapKey(tester, 'send-submit');
      expect(find.text('Send anyway?'), findsOneWidget);
      expect(
        find.text('The sender reported a problem with CL-AAAAAA. Send anyway?'),
        findsOneWidget,
      );
      expect(result.closed, isFalse);
      await tester.tap(find.text('Send anyway'));
      await tester.pumpAndSettle();
      final assigns = calls.of('assignContainerLines');
      expect(assigns, hasLength(2));
      expect(assigns.last['acknowledgeProblems'], isTrue);
      expect(calls.of('createContainer'), hasLength(1));
      expect(calls.of('setContainerStatus'), hasLength(1));
      expect(result.value, 2);
    });

    testWidgets('cancelling the sender question sends nothing more', (
      tester,
    ) async {
      final calls = _Calls()
        ..failures['assignContainerLines'] = [
          _refusal('sender', details: {
            'reason': 'sender_problem',
            'lineIds': ['a'],
          }),
        ];
      final result = await open(tester, calls);
      await tapKey(tester, 'send-submit');
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(calls.of('assignContainerLines'), hasLength(1));
      expect(calls.of('setContainerStatus'), isEmpty);
      expect(result.closed, isFalse);
      // The shipment exists; the next press continues it.
      expect(find.text('Try again'), findsOneWidget);
    });

    testWidgets('a failure at assign: the reason, Try again, same shipment', (
      tester,
    ) async {
      final calls = _Calls()
        ..failures['assignContainerLines'] = [_refusal('container_locked')];
      final result = await open(tester, calls);
      await tapKey(tester, 'send-submit');
      expect(result.closed, isFalse);
      expect(find.text('Try again'), findsOneWidget);
      expect(find.byKey(const Key('send-resume-note')), findsOneWidget);
      expect(
        find.text('The shipment is already started. Try again to finish sending.'),
        findsOneWidget,
      );
      await tapKey(tester, 'send-submit');
      expect(calls.of('createContainer'), hasLength(1));
      expect(calls.of('assignContainerLines'), hasLength(2));
      expect(calls.of('setContainerStatus'), hasLength(1));
      expect(
        calls.of('assignContainerLines').last['containerId'],
        calls.of('setContainerStatus').single['containerId'],
      );
      expect(result.value, 2);
    });

    testWidgets('a failure at ship: Try again repeats only the status', (
      tester,
    ) async {
      final calls = _Calls()
        ..failures['setContainerStatus'] = [_refusal('container_empty')];
      final result = await open(tester, calls);
      await tapKey(tester, 'send-submit');
      expect(find.text('Try again'), findsOneWidget);
      await tapKey(tester, 'send-submit');
      expect(calls.names, [
        'createContainer',
        'assignContainerLines',
        'setContainerStatus',
        'setContainerStatus',
      ]);
      expect(result.value, 2);
    });

    CheckboxListTile tile(WidgetTester tester, String id) =>
        tester.widget<CheckboxListTile>(
          find.descendant(
            of: find.byKey(ValueKey('send-row:$id')),
            matching: find.byType(CheckboxListTile),
          ),
        );

    testWidgets(
      'after the shipment exists its country, date and airway bill are locked',
      (tester) async {
        final calls = _Calls()
          ..failures['assignContainerLines'] = [_refusal('container_locked')];
        await open(
          tester,
          calls,
          packages: [_pkg('a'), _pkg('b'), _pkg('s', country: 'senegal')],
        );
        await tapKey(tester, 'send-country:guinea');
        await tapKey(tester, 'send-submit');
        expect(
          tester
              .widget<ChoiceChip>(find.byKey(const Key('send-country:senegal')))
              .onSelected,
          isNull,
        );
        expect(
          tester
              .widget<TextField>(find.byKey(const Key('send-waybill')))
              .enabled,
          isFalse,
        );
        expect(
          tester.widget<InkWell>(find.byKey(const Key('send-date'))).onTap,
          isNull,
        );
      },
    );

    // Regression: a refused package could not be left out once the shipment
    // existed, so Try again failed for ever.
    testWidgets('a refused package can be unticked; Try again sends the rest', (
      tester,
    ) async {
      final calls = _Calls()
        ..failures['assignContainerLines'] = [
          _refusal('line_already_assigned', details: {
            'reason': 'line_already_assigned',
            'lineIds': ['a'],
          }),
        ];
      final result = await open(tester, calls);
      await tapKey(tester, 'send-submit');
      expect(find.text('Try again'), findsOneWidget);
      expect(tile(tester, 'a').onChanged, isNotNull);
      await tapKey(tester, 'send-row:a');
      await tapKey(tester, 'send-submit');
      expect(calls.of('createContainer'), hasLength(1));
      final assigns = calls.of('assignContainerLines');
      expect(assigns, hasLength(2));
      expect(assigns.last['lineIds'], ['b']);
      expect(assigns.last['containerId'], 'box1');
      expect(calls.of('setContainerStatus').single['containerId'], 'box1');
      expect(result.value, 1);
    });

    testWidgets('saying no to Send anyway lets the package be left out', (
      tester,
    ) async {
      final calls = _Calls()
        ..failures['assignContainerLines'] = [
          _refusal('sender', details: {
            'reason': 'sender_problem',
            'lineIds': ['a'],
          }),
        ];
      final result = await open(tester, calls);
      await tapKey(tester, 'send-submit');
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(tile(tester, 'a').onChanged, isNotNull);
      await tapKey(tester, 'send-row:a');
      await tapKey(tester, 'send-submit');
      expect(calls.of('createContainer'), hasLength(1));
      expect(calls.of('assignContainerLines').last['lineIds'], ['b']);
      expect(result.value, 1);
    });

    testWidgets('an answer that may be lost keeps the ticks locked', (
      tester,
    ) async {
      final calls = _Calls()
        ..failures['assignContainerLines'] = [
          FirebaseFunctionsException(message: 'offline', code: 'unavailable'),
        ];
      final result = await open(tester, calls);
      await tapKey(tester, 'send-submit');
      // The packages may already be on the shipment: the same ones go again.
      expect(tile(tester, 'a').onChanged, isNull);
      await tapKey(tester, 'send-submit');
      expect(calls.of('assignContainerLines').last['lineIds'], ['a', 'b']);
      expect(result.value, 2);
    });

    testWidgets('a failure at ship keeps the ticks locked', (tester) async {
      final calls = _Calls()
        ..failures['setContainerStatus'] = [_refusal('container_empty')];
      await open(tester, calls);
      await tapKey(tester, 'send-submit');
      expect(tile(tester, 'a').onChanged, isNull);
    });

    testWidgets('a failure at create: the reason, and a retry creates again', (
      tester,
    ) async {
      final calls = _Calls()
        ..failures['createContainer'] = [_refusal('container_label_required')];
      final result = await open(tester, calls);
      await tapKey(tester, 'send-submit');
      expect(result.closed, isFalse);
      expect(find.text('Try again'), findsOneWidget);
      // Nothing was made, so there is no "already started" note.
      expect(find.byKey(const Key('send-resume-note')), findsNothing);
      await tapKey(tester, 'send-submit');
      expect(calls.of('createContainer'), hasLength(2));
      expect(result.value, 2);
    });

    testWidgets('an empty shipment from an earlier Send is taken, not copied', (
      tester,
    ) async {
      final calls = _Calls();
      final result = await open(
        tester,
        calls,
        containers: [
          _box('earlier', day: '2026-11-10', label: 'Flight 11/10/2026'),
        ],
      );
      await tapKey(tester, 'send-submit');
      expect(calls.names, ['assignContainerLines', 'setContainerStatus']);
      expect(calls.of('assignContainerLines').single['containerId'], 'earlier');
      expect(result.value, 2);
    });

    testWidgets('a button that is working shows it and takes no second tap', (
      tester,
    ) async {
      final calls = _Calls();
      final hold = calls.hold['createContainer'] = Completer<void>();
      await open(tester, calls);
      await tester.tap(find.byKey(const Key('send-submit')));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
      expect(find.text('Sending…'), findsOneWidget);
      await tester.tap(find.byKey(const Key('send-submit')));
      await tester.pump();
      expect(calls.of('createContainer'), hasLength(1));
      hold.complete();
      await tester.pumpAndSettle();
      expect(calls.of('createContainer'), hasLength(1));
      expect(calls.of('setContainerStatus'), hasLength(1));
    });

    testWidgets('French: Envoyer, Vol, and a narrow phone', (tester) async {
      final calls = _Calls();
      await open(
        tester,
        calls,
        locale: const Locale('fr'),
        width: 430,
        packages: [
          _pkg('a', weight: 22),
          _pkg('b'),
          _pkg('s', country: 'senegal', countryName: 'Sénégal'),
        ],
      );
      expect(find.text('Envoyer les colis'), findsOneWidget);
      expect(find.text('Vers quel pays ?'), findsOneWidget);
      await tapKey(tester, 'send-country:guinea');
      expect(find.text('Envoyer 2 colis'), findsOneWidget);
      expect(find.text('Date du vol'), findsOneWidget);
      expect(find.text('10 nov. 2026'), findsOneWidget);
      expect(find.textContaining('22 lb'), findsOneWidget);
      await tapKey(tester, 'send-submit');
      expect(calls.of('createContainer').single['label'], 'Vol 11/10/2026');
      expect(tester.takeException(), isNull);
    });
  });

  group('the waiting list', () {
    Future<_Calls> openList(
      WidgetTester tester, {
      required List<ContainerLine> lines,
      bool shipsByAir = true,
    }) async {
      tester.view.physicalSize = const Size(430, 3200);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final calls = _Calls();
      await tester.pumpWidget(
        MaterialApp(
          theme: AppTheme.light,
          supportedLocales: AppLocalizations.supportedLocales,
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          home: WaitingPackagesScreen(
            businessId: 'b1',
            feed: ContainerFeed.fixed('b1', lines: lines),
            proofSettings: PackageProofSettings(shipsByAir: shipsByAir),
            caller: calls.call,
          ),
        ),
      );
      await tester.pumpAndSettle();
      return calls;
    }

    testWidgets('Send packages shows with a waiting air package', (
      tester,
    ) async {
      await openList(tester, lines: [_pkg('a')]);
      expect(find.byKey(const Key('send-packages')), findsOneWidget);
      expect(find.text('Send packages'), findsOneWidget);
    });

    testWidgets('not for sea packages, or a business that never flew', (
      tester,
    ) async {
      await openList(tester, lines: [_pkg('a', mode: 'sea')]);
      expect(find.byKey(const Key('send-packages')), findsNothing);
      await openList(tester, lines: [_pkg('a')], shipsByAir: false);
      expect(find.byKey(const Key('send-packages')), findsNothing);
      await openList(tester, lines: const []);
      expect(find.byKey(const Key('send-packages')), findsNothing);
    });

    testWidgets('sending from the list says how many left', (tester) async {
      final calls = await openList(tester, lines: [_pkg('a'), _pkg('b')]);
      await tester.tap(find.byKey(const Key('send-packages')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('send-submit')), findsOneWidget);
      await tester.tap(find.byKey(const Key('send-submit')));
      await tester.pumpAndSettle();
      expect(calls.of('createContainer'), hasLength(1));
      expect(find.text('2 packages sent'), findsOneWidget);
      expect(find.byKey(const Key('send-submit')), findsNothing);
    });
  });
}

class _Result {
  int? value;
  bool closed = false;
}
