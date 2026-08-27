import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../models/car_purchase.dart';
import '../providers/auth_provider.dart';
import '../services/car_purchase_service.dart';
import '../services/car_viewing_service.dart';
import '../theme/app_colors.dart';
import '../utils/action_confirmation.dart';
import '../widgets/app_back_button.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/car_viewing_negotiation.dart';
import '../widgets/language_toggle.dart';
import '../widgets/support_entry_button.dart';
import '../widgets/marketplace_transaction_disclosure.dart';

/// Which queue this screen is showing.
///
/// A viewing is an appointment, not a purchase - nothing is bought and no
/// money moves - so buyers reach them from their own destination. One widget
/// serves both so the two lists cannot drift apart.
enum PurchaseListScope { purchases, viewings }

class MyPurchasesScreen extends StatelessWidget {
  const MyPurchasesScreen({
    super.key,
    this.showBackButton = false,
    this.scope = PurchaseListScope.purchases,
  });

  final bool showBackButton;
  final PurchaseListScope scope;

  bool get _isViewings => scope == PurchaseListScope.viewings;

  /// The viewing negotiation lives in [CarViewingNegotiationPanel], which both
  /// sides of the conversation share. There is deliberately no "edit viewing"
  /// here any more: moving an appointment is a proposal the seller has to
  /// answer, not something a buyer does to a record on their own.

  Future<void> _requestHoldExtension(
    BuildContext context,
    CarPurchase purchase,
  ) async {
    final l10n = AppLocalizations.of(context)!;
    final current = purchase.holdUntilDate ?? DateTime.now();
    final initial = current.isAfter(DateTime.now())
        ? current.add(const Duration(days: 1))
        : DateTime.now().add(const Duration(days: 1));
    final picked = await showDatePicker(
      context: context,
      initialDate: initial,
      firstDate: initial,
      lastDate: DateTime.now().add(const Duration(days: 30)),
    );
    if (picked == null || !context.mounted) return;
    final confirmed = await confirmMajorAction(
      context,
      title: l10n.requestHoldExtensionQuestion,
      message: l10n.requestHoldExtensionMessage,
      confirmLabel: l10n.requestExtension,
      icon: Icons.event_repeat_outlined,
    );
    if (!confirmed || !context.mounted) return;
    try {
      await CarPurchaseService().requestPaidHoldExtension(
        purchaseId: purchase.id,
        requestedHoldUntilDate: picked,
      );
      if (!context.mounted) return;
      showSuccessSnackBar(context, l10n.extensionRequestSent);
    } catch (e) {
      if (!context.mounted) return;
      showErrorSnackBar(context, l10n.operationFailed('$e'));
    }
  }

