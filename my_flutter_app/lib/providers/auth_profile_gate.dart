/// Whether a Firebase auth event for [eventUid] may keep the profile that is
/// already loaded for [loadedProfileUid].
///
/// Signing in runs two things at once: `authenticate()` loads the account's
/// profile (role, business, permissions) itself, and Firebase's
/// `authStateChanges` stream announces the same sign-in a moment later. The
/// announcement used to wipe the profile `authenticate()` had just loaded and
/// start over, so a screen reading the role in that gap saw "no role" and sent
/// a staff member to the customer pages. An event for the account whose
/// profile is already loaded is only a reason to refresh it, never to throw it
/// away. A different account, or a sign-out, always starts clean.
bool authEventKeepsLoadedProfile({
  required String? loadedProfileUid,
  required String? eventUid,
}) {
  if (eventUid == null || eventUid.isEmpty) return false;
  return loadedProfileUid == eventUid;
}
