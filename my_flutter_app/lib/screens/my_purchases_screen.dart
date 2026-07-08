import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../models/car_purchase.dart';
import '../providers/auth_provider.dart';
import '../services/car_purchase_service.dart';
import '../theme/app_colors.dart';
import '../utils/action_confirmation.dart';
import '../widgets/app_back_button.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/language_toggle.dart';
import '../widgets/support_entry_button.dart';

class MyPurchasesScreen extends StatelessWidget {
  const MyPurchasesScreen({super.key, this.showBackButton = false});

  final bool showBackButton;

  Future<void> _showEditViewingSheet(
    BuildContext context,
    CarPurchase purchase,
  ) async {
    final l10n = AppLocalizations.of(context)!;
    final slots = _EditableViewingSlot.available();
    _EditableViewingSlot? selectedSlot;
    var isSubmitting = false;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (sheetContext) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            return Padding(
              padding: EdgeInsets.only(
                bottom: MediaQuery.of(context).viewInsets.bottom,
              ),
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            l10n.editViewingReservation,
                            style: Theme.of(context).textTheme.titleLarge,
                          ),
                        ),
                        IconButton(
                          onPressed: isSubmitting
                              ? null
                              : () => Navigator.pop(context),
                          icon: const Icon(Icons.close),
                        ),
                      ],
                    ),
                    const SizedBox(height: 8),
                    Text(
                      l10n.viewingEditCutoff,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        color: AppColors.lightMuted,
                        height: 1.35,
                      ),
                    ),
                    const SizedBox(height: 18),
                    Wrap(
                      spacing: 10,
                      runSpacing: 10,
                      children: slots.map((slot) {
                        final isSelected = selectedSlot == slot;
                        return ChoiceChip(
                          selected: isSelected,
                          avatar: Icon(
                            Icons.schedule,
                            size: 18,
                            color: isSelected
                                ? Colors.white
                                : AppColors.brandRed,
                          ),
                          label: Text(slot.label),
                          selectedColor: AppColors.brandRed,
                          labelStyle: TextStyle(
                            color: isSelected
                                ? Colors.white
                                : AppColors.lightOnSurface,
                            fontWeight: FontWeight.w700,
                          ),
                          onSelected: isSubmitting
                              ? null
                              : (_) => setModalState(() => selectedSlot = slot),
                        );
                      }).toList(),
                    ),
                    const SizedBox(height: 22),
                    SizedBox(
                      width: double.infinity,
                      height: 52,
                      child: FilledButton.icon(
                        onPressed: isSubmitting
                            ? null
                            : () async {
                                final slot = selectedSlot;
                                if (slot == null) return;
                                setModalState(() => isSubmitting = true);
                                try {
                                  await CarPurchaseService()
                                      .updateViewingReservation(
                                        purchaseId: purchase.id,
                                        appointmentStart: slot.start,
                                        appointmentLabel: slot.label,
                                      );
                                  if (!context.mounted) return;
                                  Navigator.pop(context);
                                  showSuccessSnackBar(
                                    context,
                                    l10n.viewingReservationUpdated,
                                  );
                                } catch (_) {
                                  if (!context.mounted) return;
                                  showErrorSnackBar(
                                    context,
                                    l10n.cannotEditViewingReservation,
                                  );
                                } finally {
                                  if (context.mounted) {
                                    setModalState(() => isSubmitting = false);
                                  }
                                }
                              },
                        icon: isSubmitting
                            ? const SizedBox(
                                width: 18,
                                height: 18,
                                child: CircularProgressIndicator(
                                  strokeWidth: 2,
                                  color: Colors.white,
                                ),
                              )
                            : const Icon(Icons.event_repeat_outlined),
                        label: Text(l10n.changeViewingTime),
                      ),
                    ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  Future<void> _cancelViewingReservation(
    BuildContext context,
    CarPurchase purchase,
  ) async {
    final l10n = AppLocalizations.of(context)!;
    final confirmed = await confirmMajorAction(
      context,
      title: l10n.cancelViewingQuestion,
      message: l10n.cancelViewingConfirmMessage,
      confirmLabel: l10n.cancelViewingReservation,
      icon: Icons.event_busy_outlined,
      destructive: true,
    );
    if (!confirmed || !context.mounted) return;
    try {
      await CarPurchaseService().cancelViewingReservation(
        purchaseId: purchase.id,
      );
      if (!context.mounted) return;
      showSuccessSnackBar(context, l10n.viewingReservationCancelled);
    } catch (error) {
      if (!context.mounted) return;
      showErrorSnackBar(context, l10n.operationFailed('$error'));
    }
  }

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
    try {
      await CarPurchaseService().payApprovedHoldExtension(purchase: purchase);
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
                title: l10n.myPurchases,
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
              snapshot.data!.docs.map(CarPurchase.fromFirestore).toList()
                ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
          if (purchases.isEmpty) {
            return SafeArea(
              child: _EmptyPurchasesState(
                title: l10n.myPurchases,
                message: l10n.noPurchasesYet,
                showBackButton: showBackButton,
              ),
            );
          }
          return SafeArea(
            child: Column(
              children: [
                _PurchasesHeader(
                  title: l10n.myPurchases,
                  showBackButton: showBackButton,
                ),
                Expanded(
                  child: ListView.separated(
                    padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
                    itemCount: purchases.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 12),
                    itemBuilder: (context, index) {
                      final purchase = purchases[index];
                      return _PurchaseCard(
                        purchase: purchase,
                        onEditViewing: purchase.canEditViewingReservation
                            ? () => _showEditViewingSheet(context, purchase)
                            : null,
                        onCancelViewing: purchase.isActiveViewingReservation
                            ? () => _cancelViewingReservation(context, purchase)
                            : null,
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
    this.onEditViewing,
    this.onCancelViewing,
    this.onRequestExtension,
    this.onPayExtension,
  });

  final CarPurchase purchase;
  final VoidCallback? onEditViewing;
  final VoidCallback? onCancelViewing;
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
            if (purchase.appointmentStart != null) ...[
              const SizedBox(height: 4),
              Text(
                '${l10n.selectViewingTime}: '
                '${purchase.appointmentLabel ?? DateFormat.yMMMd().add_jm().format(purchase.appointmentStart!)}',
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
            if (onEditViewing != null ||
                onCancelViewing != null ||
                onRequestExtension != null ||
                onPayExtension != null) ...[
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  if (onEditViewing != null)
                    OutlinedButton.icon(
                      onPressed: onEditViewing,
                      icon: const Icon(Icons.event_repeat_outlined),
                      label: Text(l10n.editViewingReservation),
                    ),
                  if (onCancelViewing != null)
                    OutlinedButton.icon(
                      onPressed: onCancelViewing,
                      icon: const Icon(Icons.event_busy_outlined),
                      label: Text(l10n.cancelViewingReservation),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: AppColors.errorRed,
                      ),
                    ),
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
            ] else if (purchase.isViewingReservation) ...[
              const SizedBox(height: 8),
              Text(
                l10n.viewingEditCutoff,
                style: Theme.of(
                  context,
                ).textTheme.bodySmall?.copyWith(color: AppColors.lightMuted),
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
    if (purchase.isViewingReservation &&
        purchase.purchaseStatus != 'cancelled') {
      return l10n.viewingScheduled;
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

class _EditableViewingSlot {
  const _EditableViewingSlot({required this.start, required this.label});

  final DateTime start;
  final String label;

  static List<_EditableViewingSlot> available() {
    final now = DateTime.now();
    final earliest = now.add(const Duration(hours: 2));
    final dateFormat = DateFormat('EEE, MMM d');
    final timeFormat = DateFormat.jm();
    final slots = <_EditableViewingSlot>[];
    var day = DateTime(now.year, now.month, now.day);

    while (slots.length < 8) {
      day = day.add(const Duration(days: 1));
      if (day.weekday == DateTime.sunday) continue;
      for (final hour in const [10, 12, 14, 16]) {
        final start = DateTime(day.year, day.month, day.day, hour);
        if (start.isBefore(earliest)) continue;
        slots.add(
          _EditableViewingSlot(
            start: start,
            label: '${dateFormat.format(start)} - ${timeFormat.format(start)}',
          ),
        );
        if (slots.length == 8) break;
      }
    }
    return slots;
  }
}
