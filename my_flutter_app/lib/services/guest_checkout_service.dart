import 'package:firebase_auth/firebase_auth.dart';

/// Contact details a customer gives when they book without an account.
///
/// A guest holds an anonymous Firebase session, which carries no email and no
/// phone, so everything the business needs to reach them travels with the
/// booking instead.
class GuestContact {
  const GuestContact({
    required this.name,
    required this.email,
    required this.phone,
  });

  final String name;
  final String email;
  final String phone;

  Map<String, String> toJson() => {
    'name': name,
    'email': email,
    'phone': phone,
  };
}

/// Which field of a guest's details is not yet usable.
enum GuestContactField { name, email, phone }

/// Deliberately permissive, and the same shape the backend applies. Whether
/// an address exists is settled by the confirmation email arriving, not by a
/// regular expression.
final RegExp _emailShape = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]{2,}$');

const int _nameMax = 120;
const int _emailMax = 254;

String _clean(String value, int max) {
  final trimmed = value.trim();
  return trimmed.length <= max ? trimmed : trimmed.substring(0, max);
}

/// The backend's rule: seven to fifteen digits, optionally led by a plus.
/// Formatting the customer typed is theirs to type and ours to drop.
String normalizeGuestPhone(String value) {
  final raw = _clean(value, 64);
  if (raw.isEmpty || RegExp(r'[A-Za-z]').hasMatch(raw)) return '';
  final normalized = raw.replaceAll(RegExp(r'[\s().-]'), '');
  if (!RegExp(r'^\+?\d+$').hasMatch(normalized)) return '';
  final digits = normalized.replaceAll(RegExp(r'\D'), '');
  if (digits.length < 7 || digits.length > 15) return '';
  return normalized;
}

GuestContact normalizeGuestContact({
  required String name,
  required String email,
  required String phone,
}) {
  return GuestContact(
    name: _clean(name, _nameMax),
    email: _clean(email, _emailMax).toLowerCase(),
    phone: normalizeGuestPhone(phone),
  );
}

/// Names every field that is not yet usable, so the form can mark all of them
/// at once rather than revealing one problem per attempt.
List<GuestContactField> guestContactProblems({
  required String name,
  required String email,
  required String phone,
}) {
  final contact = normalizeGuestContact(
    name: name,
    email: email,
    phone: phone,
  );
  return [
    if (contact.name.isEmpty) GuestContactField.name,
    if (!_emailShape.hasMatch(contact.email)) GuestContactField.email,
    if (contact.phone.isEmpty) GuestContactField.phone,
  ];
}

/// Holds the guest's details for the life of the booking.
///
/// In memory rather than on disk: the app never leaves the process during
/// checkout the way the web does for Stripe, and a contact that outlived the
/// session would attach itself to somebody else's next booking on a shared
/// phone.
class GuestCheckoutSession {
  GuestCheckoutSession({FirebaseAuth? auth}) : _injectedAuth = auth;

  final FirebaseAuth? _injectedAuth;
  GuestContact? _contact;

  /// Resolved on use rather than in the constructor: the app builds this
  /// session at import time, before Firebase has been initialized, and the
  /// contact rules are worth testing without a Firebase app standing up.
  FirebaseAuth get _auth => _injectedAuth ?? FirebaseAuth.instance;

  GuestContact? get contact => _contact;

  bool get isGuest {
    try {
      return _auth.currentUser?.isAnonymous ?? false;
    } on Object {
      // No Firebase app yet means no session of any kind, guest included.
      return false;
    }
  }

  /// True when this is a guest whose details the app no longer holds.
  ///
  /// The anonymous session is kept in the keychain and outlives the app; the
  /// contact was only ever in memory. A guest coming back is therefore still
  /// a guest and still needs to be asked, or the booking reaches the server
  /// with nothing to reach them by.
  bool get needsContact => isGuest && _contact == null;

  /// Starts an anonymous session so the booking has an identity, without the
  /// customer choosing a password or verifying an email.
  Future<void> begin(GuestContact contact) async {
    _contact = contact;
    if (!isGuest) {
      await _auth.signInAnonymously();
    }
  }

  void clear() {
    _contact = null;
  }

  /// The block a callable payload carries. Empty for a signed-in customer, so
  /// a stale contact can never redirect a real account's receipts.
  Map<String, dynamic> payloadFields() {
    final current = _contact;
    if (!isGuest || current == null) return const {};
    return {'guestContact': current.toJson()};
  }
}

/// The one session the app books through.
final GuestCheckoutSession guestCheckout = GuestCheckoutSession();
