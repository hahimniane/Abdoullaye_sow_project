import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/add_staff_screen.dart';
import 'package:my_flutter_app/services/inventory_stores.dart';

import 'fixtures/fake_staff_invite.dart';

const _link =
    'https://customer.laawoldigital.com/j/abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123-_9';

const _delegates = [
  AppLocalizations.delegate,
  GlobalMaterialLocalizations.delegate,
  GlobalWidgetsLocalizations.delegate,
  GlobalCupertinoLocalizations.delegate,
];

/// 320 px wide (the narrowest phone we support), reset after the test.
void _narrow(WidgetTester tester) {
  tester.view.devicePixelRatio = 2;
  tester.view.physicalSize = const Size(640, 6000);
  addTearDown(tester.view.reset);
}

class _Harness {
  _Harness({List<InventoryStore> stores = const []})
    : stores = StreamController<List<InventoryStore>>.broadcast() {
    _initial = stores;
  }

  final caller = FakeInviteCaller();
  final StreamController<List<InventoryStore>> stores;
  late List<InventoryStore> _initial;
  int done = 0;

  Stream<List<InventoryStore>> watch(String businessId) async* {
    yield _initial;
    yield* stores.stream;
  }
}

Future<AppLocalizations> _open(
  WidgetTester tester,
  _Harness harness,
  Locale locale,
) async {
  _narrow(tester);
  await tester.pumpWidget(
    MaterialApp(
      locale: locale,
      supportedLocales: const [Locale('en'), Locale('fr')],
      localizationsDelegates: _delegates,
      home: Scaffold(
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(8),
          child: StaffInviteForm(
            businessId: 'b1',
            service: harness.caller.service,
            watchStores: harness.watch,
            onDone: () => harness.done++,
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return lookupAppLocalizations(locale);
}

Future<void> _tapVisible(WidgetTester tester, Finder finder) async {
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pump();
}

Future<void> _fillName(WidgetTester tester) async {
  await tester.enterText(find.byKey(const Key('staff-invite-name')), 'Awa');
  await tester.pump();
}

const _twoStores = [
  InventoryStore(id: 's1', name: 'Brooklyn'),
  InventoryStore(id: 's2', name: 'Bronx'),
];

void main() {
  for (final locale in const [Locale('en'), Locale('fr')]) {
    group('${locale.languageCode} at 320 px', () {
      testWidgets('phone is the default; a not-sent WhatsApp ends on the '
          'share link with Copy', (tester) async {
        final copied = <String>[];
        tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(
          SystemChannels.platform,
          (call) async {
            if (call.method == 'Clipboard.setData') {
              copied.add((call.arguments as Map)['text'] as String);
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
        final harness = _Harness()
          ..caller.answers['inviteBusinessMember'] = {
            'success': true,
            'invitationId': 'i1',
            'channel': 'phone',
            'phoneMasked': '+1 ••••00',
            'status': 'pending',
            'inviteLink': _link,
            'whatsappSent': false,
            'whatsappStatus': 'template_pending',
          };
        final l10n = await _open(tester, harness, locale);

        expect(find.text(l10n.stiMethodPhone), findsOneWidget);
        final phoneChip = tester.widget<ChoiceChip>(
          find.byKey(const Key('staff-invite-method-phone')),
        );
        expect(phoneChip.selected, isTrue);
        expect(find.byKey(const Key('staff-invite-phone')), findsOneWidget);
        expect(find.byKey(const Key('staff-invite-email')), findsNothing);
        // One store or none: the question is not asked.
        expect(find.byKey(const Key('staff-invite-store')), findsNothing);

        await _fillName(tester);
        await tester.enterText(
          find.byKey(const Key('staff-invite-phone')),
          '7185550100',
        );
        await tester.pump();
        await _tapVisible(tester, find.byKey(const Key('staff-invite-send')));
        await tester.pumpAndSettle();

        final payload = harness.caller
            .payloadsOf('inviteBusinessMember')
            .single;
        expect(payload['method'], 'phone');
        expect(payload['phone'], '+17185550100');
        expect(payload['fullName'], 'Awa');
        expect(payload['locale'], locale.languageCode);
        expect(payload.containsKey('email'), isFalse);
        expect(payload.containsKey('inventoryStoreAccess'), isFalse);

        expect(
          find.byKey(const Key('staff-invite-share-step')),
          findsOneWidget,
        );
        expect(find.text(l10n.stiNotSentTitle), findsOneWidget);
        expect(find.text(_link), findsOneWidget);
        await _tapVisible(tester, find.byKey(const Key('staff-invite-copy')));
        await tester.pump();
        expect(copied, [_link]);
        expect(find.text(l10n.stiLinkCopied), findsOneWidget);
        expect(harness.done, 0);

        await _tapVisible(tester, find.byKey(const Key('staff-invite-done')));
        expect(harness.done, 1);
      });

      testWidgets('switching to email sends an email invitation', (
        tester,
      ) async {
        final harness = _Harness()
          ..caller.answers['inviteBusinessMember'] = {
            'success': true,
            'invitationId': 'i2',
            'channel': 'email',
            'status': 'pending',
          };
        final l10n = await _open(tester, harness, locale);

        await _tapVisible(
          tester,
          find.byKey(const Key('staff-invite-method-email')),
        );
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('staff-invite-phone')), findsNothing);
        expect(find.byKey(const Key('staff-invite-email')), findsOneWidget);

        await _fillName(tester);
        await tester.enterText(
          find.byKey(const Key('staff-invite-email')),
          'awa@example.com',
        );
        await _tapVisible(tester, find.byKey(const Key('staff-invite-send')));
        await tester.pumpAndSettle();

        final payload = harness.caller
            .payloadsOf('inviteBusinessMember')
            .single;
        expect(payload['method'], 'email');
        expect(payload['email'], 'awa@example.com');
        expect(payload.containsKey('phone'), isFalse);
        expect(harness.done, 1);
        expect(find.text(l10n.invitationSent), findsOneWidget);
      });

      testWidgets('"Which store?" only with two or more active stores, and '
          'it must be answered', (tester) async {
        final harness = _Harness(stores: _twoStores)
          ..caller.answers['inviteBusinessMember'] = {
            'channel': 'phone',
            'whatsappSent': true,
            'whatsappStatus': 'sent',
            'inviteLink': _link,
          };
        final l10n = await _open(tester, harness, locale);
        expect(find.byKey(const Key('staff-invite-store')), findsOneWidget);
        expect(find.text(l10n.stiStoreLabel), findsOneWidget);

        await _fillName(tester);
        await tester.enterText(
          find.byKey(const Key('staff-invite-phone')),
          '7185550100',
        );
        await _tapVisible(tester, find.byKey(const Key('staff-invite-send')));
        await tester.pumpAndSettle();
        // Not answered: nothing is sent.
        expect(harness.caller.calls, isEmpty);
        expect(find.text(l10n.stiStoreRequired), findsOneWidget);

        await _tapVisible(tester, find.byKey(const Key('staff-invite-store')));
        await tester.pumpAndSettle();
        await tester.tap(find.text(l10n.stiStoreAll).last);
        await tester.pumpAndSettle();
        await _tapVisible(tester, find.byKey(const Key('staff-invite-send')));
        await tester.pumpAndSettle();

        final payload = harness.caller
            .payloadsOf('inviteBusinessMember')
            .single;
        expect(payload['inventoryStoreAccess'], {'allStores': true});
        // WhatsApp delivered it: a confirmation, no share step.
        expect(find.text(l10n.stiSentOnWhatsApp), findsOneWidget);
        expect(find.byKey(const Key('staff-invite-share-step')), findsNothing);
        expect(harness.done, 1);

        // An archived second store makes it single-store again.
        harness.stores.add(const [
          InventoryStore(id: 's1', name: 'Brooklyn'),
          InventoryStore(id: 's2', name: 'Bronx', archived: true),
        ]);
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('staff-invite-store')), findsNothing);
      });

      testWidgets('a refusal shows in our words; double taps send once', (
        tester,
      ) async {
        final harness = _Harness();
        harness.caller
          ..gate = Completer<void>()
          ..errors['inviteBusinessMember'] = FirebaseFunctionsException(
            code: 'failed-precondition',
            message: 'English server text',
            details: {'reason': 'existing-authority-conflict'},
          );
        final l10n = await _open(tester, harness, locale);
        await _fillName(tester);
        await tester.enterText(
          find.byKey(const Key('staff-invite-phone')),
          '7185550100',
        );
        await _tapVisible(tester, find.byKey(const Key('staff-invite-send')));
        final send = find.byKey(const Key('staff-invite-send'));
        expect(tester.widget<ButtonStyleButton>(send).onPressed, isNull);
        await tester.tap(send, warnIfMissed: false);
        await tester.pump();
        harness.caller.gate!.complete();
        await tester.pumpAndSettle();

        expect(harness.caller.calls, hasLength(1));
        expect(find.text(l10n.stiErrExistingAuthority), findsOneWidget);
        expect(find.textContaining('English server text'), findsNothing);
        expect(tester.widget<ButtonStyleButton>(send).onPressed, isNotNull);
      });
    });
  }
}
