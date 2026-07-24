import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../models/platform_access.dart';
import '../providers/auth_provider.dart';
import '../theme/app_colors.dart';
import '../utils/business_permissions.dart';
import '../widgets/app_snackbars.dart';

class UserManagementScreen extends StatefulWidget {
  const UserManagementScreen({super.key});

  @override
  State<UserManagementScreen> createState() => _UserManagementScreenState();
}

class _UserManagementScreenState extends State<UserManagementScreen> {
  static const int _pageSize = 100;

  final _searchController = TextEditingController();
  final List<_MarketplacePerson> _people = [];
  String _category = 'all';
  String _pageToken = '';
  bool _hasMore = false;
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;
  Timer? _searchTimer;

  @override
  void initState() {
    super.initState();
    scheduleMicrotask(_reload);
  }

  @override
  void dispose() {
    _searchTimer?.cancel();
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _reload() async {
    if (!mounted) return;
    setState(() {
      _loading = true;
      _error = null;
      _pageToken = '';
    });
    try {
      final response = await context.read<AuthProvider>().listMarketplacePeople(
        search: _searchController.text,
        pageSize: _pageSize,
      );
      final rawPeople = response['people'];
      final people = rawPeople is Iterable
          ? rawPeople
                .whereType<Map>()
                .map(
                  (item) => _MarketplacePerson.fromMap(
                    Map<String, dynamic>.from(item),
                  ),
                )
                .toList()
          : <_MarketplacePerson>[];
      if (!mounted) return;
      setState(() {
        _people
          ..clear()
          ..addAll(people);
        _pageToken = (response['nextPageToken'] ?? response['pageToken'] ?? '')
            .toString();
        _hasMore = _pageToken.isNotEmpty;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error.toString();
        _loading = false;
      });
    }
  }

  Future<void> _loadMore() async {
    if (_loadingMore || !_hasMore) return;
    setState(() => _loadingMore = true);
    try {
      final response = await context.read<AuthProvider>().listMarketplacePeople(
        pageSize: _pageSize,
        pageToken: _pageToken,
        includeInvitations: false,
      );
      final rawPeople = response['people'];
      final people = rawPeople is Iterable
          ? rawPeople
                .whereType<Map>()
                .map(
                  (item) => _MarketplacePerson.fromMap(
                    Map<String, dynamic>.from(item),
                  ),
                )
                .toList()
          : <_MarketplacePerson>[];
      if (!mounted) return;
      setState(() {
        _people.addAll(people);
        _pageToken = (response['nextPageToken'] ?? response['pageToken'] ?? '')
            .toString();
        _hasMore = _pageToken.isNotEmpty;
      });
    } catch (error) {
      if (mounted) showErrorSnackBar(context, error.toString());
    } finally {
      if (mounted) setState(() => _loadingMore = false);
    }
  }

  void _searchChanged(String _) {
    _searchTimer?.cancel();
    _searchTimer = Timer(const Duration(milliseconds: 450), _reload);
  }

  List<_MarketplacePerson> get _visiblePeople {
    if (_category == 'all') return _people;
    return _people
        .where((person) => _matchesCategory(person, _category))
        .toList();
  }

  int _count(String category) =>
      _people.where((person) => _matchesCategory(person, category)).length;

  Future<void> _showPerson(_MarketplacePerson person, bool canManage) async {
    _MarketplacePerson detailed = person;
    if (person.category != 'invitation' && person.uid.isNotEmpty) {
      try {
        final response = await context
            .read<AuthProvider>()
            .getMarketplacePerson(person.uid);
        final raw = response['person'];
        if (raw is Map) {
          detailed = _MarketplacePerson.fromMap(Map<String, dynamic>.from(raw));
        }
      } catch (_) {
        // The redacted list row is still safe to display if detail refresh
        // cannot be completed.
      }
    }
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (sheetContext) => _PersonDetailSheet(
        person: detailed,
        canManage: canManage,
        isCurrentUser: detailed.uid == context.read<AuthProvider>().user?.uid,
        onChanged: () {
          Navigator.pop(sheetContext);
          _reload();
        },
      ),
    );
  }

