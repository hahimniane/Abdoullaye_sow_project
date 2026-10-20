import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/services/staff_invites.dart';
import 'package:my_flutter_app/widgets/staff_invite_widgets.dart';

import 'fixtures/fake_staff_invite.dart';

const _delegates = [
  AppLocalizations.delegate,
  GlobalMaterialLocalizations.delegate,
  GlobalWidgetsLocalizations.delegate,
  GlobalCupertinoLocalizations.delegate,
];

const _pending = {
  'invitations': [
    {
      'invitationId': 'i1',
      'kind': 'business',
      'channel': 'phone',
      'businessId': 'b1',
      'businessName': 'Conakry Express Fret International',
      'invitedByName': 'Mamadou Bah',
      'expiresAtMs': 1,
    },
    {
      'invitationId': 'i2',
      'kind': 'platform',
      'channel': 'email',
      'invitedByName': '',
    },
  ],
};

class _Host extends StatelessWidget {
  const _Host({
    required this.locale,
    required this.uid,
    required this.eligible,
    required this.caller,
    required this.memory,
    required this.joined,
  });

  final Locale locale;
  final String? uid;
  final bool eligible;
  final FakeInviteCaller caller;
  final PendingInvitationsMemory memory;
  final List<PendingInvitation> joined;

  @override
  Widget build(BuildContext context) => MaterialApp(
    locale: locale,
    supportedLocales: const [Locale('en'), Locale('fr')],
    localizationsDelegates: _delegates,
    home: Builder(
      builder: (context) => PendingInvitationsHost(
        uid: uid,
        eligible: eligible,
        service: caller.service,
        memory: memory,
        onJoined: (invite) async => joined.add(invite),
        child: const Scaffold(body: Text('home')),
      ),
    ),
  );
}

void _narrow(WidgetTester tester) {
  tester.view.devicePixelRatio = 2;
  tester.view.physicalSize = const Size(640, 1400);
  addTearDown(tester.view.reset);
}

void main() {
  for (final locale in const [Locale('en'), Locale('fr')]) {
    group('${locale.languageCode} at 320 px', () {
      testWidgets('Join accepts that invitation once, with progress', (
        tester,
      ) async {
        _narrow(tester);
        final l10n = lookupAppLocalizations(locale);
        final caller = FakeInviteCaller()
          ..answers['acceptAccessInvitation'] = _pending;
        final joined = <PendingInvitation>[];
        await tester.pumpWidget(
          _Host(
            locale: locale,
            uid: 'u1',
            eligible: true,
            caller: caller,
            memory: PendingInvitationsMemory(),
            joined: joined,
          ),
        );
        await tester.pumpAndSettle();

        expect(caller.calls.single.$2, {'action': 'pending'});
        expect(
          find.text(
            l10n.stiPendingInvited(
              'Mamadou Bah',
              'Conakry Express Fret International',
            ),
          ),
          findsOneWidget,
        );
        expect(
          find.text(l10n.stiJoin('Conakry Express Fret International')),
          findsOneWidget,
        );

        caller.gate = Completer<void>();
        await tester.tap(find.byKey(const Key('pending-invitation-join')));
        await tester.pump();
        expect(find.text(l10n.stiAccepting), findsOneWidget);
        await tester.tap(
          find.byKey(const Key('pending-invitation-join')),
          warnIfMissed: false,
        );
        caller.gate!.complete();
        await tester.pumpAndSettle();

        expect(caller.payloadsOf('acceptAccessInvitation').skip(1), [
          {'invitationId': 'i1'},
        ]);
        expect(joined.single.invitationId, 'i1');
        // Joined: the platform one is not offered on top.
        expect(find.byKey(const Key('pending-invitation')), findsNothing);
      });

      testWidgets('Not now hides it until the next sign-in; a platform '
          'invitation names Laawol Digital administration', (tester) async {
        _narrow(tester);
        final l10n = lookupAppLocalizations(locale);
        final caller = FakeInviteCaller()
          ..answers['acceptAccessInvitation'] = _pending;
        final memory = PendingInvitationsMemory();
        final joined = <PendingInvitation>[];
        Widget host({String? uid = 'u1', bool eligible = true}) => _Host(
          locale: locale,
          uid: uid,
          eligible: eligible,
          caller: caller,
          memory: memory,
          joined: joined,
        );
        await tester.pumpWidget(host());
        await tester.pumpAndSettle();

        await tester.tap(find.byKey(const Key('pending-invitation-not-now')));
        await tester.pumpAndSettle();
        expect(
          find.text(l10n.stiPendingInvitedNoInviter(l10n.stiPlatformName)),
          findsOneWidget,
        );
        await tester.tap(find.byKey(const Key('pending-invitation-not-now')));
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('pending-invitation')), findsNothing);
        expect(memory.dismissed, {'i1', 'i2'});

        // The same session coming back: read once, nothing offered again.
        await tester.pumpWidget(host(eligible: false));
        await tester.pumpWidget(host());
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('pending-invitation')), findsNothing);
        expect(caller.calls, hasLength(1));

        // Signed out and in again: asked again.
        await tester.pumpWidget(host(uid: null));
        await tester.pumpWidget(host());
        await tester.pumpAndSettle();
        expect(find.byKey(const Key('pending-invitation')), findsOneWidget);
        expect(caller.calls, hasLength(2));
        expect(joined, isEmpty);
      });

      testWidgets('a business session is never asked', (tester) async {
        _narrow(tester);
        final caller = FakeInviteCaller()
          ..answers['acceptAccessInvitation'] = _pending;
        await tester.pumpWidget(
          _Host(
            locale: locale,
            uid: 'u1',
            eligible: false,
            caller: caller,
            memory: PendingInvitationsMemory(),
            joined: [],
          ),
        );
        await tester.pumpAndSettle();
        expect(caller.calls, isEmpty);
        expect(find.byKey(const Key('pending-invitation')), findsNothing);
      });
    });
  }
}
