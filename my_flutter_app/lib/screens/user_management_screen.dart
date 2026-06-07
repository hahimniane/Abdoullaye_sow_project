import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../providers/auth_provider.dart';
import '../theme/app_colors.dart';
import '../widgets/app_back_button.dart';
import '../widgets/app_snackbars.dart';
import 'add_staff_screen.dart';
import 'platform_admin_dashboard_screen.dart';

class UserManagementScreen extends StatefulWidget {
  const UserManagementScreen({super.key});

  @override
  State<UserManagementScreen> createState() => _UserManagementScreenState();
}

class _UserManagementScreenState extends State<UserManagementScreen> {
  final FirebaseFirestore _firestore = FirebaseFirestore.instance;
  final TextEditingController _searchController = TextEditingController();
  String _searchQuery = '';
  String _roleFilter = 'all';

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _updateUserRole(String userId, String role) async {
    final authProvider = context.read<AuthProvider>();

    try {
      await authProvider.updateUserRole(userId, role);
      if (!mounted) return;
      showSuccessSnackBar(
        context,
        AppLocalizations.of(context)!.userRoleUpdated(role),
      );
    } catch (error) {
      if (!mounted) return;
      showErrorSnackBar(
        context,
        AppLocalizations.of(context)!.failedToUpdateUserRole(error.toString()),
      );
    }
  }

  Future<void> _deleteUser(String userId, String userEmail) async {
    final authProvider = context.read<AuthProvider>();
    final localizations = AppLocalizations.of(context)!;

    final confirm =
        await showDialog<bool>(
          context: context,
          builder: (context) {
            return AlertDialog(
              title: Text(localizations.confirmDeletion),
              content: Text(localizations.confirmDeleteUser(userEmail)),
              actions: [
                TextButton(
                  onPressed: () => Navigator.pop(context, false),
                  child: Text(localizations.cancel),
                ),
                FilledButton(
                  style: FilledButton.styleFrom(
                    backgroundColor: AppColors.errorRed,
                  ),
                  onPressed: () => Navigator.pop(context, true),
                  child: Text(localizations.delete),
                ),
              ],
            );
          },
        ) ??
        false;

    if (!confirm) return;

    try {
      await authProvider.deleteUser(userId);
      if (!mounted) return;
      showSuccessSnackBar(context, localizations.userDeleted(userEmail));
    } catch (error) {
      if (!mounted) return;
      showErrorSnackBar(
        context,
        localizations.failedToDeleteUser(error.toString()),
      );
    }
  }

  List<QueryDocumentSnapshot> _filteredUsers(
    List<QueryDocumentSnapshot> users,
  ) {
    final query = _searchQuery.trim().toLowerCase();
    return users.where((doc) {
      final data = doc.data() as Map<String, dynamic>;
      final role = (data['role'] ?? 'customer').toString();
      if (_roleFilter != 'all' && role != _roleFilter) return false;
      if (query.isEmpty) return true;
      final searchable = [
        data['email'],
        data['fullName'],
        data['phone'],
        data['businessName'],
        role,
      ].whereType<Object>().join(' ').toLowerCase();
      return searchable.contains(query);
    }).toList();
  }

  Map<String, int> _roleCounts(List<QueryDocumentSnapshot> users) {
    final counts = <String, int>{
      'all': users.length,
      'admin': 0,
      'businessOwner': 0,
      'staff': 0,
      'customer': 0,
    };
    for (final doc in users) {
      final data = doc.data() as Map<String, dynamic>;
      final role = (data['role'] ?? 'customer').toString();
      counts[role] = (counts[role] ?? 0) + 1;
    }
    return counts;
  }

