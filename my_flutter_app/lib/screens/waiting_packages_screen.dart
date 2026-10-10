import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../models/destination_country.dart';
import '../services/container_manifest.dart';
import '../services/container_packages.dart';
import '../services/lot_customers.dart';
import '../services/lot_ledger.dart' show LotKnownCar, LotStaff;
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
import 'containers_screen.dart';
import 'package_payment_sheet.dart';
import 'package_result_screen.dart';

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
  });

  final String businessId;
  final ContainerFeed feed;
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
  }

  @override
  void dispose() {
    widget.feed.removeListener(_onFeed);
    _filter.dispose();
    super.dispose();
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
                    staff: widget.staff,
                    anyAtAll: all.isNotEmpty,
                    searching: searching,
                    onTap: _busy.isNotEmpty ? null : _actions,
                    onPrint: _busy.isNotEmpty ? null : _printLabel,
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
  });

  /// What to show, already filtered, newest first.
  final List<ContainerLine> lines;
  final List<LotStaff> staff;

  /// Whether anything waits at all, to tell "none" from "none match".
  final bool anyAtAll;
  final bool searching;
  final ValueChanged<ContainerLine>? onTap;
  final ValueChanged<ContainerLine>? onPrint;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
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
            staff: staff,
            onTap: onTap == null ? null : () => onTap!(line),
            onPrint: onPrint == null ? null : () => onPrint!(line),
          ),
        );
      },
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
  });

  final ContainerLine line;
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
      if (line.destinationCountryName.isNotEmpty) line.destinationCountryName,
      if (size != null) '${size.dimensionsText} · ${size.volumeText}',
    ].join(' · ');
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
                  PackageMoneyLine(payment: packagePayment(line), alwaysShow: true),
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
  List<LotStaff> staff = const [],
  bool anyAtAll = true,
  bool searching = false,
  ValueChanged<ContainerLine>? onTap,
  ValueChanged<ContainerLine>? onPrint,
}) =>
    WaitingPackagesList(
      lines: lines,
      staff: staff,
      anyAtAll: anyAtAll,
      searching: searching,
      onTap: onTap,
      onPrint: onPrint,
    );
