import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../models/barrel_shipment.dart';
import '../models/business_profile.dart';
import '../models/business_service.dart';
import '../models/platform_access.dart';
import '../l10n/app_localizations.dart';
import '../providers/auth_provider.dart';
import '../theme/app_colors.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/country_phone_field.dart';
import '../widgets/language_toggle.dart';
import 'staff_car_management_screen.dart';

class PlatformAdminDashboardScreen extends StatelessWidget {
  const PlatformAdminDashboardScreen({super.key});

  Future<int> _count(String collection, {String? field, Object? value}) async {
    Query<Map<String, dynamic>> query = FirebaseFirestore.instance.collection(
      collection,
    );
    if (field != null) query = query.where(field, isEqualTo: value);
    final snapshot = await query.count().get();
    return snapshot.count ?? 0;
  }

  Future<_AdminMetrics> _metrics(PlatformAccess access) async {
    final values = await Future.wait<int>([
      access.canView(PlatformSection.businesses)
          ? _count('businesses', field: 'status', value: 'pending')
          : Future.value(0),
      access.canView(PlatformSection.businesses)
          ? _count('businesses', field: 'status', value: 'approved')
          : Future.value(0),
      access.canView(PlatformSection.people)
          ? _count('users', field: 'role', value: 'customer')
          : Future.value(0),
      access.canView(PlatformSection.operations)
          ? _count('barrelShipments', field: 'status', value: 'pending')
          : Future.value(0),
      access.canView(PlatformSection.marketplace)
          ? _count('cars', field: 'status', value: 'active')
          : Future.value(0),
      access.canView(PlatformSection.marketplace)
          ? _count('carPurchases', field: 'purchaseStatus', value: 'pending')
          : Future.value(0),
      access.canView(PlatformSection.finance)
          ? _count('walletRefundRequests', field: 'status', value: 'pending')
          : Future.value(0),
    ]);
    return _AdminMetrics(
      pendingBusinesses: values[0],
      approvedBusinesses: values[1],
      customers: values[2],
      openShipments: values[3],
      activeCars: values[4],
      pendingPurchases: values[5],
      refundRequests: values[6],
    );
  }

  @override
  Widget build(BuildContext context) {
    final access = context.watch<AuthProvider>().platformAccess;
    final canViewBusinesses = access.canView(PlatformSection.businesses);
    final canViewFinance = access.canView(PlatformSection.finance);
    final canViewOperations = access.canView(PlatformSection.operations);
    return Scaffold(
      backgroundColor: AppColors.lightBg,
      body: SafeArea(
        child: LayoutBuilder(
          builder: (context, constraints) {
            final wide = constraints.maxWidth >= 980;
            return CustomScrollView(
              slivers: [
                SliverToBoxAdapter(
                  child: _DashboardHeader(wide: wide, access: access),
                ),
                SliverPadding(
                  padding: EdgeInsets.fromLTRB(
                    wide ? 28 : 16,
                    12,
                    wide ? 28 : 16,
                    28,
                  ),
                  sliver: SliverToBoxAdapter(
                    child: Center(
                      child: ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 1280),
                        child: Column(
                          children: [
                            FutureBuilder<_AdminMetrics>(
                              future: _metrics(access),
                              builder: (context, snapshot) {
                                return _MetricsGrid(
                                  metrics:
                                      snapshot.data ?? _AdminMetrics.empty(),
                                  isLoading: !snapshot.hasData,
                                  access: access,
                                );
                              },
                            ),
                            const SizedBox(height: 16),
                            if (wide && canViewBusinesses && canViewFinance)
                              const Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Expanded(flex: 5, child: _ActionQueuePanel()),
                                  SizedBox(width: 16),
                                  Expanded(flex: 4, child: _FinancePanel()),
                                ],
                              )
                            else ...[
                              if (canViewBusinesses) const _ActionQueuePanel(),
                              if (canViewBusinesses && canViewFinance)
                                const SizedBox(height: 16),
                              if (canViewFinance) const _FinancePanel(),
                            ],
                            const SizedBox(height: 16),
                            if (wide && canViewBusinesses && canViewOperations)
                              const Row(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Expanded(child: _BusinessControlPanel()),
                                  SizedBox(width: 16),
                                  Expanded(child: _OperationsPanel()),
                                ],
                              )
                            else ...[
                              if (canViewBusinesses)
                                const _BusinessControlPanel(),
                              if (canViewBusinesses && canViewOperations)
                                const SizedBox(height: 16),
                              if (canViewOperations) const _OperationsPanel(),
                            ],
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _DashboardHeader extends StatelessWidget {
  const _DashboardHeader({required this.wide, required this.access});

  final bool wide;
  final PlatformAccess access;

  @override
  Widget build(BuildContext context) {
    final titleBlock = const _DashboardTitleBlock();
    final badge = Container(
      width: 52,
      height: 52,
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.16),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.white.withValues(alpha: 0.22)),
      ),
      child: const Icon(
        Icons.admin_panel_settings_outlined,
        color: Colors.white,
      ),
    );
    final actions = _DashboardHeaderActions(
      onAddManager: access.canManage(PlatformSection.people)
          ? () => showAddPlatformManagerDialog(context)
          : null,
      onBusinesses: access.canView(PlatformSection.businesses)
          ? () => Navigator.pushNamed(context, '/businesses')
          : null,
      onUsers: access.canView(PlatformSection.people)
          ? () => Navigator.pushNamed(context, '/user-management')
          : null,
    );
    return Container(
      padding: EdgeInsets.fromLTRB(wide ? 28 : 16, 16, wide ? 28 : 16, 20),
      decoration: const BoxDecoration(gradient: AppColors.headerGradient),
      child: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 1280),
          child: wide
              ? Row(
                  children: [
                    badge,
                    const SizedBox(width: 14),
                    const Expanded(child: _DashboardTitleBlock()),
                    actions,
                  ],
                )
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        badge,
                        const SizedBox(width: 12),
                        Expanded(child: titleBlock),
                      ],
                    ),
                    const SizedBox(height: 14),
                    actions,
                  ],
                ),
        ),
      ),
    );
  }
}

