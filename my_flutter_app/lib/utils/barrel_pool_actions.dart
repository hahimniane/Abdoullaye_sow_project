import '../models/barrel_pool.dart';

enum BarrelPoolPrimaryAction {
  payBalance,
  manageRequests,
  cancelPool,
  leavePool,
}

BarrelPoolPrimaryAction barrelPoolPrimaryActionFor(BarrelPool pool) {
  if (pool.balancePaymentStatus == 'balance_due') {
    return BarrelPoolPrimaryAction.payBalance;
  }
  if (pool.participantRole == 'owner' && pool.approvalMode == 'approval') {
    return BarrelPoolPrimaryAction.manageRequests;
  }
  if (pool.participantRole == 'owner') {
    return BarrelPoolPrimaryAction.cancelPool;
  }
  return BarrelPoolPrimaryAction.leavePool;
}

double barrelPoolOwnerCancellationForfeiture(BarrelPool pool) {
  if (pool.participantRole != 'owner') return 0;
  final shares = pool.participantSharesClaimed > 0
      ? pool.participantSharesClaimed
      : 1;
  return pool.depositPerShare * shares;
}
