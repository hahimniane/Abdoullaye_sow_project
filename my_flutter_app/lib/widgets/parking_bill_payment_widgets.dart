import 'package:firebase_auth/firebase_auth.dart' show FirebaseAuth;
import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/business_parking_entry.dart'
    show businessParkingReceivedViaValues;
import '../services/lot_ledger.dart' show lotDollarsToCents;
import '../services/parking_bill_payment.dart';
import '../services/parking_bill_payment_service.dart';
import '../services/parking_month_statement.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/date_display.dart';
import 'app_snackbars.dart';
import 'lot_sheets.dart';
import 'received_by_options.dart';

/// Paying part of a customer's month bill (docs/PARKING_BILL_PAYMENTS.md):
/// the "Record a payment" sheet on Month end, and the "Payments on this bill"
/// list on the customer's card.

/// A payment method as the app names it: the "How it was paid" words, plus
/// the payment link and online payments a month's bill can also carry.
String parkingMethodLabel(AppLocalizations l10n, String m) => switch (m) {
  'cash' => l10n.invMethodCash,
  'zelle' => l10n.invMethodZelle,
  'cashapp' => l10n.invMethodCashapp,
  'venmo' => l10n.invMethodVenmo,
  'check' => l10n.invMethodCheck,
  'card_in_person' => l10n.invMethodCardInPerson,
  'card_link' => l10n.paymentLinkLabel,
  'online' => l10n.lotPaymentOnline,
  _ => l10n.invMethodOther,
};

/// The words for a refused bill payment, by the server's `details.reason`.
/// [payableCents] is the most the bill can take (shown when the amount was
/// more than owed).
String parkingBillPaymentRefusalText(
  AppLocalizations l10n,
  String reason, {
  int payableCents = 0,
}) => switch (reason) {
  BillPaymentRefusal.noAmount => l10n.pmeBillPaymentNoAmount,
  BillPaymentRefusal.moreThanOwed => l10n.pmeBillPaymentMoreThanOwed(
    parkingMoney(payableCents),
  ),
  BillPaymentRefusal.nothingToPay => l10n.pmeBillPaymentNothingToPay,
  BillPaymentRefusal.customerNotFound => l10n.pmeBillPaymentCustomerNotFound,
  BillPaymentRefusal.billChanged => l10n.pmeBillPaymentBillChanged,
  BillPaymentRefusal.receiverRequired => l10n.pmeBillPaymentReceiverRequired,
  BillPaymentRefusal.monthInvalid => l10n.pmeBillPaymentMonthInvalid,
  BillPaymentRefusal.notFound => l10n.pmeBillPaymentNotFound,
  BillPaymentRefusal.alreadyUndone => l10n.pmeBillPaymentAlreadyUndone,
  BillPaymentRefusal.settledSince => l10n.pmeBillPaymentSettledSince,
  BillPaymentRefusal.ledgerRequired => l10n.pmeBillPaymentLedgerRequired,
  _ => l10n.lotCouldNotSave,
};

/// The failure as words: an offline or unknown failure is "could not save".
String parkingBillPaymentFailureText(
  AppLocalizations l10n,
  ParkingBillPaymentFailure failure, {
  int payableCents = 0,
}) => failure.offline
    ? l10n.lotCouldNotSave
    : parkingBillPaymentRefusalText(
        l10n,
        failure.reason,
        payableCents: payableCents,
      );

/// "Undo this $X payment?" - it comes off every car and job it paid; the
/// payment stays on file as "Undone".
Future<bool?> confirmUndoBillPayment(
  BuildContext context, {
  required String amount,
}) {
  final l10n = AppLocalizations.of(context)!;
  return showDialog<bool>(
    context: context,
    builder: (dialogContext) => AlertDialog(
      title: Text(l10n.pmeBillPaymentUndoTitle),
      content: Text(l10n.pmeBillPaymentUndoBody(amount)),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(dialogContext).pop(false),
          child: Text(l10n.cancel),
        ),
        TextButton(
          key: const Key('bill-payment-undo-confirm'),
          style: TextButton.styleFrom(foregroundColor: AppColors.errorRed),
          onPressed: () => Navigator.of(dialogContext).pop(true),
          child: Text(l10n.pmeBillPaymentUndo),
        ),
      ],
    ),
  );
}

