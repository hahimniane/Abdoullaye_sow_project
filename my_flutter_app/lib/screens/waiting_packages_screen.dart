import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../models/destination_country.dart';
import '../services/container_manifest.dart';
import '../services/container_packages.dart';
import '../services/line_pieces.dart' show LineGroupSummary, piecesLineFields;
import '../services/lot_customers.dart';
import '../services/lot_ledger.dart' show LotKnownCar, LotStaff;
import '../services/package_request_feed.dart';
import '../services/package_request_service.dart';
import '../services/package_requests.dart';
import '../services/waiting_package_service.dart';
import '../services/waiting_packages.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/action_confirmation.dart';
import '../utils/date_display.dart';
import '../widgets/app_back_button.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/lot_sheets.dart';
import '../widgets/package_money.dart';
import '../widgets/package_request_widgets.dart';
import 'containers_screen.dart';
import 'package_estimate_screen.dart';
import 'package_payment_sheet.dart';
import 'package_result_screen.dart';
import 'receive_request_sheet.dart';

/// The way into the waiting list from the containers screen: how many
/// packages have been dropped off with no container yet, one tap from the
/// top of the list. Always shown, even at zero, so staff learn where the
/// packages they register are kept.
class WaitingEntryRow extends StatelessWidget {
  const WaitingEntryRow({super.key, required this.count, required this.onTap});

  final int count;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return PressableScale(
      key: const Key('containers-open-waiting'),
      scale: 0.985,
      onTap: () {
        AppHaptics.selection();
        onTap();
      },
      child: Container(
        padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.md, vertical: AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.parchment,
          borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
          border: Border.all(color: AppColors.rule),
        ),
        child: Row(
          children: [
            const Icon(Icons.inventory_2_outlined,
                size: 20, color: AppColors.cobaltDeep),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    l10n.wpkWaitingTitle,
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: AppColors.ink,
                    ),
                  ),
                  Text(
                    count == 0 ? l10n.wpkEntryHint : l10n.wpkEntryCount(count),
                    key: const Key('containers-waiting-count'),
                    style: const TextStyle(
                        fontSize: 12.5, height: 1.3, color: AppColors.muted),
                  ),
                ],
              ),
            ),
            const Icon(Icons.chevron_right, size: 18, color: AppColors.muted),
          ],
        ),
      ),
    );
  }
}

/// The packages dropped off before any container: the counter's list.
/// Register one (or several for the same customer in a row), print its label,
/// take a payment, and leave it for a container to claim - a loading
/// container's own "Add waiting packages" does the claiming.
///
/// Reads the lines the containers screen already listens to, so opening it
/// costs no second subscription.
class WaitingPackagesScreen extends StatefulWidget {
  const WaitingPackagesScreen({
    super.key,
    required this.businessId,
    required this.feed,
    this.staff = const [],
    this.customers = const [],
    this.knownCars = const [],
    this.parkedCarRows = const [],
    this.destinations = const [],
    this.businessCountryCode = '',
    this.onCustomerRecorded,
    this.caller = callContainerCallable,
    this.labelOpener = openContainerLabels,
    this.requestFeed,
  });

  final String businessId;
  final ContainerFeed feed;

  /// The business's open package requests: the confirmed ones show as
  /// Expected above the packages already in the shop.
  final PackageRequestFeed? requestFeed;
  final List<LotStaff> staff;
  final List<LotCustomer> customers;
  final List<LotKnownCar> knownCars;
  final List<Map<String, dynamic>> parkedCarRows;
  final List<DestinationCountry> destinations;
  final String businessCountryCode;

  /// Told after a package is registered, so the lot's customer memory
  /// refreshes.
  final VoidCallback? onCustomerRecorded;
  final ContainerCallableCaller caller;
  final ContainerLabelOpener labelOpener;

  @override
  State<WaitingPackagesScreen> createState() => _WaitingPackagesScreenState();
}

class _WaitingPackagesScreenState extends State<WaitingPackagesScreen> {
  final _filter = TextEditingController();
  String _busy = '';

  @override
  void initState() {
    super.initState();
    widget.feed.addListener(_onFeed);
    widget.requestFeed?.addListener(_onFeed);
  }

