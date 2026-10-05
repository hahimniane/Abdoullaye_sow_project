/// Keeps a slow profile/role lookup from landing on the wrong account.
///
/// The role lookup awaits a token refresh and one or more Firestore reads.
/// If the person signs out - or another account signs in - while it is
/// running, the old answer used to arrive afterwards and write the previous
/// account's role, business and admin access onto the new session.
///
/// Each lookup takes a ticket for the uid it started for ([begin]) and, after
/// every await, asks whether it is still the newest lookup for the account
/// that is signed in now ([AuthLookupTicket.isCurrent]). Signing out or a
/// newer lookup ([invalidate] / a later [begin]) retires every older ticket.
///
/// Pure - no Firebase - so it is unit-tested directly; AuthProvider builds
/// Firebase in its field initialisers and cannot be constructed in a test.
class AuthLookupGuard {
  int _generation = 0;

  /// Starts a lookup for [uid], retiring any lookup already running.
  AuthLookupTicket begin(String uid) {
    _generation += 1;
    return AuthLookupTicket._(this, _generation, uid);
  }

  /// Retires every running lookup (sign-out).
  void invalidate() => _generation += 1;
}

class AuthLookupTicket {
  AuthLookupTicket._(this._guard, this._generation, this.uid);

  final AuthLookupGuard _guard;
  final int _generation;

  /// The account the lookup started for.
  final String uid;

  /// Whether this lookup may still apply its result: it is the newest one,
  /// and [currentUid] - who is signed in right now - is the account it
  /// started for.
  bool isCurrent(String? currentUid) =>
      _guard._generation == _generation && currentUid == uid;
}
