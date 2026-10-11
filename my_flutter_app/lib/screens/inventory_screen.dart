import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/inventory.dart';
import '../services/inventory_context.dart';
import '../services/inventory_service.dart';
import '../services/inventory_stores.dart';
import '../services/lot_ledger.dart' show formatLotCents;
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/inventory_widgets.dart';
import '../widgets/lot_sheets.dart';
import 'containers_screen.dart' show ContainerActionButton;
import 'inventory_categories_screen.dart';
import 'inventory_item_screen.dart';
import 'inventory_item_sheets.dart';
import 'inventory_sales_screen.dart';
import 'inventory_sell_screen.dart';
import 'inventory_stores_screen.dart';

/// The shop's inventory: today's numbers, what is running low, and the
/// products with search - low stock first. From here staff add a product, open
/// one (stock, tags, history), start a sale, or see the sales.
///
/// Products can be filtered by category, and the Today numbers carry a
/// "By category" block. In a business with several stores the counts are per
/// store: staff see their own store, the owner and "works in all stores" staff
/// see a store filter and a "By store" block - and the owner reaches the
/// stores manager from the header. A single-store business shows none of it.
class InventoryScreen extends StatefulWidget {
  const InventoryScreen({
    super.key,
    required this.businessId,
    this.source,
    this.service = const InventoryService(),
    this.tagOpener = openInventoryTags,
    this.cameraEnabled = true,
    this.access = const InventoryAccess.owner(),
  });

  final String businessId;

  /// What the signed-in person may do across stores (the owner by default,
  /// which is what a single-store business always sees).
  final InventoryAccess access;
  final InventorySource? source;
  final InventoryService service;
  final InventoryTagOpener tagOpener;

  /// Off in widget tests, where there is no camera plugin.
  @visibleForTesting
  final bool cameraEnabled;

  @override
  State<InventoryScreen> createState() => _InventoryScreenState();
}

class _InventoryScreenState extends State<InventoryScreen> {
  late final InventorySource _source =
      widget.source ?? FirestoreInventorySource();
  final List<StreamSubscription<Object?>> _subs = [];
  final TextEditingController _search = TextEditingController();
  Timer? _safety;
  late final InventoryContextWatcher _watcher = InventoryContextWatcher(
    source: _source,
    businessId: widget.businessId,
    access: widget.access,
    onChange: () {
      if (mounted) setState(() {});
    },
  );

  List<InventoryItem> _items = const [];
  bool _loaded = false;
  bool _failed = false;
  bool _showArchived = false;

  /// The category and (for someone who sees every store) the store being
  /// looked at; '' is "all".
  String _categoryFilter = '';
  String _storeFilter = '';

  InventorySummary? _summary;
  bool _summaryLoading = true;
  bool _summaryFailed = false;

  @override
  void initState() {
    super.initState();
    // The list always resolves, even if the stream never answers.
    _safety = Timer(const Duration(seconds: 15), () {
      if (mounted && !_loaded) setState(() => _loaded = true);
    });
    _watcher.start();
    _subs.add(
      _source
          .watchItems(widget.businessId)
          .listen(
            (items) {
              if (!mounted) return;
              _safety?.cancel();
              setState(() {
                _items = items;
                _loaded = true;
                _failed = false;
              });
            },
            onError: (_) {
              if (!mounted) return;
              _safety?.cancel();
              setState(() {
                _loaded = true;
                _failed = true;
              });
            },
          ),
    );
    unawaited(_loadSummary());
  }

  @override
  void dispose() {
    _safety?.cancel();
    _watcher.dispose();
    for (final s in _subs) {
      s.cancel();
    }
    _search.dispose();
    super.dispose();
  }

