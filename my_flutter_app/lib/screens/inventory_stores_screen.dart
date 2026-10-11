import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/inventory_service.dart';
import '../services/inventory_stores.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/action_confirmation.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/inventory_widgets.dart';
import '../widgets/lot_sheets.dart';

/// The owner's stores: add a store, edit it, archive or restore it. A business
/// with one store (or none) is a single-store business and shows nothing about
/// stores anywhere else; the second store is what turns that on. Only the
/// owner reaches this screen, and the server refuses anyone else (`owner_only`).
class InventoryStoresScreen extends StatefulWidget {
  const InventoryStoresScreen({
    super.key,
    required this.businessId,
    this.source,
    this.service = const InventoryService(),
  });

  final String businessId;
  final InventorySource? source;
  final InventoryService service;

  @override
  State<InventoryStoresScreen> createState() => _InventoryStoresScreenState();
}

class _InventoryStoresScreenState extends State<InventoryStoresScreen> {
  late final InventorySource _source = widget.source ?? FirestoreInventorySource();
  StreamSubscription<Object?>? _sub;
  Timer? _safety;
  List<InventoryStore> _stores = const [];
  bool _loaded = false;
  String _busy = '';

  @override
  void initState() {
    super.initState();
    _safety = Timer(const Duration(seconds: 15), () {
      if (mounted && !_loaded) setState(() => _loaded = true);
    });
    _sub = _source.watchStores(widget.businessId).listen((rows) {
      if (!mounted) return;
      _safety?.cancel();
      setState(() {
        _stores = [...rows]..sort((a, b) {
            if (a.archived != b.archived) return a.archived ? 1 : -1;
            return a.name.toLowerCase().compareTo(b.name.toLowerCase());
          });
        _loaded = true;
      });
    }, onError: (_) {
      if (!mounted) return;
      _safety?.cancel();
      setState(() => _loaded = true);
    });
  }

  @override
  void dispose() {
    _safety?.cancel();
    _sub?.cancel();
    super.dispose();
  }

  Future<void> _form([InventoryStore? existing]) async {
    final l10n = AppLocalizations.of(context)!;
    final saved = await showInventoryStoreForm(
      context,
      businessId: widget.businessId,
      existing: existing,
      service: widget.service,
    );
    if (saved == true && mounted) {
      showSuccessSnackBar(context, l10n.inventoryStoreSavedDone);
    }
  }

  Future<void> _archive(InventoryStore store) async {
    if (_busy.isNotEmpty) return;
    final l10n = AppLocalizations.of(context)!;
    if (!store.archived) {
      final ok = await confirmMajorAction(
        context,
        title: l10n.inventoryStoreArchiveTitle,
        message: l10n.inventoryStoreArchiveMessage,
        confirmLabel: l10n.inventoryArchive,
      );
      if (!ok || !mounted) return;
    }
    setState(() => _busy = store.id);
    try {
      await widget.service.setStoreArchived(
        widget.businessId,
        store.id,
        archived: !store.archived,
      );
      if (!mounted) return;
      AppHaptics.commit();
      showSuccessSnackBar(
        context,
        store.archived
            ? l10n.inventoryStoreRestoredDone
            : l10n.inventoryStoreArchivedDone,
      );
    } catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      showErrorSnackBar(
          context, inventoryFailureText(l10n, inventoryFailureFromError(error)));
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final activeCount = _stores.where((s) => !s.archived).length;
    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          InventoryHeader(title: l10n.inventoryStoresTitle),
          Expanded(
            child: !_loaded
                ? const Center(child: CircularProgressIndicator())
                : ListView(
                    padding: const EdgeInsets.fromLTRB(AppSpacing.lg,
                        AppSpacing.md, AppSpacing.lg, AppSpacing.xl),
                    children: [
                      if (activeCount < 2) ...[
                        Text(
                          l10n.inventoryStoresIntro,
                          key: const Key('inv-stores-intro'),
                          style: const TextStyle(
                              fontSize: 13, height: 1.4, color: AppColors.muted),
                        ),
                        const SizedBox(height: AppSpacing.md),
                      ],
                      LotSheetButton(
                        key: const Key('inv-stores-add'),
                        label: l10n.inventoryStoreAdd,
                        onTap: () => _form(),
                      ),
                      const SizedBox(height: AppSpacing.md),
                      for (final store in _stores)
                        _StoreRow(
                          key: ValueKey('inv-store-${store.id}'),
                          store: store,
                          busy: _busy == store.id,
                          onEdit: () => _form(store),
                          onArchive: () => _archive(store),
                        ),
                    ],
                  ),
          ),
        ],
      ),
    );
  }
}

