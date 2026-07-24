import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  final screen = File(
    'lib/screens/user_management_screen.dart',
  ).readAsStringSync();
  final provider = File('lib/providers/auth_provider.dart').readAsStringSync();
  final staffInvite = File(
    'lib/screens/add_staff_screen.dart',
  ).readAsStringSync();
  final english = File('lib/l10n/app_en.arb').readAsStringSync();
  final french = File('lib/l10n/app_fr.arb').readAsStringSync();

  test('mobile uses the same sanitized marketplace directory contract', () {
    expect('$screen\n$provider', contains('listMarketplacePeople'));
    expect('$screen\n$provider', contains('getMarketplacePerson'));
    expect(screen, isNot(contains("collection('users').snapshots()")));
    expect(screen, contains('pageToken'));
  });

  test('mobile exposes the same safe lifecycle callables as web', () {
    for (final callable in <String>[
      'setMarketplaceUserStatus',
      'revokeUserSessions',
      'sendUserRecoveryEmail',
      'invitePlatformAdmin',
      'inviteBusinessMember',
      'resendAccessInvitation',
      'cancelAccessInvitation',
      'transferBusinessOwnership',
      'reviewAccountDeletion',
      'finalizeAccountDeletion',
    ]) {
      expect(
        '$screen\n$provider',
        contains(callable),
        reason: '$callable must be shared with the web management contract',
      );
    }
  });

  test('mobile renders unified categories and permission-aware actions', () {
    for (final token in <String>[
      'platformAdministrators',
      'businessOwners',
      'businessStaff',
      'customers',
      'pendingInvitations',
      'missingProfiles',
      'businessPermissions',
      'businessId',
    ]) {
      expect(screen, contains(token));
    }
    expect(screen, contains('isCurrentUser'));
    expect(screen, contains('canManage'));
  });

  test('all marketplace people copy exists in both ARB catalogs', () {
    for (final key in <String>[
      'platformAdministrators',
      'businessOwners',
      'businessStaff',
      'pendingInvitations',
      'missingProfiles',
      'suspendAccount',
      'restoreAccount',
      'revokeSessions',
      'sendPasswordReset',
      'sendVerificationEmail',
      'transferOwnership',
      'resendInvitation',
      'cancelInvitation',
      'reviewDeletionRequest',
      'finalizeAccountDeletion',
    ]) {
      expect(english, contains('"$key"'));
      expect(french, contains('"$key"'));
    }
  });

  test(
    'mobile personnel entry points use invitations, not shared passwords',
    () {
      final personnelSources = '$screen\n$provider\n$staffInvite';
      expect(personnelSources, isNot(contains("'createStaffUser'")));
      expect(personnelSources, isNot(contains("'createPlatformManager'")));
      expect(staffInvite, contains('inviteBusinessMember'));
      expect(staffInvite, contains('businessPermissions'));
      expect(staffInvite, isNot(contains('Temporary password')));
    },
  );
}
