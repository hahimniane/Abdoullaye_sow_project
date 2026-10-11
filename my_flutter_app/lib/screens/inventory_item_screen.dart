import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/inventory.dart';
import '../services/inventory_service.dart';
import '../services/lot_ledger.dart' show LotStaff, formatLotCents;
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/action_confirmation.dart';
import '../utils/date_display.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/inventory_widgets.dart';
import '../widgets/lot_sheets.dart';
import 'containers_screen.dart' show ContainerSheetAction;
import 'inventory_item_sheets.dart';

/// One product: its price, cost and count, the actions on it (add stock, set
/// the count, edit, print tags, archive, delete) and its stock history - who
/// changed the count, by how much, and when.
///
/// Archiving is the everyday way to retire a product (history stays, and it
/// can be restored). Delete is behind its own confirmation, and past sales
/// keep a snapshot of the name and price.
class InventoryItemScreen extends StatefulWidget {
  const InventoryItemScreen({
    super.key,
    required this.businessId,
    required this.itemId,
    this.source,
    this.service = const InventoryService(),
    this.tagOpener = openInventoryTags,
  });

  final String businessId;
  final String itemId;
  final InventorySource? source;
  final InventoryService service;
  final InventoryTagOpener tagOpener;

  @override
  State<InventoryItemScreen> createState() => _InventoryItemScreenState();
}

class _InventoryItemScreenState extends State<InventoryItemScreen> {
  late final InventorySource _source = widget.source ?? FirestoreInventorySource();
  final List<StreamSubscription<Object?>> _subs = [];
  Timer? _safety;

  InventoryItem? _item;
  List<InventoryMovement> _movements = const [];
  List<LotStaff> _staff = const [];
  bool _loaded = false;
  bool _movementsLoaded = false;
  String _busy = '';

  @override
  void initState() {
    super.initState();
    _safety = Timer(const Duration(seconds: 15), () {
      if (!mounted) return;
      setState(() {
        _loaded = true;
        _movementsLoaded = true;
      });
    });
    _subs.add(_source.watchItems(widget.businessId).listen((items) {
      if (!mounted) return;
      InventoryItem? found;
      for (final item in items) {
        if (item.id == widget.itemId) found = item;
      }
      setState(() {
        _item = found;
        _loaded = true;
      });
    }, onError: (_) {
      if (mounted) setState(() => _loaded = true);
    }));
    _subs.add(_source
        .watchMovements(widget.businessId, widget.itemId)
        .listen((movements) {
      if (!mounted) return;
      setState(() {
        _movements = movements;
        _movementsLoaded = true;
      });
    }, onError: (_) {
      if (mounted) setState(() => _movementsLoaded = true);
    }));
    _subs.add(_source.watchStaff(widget.businessId).listen((staff) {
      if (mounted) setState(() => _staff = staff);
    }, onError: (_) {}));
  }

  @override
  void dispose() {
    _safety?.cancel();
    for (final s in _subs) {
      s.cancel();
    }
    super.dispose();
  }

  Future<void> _addStock(InventoryItem item, {required bool add}) async {
    final l10n = AppLocalizations.of(context)!;
    final saved = await showInventoryStockSheet(
      context,
      businessId: widget.businessId,
      item: item,
      add: add,
      service: widget.service,
    );
    if (saved == true && mounted) {
      showSuccessSnackBar(
          context, add ? l10n.inventoryStockAdded : l10n.inventoryCountSet);
    }
  }

  Future<void> _edit(InventoryItem item) async {
    final l10n = AppLocalizations.of(context)!;
    final saved = await showInventoryItemForm(
      context,
      businessId: widget.businessId,
      existing: item,
      service: widget.service,
    );
    if (saved == true && mounted) {
      showSuccessSnackBar(context, l10n.inventoryProductSaved);
    }
  }

