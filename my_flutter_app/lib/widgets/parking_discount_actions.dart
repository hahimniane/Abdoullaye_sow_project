import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/business_parking_entry.dart'
    show businessParkingReceivedViaValues;
import '../services/lot_ledger.dart' show lotDollarsToCents;
import '../services/parking_discount.dart';
import '../services/parking_discount_service.dart';
import '../services/parking_month_statement.dart' show parkingMoney;
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/action_confirmation.dart';
import '../utils/date_display.dart';
import 'app_snackbars.dart';
import 'lot_sheets.dart';
import 'parking_bill_payment_widgets.dart' show parkingMethodLabel;
import 'received_by_options.dart';

/// The words for a refused discount, by the server's `details.reason`.
String parkingDiscountRefusalText(AppLocalizations l10n, String reason) =>
    switch (reason) {
      'discount_not_direct' => l10n.pmeDiscNotDirect,
      'discount_reason_required' => l10n.pmeDiscReasonRequired,
      'discount_no_amount' => l10n.pmeDiscNoAmount,
      'discount_nothing_owed' => l10n.pmeDiscNothingOwed,
      'discount_more_than_owed' => l10n.pmeDiscMoreThanOwed,
      'discount_paid_not_less' => l10n.pmeDiscPaidNotLess,
      'discount_receiver_required' => l10n.pmeDiscReceiverRequired,
      'discount_owed_changed' => l10n.pmeDiscOwedChanged,
      'discount_not_found' => l10n.pmeDiscNotFound,
      'discount_already_undone' => l10n.pmeDiscAlreadyUndone,
      'discount_voided' => l10n.pmeDiscVoided,
      _ => l10n.lotCouldNotSave,
    };

/// A failure as words: offline or unknown is "could not save", a permission
/// refusal says so, anything else is the server's named reason.
String parkingDiscountFailureText(
  AppLocalizations l10n,
  ParkingDiscountFailure failure,
) {
  if (failure.reason.isNotEmpty) {
    return parkingDiscountRefusalText(l10n, failure.reason);
  }
  if (failure.notAllowed) return l10n.pmeNotAllowed;
  return l10n.lotCouldNotSave;
}

/// The discounts on a parked car (docs/PARKING_DISCOUNT.md), shown inside the
/// car's payment card for anyone with the parking permission: the car's
/// discounts (newest first, Undo; undone ones greyed), and "Settle for a
/// lower amount" / "Give a discount" with a live preview from
/// `parking_discount.dart` (the server's checks, in its order).
class ParkingDiscountActions extends StatefulWidget {
  const ParkingDiscountActions({
    super.key,
    required this.car,
    required this.entryId,
    required this.staffNames,
    required this.onChanged,
    this.service = const ParkingDiscountService(),
    this.now,
  });

  /// The car's record fields (`parkedCars/{id}`).
  final Map<String, dynamic> car;
  final String entryId;

  /// uid -> name of the team, for "Received by" and who gave a discount.
  final Map<String, String> staffNames;

  /// Called after a discount was recorded or undone, so the screen reads the
  /// car again.
  final Future<void> Function() onChanged;
  final ParkingDiscountService service;

  /// The clock, for tests.
  final DateTime Function()? now;

  @override
  State<ParkingDiscountActions> createState() => _ParkingDiscountActionsState();
}

class _ParkingDiscountActionsState extends State<ParkingDiscountActions> {
  String _mode = '';
  final _amount = TextEditingController();
  final _reason = TextEditingController();
  String _via = 'cash';
  String _by = '';
  bool _busy = false;
  String _error = '';

  @override
  void dispose() {
    _amount.dispose();
    _reason.dispose();
    super.dispose();
  }

  DateTime get _now => widget.now?.call() ?? DateTime.now();

  void _close() {
    setState(() {
      _mode = '';
      _amount.clear();
      _reason.clear();
      _by = '';
      _error = '';
    });
  }

  DiscountPreview? _preview() {
    if (_mode.isEmpty) return null;
    final cents = lotDollarsToCents(_amount.text) ?? -1;
    return discountPreview(
      widget.car,
      _mode,
      cents,
      _reason.text,
      receivedByStaffId: _by,
      now: _now,
    );
  }

  Future<void> _pickVia() async {
    final l10n = AppLocalizations.of(context)!;
    final picked = await pickLotOption<String>(
      context,
      title: l10n.invPayMethod,
      selected: _via,
      options: [
        for (final m in businessParkingReceivedViaValues)
          LotOption(m, parkingMethodLabel(l10n, m)),
      ],
    );
    if (picked != null && mounted) setState(() => _via = picked);
  }

  Future<void> _pickBy() async {
    final l10n = AppLocalizations.of(context)!;
    final picked = await pickLotOption<String>(
      context,
      title: l10n.lotReceivedBy,
      selected: _by,
      options: receivedByOptions(l10n, [
        for (final e in widget.staffNames.entries) LotOption(e.key, e.value),
      ]),
    );
    if (picked != null && mounted) {
      setState(() {
        _by = picked;
        _error = '';
      });
    }
  }

