import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/inventory.dart';
import '../services/inventory_context.dart';
import '../services/inventory_credit.dart';
import '../services/inventory_service.dart';
import '../services/inventory_stores.dart';
import '../services/inventory_team.dart';
import '../services/lot_ledger.dart' show LotStaff, formatLotCents;
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/action_confirmation.dart';
import '../utils/date_display.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/inventory_widgets.dart';
import '../widgets/lot_sheets.dart';
import 'inventory_credit_sheet.dart';

/// The sales recorded at the counter, newest first, one page at a time. Each
/// shows what was sold, at what price, how it was paid and by whom. A sale is
/// undone only as a whole: Void puts the stock back and keeps the sale in the
/// list marked voided - who and when - so nothing is ever erased.
///
/// In a business with several stores, staff see only their own store's sales;
/// the owner and "works in all stores" staff see every sale with a store line
/// on each and a store filter.
///
/// Opened from a sale notification ([saleId]), the screen reads that one sale
/// and shows it first, briefly highlighted, above the list. A sale that does
/// not exist, or that the person may not see (another store's, for staff tied
/// to one), is never shown: the list opens as usual with a short note.
///
/// A credit sale carries a chip (Owed $40.00, red once overdue, or Credit
/// paid) and opens its credit sheet; the chips above the list narrow to the
/// credits still owed or paid.
class InventorySalesScreen extends StatefulWidget {
  const InventorySalesScreen({
    super.key,
    required this.businessId,
    this.source,
    this.service = const InventoryService(),
    this.access = const InventoryAccess.owner(),
    this.saleId,
    this.creditSource,
    this.currentUserId,
    this.clock = DateTime.now,
  });

  final String businessId;
  final InventorySource? source;
  final InventoryService service;
  final InventoryAccess access;

  /// The owner (for the pickers) and a credit's payments; null reads
  /// Firestore.
  final InventoryCreditSource? creditSource;
  final String? currentUserId;
  final DateTime Function() clock;

  /// The sale to open first (from a notification); null or blank: just the
  /// list.
  final String? saleId;

  @override
  State<InventorySalesScreen> createState() => _InventorySalesScreenState();
}

class _InventorySalesScreenState extends State<InventorySalesScreen> {
  late final InventorySource _source =
      widget.source ?? FirestoreInventorySource();
  final List<StreamSubscription<Object?>> _subs = [];
  StreamSubscription<Object?>? _salesSub;
  Timer? _safety;
  String? _salesKey;
  late final InventoryContextWatcher _watcher = InventoryContextWatcher(
    source: _source,
    businessId: widget.businessId,
    access: widget.access,
    watchCategories: false,
    watchBrands: false,
    onChange: () {
      if (!mounted) return;
      setState(() {});
      _listenSales();
      _listenFocus();
    },
  );

  /// The sale a notification asked for. Until it is read (or refused, or the
  /// safety timer fires) the screen shows its spinner, so the list does not
  /// jump when the sale lands on top of it.
  StreamSubscription<InventorySale?>? _focusSub;
  Timer? _focusSafety;
  Timer? _highlightTimer;
  bool _focusStarted = false;
  InventorySale? _focused;
  bool _focusMissing = false;
  bool _highlight = false;

  String get _focusId => widget.saleId?.trim() ?? '';

  bool get _focusPending =>
      _focusId.isNotEmpty && _focused == null && !_focusMissing;

  /// The store being looked at ('' = all), for someone who sees every store.
  String _storeFilter = '';

  List<InventorySale> _sales = const [];
  late final InventoryTeamWatcher _team = InventoryTeamWatcher(
    source: _source,
    creditSource: widget.creditSource,
    businessId: widget.businessId,
    onChange: () {
      if (mounted) setState(() {});
    },
  );
  List<LotStaff> get _staff => _team.people;
  InventoryCreditFilter _creditFilter = InventoryCreditFilter.all;
  late final String _me = widget.currentUserId ?? inventoryCurrentUserId();
  int _pages = 1;
  bool _loaded = false;
  bool _failed = false;
  bool _loadingMore = false;
  String _voiding = '';

  @override
  void initState() {
    super.initState();
    _watcher.start();
    _listenSales();
    _listenFocus();
    _team.start();
  }