  Future<void> _showInviteMenu() async {
    final auth = context.read<AuthProvider>();
    final l10n = AppLocalizations.of(context)!;
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.paper,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (sheetContext) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              _SheetHandle(),
              const SizedBox(height: 12),
              ListTile(
                leading: const _ActionIcon(Icons.admin_panel_settings_outlined),
                title: Text(l10n.invitePlatformAdministrator),
                subtitle: Text(l10n.invitePlatformAdministratorHelp),
                onTap: () {
                  Navigator.pop(sheetContext);
                  _showPlatformInvite();
                },
              ),
              if (auth.canManagePlatformSection(PlatformSection.businesses))
                ListTile(
                  leading: const _ActionIcon(Icons.storefront_outlined),
                  title: Text(l10n.inviteBusinessPersonnel),
                  subtitle: Text(l10n.inviteBusinessPersonnelHelp),
                  onTap: () {
                    Navigator.pop(sheetContext);
                    _showBusinessInvite();
                  },
                ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _showPlatformInvite() async {
    final submitted = await showDialog<bool>(
      context: context,
      builder: (_) => const _PlatformInviteDialog(),
    );
    if (submitted == true) await _reload();
  }

  Future<void> _showBusinessInvite() async {
    final submitted = await showDialog<bool>(
      context: context,
      builder: (_) => const _BusinessInviteDialog(),
    );
    if (submitted == true) await _reload();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final auth = context.watch<AuthProvider>();
    final canView = auth.canViewPlatformSection(PlatformSection.people);
    final canManage = auth.canManagePlatformSection(PlatformSection.people);
    if (!canView) {
      return Scaffold(
        backgroundColor: AppColors.lightBg,
        body: Center(
          child: _StateCard(
            icon: Icons.lock_outline,
            title: l10n.peopleAccessRestricted,
            body: l10n.peopleAccessRestrictedHelp,
          ),
        ),
      );
    }

    final categories = <_Category>[
      _Category('all', l10n.allPeople, Icons.people_outline, _people.length),
      _Category(
        'platform',
        l10n.platformAdministrators,
        Icons.admin_panel_settings_outlined,
        _count('platform'),
      ),
      _Category(
        'businessOwner',
        l10n.businessOwners,
        Icons.storefront_outlined,
        _count('businessOwner'),
      ),
      _Category(
        'staff',
        l10n.businessStaff,
        Icons.badge_outlined,
        _count('staff'),
      ),
      _Category(
        'customer',
        l10n.customers,
        Icons.person_outline,
        _count('customer'),
      ),
      _Category(
        'invitation',
        l10n.pendingInvitations,
        Icons.outgoing_mail,
        _count('invitation'),
      ),
      _Category(
        'missing_profile',
        l10n.missingProfiles,
        Icons.person_off_outlined,
        _count('missing_profile'),
      ),
      _Category(
        'suspended',
        l10n.suspendedAccounts,
        Icons.block_outlined,
        _count('suspended'),
      ),
    ];

    return Scaffold(
      backgroundColor: AppColors.lightBg,
      floatingActionButton: canManage
          ? FloatingActionButton.extended(
              onPressed: _showInviteMenu,
              backgroundColor: AppColors.cobalt,
              foregroundColor: Colors.white,
              icon: const Icon(Icons.person_add_alt_1),
              label: Text(l10n.invitePerson),
            )
          : null,
      body: RefreshIndicator(
        onRefresh: _reload,
        child: CustomScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          slivers: [
            SliverToBoxAdapter(
              child: _PeopleHeader(
                peopleCount: _people.length,
                pendingCount: _count('invitation'),
                suspendedCount: _count('suspended'),
              ),
            ),
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
                child: TextField(
                  controller: _searchController,
                  onChanged: _searchChanged,
                  onSubmitted: (_) => _reload(),
                  keyboardType: TextInputType.emailAddress,
                  decoration: InputDecoration(
                    hintText: l10n.searchPeopleHint,
                    prefixIcon: const Icon(Icons.search),
                    suffixIcon: _searchController.text.isEmpty
                        ? null
                        : IconButton(
                            tooltip: l10n.clearSearch,
                            onPressed: () {
                              _searchController.clear();
                              _reload();
                            },
                            icon: const Icon(Icons.close),
                          ),
                    filled: true,
                    fillColor: Colors.white,
                    border: OutlineInputBorder(
                      borderRadius: BorderRadius.circular(16),
                      borderSide: BorderSide.none,
                    ),
                  ),
                ),
              ),
            ),
            SliverToBoxAdapter(
              child: SizedBox(
                height: 52,
                child: ListView.separated(
                  padding: const EdgeInsets.symmetric(horizontal: 16),
                  scrollDirection: Axis.horizontal,
                  itemCount: categories.length,
                  separatorBuilder: (_, _) => const SizedBox(width: 8),
                  itemBuilder: (context, index) {
                    final category = categories[index];
                    return FilterChip(
                      selected: _category == category.id,
                      avatar: Icon(category.icon, size: 17),
                      label: Text('${category.label}  ${category.count}'),
                      onSelected: (_) =>
                          setState(() => _category = category.id),
                    );
                  },
                ),
              ),
            ),
            if (_loading)
              const SliverFillRemaining(
                hasScrollBody: false,
                child: Center(child: CircularProgressIndicator()),
              )
            else if (_error != null)
              SliverFillRemaining(
                hasScrollBody: false,
                child: Center(
                  child: _StateCard(
                    icon: Icons.cloud_off_outlined,
                    title: l10n.peopleCouldNotLoad,
                    body: l10n.tryAgain,
                    action: FilledButton.icon(
                      onPressed: _reload,
                      icon: const Icon(Icons.refresh),
                      label: Text(l10n.tryAgain),
                    ),
                  ),
                ),
              )
            else if (_visiblePeople.isEmpty)
              SliverFillRemaining(
                hasScrollBody: false,
                child: Center(
                  child: _StateCard(
                    icon: Icons.manage_search,
                    title: l10n.noPeopleFound,
                    body: l10n.noPeopleFoundHelp,
                  ),
                ),
              )
            else
              SliverPadding(
                padding: const EdgeInsets.fromLTRB(16, 8, 16, 104),
                sliver: SliverList.separated(
                  itemCount: _visiblePeople.length + (_hasMore ? 1 : 0),
                  separatorBuilder: (_, _) => const SizedBox(height: 10),
                  itemBuilder: (context, index) {
                    if (index == _visiblePeople.length) {
                      return Center(
                        child: OutlinedButton.icon(
                          onPressed: _loadingMore ? null : _loadMore,
                          icon: _loadingMore
                              ? const SizedBox.square(
                                  dimension: 16,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : const Icon(Icons.expand_more),
                          label: Text(l10n.loadMorePeople),
                        ),
                      );
                    }
                    final person = _visiblePeople[index];
                    final isCurrentUser = person.uid == auth.user?.uid;
                    return _PersonCard(
                      person: person,
                      isCurrentUser: isCurrentUser,
                      canManage: canManage,
                      onTap: () => _showPerson(person, canManage),
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

class _MarketplacePerson {
  const _MarketplacePerson({
    required this.id,
    required this.uid,
    required this.email,
    required this.fullName,
    required this.phone,
    required this.role,
    required this.category,
    required this.adminRole,
    required this.businessId,
    required this.businessName,
    required this.businessPermissions,
    required this.accountStatus,
    required this.emailVerified,
    required this.hasProfile,
    required this.hasAuth,
    required this.invitationId,
    required this.invitationKind,
  });

  factory _MarketplacePerson.fromMap(Map<String, dynamic> data) {
    return _MarketplacePerson(
      id: (data['id'] ?? '').toString(),
      uid: (data['uid'] ?? '').toString(),
      email: (data['email'] ?? '').toString(),
      fullName: (data['fullName'] ?? '').toString(),
      phone: (data['phone'] ?? '').toString(),
      role: (data['role'] ?? '').toString(),
      category: (data['category'] ?? 'missing_profile').toString(),
      adminRole: (data['adminRole'] ?? '').toString(),
      businessId: (data['businessId'] ?? '').toString(),
      businessName: (data['businessName'] ?? '').toString(),
      businessPermissions: data['businessPermissions'] is Iterable
          ? (data['businessPermissions'] as Iterable)
                .map((item) => item.toString())
                .toList(growable: false)
          : const [],
      accountStatus: (data['accountStatus'] ?? 'active').toString(),
      emailVerified: data['emailVerified'] == true,
      hasProfile: data['hasProfile'] == true,
      hasAuth: data['hasAuth'] == true,
      invitationId: (data['invitationId'] ?? '').toString(),
      invitationKind: (data['invitationKind'] ?? '').toString(),
    );
  }

  final String id;
  final String uid;
  final String email;
  final String fullName;
  final String phone;
  final String role;
  final String category;
  final String adminRole;
  final String businessId;
  final String businessName;
  final List<String> businessPermissions;
  final String accountStatus;
  final bool emailVerified;
  final bool hasProfile;
  final bool hasAuth;
  final String invitationId;
  final String invitationKind;

  String get displayName {
    if (fullName.trim().isNotEmpty) return fullName.trim();
    if (email.trim().isNotEmpty) return email.trim();
    if (phone.trim().isNotEmpty) return phone.trim();
    return id;
  }

  bool get isSuspended =>
      accountStatus == 'suspended' || accountStatus == 'deleting';
}

class _PeopleHeader extends StatelessWidget {
  const _PeopleHeader({
    required this.peopleCount,
    required this.pendingCount,
    required this.suspendedCount,
  });

  final int peopleCount;
  final int pendingCount;
  final int suspendedCount;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Container(
      decoration: const BoxDecoration(gradient: AppColors.headerGradient),
      padding: const EdgeInsets.fromLTRB(20, 22, 20, 24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                width: 46,
                height: 46,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.16),
                  borderRadius: BorderRadius.circular(14),
                ),
                child: const Icon(Icons.manage_accounts, color: Colors.white),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      l10n.peopleAndAccess,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 24,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    Text(
                      l10n.peopleAndAccessSubtitle,
                      style: const TextStyle(color: Colors.white70),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),
          Row(
            children: [
              Expanded(
                child: _HeaderStat(value: '$peopleCount', label: l10n.people),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _HeaderStat(
                  value: '$pendingCount',
                  label: l10n.pendingInvitations,
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _HeaderStat(
                  value: '$suspendedCount',
                  label: l10n.suspended,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _HeaderStat extends StatelessWidget {
  const _HeaderStat({required this.value, required this.label});

  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: Colors.white.withValues(alpha: 0.16)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            value,
            style: const TextStyle(
              color: Colors.white,
              fontSize: 20,
              fontWeight: FontWeight.w900,
            ),
          ),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(color: Colors.white70, fontSize: 11),
          ),
        ],
      ),
    );
  }
}

class _PersonCard extends StatelessWidget {
  const _PersonCard({
    required this.person,
    required this.isCurrentUser,
    required this.canManage,
    required this.onTap,
  });

  final _MarketplacePerson person;
  final bool isCurrentUser;
  final bool canManage;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final statusColor = person.isSuspended
        ? AppColors.errorRed
        : person.category == 'invitation'
        ? const Color(0xFFB7791F)
        : const Color(0xFF0B806F);
    return Material(
      color: Colors.white,
      borderRadius: BorderRadius.circular(18),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(15),
          child: Row(
            children: [
              CircleAvatar(
                radius: 24,
                backgroundColor: statusColor.withValues(alpha: 0.12),
                foregroundColor: statusColor,
                child: Text(
                  _initials(person.displayName),
                  style: const TextStyle(fontWeight: FontWeight.w900),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            person.displayName,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontWeight: FontWeight.w900,
                              fontSize: 16,
                            ),
                          ),
                        ),
                        if (isCurrentUser) ...[
                          const SizedBox(width: 6),
                          _Badge(label: l10n.you),
                        ],
                      ],
                    ),
                    const SizedBox(height: 3),
                    Text(
                      _personSubtitle(person, l10n),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.muted,
                        fontSize: 13,
                      ),
                    ),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: [
                        _Badge(label: _roleLabel(person, l10n)),
                        _Badge(
                          label: _statusLabel(person, l10n),
                          color: statusColor,
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Icon(
                canManage ? Icons.chevron_right : Icons.visibility_outlined,
                color: AppColors.muted,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PersonDetailSheet extends StatefulWidget {
  const _PersonDetailSheet({
    required this.person,
    required this.canManage,
    required this.isCurrentUser,
    required this.onChanged,
  });

  final _MarketplacePerson person;
  final bool canManage;
  final bool isCurrentUser;
  final VoidCallback onChanged;

  @override
  State<_PersonDetailSheet> createState() => _PersonDetailSheetState();
}

class _PersonDetailSheetState extends State<_PersonDetailSheet> {
  bool _working = false;

  Future<void> _run(
    Future<void> Function(AuthProvider auth) action,
    String success,
  ) async {
    setState(() => _working = true);
    try {
      await action(context.read<AuthProvider>());
      if (!mounted) return;
      showSuccessSnackBar(context, success);
      widget.onChanged();
    } catch (error) {
      if (mounted) showErrorSnackBar(context, error.toString());
    } finally {
      if (mounted) setState(() => _working = false);
    }
  }

  Future<bool> _confirm(String title, String body, String action) async {
    return await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: Text(title),
            content: Text(body),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context, false),
                child: Text(AppLocalizations.of(context)!.cancel),
              ),
              FilledButton(
                onPressed: () => Navigator.pop(context, true),
                child: Text(action),
              ),
            ],
          ),
        ) ??
        false;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final person = widget.person;
    final locale = Localizations.localeOf(context).languageCode;
    final canAct = widget.canManage && !widget.isCurrentUser && !_working;
    return DraggableScrollableSheet(
      initialChildSize: 0.88,
      minChildSize: 0.55,
      maxChildSize: 0.96,
      builder: (context, controller) => Material(
        color: AppColors.paper,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(26)),
        clipBehavior: Clip.antiAlias,
        child: ListView(
          controller: controller,
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
          children: [
            const _SheetHandle(),
            const SizedBox(height: 18),
            Row(
              children: [
                CircleAvatar(
                  radius: 32,
                  backgroundColor: AppColors.mist.withValues(alpha: 0.25),
                  child: Text(
                    _initials(person.displayName),
                    style: const TextStyle(
                      color: AppColors.cobaltDeep,
                      fontWeight: FontWeight.w900,
                      fontSize: 20,
                    ),
                  ),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        person.displayName,
                        style: const TextStyle(
                          fontSize: 22,
                          fontWeight: FontWeight.w900,
                        ),
                      ),
                      Text(
                        _personSubtitle(person, l10n),
                        style: const TextStyle(color: AppColors.muted),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  tooltip: l10n.close,
                  onPressed: () => Navigator.pop(context),
                  icon: const Icon(Icons.close),
                ),
              ],
            ),
            const SizedBox(height: 20),
            _DetailSection(
              title: l10n.identityAndAccess,
              icon: Icons.shield_outlined,
              children: [
                _Fact(label: l10n.role, value: _roleLabel(person, l10n)),
                _Fact(label: l10n.status, value: _statusLabel(person, l10n)),
                _Fact(label: l10n.email, value: person.email),
                _Fact(label: l10n.phone, value: person.phone),
                _Fact(
                  label: l10n.emailVerification,
                  value: person.emailVerified
                      ? l10n.verified
                      : l10n.notVerified,
                ),
              ],
            ),
            if (person.category == 'business') ...[
              const SizedBox(height: 12),
              _DetailSection(
                title: l10n.businessAccess,
                icon: Icons.storefront_outlined,
                children: [
                  _Fact(
                    label: l10n.business,
                    value: person.businessName.isEmpty
                        ? person.businessId
                        : person.businessName,
                  ),
                  _Fact(
                    label: l10n.businessPermissions,
                    value: person.businessPermissions.isEmpty
                        ? l10n.noAssignedPermissions
                        : person.businessPermissions.join(', '),
                  ),
                ],
              ),
            ],
            if (widget.isCurrentUser) ...[
              const SizedBox(height: 12),
              _InfoNotice(
                icon: Icons.info_outline,
                text: l10n.cannotChangeOwnAccess,
              ),
            ],
            if (widget.canManage && !widget.isCurrentUser) ...[
              const SizedBox(height: 18),
              Text(
                l10n.accountActions,
                style: const TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w900,
                ),
              ),
              const SizedBox(height: 8),
              if (person.category == 'invitation') ...[
                _ActionTile(
                  icon: Icons.forward_to_inbox,
                  title: l10n.resendInvitation,
                  onTap: canAct
                      ? () => _run((auth) async {
                          await auth.resendAccessInvitation(
                            person.invitationId,
                          );
                        }, l10n.invitationResent)
                      : null,
                ),
                _ActionTile(
                  icon: Icons.cancel_outlined,
                  title: l10n.cancelInvitation,
                  danger: true,
                  onTap: canAct
                      ? () async {
                          if (!await _confirm(
                            l10n.cancelInvitation,
                            l10n.cancelInvitationConfirm,
                            l10n.cancelInvitation,
                          )) {
                            return;
                          }
                          await _run((auth) async {
                            await auth.cancelAccessInvitation(
                              person.invitationId,
                            );
                          }, l10n.invitationCancelled);
                        }
                      : null,
                ),
              ] else ...[
                _ActionTile(
                  icon: person.isSuspended
                      ? Icons.lock_open_outlined
                      : Icons.block_outlined,
                  title: person.isSuspended
                      ? l10n.restoreAccount
                      : l10n.suspendAccount,
                  danger: !person.isSuspended,
                  onTap: canAct
                      ? () async {
                          final action = person.isSuspended
                              ? 'restore'
                              : 'suspend';
                          if (!await _confirm(
                            person.isSuspended
                                ? l10n.restoreAccount
                                : l10n.suspendAccount,
                            person.isSuspended
                                ? l10n.restoreAccountConfirm
                                : l10n.suspendAccountConfirm,
                            person.isSuspended
                                ? l10n.restoreAccount
                                : l10n.suspendAccount,
                          )) {
                            return;
                          }
                          await _run(
                            (auth) async {
                              await auth.setMarketplaceUserStatus(
                                userId: person.uid,
                                action: action,
                              );
                            },
                            person.isSuspended
                                ? l10n.accountRestored
                                : l10n.accountSuspended,
                          );
                        }
                      : null,
                ),
                _ActionTile(
                  icon: Icons.logout,
                  title: l10n.revokeSessions,
                  onTap: canAct
                      ? () => _run((auth) async {
                          await auth.revokeUserSessions(userId: person.uid);
                        }, l10n.sessionsRevoked)
                      : null,
                ),
                _ActionTile(
                  icon: Icons.password_outlined,
                  title: l10n.sendPasswordReset,
                  onTap: canAct
                      ? () => _run((auth) async {
                          await auth.sendUserRecoveryEmail(
                            userId: person.uid,
                            action: 'password_reset',
                            locale: locale,
                          );
                        }, l10n.passwordResetSent)
                      : null,
                ),
                if (!person.emailVerified)
                  _ActionTile(
                    icon: Icons.mark_email_unread_outlined,
                    title: l10n.sendVerificationEmail,
                    onTap: canAct
                        ? () => _run((auth) async {
                            await auth.sendUserRecoveryEmail(
                              userId: person.uid,
                              action: 'verify_email',
                              locale: locale,
                            );
                          }, l10n.verificationEmailSent)
                        : null,
                  ),
                if (person.role == 'staff' && person.businessId.isNotEmpty)
                  _ActionTile(
                    icon: Icons.workspace_premium_outlined,
                    title: l10n.transferOwnership,
                    onTap: canAct
                        ? () async {
                            if (!await _confirm(
                              l10n.transferOwnership,
                              l10n.transferOwnershipConfirm,
                              l10n.transferOwnership,
                            )) {
                              return;
                            }
                            await _run((auth) async {
                              await auth.transferBusinessOwnership(
                                userId: person.uid,
                                businessId: person.businessId,
                              );
                            }, l10n.ownershipTransferred);
                          }
                        : null,
                  ),
                _ActionTile(
                  icon: Icons.delete_forever_outlined,
                  title: l10n.reviewDeletionRequest,
                  danger: true,
                  onTap: canAct ? () => _reviewDeletion(person) : null,
                ),
              ],
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _reviewDeletion(_MarketplacePerson person) async {
    final l10n = AppLocalizations.of(context)!;
    setState(() => _working = true);
    try {
      final response = await context.read<AuthProvider>().reviewAccountDeletion(
        person.uid,
      );
      final review = response['review'];
      final reviewMap = review is Map
          ? Map<String, dynamic>.from(review)
          : const <String, dynamic>{};
      final eligible = reviewMap['eligible'] == true;
      final blockers = reviewMap['blockers'] is Iterable
          ? (reviewMap['blockers'] as Iterable).length
          : 0;
      if (!mounted) return;
      if (!eligible) {
        await showDialog<void>(
          context: context,
          builder: (context) => AlertDialog(
            title: Text(l10n.deletionBlocked),
            content: Text(l10n.deletionBlockedByRecords(blockers)),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(context),
                child: Text(l10n.close),
              ),
            ],
          ),
        );
        return;
      }
      if (!await _confirm(
        l10n.finalizeAccountDeletion,
        l10n.finalizeAccountDeletionConfirm,
        l10n.finalizeAccountDeletion,
      )) {
        return;
      }
      await _run((auth) async {
        await auth.finalizeAccountDeletion(
          userId: person.uid,
          reason: l10n.adminApprovedDeletion,
        );
      }, l10n.accountDeletionFinalized);
    } catch (error) {
      if (mounted) showErrorSnackBar(context, error.toString());
    } finally {
      if (mounted) setState(() => _working = false);
    }
  }
}

class _PlatformInviteDialog extends StatefulWidget {
  const _PlatformInviteDialog();

  @override
  State<_PlatformInviteDialog> createState() => _PlatformInviteDialogState();
}

class _PlatformInviteDialogState extends State<_PlatformInviteDialog> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  String _role = 'operationsManager';
  bool _working = false;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return AlertDialog(
      title: Text(l10n.invitePlatformAdministrator),
      content: Form(
        key: _formKey,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextFormField(
                controller: _name,
                decoration: InputDecoration(labelText: l10n.fullName),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _email,
                keyboardType: TextInputType.emailAddress,
                decoration: InputDecoration(labelText: l10n.email),
                validator: (value) =>
                    _validEmail(value) ? null : l10n.validEmailRequired,
              ),
              const SizedBox(height: 12),
              DropdownButtonFormField<String>(
                initialValue: _role,
                decoration: InputDecoration(labelText: l10n.adminRole),
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
                onChanged: (value) =>
                    setState(() => _role = value ?? 'operationsManager'),
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _working ? null : () => Navigator.pop(context, false),
          child: Text(l10n.cancel),
        ),
        FilledButton.icon(
          onPressed: _working
              ? null
              : () async {
                  if (!_formKey.currentState!.validate()) return;
                  setState(() => _working = true);
                  try {
                    await context.read<AuthProvider>().invitePlatformAdmin(
                      email: _email.text,
                      fullName: _name.text,
                      adminRole: _role,
                      locale: Localizations.localeOf(context).languageCode,
                    );
                    if (!context.mounted) return;
                    showSuccessSnackBar(context, l10n.invitationSent);
                    Navigator.pop(context, true);
                  } catch (error) {
                    if (context.mounted) {
                      showErrorSnackBar(context, error.toString());
                    }
                  } finally {
                    if (mounted) setState(() => _working = false);
                  }
                },
          icon: const Icon(Icons.send_outlined),
          label: Text(l10n.sendInvitation),
        ),
      ],
    );
  }
}

class _BusinessInviteDialog extends StatefulWidget {
  const _BusinessInviteDialog();

  @override
  State<_BusinessInviteDialog> createState() => _BusinessInviteDialogState();
}

class _BusinessInviteDialogState extends State<_BusinessInviteDialog> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  String? _businessId;
  final Set<String> _permissions = {
    BusinessPermission.profile,
    BusinessPermission.people,
  };
  bool _working = false;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return AlertDialog(
      title: Text(l10n.inviteBusinessPersonnel),
      content: Form(
        key: _formKey,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
                stream: FirebaseFirestore.instance
                    .collection('businesses')
                    .orderBy('name')
                    .snapshots(),
                builder: (context, snapshot) {
                  return DropdownButtonFormField<String>(
                    initialValue: _businessId,
                    decoration: InputDecoration(labelText: l10n.business),
                    items: [
                      for (final doc in snapshot.data?.docs ?? const [])
                        DropdownMenuItem(
                          value: doc.id,
                          child: Text(
                            (doc.data()['name'] ?? doc.id).toString(),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                    ],
                    onChanged: (value) => setState(() => _businessId = value),
                    validator: (value) =>
                        value == null ? l10n.chooseStaffBusiness : null,
                  );
                },
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _name,
                decoration: InputDecoration(labelText: l10n.fullName),
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _email,
                keyboardType: TextInputType.emailAddress,
                decoration: InputDecoration(labelText: l10n.email),
                validator: (value) =>
                    _validEmail(value) ? null : l10n.validEmailRequired,
              ),
              const SizedBox(height: 14),
              Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  l10n.businessPermissions,
                  style: const TextStyle(fontWeight: FontWeight.w900),
                ),
              ),
              const SizedBox(height: 6),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (final permission in _businessPermissionOptions)
                    FilterChip(
                      label: Text(_permissionLabel(permission, l10n)),
                      selected: _permissions.contains(permission),
                      onSelected: (selected) => setState(() {
                        if (selected) {
                          _permissions.add(permission);
                        } else {
                          _permissions.remove(permission);
                        }
                      }),
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _working ? null : () => Navigator.pop(context, false),
          child: Text(l10n.cancel),
        ),
        FilledButton.icon(
          onPressed: _working
              ? null
              : () async {
                  if (!_formKey.currentState!.validate()) return;
                  setState(() => _working = true);
                  try {
                    await context.read<AuthProvider>().inviteBusinessMember(
                      email: _email.text,
                      fullName: _name.text,
                      businessId: _businessId!,
                      businessPermissions: _permissions.toList(),
                      locale: Localizations.localeOf(context).languageCode,
                    );
                    if (!context.mounted) return;
                    showSuccessSnackBar(context, l10n.invitationSent);
                    Navigator.pop(context, true);
                  } catch (error) {
                    if (context.mounted) {
                      showErrorSnackBar(context, error.toString());
                    }
                  } finally {
                    if (mounted) setState(() => _working = false);
                  }
                },
          icon: const Icon(Icons.send_outlined),
          label: Text(l10n.sendInvitation),
        ),
      ],
    );
  }
}

class _DetailSection extends StatelessWidget {
  const _DetailSection({
    required this.title,
    required this.icon,
    required this.children,
  });

  final String title;
  final IconData icon;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, color: AppColors.cobalt),
              const SizedBox(width: 8),
              Text(title, style: const TextStyle(fontWeight: FontWeight.w900)),
            ],
          ),
          const Divider(height: 24),
          ...children,
        ],
      ),
    );
  }
}