class _DashboardTitleBlock extends StatelessWidget {
  const _DashboardTitleBlock();

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          l10n.platformDashboard,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            color: Colors.white,
            fontSize: 20,
            fontWeight: FontWeight.w900,
          ),
        ),
        const SizedBox(height: 3),
        Text(
          l10n.platformDashboardSubtitle,
          maxLines: 3,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(color: Colors.white70),
        ),
      ],
    );
  }
}

class _DashboardHeaderActions extends StatelessWidget {
  const _DashboardHeaderActions({
    required this.onAddManager,
    required this.onBusinesses,
    required this.onUsers,
  });

  final VoidCallback? onAddManager;
  final VoidCallback? onBusinesses;
  final VoidCallback? onUsers;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Wrap(
      spacing: 8,
      runSpacing: 8,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        if (onAddManager != null)
          _HeaderIconButton(
            tooltip: l10n.addPlatformManager,
            icon: Icons.admin_panel_settings,
            onPressed: onAddManager!,
          ),
        if (onBusinesses != null)
          _HeaderIconButton(
            tooltip: l10n.businesses,
            icon: Icons.storefront_outlined,
            onPressed: onBusinesses!,
          ),
        if (onUsers != null)
          _HeaderIconButton(
            tooltip: l10n.users,
            icon: Icons.people_outline,
            onPressed: onUsers!,
          ),
        const LanguageToggle(),
      ],
    );
  }
}

class _HeaderIconButton extends StatelessWidget {
  const _HeaderIconButton({
    required this.tooltip,
    required this.icon,
    required this.onPressed,
  });

  final String tooltip;
  final IconData icon;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.white.withValues(alpha: 0.14),
      borderRadius: BorderRadius.circular(8),
      child: IconButton(
        tooltip: tooltip,
        onPressed: onPressed,
        icon: Icon(icon),
        color: Colors.white,
      ),
    );
  }
}

class _MetricsGrid extends StatelessWidget {
  const _MetricsGrid({
    required this.metrics,
    required this.isLoading,
    required this.access,
  });

  final _AdminMetrics metrics;
  final bool isLoading;
  final PlatformAccess access;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final items = [
      if (access.canView(PlatformSection.businesses))
        _MetricData(
          l10n.pendingBusinesses,
          metrics.pendingBusinesses,
          Icons.hourglass_top,
          _DashboardShortcut.pendingBusinesses,
        ),
      if (access.canView(PlatformSection.businesses))
        _MetricData(
          l10n.approvedBusinesses,
          metrics.approvedBusinesses,
          Icons.verified_outlined,
          _DashboardShortcut.approvedBusinesses,
        ),
      if (access.canView(PlatformSection.people))
        _MetricData(
          l10n.customers,
          metrics.customers,
          Icons.person_outline,
          _DashboardShortcut.customers,
        ),
      if (access.canView(PlatformSection.operations))
        _MetricData(
          l10n.openShipments,
          metrics.openShipments,
          Icons.inventory_2_outlined,
          _DashboardShortcut.openShipments,
        ),
      if (access.canView(PlatformSection.marketplace))
        _MetricData(
          l10n.activeCars,
          metrics.activeCars,
          Icons.directions_car_outlined,
          _DashboardShortcut.activeCars,
        ),
      if (access.canView(PlatformSection.marketplace))
        _MetricData(
          l10n.pendingPurchases,
          metrics.pendingPurchases,
          Icons.receipt_long,
          _DashboardShortcut.pendingPurchases,
        ),
      if (access.canView(PlatformSection.finance))
        _MetricData(
          l10n.refundRequests,
          metrics.refundRequests,
          Icons.account_balance_wallet_outlined,
          _DashboardShortcut.refundRequests,
        ),
    ];
    return LayoutBuilder(
      builder: (context, constraints) {
        final columns = constraints.maxWidth >= 1100
            ? 4
            : constraints.maxWidth >= 760
            ? 3
            : 2;
        return GridView.builder(
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          itemCount: items.length,
          gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
            crossAxisCount: columns,
            mainAxisSpacing: 12,
            crossAxisSpacing: 12,
            mainAxisExtent: constraints.maxWidth < 760 ? 108 : 112,
          ),
          itemBuilder: (context, index) {
            return _MetricCard(data: items[index], isLoading: isLoading);
          },
        );
      },
    );
  }
}

