/// The Team (People) section's staff controls, app side: edit what a staff
/// member can manage, give or remove "Full access", and link a staff
/// member's own "Parking bill" to a parking customer. Pure rules and the
/// requests the callables take, mirroring the console
/// (`admin_web/src/lib/full-access.ts`, `staff-expense-console.ts` and the
/// People page) and the server (`staff_full_access.js`,
/// `staff_expense_ledger.js`). Contracts: docs/STAFF_FULL_ACCESS.md and
/// docs/STAFF_EXPENSE_CREDIT.md. The calls themselves are
/// [TeamStaffService].
library;

import 'package:cloud_functions/cloud_functions.dart';

import '../utils/app_check_recovery.dart';
import 'parking_month_statement.dart' show mostUsedName, parkingCustomerKeyOf;

// ---------------------------------------------------------------------------
// People.
// ---------------------------------------------------------------------------

/// One person of the business's team: a `users` document.
class TeamMember {
  const TeamMember({
    required this.id,
    required this.name,
    required this.email,
    required this.phone,
    required this.role,
    required this.permissions,
    this.fullAccess = false,
    this.imageUrl = '',
    this.inventoryHomeStoreId = '',
    this.inventoryAllStores = false,
  });

  factory TeamMember.fromMap(String id, Map<String, dynamic> data) {
    String text(Object? v) => (v ?? '').toString().trim();
    final held = data['businessPermissions'];
    return TeamMember(
      id: id,
      name: text(data['fullName']),
      email: text(data['email']),
      phone: text(data['phone']),
      role: text(data['role']),
      permissions: held is Iterable
          ? [
              for (final p in held)
                if (text(p).isNotEmpty) text(p),
            ]
          : const [],
      // Only a real true counts, and only on staff (the server's rule).
      fullAccess: text(data['role']) == 'staff' && data['fullAccess'] == true,
      imageUrl: text(data['profileImageUrl']),
      inventoryHomeStoreId: text(data['inventoryHomeStoreId']),
      inventoryAllStores: data['inventoryAllStores'] == true,
    );
  }

  final String id;
  final String name;
  final String email;
  final String phone;
  final String role;
  final List<String> permissions;
  final bool fullAccess;
  final String imageUrl;

  /// Inventory: the store the person works in, and whether in every store.
  final String inventoryHomeStoreId;
  final bool inventoryAllStores;

  bool get isStaff => role == 'staff';
  bool get isOwner => role == 'businessOwner';

  String get displayName => name.isNotEmpty ? name : email;
}

// ---------------------------------------------------------------------------
// Who may do what.
// ---------------------------------------------------------------------------

/// Who may edit a staff member's permissions: the owner (a full-access staff
/// member acts as one) and Laawol's admins. Mirrors the server, which
/// answers anyone else `permission-denied`.
bool mayEditStaffPermissions({required bool isOwner, required bool isAdmin}) =>
    isOwner || isAdmin;

/// Who may give or remove "Full access": the business's REAL owner (never a
/// full-access staff member acting as one) or a platform super admin.
/// Mirrors `fullAccessGrantRefusal`.
bool mayGrantFullAccess({
  required bool isRealOwner,
  required bool isSuperAdmin,
}) => isRealOwner || isSuperAdmin;

/// Who may link a staff member's Parking bill: the real owner or a platform
/// admin. The server answers `link_owner_only` to everyone else, a
/// full-access staff member included (the bank stays the real owner's).
bool mayLinkStaffParking({required bool isRealOwner, required bool isAdmin}) =>
    isRealOwner || isAdmin;

/// The platform role that is a super admin.
const superAdminRole = 'superAdmin';

// ---------------------------------------------------------------------------
// Permissions.
// ---------------------------------------------------------------------------

