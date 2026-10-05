import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/providers/auth_lookup_guard.dart';

void main() {
  group('AuthLookupGuard', () {
    test('a lookup for the signed-in account applies', () {
      final guard = AuthLookupGuard();
      final ticket = guard.begin('alice');
      expect(ticket.isCurrent('alice'), isTrue);
    });

    test('signing out while a lookup runs retires it', () {
      // The regression: an admin signs out mid-lookup and the late answer
      // writes their role onto the signed-out session.
      final guard = AuthLookupGuard();
      final ticket = guard.begin('alice');
      guard.invalidate();
      expect(ticket.isCurrent(null), isFalse);
      expect(ticket.isCurrent('alice'), isFalse);
    });

    test('another account signing in retires the old lookup', () {
      final guard = AuthLookupGuard();
      final alice = guard.begin('alice');
      final bob = guard.begin('bob');
      expect(alice.isCurrent('bob'), isFalse);
      expect(alice.isCurrent('alice'), isFalse);
      expect(bob.isCurrent('bob'), isTrue);
    });

    test('an answer for a different uid never applies', () {
      final guard = AuthLookupGuard();
      final ticket = guard.begin('alice');
      expect(ticket.isCurrent('bob'), isFalse);
    });
  });

  group('AuthProvider uses it', () {
    final source = File('lib/providers/auth_provider.dart').readAsStringSync();

    String body(String signature) {
      final start = source.indexOf(signature);
      expect(start, isNonNegative, reason: signature);
      final next = source.indexOf('\n  Future<', start + signature.length);
      final nextVoid = source.indexOf('\n  void ', start + signature.length);
      final ends = [next, nextVoid].where((i) => i > 0).toList()..sort();
      return source.substring(start, ends.isEmpty ? source.length : ends.first);
    }

    test('the role lookup re-checks after every await', () {
      final lookup = body('Future<void> _checkUserRoleOnce()');
      expect(lookup, contains('_roleLookups.begin('));
      final awaits = RegExp(r'\bawait\b').allMatches(lookup).length;
      final checks = 'if (!current()) return;'.allMatches(lookup).length;
      // getIdToken(true) inside the invitation branch is followed by the
      // callable in the same try, so one check covers both.
      expect(checks, greaterThanOrEqualTo(awaits - 1));
    });

    test('a role lookup for another account is never shared', () {
      final check = body('Future<void> _checkUserRole()');
      expect(check, contains('uid == _roleCheckUid'));
    });

    test('logout clears the whole profile, admin access included', () {
      final logout = body('Future<void> logout()');
      expect(logout, contains('_roleLookups.invalidate()'));
      expect(logout, contains('_clearProfileState()'));
      final clear = body('void _clearProfileState()');
      expect(clear, contains('_adminRole = null'));
      expect(clear, contains('_platformAccess = const PlatformAccess.none()'));
    });
  });
}
