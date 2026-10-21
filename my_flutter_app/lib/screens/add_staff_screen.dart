import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../providers/auth_provider.dart';
import '../services/inventory_service.dart' show FirestoreInventorySource;
import '../services/inventory_stores.dart';
import '../services/staff_invite_service.dart';
import '../services/staff_invites.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../utils/business_permissions.dart';
import '../utils/phone_number_validator.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/country_phone_field.dart';
import '../widgets/staff_invite_widgets.dart';

/// "Invite business personnel": the owner (or a platform admin, who first
/// picks the business) invites a person by WhatsApp number - the default -
/// or by email (docs/STAFF_PHONE_INVITES.md). The form itself is
/// [StaffInviteForm], tested with a fake caller.
class AddStaffScreen extends StatefulWidget {
  const AddStaffScreen({super.key});

  @override
  State<AddStaffScreen> createState() => _AddStaffScreenState();
}

class _AddStaffScreenState extends State<AddStaffScreen> {
  /// Platform admins choose the business; listened to once, never in build.
  StreamSubscription<QuerySnapshot<Map<String, dynamic>>>? _businessesSub;
  List<StaffInviteBusiness>? _businesses;

  @override
  void initState() {
    super.initState();
    if (context.read<AuthProvider>().isAdmin) {
      _businesses = const [];
      _businessesSub = FirebaseFirestore.instance
          .collection('businesses')
          .orderBy('name')
          .snapshots()
          .listen((snapshot) {
            if (!mounted) return;
            setState(
              () => _businesses = [
                for (final doc in snapshot.docs)
                  StaffInviteBusiness(
                    id: doc.id,
                    name: (doc.data()['name'] ?? doc.id).toString(),
                  ),
              ],
            );
          }, onError: (Object _) {});
    }
  }

  @override
  void dispose() {
    _businessesSub?.cancel();
    super.dispose();
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
              padding: const EdgeInsets.all(16),
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 620),
                child: StaffInviteForm(
                  businessId: auth.isAdmin ? null : auth.businessId,
                  businesses: auth.isAdmin ? _businesses : null,
                  onDone: () => Navigator.of(context).maybePop(),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// A business a platform admin may invite into.
class StaffInviteBusiness {
  const StaffInviteBusiness({required this.id, required this.name});

  final String id;
  final String name;
}

/// The invitation form: name, Phone (WhatsApp) or Email, the permissions,
/// and "Which store?" for a business with two or more active stores. A
/// phone invitation WhatsApp did not deliver ends on "WhatsApp message not
/// sent yet - share this link" with the link and Copy; everything else on
/// a confirmation.
class StaffInviteForm extends StatefulWidget {
  const StaffInviteForm({
    super.key,
    required this.businessId,
    this.businesses,
    this.service = const StaffInviteService(),
    this.watchStores,
    this.onDone,
  });

  /// The business invited into; null while a platform admin has not picked.
  final String? businessId;

  /// The platform admin's choice of business; null for an owner.
  final List<StaffInviteBusiness>? businesses;
  final StaffInviteService service;

  /// The business's Inventory stores (tests pass their own).
  final Stream<List<InventoryStore>> Function(String businessId)? watchStores;

  /// After a confirmation, or Done on the share step.
  final VoidCallback? onDone;

  @override
  State<StaffInviteForm> createState() => _StaffInviteFormState();
}

class _StaffInviteFormState extends State<StaffInviteForm> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();
  final Set<String> _permissions = {
    BusinessPermission.profile,
    BusinessPermission.people,
  };
  StaffInviteMethod _method = StaffInviteMethod.phone;
  String? _pickedBusinessId;

  /// '' = not chosen, [_allStores] = every store, else a store id.
  String _storeChoice = '';
  static const _allStores = '*';
  StreamSubscription<List<InventoryStore>>? _storesSub;
  String? _storesBusinessId;
  InventoryStoreContext _stores = InventoryStoreContext.single;
  bool _sending = false;
  String? _error;
  StaffInviteResult? _shareResult;

  String? get _businessId =>
      widget.businesses != null ? _pickedBusinessId : widget.businessId;

  @override
  void initState() {
    super.initState();
    _watchStoresOf(_businessId);
  }

  @override
  void didUpdateWidget(StaffInviteForm oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.businessId != widget.businessId) _watchStoresOf(_businessId);
  }

  @override
  void dispose() {
    _storesSub?.cancel();
    _nameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    super.dispose();
  }

