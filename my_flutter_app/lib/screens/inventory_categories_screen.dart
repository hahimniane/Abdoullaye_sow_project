import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/inventory_service.dart';
import '../services/inventory_stores.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/inventory_widgets.dart';
import '../widgets/lot_sheets.dart';

/// A category as the sheets hand it back: its id and name. A blank id is a
/// name kept as plain text (a server that has no category list yet).
typedef InventoryCategoryChoice = ({String id, String name});

/// Asks for a category's name and saves it: a new category, or - with
/// [existing] - the new name of one. Answers the category, or null when
/// closed without saving.
Future<InventoryCategoryChoice?> showInventoryCategorySheet(
  BuildContext context, {
  required String businessId,
  InventoryCategory? existing,
  InventoryService service = const InventoryService(),
}) =>
    showLotSheet<InventoryCategoryChoice>(
      context,
      InventoryCategorySheet(
        businessId: businessId,
        existing: existing,
        service: service,
      ),
    );

class InventoryCategorySheet extends StatefulWidget {
  const InventoryCategorySheet({
    super.key,
    required this.businessId,
    this.existing,
    this.service = const InventoryService(),
  });

  final String businessId;
  final InventoryCategory? existing;
  final InventoryService service;

  @override
  State<InventoryCategorySheet> createState() => _InventoryCategorySheetState();
}

class _InventoryCategorySheetState extends State<InventoryCategorySheet> {
  late final _name = TextEditingController(text: widget.existing?.name ?? '');
  bool _busy = false;
  bool _submitted = false;
  String _serverNote = '';

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_busy) return;
    final l10n = AppLocalizations.of(context)!;
    if (validateInventoryCategoryName(_name.text).isNotEmpty) {
      AppHaptics.refuse();
      setState(() => _submitted = true);
      return;
    }
    final name = _name.text.trim();
    setState(() {
      _busy = true;
      _serverNote = '';
    });
    try {
      final existing = widget.existing;
      String id;
      if (existing == null) {
        id = await widget.service.createCategory(widget.businessId, name);
      } else {
        await widget.service.renameCategory(widget.businessId, existing.id, name);
        id = existing.id;
      }
      if (!mounted) return;
      AppHaptics.commit();
      Navigator.of(context).pop((id: id, name: name));
    } catch (error) {
      if (!mounted) return;
      // A server with no category list yet: the name is kept as the product's
      // plain category text, the way it was typed before categories existed.
      if (widget.existing == null && inventoryCategoryCreateUnsupported(error)) {
        Navigator.of(context).pop((id: '', name: name));
        return;
      }
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
    final renaming = widget.existing != null;
    final problems =
        _submitted ? validateInventoryCategoryName(_name.text) : const <String>[];
    return LotSheetShell(
      title: renaming
          ? l10n.inventoryCategoryRenameTitle
          : l10n.inventoryCategoryAddNew,
      footer: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_serverNote.isNotEmpty) ...[
            InventoryNote(key: const Key('inv-category-error'), text: _serverNote),
            const SizedBox(height: AppSpacing.sm),
          ],
          LotSheetButton(
            key: const Key('inv-category-save'),
            label: renaming
                ? l10n.inventoryCategoryRename
                : l10n.inventoryCategoryCreate,
            busy: _busy,
            busyLabel: l10n.inventorySaving,
            onTap: _save,
          ),
        ],
      ),
      body: TextField(
        key: const Key('inv-category-name'),
        controller: _name,
        enabled: !_busy,
        autofocus: true,
        textCapitalization: TextCapitalization.sentences,
        onChanged: (_) {
          if (_submitted) setState(() {});
        },
        decoration: InputDecoration(
          labelText: l10n.inventoryCategoryNameLabel,
          errorText: problems.isEmpty
              ? null
              : inventoryFieldErrorText(l10n, problems.first),
          errorMaxLines: 3,
        ),
      ),
    );
  }
}

/// The business's categories: add one, rename one, archive or restore one.
/// Archived categories stay on the products that have them.
class InventoryCategoriesScreen extends StatefulWidget {
  const InventoryCategoriesScreen({
    super.key,
    required this.businessId,
    this.source,
    this.service = const InventoryService(),
  });

  final String businessId;
  final InventorySource? source;
  final InventoryService service;

  @override
  State<InventoryCategoriesScreen> createState() =>
      _InventoryCategoriesScreenState();
}

