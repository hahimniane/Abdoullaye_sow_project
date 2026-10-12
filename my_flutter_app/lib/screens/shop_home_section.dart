import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/inventory.dart';
import '../services/inventory_context.dart';
import '../services/inventory_service.dart';
import '../services/inventory_stores.dart';
import '../services/lot_ledger.dart' show LotStaff, formatLotCents;
import '../services/shop_home.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/date_display.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/inventory_widgets.dart';
import '../widgets/lot_sheets.dart';
import 'inventory_item_screen.dart';
import 'inventory_item_sheets.dart';
import 'inventory_sales_screen.dart';
import 'inventory_screen.dart';
import 'inventory_sell_screen.dart';

/// The top of the business home for someone who sells at a counter.
///
/// A shop opens the app to sell, so Sell is the first and loudest thing on
/// the screen - one tap from the top, no scrolling - with the way in for a tag
/// that will not scan right under it. Then what the day looks like (sales and
/// money, from the same server summary the Inventory screen reads), the four
/// places a shop goes, and today's sales.
///
/// Nothing here blocks Sell: the numbers and the list load on their own and
/// show a quiet placeholder until they answer, or a dash if they cannot.
/// Every read is opened in [State.initState] (never in build) and is the
/// same business-scoped query the Inventory screens use.
class ShopHomeSection extends StatefulWidget {
  const ShopHomeSection({
    super.key,
    required this.businessId,
    required this.access,
    this.businessName = '',
    this.headerLeading,
    this.headerActions,
    this.approvalStatus,
    this.showTodaySales = true,
    this.source,
    this.service = const InventoryService(),
    this.tagOpener = openInventoryTags,
    this.cameraEnabled = true,
    this.clock = DateTime.now,
  });

  final String businessId;

  /// Where the person works in Inventory: it decides which store a sale goes
  /// to (the sell screen applies it exactly as from the Inventory screen) and
  /// which sales they may read.
  final InventoryAccess access;
  final String businessName;

  /// Beside the business name: a back button when the home was pushed, and
  /// the bell and language switch. The name shares their row, so Sell sits a
  /// whole row higher on the screen.
  final Widget? headerLeading;
  final Widget? headerActions;

  /// The business's review state when it is not yet approved ('pending',
  /// 'changes_requested'), shown as a small note; null or 'approved' shows
  /// nothing. Only handed in for a shop-only business - everyone else keeps
  /// the full-width banner.
  final String? approvalStatus;

  /// Today's sales list. Off when the business also runs other services: its
  /// own activity feed follows below.
  final bool showTodaySales;
  final InventorySource? source;
  final InventoryService service;
  final InventoryTagOpener tagOpener;

  /// Off in widget tests, where there is no camera plugin.
  @visibleForTesting
  final bool cameraEnabled;
  final DateTime Function() clock;

  @override
  State<ShopHomeSection> createState() => _ShopHomeSectionState();
}

class _ShopHomeSectionState extends State<ShopHomeSection> {
  late final InventorySource _source =
      widget.source ?? FirestoreInventorySource();

  InventoryContextWatcher? _watcher;
  StreamSubscription<Object?>? _salesSub;
  StreamSubscription<Object?>? _staffSub;
  Timer? _salesSafety;
  String? _salesKey;

  InventorySummary? _summary;
  bool _summaryLoading = true;
  bool _summaryFailed = false;
  int _summaryTicket = 0;

  List<InventorySale> _sales = const [];
  bool _salesLoaded = false;
  bool _salesFailed = false;
  String? _salesSignature;
  List<LotStaff> _staff = const [];

  InventoryStoreContext get _stores =>
      _watcher?.context ?? InventoryStoreContext.single;

  @override
  void initState() {
    super.initState();
    _start();
  }

