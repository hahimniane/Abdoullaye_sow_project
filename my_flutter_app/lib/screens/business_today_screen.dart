import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../l10n/app_localizations.dart';
import '../providers/auth_provider.dart';
import '../services/business_today.dart';
import '../services/business_today_service.dart';
import '../services/notification_routing.dart' show BusinessHomeArguments;
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../utils/date_display.dart';
import '../widgets/app_snackbars.dart';
import 'business_transport_screen.dart';
import 'containers_screen.dart';
import 'inventory_screen.dart';
import 'invoices_screen.dart';
import 'lot_ledger_screen.dart';
import 'parking_month_end_screen.dart';

/// Opens the place a "Needs attention" row is about, with the screens and
/// routes the phone already has (the console's tabs, by their phone twins).
void openTodayAttentionItem(
  BuildContext context,
  TodayAttentionItem item,
  String businessId,
) {
  final navigator = Navigator.of(context);
  void push(Widget screen) =>
      navigator.push(MaterialPageRoute<void>(builder: (_) => screen));
  switch (item.tab) {
    case TodayTab.containers:
      push(
        ContainersScreen(
          businessId: businessId,
          entry: switch (item.view) {
            TodayContainersView.requests => ContainersEntry.requests,
            TodayContainersView.waiting => ContainersEntry.waiting,
            TodayContainersView.none => ContainersEntry.containers,
          },
        ),
      );
    case TodayTab.barrels:
      navigator.pushNamed(
        '/business-home',
        arguments: const BusinessHomeArguments(category: 'barrels'),
      );
    case TodayTab.freight:
      navigator.pushNamed(
        '/business-home',
        arguments: const BusinessHomeArguments(category: 'freight'),
      );
    case TodayTab.purchases:
      navigator.pushNamed('/purchase-management');
    case TodayTab.transport:
      push(BusinessTransportScreen(businessId: businessId));
    case TodayTab.cases:
      navigator.pushNamed('/business-support');
    case TodayTab.invoices:
      push(InvoicesScreen(businessId: businessId));
    case TodayTab.parking:
      push(ParkingMonthEndScreen(businessId: businessId));
    case TodayTab.inventory:
      push(
        InventoryScreen(
          businessId: businessId,
          access: context.read<AuthProvider>().inventoryAccess,
        ),
      );
  }
}

/// The business Today page on the phone: this month's tiles, what is waiting,
/// the lot-ledger changes to look at, the containers in progress and the
/// money. The figures are counted on the server (`getBusinessOverview`) and
/// already cut to what this person may see; the screen lays out whatever
/// arrives and nothing else, so a parking lot never sees shipping tiles.
///
/// Everything is worked out once per answer ([TodayViewModel]); the spinner
/// always resolves (a timeout), a refresh keeps the last figures on screen,
/// and a failure offers Try again rather than a wrong zero.
class BusinessTodayScreen extends StatefulWidget {
  const BusinessTodayScreen({
    super.key,
    required this.businessId,
    this.showLedgerAlerts = false,
    this.api,
    this.onOpenAttention,
    this.onOpenContainers,
    this.onOpenLedger,
    this.timeout = const Duration(seconds: 20),
  });

  final String businessId;

  /// The business runs parking and this person holds the ledger permission
  /// ([todayShowsLedgerAlerts]); the unacknowledged changes are read only then.
  final bool showLedgerAlerts;

  /// Where the figures come from; the real callable and query when null.
  final BusinessTodayApi? api;

  /// Where a row goes; the app's own screens when null.
  final void Function(BuildContext context, TodayAttentionItem item)?
  onOpenAttention;
  final void Function(BuildContext context)? onOpenContainers;
  final void Function(BuildContext context)? onOpenLedger;
  final Duration timeout;

  @override
  State<BusinessTodayScreen> createState() => _BusinessTodayScreenState();
}

class _BusinessTodayScreenState extends State<BusinessTodayScreen> {
  late final BusinessTodayApi _api = widget.api ?? FirebaseBusinessTodayApi();

  BusinessTodayResponse? _response;
  TodayViewModel? _vm;
  bool _loading = true;
  bool _refreshFailed = false;
  int _attempt = 0;

