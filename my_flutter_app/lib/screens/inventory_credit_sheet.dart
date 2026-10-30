import 'dart:async';

import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../l10n/app_localizations.dart';
import '../services/eastern_clock.dart';
import '../services/inventory.dart';
import '../services/inventory_credit.dart';
import '../services/inventory_service.dart';
import '../services/invoice_ledger.dart' show invoicePaymentMethods;
import '../services/lot_ledger.dart' show LotStaff, formatLotCents;
import '../services/package_codes.dart' show packagePhoneCallUri;
import '../services/waiting_packages.dart' show wholeBalanceInput;
import '../services/zelle_check.dart';
import '../services/zelle_check_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/action_confirmation.dart';
import '../utils/date_display.dart';
import '../utils/money_input.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/day_picker.dart';
import '../widgets/inventory_widgets.dart';
import '../widgets/lot_sheets.dart';
import '../widgets/received_by_options.dart';
import 'package_payment_sheet.dart'
    show RecordedPaymentRow, containerPaymentMethodLabel;
import 'zelle_check_sheet.dart';

/// Starts a phone call; answers whether anything could take it.
typedef InventoryDialer = Future<bool> Function(Uri uri);

Future<bool> _launchDialer(Uri uri) => launchUrl(uri);

/// Opens a credit sale: who owes, who collects and by when, what came in
/// since, and the actions - Record payment, Revert, Change collector or due
/// date.
Future<void> showInventoryCreditSheet(
  BuildContext context, {
  required String businessId,
  required InventorySale sale,
  required List<LotStaff> staff,
  InventoryService service = const InventoryService(),
  InventoryCreditSource? creditSource,
  String paymentsStoreId = '',
  String currentUserId = '',
  DateTime Function() clock = DateTime.now,
  InventoryDialer dialer = _launchDialer,
  bool? isOwner,
}) => showLotSheet<void>(
  context,
  InventoryCreditSheet(
    businessId: businessId,
    sale: sale,
    staff: staff,
    service: service,
    creditSource: creditSource,
    paymentsStoreId: paymentsStoreId,
    currentUserId: currentUserId,
    clock: clock,
    dialer: dialer,
    isOwner: isOwner,
  ),
);

/// The credit side of one sale, the way the package money sheet shows a
/// package's: the balance on top, then the payments behind it. A payment is
/// never above the balance and a mistaken one is reverted (struck through),
/// never erased. Every change is a callable the server audits.
class InventoryCreditSheet extends StatefulWidget {
  const InventoryCreditSheet({
    super.key,
    required this.businessId,
    required this.sale,
    required this.staff,
    this.service = const InventoryService(),
    this.creditSource,
    this.paymentsStoreId = '',
    this.currentUserId = '',
    this.clock = DateTime.now,
    this.dialer = _launchDialer,
    this.isOwner,
  });

  /// Whether the viewer owns the business (Check Zelle then offers to
  /// connect the bank); null reads the signed-in profile.
  final bool? isOwner;

  final String businessId;
  final InventorySale sale;

  /// Everyone who can take money or collect (the owner included).
  final List<LotStaff> staff;
  final InventoryService service;
  final InventoryCreditSource? creditSource;

  /// Staff tied to one store read that store's payments only (the rules).
  final String paymentsStoreId;
  final String currentUserId;
  final DateTime Function() clock;
  final InventoryDialer dialer;

  @override
  State<InventoryCreditSheet> createState() => _InventoryCreditSheetState();
}

class _InventoryCreditSheetState extends State<InventoryCreditSheet> {
  final _amount = TextEditingController();
  final _note = TextEditingController();
  StreamSubscription<List<InventoryCreditPayment>>? _sub;
  Timer? _safety;

  late int _creditPaidCents = widget.sale.creditPaidCents;
  late String _status = widget.sale.creditStatus;
  late String _collector = widget.sale.credit?.collectorStaffId ?? '';
  late String _dueDate = widget.sale.credit?.dueDate ?? '';

  String _method = 'cash';

  /// Who took the money: blank until chosen, as for packages and parking.
  String? _receivedBy;
  List<InventoryCreditPayment> _payments = const [];
  bool _historyLoaded = false;

  /// Confirmed from the Check Zelle sheet, before the stream shows it.
  final Map<String, BankCheck> _bankConfirmed = {};

