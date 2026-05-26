import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../models/car_purchase.dart';
import '../providers/auth_provider.dart';
import '../theme/app_colors.dart';
import '../widgets/language_toggle.dart';

class MyPurchasesScreen extends StatelessWidget {
  const MyPurchasesScreen({super.key});

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
              ),
            );
          }
          return SafeArea(
            child: Column(
              children: [
                _PurchasesHeader(title: l10n.myPurchases),
                Expanded(
                  child: ListView.separated(
                    padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
                    itemCount: purchases.length,
                    separatorBuilder: (_, __) => const SizedBox(height: 12),
                    itemBuilder: (context, index) {
                      final purchase = purchases[index];
                      return _PurchaseCard(purchase: purchase);
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
  const _PurchasesHeader({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
      child: Row(
        children: [
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
  });

  final String title;
  final String message;
  final IconData icon;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        _PurchasesHeader(title: title),
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
  const _PurchaseCard({required this.purchase});

  final CarPurchase purchase;

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
                _StatusPill(label: purchase.purchaseStatus),
              ],
            ),
            const SizedBox(height: 8),
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
