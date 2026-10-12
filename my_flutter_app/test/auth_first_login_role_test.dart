import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/providers/auth_profile_gate.dart';

/// Regression: on a first login (seen on Android) a staff member landed on the
/// customer screens and only a second login showed the right ones. The late
/// `authStateChanges` event for the account `authenticate()` had just loaded
/// wiped its profile, and the login screen read the role in that gap.
void main() {
  group('authEventKeepsLoadedProfile', () {
    test('keeps the profile of the account that is already loaded', () {
      expect(
        authEventKeepsLoadedProfile(
          loadedProfileUid: 'staff-1',
          eventUid: 'staff-1',
        ),
        isTrue,
      );
    });

    test('starts clean for a different account', () {
      expect(
        authEventKeepsLoadedProfile(
          loadedProfileUid: 'staff-1',
          eventUid: 'customer-2',
        ),
        isFalse,
      );
    });

    test('starts clean when nothing is loaded yet', () {
      expect(
        authEventKeepsLoadedProfile(
          loadedProfileUid: null,
          eventUid: 'staff-1',
        ),
        isFalse,
      );
    });

    test('a sign-out event never keeps a profile', () {
      for (final eventUid in <String?>[null, '']) {
        expect(
          authEventKeepsLoadedProfile(
            loadedProfileUid: 'staff-1',
            eventUid: eventUid,
          ),
          isFalse,
        );
      }
    });
  });

  group('AuthProvider uses the gate', () {
    final source = File('lib/providers/auth_provider.dart').readAsStringSync();

    test('a late sign-in event does not wipe a loaded profile', () {
      final handler = source.substring(
        source.indexOf('Future<void> _onAuthStateChanged'),
        source.indexOf('int _authEventGeneration'),
      );
      expect(handler, contains('authEventKeepsLoadedProfile('));
      expect(
        RegExp(
          r'if \(!authEventKeepsLoadedProfile\([^)]*\)\) \{\s*_clearProfileState\(\);',
        ).hasMatch(handler),
        isTrue,
        reason:
            'the profile may only be cleared when the event is for a '
            'different account than the one already loaded',
      );
    });

    test('the loaded account is remembered and forgotten with the profile', () {
      expect(source, contains('String? _profileUid;'));
      expect(source, contains('_profileUid = signedInUser.uid;'));
      final clear = source.substring(
        source.indexOf('void _clearProfileState()'),
        source.indexOf('List<String> _stringList'),
      );
      expect(clear, contains('_profileUid = null;'));
    });

    test('a failed refresh does not downgrade a loaded account', () {
      final catchBlock = source.substring(
        source.indexOf("debugPrint('❌ Error checking user role: \$e');"),
        source.indexOf('} finally {'),
      );
      expect(catchBlock, contains('_profileUid != _auth.currentUser?.uid'));
    });

    test('invitation activation looks again before giving up', () {
      expect(source, contains('for (var attempt = 0; attempt < 2; attempt++)'));
      expect(source, contains("httpsCallable('acceptAccessInvitation')"));
      expect(source, contains('if (userDoc.exists) break;'));
    });
  });
}