  /// Changing the collector or the due date: the two pickers and Save.
  bool _editing = false;
  String _editCollector = '';
  String _editDueDate = '';

  String _busy = '';
  Set<String> _errors = {};
  String _serverNote = '';

  InventorySale get _sale => widget.sale;
  int get _creditCents => _sale.creditCents;
  int get _balanceCents {
    final left = _creditCents - _creditPaidCents;
    return left > 0 ? left : 0;
  }

  bool get _open => !_sale.voided && _status == 'open' && _balanceCents > 0;

  @override
  void initState() {
    super.initState();
    _safety = Timer(const Duration(seconds: 15), () {
      if (mounted && !_historyLoaded) setState(() => _historyLoaded = true);
    });
    try {
      final source = widget.creditSource ?? FirestoreInventoryCreditSource();
      _sub = source
          .watchCreditPayments(
            widget.businessId,
            _sale.id,
            storeId: widget.paymentsStoreId,
          )
          .listen(
            (rows) {
              if (!mounted) return;
              _safety?.cancel();
              setState(() {
                _payments = rows;
                _historyLoaded = true;
              });
            },
            onError: (_) {
              if (!mounted) return;
              _safety?.cancel();
              setState(() => _historyLoaded = true);
            },
          );
    } catch (_) {
      _historyLoaded = true;
    }
  }

  @override
  void dispose() {
    _safety?.cancel();
    _sub?.cancel();
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  String _name(String id) => receivedByName(
    AppLocalizations.of(context)!,
    id,
    inventoryStaffName(widget.staff, id),
  );

  String _personLabel(AppLocalizations l10n, String id) {
    final name = _name(id);
    final shown = name.isEmpty ? id : name;
    return id.isNotEmpty && id == widget.currentUserId
        ? l10n.invCreditMe(shown)
        : shown;
  }

  Future<void> _run(String action, Future<void> Function() work) async {
    if (_busy.isNotEmpty) return;
    final l10n = AppLocalizations.of(context)!;
    setState(() {
      _busy = action;
      _serverNote = '';
      _errors = {};
    });
    try {
      await work();
      if (mounted) AppHaptics.commit();
    } catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(
        () => _serverNote = inventoryFailureText(
          l10n,
          inventoryFailureFromError(error),
        ),
      );
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  void _applyResult(InventoryCreditPaymentResult result, int fallbackPaid) {
    setState(() {
      _creditPaidCents = result.creditPaidCents ?? fallbackPaid;
      if (result.creditStatus.isNotEmpty) {
        _status = result.creditStatus;
      } else {
        _status = _creditPaidCents >= _creditCents ? 'paid' : 'open';
      }
    });
  }

  Future<void> _record() async {
    final errors = validateInventoryCreditPayment(
      amount: _amount.text,
      method: _method,
      creditCents: _creditCents,
      creditPaidCents: _creditPaidCents,
      receivedByStaffId: _receivedBy ?? '',
      staffIds: [for (final s in widget.staff) s.id],
    );
    if (errors.isNotEmpty) {
      AppHaptics.refuse();
      setState(() => _errors = errors.toSet());
      return;
    }
    final l10n = AppLocalizations.of(context)!;
    final cents = parseMoneyCents(_amount.text) ?? 0;
    await _run('record', () async {
      final result = await widget.service.recordCreditPayment(
        businessId: widget.businessId,
        saleId: _sale.id,
        amountCents: cents,
        method: _method,
        receivedByStaffId: _receivedBy ?? '',
        note: _note.text,
      );
      if (!mounted) return;
      _applyResult(result, _creditPaidCents + cents);
      setState(() {
        _amount.clear();
        _note.clear();
        _receivedBy = null;
      });
      showSuccessSnackBar(context, l10n.wpkPaymentRecorded);
    });
  }

  Future<void> _revert(InventoryCreditPayment payment) async {
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
      final result = await widget.service.revertCreditPayment(
        widget.businessId,
        payment.id,
      );
      if (!mounted) return;
      final back = _creditPaidCents - payment.amountCents;
      _applyResult(result, back < 0 ? 0 : back);
      showSuccessSnackBar(context, l10n.wpkReverted);
    });
  }

