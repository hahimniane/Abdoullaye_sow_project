import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../models/support_case.dart';
import '../providers/auth_provider.dart';
import '../services/support_service.dart';
import '../theme/app_colors.dart';
import '../widgets/app_back_button.dart';
import '../widgets/support_entry_button.dart';

class SupportInboxArguments {
  const SupportInboxArguments({required this.scope});

  final SupportInboxScope scope;
}

class SupportInboxScreen extends StatefulWidget {
  const SupportInboxScreen({
    super.key,
    required this.scope,
    this.supportRepository,
    this.businessIdOverride,
  });
  const SupportInboxScreen.customer({
    super.key,
    this.supportRepository,
    this.businessIdOverride,
  }) : scope = SupportInboxScope.customer;
  const SupportInboxScreen.business({
    super.key,
    this.supportRepository,
    this.businessIdOverride,
  }) : scope = SupportInboxScope.business;
  const SupportInboxScreen.admin({
    super.key,
    this.supportRepository,
    this.businessIdOverride,
  }) : scope = SupportInboxScope.admin;

  final SupportInboxScope scope;
  final SupportRepository? supportRepository;
  final String? businessIdOverride;

  @override
  State<SupportInboxScreen> createState() => _SupportInboxScreenState();
}

class _SupportInboxScreenState extends State<SupportInboxScreen> {
  late final SupportRepository _supportService;
  final TextEditingController _searchController = TextEditingController();
  String _query = '';
  String _filter = 'all';

