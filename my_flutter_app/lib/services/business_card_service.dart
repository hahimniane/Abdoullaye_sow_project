import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';

import '../utils/callable_data.dart';
import 'business_card.dart';
import 'waiting_package_service.dart'
    show ContainerCallableCaller, callContainerCallable;

/// How long a card call may take before the screen says so. Every loading
/// state on the card screen resolves: with the card, or with an error and a
/// retry (docs/ENGINEERING_GUARDRAILS.md §3).
const Duration businessCardTimeout = Duration(seconds: 20);

/// A refused or failed card call, in a form the screen can word.
class BusinessCardFailure implements Exception {
  const BusinessCardFailure({required this.code, this.reason = ''});

  /// The Functions code (`failed-precondition`, `unavailable`...).
  final String code;

  /// `details.reason` when the server named one: `not_team_member`,
  /// `wallet_not_ready`...; else ''.
  final String reason;

  bool get offline =>
      code == 'unavailable' ||
      code == 'deadline-exceeded' ||
      code == 'network-request-failed';

  /// The person is not on a business's team: there is no card to show.
  bool get notTeamMember => reason == 'not_team_member';

  /// The business is not approved yet: no card is shown for it.
  bool get businessNotApproved => reason == 'business_not_approved';

  /// Nothing to retry: the person or the business has no card to show.
  bool get noCard => notTeamMember || businessNotApproved;

  /// The wallet pass cannot be made yet (the server's keys are not set up).
  bool get walletNotReady => reason == 'wallet_not_ready';

  @override
  String toString() => 'BusinessCardFailure($code $reason)';
}

BusinessCardFailure parseBusinessCardFailure(
  String code,
  Object? details, [
  String? message,
]) {
  var reason = callableString(callableMap(details)['reason']);
  if (reason.isEmpty) {
    final m = (message ?? '').trim();
    if (const {
      'not_team_member',
      'wallet_not_ready',
      'business_not_approved',
    }.contains(m)) {
      reason = m;
    }
  }
  return BusinessCardFailure(code: code.trim().toLowerCase(), reason: reason);
}

/// The `businessCards` callable: the signed-in person's own card, and the
/// link that adds it to Apple Wallet or Google Wallet. It goes through the
/// caller the other screens use, so a widget test answers in place of
/// Firebase.
class BusinessCardService {
  const BusinessCardService({
    this.caller = callContainerCallable,
    this.timeout = businessCardTimeout,
  });

  static const callable = 'businessCards';

  final ContainerCallableCaller caller;
  final Duration timeout;

  Future<Object?> _call(Map<String, Object?> payload) async {
    try {
      return await caller(callable, payload).timeout(timeout);
    } on FirebaseFunctionsException catch (error) {
      throw parseBusinessCardFailure(error.code, error.details, error.message);
    } on BusinessCardFailure {
      rethrow;
    } on TimeoutException {
      throw const BusinessCardFailure(code: 'unavailable');
    } catch (error) {
      final text = error.toString().toLowerCase();
      final offline =
          text.contains('socket') ||
          text.contains('network') ||
          text.contains('connection');
      throw BusinessCardFailure(code: offline ? 'unavailable' : 'unknown');
    }
  }

  /// `mine`: the caller's card (code, link, the card as a scan shows it, and
  /// which wallets the server can make a pass for).
  Future<MyCard> mine() async {
    final card = MyCard.fromCallable(await _call({'action': 'mine'}));
    if (card == null) throw const BusinessCardFailure(code: 'unknown');
    return card;
  }

  /// `wallet`: a short-lived https link that adds the card to the wallet of
  /// [platform] (`apple` or `google`). Open it outside the app.
  Future<Uri> walletLink(String platform) async {
    final answer = callableMap(
      await _call({'action': 'wallet', 'platform': platform}),
    );
    final uri = Uri.tryParse(callableString(answer['url']));
    if (uri == null || uri.scheme != 'https' || uri.host.isEmpty) {
      throw const BusinessCardFailure(code: 'unknown');
    }
    return uri;
  }
}
