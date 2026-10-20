import 'dart:async';

import 'package:my_flutter_app/screens/staff_invite_screen.dart';
import 'package:my_flutter_app/services/staff_invite_service.dart';
import 'package:my_flutter_app/services/staff_invites.dart';

/// Stands in for Firebase behind [StaffInviteService]: records every call
/// and answers (or throws) per callable name.
class FakeInviteCaller {
  final calls = <(String, Map<String, Object?>)>[];
  final answers = <String, Object?>{};
  final errors = <String, Object>{};

  /// When set, every call waits for it.
  Completer<void>? gate;

  Future<Object?> call(String name, Map<String, Object?> payload) async {
    calls.add((name, payload));
    final wait = gate;
    if (wait != null) await wait.future;
    final error = errors[name];
    if (error != null) throw error;
    return answers[name];
  }

  StaffInviteService get service => StaffInviteService(caller: call);

  List<Map<String, Object?>> payloadsOf(String name) => [
    for (final call in calls)
      if (call.$1 == name) call.$2,
  ];
}

/// A [StaffInviteClient] for widget tests (it stands in for AuthProvider).
class FakeStaffInviteClient implements StaffInviteClient {
  FakeStaffInviteClient({
    this.previewAnswer,
    this.previewError,
    this.viewer = StaffInviteViewer.signedOut,
  });

  StaffInvitePreview? previewAnswer;
  Object? previewError;

  @override
  StaffInviteViewer viewer;

  /// Thrown by the next accept (then cleared).
  Object? acceptError;
  Completer<void>? acceptGate;
  final accepted = <String>[];
  int previews = 0;
  int signOuts = 0;
  bool businessAccess = false;

  /// The viewer once signed in through the phone screen (the fake sign-in
  /// cannot change it itself).
  StaffInviteViewer? viewerAfterSignIn;

  @override
  Future<StaffInvitePreview> preview(String token) async {
    previews += 1;
    final error = previewError;
    if (error != null) throw error;
    return previewAnswer!;
  }

  @override
  Future<void> accept(String token) async {
    final after = viewerAfterSignIn;
    if (after != null) viewer = after;
    accepted.add(token);
    final gate = acceptGate;
    if (gate != null) await gate.future;
    final error = acceptError;
    if (error != null) {
      acceptError = null;
      throw error;
    }
    businessAccess = true;
  }

  @override
  Future<void> signOut() async {
    signOuts += 1;
    viewer = StaffInviteViewer.signedOut;
  }

  @override
  bool get hasBusinessDashboardAccess => businessAccess;
}