  Future<void> _save() async {
    final l10n = AppLocalizations.of(context)!;
    final preview = _preview();
    if (_busy || preview == null) return;
    if (!preview.ok) {
      AppHaptics.refuse();
      setState(() => _error = parkingDiscountRefusalText(l10n, preview.reason));
      return;
    }
    final settle = _mode == 'settle';
    final confirmed = await confirmMajorAction(
      context,
      title: settle
          ? l10n.pmeDiscConfirmSettleTitle
          : l10n.pmeDiscConfirmGiveTitle,
      message: settle
          ? l10n.pmeDiscConfirmSettle(
              parkingMoney(preview.paidCents),
              parkingMoney(preview.discountCents),
            )
          : l10n.pmeDiscConfirmGive(parkingMoney(preview.discountCents)),
      confirmLabel: settle ? l10n.pmeDiscSubmitSettle : l10n.pmeDiscSubmitGive,
      icon: Icons.percent,
    );
    if (!confirmed || !mounted) return;
    setState(() {
      _busy = true;
      _error = '';
    });
    try {
      if (settle) {
        await widget.service.settle(
          entryId: widget.entryId,
          paidCents: preview.paidCents,
          receivedVia: _via,
          receivedByStaffId: _by,
          reason: _reason.text,
          expectedOwedCents: preview.owedCents,
        );
      } else {
        await widget.service.give(
          entryId: widget.entryId,
          amountCents: preview.discountCents,
          reason: _reason.text,
        );
      }
      if (!mounted) return;
      AppHaptics.commit();
      _close();
      showSuccessSnackBar(
        context,
        settle ? l10n.pmeDiscDoneSettle : l10n.pmeDiscDoneGive,
      );
      await widget.onChanged();
    } on ParkingDiscountFailure catch (failure) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _error = parkingDiscountFailureText(l10n, failure));
    } catch (_) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _error = l10n.lotCouldNotSave);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _undo(ParkingDiscount d) async {
    final l10n = AppLocalizations.of(context)!;
    if (_busy) return;
    final confirmed = await confirmMajorAction(
      context,
      title: l10n.pmeDiscUndoTitle,
      message: l10n.pmeDiscUndoBody(parkingMoney(d.amountCents)),
      confirmLabel: l10n.pmeDiscUndo,
      icon: Icons.undo,
      destructive: true,
    );
    if (!confirmed || !mounted) return;
    setState(() {
      _busy = true;
      _error = '';
    });
    try {
      await widget.service.undo(entryId: widget.entryId, discountId: d.id);
      if (!mounted) return;
      AppHaptics.commit();
      showSuccessSnackBar(context, l10n.pmeDiscDoneUndo);
      await widget.onChanged();
    } on ParkingDiscountFailure catch (failure) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _error = parkingDiscountFailureText(l10n, failure));
    } catch (_) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _error = l10n.lotCouldNotSave);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final car = widget.car;
    final discounts = parkingDiscountsOf(car);
    final canGive =
        discountableCar(car) &&
        car['voided'] != true &&
        '${car['status'] ?? ''}' != 'cancelled';
    final owed = canGive ? owedNowCents(car, _now) : 0;
    if (!canGive && discounts.isEmpty) return const SizedBox.shrink();
    final locale = dateLocaleOf(context);
    String when(int ms) => ms > 0
        ? displayDateTime(DateTime.fromMillisecondsSinceEpoch(ms), locale)
        : '';
    final settle = _mode == 'settle';
    final preview = _preview();
    final typed = _amount.text.trim().isNotEmpty;
    return Column(
      key: const Key('parking-discounts'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (discounts.isNotEmpty) ...[
          Text(
            l10n.pmeDiscTitle,
            style: const TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w700,
              color: AppColors.muted,
            ),
          ),
          const SizedBox(height: 4),
          for (final d in discounts)
            _DiscountRow(
              key: Key('discount-${d.id}'),
              discount: d,
              given: when(d.atMs),
              by: widget.staffNames[d.givenByUid] ?? '',
              undoneDate: when(d.undoneAtMs > 0 ? d.undoneAtMs : d.atMs),
              busy: _busy,
              onUndo: () => _undo(d),
            ),
          const SizedBox(height: AppSpacing.sm),
        ],
        if (canGive && owed > 0 && _mode.isEmpty)
          Wrap(
            spacing: AppSpacing.sm,
            runSpacing: AppSpacing.xs,
            children: [
              OutlinedButton.icon(
                key: const Key('discount-open-settle'),
                onPressed: _busy
                    ? null
                    : () => setState(() => _mode = 'settle'),
                icon: const Icon(Icons.percent, size: 18),
                label: Text(l10n.pmeDiscSettle),
              ),
              OutlinedButton(
                key: const Key('discount-open-give'),
                onPressed: _busy
                    ? null
                    : () => setState(() => _mode = 'discount'),
                child: Text(l10n.pmeDiscGive),
              ),
            ],
          ),
        if (_mode.isNotEmpty) ...[
          Text(
            [
              l10n.pmeDiscOwedToday(parkingMoney(owed)),
              if ('${car['parkingEndDate'] ?? ''}'.isEmpty ||
                  car['parkingEndDate'] == null)
                l10n.pmeDiscKeepsAdding,
            ].join(' '),
            key: const Key('discount-owed'),
            style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
          ),
          const SizedBox(height: AppSpacing.sm),
          TextField(
            key: const Key('discount-amount'),
            controller: _amount,
            enabled: !_busy,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            onChanged: (_) => setState(() => _error = ''),
            decoration: InputDecoration(
              labelText: settle ? l10n.pmeDiscAmountPaid : l10n.pmeDiscAmount,
              prefixText: r'$ ',
            ),
          ),
          if (settle) ...[
            const SizedBox(height: AppSpacing.sm),
            LotPickerField(
              label: l10n.invPayMethod,
              value: parkingMethodLabel(l10n, _via),
              placeholder: l10n.invPayMethod,
              onTap: _busy ? () {} : _pickVia,
            ),
            const SizedBox(height: AppSpacing.sm),
            LotPickerField(
              key: const Key('discount-received-by'),
              label: l10n.lotReceivedBy,
              value: _by.isEmpty
                  ? null
                  : receivedByName(l10n, _by, widget.staffNames[_by] ?? ''),
              placeholder: l10n.pmeWhoTookIt,
              onTap: _busy ? () {} : _pickBy,
            ),
          ],
          const SizedBox(height: AppSpacing.sm),
          TextField(
            key: const Key('discount-reason'),
            controller: _reason,
            enabled: !_busy,
            maxLength: 300,
            onChanged: (_) => setState(() => _error = ''),
            decoration: InputDecoration(
              labelText: l10n.pmeDiscReason,
              hintText: l10n.pmeDiscReasonHint,
              counterText: '',
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          if (preview != null && preview.ok)
            Text(
              settle
                  ? l10n.pmeDiscPreviewSettle(
                      parkingMoney(preview.paidCents),
                      parkingMoney(preview.discountCents),
                      parkingMoney(0),
                    )
                  : l10n.pmeDiscPreviewGive(
                      parkingMoney(preview.discountCents),
                      parkingMoney(preview.leftCents),
                    ),
              key: const Key('discount-preview'),
              style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: AppColors.ink,
              ),
            ),
          if (preview != null && !preview.ok && typed)
            Text(
              parkingDiscountRefusalText(l10n, preview.reason),
              key: const Key('discount-preview-refusal'),
              style: const TextStyle(fontSize: 12.5, color: AppColors.errorRed),
            ),
          const SizedBox(height: AppSpacing.md),
          Row(
            children: [
              Expanded(
                child: LotSheetButton(
                  key: const Key('discount-save'),
                  label: settle
                      ? l10n.pmeDiscSubmitSettle
                      : l10n.pmeDiscSubmitGive,
                  busy: _busy,
                  tone: LotTone.good,
                  onTap: preview != null && preview.ok ? _save : null,
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              TextButton(
                key: const Key('discount-cancel'),
                onPressed: _busy ? null : _close,
                child: Text(l10n.cancel),
              ),
            ],
          ),
        ],
        if (_error.isNotEmpty) ...[
          const SizedBox(height: AppSpacing.sm),
          Text(
            _error,
            key: const Key('discount-error'),
            style: const TextStyle(fontSize: 12.5, color: AppColors.errorRed),
          ),
        ],
      ],
    );
  }
}

