import '../models/business_service.dart';
import '../utils/business_permissions.dart';
import 'fleet_requests.dart' show fleetAccess;
import 'fleet_views.dart' show fleetServiceOn;

/// Staff activity alerts (functions `staff_activity_alerts.js`): a push when
/// someone else of the business parks a car or saves a package. The server
/// sends them to the owner(s) and to staff who work in that area, so the
/// switches are shown to exactly those people.

/// "Cars parked by my team": owners, and staff holding `parking`, of a
/// business that offers parking.
bool showParkedCarAlertsSwitch({
  required bool isOwner,
  required bool isStaff,
  required Iterable<String> services,
  required Iterable<String> permissions,
  required String businessId,
}) =>
    businessId.trim().isNotEmpty &&
    services.contains(BusinessServiceKey.carParking.value) &&
    (isOwner || (isStaff && permissions.contains(BusinessPermission.parking)));

/// "Packages saved by my team": owners, and staff holding `containers` or
/// `deliveries`, of a business that ships.
bool showPackageAlertsSwitch({
  required bool isOwner,
  required bool isStaff,
  required Iterable<String> services,
  required Iterable<String> permissions,
  required String businessId,
}) =>
    businessId.trim().isNotEmpty &&
    businessHasShippingService(services) &&
    (isOwner ||
        (isStaff &&
            (permissions.contains(BusinessPermission.containers) ||
                permissions.contains(BusinessPermission.deliveries))));

/// "Fleet alerts" (docs/FLEET.md section 18): the owner and Fleet admins
/// (`fleet_admin`; full-access staff hold it) of a business with Fleet.
bool showFleetAlertsSwitch({
  required bool isStaff,
  required Iterable<String> services,
  required Iterable<String> permissions,
  required String businessId,
}) =>
    businessId.trim().isNotEmpty &&
    fleetServiceOn(services) &&
    fleetAccess(isStaff: isStaff, permissions: permissions).admin;
