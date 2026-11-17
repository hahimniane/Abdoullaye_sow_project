import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';

import '../utils/callable_data.dart' show callableMap, callableString;
import 'parking_discount.dart' show discountMessages;
import 'waiting_package_service.dart'
    show ContainerCallableCaller, callContainerCallable;

/// A discount the server refused or could not take.
class ParkingDiscountFailure implements Exception {
  const ParkingDiscountFailure({required this.code, this.reason = ''});

  /// The Functions code (`failed-precondition`, `permission-denied`,
  /// `unavailable`...).
  final String code;

  /// One of [discountMessages]' keys when the server named it; else ''.
  final String reason;

  bool get offline =>
      code == 'unavailable' ||
      code == 'deadline-exceeded' ||
      code == 'network-request-failed';

  bool get notAllowed => code == 'permission-denied';

  @override
  String toString() => 'ParkingDiscountFailure($code $reason)';
}

/// The refusal reason: `details.reason`, else a known reason the message is.
ParkingDiscountFailure parseParkingDiscountFailure(
  String code,
  Object? details, [
  String? message,
]) {
  var reason = callableString(callableMap(details)['reason']);
  if (reason.isEmpty) {
    final m = (message ?? '').trim();
    if (discountMessages.containsKey(m)) reason = m;
  }
  return ParkingDiscountFailure(
    code: code.trim().toLowerCase(),
    reason: reason,
  );
}

/// The three discount actions on `updateBusinessParkingEntry` (no new
/// function; docs/PARKING_DISCOUNT.md), through the caller the other sheets
/// use (timeout and App Check recovery included), so widget tests hand in a
/// fake.
class ParkingDiscountService {
  const ParkingDiscountService({this.caller = callContainerCallable});

  static const callable = 'updateBusinessParkingEntry';

  final ContainerCallableCaller caller;

  Future<Object?> _call(Map<String, Object?> payload) async {
    try {
      return await caller(
        callable,
        payload,
      ).timeout(const Duration(seconds: 60));
    } on FirebaseFunctionsException catch (error) {
      throw parseParkingDiscountFailure(
        error.code,
        error.details,
        error.message,
      );
    } on ParkingDiscountFailure {
      rethrow;
    } on TimeoutException {
      throw const ParkingDiscountFailure(code: 'unavailable');
    } catch (error) {
      final text = error.toString().toLowerCase();
      final offline =
          text.contains('socket') ||
          text.contains('network') ||
          text.contains('connection');
      throw ParkingDiscountFailure(code: offline ? 'unavailable' : 'unknown');
    }
  }

  static String _reason(String reason) {
    final t = reason.trim();
    return t.length > 300 ? t.substring(0, 300) : t;
  }

  /// `discount_give`: a discount alone; the balance left stays to pay later.
  Future<void> give({
    required String entryId,
    required int amountCents,
    required String reason,
  }) async {
    await _call({
      'action': 'discount_give',
      'entryId': entryId,
      'amountCents': amountCents,
      'reason': _reason(reason),
    });
  }

  /// `discount_settle`: a part payment plus a discount for the rest owed
  /// today. [expectedOwedCents] is the preview's owed figure; the server
  /// refuses `discount_owed_changed` when the car moved meanwhile.
  Future<void> settle({
    required String entryId,
    required int paidCents,
    required String receivedVia,
    required String receivedByStaffId,
    required String reason,
    required int expectedOwedCents,
  }) async {
    await _call({
      'action': 'discount_settle',
      'entryId': entryId,
      'paidCents': paidCents,
      'receivedVia': receivedVia,
      'receivedByStaffId': receivedByStaffId,
      'reason': _reason(reason),
      'expectedOwedCents': expectedOwedCents,
    });
  }

  /// `discount_undo`: marks the discount undone (a settle's payment stays).
  Future<void> undo({
    required String entryId,
    required String discountId,
  }) async {
    await _call({
      'action': 'discount_undo',
      'entryId': entryId,
      'discountId': discountId,
    });
  }
}
