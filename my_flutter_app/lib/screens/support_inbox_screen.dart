import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../utils/date_display.dart';
import '../models/support_case.dart';
import '../providers/auth_provider.dart';
import '../services/support_service.dart';
import '../services/whatsapp_conversations.dart';
import '../theme/app_colors.dart';
import '../utils/business_permissions.dart';
import '../widgets/app_back_button.dart';
import '../widgets/support_entry_button.dart';
import '../widgets/whatsapp_widgets.dart';

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
    this.canManageSupportOverride,
  });
  const SupportInboxScreen.customer({
    super.key,
    this.supportRepository,
    this.businessIdOverride,
    this.canManageSupportOverride,
  }) : scope = SupportInboxScope.customer;
  const SupportInboxScreen.business({
    super.key,
    this.supportRepository,
    this.businessIdOverride,
    this.canManageSupportOverride,
  }) : scope = SupportInboxScope.business;
  const SupportInboxScreen.admin({
    super.key,
    this.supportRepository,
    this.businessIdOverride,
    this.canManageSupportOverride,
  }) : scope = SupportInboxScope.admin;

  final SupportInboxScope scope;
  final SupportRepository? supportRepository;
  final String? businessIdOverride;

  /// Whether the person has the business Support permission; read from
  /// the signed-in profile when null (tests without one: yes).
  final bool? canManageSupportOverride;

  @override
  State<SupportInboxScreen> createState() => _SupportInboxScreenState();
}

class _SupportInboxScreenState extends State<SupportInboxScreen> {
  late final SupportRepository _supportService;
  final TextEditingController _searchController = TextEditingController();
  String _query = '';
  String _filter = 'all';
  SupportInboxList? _list;
  WhatsAppFilter _whatsAppFilter = WhatsAppFilter.all;

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
    // WhatsApp conversations have their own list.
    if (supportCase.isWhatsApp) return false;
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

  Stream<List<SupportCase>>? _inbox;
  String? _inboxKey;

  /// One subscription per scope and business. It used to be created in
  /// build, so every search keystroke and filter tap re-subscribed and
  /// flashed a spinner over the list.
  Stream<List<SupportCase>> _stream(AuthProvider? auth) {
    final businessId = widget.businessIdOverride ?? auth?.businessId;
    final key = supportStreamKey([widget.scope.name, businessId]);
    if (_inbox == null || key != _inboxKey) {
      _inboxKey = key;
      _inbox = _supportService.watchInbox(
        scope: widget.scope,
        businessId: businessId,
      );
    }
    return _inbox!;
  }

  Stream<List<SupportCase>>? _whatsAppInbox;
  String? _whatsAppKey;