  List<TodayLedgerEvent> _events = const [];
  final Set<String> _dismissed = {};
  final Set<String> _dismissing = {};
  List<TodayLedgerEvent> _alerts = const [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant BusinessTodayScreen old) {
    super.didUpdateWidget(old);
    if (old.businessId != widget.businessId) {
      _vm = null;
      _response = null;
      _events = const [];
      _alerts = const [];
      _dismissed.clear();
      _load();
    }
  }

  Future<List<TodayLedgerEvent>> _readAlerts() async {
    if (!widget.showLedgerAlerts) return const [];
    try {
      return await _api.ledgerAlerts(widget.businessId).timeout(widget.timeout);
    } catch (_) {
      // The alerts are a bonus; a failed read must not hide the figures.
      return const [];
    }
  }

  Future<void> _load({bool refresh = false}) async {
    final attempt = ++_attempt;
    setState(() {
      _loading = true;
      _refreshFailed = false;
    });
    try {
      final results = await Future.wait<Object?>([
        _api.load(widget.businessId, refresh: refresh).timeout(widget.timeout),
        _readAlerts(),
      ]);
      if (!mounted || attempt != _attempt) return;
      final response = results[0] as BusinessTodayResponse;
      final today = response.today;
      setState(() {
        _response = response;
        // An answer with no figures at all reads as a failure, not an empty page.
        _vm = today == null ? null : TodayViewModel(today);
        _events = results[1] as List<TodayLedgerEvent>;
        _dismissed.clear();
        _alerts = todayLedgerAlerts(_events);
      });
    } catch (_) {
      if (!mounted || attempt != _attempt) return;
      setState(() {
        // With figures already on screen they stay; otherwise Try again.
        if (_vm != null) _refreshFailed = true;
      });
    } finally {
      if (mounted && attempt == _attempt) setState(() => _loading = false);
    }
  }

  Future<void> _dismiss(String eventId) async {
    if (_dismissing.contains(eventId)) return;
    setState(() => _dismissing.add(eventId));
    try {
      await _api.dismissLedgerEvent(eventId).timeout(widget.timeout);
      if (!mounted) return;
      setState(() {
        _dismissed.add(eventId);
        _alerts = todayLedgerAlerts(_events, dismissed: _dismissed);
      });
    } catch (_) {
      if (!mounted) return;
      showErrorSnackBar(
        context,
        AppLocalizations.of(context)!.tdyDismissFailed,
      );
    } finally {
      if (mounted) setState(() => _dismissing.remove(eventId));
    }
  }

  void _openAttention(TodayAttentionItem item) {
    final open = widget.onOpenAttention;
    if (open != null) return open(context, item);
    openTodayAttentionItem(context, item, widget.businessId);
  }

  void _openContainers() {
    final open = widget.onOpenContainers;
    if (open != null) return open(context);
    openTodayAttentionItem(
      context,
      const TodayAttentionItem(
        key: 'containers',
        count: null,
        amountCents: null,
        tab: TodayTab.containers,
        view: TodayContainersView.none,
      ),
      widget.businessId,
    );
  }

  void _openLedger() {
    final open = widget.onOpenLedger;
    if (open != null) return open(context);
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => LotLedgerScreen(businessId: widget.businessId),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final vm = _vm;
    Widget body;
    if (vm == null && _loading) {
      body = const Center(
        key: Key('today-loading'),
        child: CircularProgressIndicator(),
      );
    } else if (vm == null) {
      body = _TodayFailed(onRetry: _load);
    } else {
      body = RefreshIndicator(
        onRefresh: () => _load(refresh: true),
        child: _TodayContent(
          vm: vm,
          response: _response!,
          alerts: _alerts,
          dismissing: _dismissing,
          refreshFailed: _refreshFailed,
          showLedgerAlerts: widget.showLedgerAlerts,
          onOpenAttention: _openAttention,
          onOpenContainers: _openContainers,
          onOpenLedger: _openLedger,
          onDismiss: _dismiss,
        ),
      );
    }
    return Scaffold(
      backgroundColor: AppColors.cream,
      appBar: AppBar(
        title: Text(l10n.tdyTitle),
        actions: [
          IconButton(
            key: const Key('today-refresh'),
            tooltip: l10n.tdyRefresh,
            icon: const Icon(Icons.refresh),
            onPressed: _loading ? null : () => _load(refresh: true),
          ),
        ],
      ),
      body: SafeArea(child: body),
    );
  }
}