class _Fact extends StatelessWidget {
  const _Fact({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 118,
            child: Text(
              label,
              style: const TextStyle(
                color: AppColors.muted,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          Expanded(
            child: Text(
              value.isEmpty ? AppLocalizations.of(context)!.notProvided : value,
              style: const TextStyle(fontWeight: FontWeight.w800),
            ),
          ),
        ],
      ),
    );
  }
}

class _ActionTile extends StatelessWidget {
  const _ActionTile({
    required this.icon,
    required this.title,
    required this.onTap,
    this.danger = false,
  });

  final IconData icon;
  final String title;
  final VoidCallback? onTap;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final color = danger ? AppColors.errorRed : AppColors.cobaltDeep;
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      elevation: 0,
      child: ListTile(
        onTap: onTap,
        enabled: onTap != null,
        leading: Icon(icon, color: color),
        title: Text(
          title,
          style: TextStyle(color: color, fontWeight: FontWeight.w800),
        ),
        trailing: const Icon(Icons.chevron_right),
      ),
    );
  }
}

class _ActionIcon extends StatelessWidget {
  const _ActionIcon(this.icon);

  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 42,
      height: 42,
      decoration: BoxDecoration(
        color: AppColors.mist.withValues(alpha: 0.25),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Icon(icon, color: AppColors.cobaltDeep),
    );
  }
}

