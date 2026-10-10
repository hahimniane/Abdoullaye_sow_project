import 'dart:async';

import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/container_manifest.dart';
import '../services/invoice_ledger.dart'
    show invoiceCentsToInput, invoicePaymentMethods;
import '../services/lot_ledger.dart' show LotStaff, formatLotCents;
import '../services/waiting_package_service.dart';
import '../services/waiting_packages.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/action_confirmation.dart';
import '../utils/date_display.dart';
import '../utils/money_input.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/lot_sheets.dart';
import '../widgets/package_money.dart';
import 'containers_screen.dart';

/// How a hand-recorded payment arrived, in words.
String containerPaymentMethodLabel(AppLocalizations l10n, String method) =>
    switch (method) {
      'cash' => l10n.invMethodCash,
      'zelle' => l10n.invMethodZelle,
      'cashapp' => l10n.invMethodCashapp,
      'venmo' => l10n.invMethodVenmo,
      'check' => l10n.invMethodCheck,
      'card_in_person' => l10n.invMethodCardInPerson,
      _ => l10n.invMethodOther,
    };

/// Opens the price and payments sheet for [line]: any staff member may set
/// the price, record what arrived, or revert a mistake - and every change is
/// audited on the server with who and when.
Future<void> showPackagePaymentSheet(
  BuildContext context, {
  required String businessId,
  required ContainerLine line,
  List<LotStaff> staff = const [],
  ContainerCallableCaller caller = callContainerCallable,
  LinePaymentsSource? payments,
}) =>
    showLotSheet<void>(
      context,
      PackagePaymentSheet(
        businessId: businessId,
        line: line,
        staff: staff,
        caller: caller,
        payments: payments,
      ),
    );

/// A package's price, what has been paid on it and the payments behind that
/// number. The Guinea team records money here as it arrives; a payment is
/// never above the balance, and a mistaken one is reverted (struck through),
/// not erased.
class PackagePaymentSheet extends StatefulWidget {
  const PackagePaymentSheet({
    super.key,
    required this.businessId,
    required this.line,
    this.staff = const [],
    this.caller = callContainerCallable,
    this.payments,
  });

  final String businessId;
  final ContainerLine line;
  final List<LotStaff> staff;
  final ContainerCallableCaller caller;

  /// The line's payments; the real collection unless a test gives its own.
  final LinePaymentsSource? payments;

  @override
  State<PackagePaymentSheet> createState() => _PackagePaymentSheetState();
}

class _PackagePaymentSheetState extends State<PackagePaymentSheet> {
  final _price = TextEditingController();
  final _amount = TextEditingController();
  final _note = TextEditingController();
  StreamSubscription<List<ContainerLinePayment>>? _sub;
  Timer? _safety;

  late int? _priceCents = widget.line.priceCents;
  late int _paidCents = widget.line.paidCents;
  late bool _savedPayOnArrival = widget.line.payOnArrival;
  late bool _payOnArrival = widget.line.payOnArrival;
  String _method = 'cash';
  List<ContainerLinePayment> _payments = const [];
  bool _historyLoaded = false;

  /// Which action is in flight: every button waits, the one pressed spins.
  String _busy = '';
  Set<String> _errors = {};
  String _serverNote = '';

  PackagePayment get _standing => packageStanding(
        priceCents: _priceCents,
        paidCents: _paidCents,
        payOnArrival: _savedPayOnArrival,
      );

  @override
  void initState() {
    super.initState();
    final price = widget.line.priceCents;
    _price.text = price == null ? '' : invoiceCentsToInput(price);
    final source = widget.payments ?? FirestoreLinePaymentsSource();
    // A history that never answers is a spinner that never stops: after this
    // long it says there is nothing to show instead.
    _safety = Timer(const Duration(seconds: 15), () {
      if (mounted && !_historyLoaded) setState(() => _historyLoaded = true);
    });
    _sub = source.watch(widget.businessId, widget.line.id).listen((list) {
      if (!mounted) return;
      _safety?.cancel();
      setState(() {
        _payments = list;
        _historyLoaded = true;
      });
    }, onError: (_) {
      if (!mounted) return;
      _safety?.cancel();
      setState(() => _historyLoaded = true);
    });
  }

