import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';

import 'container_delivery.dart';
import 'waiting_package_service.dart'
    show ContainerCallableCaller, callContainerCallable;

/// Marking a package delivered and undoing it (docs/WAITING_PACKAGES.md
/// "Delivered at destination"): actions on `updateContainerLine`, through
/// the caller the container sheets use (a stale device token is retried
/// once), so widget tests hand in their own caller. Refusals arrive as
/// [DeliveryFailure] carrying `details.reason`; screens put them in their
/// own words (`deliveryRefusalText`).
class ContainerDeliveryService {
  const ContainerDeliveryService({this.caller = callContainerCallable});

  final ContainerCallableCaller caller;

  Future<Object?> _call(Map<String, Object?> payload) async {
    try {
      return await caller(deliveryCallable, payload);
    } on FirebaseFunctionsException catch (error) {
      throw parseDeliveryFailure(error.code, error.details);
    } on DeliveryFailure {
      rethrow;
    } on TimeoutException {
      throw const DeliveryFailure(code: 'unavailable');
    } catch (error) {
      final text = error.toString().toLowerCase();
      final offline =
          text.contains('socket') ||
          text.contains('network') ||
          text.contains('connection');
      throw DeliveryFailure(code: offline ? 'unavailable' : 'unknown');
    }
  }

  /// Marks the whole line delivered. [acknowledgeBalance] once the person
  /// has seen the unpaid-balance warning. [pickupCode] is what the agent
  /// typed when the business asks for one; [overrideCollectedBy] +
  /// [overridePhotoPath] deliver without a code (docs/AIR_PACKAGES.md
  /// §4.7); [collectedCents] is the USD collected at handover.
  Future<DeliveryResult> deliver(
    String businessId,
    String lineId, {
    String collectedBy = '',
    bool acknowledgeBalance = false,
    String pickupCode = '',
    String overrideCollectedBy = '',
    String overridePhotoPath = '',
    int collectedCents = 0,
  }) async => DeliveryResult.fromCallable(
    await _call(
      deliverLineRequest(
        businessId,
        lineId,
        collectedBy: collectedBy,
        acknowledgeBalance: acknowledgeBalance,
        pickupCode: pickupCode,
        overrideCollectedBy: overrideCollectedBy,
        overridePhotoPath: overridePhotoPath,
        collectedCents: collectedCents,
      ),
    ),
  );

  /// Undoes a delivery; false when the package was not delivered.
  Future<bool> undo(String businessId, String lineId) async =>
      undoDeliveryResult(await _call(undoDeliveryRequest(businessId, lineId)));
}