  Future<void> _saveCollector() async {
    if (_editCollector.isEmpty) {
      AppHaptics.refuse();
      setState(() => _errors = {'collector_required'});
      return;
    }
    if (!inventoryDueDateValid(_editDueDate, today: shopToday(widget.clock())) &&
        _editDueDate != (_sale.credit?.dueDate ?? '')) {
      AppHaptics.refuse();
      setState(() => _errors = {'due_date_invalid'});
      return;
    }
    final l10n = AppLocalizations.of(context)!;
    final dueChanged = _editDueDate != _dueDate;
    await _run('collector', () async {
      await widget.service.setCreditCollector(
        businessId: widget.businessId,
        saleId: _sale.id,
        collectorStaffId: _editCollector,
        dueDate: dueChanged ? _editDueDate : null,
      );
      if (!mounted) return;
      setState(() {
        _collector = _editCollector;
        _dueDate = _editDueDate;
        _editing = false;
      });
      showSuccessSnackBar(context, l10n.invCreditChanged);
    });
  }

  /// "Check Zelle" on one later payment, through the inventory caller.
  Future<void> _checkZelle(InventoryCreditPayment payment) =>
      showZelleCheckSheet(
        context,
        businessId: widget.businessId,
        kind: ZelleCheckKind.inventoryCreditPayment,
        id: payment.id,
        amountCents: payment.amountCents,
        isOwner: widget.isOwner,
        service: ZelleCheckService(caller: widget.service.caller),
        onConfirmed: (check) {
          if (mounted) setState(() => _bankConfirmed[payment.id] = check);
        },
      );

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

  /// [receiver] adds the Business account first: who took money, not who
  /// collects the debt.
  Future<String?> _pickPerson(
    String title,
    String? selected, {
    bool receiver = false,
  }) {
    final l10n = AppLocalizations.of(context)!;
    final people = [
      for (final p in widget.staff) LotOption(p.id, _personLabel(l10n, p.id)),
    ];
    return pickLotOption<String>(
      context,
      title: title,
      selected: selected,
      options: receiver ? receivedByOptions(l10n, people) : people,
    );
  }

  Future<void> _call() async {
    final l10n = AppLocalizations.of(context)!;
    final uri = packagePhoneCallUri(_sale.credit?.customerPhone ?? '');
    var ok = false;
    if (uri != null) {
      try {
        ok = await widget.dialer(uri);
      } catch (_) {
        ok = false;
      }
    }
    if (!ok && mounted) showErrorSnackBar(context, l10n.invCreditCallFailed);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    final busy = _busy.isNotEmpty;
    final today = shopToday(widget.clock());
    final due = parseDayKey(_dueDate);
    final overdue =
        _open &&
        due != null &&
        due.isBefore(DateTime(today.year, today.month, today.day));
    final credit = _sale.credit;
    String? errorFor(List<String> codes) {
      for (final code in codes) {
        if (_errors.contains(code)) return inventoryCreditErrorText(l10n, code);
      }
      return null;
    }

    const label = TextStyle(
      fontSize: 11,
      fontWeight: FontWeight.w600,
      letterSpacing: 0.2,
      color: AppColors.muted,
    );
    const value = TextStyle(
      fontSize: 15,
      fontWeight: FontWeight.w600,
      color: AppColors.ink,
    );

    return LotSheetShell(
      title: l10n.invCreditOnCredit,
      subtitle: [
        formatLotCents(_sale.totalCents),
        if (_sale.createdAt != null)
          l10n.invCreditSoldOn(displayDateTime(_sale.createdAt!, locale)),
      ].join(' · '),
      footer: _open
          ? Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                if (_serverNote.isNotEmpty) ...[
                  InventoryNote(
                    key: const Key('credit-server-note'),
                    text: _serverNote,
                  ),
                  const SizedBox(height: AppSpacing.sm),
                ],
                LotSheetButton(
                  key: const Key('credit-record'),
                  label: l10n.wpkRecordPayment,
                  busy: _busy == 'record',
                  busyLabel: l10n.lotSaving,
                  tone: LotTone.good,
                  onTap: busy ? null : _record,
                ),
              ],
            )
          : (_serverNote.isEmpty
                ? null
                : InventoryNote(
                    key: const Key('credit-server-note'),
                    text: _serverNote,
                  )),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Where it stands.
          Text(
            _sale.voided
                ? l10n.invCreditVoidedNote
                : _open
                ? l10n.invCreditOwedOf(
                    formatLotCents(_balanceCents),
                    formatLotCents(_creditCents),
                  )
                : l10n.invCreditPaidOff,
            key: const Key('credit-standing'),
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w800,
              color: _sale.voided
                  ? AppColors.muted
                  : overdue
                  ? AppColors.errorRed
                  : _open
                  ? AppColors.ink
                  : AppColors.sage,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            [
              l10n.invCreditPaidAtSale(formatLotCents(_sale.paidAtSaleCents)),
              if (_name(_sale.moneyReceivedBy).isNotEmpty)
                l10n.invCreditReceivedByName(_name(_sale.moneyReceivedBy)),
            ].join(' · '),
            style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
          ),
          const SizedBox(height: AppSpacing.lg),