class _MetricCard extends StatelessWidget {
  const _MetricCard({required this.data, required this.isLoading});

  final _MetricData data;
  final bool isLoading;

  @override
  Widget build(BuildContext context) {
    return _Panel(
      padding: EdgeInsets.zero,
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: isLoading ? null : () => _openDashboardShortcut(context, data),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: AppColors.mist,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Icon(data.icon, color: AppColors.cobaltDeep),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      isLoading ? '...' : data.value.toString(),
                      style: const TextStyle(
                        color: AppColors.ink,
                        fontSize: 18,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    Text(
                      data.label,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.muted,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right, color: AppColors.muted, size: 20),
            ],
          ),
        ),
      ),
    );
  }
}

void _openDashboardShortcut(BuildContext context, _MetricData data) {
  switch (data.shortcut) {
    case _DashboardShortcut.pendingBusinesses:
      _showBusinessListSheet(
        context,
        title: AppLocalizations.of(context)!.pendingBusinesses,
        status: 'pending',
      );
      break;
    case _DashboardShortcut.approvedBusinesses:
      _showBusinessListSheet(
        context,
        title: AppLocalizations.of(context)!.approvedBusinesses,
        status: 'approved',
      );
      break;
    case _DashboardShortcut.customers:
      Navigator.pushNamed(context, '/user-management');
      break;
    case _DashboardShortcut.openShipments:
      _showShipmentListSheet(context, status: 'pending');
      break;
    case _DashboardShortcut.activeCars:
      Navigator.push(
        context,
        MaterialPageRoute<void>(
          builder: (_) => const StaffCarManagementScreen(showBackButton: true),
        ),
      );
      break;
    case _DashboardShortcut.pendingPurchases:
      Navigator.pushNamed(context, '/purchase-management');
      break;
    case _DashboardShortcut.refundRequests:
      _showRefundRequestsSheet(context);
      break;
  }
}

