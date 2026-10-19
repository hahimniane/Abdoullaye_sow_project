import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/inventory.dart';
import '../services/inventory_context.dart';
import '../services/inventory_service.dart';
import '../services/inventory_stores.dart';
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
import 'inventory_transfer_compose_screen.dart';

/// One product: its price, cost and count, the actions on it (add stock, set
/// the count, edit, print tags, archive, delete) and its stock history - who
/// changed the count, by how much, and when.
///
/// Archiving is the everyday way to retire a product (history stays, and it
/// can be restored). Delete is behind its own confirmation, and past sales
/// keep a snapshot of the name and price.
///
/// In a business with several stores the count is per store: staff see their
/// own store's count; the owner and "works in all stores" staff see the total
/// with each store's count and a store filter. Anyone who may send from a
/// store gets "Send to another store", which opens a new transfer with this
/// product. A single-store business sees none of that.
class InventoryItemScreen extends StatefulWidget {
  const InventoryItemScreen({
    super.key,
    required this.businessId,
    required this.itemId,
    this.source,
    this.service = const InventoryService(),
    this.tagOpener = openInventoryTags,
    this.access = const InventoryAccess.owner(),
  });

  final String businessId;
  final String itemId;
  final InventorySource? source;
  final InventoryService service;
  final InventoryTagOpener tagOpener;

  /// What the signed-in person may do across stores.
  final InventoryAccess access;

  @override
  State<InventoryItemScreen> createState() => _InventoryItemScreenState();
}

class _InventoryItemScreenState extends State<InventoryItemScreen> {
  late final InventorySource _source = widget.source ?? FirestoreInventorySource();
  final List<StreamSubscription<Object?>> _subs = [];
  StreamSubscription<Object?>? _movementsSub;
  String? _movementStore;
  Timer? _safety;
  late final InventoryContextWatcher _watcher = InventoryContextWatcher(
    source: _source,
    businessId: widget.businessId,
    access: widget.access,
    watchCategories: true,
    watchBrands: true,
    onChange: () {
      if (!mounted) return;
      setState(() {});
      _syncMovements();
    },
  );

