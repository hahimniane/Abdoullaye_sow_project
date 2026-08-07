import 'dart:async';

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../l10n/app_localizations.dart';
import '../models/transport_opportunity.dart';
import '../models/transport_quote.dart';
import '../models/transport_request.dart';
import '../services/business_transport_jobs.dart';
import '../theme/app_colors.dart';
import '../utils/action_confirmation.dart';
import '../utils/business_transport_localization.dart';
import '../widgets/app_back_button.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/async_action_button.dart';
import '../widgets/language_toggle.dart';
import 'business_transport_bid_screen.dart';

/// Everything a transport business does, on the phone.
///
/// Three lists, because a carrier's day has three questions in it: what may I
/// bid on, what have I bid on, and what have I won and must now move. The first
/// two come from `transportOpportunities` - the collection that says which
/// requests this business was invited to price, and which nothing in the app
/// subscribed to before. The third comes from `transportRequests`, which only
/// carries this business's id once a customer has chosen its quote.
class BusinessTransportScreen extends StatefulWidget {
  const BusinessTransportScreen({
    super.key,
    required this.businessId,
    BusinessTransportService? service,
    FirebaseFirestore? firestore,
  }) : _service = service,
       _firestore = firestore;

  final String businessId;
  final BusinessTransportService? _service;
  final FirebaseFirestore? _firestore;

  @override
  State<BusinessTransportScreen> createState() =>
      _BusinessTransportScreenState();
}

class _BusinessTransportScreenState extends State<BusinessTransportScreen> {
  late final FirebaseFirestore _firestore =
      widget._firestore ?? FirebaseFirestore.instance;
  late final BusinessTransportService _service =
      widget._service ?? BusinessTransportService(firestore: _firestore);

  final List<TransportOpportunity> _opportunities = [];
  final List<TransportQuote> _quotes = [];
  final List<TransportRequest> _jobs = [];

  StreamSubscription<List<TransportOpportunity>>? _opportunitySubscription;
  StreamSubscription<List<TransportQuote>>? _quoteSubscription;
  StreamSubscription<QuerySnapshot<Map<String, dynamic>>>? _jobSubscription;

  bool _opportunitiesLoaded = false;
  bool _quotesLoaded = false;
  bool _jobsLoaded = false;

  BusinessTransportSection _section = BusinessTransportSection.openToBid;

  @override
  void initState() {
    super.initState();
    _opportunitySubscription = _service
        .watchOpportunities(widget.businessId)
        .listen(
          (rows) => setState(() {
            _opportunities
              ..clear()
              ..addAll(rows);
            _opportunitiesLoaded = true;
          }),
          onError: (_) => setState(() => _opportunitiesLoaded = true),
        );
    _quoteSubscription = _service
        .watchBusinessQuotes(widget.businessId)
        .listen(
          (rows) => setState(() {
            _quotes
              ..clear()
              ..addAll(rows);
            _quotesLoaded = true;
          }),
          onError: (_) => setState(() => _quotesLoaded = true),
        );
    _jobSubscription = _firestore
        .collection('transportRequests')
        .where('businessId', isEqualTo: widget.businessId)
        .snapshots()
        .listen(
          (snapshot) => setState(() {
            _jobs
              ..clear()
              ..addAll(snapshot.docs.map(TransportRequest.fromFirestore));
            _jobs.sort((a, b) => b.createdAt.compareTo(a.createdAt));
            _jobsLoaded = true;
          }),
          onError: (_) => setState(() => _jobsLoaded = true),
        );
  }

  @override
  void dispose() {
    _opportunitySubscription?.cancel();
    _quoteSubscription?.cancel();
    _jobSubscription?.cancel();
    super.dispose();
  }

  bool get _isLoading =>
      !(_opportunitiesLoaded && _quotesLoaded && _jobsLoaded);

  /// This business's quote on a request, if it has one.
  TransportQuote? _quoteFor(String requestId) {
    for (final quote in _quotes) {
      if (quote.requestId == requestId) return quote;
    }
    return null;
  }