  @override
  void didUpdateWidget(ShopHomeSection oldWidget) {
    super.didUpdateWidget(oldWidget);
    final a = oldWidget.access;
    final b = widget.access;
    // The owner can move a staff member to another store at any time; the
    // home follows without a restart, reading that store's sales instead.
    if (oldWidget.businessId != widget.businessId ||
        a.isOwner != b.isOwner ||
        a.allStores != b.allStores ||
        a.homeStoreId != b.homeStoreId) {
      _stop();
      _start();
    }
  }

  @override
  void dispose() {
    _stop();
    super.dispose();
  }

  void _start() {
    _salesKey = null;
    _salesSignature = null;
    _salesLoaded = false;
    _salesFailed = false;
    _sales = const [];
    // The list always resolves, even if the stores or the sales never answer.
    _salesSafety = Timer(const Duration(seconds: 15), () {
      if (mounted && !_salesLoaded) setState(() => _salesLoaded = true);
    });
    _watcher = InventoryContextWatcher(
      source: _source,
      businessId: widget.businessId,
      access: widget.access,
      onChange: () {
        if (!mounted) return;
        setState(() {});
        _listenSales();
      },
    )..start();
    _staffSub = _source.watchStaff(widget.businessId).listen(
      (staff) {
        if (mounted) setState(() => _staff = staff);
      },
      // No permission to read the team: the "who" stays blank.
      onError: (_) {},
    );
    _listenSales();
    unawaited(_loadSummary());
  }

  void _stop() {
    _salesSafety?.cancel();
    _salesSub?.cancel();
    _salesSub = null;
    _staffSub?.cancel();
    _staffSub = null;
    _watcher?.dispose();
    _watcher = null;
    _summaryTicket++;
  }

  /// Today's sales, as the person may read them: every store's, or their own
  /// store's once the stores are known (the same scope as the sales screen).
  void _listenSales() {
    final watcher = _watcher;
    if (watcher == null) return;
    final scope = inventorySalesScope(
      widget.access,
      watcher.context,
      storesLoaded: watcher.storesLoaded,
    );
    if (!scope.ready) return;
    final key = scope.none ? '!' : scope.storeId;
    if (key == _salesKey) return;
    _salesKey = key;
    _salesSub?.cancel();
    _salesSub = null;
    if (scope.none) {
      _salesSafety?.cancel();
      setState(() {
        _sales = const [];
        _salesLoaded = true;
      });
      return;
    }
    _salesSub = _source
        .watchSales(
          widget.businessId,
          limit: shopHomeRecentSalesRead,
          storeId: scope.storeId,
        )
        .listen(
          (sales) {
            if (!mounted) return;
            _salesSafety?.cancel();
            final signature = inventorySalesSignature(sales);
            final changed =
                _salesSignature != null && signature != _salesSignature;
            _salesSignature = signature;
            setState(() {
              _sales = sales;
              _salesLoaded = true;
              _salesFailed = false;
            });
            // A sale made from the bottom bar or voided on the sales screen
            // moves today's numbers: read them again.
            if (changed) unawaited(_loadSummary());
          },
          onError: (_) {
            if (!mounted) return;
            _salesSafety?.cancel();
            setState(() {
              _salesLoaded = true;
              _salesFailed = true;
            });
          },
        );
  }