  Future<void> _payHoldExtension(
    BuildContext context,
    CarPurchase purchase,
  ) async {
    final l10n = AppLocalizations.of(context)!;
    final confirmed = await confirmMajorAction(
      context,
      title: l10n.payExtensionQuestion,
      message: l10n.payExtensionMessage,
      confirmLabel: l10n.payExtension,
      icon: Icons.payments_outlined,
    );
    if (!confirmed || !context.mounted) return;
    final marketplaceAcceptance = await confirmMarketplaceTransaction(
      context,
      providerNames: purchase.businessName,
      transactionSummary: l10n.payExtension,
    );
    if (marketplaceAcceptance == null || !context.mounted) return;
    try {
      await CarPurchaseService().payApprovedHoldExtension(
        purchase: purchase,
        marketplaceAcceptance: marketplaceAcceptance,
      );
      if (!context.mounted) return;
      showSuccessSnackBar(context, l10n.extensionPaidHoldUpdated);
    } catch (e) {
      if (!context.mounted) return;
      showErrorSnackBar(context, l10n.operationFailed('$e'));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final authProvider = context.watch<AuthProvider>();
    final user = authProvider.user;

    if (user == null) {
      return Scaffold(
        backgroundColor: AppColors.lightBg,
        body: SafeArea(
          child: _EmptyPurchasesState(
            title: l10n.myPurchases,
            message: l10n.signInToAccount,
            actionLabel: l10n.signIn,
            onAction: () => Navigator.pushNamed(context, '/login'),
            showBackButton: showBackButton,
          ),
        ),
      );
    }

    return Scaffold(
      backgroundColor: AppColors.lightBg,
      body: StreamBuilder<QuerySnapshot>(
        stream: FirebaseFirestore.instance
            .collection('carPurchases')
            .where('buyerUid', isEqualTo: user.uid)
            .snapshots(),
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return SafeArea(
              child: _EmptyPurchasesState(
                title: _isViewings ? l10n.myCarViewings : l10n.myPurchases,
                message: l10n.purchaseHistoryUnavailable,
                icon: Icons.lock_outline,
                showBackButton: showBackButton,
              ),
            );
          }
          if (!snapshot.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final purchases =
              snapshot.data!.docs
                  .map(CarPurchase.fromFirestore)
                  .where(
                    (purchase) =>
                        purchase.isViewingReservation == _isViewings,
                  )
                  .toList()
                ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
          if (purchases.isEmpty) {
            return SafeArea(
              child: _EmptyPurchasesState(
                title: _isViewings ? l10n.myCarViewings : l10n.myPurchases,
                message: _isViewings
                    ? l10n.noCarViewingsYet
                    : l10n.noPurchasesYet,
                showBackButton: showBackButton,
              ),
            );
          }
          return SafeArea(
            child: Column(
              children: [
                _PurchasesHeader(
                  title: _isViewings ? l10n.myCarViewings : l10n.myPurchases,
                  showBackButton: showBackButton,
                ),
                Expanded(
                  child: ListView.separated(
                    padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
                    itemCount: purchases.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 12),
                    itemBuilder: (context, index) {
                      final purchase = purchases[index];
                      return _PurchaseCard(
                        purchase: purchase,
                        onRequestExtension: purchase.canRequestHoldExtension
                            ? () => _requestHoldExtension(context, purchase)
                            : null,
                        onPayExtension: purchase.canPayApprovedExtension
                            ? () => _payHoldExtension(context, purchase)
                            : null,
                      );
                    },
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _PurchasesHeader extends StatelessWidget {
  const _PurchasesHeader({required this.title, required this.showBackButton});

  final String title;
  final bool showBackButton;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
      child: Row(
        children: [
          if (showBackButton) ...[
            const AppBackButton(),
            const SizedBox(width: 4),
          ],
          Expanded(
            child: Text(
              title,
              style: Theme.of(
                context,
              ).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w900),
            ),
          ),
          const LanguageToggle(),
        ],
      ),
    );
  }
}

class _EmptyPurchasesState extends StatelessWidget {
  const _EmptyPurchasesState({
    required this.title,
    required this.message,
    this.icon = Icons.receipt_long_outlined,
    this.actionLabel,
    this.onAction,
    this.showBackButton = false,
  });

  final String title;
  final String message;
  final IconData icon;
  final String? actionLabel;
  final VoidCallback? onAction;
  final bool showBackButton;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        _PurchasesHeader(title: title, showBackButton: showBackButton),
        Expanded(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 58,
                    height: 58,
                    decoration: BoxDecoration(
                      color: AppColors.brandRed.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(18),
                    ),
                    child: Icon(icon, color: AppColors.brandRed),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    message,
                    textAlign: TextAlign.center,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: AppColors.lightMuted,
                      height: 1.4,
                    ),
                  ),
                  if (actionLabel != null && onAction != null) ...[
                    const SizedBox(height: 18),
                    FilledButton(
                      onPressed: onAction,
                      child: Text(actionLabel!),
                    ),
                  ],
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}

class _PurchaseCard extends StatelessWidget {
  const _PurchaseCard({
    required this.purchase,
    this.onRequestExtension,
    this.onPayExtension,
  });

  final CarPurchase purchase;
  final VoidCallback? onRequestExtension;
  final VoidCallback? onPayExtension;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final currency = NumberFormat.simpleCurrency(
      name: purchase.depositCurrency,
    );
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    purchase.carTitle,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                _StatusPill(label: _statusLabel(l10n)),
              ],
            ),
            const SizedBox(height: 8),
            if (!purchase.isViewingReservation &&
                purchase.destinationCountryName.trim().isNotEmpty)
              Text(
                '${l10n.destinationCountry}: ${purchase.destinationCountryName}',
              ),
            Text(
              l10n.depositPaid(
                currency.format(purchase.depositAmount),
                purchase.paymentStatus,
              ),
            ),
            // Only for a paid hold or a purchase. A viewing's appointment is
            // the negotiation's business: the panel below says whether it is
            // agreed, still being argued over, or gone.
            if (purchase.appointmentStart != null &&
                !purchase.isViewingReservation) ...[
              const SizedBox(height: 4),
              Text(
                '${l10n.selectViewingTime}: '
                '${purchase.appointmentLabel ?? DateFormat.yMMMd().add_jm().format(purchase.appointmentStart!)}',
              ),
            ],
            if (purchase.isViewingReservation) ...[
              const SizedBox(height: 10),
              CarViewingNegotiationPanel(
                purchase: purchase,
                party: ViewingParty.customer,
              ),
            ],
            if (purchase.holdUntilDate != null) ...[
              const SizedBox(height: 4),
              Text(
                l10n.holdUntilDate(
                  DateFormat.yMMMd().format(purchase.holdUntilDate!),
                ),
              ),
            ],
            if (purchase.extensionRequestStatus != null) ...[
              const SizedBox(height: 6),
              Text(
                _extensionLabel(currency),
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: AppColors.lightMuted,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
            if (purchase.purchaseStatus == 'hold_review_required') ...[
              const SizedBox(height: 8),
              Text(
                l10n.holdReviewRequiredMessage,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: AppColors.warn,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
            if (purchase.purchaseStatus == 'no_show') ...[
              const SizedBox(height: 8),
              Text(
                l10n.customerNoShowHoldMessage,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: AppColors.errorRed,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
            if (onRequestExtension != null || onPayExtension != null) ...[
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  if (onRequestExtension != null)
                    OutlinedButton.icon(
                      onPressed: onRequestExtension,
                      icon: const Icon(Icons.event_repeat_outlined),
                      label: Text(l10n.requestExtension),
                    ),
                  if (onPayExtension != null)
                    FilledButton.icon(
                      onPressed: onPayExtension,
                      icon: const Icon(Icons.payments_outlined),
                      label: Text(l10n.payExtension),
                    ),
                ],
              ),
            ],
            const SizedBox(height: 8),
            SupportEntryButton(
              relatedCollection: 'carPurchases',
              relatedId: purchase.id,
              relatedLabel: purchase.carTitle,
              subject: l10n.supportPurchaseCaseSubject(purchase.carTitle),
              compact: true,
            ),
            const SizedBox(height: 8),
            Text(
              DateFormat.yMMMd().add_jm().format(purchase.createdAt),
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }

  String _statusLabel(AppLocalizations l10n) {
    // A viewing wears its negotiation status, not a blanket "scheduled": the
    // whole point of the flow is that a requested viewing and a confirmed one
    // are different things to the person reading the card.
    if (purchase.isViewingReservation) {
      return viewingStatusLabel(l10n, purchase.purchaseStatus);
    }
    switch (purchase.purchaseStatus) {
      case 'hold_review_required':
        return 'Review pending';
      case 'no_show':
        return 'No-show';
      default:
        break;
    }
    return purchase.purchaseStatus;
  }

  String _extensionLabel(NumberFormat currency) {
    final status = purchase.extensionRequestStatus;
    final date = purchase.extensionRequestedHoldUntilDate;
    final amount = purchase.extensionExtraAmount;
    final parts = <String>[
      'Extension: ${status ?? ''}',
      if (date != null) DateFormat.yMMMd().format(date),
      if (amount != null) 'extra ${currency.format(amount)}',
      if (purchase.extensionPaymentStatus != null)
        'payment ${purchase.extensionPaymentStatus}',
    ];
    return parts.join(' • ');
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Chip(
      label: Text(label),
      backgroundColor: AppColors.brandRed.withValues(alpha: 0.1),
      labelStyle: const TextStyle(color: AppColors.brandRed),
    );
  }
}