/// The permissions after one tap: [on] adds [permission], off removes it;
/// everything else the person holds is kept, in order, with no duplicates -
/// including permissions the form no longer offers (the retired Freight),
/// which a save must never silently drop.
List<String> togglePermission(
  Iterable<String> held,
  String permission,
  bool on,
) {
  final next = <String>[];
  for (final p in held) {
    if (!next.contains(p)) next.add(p);
  }
  if (on) {
    if (!next.contains(permission)) next.add(permission);
  } else {
    next.remove(permission);
  }
  return next;
}

/// Whether two permission lists grant the same things (order ignored).
bool samePermissions(Iterable<String> a, Iterable<String> b) {
  final x = a.toSet();
  final y = b.toSet();
  return x.length == y.length && x.containsAll(y);
}

/// `updateBusinessStaffPermissions`: the permissions, and nothing about full
/// access (left out, the server leaves it as it is).
Map<String, Object?> staffPermissionsRequest(
  String businessId,
  String staffUid,
  Iterable<String> permissions,
) => {
  'businessId': businessId,
  'staffUid': staffUid,
  'businessPermissions': permissions.toList(),
};

/// The same callable with the full-access switch; the permissions go along
/// unchanged. Mirrors the console's `fullAccessRequest`.
Map<String, Object?> fullAccessRequest(
  String businessId,
  String staffUid,
  Iterable<String> permissions,
  bool fullAccess,
) => {
  ...staffPermissionsRequest(businessId, staffUid, permissions),
  'fullAccess': fullAccess,
};

// ---------------------------------------------------------------------------
// Refusals, in codes the screen puts into its own words.
// ---------------------------------------------------------------------------

enum TeamRefusal {
  /// Only the real owner or a super admin may change full access.
  fullAccessOwnerOnly,

  /// Full access is for staff of this business.
  fullAccessStaffOnly,

  /// That person is no longer on the team.
  notMember,

  /// Only the owner may link a parking bill.
  linkOwnerOnly,

  /// Choose the parking customer to link.
  linkCustomerInvalid,

  /// The app is out of date for this action.
  actionInvalid,

  /// The account may not do this.
  notAllowed,

  /// Anything else: the network, the server.
  other,
}

/// A callable's rejection read for one of those codes: `details.reason`,
/// `details.reasons`, `details.code`, or a code in the message; the call's
/// own `permission-denied` when none. Never the raw text.
TeamRefusal teamRefusalOf(Object? error) {
  String text(Object? v) => (v ?? '').toString();
  final code = error is FirebaseFunctionsException ? error.code : '';
  final details = error is FirebaseFunctionsException ? error.details : null;
  final message = error is FirebaseFunctionsException ? error.message : '';
  final candidates = <String>[
    if (details is Map) text(details['reason']),
    if (details is Map && details['reasons'] is Iterable)
      for (final r in details['reasons'] as Iterable) text(r),
    if (details is Map) text(details['code']),
    text(message),
  ];
  const codes = <String, TeamRefusal>{
    'full_access_owner_only': TeamRefusal.fullAccessOwnerOnly,
    'full_access_staff_only': TeamRefusal.fullAccessStaffOnly,
    'staff_not_member': TeamRefusal.notMember,
    'link_owner_only': TeamRefusal.linkOwnerOnly,
    'link_customer_invalid': TeamRefusal.linkCustomerInvalid,
    'staff_action_invalid': TeamRefusal.actionInvalid,
  };
  for (final candidate in candidates) {
    if (candidate.isEmpty) continue;
    for (final entry in codes.entries) {
      if (candidate.contains(entry.key)) return entry.value;
    }
  }
  if (code == 'permission-denied') return TeamRefusal.notAllowed;
  return TeamRefusal.other;
}

// ---------------------------------------------------------------------------
// The Parking bill link.
// ---------------------------------------------------------------------------

/// A parking customer as the link picker shows it.
class ParkingLinkCustomer {
  const ParkingLinkCustomer({
    required this.key,
    required this.name,
    required this.phone,
    required this.cars,
  });

  /// `parkingCustomerKey`: the key month-end bills group by.
  final String key;
  final String name;
  final String phone;
  final int cars;
}