  List<TransportOpportunity> _opportunitiesIn(BusinessTransportSection section) =>
      _opportunities
          .where(
            (opportunity) =>
                transportOpportunitySection(opportunity.status) == section,
          )
          .toList();

  Future<void> _openBid(TransportOpportunity opportunity) async {
    await Navigator.of(context).push<bool>(
      MaterialPageRoute<bool>(
        builder: (_) => BusinessTransportBidScreen(
          opportunity: opportunity,
          businessId: widget.businessId,
          existingQuote: _quoteFor(opportunity.requestId),
          service: _service,
        ),
      ),
    );
  }

  Future<void> _withdraw(TransportOpportunity opportunity) async {
    final l10n = AppLocalizations.of(context)!;
    final confirmed = await confirmMajorAction(
      context,
      title: l10n.businessTransportWithdrawTitle,
      message: l10n.businessTransportWithdrawMessage,
      confirmLabel: l10n.businessTransportWithdrawQuote,
      destructive: true,
    );
    if (!confirmed || !mounted) return;
    try {
      await _service.withdrawQuote(
        requestId: opportunity.requestId,
        businessId: widget.businessId,
      );
      if (!mounted) return;
      showSuccessSnackBar(context, l10n.businessTransportQuoteWithdrawn);
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) return;
      final message = (error.message ?? '').trim();
      showErrorSnackBar(
        context,
        message.isEmpty ? l10n.businessTransportWithdrawFailed : message,
      );
    } catch (_) {
      if (!mounted) return;
      showErrorSnackBar(context, l10n.businessTransportWithdrawFailed);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Scaffold(
      backgroundColor: AppColors.cream,
      appBar: AppBar(
        backgroundColor: AppColors.cream,
        leading: const AppBackButton(),
        title: Text(l10n.businessTransportTitle),
        actions: const [LanguageToggle(), SizedBox(width: 8)],
      ),
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
              child: Text(
                l10n.businessTransportSubtitle,
                style: const TextStyle(color: AppColors.muted, height: 1.4),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: SingleChildScrollView(
                key: const Key('transport-section-tabs'),
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    for (final section in BusinessTransportSection.values)
                      Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: ChoiceChip(
                          key: Key('transport-section-${section.name}'),
                          label: Text(
                            '${businessTransportSectionLabel(l10n, section)}'
                            ' · ${_countFor(section)}',
                          ),
                          selected: _section == section,
                          onSelected: (_) => setState(() => _section = section),
                          labelStyle: TextStyle(
                            color: _section == section
                                ? AppColors.paper
                                : AppColors.ink,
                            fontWeight: FontWeight.w600,
                          ),
                          backgroundColor: AppColors.paper,
                          selectedColor: AppColors.ink,
                          shape: const RoundedRectangleBorder(
                            borderRadius: BorderRadius.zero,
                            side: BorderSide(color: AppColors.ink),
                          ),
                        ),
                      ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: _isLoading
                  ? const Center(child: CircularProgressIndicator())
                  : _buildSection(l10n),
            ),
          ],
        ),
      ),
    );
  }

  int _countFor(BusinessTransportSection section) =>
      section == BusinessTransportSection.wonJobs
      ? _jobs.length
      : _opportunitiesIn(section).length;

  Widget _buildSection(AppLocalizations l10n) {
    final rows = _section == BusinessTransportSection.wonJobs
        ? _jobs
        : _opportunitiesIn(_section);
    if (rows.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Text(
            businessTransportSectionEmpty(l10n, _section),
            textAlign: TextAlign.center,
            style: const TextStyle(
              color: AppColors.muted,
              fontWeight: FontWeight.w600,
              height: 1.4,
            ),
          ),
        ),
      );
    }
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
      children: [
        for (final row in rows)
          if (row is TransportRequest)
            _TransportJobCard(
              key: Key('transport-job-${row.id}'),
              job: row,
              businessId: widget.businessId,
              service: _service,
            )
          else if (row is TransportOpportunity)
            _TransportOpportunityCard(
              key: Key('transport-opportunity-${row.id}'),
              opportunity: row,
              quote: _quoteFor(row.requestId),
              onBid: () => _openBid(row),
              onWithdraw: () => _withdraw(row),
            ),
      ],
    );
  }
}

