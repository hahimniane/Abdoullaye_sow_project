import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/fleet.dart';
import '../services/fleet_pickers.dart';
import '../services/fleet_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../widgets/fleet_pickers.dart';
import '../widgets/fleet_widgets.dart';

/// A plate's page (docs/FLEET.md section 6): its papers, the car on it, the
/// cars it was on before, and who had it when (friends who drove included).
class FleetCarScreen extends StatelessWidget {
  const FleetCarScreen({
    super.key,
    required this.controller,
    required this.carId,
    required this.onOpenDriver,
  });

  final FleetController controller;
  final String carId;
  final ValueChanged<String> onOpenDriver;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return ListenableBuilder(
      listenable: controller,
      builder: (context, _) {
        final s = controller.state;
        final car = s.index.carById[carId];
        return Scaffold(
          backgroundColor: AppColors.cream,
          appBar: AppBar(title: Text(car?.plate ?? l10n.fltPlate)),
          body: car == null
              ? Center(
                  child: Text(
                    s.loading ? '' : l10n.fltRefusalNotFound,
                    key: const Key('fleet-car-missing'),
                  ),
                )
              : _body(context, l10n, s, car),
        );
      },
    );
  }

  Widget _body(
    BuildContext context,
    AppLocalizations l10n,
    FleetState s,
    FleetCar car,
  ) {
    final timeline = fleetCarTimeline(car.id, s.index);
    final plateCars = fleetPlateCarHistory(car);
    final reg = fleetExpiryState(car.registrationExpiry, s.todayKey);
    final dia = fleetExpiryState(car.diamondExpiry, s.todayKey);
    return ListView(
      padding: const EdgeInsets.all(AppSpacing.lg),
      children: [
        FleetCard(
          title: l10n.fltPlate,
          action: TextButton(
            key: const Key('fleet-car-edit'),
            onPressed: () => showFleetSheet(
              context,
              (_) => FleetCarFormSheet(controller: controller, car: car),
            ),
            child: Text(l10n.fltEditDetails),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                car.plate,
                style: const TextStyle(
                  fontSize: 22,
                  fontWeight: FontWeight.w800,
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              _PaperLine(
                label: l10n.fltRegistrationExpires,
                dayKey: car.registrationExpiry,
                state: reg,
              ),
              const SizedBox(height: AppSpacing.sm),
              _PaperLine(
                label: l10n.fltDiamondExpires,
                dayKey: car.diamondExpiry,
                state: dia,
              ),
              const SizedBox(height: AppSpacing.lg),
              Wrap(
                spacing: AppSpacing.lg,
                runSpacing: AppSpacing.md,
                children: [
                  FleetFact(label: l10n.fltFieldCompany, value: car.company),
                  FleetFact(
                    label: l10n.fltFieldCarOnPlate,
                    value: car.vehicleType,
                  ),
                  FleetFact(label: l10n.fltFieldVin, value: car.vin),
                  FleetFact(label: l10n.fltFieldInsurer, value: car.insurer),
                  FleetFact(
                    label: l10n.fltFieldPolicy,
                    value: car.policyNumber,
                  ),
                  FleetFact(
                    label: l10n.fltFieldPremium,
                    value: car.premiumCents > 0
                        ? fleetMoney(car.premiumCents)
                        : '',
                  ),
                  FleetFact(
                    label: l10n.fltFieldInsuranceDueDay,
                    value: car.insuranceDueDay > 0
                        ? '${car.insuranceDueDay}'
                        : '',
                  ),
                  FleetFact(
                    label: l10n.fltFieldInsurancePaidBy,
                    value: car.insurancePaidBy,
                  ),
                  FleetFact(
                    label: l10n.fltFieldAutopay,
                    value: car.insuranceAutopay ? l10n.fltYes : l10n.fltNo,
                  ),
                  FleetFact(
                    label: l10n.fltFieldOwnership,
                    value: car.ownership == 'driver'
                        ? l10n.fltOwnerDriver
                        : l10n.fltOwnerCompany,
                  ),
                ],
              ),
            ],
          ),
        ),
        if (plateCars.length > 1) ...[
          const SizedBox(height: AppSpacing.md),
          FleetCard(
            title: l10n.fltCarsOnPlate,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final p in plateCars)
                  Padding(
                    padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                    child: Text(
                      [
                        [
                          p.vehicleType,
                          p.vin,
                        ].where((t) => t.isNotEmpty).join(' · '),
                        p.toDayKey.isEmpty
                            ? l10n.fltCarNow
                            : l10n.fltCarUntil(fleetDayLabel(p.toDayKey)),
                        p.ownership == 'driver'
                            ? l10n.fltOwnerDriver
                            : l10n.fltOwnerCompany,
                      ].join(' · '),
                    ),
                  ),
              ],
            ),
          ),
        ],
        const SizedBox(height: AppSpacing.md),
        FleetCard(
          title: l10n.fltWhoHadIt,
          child: timeline.isEmpty
              ? Text(l10n.fltNobodyHadIt)
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    for (final e in timeline)
                      Padding(
                        padding: const EdgeInsets.only(bottom: AppSpacing.md),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            InkWell(
                              key: Key('fleet-car-driver-${e.id}'),
                              onTap: () => onOpenDriver(e.driverId),
                              child: Padding(
                                padding: const EdgeInsets.symmetric(
                                  vertical: 2,
                                ),
                                child: Text(
                                  e.driverName.isEmpty ? '—' : e.driverName,
                                  style: const TextStyle(
                                    fontWeight: FontWeight.w800,
                                    color: AppColors.cobalt,
                                  ),
                                ),
                              ),
                            ),
                            Text(
                              '${fleetDayLabel(e.startDayKey)} - '
                              '${e.endDayKey.isEmpty ? l10n.fltCarNow : fleetDayLabel(e.endDayKey)}'
                              ' · ${fleetRentText(l10n, e.rentCents, e.period)}',
                              style: const TextStyle(color: AppColors.muted),
                            ),
                            for (final f in e.friends)
                              Text(
                                l10n.fltFriendDrove(
                                  f.name,
                                  fleetDayLabel(f.fromDayKey),
                                  fleetDayLabel(f.toDayKey),
                                ),
                                style: const TextStyle(
                                  color: AppColors.muted,
                                  fontSize: 12,
                                ),
                              ),
                          ],
                        ),
                      ),
                  ],
                ),
        ),
      ],
    );
  }
}