class _StoreRow extends StatelessWidget {
  const _StoreRow({
    super.key,
    required this.store,
    required this.busy,
    required this.onEdit,
    required this.onArchive,
  });

  final InventoryStore store;
  final bool busy;
  final VoidCallback onEdit;
  final VoidCallback onArchive;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final detail = [
      if (store.address.isNotEmpty) store.address,
      if (store.phone.isNotEmpty) store.phone,
    ].join(' · ');
    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            store.name,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w700,
              color: store.archived ? AppColors.muted : AppColors.ink,
            ),
          ),
          if (detail.isNotEmpty)
            Text(
              detail,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
            ),
          if (store.archived) ...[
            const SizedBox(height: 4),
            InventoryChip(
              label: l10n.inventoryArchivedChip,
              color: AppColors.muted,
            ),
          ],
          Align(
            alignment: Alignment.centerRight,
            child: Wrap(
              children: [
                TextButton(
                  key: Key('inv-store-edit-${store.id}'),
                  onPressed: busy ? null : onEdit,
                  child: Text(l10n.inventoryStoreEdit),
                ),
                TextButton(
                  key: Key('inv-store-archive-${store.id}'),
                  onPressed: busy ? null : onArchive,
                  child: busy
                      ? const SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Text(store.archived
                          ? l10n.inventoryRestore
                          : l10n.inventoryArchive),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Add a store, or edit one. Answers true when something was saved.
Future<bool?> showInventoryStoreForm(
  BuildContext context, {
  required String businessId,
  InventoryStore? existing,
  InventoryService service = const InventoryService(),
}) =>
    showLotSheet<bool>(
      context,
      InventoryStoreFormSheet(
        businessId: businessId,
        existing: existing,
        service: service,
      ),
    );

class InventoryStoreFormSheet extends StatefulWidget {
  const InventoryStoreFormSheet({
    super.key,
    required this.businessId,
    this.existing,
    this.service = const InventoryService(),
  });

  final String businessId;
  final InventoryStore? existing;
  final InventoryService service;

  @override
  State<InventoryStoreFormSheet> createState() => _InventoryStoreFormSheetState();
}

class _InventoryStoreFormSheetState extends State<InventoryStoreFormSheet> {
  late final _name = TextEditingController(text: widget.existing?.name ?? '');
  late final _address = TextEditingController(text: widget.existing?.address ?? '');
  late final _phone = TextEditingController(text: widget.existing?.phone ?? '');
  bool _busy = false;
  bool _submitted = false;
  String _serverNote = '';

  @override
  void dispose() {
    _name.dispose();
    _address.dispose();
    _phone.dispose();
    super.dispose();
  }

  InventoryStoreDraft get _draft => InventoryStoreDraft(
        name: _name.text,
        address: _address.text,
        phone: _phone.text,
      );

  Future<void> _save() async {
    if (_busy) return;
    final l10n = AppLocalizations.of(context)!;
    if (validateInventoryStoreDraft(_draft).isNotEmpty) {
      AppHaptics.refuse();
      setState(() => _submitted = true);
      return;
    }
    setState(() {
      _busy = true;
      _serverNote = '';
    });
    try {
      final existing = widget.existing;
      if (existing == null) {
        await widget.service.createStore(widget.businessId, _draft);
      } else {
        await widget.service.updateStore(widget.businessId, existing, _draft);
      }
      if (!mounted) return;
      AppHaptics.commit();
      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _serverNote =
          inventoryFailureText(l10n, inventoryFailureFromError(error)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final problems =
        _submitted ? validateInventoryStoreDraft(_draft) : const <String>[];
    String? nameError;
    for (final code in ['store_name_required', 'store_name_too_long']) {
      if (problems.contains(code)) nameError = inventoryFieldErrorText(l10n, code);
    }
    void changed(String _) {
      if (_submitted) setState(() {});
    }

    return LotSheetShell(
      title: widget.existing == null
          ? l10n.inventoryStoreAdd
          : l10n.inventoryStoreEdit,
      footer: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_serverNote.isNotEmpty) ...[
            InventoryNote(key: const Key('inv-store-error'), text: _serverNote),
            const SizedBox(height: AppSpacing.sm),
          ],
          LotSheetButton(
            key: const Key('inv-store-save'),
            label: l10n.inventoryStoreSave,
            busy: _busy,
            busyLabel: l10n.inventorySaving,
            onTap: _save,
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            key: const Key('inv-store-name'),
            controller: _name,
            enabled: !_busy,
            textCapitalization: TextCapitalization.words,
            onChanged: changed,
            decoration: InputDecoration(
              labelText: l10n.inventoryStoreName,
              errorText: nameError,
              errorMaxLines: 3,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            key: const Key('inv-store-address'),
            controller: _address,
            enabled: !_busy,
            textCapitalization: TextCapitalization.words,
            decoration: InputDecoration(labelText: l10n.inventoryStoreAddress),
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            key: const Key('inv-store-phone'),
            controller: _phone,
            enabled: !_busy,
            keyboardType: TextInputType.phone,
            decoration: InputDecoration(labelText: l10n.inventoryStorePhone),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Staff: home store and "works in all stores" (owner only).
// ---------------------------------------------------------------------------

/// A team member who holds the inventory permission, as the owner sees them.
class InventoryTeamMember {
  const InventoryTeamMember({
    required this.userId,
    required this.name,
    this.homeStoreId = '',
    this.allStores = false,
  });

  final String userId;
  final String name;
  final String homeStoreId;
  final bool allStores;
}

/// The owner's control for the staff who hold Inventory: where each person
/// sells (their home store) and whether they work in all stores. It shows
/// only when the business has two or more stores - before that there is
/// nothing to assign.
class InventoryTeamAccess extends StatefulWidget {
  const InventoryTeamAccess({
    super.key,
    required this.businessId,
    required this.members,
    this.source,
    this.service = const InventoryService(),
  });

  final String businessId;
  final List<InventoryTeamMember> members;
  final InventorySource? source;
  final InventoryService service;

  @override
  State<InventoryTeamAccess> createState() => _InventoryTeamAccessState();
}

class _InventoryTeamAccessState extends State<InventoryTeamAccess> {
  late final InventorySource _source = widget.source ?? FirestoreInventorySource();
  StreamSubscription<Object?>? _sub;
  List<InventoryStore> _stores = const [];

  @override
  void initState() {
    super.initState();
    _sub = _source.watchStores(widget.businessId).listen((rows) {
      if (mounted) setState(() => _stores = rows);
    }, onError: (_) {});
  }

  @override
  void dispose() {
    _sub?.cancel();
    super.dispose();
  }

  Future<void> _edit(InventoryTeamMember member) async {
    final l10n = AppLocalizations.of(context)!;
    final saved = await showInventoryStaffAccessSheet(
      context,
      businessId: widget.businessId,
      member: member,
      stores: InventoryStoreContext(stores: _stores),
      service: widget.service,
    );
    if (saved == true && mounted) {
      showSuccessSnackBar(context, l10n.inventoryStaffAccessSaved);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final ctx = InventoryStoreContext(stores: _stores);
    if (!ctx.multi || widget.members.isEmpty) return const SizedBox.shrink();
    return Column(
      key: const Key('inv-team-access'),
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const SizedBox(height: AppSpacing.md),
        Text(
          l10n.inventoryStaffAccessTitle,
          style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w800),
        ),
        const SizedBox(height: 4),
        for (final member in widget.members)
          ListTile(
            key: ValueKey('inv-access-${member.userId}'),
            contentPadding: EdgeInsets.zero,
            dense: true,
            title: Text(member.name, maxLines: 1, overflow: TextOverflow.ellipsis),
            subtitle: Text(inventoryStaffAccessSummary(l10n, ctx, member)),
            trailing: const Icon(Icons.chevron_right, size: 18),
            onTap: () => _edit(member),
          ),
      ],
    );
  }
}

/// "All stores", "Home: Brooklyn" or "No home store yet".
String inventoryStaffAccessSummary(
  AppLocalizations l10n,
  InventoryStoreContext context,
  InventoryTeamMember member,
) {
  if (member.allStores) return l10n.inventoryAllStoresSwitch;
  final home = context.storeName(member.homeStoreId);
  return home.isEmpty
      ? l10n.inventoryStaffAccessUnset
      : l10n.inventoryStaffAccessHome(home);
}

/// Sets a staff member's home store and whether they work in all stores.
/// Answers true when saved.
Future<bool?> showInventoryStaffAccessSheet(
  BuildContext context, {
  required String businessId,
  required InventoryTeamMember member,
  required InventoryStoreContext stores,
  InventoryService service = const InventoryService(),
}) =>
    showLotSheet<bool>(
      context,
      InventoryStaffAccessSheet(
        businessId: businessId,
        member: member,
        stores: stores,
        service: service,
      ),
    );

class InventoryStaffAccessSheet extends StatefulWidget {
  const InventoryStaffAccessSheet({
    super.key,
    required this.businessId,
    required this.member,
    required this.stores,
    this.service = const InventoryService(),
  });

  final String businessId;
  final InventoryTeamMember member;
  final InventoryStoreContext stores;
  final InventoryService service;

  @override
  State<InventoryStaffAccessSheet> createState() =>
      _InventoryStaffAccessSheetState();
}

class _InventoryStaffAccessSheetState extends State<InventoryStaffAccessSheet> {
  late String _home = widget.stores.active.any((s) => s.id == widget.member.homeStoreId)
      ? widget.member.homeStoreId
      : '';
  late bool _all = widget.member.allStores;
  bool _busy = false;
  String _serverNote = '';

  Future<void> _pickHome() async {
    final l10n = AppLocalizations.of(context)!;
    final picked = await pickLotOption<String>(
      context,
      title: l10n.inventoryHomeStore,
      selected: _home,
      options: [
        LotOption('', l10n.inventoryHomeStoreNone),
        for (final store in widget.stores.active) LotOption(store.id, store.name),
      ],
    );
    if (picked != null && mounted) setState(() => _home = picked);
  }

  Future<void> _save() async {
    if (_busy) return;
    final l10n = AppLocalizations.of(context)!;
    setState(() {
      _busy = true;
      _serverNote = '';
    });
    try {
      await widget.service.setStaffAccess(
        businessId: widget.businessId,
        userId: widget.member.userId,
        homeStoreId: _home,
        allStores: _all,
      );
      if (!mounted) return;
      AppHaptics.commit();
      Navigator.of(context).pop(true);
    } catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _serverNote =
          inventoryFailureText(l10n, inventoryFailureFromError(error)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final homeName = widget.stores.storeName(_home);
    return LotSheetShell(
      title: l10n.inventoryStaffAccessTitle,
      subtitle: widget.member.name,
      footer: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_serverNote.isNotEmpty) ...[
            InventoryNote(key: const Key('inv-access-error'), text: _serverNote),
            const SizedBox(height: AppSpacing.sm),
          ],
          LotSheetButton(
            key: const Key('inv-access-save'),
            label: l10n.inventoryStaffAccessSave,
            busy: _busy,
            busyLabel: l10n.inventorySaving,
            onTap: _save,
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.inventoryStaffAccessHelp,
            style: const TextStyle(fontSize: 13, height: 1.4, color: AppColors.muted),
          ),
          const SizedBox(height: AppSpacing.md),
          LotPickerField(
            key: const Key('inv-access-home'),
            label: l10n.inventoryHomeStore,
            value: homeName,
            placeholder: l10n.inventoryHomeStoreNone,
            onTap: _busy ? () {} : _pickHome,
          ),
          const SizedBox(height: AppSpacing.md),
          SwitchListTile(
            key: const Key('inv-access-all'),
            contentPadding: EdgeInsets.zero,
            value: _all,
            onChanged: _busy ? null : (v) => setState(() => _all = v),
            title: Text(l10n.inventoryAllStoresSwitch),
            subtitle: Text(l10n.inventoryAllStoresHelp),
          ),
        ],
      ),
    );
  }
}