/// One request this business may price, with whatever it has already bid.
class _TransportOpportunityCard extends StatelessWidget {
  const _TransportOpportunityCard({
    super.key,
    required this.opportunity,
    required this.quote,
    required this.onBid,
    required this.onWithdraw,
  });

  final TransportOpportunity opportunity;
  final TransportQuote? quote;
  final VoidCallback onBid;
  final Future<void> Function() onWithdraw;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final dateFormat = DateFormat.yMMMd(
      Localizations.localeOf(context).toString(),
    );
    final live = quote != null && !quote!.isWithdrawn;
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.paper,
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            opportunity.trackingCode,
            style: const TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: AppColors.muted,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            opportunity.vehicleLabel.isEmpty
                ? l10n.vehicle
                : opportunity.vehicleLabel,
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.bold,
              color: AppColors.ink,
            ),
          ),
          const SizedBox(height: 8),
          _Fact(
            label: l10n.businessTransportRoute,
            value:
                '${opportunity.pickupArea.isEmpty ? l10n.notProvided : opportunity.pickupArea}'
                ' → '
                '${opportunity.destinationCountryName.isEmpty ? l10n.notProvided : opportunity.destinationCountryName}',
          ),
          _Fact(
            label: l10n.vehicle,
            value: opportunity.vehicleOperable
                ? l10n.businessTransportVehicleOperable
                : l10n.businessTransportVehicleNotOperable,
          ),
          _Fact(
            label: l10n.transportMethod,
            value: transportMethodLabel(
              l10n,
              opportunity.requestedTransportMethod,
            ),
          ),
          _Fact(
            label: l10n.businessTransportPreferredPickup,
            value: opportunity.preferredDate == null
                ? l10n.businessTransportFlexibleDates
                : dateFormat.format(opportunity.preferredDate!),
          ),
          _Fact(
            label: l10n.businessTransportQuoteDeadline,
            value: opportunity.expiresAt == null
                ? l10n.notProvided
                : dateFormat.format(opportunity.expiresAt!),
          ),
          if (live) ...[
            const SizedBox(height: 10),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: AppColors.parchment,
                border: Border.all(color: AppColors.rule),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    l10n.businessTransportCurrentQuote,
                    style: const TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                      color: AppColors.muted,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    NumberFormat.simpleCurrency().format(
                      quote!.totalCents / 100,
                    ),
                    style: const TextStyle(
                      fontSize: 18,
                      fontWeight: FontWeight.w800,
                      color: AppColors.ink,
                    ),
                  ),
                  if (quote!.pickupIncluded && quote!.pickupFeeCents > 0)
                    Text(
                      '${NumberFormat.simpleCurrency().format(quote!.amountCents / 100)}'
                      ' + ${l10n.businessTransportPickupLeg} '
                      '${NumberFormat.simpleCurrency().format(quote!.pickupFeeCents / 100)}',
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.muted,
                      ),
                    ),
                  if (quote!.isRevision)
                    Text(
                      l10n.businessTransportRevisionNumber(quote!.revision),
                      style: const TextStyle(
                        fontSize: 12,
                        color: AppColors.muted,
                      ),
                    ),
                ],
              ),
            ),
          ],
          if (opportunity.isExpired) ...[
            const SizedBox(height: 10),
            Text(
              l10n.businessTransportWindowClosed,
              style: const TextStyle(
                color: AppColors.warn,
                fontWeight: FontWeight.w700,
                fontSize: 13,
              ),
            ),
          ],
          const SizedBox(height: 12),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              FilledButton.icon(
                key: Key('transport-bid-${opportunity.id}'),
                // The server refuses a quote after the deadline, so the button
                // is absent rather than present-and-rejected.
                onPressed: opportunity.isExpired ? null : onBid,
                icon: const Icon(Icons.request_quote, size: 18),
                label: Text(
                  live
                      ? l10n.businessTransportReviseQuote
                      : l10n.businessTransportSendQuote,
                ),
              ),
              if (live && quote!.isSubmitted)
                AsyncActionButton.outlined(
                  key: Key('transport-withdraw-${opportunity.id}'),
                  icon: Icons.cancel_outlined,
                  label: l10n.businessTransportWithdrawQuote,
                  loadingLabel: l10n.businessTransportWithdrawingQuote,
                  onPressed: onWithdraw,
                ),
            ],
          ),
        ],
      ),
    );
  }
}