/// "Record a payment": one amount, split oldest first across the bill's cars
/// and jobs. Shows what it pays off and what is left as the amount is typed;
/// saves one payment (one receipt, undone as one).
class BillPaymentSheet extends StatefulWidget {
  const BillPaymentSheet({
    super.key,
    required this.businessId,
    required this.monthKey,
    required this.monthLabel,
    required this.customer,
    required this.staff,
    this.service = const ParkingBillPaymentService(),
    this.currentUid,
  });

  final String businessId;
  final String monthKey;
  final String monthLabel;
  final ParkingMonthCustomer customer;
  final List<({String id, String name})> staff;
  final ParkingBillPaymentService service;

  /// Who is recording, preselected as "Received by" when on the team. The
  /// signed-in user when absent.
  final String? currentUid;

  @override
  State<BillPaymentSheet> createState() => _BillPaymentSheetState();
}

class _BillPaymentSheetState extends State<BillPaymentSheet> {
  final _amount = TextEditingController();
  final _note = TextEditingController();
  String _via = 'cash';
  late String _by =
      widget.staff
          .where(
            (s) =>
                s.id ==
                (widget.currentUid ??
                    FirebaseAuth.instance.currentUser?.uid ??
                    ''),
          )
          .firstOrNull
          ?.id ??
      '';
  bool _busy = false;
  String _error = '';

  /// The most the bill can take here, worked out once.
  late final int _payableCents = billPaymentPlan(
    widget.customer,
    1,
  ).payableCents;

  /// What the typed amount pays; null while nothing usable is typed. Worked
  /// out when the amount changes, never per build.
  BillPaymentPlan? _plan;
  int _cents = 0;

  @override
  void initState() {
    super.initState();
    _amount.addListener(_replan);
  }

  @override
  void dispose() {
    _amount.removeListener(_replan);
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  void _replan() {
    final typed = lotDollarsToCents(_amount.text);
    final plan = typed == null || typed <= 0
        ? null
        : billPaymentPlan(widget.customer, typed);
    setState(() {
      _cents = typed ?? 0;
      _plan = plan;
      _error = '';
    });
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
        for (final s in widget.staff) LotOption(s.id, s.name),
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
    final plan = _plan;
    if (plan == null || !plan.ok || _busy) return;
    if (_by.isEmpty) {
      AppHaptics.refuse();
      setState(() => _error = l10n.pmeSayWhoReceived);
      return;
    }
    setState(() {
      _busy = true;
      _error = '';
    });
    try {
      final result = await widget.service.record(
        businessId: widget.businessId,
        monthKey: widget.monthKey,
        customerKey: widget.customer.key,
        amountCents: _cents,
        receivedVia: _via,
        receivedByStaffId: _by,
        note: _note.text,
        expectedPayableCents: plan.payableCents,
      );
      if (!mounted) return;
      AppHaptics.commit();
      final recorded = parkingMoney(result.amountCents);
      final message = result.leftCents > 0
          ? l10n.pmeBillPaymentRecorded(
              recorded,
              parkingMoney(result.leftCents),
            )
          : l10n.pmeBillPaymentRecordedPaid(recorded);
      Navigator.of(context).pop(true);
      showSuccessSnackBar(context, message);
      if (result.receipt == 'failed') {
        showErrorSnackBar(context, l10n.pmeBillPaymentReceiptFailed);
      }
    } on ParkingBillPaymentFailure catch (failure) {
      if (!mounted) return;
      AppHaptics.refuse();
      final text = parkingBillPaymentFailureText(
        l10n,
        failure,
        payableCents: _payableCents,
      );
      if (failure.reason == BillPaymentRefusal.billChanged) {
        // The live month data is already refreshing: close, so the next try
        // starts from the new amounts.
        Navigator.of(context).pop(false);
        showErrorSnackBar(context, text);
      } else {
        setState(() => _error = text);
      }
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
    final plan = _plan;
    final ok = plan != null && plan.ok;
    final byName = _by.isEmpty
        ? null
        : receivedByName(
            l10n,
            _by,
            widget.staff.where((s) => s.id == _by).firstOrNull?.name ?? '',
          );
    return LotSheetShell(
      title: l10n.pmeRecordPayment,
      subtitle: '${widget.customer.customerName} · ${widget.monthLabel}',
      footer: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_error.isNotEmpty) ...[
            Text(
              _error,
              key: const Key('bill-payment-error'),
              style: const TextStyle(fontSize: 12.5, color: AppColors.errorRed),
            ),
            const SizedBox(height: AppSpacing.sm),
          ],
          LotSheetButton(
            key: const Key('bill-payment-save'),
            label: ok
                ? l10n.pmeRecordTotal(parkingMoney(_cents))
                : l10n.pmeRecordPayment,
            busy: _busy,
            tone: LotTone.good,
            onTap: ok ? _save : null,
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.pmeBillPaymentHint,
            style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            key: const Key('bill-payment-amount'),
            controller: _amount,
            enabled: !_busy,
            autofocus: true,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            decoration: InputDecoration(
              labelText: l10n.pmeBillPaymentAmount,
              prefixText: r'$ ',
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          _Preview(plan: plan, payableCents: _payableCents),
          const SizedBox(height: AppSpacing.md),
          LotPickerField(
            label: l10n.invPayMethod,
            value: parkingMethodLabel(l10n, _via),
            placeholder: l10n.invPayMethod,
            onTap: _busy ? () {} : _pickVia,
          ),
          const SizedBox(height: AppSpacing.md),
          LotPickerField(
            key: const Key('bill-payment-received-by'),
            label: l10n.lotReceivedBy,
            value: byName,
            placeholder: l10n.pmeWhoTookIt,
            onTap: _busy ? () {} : _pickBy,
            error: _error.isNotEmpty && _by.isEmpty
                ? l10n.pmeSayWhoReceived
                : null,
          ),
          const SizedBox(height: AppSpacing.md),
          TextField(
            controller: _note,
            enabled: !_busy,
            decoration: InputDecoration(labelText: l10n.invPayNote),
          ),
        ],
      ),
    );
  }
}

/// What the typed amount pays off, or why it cannot be taken.
class _Preview extends StatelessWidget {
  const _Preview({required this.plan, required this.payableCents});

