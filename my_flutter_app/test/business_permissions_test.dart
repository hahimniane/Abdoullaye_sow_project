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
}