  @override
  void dispose() {
    widget.feed.removeListener(_onFeed);
    widget.requestFeed?.removeListener(_onFeed);
    _filter.dispose();
    super.dispose();
  }

  /// Expected requests matching the search, soonest first.
  List<PackageRequest> _expected(String query) {
    final all = widget.requestFeed?.expected ?? const <PackageRequest>[];
    final q = query.trim().toLowerCase();
    if (q.length < 2) return all;
    return [
      for (final r in all)
        if ([
          r.senderName,
          r.senderPhone,
          r.receiverName,
          r.code,
        ].any((s) => s.toLowerCase().contains(q)))
          r,
    ];
  }

  Future<void> _receive(PackageRequest request) async {
    final l10n = AppLocalizations.of(context)!;
    final service = widget.requestFeed?.service;
    if (service == null || _busy.isNotEmpty) return;
    final received = await showReceiveRequestSheet(
      context,
      businessId: widget.businessId,
      request: request,
      service: service,
      staff: widget.staff,
    );
    if (received == null || !mounted) return;
    showSuccessSnackBar(
      context,
      received.alreadyReceived
          ? l10n.prqAlreadyReceived(received.trackingCode)
          : l10n.prqReceivedDone(received.trackingCode),
    );
    if (received.lineId.isEmpty) return;
    // Labels, one per piece ("CODE · 1 of N"), from the server's own label
    // set for the new line - the same sheet as any waiting package.
    final line =
        widget.feed.lines.where((l) => l.id == received.lineId).firstOrNull ??
        ContainerLine.fromMap(received.lineId, {
          'businessId': widget.businessId,
          'containerId': '',
          'containerStatus': containerLineStatusWaiting,
          // The pieces as they arrived (some may have been added or left
          // out at Received), the way the server stored them.
          ...piecesLineFields(
            received.pieces.isNotEmpty
                ? received.pieces
                : [for (final p in requestLinePieces(request)) p.toMap()],
          ),
          'customerName': request.senderName,
          'customerPhone': request.senderPhone,
          'receiverName': request.receiverName,
          'receiverPhone': request.receiverPhone,
          'trackingCode': received.trackingCode,
          'destinationCountryId': request.destinationCountryId,
          'destinationCountryName': request.destinationCountryName,
        });
    await _printLabel(line);
  }

  Future<void> _cancelRequest(PackageRequest request) async {
    final l10n = AppLocalizations.of(context)!;
    final service = widget.requestFeed?.service;
    if (service == null || _busy.isNotEmpty) return;
    final reason = await askRequestReason(
      context,
      title: l10n.prqCancelTitle,
      message: l10n.prqCancelMessage,
      confirmLabel: l10n.prqCancelRequest,
    );
    if (reason == null || !mounted) return;
    setState(() => _busy = request.id);
    try {
      await service.cancel(
        businessId: widget.businessId,
        requestId: request.id,
        reason: reason,
      );
      if (!mounted) return;
      AppHaptics.commit();
      showSuccessSnackBar(context, l10n.prqCancelledDone);
    } on RequestFailure catch (failure) {
      if (!mounted) return;
      AppHaptics.refuse();
      showErrorSnackBar(context, requestRefusalText(l10n, failure.refusal));
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  void _openRequest(PackageRequest request) {
    final service = widget.requestFeed?.service;
    if (service == null) return;
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => PackageEstimateScreen(
          businessId: widget.businessId,
          requestId: request.id,
          initial: request,
          service: service,
        ),
      ),
    );
  }

  void _onFeed() {
    if (mounted) setState(() {});
  }

  List<ContainerLine> get _waiting => waitingLines(widget.feed.lines);

  Future<void> _register() async {
    final saved = await showWaitingPackageSheet(
      context,
      businessId: widget.businessId,
      containers: widget.feed.containers,
      lines: widget.feed.lines,
      customers: widget.customers,
      knownCars: widget.knownCars,
      parkedCarRows: widget.parkedCarRows,
      businessCountryCode: widget.businessCountryCode,
      destinations: widget.destinations,
      onLineAdded: widget.onCustomerRecorded,
      caller: widget.caller,
      staff: widget.staff,
    );
    if (saved == null || !mounted) return;
    final line = saved.line;
    if (saved.printLabel && line != null) await _printLabel(line);
  }

