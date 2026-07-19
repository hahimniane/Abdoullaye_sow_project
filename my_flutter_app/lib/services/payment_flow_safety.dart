Future<void> completePaymentFlowSafely({
  required Future<void> Function() presentPaymentSheet,
  required Future<void> Function() completeTransaction,
  required Future<void> Function() cancelPendingTransaction,
}) async {
  try {
    await presentPaymentSheet();
  } catch (_) {
    try {
      await cancelPendingTransaction();
    } catch (_) {
      // Preserve the payment-sheet error for the customer.
    }
    rethrow;
  }

  // Stripe may already have charged the customer. A failure in our follow-up
  // request must remain recoverable by the server/webhook, not be cancelled.
  await completeTransaction();
}

/// Runs a non-critical action after a transaction has already succeeded.
///
/// Receipt printing, sharing, and other local handoffs must never turn a paid
/// order into an apparent failure. Callers can use the boolean result to show
/// accurate follow-up guidance without inviting a duplicate payment attempt.
Future<bool> runBestEffortPostPaymentAction(
  Future<void> Function() action,
) async {
  try {
    await action();
    return true;
  } catch (_) {
    return false;
  }
}