Future<void> _showBusinessListSheet(
  BuildContext context, {
  required String title,
  required String status,
}) async {
  await _showDashboardSheet(
    context,
    title: title,
    child: StreamBuilder<QuerySnapshot>(
      stream: FirebaseFirestore.instance
          .collection('businesses')
          .where('status', isEqualTo: status)
          .snapshots(),
      builder: (context, snapshot) {
        if (!snapshot.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        final businesses =
            snapshot.data!.docs.map(BusinessProfile.fromFirestore).toList()
              ..sort((a, b) => a.name.compareTo(b.name));
        if (businesses.isEmpty) {
          return _EmptyPanelMessage(
            AppLocalizations.of(context)!.noMatchingBusinesses,
          );
        }
        return Column(
          children: [
            for (final business in businesses)
              _ListRow(
                icon: Icons.storefront_outlined,
                title: business.name,
                subtitle: [
                  business.status,
                  if ((business.phone ?? '').isNotEmpty) business.phone,
                  if ((business.email ?? '').isNotEmpty) business.email,
                ].whereType<String>().join(' • '),
                trailing: const Icon(Icons.chevron_right),
                onTap: () {
                  Navigator.pop(context);
                  _showReviewSheet(context, business);
                },
              ),
          ],
        );
      },
    ),
  );
}

Future<void> _showShipmentListSheet(
  BuildContext context, {
  required String status,
}) async {
  await _showDashboardSheet(
    context,
    title: AppLocalizations.of(context)!.openShipments,
    child: StreamBuilder<QuerySnapshot>(
      stream: FirebaseFirestore.instance
          .collection('barrelShipments')
          .where('status', isEqualTo: status)
          .snapshots(),
      builder: (context, snapshot) {
        if (!snapshot.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        final shipments =
            snapshot.data!.docs.map(BarrelShipment.fromFirestore).toList()
              ..sort((a, b) => b.createdAt.compareTo(a.createdAt));
        if (shipments.isEmpty) {
          return _EmptyPanelMessage(
            AppLocalizations.of(context)!.noOpenShipments,
          );
        }
        return Column(
          children: [
            for (final shipment in shipments)
              _ListRow(
                icon: Icons.inventory_2_outlined,
                title: '${shipment.receiverName} • ${shipment.trackingCode}',
                subtitle:
                    [
                          shipment.businessName,
                          shipment.destinationCountryName,
                          shipment.customerEmail,
                        ]
                        .whereType<String>()
                        .where((item) => item.isNotEmpty)
                        .join(' • '),
                trailing: _StatusPill(label: shipment.status),
                onTap: () {
                  Navigator.pop(context);
                  Navigator.pushNamed(
                    context,
                    '/barrel-shipment-details',
                    arguments: shipment,
                  );
                },
              ),
          ],
        );
      },
    ),
  );
}

Future<void> _showRefundRequestsSheet(BuildContext context) async {
  final currency = NumberFormat.simpleCurrency();
  final l10n = AppLocalizations.of(context)!;
  await _showDashboardSheet(
    context,
    title: l10n.refundRequests,
    child: StreamBuilder<QuerySnapshot>(
      stream: FirebaseFirestore.instance
          .collection('walletRefundRequests')
          .where('status', isEqualTo: 'pending')
          .snapshots(),
      builder: (context, snapshot) {
        if (!snapshot.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        final docs = snapshot.data!.docs;
        if (docs.isEmpty) {
          return _EmptyPanelMessage(l10n.noPendingRefundRequests);
        }
        return Column(
          children: [
            for (final doc in docs)
              Builder(
                builder: (context) {
                  final data = doc.data() as Map<String, dynamic>;
                  final amount = (data['amount'] as num?)?.toDouble() ?? 0;
                  return _ListRow(
                    icon: Icons.payments_outlined,
                    title: currency.format(amount),
                    subtitle: [
                      data['customerEmail']?.toString() ?? l10n.customer,
                      data['reason']?.toString() ?? l10n.cardReturnRequest,
                    ].where((item) => item.isNotEmpty).join(' • '),
                    trailing: _StatusPill(label: l10n.pending),
                    onTap: () => _showRefundDetails(context, doc.id, data),
                  );
                },
              ),
          ],
        );
      },
    ),
  );
}

Future<void> _showDashboardSheet(
  BuildContext context, {
  required String title,
  required Widget child,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (context) {
      return DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.78,
        maxChildSize: 0.94,
        minChildSize: 0.42,
        builder: (context, scrollController) {
          return ListView(
            controller: scrollController,
            padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      title,
                      style: const TextStyle(
                        fontSize: 17,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                  IconButton(
                    onPressed: () => Navigator.pop(context),
                    icon: const Icon(Icons.close),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              child,
            ],
          );
        },
      );
    },
  );
}

void _showRefundDetails(
  BuildContext context,
  String requestId,
  Map<String, dynamic> data,
) {
  final currency = NumberFormat.simpleCurrency();
  final amount = (data['amount'] as num?)?.toDouble() ?? 0;
  final l10n = AppLocalizations.of(context)!;
  showDialog<void>(
    context: context,
    builder: (context) {
      return AlertDialog(
        title: Text(l10n.refundRequest),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(l10n.amountLabel(currency.format(amount))),
            Text(l10n.customerLabel(data['customerEmail'] ?? l10n.unknown)),
            Text(l10n.statusLabelValue(data['status'] ?? l10n.pending)),
            if ((data['businessName'] ?? '').toString().isNotEmpty)
              Text(l10n.businessLabel(data['businessName'])),
            const SizedBox(height: 10),
            Text(
              '${l10n.requestId}: $requestId',
              style: const TextStyle(color: AppColors.muted, fontSize: 12),
            ),
            const SizedBox(height: 10),
            Text(
              l10n.cardReturnsSimulatedNotice,
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context),
            child: Text(l10n.close),
          ),
        ],
      );
    },
  );
}

Future<void> showAddPlatformManagerDialog(BuildContext context) async {
  final l10n = AppLocalizations.of(context)!;
  final authProvider = context.read<AuthProvider>();
  final messenger = ScaffoldMessenger.of(context);
  final formKey = GlobalKey<FormState>();
  final nameController = TextEditingController();
  final emailController = TextEditingController();
  String adminRole = 'operationsManager';
  bool saving = false;

  await showDialog<void>(
    context: context,
    builder: (dialogContext) {
      return StatefulBuilder(
        builder: (dialogContext, setDialogState) {
          Future<void> submit() async {
            if (!formKey.currentState!.validate()) return;
            setDialogState(() => saving = true);
            try {
              await authProvider.invitePlatformAdmin(
                fullName: nameController.text,
                email: emailController.text,
                adminRole: adminRole,
                locale: Localizations.localeOf(context).languageCode,
              );
              if (!dialogContext.mounted) return;
              Navigator.pop(dialogContext);
              messenger.showSnackBar(
                SnackBar(
                  content: Text(l10n.invitationSent),
                  backgroundColor: const Color(0xFF16A34A),
                  behavior: SnackBarBehavior.floating,
                ),
              );
            } catch (error) {
              if (!dialogContext.mounted) return;
              messenger.showSnackBar(
                SnackBar(
                  content: Text('$error'),
                  backgroundColor: AppColors.brandRed,
                  behavior: SnackBarBehavior.floating,
                ),
              );
            } finally {
              if (dialogContext.mounted) {
                setDialogState(() => saving = false);
              }
            }
          }

          return AlertDialog(
            title: Text(l10n.invitePlatformAdministrator),
            content: Form(
              key: formKey,
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    TextFormField(
                      controller: nameController,
                      textCapitalization: TextCapitalization.words,
                      decoration: InputDecoration(
                        labelText: l10n.fullName,
                        prefixIcon: const Icon(Icons.badge_outlined),
                      ),
                      validator: (value) =>
                          value == null || value.trim().isEmpty
                          ? l10n.fullNameRequired
                          : null,
                    ),
                    const SizedBox(height: 10),
                    TextFormField(
                      controller: emailController,
                      keyboardType: TextInputType.emailAddress,
                      decoration: InputDecoration(
                        labelText: l10n.email,
                        prefixIcon: const Icon(Icons.email_outlined),
                      ),
                      validator: (value) {
                        final trimmed = value?.trim() ?? '';
                        if (trimmed.isEmpty) return l10n.emailRequired;
                        if (!RegExp(
                          r'^[\w\-.]+@([\w-]+\.)+[\w-]{2,4}$',
                        ).hasMatch(trimmed)) {
                          return l10n.validEmailRequired;
                        }
                        return null;
                      },
                    ),
                    const SizedBox(height: 10),
                    DropdownButtonFormField<String>(
                      initialValue: adminRole,
                      decoration: InputDecoration(
                        labelText: l10n.adminRole,
                        prefixIcon: const Icon(Icons.security_outlined),
                      ),
                      items: [
                        DropdownMenuItem(
                          value: 'operationsManager',
                          child: Text(l10n.operationsManager),
                        ),
                        DropdownMenuItem(
                          value: 'financeManager',
                          child: Text(l10n.financeManager),
                        ),
                        DropdownMenuItem(
                          value: 'supportAdmin',
                          child: Text(l10n.supportAdministrator),
                        ),
                        DropdownMenuItem(
                          value: 'contentManager',
                          child: Text(l10n.contentManager),
                        ),
                      ],
                      onChanged: (value) {
                        setDialogState(
                          () => adminRole = value ?? 'operationsManager',
                        );
                      },
                    ),
                  ],
                ),
              ),
            ),
            actions: [
              TextButton(
                onPressed: saving ? null : () => Navigator.pop(dialogContext),
                child: Text(l10n.cancel),
              ),
              FilledButton.icon(
                onPressed: saving ? null : submit,
                icon: saving
                    ? const SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.person_add_alt_1),
                label: Text(saving ? l10n.creating : l10n.sendInvitation),
              ),
            ],
          );
        },
      );
    },
  );

  // Let Flutter finish dismissing the dialog route before these short-lived
  // controllers are garbage collected. Disposing immediately can race the
  // route teardown animation and trigger "used after disposed" in debug mode.
}

