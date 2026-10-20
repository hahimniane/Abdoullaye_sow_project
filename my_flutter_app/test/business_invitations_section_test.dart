import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/widgets/staff_invite_widgets.dart';

import 'fixtures/fake_staff_invite.dart';

const _link =
    'https://customer.laawoldigital.com/j/abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123-_9';

const _delegates = [
  AppLocalizations.delegate,
  GlobalMaterialLocalizations.delegate,
  GlobalWidgetsLocalizations.delegate,
  GlobalCupertinoLocalizations.delegate,
];

const _rows = {
  'invitations': [
    {
      'invitationId': 'p1',
      'channel': 'phone',
      'fullName': 'Awa Diallo',
      'phoneMasked': '+224 ••••56',
      'inviteLink': _link,
      'whatsappStatus': 'template_pending',
      'status': 'pending',
      'expiresAtMs': 1793116800000,
    },
    {
      'invitationId': 'p2',
      'channel': 'phone',
      'fullName': 'Ibrahima Sow',
      'phoneMasked': '+1 ••••00',
      'inviteLink': _link,
      'whatsappStatus': 'sent',
      'status': 'pending',
    },
    {
      'invitationId': 'e1',
      'channel': 'email',
      'fullName': 'Fatou',
      'email': 'fatou@example.com',
      'status': 'expired',
    },
  ],
};

void main() {
  for (final locale in const [Locale('en'), Locale('fr')]) {
    testWidgets('${locale.languageCode} at 320 px: phone rows show the '
        'masked number, Copy link and the not-sent note; Resend that '
        'WhatsApp did not carry offers the link', (tester) async {
      tester.view.devicePixelRatio = 2;
      tester.view.physicalSize = const Size(640, 3000);
      addTearDown(tester.view.reset);
      final l10n = lookupAppLocalizations(locale);
      final caller = FakeInviteCaller()
        ..answers['listBusinessInvitations'] = _rows
        ..answers['resendAccessInvitation'] = {
          'channel': 'phone',
          'inviteLink': _link,
          'whatsappSent': false,
          'whatsappStatus': 'failed',
        };
      await tester.pumpWidget(
        MaterialApp(
          locale: locale,
          supportedLocales: const [Locale('en'), Locale('fr')],
          localizationsDelegates: _delegates,
          home: Scaffold(
            body: SingleChildScrollView(
              child: BusinessInvitationsSection(
                businessId: 'b1',
                service: caller.service,
              ),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(caller.calls.single.$2, {'businessId': 'b1'});
      expect(find.textContaining('+224 ••••56'), findsOneWidget);
      expect(find.textContaining('fatou@example.com'), findsOneWidget);
      // Only the row WhatsApp did not reach carries the note.
      expect(find.text(l10n.stiNotSentTitle), findsOneWidget);
      expect(find.byKey(const Key('invitation-copy-p2')), findsOneWidget);
      expect(find.byKey(const Key('invitation-copy-p1')), findsNothing);
      expect(find.byKey(const Key('invitation-cancel-e1')), findsNothing);
      expect(find.byKey(const Key('invitation-resend-e1')), findsOneWidget);
      expect(find.textContaining(l10n.stiStatusExpired), findsOneWidget);

      await tester.tap(find.byKey(const Key('invitation-resend-p2')));
      await tester.pumpAndSettle();
      expect(caller.payloadsOf('resendAccessInvitation').single, {
        'invitationId': 'p2',
      });
      expect(find.byType(AlertDialog), findsOneWidget);
      expect(
        find.descendant(
          of: find.byType(AlertDialog),
          matching: find.text(l10n.stiNotSentTitle),
        ),
        findsOneWidget,
      );
      await tester.tap(find.text(l10n.done));
      await tester.pumpAndSettle();
      // Read again after the resend.
      expect(caller.payloadsOf('listBusinessInvitations'), hasLength(2));

      await tester.tap(find.byKey(const Key('invitation-cancel-p1')));
      await tester.pumpAndSettle();
      await tester.tap(
        find.descendant(
          of: find.byType(FilledButton),
          matching: find.text(l10n.cancelInvitation),
        ),
      );
      await tester.pumpAndSettle();
      expect(caller.payloadsOf('cancelAccessInvitation').single, {
        'invitationId': 'p1',
      });
    });
  }
}
