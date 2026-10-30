import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/business_account_receiver.dart';
import '../services/eastern_clock.dart';
import '../services/inventory.dart';
import '../services/inventory_credit.dart';
import '../services/inventory_service.dart';
import '../services/invoice_ledger.dart' show invoicePaymentMethods;
import '../services/lot_ledger.dart' show LotStaff, formatLotCents;
import '../theme/app_motion.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../utils/action_confirmation.dart';
import '../utils/date_display.dart';
import '../widgets/inventory_credit_fields.dart';
import '../widgets/inventory_widgets.dart';
import '../widgets/lot_sheets.dart';
import '../widgets/received_by_options.dart';
import 'package_payment_sheet.dart' show containerPaymentMethodLabel;

/// Switches a recorded sale between paid and credit (docs/INVENTORY.md v6):
/// "Switch to credit" on a sale paid in full, "Switch to paid" on a credit
/// sale nothing was collected on. Answers the server's result once the switch
/// is made, null when dismissed.
Future<InventorySaleSwitchResult?> showInventorySaleSwitchSheet(
  BuildContext context, {
  required String businessId,
  required InventorySale sale,
  required List<LotStaff> staff,
  InventoryService service = const InventoryService(),
  String currentUserId = '',
  DateTime Function() clock = DateTime.now,
  String Function() newRequestId = newInventoryRequestId,
}) => showLotSheet<InventorySaleSwitchResult>(
  context,
  InventorySaleSwitchSheet(
    businessId: businessId,
    sale: sale,
    staff: staff,
    service: service,
    currentUserId: currentUserId,
    clock: clock,
    newRequestId: newRequestId,
  ),
);

/// To credit asks what a credit sale asks at the counter (the Sell screen's
/// fields: what was paid at the time, who owes the rest, who collects it, by
/// when); to paid asks how the whole total was paid and who received it,
/// prefilled from the sale. Both confirm before anything is sent, and a
/// retry of the same answers reuses its request id (the server answers the
/// same switch, never a second one).
class InventorySaleSwitchSheet extends StatefulWidget {
  const InventorySaleSwitchSheet({
    super.key,
    required this.businessId,
    required this.sale,
    required this.staff,
    this.service = const InventoryService(),
    this.currentUserId = '',
    this.clock = DateTime.now,
    this.newRequestId = newInventoryRequestId,
  });

  final String businessId;
  final InventorySale sale;

  /// Everyone who can collect or receive money (the owner included).
  final List<LotStaff> staff;
  final InventoryService service;
  final String currentUserId;
  final DateTime Function() clock;
  final String Function() newRequestId;

  @override
  State<InventorySaleSwitchSheet> createState() =>
      _InventorySaleSwitchSheetState();
}

class _InventorySaleSwitchSheetState extends State<InventorySaleSwitchSheet> {
  late final bool _toCredit = inventorySaleCanSwitchToCredit(widget.sale);

  // To credit.
  InventoryCheckoutDraft _draft = inventorySwitchCreditDraft;
  final _paidNow = TextEditingController();
  final _customerName = TextEditingController();
  final _customerPhone = TextEditingController();
  bool _tried = false;

  // To paid.
  late String _method = inventorySwitchDefaultMethod(widget.sale);
  late String _receivedBy = inventorySwitchDefaultReceiver(widget.sale);
  Set<String> _paidErrors = {};

  bool _busy = false;
  String _serverNote = '';
  String _attemptKey = '';
  String _attemptId = '';

  InventorySale get _sale => widget.sale;

  @override
  void dispose() {
    _paidNow.dispose();
    _customerName.dispose();
    _customerPhone.dispose();
    super.dispose();
  }

  /// One id per set of answers: the same answers sent again are a retry.
  String _requestIdFor(String key) {
    if (key != _attemptKey || _attemptId.isEmpty) {
      _attemptKey = key;
      _attemptId = widget.newRequestId();
    }
    return _attemptId;
  }

  String _name(String id) => inventoryStaffName(widget.staff, id);

  String _personLabel(AppLocalizations l10n, String id) {
    if (isBusinessAccountReceiver(id)) return l10n.sbalBusinessAccount;
    final name = _name(id);
    return inventoryPersonOptionLabel(
      l10n,
      id,
      name.isEmpty ? id : name,
      widget.currentUserId,
    );
  }

  List<String> _creditProblems() => validateInventoryCheckout(
    _draft,
    totalCents: _sale.totalCents,
    staffIds: [for (final p in widget.staff) p.id],
    today: shopToday(widget.clock()),
  );

