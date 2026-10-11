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

/// The sales recorded at the counter, newest first, one page at a time. Each
/// shows what was sold, at what price, how it was paid and by whom. A sale is
/// undone only as a whole: Void puts the stock back and keeps the sale in the
/// list marked voided - who and when - so nothing is ever erased.
class InventorySalesScreen extends StatefulWidget {
  const InventorySalesScreen({
    super.key,
    required this.businessId,
    this.source,
    this.service = const InventoryService(),
  });

  final String businessId;
  final InventorySource? source;
  final InventoryService service;

  @override
  State<InventorySalesScreen> createState() => _InventorySalesScreenState();
}

class _InventorySalesScreenState extends State<InventorySalesScreen> {
  late final InventorySource _source = widget.source ?? FirestoreInventorySource();
  final List<StreamSubscription<Object?>> _subs = [];
  StreamSubscription<Object?>? _salesSub;
  Timer? _safety;

  List<InventorySale> _sales = const [];
  List<LotStaff> _staff = const [];
  int _pages = 1;
  bool _loaded = false;
  bool _failed = false;
  bool _loadingMore = false;
  String _voiding = '';

  @override
  void initState() {
    super.initState();
    _listenSales();
    _subs.add(_source.watchStaff(widget.businessId).listen((staff) {
      if (mounted) setState(() => _staff = staff);
    }, onError: (_) {}));
  }

  @override
  void dispose() {
    _safety?.cancel();
    _salesSub?.cancel();
    for (final s in _subs) {
      s.cancel();
    }
    super.dispose();
  }

  int get _limit => inventorySalesPageSize * _pages;

  void _listenSales() {
    _safety?.cancel();
    // A list that never answers is a spinner that never stops.
    _safety = Timer(const Duration(seconds: 15), () {
      if (mounted && !_loaded) setState(() => _loaded = true);
    });
    _salesSub?.cancel();
    _salesSub = _source.watchSales(widget.businessId, limit: _limit).listen(
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

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          InventoryHeader(title: l10n.inventorySalesTitle),
          Expanded(
            child: !_loaded
                ? const Center(child: CircularProgressIndicator())
                : _failed && _sales.isEmpty
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
                                  _listenSales();
                                },
                                child: Text(l10n.retry),
                              ),
                            ),
                          ],
                        ),
                      )
                    : _sales.isEmpty
                        ? LotEmptyState(
                            key: const Key('inv-sales-empty'),
                            icon: Icons.receipt_long_outlined,
                            title: l10n.inventoryNoSales,
                            hint: l10n.inventoryNoSalesHint,
                          )
                        : ListView(
                            padding: const EdgeInsets.fromLTRB(
                                AppSpacing.lg,
                                AppSpacing.md,
                                AppSpacing.lg,
                                AppSpacing.xl),
                            children: [
                              for (final sale in _sales)
                                InventorySaleCard(
                                  key: ValueKey('inv-sale-${sale.id}'),
                                  sale: sale,
                                  locale: locale,
                                  staff: _staff,
                                  voiding: _voiding == sale.id,
                                  canVoid: _voiding.isEmpty,
                                  onVoid: () => _void(sale),
                                ),
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
                                                strokeWidth: 2),
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
  });

  final InventorySale sale;
  final String locale;
  final List<LotStaff> staff;
  final VoidCallback onVoid;
  final bool voiding;
  final bool canVoid;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final when = sale.createdAt == null
        ? ''
        : displayDateTime(sale.createdAt!, locale);
    final soldBy = inventoryStaffName(staff, sale.soldByStaffId);
    final voidedBy = inventoryStaffName(staff, sale.voidedByStaffId);
    final voidedWhen =
        sale.voidedAt == null ? '' : displayDateTime(sale.voidedAt!, locale);
    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.all(AppSpacing.md),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(
          color: sale.voided
              ? AppColors.errorRed.withValues(alpha: 0.35)
              : AppColors.rule,
        ),
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
                  style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
                ),
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
                          line.name,
                          formatLotCents(line.soldPriceCents),
                          formatLotCents(line.listPriceCents),
                        )
                      : l10n.inventorySaleLine(
                          line.quantity,
                          line.name,
                          formatLotCents(line.soldPriceCents),
                        ),
                  if (line.countWasOff) l10n.inventorySaleCountOff,
                ].join(' · '),
                style: const TextStyle(
                    fontSize: 13, height: 1.35, color: AppColors.ink),
              ),
            ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            [
              inventoryPaymentLabel(l10n, sale.paymentMethod),
              if (soldBy.isNotEmpty) l10n.inventorySoldBy(soldBy),
            ].join(' · '),
            style: const TextStyle(fontSize: 12, color: AppColors.muted),
          ),
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
              child: TextButton(
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
                          color: canVoid ? AppColors.errorRed : AppColors.muted,
                        ),
                      ),
              ),
            ),
        ],
      ),
    );
  }
}
