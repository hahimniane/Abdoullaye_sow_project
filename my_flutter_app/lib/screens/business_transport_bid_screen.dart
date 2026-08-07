import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';

import '../l10n/app_localizations.dart';
import '../models/transport_opportunity.dart';
import '../models/transport_quote.dart';
import '../services/business_transport_jobs.dart';
import '../theme/app_colors.dart';
import '../utils/business_transport_localization.dart';
import '../widgets/app_back_button.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/async_action_button.dart';
import '../widgets/language_toggle.dart';

/// Bidding on one transport request.
///
/// The screen exists because a business could not quote from the phone at all -
/// `submitTransportQuote` had no caller in the app. Every refusal the callable
/// can give for the amount is checked here first (currency, the cap, whole
/// cents, a positive number), because a quote deadline is a real clock and a
/// round trip spent on a typo is time a carrier does not get back.
///
/// Re-bidding reads as revising: one business gets ONE quote per request, and
/// the server rewrites the same document and bumps `revision`. A screen that
/// implied a second quote was being added would be describing a marketplace
/// this one is not.
class BusinessTransportBidScreen extends StatefulWidget {
  const BusinessTransportBidScreen({
    super.key,
    required this.opportunity,
    required this.businessId,
    this.existingQuote,
    BusinessTransportService? service,
  }) : _service = service;

  final TransportOpportunity opportunity;
  final String businessId;

  /// The quote this business already has on this request, if any. Its
  /// `pickupFeeCents` is the only way the app knows what the server will add -
  /// there is no callable that prices a transport pickup without submitting.
  final TransportQuote? existingQuote;

  final BusinessTransportService? _service;

  @override
  State<BusinessTransportBidScreen> createState() =>
      _BusinessTransportBidScreenState();
}