class _Badge extends StatelessWidget {
  const _Badge({required this.label, this.color = AppColors.cobaltDeep});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: TextStyle(
          color: color,
          fontSize: 11,
          fontWeight: FontWeight.w800,
        ),
      ),
    );
  }
}

class _InfoNotice extends StatelessWidget {
  const _InfoNotice({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: AppColors.mist.withValues(alpha: 0.2),
        borderRadius: BorderRadius.circular(14),
      ),
      child: Row(
        children: [
          Icon(icon, color: AppColors.cobaltDeep),
          const SizedBox(width: 10),
          Expanded(child: Text(text)),
        ],
      ),
    );
  }
}

class _StateCard extends StatelessWidget {
  const _StateCard({
    required this.icon,
    required this.title,
    required this.body,
    this.action,
  });

  final IconData icon;
  final String title;
  final String body;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Container(
      constraints: const BoxConstraints(maxWidth: 440),
      margin: const EdgeInsets.all(24),
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 42, color: AppColors.cobalt),
          const SizedBox(height: 12),
          Text(
            title,
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 6),
          Text(
            body,
            textAlign: TextAlign.center,
            style: const TextStyle(color: AppColors.muted),
          ),
          if (action != null) ...[const SizedBox(height: 16), action!],
        ],
      ),
    );
  }
}

