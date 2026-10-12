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

/// A brand as the sheets hand it back: its id and name. A blank id is a
/// name kept as plain text (a server that has no brand list yet).
typedef InventoryBrandChoice = ({String id, String name});

/// Asks for a brand's name and saves it: a new brand, or - with
/// [existing] - the new name of one. Answers the brand, or null when
/// closed without saving.
Future<InventoryBrandChoice?> showInventoryBrandSheet(
  BuildContext context, {
  required String businessId,
  InventoryBrand? existing,
  InventoryService service = const InventoryService(),
}) => showLotSheet<InventoryBrandChoice>(
  context,
  InventoryBrandSheet(
    businessId: businessId,
    existing: existing,
    service: service,
  ),
);

class InventoryBrandSheet extends StatefulWidget {
  const InventoryBrandSheet({
    super.key,
    required this.businessId,
    this.existing,
    this.service = const InventoryService(),
  });

  final String businessId;
  final InventoryBrand? existing;
  final InventoryService service;

  @override
  State<InventoryBrandSheet> createState() => _InventoryBrandSheetState();
}

class _InventoryBrandSheetState extends State<InventoryBrandSheet> {
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
    if (validateInventoryBrandName(_name.text).isNotEmpty) {
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
        id = await widget.service.createBrand(widget.businessId, name);
      } else {
        await widget.service.renameBrand(widget.businessId, existing.id, name);
        id = existing.id;
      }
      if (!mounted) return;
      AppHaptics.commit();
      Navigator.of(context).pop((id: id, name: name));
    } catch (error) {
      if (!mounted) return;
      // A server with no brand list yet: the name is kept as the product's
      // plain brand text, the way it was typed before brands existed.
      if (widget.existing == null && inventoryBrandCreateUnsupported(error)) {
        Navigator.of(context).pop((id: '', name: name));
        return;
      }
      AppHaptics.refuse();
      setState(
        () => _serverNote = inventoryFailureText(
          l10n,
          inventoryFailureFromError(error),
        ),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final renaming = widget.existing != null;
    final problems = _submitted
        ? validateInventoryBrandName(_name.text)
        : const <String>[];
    return LotSheetShell(
      title: renaming
          ? l10n.inventoryBrandRenameTitle
          : l10n.inventoryBrandAddNew,
      footer: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_serverNote.isNotEmpty) ...[
            InventoryNote(key: const Key('inv-brand-error'), text: _serverNote),
            const SizedBox(height: AppSpacing.sm),
          ],
          LotSheetButton(
            key: const Key('inv-brand-save'),
            label: renaming
                ? l10n.inventoryBrandRename
                : l10n.inventoryBrandCreate,
            busy: _busy,
            busyLabel: l10n.inventorySaving,
            onTap: _save,
          ),
        ],
      ),
      body: TextField(
        key: const Key('inv-brand-name'),
        controller: _name,
        enabled: !_busy,
        autofocus: true,
        textCapitalization: TextCapitalization.words,
        onChanged: (_) {
          if (_submitted) setState(() {});
        },
        decoration: InputDecoration(
          labelText: l10n.inventoryBrandNameLabel,
          errorText: problems.isEmpty
              ? null
              : inventoryFieldErrorText(l10n, problems.first),
          errorMaxLines: 3,
        ),
      ),
    );
  }
}

/// The business's brands: add one, rename one, archive or restore one.
/// Archived brands stay on the products that have them.
class InventoryBrandsScreen extends StatefulWidget {
  const InventoryBrandsScreen({
    super.key,
    required this.businessId,
    this.source,
    this.service = const InventoryService(),
  });

  final String businessId;
  final InventorySource? source;
  final InventoryService service;

  @override
  State<InventoryBrandsScreen> createState() => _InventoryBrandsScreenState();
}

class _InventoryBrandsScreenState extends State<InventoryBrandsScreen> {
  late final InventorySource _source =
      widget.source ?? FirestoreInventorySource();
  StreamSubscription<Object?>? _sub;
  Timer? _safety;
  List<InventoryBrand> _brands = const [];
  bool _loaded = false;
  String _busy = '';

