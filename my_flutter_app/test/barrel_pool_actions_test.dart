import 'package:flutter_test/flutter_test.dart';
import 'package:my_flutter_app/models/barrel_pool.dart';
import 'package:my_flutter_app/utils/barrel_pool_actions.dart';

BarrelPool pool({
  String participantRole = 'owner',
  int participantSharesClaimed = 1,
  String approvalMode = 'approval',
  String balancePaymentStatus = '',
}) {
  return BarrelPool(
    id: 'pool-1',
    businessId: 'business-1',
    businessName: 'Test Business',
    destinationCountryId: 'gn',
    destinationCountryName: 'Guinea',
    totalShares: 2,
    openShares: 0,
    pricePerShare: 100,
    depositPerShare: 30,
    status: 'full',
    participantRole: participantRole,
    participantSharesClaimed: participantSharesClaimed,
    approvalMode: approvalMode,
    balancePaymentStatus: balancePaymentStatus,
  );
}

void main() {
  test('manual-approval pool owner can manage pending join requests', () {
    expect(
      barrelPoolPrimaryActionFor(pool()),
      BarrelPoolPrimaryAction.manageRequests,
    );
  });

  test('balance payment remains the highest-priority pool action', () {
    expect(
      barrelPoolPrimaryActionFor(pool(balancePaymentStatus: 'balance_due')),
      BarrelPoolPrimaryAction.payBalance,
    );
  });

  test('auto-approval owner can cancel and a joiner can leave', () {
    expect(
      barrelPoolPrimaryActionFor(pool(approvalMode: 'auto')),
      BarrelPoolPrimaryAction.cancelPool,
    );
    expect(
      barrelPoolPrimaryActionFor(pool(participantRole: 'joiner')),
      BarrelPoolPrimaryAction.leavePool,
    );
  });

  test('calculates the full deposit forfeited by an owner cancellation', () {
    expect(
      barrelPoolOwnerCancellationForfeiture(pool(participantSharesClaimed: 2)),
      60,
    );
    expect(
      barrelPoolOwnerCancellationForfeiture(pool(participantRole: 'joiner')),
      0,
    );
  });
}
