import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../providers/auth_provider.dart';
import '../theme/app_colors.dart';
import '../utils/business_permissions.dart';
import '../widgets/app_snackbars.dart';

class AddStaffScreen extends StatefulWidget {
  const AddStaffScreen({super.key});

  @override
  State<AddStaffScreen> createState() => _AddStaffScreenState();
}

class _AddStaffScreenState extends State<AddStaffScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final Set<String> _permissions = {
    BusinessPermission.profile,
    BusinessPermission.people,
  };
  String? _selectedBusinessId;
  bool _isLoading = false;

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    super.dispose();
  }

  Future<void> _inviteStaffMember() async {
    if (!_formKey.currentState!.validate()) return;
    final auth = context.read<AuthProvider>();
    final businessId = auth.isAdmin ? _selectedBusinessId : auth.businessId;
    final l10n = AppLocalizations.of(context)!;
    if (businessId == null || businessId.isEmpty) {
      showErrorSnackBar(context, l10n.chooseStaffBusinessMessage);
      return;
    }

    setState(() => _isLoading = true);
    try {
      await auth.inviteBusinessMember(
        email: _emailController.text,
        fullName: _nameController.text,
        businessId: businessId,
        businessPermissions: _permissions.toList(),
        locale: Localizations.localeOf(context).languageCode,
      );
      if (!mounted) return;
      showSuccessSnackBar(context, l10n.invitationSent);
      Navigator.pop(context);
    } catch (error) {
      if (mounted) showErrorSnackBar(context, error.toString());
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final auth = context.watch<AuthProvider>();
    final l10n = AppLocalizations.of(context)!;
    return Container(
      decoration: const BoxDecoration(gradient: AppColors.headerGradient),
      child: Scaffold(
        backgroundColor: Colors.transparent,
        appBar: AppBar(
          title: Text(
            l10n.inviteBusinessPersonnel,
            style: const TextStyle(
              color: Colors.white,
              fontWeight: FontWeight.w900,
            ),
          ),
          backgroundColor: Colors.transparent,
          elevation: 0,
          iconTheme: const IconThemeData(color: Colors.white),
        ),
        body: SafeArea(
          child: Center(
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(20),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 620),
                child: Container(
                  padding: const EdgeInsets.all(22),
                  decoration: BoxDecoration(
                    color: AppColors.paper,
                    borderRadius: BorderRadius.circular(24),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withValues(alpha: 0.12),
                        blurRadius: 28,
                        offset: const Offset(0, 14),
                      ),
                    ],
                  ),
                  child: Form(
                    key: _formKey,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          width: 50,
                          height: 50,
                          decoration: BoxDecoration(
                            color: AppColors.mist.withValues(alpha: 0.28),
                            borderRadius: BorderRadius.circular(15),
                          ),
                          child: const Icon(
                            Icons.outgoing_mail,
                            color: AppColors.cobaltDeep,
                          ),
                        ),
                        const SizedBox(height: 14),
                        Text(
                          l10n.inviteBusinessPersonnel,
                          style: const TextStyle(
                            fontSize: 24,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const SizedBox(height: 5),
                        Text(
                          l10n.inviteBusinessPersonnelHelp,
                          style: const TextStyle(color: AppColors.muted),
                        ),
                        const SizedBox(height: 22),
                        if (auth.isAdmin) ...[
                          StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
                            stream: FirebaseFirestore.instance
                                .collection('businesses')
                                .orderBy('name')
                                .snapshots(),
                            builder: (context, snapshot) {
                              return DropdownButtonFormField<String>(
                                initialValue: _selectedBusinessId,
                                decoration: InputDecoration(
                                  labelText: l10n.business,
                                  prefixIcon: const Icon(
                                    Icons.storefront_outlined,
                                  ),
                                ),
                                items: [
                                  for (final doc
                                      in snapshot.data?.docs ?? const [])
                                    DropdownMenuItem(
                                      value: doc.id,
                                      child: Text(
                                        (doc.data()['name'] ?? doc.id)
                                            .toString(),
                                        overflow: TextOverflow.ellipsis,
                                      ),
                                    ),
                                ],
                                onChanged: (value) =>
                                    setState(() => _selectedBusinessId = value),
                                validator: (value) => value == null
                                    ? l10n.chooseStaffBusiness
                                    : null,
                              );
                            },
                          ),
                          const SizedBox(height: 14),
                        ],
                        TextFormField(
                          controller: _nameController,
                          textCapitalization: TextCapitalization.words,
                          decoration: InputDecoration(
                            labelText: l10n.fullName,
                            prefixIcon: const Icon(Icons.badge_outlined),
                          ),
                        ),
                        const SizedBox(height: 14),
                        TextFormField(
                          controller: _emailController,
                          keyboardType: TextInputType.emailAddress,
                          decoration: InputDecoration(
                            labelText: l10n.email,
                            prefixIcon: const Icon(Icons.email_outlined),
                          ),
                          validator: (value) =>
                              RegExp(
                                r'^[^@\s]+@[^@\s]+\.[^@\s]+$',
                              ).hasMatch(value?.trim() ?? '')
                              ? null
                              : l10n.validEmailRequired,
                        ),
                        const SizedBox(height: 20),
                        Text(
                          l10n.businessPermissions,
                          style: const TextStyle(
                            fontSize: 16,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          l10n.businessPermissionsHelp,
                          style: const TextStyle(color: AppColors.muted),
                        ),
                        const SizedBox(height: 10),
                        Wrap(
                          spacing: 7,
                          runSpacing: 7,
                          children: [
                            for (final permission in _permissionOptions)
                              FilterChip(
                                selected: _permissions.contains(permission.key),
                                avatar: Icon(permission.icon, size: 17),
                                label: Text(permission.label(l10n)),
                                onSelected: (selected) => setState(() {
                                  if (selected) {
                                    _permissions.add(permission.key);
                                  } else {
                                    _permissions.remove(permission.key);
                                  }
                                }),
                              ),
                          ],
                        ),
                        const SizedBox(height: 24),
                        SizedBox(
                          width: double.infinity,
                          height: 52,
                          child: FilledButton.icon(
                            onPressed: _isLoading ? null : _inviteStaffMember,
                            icon: _isLoading
                                ? const SizedBox.square(
                                    dimension: 18,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : const Icon(Icons.send_outlined),
                            label: Text(l10n.sendInvitation),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _PermissionOption {
  const _PermissionOption(this.key, this.icon, this.label);

  final String key;
  final IconData icon;
  final String Function(AppLocalizations l10n) label;
}

final _permissionOptions = <_PermissionOption>[
  _PermissionOption(
    BusinessPermission.profile,
    Icons.storefront_outlined,
    (l10n) => l10n.profile,
  ),
  _PermissionOption(
    BusinessPermission.listings,
    Icons.directions_car_outlined,
    (l10n) => l10n.listings,
  ),
  _PermissionOption(
    BusinessPermission.purchases,
    Icons.receipt_long_outlined,
    (l10n) => l10n.purchases,
  ),
  _PermissionOption(
    BusinessPermission.barrels,
    Icons.inventory_2_outlined,
    (l10n) => l10n.barrels,
  ),
  _PermissionOption(
    BusinessPermission.freight,
    Icons.flight_outlined,
    (l10n) => l10n.freight,
  ),
  _PermissionOption(
    BusinessPermission.transport,
    Icons.local_shipping_outlined,
    (l10n) => l10n.transport,
  ),
  _PermissionOption(
    BusinessPermission.parking,
    Icons.local_parking_outlined,
    (l10n) => l10n.parking,
  ),
  _PermissionOption(
    BusinessPermission.destinations,
    Icons.public_outlined,
    (l10n) => l10n.destinations,
  ),
  _PermissionOption(
    BusinessPermission.people,
    Icons.people_outline,
    (l10n) => l10n.people,
  ),
  _PermissionOption(
    BusinessPermission.support,
    Icons.support_agent_outlined,
    (l10n) => l10n.support,
  ),
  _PermissionOption(
    BusinessPermission.growth,
    Icons.auto_awesome_outlined,
    (l10n) => l10n.growth,
  ),
];
