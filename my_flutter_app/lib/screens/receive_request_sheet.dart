import 'package:flutter/material.dart';

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
import '../widgets/pieces_editor.dart';
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

/// "Received" on an Expected request (§2 Received): the load as it arrived,
/// in phase 1's pieces editor (the counter's) - the request's pieces with
/// their final prices (prefilled from the estimate - it never binds), what
/// each turned out to be, pieces brought on top, pieces that did not come -
/// and the money if some is handed over now. One `receivePackageRequest`
/// makes the waiting line, the same line the counter would; the caller then
/// prints its labels, one per piece.
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
  // A collected request's pickup fee is its own field, prefilled from the
  // estimate and inside the total, never in the piece prices (owner
  // decision 2026-10-18); a request brought in has none.
  late final PiecesEditorController _pieces = PiecesEditorController(
    initial: receivePrefillPieces(widget.request),
    limit: requestMaxPieces,
    pickupFeeCents: widget.request.isCollect
        ? receivePrefillPickupFeeCents(widget.request)
        : null,
  )..addListener(_edited);

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
  bool _showPieceErrors = false;
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
    _pieces.dispose();
    _total.dispose();
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  ReceiveCheck get _check => checkReceive(
    _pieces.draftPieces,
    pickupFeeCents: _pieces.pickupFeeForRequest,
    pickupFeeInvalid: _pieces.pickupFeeInvalid,
  );

  void _syncTotal() {
    final check = _check;
    final total = check.ok ? check.totalCents : null;
    _total.text = total == null ? '' : requestCentsToInput(total);
  }

  void _edited() {
    if (!mounted) return;
    setState(() {
      _syncTotal();
      _errors = {};
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
        _showPieceErrors = check.reasons.isNotEmpty;
        _banner = check.reasons.isEmpty
            ? ''
            : requestReasonText(l10n, check.reasons.first) ??
                  containerErrorText(l10n, check.reasons.first);
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
          check: check,
          payOnArrival: !_card && _payOnArrival,
          payment: takesMoney ? intakePaymentRecord(_payment) : null,
        ),
      );
      if (!mounted) return;
      AppHaptics.commit();
      Navigator.of(context).pop(
        result.alreadyReceived
            ? result
            : result.withPieces(
                check.pieces,
                pickupFeeCents: check.pickupFeeCents,
              ),
      );
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
          RequestPickupNote(request: request),
          const SizedBox(height: AppSpacing.md),
          PiecesEditor(
            controller: _pieces,
            describe: (code) => containerErrorText(l10n, code),
            showErrors: _showPieceErrors,
            enabled: !_busy,
            error: _errors.contains('too_many_pieces')
                ? requestReasonText(l10n, 'too_many_pieces')
                : null,
          ),
          const SizedBox(height: AppSpacing.sm),
          PiecesTotalLine(controller: _pieces),
          if (check.reasons.contains('price_required'))
            Text(
              l10n.prqPriceAllOrNone,
              key: const Key('receive-price-all-or-none'),
              style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: AppColors.errorRed,
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