  /// One subscription per business (or, for Laawol, all of them).
  Stream<List<SupportCase>> _whatsAppStream(String businessId) {
    final all = widget.scope == SupportInboxScope.admin;
    final key = supportStreamKey(['whatsapp', all ? '*' : businessId]);
    if (_whatsAppInbox == null || key != _whatsAppKey) {
      _whatsAppKey = key;
      _whatsAppInbox = _supportService.watchWhatsAppInbox(
        businessId: all ? null : businessId,
      );
    }
    return _whatsAppInbox!;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final auth = context.watch<AuthProvider?>();
    final businessId = widget.businessIdOverride ?? auth?.businessId ?? '';
    final businessName = auth?.businessName ?? '';
    final canManageSupport =
        widget.canManageSupportOverride ??
        (auth == null ||
            auth.hasBusinessPermission(BusinessPermission.support));
    final lists = supportInboxLists(
      scope: widget.scope,
      canManageSupport: canManageSupport,
    );
    final list = lists.contains(_list) ? _list! : lists.first;
    final whatsApp = list == SupportInboxList.whatsApp;
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
            if (lists.length > 1)
              Padding(
                padding: const EdgeInsets.fromLTRB(20, 4, 20, 4),
                child: SizedBox(
                  width: double.infinity,
                  child: SegmentedButton<SupportInboxList>(
                    key: const Key('support-inbox-lists'),
                    showSelectedIcon: false,
                    segments: [
                      for (final option in lists)
                        ButtonSegment(
                          value: option,
                          icon: Icon(
                            option == SupportInboxList.whatsApp
                                ? Icons.chat_outlined
                                : Icons.support_agent_outlined,
                            size: 18,
                          ),
                          label: Text(
                            option == SupportInboxList.whatsApp
                                ? l10n.waWhatsApp
                                : l10n.waListSupport,
                          ),
                        ),
                    ],
                    selected: {list},
                    onSelectionChanged: (selection) => setState(() {
                      _list = selection.first;
                    }),
                  ),
                ),
              ),
            if (!whatsApp &&
                widget.scope == SupportInboxScope.business &&
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
                  hintText: whatsApp ? l10n.waSearch : l10n.supportSearch,
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
            if (whatsApp)
              _WhatsAppFilters(
                selected: _whatsAppFilter,
                onChanged: (value) => setState(() => _whatsAppFilter = value),
              )
            else
              _SupportFilters(
                selected: _filter,
                onChanged: (value) => setState(() => _filter = value),
              ),
            if (whatsApp)
              Expanded(
                child: _WhatsAppList(
                  stream: _whatsAppStream(businessId),
                  query: _query,
                  filter: _whatsAppFilter,
                  showBusiness: widget.scope == SupportInboxScope.admin,
                ),
              )
            else
              Expanded(
                child: StreamBuilder<List<SupportCase>>(
                  stream: _stream(auth),
                  builder: (context, snapshot) {
                    // Only the very first load shows a spinner; a list already
                    // on screen stays while a new subscription catches up.
                    if (snapshot.connectionState == ConnectionState.waiting &&
                        !snapshot.hasData) {
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

class _WhatsAppFilters extends StatelessWidget {
  const _WhatsAppFilters({required this.selected, required this.onChanged});

  final WhatsAppFilter selected;
  final ValueChanged<WhatsAppFilter> onChanged;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return SizedBox(
      height: 44,
      child: ListView.separated(
        padding: const EdgeInsets.symmetric(horizontal: 20),
        scrollDirection: Axis.horizontal,
        itemCount: WhatsAppFilter.values.length,
        separatorBuilder: (_, _) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          final filter = WhatsAppFilter.values[index];
          return ChoiceChip(
            key: ValueKey('wa-filter:${filter.name}'),
            selected: selected == filter,
            onSelected: (_) => onChanged(filter),
            label: Text(whatsAppFilterLabel(l10n, filter)),
          );
        },
      ),
    );
  }
}

/// The WhatsApp conversations, filtered and searched on the phone.
class _WhatsAppList extends StatelessWidget {
  const _WhatsAppList({
    required this.stream,
    required this.query,
    required this.filter,
    required this.showBusiness,
  });

  final Stream<List<SupportCase>> stream;
  final String query;
  final WhatsAppFilter filter;
  final bool showBusiness;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return StreamBuilder<List<SupportCase>>(
      stream: stream,
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting &&
            !snapshot.hasData) {
          return const Center(child: CircularProgressIndicator());
        }
        if (snapshot.hasError && !snapshot.hasData) {
          return _SupportEmptyState(
            title: l10n.waRefusalUnknown,
            subtitle: l10n.waEmptySubtitle,
          );
        }
        final cases = [
          for (final supportCase in snapshot.data ?? const <SupportCase>[])
            if (whatsAppFilterMatches(supportCase, filter) &&
                whatsAppSearchMatches(supportCase, query))
              supportCase,
        ];
        if (cases.isEmpty) {
          return _SupportEmptyState(
            title: l10n.waEmptyTitle,
            subtitle: l10n.waEmptySubtitle,
          );
        }
        return ListView.separated(
          padding: const EdgeInsets.fromLTRB(20, 10, 20, 24),
          itemCount: cases.length,
          separatorBuilder: (_, _) => const SizedBox(height: 10),
          itemBuilder: (context, index) {
            final supportCase = cases[index];
            return WhatsAppConversationCard(
              supportCase: supportCase,
              showBusiness: showBusiness,
              onTap: () => Navigator.pushNamed(
                context,
                '/support-thread',
                arguments: supportCase.id,
              ),
            );
          },
        );
      },
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
                            displayMonthDay(time, dateLocaleOf(context)),
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