class _InventoryCategoriesScreenState extends State<InventoryCategoriesScreen> {
  late final InventorySource _source = widget.source ?? FirestoreInventorySource();
  StreamSubscription<Object?>? _sub;
  Timer? _safety;
  List<InventoryCategory> _categories = const [];
  bool _loaded = false;
  String _busy = '';

  @override
  void initState() {
    super.initState();
    _safety = Timer(const Duration(seconds: 15), () {
      if (mounted && !_loaded) setState(() => _loaded = true);
    });
    _sub = _source.watchCategories(widget.businessId).listen((rows) {
      if (!mounted) return;
      _safety?.cancel();
      setState(() {
        _categories = [
          ...rows,
        ]..sort((a, b) {
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

  Future<void> _add() async {
    final l10n = AppLocalizations.of(context)!;
    final made = await showInventoryCategorySheet(
      context,
      businessId: widget.businessId,
      service: widget.service,
    );
    if (made != null && mounted) {
      showSuccessSnackBar(context, l10n.inventoryCategoryAddedDone);
    }
  }

  Future<void> _rename(InventoryCategory category) async {
    final l10n = AppLocalizations.of(context)!;
    final done = await showInventoryCategorySheet(
      context,
      businessId: widget.businessId,
      existing: category,
      service: widget.service,
    );
    if (done != null && mounted) {
      showSuccessSnackBar(context, l10n.inventoryCategoryRenamedDone);
    }
  }

  Future<void> _archive(InventoryCategory category) async {
    if (_busy.isNotEmpty) return;
    final l10n = AppLocalizations.of(context)!;
    setState(() => _busy = category.id);
    try {
      await widget.service.setCategoryArchived(
        widget.businessId,
        category.id,
        archived: !category.archived,
      );
      if (!mounted) return;
      AppHaptics.commit();
      showSuccessSnackBar(
        context,
        category.archived
            ? l10n.inventoryCategoryRestoredDone
            : l10n.inventoryCategoryArchivedDone,
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
    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          InventoryHeader(title: l10n.inventoryCategoriesTitle),
          Expanded(
            child: !_loaded
                ? const Center(child: CircularProgressIndicator())
                : ListView(
                    padding: const EdgeInsets.fromLTRB(AppSpacing.lg,
                        AppSpacing.md, AppSpacing.lg, AppSpacing.xl),
                    children: [
                      LotSheetButton(
                        key: const Key('inv-categories-add'),
                        label: l10n.inventoryCategoryAddNew,
                        onTap: _add,
                      ),
                      const SizedBox(height: AppSpacing.md),
                      if (_categories.isEmpty)
                        LotEmptyState(
                          key: const Key('inv-categories-empty'),
                          icon: Icons.category_outlined,
                          title: l10n.inventoryCategoriesEmpty,
                        )
                      else
                        for (final category in _categories)
                          _CategoryRow(
                            key: ValueKey('inv-category-${category.id}'),
                            category: category,
                            busy: _busy == category.id,
                            onRename: () => _rename(category),
                            onArchive: () => _archive(category),
                          ),
                    ],
                  ),
          ),
        ],
      ),
    );
  }
}

class _CategoryRow extends StatelessWidget {
  const _CategoryRow({
    super.key,
    required this.category,
    required this.busy,
    required this.onRename,
    required this.onArchive,
  });

  final InventoryCategory category;
  final bool busy;
  final VoidCallback onRename;
  final VoidCallback onArchive;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md, vertical: AppSpacing.sm),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.rule),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  category.name,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: category.archived ? AppColors.muted : AppColors.ink,
                  ),
                ),
                if (category.archived) ...[
                  const SizedBox(height: 4),
                  InventoryChip(
                    label: l10n.inventoryArchivedChip,
                    color: AppColors.muted,
                  ),
                ],
              ],
            ),
          ),
          TextButton(
            key: Key('inv-category-rename-${category.id}'),
            style: TextButton.styleFrom(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              minimumSize: const Size(44, 44),
            ),
            onPressed: busy ? null : onRename,
            child: Text(l10n.inventoryCategoryRename),
          ),
          TextButton(
            key: Key('inv-category-archive-${category.id}'),
            style: TextButton.styleFrom(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              minimumSize: const Size(44, 44),
            ),
            onPressed: busy ? null : onArchive,
            child: Text(
              category.archived ? l10n.inventoryRestore : l10n.inventoryArchive,
            ),
          ),
        ],
      ),
    );
  }
}
