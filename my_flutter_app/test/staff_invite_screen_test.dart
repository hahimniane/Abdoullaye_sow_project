import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/screens/phone_sign_in_screen.dart';
import 'package:my_flutter_app/screens/staff_invite_screen.dart';
import 'package:my_flutter_app/services/phone_accounts.dart';
import 'package:my_flutter_app/services/staff_invites.dart';

import 'fixtures/fake_phone_sign_in.dart';
import 'fixtures/fake_staff_invite.dart';

const _token = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123-_9';

const _delegates = [
  AppLocalizations.delegate,
  GlobalMaterialLocalizations.delegate,
  GlobalWidgetsLocalizations.delegate,
  GlobalCupertinoLocalizations.delegate,
];

StaffInvitePreview _preview({String status = 'pending'}) => StaffInvitePreview(
  invitationId: 'i1',
  status: status,
  businessId: 'b1',
  businessName: 'Conakry Express Fret International',
  invitedByName: 'Mamadou Bah',
  fullName: 'Awa',
  phoneLastTwo: '35',
  expiresAtMs: DateTime(2026, 10, 27, 15).millisecondsSinceEpoch,
);

Future<(AppLocalizations, List<StaffInvitePreview>)> _open(
  WidgetTester tester,
  FakeStaffInviteClient client,
  Locale locale, {
  FakePhoneSignIn? phone,
}) async {
  tester.view.devicePixelRatio = 2;
  tester.view.physicalSize = const Size(640, 1400);
  addTearDown(tester.view.reset);
  final accepted = <StaffInvitePreview>[];
  await tester.pumpWidget(
    MaterialApp(
      locale: locale,
      supportedLocales: const [Locale('en'), Locale('fr')],
      localizationsDelegates: _delegates,
      home: StaffInviteScreen(
        token: _token,
        client: client,
        phoneSignInClient: phone,
        onAccepted: (_, preview) => accepted.add(preview),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return (lookupAppLocalizations(locale), accepted);
}

void main() {
  for (final locale in const [Locale('en'), Locale('fr')]) {
    group('${locale.languageCode} at 320 px', () {
      testWidgets('signed out: accept with the masked number, then the '
          'invitation is accepted', (tester) async {
        final client = FakeStaffInviteClient(previewAnswer: _preview());
        final phone = FakePhoneSignIn()
          ..challenge = const PhoneLoginChallenge(
            challengeId: 'c1',
            lastTwo: '35',
          );
        final (l10n, accepted) = await _open(
          tester,
          client,
          locale,
          phone: phone,
        );

        expect(
          find.text(
            l10n.stiInvitedYou(
              'Mamadou Bah',
              'Conakry Express Fret International',
            ),
          ),
          findsOneWidget,
        );
        // Dates month-first in English, the French form in French.
        expect(
          find.text(
            l10n.stiExpiresOn(
              locale.languageCode == 'en' ? 'Oct 27, 2026' : '27 oct. 2026',
            ),
          ),
          findsOneWidget,
        );
        expect(find.text(l10n.stiAcceptWithNumber('35')), findsOneWidget);

        await tester.tap(find.byKey(const Key('staff-invite-primary')));
        await tester.pump();
        await tester.pump();
        expect(find.byType(PhoneSignInScreen), findsOneWidget);
        final request = phone.requests.single as InvitePhoneCodeRequest;
        expect(request.inviteToken, _token);
        // Only the last two digits are ever shown.
        expect(
          tester
              .widget<Text>(find.byKey(const Key('phone-sign-in-code-sent')))
              .data,
          contains('••35'),
        );

        await tester.enterText(
          find.byKey(const Key('phone-sign-in-code')),
          '123456',
        );
        await tester.tap(find.byKey(const Key('phone-sign-in-primary')));
        await tester.pumpAndSettle();

        expect(phone.verified, ['c1:123456']);
        expect(client.accepted, [_token]);
        expect(accepted.single.businessId, 'b1');
      });

      testWidgets('signed in with that number: Accept invitation, once', (
        tester,
      ) async {
        final client = FakeStaffInviteClient(
          previewAnswer: _preview(),
          viewer: const StaffInviteViewer(
            signedIn: true,
            phoneNumber: '+224622000035',
          ),
        )..acceptGate = Completer<void>();
        final (l10n, accepted) = await _open(tester, client, locale);
        expect(
          find.byKey(const Key('staff-invite-acceptAsSignedIn')),
          findsOneWidget,
        );
        expect(find.text(l10n.stiAccept), findsOneWidget);

        await tester.tap(find.byKey(const Key('staff-invite-primary')));
        await tester.pump();
        expect(find.text(l10n.stiAccepting), findsOneWidget);
        await tester.tap(
          find.byKey(const Key('staff-invite-primary')),
          warnIfMissed: false,
        );
        client.acceptGate!.complete();
        await tester.pumpAndSettle();
        expect(client.accepted, hasLength(1));
        expect(accepted, hasLength(1));
      });

      testWidgets('a refused acceptance shows in our words', (tester) async {
        final client =
            FakeStaffInviteClient(
                previewAnswer: _preview(),
                viewer: const StaffInviteViewer(
                  signedIn: true,
                  phoneNumber: '+224622000035',
                ),
              )
              ..acceptError = const StaffInviteFailure(
                code: 'failed-precondition',
                reason: StaffInviteReason.existingAuthorityConflict,
              );
        final (l10n, accepted) = await _open(tester, client, locale);
        await tester.tap(find.byKey(const Key('staff-invite-primary')));
        await tester.pumpAndSettle();
        expect(find.text(l10n.stiErrExistingAuthority), findsOneWidget);
        expect(accepted, isEmpty);
      });

      testWidgets('another account: explain, then sign out to continue', (
        tester,
      ) async {
        final client = FakeStaffInviteClient(
          previewAnswer: _preview(),
          viewer: const StaffInviteViewer(
            signedIn: true,
            phoneNumber: '+17185550100',
          ),
        );
        final (l10n, _) = await _open(tester, client, locale);
        expect(find.text(l10n.stiOtherAccount('35')), findsOneWidget);
        expect(find.text(l10n.stiSignOutToContinue), findsOneWidget);

        await tester.tap(find.byKey(const Key('staff-invite-primary')));
        await tester.pumpAndSettle();
        expect(client.signOuts, 1);
        expect(find.text(l10n.stiAcceptWithNumber('35')), findsOneWidget);
      });

      testWidgets('expired, cancelled, accepted and unknown links ask for a '
          'new invitation', (tester) async {
        for (final (status, text) in [
          ('expired', (AppLocalizations l) => l.stiClosedExpired),
          ('cancelled', (AppLocalizations l) => l.stiClosedCancelled),
          ('accepted', (AppLocalizations l) => l.stiClosedAccepted),
        ]) {
          final client = FakeStaffInviteClient(
            previewAnswer: _preview(status: status),
          );
          await tester.pumpWidget(const SizedBox());
          final (l10n, _) = await _open(tester, client, locale);
          expect(find.text(text(l10n)), findsOneWidget, reason: status);
          expect(find.byKey(const Key('staff-invite-primary')), findsNothing);
        }
        await tester.pumpWidget(const SizedBox());
        final (l10n, _) = await _open(
          tester,
          FakeStaffInviteClient(
            previewError: const StaffInviteFailure(
              code: 'not-found',
              reason: StaffInviteReason.inviteNotFound,
            ),
          ),
          locale,
        );
        expect(find.text(l10n.stiErrNotActive), findsOneWidget);
      });

      testWidgets('a failed load offers Retry', (tester) async {
        final client = FakeStaffInviteClient(
          previewError: const StaffInviteFailure(code: 'unavailable'),
        );
        final (l10n, _) = await _open(tester, client, locale);
        expect(find.text(l10n.stiLoadFailed), findsOneWidget);
        client
          ..previewError = null
          ..previewAnswer = _preview();
        await tester.tap(find.byKey(const Key('staff-invite-retry')));
        await tester.pumpAndSettle();
        expect(client.previews, 2);
        expect(find.text(l10n.stiAcceptWithNumber('35')), findsOneWidget);
      });
    });
  }
}
