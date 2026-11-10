import 'package:cloud_functions/cloud_functions.dart';
import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/container_manifest.dart';
import '../services/package_proof.dart'
    show senderProblemLineIds, weightText;
import '../services/send_packages.dart';
import '../services/waiting_package_service.dart';
import '../services/waiting_packages.dart'
    show AssignableLine, assignSelectionRefusal;
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/action_confirmation.dart';
import '../utils/date_display.dart';
import '../widgets/day_picker.dart';
import '../widgets/lot_sheets.dart';
import 'add_waiting_packages_sheet.dart' show PickPackageRow;
import 'containers_screen.dart'
    show ContainerRefusalNote, containerErrorText, containerRefusalText;

/// Opens Send packages (docs/SHIPPING_SIMPLE_HOME.md, part S) over the
/// waiting list. Answers how many packages left, or null when closed without
/// finishing.
///
/// [containers] and [lines] are read when a Send starts, so a shipment made
/// by an earlier attempt that was closed half way is seen and picked up again
/// (only when it is still empty). [caller] stands in for the callables in
/// tests; [clock] for today.
Future<int?> showSendPackagesSheet(
  BuildContext context, {
  required String businessId,
  required List<ContainerLine> packages,
  List<ShippingContainer> Function()? containers,
  List<ContainerLine> Function()? lines,
  ContainerCallableCaller caller = callContainerCallable,
  DateTime Function() clock = DateTime.now,
}) => showLotSheet<int>(
  context,
  SendPackagesSheet(
    businessId: businessId,
    packages: packages,
    containers: containers,
    lines: lines,
    caller: caller,
    clock: clock,
  ),
);

/// Pick the country, tick the packages, say when the flight leaves (and its
/// airway bill if there is one), and send: one shipment is made, the
/// packages go on it, and it is marked shipped - which is what tells the
/// customers it left.
///
/// A failure after the shipment was made keeps it: the sheet shows the
/// server's reason and "Try again" continues from the failed step with the
/// same shipment, never making a second one. Until then the country, the
/// date and the airway bill are locked, because the shipment already has
/// them. The ticks open again when the server refused the packages (one of
/// them was taken, or its sender reported a problem), so staff can leave
/// that package out and try again - nothing was put on the shipment yet.
class SendPackagesSheet extends StatefulWidget {
  const SendPackagesSheet({
    super.key,
    required this.businessId,
    required this.packages,
    this.containers,
    this.lines,
    this.caller = callContainerCallable,
    this.clock = DateTime.now,
  });

  final String businessId;

  /// The waiting air packages of customers ([sendablePackages]).
  final List<ContainerLine> packages;
  final List<ShippingContainer> Function()? containers;
  final List<ContainerLine> Function()? lines;
  final ContainerCallableCaller caller;
  final DateTime Function() clock;

  @override
  State<SendPackagesSheet> createState() => _SendPackagesSheetState();
}

class _SendPackagesSheetState extends State<SendPackagesSheet> {
  final _waybill = TextEditingController();
  final Set<String> _selected = {};
  String _countryId = '';
  late DateTime _date;
  bool _busy = false;
  bool _waybillError = false;

  /// The last Send failed: the button reads Try again until the choices
  /// change (a made shipment keeps them locked).
  bool _failed = false;
  String _note = '';
  Set<String> _flagged = {};
  SendRunner? _runner;

  /// The server refused the packages (nothing went on the shipment), so
  /// which ones go can still change. Never after an answer that may have
  /// been lost on the way: the packages could already be on the shipment.
  bool _ticksOpen = false;

  late final List<SendCountry> _countries = sendCountries(widget.packages);

  @override
  void initState() {
    super.initState();
    final now = widget.clock();
    _date = DateTime(now.year, now.month, now.day);
    // One country waiting: no question.
    if (_countries.length == 1) _chooseCountry(_countries.single.id);
  }

  @override
  void dispose() {
    _waybill.dispose();
    super.dispose();
  }

  /// The shipment exists and the choices are the ones it was made with.
  bool get _locked => _runner?.startedShipment ?? false;

  List<ContainerLine> get _shown =>
      packagesToCountry(widget.packages, _countryId);

  void _chooseCountry(String id) {
    _countryId = id;
    _selected
      ..clear()
      ..addAll(_shown.map((l) => l.id));
  }

  void _toggle(String id) => setState(() {
    _note = '';
    _failed = false;
    _flagged = {};
    if (!_selected.remove(id)) _selected.add(id);
  });

