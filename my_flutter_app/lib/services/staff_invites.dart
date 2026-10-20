// Staff invited by phone (docs/STAFF_PHONE_INVITES.md): the pure half. The
// invitation form's request, the answers of the invitation callables, the
// owner's invitation rows, the /j/ link, what the invitation screen shows,
// the refusals, and when a live profile has lost its business access. No
// Firebase here (test/staff_invites_test.dart); the calls live in
// staff_invite_service.dart.

import '../utils/callable_data.dart';
import 'package_codes.dart' show packageLinkHost;

// ---------------------------------------------------------------------------
// The link: https://customer.laawoldigital.com/j/<43-char token>.
// ---------------------------------------------------------------------------

const staffInviteLinkSegment = 'j';

final _inviteToken = RegExp(r'^[A-Za-z0-9_-]{43}$');

bool isStaffInviteToken(String value) => _inviteToken.hasMatch(value);

/// The token of a staff invitation link, or null for any other link: the
/// path form `/j/<token>` and the form the website forwards to
/// (`/?service=staff-invite&j=<token>`), on the customer host only.
String? staffInviteTokenFromUri(Uri? uri) {
  if (uri == null) return null;
  final scheme = uri.scheme.toLowerCase();
  if (scheme != 'https' && scheme != 'http') return null;
  if (uri.host.toLowerCase() != packageLinkHost) return null;
  final segments = uri.pathSegments.where((s) => s.isNotEmpty).toList();
  if (segments.length == 2 &&
      segments.first.toLowerCase() == staffInviteLinkSegment) {
    return isStaffInviteToken(segments[1]) ? segments[1] : null;
  }
  if (segments.isEmpty && uri.queryParameters['service'] == 'staff-invite') {
    final token = uri.queryParameters['j'] ?? '';
    return isStaffInviteToken(token) ? token : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The invitation form (inviteBusinessMember).
// ---------------------------------------------------------------------------

abstract final class StaffInviteChannel {
  static const phone = 'phone';
  static const email = 'email';
}

enum StaffInviteMethod { phone, email }

/// "Which store?": every store, or one. Only asked (and only sent) when the
/// business has two or more active stores.
class StaffInviteStoreChoice {
  const StaffInviteStoreChoice.allStores() : allStores = true, homeStoreId = '';

  const StaffInviteStoreChoice.store(this.homeStoreId) : allStores = false;

  final bool allStores;
  final String homeStoreId;

  /// A choice the server accepts: all stores, or one named store.
  bool get isComplete => allStores || homeStoreId.trim().isNotEmpty;

  Map<String, Object?> toPayload() => allStores
      ? {'allStores': true}
      : {'allStores': false, 'homeStoreId': homeStoreId.trim()};
}

/// The `inviteBusinessMember` data for the form. [storeChoice] is sent only
/// when [multiStore] - a single-store business is never asked.
Map<String, Object?> businessInvitePayload({
  required String businessId,
  required String fullName,
  required StaffInviteMethod method,
  required String phone,
  required String email,
  required List<String> businessPermissions,
  required String locale,
  bool multiStore = false,
  StaffInviteStoreChoice? storeChoice,
}) => {
  'businessId': businessId,
  'fullName': fullName.trim(),
  'method': method == StaffInviteMethod.phone
      ? StaffInviteChannel.phone
      : StaffInviteChannel.email,
  if (method == StaffInviteMethod.phone) 'phone': phone.trim(),
  if (method == StaffInviteMethod.email) 'email': email.trim(),
  'businessPermissions': businessPermissions,
  if (multiStore && storeChoice != null && storeChoice.isComplete)
    'inventoryStoreAccess': storeChoice.toPayload(),
  'locale': locale == 'fr' ? 'fr' : 'en',
};

/// The answer of `inviteBusinessMember` / `resendAccessInvitation`.
class StaffInviteResult {
  const StaffInviteResult({
    this.invitationId = '',
    this.channel = StaffInviteChannel.email,
    this.phoneMasked = '',
    this.status = '',
    this.inviteLink = '',
    this.expiresAtMs = 0,
    this.whatsappSent = false,
    this.whatsappStatus = '',
  });

  final String invitationId;
  final String channel;
  final String phoneMasked;
  final String status;
  final String inviteLink;
  final int expiresAtMs;
  final bool whatsappSent;

  /// sent | not_configured | template_pending | failed ('' for email).
  final String whatsappStatus;

  bool get isPhone => channel == StaffInviteChannel.phone;

  /// "WhatsApp message not sent yet - share this link": a phone invitation
  /// the message did not reach. Not an error - the link works.
  bool get needsShare => isPhone && !whatsappSent && inviteLink.isNotEmpty;

  factory StaffInviteResult.fromCallable(Object? raw) {
    final d = callableMap(raw);
    return StaffInviteResult(
      invitationId: callableString(d['invitationId']),
      channel: callableString(d['channel']) == StaffInviteChannel.phone
          ? StaffInviteChannel.phone
          : StaffInviteChannel.email,
      phoneMasked: callableString(d['phoneMasked']),
      status: callableString(d['status']),
      inviteLink: callableString(d['inviteLink']),
      expiresAtMs: callableInt(d['expiresAtMs']),
      whatsappSent: callableBool(d['whatsappSent']),
      whatsappStatus: callableString(d['whatsappStatus']),
    );
  }
}

// ---------------------------------------------------------------------------
// The owner's invitations (listBusinessInvitations).
// ---------------------------------------------------------------------------

abstract final class StaffInviteStatus {
  static const pending = 'pending';
  static const expired = 'expired';
  static const cancelled = 'cancelled';
  static const accepted = 'accepted';
}

class BusinessInvitation {
  const BusinessInvitation({
    required this.invitationId,
    this.channel = StaffInviteChannel.email,
    this.fullName = '',
    this.email = '',
    this.phoneMasked = '',
    this.inviteLink = '',
    this.whatsappStatus = '',
    this.status = StaffInviteStatus.pending,
    this.expiresAtMs = 0,
  });

  final String invitationId;
  final String channel;
  final String fullName;
  final String email;
  final String phoneMasked;
  final String inviteLink;
  final String whatsappStatus;

  /// The derived status: pending | expired | cancelled | accepted.
  final String status;
  final int expiresAtMs;

  bool get isPhone => channel == StaffInviteChannel.phone;
  bool get isPending => status == StaffInviteStatus.pending;

  /// Resend gives a fresh seven days: pending and expired rows.
  bool get canResend =>
      status == StaffInviteStatus.pending ||
      status == StaffInviteStatus.expired;

  /// The note "WhatsApp message not sent yet - share this link".
  bool get whatsappNotSent =>
      isPhone && whatsappStatus != 'sent' && inviteLink.isNotEmpty;

  /// The masked number or the email: who it went to.
  String get contact => isPhone ? phoneMasked : email;

  DateTime? get expiresAt =>
      expiresAtMs > 0 ? DateTime.fromMillisecondsSinceEpoch(expiresAtMs) : null;

  static BusinessInvitation? fromCallable(Object? raw) {
    final d = callableMap(raw);
    final id = callableString(d['invitationId']);
    if (id.isEmpty) return null;
    return BusinessInvitation(
      invitationId: id,
      channel: callableString(d['channel']) == StaffInviteChannel.phone
          ? StaffInviteChannel.phone
          : StaffInviteChannel.email,
      fullName: callableString(d['fullName']),
      email: callableString(d['email']),
      phoneMasked: callableString(d['phoneMasked']),
      inviteLink: callableString(d['inviteLink']),
      whatsappStatus: callableString(d['whatsappStatus']),
      status: callableString(d['status'], StaffInviteStatus.pending),
      expiresAtMs: callableInt(d['expiresAtMs']),
    );
  }
}

/// `{invitations: [...]}` -> the rows, unreadable ones dropped.
List<BusinessInvitation> businessInvitationsFrom(Object? raw) {
  final rows = callableMap(raw)['invitations'];
  if (rows is! List) return const [];
  return [for (final row in rows) ?BusinessInvitation.fromCallable(row)];
}

// ---------------------------------------------------------------------------
// The invitation screen (/j/<token>).
// ---------------------------------------------------------------------------

/// `phoneAccount {action: "staffInvite", token}`: who invited, to which
/// business, and the last two digits of the number - never the number.
class StaffInvitePreview {
  const StaffInvitePreview({
    required this.invitationId,
    required this.status,
    this.businessId = '',
    this.businessName = '',
    this.invitedByName = '',
    this.fullName = '',
    this.phoneLastTwo = '',
    this.expiresAtMs = 0,
  });

  final String invitationId;
  final String status;
  final String businessId;
  final String businessName;
  final String invitedByName;
  final String fullName;
  final String phoneLastTwo;
  final int expiresAtMs;

  bool get isPending => status == StaffInviteStatus.pending;

  factory StaffInvitePreview.fromCallable(Object? raw) {
    final d = callableMap(raw);
    final lastTwo = callableString(d['phoneLastTwo']);
    return StaffInvitePreview(
      invitationId: callableString(d['invitationId']),
      status: callableString(d['status'], StaffInviteStatus.expired),
      businessId: callableString(d['businessId']),
      businessName: callableString(d['businessName']),
      invitedByName: callableString(d['invitedByName']),
      fullName: callableString(d['fullName']),
      phoneLastTwo: RegExp(r'^\d{1,4}$').hasMatch(lastTwo) ? lastTwo : '',
      expiresAtMs: callableInt(d['expiresAtMs']),
    );
  }
}

Map<String, Object?> staffInvitePreviewPayload(String token) => {
  'action': 'staffInvite',
  'token': token.trim(),
};

/// Who is looking at the invitation.
class StaffInviteViewer {
  const StaffInviteViewer({
    this.signedIn = false,
    this.anonymous = false,
    this.phoneNumber = '',
  });

  static const signedOut = StaffInviteViewer();

  final bool signedIn;
  final bool anonymous;

  /// The Auth account's number ('' for none); only ever set through proof.
  final String phoneNumber;
}

enum StaffInviteView {
  /// Expired, cancelled, accepted or unknown: ask the business again.
  closed,

  /// Nobody (or a guest) is signed in: "Accept with the number ending in ••35".
  signInToAccept,

  /// Signed in with that number: "Accept invitation".
  acceptAsSignedIn,

  /// Signed in as another account: "Sign out to continue".
  otherAccount,
}

/// The number's last digits match the invitation's.
bool phoneEndsWith(String phone, String lastTwo) {
  final digits = phone.replaceAll(RegExp(r'\D'), '');
  return lastTwo.isNotEmpty &&
      digits.length > lastTwo.length &&
      digits.endsWith(lastTwo);
}

StaffInviteView staffInviteView(
  StaffInvitePreview? preview,
  StaffInviteViewer viewer,
) {
  if (preview == null || !preview.isPending) return StaffInviteView.closed;
  if (!viewer.signedIn || viewer.anonymous) {
    return StaffInviteView.signInToAccept;
  }
  return phoneEndsWith(viewer.phoneNumber, preview.phoneLastTwo)
      ? StaffInviteView.acceptAsSignedIn
      : StaffInviteView.otherAccount;
}

Map<String, Object?> acceptInvitePayload(String token) => {
  'inviteToken': token.trim(),
};

// ---------------------------------------------------------------------------
// Refusals (details.reason), mapped to words in staff_invite_widgets.dart.
// ---------------------------------------------------------------------------

abstract final class StaffInviteReason {
  // inviteBusinessMember / resendAccessInvitation.
  static const fullNameRequired = 'full-name-required';
  static const validPhoneRequired = 'valid-phone-required';
  static const phoneCountryCodeRequired = 'phone-country-code-required';
  static const validEmailRequired = 'valid-email-required';
  static const storeAccessInvalid = 'store-access-invalid';
  static const storeNotFound = 'store-not-found';
  static const existingAuthorityConflict = 'existing-authority-conflict';
  static const invitationAlreadyPending = 'invitation-already-pending';
  static const businessOwnerRequired = 'business-owner-required';
  static const businessRequired = 'business-required';
  static const businessNotFound = 'business-not-found';

  // acceptAccessInvitation.
  static const activeInvitationNotFound = 'active-invitation-not-found';
  static const invitationSelectionRequired = 'invitation-selection-required';
  static const invitationExpired = 'invitation-expired';
  static const invitationNotPending = 'invitation-not-pending';
  static const invitationIdentityMismatch = 'invitation-identity-mismatch';
  static const verifiedEmailRequired = 'verified-email-required';

  // phoneAccount staffInvite / requestPhoneLoginCode({inviteToken}).
  static const inviteNotFound = 'invite_not_found';

  static const all = [
    fullNameRequired,
    validPhoneRequired,
    phoneCountryCodeRequired,
    validEmailRequired,
    storeAccessInvalid,
    storeNotFound,
    existingAuthorityConflict,
    invitationAlreadyPending,
    businessOwnerRequired,
    businessRequired,
    businessNotFound,
    activeInvitationNotFound,
    invitationSelectionRequired,
    invitationExpired,
    invitationNotPending,
    invitationIdentityMismatch,
    verifiedEmailRequired,
    inviteNotFound,
  ];
}

/// A refused invitation call, or one that never got through.
class StaffInviteFailure implements Exception {
  const StaffInviteFailure({required this.code, this.reason = ''});

  /// The Functions code (`not-found`, `unavailable`...); `unknown` when none.
  final String code;

  /// `details.reason`; '' when none came.
  final String reason;

  bool get offline =>
      code == 'unavailable' ||
      code == 'deadline-exceeded' ||
      code == 'network-request-failed';

  @override
  String toString() => 'StaffInviteFailure($code $reason)';
}

StaffInviteFailure parseStaffInviteFailure(String code, Object? details) =>
    StaffInviteFailure(
      code: code.trim().toLowerCase(),
      reason: callableString(callableMap(details)['reason']),
    );

// ---------------------------------------------------------------------------
// Removal: the live profile lost business or platform access.
// ---------------------------------------------------------------------------

/// The part of a profile that carries authority.
class ProfileAuthority {
  const ProfileAuthority({this.role = '', this.businessId = ''});

  final String role;
  final String businessId;
}

const _businessRoles = {'staff', 'businessOwner'};

/// Whether a session that had business or platform access just lost it
/// (mirrors the server's `accessRemoved`, plus a profile that disappeared):
/// role now customer (or none), a business role moved to another business,
/// or no profile at all. The app then forces a token refresh at once; the
/// server revoked the refresh tokens, so the refresh fails and the app signs
/// out (docs/STAFF_PHONE_INVITES.md §5).
bool profileAccessLost(ProfileAuthority before, ProfileAuthority? after) {
  final was = before.role.trim();
  if (!_businessRoles.contains(was) && was != 'admin') return false;
  if (after == null) return true;
  final now = after.role.trim();
  if (now.isEmpty || now == 'customer') return true;
  if (_businessRoles.contains(was)) {
    if (!_businessRoles.contains(now)) return true;
    return before.businessId.trim() != after.businessId.trim();
  }
  return false;
}

// ---------------------------------------------------------------------------
// The "Join {business}" prompt after a normal sign-in (§4.1).
// ---------------------------------------------------------------------------

Map<String, Object?> pendingInvitationsPayload() => {'action': 'pending'};

Map<String, Object?> acceptInvitationByIdPayload(String invitationId) => {
  'invitationId': invitationId.trim(),
};

/// A live invitation waiting for the signed-in person's verified email or
/// phone. Nothing is accepted by listing it.
class PendingInvitation {
  const PendingInvitation({
    required this.invitationId,
    this.kind = 'business',
    this.channel = StaffInviteChannel.email,
    this.businessId = '',
    this.businessName = '',
    this.invitedByName = '',
    this.expiresAtMs = 0,
  });

  final String invitationId;

  /// business | platform (Laawol Digital administration).
  final String kind;
  final String channel;
  final String businessId;
  final String businessName;
  final String invitedByName;
  final int expiresAtMs;

  bool get isPlatform => kind == 'platform';

  static PendingInvitation? fromCallable(Object? raw) {
    final d = callableMap(raw);
    final id = callableString(d['invitationId']);
    if (id.isEmpty) return null;
    return PendingInvitation(
      invitationId: id,
      kind: callableString(d['kind']) == 'platform' ? 'platform' : 'business',
      channel: callableString(d['channel']) == StaffInviteChannel.phone
          ? StaffInviteChannel.phone
          : StaffInviteChannel.email,
      businessId: callableString(d['businessId']),
      businessName: callableString(d['businessName']),
      invitedByName: callableString(d['invitedByName']),
      expiresAtMs: callableInt(d['expiresAtMs']),
    );
  }
}

List<PendingInvitation> pendingInvitationsFrom(Object? raw) {
  final rows = callableMap(raw)['invitations'];
  if (rows is! List) return const [];
  final seen = <String>{};
  return [
    for (final row in rows)
      if (PendingInvitation.fromCallable(row) case final invite?)
        if (seen.add(invite.invitationId)) invite,
  ];
}

/// The invitations still to offer: those not put off with "Not now".
List<PendingInvitation> visiblePendingInvitations(
  List<PendingInvitation> all,
  Set<String> dismissed,
) => [
  for (final invite in all)
    if (!dismissed.contains(invite.invitationId)) invite,
];

/// What the prompt remembers for one sign-in, in memory: the list it read
/// once, and the invitations put off with "Not now". Another account (or a
/// new sign-in) starts afresh.
class PendingInvitationsMemory {
  String? _uid;
  Future<List<PendingInvitation>>? _load;
  final Set<String> _dismissed = {};

  static final PendingInvitationsMemory instance = PendingInvitationsMemory();

  Set<String> get dismissed => Set.unmodifiable(_dismissed);

  /// The pending invitations of [uid], read once per sign-in.
  Future<List<PendingInvitation>> pendingFor(
    String uid,
    Future<List<PendingInvitation>> Function() read,
  ) {
    if (_uid != uid) {
      _uid = uid;
      _dismissed.clear();
      _load = null;
    }
    return _load ??= read().catchError((Object _) {
      // A failed read is tried again the next time the home opens.
      _load = null;
      return const <PendingInvitation>[];
    });
  }

  void dismiss(String invitationId) => _dismissed.add(invitationId);

  /// Signed out: the next sign-in asks again.
  void forget() {
    _uid = null;
    _load = null;
    _dismissed.clear();
  }
}
