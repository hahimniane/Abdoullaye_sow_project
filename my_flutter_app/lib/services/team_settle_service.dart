import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';

import '../utils/callable_data.dart' show callableMap, callableString;
import 'team_settle.dart' show SettleRefusal;
import 'waiting_package_service.dart'
    show ContainerCallableCaller, callContainerCallable;

/// A settlement the server refused or could not take.
class TeamSettleFailure implements Exception {
  const TeamSettleFailure({required this.code, this.reason = ''});

  /// The Functions code (`failed-precondition`, `permission-denied`,
  /// `unavailable`...).
  final String code;

  /// One of [SettleRefusal.all] when the server named it; else ''.
  final String reason;

  bool get offline =>
      code == 'unavailable' ||
      code == 'deadline-exceeded' ||
      code == 'network-request-failed';

  bool get notAllowed => code == 'permission-denied';

  @override
  String toString() => 'TeamSettleFailure($code $reason)';
}

/// The refusal reason: `details.reason`, else a known code the message is.
TeamSettleFailure parseTeamSettleFailure(
  String code,
  Object? details, [
  String? message,
]) {
  var reason = callableString(callableMap(details)['reason']);
  if (reason.isEmpty) {
    final m = (message ?? '').trim();
    if (SettleRefusal.all.contains(m)) reason = m;
  }
  return TeamSettleFailure(code: code.trim().toLowerCase(), reason: reason);
}

/// What a settlement action answered.
class TeamSettleResult {
  const TeamSettleResult({this.receipt = '', this.settlementId = ''});

  factory TeamSettleResult.fromCallable(Object? data) {
    final map = callableMap(data);
    return TeamSettleResult(
      receipt: callableString(map['receipt']),
      settlementId: callableString(map['settlementId']),
    );
  }

  /// "sent" / "failed" / "skipped" / "" (no receipt for this action).
  final String receipt;
  final String settlementId;
}

/// The settlement actions on `updateLotExpenseEntry` (no new export;
/// docs/TEAM_SETTLE.md), through the caller the other sheets use, so widget
/// tests hand in a fake.
class TeamSettleService {
  const TeamSettleService({this.caller = callContainerCallable});

  static const callable = 'updateLotExpenseEntry';

  final ContainerCallableCaller caller;

  Future<TeamSettleResult> _call(Map<String, Object?> payload) async {
    try {
      final data = await caller(
        callable,
        payload,
      ).timeout(const Duration(seconds: 60));
      return TeamSettleResult.fromCallable(data);
    } on FirebaseFunctionsException catch (error) {
      throw parseTeamSettleFailure(error.code, error.details, error.message);
    } on TeamSettleFailure {
      rethrow;
    } on TimeoutException {
      throw const TeamSettleFailure(code: 'unavailable');
    } catch (error) {
      final text = error.toString().toLowerCase();
      final offline =
          text.contains('socket') ||
          text.contains('network') ||
          text.contains('connection');
      throw TeamSettleFailure(code: offline ? 'unavailable' : 'unknown');
    }
  }

  static String _note(String note) {
    final t = note.trim();
    return t.length > 300 ? t.substring(0, 300) : t;
  }

  /// `team_settle_request`: file "I paid everything" for [staffId]. Naming
  /// yourself (or the Business account) as the receiver, as the owner or
  /// someone with Full access, confirms it at once.
  Future<TeamSettleResult> request({
    required String businessId,
    required String monthKey,
    required String staffId,
    required int amountCents,
    required String scope,
    required String receiverId,
    required String method,
    String note = '',
  }) => _call({
    'action': 'team_settle_request',
    'businessId': businessId,
    'monthKey': monthKey,
    'staffId': staffId,
    'amountCents': amountCents,
    'scope': scope,
    'receiverId': receiverId,
    'method': method,
    'note': _note(note),
  });

  /// `team_settle_confirm`: the named receiver says they got the money.
  Future<TeamSettleResult> confirm({
    required String businessId,
    required String settlementId,
  }) => _call({
    'action': 'team_settle_confirm',
    'businessId': businessId,
    'settlementId': settlementId,
  });

  /// `team_settle_decline`: nothing changes; the member is told.
  Future<TeamSettleResult> decline({
    required String businessId,
    required String settlementId,
    String note = '',
  }) => _call({
    'action': 'team_settle_decline',
    'businessId': businessId,
    'settlementId': settlementId,
    'note': _note(note),
  });

  /// `team_settle_undo`: voids the hand-over and the bill payment together.
  Future<TeamSettleResult> undo({
    required String businessId,
    required String settlementId,
  }) => _call({
    'action': 'team_settle_undo',
    'businessId': businessId,
    'settlementId': settlementId,
  });

  /// `team_payback`: the business pays the member back (their statement is
  /// negative).
  Future<TeamSettleResult> payback({
    required String businessId,
    required String monthKey,
    required String staffId,
    required int amountCents,
    required String method,
    String note = '',
  }) => _call({
    'action': 'team_payback',
    'businessId': businessId,
    'monthKey': monthKey,
    'staffId': staffId,
    'amountCents': amountCents,
    'method': method,
    'note': _note(note),
  });
}
