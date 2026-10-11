import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/inventory.dart';
import '../services/inventory_service.dart';
import '../services/lot_ledger.dart' show formatLotCents;
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/inventory_widgets.dart';
import '../widgets/lot_sheets.dart';
import 'containers_screen.dart' show ContainerActionButton;
import 'inventory_item_screen.dart';
import 'inventory_item_sheets.dart';
import 'inventory_sales_screen.dart';
import 'inventory_sell_screen.dart';

/// The shop's inventory: today's numbers, what is running low, and the
/// products with search - low stock first. From here staff add a product, open
/// one (stock, tags, history), start a sale, or see the sales.
class InventoryScreen extends StatefulWidget {
  const InventoryScreen({
    super.key,
    required this.businessId,
    this.source,
    this.service = const InventoryService(),
    this.tagOpener = openInventoryTags,
    this.cameraEnabled = true,
  });

  final String businessId;
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
  late final InventorySource _source = widget.source ?? FirestoreInventorySource();
  final List<StreamSubscription<Object?>> _subs = [];
  final TextEditingController _search = TextEditingController();
  Timer? _safety;

  List<InventoryItem> _items = const [];
  bool _loaded = false;
  bool _failed = false;
  bool _showArchived = false;

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
    _subs.add(_source.watchItems(widget.businessId).listen((items) {
      if (!mounted) return;
      _safety?.cancel();
      setState(() {
        _items = items;
        _loaded = true;
        _failed = false;
      });
    }, onError: (_) {
      if (!mounted) return;
      _safety?.cancel();
      setState(() {
        _loaded = true;
        _failed = true;
      });
    }));
    unawaited(_loadSummary());
  }

  @override
  void dispose() {
    _safety?.cancel();
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
          .summary(widget.businessId)
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
    await Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => screen));
    // A sale, a void or a stock change moved today's numbers.
    if (mounted) unawaited(_loadSummary());
  }

  void _openItem(String itemId) => _push(InventoryItemScreen(
        businessId: widget.businessId,
        itemId: itemId,
        source: _source,
        service: widget.service,
        tagOpener: widget.tagOpener,
      ));

  Future<void> _add() async {
    final l10n = AppLocalizations.of(context)!;
    final saved = await showInventoryItemForm(
      context,
      businessId: widget.businessId,
      service: widget.service,
    );
    if (saved == true && mounted) {
      showSuccessSnackBar(context, l10n.inventoryProductAdded);
      unawaited(_loadSummary());
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final shown = inventoryListing(
      _items,
      query: _search.text,
      showArchived: _showArchived,
    );
    final searching = _search.text.trim().isNotEmpty;
    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          InventoryHeader(title: l10n.inventoryTitle),
          Expanded(
            child: ListView(
              keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
              padding: const EdgeInsets.fromLTRB(
                  AppSpacing.lg, AppSpacing.md, AppSpacing.lg, AppSpacing.xl),
              children: [
                ContainerActionButton(
                  key: const Key('inv-open-sell'),
                  icon: Icons.qr_code_scanner,
                  label: l10n.inventorySell,
                  primary: true,
                  onTap: () => _push(InventorySellScreen(
                    businessId: widget.businessId,
                    source: _source,
                    service: widget.service,
                    cameraEnabled: widget.cameraEnabled,
                  )),
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
                        onTap: () => _push(InventorySalesScreen(
                          businessId: widget.businessId,
                          source: _source,
                          service: widget.service,
                        )),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.lg),
                _summaryCard(l10n),
                const SizedBox(height: AppSpacing.lg),
                TextField(
                  key: const Key('inv-search'),
                  controller: _search,
                  autocorrect: false,
                  textInputAction: TextInputAction.search,
                  onChanged: (_) => setState(() {}),
                  decoration: InputDecoration(
                    hintText: l10n.inventorySearchHint,
                    prefixIcon: const Icon(Icons.search,
                        size: 20, color: AppColors.muted),
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
                      onTap: () => _openItem(item.id),
                    ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _summaryCard(AppLocalizations l10n) {
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
            if (summary.low.isNotEmpty) ...[
              const SizedBox(height: AppSpacing.md),
              _sectionLabel(l10n.inventoryLowStockTitle),
              for (final row in summary.low)
                _AttentionRow(
                  key: ValueKey('inv-low-${row.itemId}'),
                  name: row.name,
                  trailing: l10n.inventoryInStockCount(row.quantity),
                  color: row.quantity <= 0 ? AppColors.errorRed : AppColors.warn,
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
              Text(trailing,
                  style: TextStyle(
                      fontSize: 12.5, fontWeight: FontWeight.w600, color: color)),
            ],
            const Icon(Icons.chevron_right, size: 18, color: AppColors.muted),
          ],
        ),
      ),
    );
  }
}

class _ItemRow extends StatelessWidget {
  const _ItemRow({super.key, required this.item, required this.onTap});

  final InventoryItem item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
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
                    style: const TextStyle(fontSize: 12, color: AppColors.muted),
                  ),
                  const SizedBox(height: 4),
                  InventoryStatusChips(item: item),
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