class _SheetHandle extends StatelessWidget {
  const _SheetHandle();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Container(
        width: 42,
        height: 4,
        decoration: BoxDecoration(
          color: AppColors.rule,
          borderRadius: BorderRadius.circular(999),
        ),
      ),
    );
  }
}

class _Category {
  const _Category(this.id, this.label, this.icon, this.count);

  final String id;
  final String label;
  final IconData icon;
  final int count;
}

const _businessPermissionOptions = [
  BusinessPermission.profile,
  BusinessPermission.listings,
  BusinessPermission.purchases,
  BusinessPermission.barrels,
  BusinessPermission.freight,
  BusinessPermission.transport,
  BusinessPermission.parking,
  BusinessPermission.destinations,
  BusinessPermission.people,
  BusinessPermission.support,
  BusinessPermission.growth,
];

bool _matchesCategory(_MarketplacePerson person, String category) {
  return switch (category) {
    'all' => true,
    'platform' => person.category == 'platform',
    'businessOwner' => person.role == 'businessOwner',
    'staff' => person.role == 'staff',
    'customer' => person.category == 'customer',
    'invitation' => person.category == 'invitation',
    'missing_profile' => person.category == 'missing_profile',
    'suspended' => person.isSuspended,
    _ => false,
  };
}

String _initials(String value) {
  final words = value
      .trim()
      .split(RegExp(r'\s+'))
      .where((word) => word.isNotEmpty)
      .take(2)
      .toList();
  if (words.isEmpty) return '?';
  return words.map((word) => word[0].toUpperCase()).join();
}

