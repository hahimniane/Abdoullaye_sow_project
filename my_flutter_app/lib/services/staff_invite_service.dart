import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';

import 'phone_accounts.dart' show phoneAccountCallable;
import 'staff_invites.dart';
import 'waiting_package_service.dart'
    show ContainerCallableCaller, callContainerCallable;

/// The staff-invitation calls (docs/STAFF_PHONE_INVITES.md §4), through the
/// caller the container and phone-account sheets use (a stale device token is
/// retried once), so widget tests hand in their own caller. Refusals arrive
/// as [StaffInviteFailure] carrying `details.reason`; screens put them in
/// their own words (`staffInviteRefusalText`).
class StaffInviteService {
  const StaffInviteService({this.caller = callContainerCallable});

  final ContainerCallableCaller caller;

  Future<Object?> _call(String name, Map<String, Object?> payload) async {
    try {
      return await caller(name, payload);
    } on FirebaseFunctionsException catch (error) {
      throw parseStaffInviteFailure(error.code, error.details);
    } on StaffInviteFailure {
      rethrow;
    } on TimeoutException {
      throw const StaffInviteFailure(code: 'unavailable');
    } catch (error) {
      final text = error.toString().toLowerCase();
      final offline =
          text.contains('socket') ||
          text.contains('network') ||
          text.contains('connection');
      throw StaffInviteFailure(code: offline ? 'unavailable' : 'unknown');
    }
  }

  /// `inviteBusinessMember`, by phone (WhatsApp) or email.
  Future<StaffInviteResult> inviteBusinessMember(
    Map<String, Object?> payload,
  ) async => StaffInviteResult.fromCallable(
    await _call('inviteBusinessMember', payload),
  );

  /// `resendAccessInvitation`: a fresh seven days; a phone invitation keeps
  /// its link and tries WhatsApp again.
  Future<StaffInviteResult> resend(String invitationId) async =>
      StaffInviteResult.fromCallable(
        await _call('resendAccessInvitation', {'invitationId': invitationId}),
      );

  Future<void> cancel(String invitationId) async {
    await _call('cancelAccessInvitation', {'invitationId': invitationId});
  }

  /// `listBusinessInvitations`: the business's outstanding invitations.
  Future<List<BusinessInvitation>> list(String businessId) async =>
      businessInvitationsFrom(
        await _call('listBusinessInvitations', {'businessId': businessId}),
      );

  /// What the /j/ link shows; no sign-in needed.
  Future<StaffInvitePreview> preview(String token) async =>
      StaffInvitePreview.fromCallable(
        await _call(phoneAccountCallable, staffInvitePreviewPayload(token)),
      );

  /// `acceptAccessInvitation({action: "pending"})`: the invitations waiting
  /// for the signed-in person (§4.1). Nothing is accepted by listing.
  Future<List<PendingInvitation>> pending() async => pendingInvitationsFrom(
    await _call('acceptAccessInvitation', pendingInvitationsPayload()),
  );

  /// "Join {business}": `acceptAccessInvitation({invitationId})`.
  Future<void> acceptById(String invitationId) async {
    await _call(
      'acceptAccessInvitation',
      acceptInvitationByIdPayload(invitationId),
    );
  }

  /// `acceptAccessInvitation({inviteToken})` by the signed-in account.
  Future<void> accept(String token) async {
    await _call('acceptAccessInvitation', acceptInvitePayload(token));
  }
}