class _ActionQueuePanel extends StatelessWidget {
  const _ActionQueuePanel();

  @override
  Widget build(BuildContext context) {
    return _Panel(
      title: AppLocalizations.of(context)!.actionQueue,
      icon: Icons.notifications_active_outlined,
      child: StreamBuilder<QuerySnapshot>(
        stream: FirebaseFirestore.instance
            .collection('businesses')
            .where('status', whereIn: ['pending', 'changes_requested'])
            .snapshots(),
        builder: (context, snapshot) {
          final businesses =
              snapshot.data?.docs.map(BusinessProfile.fromFirestore).toList() ??
              <BusinessProfile>[];
          businesses.sort((a, b) => a.name.compareTo(b.name));
          if (!snapshot.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          if (businesses.isEmpty) {
            return _EmptyPanelMessage(
              AppLocalizations.of(context)!.noBusinessApplicationsWaiting,
            );
          }
          return Column(
            children: [
              for (final business in businesses.take(8))
                _BusinessReviewTile(business: business),
            ],
          );
        },
      ),
    );
  }
}

class _BusinessReviewTile extends StatelessWidget {
  const _BusinessReviewTile({required this.business});

  final BusinessProfile business;

  @override
  Widget build(BuildContext context) {
    return _ListRow(
      icon: Icons.storefront_outlined,
      title: business.name,
      subtitle: [
        business.status,
        if ((business.phone ?? '').isNotEmpty) business.phone,
        if ((business.email ?? '').isNotEmpty) business.email,
      ].whereType<String>().join(' • '),
      trailing: FilledButton(
        onPressed: () => _showReviewSheet(context, business),
        child: Text(AppLocalizations.of(context)!.review),
      ),
      onTap: () => _showReviewSheet(context, business),
    );
  }
}

class _BusinessControlPanel extends StatelessWidget {
  const _BusinessControlPanel();