/// One choice of the picker: a customer, and whether it is a likely match.
class ParkingLinkChoice {
  const ParkingLinkChoice({required this.customer, required this.suggested});

  final ParkingLinkCustomer customer;
  final bool suggested;
}

String _clean(Object? v, [int max = 200]) {
  final text = (v ?? '').toString().trim();
  return text.length > max ? text.substring(0, max) : text;
}

String _last10(Object? v) {
  final digits = _clean(v, 40).replaceAll(RegExp(r'\D+'), '');
  return digits.length > 10 ? digits.substring(digits.length - 10) : digits;
}

/// The business's parking customers, one per customer key (the phone, else
/// the name), each with the name used most and how many cars; by name.
/// Cancelled stays and rows with neither a name nor a phone are left out.
/// Mirrors `parkingLinkCustomers`.
List<ParkingLinkCustomer> parkingLinkCustomers(
  Iterable<Map<String, dynamic>> cars,
) {
  final groups = <String, _Group>{};
  var anonymous = 0;
  for (final row in cars) {
    if (_clean(row['status'], 40) == 'cancelled') continue;
    final name = _clean(row['customerName']).isNotEmpty
        ? _clean(row['customerName'])
        : _clean(row['ownerName']);
    final phone = _clean(row['customerPhone'], 40);
    if (name.isEmpty && phone.isEmpty) continue;
    final key = parkingCustomerKeyOf(phone, name);
    final group = groups.putIfAbsent(key, _Group.new);
    if (name.isNotEmpty) group.names.add(name);
    if (group.phone.isEmpty && phone.isNotEmpty) group.phone = phone;
    final id = _clean(row['id']);
    group.ids.add(id.isEmpty ? 'row${anonymous++}' : id);
  }
  final out = [
    for (final e in groups.entries)
      ParkingLinkCustomer(
        key: e.key,
        name: mostUsedName(e.value.names),
        phone: e.value.phone,
        cars: e.value.ids.length,
      ),
  ];
  out.sort((a, b) {
    final byName = a.name.toLowerCase().compareTo(b.name.toLowerCase());
    return byName != 0 ? byName : a.key.compareTo(b.key);
  });
  return out;
}

class _Group {
  final names = <String>[];
  final ids = <String>{};
  String phone = '';
}

List<String> _tokens(Object? name) => _clean(name)
    .toLowerCase()
    .split(RegExp(r'[^a-z0-9]+'))
    .where((t) => t.length >= 2)
    .toList();

/// How well a parking customer matches a staff member: the same phone (last
/// ten digits) beats everything; then names that share a word, a word that
/// starts the other counting less. 0 = no match. Mirrors `parkingLinkScore`.
int parkingLinkScore(
  ({String name, String phone}) staff,
  ParkingLinkCustomer customer,
) {
  var score = 0;
  final a = _last10(staff.phone);
  final b = _last10(customer.phone);
  if (a.length >= 7 && a == b) score += 100;
  final mine = _tokens(staff.name);
  for (final theirs in _tokens(customer.name)) {
    if (mine.contains(theirs)) {
      score += 10;
    } else if (theirs.length >= 3 &&
        mine.any(
          (m) =>
              m.length >= 3 && (m.startsWith(theirs) || theirs.startsWith(m)),
        )) {
      score += 4;
    }
  }
  return score;
}