class _PaperLine extends StatelessWidget {
  const _PaperLine({
    required this.label,
    required this.dayKey,
    required this.state,
  });

  final String label, dayKey;
  final FleetExpiry state;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 8,
      runSpacing: 4,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        Text(label, style: const TextStyle(color: AppColors.muted)),
        Text(
          dayKey.isEmpty ? '—' : fleetDayLabel(dayKey),
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        FleetExpiryChip(state: state),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Add / edit a plate.
// ---------------------------------------------------------------------------

class FleetCarFormSheet extends StatefulWidget {
  const FleetCarFormSheet({super.key, required this.controller, this.car});

  final FleetController controller;

  /// Null adds a plate.
  final FleetCar? car;

  @override
  State<FleetCarFormSheet> createState() => _FleetCarFormSheetState();
}

class _FleetCarFormSheetState extends State<FleetCarFormSheet> with FleetRun {
  late final _plate = TextEditingController(text: widget.car?.plate);
  late String _company = widget.car?.company ?? '';
  late final _type = TextEditingController(text: widget.car?.vehicleType);
  late final _vin = TextEditingController(text: widget.car?.vin);
  late String _insurer = widget.car?.insurer ?? '';
  late final _policy = TextEditingController(text: widget.car?.policyNumber);
  late final _premium = TextEditingController(
    text: fleetCentsToInput(widget.car?.premiumCents),
  );
  late int? _dueDay = (widget.car?.insuranceDueDay ?? 0) > 0
      ? widget.car!.insuranceDueDay
      : null;
  late String _paidBy = widget.car?.insurancePaidBy ?? '';
  late String _registration = widget.car?.registrationExpiry ?? '';
  late String _diamond = widget.car?.diamondExpiry ?? '';
  late bool _autopay = widget.car?.insuranceAutopay ?? false;
  // A new plate: the car on it is usually the driver's own.
  late String _ownership = widget.car == null
      ? 'driver'
      : widget.car!.ownership;
  // Editing the car on a plate: a different car, or a typo being fixed?
  String _change = '';
  String _movedSince = '';

  @override
  void dispose() {
    for (final c in [_plate, _type, _vin, _policy, _premium]) {
      c.dispose();
    }
    super.dispose();
  }

  /// The values this business already saved on its plates for one field.
  List<String> _known(String Function(FleetCar car) pick) =>
      fleetKnownValues(widget.controller.state.data.cars.map(pick));

  bool get _carEdited {
    final car = widget.car;
    if (car == null) return false;
    final had = car.vin.isNotEmpty || car.vehicleType.isNotEmpty;
    return had &&
        (_vin.text.trim().toUpperCase() != car.vin.toUpperCase() ||
            _type.text.trim() != car.vehicleType);
  }

  Future<void> _save() async {
    final l10n = AppLocalizations.of(context)!;
    final premium = _premium.text.trim().isEmpty
        ? 0
        : fleetDollarsToCents(_premium.text);
    if (_plate.text.trim().isEmpty || premium == null) {
      setState(() => error = l10n.fltRefusalBadInput);
      return;
    }
    if (_carEdited && _change.isEmpty) {
      setState(() => error = l10n.fltCarChangeAsk);
      return;
    }
    final c = widget.controller;
    final answer = await runFleet(
      c.service,
      FleetRequests.carSave(
        c.businessId,
        carId: widget.car?.id ?? '',
        plate: _plate.text.trim(),
        company: _company,
        vehicleType: _type.text.trim(),
        vin: _vin.text.trim(),
        registrationExpiry: _registration,
        diamondExpiry: _diamond,
        insurer: _insurer,
        policyNumber: _policy.text.trim(),
        premiumCents: premium,
        insuranceDueDay: _dueDay,
        insuranceAutopay: _autopay,
        insurancePaidBy: _paidBy,
        ownership: _ownership,
        plateMoved: _carEdited && _change == 'moved',
        movedSinceDayKey: _movedSince,
      ),
    );
    if (answer != null && mounted) Navigator.of(context).pop(true);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return FleetSheetFrame(
      title: widget.car == null ? l10n.fltAddPlate : l10n.fltEditPlate,
      actionLabel: l10n.fltSavePlate,
      busy: busy,
      error: error,
      onSubmit: _save,
      submitKey: const Key('fleet-car-submit'),
      children: [
        FleetField(
          controller: _plate,
          label: l10n.fltFieldPlate,
          maxLength: 12,
          enabled: !busy,
        ),
        FleetPickOrAdd(
          key: const Key('fleet-car-company'),
          label: l10n.fltFieldCompany,
          value: _company,
          known: _known((c) => c.company),
          addLabel: l10n.fltPickAddCompany,
          enabled: !busy,
          onChanged: (v) => _company = v,
        ),
        FleetField(
          controller: _vin,
          label: l10n.fltFieldVin,
          maxLength: 17,
          enabled: !busy,
        ),
        FleetPlateCarFields(
          key: const Key('fleet-car-type'),
          vinController: _vin,
          vehicleType: widget.car?.vehicleType ?? '',
          enabled: !busy,
          onVehicleType: (v) => _type.text = v,
        ),
        FleetDayField(
          label: l10n.fltRegistrationExpires,
          value: _registration,
          enabled: !busy,
          allowClear: true,
          onChanged: (d) => setState(() => _registration = d),
        ),
        FleetDayField(
          label: l10n.fltDiamondExpires,
          value: _diamond,
          enabled: !busy,
          allowClear: true,
          onChanged: (d) => setState(() => _diamond = d),
        ),
        FleetPickOrAdd(
          key: const Key('fleet-car-insurer'),
          label: l10n.fltFieldInsurer,
          value: _insurer,
          known: _known((c) => c.insurer),
          addLabel: l10n.fltPickAddInsurer,
          enabled: !busy,
          onChanged: (v) => _insurer = v,
        ),
        FleetField(
          controller: _policy,
          label: l10n.fltFieldPolicy,
          maxLength: 40,
          enabled: !busy,
        ),
        FleetField(
          controller: _premium,
          label: l10n.fltFieldPremium,
          keyboard: const TextInputType.numberWithOptions(decimal: true),
          enabled: !busy,
        ),
        FleetDueDayField(
          key: const Key('fleet-car-dueday'),
          label: l10n.fltFieldInsuranceDueDay,
          value: _dueDay,
          emptyLabel: l10n.fltPickNotSet,
          enabled: !busy,
          onChanged: (d) => setState(() => _dueDay = d),
        ),
        FleetPickOrAdd(
          key: const Key('fleet-car-paidby'),
          label: l10n.fltFieldInsurancePaidBy,
          value: _paidBy,
          known: _known((c) => c.insurancePaidBy),
          fixed: [
            FleetFixedChoice(fleetPayerCompany, l10n.fltOwnerCompany),
            FleetFixedChoice(fleetPayerDriver, l10n.fltOwnerDriver),
          ],
          addLabel: l10n.fltPickAddSomeone,
          enabled: !busy,
          onChanged: (v) => _paidBy = v,
        ),
        SwitchListTile(
          key: const Key('fleet-car-autopay'),
          contentPadding: EdgeInsets.zero,
          title: Text(l10n.fltAutopayOn),
          value: _autopay,
          onChanged: busy ? null : (v) => setState(() => _autopay = v),
        ),
        Padding(
          padding: const EdgeInsets.only(bottom: AppSpacing.md),
          child: SegmentedButton<String>(
            key: const Key('fleet-car-ownership'),
            showSelectedIcon: false,
            segments: [
              ButtonSegment(
                value: 'company',
                label: Text(l10n.fltOwnerCompany),
              ),
              ButtonSegment(value: 'driver', label: Text(l10n.fltOwnerDriver)),
            ],
            selected: {_ownership},
            onSelectionChanged: busy
                ? null
                : (v) => setState(() => _ownership = v.first),
          ),
        ),
        if (_carEdited)
          Container(
            key: const Key('fleet-car-change'),
            padding: const EdgeInsets.all(AppSpacing.md),
            margin: const EdgeInsets.only(bottom: AppSpacing.md),
            decoration: BoxDecoration(
              border: Border.all(color: AppColors.rule),
              borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
            ),
            child: RadioGroup<String>(
              groupValue: _change.isEmpty ? null : _change,
              onChanged: (v) => setState(() => _change = v ?? ''),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    l10n.fltCarChangedTitle,
                    style: const TextStyle(fontWeight: FontWeight.w800),
                  ),
                  RadioListTile<String>(
                    contentPadding: EdgeInsets.zero,
                    title: Text(l10n.fltCarMoved),
                    value: 'moved',
                  ),
                  if (_change == 'moved')
                    FleetDayField(
                      label: l10n.fltCarMovedSince,
                      value: _movedSince,
                      allowClear: true,
                      enabled: !busy,
                      onChanged: (d) => setState(() => _movedSince = d),
                    ),
                  RadioListTile<String>(
                    contentPadding: EdgeInsets.zero,
                    title: Text(l10n.fltCarTypo),
                    value: 'typo',
                  ),
                  Text(
                    l10n.fltCarMovedHint,
                    style: const TextStyle(
                      color: AppColors.muted,
                      fontSize: 13,
                    ),
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }
}