  Future<void> _edit(ContainerLine line) async {
    await showWaitingPackageSheet(
      context,
      businessId: widget.businessId,
      containers: widget.feed.containers,
      lines: widget.feed.lines,
      customers: widget.customers,
      knownCars: widget.knownCars,
      parkedCarRows: widget.parkedCarRows,
      businessCountryCode: widget.businessCountryCode,
      destinations: widget.destinations,
      existing: line,
      onLineAdded: widget.onCustomerRecorded,
      caller: widget.caller,
      staff: widget.staff,
    );
  }

  Future<void> _printLabel(ContainerLine line) => showContainerLabelSheet(
        context,
        businessId: widget.businessId,
        line: line,
        opener: widget.labelOpener,
      );

  Future<void> _remove(ContainerLine line) async {
    final l10n = AppLocalizations.of(context)!;
    final ok = await confirmMajorAction(
      context,
      title: l10n.wpkRemoveTitle,
      message: l10n.wpkRemoveMessage,
      confirmLabel: l10n.ctrRemove,
      destructive: true,
    );
    if (!ok || !mounted) return;
    if (_busy.isNotEmpty) return;
    setState(() => _busy = 'remove');
    try {
      await widget.caller(
        'removeContainerLine',
        removeWaitingPackageRequest(widget.businessId, line.id),
      );
      if (!mounted) return;
      AppHaptics.commit();
      showSuccessSnackBar(context, l10n.wpkRemoved);
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      showErrorSnackBar(context, containerRefusalText(l10n, error));
    } catch (_) {
      if (!mounted) return;
      AppHaptics.refuse();
      showErrorSnackBar(context, l10n.lotCouldNotSave);
    } finally {
      if (mounted) setState(() => _busy = '');
    }
  }