/// The picker's list: suggestions first (best match first), then everyone by
/// name; [search] narrows by name, or by at least three digits of a phone.
List<ParkingLinkChoice> parkingLinkChoices(
  ({String name, String phone}) staff,
  Iterable<ParkingLinkCustomer> customers, {
  String search = '',
}) {
  final q = _clean(search).toLowerCase();
  final qDigits = q.replaceAll(RegExp(r'\D+'), '');
  final scored = [
    for (final c in customers)
      if (q.isEmpty ||
          c.name.toLowerCase().contains(q) ||
          (qDigits.length >= 3 && _last10(c.phone).contains(qDigits)))
        (customer: c, score: parkingLinkScore(staff, c)),
  ];
  final suggested =
      [
        for (final s in scored)
          if (s.score > 0) s,
      ]..sort((x, y) {
        final byScore = y.score.compareTo(x.score);
        return byScore != 0
            ? byScore
            : x.customer.name.compareTo(y.customer.name);
      });
  final rest = [
    for (final s in scored)
      if (s.score <= 0) s,
  ];
  return [
    for (final s in suggested)
      ParkingLinkChoice(customer: s.customer, suggested: true),
    for (final s in rest)
      ParkingLinkChoice(customer: s.customer, suggested: false),
  ];
}

/// `updateLotExpenseEntry` with `link_staff_parking`; a null [customer]
/// unlinks (`customerKey: ""`). Mirrors `staffParkingLinkRequest`.
Map<String, Object?> staffParkingLinkRequest(
  String businessId,
  String staffId,
  ParkingLinkCustomer? customer,
) => {
  'action': 'link_staff_parking',
  'businessId': businessId,
  'staffId': staffId,
  'customerKey': customer?.key ?? '',
  'customerName': customer?.name ?? '',
  'customerPhone': customer?.phone ?? '',
};

/// `businesses/{id}.staffParkingLinks[staffId]`: who a staff member's
/// parking bill is, or null when not linked.
class StaffParkingLink {
  const StaffParkingLink({
    required this.customerKey,
    this.customerName = '',
    this.customerPhone = '',
  });

  final String customerKey;
  final String customerName;
  final String customerPhone;

  /// What names the customer: the name, else the phone, else the key.
  String get label => customerName.isNotEmpty
      ? customerName
      : (customerPhone.isNotEmpty ? customerPhone : customerKey);

  static StaffParkingLink? fromLinks(Object? links, String staffId) {
    if (links is! Map) return null;
    final link = links[staffId];
    if (link is! Map) return null;
    final key = _clean(link['customerKey']);
    if (key.isEmpty) return null;
    return StaffParkingLink(
      customerKey: key,
      customerName: _clean(link['customerName']),
      customerPhone: _clean(link['customerPhone'], 40),
    );
  }
}

/// How far back the picker reads parked cars: twelve months.
int parkingLinkSinceMs(DateTime now) =>
    DateTime(now.year, now.month - 12, 1).millisecondsSinceEpoch;

// ---------------------------------------------------------------------------
// The calls.
// ---------------------------------------------------------------------------

/// Calls a Cloud Function and hands back its data; a fake in tests.
typedef TeamCallableCaller =
    Future<Object?> Function(String name, Map<String, Object?> payload);

Future<Object?> callTeamCallable(
  String name,
  Map<String, Object?> payload,
) async {
  final response = await callWithAppCheckRecovery(
    () => FirebaseFunctions.instance.httpsCallable(name).call<Object?>(payload),
  );
  return response.data;
}

/// The team's three writes, each a callable the website already uses.
class TeamStaffService {
  const TeamStaffService({this.caller = callTeamCallable});

  final TeamCallableCaller caller;

  Future<void> savePermissions(
    String businessId,
    String staffUid,
    Iterable<String> permissions,
  ) async {
    await caller(
      'updateBusinessStaffPermissions',
      staffPermissionsRequest(businessId, staffUid, permissions),
    );
  }

  Future<void> setFullAccess(
    String businessId,
    String staffUid,
    Iterable<String> permissions, {
    required bool on,
  }) async {
    await caller(
      'updateBusinessStaffPermissions',
      fullAccessRequest(businessId, staffUid, permissions, on),
    );
  }

  Future<void> linkParking(
    String businessId,
    String staffId,
    ParkingLinkCustomer? customer,
  ) async {
    await caller(
      'updateLotExpenseEntry',
      staffParkingLinkRequest(businessId, staffId, customer),
    );
  }
}
