import 'dart:async';

import 'package:flutter/material.dart';
import 'package:intl/intl.dart' show NumberFormat;

import '../l10n/app_localizations.dart';
import '../services/inventory.dart';
import '../services/inventory_context.dart';
import '../services/inventory_service.dart';
import '../services/inventory_stores.dart';
import '../services/inventory_team.dart';
import '../services/lot_ledger.dart' show formatLotCents;
import '../services/sales_history.dart';
import '../services/sales_history_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/date_display.dart';
import '../widgets/day_picker.dart';
import '../widgets/inventory_widgets.dart';
import '../widgets/lot_sheets.dart';
import 'inventory_item_screen.dart';
import 'inventory_sales_screen.dart';

/// Sales history: a day, a week (Sunday to Saturday), a month or a year on
/// the shop's clock (New York), with previous / next and a calendar. It shows
/// the headline figures against the period before, a bar chart (tap a bar
/// for its amount, then open that day or month), the breakdowns (store,
/// seller, payment, products, brands, categories) and what happened, day by
/// day; a sale, a void or a credit payment opens that sale, a stock change
/// opens the product. Profit is the owner's only.
///
/// The reach is the sales list's: staff tied to one store read that store;
/// whoever sees every store of a multi-store business can pick one. A period
/// is read once (not live) and added up once per read, never per frame.
class SalesHistoryScreen extends StatefulWidget {
  const SalesHistoryScreen({
    super.key,
    required this.businessId,
    this.access = const InventoryAccess.owner(),
    this.source,
    this.historySource,
    this.creditSource,
    this.service = const InventoryService(),
    this.currentUserId,
    this.clock = DateTime.now,
  });

  final String businessId;
  final InventoryAccess access;
  final InventorySource? source;
  final SalesHistorySource? historySource;
  final InventoryCreditSource? creditSource;
  final InventoryService service;
  final String? currentUserId;
  final DateTime Function() clock;

  @override
  State<SalesHistoryScreen> createState() => _SalesHistoryScreenState();
}

/// One row of the "What happened" list: a day heading or an event.
typedef _TimelineRow = ({DateTime? day, SalesEvent? event});

class _SalesHistoryScreenState extends State<SalesHistoryScreen> {
  late final InventorySource _source =
      widget.source ?? FirestoreInventorySource();
  late final SalesHistorySource _history =
      widget.historySource ?? FirestoreSalesHistorySource();

  late final InventoryContextWatcher _watcher = InventoryContextWatcher(
    source: _source,
    businessId: widget.businessId,
    access: widget.access,
    watchCategories: false,
    watchBrands: false,
    onChange: () {
      if (!mounted) return;
      setState(() {});
      _maybeLoad();
    },
  );
  late final InventoryTeamWatcher _team = InventoryTeamWatcher(
    source: _source,
    creditSource: widget.creditSource,
    businessId: widget.businessId,
    onChange: () {
      if (mounted) setState(() {});
    },
  );
  StreamSubscription<List<InventoryItem>>? _itemsSub;
  Map<String, String> _itemNames = const {};

  late SalesPeriod _period = SalesPeriod.current(
    SalesPeriodKind.day,
    widget.clock(),
  );
  String _storeFilter = '';