  Future<void> _run(String action, Future<void> Function() work,
      {required String success, bool leave = false}) async {
    if (_busy.isNotEmpty) return;
    final l10n = AppLocalizations.of(context)!;
    setState(() => _busy = action);
    try {
      await work();
      if (!mounted) return;
      AppHaptics.commit();
      showSuccessSnackBar(context, success);
      if (leave) Navigator.of(context).maybePop();
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

  Future<void> _archive(InventoryItem item) async {
    final l10n = AppLocalizations.of(context)!;
    if (!item.archived) {
      final ok = await confirmMajorAction(
        context,
        title: l10n.inventoryArchiveTitle,
        message: l10n.inventoryArchiveMessage,
        confirmLabel: l10n.inventoryArchive,
      );
      if (!ok || !mounted) return;
    }
    await _run(
      'archive',
      () => widget.service
          .setArchived(widget.businessId, item.id, archived: !item.archived),
      success:
          item.archived ? l10n.inventoryRestoredDone : l10n.inventoryArchivedDone,
    );
  }

  Future<void> _delete(InventoryItem item) async {
    final l10n = AppLocalizations.of(context)!;
    final ok = await confirmMajorAction(
      context,
      title: l10n.inventoryDeleteTitle,
      message: l10n.inventoryDeleteMessage,
      confirmLabel: l10n.inventoryDelete,
      destructive: true,
    );
    if (!ok || !mounted) return;
    await _run(
      'delete',
      () => widget.service.deleteItem(widget.businessId, item.id),
      success: l10n.inventoryDeletedDone,
      leave: true,
    );
  }

  Future<void> _tags(InventoryItem item) => showInventoryTagSheet(
        context,
        businessId: widget.businessId,
        item: item,
        opener: widget.tagOpener,
      );

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final item = _item;
    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          InventoryHeader(
            title: item?.name ?? l10n.inventoryProductTitle,
            subtitle: item?.code,
          ),
          Expanded(
            child: !_loaded
                ? const Center(child: CircularProgressIndicator())
                : item == null
                    ? LotEmptyState(
                        key: const Key('inv-item-gone'),
                        icon: Icons.inventory_2_outlined,
                        title: l10n.inventoryProductGone,
                      )
                    : _body(l10n, item),
          ),
        ],
      ),
    );
  }

  Widget _body(AppLocalizations l10n, InventoryItem item) {
    final locale = dateLocaleOf(context);
    final busy = _busy.isNotEmpty;
    return ListView(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.xl),
      children: [
        Container(
          padding: const EdgeInsets.all(AppSpacing.lg),
          decoration: BoxDecoration(
            color: AppColors.paper,
            borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
            border: Border.all(color: AppColors.rule),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  InventoryPhoto(url: item.photoUrl, size: 72),
                  const SizedBox(width: AppSpacing.lg),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${item.quantity}',
                          key: const Key('inv-item-count'),
                          style: const TextStyle(
                            fontSize: 30,
                            fontWeight: FontWeight.w800,
                            height: 1.05,
                            color: AppColors.ink,
                          ),
                        ),
                        Text(
                          l10n.inventoryInStockCount(item.quantity),
                          style: const TextStyle(
                              fontSize: 12.5, color: AppColors.muted),
                        ),
                        const SizedBox(height: AppSpacing.sm),
                        InventoryStatusChips(item: item),
                      ],
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.md),
              _fact(l10n.inventoryPrice, formatLotCents(item.priceCents),
                  key: const Key('inv-item-price')),
              if (item.costCents != null)
                _fact(l10n.inventoryCost, formatLotCents(item.costCents!)),
              _fact(l10n.inventoryTagCode, item.code),
              if (item.category.isNotEmpty)
                _fact(l10n.inventoryCategory, item.category),
              if (item.lowStockAt != null)
                _fact(l10n.inventoryLowStockAtLabel,
                    '${item.lowStockAt}'),
              if (item.countWasOff) ...[
                const SizedBox(height: AppSpacing.sm),
                InventoryNote(
                  key: const Key('inv-item-count-off'),
                  error: false,
                  text: l10n.inventoryCountOffNote,
                ),
              ],
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.lg),
        ContainerSheetAction(
          key: const Key('inv-act-add'),
          icon: Icons.add_box_outlined,
          label: l10n.inventoryAddStock,
          onTap: busy ? () {} : () => _addStock(item, add: true),
        ),
        ContainerSheetAction(
          key: const Key('inv-act-set'),
          icon: Icons.tune,
          label: l10n.inventorySetCount,
          onTap: busy ? () {} : () => _addStock(item, add: false),
        ),
        ContainerSheetAction(
          key: const Key('inv-act-tags'),
          icon: Icons.qr_code_2,
          label: l10n.inventoryPrintTags,
          onTap: busy ? () {} : () => _tags(item),
        ),
        ContainerSheetAction(
          key: const Key('inv-act-edit'),
          icon: Icons.edit_outlined,
          label: l10n.inventoryEditProduct,
          onTap: busy ? () {} : () => _edit(item),
        ),
        ContainerSheetAction(
          key: const Key('inv-act-archive'),
          icon: item.archived ? Icons.unarchive_outlined : Icons.archive_outlined,
          label: item.archived ? l10n.inventoryRestore : l10n.inventoryArchive,
          onTap: busy ? () {} : () => _archive(item),
        ),
        ContainerSheetAction(
          key: const Key('inv-act-delete'),
          icon: Icons.delete_outline,
          label: l10n.inventoryDelete,
          destructive: true,
          onTap: busy ? () {} : () => _delete(item),
        ),
        const SizedBox(height: AppSpacing.lg),
        Text(
          l10n.inventoryHistoryTitle,
          style: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.2,
            color: AppColors.ink,
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        if (!_movementsLoaded)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: AppSpacing.lg),
            child: Center(child: CircularProgressIndicator()),
          )
        else if (_movements.isEmpty)
          Text(
            l10n.inventoryNoHistory,
            key: const Key('inv-history-empty'),
            style: const TextStyle(fontSize: 13, color: AppColors.muted),
          )
        else
          Column(
            key: const Key('inv-history'),
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final move in _movements)
                _MovementRow(
                  key: ValueKey('inv-move-${move.id}'),
                  movement: move,
                  by: inventoryStaffName(_staff, move.byStaffId),
                  locale: locale,
                ),
            ],
          ),
      ],
    );
  }

  Widget _fact(String label, String value, {Key? key}) => Padding(
        padding: const EdgeInsets.only(bottom: 4),
        child: Row(
          children: [
            Expanded(
              child: Text(label,
                  style: const TextStyle(fontSize: 13, color: AppColors.muted)),
            ),
            Flexible(
              child: Text(
                value,
                key: key,
                textAlign: TextAlign.end,
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: AppColors.ink,
                ),
              ),
            ),
          ],
        ),
      );
}

