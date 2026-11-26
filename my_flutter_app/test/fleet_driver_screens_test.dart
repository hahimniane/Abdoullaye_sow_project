import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/fleet_driver_shell.dart';
import 'package:my_flutter_app/services/fleet.dart' show fleetMoney;
import 'package:my_flutter_app/services/fleet_driver_app.dart';
import 'package:my_flutter_app/services/fleet_driver_service.dart';
import 'package:my_flutter_app/services/fleet_requests.dart' show FleetFailure;
import 'package:my_flutter_app/services/lot_ledger.dart'
    show setMoneyDisplayLanguage;
import 'package:my_flutter_app/widgets/app_back_button.dart';

import 'fixtures/fake_fleet_driver.dart';

/// The driver's side of Fleet on a phone (docs/FLEET.md section 11): a driver
/// whose business shows its drivers Fleet alone lands on their own account
/// (what they owe, how to pay, payments, the plate); everyone else keeps the
/// regular home; English and French; a 320 px phone with no overflow.
/// Made-up data only.

class _Rig {
  _Rig(this.service, this.cache, this.controller);

  final FakeFleetDriverService service;
  final MemoryDriverHomeCache cache;
  final FleetDriverController controller;
  final List<Uri> opened = [];
  bool linkOpens = true;

  Future<bool> open(Uri uri) async {
    opened.add(uri);
    return linkOpens;
  }
}

_Rig _rig(Object answer, {Map<String, dynamic>? kept}) {
  final cache = MemoryDriverHomeCache();
  if (kept != null) cache.kept['u1'] = DriverHome.encode(kept);
  final service = FakeFleetDriverService(answer);
  final controller = FleetDriverController(service: service, cache: cache);
  addTearDown(controller.dispose);
  return _Rig(service, cache, controller);
}

const _regularHome = Scaffold(
  body: Column(children: [Text('REGULAR HOME'), FleetDriverHomeCard()]),
);