  @override
  void dispose() {
    _safety?.cancel();
    _sub?.cancel();
    _price.dispose();
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  String _staffName(String id) =>
      widget.staff.where((s) => s.id == id).firstOrNull?.name ?? '';

  /// One shape for every action: refuse what the phone can see, show progress
  /// on the button pressed, say what the server refused, and always release.
  Future<void> _run(
    String action,
    Future<void> Function() work,
  ) async {
    if (_busy.isNotEmpty) return;
    final l10n = AppLocalizations.of(context)!;
    setState(() {
      _busy = action;
      _serverNote = '';
      _errors = {};
    });
    try {
      await work();
      if (!mounted) return;
      AppHaptics.commit();
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _serverNote = containerRefusalText(l10n, error));
    } catch (_) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() => _serverNote = l10n.lotCouldNotSave);
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  int? _intOf(Object? data, String key) {
    final value = data is Map ? data[key] : null;
    return value is num && value.isFinite ? value.round() : null;
  }

  Future<void> _savePrice() async {
    final problems = validatePackagePrice(_price.text, _paidCents);
    if (problems.isNotEmpty) {
      AppHaptics.refuse();
      setState(() => _errors = problems.toSet());
      return;
    }
    final l10n = AppLocalizations.of(context)!;
    final cents = readPackagePrice(_price.text).cents;
    await _run('price', () async {
      final data = await widget.caller(
        'setContainerLinePrice',
        setPackagePriceRequest(
          widget.businessId,
          widget.line.id,
          priceCents: cents,
          payOnArrival: _payOnArrival,
        ),
      );
      if (!mounted) return;
      setState(() {
        _priceCents = cents;
        _savedPayOnArrival = _payOnArrival;
      });
      showSuccessSnackBar(context, l10n.wpkPriceSaved);
      // The server answers with what it stored; trust it over the request.
      final stored = _intOf(data, 'priceCents');
      if (data is Map && data.containsKey('priceCents')) {
        setState(() => _priceCents = stored);
      }
    });
  }

  Future<void> _record() async {
    final standing = _standing;
    final errors = validatePackagePayment(
      amount: _amount.text,
      method: _method,
      standing: standing,
    );
    if (errors.isNotEmpty) {
      AppHaptics.refuse();
      setState(() => _errors = errors.toSet());
      return;
    }
    final l10n = AppLocalizations.of(context)!;
    await _run('record', () async {
      final data = await widget.caller(
        'recordContainerLinePayment',
        recordPackagePaymentRequest(
          widget.businessId,
          widget.line.id,
          amountCents: parseMoneyCents(_amount.text) ?? 0,
          method: _method,
          note: _note.text,
        ),
      );
      if (!mounted) return;
      final paid = _intOf(data, 'paidCents');
      setState(() {
        _paidCents = paid ?? _paidCents + (parseMoneyCents(_amount.text) ?? 0);
        _amount.clear();
        _note.clear();
      });
      showSuccessSnackBar(context, l10n.wpkPaymentRecorded);
    });
  }

  Future<void> _revert(ContainerLinePayment payment) async {
    final l10n = AppLocalizations.of(context)!;
    final ok = await confirmMajorAction(
      context,
      title: l10n.wpkRevertTitle,
      message: l10n.wpkRevertMessage(formatLotCents(payment.amountCents)),
      confirmLabel: l10n.wpkRevert,
      destructive: true,
    );
    if (!ok || !mounted) return;
    await _run('revert:${payment.id}', () async {
      final data = await widget.caller(
        'revertContainerLinePayment',
        revertPackagePaymentRequest(widget.businessId, payment.id),
      );
      if (!mounted) return;
      final paid = _intOf(data, 'paidCents');
      setState(() {
        _paidCents = paid ??
            (_paidCents - payment.amountCents < 0
                ? 0
                : _paidCents - payment.amountCents);
      });
      showSuccessSnackBar(context, l10n.wpkReverted);
    });
  }