  @override
  void initState() {
    super.initState();
    _safety = Timer(const Duration(seconds: 15), () {
      if (mounted && !_loaded) setState(() => _loaded = true);
    });
    _sub = _source
        .watchBrands(widget.businessId)
        .listen(
          (rows) {
            if (!mounted) return;
            _safety?.cancel();
            setState(() {
              _brands = [...rows]
                ..sort((a, b) {
                  if (a.archived != b.archived) return a.archived ? 1 : -1;
                  return a.name.toLowerCase().compareTo(b.name.toLowerCase());
                });
              _loaded = true;
            });
          },
          onError: (_) {
            if (!mounted) return;
            _safety?.cancel();
            setState(() => _loaded = true);
          },
        );
  }

  @override
  void dispose() {
    _safety?.cancel();
    _sub?.cancel();
    super.dispose();
  }

  Future<void> _add() async {
    final l10n = AppLocalizations.of(context)!;
    final made = await showInventoryBrandSheet(
      context,
      businessId: widget.businessId,
      service: widget.service,
    );
    if (made != null && mounted) {
      showSuccessSnackBar(context, l10n.inventoryBrandAddedDone);
    }
  }

  Future<void> _rename(InventoryBrand brand) async {
    final l10n = AppLocalizations.of(context)!;
    final done = await showInventoryBrandSheet(
      context,
      businessId: widget.businessId,
      existing: brand,
      service: widget.service,
    );
    if (done != null && mounted) {
      showSuccessSnackBar(context, l10n.inventoryBrandRenamedDone);
    }
  }

  Future<void> _archive(InventoryBrand brand) async {
    if (_busy.isNotEmpty) return;
    final l10n = AppLocalizations.of(context)!;
    setState(() => _busy = brand.id);
    try {
      await widget.service.setBrandArchived(
        widget.businessId,
        brand.id,
        archived: !brand.archived,
      );
      if (!mounted) return;
      AppHaptics.commit();
      showSuccessSnackBar(
        context,
        brand.archived
            ? l10n.inventoryBrandRestoredDone
            : l10n.inventoryBrandArchivedDone,
      );
    } catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      showErrorSnackBar(
        context,
        inventoryFailureText(l10n, inventoryFailureFromError(error)),
      );
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
          InventoryHeader(title: l10n.inventoryBrandsTitle),
          Expanded(
            child: !_loaded
                ? const Center(child: CircularProgressIndicator())
                : ListView(
                    padding: const EdgeInsets.fromLTRB(
                      AppSpacing.lg,
                      AppSpacing.md,
                      AppSpacing.lg,
                      AppSpacing.xl,
                    ),
                    children: [
                      LotSheetButton(
                        key: const Key('inv-brands-add'),
                        label: l10n.inventoryBrandAddNew,
                        onTap: _add,
                      ),
                      const SizedBox(height: AppSpacing.md),
                      if (_brands.isEmpty)
                        LotEmptyState(
                          key: const Key('inv-brands-empty'),
                          icon: Icons.sell_outlined,
                          title: l10n.inventoryBrandsEmpty,
                        )
                      else
                        for (final brand in _brands)
                          _BrandRow(
                            key: ValueKey('inv-brand-${brand.id}'),
                            brand: brand,
                            busy: _busy == brand.id,
                            onRename: () => _rename(brand),
                            onArchive: () => _archive(brand),
                          ),
                    ],
                  ),
          ),
        ],
      ),
    );
  }
}

class _BrandRow extends StatelessWidget {
  const _BrandRow({
    super.key,
    required this.brand,
    required this.busy,
    required this.onRename,
    required this.onArchive,
  });

  final InventoryBrand brand;
  final bool busy;
  final VoidCallback onRename;
  final VoidCallback onArchive;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md,
        vertical: AppSpacing.sm,
      ),
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
                  brand.name,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: brand.archived ? AppColors.muted : AppColors.ink,
                  ),
                ),
                if (brand.archived) ...[
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
            key: Key('inv-brand-rename-${brand.id}'),
            style: TextButton.styleFrom(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              minimumSize: const Size(44, 44),
            ),
            onPressed: busy ? null : onRename,
            child: Text(l10n.inventoryBrandRename),
          ),
          TextButton(
            key: Key('inv-brand-archive-${brand.id}'),
            style: TextButton.styleFrom(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              minimumSize: const Size(44, 44),
            ),
            onPressed: busy ? null : onArchive,
            child: Text(
              brand.archived ? l10n.inventoryRestore : l10n.inventoryArchive,
            ),
          ),
        ],
      ),
    );
  }
}