  void _watchStoresOf(String? businessId) {
    if (businessId == _storesBusinessId) return;
    _storesSub?.cancel();
    _storesSub = null;
    _storesBusinessId = businessId;
    _stores = InventoryStoreContext.single;
    _storeChoice = '';
    if (businessId == null || businessId.isEmpty) return;
    final watch = widget.watchStores ?? FirestoreInventorySource().watchStores;
    // A business without Inventory (or a refused read) has no stores: the
    // question is simply not asked.
    _storesSub = watch(businessId).listen((rows) {
      if (!mounted) return;
      setState(() {
        _stores = InventoryStoreContext(stores: rows);
        if (_storeChoice != _allStores &&
            !_stores.active.any((store) => store.id == _storeChoice)) {
          _storeChoice = '';
        }
      });
    }, onError: (Object _) {});
  }

  StaffInviteStoreChoice? get _storeChoiceValue => switch (_storeChoice) {
    '' => null,
    _allStores => const StaffInviteStoreChoice.allStores(),
    final id => StaffInviteStoreChoice.store(id),
  };

  Future<void> _send() async {
    if (_sending) return;
    final l10n = AppLocalizations.of(context)!;
    setState(() => _error = null);
    if (!_formKey.currentState!.validate()) return;
    final businessId = _businessId;
    if (businessId == null || businessId.isEmpty) {
      setState(() => _error = l10n.chooseStaffBusinessMessage);
      return;
    }
    final payload = businessInvitePayload(
      businessId: businessId,
      fullName: _nameController.text,
      method: _method,
      phone: PhoneNumberValidator.normalized(_phoneController.text),
      email: _emailController.text,
      businessPermissions: _permissions.toList(),
      locale: Localizations.localeOf(context).languageCode,
      multiStore: _stores.multi,
      storeChoice: _storeChoiceValue,
    );
    setState(() => _sending = true);
    try {
      final result = await widget.service.inviteBusinessMember(payload);
      if (!mounted) return;
      if (result.needsShare) {
        setState(() {
          _sending = false;
          _shareResult = result;
        });
        return;
      }
      showSuccessSnackBar(
        context,
        result.isPhone ? l10n.stiSentOnWhatsApp : l10n.invitationSent,
      );
      widget.onDone?.call();
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = staffInviteErrorText(l10n, error));
    } finally {
      if (mounted && _sending) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final share = _shareResult;
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.12),
            blurRadius: 28,
            offset: const Offset(0, 14),
          ),
        ],
      ),
      child: share != null ? _shareStep(l10n, share) : _form(l10n),
    );
  }

  Widget _shareStep(AppLocalizations l10n, StaffInviteResult result) {
    return Column(
      key: const Key('staff-invite-share-step'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          l10n.invitationSent,
          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900),
        ),
        if (result.phoneMasked.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.xs),
          Text(
            result.phoneMasked,
            style: const TextStyle(color: AppColors.muted),
          ),
        ],
        const SizedBox(height: AppSpacing.md),
        StaffInviteShareNote(link: result.inviteLink),
        const SizedBox(height: AppSpacing.lg),
        SizedBox(
          height: 48,
          child: FilledButton(
            key: const Key('staff-invite-done'),
            onPressed: widget.onDone,
            child: Text(l10n.done),
          ),
        ),
      ],
    );
  }

  Widget _form(AppLocalizations l10n) {
    final businesses = widget.businesses;
    return Form(
      key: _formKey,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.inviteBusinessPersonnel,
            style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w900),
          ),
          const SizedBox(height: 5),
          Text(
            l10n.inviteBusinessPersonnelHelp,
            style: const TextStyle(color: AppColors.muted),
          ),
          const SizedBox(height: 18),
          if (businesses != null) ...[
            DropdownButtonFormField<String>(
              key: const Key('staff-invite-business'),
              initialValue: _pickedBusinessId,
              isExpanded: true,
              decoration: InputDecoration(
                labelText: l10n.business,
                prefixIcon: const Icon(Icons.storefront_outlined),
              ),
              items: [
                for (final business in businesses)
                  DropdownMenuItem(
                    value: business.id,
                    child: Text(business.name, overflow: TextOverflow.ellipsis),
                  ),
              ],
              onChanged: _sending
                  ? null
                  : (value) {
                      setState(() => _pickedBusinessId = value);
                      _watchStoresOf(value);
                    },
              validator: (value) =>
                  value == null ? l10n.chooseStaffBusiness : null,
            ),
            const SizedBox(height: 14),
          ],
          TextFormField(
            key: const Key('staff-invite-name'),
            controller: _nameController,
            enabled: !_sending,
            textCapitalization: TextCapitalization.words,
            decoration: InputDecoration(
              labelText: l10n.fullName,
              prefixIcon: const Icon(Icons.badge_outlined),
            ),
            validator: (value) =>
                (value ?? '').trim().isEmpty ? l10n.stiNameRequired : null,
          ),
          const SizedBox(height: 14),
          Text(
            l10n.stiMethodLabel,
            style: const TextStyle(fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 6),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            children: [
              ChoiceChip(
                key: const Key('staff-invite-method-phone'),
                avatar: const Icon(Icons.chat_outlined, size: 17),
                label: Text(l10n.stiMethodPhone),
                selected: _method == StaffInviteMethod.phone,
                onSelected: _sending
                    ? null
                    : (_) => setState(() {
                        _method = StaffInviteMethod.phone;
                        _error = null;
                      }),
              ),
              ChoiceChip(
                key: const Key('staff-invite-method-email'),
                avatar: const Icon(Icons.email_outlined, size: 17),
                label: Text(l10n.stiMethodEmail),
                selected: _method == StaffInviteMethod.email,
                onSelected: _sending
                    ? null
                    : (_) => setState(() {
                        _method = StaffInviteMethod.email;
                        _error = null;
                      }),
              ),
            ],
          ),
          const SizedBox(height: 12),
          if (_method == StaffInviteMethod.phone)
            CountryPhoneField(
              key: const ValueKey('staff-invite-phone-field'),
              fieldKey: const Key('staff-invite-phone'),
              controller: _phoneController,
              enabled: !_sending,
              labelText: l10n.stiPhoneLabel,
              helperText: l10n.stiPhoneHelp,
              textInputAction: TextInputAction.done,
              validator: (_) =>
                  PhoneNumberValidator.isValidE164(
                    PhoneNumberValidator.normalized(_phoneController.text),
                  )
                  ? null
                  : l10n.stiPhoneRequired,
            )
          else
            TextFormField(
              key: const Key('staff-invite-email'),
              controller: _emailController,
              enabled: !_sending,
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
          if (_stores.multi) ...[
            const SizedBox(height: 16),
            DropdownButtonFormField<String>(
              key: const Key('staff-invite-store'),
              initialValue: _storeChoice.isEmpty ? null : _storeChoice,
              isExpanded: true,
              decoration: InputDecoration(
                labelText: l10n.stiStoreLabel,
                helperText: l10n.stiStoreHelp,
                prefixIcon: const Icon(Icons.store_mall_directory_outlined),
              ),
              items: [
                DropdownMenuItem(
                  value: _allStores,
                  child: Text(l10n.stiStoreAll),
                ),
                for (final store in _stores.active)
                  DropdownMenuItem(
                    value: store.id,
                    child: Text(store.name, overflow: TextOverflow.ellipsis),
                  ),
              ],
              onChanged: _sending
                  ? null
                  : (value) => setState(() => _storeChoice = value ?? ''),
              validator: (value) =>
                  (value ?? '').isEmpty ? l10n.stiStoreRequired : null,
            ),
          ],
          const SizedBox(height: 20),
          Text(
            l10n.businessPermissions,
            style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w900),
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
                  onSelected: _sending
                      ? null
                      : (selected) => setState(() {
                          if (selected) {
                            _permissions.add(permission.key);
                          } else {
                            _permissions.remove(permission.key);
                          }
                        }),
                ),
            ],
          ),
          if (_error != null) ...[
            const SizedBox(height: 16),
            Semantics(
              liveRegion: true,
              child: Container(
                key: const Key('staff-invite-error'),
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: AppColors.errorRed.withValues(alpha: 0.08),
                  borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                ),
                child: Text(
                  _error!,
                  style: const TextStyle(
                    color: AppColors.errorRed,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ),
          ],
          const SizedBox(height: 22),
          SizedBox(
            width: double.infinity,
            height: 52,
            child: FilledButton.icon(
              key: const Key('staff-invite-send'),
              onPressed: _sending ? null : _send,
              icon: _sending
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.send_outlined),
              label: Text(l10n.sendInvitation),
            ),
          ),
        ],
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
    BusinessPermission.ledger,
    Icons.menu_book_outlined,
    (l10n) => l10n.lotLedgerTitle,
  ),
  _PermissionOption(
    BusinessPermission.invoices,
    Icons.request_quote_outlined,
    (l10n) => l10n.invPermissionLabel,
  ),
  _PermissionOption(
    BusinessPermission.containers,
    Icons.view_in_ar_outlined,
    (l10n) => l10n.ctrTitle,
  ),
  _PermissionOption(
    BusinessPermission.deliveries,
    Icons.how_to_reg_outlined,
    (l10n) => l10n.dlvTitle,
  ),
  _PermissionOption(
    BusinessPermission.inventory,
    Icons.qr_code_scanner,
    (l10n) => l10n.inventoryTitle,
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
    BusinessPermission.reviews,
    Icons.star_outline,
    (l10n) => l10n.reviews,
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