  Future<void> _pickCollector() async {
    final l10n = AppLocalizations.of(context)!;
    final picked = await pickInventoryPerson(
      context,
      title: l10n.invCreditCollectorPick,
      people: widget.staff,
      me: widget.currentUserId,
      selected: _draft.collectorStaffId,
    );
    if (picked == null || !mounted) return;
    setState(() => _draft = _draft.copyWith(collectorStaffId: picked));
  }

  Future<void> _pickDueDate() async {
    final picked = await pickInventoryDueDay(
      context,
      today: shopToday(widget.clock()),
      current: _draft.dueDate,
    );
    if (picked == null || !mounted) return;
    setState(() => _draft = _draft.copyWith(dueDate: picked));
  }

  Future<void> _pickMethod() async {
    final l10n = AppLocalizations.of(context)!;
    final picked = await pickLotOption<String>(
      context,
      title: l10n.invSwitchHowPaid,
      selected: _method,
      options: [
        for (final m in invoicePaymentMethods)
          LotOption(m, containerPaymentMethodLabel(l10n, m)),
      ],
    );
    if (picked == null || !mounted) return;
    setState(() => _method = picked);
  }

  Future<void> _pickReceiver() async {
    final l10n = AppLocalizations.of(context)!;
    final picked = await pickLotOption<String>(
      context,
      title: l10n.lotReceivedBy,
      selected: _receivedBy,
      options: receivedByOptions(l10n, [
        for (final p in widget.staff)
          LotOption(
            p.id,
            inventoryPersonOptionLabel(
              l10n,
              p.id,
              p.name,
              widget.currentUserId,
            ),
          ),
      ]),
    );
    if (picked == null || !mounted) return;
    setState(() => _receivedBy = picked);
  }

