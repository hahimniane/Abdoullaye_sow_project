import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/fleet.dart';
import '../services/fleet_home.dart';
import '../services/fleet_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/fleet_widgets.dart';

/// Fleet's front tab, "Needs you" (docs/FLEET.md section 15): what the office
/// must do today, most money first. Each row has its action; nothing here
/// writes except the WhatsApp reminder, which is the driver page's own button.
/// Reads `bank_status` once (pull down to read it again); the rest comes from
/// the Fleet data every tab already shares.
class FleetNeedsTab extends StatefulWidget {
  const FleetNeedsTab({
    super.key,
    required this.controller,
    required this.onOpenDriver,
    required this.onOpenCar,
    required this.onGoBank,
    required this.onGoPaperwork,
  });

  final FleetController controller;
  final ValueChanged<String> onOpenDriver;
  final ValueChanged<String> onOpenCar;

  /// Deposits, claims and take-backs live in Payments, under Bank.
  final VoidCallback onGoBank;
  final VoidCallback onGoPaperwork;

  @override
  State<FleetNeedsTab> createState() => _FleetNeedsTabState();
}

class _FleetNeedsTabState extends State<FleetNeedsTab> {
  static const _timeout = Duration(seconds: 20);
  static const _firstShown = 25;

  FleetBankStatus? _bank;
  bool _bankLoading = true;
  bool _bankFailed = false;
  bool _showAll = false;
  String? _reminding;

  // The list is worked out once per input, not on every build.
  List<FleetNeedsItem> _items = const [];
  FleetState? _itemsState;
  List<FleetClaim>? _itemsClaims;
  FleetBankStatus? _itemsBank;

  FleetController get c => widget.controller;

  @override
  void initState() {
    super.initState();
    unawaited(_loadBank());
  }

  /// Always ends: an answer, a refusal or the timeout. A bank that cannot be
  /// read only leaves deposits out of the list (and says so).
  Future<void> _loadBank() async {
    if (mounted) {
      setState(() {
        _bankLoading = true;
        _bankFailed = false;
      });
    }
    try {
      final status = await c.service.bankStatus(c.businessId).timeout(_timeout);
      if (mounted) setState(() => _bank = status);
    } on FleetFailure {
      if (mounted) setState(() => _bankFailed = true);
    } on TimeoutException {
      if (mounted) setState(() => _bankFailed = true);
    } finally {
      if (mounted) setState(() => _bankLoading = false);
    }
  }

  void _recompute(FleetState s) {
    if (identical(_itemsState, s) &&
        identical(_itemsClaims, c.claims) &&
        identical(_itemsBank, _bank)) {
      return;
    }
    _items = fleetNeedsItems(
      data: s.data,
      index: s.index,
      todayKey: s.todayKey,
      claims: c.claims,
      bank: _bank,
      driverRows: s.driverRows,
    );
    _itemsState = s;
    _itemsClaims = c.claims;
    _itemsBank = _bank;
  }

  bool _canRemind(FleetNeedsLate item) {
    final wa = c.state.settings;
    return item.active &&
        item.owedCents > 0 &&
        wa.whatsappEnabled &&
        (wa.whatsappOnlyDriverIds.isEmpty ||
            wa.whatsappOnlyDriverIds.contains(item.driverId));
  }

