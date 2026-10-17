import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/eastern_clock.dart';
import '../services/inventory.dart';
import '../services/inventory_context.dart';
import '../services/inventory_credit.dart';
import '../services/inventory_service.dart';
import '../services/inventory_stores.dart';
import '../services/inventory_team.dart';
import '../services/lot_ledger.dart' show formatLotCents;
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/date_display.dart';
import '../widgets/inventory_widgets.dart';
import '../widgets/lot_sheets.dart';
import 'inventory_credit_sheet.dart';

/// Credit owed: every credit sale still to be collected, overdue first, with
/// what is owed in total. Staff start on their own ("Mine"); the owner on
/// everyone's. Someone who sees every store of a multi-store business can
/// narrow to one store; staff tied to one store read only that store's (the
/// same reach as the sales list). Tapping a row opens its credit sheet.
class InventoryCreditScreen extends StatefulWidget {
  const InventoryCreditScreen({
    super.key,
    required this.businessId,
    this.access = const InventoryAccess.owner(),
    this.source,
    this.creditSource,
    this.service = const InventoryService(),
    this.currentUserId,
    this.clock = DateTime.now,
  });

  final String businessId;
  final InventoryAccess access;
  final InventorySource? source;
  final InventoryCreditSource? creditSource;
  final InventoryService service;
  final String? currentUserId;
  final DateTime Function() clock;

  @override
  State<InventoryCreditScreen> createState() => _InventoryCreditScreenState();
}

class _InventoryCreditScreenState extends State<InventoryCreditScreen> {
  late final InventorySource _source =
      widget.source ?? FirestoreInventorySource();
  late final String _me = widget.currentUserId ?? inventoryCurrentUserId();

  late final InventoryContextWatcher _watcher = InventoryContextWatcher(
    source: _source,
    businessId: widget.businessId,
    access: widget.access,
    watchCategories: false,
    watchBrands: false,
    onChange: () {
      if (!mounted) return;
      setState(() {});
      _listen();
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

  StreamSubscription<List<InventorySale>>? _sub;
  String? _key;
  Timer? _safety;
  List<InventorySale> _credits = const [];
  bool _loaded = false;
  bool _failed = false;

  late String _collector = inventoryCreditDefaultCollector(
    isOwner: widget.access.isOwner,
    currentUserId: _me,
  );
  String _storeFilter = '';

  @override
  void initState() {
    super.initState();
    _watcher.start();
    _team.start();
    _listen();
  }

  @override
  void dispose() {
    _safety?.cancel();
    _sub?.cancel();
    _watcher.dispose();
    _team.dispose();
    super.dispose();
  }

  ({bool ready, bool none, String storeId}) get _scope => inventorySalesScope(
    widget.access,
    _watcher.context,
    storesLoaded: _watcher.storesLoaded,
  );

  /// Reads the open credits once the person's reach is known; a list that
  /// never answers stops spinning after a while.
  void _listen({bool force = false}) {
    _safety ??= Timer(const Duration(seconds: 15), () {
      if (mounted && !_loaded) setState(() => _loaded = true);
    });
    final scope = _scope;
    if (!scope.ready) return;
    final key = scope.none ? '!' : scope.storeId;
    if (!force && key == _key) return;
    _key = key;
    _sub?.cancel();
    _sub = null;
    if (scope.none) {
      _safety?.cancel();
      setState(() {
        _credits = const [];
        _loaded = true;
      });
      return;
    }
    try {
      _sub = (widget.creditSource ?? FirestoreInventoryCreditSource())
          .watchOpenCredits(widget.businessId, storeId: scope.storeId)
          .listen(
            (rows) {
              if (!mounted) return;
              _safety?.cancel();
              setState(() {
                _credits = rows;
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
          );
    } catch (_) {
      _safety?.cancel();
      _loaded = true;
      _failed = true;
    }
  }

  Future<void> _open(InventorySale sale) async {
    await showInventoryCreditSheet(
      context,
      businessId: widget.businessId,
      sale: sale,
      staff: _team.people,
      service: widget.service,
      creditSource: widget.creditSource,
      paymentsStoreId: _scope.storeId,
      currentUserId: _me,
      clock: widget.clock,
    );
  }

  String _name(String id) {
    final name = inventoryStaffName(_team.people, id);
    return name.isEmpty ? id : name;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    final today = shopToday(widget.clock());
    final stores = _watcher.context;
    final shown = inventoryOpenCredits(
      _credits,
      collectorId: _collector,
      storeId: stores.viewerSeesAll ? _storeFilter : '',
      today: today,
    );
    final totals = inventoryCreditTotals(shown, today: today);
    // Mine, everyone, then each other collector with something open.
    final collectors = [
      for (final id in inventoryCreditCollectors(_credits))
        if (id != _me) id,
    ];
    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          InventoryHeader(title: l10n.invCreditOwedTitle),
          Padding(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.lg,
              AppSpacing.md,
              AppSpacing.lg,
              0,
            ),
            child: InventoryChoiceChips(
              keyPrefix: 'credit-collector',
              options: [
                if (_me.isNotEmpty) (id: _me, label: l10n.invCreditFilterMine),
                (id: '', label: l10n.invCreditFilterEveryone),
                for (final id in collectors) (id: id, label: _name(id)),
              ],
              selected: _collector,
              onSelected: (id) => setState(() => _collector = id),
            ),
          ),
          if (stores.viewerSeesAll)
            Padding(
              padding: const EdgeInsets.fromLTRB(
                AppSpacing.lg,
                AppSpacing.sm,
                AppSpacing.lg,
                0,
              ),
              child: InventoryChoiceChips(
                keyPrefix: 'credit-store',
                options: inventoryStoreChoices(l10n, stores),
                selected: _storeFilter,
                onSelected: (id) => setState(() => _storeFilter = id),
              ),
            ),
          Expanded(
            child: !_loaded
                ? const Center(child: CircularProgressIndicator())
                : _failed && _credits.isEmpty
                ? Padding(
                    padding: const EdgeInsets.all(AppSpacing.xl),
                    child: Center(
                      child: InventoryNote(
                        key: const Key('credit-load-failed'),
                        text: l10n.invCreditLoadFailed,
                        trailing: TextButton(
                          onPressed: () {
                            setState(() {
                              _loaded = false;
                              _failed = false;
                              _safety = null;
                            });
                            _listen(force: true);
                          },
                          child: Text(l10n.retry),
                        ),
                      ),
                    ),
                  )
                : ListView(
                    key: const Key('credit-list'),
                    padding: const EdgeInsets.fromLTRB(
                      AppSpacing.lg,
                      AppSpacing.md,
                      AppSpacing.lg,
                      AppSpacing.xl,
                    ),
                    children: [
                      _TotalsCard(totals: totals),
                      const SizedBox(height: AppSpacing.md),
                      if (shown.isEmpty)
                        LotEmptyState(
                          key: const Key('credit-empty'),
                          icon: Icons.handshake_outlined,
                          title: l10n.invCreditNoneOpen,
                          hint: l10n.invCreditNoneOpenHint,
                        )
                      else
                        for (final sale in shown)
                          _CreditRow(
                            key: ValueKey('credit-${sale.id}'),
                            sale: sale,
                            today: today,
                            locale: locale,
                            collector:
                                (sale.credit?.collectorStaffId ?? '').isEmpty
                                ? ''
                                : _name(sale.credit!.collectorStaffId),
                            storeName: stores.viewerSeesAll
                                ? (sale.storeName.isNotEmpty
                                      ? sale.storeName
                                      : stores.storeName(sale.storeId))
                                : '',
                            onTap: () => _open(sale),
                          ),
                    ],
                  ),
          ),
        ],
      ),
    );
  }
}

class _TotalsCard extends StatelessWidget {
  const _TotalsCard({required this.totals});