  Future<void> _loadSummary() async {
    final ticket = ++_summaryTicket;
    if (mounted) {
      setState(() {
        _summaryLoading = true;
        _summaryFailed = false;
      });
    }
    try {
      // Blank store: the owner's whole business, or - for staff - the server
      // narrows it to their own store, exactly as on the Inventory screen.
      final summary = await widget.service
          .summary(widget.businessId)
          .timeout(const Duration(seconds: 20));
      if (!mounted || ticket != _summaryTicket) return;
      setState(() {
        _summary = summary;
        _summaryLoading = false;
      });
    } catch (_) {
      if (!mounted || ticket != _summaryTicket) return;
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

  void _openSell({bool search = false}) => _push(
    InventorySellScreen(
      businessId: widget.businessId,
      source: _source,
      service: widget.service,
      access: widget.access,
      cameraEnabled: widget.cameraEnabled,
      startWithSearch: search,
    ),
  );

  void _openProducts() => _push(
    InventoryScreen(
      businessId: widget.businessId,
      source: _source,
      service: widget.service,
      tagOpener: widget.tagOpener,
      cameraEnabled: widget.cameraEnabled,
      access: widget.access,
    ),
  );

  void _openSales() => _push(
    InventorySalesScreen(
      businessId: widget.businessId,
      source: _source,
      service: widget.service,
      access: widget.access,
    ),
  );

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

  Future<void> _addProduct() async {
    final l10n = AppLocalizations.of(context)!;
    final watcher = _watcher;
    final saved = await showInventoryItemForm(
      context,
      businessId: widget.businessId,
      service: widget.service,
      categories: watcher?.categories ?? const [],
      brands: watcher?.brands ?? const [],
      stores: _stores,
    );
    if (saved == true && mounted) {
      showSuccessSnackBar(context, l10n.inventoryProductAdded);
      unawaited(_loadSummary());
    }
  }

  Future<void> _showLowStock() async {
    final l10n = AppLocalizations.of(context)!;
    final rows = _summary?.low ?? const <InventoryLowStock>[];
    final stores = _stores;
    final itemId = await showLotSheet<String>(
      context,
      LotSheetShell(
        title: l10n.inventoryLowStockTitle,
        body: rows.isEmpty
            ? Padding(
                padding: const EdgeInsets.symmetric(vertical: AppSpacing.lg),
                child: Text(
                  l10n.shopHomeLowNone,
                  key: const Key('shop-low-none'),
                  style: const TextStyle(fontSize: 14, color: AppColors.muted),
                ),
              )
            : Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  for (final row in rows)
                    Builder(
                      builder: (sheetContext) => _LowStockRow(
                        key: ValueKey(
                          'shop-low-${row.itemId}'
                          '${row.storeId.isEmpty ? '' : '-${row.storeId}'}',
                        ),
                        name: _lowName(stores, row),
                        trailing: l10n.inventoryInStockCount(row.quantity),
                        out: row.quantity <= 0,
                        onTap: () => Navigator.of(sheetContext).pop(row.itemId),
                      ),
                    ),
                ],
              ),
      ),
    );
    if (itemId != null && mounted) _openItem(itemId);
  }

  String _lowName(InventoryStoreContext stores, InventoryLowStock row) {
    if (!stores.multi) return row.name;
    final store = row.storeName.isNotEmpty
        ? row.storeName
        : stores.storeName(row.storeId);
    return store.isEmpty ? row.name : '${row.name} · $store';
  }

