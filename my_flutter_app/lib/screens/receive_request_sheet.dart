import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../l10n/app_localizations.dart';
import '../services/invoice_ledger.dart' show invoicePaymentMethods;
import '../services/lot_ledger.dart' show LotStaff;
import '../services/package_request_service.dart';
import '../services/package_requests.dart';
import '../services/waiting_packages.dart'
    show
        IntakePaymentDraft,
        intakeAmountInput,
        intakePaymentErrors,
        intakePaymentRecord;
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../widgets/lot_sheets.dart';
import '../widgets/package_request_widgets.dart';
import '../widgets/waiting_package_fields.dart';
import 'containers_screen.dart' show containerErrorText;
import 'package_payment_sheet.dart' show containerPaymentMethodLabel;

/// Opens the Received sheet for an Expected request; answers what the
/// server made (the line and its code), or null when dismissed.
Future<RequestReceived?> showReceiveRequestSheet(
  BuildContext context, {
  required String businessId,
  required PackageRequest request,
  required PackageRequestService service,
  List<LotStaff> staff = const [],
}) => showLotSheet<RequestReceived>(
  context,
  ReceiveRequestSheet(
    businessId: businessId,
    request: request,
    service: service,
    staff: staff,
  ),
);

/// "Received" on an Expected request (§2 Received): the final price of each
/// piece (prefilled from the estimate - it never binds) and the money if
/// some is handed over now. One `receivePackageRequest` makes the waiting
/// line; the caller then prints its labels, one per piece.
class ReceiveRequestSheet extends StatefulWidget {
  const ReceiveRequestSheet({
    super.key,
    required this.businessId,
    required this.request,
    required this.service,
    this.staff = const [],
  });

  final String businessId;
  final PackageRequest request;
  final PackageRequestService service;
  final List<LotStaff> staff;

  @override
  State<ReceiveRequestSheet> createState() => _ReceiveRequestSheetState();
}

class _ReceiveRequestSheetState extends State<ReceiveRequestSheet> {
  late final List<ReceivePieceDraft> _drafts = receivePrefill(widget.request);
  late final List<TextEditingController> _prices = [
    for (final d in _drafts) TextEditingController(text: d.price),
  ];

  /// The total as the payment fields read it ("money received" needs a
  /// price), kept in step with the piece prices.
  final _total = TextEditingController();
  bool _payOnArrival = false;
  bool _moneyReceived = false;
  final _amount = TextEditingController();
  final _note = TextEditingController();
  String _method = 'cash';
  String? _receivedBy;

  Set<String> _errors = {};
  Set<int> _invalid = {};
  String _banner = '';
  bool _busy = false;

  bool get _card => widget.request.isCardOrder;

  @override
  void initState() {
    super.initState();
    _syncTotal();
  }

