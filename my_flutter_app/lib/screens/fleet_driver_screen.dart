import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/fleet.dart';
import '../services/fleet_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../widgets/app_snackbars.dart';
import '../widgets/fleet_widgets.dart';
import 'fleet_driver_sheets.dart';

/// A driver's page (docs/FLEET.md section 6): who they are, what they owe,
/// the plate they have, their track record, office notes, friends who drove,
/// their bills and their payments. Everything here is office-only.
class FleetDriverScreen extends StatefulWidget {
  const FleetDriverScreen({
    super.key,
    required this.controller,
    required this.driverId,
    required this.onOpenCar,
  });

  final FleetController controller;
  final String driverId;
  final ValueChanged<String> onOpenCar;

  @override
  State<FleetDriverScreen> createState() => _FleetDriverScreenState();
}

class _FleetDriverScreenState extends State<FleetDriverScreen> {
  FleetBillView _billView = FleetBillView.open;
  FleetPaymentView _paymentView = FleetPaymentView.all;
  int _billsShown = 20;
  int _paymentsShown = 20;
  int _timelineShown = 12;
  bool _reminding = false;

  FleetController get c => widget.controller;

  Future<void> _remind(FleetDriver driver) async {
    if (_reminding) return;
    final l10n = AppLocalizations.of(context)!;
    setState(() => _reminding = true);
    try {
      await c.service.call(
        FleetRequests.whatsappRemindDriver(c.businessId, driver.id),
      );
      if (mounted) showSuccessSnackBar(context, l10n.fltReminderSent);
    } on FleetFailure catch (failure) {
      if (mounted) showErrorSnackBar(context, fleetRefusalText(l10n, failure));
    } finally {
      if (mounted) setState(() => _reminding = false);
    }
  }

  Future<void> _undo(FleetPayment p) async {
    final l10n = AppLocalizations.of(context)!;
    final yes = await fleetConfirm(
      context,
      title: l10n.fltUndoPaymentTitle,
      message: l10n.fltUndoPaymentMessage(fleetMoney(p.amountCents)),
      confirmLabel: l10n.fltUndoAction,
      destructive: true,
    );
    if (!yes || !mounted) return;
    try {
      await c.service.call(FleetRequests.paymentUndo(c.businessId, p.id));
      if (mounted) showSuccessSnackBar(context, l10n.fltPaymentUndone);
    } on FleetFailure catch (failure) {
      if (mounted) showErrorSnackBar(context, fleetRefusalText(l10n, failure));
    }
  }

  Future<void> _voidNote(FleetNote n) async {
    final l10n = AppLocalizations.of(context)!;
    final yes = await fleetConfirm(
      context,
      title: l10n.fltRemoveNoteTitle,
      message: l10n.fltRemoveNoteMessage,
      confirmLabel: l10n.fltRemove,
      destructive: true,
    );
    if (!yes || !mounted) return;
    try {
      await c.service.call(FleetRequests.noteVoid(c.businessId, n.id));
    } on FleetFailure catch (failure) {
      if (mounted) showErrorSnackBar(context, fleetRefusalText(l10n, failure));
    }
  }

