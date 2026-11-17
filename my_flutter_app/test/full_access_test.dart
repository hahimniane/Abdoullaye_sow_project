import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/utils/business_permissions.dart';
import 'package:my_flutter_app/utils/full_access.dart';

// "Full access" staff act as the owner in the app, as on the website
// (admin_web/src/lib/full-access.test.ts) and the server
// (functions/test/staff-full-access.test.js). Owner, 2026-11-17: "on the app
// staff can't see parked cars": a full-access person was still shown only
// what their old staff permissions allowed.

void main() {
  test('a staff member with full access, in a business, is its owner', () {
    expect(
      isFullAccessStaff(role: 'staff', fullAccess: true, businessId: 'b1'),
      isTrue,
    );
    expect(
      effectiveRole(role: 'staff', fullAccess: true, businessId: 'b1'),
      'businessOwner',
    );
  });

  test(
    'nobody else is: ordinary staff, the owner, a customer, a stray flag',
    () {
      for (final profile in <(String?, Object?, Object?)>[
        ('staff', false, 'b1'),
        ('staff', null, 'b1'),
        // Only a real true counts: never a string or a number.
        ('staff', 'true', 'b1'),
        ('staff', 1, 'b1'),
        // A flag left on someone who is no longer in a business.
        ('staff', true, ''),
        ('staff', true, '  '),
        ('staff', true, null),
        ('businessOwner', true, 'b1'),
        ('customer', true, 'b1'),
        ('admin', true, 'b1'),
        (null, true, 'b1'),
      ]) {
        final (role, flag, business) = profile;
        expect(
          isFullAccessStaff(role: role, fullAccess: flag, businessId: business),
          isFalse,
          reason: '$profile',
        );
        expect(
          effectiveRole(role: role, fullAccess: flag, businessId: business),
          role,
          reason: '$profile',
        );
      }
    },
  );

  test('acting as the owner opens every section, whatever was ticked', () {
    // What AuthProvider does with it: a full-access person is not "staff"
    // for the permission check, so an old, short permission list no longer
    // hides the parked cars, the ledger or anything else.
    const oldPermissions = ['containers'];
    bool sees(String permission, {required bool fullAccess}) =>
        canAccessBusinessPermission(
          isStaff: !fullAccess,
          permissions: oldPermissions,
          permission: permission,
        );
    expect(sees(BusinessPermission.parking, fullAccess: false), isFalse);
    expect(sees(BusinessPermission.ledger, fullAccess: false), isFalse);
    for (final permission in [
      BusinessPermission.parking,
      BusinessPermission.ledger,
      BusinessPermission.invoices,
      BusinessPermission.containers,
      BusinessPermission.people,
      BusinessPermission.inventory,
    ]) {
      expect(sees(permission, fullAccess: true), isTrue, reason: permission);
    }
  });

  group('the app uses the rule', () {
    String read(String path) => File(path).readAsStringSync();

    test('the signed-in profile is loaded through it', () {
      final source = read('lib/providers/auth_provider.dart');
      expect(source, contains('isFullAccessStaff('));
      // Owner everywhere; not "staff" for the permission checks.
      expect(
        RegExp(
          r"_isBusinessOwner = role == 'businessOwner' \|\| fullAccess;\s+"
          r"_isStaff = role == 'staff' && !fullAccess;",
        ).hasMatch(source),
        isTrue,
      );
      expect(source, contains('_hasFullAccess = false;'));
    });

    test('the bank stays the real owner\'s', () {
      // Connecting the bank Zelle is checked against is kept owner-only
      // (docs/STAFF_FULL_ACCESS.md): a full-access person never reaches it.
      expect(
        read('lib/screens/zelle_check_sheet.dart'),
        contains('!auth.isRealBusinessOwner'),
      );
      expect(read('lib/main.dart'), contains('!auth.isRealBusinessOwner'));
      expect(
        read('lib/screens/settings_screen.dart'),
        contains('authProvider.isRealBusinessOwner'),
      );
    });
  });
}