  void _open(ContainerLine line) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => PackageResultScreen(
          businessId: widget.businessId,
          code: line.trackingCode,
          lineId: line.id,
          businessCountryCode: widget.businessCountryCode,
          destinations: widget.destinations,
          labelOpener: widget.labelOpener,
          staff: widget.staff,
          groupLines: widget.feed.lines,
        ),
      ),
    );
  }

  Future<void> _actions(ContainerLine line) async {
    final l10n = AppLocalizations.of(context)!;
    final action = await showLotSheet<String>(
      context,
      LotSheetShell(
        title: containerLineTitle(l10n, line),
        subtitle: l10n.wpkWaitingTitle,
        body: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            ContainerSheetAction(
              key: const Key('waiting-money'),
              icon: Icons.payments_outlined,
              label: l10n.wpkMoney,
              onTap: () => Navigator.of(context).pop('money'),
            ),
            ContainerSheetAction(
              key: const Key('waiting-print'),
              icon: Icons.qr_code_2,
              label: l10n.ctrPrintLineLabels,
              onTap: () => Navigator.of(context).pop('print'),
            ),
            ContainerSheetAction(
              key: const Key('waiting-edit'),
              icon: Icons.edit_outlined,
              label: l10n.wpkEditPackage,
              onTap: () => Navigator.of(context).pop('edit'),
            ),
            ContainerSheetAction(
              key: const Key('waiting-contacts'),
              icon: Icons.contact_phone_outlined,
              label: l10n.ctrEditContacts,
              onTap: () => Navigator.of(context).pop('contacts'),
            ),
            ContainerSheetAction(
              key: const Key('waiting-open'),
              icon: Icons.open_in_new,
              label: l10n.pkgTitle,
              onTap: () => Navigator.of(context).pop('open'),
            ),
            ContainerSheetAction(
              key: const Key('waiting-history'),
              icon: Icons.history,
              label: l10n.lotHistory,
              onTap: () => Navigator.of(context).pop('history'),
            ),
            ContainerSheetAction(
              key: const Key('waiting-remove'),
              icon: Icons.remove_circle_outline,
              label: l10n.wpkRemove,
              destructive: true,
              onTap: () => Navigator.of(context).pop('remove'),
            ),
          ],
        ),
      ),
    );
    if (action == null || !mounted) return;
    switch (action) {
      case 'money':
        await showPackagePaymentSheet(
          context,
          businessId: widget.businessId,
          line: line,
          staff: widget.staff,
          caller: widget.caller,
          group: lineGroupOf(line, widget.feed.groups),
        );
      case 'print':
        await _printLabel(line);
      case 'edit':
        await _edit(line);
      case 'contacts':
        await editContainerLineContacts(
          context,
          businessId: widget.businessId,
          line: line,
          businessCountryCode: widget.businessCountryCode,
          destinations: widget.destinations,
        );
      case 'open':
        _open(line);
      case 'history':
        await showLotSheet<void>(
          context,
          LotHistorySheet(
            businessId: widget.businessId,
            entityId: line.id,
            staff: widget.staff,
          ),
        );
      case 'remove':
        await _remove(line);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final all = _waiting;
    final shown = filterWaitingPackages(all, _filter.text);
    final searching = _filter.text.trim().length >= 2;

    return Scaffold(
      backgroundColor: AppColors.cream,
      body: Column(
        children: [
          Container(
            decoration: BoxDecoration(
              color: AppColors.paper,
              border: Border(
                bottom: BorderSide(color: AppColors.rule.withValues(alpha: 0.8)),
              ),
            ),
            child: SafeArea(
              bottom: false,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(
                    4, 4, AppSpacing.lg, AppSpacing.md),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        const AppBackButton(),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                l10n.wpkWaitingTitle,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontSize: 20,
                                  fontWeight: FontWeight.w700,
                                  height: 1.1,
                                  letterSpacing: -0.4,
                                  color: AppColors.ink,
                                ),
                              ),
                              Text(
                                l10n.wpkEntryCount(all.length),
                                key: const Key('waiting-count'),
                                style: const TextStyle(
                                  fontSize: 12,
                                  height: 1.3,
                                  color: AppColors.muted,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.md),
                    Padding(
                      padding: const EdgeInsets.only(left: AppSpacing.md),
                      child: TextField(
                        key: const Key('waiting-search'),
                        controller: _filter,
                        onChanged: (_) => setState(() {}),
                        textInputAction: TextInputAction.search,
                        decoration: InputDecoration(
                          hintText: l10n.ctrSearchHint,
                          prefixIcon: const Icon(Icons.search,
                              size: 20, color: AppColors.muted),
                          isDense: true,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          Expanded(
            child: Stack(
              children: [
                if (!widget.feed.loaded)
                  const Center(child: CircularProgressIndicator())
                else
                  WaitingPackagesList(
                    lines: shown,
                    groups: widget.feed.groups,
                    staff: widget.staff,
                    anyAtAll: all.isNotEmpty,
                    searching: searching,
                    onTap: _busy.isNotEmpty ? null : _actions,
                    onPrint: _busy.isNotEmpty ? null : _printLabel,
                    expected: _expected(_filter.text),
                    busyRequestId: _busy,
                    onReceived: _receive,
                    onCancelRequest: _cancelRequest,
                    onOpenRequest: _openRequest,
                  ),
                Positioned(
                  left: 0,
                  right: 0,
                  bottom: 0,
                  child: LotPrimaryBar(
                    label: l10n.wpkRegister,
                    icon: Icons.add,
                    onTap: _register,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The waiting packages as a list of cards: pure rendering over callbacks,
/// so it is tested without Firebase.
class WaitingPackagesList extends StatelessWidget {
  const WaitingPackagesList({
    super.key,
    required this.lines,
    required this.staff,
    required this.anyAtAll,
    required this.searching,
    required this.onTap,
    required this.onPrint,
    this.groups = const {},
    this.expected = const [],
    this.onReceived,
    this.onCancelRequest,
    this.onOpenRequest,
    this.busyRequestId = '',
  });

  /// What to show, already filtered, newest first.
  final List<ContainerLine> lines;

  /// Every package's group, worked out once by the feed: a part shows what
  /// its whole package has been paid and still owes.
  final Map<String, LineGroupSummary> groups;
  final List<LotStaff> staff;

  /// Whether anything waits at all, to tell "none" from "none match".
  final bool anyAtAll;
  final bool searching;
  final ValueChanged<ContainerLine>? onTap;
  final ValueChanged<ContainerLine>? onPrint;

  /// Confirmed package requests not yet handed over: "Expected", above the
  /// packages already in the shop.
  final List<PackageRequest> expected;
  final ValueChanged<PackageRequest>? onReceived;
  final ValueChanged<PackageRequest>? onCancelRequest;
  final ValueChanged<PackageRequest>? onOpenRequest;
  final String busyRequestId;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    if (expected.isNotEmpty) return _withExpected(context, l10n);
    if (lines.isEmpty) {
      return ListView(
        padding: const EdgeInsets.fromLTRB(
            AppSpacing.lg, AppSpacing.md, AppSpacing.lg, 120),
        children: [
          LotEmptyState(
            key: const Key('waiting-empty'),
            icon: Icons.inventory_2_outlined,
            title: anyAtAll && searching ? l10n.wpkNoMatch : l10n.wpkEmptyTitle,
            hint: anyAtAll ? null : l10n.wpkEmptyHint,
          ),
        ],
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(
          AppSpacing.lg, AppSpacing.md, AppSpacing.lg, 120),
      itemCount: lines.length,
      itemBuilder: (context, i) {
        final line = lines[i];
        return RiseIn(
          key: ValueKey(line.id),
          index: i,
          child: WaitingPackageCard(
            line: line,
            group: lineGroupOf(line, groups),
            staff: staff,
            onTap: onTap == null ? null : () => onTap!(line),
            onPrint: onPrint == null ? null : () => onPrint!(line),
          ),
        );
      },
    );
  }

  /// "Expected · N" above "In the shop · N": what customers confirmed they
  /// will bring (or the business will collect), then what is already here.
  Widget _withExpected(BuildContext context, AppLocalizations l10n) {
    Widget header(String text, Key key) => Padding(
      padding: const EdgeInsets.only(top: AppSpacing.sm, bottom: AppSpacing.sm),
      child: Text(
        text,
        key: key,
        style: const TextStyle(
          fontSize: 13,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.2,
          color: AppColors.muted,
        ),
      ),
    );
    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.md,
        AppSpacing.lg,
        120,
      ),
      children: [
        header(
          l10n.prqExpectedTitle(expected.length),
          const Key('waiting-expected-title'),
        ),
        for (final request in expected)
          ExpectedRequestCard(
            key: ValueKey('expected:${request.id}'),
            request: request,
            busy: busyRequestId == request.id,
            onReceived: onReceived == null ? null : () => onReceived!(request),
            onCancel: onCancelRequest == null || request.isCardOrder
                ? null
                : () => onCancelRequest!(request),
            onOpen: onOpenRequest == null
                ? null
                : () => onOpenRequest!(request),
          ),
        header(
          l10n.prqInShopTitle(lines.length),
          const Key('waiting-in-shop-title'),
        ),
        if (lines.isEmpty)
          LotEmptyState(
            key: const Key('waiting-empty'),
            icon: Icons.inventory_2_outlined,
            title: anyAtAll && searching ? l10n.wpkNoMatch : l10n.wpkEmptyTitle,
          )
        else
          for (final line in lines)
            WaitingPackageCard(
              key: ValueKey(line.id),
              line: line,
              staff: staff,
              onTap: onTap == null ? null : () => onTap!(line),
              onPrint: onPrint == null ? null : () => onPrint!(line),
            ),
      ],
    );
  }
}

/// A confirmed request in the Waiting list, amber so it reads as "not here
/// yet": who, when (planned day or pickup window), what, the estimate - and
/// Received (or "Picked up · Received" for a collection) and Cancel.
class ExpectedRequestCard extends StatelessWidget {
  const ExpectedRequestCard({
    super.key,
    required this.request,
    this.onReceived,
    this.onCancel,
    this.onOpen,
    this.busy = false,
  });

  final PackageRequest request;
  final VoidCallback? onReceived;
  final VoidCallback? onCancel;
  final VoidCallback? onOpen;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    final when = request.isCollect
        ? (request.handoffDay.isEmpty
              ? l10n.prqNoDay
              : l10n.prqCollectOn(
                  requestDayText(request.handoffDay, locale),
                  requestWindowLabel(l10n, request.handoffWindow),
                ))
        : (request.plannedDate.isEmpty
              ? l10n.prqNoDay
              : l10n.prqPlannedDayShort(
                  requestDayText(request.plannedDate, locale),
                ));
    final where = request.isCollect
        ? request.pickup?.address ?? ''
        : request.location?.title ?? '';
    final total = request.totalCents;
    return PressableScale(
      scale: 0.985,
      onTap: onOpen == null
          ? null
          : () {
              AppHaptics.selection();
              onOpen!();
            },
      child: Container(
        margin: const EdgeInsets.only(bottom: AppSpacing.sm),
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.saffron.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          border: Border.all(color: AppColors.saffron.withValues(alpha: 0.45)),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(
                  request.isCollect
                      ? Icons.local_shipping_outlined
                      : Icons.schedule_outlined,
                  size: 20,
                  color: AppColors.warn,
                ),
                const SizedBox(width: AppSpacing.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        request.senderName,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 15,
                          fontWeight: FontWeight.w700,
                          color: AppColors.ink,
                        ),
                      ),
                      Text(
                        [when, if (where.isNotEmpty) where].join(' · '),
                        key: const Key('expected-when'),
                        style: const TextStyle(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                          color: AppColors.ink,
                        ),
                      ),
                      Text(
                        [
                          containerPiecesSummary(
                            l10n,
                            requestLinePieces(request),
                          ),
                          if (request.destinationCountryName.isNotEmpty)
                            request.destinationCountryName,
                          request.code,
                        ].where((s) => s.isNotEmpty).join(' · '),
                        style: const TextStyle(
                          fontSize: 12.5,
                          color: AppColors.muted,
                        ),
                      ),
                      if (total != null)
                        Text(
                          l10n.prqEstimateTotal(formatRequestCents(total)),
                          style: const TextStyle(
                            fontSize: 12.5,
                            fontWeight: FontWeight.w600,
                            color: AppColors.cobaltDeep,
                          ),
                        ),
                    ],
                  ),
                ),
              ],
            ),
            if (request.isCardOrder || request.whatsappUnreachable)
              Padding(
                padding: const EdgeInsets.only(top: AppSpacing.sm),
                child: Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    if (request.isCardOrder)
                      RequestBadge(
                        key: const Key('expected-paid-online'),
                        icon: Icons.credit_card,
                        label: l10n.prqPaidOnline,
                        color: AppColors.sage,
                      ),
                    if (request.whatsappUnreachable)
                      RequestBadge(
                        icon: Icons.phone_disabled_outlined,
                        label: l10n.prqNotReachable,
                        color: AppColors.errorRed,
                      ),
                  ],
                ),
              ),
            const SizedBox(height: AppSpacing.sm),
            Wrap(
              spacing: AppSpacing.sm,
              runSpacing: AppSpacing.sm,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                FilledButton.icon(
                  key: ValueKey('expected-received:${request.id}'),
                  onPressed: busy ? null : onReceived,
                  icon: busy
                      ? const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: Colors.white,
                          ),
                        )
                      : const Icon(Icons.inventory_2_outlined, size: 16),
                  label: Text(
                    request.isCollect
                        ? l10n.prqPickedUpReceived
                        : l10n.prqReceived,
                  ),
                ),
                if (onCancel != null)
                  TextButton(
                    key: ValueKey('expected-cancel:${request.id}'),
                    style: TextButton.styleFrom(
                      foregroundColor: AppColors.errorRed,
                    ),
                    onPressed: busy ? null : onCancel,
                    child: Text(l10n.prqCancelRequest),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// One waiting package: what it is, whose, where it is going, how big, and
/// where it stands on money.
class WaitingPackageCard extends StatelessWidget {
  const WaitingPackageCard({
    super.key,
    required this.line,
    required this.staff,
    this.onTap,
    this.onPrint,
    this.group,
  });

  final ContainerLine line;

  /// Its package's group; null reads the line alone.
  final LineGroupSummary? group;
  final List<LotStaff> staff;
  final VoidCallback? onTap;
  final VoidCallback? onPrint;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    final addedBy =
        staff.where((s) => s.id == line.addedByStaffId).firstOrNull?.name ?? '';
    final owner = [line.customerName, line.customerPhone]
        .where((p) => p.isNotEmpty)
        .join(' · ');
    final receiver = [line.receiverName, line.receiverPhone]
        .where((p) => p.isNotEmpty)
        .join(' · ');
    final size = packageSize(line);
    final where = [
      // "3 pieces · Guinea": the count the labels are printed for.
      if (!line.isCar) l10n.pcsPieceCount(line.pieceCount),
      if (line.destinationCountryName.isNotEmpty) line.destinationCountryName,
      if (size != null) '${size.dimensionsText} · ${size.volumeText}',
    ].join(' · ');
    final g = group;
    // A part split off a package that went ahead: which package it is.
    final partOf = line.isPart && g != null && g.parts.isNotEmpty
        ? l10n.pcsPartOf(line.partIndex, g.parts.first.trackingCode)
        : '';
    final dropped = line.createdAt == null
        ? ''
        : l10n.wpkDroppedOff(displayDate(line.createdAt!, locale));
    final meta = [
      if (dropped.isNotEmpty) dropped,
      if (addedBy.isNotEmpty) '${l10n.lotRecordedBy}: $addedBy',
    ].join(' · ');
    TextStyle muted(double size) =>
        TextStyle(fontSize: size, height: 1.35, color: AppColors.muted);

    return PressableScale(
      onTap: onTap == null
          ? null
          : () {
              AppHaptics.selection();
              onTap!();
            },
      scale: 0.985,
      child: Container(
        margin: const EdgeInsets.only(bottom: AppSpacing.sm),
        padding: const EdgeInsets.all(AppSpacing.md),
        decoration: BoxDecoration(
          color: AppColors.paper,
          borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          border: Border.all(color: AppColors.rule),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              width: 34,
              height: 34,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: AppColors.mist,
                borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
              ),
              child: Icon(containerKindIcon(line.kind),
                  size: 18, color: AppColors.cobaltDeep),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    containerLineTitle(l10n, line),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: const TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w700,
                      letterSpacing: -0.2,
                      color: AppColors.ink,
                    ),
                  ),
                  if (line.isCar &&
                      line.vinNumber.isNotEmpty &&
                      line.vehicleLabel != line.vinNumber)
                    Text(line.vinNumber, style: muted(12.5)),
                  if (owner.isNotEmpty) Text(owner, style: muted(13)),
                  if (receiver.isNotEmpty)
                    Text('→ $receiver', style: muted(13)),
                  if (where.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 3),
                      child: Text(
                        where,
                        key: const Key('waiting-where'),
                        style: const TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w600,
                          color: AppColors.ink,
                        ),
                      ),
                    ),
                  if (line.trackingCode.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 3),
                      child: Text(
                        l10n.ctrLineTrackingCode(line.trackingCode),
                        key: const Key('line-tracking-code'),
                        style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          letterSpacing: 0.2,
                          color: AppColors.cobaltDeep,
                        ),
                      ),
                    ),
                  if (partOf.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 3),
                      child: Text(
                        partOf,
                        key: const Key('waiting-part-of'),
                        style: muted(12),
                      ),
                    ),
                  PackageMoneyLine(
                    payment: g == null ? packagePayment(line) : groupPayment(g),
                    alwaysShow: true,
                  ),
                  if (meta.isNotEmpty)
                    Padding(
                      padding: const EdgeInsets.only(top: 4),
                      child: Text(meta, style: muted(11)),
                    ),
                ],
              ),
            ),
            if (onPrint != null) ...[
              const SizedBox(width: AppSpacing.sm),
              IconButton(
                key: ValueKey('waiting-print-labels:${line.id}'),
                onPressed: onPrint,
                icon: const Icon(Icons.qr_code_2, size: 20),
                color: AppColors.cobaltDeep,
                tooltip: l10n.ctrPrintLineLabels,
                visualDensity: VisualDensity.compact,
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// The waiting list on its own, for widget tests.
@visibleForTesting
Widget waitingPackagesListForTesting({
  required List<ContainerLine> lines,
  Map<String, LineGroupSummary> groups = const {},
  List<LotStaff> staff = const [],
  bool anyAtAll = true,
  bool searching = false,
  ValueChanged<ContainerLine>? onTap,
  ValueChanged<ContainerLine>? onPrint,
}) =>
    WaitingPackagesList(
      lines: lines,
      groups: groups,
      staff: staff,
      anyAtAll: anyAtAll,
      searching: searching,
      onTap: onTap,
      onPrint: onPrint,
    );