class _MovementRow extends StatelessWidget {
  const _MovementRow({
    super.key,
    required this.movement,
    required this.by,
    required this.locale,
  });

  final InventoryMovement movement;
  final String by;
  final String locale;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final when = movement.createdAt == null
        ? ''
        : displayDateTime(movement.createdAt!, locale);
    final detail = [
      l10n.inventoryMoveNow(movement.quantityAfter),
      if (by.isNotEmpty) l10n.inventoryByName(by),
      if (when.isNotEmpty) when,
    ].join(' · ');
    final up = movement.delta > 0;
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 48,
            child: Text(
              inventoryDeltaText(movement.delta),
              style: TextStyle(
                fontSize: 15,
                fontWeight: FontWeight.w800,
                color: movement.delta == 0
                    ? AppColors.muted
                    : (up ? AppColors.sage : AppColors.warn),
              ),
            ),
          ),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  inventoryMovementLabel(l10n, movement.type),
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: AppColors.ink,
                  ),
                ),
                Text(
                  detail,
                  style: const TextStyle(
                      fontSize: 12, height: 1.35, color: AppColors.muted),
                ),
                if (movement.note.isNotEmpty)
                  Text(
                    movement.note,
                    style: const TextStyle(
                        fontSize: 12, height: 1.35, color: AppColors.muted),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