  @override
  Widget build(BuildContext context) {
    return _Panel(
      title: AppLocalizations.of(context)!.businessManagement,
      icon: Icons.business_center_outlined,
      trailing: TextButton.icon(
        onPressed: () => Navigator.pushNamed(context, '/businesses'),
        icon: const Icon(Icons.open_in_new, size: 18),
        label: Text(AppLocalizations.of(context)!.openFullList),
      ),
      child: StreamBuilder<QuerySnapshot>(
        stream: FirebaseFirestore.instance.collection('businesses').snapshots(),
        builder: (context, snapshot) {
          final businesses =
              snapshot.data?.docs.map(BusinessProfile.fromFirestore).toList() ??
              <BusinessProfile>[];
          businesses.sort((a, b) {
            final status = a.status.compareTo(b.status);
            return status != 0 ? status : a.name.compareTo(b.name);
          });
          if (!snapshot.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          if (businesses.isEmpty) {
            return _EmptyPanelMessage(
              AppLocalizations.of(context)!.noBusinessesYet,
            );
          }
          return Column(
            children: [
              for (final business in businesses.take(10))
                _ListRow(
                  icon: Icons.apartment_outlined,
                  title: business.name,
                  subtitle: [
                    business.status,
                    if ((business.serviceNote ?? '').isNotEmpty)
                      business.serviceNote,
                  ].whereType<String>().join(' • '),
                  trailing: _StatusPill(label: business.status),
                  onTap: () => _showReviewSheet(context, business),
                ),
            ],
          );
        },
      ),
    );
  }
}

class _FinancePanel extends StatelessWidget {
  const _FinancePanel();

  @override
  Widget build(BuildContext context) {
    final currency = NumberFormat.simpleCurrency();
    return _Panel(
      title: AppLocalizations.of(context)!.financeReadiness,
      icon: Icons.account_balance_wallet_outlined,
      child: StreamBuilder<QuerySnapshot>(
        stream: FirebaseFirestore.instance
            .collection('walletRefundRequests')
            .where('status', isEqualTo: 'pending')
            .snapshots(),
        builder: (context, snapshot) {
          final docs = snapshot.data?.docs ?? [];
          if (!snapshot.hasData) {
            return const Center(child: CircularProgressIndicator());
          }
          if (docs.isEmpty) {
            final l10n = AppLocalizations.of(context)!;
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _EmptyPanelMessage(l10n.noPendingWalletCardReturns),
                const SizedBox(height: 10),
                _InfoBand(l10n.stripeConnectPlaceholders),
              ],
            );
          }
          return Column(
            children: [
              for (final doc in docs.take(8))
                _ListRow(
                  icon: Icons.payments_outlined,
                  title: currency.format(
                    ((doc.data() as Map<String, dynamic>)['amount'] as num?)
                            ?.toDouble() ??
                        0,
                  ),
                  subtitle:
                      (doc.data() as Map<String, dynamic>)['customerEmail'] ??
                      AppLocalizations.of(context)!.customerRefundRequest,
                  trailing: _StatusPill(
                    label: AppLocalizations.of(context)!.pending,
                  ),
                  onTap: () => _showRefundDetails(
                    context,
                    doc.id,
                    doc.data() as Map<String, dynamic>,
                  ),
                ),
            ],
          );
        },
      ),
    );
  }
}

class _OperationsPanel extends StatelessWidget {
  const _OperationsPanel();

  @override
  Widget build(BuildContext context) {
    return _Panel(
      title: AppLocalizations.of(context)!.recentOperations,
      icon: Icons.route_outlined,
      child: Column(
        children: const [
          _RecentCollectionRows(
            collection: 'barrelShipments',
            titleField: 'trackingCode',
            subtitleField: 'businessName',
            icon: Icons.inventory_2_outlined,
          ),
          Divider(height: 18),
          _RecentCollectionRows(
            collection: 'carPurchases',
            titleField: 'carTitle',
            subtitleField: 'businessName',
            icon: Icons.receipt_long,
          ),
        ],
      ),
    );
  }
}

class _RecentCollectionRows extends StatelessWidget {
  const _RecentCollectionRows({
    required this.collection,
    required this.titleField,
    required this.subtitleField,
    required this.icon,
  });

