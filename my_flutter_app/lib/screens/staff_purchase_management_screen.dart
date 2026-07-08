import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../models/car_purchase.dart';
import '../providers/auth_provider.dart';
import '../theme/app_colors.dart';
import '../utils/action_confirmation.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/language_toggle.dart';
import '../widgets/support_entry_button.dart';

class StaffPurchaseManagementScreen extends StatelessWidget {
  const StaffPurchaseManagementScreen({super.key});

  Future<void> _callPurchaseAction(
    BuildContext context,
    String functionName,
    Map<String, dynamic> data,
  ) async {
    final l10n = AppLocalizations.of(context)!;
    try {
      await FirebaseFunctions.instance.httpsCallable(functionName).call(data);
      if (!context.mounted) return;
      showSuccessSnackBar(context, l10n.purchaseUpdated);
    } catch (e) {
      if (!context.mounted) return;
      showErrorSnackBar(context, l10n.operationFailed('$e'));
    }
  }

  Future<void> _markPaidHoldSold(
    BuildContext context,
    CarPurchase purchase,
  ) async {
    final l10n = AppLocalizations.of(context)!;
    final confirmed = await confirmMajorAction(
      context,
      title: 'Mark car sold?',
      message: 'This will complete the paid hold for ${purchase.carTitle}.',
      confirmLabel: l10n.completed,
      icon: Icons.sell_outlined,
    );
    if (!confirmed || !context.mounted) return;
    await _callPurchaseAction(context, 'markPaidHoldSold', {
      'purchaseId': purchase.id,
    });
  }

  Future<void> _markPaidHoldNoShow(
    BuildContext context,
    CarPurchase purchase,
  ) async {
    final confirmed = await confirmMajorAction(
      context,
      title: 'Customer did not come?',
      message:
          'This will release ${purchase.carTitle}, forfeit the hold deposit, '
          'and add this outcome to the buyer history.',
      confirmLabel: 'Customer did not come',
      icon: Icons.person_off_outlined,
      destructive: true,
    );
    if (!confirmed || !context.mounted) return;
    await _callPurchaseAction(context, 'markPaidHoldNoShow', {
      'purchaseId': purchase.id,
    });
  }

  Future<void> _decideExtension(
    BuildContext context,
    CarPurchase purchase,
    String decision,
  ) async {
    final confirmed = await confirmMajorAction(
      context,
      title: decision == 'approved'
          ? 'Approve extension?'
          : 'Reject extension?',
      message: decision == 'approved'
          ? 'The customer will be allowed to pay the extra hold amount.'
          : 'The current hold date will stay unchanged.',
      confirmLabel: decision == 'approved' ? 'Approve' : 'Reject',
      icon: decision == 'approved'
          ? Icons.check_circle_outline
          : Icons.cancel_outlined,
      destructive: decision == 'rejected',
    );
    if (!confirmed || !context.mounted) return;
    await _callPurchaseAction(context, 'decidePaidHoldExtension', {
      'purchaseId': purchase.id,
      'decision': decision,
    });
  }