  final BillPaymentPlan? plan;
  final int payableCents;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final plan = this.plan;
    if (plan == null) {
      return Text(
        l10n.pmeBillPaymentUpTo(parkingMoney(payableCents)),
        key: const Key('bill-payment-up-to'),
        style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
      );
    }
    if (!plan.ok) {
      return Text(
        parkingBillPaymentRefusalText(
          l10n,
          plan.reason,
          payableCents: plan.payableCents,
        ),
        key: const Key('bill-payment-refusal'),
        style: const TextStyle(fontSize: 12.5, color: AppColors.errorRed),
      );
    }
    return Column(
      key: const Key('bill-payment-preview'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          l10n.pmeBillPaymentPaysOff,
          style: const TextStyle(
            fontSize: 12.5,
            fontWeight: FontWeight.w700,
            color: AppColors.muted,
          ),
        ),
        const SizedBox(height: 4),
        for (final part in plan.parts)
          Padding(
            padding: const EdgeInsets.only(bottom: 4),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(
                    part.label,
                    style: const TextStyle(fontSize: 13, color: AppColors.ink),
                  ),
                ),
                const SizedBox(width: 8),
                if (part.full) ...[
                  Text(
                    l10n.pmeBillPaymentFull,
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: AppColors.sage,
                    ),
                  ),
                  const SizedBox(width: 8),
                ],
                Text(
                  parkingMoney(part.amountCents),
                  style: const TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    fontFeatures: [FontFeature.tabularFigures()],
                  ),
                ),
              ],
            ),
          ),
        const Divider(height: 14),
        Text(
          l10n.pmeBillPaymentLeft(parkingMoney(plan.leftCents)),
          key: const Key('bill-payment-left'),
          style: const TextStyle(
            fontSize: 14,
            fontWeight: FontWeight.w800,
            color: AppColors.ink,
          ),
        ),
      ],
    );
  }
}

/// "Payments on this bill" on a customer's card: each payment's amount,
/// method, date, who received it and what it paid; a recorded one can be
/// undone, an undone one shows greyed as "Undone · date".
class ParkingBillPaymentsSection extends StatelessWidget {
  const ParkingBillPaymentsSection({
    super.key,
    required this.payments,
    required this.staffNames,
    this.onUndo,
    this.busyKey = '',
  });