  void _openCreateMenu() {
    final screenContext = context;
    showModalBottomSheet<void>(
      context: screenContext,
      backgroundColor: AppColors.paper,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(8)),
      ),
      builder: (context) {
        final l10n = AppLocalizations.of(context)!;
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.fromLTRB(16, 10, 16, 16),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Container(
                  width: 42,
                  height: 4,
                  decoration: BoxDecoration(
                    color: AppColors.rule,
                    borderRadius: BorderRadius.circular(999),
                  ),
                ),
                const SizedBox(height: 12),
                _ActionChoice(
                  icon: Icons.admin_panel_settings,
                  title: l10n.addPlatformManager,
                  subtitle: l10n.createAdminSubtitle,
                  onTap: () {
                    Navigator.pop(context);
                    showAddPlatformManagerDialog(screenContext);
                  },
                ),
                const Divider(height: 1),
                _ActionChoice(
                  icon: Icons.person_add_alt_1,
                  title: l10n.addBusinessStaff,
                  subtitle: l10n.createStaffSubtitle,
                  onTap: () {
                    Navigator.pop(context);
                    Navigator.push(
                      context,
                      MaterialPageRoute<void>(
                        builder: (_) => const AddStaffScreen(),
                      ),
                    );
                  },
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Scaffold(
      backgroundColor: AppColors.lightBg,
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _openCreateMenu,
        backgroundColor: AppColors.cobalt,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.add),
        label: Text(l10n.add),
      ),
      body: SafeArea(
        child: StreamBuilder<QuerySnapshot>(
          stream: _firestore.collection('users').snapshots(),
          builder: (context, snapshot) {
            if (snapshot.hasError) {
              return Center(
                child: Text(l10n.errorDetails(snapshot.error.toString())),
              );
            }
            if (!snapshot.hasData) {
              return const Center(child: CircularProgressIndicator());
            }

            final users = snapshot.data!.docs.toList()
              ..sort((a, b) {
                final aData = a.data() as Map<String, dynamic>;
                final bData = b.data() as Map<String, dynamic>;
                final aRole = (aData['role'] ?? 'customer').toString();
                final bRole = (bData['role'] ?? 'customer').toString();
                final roleCompare = _roleRank(
                  aRole,
                ).compareTo(_roleRank(bRole));
                if (roleCompare != 0) return roleCompare;
                return (aData['email'] ?? '').toString().compareTo(
                  (bData['email'] ?? '').toString(),
                );
              });
            final counts = _roleCounts(users);
            final visibleUsers = _filteredUsers(users);
            final accessRows = _buildAccessRows(visibleUsers, l10n);

            return CustomScrollView(
              slivers: [
                SliverToBoxAdapter(
                  child: _UsersHeader(
                    totalUsers: users.length,
                    managerCount: counts['admin'] ?? 0,
                    staffCount:
                        (counts['staff'] ?? 0) + (counts['businessOwner'] ?? 0),
                    customerCount: counts['customer'] ?? 0,
                    onAddManager: () => showAddPlatformManagerDialog(context),
                    onAddStaff: () => Navigator.push(
                      context,
                      MaterialPageRoute<void>(
                        builder: (_) => const AddStaffScreen(),
                      ),
                    ),
                  ),
                ),
                SliverPersistentHeader(
                  pinned: true,
                  delegate: _UserToolsHeader(
                    searchController: _searchController,
                    searchQuery: _searchQuery,
                    roleFilter: _roleFilter,
                    counts: counts,
                    onSearchChanged: (value) =>
                        setState(() => _searchQuery = value),
                    onRoleChanged: (value) =>
                        setState(() => _roleFilter = value),
                  ),
                ),
                if (visibleUsers.isEmpty)
                  SliverFillRemaining(
                    hasScrollBody: false,
                    child: Center(child: Text(l10n.noUsersMatch)),
                  )
                else
                  SliverPadding(
                    padding: const EdgeInsets.fromLTRB(16, 12, 16, 96),
                    sliver: SliverList.list(
                      children: [
                        for (final row in accessRows)
                          if (row.header != null)
                            _AccessSectionHeader(
                              title: row.header!.title,
                              subtitle: row.header!.subtitle,
                              icon: row.header!.icon,
                            )
                          else if (row.user != null)
                            Padding(
                              padding: const EdgeInsets.only(bottom: 10),
                              child: _UserManagementCard(
                                userId: row.user!.id,
                                data: row.user!.data() as Map<String, dynamic>,
                                onRole: (role) =>
                                    _updateUserRole(row.user!.id, role),
                                onDelete: (email) =>
                                    _deleteUser(row.user!.id, email),
                              ),
                            ),
                      ],
                    ),
                  ),
              ],
            );
          },
        ),
      ),
    );
  }

  List<_AccessRow> _buildAccessRows(
    List<QueryDocumentSnapshot> users,
    AppLocalizations l10n,
  ) {
    final rows = <_AccessRow>[];
    final managers = <QueryDocumentSnapshot>[];
    final customers = <QueryDocumentSnapshot>[];
    final businessTeams = <String, List<QueryDocumentSnapshot>>{};
    final businessNames = <String, String>{};

    for (final user in users) {
      final data = user.data() as Map<String, dynamic>;
      final role = (data['role'] ?? 'customer').toString();
      if (role == 'admin') {
        managers.add(user);
      } else if (role == 'businessOwner' || role == 'staff') {
        final businessId = (data['businessId'] ?? '').toString().trim();
        final businessName = (data['businessName'] ?? '').toString().trim();
        final key = businessId.isEmpty ? 'unassigned_business' : businessId;
        businessTeams.putIfAbsent(key, () => []).add(user);
        businessNames[key] = businessName.isEmpty
            ? l10n.unassignedBusiness
            : businessName;
      } else {
        customers.add(user);
      }
    }

    void addUserSection(
      String title,
      String subtitle,
      IconData icon,
      List<QueryDocumentSnapshot> sectionUsers,
    ) {
      if (sectionUsers.isEmpty) return;
      rows.add(_AccessRow.header(title: title, subtitle: subtitle, icon: icon));
      rows.addAll(sectionUsers.map(_AccessRow.user));
    }

    addUserSection(
      l10n.platformManagers,
      l10n.platformManagersCount(managers.length),
      Icons.admin_panel_settings,
      managers,
    );

    final businessEntries = businessTeams.entries.toList()
      ..sort(
        (a, b) => (businessNames[a.key] ?? a.key).compareTo(
          businessNames[b.key] ?? b.key,
        ),
      );
    for (final entry in businessEntries) {
      final members = entry.value
        ..sort((a, b) {
          final aRole = ((a.data() as Map<String, dynamic>)['role'] ?? '')
              .toString();
          final bRole = ((b.data() as Map<String, dynamic>)['role'] ?? '')
              .toString();
          final roleCompare = _roleRank(aRole).compareTo(_roleRank(bRole));
          if (roleCompare != 0) return roleCompare;
          return (((a.data() as Map<String, dynamic>)['email'] ?? '')
                  .toString())
              .compareTo(
                (((b.data() as Map<String, dynamic>)['email'] ?? '')
                    .toString()),
              );
        });
      rows.add(
        _AccessRow.header(
          title: businessNames[entry.key] ?? l10n.businessTeam,
          subtitle: l10n.businessTeamCount(members.length),
          icon: Icons.storefront_outlined,
        ),
      );
      rows.addAll(members.map(_AccessRow.user));
    }

    addUserSection(
      l10n.customers,
      l10n.customerAccountsCount(customers.length),
      Icons.person_outline,
      customers,
    );

    return rows;
  }
}

