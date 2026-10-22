import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/services/staff_activity_alerts.dart';

// The switches are shown to exactly the people the server tells
// (functions staff_activity_alerts.js planActivityRecipients).
void main() {
  bool cars({
    bool isOwner = false,
    bool isStaff = true,
    List<String> services = const ['carParking'],
    List<String> permissions = const ['parking'],
    String businessId = 'biz',
  }) => showParkedCarAlertsSwitch(
    isOwner: isOwner,
    isStaff: isStaff,
    services: services,
    permissions: permissions,
    businessId: businessId,
  );

  bool packages({
    bool isOwner = false,
    bool isStaff = true,
    List<String> services = const ['barrelShipping'],
    List<String> permissions = const ['containers'],
    String businessId = 'biz',
  }) => showPackageAlertsSwitch(
    isOwner: isOwner,
    isStaff: isStaff,
    services: services,
    permissions: permissions,
    businessId: businessId,
  );

  test('cars parked: owners and parking staff of a lot', () {
    expect(cars(), isTrue);
    expect(cars(isOwner: true, isStaff: false, permissions: []), isTrue);
    expect(cars(permissions: ['containers']), isFalse);
    expect(cars(services: ['barrelShipping']), isFalse);
    expect(cars(businessId: ''), isFalse);
    // A customer is neither owner nor staff.
    expect(cars(isStaff: false), isFalse);
  });

  test('packages saved: owners, containers and deliveries staff', () {
    expect(packages(), isTrue);
    expect(packages(permissions: ['deliveries']), isTrue);
    expect(packages(isOwner: true, isStaff: false, permissions: []), isTrue);
    expect(packages(permissions: ['parking', 'ledger']), isFalse);
    expect(packages(services: ['inventory']), isFalse);
    expect(packages(businessId: ' '), isFalse);
    expect(packages(isStaff: false), isFalse);
  });
}