  final String collection;
  final String titleField;
  final String subtitleField;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<QuerySnapshot>(
      stream: FirebaseFirestore.instance
          .collection(collection)
          .limit(5)
          .snapshots(),
      builder: (context, snapshot) {
        final docs = snapshot.data?.docs ?? [];
        if (!snapshot.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        if (docs.isEmpty) {
          return const SizedBox.shrink();
        }
        return Column(
          children: [
            for (final doc in docs)
              Builder(
                builder: (context) {
                  final data = doc.data() as Map<String, dynamic>;
                  return _ListRow(
                    icon: icon,
                    title: (data[titleField] ?? doc.id).toString(),
                    subtitle: (data[subtitleField] ?? 'Unassigned business')
                        .toString(),
                    trailing: _StatusPill(
                      label:
                          (data['status'] ?? data['purchaseStatus'] ?? 'open')
                              .toString(),
                    ),
                    onTap: () {
                      if (collection == 'barrelShipments') {
                        Navigator.pushNamed(
                          context,
                          '/barrel-shipment-details',
                          arguments: BarrelShipment.fromFirestore(doc),
                        );
                      } else if (collection == 'carPurchases') {
                        Navigator.pushNamed(context, '/purchase-management');
                      }
                    },
                  );
                },
              ),
          ],
        );
      },
    );
  }
}