  @override
  void initState() {
    super.initState();
    _supportService = widget.supportRepository ?? SupportService();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  bool _matches(SupportCase supportCase) {
    if (_filter == 'escalated' && !supportCase.isEscalated) return false;
    if (_filter == 'urgent' && !supportCase.isUrgent) return false;
    if (_filter == 'resolved' && !supportCase.isResolved) return false;
    if (_query.isEmpty) return true;
    final q = _query.toLowerCase();
    return supportCase.subject.toLowerCase().contains(q) ||
        supportCase.relatedLabel.toLowerCase().contains(q) ||
        supportCase.businessName.toLowerCase().contains(q) ||
        supportCase.customerName.toLowerCase().contains(q) ||
        supportCase.lastMessage.toLowerCase().contains(q);
  }

  String _title(AppLocalizations l10n) {
    switch (widget.scope) {
      case SupportInboxScope.customer:
        return l10n.supportCenter;
      case SupportInboxScope.business:
        return l10n.supportInbox;
      case SupportInboxScope.admin:
        return l10n.supportCases;
    }
  }

  Stream<List<SupportCase>> _stream(AuthProvider? auth) {
    return _supportService.watchInbox(
      scope: widget.scope,
      businessId: widget.businessIdOverride ?? auth?.businessId,
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final auth = context.watch<AuthProvider?>();
    final businessId = widget.businessIdOverride ?? auth?.businessId ?? '';
    final businessName = auth?.businessName ?? '';
    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      body: SafeArea(
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
              child: Row(
                children: [
                  const AppBackButton(),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _title(l10n),
                          style: Theme.of(context).textTheme.titleLarge,
                        ),
                        Text(
                          l10n.supportInboxSubtitle,
                          style: Theme.of(context).textTheme.bodySmall
                              ?.copyWith(color: AppColors.muted),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            if (widget.scope == SupportInboxScope.business &&
                businessId.isNotEmpty)
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 6, 20, 8),
                child: Align(
                  alignment: Alignment.centerLeft,
                  child: BusinessPlatformSupportButton(
                    businessId: businessId,
                    businessName: businessName,
                    supportRepository: _supportService,
                  ),
                ),
              ),
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 10),
              child: TextField(
                controller: _searchController,
                onChanged: (value) => setState(() => _query = value.trim()),
                decoration: InputDecoration(
                  hintText: l10n.supportSearch,
                  prefixIcon: const Icon(Icons.search),
                  suffixIcon: _query.isEmpty
                      ? null
                      : IconButton(
                          onPressed: () => setState(() {
                            _query = '';
                            _searchController.clear();
                          }),
                          icon: const Icon(Icons.close),
                        ),
                ),
              ),
            ),
            _SupportFilters(
              selected: _filter,
              onChanged: (value) => setState(() => _filter = value),
            ),
            Expanded(
              child: StreamBuilder<List<SupportCase>>(
                stream: _stream(auth),
                builder: (context, snapshot) {
                  if (snapshot.connectionState == ConnectionState.waiting) {
                    return const Center(child: CircularProgressIndicator());
                  }
                  final cases = (snapshot.data ?? const <SupportCase>[])
                      .where(_matches)
                      .toList();
                  if (cases.isEmpty) {
                    return _SupportEmptyState(
                      title: l10n.supportNoCases,
                      subtitle: l10n.supportNoCasesSubtitle,
                    );
                  }
                  return ListView.separated(
                    padding: const EdgeInsets.fromLTRB(20, 10, 20, 24),
                    itemCount: cases.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 12),
                    itemBuilder: (context, index) {
                      final supportCase = cases[index];
                      return _SupportCaseCard(
                        supportCase: supportCase,
                        onTap: () => Navigator.pushNamed(
                          context,
                          '/support-thread',
                          arguments: supportCase.id,
                        ),
                      );
                    },
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _SupportFilters extends StatelessWidget {
  const _SupportFilters({required this.selected, required this.onChanged});

  final String selected;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final filters = [
      ('all', l10n.supportAllCases),
      ('urgent', l10n.supportUrgent),
      ('escalated', l10n.supportEscalated),
      ('resolved', l10n.supportResolved),
    ];
    return SizedBox(
      height: 44,
      child: ListView.separated(
        padding: const EdgeInsets.symmetric(horizontal: 20),
        scrollDirection: Axis.horizontal,
        itemCount: filters.length,
        separatorBuilder: (_, _) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          final filter = filters[index];
          final active = selected == filter.$1;
          return ChoiceChip(
            selected: active,
            onSelected: (_) => onChanged(filter.$1),
            label: Text(filter.$2),
          );
        },
      ),
    );
  }
}

class _SupportCaseCard extends StatelessWidget {
  const _SupportCaseCard({required this.supportCase, required this.onTap});

  final SupportCase supportCase;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final status = _statusLabel(l10n, supportCase.status);
    final time = supportCase.lastMessageAt ?? supportCase.updatedAt;
    return Material(
      color: Theme.of(context).colorScheme.surface,
      borderRadius: BorderRadius.circular(8),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: AppColors.rule),
          ),
          child: Row(
            children: [
              CircleAvatar(
                backgroundColor: supportCase.isEscalated
                    ? AppColors.saffron
                    : AppColors.cobalt,
                child: Icon(
                  supportCase.isEscalated
                      ? Icons.admin_panel_settings_outlined
                      : Icons.support_agent_outlined,
                  color: Colors.white,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            supportCase.subject.isEmpty
                                ? supportCase.relatedLabel
                                : supportCase.subject,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                        ),
                        if (time != null)
                          Text(
                            DateFormat.MMMd().format(time),
                            style: Theme.of(context).textTheme.labelSmall
                                ?.copyWith(color: AppColors.muted),
                          ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      [
                        supportCase.businessName,
                        supportCase.customerName,
                        supportCase.relatedLabel,
                      ].where((value) => value.trim().isNotEmpty).join(' · '),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(
                        context,
                      ).textTheme.bodySmall?.copyWith(color: AppColors.muted),
                    ),
                    const SizedBox(height: 8),
                    Row(
                      children: [
                        _Pill(label: status, urgent: supportCase.isUrgent),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            supportCase.lastMessage,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _Pill extends StatelessWidget {
  const _Pill({required this.label, required this.urgent});

  final String label;
  final bool urgent;

  @override
  Widget build(BuildContext context) {
    final color = urgent ? AppColors.warn : AppColors.cobalt;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
          color: color,
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

class _SupportEmptyState extends StatelessWidget {
  const _SupportEmptyState({required this.title, required this.subtitle});

  final String title;
  final String subtitle;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(
              Icons.support_agent_outlined,
              size: 42,
              color: AppColors.cobalt,
            ),
            const SizedBox(height: 12),
            Text(title, style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 6),
            Text(
              subtitle,
              textAlign: TextAlign.center,
              style: Theme.of(
                context,
              ).textTheme.bodyMedium?.copyWith(color: AppColors.muted),
            ),
          ],
        ),
      ),
    );
  }
}

String _statusLabel(AppLocalizations l10n, String status) {
  switch (status) {
    case 'waiting_for_business':
      return l10n.supportWaitingBusiness;
    case 'waiting_for_customer':
    case 'customer_action_required':
      return l10n.supportWaitingCustomer;
    case 'escalated_to_platform':
      return l10n.supportEscalated;
    case 'waiting_for_admin':
    case 'admin_reviewing':
      return l10n.supportAdminReviewing;
    case 'resolved':
    case 'closed':
      return l10n.supportResolved;
    default:
      return l10n.supportBusinessFirst;
  }
}