  Future<void> _updateStatus(
    BuildContext context,
    CarPurchase purchase,
    String status,
  ) async {
    final l10n = AppLocalizations.of(context)!;
    final confirmed = await confirmMajorAction(
      context,
      title: l10n.updatePurchaseStatusQuestion,
      message: l10n.updatePurchaseStatusMessage(purchase.carTitle, status),
      confirmLabel: l10n.updateStatus,
      icon: Icons.receipt_long_outlined,
      destructive: status == 'cancelled' || status == 'refunded',
    );
    if (!confirmed || !context.mounted) return;
    if (purchase.purchaseStatus == 'forfeited' && status == 'completed') {
      showErrorSnackBar(
        context,
        l10n.operationFailed('Forfeited holds cannot be completed.'),
        feedback: false,
      );
      return;
    }

    try {
      final firestore = FirebaseFirestore.instance;
      final batch = firestore.batch();
      final purchaseRef = firestore.collection('carPurchases').doc(purchase.id);
      batch.update(purchaseRef, {
        'purchaseStatus': status,
        'updatedAt': FieldValue.serverTimestamp(),
      });
      if (status == 'completed' && !purchase.isViewingReservation) {
        batch.update(firestore.collection('cars').doc(purchase.carId), {
          'status': 'sold',
          'soldInfo': {
            'customerName': purchase.buyerName,
            'customerPhone': purchase.buyerPhone,
            'customerEmail': purchase.buyerEmail,
            'amount': purchase.depositAmount,
            'soldDate': FieldValue.serverTimestamp(),
            'notes': 'Payment completed through app',
          },
          'updatedAt': FieldValue.serverTimestamp(),
        });
      } else if (purchase.isViewingReservation && status == 'completed') {
        batch.update(firestore.collection('cars').doc(purchase.carId), {
          'status': 'active',
          'reservedPurchaseId': FieldValue.delete(),
          'reservationType': FieldValue.delete(),
          'updatedAt': FieldValue.serverTimestamp(),
        });
      } else if (status == 'cancelled' || status == 'refunded') {
        batch.update(firestore.collection('cars').doc(purchase.carId), {
          'status': 'active',
          'reservedPurchaseId': FieldValue.delete(),
          'reservationType': FieldValue.delete(),
          'updatedAt': FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
      if (!context.mounted) return;
      showSuccessSnackBar(context, l10n.purchaseUpdated);
    } catch (e) {
      if (!context.mounted) return;
      showErrorSnackBar(context, l10n.operationFailed('$e'));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final auth = context.watch<AuthProvider>();
    final query = FirebaseFirestore.instance.collection('carPurchases');
    final stream = auth.isAdmin
        ? query.snapshots()
        : query.where('businessId', isEqualTo: auth.businessId).snapshots();
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.purchaseReservations),
        actions: const [LanguageToggle()],
      ),
      body: StreamBuilder<QuerySnapshot>(
        stream: stream,
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return Center(
              child: Text(l10n.operationFailed('${snapshot.error}')),
            );
          }
          if (!snapshot.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          final purchases =
              snapshot.data!.docs.map(CarPurchase.fromFirestore).toList()
                ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
          if (purchases.isEmpty) {
            return Center(child: Text(l10n.noPurchasesYet));
          }
          return ListView.separated(
            padding: const EdgeInsets.all(16),
            itemCount: purchases.length,
            separatorBuilder: (_, __) => const SizedBox(height: 12),
            itemBuilder: (context, index) {
              final purchase = purchases[index];
              return _StaffPurchaseCard(
                purchase: purchase,
                onStatus: (status) => _updateStatus(context, purchase, status),
                onMarkSold: () => _markPaidHoldSold(context, purchase),
                onNoShow: () => _markPaidHoldNoShow(context, purchase),
                onApproveExtension: () =>
                    _decideExtension(context, purchase, 'approved'),
                onRejectExtension: () =>
                    _decideExtension(context, purchase, 'rejected'),
              );
            },
          );
        },
      ),
    );
  }
}

class _StaffPurchaseCard extends StatelessWidget {
  const _StaffPurchaseCard({
    required this.purchase,
    required this.onStatus,
    required this.onMarkSold,
    required this.onNoShow,
    required this.onApproveExtension,
    required this.onRejectExtension,
  });

