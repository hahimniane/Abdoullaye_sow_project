import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/fleet_screen.dart';
import 'package:my_flutter_app/services/fleet.dart';
import 'package:my_flutter_app/services/fleet_service.dart';
import 'package:my_flutter_app/services/lot_ledger.dart'
    show setMoneyDisplayLanguage;

import 'fixtures/fake_fleet.dart';

/// Fleet's screens on a phone (docs/FLEET.md): the payments by period, record
/// and undo a payment, add a driver, give a plate, a refusal in words, who
/// sees what, and a French phone 320 px wide with no overflow. The server is a
/// small fake that applies the actions the tests use.

final _now = DateTime.utc(2026, 11, 10, 17); // 12 PM in New York

FleetData _data() => FleetData(
  drivers: const [
    FleetDriver(
      id: 'd1',
      name: 'Amy Bah',
      phone: '+13475550101',
      personalCents: 7,
    ),
    FleetDriver(id: 'd2', name: 'Bob Diallo', phone: '+13475550102'),
  ],
  cars: const [
    FleetCar(
      id: 'c1',
      plate: 'T123456C',
      company: 'Landa',
      registrationExpiry: '2026-12-01',
    ),
    FleetCar(id: 'c2', plate: 'T999999C', company: 'Landa'),
  ],
  assignments: const [
    FleetAssignment(
      id: 'a1',
      carId: 'c1',
      driverId: 'd1',
      startDayKey: '2026-01-01',
      rentCents: 90000,
      dueDay: 1,
    ),
  ],
  bills: const [
    FleetBill(
      id: 'b1',
      driverId: 'd1',
      kind: 'rent',
      label: 'Plate fee Nov 2026',
      dueDayKey: '2026-11-01',
      amountCents: 90000,
    ),
  ],
);

const _admin = FleetAccess(staff: true, admin: true);
const _staff = FleetAccess(staff: true, admin: false);

class _Rig {
  _Rig(this.source, this.backend, this.controller);

  final FakeFleetSource source;
  final FakeFleetBackend backend;
  final FleetController controller;
}

_Rig _rig({
  FleetAccess access = _admin,
  FleetData? data,
  Duration loadTimeout = const Duration(seconds: 25),
}) {
  final source = FakeFleetSource(
    data: data ?? _data(),
    business: {
      'fleet': {
        'enabled': true,
        'settings': {
          'lateFee': {'cents': 5000, 'dayOfMonth': 5, 'firstMonth': '2026-11'},
          'zelle': {'name': 'Landa', 'handle': 'pay@landa.test'},
        },
      },
    },
  );
  final backend = FakeFleetBackend(source);
  final controller = FleetController(
    businessId: 'biz1',
    source: source,
    service: backend.service,
    access: access,
    loadTimeout: loadTimeout,
    clock: () => _now,
  );
  return _Rig(source, backend, controller);
}