class _TodayFailed extends StatelessWidget {
  const _TodayFailed({required this.onRetry});

  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              l10n.tdyLoadFailed,
              key: const Key('today-failed'),
              textAlign: TextAlign.center,
              style: const TextStyle(color: AppColors.muted, height: 1.4),
            ),
            const SizedBox(height: AppSpacing.lg),
            OutlinedButton.icon(
              key: const Key('today-retry'),
              onPressed: onRetry,
              icon: const Icon(Icons.refresh),
              label: Text(l10n.tdyRetry),
            ),
          ],
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Words: a key from the pure half becomes the phone's language.
// ---------------------------------------------------------------------------

String _tileLabel(AppLocalizations l, TodayTileKey key) => switch (key) {
  TodayTileKey.packages => l.tdyTilePackages,
  TodayTileKey.barrels => l.tdyTileBarrels,
  TodayTileKey.carsShipped => l.tdyTileCarsShipped,
  TodayTileKey.containers => l.tdyTileContainers,
  TodayTileKey.collected => l.tdyTileCollected,
  TodayTileKey.owed => l.tdyTileOwed,
  TodayTileKey.shopSales => l.tdyTileShopSales,
  TodayTileKey.inLot => l.tdyTileInLot,
  TodayTileKey.listings => l.tdyTileListings,
};

String _noteLabel(AppLocalizations l, TodayNoteKey key) => switch (key) {
  TodayNoteKey.openNow => l.tdyNoteOpenNow,
  TodayNoteKey.payments => l.tdyNotePayments,
  TodayNoteKey.spaces => l.tdyNoteSpaces,
};

String _attentionLabel(AppLocalizations l, String key) => switch (key) {
  'packageRequests' => l.tdyAttPackageRequests,
  'waitingPackages' => l.tdyAttWaitingPackages,
  'containersLoading' => l.tdyAttContainersLoading,
  'barrelOrders' => l.tdyAttBarrelOrders,
  'freightOrders' => l.tdyAttFreightOrders,
  'carPurchases' => l.tdyAttCarPurchases,
  'transportRequests' => l.tdyAttTransport,
  'supportRequests' => l.tdyAttSupport,
  'packagesOwed' => l.tdyAttPackagesOwed,
  'openInvoices' => l.tdyAttOpenInvoices,
  'parkingOwed' => l.tdyAttParkingOwed,
  'shopCredit' => l.tdyAttShopCredit,
  _ => key,
};

String _serviceLabel(AppLocalizations l, String key) => switch (key) {
  'packages' => l.tdySvcPackages,
  'invoices' => l.tdySvcInvoices,
  'lot' => l.tdySvcLot,
  'parking' => l.tdySvcParking,
  'shop' => l.tdySvcShop,
  'online' => l.tdySvcOnline,
  _ => key,
};

String _methodLabel(AppLocalizations l, String key) => switch (key) {
  'cash' => l.tdyMethodCash,
  'zelle' => l.tdyMethodZelle,
  'cashapp' => l.tdyMethodCashApp,
  'venmo' => l.tdyMethodVenmo,
  'check' => l.tdyMethodCheck,
  'card_in_person' => l.tdyMethodCardInPerson,
  'online' => l.tdyMethodOnline,
  _ => l.tdyMethodOther,
};

String _owedLabel(AppLocalizations l, TodayOwedKey key) => switch (key) {
  TodayOwedKey.packages => l.tdySvcPackages,
  TodayOwedKey.invoices => l.tdySvcInvoices,
  TodayOwedKey.parking => l.tdySvcParking,
  TodayOwedKey.shopCredit => l.tdyOwedShopCredit,
};

String _ledgerTitle(AppLocalizations l, TodayLedgerTitle title) =>
    switch (title) {
      TodayLedgerTitle.parkingLinked => l.tdyLedgerLinked,
      TodayLedgerTitle.parkingUnlinked => l.tdyLedgerUnlinked,
      TodayLedgerTitle.staffRepaid => l.tdyLedgerRepaid,
      TodayLedgerTitle.staffRepaymentVoided => l.tdyLedgerRepaymentVoided,
      TodayLedgerTitle.entryVoided => l.tdyLedgerVoided,
      TodayLedgerTitle.paymentReceived => l.tdyLedgerPaid,
      TodayLedgerTitle.entryEdited => l.tdyLedgerEdited,
    };