  SalesHistoryData? _data;
  List<_TimelineRow> _rows = const [];
  String? _loadedKey;
  int _ticket = 0;
  bool _loading = true;
  bool _failed = false;
  Timer? _safety;
  int? _selectedBar;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // A person or owner with no name reads as words, never their uid.
    final l10n = AppLocalizations.of(context)!;
    _team
      ..unnamedPersonLabel = l10n.lotUnnamedPerson
      ..unnamedOwnerLabel = l10n.lotBusinessOwner;
  }

  @override
  void initState() {
    super.initState();
    _watcher.start();
    _team.start();
    _itemsSub = _source.watchItems(widget.businessId).listen(
      (items) {
        if (!mounted) return;
        setState(() {
          _itemNames = {for (final i in items) i.id: i.displayName};
        });
      },
      // No product names: stock rows say "A product".
      onError: (_) {},
    );
    _armSafety();
    _maybeLoad();
  }

  @override
  void dispose() {
    _safety?.cancel();
    _itemsSub?.cancel();
    _watcher.dispose();
    _team.dispose();
    _ticket++;
    super.dispose();
  }

  /// Staff whose stores never answer still get an answer: a retry.
  void _armSafety() {
    _safety?.cancel();
    _safety = Timer(const Duration(seconds: 15), () {
      if (mounted && _loading && _data == null && !_scope.ready) {
        setState(() {
          _loading = false;
          _failed = true;
        });
      }
    });
  }

  ({bool ready, bool none, String storeId}) get _scope => inventorySalesScope(
    widget.access,
    _watcher.context,
    storesLoaded: _watcher.storesLoaded,
  );

  /// The store read: staff tied to one store always read theirs; whoever
  /// sees every store reads the one picked ('' = all).
  String get _storeId {
    final own = _scope.storeId;
    if (own.isNotEmpty) return own;
    return _watcher.context.viewerSeesAll ? _storeFilter : '';
  }

  void _maybeLoad({bool force = false}) {
    final scope = _scope;
    if (!scope.ready) return;
    if (scope.none) {
      _safety?.cancel();
      if (_loading || _data != null) {
        setState(() {
          _loading = false;
          _data = null;
          _rows = const [];
        });
      }
      return;
    }
    final key = '${_period.kind.name}|${_period.startDay}|$_storeId';
    if (!force && key == _loadedKey) return;
    _loadedKey = key;
    unawaited(_load(_period, _storeId));
  }

  Future<void> _load(SalesPeriod period, String storeId) async {
    final ticket = ++_ticket;
    _safety?.cancel();
    setState(() {
      _loading = true;
      _failed = false;
    });
    try {
      final data = await loadSalesHistory(
        _history,
        widget.businessId,
        period,
        storeId: storeId,
      ).timeout(const Duration(seconds: 45));
      if (!mounted || ticket != _ticket) return;
      setState(() {
        _data = data;
        _rows = [
          for (final day in data.days) ...[
            (day: day.day, event: null),
            for (final e in day.events) (day: null, event: e),
          ],
        ];
        _loading = false;
      });
    } catch (_) {
      if (!mounted || ticket != _ticket) return;
      setState(() {
        _loading = false;
        _failed = true;
      });
    }
  }

  /// A new period or store: the old figures are another period's, so they
  /// go (a spinner shows) rather than sit under the new heading.
  void _show(SalesPeriod period) {
    setState(() {
      _period = period;
      _data = null;
      _rows = const [];
      _selectedBar = null;
    });
    _maybeLoad();
  }

  void _setKind(SalesPeriodKind kind) {
    if (kind == _period.kind) return;
    final now = widget.clock();
    _show(
      _period.contains(now)
          ? SalesPeriod.current(kind, now)
          : SalesPeriod.containing(kind, _period.startDay),
    );
  }

  void _setStore(String id) {
    if (id == _storeFilter) return;
    _storeFilter = id;
    _show(_period);
  }

  Future<void> _pickDay() async {
    final today = shopToday(widget.clock());
    final picked = await pickCalendarDay(
      context,
      initial: wallDayAsLocal(_period.startDay),
      first: DateTime(2020, 1, 1),
      last: today,
    );
    if (picked == null || !mounted) return;
    _show(
      SalesPeriod.containing(
        _period.kind,
        DateTime.utc(picked.year, picked.month, picked.day),
      ),
    );
  }

  Future<void> _openEvent(SalesEvent e) async {
    final Widget screen;
    if (e.opensSale) {
      screen = InventorySalesScreen(
        businessId: widget.businessId,
        source: _source,
        service: widget.service,
        access: widget.access,
        creditSource: widget.creditSource,
        currentUserId: widget.currentUserId,
        clock: widget.clock,
        saleId: e.saleId,
      );
    } else if (e.itemId.isNotEmpty) {
      screen = InventoryItemScreen(
        businessId: widget.businessId,
        itemId: e.itemId,
        source: _source,
        service: widget.service,
        access: widget.access,
      );
    } else {
      return;
    }
    await Navigator.of(
      context,
    ).push(MaterialPageRoute<void>(builder: (_) => screen));
    // A void or a payment there changes this period: read it again.
    if (mounted) _maybeLoad(force: true);
  }

  String _person(AppLocalizations l10n, String id) {
    if (id.isEmpty) return '';
    final name = inventoryStaffName(_team.people, id);
    return name.isEmpty ? l10n.salesHistUnknownPerson : name;
  }

  String _storeLabel(AppLocalizations l10n, String id, String snapshot) {
    if (snapshot.isNotEmpty) return snapshot;
    final name = _watcher.context.storeName(id);
    return name.isNotEmpty ? name : l10n.salesHistNoStore;
  }

  String _periodLabel(String locale, AppLocalizations l10n) {
    final p = _period;
    return switch (p.kind) {
      SalesPeriodKind.day => displayWeekdayDate(
        wallDayAsLocal(p.startDay),
        locale,
      ),
      SalesPeriodKind.week => l10n.salesHistRange(
        displayMonthDay(wallDayAsLocal(p.startDay), locale),
        displayDate(
          DateTime(p.endDay.year, p.endDay.month, p.endDay.day - 1),
          locale,
        ),
      ),
      SalesPeriodKind.month => displayMonthYear(
        wallDayAsLocal(p.startDay),
        locale,
      ),
      SalesPeriodKind.year => '${p.startDay.year}',
    };
  }

  /// A bar's name: its hour, its day or its month.
  String _barLabel(int index, String locale) {
    final day = wallDayAsLocal(_period.bucketDay(index));
    return switch (_period.kind) {
      SalesPeriodKind.day => displayHour(
        DateTime(day.year, day.month, day.day, index),
        locale,
      ),
      SalesPeriodKind.week ||
      SalesPeriodKind.month => displayWeekdayMonthDay(day, locale),
      SalesPeriodKind.year => displayMonthYear(day, locale),
    };
  }

  /// The few labels under the bars; null leaves a bar unlabelled.
  String? _axisLabel(int index, String locale) {
    final day = wallDayAsLocal(_period.bucketDay(index));
    return switch (_period.kind) {
      SalesPeriodKind.day =>
        index % 6 == 0
            ? displayHour(DateTime(day.year, day.month, day.day, index), locale)
            : null,
      SalesPeriodKind.week => displayWeekdayShort(day, locale),
      SalesPeriodKind.month => index % 7 == 0 ? '${day.day}' : null,
      SalesPeriodKind.year => displayMonthNarrow(day, locale),
    };
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    final stores = _watcher.context;
    final data = _data;
    final now = widget.clock();
    final ownStore = stores.ownStoreId;

    final top = <Widget>[
      _PeriodControls(
        kind: _period.kind,
        label: _periodLabel(locale, l10n),
        current: _period.contains(now)
            ? l10n.salesHistCurrent(_period.kind.name)
            : null,
        canGoNext: _period.next.startedBy(now),
        onKind: _setKind,
        onPrevious: () => _show(_period.previous),
        onNext: () => _show(_period.next),
        onPick: _pickDay,
      ),
      if (stores.viewerSeesAll) ...[
        const SizedBox(height: AppSpacing.sm),
        InventoryChoiceChips(
          keyPrefix: 'hist-store',
          options: inventoryStoreChoices(l10n, stores),
          selected: _storeFilter,
          onSelected: _setStore,
        ),
      ],
      if (stores.homeStoreMissing) ...[
        const SizedBox(height: AppSpacing.md),
        InventoryNote(
          key: const Key('hist-home-store-missing'),
          error: false,
          text: l10n.inventoryStoreHomeRequiredView,
        ),
      ],
      if (data != null && data.truncated) ...[
        const SizedBox(height: AppSpacing.md),
        InventoryNote(
          key: const Key('hist-truncated'),
          error: false,
          text: l10n.salesHistTruncated(
            NumberFormat.decimalPattern(locale).format(salesHistoryReadLimit),
          ),
        ),
      ],
      if (data != null && data.partial) ...[
        const SizedBox(height: AppSpacing.md),
        InventoryNote(
          key: const Key('hist-partial'),
          error: false,
          text: l10n.salesHistPartial,
        ),
      ],
      if (_failed) ...[
        const SizedBox(height: AppSpacing.md),
        InventoryNote(
          key: const Key('hist-load-failed'),
          text: l10n.salesHistLoadFailed,
          trailing: TextButton(
            key: const Key('hist-retry'),
            onPressed: () {
              _armSafety();
              setState(() {
                _failed = false;
                _loading = true;
              });
              _maybeLoad(force: true);
            },
            child: Text(l10n.retry),
          ),
        ),
      ],
    ];

    final body = <Widget>[];
    if (data != null) {
      final s = data.summary;
      if (s.isEmpty && data.eventCount == 0) {
        body.add(
          LotEmptyState(
            key: const Key('hist-empty'),
            icon: Icons.insights_outlined,
            title: l10n.salesHistEmpty,
            hint: l10n.salesHistEmptyHint,
          ),
        );
      } else {
        body.addAll([
          _Figures(
            summary: s,
            previous: data.previous,
            kind: _period.kind,
            showProfit: widget.access.isOwner,
          ),
          const SizedBox(height: AppSpacing.md),
          _ChartCard(
            title: l10n.salesHistChartTitle(_period.kind.name),
            values: s.buckets,
            selected: _selectedBar,
            barLabel: (i) => _barLabel(i, locale),
            axisLabel: (i) => _axisLabel(i, locale),
            onSelect: (i) =>
                setState(() => _selectedBar = _selectedBar == i ? null : i),
            drillLabel: switch (_period.kind) {
              SalesPeriodKind.day => null,
              SalesPeriodKind.week ||
              SalesPeriodKind.month => l10n.salesHistOpenDay,
              SalesPeriodKind.year => l10n.salesHistOpenMonth,
            },
            onDrill: (i) => _show(
              SalesPeriod.containing(
                _period.kind == SalesPeriodKind.year
                    ? SalesPeriodKind.month
                    : SalesPeriodKind.day,
                _period.bucketDay(i),
              ),
            ),
          ),
          ..._breakdowns(l10n, s, stores),
        ]);
      }
      body.addAll([
        const SizedBox(height: AppSpacing.xl),
        _SectionTitle(l10n.salesHistTimelineTitle),
        if (_rows.isEmpty)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
            child: Text(
              l10n.salesHistNothingHappened,
              key: const Key('hist-timeline-empty'),
              style: const TextStyle(fontSize: 13, color: AppColors.muted),
            ),
          ),
      ]);
    }

    const gutter = EdgeInsets.symmetric(horizontal: AppSpacing.lg);
    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          InventoryHeader(
            title: l10n.salesHistTitle,
            subtitle: ownStore.isNotEmpty
                ? l10n.inventoryStoreShowing(stores.storeName(ownStore))
                : null,
            actions: [
              IconButton(
                key: const Key('hist-refresh'),
                tooltip: l10n.salesHistRefresh,
                onPressed: _loading ? null : () => _maybeLoad(force: true),
                icon: const Icon(Icons.refresh),
              ),
            ],
          ),
          if (_loading && data != null)
            const LinearProgressIndicator(minHeight: 2),
          Expanded(
            child: CustomScrollView(
              key: const Key('hist-scroll'),
              slivers: [
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(
                    AppSpacing.lg,
                    AppSpacing.md,
                    AppSpacing.lg,
                    AppSpacing.md,
                  ),
                  sliver: SliverList.list(children: top),
                ),
                if (_loading && data == null && !_failed)
                  const SliverToBoxAdapter(
                    child: Padding(
                      padding: EdgeInsets.all(AppSpacing.xl),
                      child: Center(
                        child: CircularProgressIndicator(
                          key: Key('hist-loading'),
                        ),
                      ),
                    ),
                  ),
                SliverPadding(
                  padding: gutter,
                  sliver: SliverList.list(children: body),
                ),
                // Built as it scrolls: a year can hold thousands of rows.
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(
                    AppSpacing.lg,
                    0,
                    AppSpacing.lg,
                    AppSpacing.xl,
                  ),
                  sliver: SliverList.builder(
                    itemCount: _rows.length,
                    itemBuilder: (context, i) {
                      final row = _rows[i];
                      final day = row.day;
                      if (day != null) {
                        return _DayHeading(
                          key: ValueKey('hist-day-$day'),
                          text: displayWeekdayDate(wallDayAsLocal(day), locale),
                        );
                      }
                      return _eventRow(l10n, locale, row.event!);
                    },
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  List<Widget> _breakdowns(
    AppLocalizations l10n,
    SalesHistorySummary s,
    InventoryStoreContext stores,
  ) {
    List<_Share> rows(
      List<SalesBreakdownRow> from,
      String Function(SalesBreakdownRow) label,
      String Function(int) caption,
    ) => [
      for (final r in from)
        _Share(
          id: r.id,
          label: label(r),
          caption: caption(r.count),
          cents: r.cents,
        ),
    ];

    final cards = <({String key, String title, List<_Share> rows})>[
      if (stores.viewerSeesAll && _storeFilter.isEmpty && s.byStore.length > 1)
        (
          key: 'store',
          title: l10n.salesHistByStore,
          rows: rows(
            s.byStore,
            (r) => _storeLabel(l10n, r.id, r.label),
            l10n.salesHistSalesCount,
          ),
        ),
      if (s.bySeller.isNotEmpty)
        (
          key: 'seller',
          title: l10n.salesHistBySeller,
          rows: rows(
            s.bySeller,
            (r) => _person(l10n, r.id).isEmpty
                ? l10n.salesHistUnknownPerson
                : _person(l10n, r.id),
            l10n.salesHistSalesCount,
          ),
        ),
      if (s.byPayment.isNotEmpty)
        (
          key: 'payment',
          title: l10n.salesHistByPayment,
          rows: rows(
            s.byPayment,
            (r) => r.id == salesOnCreditMethod || r.id.isEmpty
                ? l10n.invCreditPaymentOnCredit
                : inventoryPaymentLabel(l10n, r.id),
            l10n.salesHistSalesCount,
          ),
        ),
      if (s.topProducts.isNotEmpty)
        (
          key: 'products',
          title: l10n.salesHistTopProducts,
          rows: rows(
            s.topProducts,
            (r) => r.label.isEmpty ? l10n.salesHistUnknownItem : r.label,
            l10n.salesHistPieces,
          ),
        ),
      // A brand or category breakdown that is all "none" says nothing.
      if (s.topBrands.any((r) => r.id.isNotEmpty))
        (
          key: 'brands',
          title: l10n.salesHistTopBrands,
          rows: rows(
            s.topBrands,
            (r) => r.label.isEmpty ? l10n.inventoryBrandNone : r.label,
            l10n.salesHistPieces,
          ),
        ),
      if (s.topCategories.any((r) => r.id.isNotEmpty))
        (
          key: 'categories',
          title: l10n.salesHistTopCategories,
          rows: rows(
            s.topCategories,
            (r) => r.label.isEmpty ? l10n.inventoryCategoryNone : r.label,
            l10n.salesHistPieces,
          ),
        ),
    ];
    return [
      for (final card in cards) ...[
        const SizedBox(height: AppSpacing.md),
        _BreakdownCard(
          key: Key('hist-breakdown-${card.key}'),
          title: card.title,
          rows: card.rows,
        ),
      ],
    ];
  }

  Widget _eventRow(AppLocalizations l10n, String locale, SalesEvent e) {
    final time = displayTime(easternWallAsLocal(e.at), locale);
    final person = _person(l10n, e.staffId);
    final store = _watcher.context.viewerSeesAll && _storeFilter.isEmpty
        ? _watcher.context.storeName(e.storeId)
        : '';
    final item = _itemNames[e.itemId] ?? l10n.salesHistUnknownItem;
    final customer = e.title;

    String withCustomer(String head) =>
        customer.isEmpty ? head : '$head · $customer';

    final (IconData icon, String title, String amount, Color color) =
        switch (e.kind) {
          SalesEventKind.sale => (
            Icons.receipt_long_outlined,
            e.title.isEmpty
                ? l10n.salesHistEventSaleFallback
                : e.lineCount > 1
                ? l10n.salesHistMoreLines(e.title, e.lineCount - 1)
                : e.title,
            formatLotCents(e.cents),
            e.saleVoided ? AppColors.muted : AppColors.ink,
          ),
          SalesEventKind.voided => (
            Icons.block,
            l10n.salesHistEventVoided,
            '−${formatLotCents(e.cents)}',
            AppColors.errorRed,
          ),
          SalesEventKind.creditPayment => (
            Icons.payments_outlined,
            withCustomer(l10n.salesHistEventPayment),
            '+${formatLotCents(e.cents)}',
            AppColors.sage,
          ),
          SalesEventKind.creditReverted => (
            Icons.undo,
            withCustomer(l10n.salesHistEventReverted),
            formatLotCents(e.cents),
            AppColors.muted,
          ),
          SalesEventKind.stockAdded => (
            Icons.add_box_outlined,
            l10n.salesHistEventAdded(item),
            inventoryDeltaText(e.quantity),
            AppColors.ink,
          ),
          SalesEventKind.stockSet => (
            Icons.fact_check_outlined,
            l10n.salesHistEventSet(item),
            l10n.salesHistCountNow(e.quantity),
            AppColors.ink,
          ),
          SalesEventKind.stockMoved => (
            Icons.swap_horiz,
            l10n.salesHistEventMoved(item),
            inventoryDeltaText(e.quantity),
            AppColors.ink,
          ),
        };
    final detail = [
      time,
      if (person.isNotEmpty) l10n.salesHistByPerson(person),
      if (store.isNotEmpty) store,
    ].join(' · ');
    final struck =
        (e.kind == SalesEventKind.sale && e.saleVoided) ||
        e.kind == SalesEventKind.creditReverted;
    final tappable = e.opensSale || e.itemId.isNotEmpty;
    return _EventRow(
      key: ValueKey('hist-event-${e.kind.name}-${e.saleId}${e.itemId}-${e.at}'),
      icon: icon,
      title: title,
      detail: detail,
      amount: amount,
      color: color,
      struck: struck,
      tag: e.kind == SalesEventKind.sale && e.saleVoided
          ? l10n.salesHistVoidedTag
          : null,
      onTap: tappable ? () => _openEvent(e) : null,
    );
  }
}

// ---------------------------------------------------------------------------
// Pieces.
// ---------------------------------------------------------------------------

class _PeriodControls extends StatelessWidget {
  const _PeriodControls({
    required this.kind,
    required this.label,
    required this.current,
    required this.canGoNext,
    required this.onKind,
    required this.onPrevious,
    required this.onNext,
    required this.onPick,
  });

  final SalesPeriodKind kind;
  final String label;
  final String? current;
  final bool canGoNext;
  final ValueChanged<SalesPeriodKind> onKind;
  final VoidCallback onPrevious;
  final VoidCallback onNext;
  final VoidCallback onPick;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    ButtonSegment<SalesPeriodKind> segment(SalesPeriodKind k, String text) =>
        ButtonSegment(
          value: k,
          label: Text(
            text,
            key: Key('hist-kind-${k.name}'),
            maxLines: 1,
            softWrap: false,
            overflow: TextOverflow.fade,
          ),
        );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SegmentedButton<SalesPeriodKind>(
          segments: [
            segment(SalesPeriodKind.day, l10n.salesHistDay),
            segment(SalesPeriodKind.week, l10n.salesHistWeek),
            segment(SalesPeriodKind.month, l10n.salesHistMonth),
            segment(SalesPeriodKind.year, l10n.salesHistYear),
          ],
          selected: {kind},
          showSelectedIcon: false,
          onSelectionChanged: (set) => onKind(set.first),
          style: const ButtonStyle(visualDensity: VisualDensity.compact),
        ),
        const SizedBox(height: AppSpacing.sm),
        Row(
          children: [
            IconButton(
              key: const Key('hist-previous'),
              tooltip: l10n.salesHistPrevious,
              onPressed: onPrevious,
              icon: const Icon(Icons.chevron_left),
            ),
            Expanded(
              child: Semantics(
                button: true,
                label: l10n.salesHistPickDate,
                child: InkWell(
                  key: const Key('hist-pick-date'),
                  onTap: onPick,
                  borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      vertical: AppSpacing.xs,
                    ),
                    child: Column(
                      children: [
                        Row(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Flexible(
                              child: Text(
                                label,
                                key: const Key('hist-period-label'),
                                textAlign: TextAlign.center,
                                maxLines: 2,
                                style: const TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.w700,
                                  color: AppColors.ink,
                                ),
                              ),
                            ),
                            const SizedBox(width: AppSpacing.xs),
                            const Icon(
                              Icons.calendar_today_outlined,
                              size: 15,
                              color: AppColors.muted,
                            ),
                          ],
                        ),
                        if (current != null)
                          Text(
                            current!,
                            key: const Key('hist-period-current'),
                            style: const TextStyle(
                              fontSize: 12,
                              color: AppColors.muted,
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
            IconButton(
              key: const Key('hist-next'),
              tooltip: l10n.salesHistNext,
              onPressed: canGoNext ? onNext : null,
              icon: const Icon(Icons.chevron_right),
            ),
          ],
        ),
      ],
    );
  }
}

class _Card extends StatelessWidget {
  const _Card({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(AppSpacing.md),
    decoration: BoxDecoration(
      color: AppColors.paper,
      borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
      border: Border.all(color: AppColors.rule),
    ),
    child: child,
  );
}

class _SectionTitle extends StatelessWidget {
  const _SectionTitle(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: AppSpacing.sm),
    child: Text(
      text,
      style: const TextStyle(
        fontSize: 17,
        fontWeight: FontWeight.w700,
        color: AppColors.ink,
      ),
    ),
  );
}

class _Figures extends StatelessWidget {
  const _Figures({
    required this.summary,
    required this.previous,
    required this.kind,
    required this.showProfit,
  });

  final SalesHistorySummary summary;
  final SalesHistorySummary? previous;
  final SalesPeriodKind kind;
  final bool showProfit;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final s = summary;
    final before = previous;
    Widget? comparison;
    if (before != null) {
      final change = percentChange(s.totalCents, before.totalCents);
      comparison = Text(
        change == null
            ? l10n.salesHistNoComparison(kind.name)
            : l10n.salesHistVsPrevious(percentChangeText(change), kind.name),
        key: const Key('hist-kpi-change'),
        style: TextStyle(
          fontSize: 12.5,
          fontWeight: change == null ? FontWeight.w400 : FontWeight.w600,
          color: change == null || change.round() == 0
              ? AppColors.muted
              : change > 0
              ? AppColors.sage
              : AppColors.errorRed,
        ),
      );
    }
    final figures = <Widget>[
      InventoryFigure(
        key: const Key('hist-kpi-count'),
        value: '${s.salesCount}',
        label: l10n.salesHistSalesLabel(s.salesCount),
      ),
      InventoryFigure(
        key: const Key('hist-kpi-average'),
        value: formatLotCents(s.averageCents),
        label: l10n.salesHistAverage,
      ),
      InventoryFigure(
        key: const Key('hist-kpi-items'),
        value: '${s.itemsSold}',
        label: l10n.salesHistItemsLabel(s.itemsSold),
      ),
      if (showProfit)
        InventoryFigure(
          key: const Key('hist-kpi-profit'),
          value: formatLotCents(s.profitCents),
          label: l10n.inventoryProfit,
        ),
    ];
    return _Card(
      key: const Key('hist-figures'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.salesHistTotalSold,
            style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
          ),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              formatLotCents(s.totalCents),
              key: const Key('hist-kpi-total'),
              style: const TextStyle(
                fontSize: 24,
                fontWeight: FontWeight.w800,
                letterSpacing: -0.4,
                color: AppColors.ink,
              ),
            ),
          ),
          ?comparison,
          if (s.creditCents > 0)
            Text(
              l10n.invCreditSplit(
                formatLotCents(s.paidNowCents),
                formatLotCents(s.creditCents),
              ),
              key: const Key('hist-kpi-split'),
              style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
            ),
          if (s.creditCollectedCents > 0)
            Text(
              l10n.salesHistCollected(formatLotCents(s.creditCollectedCents)),
              key: const Key('hist-kpi-collected'),
              style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
            ),
          const Padding(
            padding: EdgeInsets.symmetric(vertical: AppSpacing.md),
            child: Divider(height: 1, color: AppColors.rule),
          ),
          // Two to a row: room for the longer French labels on a phone.
          for (var i = 0; i < figures.length; i += 2) ...[
            if (i > 0) const SizedBox(height: AppSpacing.md),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(child: figures[i]),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: i + 1 < figures.length
                      ? figures[i + 1]
                      : const SizedBox.shrink(),
                ),
              ],
            ),
          ],
          if (showProfit && s.linesWithoutCost > 0) ...[
            const SizedBox(height: AppSpacing.sm),
            Text(
              l10n.salesHistProfitPartial(s.linesWithoutCost),
              key: const Key('hist-kpi-profit-partial'),
              style: const TextStyle(fontSize: 12, color: AppColors.muted),
            ),
          ],
          if (s.voidedCount > 0) ...[
            const SizedBox(height: AppSpacing.sm),
            Text(
              l10n.salesHistVoidedCount(s.voidedCount),
              key: const Key('hist-kpi-voided'),
              style: const TextStyle(fontSize: 12, color: AppColors.muted),
            ),
          ],
        ],
      ),
    );
  }
}

