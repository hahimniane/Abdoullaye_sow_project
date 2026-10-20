import 'dart:io';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/l10n/app_localizations.dart';
import 'package:my_flutter_app/services/phone_accounts.dart';
import 'package:my_flutter_app/services/staff_invites.dart';
import 'package:my_flutter_app/widgets/staff_invite_widgets.dart';

import 'fixtures/fake_staff_invite.dart';

const _token = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123-_9';

void main() {
  test('the token is 43 characters', () {
    expect(_token.length, 43);
    expect(isStaffInviteToken(_token), isTrue);
  });

  group('staffInviteTokenFromUri', () {
    test('reads /j/<token> and the forwarded form on the customer host', () {
      expect(
        staffInviteTokenFromUri(
          Uri.parse('https://customer.laawoldigital.com/j/$_token'),
        ),
        _token,
      );
      expect(
        staffInviteTokenFromUri(
          Uri.parse('https://customer.laawoldigital.com/j/$_token/'),
        ),
        _token,
      );
      expect(
        staffInviteTokenFromUri(
          Uri.parse(
            'https://customer.laawoldigital.com/?service=staff-invite&j=$_token',
          ),
        ),
        _token,
      );
    });

    test('ignores other hosts, paths and malformed tokens', () {
      for (final link in [
        'https://laawoldigital.com/j/$_token',
        'https://customer.laawoldigital.com/t/$_token',
        'https://customer.laawoldigital.com/j/short',
        'https://customer.laawoldigital.com/j/${_token}x',
        'https://customer.laawoldigital.com/j/$_token/extra',
        'ftp://customer.laawoldigital.com/j/$_token',
        'https://customer.laawoldigital.com/?service=staff-invite&j=bad',
      ]) {
        expect(staffInviteTokenFromUri(Uri.parse(link)), isNull, reason: link);
      }
      expect(staffInviteTokenFromUri(null), isNull);
    });
  });

  group('businessInvitePayload', () {
    test('phone: the number, no email, and the store only when multi', () {
      final payload = businessInvitePayload(
        businessId: 'b1',
        fullName: '  Awa Diallo ',
        method: StaffInviteMethod.phone,
        phone: '+224622123456',
        email: 'ignored@example.com',
        businessPermissions: const ['inventory'],
        locale: 'fr',
        multiStore: true,
        storeChoice: const StaffInviteStoreChoice.store('s2'),
      );
      expect(payload, {
        'businessId': 'b1',
        'fullName': 'Awa Diallo',
        'method': 'phone',
        'phone': '+224622123456',
        'businessPermissions': ['inventory'],
        'inventoryStoreAccess': {'allStores': false, 'homeStoreId': 's2'},
        'locale': 'fr',
      });
    });

    test('email: no phone; a single-store business sends no store', () {
      final payload = businessInvitePayload(
        businessId: 'b1',
        fullName: 'Awa',
        method: StaffInviteMethod.email,
        phone: '+224622123456',
        email: ' awa@example.com ',
        businessPermissions: const [],
        locale: 'de',
        storeChoice: const StaffInviteStoreChoice.allStores(),
      );
      expect(payload['method'], 'email');
      expect(payload['email'], 'awa@example.com');
      expect(payload.containsKey('phone'), isFalse);
      expect(payload.containsKey('inventoryStoreAccess'), isFalse);
      expect(payload['locale'], 'en');
    });

    test('all stores is sent as {allStores: true}', () {
      expect(const StaffInviteStoreChoice.allStores().toPayload(), {
        'allStores': true,
      });
      expect(const StaffInviteStoreChoice.store('').isComplete, isFalse);
    });
  });

  group('answers', () {
    test('a phone invite WhatsApp did not carry needs the share link', () {
      final result = StaffInviteResult.fromCallable(<Object?, Object?>{
        'success': true,
        'invitationId': 'i1',
        'channel': 'phone',
        'phoneMasked': '+224 ••••56',
        'status': 'pending',
        'inviteLink': 'https://customer.laawoldigital.com/j/$_token',
        'expiresAtMs': 1790000000000,
        'whatsappSent': false,
        'whatsappStatus': 'template_pending',
      });
      expect(result.isPhone, isTrue);
      expect(result.needsShare, isTrue);
      expect(result.phoneMasked, '+224 ••••56');
      final sent = StaffInviteResult.fromCallable({
        'channel': 'phone',
        'inviteLink': 'x',
        'whatsappSent': true,
      });
      expect(sent.needsShare, isFalse);
      expect(
        StaffInviteResult.fromCallable({'channel': 'email'}).needsShare,
        isFalse,
      );
    });

    test('invitation rows: masked number, link, the not-sent note', () {
      final rows = businessInvitationsFrom(<Object?, Object?>{
        'invitations': [
          {
            'invitationId': 'p1',
            'channel': 'phone',
            'fullName': 'Awa',
            'phoneMasked': '+224 ••••56',
            'inviteLink': 'https://customer.laawoldigital.com/j/$_token',
            'whatsappStatus': '',
            'status': 'pending',
          },
          {
            'invitationId': 'e1',
            'channel': 'email',
            'email': 'a@b.c',
            'status': 'expired',
          },
          {'channel': 'phone'},
        ],
      });
      expect(rows, hasLength(2));
      expect(rows.first.contact, '+224 ••••56');
      expect(rows.first.whatsappNotSent, isTrue);
      expect(rows.first.canResend, isTrue);
      expect(rows.last.contact, 'a@b.c');
      expect(rows.last.whatsappNotSent, isFalse);
      expect(rows.last.canResend, isTrue);
      expect(rows.last.isPending, isFalse);
      expect(businessInvitationsFrom(null), isEmpty);
    });

    test('a refusal is read from details.reason', () {
      final failure = parseStaffInviteFailure('NOT-FOUND', <Object?, Object?>{
        'reason': 'invite_not_found',
      });
      expect(failure.code, 'not-found');
      expect(failure.reason, StaffInviteReason.inviteNotFound);
    });

    test('the service turns a Functions refusal into its reason', () async {
      final caller = FakeInviteCaller()
        ..errors['acceptAccessInvitation'] = FirebaseFunctionsException(
          code: 'permission-denied',
          message: 'This invitation belongs to another account',
          details: {'reason': 'invitation-identity-mismatch'},
        );
      await expectLater(
        caller.service.accept(_token),
        throwsA(
          isA<StaffInviteFailure>().having(
            (f) => f.reason,
            'reason',
            StaffInviteReason.invitationIdentityMismatch,
          ),
        ),
      );
      expect(caller.calls.single.$2, {'inviteToken': _token});
    });

    test('the preview goes through phoneAccount', () async {
      final caller = FakeInviteCaller()
        ..answers['phoneAccount'] = {
          'invitationId': 'i1',
          'status': 'pending',
          'businessName': 'Conakry Express',
          'invitedByName': 'Mamadou',
          'phoneLastTwo': '35',
          'expiresAtMs': 1,
        };
      final preview = await caller.service.preview(_token);
      expect(caller.calls.single.$2, {
        'action': 'staffInvite',
        'token': _token,
      });
      expect(preview.isPending, isTrue);
      expect(preview.phoneLastTwo, '35');
    });
  });

  group('staffInviteView', () {
    const pending = StaffInvitePreview(
      invitationId: 'i1',
      status: 'pending',
      phoneLastTwo: '35',
    );

    test('closed unless pending', () {
      for (final status in ['expired', 'cancelled', 'accepted']) {
        expect(
          staffInviteView(
            StaffInvitePreview(invitationId: 'i', status: status),
            StaffInviteViewer.signedOut,
          ),
          StaffInviteView.closed,
        );
      }
      expect(
        staffInviteView(null, StaffInviteViewer.signedOut),
        StaffInviteView.closed,
      );
    });

    test('signed out or a guest signs in with the masked number', () {
      expect(
        staffInviteView(pending, StaffInviteViewer.signedOut),
        StaffInviteView.signInToAccept,
      );
      expect(
        staffInviteView(
          pending,
          const StaffInviteViewer(signedIn: true, anonymous: true),
        ),
        StaffInviteView.signInToAccept,
      );
    });

    test('that number accepts; another account signs out first', () {
      expect(
        staffInviteView(
          pending,
          const StaffInviteViewer(signedIn: true, phoneNumber: '+224622000035'),
        ),
        StaffInviteView.acceptAsSignedIn,
      );
      expect(
        staffInviteView(
          pending,
          const StaffInviteViewer(signedIn: true, phoneNumber: '+224622000036'),
        ),
        StaffInviteView.otherAccount,
      );
      // An email account with no number.
      expect(
        staffInviteView(pending, const StaffInviteViewer(signedIn: true)),
        StaffInviteView.otherAccount,
      );
    });
  });

  group('profileAccessLost (removal)', () {
    const staff = ProfileAuthority(role: 'staff', businessId: 'b1');

    test('role customer, no role, or no profile at all', () {
      expect(
        profileAccessLost(staff, const ProfileAuthority(role: 'customer')),
        isTrue,
      );
      expect(profileAccessLost(staff, const ProfileAuthority()), isTrue);
      expect(profileAccessLost(staff, null), isTrue);
      expect(
        profileAccessLost(
          const ProfileAuthority(role: 'admin'),
          const ProfileAuthority(role: 'customer'),
        ),
        isTrue,
      );
    });

    test('another business is a removal; the same business is not', () {
      expect(
        profileAccessLost(
          staff,
          const ProfileAuthority(role: 'staff', businessId: 'b2'),
        ),
        isTrue,
      );
      expect(
        profileAccessLost(
          staff,
          const ProfileAuthority(role: 'staff', businessId: 'b1'),
        ),
        isFalse,
      );
      // Promoted to owner of the same business: still access.
      expect(
        profileAccessLost(
          staff,
          const ProfileAuthority(role: 'businessOwner', businessId: 'b1'),
        ),
        isFalse,
      );
    });

    test('a customer session never counts as a removal', () {
      expect(
        profileAccessLost(const ProfileAuthority(role: 'customer'), null),
        isFalse,
      );
      expect(profileAccessLost(const ProfileAuthority(), null), isFalse);
    });
  });

  test('the masked invite request sends only the token', () {
    expect(
      const InvitePhoneCodeRequest(
        inviteToken: ' $_token ',
        lastTwo: '35',
      ).toPayload(),
      {'action': 'requestPhoneLoginCode', 'inviteToken': _token},
    );
  });

  test('every reason has its own words in both languages', () {
    for (final locale in const [Locale('en'), Locale('fr')]) {
      final l10n = lookupAppLocalizations(locale);
      for (final reason in StaffInviteReason.all) {
        final text = staffInviteRefusalText(
          l10n,
          StaffInviteFailure(code: 'failed-precondition', reason: reason),
        );
        expect(text, isNot(l10n.phaErrGeneric), reason: '$locale $reason');
      }
      // Offline and unknown fall back by code, never to a server message.
      expect(
        staffInviteRefusalText(
          l10n,
          const StaffInviteFailure(code: 'unavailable'),
        ),
        l10n.phaErrOffline,
      );
      expect(
        staffInviteRefusalText(l10n, const StaffInviteFailure(code: 'x')),
        l10n.phaErrGeneric,
      );
    }
  });

  test('the contract lists every reason the app maps', () {
    final contract = File('../docs/STAFF_PHONE_INVITES.md').readAsStringSync();
    for (final reason in StaffInviteReason.all) {
      expect(contract, contains('`$reason`'), reason: reason);
    }
  });
}
