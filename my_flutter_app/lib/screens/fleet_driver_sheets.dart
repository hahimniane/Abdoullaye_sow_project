import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/fleet.dart';
import '../services/fleet_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../widgets/fleet_widgets.dart';

// The sheets of a driver's page and of the Drivers list (docs/FLEET.md
// section 6): add or edit a driver, record a payment, add a charge, give a
// plate, take it back, waive a bill, add a note, add a friend who drove.
// Each reports a refusal in words inside the sheet and pops true when saved.

// ---------------------------------------------------------------------------
// Add / edit a driver.
// ---------------------------------------------------------------------------

class FleetDriverFormSheet extends StatefulWidget {
  const FleetDriverFormSheet({
    super.key,
    required this.controller,
    this.driver,
  });

  final FleetController controller;

  /// Null adds a driver.
  final FleetDriver? driver;

  @override
  State<FleetDriverFormSheet> createState() => _FleetDriverFormSheetState();
}

class _FleetDriverFormSheetState extends State<FleetDriverFormSheet>
    with FleetRun {
  late final _name = TextEditingController(text: widget.driver?.name);
  late final _phone = TextEditingController(text: widget.driver?.phone);
  late final _tlc = TextEditingController(text: widget.driver?.tlcLicense);
  late final _line1 = TextEditingController(text: widget.driver?.line1);
  late final _city = TextEditingController(text: widget.driver?.city);
  late final _state = TextEditingController(text: widget.driver?.state);
  late final _zip = TextEditingController(text: widget.driver?.zip);
  late final _notes = TextEditingController(text: widget.driver?.notes);
  late String _status = widget.driver?.status ?? 'active';

  @override
  void dispose() {
    for (final c in [
      _name,
      _phone,
      _tlc,
      _line1,
      _city,
      _state,
      _zip,
      _notes,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    final l10n = AppLocalizations.of(context)!;
    if (_name.text.trim().isEmpty) {
      setState(() => error = l10n.fltRefusalBadInput);
      return;
    }
    final c = widget.controller;
    final answer = await runFleet(
      c.service,
      FleetRequests.driverSave(
        c.businessId,
        driverId: widget.driver?.id ?? '',
        name: _name.text.trim(),
        phone: _phone.text.trim(),
        tlcLicense: _tlc.text.trim(),
        line1: _line1.text.trim(),
        city: _city.text.trim(),
        state: _state.text.trim(),
        zip: _zip.text.trim(),
        notes: _notes.text.trim(),
        status: widget.driver == null ? null : _status,
      ),
    );
    if (answer != null && mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return FleetSheetFrame(
      title: widget.driver == null ? l10n.fltAddDriver : l10n.fltEditDriver,
      actionLabel: l10n.fltSaveDriver,
      busy: busy,
      error: error,
      onSubmit: _save,
      children: [
        FleetField(
          controller: _name,
          label: l10n.fltFieldFullName,
          maxLength: 120,
          enabled: !busy,
        ),
        FleetField(
          controller: _phone,
          label: l10n.fltFieldPhone,
          keyboard: TextInputType.phone,
          enabled: !busy,
        ),
        FleetField(
          controller: _tlc,
          label: l10n.fltFieldTlc,
          maxLength: 20,
          enabled: !busy,
        ),
        FleetField(
          controller: _line1,
          label: l10n.fltFieldStreet,
          maxLength: 160,
          enabled: !busy,
        ),
        FleetField(
          controller: _city,
          label: l10n.fltFieldCity,
          maxLength: 80,
          enabled: !busy,
        ),
        FleetField(
          controller: _state,
          label: l10n.fltFieldState,
          maxLength: 40,
          enabled: !busy,
        ),
        FleetField(
          controller: _zip,
          label: l10n.fltFieldZip,
          maxLength: 12,
          enabled: !busy,
        ),
        if (widget.driver != null)
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.md),
            child: SegmentedButton<String>(
              key: const Key('fleet-driver-status'),
              showSelectedIcon: false,
              segments: [
                ButtonSegment(
                  value: 'active',
                  label: Text(l10n.fltStatusActive),
                ),
                ButtonSegment(value: 'left', label: Text(l10n.fltStatusLeft)),
              ],
              selected: {_status},
              onSelectionChanged: busy
                  ? null
                  : (v) => setState(() => _status = v.first),
            ),
          ),
        FleetField(
          controller: _notes,
          label: l10n.fltFieldNotes,
          maxLength: 1000,
          maxLines: 3,
          enabled: !busy,
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Record a payment.
// ---------------------------------------------------------------------------

class FleetPaymentSheet extends StatefulWidget {
  const FleetPaymentSheet({
    super.key,
    required this.controller,
    required this.driver,
  });

  final FleetController controller;
  final FleetDriver driver;

  @override
  State<FleetPaymentSheet> createState() => _FleetPaymentSheetState();
}

class _FleetPaymentSheetState extends State<FleetPaymentSheet> with FleetRun {
  final _amount = TextEditingController();
  final _note = TextEditingController();
  String _method = 'zelle';
  late String _day = widget.controller.state.todayKey;
  int? _credit;

  @override
  void dispose() {
    _amount.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final l10n = AppLocalizations.of(context)!;
    final cents = fleetDollarsToCents(_amount.text);
    if (cents == null || cents <= 0) {
      setState(() => error = l10n.fltRefusalNoAmount);
      return;
    }
    final c = widget.controller;
    final answer = await runFleet(
      c.service,
      FleetRequests.paymentRecord(
        c.businessId,
        driverId: widget.driver.id,
        amountCents: cents,
        method: _method,
        paidDayKey: _day,
        note: _note.text.trim(),
      ),
    );
    if (answer != null && mounted) {
      final credit = answer['creditAddedCents'];
      setState(() => _credit = credit is num ? credit.round() : 0);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    if (_credit != null) {
      return FleetSheetFrame(
        title: l10n.fltPaymentRecorded,
        subtitle: widget.driver.name,
        actionLabel: l10n.fltClose,
        busy: false,
        submitKey: const Key('fleet-payment-done'),
        onSubmit: () => Navigator.of(context).pop(true),
        children: [
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.lg),
            child: Text(
              _credit! > 0
                  ? l10n.fltPaymentWentToCredit(fleetMoney(_credit!))
                  : l10n.fltPaymentSpread,
              key: const Key('fleet-payment-result'),
            ),
          ),
        ],
      );
    }
    return FleetSheetFrame(
      title: l10n.fltRecordPayment,
      subtitle: widget.driver.name,
      actionLabel: l10n.fltRecordPaymentAction,
      busy: busy,
      error: error,
      onSubmit: _save,
      submitKey: const Key('fleet-payment-submit'),
      children: [
        FleetField(
          controller: _amount,
          label: l10n.fltFieldAmount,
          keyboard: const TextInputType.numberWithOptions(decimal: true),
          enabled: !busy,
          hint: '0.00',
        ),
        Padding(
          padding: const EdgeInsets.only(bottom: AppSpacing.md),
          child: SegmentedButton<String>(
            key: const Key('fleet-payment-method'),
            showSelectedIcon: false,
            segments: [
              ButtonSegment(value: 'zelle', label: Text(l10n.fltMethodZelle)),
              ButtonSegment(value: 'cash', label: Text(l10n.fltMethodCash)),
              ButtonSegment(value: 'other', label: Text(l10n.fltMethodOther)),
            ],
            selected: {_method},
            onSelectionChanged: busy
                ? null
                : (v) => setState(() => _method = v.first),
          ),
        ),
        FleetDayField(
          label: l10n.fltFieldPaidOn,
          value: _day,
          enabled: !busy,
          onChanged: (d) => setState(() => _day = d),
        ),
        FleetField(
          controller: _note,
          label: l10n.fltFieldNote,
          maxLength: 300,
          enabled: !busy,
        ),
        Padding(
          padding: const EdgeInsets.only(bottom: AppSpacing.md),
          child: Text(
            l10n.fltPaymentHint,
            style: const TextStyle(color: AppColors.muted, fontSize: 13),
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Add a charge.
// ---------------------------------------------------------------------------

class FleetChargeSheet extends StatefulWidget {
  const FleetChargeSheet({
    super.key,
    required this.controller,
    required this.driver,
  });

  final FleetController controller;
  final FleetDriver driver;

  @override
  State<FleetChargeSheet> createState() => _FleetChargeSheetState();
}

class _FleetChargeSheetState extends State<FleetChargeSheet> with FleetRun {
  final _label = TextEditingController();
  final _amount = TextEditingController();
  late String _due = widget.controller.state.todayKey;

  @override
  void dispose() {
    _label.dispose();
    _amount.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final l10n = AppLocalizations.of(context)!;
    final cents = fleetDollarsToCents(_amount.text);
    if (cents == null || cents <= 0 || _label.text.trim().isEmpty) {
      setState(() => error = l10n.fltRefusalBadInput);
      return;
    }
    final c = widget.controller;
    final answer = await runFleet(
      c.service,
      FleetRequests.chargeAdd(
        c.businessId,
        driverId: widget.driver.id,
        amountCents: cents,
        label: _label.text.trim(),
        dueDayKey: _due,
      ),
    );
    if (answer != null && mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return FleetSheetFrame(
      title: l10n.fltAddCharge,
      subtitle: widget.driver.name,
      actionLabel: l10n.fltAddChargeAction,
      busy: busy,
      error: error,
      onSubmit: _save,
      submitKey: const Key('fleet-charge-submit'),
      children: [
        FleetField(
          controller: _label,
          label: l10n.fltFieldWhatFor,
          maxLength: 120,
          enabled: !busy,
        ),
        FleetField(
          controller: _amount,
          label: l10n.fltFieldAmount,
          keyboard: const TextInputType.numberWithOptions(decimal: true),
          enabled: !busy,
        ),
        FleetDayField(
          label: l10n.fltFieldDueOn,
          value: _due,
          enabled: !busy,
          onChanged: (d) => setState(() => _due = d),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Give a plate / plate returned.
// ---------------------------------------------------------------------------

class FleetGiveCarSheet extends StatefulWidget {
  const FleetGiveCarSheet({
    super.key,
    required this.controller,
    required this.driver,
  });

  final FleetController controller;
  final FleetDriver driver;

  @override
  State<FleetGiveCarSheet> createState() => _FleetGiveCarSheetState();
}

class _FleetGiveCarSheetState extends State<FleetGiveCarSheet> with FleetRun {
  late final List<FleetCar> _free = fleetFreeCars(
    widget.controller.state.data,
    widget.controller.state.index,
  );
  final _rent = TextEditingController();
  String _carId = '';
  late String _start = widget.controller.state.todayKey;
  String _period = 'monthly';
  int _dueDay = 1;

  @override
  void dispose() {
    _rent.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final l10n = AppLocalizations.of(context)!;
    final cents = fleetDollarsToCents(_rent.text);
    if (_carId.isEmpty || cents == null || cents <= 0 || _start.isEmpty) {
      setState(() => error = l10n.fltRefusalBadInput);
      return;
    }
    final c = widget.controller;
    final answer = await runFleet(
      c.service,
      FleetRequests.assignmentStart(
        c.businessId,
        driverId: widget.driver.id,
        carId: _carId,
        startDayKey: _start,
        rentCents: cents,
        period: _period,
        dueDay: _dueDay,
      ),
    );
    if (answer != null && mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final weekly = _period == 'weekly';
    final dayNames = [
      l10n.fltWeekdayMon,
      l10n.fltWeekdayTue,
      l10n.fltWeekdayWed,
      l10n.fltWeekdayThu,
      l10n.fltWeekdayFri,
      l10n.fltWeekdaySat,
      l10n.fltWeekdaySun,
    ];
    return FleetSheetFrame(
      title: l10n.fltGivePlate,
      subtitle: widget.driver.name,
      actionLabel: l10n.fltGivePlateAction,
      busy: busy,
      error: error,
      onSubmit: _free.isEmpty ? null : _save,
      submitKey: const Key('fleet-give-submit'),
      children: [
        if (_free.isEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.md),
            child: Text(l10n.fltNoFreePlates),
          ),
        Padding(
          padding: const EdgeInsets.only(bottom: AppSpacing.md),
          child: DropdownButtonFormField<String>(
            key: const Key('fleet-give-plate'),
            isExpanded: true,
            initialValue: _carId.isEmpty ? null : _carId,
            decoration: InputDecoration(
              labelText: l10n.fltFieldPlate,
              isDense: true,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
              ),
            ),
            items: [
              for (final car in _free)
                DropdownMenuItem(
                  value: car.id,
                  child: Text(
                    [
                      car.plate,
                      car.company,
                      car.vehicleType,
                    ].where((p) => p.isNotEmpty).join(' · '),
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
            ],
            onChanged: busy ? null : (v) => setState(() => _carId = v ?? ''),
          ),
        ),
        FleetDayField(
          label: l10n.fltFieldStartDay,
          value: _start,
          enabled: !busy,
          onChanged: (d) => setState(() => _start = d),
        ),
        FleetField(
          controller: _rent,
          label: l10n.fltFieldRent,
          keyboard: const TextInputType.numberWithOptions(decimal: true),
          enabled: !busy,
        ),
        Padding(
          padding: const EdgeInsets.only(bottom: AppSpacing.md),
          child: SegmentedButton<String>(
            key: const Key('fleet-give-period'),
            showSelectedIcon: false,
            segments: [
              ButtonSegment(
                value: 'monthly',
                label: Text(l10n.fltPeriodMonthly),
              ),
              ButtonSegment(value: 'weekly', label: Text(l10n.fltPeriodWeekly)),
            ],
            selected: {_period},
            onSelectionChanged: busy
                ? null
                : (v) => setState(() {
                    _period = v.first;
                    _dueDay = 1;
                  }),
          ),
        ),
        Padding(
          padding: const EdgeInsets.only(bottom: AppSpacing.md),
          child: DropdownButtonFormField<int>(
            key: ValueKey('fleet-give-dueday-$_period'),
            isExpanded: true,
            initialValue: _dueDay,
            decoration: InputDecoration(
              labelText: weekly ? l10n.fltFieldDueWeekday : l10n.fltFieldDueDay,
              isDense: true,
              border: OutlineInputBorder(
                borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
              ),
            ),
            items: [
              for (var d = 1; d <= (weekly ? 7 : 28); d++)
                DropdownMenuItem(
                  value: d,
                  child: Text(weekly ? dayNames[d - 1] : '$d'),
                ),
            ],
            onChanged: busy ? null : (v) => setState(() => _dueDay = v ?? 1),
          ),
        ),
      ],
    );
  }
}

class FleetReturnCarSheet extends StatefulWidget {
  const FleetReturnCarSheet({
    super.key,
    required this.controller,
    required this.driver,
    required this.assignment,
  });

  final FleetController controller;
  final FleetDriver driver;
  final FleetAssignment assignment;

  @override
  State<FleetReturnCarSheet> createState() => _FleetReturnCarSheetState();
}

class _FleetReturnCarSheetState extends State<FleetReturnCarSheet>
    with FleetRun {
  late String _end = widget.controller.state.todayKey;

  Future<void> _save() async {
    final c = widget.controller;
    final answer = await runFleet(
      c.service,
      FleetRequests.assignmentEnd(
        c.businessId,
        assignmentId: widget.assignment.id,
        endDayKey: _end,
      ),
    );
    if (answer != null && mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final rule = widget.controller.state.settings.returnRule;
    return FleetSheetFrame(
      title: l10n.fltPlateReturned,
      subtitle: widget.driver.name,
      actionLabel: l10n.fltPlateReturnedAction,
      busy: busy,
      error: error,
      onSubmit: _save,
      submitKey: const Key('fleet-return-submit'),
      children: [
        FleetDayField(
          label: l10n.fltFieldReturnedOn,
          value: _end,
          enabled: !busy,
          first: DateTime.tryParse(widget.assignment.startDayKey),
          onChanged: (d) => setState(() => _end = d),
        ),
        Padding(
          padding: const EdgeInsets.only(bottom: AppSpacing.md),
          child: Text(
            rule == 'days' ? l10n.fltReturnRuleDays : l10n.fltReturnRuleFull,
            style: const TextStyle(color: AppColors.muted, fontSize: 13),
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Waive a bill.
// ---------------------------------------------------------------------------

class FleetWaiveSheet extends StatefulWidget {
  const FleetWaiveSheet({
    super.key,
    required this.controller,
    required this.bill,
  });

  final FleetController controller;
  final FleetBill bill;

  @override
  State<FleetWaiveSheet> createState() => _FleetWaiveSheetState();
}

class _FleetWaiveSheetState extends State<FleetWaiveSheet> with FleetRun {
  final _reason = TextEditingController();

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final l10n = AppLocalizations.of(context)!;
    if (_reason.text.trim().isEmpty) {
      setState(() => error = l10n.fltRefusalReasonRequired);
      return;
    }
    final c = widget.controller;
    final answer = await runFleet(
      c.service,
      FleetRequests.billWaive(
        c.businessId,
        billId: widget.bill.id,
        reason: _reason.text.trim(),
      ),
    );
    if (answer != null && mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return FleetSheetFrame(
      title: l10n.fltWaiveTitle,
      subtitle:
          '${widget.bill.label.isEmpty ? widget.bill.kind : widget.bill.label}'
          ' · ${fleetMoney(widget.bill.remainingCents)}',
      actionLabel: l10n.fltWaiveAction,
      busy: busy,
      error: error,
      destructive: true,
      onSubmit: _save,
      submitKey: const Key('fleet-waive-submit'),
      children: [
        FleetField(
          controller: _reason,
          label: l10n.fltFieldReason,
          maxLength: 300,
          maxLines: 2,
          enabled: !busy,
        ),
        Padding(
          padding: const EdgeInsets.only(bottom: AppSpacing.md),
          child: Text(
            l10n.fltWaiveHint,
            style: const TextStyle(color: AppColors.muted, fontSize: 13),
          ),
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// An office note, and a friend who drove.
// ---------------------------------------------------------------------------

class FleetNoteSheet extends StatefulWidget {
  const FleetNoteSheet({
    super.key,
    required this.controller,
    required this.driver,
  });

  final FleetController controller;
  final FleetDriver driver;

  @override
  State<FleetNoteSheet> createState() => _FleetNoteSheetState();
}

class _FleetNoteSheetState extends State<FleetNoteSheet> with FleetRun {
  final _text = TextEditingController();

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final l10n = AppLocalizations.of(context)!;
    if (_text.text.trim().isEmpty) {
      setState(() => error = l10n.fltRefusalNoteEmpty);
      return;
    }
    final c = widget.controller;
    final answer = await runFleet(
      c.service,
      FleetRequests.noteAdd(
        c.businessId,
        driverId: widget.driver.id,
        text: _text.text.trim(),
      ),
    );
    if (answer != null && mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return FleetSheetFrame(
      title: l10n.fltAddNote,
      subtitle: widget.driver.name,
      actionLabel: l10n.fltSaveNote,
      busy: busy,
      error: error,
      onSubmit: _save,
      submitKey: const Key('fleet-note-submit'),
      children: [
        FleetField(
          controller: _text,
          label: l10n.fltFieldNote,
          maxLength: 2000,
          maxLines: 4,
          enabled: !busy,
        ),
        Padding(
          padding: const EdgeInsets.only(bottom: AppSpacing.md),
          child: Text(
            l10n.fltNoteNoFilesHint,
            style: const TextStyle(color: AppColors.muted, fontSize: 13),
          ),
        ),
      ],
    );
  }
}

class FleetFriendSheet extends StatefulWidget {
  const FleetFriendSheet({
    super.key,
    required this.controller,
    required this.driver,
  });

  final FleetController controller;
  final FleetDriver driver;

  @override
  State<FleetFriendSheet> createState() => _FleetFriendSheetState();
}

class _FleetFriendSheetState extends State<FleetFriendSheet> with FleetRun {
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _tlc = TextEditingController();
  late String _from = widget.controller.state.todayKey;
  late String _to = widget.controller.state.todayKey;

  @override
  void dispose() {
    _name.dispose();
    _phone.dispose();
    _tlc.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final l10n = AppLocalizations.of(context)!;
    if (_name.text.trim().isEmpty || _to.compareTo(_from) < 0) {
      setState(() => error = l10n.fltRefusalBadInput);
      return;
    }
    final c = widget.controller;
    final answer = await runFleet(
      c.service,
      FleetRequests.substituteSave(
        c.businessId,
        driverId: widget.driver.id,
        name: _name.text.trim(),
        phone: _phone.text.trim(),
        tlcLicense: _tlc.text.trim(),
        fromDayKey: _from,
        toDayKey: _to,
      ),
    );
    if (answer != null && mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return FleetSheetFrame(
      title: l10n.fltAddFriend,
      subtitle: widget.driver.name,
      actionLabel: l10n.fltSaveFriend,
      busy: busy,
      error: error,
      onSubmit: _save,
      submitKey: const Key('fleet-friend-submit'),
      children: [
        FleetField(
          controller: _name,
          label: l10n.fltFieldFullName,
          maxLength: 120,
          enabled: !busy,
        ),
        FleetField(
          controller: _phone,
          label: l10n.fltFieldPhone,
          keyboard: TextInputType.phone,
          enabled: !busy,
        ),
        FleetField(
          controller: _tlc,
          label: l10n.fltFieldTlc,
          maxLength: 20,
          enabled: !busy,
        ),
        FleetDayField(
          label: l10n.fltFieldFromDay,
          value: _from,
          enabled: !busy,
          onChanged: (d) => setState(() => _from = d),
        ),
        FleetDayField(
          label: l10n.fltFieldToDay,
          value: _to,
          enabled: !busy,
          onChanged: (d) => setState(() => _to = d),
        ),
      ],
    );
  }
}