  Future<void> _voidFriend(FleetFriend f) async {
    final l10n = AppLocalizations.of(context)!;
    final yes = await fleetConfirm(
      context,
      title: l10n.fltRemoveFriendTitle,
      message: l10n.fltRemoveFriendMessage,
      confirmLabel: l10n.fltRemove,
      destructive: true,
    );
    if (!yes || !mounted) return;
    try {
      await c.service.call(FleetRequests.substituteVoid(c.businessId, f.id));
    } on FleetFailure catch (failure) {
      if (mounted) showErrorSnackBar(context, fleetRefusalText(l10n, failure));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return ListenableBuilder(
      listenable: c,
      builder: (context, _) {
        final s = c.state;
        final driver = s.index.driverById[widget.driverId];
        return Scaffold(
          backgroundColor: AppColors.cream,
          appBar: AppBar(title: Text(driver?.name ?? l10n.fltDriver)),
          body: driver == null
              ? Center(
                  child: Text(
                    s.loading ? '' : l10n.fltRefusalNotFound,
                    key: const Key('fleet-driver-missing'),
                  ),
                )
              : _body(context, l10n, s, driver),
        );
      },
    );
  }

  Widget _body(
    BuildContext context,
    AppLocalizations l10n,
    FleetState s,
    FleetDriver driver,
  ) {
    final index = s.index;
    final current = index.currentByDriver[driver.id];
    final car = current == null ? null : index.carById[current.carId];
    final bills = [...?index.billsByDriver[driver.id]]
      ..sort((a, b) => b.dueDayKey.compareTo(a.dueDayKey));
    final payments = [...?index.paymentsByDriver[driver.id]]
      ..sort((a, b) {
        final d = b.paidDayKey.compareTo(a.paidDayKey);
        return d != 0 ? d : b.receivedAtMs - a.receivedAtMs;
      });
    final balance = fleetDriverBalance(bills, driver.creditCents, s.todayKey);
    final tenure = fleetDriverTenure(
      index.assignmentsByDriver[driver.id] ?? const [],
      s.todayKey,
    );
    final code = fleetZelleAmountText(balance.owedCents, driver.personalCents);
    final timeline = fleetDriverTimeline(driver, index);
    final notes = [...?index.notesByDriver[driver.id]]
      ..sort((a, b) => b.atMs - a.atMs);
    final friends = [...?index.friendsByDriver[driver.id]]
      ..sort((a, b) => b.fromDayKey.compareTo(a.fromDayKey));
    final shownBills = [
      for (final b in bills)
        if (fleetBillInView(b, _billView)) b,
    ];
    final shownPayments = [
      for (final p in payments)
        if (fleetPaymentInView(p, _paymentView)) p,
    ];
    final admin = c.access.admin;
    final wa = s.settings;
    final waOn =
        wa.whatsappEnabled &&
        (wa.whatsappOnlyDriverIds.isEmpty ||
            wa.whatsappOnlyDriverIds.contains(driver.id));
    final tenureText = _tenureText(l10n, tenure.days);

    return ListView(
      padding: const EdgeInsets.all(AppSpacing.lg),
      children: [
        FleetCard(
          title: l10n.fltDriver,
          action: TextButton(
            key: const Key('fleet-driver-edit'),
            onPressed: () => showFleetSheet(
              context,
              (_) => FleetDriverFormSheet(controller: c, driver: driver),
            ),
            child: Text(l10n.fltEditDetails),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                driver.name,
                style: const TextStyle(
                  fontSize: 20,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                [
                  driver.phone,
                  if (driver.tlcLicense.isNotEmpty) 'TLC ${driver.tlcLicense}',
                  driver.addressLine,
                ].where((p) => p.isNotEmpty).join(' · '),
                style: const TextStyle(color: AppColors.muted),
              ),
              if (driver.notes.isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(
                  driver.notes,
                  style: const TextStyle(color: AppColors.muted),
                ),
              ],
              const SizedBox(height: AppSpacing.sm),
              FleetChip(
                label: driver.isActive
                    ? l10n.fltStatusActive
                    : l10n.fltStatusLeft,
                tone: driver.isActive ? FleetTone.ok : FleetTone.muted,
              ),
              const SizedBox(height: AppSpacing.lg),
              Wrap(
                spacing: AppSpacing.lg,
                runSpacing: AppSpacing.md,
                children: [
                  FleetFact(
                    label: l10n.fltFactJoined,
                    value: tenure.joinedDayKey.isEmpty
                        ? ''
                        : fleetDayLabel(tenure.joinedDayKey),
                  ),
                  FleetFact(label: l10n.fltFactWithCompany, value: tenureText),
                  FleetFact(label: l10n.fltFactPlate, value: car?.plate ?? ''),
                  FleetFact(
                    label: l10n.fltFactOwed,
                    value: fleetMoney(balance.owedCents),
                  ),
                  FleetFact(
                    label: l10n.fltFactLate,
                    value: fleetMoney(balance.lateCents),
                  ),
                  FleetFact(
                    label: l10n.fltFactCredit,
                    value: fleetMoney(balance.creditCents),
                  ),
                  FleetFact(
                    label: l10n.fltFactNextDue,
                    value: balance.hasNextDue
                        ? '${fleetDayLabel(balance.nextDueDayKey)} · '
                              '${fleetMoney(balance.nextDueCents)}'
                        : '',
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.md),
              Text(
                code == null
                    ? l10n.fltNoZelleCents
                    : l10n.fltZelleAmountFor(code),
                key: const Key('fleet-driver-zelle'),
                style: const TextStyle(color: AppColors.muted, fontSize: 13),
              ),
              const SizedBox(height: AppSpacing.lg),
              Wrap(
                spacing: AppSpacing.sm,
                runSpacing: AppSpacing.sm,
                children: [
                  FilledButton(
                    key: const Key('fleet-driver-pay'),
                    onPressed: () => showFleetSheet(
                      context,
                      (_) => FleetPaymentSheet(controller: c, driver: driver),
                    ),
                    child: Text(l10n.fltRecordPayment),
                  ),
                  OutlinedButton(
                    key: const Key('fleet-driver-charge'),
                    onPressed: () => showFleetSheet(
                      context,
                      (_) => FleetChargeSheet(controller: c, driver: driver),
                    ),
                    child: Text(l10n.fltAddCharge),
                  ),
                  if (driver.isActive && waOn)
                    OutlinedButton.icon(
                      key: const Key('fleet-driver-remind'),
                      onPressed: _reminding || balance.owedCents <= 0
                          ? null
                          : () => _remind(driver),
                      icon: _reminding
                          ? const SizedBox(
                              height: 16,
                              width: 16,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Icon(Icons.chat_outlined, size: 18),
                      label: Text(l10n.fltSendReminder),
                    ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.md),
        FleetCard(
          title: l10n.fltPlateCardTitle,
          child: current != null && car != null
              ? Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    InkWell(
                      key: const Key('fleet-driver-open-car'),
                      onTap: () => widget.onOpenCar(car.id),
                      child: Padding(
                        padding: const EdgeInsets.symmetric(vertical: 4),
                        child: Text(
                          car.plate,
                          style: const TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w800,
                            color: AppColors.cobalt,
                          ),
                        ),
                      ),
                    ),
                    Text(
                      [
                        car.company,
                        car.vehicleType,
                      ].where((p) => p.isNotEmpty).join(' · '),
                      style: const TextStyle(color: AppColors.muted),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      l10n.fltPlateSince(
                        fleetDayLabel(current.startDayKey),
                        fleetRentText(l10n, current.rentCents, current.period),
                        current.period == 'weekly'
                            ? _weekday(l10n, current.dueDay)
                            : '${current.dueDay}',
                      ),
                    ),
                    if (admin) ...[
                      const SizedBox(height: AppSpacing.md),
                      OutlinedButton(
                        key: const Key('fleet-driver-return'),
                        onPressed: () => showFleetSheet(
                          context,
                          (_) => FleetReturnCarSheet(
                            controller: c,
                            driver: driver,
                            assignment: current,
                          ),
                        ),
                        child: Text(l10n.fltPlateReturned),
                      ),
                    ],
                  ],
                )
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(l10n.fltNoPlateNow),
                    if (admin) ...[
                      const SizedBox(height: AppSpacing.md),
                      FilledButton(
                        key: const Key('fleet-driver-give'),
                        onPressed: () => showFleetSheet(
                          context,
                          (_) =>
                              FleetGiveCarSheet(controller: c, driver: driver),
                        ),
                        child: Text(l10n.fltGivePlate),
                      ),
                    ],
                  ],
                ),
        ),
        const SizedBox(height: AppSpacing.md),
        FleetCard(
          title: l10n.fltTrackRecord,
          child: timeline.isEmpty
              ? Text(l10n.fltTrackRecordEmpty)
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    for (final e in timeline.take(_timelineShown))
                      _TimelineLine(entry: e),
                    if (timeline.length > _timelineShown)
                      TextButton(
                        onPressed: () => setState(() => _timelineShown += 20),
                        child: Text(l10n.fltShowMore),
                      ),
                  ],
                ),
        ),
        const SizedBox(height: AppSpacing.md),
        FleetCard(
          title: l10n.fltNotesTitle,
          action: TextButton(
            key: const Key('fleet-note-add'),
            onPressed: () => showFleetSheet(
              context,
              (_) => FleetNoteSheet(controller: c, driver: driver),
            ),
            child: Text(l10n.fltAddNote),
          ),
          child: notes.isEmpty
              ? Text(l10n.fltNotesEmpty)
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    for (final n in notes)
                      Padding(
                        padding: const EdgeInsets.only(bottom: AppSpacing.md),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Expanded(
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    n.text.isEmpty
                                        ? l10n.fltNoteFilesOnly(n.files.length)
                                        : n.text,
                                    style: TextStyle(
                                      decoration: n.voided
                                          ? TextDecoration.lineThrough
                                          : null,
                                      color: n.voided ? AppColors.muted : null,
                                    ),
                                  ),
                                  Text(
                                    [
                                      if (n.atMs > 0)
                                        fleetDayLabel(fleetDayOfMs(n.atMs)),
                                      n.byName,
                                      if (n.voided) l10n.fltNoteRemoved,
                                    ].where((p) => p.isNotEmpty).join(' · '),
                                    style: const TextStyle(
                                      color: AppColors.muted,
                                      fontSize: 12,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                            if (admin && !n.voided)
                              IconButton(
                                key: Key('fleet-note-void-${n.id}'),
                                tooltip: l10n.fltRemove,
                                icon: const Icon(
                                  Icons.delete_outline,
                                  size: 20,
                                ),
                                onPressed: () => _voidNote(n),
                              ),
                          ],
                        ),
                      ),
                  ],
                ),
        ),
        const SizedBox(height: AppSpacing.md),
        FleetCard(
          title: l10n.fltFriendsTitle,
          action: TextButton(
            key: const Key('fleet-friend-add'),
            onPressed: () => showFleetSheet(
              context,
              (_) => FleetFriendSheet(controller: c, driver: driver),
            ),
            child: Text(l10n.fltAddFriend),
          ),
          child: friends.isEmpty
              ? Text(l10n.fltFriendsEmpty)
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    for (final f in friends)
                      Padding(
                        padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                        child: Row(
                          children: [
                            Expanded(
                              child: Text(
                                '${f.name} · ${fleetDayLabel(f.fromDayKey)}'
                                ' - ${fleetDayLabel(f.toDayKey)}'
                                '${f.voided ? ' · ${l10n.fltNoteRemoved}' : ''}',
                                style: TextStyle(
                                  decoration: f.voided
                                      ? TextDecoration.lineThrough
                                      : null,
                                  color: f.voided ? AppColors.muted : null,
                                ),
                              ),
                            ),
                            if (admin && !f.voided)
                              IconButton(
                                key: Key('fleet-friend-void-${f.id}'),
                                tooltip: l10n.fltRemove,
                                icon: const Icon(
                                  Icons.delete_outline,
                                  size: 20,
                                ),
                                onPressed: () => _voidFriend(f),
                              ),
                          ],
                        ),
                      ),
                  ],
                ),
        ),
        const SizedBox(height: AppSpacing.md),
        FleetCard(
          title: l10n.fltBillsTitle,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (bills.isNotEmpty)
                Wrap(
                  spacing: 6,
                  children: [
                    for (final (v, label) in [
                      (FleetBillView.open, l10n.fltBillsOpen),
                      (FleetBillView.paid, l10n.fltBillsPaid),
                      (FleetBillView.waived, l10n.fltBillsWaived),
                      (FleetBillView.all, l10n.fltBillsAll),
                    ])
                      FleetFilterChip(
                        label: label,
                        count: bills.where((b) => fleetBillInView(b, v)).length,
                        selected: _billView == v,
                        onSelected: () => setState(() {
                          _billView = v;
                          _billsShown = 20;
                        }),
                      ),
                  ],
                ),
              if (bills.isEmpty)
                Text(l10n.fltNoBillsYet)
              else if (shownBills.isEmpty)
                Text(l10n.fltNoBillInList)
              else ...[
                for (final b in shownBills.take(_billsShown))
                  _BillLine(
                    bill: b,
                    todayKey: s.todayKey,
                    onWaive: admin && b.isOpen
                        ? () => showFleetSheet(
                            context,
                            (_) => FleetWaiveSheet(controller: c, bill: b),
                          )
                        : null,
                  ),
                if (shownBills.length > _billsShown)
                  TextButton(
                    onPressed: () => setState(() => _billsShown += 20),
                    child: Text(l10n.fltShowMore),
                  ),
              ],
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.md),
        FleetCard(
          title: l10n.fltPaymentsTitle,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (payments.isNotEmpty)
                Wrap(
                  spacing: 6,
                  children: [
                    for (final (v, label) in [
                      (FleetPaymentView.all, l10n.fltBillsAll),
                      (FleetPaymentView.zelle, l10n.fltMethodZelle),
                      (FleetPaymentView.cash, l10n.fltMethodCash),
                      (FleetPaymentView.import, l10n.fltMethodImport),
                      (FleetPaymentView.other, l10n.fltMethodOther),
                    ])
                      if (v == FleetPaymentView.all ||
                          _paymentView == v ||
                          payments.any((p) => fleetPaymentInView(p, v)))
                        FleetFilterChip(
                          label: label,
                          count: payments
                              .where((p) => fleetPaymentInView(p, v))
                              .length,
                          selected: _paymentView == v,
                          onSelected: () => setState(() {
                            _paymentView = v;
                            _paymentsShown = 20;
                          }),
                        ),
                  ],
                ),
              if (payments.isEmpty)
                Text(l10n.fltNoPaymentsYet)
              else if (shownPayments.isEmpty)
                Text(l10n.fltNoPaymentInList)
              else ...[
                for (final p in shownPayments.take(_paymentsShown))
                  _PaymentLine(
                    payment: p,
                    onUndo: admin && p.isRecorded && !p.imported
                        ? () => _undo(p)
                        : null,
                  ),
                if (shownPayments.length > _paymentsShown)
                  TextButton(
                    onPressed: () => setState(() => _paymentsShown += 20),
                    child: Text(l10n.fltShowMore),
                  ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}

String _weekday(AppLocalizations l10n, int day) => [
  l10n.fltWeekdayMon,
  l10n.fltWeekdayTue,
  l10n.fltWeekdayWed,
  l10n.fltWeekdayThu,
  l10n.fltWeekdayFri,
  l10n.fltWeekdaySat,
  l10n.fltWeekdaySun,
][(day - 1).clamp(0, 6)];

String _tenureText(AppLocalizations l10n, int days) {
  if (days <= 0) return '';
  final p = fleetTenureParts(days);
  final parts = <String>[
    if (p.years > 0) l10n.fltTenureYears(p.years),
    if (p.months > 0) l10n.fltTenureMonths(p.months),
  ];
  if (parts.isEmpty) parts.add(l10n.fltTenureDays(p.days));
  return parts.join(' ');
}

class _TimelineLine extends StatelessWidget {
  const _TimelineLine({required this.entry});

  final FleetProfileEntry entry;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final e = entry;
    final text = switch (e.kind) {
      FleetProfileKind.joined => l10n.fltEntryJoined(e.plate),
      FleetProfileKind.carGiven => l10n.fltEntryCarGiven(
        e.plate,
        fleetRentText(l10n, e.rentCents, e.period),
      ),
      FleetProfileKind.carReturned => l10n.fltEntryCarReturned(e.plate),
      FleetProfileKind.rentChange => l10n.fltEntryRentChange(
        fleetMoney(e.fromRentCents),
        fleetMoney(e.rentCents),
      ),
      FleetProfileKind.leftBack => l10n.fltEntryLeftBack(
        fleetDayLabel(e.leftDayKey),
      ),
      FleetProfileKind.license => l10n.fltEntryLicense(e.license),
      FleetProfileKind.friend => l10n.fltEntryFriend(
        e.name,
        e.plate,
        fleetDayLabel(e.fromDayKey),
        fleetDayLabel(e.toDayKey),
      ),
      FleetProfileKind.lateFee => l10n.fltEntryLateFee(
        e.label,
        fleetMoney(e.amountCents),
      ),
      FleetProfileKind.charge => l10n.fltEntryCharge(
        e.label,
        fleetMoney(e.amountCents),
      ),
      FleetProfileKind.waived => l10n.fltEntryWaived(
        e.label,
        fleetMoney(e.amountCents),
        e.text,
      ),
      FleetProfileKind.note => l10n.fltEntryNote(e.text),
    };
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 92,
            child: Text(
              fleetDayLabel(e.dayKey),
              style: const TextStyle(color: AppColors.muted, fontSize: 12),
            ),
          ),
          Expanded(
            child: Text(
              text,
              style: TextStyle(
                decoration: e.voided ? TextDecoration.lineThrough : null,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _BillLine extends StatelessWidget {
  const _BillLine({
    required this.bill,
    required this.todayKey,
    required this.onWaive,
  });

  final FleetBill bill;
  final String todayKey;
  final VoidCallback? onWaive;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final late = bill.isOpen && bill.dueDayKey.compareTo(todayKey) < 0;
    final chip = bill.status == 'paid'
        ? FleetChip(label: l10n.fltBillPaid, tone: FleetTone.ok)
        : late
        ? FleetChip(label: l10n.fltBillLate, tone: FleetTone.bad)
        : bill.isOpen
        ? FleetChip(label: l10n.fltBillOpen, tone: FleetTone.warn)
        : FleetChip(
            label: bill.status == 'waived'
                ? l10n.fltBillWaived
                : l10n.fltBillVoid,
          );
    return Padding(
      padding: const EdgeInsets.only(top: AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  bill.label.isEmpty ? bill.kind : bill.label,
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
              ),
              Text(fleetMoney(bill.amountCents)),
            ],
          ),
          const SizedBox(height: 2),
          Wrap(
            spacing: 8,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(
                l10n.fltBillDue(fleetDayLabel(bill.dueDayKey)),
                style: const TextStyle(color: AppColors.muted, fontSize: 12),
              ),
              Text(
                l10n.fltBillPaidAmount(fleetMoney(bill.paidCents)),
                style: const TextStyle(color: AppColors.muted, fontSize: 12),
              ),
              chip,
              if (onWaive != null)
                TextButton(
                  key: Key('fleet-bill-waive-${bill.id}'),
                  style: TextButton.styleFrom(
                    visualDensity: VisualDensity.compact,
                  ),
                  onPressed: onWaive,
                  child: Text(l10n.fltWaiveAction),
                ),
            ],
          ),
          if (bill.status == 'waived' && bill.waivedReason.isNotEmpty)
            Text(
              bill.waivedReason,
              style: const TextStyle(color: AppColors.muted, fontSize: 12),
            ),
        ],
      ),
    );
  }
}