  /// The line under the business name: where this person sells from, in a
  /// business with several stores.
  String _storeLine(AppLocalizations l10n) {
    final stores = _stores;
    if (!stores.multi) return '';
    final sell = inventorySellStore(stores);
    return switch (sell.mode) {
      InventorySellStoreMode.home => l10n.inventoryStoreSellingFrom(
        stores.storeName(sell.defaultStoreId),
      ),
      InventorySellStoreMode.pick => l10n.inventoryStoreFilterAll,
      InventorySellStoreMode.missing => l10n.inventoryStoreHomeRequired,
      InventorySellStoreMode.single => '',
    };
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final storeLine = _storeLine(l10n);
    final status = widget.approvalStatus;
    final summary = _summary;
    final lowCount = summary?.low.length;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        _Header(
          leading: widget.headerLeading,
          actions: widget.headerActions,
          businessName: widget.businessName.trim(),
          storeLine: storeLine,
        ),
        if (status != null && status != 'approved') ...[
          const SizedBox(height: AppSpacing.sm),
          Align(
            alignment: Alignment.centerLeft,
            child: ShopApprovalNote(status: status),
          ),
        ],
        const SizedBox(height: AppSpacing.lg),
        ShopSellButton(onTap: () => _openSell()),
        const SizedBox(height: AppSpacing.sm),
        _SecondaryAction(
          key: const Key('shop-enter-code'),
          icon: Icons.keyboard_outlined,
          label: l10n.shopHomeEnterCode,
          onTap: () => _openSell(search: true),
        ),
        const SizedBox(height: AppSpacing.lg),
        _TodayCard(
          l10n: l10n,
          summary: summary,
          loading: _summaryLoading && summary == null,
          failed: _summaryFailed && summary == null,
          onRetry: _loadSummary,
        ),
        const SizedBox(height: AppSpacing.lg),
        _QuickLinks(
          tiles: [
            _QuickLink(
              tileKey: const Key('shop-open-products'),
              icon: Icons.inventory_2_outlined,
              title: l10n.shopHomeProducts,
              caption: l10n.shopHomeProductsHint,
              onTap: _openProducts,
            ),
            _QuickLink(
              tileKey: const Key('shop-open-sales'),
              icon: Icons.receipt_long_outlined,
              title: l10n.inventorySalesTitle,
              caption: l10n.shopHomeSalesHint,
              onTap: _openSales,
            ),
            _QuickLink(
              tileKey: const Key('shop-open-low'),
              icon: Icons.trending_down_rounded,
              title: l10n.inventoryLowStockTitle,
              // Until the numbers answer, a count would be a guess.
              caption: lowCount == null ? '—' : l10n.shopHomeLowCount(lowCount),
              badge: lowCount != null && lowCount > 0 ? '$lowCount' : null,
              onTap: _showLowStock,
            ),
            _QuickLink(
              tileKey: const Key('shop-add-product'),
              icon: Icons.add_box_outlined,
              title: l10n.inventoryAddProduct,
              caption: l10n.shopHomeAddHint,
              onTap: _addProduct,
            ),
          ],
        ),
        if (widget.showTodaySales) ...[
          const SizedBox(height: AppSpacing.xl),
          _TodaySales(
            l10n: l10n,
            sales: inventorySalesToday(_sales, widget.clock()),
            loaded: _salesLoaded,
            failed: _salesFailed,
            staff: _staff,
            stores: _stores,
            onSeeAll: _openSales,
          ),
        ],
      ],
    );
  }
}

/// The business name with where the person sells from under it, sharing a
/// row with the screen's own controls.
class _Header extends StatelessWidget {
  const _Header({
    required this.leading,
    required this.actions,
    required this.businessName,
    required this.storeLine,
  });

  final Widget? leading;
  final Widget? actions;
  final String businessName;
  final String storeLine;

  @override
  Widget build(BuildContext context) {
    return ConstrainedBox(
      constraints: const BoxConstraints(minHeight: 48),
      child: Row(
        children: [
          ?leading,
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                if (businessName.isNotEmpty)
                  Text(
                    businessName,
                    key: const Key('shop-business-name'),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 22,
                      height: 1.2,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -0.4,
                      color: AppColors.ink,
                    ),
                  ),
                if (storeLine.isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Row(
                    key: const Key('shop-store-line'),
                    children: [
                      const Icon(
                        Icons.storefront_outlined,
                        size: 15,
                        color: AppColors.muted,
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          storeLine,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            fontSize: 13,
                            height: 1.3,
                            fontWeight: FontWeight.w600,
                            color: AppColors.muted,
                          ),
                        ),
                      ),
                    ],
                  ),
                ],
              ],
            ),
          ),
          ?actions,
        ],
      ),
    );
  }
}