  final InventoryCreditTotals totals;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Container(
      key: const Key('credit-totals'),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              formatLotCents(totals.owedCents),
              key: const Key('credit-total-owed'),
              style: const TextStyle(
                fontSize: 22,
                fontWeight: FontWeight.w800,
                color: AppColors.ink,
              ),
            ),
          ),
          Text(
            l10n.invCreditTotals(
              totals.count,
              formatLotCents(totals.owedCents),
            ),
            style: const TextStyle(fontSize: 13, color: AppColors.muted),
          ),
          if (totals.overdueCount > 0)
            Text(
              l10n.invCreditOverdueTotals(
                totals.overdueCount,
                formatLotCents(totals.overdueCents),
              ),
              key: const Key('credit-total-overdue'),
              style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: AppColors.errorRed,
              ),
            ),
        ],
      ),
    );
  }
}

class _CreditRow extends StatelessWidget {
  const _CreditRow({
    super.key,
    required this.sale,
    required this.today,
    required this.locale,
    required this.collector,
    required this.storeName,
    required this.onTap,
  });

  final InventorySale sale;
  final DateTime today;
  final String locale;
  final String collector;
  final String storeName;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final overdue = inventoryCreditOverdue(sale, today: today);
    final due = parseDayKey(sale.credit?.dueDate);
    final detail = [
      if (collector.isNotEmpty) l10n.invCreditCollectedBy(collector),
      if (sale.createdAt != null)
        l10n.invCreditSoldOn(displayDate(sale.createdAt!, locale)),
      if (storeName.isNotEmpty) l10n.inventoryStoreOf(storeName),
    ].join(' · ');
    return PressableScale(
      onTap: onTap,
      scale: 0.99,
      child: Container(
        margin: const EdgeInsets.only(bottom: AppSpacing.sm),
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.paper,
          borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          border: Border.all(
            color: overdue
                ? AppColors.errorRed.withValues(alpha: 0.45)
                : AppColors.rule,
          ),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    sale.credit?.customerName ?? '',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      color: AppColors.ink,
                    ),
                  ),
                  if (due != null)
                    Text(
                      overdue
                          ? l10n.invCreditOverdueSince(displayDate(due, locale))
                          : l10n.invCreditDueOn(displayDate(due, locale)),
                      key: Key('credit-due-${sale.id}'),
                      style: TextStyle(
                        fontSize: 12.5,
                        fontWeight: overdue ? FontWeight.w700 : FontWeight.w400,
                        color: overdue ? AppColors.errorRed : AppColors.muted,
                      ),
                    ),
                  if (detail.isNotEmpty)
                    Text(
                      detail,
                      style: const TextStyle(
                        fontSize: 12,
                        height: 1.35,
                        color: AppColors.muted,
                      ),
                    ),
                ],
              ),
            ),
            const SizedBox(width: AppSpacing.md),
            Text(
              formatLotCents(sale.creditBalanceCents),
              key: Key('credit-owed-${sale.id}'),
              style: TextStyle(
                fontSize: 16,
                fontWeight: FontWeight.w800,
                color: overdue ? AppColors.errorRed : AppColors.ink,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