Future<void> _pump(
  WidgetTester tester,
  _Rig rig, {
  Locale locale = const Locale('en'),
  Size size = const Size(390, 2000),
  bool eligible = true,
  bool hold = false,
  String? uid = 'u1',
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  setMoneyDisplayLanguage(locale.languageCode);
  addTearDown(() => setMoneyDisplayLanguage('en'));
  await tester.pumpWidget(
    MaterialApp(
      locale: locale,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: FleetDriverHost(
        uid: uid,
        eligible: eligible,
        hold: hold,
        controller: rig.controller,
        openLink: rig.open,
        settings: (_) => const Center(child: Text('SETTINGS TAB')),
        shipping: DriverShippingPages(
          sendPackage: (slug) => Scaffold(body: Text('SEND FORM $slug')),
          myPackages: (id) => Scaffold(body: Text('MY PACKAGES $id')),
        ),
        child: _regularHome,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _tab(WidgetTester tester, String label) async {
  await tester.tap(find.text(label).last);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('a Fleet-only driver lands on their own account, not the '
      'regular home', (tester) async {
    final rig = _rig(driverHomeAnswer());
    await _pump(tester, rig);
    expect(find.byKey(const Key('fleet-driver-shell')), findsOneWidget);
    expect(find.text('REGULAR HOME'), findsNothing);
    expect(find.text('Dala Fleet · on Laawol'), findsOneWidget);
    expect(find.text('Hi Awa Test'), findsOneWidget);
    expect(
      tester.widget<Text>(find.byKey(const Key('fleet-driver-owed'))).data,
      r'$425.00',
    );
    expect(find.text('Late since Dec 1, 2026'), findsOneWidget);
    expect(find.text('Plate fee · Dec 2026'), findsOneWidget);
    expect(find.text('Late fee'), findsOneWidget);
    expect(find.text('pay@dala.test'), findsOneWidget);
    expect(find.text('Dala Fleet LLC'), findsOneWidget);
    // The payment they reported, and the last ones received.
    expect(
      find.textContaining(r'$400.00 · reported Dec 4, 2026'),
      findsOneWidget,
    );
    expect(find.text('Waiting for the bank'), findsOneWidget);
    expect(find.text('Nov 2, 2026'), findsOneWidget);
    expect(find.text('Recorded before Laawol'), findsOneWidget);
    // Four places, Settings among them.
    for (final label in ['Home', 'Payments', 'My plate', 'Settings']) {
      expect(find.text(label), findsWidgets, reason: label);
    }
  });

  testWidgets('Payments lists every bill with its state and every payment', (
    tester,
  ) async {
    final rig = _rig(driverHomeAnswer());
    await _pump(tester, rig);
    await _tab(tester, 'Payments');
    final page = find.byKey(const Key('fleet-driver-payments'));
    expect(page, findsOneWidget);
    Finder inPage(String text) =>
        find.descendant(of: page, matching: find.text(text));
    expect(inPage('Plate fee · Dec 2026'), findsOneWidget);
    expect(inPage('Plate fee · Nov 2026'), findsOneWidget);
    expect(inPage('Late'), findsOneWidget);
    expect(inPage('Open'), findsOneWidget);
    expect(inPage('Paid'), findsOneWidget);
    expect(inPage('Payments received'), findsOneWidget);
    expect(inPage('Zelle'), findsOneWidget);
  });

  testWidgets('My plate shows the plate, its fee and the papers to renew', (
    tester,
  ) async {
    final rig = _rig(driverHomeAnswer());
    await _pump(tester, rig);
    await _tab(tester, 'My plate');
    final page = find.byKey(const Key('fleet-driver-plate'));
    Finder inPage(String text) =>
        find.descendant(of: page, matching: find.text(text));
    expect(inPage('T100000C'), findsOneWidget);
    expect(inPage('Toyota Camry'), findsOneWidget);
    expect(inPage('The car is yours'), findsOneWidget);
    expect(inPage(r'$400.00 a month'), findsOneWidget);
    expect(inPage('Due on day 1 of each month'), findsOneWidget);
    expect(inPage('With you since Jan 10, 2026'), findsOneWidget);
    expect(inPage('Expires Dec 20, 2026'), findsOneWidget);
    expect(inPage('Renew soon'), findsOneWidget);
    expect(inPage('Expires Jun 1, 2027'), findsOneWidget);
    expect(inPage('Sample Mutual'), findsOneWidget);
    // The policy number is the office's: no row for it.
    expect(inPage('Policy number'), findsNothing);
    await tester.scrollUntilVisible(
      find.byKey(const Key('fleet-driver-call')),
      200,
      scrollable: find
          .descendant(of: page, matching: find.byType(Scrollable))
          .first,
    );
    await tester.tap(find.byKey(const Key('fleet-driver-call')));
    await tester.pump();
    expect(rig.opened.single.toString(), 'tel:+16465550100');
  });

  testWidgets('Settings is the fourth place', (tester) async {
    final rig = _rig(driverHomeAnswer());
    await _pump(tester, rig);
    await _tab(tester, 'Settings');
    expect(find.text('SETTINGS TAB'), findsOneWidget);
  });

  testWidgets('"Send my payment screenshot" opens the WhatsApp chat with '
      'Laawol; when it cannot, the number is said', (tester) async {
    final rig = _rig(driverHomeAnswer());
    await _pump(tester, rig);
    final button = find.byKey(const Key('fleet-driver-send-proof'));
    await tester.ensureVisible(button);
    await tester.tap(button);
    await tester.pump();
    expect(
      rig.opened.single.toString(),
      'https://wa.me/16465550199?text=Here+is+my+Zelle+payment+for+Dala+Fleet.',
    );
    expect(find.textContaining('WhatsApp could not be opened'), findsNothing);

    rig.linkOpens = false;
    await tester.tap(button);
    await tester.pump();
    expect(
      find.text(
        'WhatsApp could not be opened. Send the screenshot on '
        'WhatsApp to +1 (646) 555-0199.',
      ),
      findsOneWidget,
    );
    await tester.pumpAndSettle(const Duration(seconds: 6));
  });

  testWidgets('Copy puts the Zelle address on the clipboard', (tester) async {
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
    final rig = _rig(driverHomeAnswer());
    await _pump(tester, rig);
    await tester.tap(find.byKey(const Key('fleet-driver-copy-zelle')));
    await tester.pump();
    expect(copied, 'pay@dala.test');
    expect(find.text('Copied'), findsOneWidget);
    await tester.pumpAndSettle(const Duration(seconds: 6));
  });

  testWidgets('a driver who owes nothing reads "all paid up", with their '
      'credit', (tester) async {
    final rig = _rig(
      driverHomeAnswer(
        owedCents: 0,
        lateCents: 0,
        creditCents: 1500,
        claims: false,
      ),
    );
    await _pump(tester, rig);
    expect(find.byKey(const Key('fleet-driver-paid-up')), findsOneWidget);
    expect(
      tester.widget<Text>(find.byKey(const Key('fleet-driver-owed'))).data,
      r'$0.00',
    );
    expect(
      find.text(r'Credit on your account: $15.00. It pays your next bill.'),
      findsOneWidget,
    );
    expect(find.byKey(const Key('fleet-driver-claims')), findsNothing);
  });

  testWidgets('no Zelle details yet: the driver is told to ask, and a driver '
      'who left is told what is still owed', (tester) async {
    final rig = _rig(
      driverHomeAnswer(zelle: false, status: 'left', plates: false),
    );
    await _pump(tester, rig);
    expect(find.byKey(const Key('fleet-driver-no-zelle')), findsOneWidget);
    expect(find.byKey(const Key('fleet-driver-left')), findsOneWidget);
    await _tab(tester, 'My plate');
    expect(find.byKey(const Key('fleet-driver-no-plate')), findsOneWidget);
  });

  testWidgets('a locked driver reaches the fleet business\'s own shipping, '
      'and only that business\'s', (tester) async {
    final rig = _rig(driverHomeAnswer(ships: true, sendSlug: 'dala-ship'));
    await _pump(tester, rig);
    expect(find.byKey(const Key('fleet-driver-shipping')), findsOneWidget);
    expect(find.text('Shipping with Dala Fleet'), findsOneWidget);
    await tester.tap(find.byKey(const Key('fleet-driver-send-package')));
    await tester.pumpAndSettle();
    // The request form, pinned to that business by its link name.
    expect(find.text('SEND FORM dala-ship'), findsOneWidget);
    Navigator.of(tester.element(find.text('SEND FORM dala-ship'))).pop();
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('fleet-driver-my-packages')));
    await tester.pumpAndSettle();
    expect(find.text('MY PACKAGES biz-dala'), findsOneWidget);
  });

  testWidgets('no shipping block for a business that does not ship', (
    tester,
  ) async {
    final rig = _rig(driverHomeAnswer());
    await _pump(tester, rig);
    expect(find.byKey(const Key('fleet-driver-shipping')), findsNothing);
  });

  testWidgets('no form row for a business that takes no requests', (
    tester,
  ) async {
    final rig = _rig(driverHomeAnswer(ships: true));
    await _pump(tester, rig);
    expect(find.byKey(const Key('fleet-driver-shipping')), findsOneWidget);
    expect(find.byKey(const Key('fleet-driver-send-package')), findsNothing);
    expect(find.byKey(const Key('fleet-driver-my-packages')), findsOneWidget);
  });

  testWidgets('a push about the account makes the screens read it again', (
    tester,
  ) async {
    final rig = _rig(driverHomeAnswer());
    await _pump(tester, rig);
    expect(rig.service.calls, 1);
    expect(find.text('Late since Dec 1, 2026'), findsOneWidget);
    // A push about something else changes nothing.
    noteFleetDriverPush({'type': 'barrel_shipment_status'});
    await tester.pumpAndSettle();
    expect(rig.service.calls, 1);
    // The receipt's push: the bill is paid now.
    rig.service.answer = driverHomeAnswer(
      owedCents: 0,
      lateCents: 0,
      claims: false,
    );
    noteFleetDriverPush({'type': 'fleet_driver', 'kind': 'receipt'});
    await tester.pumpAndSettle();
    expect(rig.service.calls, 2);
    expect(find.byKey(const Key('fleet-driver-paid-up')), findsOneWidget);
  });

  testWidgets('a customer keeps the regular home and sees no plate card', (
    tester,
  ) async {
    final rig = _rig(notADriverAnswer());
    await _pump(tester, rig);
    expect(find.text('REGULAR HOME'), findsOneWidget);
    expect(find.byKey(const Key('fleet-driver-shell')), findsNothing);
    expect(find.textContaining('Your plate'), findsNothing);
  });

  testWidgets('a guest or a person with business access is never asked', (
    tester,
  ) async {
    final rig = _rig(driverHomeAnswer());
    await _pump(tester, rig, eligible: false);
    expect(find.text('REGULAR HOME'), findsOneWidget);
    expect(rig.service.calls, 0);
  });

  testWidgets('a business that lets its drivers use all of Laawol: the '
      'regular home with a "Your plate" card that opens the account', (
    tester,
  ) async {
    final rig = _rig(
      driverHomeAnswer(onlyFleet: false, ships: true, sendSlug: 'dala-ship'),
    );
    await _pump(tester, rig);
    expect(find.text('REGULAR HOME'), findsOneWidget);
    expect(find.text('Your plate · Dala Fleet'), findsOneWidget);
    expect(find.text(r'You owe $425.00'), findsOneWidget);
    await tester.tap(find.byKey(const Key('fleet-driver-card-biz-dala')));
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('fleet-driver-shell')), findsOneWidget);
    expect(find.text('Hi Awa Test'), findsOneWidget);
    // Three places and a way back; Settings stays in the regular app.
    expect(find.text('Settings'), findsNothing);
    // Shipping too: the regular app already has it.
    expect(find.byKey(const Key('fleet-driver-shipping')), findsNothing);
    await tester.tap(find.byType(AppBackButton).first);
    await tester.pumpAndSettle();
    expect(find.text('REGULAR HOME'), findsOneWidget);
  });

  testWidgets('a phone-only account waits for the answer behind a spinner '
      'instead of flashing the regular home', (tester) async {
    final gate = Completer<Map<String, dynamic>>();
    final rig = _rig(() => gate.future);
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: FleetDriverHost(
          uid: 'u1',
          eligible: true,
          hold: true,
          controller: rig.controller,
          settings: (_) => const Center(child: Text('SETTINGS TAB')),
          child: _regularHome,
        ),
      ),
    );
    await tester.pump();
    expect(find.byKey(const Key('fleet-driver-hold')), findsOneWidget);
    expect(find.text('REGULAR HOME'), findsNothing);
    gate.complete(driverHomeAnswer());
    await tester.pumpAndSettle();
    expect(find.byKey(const Key('fleet-driver-shell')), findsOneWidget);
  });

  testWidgets('the spinner always ends: no answer in time, the regular home '
      'shows', (tester) async {
    final never = Completer<Map<String, dynamic>>();
    final rig = _rig(() => never.future);
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: FleetDriverHost(
          uid: 'u1',
          eligible: true,
          hold: true,
          controller: rig.controller,
          settings: (_) => const Center(child: Text('SETTINGS TAB')),
          child: _regularHome,
        ),
      ),
    );
    await tester.pump();
    expect(find.byKey(const Key('fleet-driver-hold')), findsOneWidget);
    await tester.pump(FleetDriverController.settleAfter);
    await tester.pump();
    expect(find.byKey(const Key('fleet-driver-hold')), findsNothing);
    expect(find.text('REGULAR HOME'), findsOneWidget);
  });

  testWidgets('offline with a kept copy: the account still opens and says it '
      'could not refresh', (tester) async {
    final rig = _rig(
      const FleetFailure(code: 'unavailable'),
      kept: driverHomeAnswer(),
    );
    await _pump(tester, rig, hold: true);
    expect(find.byKey(const Key('fleet-driver-shell')), findsOneWidget);
    expect(find.byKey(const Key('fleet-driver-stale')), findsOneWidget);
  });

  testWidgets('in French, on a 320 px phone, every place reads French and '
      'nothing overflows', (tester) async {
    final rig = _rig(
      driverHomeAnswer(creditCents: 1500, ships: true, sendSlug: 'dala-ship'),
    );
    await _pump(
      tester,
      rig,
      locale: const Locale('fr'),
      size: const Size(320, 640),
    );
    expect(find.text('Dala Fleet · sur Laawol'), findsOneWidget);
    expect(find.text('Bonjour Awa Test'), findsOneWidget);
    expect(find.text('Vous devez'), findsOneWidget);
    expect(find.text('En retard depuis le 1er déc. 2026'), findsOneWidget);
    expect(find.text('Frais de plaque · déc. 2026'), findsOneWidget);
    expect(
      tester.widget<Text>(find.byKey(const Key('fleet-driver-owed'))).data,
      fleetMoney(42500, language: 'fr'),
    );
    final home = find.byKey(const Key('fleet-driver-home'));
    Finder scroller(Finder page) =>
        find.descendant(of: page, matching: find.byType(Scrollable)).first;
    await tester.scrollUntilVisible(
      find.text('Enregistré avant Laawol'),
      150,
      scrollable: scroller(home),
    );
    expect(find.text('Derniers paiements'), findsOneWidget);
    expect(find.text('Enregistré avant Laawol'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.byKey(const Key('fleet-driver-my-packages')),
      150,
      scrollable: scroller(home),
    );
    expect(find.text('Expédier avec Dala Fleet'), findsOneWidget);
    expect(find.text('Envoyer un colis'), findsOneWidget);
    expect(find.text('Mes colis'), findsOneWidget);
    expect(tester.takeException(), isNull);

    await _tab(tester, 'Paiements');
    expect(find.text('Factures'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.text('Paiements reçus'),
      150,
      scrollable: scroller(find.byKey(const Key('fleet-driver-payments'))),
    );
    expect(tester.takeException(), isNull);

    await _tab(tester, 'Ma plaque');
    expect(find.text('La voiture est à vous'), findsOneWidget);
    expect(find.text('À payer le 1er de chaque mois'), findsOneWidget);
    final plate = find.byKey(const Key('fleet-driver-plate'));
    await tester.scrollUntilVisible(
      find.text('Expire le 20 déc. 2026'),
      150,
      scrollable: scroller(plate),
    );
    expect(find.text('À renouveler bientôt'), findsOneWidget);
    await tester.scrollUntilVisible(
      find.byKey(const Key('fleet-driver-call')),
      150,
      scrollable: scroller(plate),
    );
    expect(
      find.textContaining('Un problème ? Appelez Dala Fleet'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });
}
