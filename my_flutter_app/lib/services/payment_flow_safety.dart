import 'package:flutter_stripe/flutter_stripe.dart';

/// Runs [action] with Stripe scoped to the connected account that owns a
/// direct-charge PaymentIntent, then restores the previous scope.
///
/// A direct-charge intent is created on the business's connected account (the
/// server sends the `Stripe-Account` header), so its client secret only
/// resolves for a client presenting that same account. Hosted web checkout
/// carries the account in its redirect URL; the native payment sheet does not,
/// and would otherwise ask the platform account for an intent it does not own.
///
/// The scope must cover **both** `initPaymentSheet` and `presentPaymentSheet`:
/// the SDK applies pending settings on each call, so restoring in between would
/// leave present() pointed at the wrong account. Restoring in `finally` keeps a
/// later platform-charge payment in the same session from inheriting it.
///
/// An empty [connectedAccountId] means a platform-owned intent, which must run
/// unscoped - passing one through would break it the same way.
Future<T> withStripeConnectedAccount<T>(
  String connectedAccountId,
  Future<T> Function() action,
) async {
  final accountId = connectedAccountId.trim();
  if (accountId.isEmpty) {
    return action();
  }

  final previousAccountId = Stripe.stripeAccountId;
  Stripe.stripeAccountId = accountId;
  try {
    return await action();
  } finally {
    Stripe.stripeAccountId = previousAccountId;
  }
}

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