  Future<void> _submit() async {
    if (_busy) return;
    final l10n = AppLocalizations.of(context)!;
    final Future<InventorySaleSwitchResult> Function(String requestId) send;
    final String key;
    final bool ok;
    if (_toCredit) {
      if (_creditProblems().isNotEmpty) {
        AppHaptics.refuse();
        setState(() => _tried = true);
        return;
      }
      final credit = inventoryCreditRequest(_sale.totalCents, _draft)!;
      final split = inventoryCheckoutSplit(_sale.totalCents, _draft);
      key = 'credit|${_draft.signature}';
      ok = await confirmMajorAction(
        context,
        title: l10n.invSwitchConfirmCreditTitle,
        message: l10n.invSwitchConfirmCreditMessage(
          _draft.customerName.trim(),
          formatLotCents(split.creditCents),
          formatLotCents(split.paidNowCents),
        ),
        confirmLabel: l10n.invSwitchToCredit,
        icon: Icons.swap_horiz,
      );
      send = (id) => widget.service.switchSalePayment(
        businessId: widget.businessId,
        saleId: _sale.id,
        clientRequestId: id,
        to: 'credit',
        credit: credit,
      );
    } else {
      final errors = validateInventorySwitchToPaid(
        method: _method,
        receivedByStaffId: _receivedBy,
        staffIds: [for (final p in widget.staff) p.id],
      );
      if (errors.isNotEmpty) {
        AppHaptics.refuse();
        setState(() => _paidErrors = errors.toSet());
        return;
      }
      key = 'paid|$_method|$_receivedBy';
      ok = await confirmMajorAction(
        context,
        title: l10n.invSwitchConfirmPaidTitle,
        message: l10n.invSwitchConfirmPaidMessage(
          formatLotCents(_sale.totalCents),
        ),
        confirmLabel: l10n.invSwitchToPaid,
        icon: Icons.swap_horiz,
      );
      send = (id) => widget.service.switchSalePayment(
        businessId: widget.businessId,
        saleId: _sale.id,
        clientRequestId: id,
        to: 'paid',
        paymentMethod: _method,
        receivedByStaffId: _receivedBy,
      );
    }
    if (!ok || !mounted) return;
    setState(() {
      _busy = true;
      _serverNote = '';
    });
    try {
      final result = await send(_requestIdFor(key));
      if (!mounted) return;
      AppHaptics.commit();
      Navigator.of(context).pop(result);
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
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    return LotSheetShell(
      title: _toCredit
          ? l10n.invSwitchToCreditTitle
          : l10n.invSwitchToPaidTitle,
      subtitle: [
        formatLotCents(_sale.totalCents),
        if (_sale.createdAt != null)
          l10n.invCreditSoldOn(displayDateTime(_sale.createdAt!, locale)),
      ].join(' · '),
      footer: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_serverNote.isNotEmpty) ...[
            InventoryNote(
              key: const Key('inv-switch-server-note'),
              text: _serverNote,
            ),
            const SizedBox(height: AppSpacing.sm),
          ],
          LotSheetButton(
            key: const Key('inv-switch-submit'),
            label: _toCredit ? l10n.invSwitchToCredit : l10n.invSwitchToPaid,
            busy: _busy,
            busyLabel: l10n.lotSaving,
            tone: LotTone.good,
            onTap: _busy ? null : _submit,
          ),
        ],
      ),
      body: _toCredit ? _creditBody(l10n) : _paidBody(l10n),
    );
  }

  Widget _creditBody(AppLocalizations l10n) {
    final errors = _tried ? _creditProblems().toSet() : const <String>{};
    String? errorFor(List<String> codes) {
      for (final code in codes) {
        if (errors.contains(code)) return inventoryCreditErrorText(l10n, code);
      }
      return null;
    }

    final split = inventoryCheckoutSplit(_sale.totalCents, _draft);
    final collector = _draft.collectorStaffId;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          l10n.invSwitchToCreditNote,
          style: const TextStyle(fontSize: 13, color: AppColors.muted),
        ),
        const SizedBox(height: AppSpacing.md),
        InventoryCreditTermsFields(
          draft: _draft,
          paidNow: _paidNow,
          customerName: _customerName,
          customerPhone: _customerPhone,
          paidNowLabel: l10n.invSwitchPaidAtTime,
          busy: _busy,
          errorFor: errorFor,
          collectorLabel: collector.isEmpty
              ? null
              : _personLabel(l10n, collector),
          onEdit: (edit) => setState(() => _draft = edit(_draft)),
          onPickCollector: _pickCollector,
          onPickDueDate: _pickDueDate,
        ),
        const SizedBox(height: AppSpacing.md),
        Text(
          l10n.invCreditSplit(
            formatLotCents(split.paidNowCents),
            formatLotCents(split.creditCents),
          ),
          key: const Key('inv-switch-split'),
          style: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w700,
            color: AppColors.ink,
          ),
        ),
      ],
    );
  }

  Widget _paidBody(AppLocalizations l10n) {
    String? errorFor(String code) => _paidErrors.contains(code)
        ? inventoryCreditErrorText(l10n, code)
        : null;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          l10n.invSwitchToPaidNote(formatLotCents(_sale.totalCents)),
          key: const Key('inv-switch-paid-note'),
          style: const TextStyle(fontSize: 13, color: AppColors.muted),
        ),
        const SizedBox(height: AppSpacing.md),
        LotPickerField(
          key: const Key('inv-switch-method'),
          label: l10n.invSwitchHowPaid,
          value: containerPaymentMethodLabel(l10n, _method),
          placeholder: l10n.invSwitchHowPaid,
          onTap: _busy ? () {} : _pickMethod,
          error: errorFor('payment_method_invalid'),
        ),
        const SizedBox(height: AppSpacing.md),
        LotPickerField(
          key: const Key('inv-switch-received-by'),
          label: l10n.lotReceivedBy,
          value: _receivedBy.isEmpty ? null : _personLabel(l10n, _receivedBy),
          placeholder: l10n.lotReceivedBy,
          onTap: _busy ? () {} : _pickReceiver,
          error:
              errorFor('received_by_required') ??
              errorFor('received_by_invalid'),
        ),
      ],
    );
  }
}

/// The history line of one switch: "Switched to credit by Ama · 10/20/2026,
/// 3:15 PM · $10.00 paid, $30.00 owed".
String inventorySaleSwitchLine(
  AppLocalizations l10n,
  InventorySaleSwitch entry, {
  required String who,
  required String locale,
}) {
  final name = who.isEmpty ? l10n.lotUnnamedPerson : who;
  final when = entry.at == null ? '' : displayDateTime(entry.at!, locale);
  return entry.toCredit
      ? l10n.invSwitchLineCredit(
          name,
          when,
          formatLotCents(entry.toPaidNowCents),
          formatLotCents(entry.toCreditCents),
        )
      : l10n.invSwitchLinePaid(
          name,
          when,
          formatLotCents(entry.totalCents),
          containerPaymentMethodLabel(l10n, entry.toPaymentMethod),
        );
}
