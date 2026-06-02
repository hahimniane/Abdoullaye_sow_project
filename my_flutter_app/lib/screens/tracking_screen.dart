import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../l10n/app_localizations.dart';
import '../models/barrel_shipment.dart';
import '../providers/auth_provider.dart';
import '../theme/app_colors.dart';
import '../utils/barrel_receipt_generator.dart';
import '../widgets/language_toggle.dart';

class TrackingScreen extends StatelessWidget {
  const TrackingScreen({super.key});

  static final Uri _carrierTrackingUri = Uri.parse(
    'https://www.maersk.com/tracking',
  );

  Future<void> _openCarrierTracking(BuildContext context) async {
    final messenger = ScaffoldMessenger.of(context);
    final l10n = AppLocalizations.of(context)!;
    final opened = await launchUrl(
      _carrierTrackingUri,
      mode: LaunchMode.externalApplication,
    );
    if (!opened) {
      messenger.showSnackBar(
        SnackBar(content: Text(l10n.couldNotOpenCarrierTracking)),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final auth = context.watch<AuthProvider>();
    final user = auth.user;

    if (user == null) {
      return Scaffold(
        backgroundColor: AppColors.lightBg,
        body: SafeArea(
          child: _EmptyShipmentsState(
            title: l10n.trackShipment,
            message: l10n.signInToTrackShipments,
            actionLabel: l10n.signIn,
            onAction: () => Navigator.pushNamed(context, '/login'),
            onOpenCarrierTracking: () => _openCarrierTracking(context),
          ),
        ),
      );
    }

    return Scaffold(
      backgroundColor: AppColors.lightBg,
      body: StreamBuilder<QuerySnapshot>(
        stream: FirebaseFirestore.instance
            .collection('barrelShipments')
            .where('customerUid', isEqualTo: user.uid)
            .snapshots(),
        builder: (context, snapshot) {
          if (snapshot.hasError) {
            return SafeArea(
              child: _EmptyShipmentsState(
                title: l10n.trackShipment,
                icon: Icons.lock_outline,
                message: l10n.shipmentsLoadError,
                onOpenCarrierTracking: () => _openCarrierTracking(context),
              ),
            );
          }

          if (!snapshot.hasData) {
            return const Center(child: CircularProgressIndicator());
          }

          final shipments =
              snapshot.data!.docs.map(BarrelShipment.fromFirestore).toList()
                ..sort((a, b) => b.createdAt.compareTo(a.createdAt));

          if (shipments.isEmpty) {
            return SafeArea(
              child: _EmptyShipmentsState(
                title: l10n.trackShipment,
                message: l10n.shipmentsAppearAfterPayment,
                actionLabel: l10n.sendBarrels,
                onAction: () => Navigator.pushNamed(context, '/barrel'),
                onOpenCarrierTracking: () => _openCarrierTracking(context),
              ),
            );
          }

          return SafeArea(
            child: Column(
              children: [
                _ShipmentsHeader(
                  title: l10n.trackShipment,
                  onOpenCarrierTracking: () => _openCarrierTracking(context),
                ),
                if (!context.watch<AuthProvider>().hasBusinessDashboardAccess)
                  _WalletSummary(customerUid: user.uid),
                _ShipmentStats(shipments: shipments),
                Expanded(
                  child: RefreshIndicator(
                    onRefresh: () async {},
                    child: ListView.separated(
                      physics: const AlwaysScrollableScrollPhysics(),
                      padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
                      itemCount: shipments.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 12),
                      itemBuilder: (context, index) {
                        return _ShipmentCard(shipment: shipments[index]);
                      },
                    ),
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

class _WalletSummary extends StatelessWidget {
  const _WalletSummary({required this.customerUid});

  final String customerUid;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<DocumentSnapshot>(
      stream: FirebaseFirestore.instance
          .collection('wallets')
          .doc(customerUid)
          .snapshots(),
      builder: (context, snapshot) {
        final l10n = AppLocalizations.of(context)!;
        final data = snapshot.data?.data() as Map<String, dynamic>?;
        final balance =
            (data?['balance'] as num?)?.toDouble() ??
            (((data?['balanceCents'] as num?)?.toDouble() ?? 0) / 100);
        final currency = NumberFormat.simpleCurrency(
          name: (data?['currency'] as String?)?.toUpperCase() ?? 'USD',
        );

        return Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
          child: StreamBuilder<QuerySnapshot>(
            stream: FirebaseFirestore.instance
                .collection('wallets')
                .doc(customerUid)
                .collection('transactions')
                .orderBy('createdAt', descending: true)
                .limit(3)
                .snapshots(),
            builder: (context, transactionsSnapshot) {
              final transactions = transactionsSnapshot.data?.docs ?? [];
              return Container(
                width: double.infinity,
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: AppColors.paper,
                  border: Border.all(color: AppColors.rule),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Column(
                  children: [
                    Row(
                      children: [
                        Container(
                          width: 38,
                          height: 38,
                          decoration: BoxDecoration(
                            color: AppColors.sage.withValues(alpha: 0.12),
                            borderRadius: BorderRadius.circular(8),
                          ),
                          child: const Icon(
                            Icons.account_balance_wallet_outlined,
                            color: AppColors.sage,
                            size: 21,
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                l10n.walletBalance,
                                style: Theme.of(context).textTheme.bodySmall
                                    ?.copyWith(
                                      color: AppColors.lightMuted,
                                      fontWeight: FontWeight.w800,
                                    ),
                              ),
                              Text(
                                currency.format(balance),
                                style: Theme.of(context).textTheme.titleLarge
                                    ?.copyWith(fontWeight: FontWeight.w900),
                              ),
                            ],
                          ),
                        ),
                        Text(
                          l10n.refundCredits,
                          style: Theme.of(context).textTheme.bodySmall
                              ?.copyWith(
                                color: AppColors.lightMuted,
                                fontWeight: FontWeight.w700,
                              ),
                        ),
                      ],
                    ),
                    if (transactions.isNotEmpty) ...[
                      const SizedBox(height: 12),
                      const Divider(height: 1),
                      const SizedBox(height: 8),
                      ...transactions.map((doc) {
                        final item = doc.data() as Map<String, dynamic>;
                        final amount =
                            (item['amount'] as num?)?.toDouble() ??
                            (((item['amountCents'] as num?)?.toDouble() ?? 0) /
                                100);
                        final trackingCode =
                            (item['trackingCode'] as String?) ?? '';
                        return Padding(
                          padding: const EdgeInsets.only(top: 6),
                          child: Row(
                            children: [
                              const Icon(
                                Icons.add_circle_outline,
                                color: AppColors.sage,
                                size: 16,
                              ),
                              const SizedBox(width: 8),
                              Expanded(
                                child: Text(
                                  trackingCode.isEmpty
                                      ? l10n.destinationRefund
                                      : l10n.destinationRefundWithCode(
                                          trackingCode,
                                        ),
                                  style: Theme.of(context).textTheme.bodySmall,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              Text(
                                currency.format(amount),
                                style: Theme.of(context).textTheme.bodySmall
                                    ?.copyWith(
                                      color: AppColors.sage,
                                      fontWeight: FontWeight.w800,
                                    ),
                              ),
                            ],
                          ),
                        );
                      }),
                    ],
                  ],
                ),
              );
            },
          ),
        );
      },
    );
  }
}

class _ShipmentsHeader extends StatelessWidget {
  const _ShipmentsHeader({
    required this.title,
    required this.onOpenCarrierTracking,
  });

  final String title;
  final VoidCallback onOpenCarrierTracking;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 8),
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
          IconButton(
            onPressed: onOpenCarrierTracking,
            tooltip: AppLocalizations.of(context)!.carrierTracking,
            icon: const Icon(Icons.open_in_new),
          ),
          const LanguageToggle(),
        ],
      ),
    );
  }
}

class _ShipmentStats extends StatelessWidget {
  const _ShipmentStats({required this.shipments});

  final List<BarrelShipment> shipments;

  @override
  Widget build(BuildContext context) {
    final activeCount = shipments
        .where((shipment) => shipment.status != 'completed')
        .length;
    final pickupCount = shipments
        .where((shipment) => shipment.pickupRequested)
        .length;
    final completedCount = shipments
        .where((shipment) => shipment.status == 'completed')
        .length;
    final l10n = AppLocalizations.of(context)!;

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
      child: Row(
        children: [
          Expanded(
            child: _StatTile(
              label: l10n.activeShort,
              value: activeCount.toString(),
              icon: Icons.local_shipping,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: _StatTile(
              label: l10n.pickupShort,
              value: pickupCount.toString(),
              icon: Icons.home_work_outlined,
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: _StatTile(
              label: l10n.doneShort,
              value: completedCount.toString(),
              icon: Icons.check_circle_outline,
            ),
          ),
        ],
      ),
    );
  }
}

class _StatTile extends StatelessWidget {
  const _StatTile({
    required this.label,
    required this.value,
    required this.icon,
  });

  final String label;
  final String value;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.paper,
        border: Border.all(color: AppColors.rule),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18, color: AppColors.cobalt),
          const SizedBox(height: 8),
          Text(
            value,
            style: Theme.of(
              context,
            ).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w900),
          ),
          Text(
            label,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
              color: AppColors.lightMuted,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _ShipmentCard extends StatelessWidget {
  const _ShipmentCard({required this.shipment});

  final BarrelShipment shipment;

  Future<void> _copyTrackingNumber(BuildContext context) async {
    await Clipboard.setData(ClipboardData(text: shipment.trackingCode));
    if (!context.mounted) return;
    final l10n = AppLocalizations.of(context)!;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(l10n.trackingNumberCopiedShort)));
  }

  Future<void> _downloadReceipt(BuildContext context) async {
    await generateBarrelShipmentReceipt(shipment: shipment);
  }

  @override
  Widget build(BuildContext context) {
    final currency = NumberFormat.simpleCurrency();
    final l10n = AppLocalizations.of(context)!;
    final createdAt = DateFormat.yMMMd().add_jm().format(shipment.createdAt);
    final pickupDate = shipment.pickupDateTime == null
        ? null
        : DateFormat.MMMd().add_jm().format(shipment.pickupDateTime!);

    return Card(
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: () => Navigator.pushNamed(
          context,
          '/barrel-shipment-details',
          arguments: shipment,
        ),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          shipment.trackingCode,
                          style: Theme.of(context).textTheme.titleMedium
                              ?.copyWith(fontWeight: FontWeight.w900),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          l10n.toReceiverInCountry(
                            shipment.receiverName,
                            shipment.destinationCountryName,
                          ),
                          style: Theme.of(context).textTheme.bodyMedium
                              ?.copyWith(color: AppColors.lightMuted),
                        ),
                      ],
                    ),
                  ),
                  _StatusPill(
                    label: _statusLabel(l10n, shipment.status),
                    color: _statusColor(shipment.status),
                  ),
                ],
              ),
              const SizedBox(height: 14),
              _DetailLine(
                icon: shipment.pickupRequested
                    ? Icons.home_work_outlined
                    : Icons.storefront_outlined,
                text: shipment.pickupRequested
                    ? (pickupDate == null
                          ? l10n.pickupRequested
                          : l10n.pickupRequestedWithDate(pickupDate))
                    : l10n.customerDropOffAtOffice,
              ),
              const SizedBox(height: 8),
              _DetailLine(
                icon: Icons.payments_outlined,
                text:
                    '${currency.format(shipment.price)} • ${_paymentLabel(l10n, shipment.paymentStatus)}',
              ),
              if (shipment.deliveryEstimateLabel != null) ...[
                const SizedBox(height: 8),
                _DetailLine(
                  icon: Icons.schedule_outlined,
                  text: l10n.deliveryWithLabel(shipment.deliveryEstimateLabel!),
                ),
              ],
              const SizedBox(height: 8),
              _DetailLine(icon: Icons.schedule, text: createdAt),
              const SizedBox(height: 14),
              Row(
                children: [
                  OutlinedButton.icon(
                    onPressed: () => _copyTrackingNumber(context),
                    icon: const Icon(Icons.copy, size: 18),
                    label: Text(l10n.copy),
                  ),
                  const SizedBox(width: 8),
                  OutlinedButton.icon(
                    onPressed: () => _downloadReceipt(context),
                    icon: const Icon(Icons.receipt_long, size: 18),
                    label: Text(l10n.receipt),
                  ),
                  const Spacer(),
                  Icon(
                    Icons.chevron_right,
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  static String _statusLabel(AppLocalizations l10n, String status) {
    switch (status) {
      case 'pending_payment':
        return l10n.pendingPayment;
      case 'pending':
        return l10n.requested;
      case 'in_transit':
        return l10n.inTransit;
      case 'completed':
        return l10n.completed;
      case 'cancelled':
        return l10n.cancelled;
      default:
        return status;
    }
  }

  static Color _statusColor(String status) {
    switch (status) {
      case 'completed':
        return AppColors.sage;
      case 'in_transit':
        return AppColors.cobalt;
      case 'cancelled':
        return AppColors.errorRed;
      case 'pending_payment':
        return AppColors.warn;
      default:
        return AppColors.saffron;
    }
  }

  static String _paymentLabel(AppLocalizations l10n, String paymentStatus) {
    switch (paymentStatus) {
      case 'succeeded':
        return l10n.paid;
      case 'simulated_succeeded':
        return l10n.paid;
      case 'pending':
        return l10n.paymentPending;
      case 'cancelled':
        return l10n.paymentCancelled;
      default:
        return paymentStatus.replaceAll('_', ' ');
    }
  }
}

class _DetailLine extends StatelessWidget {
  const _DetailLine({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 18, color: AppColors.cobalt),
        const SizedBox(width: 8),
        Expanded(
          child: Text(
            text,
            style: Theme.of(context).textTheme.bodyMedium,
            overflow: TextOverflow.ellipsis,
            maxLines: 2,
          ),
        ),
      ],
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 12,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _EmptyShipmentsState extends StatelessWidget {
  const _EmptyShipmentsState({
    required this.title,
    required this.message,
    required this.onOpenCarrierTracking,
    this.icon = Icons.inventory_2_outlined,
    this.actionLabel,
    this.onAction,
  });

  final String title;
  final String message;
  final IconData icon;
  final String? actionLabel;
  final VoidCallback? onAction;
  final VoidCallback onOpenCarrierTracking;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        _ShipmentsHeader(
          title: title,
          onOpenCarrierTracking: onOpenCarrierTracking,
        ),
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
                      color: AppColors.cobalt.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(18),
                    ),
                    child: Icon(icon, color: AppColors.cobalt),
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
                  const SizedBox(height: 18),
                  Wrap(
                    alignment: WrapAlignment.center,
                    spacing: 10,
                    runSpacing: 10,
                    children: [
                      if (actionLabel != null && onAction != null)
                        FilledButton(
                          onPressed: onAction,
                          child: Text(actionLabel!),
                        ),
                      OutlinedButton.icon(
                        onPressed: onOpenCarrierTracking,
                        icon: const Icon(Icons.open_in_new, size: 18),
                        label: Text(
                          AppLocalizations.of(context)!.carrierTracking,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
      ],
    );
  }
}