String _personSubtitle(_MarketplacePerson person, AppLocalizations l10n) {
  if (person.businessName.isNotEmpty) {
    return '${person.businessName} · ${person.email}';
  }
  if (person.email.isNotEmpty && person.phone.isNotEmpty) {
    return '${person.email} · ${person.phone}';
  }
  return person.email.isNotEmpty ? person.email : person.phone;
}

String _roleLabel(_MarketplacePerson person, AppLocalizations l10n) {
  if (person.category == 'invitation') return l10n.pendingInvitation;
  return switch (person.role) {
    'admin' =>
      person.adminRole.isEmpty
          ? l10n.platformAdministrator
          : _adminRoleLabel(person.adminRole, l10n),
    'businessOwner' => l10n.businessOwner,
    'staff' => l10n.businessStaffMember,
    'customer' => l10n.customer,
    _ => l10n.missingProfile,
  };
}

String _statusLabel(_MarketplacePerson person, AppLocalizations l10n) {
  if (person.category == 'invitation') return l10n.invitationPending;
  if (person.accountStatus == 'suspended') return l10n.suspended;
  if (person.accountStatus == 'deleting') return l10n.deletionPending;
  if (!person.hasProfile) return l10n.missingProfile;
  if (!person.hasAuth) return l10n.authenticationMissing;
  return l10n.active;
}

String _adminRoleLabel(String role, AppLocalizations l10n) {
  return switch (role) {
    'superAdmin' => l10n.superAdministrator,
    'operationsManager' => l10n.operationsManager,
    'financeManager' => l10n.financeManager,
    'supportAdmin' => l10n.supportAdministrator,
    'contentManager' => l10n.contentManager,
    _ => role,
  };
}

String _permissionLabel(String permission, AppLocalizations l10n) {
  return switch (permission) {
    BusinessPermission.profile => l10n.profile,
    BusinessPermission.listings => l10n.listings,
    BusinessPermission.purchases => l10n.purchases,
    BusinessPermission.barrels => l10n.barrels,
    BusinessPermission.freight => l10n.freight,
    BusinessPermission.transport => l10n.transport,
    BusinessPermission.parking => l10n.parking,
    BusinessPermission.destinations => l10n.destinations,
    BusinessPermission.people => l10n.people,
    BusinessPermission.support => l10n.support,
    BusinessPermission.growth => l10n.growth,
    _ => permission,
  };
}

bool _validEmail(String? value) {
  return RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(value?.trim() ?? '');
}