class _AccessRow {
  const _AccessRow._({this.header, this.user});

  factory _AccessRow.header({
    required String title,
    required String subtitle,
    required IconData icon,
  }) {
    return _AccessRow._(
      header: _AccessSectionData(title: title, subtitle: subtitle, icon: icon),
    );
  }

  factory _AccessRow.user(QueryDocumentSnapshot user) {
    return _AccessRow._(user: user);
  }

  final _AccessSectionData? header;
  final QueryDocumentSnapshot? user;
}

class _AccessSectionData {
  const _AccessSectionData({
    required this.title,
    required this.subtitle,
    required this.icon,
  });

  final String title;
  final String subtitle;
  final IconData icon;
}

int _roleRank(String role) {
  switch (role) {
    case 'admin':
      return 0;
    case 'businessOwner':
      return 1;
    case 'staff':
      return 2;
    default:
      return 3;
  }
}

String _localizedRole(AppLocalizations l10n, String role) {
  switch (role) {
    case 'admin':
      return l10n.platformManager;
    case 'businessOwner':
      return l10n.businessOwner;
    case 'staff':
      return l10n.staff;
    default:
      return l10n.customer;
  }
}

Color _roleColor(String role) {
  switch (role) {
    case 'admin':
      return AppColors.cobaltDeep;
    case 'businessOwner':
      return AppColors.saffron;
    case 'staff':
      return AppColors.cobalt;
    default:
      return AppColors.muted;
  }
}

