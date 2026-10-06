import 'package:intl/intl.dart';

import '../l10n/app_localizations.dart';
import '../models/car_purchase.dart';
import '../services/car_viewing_service.dart';
import 'date_display.dart';
import '../widgets/car_viewing_negotiation.dart' show viewingStatusLabel;

/// The words for a car purchase's stored codes, in the reader's language.
///
/// `carPurchases` stores `purchaseStatus`, `paymentStatus` and the hold
/// extension's statuses as codes; the purchase screens used to print them
/// raw ("hold_review_required", "succeeded") or in English only. One place
/// for the words, so the customer's card and the business's card agree.

/// Purchase states a business filters its paid holds and purchases by, in
/// the order a hold moves through them. '' is "every state".
const List<String> carPurchaseStatusFilters = <String>[
  '',
  'pending',
  'reserved',
  'hold_review_required',
  'completed',
  'cancelled',
  'no_show',
  'forfeited',
  'refunded',
];

/// Viewing states, the same way.
const List<String> carViewingStatusFilters = <String>[
  '',
  viewingRequested,
  viewingCountered,
  viewingScheduled,
  'completed',
  viewingDeclined,
  viewingExpired,
  viewingCancelled,
];

/// A purchase or viewing state. Viewing states read as the negotiation
/// does; an unknown code is shown as stored rather than hidden.
String carPurchaseStatusLabel(AppLocalizations l10n, String status) =>
    switch (status.trim()) {
      '' => l10n.purchaseStatusAll,
      'pending' => l10n.pending,
      'reserved' => l10n.reserved,
      'hold_review_required' => l10n.purchaseStatusReviewPending,
      'completed' => l10n.completed,
      'cancelled' => l10n.cancelled,
      'no_show' => l10n.purchaseStatusNoShow,
      'forfeited' => l10n.purchaseStatusForfeited,
      'refunded' => l10n.refunded,
      final other => viewingStatusLabel(l10n, other),
    };

/// A Stripe-side payment state as stored on the purchase.
String carPurchasePaymentStatusLabel(AppLocalizations l10n, String status) =>
    switch (status.trim()) {
      'succeeded' || 'paid' => l10n.paid,
      'pending' ||
      'requires_payment_method' ||
      'requires_confirmation' ||
      'requires_action' => l10n.pending,
      'processing' => l10n.processing,
      'failed' => l10n.paymentStatusFailed,
      'refunded' => l10n.refunded,
      'cancelled' || 'canceled' => l10n.cancelled,
      'not_required' => l10n.paymentStatusNotRequired,
      final other => other,
    };

/// A hold-extension request's state.
String carPurchaseExtensionStatusLabel(AppLocalizations l10n, String status) =>
    switch (status.trim()) {
      'pending' => l10n.pending,
      'approved' => l10n.approved,
      'rejected' => l10n.extensionStatusRejected,
      'paid' => l10n.paid,
      final other => other,
    };

/// "Extension: Pending • Oct 9, 2026 • extra $40.00 • payment Paid", in the
/// reader's language. Shared by the customer's card and the business's.
String carPurchaseExtensionLine(
  AppLocalizations l10n,
  CarPurchase purchase,
  NumberFormat currency,
  String locale,
) {
  final date = purchase.extensionRequestedHoldUntilDate;
  final amount = purchase.extensionExtraAmount;
  final payment = purchase.extensionPaymentStatus;
  return l10n.extensionStatusLine(
        carPurchaseExtensionStatusLabel(
          l10n,
          purchase.extensionRequestStatus ?? '',
        ),
        date == null ? '' : l10n.dateSuffix(displayDate(date, locale)),
        amount == null ? '' : l10n.extraAmountSuffix(currency.format(amount)),
      ) +
      (payment == null
          ? ''
          : l10n.extensionPaymentSuffix(
              carPurchasePaymentStatusLabel(l10n, payment),
            ));
}

/// A forfeited deposit's state.
String carPurchaseForfeitureStatusLabel(AppLocalizations l10n, String status) =>
    switch (status.trim()) {
      'pending' || 'review_pending' => l10n.purchaseStatusReviewPending,
      'forfeited' => l10n.purchaseStatusForfeited,
      'completed' => l10n.completed,
      'active' => l10n.active,
      final other => other,
    };