  Future<void> _remind(String driverId) async {
    if (_reminding != null) return;
    final l10n = AppLocalizations.of(context)!;
    setState(() => _reminding = driverId);
    try {
      await c.service.call(
        FleetRequests.whatsappRemindDriver(c.businessId, driverId),
      );
      if (mounted) showSuccessSnackBar(context, l10n.fltReminderSent);
    } on FleetFailure catch (failure) {
      if (mounted) showErrorSnackBar(context, fleetRefusalText(l10n, failure));
    } finally {
      if (mounted) setState(() => _reminding = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return ListenableBuilder(
      listenable: c,
      builder: (context, _) {
        final s = c.state;
        return FleetStateGate(
          controller: c,
          child: Builder(
            builder: (context) {
              _recompute(s);
              final shown = _showAll
                  ? _items
                  : _items.take(_firstShown).toList();
              final loading = (s.loading || _bankLoading) && _items.isEmpty;
              return RefreshIndicator(
                onRefresh: _loadBank,
                child: ListView(
                  key: const Key('fleet-needs-list'),
                  physics: const AlwaysScrollableScrollPhysics(),
                  padding: const EdgeInsets.all(AppSpacing.lg),
                  children: [
                    Text(
                      fleetNeedsCount(_items) > 0
                          ? '${l10n.fltHomeTabNeeds} · ${fleetNeedsCount(_items)}'
                          : l10n.fltHomeTabNeeds,
                      key: const Key('fleet-needs-title'),
                      style: const TextStyle(
                        fontSize: 18,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    Text(
                      l10n.fltHomeNeedsSorted,
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.muted,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    if (_bankFailed)
                      Padding(
                        padding: const EdgeInsets.only(bottom: AppSpacing.md),
                        child: Text(
                          l10n.fltHomeNeedsBankError,
                          key: const Key('fleet-needs-bank-error'),
                          style: const TextStyle(color: AppColors.muted),
                        ),
                      ),
                    if (loading)
                      const Padding(
                        padding: EdgeInsets.all(AppSpacing.xl),
                        child: Center(
                          child: CircularProgressIndicator(
                            key: Key('fleet-needs-loading'),
                          ),
                        ),
                      )
                    else if (_items.isEmpty)
                      FleetCard(
                        key: const Key('fleet-needs-empty'),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              l10n.fltHomeNeedsAllClear,
                              style: const TextStyle(
                                fontSize: 16,
                                fontWeight: FontWeight.w800,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              l10n.fltHomeNeedsNothing,
                              style: const TextStyle(color: AppColors.muted),
                            ),
                          ],
                        ),
                      )
                    else
                      for (final item in shown) ...[
                        _row(context, l10n, item),
                        const SizedBox(height: AppSpacing.sm),
                      ],
                    if (!_showAll && _items.length > _firstShown)
                      Align(
                        alignment: Alignment.centerLeft,
                        child: OutlinedButton(
                          key: const Key('fleet-needs-show-all'),
                          onPressed: () => setState(() => _showAll = true),
                          child: Text(l10n.fltHomeNeedsShowAll(_items.length)),
                        ),
                      ),
                  ],
                ),
              );
            },
          ),
        );
      },
    );
  }

  Widget _row(
    BuildContext context,
    AppLocalizations l10n,
    FleetNeedsItem item,
  ) {
    String name(String text) => text.isEmpty ? '—' : text;
    var icon = Icons.error_outline;
    var tone = FleetTone.bad;
    var title = '';
    var sub = '';
    final actions = <Widget>[];
    VoidCallback? open;
    Widget action(String label, VoidCallback onTap, {bool primary = false}) =>
        primary
        ? FilledButton(
            key: Key('fleet-needs-action-${item.key}'),
            onPressed: onTap,
            child: Text(label),
          )
        : OutlinedButton(
            key: Key('fleet-needs-action-${item.key}'),
            onPressed: onTap,
            child: Text(label),
          );

    switch (item) {
      case FleetNeedsRemoved():
        icon = Icons.account_balance_outlined;
        title = l10n.fltHomeRemovedTitle(
          fleetMoney(item.amountCents),
          name(item.name),
        );
        sub = l10n.fltHomeRemovedSub(fleetDayLabel(item.dayKey));
        actions.add(
          action(l10n.fltHomeRemovedAction, widget.onGoBank, primary: true),
        );
        if (item.driverId.isNotEmpty) {
          open = () => widget.onOpenDriver(item.driverId);
        }
      case FleetNeedsClaim():
        icon = Icons.image_outlined;
        tone = FleetTone.warn;
        title = item.amountCents == null
            ? l10n.fltHomeClaimTitle(name(item.name))
            : l10n.fltHomeClaimTitleAmount(
                name(item.name),
                fleetMoney(item.amountCents!),
              );
        sub = item.match ? l10n.fltHomeClaimMatch : l10n.fltHomeClaimLook;
        actions.add(
          action(l10n.fltHomeClaimAction, widget.onGoBank, primary: true),
        );
        if (item.driverId.isNotEmpty) {
          open = () => widget.onOpenDriver(item.driverId);
        }
      case FleetNeedsDeposit():
        icon = Icons.payments_outlined;
        tone = FleetTone.warn;
        title = l10n.fltHomeDepositTitle(
          fleetMoney(item.amountCents),
          name(item.senderName),
        );
        sub = item.dayKey.isEmpty
            ? l10n.fltHomeDepositSub
            : l10n.fltHomeDepositSubDay(fleetDayLabel(item.dayKey));
        actions.add(action(l10n.fltHomeDepositAction, widget.onGoBank));
      case FleetNeedsLate():
        title = l10n.fltHomeLateTitle(
          name(item.name),
          fleetMoney(item.owedCents),
        );
        final late = fleetMoney(item.lateCents);
        sub = item.plate.isEmpty
            ? (item.active
                  ? l10n.fltHomeLateSubNoPlate(late)
                  : l10n.fltHomeLateSubNoPlateLeft(late))
            : (item.active
                  ? l10n.fltHomeLateSub(late, item.plate)
                  : l10n.fltHomeLateSubLeft(late, item.plate));
        if (_canRemind(item)) {
          actions.add(
            FilledButton(
              key: Key('fleet-needs-remind-${item.driverId}'),
              onPressed: _reminding != null
                  ? null
                  : () => _remind(item.driverId),
              child: Text(l10n.fltSendReminder),
            ),
          );
        }
        actions.add(
          action(
            l10n.fltHomeOpenDriver,
            () => widget.onOpenDriver(item.driverId),
          ),
        );
      case FleetNeedsIdle():
        icon = Icons.directions_car_outlined;
        tone = FleetTone.muted;
        title = l10n.fltHomeIdleTitle(item.plate);
        final days = item.idleDays;
        sub = days == null
            ? l10n.fltHomeIdleNever
            : item.missedCents > 0
            ? l10n.fltHomeIdleMissed(days, fleetMoney(item.missedCents))
            : l10n.fltHomeIdleDays(days);
        actions.add(
          action(
            l10n.fltHomeIdleAction,
            () => widget.onOpenCar(item.carId),
            primary: true,
          ),
        );
      case FleetNeedsPaper():
        icon = Icons.description_outlined;
        final past = item.daysLeft < 0;
        tone = past ? FleetTone.bad : FleetTone.warn;
        final day = fleetDayLabel(item.dayKey);
        title = switch (item.paper) {
          FleetPaper.diamond =>
            past
                ? l10n.fltHomePaperDiamondPast(item.plate, day)
                : l10n.fltHomePaperDiamondSoon(item.plate, day),
          FleetPaper.registration =>
            past
                ? l10n.fltHomePaperRegistrationPast(item.plate, day)
                : l10n.fltHomePaperRegistrationSoon(item.plate, day),
        };
        final left = past
            ? l10n.fltHomePaperAgo(-item.daysLeft)
            : l10n.fltHomePaperLeft(item.daysLeft);
        final who = item.driverName.isEmpty
            ? l10n.fltHomePaperNoDriver
            : l10n.fltHomePaperDriver(item.driverName);
        sub = '$left · $who';
        actions.add(
          action(l10n.fltHomePaperAction, () => widget.onOpenCar(item.carId)),
        );
      case FleetNeedsMissingPaper():
        icon = Icons.description_outlined;
        tone = FleetTone.muted;
        title = l10n.fltHomeMissingTitle(item.count);
        sub = l10n.fltHomeMissingSub;
        actions.add(action(l10n.fltHomeMissingAction, widget.onGoPaperwork));
    }

    return FleetCard(
      key: Key('fleet-needs-row-${item.key}'),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, size: 22, color: _toneColor(tone)),
              const SizedBox(width: AppSpacing.md),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w800,
                        color: AppColors.ink,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      sub,
                      style: const TextStyle(
                        fontSize: 13,
                        color: AppColors.muted,
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),
          // A button never wider than the card: a long French label wraps.
          LayoutBuilder(
            builder: (context, box) => Wrap(
              spacing: AppSpacing.sm,
              runSpacing: AppSpacing.sm,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                for (final button in [
                  ...actions,
                  if (open != null)
                    TextButton(
                      key: Key('fleet-needs-open-${item.key}'),
                      onPressed: open,
                      child: Text(l10n.fltHomeNeedsDetails),
                    ),
                ])
                  ConstrainedBox(
                    constraints: BoxConstraints(maxWidth: box.maxWidth),
                    child: button,
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Color _toneColor(FleetTone tone) => switch (tone) {
    FleetTone.bad => AppColors.errorRed,
    FleetTone.warn => AppColors.warn,
    _ => AppColors.muted,
  };
}