class _BusinessTransportBidScreenState
    extends State<BusinessTransportBidScreen> {
  late final BusinessTransportService _service =
      widget._service ?? BusinessTransportService();

  final TextEditingController _amountController = TextEditingController();
  final TextEditingController _termsController = TextEditingController();

  late String _method;
  DateTime? _estimatedPickupDate;
  DateTime? _estimatedDeliveryDate;
  String _error = '';

  /// The quote already in, if there is one. Everything about this screen that
  /// says "revise" rather than "send" hangs off it.
  TransportQuote? get _quote {
    final quote = widget.existingQuote;
    if (quote == null || quote.isWithdrawn) return null;
    return quote;
  }

  bool get _isRevision => _quote != null;

  @override
  void initState() {
    super.initState();
    final quote = _quote;
    // A revision opens on the numbers the customer is currently looking at, so
    // the carrier edits its quote rather than retyping it from memory.
    if (quote != null && quote.amountCents > 0) {
      _amountController.text = (quote.amountCents / 100).toStringAsFixed(2);
    }
    _termsController.text = quote?.terms ?? '';
    _method =
        quote?.transportMethod.trim().toLowerCase() ??
        widget.opportunity.requestedTransportMethod.trim().toLowerCase();
    if (!transportQuoteMethods.contains(_method)) _method = 'open';
    _estimatedPickupDate = quote?.estimatedPickupDate;
    _estimatedDeliveryDate = quote?.estimatedDeliveryDate;
  }

  @override
  void dispose() {
    _amountController.dispose();
    _termsController.dispose();
    super.dispose();
  }

  TransportQuoteDraft get _draft => TransportQuoteDraft(
    requestId: widget.opportunity.requestId,
    amountText: _amountController.text,
    transportMethod: _method,
    terms: _termsController.text,
    estimatedPickupDate: _estimatedPickupDate,
    estimatedDeliveryDate: _estimatedDeliveryDate,
  );

  /// The transport leg as typed, in whole cents, or null while it is not a
  /// number yet. Never a double: the server takes integer cents.
  int? get _amountCents {
    final text = _amountController.text.trim();
    if (text.isEmpty || transportQuoteAmountIsFractional(text)) return null;
    final cents = parseTransportQuoteCents(text);
    if (cents == null || cents <= 0 || cents > maxTransportQuoteCents) {
      return null;
    }
    return cents;
  }

  Future<void> _pickDate({required bool isPickup}) async {
    final now = DateTime.now();
    final current = isPickup ? _estimatedPickupDate : _estimatedDeliveryDate;
    final picked = await showDatePicker(
      context: context,
      initialDate: current ?? now.add(const Duration(days: 2)),
      // The server refuses a pickup estimate that is not in the future, so the
      // picker cannot offer today.
      firstDate: isPickup
          ? now.add(const Duration(days: 1))
          : (_estimatedPickupDate ?? now.add(const Duration(days: 1))),
      lastDate: now.add(const Duration(days: 730)),
    );
    if (picked == null) return;
    setState(() {
      if (isPickup) {
        _estimatedPickupDate = picked;
        final delivery = _estimatedDeliveryDate;
        // Delivery cannot precede pickup; dragging it along is kinder than
        // refusing the pickup change the carrier just made.
        if (delivery != null && delivery.isBefore(picked)) {
          _estimatedDeliveryDate = picked;
        }
      } else {
        _estimatedDeliveryDate = picked;
      }
    });
  }

  Future<void> _submit() async {
    final l10n = AppLocalizations.of(context)!;
    final errors = validateTransportQuoteDraft(_draft);
    if (errors.isNotEmpty) {
      setState(() => _error = transportQuoteErrorSummary(l10n, errors));
      return;
    }
    setState(() => _error = '');
    try {
      final result = await _service.submitQuote(
        _draft,
        businessId: widget.businessId,
      );
      if (!mounted) return;
      Navigator.of(context).pop(true);
      showSuccessSnackBar(
        context,
        result.isRevision
            ? l10n.businessTransportQuoteRevised(result.revision)
            : l10n.businessTransportQuoteSent,
      );
    } on FirebaseFunctionsException catch (error) {
      // The callable refuses for reasons this screen's copy cannot name: the
      // request stopped collecting, the deadline passed, the business no longer
      // serves the destination, the customer moved the pickup address while the
      // quote was being priced. Replacing that with "check the details" sends a
      // carrier hunting through a form that is not the problem.
      if (!mounted) return;
      final message = (error.message ?? '').trim();
      setState(
        () => _error = message.isEmpty
            ? l10n.businessTransportQuoteFailed
            : message,
      );
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = l10n.businessTransportQuoteFailed);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final opportunity = widget.opportunity;
    final quote = _quote;
    final dateFormat = DateFormat.yMMMd(Localizations.localeOf(context).toString());

    return Scaffold(
      backgroundColor: AppColors.cream,
      appBar: AppBar(
        backgroundColor: AppColors.cream,
        leading: const AppBackButton(),
        title: Text(
          _isRevision
              ? l10n.businessTransportReviseQuote
              : l10n.businessTransportSendQuote,
        ),
        actions: const [LanguageToggle(), SizedBox(width: 8)],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            _Panel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    opportunity.vehicleLabel.isEmpty
                        ? opportunity.trackingCode
                        : opportunity.vehicleLabel,
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w800,
                      color: AppColors.ink,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    '${opportunity.pickupArea.isEmpty ? l10n.notProvided : opportunity.pickupArea}'
                    ' → '
                    '${opportunity.destinationCountryName.isEmpty ? l10n.notProvided : opportunity.destinationCountryName}',
                    style: const TextStyle(color: AppColors.muted),
                  ),
                  if (opportunity.expiresAt != null) ...[
                    const SizedBox(height: 6),
                    Text(
                      '${l10n.businessTransportQuoteDeadline}: '
                      '${dateFormat.format(opportunity.expiresAt!)}',
                      style: const TextStyle(
                        color: AppColors.muted,
                        fontSize: 13,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            // A revision is not a second quote, and the screen has to say so
            // before the carrier taps: the server rewrites the same document.
            if (_isRevision) ...[
              const SizedBox(height: 12),
              Container(
                key: const Key('transport-bid-revision-notice'),
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: AppColors.parchment,
                  border: Border.all(color: AppColors.cobalt),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      l10n.businessTransportRevisionNumber(quote!.revision),
                      style: const TextStyle(
                        fontWeight: FontWeight.w800,
                        color: AppColors.ink,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      l10n.businessTransportReviseNotice,
                      style: const TextStyle(
                        color: AppColors.ink,
                        height: 1.4,
                        fontSize: 13,
                      ),
                    ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: 12),
            _Panel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  TextField(
                    key: const Key('transport-bid-amount'),
                    controller: _amountController,
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    inputFormatters: [
                      FilteringTextInputFormatter.allow(RegExp(r'[0-9.,\s]')),
                    ],
                    onChanged: (_) => setState(() {}),
                    decoration: InputDecoration(
                      labelText: l10n.businessTransportAmountLabel,
                      hintText: l10n.businessTransportAmountHint,
                      helperText: l10n.businessTransportAmountHelp,
                      helperMaxLines: 3,
                      // The currency is asserted, not chosen: the server
                      // compares it against "usd" and refuses anything else, so
                      // there is nothing for a picker to offer.
                      prefixText: '\$ ',
                    ),
                  ),
                  const SizedBox(height: 16),
                  _MoneyLine(
                    label: l10n.businessTransportPickupLeg,
                    // The pickup leg is priced SERVER-side from this business's
                    // own pickupPlan against the customer's address, and there
                    // is no callable that prices it without submitting. So the
                    // fee shown is the one the last submission returned, and
                    // before there is one the screen says what will happen
                    // rather than inventing a number.
                    value: quote == null
                        ? null
                        : (quote.pickupIncluded ? quote.pickupFeeCents : 0),
                    note: quote == null
                        ? l10n.businessTransportPickupPending
                        : (quote.pickupIncluded
                              ? null
                              : l10n.businessTransportPickupNotCharged),
                  ),
                  const Divider(height: 24),
                  _MoneyLine(
                    key: const Key('transport-bid-total'),
                    label: l10n.businessTransportCustomerTotal,
                    emphasise: true,
                    value: (_amountCents == null || quote == null)
                        ? null
                        : transportQuoteTotalCents(
                            _amountCents!,
                            quote.pickupIncluded ? quote.pickupFeeCents : 0,
                          ),
                    note: quote == null
                        ? l10n.businessTransportCustomerTotalPending
                        : null,
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            _Panel(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    l10n.transportMethod,
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      color: AppColors.ink,
                    ),
                  ),
                  const SizedBox(height: 8),
                  SegmentedButton<String>(
                    key: const Key('transport-bid-method'),
                    segments: [
                      for (final method in transportQuoteMethods)
                        ButtonSegment<String>(
                          value: method,
                          label: Text(transportMethodLabel(l10n, method)),
                        ),
                    ],
                    selected: <String>{_method},
                    onSelectionChanged: (values) =>
                        setState(() => _method = values.first),
                  ),
                  const SizedBox(height: 16),
                  _DateRow(
                    label: l10n.estimatedPickup,
                    value: _estimatedPickupDate,
                    format: dateFormat,
                    placeholder: l10n.notProvided,
                    onPressed: () => _pickDate(isPickup: true),
                  ),
                  const SizedBox(height: 8),
                  _DateRow(
                    label: l10n.estimatedDelivery,
                    value: _estimatedDeliveryDate,
                    format: dateFormat,
                    placeholder: l10n.notProvided,
                    onPressed: () => _pickDate(isPickup: false),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    key: const Key('transport-bid-terms'),
                    controller: _termsController,
                    maxLines: 4,
                    maxLength: maxTransportQuoteTermsLength,
                    decoration: InputDecoration(
                      labelText: l10n.businessTransportTermsLabel,
                      hintText: l10n.businessTransportTermsHint,
                    ),
                  ),
                ],
              ),
            ),
            if (_error.isNotEmpty) ...[
              const SizedBox(height: 12),
              Container(
                key: const Key('transport-bid-error'),
                width: double.infinity,
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: AppColors.paper,
                  border: Border.all(color: AppColors.errorRed),
                ),
                child: Text(
                  _error,
                  style: const TextStyle(
                    color: AppColors.errorRed,
                    fontWeight: FontWeight.w600,
                    height: 1.4,
                  ),
                ),
              ),
            ],
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: AsyncActionButton.filled(
                key: const Key('transport-bid-submit'),
                icon: Icons.send,
                label: _isRevision
                    ? l10n.businessTransportReviseQuote
                    : l10n.businessTransportSendQuote,
                loadingLabel: _isRevision
                    ? l10n.businessTransportRevisingQuote
                    : l10n.businessTransportSendingQuote,
                onPressed: _submit,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Panel extends StatelessWidget {
  const _Panel({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.all(16),
    decoration: BoxDecoration(
      color: AppColors.paper,
      border: Border.all(color: AppColors.rule),
    ),
    child: child,
  );
}

/// One money line, in integer cents, formatted only at the moment of display.
class _MoneyLine extends StatelessWidget {
  const _MoneyLine({
    super.key,
    required this.label,
    required this.value,
    this.note,
    this.emphasise = false,
  });

  final String label;

  /// Cents, or null when the number is not knowable yet - a dash, never a zero
  /// that would read as "free".
  final int? value;
  final String? note;
  final bool emphasise;

  @override
  Widget build(BuildContext context) {
    final cents = value;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Expanded(
              child: Text(
                label,
                style: TextStyle(
                  color: emphasise ? AppColors.ink : AppColors.muted,
                  fontWeight: emphasise ? FontWeight.w800 : FontWeight.w600,
                ),
              ),
            ),
            Text(
              cents == null
                  ? '—'
                  : NumberFormat.simpleCurrency().format(cents / 100),
              style: TextStyle(
                fontSize: emphasise ? 20 : 15,
                fontWeight: FontWeight.w800,
                color: cents == null ? AppColors.muted : AppColors.ink,
              ),
            ),
          ],
        ),
        if (note != null) ...[
          const SizedBox(height: 4),
          Text(
            note!,
            style: const TextStyle(
              fontSize: 12,
              color: AppColors.muted,
              height: 1.4,
            ),
          ),
        ],
      ],
    );
  }
}

class _DateRow extends StatelessWidget {
  const _DateRow({
    required this.label,
    required this.value,
    required this.format,
    required this.placeholder,
    required this.onPressed,
  });

  final String label;
  final DateTime? value;
  final DateFormat format;
  final String placeholder;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Expanded(
        child: Text(
          label,
          style: const TextStyle(
            color: AppColors.muted,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      OutlinedButton.icon(
        onPressed: onPressed,
        icon: const Icon(Icons.event, size: 16),
        label: Text(value == null ? placeholder : format.format(value!)),
      ),
    ],
  );
}
