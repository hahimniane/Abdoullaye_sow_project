import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/platform_activity_alerts.dart';

// The switch is shown to exactly the people the server tells
// (functions platform_activity_alerts.js getsPlatformActivity).
void main() {
  bool show({String role = 'admin', String adminRole = 'superAdmin'}) =>
      showPlatformActivitySwitch(role: role, adminRole: adminRole);

  test('platform activity: super admins and operations managers', () {
    expect(show(), isTrue);
    expect(show(adminRole: 'operationsManager'), isTrue);
    // Stray whitespace from a hand-edited profile still counts, as on the
    // server.
    expect(show(adminRole: ' operationsManager '), isTrue);
  });

  test('platform activity: no other admin role, and never a non-admin', () {
    expect(show(adminRole: 'financeManager'), isFalse);
    expect(show(adminRole: 'supportAdmin'), isFalse);
    expect(show(adminRole: 'contentManager'), isFalse);
    expect(show(adminRole: ''), isFalse);
    // An adminRole left on a profile that is no longer an admin.
    expect(show(role: 'businessOwner'), isFalse);
    expect(show(role: 'staff', adminRole: 'operationsManager'), isFalse);
    expect(show(role: 'customer'), isFalse);
    expect(show(role: ''), isFalse);
  });
}