  Future<void> _pickMethod() async {
    final l10n = AppLocalizations.of(context)!;
    final picked = await pickLotOption<String>(
      context,
      title: l10n.wpkMethod,
      selected: _method,
      options: [
        for (final m in invoicePaymentMethods)
          LotOption(m, containerPaymentMethodLabel(l10n, m)),
      ],
    );
    if (picked == null || !mounted) return;
    setState(() => _method = picked);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    final standing = _standing;
    final busy = _busy.isNotEmpty;
    String? errorFor(List<String> codes) {
      for (final code in codes) {
        if (_errors.contains(code)) return containerErrorText(l10n, code);
      }
      return null;
    }

    return LotSheetShell(
      title: l10n.wpkMoney,
      subtitle: containerLineTitle(l10n, widget.line),
      footer: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_serverNote.isNotEmpty) ...[
            ContainerRefusalNote(text: _serverNote),
            const SizedBox(height: AppSpacing.sm),
          ],
          LotSheetButton(
            key: const Key('pay-record'),
            label: l10n.wpkRecordPayment,
            busy: _busy == 'record',
            busyLabel: l10n.lotSaving,
            tone: LotTone.good,
            // Nothing to pay against until there is a price; nothing to
            // record once it is paid in full.
            onTap: busy || !standing.hasPrice || standing.balanceCents == 0
                ? null
                : _record,
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Align(
            alignment: Alignment.centerLeft,
            child: PackageMoneyLine(payment: standing, alwaysShow: true),
          ),
          const SizedBox(height: AppSpacing.lg),
          TextField(
            key: const Key('pay-price'),
            controller: _price,
            enabled: !busy,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            onChanged: (_) => setState(() {
              _errors = {..._errors}
                ..remove('price_invalid')
                ..remove('price_below_paid');
            }),
            decoration: InputDecoration(
              labelText: l10n.wpkPrice,
              prefixText: r'$ ',
              helperText: l10n.wpkPriceHint,
              errorText: errorFor(['price_invalid', 'price_below_paid']),
              errorMaxLines: 3,
            ),
          ),
          SwitchListTile.adaptive(
            key: const Key('pay-on-arrival'),
            contentPadding: EdgeInsets.zero,
            dense: true,
            value: _payOnArrival,
            onChanged: busy ? null : (v) => setState(() => _payOnArrival = v),
            title: Text(
              l10n.wpkPayOnArrival,
              style: const TextStyle(
                fontSize: 14,
                fontWeight: FontWeight.w600,
                color: AppColors.ink,
              ),
            ),
            subtitle: Text(
              l10n.wpkPayOnArrivalNote,
              style: const TextStyle(fontSize: 12, color: AppColors.muted),
            ),
          ),
          Align(
            alignment: Alignment.centerRight,
            child: TextButton(
              key: const Key('pay-save-price'),
              onPressed: busy ? null : _savePrice,
              child: _busy == 'price'
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(l10n.wpkSavePrice),
            ),
          ),
          if (standing.hasPrice) ...[
            const Divider(height: AppSpacing.xl),
            TextField(
              key: const Key('pay-amount'),
              controller: _amount,
              enabled: !busy,
              keyboardType:
                  const TextInputType.numberWithOptions(decimal: true),
              onChanged: (_) => setState(() => _errors = {..._errors}
                ..remove('amount_required')
                ..remove('amount_too_large')
                ..remove('payment_exceeds_balance')
                ..remove('price_required')),
              decoration: InputDecoration(
                labelText: l10n.wpkAmountReceived,
                prefixText: r'$ ',
                errorText: errorFor([
                  'amount_required',
                  'amount_too_large',
                  'payment_exceeds_balance',
                  'price_required',
                ]),
                errorMaxLines: 3,
              ),
            ),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                key: const Key('pay-whole-balance'),
                onPressed: busy || (standing.balanceCents ?? 0) == 0
                    ? null
                    : () => setState(() {
                          _amount.text = wholeBalanceInput(standing);
                          _errors = {};
                        }),
                child: Text(l10n.wpkPayWholeBalance),
              ),
            ),
            LotPickerField(
              key: const Key('pay-method'),
              label: l10n.wpkMethod,
              value: containerPaymentMethodLabel(l10n, _method),
              placeholder: l10n.wpkMethod,
              onTap: busy ? () {} : _pickMethod,
              error: errorFor(['payment_method_invalid']),
            ),
            const SizedBox(height: AppSpacing.md),
            TextField(
              key: const Key('pay-note'),
              controller: _note,
              enabled: !busy,
              textCapitalization: TextCapitalization.sentences,
              decoration: InputDecoration(labelText: l10n.wpkNote),
            ),
          ],
          const SizedBox(height: AppSpacing.lg),
          Text(
            l10n.wpkPaymentsTitle,
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w700,
              letterSpacing: 0.2,
              color: AppColors.ink,
            ),
          ),
          const SizedBox(height: AppSpacing.sm),
          if (!_historyLoaded)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: AppSpacing.lg),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (_payments.isEmpty)
            Text(
              l10n.wpkNoPayments,
              key: const Key('pay-history-empty'),
              style: const TextStyle(fontSize: 13, color: AppColors.muted),
            )
          else
            Column(
              key: const Key('pay-history'),
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final payment in _payments)
                  _PaymentRow(
                    key: ValueKey('pay-row:${payment.id}'),
                    payment: payment,
                    locale: locale,
                    receivedBy: _staffName(payment.receivedByStaffId),
                    revertedBy: _staffName(payment.revertedByStaffId),
                    busy: busy,
                    reverting: _busy == 'revert:${payment.id}',
                    onRevert: () => _revert(payment),
                  ),
              ],
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
    required this.locale,
    required this.receivedBy,
    required this.revertedBy,
    required this.busy,
    required this.reverting,
    required this.onRevert,
  });

  final ContainerLinePayment payment;
  final String locale;
  final String receivedBy;
  final String revertedBy;
  final bool busy;
  final bool reverting;
  final VoidCallback onRevert;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final reverted = payment.reverted;
    final when = payment.createdAt == null
        ? ''
        : displayDateTime(payment.createdAt!, locale);
    final detail = [
      containerPaymentMethodLabel(l10n, payment.method),
      if (when.isNotEmpty) when,
      if (receivedBy.isNotEmpty) l10n.wpkRecordedBy(receivedBy),
    ].join(' · ');
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.md),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  formatLotCents(payment.amountCents),
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w700,
                    color: reverted ? AppColors.muted : AppColors.ink,
                    decoration: reverted ? TextDecoration.lineThrough : null,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  detail,
                  style: const TextStyle(
                    fontSize: 12,
                    height: 1.35,
                    color: AppColors.muted,
                  ),
                ),
                if (payment.note.isNotEmpty)
                  Text(
                    payment.note,
                    style: const TextStyle(
                      fontSize: 12,
                      height: 1.35,
                      color: AppColors.muted,
                    ),
                  ),
                if (reverted)
                  Text(
                    revertedBy.isEmpty
                        ? l10n.wpkRevertedMark
                        : l10n.wpkRevertedBy(revertedBy),
                    key: Key('pay-reverted:${payment.id}'),
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: AppColors.errorRed,
                    ),
                  ),
              ],
            ),
          ),
          if (!reverted)
            TextButton(
              key: Key('pay-revert:${payment.id}'),
              onPressed: busy ? null : onRevert,
              child: reverting
                  ? const SizedBox(
                      width: 16,
                      height: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(l10n.wpkRevert),
            ),
        ],
      ),
    );
  }
}
