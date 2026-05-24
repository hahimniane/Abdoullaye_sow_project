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
        appBar: AppBar(title: Text(l10n.myPurchases)),
        body: Center(
          child: FilledButton(
            onPressed: () => Navigator.pushNamed(context, '/login'),
            child: Text(l10n.signIn),
          ),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.myPurchases),
        actions: const [LanguageToggle()],
      ),
      body: StreamBuilder<QuerySnapshot>(
        stream: FirebaseFirestore.instance
            .collection('carPurchases')
            .where('buyerUid', isEqualTo: user.uid)
            .snapshots(),
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
              return _PurchaseCard(purchase: purchase);
            },
          );
        },
      ),
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