  /// The store whose counts are shown ('' = every store), for someone who
  /// works in all of them.
  String _storeFilter = '';

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
    _watcher.start();
    _syncMovements();
    _subs.add(_source.watchStaff(widget.businessId).listen((staff) {
      if (mounted) setState(() => _staff = staff);
    }, onError: (_) {}));
  }

  /// The stock history: everyone's for the owner and all-stores staff, and
  /// only their own store's for everyone else (which waits until the stores are
  /// known, so a staff member never asks for more than they may read).
  void _syncMovements() {
    final seesAll = widget.access.seesAllStores;
    if (!seesAll && !_watcher.storesLoaded) return;
    final ctx = _watcher.context;
    final store = ctx.ownStoreId;
    final key = ctx.homeStoreMissing ? '!' : store;
    if (_movementStore == key) return;
    _movementStore = key;
    _movementsSub?.cancel();
    if (ctx.homeStoreMissing) {
      // No store, no history to read (and nothing the rules would allow).
      _movementsSub = null;
      setState(() => _movementsLoaded = true);
      return;
    }
    _movementsSub = _source
        .watchMovements(widget.businessId, widget.itemId, storeId: store)
        .listen((movements) {
      if (!mounted) return;
      setState(() {
        _movements = movements;
        _movementsLoaded = true;
      });
    }, onError: (_) {
      if (mounted) setState(() => _movementsLoaded = true);
    });
  }

  @override
  void dispose() {
    _safety?.cancel();
    _watcher.dispose();
    _movementsSub?.cancel();
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
      stores: _watcher.context,
      stock: _watcher.stock,
      initialStoreId: _storeFilter,
    );
    if (saved == true && mounted) {
      showSuccessSnackBar(
          context, add ? l10n.inventoryStockAdded : l10n.inventoryCountSet);
    }
  }

  /// A new store transfer that starts with this product, from the store in
  /// view (staff: their own store).
  Future<void> _sendToStore(InventoryItem item) => Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => InventoryTransferComposeScreen(
            businessId: widget.businessId,
            source: _source,
            service: widget.service,
            access: widget.access,
            initialItem: item,
            initialFromStoreId: _storeFilter.isNotEmpty
                ? _storeFilter
                : _watcher.context.homeStoreId,
          ),
        ),
      );

  Future<void> _edit(InventoryItem item) async {
    final l10n = AppLocalizations.of(context)!;
    final saved = await showInventoryItemForm(
      context,
      businessId: widget.businessId,
      existing: item,
      service: widget.service,
      categories: _watcher.categories,
      brands: _watcher.brands,
      stores: _watcher.context,
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
            title: item?.displayName ?? l10n.inventoryProductTitle,
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
    final stores = _watcher.context;
    final view = inventoryStockView(item, stores, _watcher.stock,
        storeFilter: _storeFilter);
    // The product as this person sees it: one store's count in place of the
    // total when they work in one store, or have narrowed to one.
    final shown =
        item.withQuantity(view.quantity, countWasOff: view.countWasOff);
    final category = inventoryCategoryOfItem(_watcher.categories, item);
    return ListView(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.xl),
      children: [
        if (stores.viewerSeesAll) ...[
          InventoryChoiceChips(
            keyPrefix: 'inv-store-filter',
            options: inventoryStoreChoices(l10n, stores),
            selected: _storeFilter,
            onSelected: (id) => setState(() => _storeFilter = id),
          ),
          const SizedBox(height: AppSpacing.md),
        ],
        if (stores.homeStoreMissing) ...[
          InventoryNote(
            key: const Key('inv-home-store-missing'),
            error: false,
            text: l10n.inventoryStoreHomeRequiredView,
          ),
          const SizedBox(height: AppSpacing.md),
        ],
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
                          '${shown.quantity}',
                          key: const Key('inv-item-count'),
                          style: const TextStyle(
                            fontSize: 30,
                            fontWeight: FontWeight.w800,
                            height: 1.05,
                            color: AppColors.ink,
                          ),
                        ),
                        Text(
                          l10n.inventoryInStockCount(shown.quantity),
                          style: const TextStyle(
                              fontSize: 12.5, color: AppColors.muted),
                        ),
                        if (stores.ownStoreId.isNotEmpty)
                          Text(
                            l10n.inventoryYourStore(
                                stores.storeName(stores.ownStoreId)),
                            key: const Key('inv-own-store'),
                            style: const TextStyle(
                                fontSize: 12.5, color: AppColors.muted),
                          ),
                        const SizedBox(height: AppSpacing.sm),
                        InventoryStatusChips(item: shown),
                        if (view.lowStoreIds.isNotEmpty)
                          Padding(
                            padding: const EdgeInsets.only(top: 4),
                            child: Wrap(
                              spacing: 6,
                              runSpacing: 4,
                              children: [
                                for (final id in view.lowStoreIds)
                                  InventoryChip(
                                    key: Key('inv-low-at-$id'),
                                    label: l10n.inventoryStoreLowAt(
                                        stores.storeName(id)),
                                    color: AppColors.warn,
                                  ),
                              ],
                            ),
                          ),
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
              if (item.brand.isNotEmpty)
                _fact(l10n.inventoryBrand, item.brand,
                    key: const Key('inv-item-brand')),
              if (item.category.isNotEmpty || category != null)
                _fact(l10n.inventoryCategory,
                    category?.name ?? item.category),
              if (item.lowStockAt != null)
                _fact(l10n.inventoryLowStockAtLabel,
                    '${item.lowStockAt}'),
              if (shown.countWasOff) ...[
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
        if (stores.viewerSeesAll) ...[
          const SizedBox(height: AppSpacing.md),
          _storeCounts(l10n, stores, item, view),
        ],
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
        if (stores.multi && !stores.homeStoreMissing)
          ContainerSheetAction(
            key: const Key('inv-act-send-to-store'),
            icon: Icons.local_shipping_outlined,
            label: l10n.invTrSendToStore,
            onTap: busy ? () {} : () => _sendToStore(item),
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
                  store: stores.multi ? stores.storeName(move.storeId) : '',
                  counterpart: stores.storeName(move.counterpartStoreId),
                ),
            ],
          ),
      ],
    );
  }

  /// Each store's count and the total, for someone who works in every store.
  Widget _storeCounts(
    AppLocalizations l10n,
    InventoryStoreContext stores,
    InventoryItem item,
    InventoryItemStockView view,
  ) {
    return Container(
      key: const Key('inv-store-counts'),
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.inventoryStockByStoreTitle,
            style: const TextStyle(
                fontSize: 13, fontWeight: FontWeight.w700, color: AppColors.ink),
          ),
          const SizedBox(height: AppSpacing.sm),
          for (final store in stores.active)
            _fact(
              store.name,
              '${_watcher.stock.at(item.id, store.id)}',
              key: Key('inv-store-count-${store.id}'),
            ),
          _fact(l10n.inventoryStockTotalLabel, '${item.quantity}',
              key: const Key('inv-store-total')),
        ],
      ),
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
    this.store = '',
    this.counterpart = '',
  });

  final InventoryMovement movement;
  final String by;
  final String locale;

  /// The store whose count moved, named only in a multi-store business.
  final String store;

  /// A store transfer's other store.
  final String counterpart;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final when = movement.createdAt == null
        ? ''
        : displayDateTime(movement.createdAt!, locale);
    final detail = [
      if (movement.transferCode.isNotEmpty)
        [movement.transferCode, if (counterpart.isNotEmpty) counterpart]
            .join(' · '),
      l10n.inventoryMoveNow(movement.quantityAfter),
      if (store.isNotEmpty) l10n.inventoryMoveAtStore(store),
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
                  // The old one-step move reads "Instant transfer"; a store
                  // transfer says which step moved the count.
                  inventoryMovementTitle(l10n, movement),
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
