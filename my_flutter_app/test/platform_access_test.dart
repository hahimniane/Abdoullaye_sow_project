import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/models/platform_access.dart';

void main() {
  group('PlatformAccess', () {
    test('built-in operations role matches the server defaults', () {
      final access = PlatformAccess.resolve(role: 'operationsManager');

      expect(access.canView(PlatformSection.people), isTrue);
      expect(access.canManage(PlatformSection.people), isFalse);
      expect(access.canManage(PlatformSection.businesses), isTrue);
      expect(access.canManage(PlatformSection.operations), isTrue);
      expect(access.canView(PlatformSection.finance), isFalse);
    });

    test('stored role configuration overrides defaults', () {
      final access = PlatformAccess.resolve(
        role: 'operationsManager',
        permissionsConfig: {
          'roles': {
            'operationsManager': {
              'sections': {'people': 'manage', 'businesses': 'none'},
              'services': ['barrel'],
            },
          },
        },
      );

      expect(access.canManage(PlatformSection.people), isTrue);
      expect(access.canView(PlatformSection.businesses), isFalse);
      expect(access.canAccessService('barrel'), isTrue);
      expect(access.canAccessService('freight'), isFalse);
    });

    test('unknown and malformed roles fail closed', () {
      final unknown = PlatformAccess.resolve(role: 'unrecognizedRole');
      final malformed = PlatformAccess.resolve(
        role: 'customRole',
        permissionsConfig: {
          'roles': {
            'customRole': {
              'sections': {'people': 'owner', 'finance': true},
            },
          },
        },
      );

      expect(unknown.canView(PlatformSection.people), isFalse);
      expect(malformed.canView(PlatformSection.people), isFalse);
      expect(malformed.canView(PlatformSection.finance), isFalse);
    });

    test('super admin has all-section and all-service access', () {
      const access = PlatformAccess.superAdmin();

      for (final section in [
        PlatformSection.people,
        PlatformSection.businesses,
        PlatformSection.marketplace,
        PlatformSection.operations,
        PlatformSection.finance,
        PlatformSection.support,
        PlatformSection.website,
      ]) {
        expect(access.canManage(section), isTrue);
      }
      expect(access.canAccessService('future-service'), isTrue);
    });
  });
}
