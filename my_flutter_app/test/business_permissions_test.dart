import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/utils/business_permissions.dart';

void main() {
  test('owners and administrators keep full business access', () {
    expect(
      canAccessBusinessPermission(
        isStaff: false,
        permissions: const [],
        permission: BusinessPermission.listings,
      ),
      isTrue,
    );
  });

  test('restricted staff only receive explicitly granted sections', () {
    const permissions = [BusinessPermission.listings];
    expect(
      canAccessBusinessPermission(
        isStaff: true,
        permissions: permissions,
        permission: BusinessPermission.listings,
      ),
      isTrue,
    );
    expect(
      canAccessBusinessPermission(
        isStaff: true,
        permissions: permissions,
        permission: BusinessPermission.purchases,
      ),
      isFalse,
    );
    expect(
      canAccessBusinessPermission(
        isStaff: true,
        permissions: const [],
        permission: BusinessPermission.support,
      ),
      isFalse,
    );
  });

  group('invoices access (ledger OR invoices)', () {
    bool allowed(bool isStaff, List<String> permissions) => canAccessInvoices(
          isStaff: isStaff,
          permissions: permissions,
        );

    test('owners always have it', () {
      expect(allowed(false, const []), isTrue);
    });

    test('staff with ledger, invoices, or both have it', () {
      expect(allowed(true, const [BusinessPermission.ledger]), isTrue);
      expect(allowed(true, const [BusinessPermission.invoices]), isTrue);
      expect(
        allowed(true, const [
          BusinessPermission.ledger,
          BusinessPermission.invoices,
        ]),
        isTrue,
      );
    });

    test('staff with neither do not, whatever else they hold', () {
      expect(allowed(true, const []), isFalse);
      expect(
        allowed(true, const [
          BusinessPermission.containers,
          BusinessPermission.inventory,
        ]),
        isFalse,
      );
    });

    test('invoices does not unlock the ledger-only screens', () {
      expect(
        canAccessBusinessPermission(
          isStaff: true,
          permissions: const [BusinessPermission.invoices],
          permission: BusinessPermission.ledger,
        ),
        isFalse,
      );
    });

    test('the permission key is the one the backend reads', () {
      expect(BusinessPermission.invoices, 'invoices');
    });
  });
}