class _DiscountRow extends StatelessWidget {
  const _DiscountRow({
    super.key,
    required this.discount,
    required this.given,
    required this.by,
    required this.undoneDate,
    required this.busy,
    required this.onUndo,
  });

  final ParkingDiscount discount;
  final String given;
  final String by;
  final String undoneDate;
  final bool busy;
  final VoidCallback onUndo;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final undone = discount.undone;
    final ink = undone ? AppColors.muted : AppColors.ink;
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  l10n.pmeDiscLine(parkingMoney(discount.amountCents)),
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: ink,
                    decoration: undone ? TextDecoration.lineThrough : null,
                  ),
                ),
                Text(
                  [
                    discount.reason,
                    if (by.isNotEmpty) l10n.pmeDiscLineBy(by),
                    if (given.isNotEmpty) given,
                  ].where((x) => x.isNotEmpty).join(' · '),
                  style: const TextStyle(
                    fontSize: 11.5,
                    color: AppColors.muted,
                  ),
                ),
                if (undone)
                  Text(
                    l10n.pmeDiscUndone(undoneDate),
                    key: Key('discount-undone-${discount.id}'),
                    style: const TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w600,
                      color: AppColors.muted,
                    ),
                  ),
              ],
            ),
          ),
          if (!undone)
            TextButton(
              key: Key('discount-undo-${discount.id}'),
              style: TextButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: 8),
                minimumSize: const Size(0, 32),
                foregroundColor: AppColors.errorRed,
              ),
              onPressed: busy ? null : onUndo,
              child: Text(l10n.pmeDiscUndo),
            ),
        ],
      ),
    );
  }
}