  @override
  void dispose() {
    _safety?.cancel();
    _focusSafety?.cancel();
    _highlightTimer?.cancel();
    _focusSub?.cancel();
    _salesSub?.cancel();
    _watcher.dispose();
    _team.dispose();
    for (final s in _subs) {
      s.cancel();
    }
    super.dispose();
  }

  int get _limit => inventorySalesPageSize * _pages;

  /// Listens to the newest sales: everyone's, or - for staff of a business with
  /// several stores - only their own store's (waiting until the stores are
  /// known, so nobody asks for more than they may read). Listening again for
  /// the same store and page does nothing.
  void _listenSales({bool force = false}) {
    final ctx = _watcher.context;
    final scope = inventorySalesScope(
      widget.access,
      ctx,
      storesLoaded: _watcher.storesLoaded,
    );
    if (!scope.ready) {
      _safety ??= Timer(const Duration(seconds: 15), () {
        if (mounted && !_loaded) setState(() => _loaded = true);
      });
      return;
    }
    final store = scope.storeId;
    final key = '${scope.none ? '!' : store}#$_pages';
    if (!force && key == _salesKey) return;
    _salesKey = key;
    _safety?.cancel();
    // A list that never answers is a spinner that never stops.
    _safety = Timer(const Duration(seconds: 15), () {
      if (mounted && !_loaded) setState(() => _loaded = true);
    });
    _salesSub?.cancel();
    if (scope.none) {
      // No store, no sales to read.
      _salesSub = null;
      _safety?.cancel();
      _sales = const [];
      _loaded = true;
      return;
    }
    _salesSub = _source
        .watchSales(widget.businessId, limit: _limit, storeId: store)
        .listen(
          (sales) {
            if (!mounted) return;
            _safety?.cancel();
            setState(() {
              _sales = sortSalesNewestFirst(sales);
              _loaded = true;
              _failed = false;
              _loadingMore = false;
            });
          },
          onError: (_) {
            if (!mounted) return;
            _safety?.cancel();
            setState(() {
              _loaded = true;
              _failed = true;
              _loadingMore = false;
            });
          },
        );
  }

  /// Reads the notification's sale once the person's reach is known (the same
  /// wait as the list), and keeps it live so a void shows on it. Anything but
  /// a sale this person may see falls back to the list with a note.
  void _listenFocus() {
    final saleId = _focusId;
    // Once given up on (the safety timer), it stays given up on: a sale that
    // pops in later would sit under a note saying it is not available.
    if (saleId.isEmpty || _focusStarted || _focusMissing) return;
    final scope = inventorySalesScope(
      widget.access,
      _watcher.context,
      storesLoaded: _watcher.storesLoaded,
    );
    // A sale that never answers must not keep the spinner up.
    _focusSafety ??= Timer(const Duration(seconds: 15), () {
      if (mounted && _focusPending) _refuseFocus();
    });
    if (!scope.ready) return;
    _focusStarted = true;
    if (scope.none) {
      _refuseFocus();
      return;
    }
    _focusSub = _source
        .watchSale(widget.businessId, saleId)
        .listen(
          (sale) {
            if (!mounted) return;
            if (sale == null ||
                !inventorySaleVisible(
                  sale,
                  businessId: widget.businessId,
                  context: _watcher.context,
                )) {
              _refuseFocus();
              return;
            }
            _focusSafety?.cancel();
            final first = _focused == null;
            setState(() {
              _focused = sale;
              if (first) _highlight = true;
            });
            if (first) {
              _highlightTimer = Timer(const Duration(milliseconds: 2400), () {
                if (mounted) setState(() => _highlight = false);
              });
            }
          },
          onError: (_) {
            // Refused by the rules (or offline before the first answer).
            // Once the sale is on screen a later error leaves it there.
            if (mounted && _focused == null) _refuseFocus();
          },
        );
  }

  void _refuseFocus() {
    _focusSafety?.cancel();
    _focusSub?.cancel();
    _focusSub = null;
    if (!mounted) return;
    setState(() {
      _focused = null;
      _focusMissing = true;
    });
  }

  void _loadMore() {
    if (_loadingMore) return;
    setState(() {
      _loadingMore = true;
      _pages++;
    });
    _listenSales();
  }