          // Who owes it.
          Text(l10n.invCreditCustomer, style: label),
          const SizedBox(height: 2),
          Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      credit?.customerName ?? '',
                      key: const Key('credit-customer'),
                      style: value,
                    ),
                    if ((credit?.customerPhone ?? '').isNotEmpty)
                      Text(
                        credit!.customerPhone,
                        key: const Key('credit-phone'),
                        style: const TextStyle(
                          fontSize: 13,
                          color: AppColors.muted,
                        ),
                      ),
                  ],
                ),
              ),
              if (packagePhoneCallUri(credit?.customerPhone ?? '') != null)
                IconButton(
                  key: const Key('credit-call'),
                  tooltip: l10n.invCreditCall(credit?.customerName ?? ''),
                  onPressed: _call,
                  icon: const Icon(
                    Icons.call_outlined,
                    color: AppColors.cobalt,
                  ),
                ),
            ],
          ),
          const SizedBox(height: AppSpacing.md),

          // Who collects, and by when.
          Text(
            _collector.isEmpty
                ? l10n.invCreditNoCollector
                : l10n.invCreditCollectedBy(_personLabel(l10n, _collector)),
            key: const Key('credit-collector'),
            style: value,
          ),
          if (due != null)
            Text(
              overdue
                  ? l10n.invCreditOverdueSince(displayDate(due, locale))
                  : l10n.invCreditDueOn(displayDate(due, locale)),
              key: const Key('credit-due'),
              style: TextStyle(
                fontSize: 13,
                fontWeight: overdue ? FontWeight.w700 : FontWeight.w400,
                color: overdue ? AppColors.errorRed : AppColors.muted,
              ),
            ),
          if (_open && !_editing)
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                key: const Key('credit-change'),
                onPressed: busy
                    ? null
                    : () => setState(() {
                        _editing = true;
                        _editCollector = _collector;
                        _editDueDate = _dueDate;
                        _errors = {};
                      }),
                child: Text(l10n.invCreditChange),
              ),
            ),
          if (_editing) ..._editBlock(l10n, locale, busy, errorFor),

          if (_open) ...[
            const Divider(height: AppSpacing.xl),
            TextField(
              key: const Key('credit-amount'),
              controller: _amount,
              enabled: !busy,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              onChanged: (_) => setState(
                () => _errors = {..._errors}
                  ..remove('amount_required')
                  ..remove('amount_too_large')
                  ..remove('payment_exceeds_balance'),
              ),
              decoration: InputDecoration(
                labelText: l10n.wpkAmountReceived,
                prefixText: r'$ ',
                errorText: errorFor([
                  'amount_required',
                  'amount_too_large',
                  'payment_exceeds_balance',
                ]),
                errorMaxLines: 3,
              ),
            ),
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                key: const Key('credit-whole-balance'),
                onPressed: busy
                    ? null
                    : () => setState(() {
                        _amount.text = wholeBalanceInput(
                          inventoryCreditMoney(
                            creditCents: _creditCents,
                            creditPaidCents: _creditPaidCents,
                          ),
                        );
                        _errors = {};
                      }),
                child: Text(l10n.wpkPayWholeBalance),
              ),
            ),
            LotPickerField(
              key: const Key('credit-method'),
              label: l10n.wpkMethod,
              value: containerPaymentMethodLabel(l10n, _method),
              placeholder: l10n.wpkMethod,
              onTap: busy ? () {} : _pickMethod,
              error: errorFor(['payment_method_invalid']),
            ),
            const SizedBox(height: AppSpacing.md),
            LotPickerField(
              key: const Key('credit-received-by'),
              label: l10n.lotReceivedBy,
              value: (_receivedBy ?? '').isEmpty
                  ? null
                  : _personLabel(l10n, _receivedBy!),
              placeholder: l10n.lotReceivedBy,
              onTap: busy
                  ? () {}
                  : () async {
                      final picked = await _pickPerson(
                        l10n.lotReceivedBy,
                        _receivedBy,
                        receiver: true,
                      );
                      if (picked == null || !mounted) return;
                      setState(() {
                        _receivedBy = picked;
                        _errors = {..._errors}
                          ..remove('received_by_required')
                          ..remove('received_by_invalid');
                      });
                    },
              error: errorFor(['received_by_required', 'received_by_invalid']),
            ),
            const SizedBox(height: AppSpacing.md),
            TextField(
              key: const Key('credit-note'),
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
              key: const Key('credit-history-empty'),
              style: const TextStyle(fontSize: 13, color: AppColors.muted),
            )
          else
            Column(
              key: const Key('credit-history'),
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final payment in _payments)
                  RecordedPaymentRow(
                    key: ValueKey('credit-row:${payment.id}'),
                    id: payment.id,
                    amountCents: payment.amountCents,
                    method: payment.method,
                    createdAt: payment.createdAt,
                    note: payment.note,
                    reverted: payment.reverted,
                    locale: locale,
                    receivedBy: _name(payment.receivedByStaffId),
                    enteredBy:
                        payment.recordedByStaffId.isNotEmpty &&
                            payment.recordedByStaffId !=
                                payment.receivedByStaffId
                        ? _name(payment.recordedByStaffId)
                        : '',
                    revertedBy: _name(payment.revertedByStaffId),
                    busy: busy || _sale.voided,
                    reverting: _busy == 'revert:${payment.id}',
                    onRevert: () => _revert(payment),
                    bankCheck:
                        payment.bankCheck ?? _bankConfirmed[payment.id],
                    onCheckZelle: _sale.voided
                        ? null
                        : () => _checkZelle(payment),
                  ),
              ],
            ),
        ],
      ),
    );
  }

  List<Widget> _editBlock(
    AppLocalizations l10n,
    String locale,
    bool busy,
    String? Function(List<String>) errorFor,
  ) {
    final due = parseDayKey(_editDueDate);
    return [
      const SizedBox(height: AppSpacing.sm),
      LotPickerField(
        key: const Key('credit-edit-collector'),
        label: l10n.invCreditCollector,
        value: _editCollector.isEmpty
            ? null
            : _personLabel(l10n, _editCollector),
        placeholder: l10n.invCreditCollectorPick,
        onTap: busy
            ? () {}
            : () async {
                final picked = await _pickPerson(
                  l10n.invCreditCollectorPick,
                  _editCollector,
                );
                if (picked == null || !mounted) return;
                setState(() => _editCollector = picked);
              },
        error: errorFor(['collector_required']),
      ),
      const SizedBox(height: AppSpacing.md),
      Row(
        children: [
          Expanded(
            child: LotPickerField(
              key: const Key('credit-edit-due'),
              label: l10n.invCreditDueDate,
              value: due == null ? null : displayDate(due, locale),
              placeholder: l10n.invCreditNoDueDate,
              onTap: busy
                  ? () {}
                  : () async {
                      final today = shopToday(widget.clock());
                      final picked = await pickCalendarDay(
                        context,
                        initial: due ?? today.add(const Duration(days: 7)),
                        first: today,
                        last: today.add(const Duration(days: 730)),
                      );
                      if (picked == null || !mounted) return;
                      setState(() => _editDueDate = inventoryDayKey(picked));
                    },
              error: errorFor(['due_date_invalid']),
            ),
          ),
          if (due != null)
            IconButton(
              key: const Key('credit-edit-due-clear'),
              tooltip: l10n.invCreditClearDueDate,
              onPressed: busy ? null : () => setState(() => _editDueDate = ''),
              icon: const Icon(Icons.close, size: 20),
            ),
        ],
      ),
      Row(
        mainAxisAlignment: MainAxisAlignment.end,
        children: [
          TextButton(
            onPressed: busy ? null : () => setState(() => _editing = false),
            child: Text(l10n.cancel),
          ),
          TextButton(
            key: const Key('credit-edit-save'),
            onPressed: busy ? null : _saveCollector,
            child: _busy == 'collector'
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : Text(l10n.save),
          ),
        ],
      ),
    ];
  }
}