// ---------------------------------------------------------------------------
// The page.
// ---------------------------------------------------------------------------

class _TodayContent extends StatelessWidget {
  const _TodayContent({
    required this.vm,
    required this.response,
    required this.alerts,
    required this.dismissing,
    required this.refreshFailed,
    required this.showLedgerAlerts,
    required this.onOpenAttention,
    required this.onOpenContainers,
    required this.onOpenLedger,
    required this.onDismiss,
  });

  final TodayViewModel vm;
  final BusinessTodayResponse response;
  final List<TodayLedgerEvent> alerts;
  final Set<String> dismissing;
  final bool refreshFailed;
  final bool showLedgerAlerts;
  final ValueChanged<TodayAttentionItem> onOpenAttention;
  final VoidCallback onOpenContainers;
  final VoidCallback onOpenLedger;
  final ValueChanged<String> onDismiss;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final today = vm.today;
    final locale = dateLocaleOf(context);
    final language = locale.startsWith('fr') ? 'fr' : 'en';
    final month = todayMonthStart(today.month);
    final previous = todayMonthStart(today.previousMonth);
    final computedAt = response.computedAt;
    final containers = today.containers;
    // Some read failed on the server, or the money is hidden because it did.
    final figuresPartial =
        !response.complete ||
        (today.unavailable.isNotEmpty && today.money == null);

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(AppSpacing.lg),
      children: [
        Text(
          l10n.tdyThisMonth.toUpperCase(),
          style: const TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w800,
            letterSpacing: 0.6,
            color: AppColors.muted,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          month == null ? '—' : displayMonthYear(month, locale),
          key: const Key('today-month'),
          style: const TextStyle(
            fontSize: 26,
            fontWeight: FontWeight.w800,
            color: AppColors.ink,
          ),
        ),
        if (previous != null) ...[
          const SizedBox(height: 2),
          Text(
            l10n.tdyComparedWith(displayMonthYear(previous, locale)),
            style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
          ),
        ],
        if (computedAt != null) ...[
          const SizedBox(height: 2),
          Text(
            l10n.tdyUpdatedAt(displayTime(computedAt, locale)),
            key: const Key('today-updated'),
            style: const TextStyle(fontSize: 12, color: AppColors.muted),
          ),
        ],
        const SizedBox(height: AppSpacing.lg),
        if (refreshFailed)
          _Note(key: const Key('today-refresh-failed'), l10n.tdyRefreshFailed),
        if (figuresPartial)
          _Note(
            key: const Key('today-figures-partial'),
            l10n.tdyFiguresPartial,
          ),
        if (vm.tiles.isNotEmpty) ...[
          _TileGrid(tiles: vm.tiles, language: language),
          const SizedBox(height: AppSpacing.lg),
        ],
        _Card(
          icon: Icons.checklist,
          title: l10n.tdyNeedsAttention,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final item in vm.attention)
                _AttentionRow(
                  item: item,
                  language: language,
                  onTap: () => onOpenAttention(item),
                ),
              if (vm.attention.isEmpty && alerts.isEmpty)
                Text(
                  l10n.tdyNothingWaiting,
                  key: const Key('today-nothing-waiting'),
                  style: const TextStyle(color: AppColors.muted),
                ),
              if (showLedgerAlerts)
                for (final event in alerts)
                  _LedgerRow(
                    event: event,
                    locale: locale,
                    busy: dismissing.contains(event.id),
                    onOpen: onOpenLedger,
                    onDismiss: () => onDismiss(event.id),
                  ),
            ],
          ),
        ),
        if (containers != null) ...[
          const SizedBox(height: AppSpacing.lg),
          _Card(
            icon: Icons.view_in_ar_outlined,
            title: l10n.tdyContainersTitle,
            action: TextButton(
              key: const Key('today-open-containers'),
              onPressed: onOpenContainers,
              child: Text(l10n.tdyContainersOpen),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final c in containers.list)
                  _ContainerRow(
                    container: c,
                    locale: locale,
                    language: language,
                    onTap: onOpenContainers,
                  ),
                if (containers.list.isEmpty)
                  Text(
                    l10n.tdyContainersEmpty,
                    style: const TextStyle(color: AppColors.muted),
                  ),
                if (containers.more)
                  TextButton(
                    key: const Key('today-containers-more'),
                    onPressed: onOpenContainers,
                    child: Text(l10n.tdyContainersMore),
                  ),
              ],
            ),
          ),
        ],
        if (today.money != null) ...[
          const SizedBox(height: AppSpacing.lg),
          _MoneyCard(vm: vm, language: language),
        ],
      ],
    );
  }
}