  Future<void> _void(InventorySale sale) async {
    if (_voiding.isNotEmpty) return;
    final l10n = AppLocalizations.of(context)!;
    final ok = await confirmMajorAction(
      context,
      title: l10n.inventoryVoidTitle,
      message: l10n.inventoryVoidMessage,
      confirmLabel: l10n.inventoryVoidSale,
      destructive: true,
    );
    if (!ok || !mounted) return;
    setState(() => _voiding = sale.id);
    try {
      await widget.service.voidSale(widget.businessId, sale.id);
      if (!mounted) return;
      AppHaptics.commit();
      showSuccessSnackBar(context, l10n.inventoryVoidedDone);
    } catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      showErrorSnackBar(
        context,
        inventoryFailureText(l10n, inventoryFailureFromError(error)),
      );
    } finally {
      if (mounted) setState(() => _voiding = '');
    }
  }

  /// The credit sheet of [sale]: payments, collector, due date.
  Future<void> _openCredit(InventorySale sale) {
    final scope = inventorySalesScope(
      widget.access,
      _watcher.context,
      storesLoaded: _watcher.storesLoaded,
    );
    return showInventoryCreditSheet(
      context,
      businessId: widget.businessId,
      sale: sale,
      staff: _staff,
      service: widget.service,
      creditSource: widget.creditSource,
      paymentsStoreId: scope.storeId,
      currentUserId: _me,
      clock: widget.clock,
    );
  }

  /// The notification's sale, when it is loaded, still the viewer's to see,
  /// and inside the store filter (someone who narrowed to another store does
  /// not see it pinned on top).
  InventorySale? _focusedShown(InventoryStoreContext stores) {
    final sale = _focused;
    if (sale == null) return null;
    if (!inventorySaleVisible(
      sale,
      businessId: widget.businessId,
      context: stores,
    )) {
      return null;
    }
    if (stores.viewerSeesAll &&
        inventorySalesForStore([sale], _storeFilter).isEmpty) {
      return null;
    }
    return sale;
  }

  Widget _card(
    InventorySale sale,
    String locale,
    InventoryStoreContext stores, {
    bool highlighted = false,
  }) => InventorySaleCard(
    key: ValueKey('inv-sale-${sale.id}'),
    sale: sale,
    locale: locale,
    staff: _staff,
    storeName: stores.viewerSeesAll
        ? (sale.storeName.isNotEmpty
              ? sale.storeName
              : stores.storeName(sale.storeId))
        : '',
    voiding: _voiding == sale.id,
    canVoid: _voiding.isEmpty,
    onVoid: () => _void(sale),
    highlighted: highlighted,
    today: widget.clock(),
    onCredit: sale.isOnCredit ? () => _openCredit(sale) : null,
  );

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    final stores = _watcher.context;
    final shown = inventorySalesForCredit(
      stores.viewerSeesAll
          ? inventorySalesForStore(_sales, _storeFilter)
          : _sales,
      _creditFilter,
    );
    final focused = _focusedShown(stores);
    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          InventoryHeader(title: l10n.inventorySalesTitle),
          if (stores.homeStoreMissing)
            Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.lg,
                AppSpacing.md,
                AppSpacing.lg,
                0,
              ),
              child: InventoryNote(
                key: const Key('inv-home-store-missing'),
                error: false,
                text: l10n.inventoryStoreHomeRequiredView,
              ),
            ),
          if (_focusMissing)
            Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.lg,
                AppSpacing.md,
                AppSpacing.lg,
                0,
              ),
              child: InventoryNote(
                key: const Key('inv-sale-unavailable'),
                error: false,
                text: l10n.inventorySaleNotAvailable,
              ),
            ),
          if (stores.viewerSeesAll)
            Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.lg,
                AppSpacing.md,
                AppSpacing.lg,
                0,
              ),
              child: InventoryChoiceChips(
                keyPrefix: 'inv-sales-store',
                options: inventoryStoreChoices(l10n, stores),
                selected: _storeFilter,
                onSelected: (id) => setState(() => _storeFilter = id),
              ),
            ),
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg,
              AppSpacing.md,
              AppSpacing.lg,
              0,
            ),
            child: InventoryChoiceChips(
              keyPrefix: 'inv-sales-credit',
              options: [
                (id: '', label: l10n.invCreditFilterAll),
                (id: 'open', label: l10n.invCreditOwedTitle),
                (id: 'paid', label: l10n.invCreditChipPaid),
              ],
              selected: switch (_creditFilter) {
                InventoryCreditFilter.all => '',
                InventoryCreditFilter.open => 'open',
                InventoryCreditFilter.paid => 'paid',
              },
              onSelected: (id) => setState(
                () => _creditFilter = switch (id) {
                  'open' => InventoryCreditFilter.open,
                  'paid' => InventoryCreditFilter.paid,
                  _ => InventoryCreditFilter.all,
                },
              ),
            ),
          ),
          Expanded(
            child: !_loaded || _focusPending
                ? const Center(child: CircularProgressIndicator())
                : _failed && _sales.isEmpty && focused == null
                ? Padding(
                    padding: const EdgeInsets.all(AppSpacing.xl),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        InventoryNote(
                          key: const Key('inv-sales-error'),
                          text: l10n.inventorySalesLoadFailed,
                          trailing: TextButton(
                            onPressed: () {
                              setState(() {
                                _loaded = false;
                                _failed = false;
                              });
                              _listenSales(force: true);
                            },
                            child: Text(l10n.retry),
                          ),
                        ),
                      ],
                    ),
                  )
                : shown.isEmpty && focused == null
                ? LotEmptyState(
                    key: const Key('inv-sales-empty'),
                    icon: Icons.receipt_long_outlined,
                    title: l10n.inventoryNoSales,
                    hint: l10n.inventoryNoSalesHint,
                  )
                : ListView(
                    key: const Key('inv-sales-list'),
                    padding: const EdgeInsets.fromLTRB(
                      AppSpacing.lg,
                      AppSpacing.md,
                      AppSpacing.lg,
                      AppSpacing.xl,
                    ),
                    children: [
                      // The notification's sale first, then the rest
                      // without it.
                      if (focused != null)
                        KeyedSubtree(
                          key: const Key('inv-sale-focused'),
                          child: _card(
                            focused,
                            locale,
                            stores,
                            highlighted: _highlight,
                          ),
                        ),
                      for (final sale in shown)
                        if (sale.id != focused?.id) _card(sale, locale, stores),
                      if (_sales.length >= _limit)
                        Center(
                          child: TextButton(
                            key: const Key('inv-sales-more'),
                            onPressed: _loadingMore ? null : _loadMore,
                            child: _loadingMore
                                ? const SizedBox(
                                    width: 16,
                                    height: 16,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : Text(l10n.inventoryLoadMoreSales),
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

/// One sale: when, the total, what was sold at what price, how it was paid,
/// who sold it - and, when voided, who voided it and when.
class InventorySaleCard extends StatelessWidget {
  const InventorySaleCard({
    super.key,
    required this.sale,
    required this.locale,
    required this.staff,
    required this.onVoid,
    this.voiding = false,
    this.canVoid = true,
    this.storeName = '',
    this.highlighted = false,
    this.today,
    this.onCredit,
  });

  final InventorySale sale;

  /// For the credit chip's overdue reading (null: now).
  final DateTime? today;

  /// Opens the credit sheet; null for a sale paid in full.
  final VoidCallback? onCredit;
  final String locale;
  final List<LotStaff> staff;
  final VoidCallback onVoid;
  final bool voiding;
  final bool canVoid;

  /// The store the sale was made from; blank (and not shown) unless the
  /// viewer sees every store of a multi-store business.
  final String storeName;

  /// Drawn out for a moment: the sale a notification opened.
  final bool highlighted;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final when = sale.createdAt == null
        ? ''
        : displayDateTime(sale.createdAt!, locale);
    final soldBy = inventoryStaffName(staff, sale.soldByStaffId);
    final receivedBy = inventoryStaffName(staff, sale.moneyReceivedBy);
    final voidedBy = inventoryStaffName(staff, sale.voidedByStaffId);
    final voidedWhen = sale.voidedAt == null
        ? ''
        : displayDateTime(sale.voidedAt!, locale);
    return AnimatedContainer(
      duration: AppMotion.reduced(context)
          ? const Duration(milliseconds: 120)
          : const Duration(milliseconds: 600),
      curve: AppMotion.standard,
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: highlighted ? AppColors.mist : AppColors.paper,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(
          color: highlighted
              ? AppColors.cobalt
              : sale.voided
              ? AppColors.errorRed.withValues(alpha: 0.35)
              : AppColors.rule,
        ),
        boxShadow: [
          BoxShadow(
            color: AppColors.cobalt.withValues(alpha: highlighted ? 0.25 : 0),
            blurRadius: 12,
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  when,
                  style: const TextStyle(
                    fontSize: 12.5,
                    color: AppColors.muted,
                  ),
                ),
              ),
              if (sale.isOnCredit && !sale.voided)
                InventoryCreditChip(
                  key: Key('inv-credit-chip-${sale.id}'),
                  sale: sale,
                  today: today ?? DateTime.now(),
                ),
              if (sale.voided)
                InventoryChip(
                  key: Key('inv-voided-${sale.id}'),
                  label: l10n.inventoryVoidedMark,
                  color: AppColors.errorRed,
                ),
            ],
          ),
          const SizedBox(height: 2),
          Text(
            formatLotCents(sale.totalCents),
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w800,
              color: sale.voided ? AppColors.muted : AppColors.ink,
              decoration: sale.voided ? TextDecoration.lineThrough : null,
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          for (final line in sale.lines)
            Padding(
              padding: const EdgeInsets.only(bottom: 2),
              child: Text(
                [
                  line.priceChanged
                      ? l10n.inventorySaleLineChanged(
                          line.quantity,
                          line.displayName,
                          formatLotCents(line.soldPriceCents),
                          formatLotCents(line.listPriceCents),
                        )
                      : l10n.inventorySaleLine(
                          line.quantity,
                          line.displayName,
                          formatLotCents(line.soldPriceCents),
                        ),
                  if (line.countWasOff) l10n.inventorySaleCountOff,
                ].join(' · '),
                style: const TextStyle(
                  fontSize: 13,
                  height: 1.35,
                  color: AppColors.ink,
                ),
              ),
            ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            [
              // Nothing paid at the counter: no method to name.
              if (!sale.isOnCredit || sale.paidAtSaleCents > 0)
                inventoryPaymentLabel(l10n, sale.paymentMethod),
              if (soldBy.isNotEmpty) l10n.inventorySoldBy(soldBy),
              if (receivedBy.isNotEmpty &&
                  sale.moneyReceivedBy != sale.soldByStaffId)
                l10n.invCreditReceivedByName(receivedBy),
              if (storeName.isNotEmpty) l10n.inventoryStoreOf(storeName),
            ].join(' · '),
            key: Key('inv-sale-meta-${sale.id}'),
            style: const TextStyle(fontSize: 12, color: AppColors.muted),
          ),
          if (sale.isOnCredit) ...[
            const SizedBox(height: 2),
            Text(
              [
                l10n.invCreditSplit(
                  formatLotCents(sale.paidAtSaleCents),
                  formatLotCents(sale.creditCents),
                ),
                if ((sale.credit?.customerName ?? '').isNotEmpty)
                  sale.credit!.customerName,
              ].join(' · '),
              key: Key('inv-sale-credit-${sale.id}'),
              style: const TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: AppColors.ink,
              ),
            ),
          ],
          if (sale.voided)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                voidedBy.isNotEmpty
                    ? l10n.inventoryVoidedBy(voidedBy, voidedWhen)
                    : l10n.inventoryVoidedWhen(voidedWhen),
                key: Key('inv-voided-by-${sale.id}'),
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: AppColors.errorRed,
                ),
              ),
            )
          else
            Align(
              alignment: Alignment.centerRight,
              child: Wrap(
                alignment: WrapAlignment.end,
                children: [
                  if (onCredit != null)
                    TextButton(
                      key: Key('inv-credit-open-${sale.id}'),
                      onPressed: onCredit,
                      child: Text(l10n.invCreditDetails),
                    ),
                  TextButton(
                    key: Key('inv-void-${sale.id}'),
                    onPressed: canVoid ? onVoid : null,
                    child: voiding
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : Text(
                            l10n.inventoryVoidSale,
                            style: TextStyle(
                              color: canVoid
                                  ? AppColors.errorRed
                                  : AppColors.muted,
                            ),
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