class _ChartCard extends StatelessWidget {
  const _ChartCard({
    required this.title,
    required this.values,
    required this.selected,
    required this.barLabel,
    required this.axisLabel,
    required this.onSelect,
    required this.drillLabel,
    required this.onDrill,
  });

  final String title;
  final List<int> values;
  final int? selected;
  final String Function(int) barLabel;
  final String? Function(int) axisLabel;
  final ValueChanged<int> onSelect;
  final String? drillLabel;
  final ValueChanged<int> onDrill;

  static const _barsHeight = 120.0;
  static const _axisHeight = 18.0;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final n = values.length;
    final max = values.fold(0, (m, v) => v > m ? v : m);
    final pick = selected;
    final gap = n > 24 ? 2.0 : 4.0;
    return _Card(
      key: const Key('hist-chart'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: AppColors.ink,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          SizedBox(
            height: _barsHeight,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (var i = 0; i < n; i++)
                  Expanded(
                    child: Semantics(
                      button: true,
                      selected: pick == i,
                      label: l10n.salesHistBarValue(
                        barLabel(i),
                        formatLotCents(values[i]),
                      ),
                      excludeSemantics: true,
                      child: GestureDetector(
                        key: Key('hist-bar-$i'),
                        behavior: HitTestBehavior.opaque,
                        onTap: () => onSelect(i),
                        child: Padding(
                          padding: EdgeInsets.symmetric(horizontal: gap / 2),
                          child: Align(
                            alignment: Alignment.bottomCenter,
                            child: Container(
                              height: max == 0 || values[i] == 0
                                  ? 2
                                  : (values[i] / max * _barsHeight).clamp(
                                      3.0,
                                      _barsHeight,
                                    ),
                              decoration: BoxDecoration(
                                color: values[i] == 0
                                    ? AppColors.rule
                                    : pick == null || pick == i
                                    ? AppColors.cobalt
                                    : AppColors.cobalt.withValues(alpha: 0.35),
                                borderRadius: const BorderRadius.vertical(
                                  top: Radius.circular(2),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const Divider(height: 1, color: AppColors.rule),
          SizedBox(
            height: _axisHeight,
            child: LayoutBuilder(
              builder: (context, box) {
                const w = 44.0;
                final step = n == 0 ? 0.0 : box.maxWidth / n;
                return Stack(
                  children: [
                    for (var i = 0; i < n; i++)
                      if (axisLabel(i) case final text?)
                        Positioned(
                          left: ((i + 0.5) * step - w / 2).clamp(
                            0.0,
                            (box.maxWidth - w).clamp(0.0, double.infinity),
                          ),
                          width: w,
                          top: 3,
                          child: Text(
                            text,
                            textAlign: TextAlign.center,
                            maxLines: 1,
                            overflow: TextOverflow.clip,
                            style: const TextStyle(
                              fontSize: 10.5,
                              color: AppColors.muted,
                            ),
                          ),
                        ),
                  ],
                );
              },
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          if (pick != null && pick < n)
            Row(
              children: [
                Expanded(
                  child: Text(
                    l10n.salesHistBarValue(
                      barLabel(pick),
                      formatLotCents(values[pick]),
                    ),
                    key: const Key('hist-bar-value'),
                    style: const TextStyle(
                      fontSize: 13,
                      fontWeight: FontWeight.w700,
                      color: AppColors.ink,
                    ),
                  ),
                ),
                if (drillLabel != null)
                  TextButton(
                    key: const Key('hist-bar-open'),
                    onPressed: () => onDrill(pick),
                    child: Text(drillLabel!),
                  ),
              ],
            )
          else
            Text(
              l10n.salesHistChartHint,
              style: const TextStyle(fontSize: 12, color: AppColors.muted),
            ),
        ],
      ),
    );
  }
}

class _Share {
  const _Share({
    required this.id,
    required this.label,
    required this.caption,
    required this.cents,
  });

  final String id;
  final String label;
  final String caption;
  final int cents;
}

class _BreakdownCard extends StatelessWidget {
  const _BreakdownCard({super.key, required this.title, required this.rows});

  final String title;
  final List<_Share> rows;

  @override
  Widget build(BuildContext context) {
    final top = rows.fold(0, (m, r) => r.cents > m ? r.cents : m);
    return _Card(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: AppColors.ink,
            ),
          ),
          for (final r in rows) ...[
            const SizedBox(height: AppSpacing.md),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        r.label,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 14,
                          color: AppColors.ink,
                        ),
                      ),
                      Text(
                        r.caption,
                        style: const TextStyle(
                          fontSize: 12,
                          color: AppColors.muted,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: AppSpacing.md),
                Text(
                  formatLotCents(r.cents),
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
              ],
            ),
            const SizedBox(height: AppSpacing.xs),
            ClipRRect(
              borderRadius: BorderRadius.circular(2),
              child: SizedBox(
                height: 4,
                child: Stack(
                  children: [
                    const Positioned.fill(
                      child: ColoredBox(color: AppColors.parchment),
                    ),
                    FractionallySizedBox(
                      widthFactor: top == 0 ? 0 : (r.cents / top).clamp(0, 1),
                      child: const ColoredBox(color: AppColors.cobaltMid),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _DayHeading extends StatelessWidget {
  const _DayHeading({super.key, required this.text});

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: AppSpacing.md, bottom: AppSpacing.xs),
    child: Text(
      text,
      style: const TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w700,
        letterSpacing: 0.2,
        color: AppColors.muted,
      ),
    ),
  );
}

class _EventRow extends StatelessWidget {
  const _EventRow({
    super.key,
    required this.icon,
    required this.title,
    required this.detail,
    required this.amount,
    required this.color,
    required this.struck,
    required this.tag,
    required this.onTap,
  });

  final IconData icon;
  final String title;
  final String detail;
  final String amount;
  final Color color;
  final bool struck;
  final String? tag;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final row = Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.xs),
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.md,
        vertical: AppSpacing.sm,
      ),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
        border: Border.all(color: AppColors.rule),
      ),
      child: Row(
        children: [
          Icon(icon, size: 20, color: AppColors.muted),
          const SizedBox(width: AppSpacing.md),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  maxLines: 2,
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
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text(
                amount,
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  color: color,
                  decoration: struck ? TextDecoration.lineThrough : null,
                ),
              ),
              if (tag != null)
                InventoryChip(label: tag!, color: AppColors.errorRed),
            ],
          ),
        ],
      ),
    );
    if (onTap == null) return row;
    return PressableScale(onTap: onTap!, scale: 0.99, child: row);
  }
}