/// The business's review state, small and calm. A shop can sell and manage
/// its stock while it waits, so this is a note, not a warning across the top
/// of every tab.
class ShopApprovalNote extends StatelessWidget {
  const ShopApprovalNote({super.key, required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final text = status == 'changes_requested'
        ? l10n.shopHomeChangesNote
        : l10n.shopHomePendingNote;
    return Container(
      key: const Key('shop-approval-note'),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
      decoration: BoxDecoration(
        color: AppColors.saffron.withValues(alpha: 0.10),
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.saffron.withValues(alpha: 0.35)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Icon(
            Icons.hourglass_top_rounded,
            size: 14,
            color: AppColors.warn,
          ),
          const SizedBox(width: 6),
          Flexible(
            child: Text(
              text,
              style: const TextStyle(
                fontSize: 12.5,
                height: 1.3,
                fontWeight: FontWeight.w600,
                color: AppColors.ink,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Sell: the one thing on the home that is filled with the brand colour.
/// Big enough to hit without looking (at least 72 high, full width), and it
/// opens the counter straight away.
class ShopSellButton extends StatelessWidget {
  const ShopSellButton({super.key, required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    void sell() {
      AppHaptics.commit();
      onTap();
    }

    return Semantics(
      button: true,
      label: '${l10n.inventorySell}. ${l10n.shopHomeSellSubtitle}',
      excludeSemantics: true,
      onTap: sell,
      child: PressableScale(
        key: const Key('shop-sell'),
        scale: 0.98,
        onTap: sell,
        child: Container(
          constraints: const BoxConstraints(minHeight: 80),
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.lg,
            vertical: AppSpacing.md,
          ),
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [AppColors.cobalt, AppColors.cobaltDeep],
            ),
            borderRadius: BorderRadius.circular(14),
            boxShadow: [
              BoxShadow(
                color: AppColors.cobaltDeep.withValues(alpha: 0.28),
                blurRadius: 18,
                spreadRadius: -4,
                offset: const Offset(0, 10),
              ),
            ],
          ),
          child: Row(
            children: [
              Container(
                width: 52,
                height: 52,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: Colors.white.withValues(alpha: 0.16),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: const Icon(
                  Icons.qr_code_scanner_rounded,
                  color: Colors.white,
                  size: 28,
                ),
              ),
              const SizedBox(width: AppSpacing.lg),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      l10n.inventorySell,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 22,
                        height: 1.15,
                        fontWeight: FontWeight.w800,
                        letterSpacing: -0.3,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      l10n.shopHomeSellSubtitle,
                      style: TextStyle(
                        color: Colors.white.withValues(alpha: 0.86),
                        fontSize: 13.5,
                        height: 1.3,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              const Icon(
                Icons.arrow_forward_rounded,
                color: Colors.white,
                size: 24,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SecondaryAction extends StatelessWidget {
  const _SecondaryAction({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: label,
      excludeSemantics: true,
      onTap: onTap,
      child: Material(
        color: AppColors.paper,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: const BorderSide(color: AppColors.rule),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 52),
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.lg,
                vertical: AppSpacing.sm,
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(icon, size: 20, color: AppColors.cobaltDeep),
                  const SizedBox(width: AppSpacing.sm),
                  Flexible(
                    child: Text(
                      label,
                      textAlign: TextAlign.center,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: AppColors.ink,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Today in two numbers: how many sales and how much money.
class _TodayCard extends StatelessWidget {
  const _TodayCard({
    required this.l10n,
    required this.summary,
    required this.loading,
    required this.failed,
    required this.onRetry,
  });

  final AppLocalizations l10n;
  final InventorySummary? summary;
  final bool loading;
  final bool failed;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final s = summary;
    return Container(
      key: const Key('shop-today'),
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.md,
        AppSpacing.lg,
        AppSpacing.lg,
      ),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(12),
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
                    fontSize: 13,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.2,
                    color: AppColors.muted,
                  ),
                ),
              ),
              if (failed)
                TextButton.icon(
                  key: const Key('shop-today-retry'),
                  onPressed: onRetry,
                  style: TextButton.styleFrom(
                    minimumSize: const Size(48, 40),
                    visualDensity: VisualDensity.compact,
                  ),
                  icon: const Icon(Icons.refresh, size: 16),
                  label: Text(l10n.retry),
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Expanded(
                  child: _Figure(
                    figureKey: const Key('shop-today-count'),
                    value: s == null ? null : '${s.salesCount}',
                    label: l10n.shopHomeSalesLabel(s?.salesCount ?? 0),
                    loading: loading,
                    quiet: s == null || s.salesCount == 0,
                  ),
                ),
                const VerticalDivider(
                  width: AppSpacing.xl,
                  thickness: 1,
                  color: AppColors.rule,
                ),
                Expanded(
                  child: _Figure(
                    figureKey: const Key('shop-today-revenue'),
                    value: s == null ? null : formatLotCents(s.revenueCents),
                    label: l10n.inventoryRevenue,
                    loading: loading,
                    quiet: s == null || s.revenueCents == 0,
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

class _Figure extends StatelessWidget {
  const _Figure({
    required this.figureKey,
    required this.value,
    required this.label,
    required this.loading,
    required this.quiet,
  });

  final Key figureKey;
  final String? value;
  final String label;
  final bool loading;

  /// Nothing yet (a dash, or zero): not news, so it does not shout.
  final bool quiet;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        SizedBox(
          height: 34,
          child: loading
              // A placeholder the size of the number, not a spinner: the
              // numbers are a glance, never something to wait for.
              ? Align(
                  alignment: Alignment.centerLeft,
                  child: Container(
                    key: figureKey,
                    width: 72,
                    height: 22,
                    decoration: BoxDecoration(
                      color: AppColors.parchment,
                      borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                    ),
                  ),
                )
              : FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text(
                    value ?? '—',
                    key: figureKey,
                    style: TextStyle(
                      fontSize: 28,
                      height: 1.15,
                      fontWeight: FontWeight.w800,
                      letterSpacing: -0.5,
                      color: quiet ? AppColors.muted : AppColors.ink,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
                  ),
                ),
        ),
        const SizedBox(height: 2),
        Text(
          label,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
            fontSize: 12.5,
            height: 1.3,
            color: AppColors.muted,
          ),
        ),
      ],
    );
  }
}

class _QuickLink {
  const _QuickLink({
    required this.tileKey,
    required this.icon,
    required this.title,
    required this.caption,
    required this.onTap,
    this.badge,
  });

  final Key tileKey;
  final IconData icon;
  final String title;
  final String caption;
  final VoidCallback onTap;

  /// A count that needs attention (running-low products), shown in amber.
  final String? badge;
}

/// The places a shop goes, two to a row, each row as tall as its tallest
/// tile so longer French captions never clip.
class _QuickLinks extends StatelessWidget {
  const _QuickLinks({required this.tiles});

  final List<_QuickLink> tiles;

  @override
  Widget build(BuildContext context) {
    final rows = <Widget>[];
    for (var i = 0; i < tiles.length; i += 2) {
      if (i > 0) rows.add(const SizedBox(height: AppSpacing.md));
      rows.add(
        IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(child: _QuickLinkTile(link: tiles[i])),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: i + 1 < tiles.length
                    ? _QuickLinkTile(link: tiles[i + 1])
                    : const SizedBox.shrink(),
              ),
            ],
          ),
        ),
      );
    }
    return Column(
      key: const Key('shop-quick-links'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: rows,
    );
  }
}

class _QuickLinkTile extends StatelessWidget {
  const _QuickLinkTile({required this.link});

  final _QuickLink link;

  @override
  Widget build(BuildContext context) {
    final attention = link.badge != null;
    return Semantics(
      button: true,
      label: '${link.title}, ${link.caption}',
      excludeSemantics: true,
      onTap: link.onTap,
      child: Material(
        key: link.tileKey,
        color: AppColors.paper,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: const BorderSide(color: AppColors.rule),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: link.onTap,
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 104),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        width: 40,
                        height: 40,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: attention
                              ? AppColors.saffron.withValues(alpha: 0.14)
                              : AppColors.mist.withValues(alpha: 0.7),
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: Icon(
                          link.icon,
                          size: 22,
                          color: attention
                              ? AppColors.warn
                              : AppColors.cobaltDeep,
                        ),
                      ),
                      const Spacer(),
                      if (attention)
                        Container(
                          constraints: const BoxConstraints(minWidth: 26),
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 3,
                          ),
                          decoration: BoxDecoration(
                            color: AppColors.warn,
                            borderRadius: BorderRadius.circular(999),
                          ),
                          child: Text(
                            link.badge!,
                            textAlign: TextAlign.center,
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 12,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: AppSpacing.md),
                  Text(
                    link.title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 15,
                      height: 1.25,
                      fontWeight: FontWeight.w700,
                      letterSpacing: -0.1,
                      color: AppColors.ink,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    link.caption,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 12.5,
                      height: 1.3,
                      fontWeight: attention ? FontWeight.w700 : FontWeight.w400,
                      color: attention ? AppColors.warn : AppColors.muted,
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// Today's sales: what went, for how much, when and by whom.
class _TodaySales extends StatelessWidget {
  const _TodaySales({
    required this.l10n,
    required this.sales,
    required this.loaded,
    required this.failed,
    required this.staff,
    required this.stores,
    required this.onSeeAll,
  });

  final AppLocalizations l10n;
  final List<InventorySale> sales;
  final bool loaded;
  final bool failed;
  final List<LotStaff> staff;
  final InventoryStoreContext stores;
  final VoidCallback onSeeAll;

  @override
  Widget build(BuildContext context) {
    final locale = dateLocaleOf(context);
    Widget body;
    if (!loaded) {
      body = Column(
        key: const Key('shop-sales-loading'),
        children: [
          for (var i = 0; i < 2; i++) ...[
            if (i > 0) const Divider(height: 1, indent: 68),
            const _SaleRowPlaceholder(),
          ],
        ],
      );
    } else if (sales.isEmpty) {
      body = Padding(
        key: const Key('shop-sales-empty'),
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.xl,
          vertical: AppSpacing.xl,
        ),
        child: Column(
          children: [
            Container(
              width: 44,
              height: 44,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: AppColors.mist.withValues(alpha: 0.7),
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.qr_code_2_rounded,
                color: AppColors.cobaltDeep,
                size: 22,
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            Text(
              failed
                  ? l10n.inventorySalesLoadFailed
                  : l10n.shopHomeNoSalesToday,
              textAlign: TextAlign.center,
              style: const TextStyle(
                fontSize: 14,
                height: 1.4,
                color: AppColors.muted,
              ),
            ),
          ],
        ),
      );
    } else {
      body = Column(
        children: [
          for (var i = 0; i < sales.length; i++) ...[
            if (i > 0) const Divider(height: 1, indent: 68),
            _SaleRow(
              key: ValueKey('shop-sale-${sales[i].id}'),
              l10n: l10n,
              sale: sales[i],
              locale: locale,
              soldBy: inventoryStaffName(staff, sales[i].soldByStaffId),
              storeName: stores.viewerSeesAll
                  ? (sales[i].storeName.isNotEmpty
                        ? sales[i].storeName
                        : stores.storeName(sales[i].storeId))
                  : '',
              onTap: onSeeAll,
            ),
          ],
        ],
      );
    }
    return Column(
      key: const Key('shop-today-sales'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: Text(
                l10n.shopHomeRecentTitle,
                style: const TextStyle(
                  fontSize: 17,
                  fontWeight: FontWeight.w700,
                  color: AppColors.ink,
                ),
              ),
            ),
            TextButton(
              key: const Key('shop-sales-see-all'),
              onPressed: onSeeAll,
              style: TextButton.styleFrom(minimumSize: const Size(48, 44)),
              child: Text(l10n.shopHomeSeeAll),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.xs),
        Container(
          decoration: BoxDecoration(
            color: AppColors.paper,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: AppColors.rule),
          ),
          clipBehavior: Clip.antiAlias,
          child: body,
        ),
      ],
    );
  }
}

class _SaleRow extends StatelessWidget {
  const _SaleRow({
    super.key,
    required this.l10n,
    required this.sale,
    required this.locale,
    required this.soldBy,
    required this.storeName,
    required this.onTap,
  });

  final AppLocalizations l10n;
  final InventorySale sale;
  final String locale;
  final String soldBy;
  final String storeName;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final what = sale.lines.isEmpty
        ? l10n.inventoryPieces(sale.itemCount)
        : l10n.shopHomeSaleItems(
            sale.lines.length - 1,
            sale.lines.first.quantity > 1
                ? '${sale.lines.first.quantity} × ${sale.lines.first.displayName}'
                : sale.lines.first.displayName,
          );
    final meta = [
      if (sale.createdAt != null) displayTime(sale.createdAt!, locale),
      if (soldBy.isNotEmpty) soldBy,
      inventoryPaymentLabel(l10n, sale.paymentMethod),
      if (storeName.isNotEmpty) storeName,
    ].join(' · ');
    return InkWell(
      onTap: onTap,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 64),
        child: Padding(
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.lg,
            vertical: AppSpacing.md,
          ),
          child: Row(
            children: [
              Container(
                width: 36,
                height: 36,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppColors.parchment,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Icon(
                  Icons.shopping_bag_outlined,
                  size: 18,
                  color: AppColors.cobaltDeep,
                ),
              ),
              const SizedBox(width: AppSpacing.lg),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      what,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 14.5,
                        fontWeight: FontWeight.w600,
                        color: AppColors.ink,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      meta,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 12.5,
                        color: AppColors.muted,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: AppSpacing.md),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    formatLotCents(sale.totalCents),
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w800,
                      color: sale.voided ? AppColors.muted : AppColors.ink,
                      decoration: sale.voided
                          ? TextDecoration.lineThrough
                          : null,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
                  ),
                  if (sale.voided)
                    Text(
                      l10n.inventoryVoidedMark,
                      style: const TextStyle(
                        fontSize: 11.5,
                        fontWeight: FontWeight.w700,
                        color: AppColors.errorRed,
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
}

class _SaleRowPlaceholder extends StatelessWidget {
  const _SaleRowPlaceholder();

  @override
  Widget build(BuildContext context) {
    Widget bar(double width, double height) => Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: AppColors.parchment,
        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
      ),
    );
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.lg,
        vertical: AppSpacing.md,
      ),
      child: Row(
        children: [
          bar(36, 36),
          const SizedBox(width: AppSpacing.lg),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [bar(140, 12), const SizedBox(height: 8), bar(90, 10)],
            ),
          ),
          bar(56, 14),
        ],
      ),
    );
  }
}

class _LowStockRow extends StatelessWidget {
  const _LowStockRow({
    super.key,
    required this.name,
    required this.trailing,
    required this.out,
    required this.onTap,
  });

  final String name;
  final String trailing;
  final bool out;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final color = out ? AppColors.errorRed : AppColors.warn;
    return InkWell(
      onTap: onTap,
      child: ConstrainedBox(
        constraints: const BoxConstraints(minHeight: 48),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
          child: Row(
            children: [
              Icon(Icons.circle, size: 8, color: color),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Text(
                  name,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 14.5, color: AppColors.ink),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Text(
                trailing,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: color,
                ),
              ),
              const Icon(Icons.chevron_right, size: 20, color: AppColors.muted),
            ],
          ),
        ),
      ),
    );
  }
}