  @override
  void dispose() {
    for (final c in _prices) {
      c.dispose();
    }
    _total.dispose();
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  List<ReceivePieceDraft> get _pieces => [
    for (var i = 0; i < _drafts.length; i++)
      _drafts[i].copyWith(price: _prices[i].text),
  ];

  ReceiveCheck get _check => checkReceive(
    _pieces,
    pickupFeeCents: receivePickupFeeCents(widget.request),
  );

  void _syncTotal() {
    final check = _check;
    final total = check.ok ? check.totalCents : null;
    _total.text = total == null ? '' : requestCentsToInput(total);
  }

  void _edited() {
    setState(() {
      _syncTotal();
      _errors = {};
      _invalid = {};
      _banner = '';
    });
  }

  IntakePaymentDraft get _payment => IntakePaymentDraft(
    amount: _amount.text,
    method: _method,
    receivedByStaffId: _receivedBy ?? '',
    note: _note.text,
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

  Future<void> _pickReceiver() async {
    final l10n = AppLocalizations.of(context)!;
    final picked = await pickLotOption<String>(
      context,
      title: l10n.lotReceivedBy,
      selected: _receivedBy,
      options: [for (final s in widget.staff) LotOption(s.id, s.name)],
    );
    if (picked == null || !mounted) return;
    setState(() {
      _receivedBy = picked;
      _errors = {..._errors}..remove('received_by_required');
    });
  }

  Future<void> _save() async {
    final l10n = AppLocalizations.of(context)!;
    if (_busy) return;
    final pieces = _pieces;
    final check = _check;
    final takesMoney = !_card && _moneyReceived && check.totalCents != null;
    final paymentErrors = takesMoney
        ? intakePaymentErrors(
            _payment,
            priceCents: check.totalCents,
            staffIds: [for (final s in widget.staff) s.id],
          )
        : const <String>[];
    if (!check.ok || paymentErrors.isNotEmpty) {
      AppHaptics.refuse();
      setState(() {
        _errors = {...check.reasons, ...paymentErrors};
        _invalid = check.invalid;
        _banner = check.reasons.isEmpty
            ? ''
            : requestReasonText(l10n, check.reasons.first) ?? '';
      });
      return;
    }
    setState(() {
      _busy = true;
      _banner = '';
      _errors = {};
    });
    try {
      final result = await widget.service.receive(
        receivePayload(
          businessId: widget.businessId,
          requestId: widget.request.id,
          pieces: pieces,
          check: check,
          payOnArrival: !_card && _payOnArrival,
          payment: takesMoney ? intakePaymentRecord(_payment) : null,
        ),
      );
      if (!mounted) return;
      AppHaptics.commit();
      Navigator.of(context).pop(result);
    } on RequestFailure catch (failure) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() {
        _errors = failure.refusal.reasons.toSet();
        _banner = requestRefusalText(l10n, failure.refusal);
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String? _paymentError(AppLocalizations l10n, List<String> codes) {
    for (final c in codes) {
      if (_errors.contains(c)) return containerErrorText(l10n, c);
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final request = widget.request;
    final check = _check;
    final total = check.totalCents;
    final fee = receivePickupFeeCents(request);
    return LotSheetShell(
      title: l10n.prqReceiveTitle,
      subtitle: l10n.prqReceiveSubtitle(request.code),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            [
              request.senderName,
              request.receiverName,
              request.destinationCountryName,
            ].where((s) => s.isNotEmpty).join(' → '),
            style: const TextStyle(fontSize: 13, color: AppColors.muted),
          ),
          const SizedBox(height: AppSpacing.md),
          for (var i = 0; i < _drafts.length; i++)
            Container(
              margin: const EdgeInsets.only(bottom: AppSpacing.sm),
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                color: AppColors.parchment,
                borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                border: Border.all(color: AppColors.rule),
              ),
              child: Row(
                children: [
                  Icon(
                    requestPieceKindIcon(_drafts[i].kind),
                    size: 18,
                    color: AppColors.cobaltDeep,
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Text(
                      _drafts[i].description.isNotEmpty
                          ? _drafts[i].description
                          : requestPieceKindLabel(l10n, _drafts[i].kind),
                      style: const TextStyle(
                        fontSize: 14,
                        fontWeight: FontWeight.w600,
                        color: AppColors.ink,
                      ),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  SizedBox(
                    width: 120,
                    child: TextField(
                      key: Key('receive-price:${_drafts[i].id}'),
                      controller: _prices[i],
                      enabled: !_busy,
                      keyboardType: const TextInputType.numberWithOptions(
                        decimal: true,
                      ),
                      inputFormatters: [
                        FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
                      ],
                      onChanged: (_) => _edited(),
                      decoration: InputDecoration(
                        labelText: l10n.prqFinalPrice,
                        isDense: true,
                        errorText: _invalid.contains(i)
                            ? l10n.prqPriceInvalid
                            : null,
                        errorMaxLines: 3,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          if (fee > 0)
            Text(
              '${l10n.prqPickupFee}: ${formatRequestCents(fee)}',
              style: const TextStyle(fontSize: 13, color: AppColors.muted),
            ),
          Text(
            total == null
                ? l10n.prqPriceAllOrNone
                : l10n.prqLineTotal(formatRequestCents(total)),
            key: const Key('receive-total'),
            style: TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w700,
              color: _errors.contains('price_required')
                  ? AppColors.errorRed
                  : AppColors.ink,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          if (_card)
            RequestBanner(
              key: const Key('receive-paid-online'),
              text: l10n.prqPaidOnlineNote(
                formatRequestCents(request.paidCents),
              ),
              icon: Icons.credit_card,
              color: AppColors.sage,
            )
          else ...[
            SwitchListTile.adaptive(
              key: const Key('receive-pay-on-arrival'),
              contentPadding: EdgeInsets.zero,
              dense: true,
              value: _payOnArrival,
              onChanged: _busy
                  ? null
                  : (v) => setState(() => _payOnArrival = v),
              title: Text(
                l10n.prqPayOnArrivalSwitch,
                style: const TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            IntakePaymentFields(
              price: _total,
              received: _moneyReceived,
              onReceived: (on) => setState(() {
                _moneyReceived = on;
                if (on && _amount.text.trim().isEmpty) {
                  _amount.text = intakeAmountInput(check.totalCents);
                }
              }),
              amount: _amount,
              note: _note,
              methodLabel: containerPaymentMethodLabel(l10n, _method),
              onPickMethod: _pickMethod,
              receiverName:
                  widget.staff
                      .where((s) => s.id == _receivedBy)
                      .firstOrNull
                      ?.name ??
                  '',
              onPickReceiver: _pickReceiver,
              enabled: !_busy,
              onEdited: () => setState(() => _errors = {}),
              amountError: _paymentError(l10n, const [
                'amount_required',
                'amount_too_large',
                'payment_exceeds_balance',
              ]),
              methodError: _paymentError(l10n, const [
                'payment_method_invalid',
              ]),
              receiverError: _paymentError(l10n, const [
                'received_by_required',
                'received_by_invalid',
              ]),
            ),
          ],
          if (_banner.isNotEmpty) ...[
            const SizedBox(height: AppSpacing.sm),
            RequestBanner(
              key: const Key('receive-banner'),
              text: _banner,
              icon: Icons.error_outline,
              color: AppColors.errorRed,
            ),
          ],
        ],
      ),
      footer: RequestPrimaryButton(
        key: const Key('receive-save'),
        label: l10n.prqReceiveAndPrint,
        busyLabel: l10n.prqSaving,
        busy: _busy,
        onTap: _save,
      ),
    );
  }
}
