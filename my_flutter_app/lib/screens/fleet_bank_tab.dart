import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/fleet.dart';
import '../services/fleet_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../widgets/fleet_widgets.dart';

/// Zelle from the bank (docs/FLEET.md section 8): the bank, the deposits
/// waiting for a driver (pick the driver; the sender is remembered), payments
/// the bank took back, and "Check bank now".
class FleetBankTab extends StatefulWidget {
  const FleetBankTab({super.key, required this.controller});

  final FleetController controller;

  @override
  State<FleetBankTab> createState() => _FleetBankTabState();
}

class _FleetBankTabState extends State<FleetBankTab> {
  static const _timeout = Duration(seconds: 20);

  FleetBankStatus? _status;
  bool _loading = true;
  bool _failed = false;
  bool _busy = false;
  String? _error;
  String? _flash;
  final _picked = <String, String>{};

  FleetController get c => widget.controller;

  @override
  void initState() {
    super.initState();
    unawaited(_load());
  }

  /// Always ends: an answer, a refusal or the timeout.
  Future<void> _load() async {
    setState(() {
      _loading = true;
      _failed = false;
    });
    try {
      final status = await c.service.bankStatus(c.businessId).timeout(_timeout);
      if (mounted) setState(() => _status = status);
    } on FleetFailure catch (failure) {
      if (mounted) {
        setState(() {
          _failed = true;
          _error = fleetRefusalText(AppLocalizations.of(context)!, failure);
        });
      }
    } on TimeoutException {
      if (mounted) {
        setState(() {
          _failed = true;
          _error = AppLocalizations.of(context)!.fltBankTooSlow;
        });
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  /// One action with the busy flag that always clears.
  Future<bool> _run(Map<String, Object?> request, String done) async {
    if (_busy) return false;
    final l10n = AppLocalizations.of(context)!;
    setState(() {
      _busy = true;
      _error = null;
      _flash = null;
    });
    try {
      final answer = await c.service.call(request);
      if (mounted) {
        setState(
          () => _flash = answer['limitReached'] == true
              ? l10n.fltBankLimitReached
              : done,
        );
      }
      return true;
    } on FleetFailure catch (failure) {
      if (mounted) setState(() => _error = fleetRefusalText(l10n, failure));
      return false;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _checkNow() async {
    final l10n = AppLocalizations.of(context)!;
    if (await _run(
      FleetRequests.bankCheckNow(c.businessId),
      l10n.fltBankChecked,
    )) {
      unawaited(_load());
    }
  }

  Future<void> _pay(FleetWaitingDeposit w) async {
    final l10n = AppLocalizations.of(context)!;
    final driverId = _picked[w.id];
    if (driverId == null) {
      setState(() => _error = l10n.fltPickDriverFirst);
      return;
    }
    final name = c.state.index.driverById[driverId]?.name ?? '';
    final yes = await fleetConfirm(
      context,
      title: l10n.fltPayWithDepositTitle,
      message: l10n.fltPayWithDepositMessage(name),
      confirmLabel: l10n.fltPayThisDriver,
    );
    if (!yes || !mounted) return;
    if (await _run(
      FleetRequests.bankAssign(
        c.businessId,
        creditId: w.id,
        driverId: driverId,
      ),
      l10n.fltPaymentRecorded,
    )) {
      unawaited(_load());
    }
  }

  Future<void> _keep(FleetRemovedDeposit r) async {
    final l10n = AppLocalizations.of(context)!;
    final yes = await fleetConfirm(
      context,
      title: l10n.fltKeepPaymentTitle,
      message: l10n.fltKeepPaymentMessage,
      confirmLabel: l10n.fltKeepPayment,
    );
    if (!yes || !mounted) return;
    if (await _run(
      FleetRequests.bankRemovedKeep(c.businessId, r.paymentId),
      l10n.fltPaymentKept,
    )) {
      unawaited(_load());
    }
  }

  Future<void> _undoRemoved(FleetRemovedDeposit r) async {
    final l10n = AppLocalizations.of(context)!;
    final yes = await fleetConfirm(
      context,
      title: l10n.fltUndoPaymentTitle,
      message: l10n.fltUndoPaymentMessage(fleetMoney(r.amountCents)),
      confirmLabel: l10n.fltUndoAction,
      destructive: true,
    );
    if (!yes || !mounted) return;
    if (await _run(
      FleetRequests.paymentUndo(c.businessId, r.paymentId),
      l10n.fltPaymentUndone,
    )) {
      unawaited(_load());
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final admin = c.access.admin;
    final status = _status;
    return ListenableBuilder(
      listenable: c,
      builder: (context, _) {
        final drivers = [
          for (final d in c.state.data.drivers)
            if (d.isActive) d,
        ]..sort((a, b) => a.name.compareTo(b.name));
        final names = {
          for (final d in c.state.data.drivers)
            d.id: d.name.isEmpty ? d.phone : d.name,
        };
        return ListView(
          padding: const EdgeInsets.all(AppSpacing.lg),
          children: [
            FleetCard(
              title: l10n.fltBankTitle,
              action: status != null && status.connected
                  ? TextButton.icon(
                      key: const Key('fleet-bank-check'),
                      onPressed: _busy ? null : _checkNow,
                      icon: _busy
                          ? const SizedBox(
                              height: 14,
                              width: 14,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.refresh, size: 16),
                      label: Text(l10n.fltCheckBankNow),
                    )
                  : null,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (_error != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: AppSpacing.md),
                      child: Text(
                        _error!,
                        key: const Key('fleet-bank-error'),
                        style: const TextStyle(color: AppColors.errorRed),
                      ),
                    ),
                  if (_flash != null)
                    Padding(
                      padding: const EdgeInsets.only(bottom: AppSpacing.md),
                      child: Text(
                        _flash!,
                        key: const Key('fleet-bank-flash'),
                        style: const TextStyle(color: AppColors.sage),
                      ),
                    ),
                  if (_loading && status == null)
                    const Center(
                      child: CircularProgressIndicator(
                        key: Key('fleet-bank-loading'),
                      ),
                    )
                  else if (_failed && status == null)
                    OutlinedButton(
                      key: const Key('fleet-bank-retry'),
                      onPressed: _load,
                      child: Text(l10n.fltRetry),
                    )
                  else if (status != null && !status.connected)
                    Text(l10n.fltBankNotConnected)
                  else if (status != null) ...[
                    Text(
                      [
                        status.institutionName.isEmpty
                            ? l10n.fltBankGeneric
                            : status.institutionName,
                        if (status.accountMask.isNotEmpty)
                          '••${status.accountMask}',
                      ].join(' '),
                      style: const TextStyle(fontWeight: FontWeight.w800),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      l10n.fltBankAutoNote,
                      style: const TextStyle(color: AppColors.muted),
                    ),
                    if (status.lastScheduledMs > 0)
                      Text(
                        l10n.fltBankLastCheck(
                          fleetDayLabel(fleetDayOfMs(status.lastScheduledMs)),
                        ),
                        style: const TextStyle(color: AppColors.muted),
                      ),
                  ],
                ],
              ),
            ),
            if (status != null && status.connected) ...[
              if (status.removed.isNotEmpty) ...[
                const SizedBox(height: AppSpacing.md),
                FleetCard(
                  title: l10n.fltBankRemovedTitle,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        l10n.fltBankRemovedHint,
                        style: const TextStyle(color: AppColors.muted),
                      ),
                      for (final r in status.removed)
                        Padding(
                          key: Key('fleet-removed-${r.paymentId}'),
                          padding: const EdgeInsets.only(top: AppSpacing.md),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '${fleetMoney(r.amountCents)} · '
                                '${names[r.driverId] ?? '—'}',
                                style: const TextStyle(
                                  fontWeight: FontWeight.w800,
                                ),
                              ),
                              Text(
                                [
                                  if (r.senderName.isNotEmpty) r.senderName,
                                  if (r.paidDayKey.isNotEmpty)
                                    fleetDayLabel(r.paidDayKey),
                                ].join(' · '),
                                style: const TextStyle(
                                  color: AppColors.muted,
                                  fontSize: 12,
                                ),
                              ),
                              if (admin)
                                Wrap(
                                  spacing: AppSpacing.sm,
                                  children: [
                                    OutlinedButton(
                                      onPressed: _busy ? null : () => _keep(r),
                                      child: Text(l10n.fltKeepPayment),
                                    ),
                                    OutlinedButton(
                                      onPressed: _busy
                                          ? null
                                          : () => _undoRemoved(r),
                                      child: Text(l10n.fltUndoAction),
                                    ),
                                  ],
                                )
                              else
                                Text(
                                  l10n.fltAdminDecides,
                                  style: const TextStyle(
                                    color: AppColors.muted,
                                    fontSize: 12,
                                  ),
                                ),
                            ],
                          ),
                        ),
                    ],
                  ),
                ),
              ],
              const SizedBox(height: AppSpacing.md),
              FleetCard(
                title: l10n.fltBankWaitingTitle,
                child: status.waiting.isEmpty
                    ? Text(
                        l10n.fltBankNoneWaiting,
                        key: const Key('fleet-bank-none'),
                      )
                    : Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          for (final w in status.waiting)
                            Padding(
                              key: Key('fleet-deposit-${w.id}'),
                              padding: const EdgeInsets.only(
                                bottom: AppSpacing.lg,
                              ),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    fleetMoney(w.amountCents),
                                    style: const TextStyle(
                                      fontSize: 18,
                                      fontWeight: FontWeight.w800,
                                    ),
                                  ),
                                  Text(
                                    [
                                      if (w.senderName.isNotEmpty) w.senderName,
                                      if (w.dateKey.isNotEmpty)
                                        fleetDayLabel(w.dateKey),
                                      if (w.pending) l10n.fltBankPending,
                                    ].join(' · '),
                                    style: const TextStyle(
                                      color: AppColors.muted,
                                    ),
                                  ),
                                  Text(
                                    fleetWaitingReasonText(l10n, w.reason),
                                    style: const TextStyle(
                                      color: AppColors.muted,
                                      fontSize: 12,
                                    ),
                                  ),
                                  const SizedBox(height: AppSpacing.sm),
                                  DropdownButtonFormField<String>(
                                    key: Key('fleet-deposit-driver-${w.id}'),
                                    isExpanded: true,
                                    initialValue: _picked[w.id],
                                    decoration: InputDecoration(
                                      labelText: l10n.fltDriverWhoSent,
                                      isDense: true,
                                      border: OutlineInputBorder(
                                        borderRadius: BorderRadius.circular(
                                          AppSpacing.radiusMd,
                                        ),
                                      ),
                                    ),
                                    items: [
                                      for (final d in drivers)
                                        DropdownMenuItem(
                                          value: d.id,
                                          child: Text(
                                            d.name.isEmpty ? d.phone : d.name,
                                            overflow: TextOverflow.ellipsis,
                                          ),
                                        ),
                                    ],
                                    onChanged: _busy
                                        ? null
                                        : (v) => setState(() {
                                            if (v != null) _picked[w.id] = v;
                                          }),
                                  ),
                                  const SizedBox(height: AppSpacing.sm),
                                  FilledButton(
                                    key: Key('fleet-deposit-pay-${w.id}'),
                                    onPressed: _busy || _picked[w.id] == null
                                        ? null
                                        : () => _pay(w),
                                    child: Text(l10n.fltPayThisDriver),
                                  ),
                                ],
                              ),
                            ),
                        ],
                      ),
              ),
            ],
          ],
        );
      },
    );
  }
}
