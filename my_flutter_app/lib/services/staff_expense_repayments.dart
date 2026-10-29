import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';

import '../utils/callable_data.dart' show callableMap, callableString;
import 'lot_ledger.dart' show lotDateOf;
import 'waiting_package_service.dart'
    show ContainerCallableCaller, callContainerCallable;

/// "Paid back": money the business gave a staff member for the lot expenses
/// they paid out of pocket (docs/STAFF_EXPENSE_CREDIT.md §2, §4). Rows of
/// `staffExpenseRepayments`, written only by `updateLotExpenseEntry`; never
/// deleted - a mistake is voided.
class StaffExpenseRepayment {
  const StaffExpenseRepayment({
    required this.id,
    required this.staffId,
    required this.amountCents,
    required this.month,
    required this.method,
    required this.givenByStaffId,
    required this.note,
    required this.voided,
    this.paidAt,
  });

  factory StaffExpenseRepayment.fromMap(String id, Map<String, dynamic> d) {
    String s(Object? v, [int max = 200]) {
      final t = (v ?? '').toString().trim();
      return t.length > max ? t.substring(0, max) : t;
    }

    final amount = (num.tryParse('${d['amountCents'] ?? ''}') ?? 0).round();
    return StaffExpenseRepayment(
      id: id,
      staffId: s(d['staffId'], 128),
      amountCents: amount > 0 ? amount : 0,
      month: s(d['month'], 7),
      method: s(d['method'], 40),
      givenByStaffId: s(d['givenByStaffId'], 128),
      note: s(d['note'], 500),
      voided: d['voided'] == true,
      paidAt: lotDateOf(d['paidAt']),
    );
  }

  final String id;
  final String staffId;
  final int amountCents;

  /// "yyyy-mm" of [paidAt].
  final String month;

  /// cash · zelle · check · other.
  final String method;
  final String givenByStaffId;
  final String note;
  final bool voided;
  final DateTime? paidAt;
}

/// How a staff member can be paid back (§4).
const staffRepaymentMethods = ['cash', 'zelle', 'check', 'other'];

/// The refusals the repayment actions can send (§4), as `details.reason`.
const staffRepaymentRefusals = {
  'repayment_amount_invalid',
  'repayment_exceeds_credit',
  'repayment_not_found',
  'repayment_voided',
  'repayment_method_invalid',
  'repayment_date_invalid',
  'link_customer_invalid',
  'staff_action_invalid',
  'staff_not_member',
};

class StaffRepaymentFailure implements Exception {
  const StaffRepaymentFailure({required this.code, this.reason = ''});

  /// The Functions code (`failed-precondition`, `unavailable`...).
  final String code;

  /// One of [staffRepaymentRefusals] when the server named it; else ''.
  final String reason;

  bool get offline =>
      code == 'unavailable' ||
      code == 'deadline-exceeded' ||
      code == 'network-request-failed';

  @override
  String toString() => 'StaffRepaymentFailure($code $reason)';
}

/// The refusal reason: `details.reason`, else a known code the message is.
StaffRepaymentFailure parseStaffRepaymentFailure(
  String code,
  Object? details, [
  String? message,
]) {
  var reason = callableString(callableMap(details)['reason']);
  if (reason.isEmpty) {
    final m = (message ?? '').trim();
    if (staffRepaymentRefusals.contains(m)) reason = m;
  }
  return StaffRepaymentFailure(code: code.trim().toLowerCase(), reason: reason);
}

/// The two repayment actions on `updateLotExpenseEntry` (no new export),
/// through the caller the other sheets use, so widget tests hand in a fake.
class StaffExpenseRepaymentService {
  const StaffExpenseRepaymentService({this.caller = callContainerCallable});

  static const callable = 'updateLotExpenseEntry';

  final ContainerCallableCaller caller;

  Future<Object?> _call(Map<String, Object?> payload) async {
    try {
      return await caller(callable, payload);
    } on FirebaseFunctionsException catch (error) {
      throw parseStaffRepaymentFailure(
        error.code,
        error.details,
        error.message,
      );
    } on StaffRepaymentFailure {
      rethrow;
    } on TimeoutException {
      throw const StaffRepaymentFailure(code: 'unavailable');
    } catch (error) {
      final text = error.toString().toLowerCase();
      final offline =
          text.contains('socket') ||
          text.contains('network') ||
          text.contains('connection');
      throw StaffRepaymentFailure(code: offline ? 'unavailable' : 'unknown');
    }
  }

  /// `record_staff_repayment`: cash (or Zelle, check...) given back.
  Future<void> record({
    required String businessId,
    required String staffId,
    required int amountCents,
    required String method,
    required String givenByStaffId,
    String note = '',
  }) async {
    await _call({
      'action': 'record_staff_repayment',
      'businessId': businessId,
      'staffId': staffId,
      'amountCents': amountCents,
      'method': method,
      'givenByStaffId': givenByStaffId,
      'note': note.trim(),
    });
  }

  /// `void_staff_repayment`: the payment counts as not given; kept on file.
  Future<void> voidRepayment({
    required String businessId,
    required String repaymentId,
  }) async {
    await _call({
      'action': 'void_staff_repayment',
      'businessId': businessId,
      'repaymentId': repaymentId,
    });
  }
}
