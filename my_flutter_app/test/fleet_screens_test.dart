import 'dart:async';
import 'dart:io';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/fleet_screen.dart';
import 'package:my_flutter_app/services/fleet.dart';
import 'package:my_flutter_app/services/fleet_service.dart';
import 'package:my_flutter_app/services/fleet_tabs.dart';
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
    FleetDriver(id: 'd1', name: 'Amy Bah', phone: '+13475550101'),
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
  List<FleetClaim> claims = const [],
  Duration loadTimeout = const Duration(seconds: 25),
}) {
  final source = FakeFleetSource(
    claims: claims,
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
  // These tests were written for the old first tab, Payments.
  FleetTab initialTab = FleetTab.payments,
}) async {
  tester.view.devicePixelRatio = 1;
  // Tall, so the driver page (a lazy list) builds every card.
  tester.view.physicalSize = Size(width, 3600);
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
        initialTab: initialTab,
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

/// Opens a claim's photo. The picture itself is a network image that never
/// loads in a test, so this pumps a few frames instead of settling.
Future<void> _openPhoto(WidgetTester tester, String claimId) async {
  final f = find.byKey(Key('fleet-claim-photo-$claimId'));
  await tester.ensureVisible(f);
  await tester.pumpAndSettle();
  await tester.tap(f);
  for (var i = 0; i < 5; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

/// Opens a tab by its label. The Bank is not a tab: it is a section of
/// Payments, so 'Bank' opens Payments and then the Bank section.
Future<void> _openTab(WidgetTester tester, String label) async {
  const sections = {'Bank', 'Banque', 'Payments', 'Paiements'};
  if (sections.contains(label)) {
    // Payments and Bank are the two sections of the Payments tab.
    await _openTabOnly(
      tester,
      label == 'Banque'
          ? 'Paiements'
          : label == 'Bank'
          ? 'Payments'
          : label,
    );
    await tester.tap(
      find.descendant(
        of: find.byKey(const Key('fleet-pay-section')),
        matching: find.text(label),
      ),
    );
    await tester.pumpAndSettle();
    return;
  }
  await _openTabOnly(tester, label);
}

Future<void> _openTabOnly(WidgetTester tester, String label) async {
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
    // No Zelle cents anywhere: the page has the names this driver pays from.
    expect(find.byKey(const Key('fleet-payer-names')), findsOneWidget);

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
      expect(find.text('Enter an amount.'), findsOneWidget);
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
    expect(find.text('Write a note or attach a file.'), findsOneWidget);
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

  testWidgets('the Settings gear shows only to a Fleet admin', (tester) async {
    final staffRig = _rig(access: _staff);
    await _pump(tester, staffRig, access: _staff);
    expect(find.byKey(const Key('fleet-settings-gear')), findsNothing);
    // Settings is not a tab any more.
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
    await _tapKey(tester, 'fleet-settings-gear');
    expect(find.text('Fleet settings'), findsWidgets);
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
      // Plates and Paperwork are two tabs now, not one switch.
      expect(find.byKey(const Key('fleet-cars-mode')), findsNothing);
      await _openTab(tester, 'Paperwork');
      // Paperwork lists the plates with a driver; "Every plate" adds the rest.
      expect(find.byKey(const Key('fleet-car-row-c1')), findsOneWidget);
      expect(find.byKey(const Key('fleet-car-row-c2')), findsNothing);
      expect(find.text('Plates with a driver (1)'), findsOneWidget);
      await tester.tap(find.text('Every plate (2)'));
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
        "Connect the business's bank first (Profile, Bank for Zelle checks).",
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
          'reason': 'shared_payer',
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
    for (final tab in [
      'À traiter',
      'Chauffeurs',
      'Plaques',
      'Banque',
      'Papiers',
    ]) {
      await _openTab(tester, tab);
      expect(tester.takeException(), isNull, reason: tab);
    }
    // Settings behind the gear, in French.
    await _tapKey(tester, 'fleet-settings-gear');
    expect(find.text('Réglages de la flotte'), findsWidgets);
    expect(tester.takeException(), isNull);
    tester.state<NavigatorState>(find.byType(Navigator)).pop();
    await tester.pumpAndSettle();

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

  // -------------------------------------------------------------------------
  // Payment claims, payer names, plate fee, "Driver has left", month by bill.
  // -------------------------------------------------------------------------

  final claimAt = DateTime.utc(2026, 11, 10, 17).millisecondsSinceEpoch;
  List<FleetClaim> claims() => [
    readFleetClaim('c1', {
      'driverId': 'd1',
      'fromPhone': '+13475550101',
      'state': 'waiting_bank',
      'amountCents': 40000,
      'mediaPath': 'support_cases/x/whatsapp/a.jpg',
      'createdAtMs': claimAt,
    })!,
    readFleetClaim('c2', {
      'fromPhone': '+13475550199',
      'state': 'office',
      'reason': 'not_a_driver',
      'createdAtMs': claimAt + 60000,
    })!,
  ];
  const bankAnswer = {
    'success': true,
    'bank': {
      'connected': true,
      'institutionName': 'Chase',
      'accountMask': '4321',
    },
    'waiting': [
      {
        'id': 'cr1',
        'amountCents': 40000,
        'senderName': 'AMY BAH',
        'atMs': 1762790000000,
        'reason': 'unknown',
      },
      {
        'id': 'cr2',
        'amountCents': 30000,
        'senderName': '',
        'atMs': 1762700000000,
        'reason': 'unknown',
      },
    ],
  };

  testWidgets('claims: the card lists each open claim with its words', (
    tester,
  ) async {
    final rig = _rig(claims: claims());
    rig.backend.bankAnswer = bankAnswer;
    await _pump(tester, rig);
    await _openTab(tester, 'Bank');
    expect(find.text('Reported by drivers, waiting for the bank'), findsOne);
    expect(find.byKey(const Key('fleet-claim-c1')), findsOneWidget);
    expect(find.byKey(const Key('fleet-claim-c2')), findsOneWidget);
    expect(find.text(r'$400.00'), findsWidgets);
    expect(
      find.text('Waiting for the deposit to show in the bank.'),
      findsOneWidget,
    );
    expect(
      find.text(
        'This phone is not one of your drivers. Find out who the payment is for.',
      ),
      findsOneWidget,
    );
    // The phone stands in for a driver we do not know; the amount is a dash.
    expect(find.text('+13475550199'), findsOneWidget);
    expect(find.text('—'), findsOneWidget);
    // Oldest first.
    expect(
      tester.getTopLeft(find.byKey(const Key('fleet-claim-c1'))).dy,
      lessThan(tester.getTopLeft(find.byKey(const Key('fleet-claim-c2'))).dy),
    );
    // No photo on c2.
    expect(find.byKey(const Key('fleet-claim-photo-c1')), findsOneWidget);
    expect(find.byKey(const Key('fleet-claim-photo-c2')), findsNothing);
    expect(find.text('No photo'), findsOneWidget);
    // Every action is at least 48 high.
    for (final key in [
      'fleet-claim-photo-c1',
      'fleet-claim-theirs-c1',
      'fleet-claim-close-c1',
      'fleet-claim-theirs-c2',
    ]) {
      expect(
        tester.getSize(find.byKey(Key(key))).height,
        greaterThanOrEqualTo(48),
        reason: key,
      );
    }
  });

  testWidgets('claims: View photo asks the server and opens the picture', (
    tester,
  ) async {
    final rig = _rig(claims: claims());
    rig.backend.bankAnswer = bankAnswer;
    await _pump(tester, rig);
    await _openTab(tester, 'Bank');
    await _openPhoto(tester, 'c1');
    expect(rig.backend.of('claim_photo').single['claimId'], 'c1');
    expect(find.byKey(const Key('fleet-claim-photo-image')), findsOneWidget);
    await tester.tap(find.byKey(const Key('fleet-claim-photo-close')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('fleet-claim-photo-image')), findsNothing);

    // A photo that was deleted says so.
    rig.backend.photoUrl = null;
    await _openPhoto(tester, 'c1');
    expect(
      find.text('This photo was deleted after 12 months.'),
      findsOneWidget,
    );
    // No url and not deleted: just "No photo".
    rig.backend.photoDeleted = false;
    await _openPhoto(tester, 'c1');
    expect(find.text('No photo'), findsWidgets);
    expect(find.text('This photo was deleted after 12 months.'), findsNothing);
    expect(find.byKey(const Key('fleet-claim-photo-image')), findsNothing);
  });

  testWidgets('claims: This deposit is theirs gives a waiting deposit', (
    tester,
  ) async {
    final rig = _rig(claims: claims());
    rig.backend.bankAnswer = bankAnswer;
    await _pump(tester, rig);
    await _openTab(tester, 'Bank');
    await _tapKey(tester, 'fleet-claim-theirs-c1');
    // The same amount comes first; a different one is marked in words.
    final first = tester.getTopLeft(
      find.byKey(const Key('fleet-claim-offer-cr1')),
    );
    final second = tester.getTopLeft(
      find.byKey(const Key('fleet-claim-offer-cr2')),
    );
    expect(first.dy, lessThan(second.dy));
    expect(find.textContaining('Same amount'), findsOneWidget);
    // Nothing picked yet: told in words, nothing sent.
    await _tapKey(tester, 'fleet-sheet-submit');
    expect(find.text('Pick the deposit that is theirs.'), findsOneWidget);
    expect(rig.backend.of('claim_assign'), isEmpty);

    await tester.tap(find.byKey(const Key('fleet-claim-offer-cr2')));
    await tester.pumpAndSettle();
    expect(
      find.text(
        'This deposit is for a different amount. The bank’s amount is what is recorded.',
      ),
      findsOneWidget,
    );
    await tester.tap(find.byKey(const Key('fleet-claim-offer-cr1')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('fleet-claim-different')), findsNothing);
    await _tapKey(tester, 'fleet-sheet-submit');
    expect(find.textContaining('from AMY BAH to Amy Bah'), findsOneWidget);
    await _tapKey(tester, 'fleet-confirm-yes');
    final sent = rig.backend.of('claim_assign').single;
    expect(sent['claimId'], 'c1');
    expect(sent['creditId'], 'cr1');
    // The claim left the open list; the bank is read again.
    expect(find.byKey(const Key('fleet-claim-c1')), findsNothing);
    expect(find.text('Payment recorded'), findsOneWidget);
    expect(rig.backend.of('bank_status').length, 2);
  });

  testWidgets('claims: a refused deposit says why, in words', (tester) async {
    final rig = _rig(claims: claims());
    rig.backend.bankAnswer = bankAnswer;
    await _pump(tester, rig);
    await _openTab(tester, 'Bank');
    await _tapKey(tester, 'fleet-claim-theirs-c1');
    await tester.tap(find.byKey(const Key('fleet-claim-offer-cr1')));
    await tester.pumpAndSettle();
    rig.backend.errors['claim_assign'] = fleetRefusal(
      'fleet_deposit_not_waiting',
    );
    await _tapKey(tester, 'fleet-sheet-submit');
    await _tapKey(tester, 'fleet-confirm-yes');
    expect(
      find.text('That deposit is no longer waiting. Refresh and try again.'),
      findsOneWidget,
    );
    // The sheet is still open and not stuck busy.
    expect(find.byKey(const Key('fleet-claim-offer-cr1')), findsOneWidget);
  });

  testWidgets('claims: Close asks first, then closes the report', (
    tester,
  ) async {
    final rig = _rig(claims: claims());
    rig.backend.bankAnswer = bankAnswer;
    await _pump(tester, rig);
    await _openTab(tester, 'Bank');
    await _tapKey(tester, 'fleet-claim-close-c1');
    expect(
      find.text(
        'Close this report from Amy Bah? The bill stays unpaid and nothing is recorded.',
      ),
      findsOneWidget,
    );
    await _tapKey(tester, 'fleet-confirm-yes');
    expect(rig.backend.of('claim_close').single['claimId'], 'c1');
    expect(find.text('Report closed.'), findsOneWidget);
    expect(find.byKey(const Key('fleet-claim-c1')), findsNothing);
  });

  testWidgets('claims: a failed claims read never blanks the rest of Fleet', (
    tester,
  ) async {
    final rig = _rig(claims: claims());
    rig.source.claimsFailWith = StateError('denied');
    rig.backend.bankAnswer = bankAnswer;
    await _pump(tester, rig);
    // Payments is untouched.
    expect(find.byKey(const Key('fleet-payment-row-d1')), findsOneWidget);
    expect(find.byKey(const Key('fleet-retry')), findsNothing);
    await _openTab(tester, 'Bank');
    expect(
      find.text(
        'The reported payments could not be loaded. Try again in a moment.',
      ),
      findsOneWidget,
    );
    // The bank's own deposits still show.
    expect(find.byKey(const Key('fleet-deposit-cr1')), findsOneWidget);
    // Try again reads them.
    rig.source.claimsFailWith = null;
    await _tapKey(tester, 'fleet-claims-retry');
    expect(find.byKey(const Key('fleet-claim-c1')), findsOneWidget);
  });

  testWidgets('claims: a read that never answers still resolves', (
    tester,
  ) async {
    final controller = FleetController(
      businessId: 'biz1',
      source: _SilentSource(),
      loadTimeout: const Duration(seconds: 3),
      clock: () => _now,
    )..start();
    expect(controller.claimsLoading, isTrue);
    await tester.pump(const Duration(seconds: 4));
    expect(controller.claimsLoading, isFalse);
    expect(controller.claimsError, isTrue);
    controller.dispose();
  });

  testWidgets('payer names: list, add, remove, and a refused name', (
    tester,
  ) async {
    final data = _data();
    final rig = _rig(
      data: FleetData(
        drivers: [
          const FleetDriver(
            id: 'd1',
            name: 'Amy Bah #12',
            phone: '+13475550101',
            payerNames: ['AWA BAH'],
          ),
          data.drivers[1],
        ],
        cars: data.cars,
        assignments: data.assignments,
        bills: data.bills,
      ),
    );
    await _pump(tester, rig);
    await tester.tap(find.byKey(const Key('fleet-payment-row-d1')));
    await tester.pumpAndSettle();
    expect(find.text('Names this driver pays from'), findsOneWidget);
    expect(
      find.text('A Zelle from one of these names pays this driver by itself.'),
      findsOneWidget,
    );
    expect(find.byKey(const Key('fleet-payer-name-AWA BAH')), findsOneWidget);
    expect(find.byKey(const Key('fleet-payer-hint')), findsOneWidget);
    expect(
      find.text('Type the full name as the bank shows it, at least two words.'),
      findsOneWidget,
    );

    // Nothing typed, then a duplicate: told in words, nothing sent.
    await _tapKey(tester, 'fleet-payer-add');
    expect(find.text('Type a name first.'), findsOneWidget);
    await tester.enterText(_field('Name on the Zelle account'), 'awa  bah');
    await _tapKey(tester, 'fleet-payer-add');
    expect(find.text('That name is already on the list.'), findsOneWidget);
    expect(rig.backend.of('payer_names_save'), isEmpty);

    await tester.enterText(_field('Name on the Zelle account'), 'Moussa  Bah');
    await _tapKey(tester, 'fleet-payer-add');
    expect(rig.backend.of('payer_names_save').single['names'], [
      'AWA BAH',
      'Moussa Bah',
    ]);
    expect(
      find.byKey(const Key('fleet-payer-name-Moussa Bah')),
      findsOneWidget,
    );

    // The server refuses what is not a person's name.
    rig.backend.errors['payer_names_save'] = FirebaseFunctionsException(
      message: 'refused',
      code: 'invalid-argument',
      details: {'reason': 'fleet_bad_name', 'name': 'Zelle'},
    );
    await tester.enterText(_field('Name on the Zelle account'), 'Zelle');
    await _tapKey(tester, 'fleet-payer-add');
    expect(
      find.text(
        '"Zelle" cannot be used. Type the person\'s full name as the bank shows it.',
      ),
      findsOneWidget,
    );

    // Removing asks first, and addresses the driver by display name.
    await _tapKey(tester, 'fleet-payer-remove-AWA BAH');
    expect(
      find.text(
        'Stop paying Amy Bah automatically from AWA BAH? Deposits from this name will wait for the office again.',
      ),
      findsOneWidget,
    );
    await _tapKey(tester, 'fleet-confirm-yes');
    expect(rig.backend.of('payer_names_save').last['names'], ['Moussa Bah']);
    expect(find.byKey(const Key('fleet-payer-name-AWA BAH')), findsNothing);
    expect(
      tester
          .getSize(find.byKey(const Key('fleet-payer-remove-Moussa Bah')))
          .height,
      greaterThanOrEqualTo(48),
    );
  });

  testWidgets('plate fee: change it, then see when it applies', (tester) async {
    final rig = _rig();
    await _pump(tester, rig);
    await tester.tap(find.byKey(const Key('fleet-payment-row-d1')));
    await tester.pumpAndSettle();
    await _tapKey(tester, 'fleet-driver-fee');
    expect(find.text('Change plate fee'), findsWidgets);
    // Nothing changed is refused before the server.
    await _tapKey(tester, 'fleet-sheet-submit');
    expect(find.text('Nothing was changed.'), findsOneWidget);
    expect(rig.backend.of('assignment_update'), isEmpty);
    await tester.enterText(_field(r'New plate fee a month ($)'), '1,000');
    // The due day is a list (1-28), not a typed box.
    await tester.tap(find.byKey(const Key('fleet-fee-dueday')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('10').last);
    await tester.pumpAndSettle();
    await _tapKey(tester, 'fleet-sheet-submit');
    expect(
      find.textContaining(
        'Change Amy Bah’s plate fee for T123456C to \$1,000.00, due day 10?',
      ),
      findsOneWidget,
    );
    await _tapKey(tester, 'fleet-confirm-yes');
    final sent = rig.backend.of('assignment_update').single;
    expect(sent['assignmentId'], 'a1');
    expect(sent['rentCents'], 100000);
    expect(sent['dueDay'], 10);
    expect(
      find.text(
        'Applies from Dec 1, 2026. Bills already made are not changed.',
      ),
      findsOneWidget,
    );
    await _tapKey(tester, 'fleet-fee-done');
    expect(find.byKey(const Key('fleet-fee-applies')), findsNothing);
  });

  testWidgets(
    'plate fee: a Fleet staff member who is not admin has no button',
    (tester) async {
      final rig = _rig(access: _staff);
      await _pump(tester, rig, access: _staff);
      await tester.tap(find.byKey(const Key('fleet-payment-row-d1')));
      await tester.pumpAndSettle();
      expect(find.byKey(const Key('fleet-driver-fee')), findsNothing);
      expect(find.byKey(const Key('fleet-driver-left')), findsNothing);
      expect(find.byKey(const Key('fleet-payer-names')), findsOneWidget);
    },
  );

  testWidgets('Driver has left: confirms, sends the day, and is then hidden', (
    tester,
  ) async {
    final rig = _rig();
    await _pump(tester, rig);
    await tester.tap(find.byKey(const Key('fleet-payment-row-d1')));
    await tester.pumpAndSettle();
    await _tapKey(tester, 'fleet-driver-left');
    expect(
      find.text('The plate comes back on this date and bills stop.'),
      findsOneWidget,
    );
    await _tapKey(tester, 'fleet-sheet-submit');
    expect(
      find.text(
        'Mark Amy Bah as having left on Nov 10, 2026? Plate T123456C comes back on that date and bills stop.',
      ),
      findsOneWidget,
    );
    await _tapKey(tester, 'fleet-confirm-yes');
    final sent = rig.backend.of('driver_leave').single;
    expect(sent['driverId'], 'd1');
    expect(sent['endDayKey'], '2026-11-10');
    expect(find.byKey(const Key('fleet-left-result')), findsOneWidget);
    await _tapKey(tester, 'fleet-left-done');
    // Left: the button is gone and the plate card says there is no plate.
    expect(find.byKey(const Key('fleet-driver-left')), findsNothing);
    expect(find.text('No plate right now.'), findsOneWidget);
  });

  testWidgets('Driver has left: a refusal says the driver still has a plate', (
    tester,
  ) async {
    final rig = _rig();
    await _pump(tester, rig);
    await tester.tap(find.byKey(const Key('fleet-payment-row-d1')));
    await tester.pumpAndSettle();
    // Marking left in the edit sheet: the server refuses while a plate is held.
    await _tapKey(tester, 'fleet-driver-edit');
    rig.backend.errors['driver_save'] = fleetRefusal('fleet_driver_has_plate');
    await tester.tap(find.text('Left').last);
    await tester.pumpAndSettle();
    await _tapKey(tester, 'fleet-sheet-submit');
    expect(
      find.text(
        'This driver still has a plate. Get it back first, or ask a Fleet admin to use Driver has left.',
      ),
      findsOneWidget,
    );
    // The same refusal when Driver has left itself is refused.
    await tester.tap(find.text('Cancel').last);
    await tester.pumpAndSettle();
    await _tapKey(tester, 'fleet-driver-left');
    rig.backend.errors['driver_leave'] = fleetRefusal('fleet_admin_only');
    await _tapKey(tester, 'fleet-sheet-submit');
    await _tapKey(tester, 'fleet-confirm-yes');
    expect(find.text('Only a Fleet admin can do this.'), findsOneWidget);
  });

  testWidgets('Payments: the plate fees line, and + fee owed counts as Owes', (
    tester,
  ) async {
    final data = _data();
    final rig = _rig(
      data: FleetData(
        drivers: data.drivers,
        cars: data.cars,
        assignments: data.assignments,
        bills: const [
          FleetBill(
            id: 'b1',
            driverId: 'd1',
            kind: 'rent',
            dueDayKey: '2026-11-01',
            amountCents: 90000,
            paidCents: 90000,
            status: 'paid',
          ),
          FleetBill(
            id: 'f1',
            driverId: 'd1',
            kind: 'late_fee',
            dueDayKey: '2026-11-05',
            amountCents: 5000,
          ),
          FleetBill(
            id: 'b2',
            driverId: 'd2',
            kind: 'rent',
            dueDayKey: '2026-11-01',
            amountCents: 90000,
            paidCents: 30000,
          ),
        ],
        payments: const [
          FleetPayment(
            id: 'p1',
            driverId: 'd1',
            amountCents: 500000,
            paidDayKey: '2026-11-02',
          ),
        ],
      ),
    );
    await _pump(tester, rig);
    // $1,200 paid on $1,800 of plate fees: 67%, not collected over billed.
    expect(
      find.text(
        '67% of this month’s plate fees paid (\$1,200.00 of \$1,800.00)',
      ),
      findsOneWidget,
    );
    expect(find.byKey(const Key('fleet-fee-owed-d1')), findsOneWidget);
    expect(find.byKey(const Key('fleet-fee-owed-d2')), findsNothing);
    // d1's month reads from its rent bill (paid), the fee is only marked.
    expect(
      find.descendant(
        of: find.byKey(const Key('fleet-payment-row-d1')),
        matching: find.text('Paid in full'),
      ),
      findsOneWidget,
    );
    // d1 (fee owed) counts as Owes, d2 is Part paid; nobody is Paid in full.
    expect(find.text('Owes (1)'), findsOneWidget);
    expect(find.text('Part paid (1)'), findsOneWidget);
    expect(find.textContaining('Paid in full ('), findsNothing);
    await tester.tap(find.text('Owes (1)'));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('fleet-payment-row-d1')), findsOneWidget);
    expect(find.byKey(const Key('fleet-payment-row-d2')), findsNothing);
  });

  testWidgets(
    'Driver page: a bill made by mistake is on no list and in no count',
    (tester) async {
      final data = _data();
      final rig = _rig(
        data: FleetData(
          drivers: data.drivers,
          cars: data.cars,
          assignments: data.assignments,
          bills: const [
            FleetBill(
              id: 'b1',
              driverId: 'd1',
              kind: 'rent',
              label: 'Plate fee Nov 2026',
              dueDayKey: '2026-11-01',
              amountCents: 90000,
            ),
            FleetBill(
              id: 'bm',
              driverId: 'd1',
              kind: 'rent',
              label: 'Billed by mistake',
              dueDayKey: '2026-10-01',
              amountCents: 90000,
              status: 'void',
              voidReason: 'billed_by_mistake',
            ),
            FleetBill(
              id: 'bw',
              driverId: 'd1',
              kind: 'rent',
              label: 'Rent gone',
              dueDayKey: '2026-09-01',
              amountCents: 90000,
              status: 'void',
              voidReason: 'rent_bill_gone',
            ),
          ],
        ),
      );
      await _pump(tester, rig);
      await tester.tap(find.byKey(const Key('fleet-payment-row-d1')));
      await tester.pumpAndSettle();
      expect(find.text('All (2)'), findsOneWidget);
      expect(find.text('Waived (1)'), findsOneWidget);
      expect(find.text('Open (1)'), findsOneWidget);
      await tester.tap(find.text('All (2)'));
      await tester.pumpAndSettle();
      expect(find.text('Billed by mistake'), findsNothing);
      expect(find.text('Rent gone'), findsOneWidget);
    },
  );

  testWidgets('Drivers: no sort by Zelle cents', (tester) async {
    final rig = _rig();
    await _pump(tester, rig);
    await _openTab(tester, 'Drivers');
    await tester.tap(find.byKey(const Key('fleet-drivers-sort')));
    await tester.pumpAndSettle();
    expect(find.textContaining('cents'), findsNothing);
    expect(find.text('Most owed first'), findsWidgets);
  });

  testWidgets('French on a 320 px phone: the new sections fit', (tester) async {
    final rig = _rig(claims: claims());
    rig.backend.bankAnswer = bankAnswer;
    await _pump(tester, rig, language: 'fr', width: 320);
    // Payments: the plate fees line and the fee marker.
    expect(tester.takeException(), isNull);
    // Bank: the claims card, then its deposit sheet and the photo.
    await _openTab(tester, 'Banque');
    expect(
      find.text('Signalés par les chauffeurs, en attente de la banque'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
    await _openPhoto(tester, 'c1');
    expect(tester.takeException(), isNull);
    await tester.tap(find.byKey(const Key('fleet-claim-photo-close')));
    await tester.pumpAndSettle();
    await _tapKey(tester, 'fleet-claim-theirs-c1');
    await tester.tap(find.byKey(const Key('fleet-claim-offer-cr2')));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    await _tapKey(tester, 'fleet-sheet-submit');
    expect(find.textContaining('Donner ce dépôt de'), findsOneWidget);
    expect(tester.takeException(), isNull);
    // Cancel the question, then the sheet.
    await tester.tap(find.text('Annuler').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Annuler').last);
    await tester.pumpAndSettle();
    await _tapKey(tester, 'fleet-claim-close-c1');
    expect(tester.takeException(), isNull);
    await tester.tap(find.text('Annuler').last);
    await tester.pumpAndSettle();

    // The driver page: names, plate fee, Driver has left.
    await _openTab(tester, 'Paiements');
    await tester.tap(find.byKey(const Key('fleet-payment-row-d1')));
    await tester.pumpAndSettle();
    expect(find.text('Noms depuis lesquels ce chauffeur paie'), findsOneWidget);
    expect(tester.takeException(), isNull);
    rig.backend.errors['payer_names_save'] = fleetRefusal(
      'fleet_bad_name',
      code: 'invalid-argument',
    );
    await tester.enterText(_field('Nom sur le compte Zelle'), 'Zelle');
    await _tapKey(tester, 'fleet-payer-add');
    expect(
      find.textContaining('Ce nom ne peut pas être utilisé'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
    await _tapKey(tester, 'fleet-driver-fee');
    expect(tester.takeException(), isNull);
    await tester.enterText(
      _field(r'Nouveaux frais de plaque par mois ($)'),
      '1000',
    );
    await _tapKey(tester, 'fleet-sheet-submit');
    expect(tester.takeException(), isNull);
    await _tapKey(tester, 'fleet-confirm-yes');
    expect(find.textContaining('S’applique à partir du'), findsWidgets);
    expect(tester.takeException(), isNull);
    await _tapKey(tester, 'fleet-fee-done');
    await _tapKey(tester, 'fleet-driver-left');
    expect(tester.takeException(), isNull);
    await _tapKey(tester, 'fleet-sheet-submit');
    expect(
      find.textContaining('Marquer Amy Bah comme parti le'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
    await _tapKey(tester, 'fleet-confirm-yes');
    expect(
      find.text(
        'Le chauffeur est marqué comme parti. Sa plaque est revenue et sa facturation s’est arrêtée.',
      ),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('French on a 320 px phone: a month with a fee owed fits', (
    tester,
  ) async {
    final data = _data();
    final rig = _rig(
      data: FleetData(
        drivers: data.drivers,
        cars: data.cars,
        assignments: data.assignments,
        bills: const [
          FleetBill(
            id: 'b1',
            driverId: 'd1',
            kind: 'rent',
            dueDayKey: '2026-11-01',
            amountCents: 90000,
            paidCents: 90000,
            status: 'paid',
          ),
          FleetBill(
            id: 'f1',
            driverId: 'd1',
            kind: 'late_fee',
            dueDayKey: '2026-11-05',
            amountCents: 5000,
          ),
        ],
      ),
    );
    await _pump(tester, rig, language: 'fr', width: 320);
    expect(find.text('+ frais dus'), findsOneWidget);
    expect(
      find.textContaining('des frais de plaque de ce mois payés'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
    // Paperwork in French: the two scope chips.
    await _openTab(tester, 'Papiers');
    expect(find.text('Plaques avec un chauffeur (1)'), findsOneWidget);
    expect(find.text('Toutes les plaques (2)'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Fleet admin actions: hidden for staff, refused in words', (
    tester,
  ) async {
    // (Hidden for staff: see the plate fee test above.)
    // An admin whose rights were taken away meanwhile is refused in words.
    final rig = _rig();
    await _pump(tester, rig);
    await tester.tap(find.byKey(const Key('fleet-payment-row-d1')));
    await tester.pumpAndSettle();
    rig.backend.errors['driver_leave'] = fleetRefusal('fleet_admin_only');
    await _tapKey(tester, 'fleet-driver-left');
    await _tapKey(tester, 'fleet-sheet-submit');
    await _tapKey(tester, 'fleet-confirm-yes');
    expect(find.text('Only a Fleet admin can do this.'), findsOneWidget);
  });

  testWidgets('claims: the new reasons read in words, French fits 320 px', (
    tester,
  ) async {
    final rig = _rig(
      claims: [
        for (final r in ['no_amount', 'no_deposit', 'payment_undone'])
          readFleetClaim('x-$r', {
            'driverId': 'd1',
            'state': 'office',
            'reason': r,
            'createdAtMs': claimAt,
          })!,
      ],
    );
    rig.backend.bankAnswer = {
      ...bankAnswer,
      'waiting': [
        {'id': 'u1', 'amountCents': 100, 'reason': 'undone'},
      ],
    };
    await _pump(tester, rig, language: 'fr', width: 320);
    await _openTab(tester, 'Banque');
    expect(
      find.text(
        'Le chauffeur n’a pas donné de montant lisible. Regardez la photo.',
      ),
      findsOneWidget,
    );
    expect(
      find.text('Aucun dépôt n’est apparu en banque après 2 jours.'),
      findsOneWidget,
    );
    expect(
      find.textContaining(
        'Le paiement fait à partir de ce signalement a été annulé.',
      ),
      findsOneWidget,
    );
    expect(
      find.textContaining('Le paiement de ce dépôt a été annulé.'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
    // A long refusal in French inside a sheet does not overflow either.
    await _openTab(tester, 'Paiements');
    await tester.tap(find.byKey(const Key('fleet-payment-row-d1')));
    await tester.pumpAndSettle();
    rig.backend.errors['driver_leave'] = fleetRefusal('fleet_driver_has_plate');
    await _tapKey(tester, 'fleet-driver-left');
    await _tapKey(tester, 'fleet-sheet-submit');
    await _tapKey(tester, 'fleet-confirm-yes');
    expect(
      find.textContaining('demandez à un administrateur de la flotte'),
      findsOneWidget,
    );
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

  @override
  Stream<List<FleetClaim>> watchClaims(String businessId) =>
      const Stream.empty();
}