class _Note extends StatelessWidget {
  const _Note(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: AppSpacing.md),
    child: Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.parchment,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.rule),
      ),
      child: Text(
        text,
        style: const TextStyle(fontSize: 13, height: 1.4, color: AppColors.ink),
      ),
    ),
  );
}

/// A card: content never touches its edge (16 px inside).
class _Card extends StatelessWidget {
  const _Card({
    required this.icon,
    required this.title,
    required this.child,
    this.action,
  });

  final IconData icon;
  final String title;
  final Widget child;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Wrap(
            alignment: WrapAlignment.spaceBetween,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Icon(icon, size: 18, color: AppColors.cobaltDeep),
                  const SizedBox(width: AppSpacing.sm),
                  Flexible(
                    child: Text(
                      title,
                      style: const TextStyle(
                        fontSize: 16,
                        fontWeight: FontWeight.w800,
                        color: AppColors.ink,
                      ),
                    ),
                  ),
                ],
              ),
              ?action,
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          child,
        ],
      ),
    );
  }
}

// -- Tiles ------------------------------------------------------------------

class _TileGrid extends StatelessWidget {
  const _TileGrid({required this.tiles, required this.language});

  final List<TodayTile> tiles;
  final String language;

  @override
  Widget build(BuildContext context) {
    // Two to a row, the pair as tall as its taller tile.
    final rows = <Widget>[];
    for (var i = 0; i < tiles.length; i += 2) {
      final pair = tiles.skip(i).take(2).toList();
      rows.add(
        IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Expanded(
                child: _TileCard(tile: pair[0], language: language),
              ),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: pair.length > 1
                    ? _TileCard(tile: pair[1], language: language)
                    : const SizedBox.shrink(),
              ),
            ],
          ),
        ),
      );
      if (i + 2 < tiles.length) rows.add(const SizedBox(height: AppSpacing.md));
    }
    return Column(children: rows);
  }
}

class _TileCard extends StatelessWidget {
  const _TileCard({required this.tile, required this.language});

  final TodayTile tile;
  final String language;

  Color get _figureColor => switch (tile.tone) {
    TodayTone.good => AppColors.sage,
    TodayTone.attention => AppColors.warn,
    _ => AppColors.ink,
  };

  String _value(int v, TodayTileKind kind) => kind == TodayTileKind.money
      ? formatTodayMoney(v, language: language, whole: true)
      : formatTodayCount(v, language: language);

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final change = tile.compares
        ? formatTodayChange(tile.change, language: language)
        : '';
    final tone = todayChangeTone(tile.change);
    final changeColor = switch (tone) {
      TodayChangeTone.up => AppColors.sage,
      TodayChangeTone.down => AppColors.errorRed,
      TodayChangeTone.flat => AppColors.muted,
    };
    const small = TextStyle(fontSize: 12, height: 1.3, color: AppColors.muted);
    final note = tile.note;
    return Container(
      key: Key('today-tile-${tile.key.name}'),
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
            _tileLabel(l10n, tile.key),
            style: const TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w600,
              color: AppColors.muted,
            ),
          ),
          const SizedBox(height: AppSpacing.xs),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              _value(tile.value, tile.kind),
              key: Key('today-figure-${tile.key.name}'),
              style: TextStyle(
                fontSize: 24,
                fontWeight: FontWeight.w800,
                color: _figureColor,
              ),
            ),
          ),
          if (tile.compares) ...[
            const SizedBox(height: AppSpacing.xs),
            if (change.isNotEmpty)
              Text.rich(
                TextSpan(
                  children: [
                    TextSpan(
                      text: change,
                      style: TextStyle(
                        fontWeight: FontWeight.w700,
                        color: changeColor,
                      ),
                    ),
                    TextSpan(text: ' ${l10n.tdyVsLastMonth}'),
                  ],
                ),
                style: small,
              )
            else
              Text(l10n.tdyNoLastMonth, style: small),
          ],
          if (note != null) ...[
            const SizedBox(height: AppSpacing.xs),
            Text(
              '${_noteLabel(l10n, note.key)} ${_value(note.value, note.kind)}',
              style: small,
            ),
          ],
        ],
      ),
    );
  }
}