/// One won job, and the only legal ways it can move.
///
/// The control mirrors the server's transition table rather than listing every
/// status: a carrier is offered `in_transit` from `scheduled` and nothing at
/// all from `delivered`. It calls `updateTransportFulfillmentStatus` and never
/// writes `transportRequests` directly - the web console does write directly
/// and thereby skips both the table and the container gate, which is the defect
/// this is deliberately not repeating.
class _TransportJobCard extends StatefulWidget {
  const _TransportJobCard({
    super.key,
    required this.job,
    required this.businessId,
    required this.service,
  });

  final TransportRequest job;
  final String businessId;
  final BusinessTransportService service;

  @override
  State<_TransportJobCard> createState() => _TransportJobCardState();
}

class _TransportJobCardState extends State<_TransportJobCard> {
  final TextEditingController _containerController = TextEditingController();
  String _error = '';

  @override
  void dispose() {
    _containerController.dispose();
    super.dispose();
  }

  /// What the server will compare against its table: `fulfillmentStatus` when
  /// it has one, `status` otherwise.
  String get _currentStatus => transportJobCurrentStatus(<String, dynamic>{
    'fulfillmentStatus': widget.job.fulfillmentStatus,
    'status': widget.job.status,
  });

  Future<void> _move(String nextStatus) async {
    final l10n = AppLocalizations.of(context)!;
    final typed = _containerController.text;
    final errors = validateTransportFulfillmentChange(
      currentStatus: _currentStatus,
      nextStatus: nextStatus,
      existingContainerNumber: widget.job.containerNumber,
      submittedContainerNumber: typed,
    );
    if (errors.isNotEmpty) {
      setState(
        () => _error = transportFulfillmentErrorText(
          l10n,
          errors.first,
          currentStatus: _currentStatus,
          nextStatus: nextStatus,
        ),
      );
      return;
    }
    setState(() => _error = '');
    try {
      final result = await widget.service.updateFulfillmentStatus(
        requestId: widget.job.id,
        status: nextStatus,
        containerNumber: typed,
        businessId: widget.businessId,
      );
      if (!mounted) return;
      _containerController.clear();
      showSuccessSnackBar(
        context,
        // Two people tapping the same status is a success, not an error.
        result.alreadyUpdated
            ? l10n.transportJobStatusAlready(
                transportFulfillmentStatusLabel(l10n, result.status),
              )
            : l10n.transportJobStatusUpdated,
      );
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) return;
      final message = (error.message ?? '').trim();
      setState(
        () => _error = message.isEmpty ? l10n.transportJobStatusFailed : message,
      );
    } catch (_) {
      if (!mounted) return;
      setState(() => _error = l10n.transportJobStatusFailed);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final job = widget.job;
    final status = _currentStatus;
    final known = transportFulfillmentStatusIsKnown(status);
    final nextStatuses = transportFulfillmentNextStatuses(status);
    final container = job.containerNumber.trim();

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.paper,
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  job.trackingCode,
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: AppColors.muted,
                  ),
                ),
              ),
              // An unrecognised status is SHOWN, not mapped onto the nearest
              // transport status: `updateAdminRecordStatus` can write `active`,
              // `in_progress`, `completed`, `sold`, `reserved` or `inactive`
              // onto this same document, and labelling one of those "In
              // transit" would be a claim nobody made.
              Container(
                key: Key('transport-job-status-${job.id}'),
                padding: const EdgeInsets.symmetric(
                  horizontal: 10,
                  vertical: 4,
                ),
                decoration: BoxDecoration(
                  color: AppColors.parchment,
                  border: Border.all(
                    color: known ? AppColors.cobalt : AppColors.warn,
                  ),
                ),
                child: Text(
                  transportFulfillmentStatusLabel(l10n, status),
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            '${job.carYear} ${job.carMake} ${job.carModel}'.trim(),
            style: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.bold,
              color: AppColors.ink,
            ),
          ),
          const SizedBox(height: 8),
          _Fact(label: l10n.ownerName, value: job.ownerName),
          _Fact(
            label: l10n.pickupAddress,
            value: job.pickupAddress.isEmpty ? l10n.notProvided : job.pickupAddress,
          ),
          _Fact(
            label: l10n.destination,
            value: job.destinationCountryName.isEmpty
                ? l10n.notProvided
                : job.destinationCountryName,
          ),
          _Fact(
            label: l10n.transportJobAcceptedQuote,
            value: NumberFormat.simpleCurrency().format(
              job.selectedAmountCents > 0
                  ? job.selectedAmountCents / 100
                  : job.price,
            ),
          ),
          if (container.isNotEmpty)
            _Fact(
              label: l10n.containerNumberLabel,
              value: l10n.transportJobContainerOnFile(container),
            ),
          const Divider(height: 24),
          Text(
            l10n.transportJobMoveTitle,
            style: const TextStyle(
              fontWeight: FontWeight.w800,
              color: AppColors.ink,
            ),
          ),
          const SizedBox(height: 8),
          if (!known)
            Text(
              key: Key('transport-job-unknown-${job.id}'),
              l10n.transportJobStatusUnknown(
                transportFulfillmentStatusLabel(l10n, status),
              ),
              style: const TextStyle(
                color: AppColors.muted,
                height: 1.4,
                fontSize: 13,
              ),
            )
          else if (nextStatuses.isEmpty)
            Text(
              l10n.transportJobNothingLeft,
              style: const TextStyle(
                color: AppColors.muted,
                height: 1.4,
                fontSize: 13,
              ),
            )
          else ...[
            // The container number is asked for before `in_transit` rather than
            // let the server's `failed-precondition` be how a carrier finds out
            // it was needed. Shown only while a move that needs it is on offer,
            // and only while the job does not already carry one.
            if (nextStatuses.any(transportFulfillmentRequiresContainer) &&
                container.isEmpty) ...[
              TextField(
                key: Key('transport-job-container-${job.id}'),
                controller: _containerController,
                textCapitalization: TextCapitalization.characters,
                onChanged: (_) => setState(() {}),
                decoration: InputDecoration(
                  isDense: true,
                  labelText: l10n.containerNumberLabel,
                  hintText: l10n.containerNumberHint,
                ),
              ),
              const SizedBox(height: 12),
            ],
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final next in nextStatuses)
                  AsyncActionButton.outlined(
                    key: Key('transport-job-${job.id}-to-$next'),
                    label: transportFulfillmentStatusLabel(l10n, next),
                    onPressed: () => _move(next),
                  ),
              ],
            ),
          ],
          if (_error.isNotEmpty) ...[
            const SizedBox(height: 10),
            Text(
              _error,
              key: Key('transport-job-error-${job.id}'),
              style: const TextStyle(
                color: AppColors.errorRed,
                fontWeight: FontWeight.w600,
                height: 1.4,
                fontSize: 13,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _Fact extends StatelessWidget {
  const _Fact({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 4),
    child: Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 120,
          child: Text(
            label,
            style: const TextStyle(fontSize: 12, color: AppColors.muted),
          ),
        ),
        Expanded(
          child: Text(
            value,
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: AppColors.ink,
            ),
          ),
        ),
      ],
    ),
  );
}