  Future<void> _pickDate() async {
    final today = widget.clock();
    final picked = await pickCalendarDay(
      context,
      initial: _date,
      first: DateTime(today.year, today.month, today.day - 30),
      last: DateTime(today.year + 1, today.month, today.day),
    );
    if (picked == null || !mounted) return;
    setState(() => _date = picked);
  }

  SendPlan _plan(AppLocalizations l10n) {
    final country = _countries.firstWhere((c) => c.id == _countryId);
    return SendPlan(
      businessId: widget.businessId,
      countryId: country.id,
      countryName: country.name,
      flightDate: _date,
      // The packages in the order the list shows them.
      lineIds: [
        for (final l in _shown)
          if (_selected.contains(l.id)) l.id,
      ],
      flightWord: l10n.sndFlightWord,
      airWaybill: _waybill.text,
    );
  }

  Future<void> _send({bool acknowledgeProblems = false}) async {
    if (_busy) return;
    final l10n = AppLocalizations.of(context)!;
    if (_countryId.isEmpty || _selected.isEmpty) {
      AppHaptics.refuse();
      setState(() => _note = l10n.sndTickOne);
      return;
    }
    final countRefusal = assignSelectionRefusal(_selected.length);
    if (countRefusal != null) {
      AppHaptics.refuse();
      setState(() => _note = containerErrorText(l10n, countRefusal));
      return;
    }
    if (!_locked && sendWaybillRefusal(_waybill.text) != null) {
      AppHaptics.refuse();
      setState(() => _waybillError = true);
      return;
    }
    // A shipment already made keeps its plan; otherwise this Send starts
    // afresh from what is chosen now - and picks up an empty shipment an
    // earlier attempt left, so a lost answer never makes a second one.
    var runner = _runner;
    if (runner == null || !runner.startedShipment) {
      final plan = _plan(l10n);
      runner = SendRunner(plan: plan, caller: widget.caller);
      final earlier = reusableEmptyShipment(
        plan,
        widget.containers?.call() ?? const [],
        widget.lines?.call() ?? const [],
      );
      if (earlier != null) runner.adopt(earlier.id);
      _runner = runner;
    } else if (_ticksOpen && runner.step == SendStep.assign) {
      // Same shipment, the packages ticked now.
      runner = SendRunner(
        plan: _plan(l10n),
        caller: widget.caller,
        reuseContainerId: runner.containerId,
      );
      _runner = runner;
    }
    setState(() {
      _busy = true;
      _failed = false;
      _ticksOpen = false;
      _note = '';
      _flagged = {};
    });
    try {
      await runner.run(acknowledgeProblems: acknowledgeProblems);
      if (!mounted) return;
      AppHaptics.commit();
      Navigator.of(context).pop(runner.count);
    } on FirebaseFunctionsException catch (error) {
      if (!mounted) return;
      AppHaptics.refuse();
      // A sender's "Something's wrong" warns, never blocks: name the
      // packages, ask, and repeat the same step confirmed.
      final problems = runner.step == SendStep.assign
          ? senderProblemLineIds(error.details)
          : const <String>[];
      if (problems.isNotEmpty && !acknowledgeProblems) {
        setState(() {
          _busy = false;
          _ticksOpen = true;
          _flagged = problems.toSet();
        });
        final codes = [
          for (final id in problems)
            widget.packages
                    .where((l) => l.id == id)
                    .firstOrNull
                    ?.trackingCode ??
                id,
        ].where((c) => c.isNotEmpty).join(', ');
        final go = await confirmMajorAction(
          context,
          title: l10n.sndSendAnywayTitle,
          message: l10n.sndSendAnywayMessage(codes),
          confirmLabel: l10n.sndSendAnyway,
          icon: Icons.error_outline,
        );
        if (go && mounted) await _send(acknowledgeProblems: true);
        return;
      }
      final refused = parseContainerRefusal(error.details, error.message);
      setState(() {
        _failed = true;
        _ticksOpen =
            runner!.step == SendStep.assign && !_answerMayBeLost(error);
        _flagged = refused.lineIds.toSet();
        _note = containerRefusalText(l10n, error);
      });
    } catch (_) {
      if (!mounted) return;
      AppHaptics.refuse();
      setState(() {
        _failed = true;
        _note = l10n.lotCouldNotSave;
      });
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// The call may have landed although it failed here (no network, a
  /// timeout, a crash after the write): what it changed is not known.
  static bool _answerMayBeLost(FirebaseFunctionsException error) => const {
    'unavailable',
    'deadline-exceeded',
    'internal',
    'unknown',
    'cancelled',
  }.contains(error.code);

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    final chosen = _countryId.isNotEmpty;
    final shown = chosen ? _shown : const <ContainerLine>[];
    final frozen = _busy || _locked;
    final ticksFrozen = _busy || (_locked && !_ticksOpen);
    final count = _selected.length;

    return LotSheetShell(
      title: l10n.sndSendPackages,
      subtitle: l10n.sndSubtitle,
      footer: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: [
          if (_note.isNotEmpty) ...[
            ContainerRefusalNote(text: _note),
            const SizedBox(height: AppSpacing.sm),
          ],
          if (_locked) ...[
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.sm),
              child: Text(
                l10n.sndResumeNote,
                key: const Key('send-resume-note'),
                style: const TextStyle(
                  fontSize: 12.5,
                  height: 1.35,
                  color: AppColors.muted,
                ),
              ),
            ),
          ],
          LotSheetButton(
            key: const Key('send-submit'),
            label: _locked || _failed
                ? l10n.sndTryAgain
                : l10n.sndSubmit(count),
            busy: _busy,
            busyLabel: l10n.sndSending,
            onTap: chosen && count > 0 ? _send : null,
          ),
        ],
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Packages go one country per shipment; the server refuses a mix.
          if (_countries.length > 1) ...[
            Text(
              l10n.sndWhereTitle,
              style: const TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w700,
                color: AppColors.ink,
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            Wrap(
              spacing: AppSpacing.sm,
              runSpacing: AppSpacing.sm,
              children: [
                for (final country in _countries)
                  ChoiceChip(
                    key: Key('send-country:${country.id}'),
                    label: Text(
                      l10n.sndCountryOption(country.name, country.count),
                    ),
                    selected: _countryId == country.id,
                    onSelected: frozen
                        ? null
                        : (_) {
                            AppHaptics.selection();
                            setState(() {
                              _note = '';
                              _failed = false;
                              _flagged = {};
                              _chooseCountry(country.id);
                            });
                          },
                  ),
              ],
            ),
            const SizedBox(height: AppSpacing.lg),
          ],
          if (chosen) ...[
            // Wraps on a narrow phone: the French labels are long.
            Wrap(
              children: [
                TextButton(
                  key: const Key('send-select-all'),
                  onPressed: ticksFrozen
                      ? null
                      : () => setState(() {
                          _note = '';
                          _failed = false;
                          _flagged = {};
                          _selected.addAll(shown.map((l) => l.id));
                        }),
                  child: Text(l10n.sndSelectAll),
                ),
                TextButton(
                  key: const Key('send-select-none'),
                  onPressed: ticksFrozen
                      ? null
                      : () => setState(() {
                          _flagged = {};
                          _selected.clear();
                        }),
                  child: Text(l10n.sndSelectNone),
                ),
              ],
            ),
            for (final line in shown)
              PickPackageRow(
                key: ValueKey('send-row:${line.id}'),
                entry: AssignableLine(line, null),
                reason: '',
                selected: _selected.contains(line.id),
                flagged: _flagged.contains(line.id),
                enabled: !ticksFrozen,
                showReceiver: true,
                weight: weightText(line, locale),
                onTap: () => _toggle(line.id),
              ),
            const SizedBox(height: AppSpacing.md),
            // Today by default; month first, as every date reads.
            InkWell(
              key: const Key('send-date'),
              onTap: frozen ? null : _pickDate,
              borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
              child: InputDecorator(
                decoration: InputDecoration(
                  labelText: l10n.sndFlightDate,
                  suffixIcon: const Icon(Icons.calendar_today_outlined),
                  enabled: !frozen,
                ),
                child: Text(
                  displayDate(_date, locale),
                  key: const Key('send-date-text'),
                  style: const TextStyle(fontSize: 15, color: AppColors.ink),
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.md),
            TextField(
              key: const Key('send-waybill'),
              controller: _waybill,
              enabled: !frozen,
              textCapitalization: TextCapitalization.characters,
              onChanged: (_) {
                if (_waybillError) setState(() => _waybillError = false);
              },
              decoration: InputDecoration(
                labelText: l10n.sndWaybillLabel,
                helperText: l10n.sndWaybillHelp,
                errorText: _waybillError ? l10n.sndWaybillInvalid : null,
              ),
            ),
          ],
        ],
      ),
    );
  }
}