  /// Newest first (see [billPaymentsByCustomer]).
  final List<ParkingBillPayment> payments;
  final Map<String, String> staffNames;

  /// Null hides Undo.
  final ValueChanged<ParkingBillPayment>? onUndo;

  /// The payment being undone, as `undo:{id}`.
  final String busyKey;

  @override
  Widget build(BuildContext context) {
    if (payments.isEmpty) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    final language = Localizations.localeOf(context).languageCode == 'fr'
        ? 'fr'
        : 'en';
    String when(int ms) => ms > 0
        ? displayDateTime(DateTime.fromMillisecondsSinceEpoch(ms), locale)
        : '';
    return Padding(
      key: const Key('bill-payments'),
      padding: const EdgeInsets.only(top: AppSpacing.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Divider(height: 16),
          Text(
            l10n.pmeBillPaymentsTitle,
            style: const TextStyle(
              fontSize: 12.5,
              fontWeight: FontWeight.w700,
              color: AppColors.muted,
            ),
          ),
          const SizedBox(height: 4),
          for (final p in payments)
            _PaymentRow(
              key: Key('bill-payment-${p.id}'),
              payment: p,
              l10n: l10n,
              date: when(p.atMs),
              undoneDate: when(p.undoneAtMs > 0 ? p.undoneAtMs : p.atMs),
              receivedBy: receivedByName(
                l10n,
                p.receivedByStaffId,
                staffNames[p.receivedByStaffId] ?? '',
              ),
              paidFor: billPaymentFor([
                for (final x in p.parts) x.label,
              ], language),
              busy: busyKey == 'undo:${p.id}',
              canUndo: onUndo != null,
              onUndo: busyKey.isNotEmpty || onUndo == null
                  ? null
                  : () => onUndo!(p),
            ),
        ],
      ),
    );
  }
}

class _PaymentRow extends StatelessWidget {
  const _PaymentRow({
    super.key,
    required this.payment,
    required this.l10n,
    required this.date,
    required this.undoneDate,
    required this.receivedBy,
    required this.paidFor,
    required this.busy,
    required this.canUndo,
    required this.onUndo,
  });

  final ParkingBillPayment payment;
  final AppLocalizations l10n;
  final String date;
  final String undoneDate;
  final String receivedBy;
  final String paidFor;
  final bool busy;
  final bool canUndo;
  final VoidCallback? onUndo;

  @override
  Widget build(BuildContext context) {
    final undone = payment.undone;
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
                  [
                    parkingMoney(payment.amountCents),
                    parkingMethodLabel(l10n, payment.receivedVia),
                  ].join(' · '),
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: ink,
                    decoration: undone ? TextDecoration.lineThrough : null,
                  ),
                ),
                Text(
                  [
                    if (date.isNotEmpty) date,
                    if (receivedBy.isNotEmpty)
                      l10n.pmeBillPaymentReceivedBy(receivedBy),
                  ].join(' · '),
                  style: const TextStyle(
                    fontSize: 11.5,
                    color: AppColors.muted,
                  ),
                ),
                Text(
                  l10n.pmeBillPaymentPaidFor(paidFor),
                  style: const TextStyle(
                    fontSize: 11.5,
                    color: AppColors.muted,
                  ),
                ),
                if (undone)
                  Text(
                    l10n.pmeBillPaymentUndone(undoneDate),
                    key: Key('bill-payment-undone-${payment.id}'),
                    style: const TextStyle(
                      fontSize: 11.5,
                      fontWeight: FontWeight.w600,
                      color: AppColors.muted,
                    ),
                  ),
              ],
            ),
          ),
          if (!undone && canUndo)
            busy
                ? const Padding(
                    padding: EdgeInsets.all(8),
                    child: SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  )
                : TextButton(
                    key: Key('bill-payment-undo-${payment.id}'),
                    style: TextButton.styleFrom(
                      padding: const EdgeInsets.symmetric(horizontal: 8),
                      minimumSize: const Size(0, 32),
                      foregroundColor: AppColors.errorRed,
                    ),
                    onPressed: onUndo,
                    child: Text(l10n.pmeBillPaymentUndo),
                  ),
        ],
      ),
    );
  }
}