// -- Needs attention ----------------------------------------------------------

class _AttentionRow extends StatelessWidget {
  const _AttentionRow({
    required this.item,
    required this.language,
    required this.onTap,
  });

  final TodayAttentionItem item;
  final String language;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final count = item.count;
    final amount = item.amountCents;
    return InkWell(
      key: Key('today-attention-${item.key}'),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
        child: Row(
          children: [
            Expanded(
              child: Text(
                _attentionLabel(l10n, item.key),
                style: const TextStyle(
                  fontSize: 14.5,
                  fontWeight: FontWeight.w600,
                  color: AppColors.ink,
                ),
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            if (count != null && count > 0)
              Text(
                formatTodayCount(count, language: language),
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w800,
                  color: AppColors.ink,
                ),
              ),
            if (amount != null && amount > 0) ...[
              if (count != null && count > 0)
                const SizedBox(width: AppSpacing.sm),
              Text(
                formatTodayMoney(amount, language: language),
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w700,
                  color: AppColors.warn,
                ),
              ),
            ],
            const Icon(Icons.chevron_right, size: 20, color: AppColors.muted),
          ],
        ),
      ),
    );
  }
}

class _LedgerRow extends StatelessWidget {
  const _LedgerRow({
    required this.event,
    required this.locale,
    required this.busy,
    required this.onOpen,
    required this.onDismiss,
  });

  final TodayLedgerEvent event;
  final String locale;
  final bool busy;
  final VoidCallback onOpen;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final parts = <String>[
      if (event.summary.isNotEmpty) event.summary,
      if (event.byStaffId.isNotEmpty) l10n.tdyLedgerByStaff,
      if (event.at != null) displayDateTime(event.at!, locale),
    ];
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: InkWell(
              key: Key('today-ledger-${event.id}'),
              onTap: onOpen,
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      _ledgerTitle(l10n, todayLedgerTitle(event)),
                      style: const TextStyle(
                        fontSize: 14.5,
                        fontWeight: FontWeight.w700,
                        color: AppColors.ink,
                      ),
                    ),
                    if (parts.isNotEmpty)
                      Text(
                        parts.join(' · '),
                        style: const TextStyle(
                          fontSize: 12,
                          height: 1.35,
                          color: AppColors.muted,
                        ),
                      ),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(width: AppSpacing.sm),
          TextButton(
            key: Key('today-ledger-dismiss-${event.id}'),
            onPressed: busy ? null : onDismiss,
            child: Text(l10n.tdyDismiss),
          ),
        ],
      ),
    );
  }
}

// -- Containers ---------------------------------------------------------------

class _ContainerRow extends StatelessWidget {
  const _ContainerRow({
    required this.container,
    required this.locale,
    required this.language,
    required this.onTap,
  });

