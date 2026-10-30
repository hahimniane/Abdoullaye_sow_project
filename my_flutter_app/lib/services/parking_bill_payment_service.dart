import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';

import '../utils/callable_data.dart'
    show callableInt, callableMap, callableString;
import 'parking_bill_payment.dart' show BillPaymentRefusal;
import 'waiting_package_service.dart'
    show ContainerCallableCaller, callContainerCallable;

/// A bill payment the server refused or could not take.
class ParkingBillPaymentFailure implements Exception {
  const ParkingBillPaymentFailure({required this.code, this.reason = ''});

  /// The Functions code (`failed-precondition`, `permission-denied`,
  /// `unavailable`...).
  final String code;

  /// One of [BillPaymentRefusal.all] when the server named it; else ''.
  final String reason;

  bool get offline =>
      code == 'unavailable' ||
      code == 'deadline-exceeded' ||
      code == 'network-request-failed';

  @override
  String toString() => 'ParkingBillPaymentFailure($code $reason)';
}

/// The refusal reason: `details.reason`, else a known reason the message is.
ParkingBillPaymentFailure parseParkingBillPaymentFailure(
  String code,
  Object? details, [
  String? message,
]) {
  var reason = callableString(callableMap(details)['reason']);
  if (reason.isEmpty) {
    final m = (message ?? '').trim();
    if (BillPaymentRefusal.all.contains(m)) reason = m;
  }
  return ParkingBillPaymentFailure(
    code: code.trim().toLowerCase(),
    reason: reason,
  );
}

/// What `bill_payment_record` answers with.
class ParkingBillPaymentRecorded {
  const ParkingBillPaymentRecorded({
    required this.billPaymentId,
    required this.amountCents,
    required this.leftCents,
    required this.receipt,
  });

  factory ParkingBillPaymentRecorded.fromCallable(Object? data) {
    final map = callableMap(data);
    return ParkingBillPaymentRecorded(
      billPaymentId: callableString(map['billPaymentId']),
      amountCents: callableInt(map['amountCents']),
      leftCents: callableInt(map['leftCents']),
      receipt: callableString(map['receipt']),
    );
  }

  final String billPaymentId;
  final int amountCents;
  final int leftCents;

  /// "sent" / "failed" / "skipped" / "" when parking WhatsApp is off.
  final String receipt;
}

/// The two bill-payment actions on `updateBusinessParkingEntry` (no new
/// function), through the caller the other sheets use (timeout and App Check
/// recovery included), so widget tests hand in a fake.
class ParkingBillPaymentService {
  const ParkingBillPaymentService({this.caller = callContainerCallable});

  static const callable = 'updateBusinessParkingEntry';

  final ContainerCallableCaller caller;

  Future<Object?> _call(Map<String, Object?> payload) async {
    try {
      return await caller(
        callable,
        payload,
      ).timeout(const Duration(seconds: 60));
    } on FirebaseFunctionsException catch (error) {
      throw parseParkingBillPaymentFailure(
        error.code,
        error.details,
        error.message,
      );
    } on ParkingBillPaymentFailure {
      rethrow;
    } on TimeoutException {
      throw const ParkingBillPaymentFailure(code: 'unavailable');
    } catch (error) {
      final text = error.toString().toLowerCase();
      final offline =
          text.contains('socket') ||
          text.contains('network') ||
          text.contains('connection');
      throw ParkingBillPaymentFailure(
        code: offline ? 'unavailable' : 'unknown',
      );
    }
  }

  /// `bill_payment_record`: one amount, split oldest first by the server.
  /// [expectedPayableCents] is the preview's payable total; the server
  /// refuses `bill_payment_bill_changed` when the bill moved meanwhile.
  Future<ParkingBillPaymentRecorded> record({
    required String businessId,
    required String monthKey,
    required String customerKey,
    required int amountCents,
    required String receivedVia,
    required String receivedByStaffId,
    required int expectedPayableCents,
    String note = '',
  }) async {
    final data = await _call({
      'action': 'bill_payment_record',
      'businessId': businessId,
      'monthKey': monthKey,
      'customerKey': customerKey,
      'amountCents': amountCents,
      'receivedVia': receivedVia,
      'receivedByStaffId': receivedByStaffId,
      'note': note.trim(),
      'expectedPayableCents': expectedPayableCents,
    });
    return ParkingBillPaymentRecorded.fromCallable(data);
  }

  /// `bill_payment_undo`: the whole payment comes off every car and job it
  /// paid; it stays on file as "Undone".
  Future<void> undo({
    required String businessId,
    required String billPaymentId,
  }) async {
    await _call({
      'action': 'bill_payment_undo',
      'businessId': businessId,
      'billPaymentId': billPaymentId,
    });
  }
}