Future<void> _showReviewSheet(
  BuildContext context,
  BusinessProfile business,
) async {
  final l10n = AppLocalizations.of(context)!;
  final nameController = TextEditingController(text: business.name);
  final phoneController = TextEditingController(text: business.phone ?? '');
  final emailController = TextEditingController(text: business.email ?? '');
  final websiteController = TextEditingController(text: business.website ?? '');
  final noteController = TextEditingController(
    text: business.serviceNote ?? '',
  );
  final selectedServices = <String>{...business.enabledServices};
  final reviewNoteController = TextEditingController();
  String action = business.status == 'approved' ? 'suspend' : 'approve';
  bool saving = false;

  await showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (context) {
      return StatefulBuilder(
        builder: (context, setModalState) {
          Future<void> submit() async {
            setModalState(() => saving = true);
            try {
              await FirebaseFunctions.instance
                  .httpsCallable('reviewBusinessApplication')
                  .call({
                    'businessId': business.id,
                    'action': action,
                    'name': nameController.text.trim(),
                    'phone': phoneController.text.trim(),
                    'email': emailController.text.trim(),
                    'website': websiteController.text.trim(),
                    'enabledServices': selectedServices.toList(),
                    'serviceNote': noteController.text.trim(),
                    'reviewNote': reviewNoteController.text.trim(),
                  });
              if (!context.mounted) return;
              Navigator.pop(context);
              showSuccessSnackBar(context, l10n.businessReviewSaved);
            } catch (error) {
              if (!context.mounted) return;
              showErrorSnackBar(context, '$error');
            } finally {
              if (context.mounted) setModalState(() => saving = false);
            }
          }

          return Padding(
            padding: EdgeInsets.only(
              left: 20,
              right: 20,
              top: 20,
              bottom: MediaQuery.of(context).viewInsets.bottom + 20,
            ),
            child: SingleChildScrollView(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    business.name,
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.w900,
                    ),
                  ),
                  const SizedBox(height: 14),
                  TextField(
                    controller: nameController,
                    decoration: InputDecoration(labelText: l10n.businessName),
                  ),
                  const SizedBox(height: 10),
                  CountryPhoneField(
                    controller: phoneController,
                    labelText: l10n.phone,
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: emailController,
                    decoration: InputDecoration(labelText: l10n.email),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: websiteController,
                    decoration: InputDecoration(labelText: l10n.website),
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: noteController,
                    minLines: 2,
                    maxLines: 4,
                    decoration: InputDecoration(labelText: l10n.serviceNote),
                  ),
                  const SizedBox(height: 10),
                  Align(
                    alignment: Alignment.centerLeft,
                    child: Text(
                      l10n.services,
                      style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                  for (final service in businessServiceCatalog)
                    CheckboxListTile(
                      value: selectedServices.contains(service.key.value),
                      onChanged: (value) {
                        setModalState(() {
                          if (value == true) {
                            selectedServices.add(service.key.value);
                          } else {
                            selectedServices.remove(service.key.value);
                          }
                        });
                      },
                      title: Text(service.label),
                      subtitle: Text(service.description),
                      secondary: Icon(service.icon),
                      contentPadding: EdgeInsets.zero,
                    ),
                  const SizedBox(height: 10),
                  DropdownButtonFormField<String>(
                    initialValue: action,
                    decoration: InputDecoration(labelText: l10n.reviewAction),
                    items: [
                      DropdownMenuItem(
                        value: 'approve',
                        child: Text(l10n.approve),
                      ),
                      DropdownMenuItem(
                        value: 'suspend',
                        child: Text(l10n.suspend),
                      ),
                      DropdownMenuItem(
                        value: 'reject',
                        child: Text(l10n.reject),
                      ),
                      DropdownMenuItem(
                        value: 'request_changes',
                        child: Text(l10n.requestChanges),
                      ),
                    ],
                    onChanged: (value) {
                      if (value != null) setModalState(() => action = value);
                    },
                  ),
                  const SizedBox(height: 10),
                  TextField(
                    controller: reviewNoteController,
                    minLines: 2,
                    maxLines: 4,
                    decoration: InputDecoration(labelText: l10n.reviewNote),
                  ),
                  const SizedBox(height: 16),
                  SizedBox(
                    width: double.infinity,
                    height: 52,
                    child: FilledButton.icon(
                      onPressed: saving ? null : submit,
                      icon: saving
                          ? const SizedBox(
                              width: 18,
                              height: 18,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.check),
                      label: Text(saving ? l10n.saving : l10n.saveReview),
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

  // Let Flutter finish dismissing the bottom sheet route before these
  // short-lived controllers are garbage collected.
}

class _Panel extends StatelessWidget {
  const _Panel({
    this.title,
    this.icon,
    this.trailing,
    this.padding = const EdgeInsets.all(16),
    required this.child,
  });

  final String? title;
  final IconData? icon;
  final Widget? trailing;
  final EdgeInsets padding;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.paper,
      elevation: 1,
      shadowColor: AppColors.ink.withValues(alpha: 0.08),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: const BorderSide(color: AppColors.rule),
      ),
      child: Padding(
        padding: padding,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (title != null) ...[
              Row(
                children: [
                  if (icon != null) Icon(icon, color: AppColors.cobaltDeep),
                  if (icon != null) const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      title!,
                      style: const TextStyle(
                        color: AppColors.ink,
                        fontSize: 17,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                  ),
                  ?trailing,
                ],
              ),
              const SizedBox(height: 12),
            ],
            child,
          ],
        ),
      ),
    );
  }
}

class _ListRow extends StatelessWidget {
  const _ListRow({
    required this.icon,
    required this.title,
    required this.subtitle,
    this.trailing,
    this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: AppColors.paper,
      child: ListTile(
        onTap: onTap,
        contentPadding: EdgeInsets.zero,
        leading: Container(
          width: 38,
          height: 38,
          decoration: BoxDecoration(
            color: AppColors.mist,
            borderRadius: BorderRadius.circular(8),
          ),
          child: Icon(icon, color: AppColors.cobaltDeep, size: 20),
        ),
        title: Text(
          title,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontWeight: FontWeight.w800),
        ),
        subtitle: Text(subtitle, overflow: TextOverflow.ellipsis),
        trailing: trailing,
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    final normalized = label.toLowerCase();
    final color = normalized == 'approved' || normalized == 'active'
        ? AppColors.sage
        : normalized == 'pending'
        ? AppColors.warn
        : AppColors.cobaltDeep;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 12,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class _EmptyPanelMessage extends StatelessWidget {
  const _EmptyPanelMessage(this.message);

  final String message;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 18),
      child: Center(
        child: Text(
          message,
          textAlign: TextAlign.center,
          style: const TextStyle(
            color: AppColors.muted,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }
}

class _InfoBand extends StatelessWidget {
  const _InfoBand(this.message);

  final String message;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: AppColors.mist,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        message,
        style: const TextStyle(
          color: AppColors.cobaltDeep,
          fontWeight: FontWeight.w700,
          height: 1.35,
        ),
      ),
    );
  }
}

class _AdminMetrics {
  const _AdminMetrics({
    required this.pendingBusinesses,
    required this.approvedBusinesses,
    required this.customers,
    required this.openShipments,
    required this.activeCars,
    required this.pendingPurchases,
    required this.refundRequests,
  });

  factory _AdminMetrics.empty() {
    return const _AdminMetrics(
      pendingBusinesses: 0,
      approvedBusinesses: 0,
      customers: 0,
      openShipments: 0,
      activeCars: 0,
      pendingPurchases: 0,
      refundRequests: 0,
    );
  }

  final int pendingBusinesses;
  final int approvedBusinesses;
  final int customers;
  final int openShipments;
  final int activeCars;
  final int pendingPurchases;
  final int refundRequests;
}

enum _DashboardShortcut {
  pendingBusinesses,
  approvedBusinesses,
  customers,
  openShipments,
  activeCars,
  pendingPurchases,
  refundRequests,
}

class _MetricData {
  const _MetricData(this.label, this.value, this.icon, this.shortcut);

  final String label;
  final int value;
  final IconData icon;
  final _DashboardShortcut shortcut;
}