  final TodayContainer container;
  final String locale;
  final String language;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final shipped = container.status == 'shipped';
    final sailed = container.sailedAtMs;
    final detail = <String>[
      if (container.destination.isNotEmpty) container.destination,
      '${l10n.tdyContainerPieces} ${formatTodayCount(container.pieces, language: language)}',
      if (shipped && sailed != null)
        '${l10n.tdyContainerSailed} ${displayDate(DateTime.fromMillisecondsSinceEpoch(sailed), locale)}',
    ];
    return InkWell(
      key: Key('today-container-${container.id}'),
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    container.name.isEmpty ? '—' : container.name,
                    style: const TextStyle(
                      fontSize: 14.5,
                      fontWeight: FontWeight.w700,
                      color: AppColors.ink,
                    ),
                  ),
                  Text(
                    detail.join(' · '),
                    style: const TextStyle(
                      fontSize: 12,
                      height: 1.35,
                      color: AppColors.muted,
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: AppSpacing.sm),
            Container(
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.sm,
                vertical: 3,
              ),
              decoration: BoxDecoration(
                color: shipped ? AppColors.mist : AppColors.parchment,
                borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
              ),
              child: Text(
                shipped ? l10n.ctrStatusShipped : l10n.ctrStatusLoading,
                style: const TextStyle(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w700,
                  color: AppColors.cobaltDeep,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// -- Money --------------------------------------------------------------------

class _MoneyCard extends StatelessWidget {
  const _MoneyCard({required this.vm, required this.language});

  final TodayViewModel vm;
  final String language;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final money = vm.today.money!;
    final owedTotal = vm.today.owed.totalCents;
    return _Card(
      icon: Icons.payments_outlined,
      title: l10n.tdyMoneyTitle,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _LabelValue(
            label: l10n.tdyTotal,
            value: formatTodayMoney(vm.money.totalCents, language: language),
            valueKey: const Key('today-money-total'),
            strong: true,
          ),
          const SizedBox(height: AppSpacing.md),
          if (vm.money.totalCents > 0) ...[
            _MoneyBars(
              title: l10n.tdyByService,
              rows: vm.money.services,
              label: (k) => _serviceLabel(l10n, k),
              language: language,
            ),
            const SizedBox(height: AppSpacing.md),
            _MoneyBars(
              title: l10n.tdyByMethod,
              rows: vm.money.methods,
              label: (k) => _methodLabel(l10n, k),
              language: language,
            ),
          ] else
            Text(
              l10n.tdyNoPayments,
              style: const TextStyle(color: AppColors.muted),
            ),
          const Divider(height: AppSpacing.xl),
          _LabelValue(
            label: l10n.tdyLastMonth,
            value: formatTodayMoney(
              money.previous.totalCents,
              language: language,
            ),
          ),
          if (owedTotal != null) ...[
            const SizedBox(height: AppSpacing.sm),
            _LabelValue(
              label: l10n.tdyStillOwed,
              value: formatTodayMoney(owedTotal, language: language),
              valueKey: const Key('today-owed-total'),
            ),
            for (final row in vm.owedRows)
              Padding(
                padding: const EdgeInsets.only(
                  left: AppSpacing.md,
                  top: AppSpacing.xs,
                ),
                child: _LabelValue(
                  label: _owedLabel(l10n, row.key),
                  value: formatTodayMoney(row.cents, language: language),
                  muted: true,
                ),
              ),
          ],
          const SizedBox(height: AppSpacing.md),
          Text(
            l10n.tdyMoneyHint,
            style: const TextStyle(
              fontSize: 12,
              height: 1.4,
              color: AppColors.muted,
            ),
          ),
          if (!vm.moneyComplete) ...[
            const SizedBox(height: AppSpacing.md),
            _Note(key: const Key('today-money-partial'), l10n.tdyPartial),
          ],
        ],
      ),
    );
  }
}

class _LabelValue extends StatelessWidget {
  const _LabelValue({
    required this.label,
    required this.value,
    this.valueKey,
    this.strong = false,
    this.muted = false,
  });

  final String label;
  final String value;
  final Key? valueKey;
  final bool strong;
  final bool muted;

  @override
  Widget build(BuildContext context) {
    final color = muted ? AppColors.muted : AppColors.ink;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Text(
            label,
            style: TextStyle(
              fontSize: strong ? 15 : 13.5,
              fontWeight: strong ? FontWeight.w700 : FontWeight.w500,
              color: color,
            ),
          ),
        ),
        const SizedBox(width: AppSpacing.sm),
        Text(
          value,
          key: valueKey,
          style: TextStyle(
            fontSize: strong ? 18 : 13.5,
            fontWeight: FontWeight.w800,
            color: color,
          ),
        ),
      ],
    );
  }
}

class _MoneyBars extends StatelessWidget {
  const _MoneyBars({
    required this.title,
    required this.rows,
    required this.label,
    required this.language,
  });

  final String title;
  final List<TodayMoneyRow> rows;
  final String Function(String key) label;
  final String language;

  @override
  Widget build(BuildContext context) {
    if (rows.isEmpty) return const SizedBox.shrink();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          title,
          style: const TextStyle(
            fontSize: 12.5,
            fontWeight: FontWeight.w800,
            color: AppColors.muted,
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        for (final row in rows)
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.sm),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _LabelValue(
                  label: label(row.key),
                  value: formatTodayMoney(row.cents, language: language),
                ),
                const SizedBox(height: 4),
                ClipRRect(
                  borderRadius: BorderRadius.circular(3),
                  child: LinearProgressIndicator(
                    value: row.percent / 100,
                    minHeight: 6,
                    backgroundColor: AppColors.parchment,
                    color: AppColors.cobalt,
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}