class _PaymentLine extends StatelessWidget {
  const _PaymentLine({required this.payment, required this.onUndo});

  final FleetPayment payment;
  final VoidCallback? onUndo;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final p = payment;
    final undone = p.status == 'undone';
    return Padding(
      key: Key('fleet-payment-line-${p.id}'),
      padding: const EdgeInsets.only(top: AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  fleetDayLabel(p.paidDayKey),
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
              ),
              Text(
                fleetMoney(p.amountCents),
                style: TextStyle(
                  fontWeight: FontWeight.w800,
                  decoration: undone ? TextDecoration.lineThrough : null,
                  color: undone ? AppColors.muted : null,
                ),
              ),
            ],
          ),
          Wrap(
            spacing: 8,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(
                fleetMethodText(l10n, p.shownMethod),
                style: const TextStyle(color: AppColors.muted, fontSize: 12),
              ),
              if (p.note.isNotEmpty)
                Text(
                  p.note,
                  style: const TextStyle(color: AppColors.muted, fontSize: 12),
                ),
              if (p.creditAddedCents > 0)
                Text(
                  l10n.fltPaymentToCredit(fleetMoney(p.creditAddedCents)),
                  style: const TextStyle(color: AppColors.muted, fontSize: 12),
                ),
              if (undone) FleetChip(label: l10n.fltPaymentUndoneChip),
              if (onUndo != null)
                TextButton(
                  key: Key('fleet-payment-undo-${p.id}'),
                  style: TextButton.styleFrom(
                    visualDensity: VisualDensity.compact,
                  ),
                  onPressed: onUndo,
                  child: Text(l10n.fltUndoAction),
                ),
            ],
          ),
        ],
      ),
    );
  }
}