Future<void> _pump(
  WidgetTester tester,
  _Rig rig, {
  FleetAccess access = _admin,
  String language = 'en',
  double width = 390,
}) async {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = Size(width, 1600);
  addTearDown(tester.view.reset);
  setMoneyDisplayLanguage(language);
  addTearDown(() => setMoneyDisplayLanguage('en'));
  await tester.pumpWidget(
    MaterialApp(
      locale: Locale(language),
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: FleetScreen(
        businessId: 'biz1',
        access: access,
        controller: rig.controller,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Finder _field(String label) => find.byWidgetPredicate(
  (w) => w is TextField && w.decoration?.labelText == label,
);

Future<void> _tapKey(WidgetTester tester, String key) async {
  final f = find.byKey(Key(key));
  await tester.ensureVisible(f);
  await tester.pumpAndSettle();
  await tester.tap(f);
  await tester.pumpAndSettle();
}

Future<void> _openTab(WidgetTester tester, String label) async {
  final tab = find.descendant(
    of: find.byKey(const Key('fleet-tabs')),
    matching: find.text(label),
  );
  // The tab bar scrolls sideways: bring the tab on screen first.
  final width = tester.view.physicalSize.width;
  for (var i = 0; i < 3; i++) {
    final x = tester.getCenter(tab).dx;
    if (x > 24 && x < width - 24) break;
    await tester.drag(
      find.byKey(const Key('fleet-tabs')),
      Offset(x > width / 2 ? -width * 0.6 : width * 0.6, 0),
    );
    await tester.pumpAndSettle();
  }
  await tester.tap(tab);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('Payments lists each driver with what they paid and owe', (
    tester,
  ) async {
    final rig = _rig();
    await _pump(tester, rig);

    expect(find.byKey(const Key('fleet-payment-row-d1')), findsOneWidget);
    expect(find.byKey(const Key('fleet-payment-row-d2')), findsOneWidget);
    // November's bill is unpaid and late.
    expect(find.text('Owes'), findsWidgets);
    expect(find.byKey(const Key('fleet-tile-owed')), findsOneWidget);
    expect(find.text(r'$900.00'), findsWidgets);
    expect(find.byKey(const Key('fleet-period-label')), findsOneWidget);
    expect(
      tester.widget<Text>(find.byKey(const Key('fleet-period-label'))).data,
      'Nov 2026',
    );
  });

  testWidgets('the period switches to a week and steps back', (tester) async {
    final rig = _rig();
    await _pump(tester, rig);

    await tester.tap(find.text('Week'));
    await tester.pumpAndSettle();
    final label = tester
        .widget<Text>(find.byKey(const Key('fleet-period-label')))
        .data!;
    expect(label, 'Nov 9, 2026 - Nov 15, 2026');
    await tester.tap(find.byKey(const Key('fleet-period-prev')));
    await tester.pumpAndSettle();
    expect(
      tester.widget<Text>(find.byKey(const Key('fleet-period-label'))).data,
      'Nov 2, 2026 - Nov 8, 2026',
    );
    // The current period is as far forward as it goes.
    await tester.tap(find.byKey(const Key('fleet-period-next')));
    await tester.pumpAndSettle();
    expect(
      tester
          .widget<IconButton>(find.byKey(const Key('fleet-period-next')))
          .onPressed,
      isNull,
    );
  });

  testWidgets('record a payment, see it on the driver page, then undo it', (
    tester,
  ) async {
    final rig = _rig();
    await _pump(tester, rig);

    await tester.tap(find.byKey(const Key('fleet-payment-row-d1')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('fleet-driver-zelle')), findsOneWidget);

    await _tapKey(tester, 'fleet-driver-pay');
    await tester.enterText(_field(r'Amount ($)'), '900');
    await _tapKey(tester, 'fleet-payment-submit');

    final sent = rig.backend.of('payment_record').single;
    expect(sent['driverId'], 'd1');
    expect(sent['amountCents'], 90000);
    expect(sent['method'], 'zelle');
    expect(find.byKey(const Key('fleet-payment-result')), findsOneWidget);

    await _tapKey(tester, 'fleet-payment-done');
    // The payment is on the page; the bill is paid.
    expect(find.byKey(const Key('fleet-payment-undo-p-new-0')), findsOneWidget);

    await _tapKey(tester, 'fleet-payment-undo-p-new-0');
    await _tapKey(tester, 'fleet-confirm-yes');
    expect(rig.backend.of('payment_undo').single['paymentId'], 'p-new-0');
    expect(find.text('Undone'), findsOneWidget);
    expect(find.byKey(const Key('fleet-payment-undo-p-new-0')), findsNothing);
  });

  testWidgets(
    'a payment with no amount is refused on the phone, before the server',
    (tester) async {
      final rig = _rig();
      await _pump(tester, rig);
      await tester.tap(find.byKey(const Key('fleet-payment-row-d1')));
      await tester.pumpAndSettle();
      await _tapKey(tester, 'fleet-driver-pay');
      await _tapKey(tester, 'fleet-payment-submit');
      expect(find.text('Enter an amount greater than zero.'), findsOneWidget);
      expect(rig.backend.of('payment_record'), isEmpty);
    },
  );

  testWidgets('add a driver from the Drivers list', (tester) async {
    final rig = _rig();
    await _pump(tester, rig);
    await _openTab(tester, 'Drivers');

    await _tapKey(tester, 'fleet-add-driver');
    await tester.enterText(_field('Full name'), 'Cara Sow');
    await tester.enterText(_field('Phone'), '3475550103');
    await _tapKey(tester, 'fleet-sheet-submit');

    final sent = rig.backend.of('driver_save').single;
    expect((sent['driver'] as Map)['name'], 'Cara Sow');
    expect((sent['driver'] as Map).containsKey('status'), isFalse);
    expect(find.text('Cara Sow'), findsOneWidget);
  });

  testWidgets('a driver needs a name', (tester) async {
    final rig = _rig();
    await _pump(tester, rig);
    await _openTab(tester, 'Drivers');
    await _tapKey(tester, 'fleet-add-driver');
    await _tapKey(tester, 'fleet-sheet-submit');
    expect(find.text('Some details are missing or not valid.'), findsOneWidget);
    expect(rig.backend.of('driver_save'), isEmpty);
  });

  testWidgets(
    'give a free plate to a driver; a taken plate is refused in words',
    (tester) async {
      final rig = _rig();
      await _pump(tester, rig);
      await tester.tap(find.byKey(const Key('fleet-payment-row-d2')));
      await tester.pumpAndSettle();

      await _tapKey(tester, 'fleet-driver-give');
      await tester.tap(find.byKey(const Key('fleet-give-plate')));
      await tester.pumpAndSettle();
      // Only the free plate is offered.
      expect(find.textContaining('T123456C'), findsNothing);
      await tester.tap(find.textContaining('T999999C').last);
      await tester.pumpAndSettle();
      await tester.enterText(_field(r'Rent ($)'), '850');

      // The server says someone took it meanwhile.
      rig.backend.errors['assignment_start'] = fleetRefusal('fleet_car_taken');
      await _tapKey(tester, 'fleet-give-submit');
      expect(
        find.text('This plate already has a driver. Get it back first.'),
        findsOneWidget,
      );
      expect(find.byKey(const Key('fleet-sheet-error')), findsOneWidget);

      // Try again: it goes through, and the plate shows on the page.
      await _tapKey(tester, 'fleet-give-submit');
      final sent = rig.backend.of('assignment_start').last;
      expect(sent['driverId'], 'd2');
      expect(sent['carId'], 'c2');
      expect(sent['rentCents'], 85000);
      expect(sent['period'], 'monthly');
      expect(find.text('T999999C'), findsWidgets);
      expect(find.byKey(const Key('fleet-driver-return')), findsOneWidget);
    },
  );

  testWidgets('the busy button cannot be tapped twice', (tester) async {
    final rig = _rig();
    await _pump(tester, rig);
    await tester.tap(find.byKey(const Key('fleet-payment-row-d1')));
    await tester.pumpAndSettle();
    await _tapKey(tester, 'fleet-driver-pay');
    await tester.enterText(_field(r'Amount ($)'), '100');

    rig.backend.gate = Completer<void>();
    await tester.tap(find.byKey(const Key('fleet-payment-submit')));
    await tester.pump();
    final button = tester.widget<FilledButton>(
      find.byKey(const Key('fleet-payment-submit')),
    );
    expect(button.onPressed, isNull);
    rig.backend.gate!.complete();
    await tester.pumpAndSettle();
    expect(rig.backend.of('payment_record').length, 1);
  });

  testWidgets(
    'Fleet staff cannot waive, undo, give or return a plate; admins can',
    (tester) async {
      final staffRig = _rig(access: _staff);
      await _pump(tester, staffRig, access: _staff);
      await tester.tap(find.byKey(const Key('fleet-payment-row-d1')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('fleet-driver-return')), findsNothing);
      expect(find.byKey(const Key('fleet-bill-waive-b1')), findsNothing);
      // Staff can still record a payment and add a note.
      expect(find.byKey(const Key('fleet-driver-pay')), findsOneWidget);
      expect(find.byKey(const Key('fleet-note-add')), findsOneWidget);
    },
  );

  testWidgets('an admin can waive an open bill with a reason', (tester) async {
    final rig = _rig();
    await _pump(tester, rig);
    await tester.tap(find.byKey(const Key('fleet-payment-row-d1')));
    await tester.pumpAndSettle();
    await _tapKey(tester, 'fleet-bill-waive-b1');
    await _tapKey(tester, 'fleet-waive-submit');
    // A reason is required.
    expect(find.text('Say why.'), findsOneWidget);
    expect(rig.backend.of('bill_waive'), isEmpty);
    await tester.enterText(_field('Reason'), 'Car in the shop');
    await _tapKey(tester, 'fleet-waive-submit');
    final sent = rig.backend.of('bill_waive').single;
    expect(sent['billId'], 'b1');
    expect(sent['reason'], 'Car in the shop');
  });

  testWidgets(
    'the WhatsApp reminder shows only when WhatsApp is on, and sends once',
    (tester) async {
      final rig = _rig();
      await _pump(tester, rig);
      await tester.tap(find.byKey(const Key('fleet-payment-row-d1')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('fleet-driver-remind')), findsNothing);

      rig.source.setBusiness({
        'fleet': {
          'enabled': true,
          'settings': {
            'whatsapp': {'enabled': true},
          },
        },
      });
      await tester.pumpAndSettle();
      await _tapKey(tester, 'fleet-driver-remind');
      final sent = rig.backend.of('whatsapp_remind_driver').single;
      expect(sent['driverId'], 'd1');
      expect(find.text('The WhatsApp reminder was sent.'), findsOneWidget);
    },
  );

  testWidgets('a refused reminder says why in words', (tester) async {
    final rig = _rig();
    rig.source.setBusiness({
      'fleet': {
        'enabled': true,
        'settings': {
          'whatsapp': {'enabled': true},
        },
      },
    });
    await _pump(tester, rig);
    await tester.tap(find.byKey(const Key('fleet-payment-row-d1')));
    await tester.pumpAndSettle();
    rig.backend.errors['whatsapp_remind_driver'] = fleetRefusal(
      'fleet_no_phone',
    );
    await _tapKey(tester, 'fleet-driver-remind');
    expect(
      find.text('This driver has no WhatsApp number. Add one in Edit details.'),
      findsOneWidget,
    );
  });

  testWidgets('an office note is added as text; an admin can remove it', (
    tester,
  ) async {
    final rig = _rig(
      data: FleetData(
        drivers: _data().drivers,
        cars: _data().cars,
        assignments: _data().assignments,
        bills: _data().bills,
        notes: const [
          FleetNote(
            id: 'n1',
            driverId: 'd1',
            text: 'Called him',
            byName: 'Lamine',
            atMs: 1763000000000,
          ),
        ],
      ),
    );
    await _pump(tester, rig);
    await tester.tap(find.byKey(const Key('fleet-payment-row-d1')));
    await tester.pumpAndSettle();
    expect(find.text('Called him'), findsWidgets);
    await _tapKey(tester, 'fleet-note-add');
    await _tapKey(tester, 'fleet-note-submit');
    expect(find.text('Write a note.'), findsOneWidget);
    await tester.enterText(_field('Note'), 'Brought the papers');
    await _tapKey(tester, 'fleet-note-submit');
    final sent = rig.backend.of('note_add').single;
    expect(sent['driverId'], 'd1');
    expect(sent['text'], 'Brought the papers');
    expect(sent['files'], isEmpty);

    await _tapKey(tester, 'fleet-note-void-n1');
    await _tapKey(tester, 'fleet-confirm-yes');
    expect(rig.backend.of('note_void').single['noteId'], 'n1');
  });

  testWidgets('Settings shows only to a Fleet admin', (tester) async {
    final staffRig = _rig(access: _staff);
    await _pump(tester, staffRig, access: _staff);
    expect(
      find.descendant(
        of: find.byKey(const Key('fleet-tabs')),
        matching: find.text('Settings'),
      ),
      findsNothing,
    );
  });

  testWidgets('a Fleet admin saves the settings through the callable', (
    tester,
  ) async {
    final rig = _rig();
    await _pump(tester, rig);
    await _openTab(tester, 'Settings');
    // The late fee the business saved is in the form.
    expect(
      tester
          .widget<TextField>(_field('Late fee (\$, 0 for none)'))
          .controller!
          .text,
      '50',
    );
    await tester.enterText(_field('Late fee (\$, 0 for none)'), '75');
    await _tapKey(tester, 'fleet-settings-save');
    await _tapKey(tester, 'fleet-confirm-yes');
    final sent = rig.backend.of('settings_save').single;
    final settings = sent['settings'] as Map;
    expect((settings['lateFee'] as Map)['cents'], 7500);
    expect((settings['lateFee'] as Map)['firstMonth'], '2026-11');
    expect((settings['zelle'] as Map)['handle'], 'pay@landa.test');
    expect(find.byKey(const Key('fleet-settings-saved')), findsOneWidget);
  });

  testWidgets('without Fleet access the screen shows nothing of Fleet', (
    tester,
  ) async {
    final rig = _rig(access: FleetAccess.none);
    tester.view.physicalSize = const Size(390, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: FleetScreen(
          businessId: 'biz1',
          access: FleetAccess.none,
          source: rig.source,
          service: rig.backend.service,
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('fleet-no-access')), findsOneWidget);
    expect(find.byKey(const Key('fleet-tabs')), findsNothing);
    expect(find.byKey(const Key('fleet-payment-row-d1')), findsNothing);
    expect(rig.backend.calls, isEmpty);
  });

  testWidgets('loading always resolves: a failed read shows Try again', (
    tester,
  ) async {
    final rig = _rig(data: FleetData.empty);
    rig.source.failWith = StateError('permission-denied');
    await _pump(tester, rig);
    expect(find.byKey(const Key('fleet-retry')), findsOneWidget);
    expect(find.byKey(const Key('fleet-loading')), findsNothing);
    // Reading again works.
    rig.source.failWith = null;
    rig.source.set(_data());
    await tester.tap(find.byKey(const Key('fleet-retry')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('fleet-payment-row-d1')), findsOneWidget);
  });

  testWidgets('loading always resolves: a read that never answers times out', (
    tester,
  ) async {
    final source = _SilentSource();
    final controller = FleetController(
      businessId: 'biz1',
      source: source,
      access: _admin,
      loadTimeout: const Duration(milliseconds: 200),
      clock: () => _now,
    );
    tester.view.physicalSize = const Size(390, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: FleetScreen(
          businessId: 'biz1',
          access: _admin,
          controller: controller,
        ),
      ),
    );
    await tester.pump();
    expect(find.byKey(const Key('fleet-loading')), findsOneWidget);
    await tester.pump(const Duration(milliseconds: 300));
    expect(find.byKey(const Key('fleet-loading')), findsNothing);
    expect(find.byKey(const Key('fleet-retry')), findsOneWidget);
    controller.dispose();
  });

  testWidgets(
    'the Plates tab lists plates, with the paperwork list ordered by date',
    (tester) async {
      final rig = _rig();
      await _pump(tester, rig);
      await _openTab(tester, 'Plates');
      expect(find.byKey(const Key('fleet-car-row-c1')), findsOneWidget);
      expect(find.byKey(const Key('fleet-car-row-c2')), findsOneWidget);
      await tester.tap(find.text('Paperwork'));
      await tester.pumpAndSettle();
      // The plate with a date comes before the one with none.
      final first = tester
          .getTopLeft(find.byKey(const Key('fleet-car-row-c1')))
          .dy;
      final second = tester
          .getTopLeft(find.byKey(const Key('fleet-car-row-c2')))
          .dy;
      expect(first, lessThan(second));
      // The plate's page shows who had it.
      await tester.tap(find.byKey(const Key('fleet-car-row-c1')));
      await tester.pumpAndSettle();
      expect(find.text('Amy Bah'), findsWidgets);
    },
  );

  testWidgets(
    'the Bank tab lists waiting deposits and pays the driver picked',
    (tester) async {
      final rig = _rig();
      rig.backend.bankAnswer = {
        'success': true,
        'bank': {
          'connected': true,
          'institutionName': 'Chase',
          'accountMask': '4321',
        },
        'waiting': [
          {
            'id': 'cr1',
            'amountCents': 90007,
            'senderName': 'AMY BAH',
            'reason': 'unknown',
          },
        ],
      };
      await _pump(tester, rig);
      await _openTab(tester, 'Bank');
      expect(find.byKey(const Key('fleet-deposit-cr1')), findsOneWidget);
      expect(find.text(r'$900.07'), findsOneWidget);
      // Pay is off until a driver is picked.
      expect(
        tester
            .widget<FilledButton>(
              find.byKey(const Key('fleet-deposit-pay-cr1')),
            )
            .onPressed,
        isNull,
      );
      await tester.tap(find.byKey(const Key('fleet-deposit-driver-cr1')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Amy Bah').last);
      await tester.pumpAndSettle();
      await _tapKey(tester, 'fleet-deposit-pay-cr1');
      await _tapKey(tester, 'fleet-confirm-yes');
      final sent = rig.backend.of('bank_assign').single;
      expect(sent['creditId'], 'cr1');
      expect(sent['driverId'], 'd1');
    },
  );

  testWidgets('a bank refusal is shown in words', (tester) async {
    final rig = _rig();
    rig.backend.bankAnswer = {
      'success': true,
      'bank': {'connected': true, 'institutionName': 'Chase'},
    };
    await _pump(tester, rig);
    await _openTab(tester, 'Bank');
    rig.backend.errors['bank_check_now'] = fleetRefusal('fleet_no_bank');
    await _tapKey(tester, 'fleet-bank-check');
    expect(
      find.text(
        'Connect the business’s bank first (Profile, Bank for Zelle checks).',
      ),
      findsOneWidget,
    );
  });

  testWidgets('French on a 320 px phone: every screen fits', (tester) async {
    final rig = _rig();
    await _pump(tester, rig, language: 'fr', width: 320);
    rig.backend.bankAnswer = {
      'success': true,
      'bank': {
        'connected': true,
        'institutionName': 'Chase',
        'accountMask': '4321',
      },
      'waiting': [
        {
          'id': 'cr1',
          'amountCents': 90007,
          'senderName': 'AMY BAH',
          'reason': 'two_drivers',
        },
      ],
      'removed': [
        {'paymentId': 'p9', 'driverId': 'd1', 'amountCents': 5000},
      ],
    };
    expect(find.text('Paiements'), findsWidgets);
    expect(tester.takeException(), isNull);

    // Payments: the period switcher in French.
    await tester.tap(find.text('Semaine'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);

    // Every tab.
    for (final tab in ['Chauffeurs', 'Plaques', 'Banque', 'Réglages']) {
      await _openTab(tester, tab);
      expect(tester.takeException(), isNull, reason: tab);
    }

    // A driver's page, and each sheet on it.
    await _openTab(tester, 'Paiements');
    await tester.tap(find.byKey(const Key('fleet-payment-row-d1')));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    for (final key in [
      'fleet-driver-pay',
      'fleet-driver-charge',
      'fleet-driver-edit',
      'fleet-note-add',
      'fleet-friend-add',
    ]) {
      await _tapKey(tester, key);
      expect(tester.takeException(), isNull, reason: key);
      await tester.tap(find.text('Annuler').last);
      await tester.pumpAndSettle();
    }
    await _tapKey(tester, 'fleet-bill-waive-b1');
    expect(tester.takeException(), isNull);
    await tester.tap(find.text('Annuler').last);
    await tester.pumpAndSettle();
    await _tapKey(tester, 'fleet-driver-return');
    expect(tester.takeException(), isNull);
    await tester.tap(find.text('Annuler').last);
    await tester.pumpAndSettle();

    // The plate's page.
    await _tapKey(tester, 'fleet-driver-open-car');
    expect(tester.takeException(), isNull);
    await _tapKey(tester, 'fleet-car-edit');
    expect(tester.takeException(), isNull);
  });

  test(
    'the home carries one Fleet row, gated by the service and the permission',
    () {
      final src = File('lib/screens/home_menu.dart').readAsStringSync();
      expect("Key('open-fleet')".allMatches(src).length, 1);
      expect(src, contains('showsFleetRow('));
      expect(src, contains('BusinessPermission.fleet'));
      expect(src, contains('auth.effectiveBusinessServices'));
    },
  );
}

class _SilentSource implements FleetSource {
  @override
  Stream<FleetData> watch(String businessId) => const Stream.empty();

  @override
  Stream<Map<String, dynamic>> watchBusiness(String businessId) =>
      const Stream.empty();
}