  Future<void> _loadSummary() async {
    if (mounted) {
      setState(() {
        _summaryLoading = true;
        _summaryFailed = false;
      });
    }
    try {
      final summary = await widget.service
          .summary(
            widget.businessId,
            // "All stores" is blank, and only someone who sees every store
            // may ask for it; a store is asked for by id.
            storeId: widget.access.seesAllStores ? _storeFilter : '',
          )
          .timeout(const Duration(seconds: 20));
      if (!mounted) return;
      setState(() {
        _summary = summary;
        _summaryLoading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _summaryLoading = false;
        _summaryFailed = true;
      });
    }
  }

  Future<void> _push(Widget screen) async {
    await Navigator.of(
      context,
    ).push(MaterialPageRoute<void>(builder: (_) => screen));
    // A sale, a void or a stock change moved today's numbers.
    if (mounted) unawaited(_loadSummary());
  }

  void _openItem(String itemId) => _push(
    InventoryItemScreen(
      businessId: widget.businessId,
      itemId: itemId,
      source: _source,
      service: widget.service,
      tagOpener: widget.tagOpener,
      access: widget.access,
    ),
  );

  void _setStoreFilter(String id) {
    setState(() => _storeFilter = id);
    unawaited(_loadSummary());
  }

  Future<void> _add() async {
    final l10n = AppLocalizations.of(context)!;
    final saved = await showInventoryItemForm(
      context,
      businessId: widget.businessId,
      service: widget.service,
      categories: _watcher.categories,
      stores: _watcher.context,
    );
    if (saved == true && mounted) {
      showSuccessSnackBar(context, l10n.inventoryProductAdded);
      unawaited(_loadSummary());
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final stores = _watcher.context;
    final categories = inventoryActiveCategories(_watcher.categories);
    final category = inventoryCategoryById(categories, _categoryFilter);
    // One store's count in place of the total, for staff tied to a store and
    // for anyone who has narrowed to one store.
    final viewItems = inventoryViewItems(
      _items,
      stores,
      _watcher.stock,
      storeFilter: _storeFilter,
    );
    final shown = inventoryListing(
      viewItems,
      query: _search.text,
      showArchived: _showArchived,
      categoryId: category?.id ?? '',
      categoryName: category?.name ?? '',
    );
    final searching = _search.text.trim().isNotEmpty;
    // The stored products by id (their total counts), once per build, for the
    // per-store line of someone who sees every store.
    final rawById = stores.viewerSeesAll && _storeFilter.isEmpty
        ? {for (final i in _items) i.id: i}
        : const <String, InventoryItem>{};
    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          InventoryHeader(
            title: l10n.inventoryTitle,
            actions: [
              IconButton(
                key: const Key('inv-open-categories'),
                tooltip: l10n.inventoryManageCategories,
                icon: const Icon(Icons.category_outlined),
                onPressed: () => _push(
                  InventoryCategoriesScreen(
                    businessId: widget.businessId,
                    source: _source,
                    service: widget.service,
                  ),
                ),
              ),
              if (widget.access.canManageStores)
                IconButton(
                  key: const Key('inv-open-stores'),
                  tooltip: l10n.inventoryStoresTitle,
                  icon: const Icon(Icons.storefront_outlined),
                  onPressed: () => _push(
                    InventoryStoresScreen(
                      businessId: widget.businessId,
                      source: _source,
                      service: widget.service,
                    ),
                  ),
                ),
            ],
          ),
          Expanded(
            child: ListView(
              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.lg,
                AppSpacing.md,
                AppSpacing.lg,
                AppSpacing.xl,
              ),
              children: [
                ContainerActionButton(
                  key: const Key('inv-open-sell'),
                  icon: Icons.qr_code_scanner,
                  label: l10n.inventorySell,
                  primary: true,
                  onTap: () => _push(
                    InventorySellScreen(
                      businessId: widget.businessId,
                      source: _source,
                      service: widget.service,
                      cameraEnabled: widget.cameraEnabled,
                      access: widget.access,
                    ),
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                Row(
                  children: [
                    Expanded(
                      child: ContainerActionButton(
                        key: const Key('inv-open-add'),
                        icon: Icons.add,
                        label: l10n.inventoryAddProduct,
                        onTap: _add,
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: ContainerActionButton(
                        key: const Key('inv-open-sales'),
                        icon: Icons.receipt_long_outlined,
                        label: l10n.inventorySalesTitle,
                        onTap: () => _push(
                          InventorySalesScreen(
                            businessId: widget.businessId,
                            source: _source,
                            service: widget.service,
                            access: widget.access,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.lg),
                if (stores.viewerSeesAll) ...[
                  InventoryChoiceChips(
                    keyPrefix: 'inv-store-filter',
                    options: inventoryStoreChoices(l10n, stores),
                    selected: _storeFilter,
                    onSelected: _setStoreFilter,
                  ),
                  const SizedBox(height: AppSpacing.md),
                ],
                if (stores.ownStoreId.isNotEmpty) ...[
                  Text(
                    l10n.inventoryStoreShowing(
                      stores.storeName(stores.ownStoreId),
                    ),
                    key: const Key('inv-list-store-home'),
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w600,
                      color: AppColors.ink,
                    ),
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
                _summaryCard(l10n, stores),
                const SizedBox(height: AppSpacing.lg),
                TextField(
                  key: const Key('inv-search'),
                  controller: _search,
                  autocorrect: false,
                  textInputAction: TextInputAction.search,
                  onChanged: (_) => setState(() {}),
                  decoration: InputDecoration(
                    hintText: l10n.inventorySearchHint,
                    prefixIcon: const Icon(
                      Icons.search,
                      size: 20,
                      color: AppColors.muted,
                    ),
                    suffixIcon: _search.text.isEmpty
                        ? null
                        : IconButton(
                            icon: const Icon(Icons.close, size: 18),
                            tooltip: l10n.cancel,
                            onPressed: () => setState(_search.clear),
                          ),
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                if (categories.isNotEmpty) ...[
                  InventoryChoiceChips(
                    keyPrefix: 'inv-category-filter',
                    options: [
                      (id: '', label: l10n.inventoryCategoryAll),
                      for (final c in categories) (id: c.id, label: c.name),
                    ],
                    selected: category?.id ?? '',
                    onSelected: (id) => setState(() => _categoryFilter = id),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                ],
                Align(
                  alignment: Alignment.centerLeft,
                  child: FilterChip(
                    key: const Key('inv-archived-toggle'),
                    label: Text(l10n.inventoryShowArchived),
                    selected: _showArchived,
                    onSelected: (v) => setState(() => _showArchived = v),
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                if (!_loaded)
                  const Padding(
                    padding: EdgeInsets.symmetric(vertical: AppSpacing.xl),
                    child: Center(child: CircularProgressIndicator()),
                  )
                else if (_failed && _items.isEmpty)
                  InventoryNote(
                    key: const Key('inv-load-failed'),
                    text: l10n.inventoryLoadFailed,
                  )
                else if (shown.isEmpty)
                  LotEmptyState(
                    key: const Key('inv-empty'),
                    icon: Icons.inventory_2_outlined,
                    title: searching
                        ? l10n.inventoryNoMatch
                        : (_showArchived
                              ? l10n.inventoryNoArchived
                              : l10n.inventoryNoProducts),
                    hint: searching || _showArchived
                        ? null
                        : l10n.inventoryNoProductsHint,
                  )
                else
                  for (final item in shown)
                    _ItemRow(
                      key: ValueKey('inv-item-${item.id}'),
                      item: item,
                      stores: stores,
                      allStores: rawById[item.id] == null
                          ? null
                          : inventoryStockView(
                              rawById[item.id]!,
                              stores,
                              _watcher.stock,
                            ),
                      onTap: () => _openItem(item.id),
                    ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _summaryCard(AppLocalizations l10n, InventoryStoreContext stores) {
    final summary = _summary;
    return Container(
      key: const Key('inv-summary'),
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
            children: [
              Expanded(
                child: Text(
                  l10n.inventoryTodayTitle,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
              ),
              if (_summaryLoading)
                const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          if (summary == null && _summaryFailed)
            InventoryNote(
              key: const Key('inv-summary-error'),
              text: l10n.inventorySummaryUnavailable,
              trailing: TextButton(
                key: const Key('inv-summary-retry'),
                onPressed: _loadSummary,
                child: Text(l10n.retry),
              ),
            )
          else if (summary != null) ...[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: InventoryFigure(
                    value: '${summary.salesCount}',
                    label: l10n.inventorySalesCount(summary.salesCount),
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: InventoryFigure(
                    value: formatLotCents(summary.revenueCents),
                    label: l10n.inventoryRevenue,
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: InventoryFigure(
                    value: formatLotCents(summary.profitCents),
                    label: l10n.inventoryProfit,
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(
              [
                l10n.inventoryItemsSoldCount(summary.itemsSold),
                if (summary.discountCents > 0)
                  '${l10n.inventoryDiscounts}: ${formatLotCents(summary.discountCents)}',
              ].join(' · '),
              key: const Key('inv-summary-detail'),
              style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
            ),
            if (summary.byCategory.isNotEmpty) ...[
              const SizedBox(height: AppSpacing.md),
              _sectionLabel(l10n.inventoryByCategoryTitle),
              for (final row in summary.byCategory)
                _MoneyRow(
                  key: ValueKey(
                    'inv-bycat-${row.categoryId.isEmpty ? 'none' : row.categoryId}',
                  ),
                  name: row.name.isEmpty
                      ? l10n.inventoryCategoryUncategorized
                      : row.name,
                  money: formatLotCents(row.revenueCents),
                  detail: [
                    l10n.inventoryItemsSoldCount(row.itemsSold),
                    '${l10n.inventoryProfit} ${formatLotCents(row.profitCents)}',
                  ].join(' · '),
                ),
            ],
            if (stores.viewerSeesAll && summary.byStore.isNotEmpty) ...[
              const SizedBox(height: AppSpacing.md),
              _sectionLabel(l10n.inventoryByStoreTitle),
              for (final row in summary.byStore)
                _MoneyRow(
                  key: ValueKey('inv-bystore-${row.storeId}'),
                  name: row.name.isEmpty
                      ? stores.storeName(row.storeId)
                      : row.name,
                  money: formatLotCents(row.revenueCents),
                  detail: [
                    l10n.inventorySalesCount(row.salesCount),
                    l10n.inventoryItemsSoldCount(row.itemsSold),
                    '${l10n.inventoryProfit} ${formatLotCents(row.profitCents)}',
                  ].join(' · '),
                ),
            ],
            if (summary.low.isNotEmpty) ...[
              const SizedBox(height: AppSpacing.md),
              _sectionLabel(l10n.inventoryLowStockTitle),
              for (final row in summary.low)
                _AttentionRow(
                  key: ValueKey(
                    'inv-low-${row.itemId}${row.storeId.isEmpty ? '' : '-${row.storeId}'}',
                  ),
                  name: _lowName(stores, row),
                  trailing: l10n.inventoryInStockCount(row.quantity),
                  color: row.quantity <= 0
                      ? AppColors.errorRed
                      : AppColors.warn,
                  onTap: () => _openItem(row.itemId),
                ),
            ],
            if (summary.countWasOff.isNotEmpty) ...[
              const SizedBox(height: AppSpacing.md),
              _sectionLabel(l10n.inventoryCountOffTitle),
              for (final row in summary.countWasOff)
                _AttentionRow(
                  key: ValueKey('inv-off-${row.itemId}'),
                  name: row.name,
                  trailing: '',
                  color: AppColors.warn,
                  onTap: () => _openItem(row.itemId),
                ),
            ],
          ],
        ],
      ),
    );
  }

  /// A low-stock row's name, with its store when the business has several.
  String _lowName(InventoryStoreContext stores, InventoryLowStock row) {
    if (!stores.multi) return row.name;
    final store = row.storeName.isNotEmpty
        ? row.storeName
        : stores.storeName(row.storeId);
    return store.isEmpty ? row.name : '${row.name} · $store';
  }

  Widget _sectionLabel(String text) => Padding(
    padding: const EdgeInsets.only(bottom: 4),
    child: Text(
      text,
      style: const TextStyle(
        fontSize: 11,
        fontWeight: FontWeight.w700,
        letterSpacing: 0.4,
        color: AppColors.muted,
      ),
    ),
  );
}

class _AttentionRow extends StatelessWidget {
  const _AttentionRow({
    super.key,
    required this.name,
    required this.trailing,
    required this.color,
    required this.onTap,
  });

  final String name;
  final String trailing;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return PressableScale(
      onTap: onTap,
      scale: 0.99,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 6),
        child: Row(
          children: [
            Icon(Icons.circle, size: 8, color: color),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Text(
                name,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 14, color: AppColors.ink),
              ),
            ),
            if (trailing.isNotEmpty) ...[
              const SizedBox(width: AppSpacing.sm),
              Text(
                trailing,
                style: TextStyle(
                  fontSize: 12.5,
                  fontWeight: FontWeight.w600,
                  color: color,
                ),
              ),
            ],
            const Icon(Icons.chevron_right, size: 18, color: AppColors.muted),
          ],
        ),
      ),
    );
  }
}

/// A line of a money block: a name, what it brought in, and a small detail.
class _MoneyRow extends StatelessWidget {
  const _MoneyRow({
    super.key,
    required this.name,
    required this.money,
    required this.detail,
  });

  final String name;
  final String money;
  final String detail;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 5),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: AppColors.ink,
                  ),
                ),
                Text(
                  detail,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 12, color: AppColors.muted),
                ),
              ],
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          Text(
            money,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: AppColors.ink,
            ),
          ),
        ],
      ),
    );
  }
}

class _ItemRow extends StatelessWidget {
  const _ItemRow({
    super.key,
    required this.item,
    required this.stores,
    required this.onTap,
    this.allStores,
  });

  /// The product as this person reads it (one store's count in place of the
  /// total when they work in one store).
  final InventoryItem item;
  final InventoryStoreContext stores;

  /// For someone who sees every store: each store's count and where it is low.
  final InventoryItemStockView? allStores;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final perStore = allStores != null && stores.viewerSeesAll
        ? [
            for (final row in allStores!.perStore)
              '${stores.storeName(row.storeId)} ${row.quantity}',
          ].join(' · ')
        : '';
    final lowAt = allStores?.lowStoreIds ?? const <String>[];
    return PressableScale(
      onTap: onTap,
      scale: 0.985,
      child: Container(
        margin: const EdgeInsets.only(bottom: AppSpacing.sm),
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.paper,
          borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          border: Border.all(
            color: item.needsAttention
                ? AppColors.warn.withValues(alpha: 0.5)
                : AppColors.rule,
          ),
        ),
        child: Row(
          children: [
            InventoryPhoto(url: item.photoUrl),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    item.name,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      color: AppColors.ink,
                    ),
                  ),
                  Text(
                    [
                      item.code,
                      if (item.category.isNotEmpty) item.category,
                    ].join(' · '),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 12,
                      color: AppColors.muted,
                    ),
                  ),
                  const SizedBox(height: 4),
                  InventoryStatusChips(item: item),
                  if (lowAt.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Wrap(
                        spacing: 6,
                        runSpacing: 4,
                        children: [
                          for (final id in lowAt)
                            InventoryChip(
                              key: Key('inv-row-low-${item.id}-$id'),
                              label: l10n.inventoryStoreLowAt(
                                stores.storeName(id),
                              ),
                              color: AppColors.warn,
                            ),
                        ],
                      ),
                    ),
                  if (perStore.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(
                        perStore,
                        key: Key('inv-row-stores-${item.id}'),
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppColors.muted,
                        ),
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(
                  formatLotCents(item.priceCents),
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
                Text(
                  l10n.inventoryInStockCount(item.quantity),
                  style: const TextStyle(fontSize: 12, color: AppColors.muted),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