  final CarPurchase purchase;
  final ValueChanged<String> onStatus;
  final VoidCallback onMarkSold;
  final VoidCallback onNoShow;
  final VoidCallback onApproveExtension;
  final VoidCallback onRejectExtension;

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
                Chip(
                  label: Text(purchase.purchaseStatus),
                  backgroundColor: AppColors.brandRed.withValues(alpha: 0.1),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text('${l10n.customerName}: ${purchase.buyerName}'),
            Text('${l10n.customerPhone}: ${purchase.buyerPhone}'),
            Text('${l10n.customerEmail}: ${purchase.buyerEmail}'),
            if (purchase.destinationCountryName.trim().isNotEmpty)
              Text(
                '${l10n.destinationCountry}: ${purchase.destinationCountryName}',
              ),
            Text(
              l10n.depositPaid(
                currency.format(purchase.depositAmount),
                purchase.paymentStatus,
              ),
            ),
            if (purchase.appointmentStart != null)
              Text(
                '${l10n.selectViewingTime}: '
                '${purchase.appointmentLabel ?? DateFormat.yMMMd().add_jm().format(purchase.appointmentStart!)}',
              ),
            if (purchase.holdUntilDate != null)
              Text(
                l10n.holdUntilDate(
                  DateFormat.yMMMd().format(purchase.holdUntilDate!),
                ),
              ),
            if (purchase.holdPricingMode != null)
              Text(
                l10n.holdPricingSummary(
                  purchase.holdPricingMode == 'per_day'
                      ? l10n.perDay
                      : l10n.flat,
                  purchase.holdDays == null
                      ? ''
                      : l10n.holdDaysSuffix(purchase.holdDays!),
                ),
              ),
            if (purchase.depositForfeitureStatus != null)
              Text(
                l10n.forfeitureStatusLabel(purchase.depositForfeitureStatus!),
              ),
            if (purchase.holdReviewRequiredAt != null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: _NoticeBand(
                  icon: Icons.priority_high_outlined,
                  text: l10n.holdDateReachedStaffAction,
                  color: AppColors.warn,
                ),
              ),
            if (purchase.extensionRequestStatus != null) ...[
              const SizedBox(height: 8),
              _NoticeBand(
                icon: Icons.event_repeat_outlined,
                color: AppColors.brandRed,
                text: l10n.extensionStatusLine(
                  purchase.extensionRequestStatus!,
                  purchase.extensionRequestedHoldUntilDate == null
                      ? ''
                      : l10n.dateSuffix(
                          DateFormat.yMMMd().format(
                            purchase.extensionRequestedHoldUntilDate!,
                          ),
                        ),
                  purchase.extensionExtraAmount == null
                      ? ''
                      : l10n.extraAmountSuffix(
                          currency.format(purchase.extensionExtraAmount),
                        ),
                ),
              ),
            ],
            if (purchase.buyerReliabilitySnapshot != null) ...[
              const SizedBox(height: 8),
              Text(
                l10n.buyerHistoryLine(
                  purchase.buyerReliabilitySnapshot!['completedHolds'] ?? 0,
                  purchase.buyerReliabilitySnapshot!['noShows'] ?? 0,
                  purchase.buyerReliabilitySnapshot!['forfeitures'] ?? 0,
                ),
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                if (purchase.isPaidHold &&
                    (purchase.purchaseStatus == 'reserved' ||
                        purchase.purchaseStatus == 'hold_review_required')) ...[
                  FilledButton.icon(
                    onPressed: onMarkSold,
                    icon: const Icon(Icons.sell_outlined),
                    label: Text(l10n.markAsSold),
                  ),
                  if (purchase.purchaseStatus == 'hold_review_required')
                    OutlinedButton.icon(
                      onPressed: onNoShow,
                      icon: const Icon(Icons.person_off_outlined),
                      label: Text(l10n.customerDidNotCome),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppColors.errorRed,
                      ),
                    ),
                ] else ...[
                  OutlinedButton(
                    onPressed:
                        purchase.purchaseStatus == 'forfeited' ||
                            purchase.purchaseStatus == 'no_show'
                        ? null
                        : () => onStatus('completed'),
                    child: Text(l10n.completed),
                  ),
                  OutlinedButton(
                    onPressed: () => onStatus('cancelled'),
                    child: Text(l10n.cancelled),
                  ),
                  OutlinedButton(
                    onPressed: () => onStatus('refunded'),
                    child: Text(l10n.refunded),
                  ),
                ],
                if (purchase.extensionRequestStatus == 'pending') ...[
                  OutlinedButton.icon(
                    onPressed: onApproveExtension,
                    icon: const Icon(Icons.check_circle_outline),
                    label: Text(l10n.approveExtension),
                  ),
                  OutlinedButton.icon(
                    onPressed: onRejectExtension,
                    icon: const Icon(Icons.cancel_outlined),
                    label: Text(l10n.rejectExtension),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: AppColors.errorRed,
                    ),
                  ),
                ],
                SupportEntryButton(
                  relatedCollection: 'carPurchases',
                  relatedId: purchase.id,
                  relatedLabel: purchase.carTitle,
                  subject: l10n.supportPurchaseCaseSubject(purchase.carTitle),
                  compact: true,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _NoticeBand extends StatelessWidget {
  const _NoticeBand({
    required this.icon,
    required this.text,
    required this.color,
  });

  final IconData icon;
  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withValues(alpha: 0.22)),
      ),
      child: Row(
        children: [
          Icon(icon, color: color),
          const SizedBox(width: 8),
          Expanded(child: Text(text)),
        ],
      ),
    );
  }
}