class _UsersHeader extends StatelessWidget {
  const _UsersHeader({
    required this.totalUsers,
    required this.managerCount,
    required this.staffCount,
    required this.customerCount,
    required this.onAddManager,
    required this.onAddStaff,
  });

  final int totalUsers;
  final int managerCount;
  final int staffCount;
  final int customerCount;
  final VoidCallback onAddManager;
  final VoidCallback onAddStaff;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Container(
      decoration: const BoxDecoration(gradient: AppColors.headerGradient),
      padding: const EdgeInsets.fromLTRB(20, 14, 20, 18),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const AppBackButton(onDarkBackground: true),
              Expanded(
                child: Text(
                  l10n.peopleAndAccess,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: Colors.white,
                    fontSize: 17,
                    fontWeight: FontWeight.w900,
                  ),
                ),
              ),
              IconButton(
                tooltip: l10n.addPlatformManager,
                onPressed: onAddManager,
                icon: const Icon(Icons.admin_panel_settings),
                color: Colors.white,
              ),
            ],
          ),
          const SizedBox(height: 14),
          Text(
            l10n.peopleAndAccessSubtitle,
            style: const TextStyle(color: Colors.white70, height: 1.35),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: _AccessStat(
                  label: l10n.managers,
                  value: managerCount,
                  icon: Icons.admin_panel_settings,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _AccessStat(
                  label: l10n.staff,
                  value: staffCount,
                  icon: Icons.groups_2_outlined,
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _AccessStat(
                  label: l10n.customers,
                  value: customerCount,
                  icon: Icons.person_outline,
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Wrap(
            spacing: 10,
            runSpacing: 8,
            children: [
              FilledButton.icon(
                onPressed: onAddManager,
                icon: const Icon(Icons.admin_panel_settings),
                label: Text(l10n.manager),
              ),
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(
                  foregroundColor: Colors.white,
                  side: const BorderSide(color: Colors.white54),
                ),
                onPressed: onAddStaff,
                icon: const Icon(Icons.person_add_alt_1),
                label: Text(l10n.businessStaff),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _AccessStat extends StatelessWidget {
  const _AccessStat({
    required this.label,
    required this.value,
    required this.icon,
  });

  final String label;
  final int value;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.white.withValues(alpha: 0.18)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: Colors.white, size: 19),
          const SizedBox(height: 8),
          Text(
            value.toString(),
            style: const TextStyle(
              color: Colors.white,
              fontSize: 17,
              fontWeight: FontWeight.w900,
            ),
          ),
          Text(
            label,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              color: Colors.white70,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _UserToolsHeader extends SliverPersistentHeaderDelegate {
  _UserToolsHeader({
    required this.searchController,
    required this.searchQuery,
    required this.roleFilter,
    required this.counts,
    required this.onSearchChanged,
    required this.onRoleChanged,
  });

  final TextEditingController searchController;
  final String searchQuery;
  final String roleFilter;
  final Map<String, int> counts;
  final ValueChanged<String> onSearchChanged;
  final ValueChanged<String> onRoleChanged;

  @override
  double get minExtent => 146;

  @override
  double get maxExtent => 146;

  @override
  Widget build(
    BuildContext context,
    double shrinkOffset,
    bool overlapsContent,
  ) {
    final l10n = AppLocalizations.of(context)!;
    return Material(
      color: AppColors.lightBg,
      elevation: overlapsContent ? 2 : 0,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 10),
        child: Column(
          children: [
            TextField(
              controller: searchController,
              onChanged: onSearchChanged,
              decoration: InputDecoration(
                hintText: l10n.searchUsersHint,
                prefixIcon: const Icon(Icons.search),
                suffixIcon: searchQuery.isEmpty
                    ? null
                    : IconButton(
                        onPressed: () {
                          searchController.clear();
                          onSearchChanged('');
                        },
                        icon: const Icon(Icons.close),
                      ),
              ),
            ),
            const SizedBox(height: 10),
            SizedBox(
              height: 42,
              child: ListView(
                scrollDirection: Axis.horizontal,
                children: [
                  _RoleFilterChip(
                    label: l10n.all,
                    count: counts['all'] ?? 0,
                    selected: roleFilter == 'all',
                    onTap: () => onRoleChanged('all'),
                  ),
                  _RoleFilterChip(
                    label: l10n.managers,
                    count: counts['admin'] ?? 0,
                    selected: roleFilter == 'admin',
                    onTap: () => onRoleChanged('admin'),
                  ),
                  _RoleFilterChip(
                    label: l10n.owners,
                    count: counts['businessOwner'] ?? 0,
                    selected: roleFilter == 'businessOwner',
                    onTap: () => onRoleChanged('businessOwner'),
                  ),
                  _RoleFilterChip(
                    label: l10n.staff,
                    count: counts['staff'] ?? 0,
                    selected: roleFilter == 'staff',
                    onTap: () => onRoleChanged('staff'),
                  ),
                  _RoleFilterChip(
                    label: l10n.customers,
                    count: counts['customer'] ?? 0,
                    selected: roleFilter == 'customer',
                    onTap: () => onRoleChanged('customer'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  @override
  bool shouldRebuild(covariant _UserToolsHeader oldDelegate) {
    return oldDelegate.searchQuery != searchQuery ||
        oldDelegate.roleFilter != roleFilter ||
        oldDelegate.counts != counts;
  }
}

class _RoleFilterChip extends StatelessWidget {
  const _RoleFilterChip({
    required this.label,
    required this.count,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final int count;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: ChoiceChip(
        selected: selected,
        onSelected: (_) => onTap(),
        label: Text('$label $count'),
        showCheckmark: false,
      ),
    );
  }
}

class _AccessSectionHeader extends StatelessWidget {
  const _AccessSectionHeader({
    required this.title,
    required this.subtitle,
    required this.icon,
  });

  final String title;
  final String subtitle;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 8, bottom: 10),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: AppColors.mist,
              borderRadius: BorderRadius.circular(8),
            ),
            child: Icon(icon, color: AppColors.cobaltDeep, size: 19),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.ink,
                    fontWeight: FontWeight.w900,
                    fontSize: 16,
                  ),
                ),
                Text(
                  subtitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    color: AppColors.muted,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _UserManagementCard extends StatelessWidget {
  const _UserManagementCard({
    required this.userId,
    required this.data,
    required this.onRole,
    required this.onDelete,
  });

  final String userId;
  final Map<String, dynamic> data;
  final ValueChanged<String> onRole;
  final ValueChanged<String> onDelete;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final email = (data['email'] ?? l10n.noEmail).toString();
    final name = (data['fullName'] ?? '').toString().trim();
    final phone = (data['phone'] ?? '').toString().trim();
    final role = (data['role'] ?? 'customer').toString();
    final businessName = (data['businessName'] ?? '').toString().trim();
    final imageUrl = (data['profileImageUrl'] ?? '').toString().trim();
    final title = name.isEmpty ? email : name;
    final subtitle = [
      email,
      if (phone.isNotEmpty) phone,
      if (businessName.isNotEmpty) businessName,
    ].join(' • ');

    return Material(
      color: AppColors.paper,
      borderRadius: BorderRadius.circular(8),
      elevation: 1,
      shadowColor: AppColors.ink.withValues(alpha: 0.08),
      child: InkWell(
        borderRadius: BorderRadius.circular(8),
        onTap: () => _showUserDetails(context),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Row(
            children: [
              CircleAvatar(
                radius: 24,
                backgroundColor: AppColors.mist,
                backgroundImage: imageUrl.isEmpty
                    ? null
                    : NetworkImage(imageUrl),
                child: imageUrl.isEmpty
                    ? Text(
                        email.isEmpty ? 'U' : email[0].toUpperCase(),
                        style: const TextStyle(
                          color: AppColors.cobaltDeep,
                          fontWeight: FontWeight.w900,
                        ),
                      )
                    : null,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.ink,
                        fontWeight: FontWeight.w900,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      subtitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        color: AppColors.muted,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                    const SizedBox(height: 8),
                    _RolePill(role: role),
                  ],
                ),
              ),
              PopupMenuButton<String>(
                tooltip: l10n.userActions,
                onSelected: (value) {
                  if (value == 'delete') {
                    onDelete(email);
                  } else {
                    onRole(value);
                  }
                },
                itemBuilder: (context) => [
                  PopupMenuItem(
                    value: 'customer',
                    child: Text(l10n.setAsCustomer),
                  ),
                  PopupMenuItem(value: 'staff', child: Text(l10n.setAsStaff)),
                  PopupMenuItem(
                    value: 'admin',
                    child: Text(l10n.setAsPlatformManager),
                  ),
                  const PopupMenuDivider(),
                  PopupMenuItem(
                    value: 'delete',
                    child: Text(
                      l10n.deleteUser,
                      style: const TextStyle(color: AppColors.errorRed),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _showUserDetails(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final email = (data['email'] ?? l10n.noEmail).toString();
    final name = (data['fullName'] ?? '').toString().trim();
    final phone = (data['phone'] ?? '').toString().trim();
    final role = (data['role'] ?? 'customer').toString();
    final businessName = (data['businessName'] ?? '').toString().trim();
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.paper,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(8)),
      ),
      builder: (context) {
        return SafeArea(
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name.isEmpty ? email : name,
                  style: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 10),
                _DetailLine(label: l10n.email, value: email),
                if (phone.isNotEmpty)
                  _DetailLine(label: l10n.phone, value: phone),
                _DetailLine(
                  label: l10n.role,
                  value: _localizedRole(l10n, role),
                ),
                if (businessName.isNotEmpty)
                  _DetailLine(label: l10n.business, value: businessName),
                _DetailLine(label: l10n.userId, value: userId),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _RolePill extends StatelessWidget {
  const _RolePill({required this.role});

  final String role;

  @override
  Widget build(BuildContext context) {
    final color = _roleColor(role);
    final l10n = AppLocalizations.of(context)!;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        _localizedRole(l10n, role),
        style: TextStyle(
          color: color,
          fontSize: 12,
          fontWeight: FontWeight.w900,
        ),
      ),
    );
  }
}

class _DetailLine extends StatelessWidget {
  const _DetailLine({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 82,
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
              value,
              style: const TextStyle(fontWeight: FontWeight.w700),
            ),
          ),
        ],
      ),
    );
  }
}

class _ActionChoice extends StatelessWidget {
  const _ActionChoice({
    required this.icon,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      contentPadding: EdgeInsets.zero,
      leading: Container(
        width: 40,
        height: 40,
        decoration: BoxDecoration(
          color: AppColors.mist,
          borderRadius: BorderRadius.circular(8),
        ),
        child: Icon(icon, color: AppColors.cobaltDeep),
      ),
      title: Text(title, style: const TextStyle(fontWeight: FontWeight.w900)),
      subtitle: Text(subtitle),
      trailing: const Icon(Icons.chevron_right),
      onTap: onTap,
    );
  }
}
