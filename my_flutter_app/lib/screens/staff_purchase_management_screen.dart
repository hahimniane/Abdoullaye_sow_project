import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../l10n/app_localizations.dart';
import '../models/car_purchase.dart';
import '../theme/app_colors.dart';
import '../widgets/language_toggle.dart';

class StaffPurchaseManagementScreen extends StatelessWidget {
  const StaffPurchaseManagementScreen({super.key});

  Future<void> _updateStatus(
    BuildContext context,
    CarPurchase purchase,
    String status,
  ) async {
    final firestore = FirebaseFirestore.instance;
    final batch = firestore.batch();
    final purchaseRef = firestore.collection('carPurchases').doc(purchase.id);
    batch.update(purchaseRef, {
      'purchaseStatus': status,
      'updatedAt': FieldValue.serverTimestamp(),
    });
    if (status == 'completed') {
      batch.update(firestore.collection('cars').doc(purchase.carId), {
        'status': 'sold',
        'soldInfo': {
          'customerName': purchase.buyerName,
          'customerPhone': purchase.buyerPhone,
          'customerEmail': purchase.buyerEmail,
          'amount': purchase.depositAmount,
          'soldDate': FieldValue.serverTimestamp(),
          'notes': 'Deposit paid through app',
        },
        'updatedAt': FieldValue.serverTimestamp(),
      });
    } else if (status == 'cancelled' || status == 'refunded') {
      batch.update(firestore.collection('cars').doc(purchase.carId), {
        'status': 'active',
        'reservedPurchaseId': FieldValue.delete(),
        'updatedAt': FieldValue.serverTimestamp(),
      });
    }
    await batch.commit();
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(AppLocalizations.of(context)!.purchaseUpdated)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.purchaseReservations),
        actions: const [LanguageToggle()],
      ),
      body: StreamBuilder<QuerySnapshot>(
        stream: FirebaseFirestore.instance
            .collection('carPurchases')
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
              return _StaffPurchaseCard(
                purchase: purchase,
                onStatus: (status) => _updateStatus(context, purchase, status),
              );
            },
          );
        },
      ),
    );
  }
}

class _StaffPurchaseCard extends StatelessWidget {
  const _StaffPurchaseCard({required this.purchase, required this.onStatus});

  final CarPurchase purchase;
  final ValueChanged<String> onStatus;

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
            Text(
              '${l10n.destinationCountry}: ${purchase.destinationCountryName}',
            ),
            Text(
              l10n.depositPaid(
                currency.format(purchase.depositAmount),
                purchase.paymentStatus,
              ),
            ),
            const SizedBox(height: 12),
            Wrap(
              spacing: 8,
              children: [
                OutlinedButton(
                  onPressed: () => onStatus('completed'),
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
            ),
          ],
        ),
      ),
    );
  }
}
