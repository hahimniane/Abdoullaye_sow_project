import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/parking_lots.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../utils/parking_lots_localization.dart';

/// What the lot chooser tells its form.
class ParkingLotChoice {
  const ParkingLotChoice({this.asks = false, this.lotId = ''});

  /// Whether the business has two or more open lots, so a lot is required.
  final bool asks;

  /// The lot picked; '' while it is not asked for.
  final String lotId;

  @override
  bool operator ==(Object other) =>
      other is ParkingLotChoice && other.asks == asks && other.lotId == lotId;

  @override
  int get hashCode => Object.hash(asks, lotId);
}

/// "Which lot?" on the park-a-car form: a required choice among the open
/// lots, shown only to a business with two or more of them, opening on the
/// lot this person used last on this device when it has room
/// (docs/PARKING_LOTS.md decision 5).
///
/// Self-contained so a form just drops it in and hears [onChanged]: it reads
/// the lots live, how full each is, and the remembered lot. The form calls
/// [ParkingLotsService.rememberLot] once the car is saved.
class ParkingLotChooser extends StatefulWidget {
  const ParkingLotChooser({
    super.key,
    required this.businessId,
    required this.onChanged,
    this.service,
    this.enabled = true,
  });

  final String businessId;
  final ValueChanged<ParkingLotChoice> onChanged;
  final ParkingLotsService? service;
  final bool enabled;

  @override
  State<ParkingLotChooser> createState() => _ParkingLotChooserState();
}

class _ParkingLotChooserState extends State<ParkingLotChooser> {
  late final ParkingLotsService _service;
  StreamSubscription<List<ParkingLot>>? _sub;
  List<ParkingLot> _lots = const [];
  List<ParkingLotFigures> _figures = const [];
  String _remembered = '';
  String _value = '';
  bool _setUp = false;

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? ParkingLotsService();
    unawaited(_start());
  }

  Future<void> _start() async {
    if (widget.businessId.isEmpty) return;
    // Both reads are best effort: with neither, the first open lot is the
    // default and the server still refuses a full one in words.
    final remembered = await _service.rememberedLot(widget.businessId);
    if (!mounted) return;
    _remembered = remembered;
    try {
      _sub = _service
          .watchLots(widget.businessId)
          .listen(_onLots, onError: (_) {});
    } catch (_) {
      // No lots to offer: the form stays as it was.
    }
  }

  Future<void> _onLots(List<ParkingLot> lots) async {
    if (!mounted) return;
    _lots = lots;
    if (!asksForParkingLot(lots)) {
      setState(() => _value = '');
      _report();
      return;
    }
    if (!_setUp) {
      _setUp = true;
      final figures = await _service.readFigures(widget.businessId, lots);
      if (!mounted) return;
      _figures = figures;
      setState(
        () => _value = defaultParkingLotId(
          lots,
          widget.businessId,
          _remembered,
          figures,
        ),
      );
    } else if (!openParkingLots(lots).any((lot) => lot.id == _value)) {
      // The lot closed while the form was open.
      setState(
        () => _value = defaultParkingLotId(
          lots,
          widget.businessId,
          _remembered,
          _figures,
        ),
      );
    }
    _report();
  }

  void _report() => widget.onChanged(
    ParkingLotChoice(asks: asksForParkingLot(_lots), lotId: _value),
  );

  @override
  void dispose() {
    unawaited(_sub?.cancel());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!asksForParkingLot(_lots) || _value.isEmpty) {
      return const SizedBox.shrink();
    }
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.lg),
      child: ParkingLotPicker(
        lots: openParkingLots(_lots),
        figures: _figures,
        value: _value,
        enabled: widget.enabled,
        onChanged: (lotId) {
          setState(() => _value = lotId);
          _report();
        },
      ),
    );
  }
}

/// The dropdown itself: each open lot with its free spaces when known, a
/// full lot marked and not selectable.
class ParkingLotPicker extends StatelessWidget {
  const ParkingLotPicker({
    super.key,
    required this.lots,
    required this.value,
    required this.onChanged,
    this.figures = const [],
    this.enabled = true,
  });

  final List<ParkingLot> lots;
  final String value;
  final ValueChanged<String> onChanged;
  final List<ParkingLotFigures> figures;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    ParkingLotFigures? figuresOf(String id) =>
        figures.where((f) => f.lotId == id).firstOrNull;
    String label(ParkingLot lot) {
      final told = figuresOf(lot.id);
      if (told == null || lot.usableSpaces == 0) return lot.name;
      return told.isFull
          ? l10n.pltOptionFull(lot.name)
          : l10n.pltOptionFree(lot.name, told.free);
    }

    return DropdownButtonFormField<String>(
      key: ValueKey<String>('parking-lot-picker-$value'),
      initialValue: lots.any((lot) => lot.id == value) ? value : null,
      isExpanded: true,
      onChanged: enabled ? (id) => id == null ? null : onChanged(id) : null,
      validator: (id) =>
          (id == null || id.isEmpty) ? l10n.pltLotRequired : null,
      decoration: InputDecoration(
        labelText: l10n.pltWhichLot,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide(color: Colors.grey.shade300),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: const BorderSide(color: AppColors.brandRed, width: 2),
        ),
        filled: true,
        fillColor: Colors.grey.shade50,
      ),
      items: [
        for (final lot in lots)
          DropdownMenuItem<String>(
            value: lot.id,
            // A full lot cannot be picked, except the one already chosen.
            enabled: !parkingLotIsFull(figuresOf(lot.id)) || lot.id == value,
            child: Text(
              label(lot),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
      ],
    );
  }
}

/// The lot's name as a small tag on a parked-car row.
class ParkingLotBadge extends StatelessWidget {
  const ParkingLotBadge({super.key, required this.name});

  final String name;

  @override
  Widget build(BuildContext context) {
    if (name.isEmpty) return const SizedBox.shrink();
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Icons.place_outlined, size: 12, color: AppColors.muted),
        const SizedBox(width: 2),
        Flexible(
          child: Text(
            name,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(fontSize: 12, color: AppColors.muted),
          ),
        ),
      ],
    );
  }
}

/// The lots side by side on the parking list: each open lot with the cars in
/// it and the spaces free; tapping one narrows the list to it, tapping it
/// again (or "All lots") shows every lot. Hidden with fewer than two lots.
class ParkingLotStrip extends StatelessWidget {
  const ParkingLotStrip({
    super.key,
    required this.figures,
    required this.selected,
    required this.onSelect,
  });

  final List<ParkingLotFigures> figures;

  /// The lot the list is narrowed to, '' for every lot.
  final String selected;
  final ValueChanged<String> onSelect;

  @override
  Widget build(BuildContext context) {
    if (figures.length < 2) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context)!;
    return Semantics(
      container: true,
      label: l10n.pltStripLabel,
      child: Wrap(
        spacing: AppSpacing.sm,
        runSpacing: AppSpacing.sm,
        children: [
          _LotTile(
            key: const ValueKey<String>('parking-lot-all'),
            on: selected.isEmpty,
            onTap: () => onSelect(''),
            title: l10n.pltStripAll,
            lines: const [],
          ),
          for (final lot in figures)
            _LotTile(
              key: ValueKey<String>('parking-lot-${lot.lotId}'),
              on: selected == lot.lotId,
              onTap: () => onSelect(selected == lot.lotId ? '' : lot.lotId),
              title: lot.lot.name,
              closed: !lot.lot.open,
              lines: [
                l10n.pltStripCars(lot.used),
                if (lot.isFull)
                  l10n.pltStripFull
                else if (lot.totals.spacesTotal > 0)
                  l10n.pltStripFree(lot.free),
              ],
            ),
        ],
      ),
    );
  }
}

class _LotTile extends StatelessWidget {
  const _LotTile({
    super.key,
    required this.on,
    required this.onTap,
    required this.title,
    required this.lines,
    this.closed = false,
  });

  final bool on;
  final VoidCallback onTap;
  final String title;
  final List<String> lines;
  final bool closed;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Semantics(
      button: true,
      selected: on,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        child: Container(
          constraints: const BoxConstraints(minHeight: 48, maxWidth: 220),
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.lg,
            vertical: AppSpacing.md,
          ),
          decoration: BoxDecoration(
            color: on ? AppColors.ink : AppColors.paper,
            border: Border.all(color: on ? AppColors.ink : AppColors.rule),
            borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                closed ? '$title · ${l10n.pltStripClosed}' : title,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w800,
                  color: on ? Colors.white : AppColors.ink,
                ),
              ),
              for (final line in lines)
                Text(
                  line,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 12,
                    color: on ? Colors.white70 : AppColors.muted,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// "Move to another lot" on a parked car's page: the other open lots, one
/// button, and the server's refusals in words. Hidden unless the business has
/// two or more open lots. Nobody is messaged and the bill does not change.
class ParkingLotMove extends StatefulWidget {
  const ParkingLotMove({
    super.key,
    required this.businessId,
    required this.carId,
    required this.car,
    this.service,
    this.enabled = true,
    this.onMoved,
  });

  final String businessId;
  final String carId;

  /// The car's fields (carries `parkingLotId` and `parkingLotName`).
  final Map<String, dynamic> car;
  final ParkingLotsService? service;
  final bool enabled;

  /// Called with the lot the car now stands in, after a successful move.
  final void Function(ParkingLot lot)? onMoved;

  @override
  State<ParkingLotMove> createState() => _ParkingLotMoveState();
}

class _ParkingLotMoveState extends State<ParkingLotMove> {
  late final ParkingLotsService _service;
  StreamSubscription<List<ParkingLot>>? _sub;
  List<ParkingLot> _lots = const [];
  List<ParkingLotFigures> _figures = const [];
  String _target = '';
  bool _busy = false;
  String _error = '';
  String _flash = '';
  // The lot the car stands in now, kept here so a move updates the page
  // without a round trip through the list.
  late String _currentId;

  @override
  void initState() {
    super.initState();
    _service = widget.service ?? ParkingLotsService();
    _currentId = parkingLotIdOf(widget.car, widget.businessId);
    if (widget.businessId.isNotEmpty) {
      try {
        _sub = _service.watchLots(widget.businessId).listen((lots) async {
          if (!mounted) return;
          setState(() => _lots = lots);
          if (_figures.isEmpty && asksForParkingLot(lots)) {
            final figures = await _service.readFigures(widget.businessId, lots);
            if (mounted) setState(() => _figures = figures);
          }
        }, onError: (_) {});
      } catch (_) {
        // No lots: nothing is offered.
      }
    }
  }

  @override
  void dispose() {
    unawaited(_sub?.cancel());
    super.dispose();
  }

  Future<void> _move(String targetId) async {
    final l10n = AppLocalizations.of(context)!;
    setState(() {
      _busy = true;
      _error = '';
      _flash = '';
    });
    try {
      final result = await _service.moveCar(
        entryId: widget.carId,
        parkingLotId: targetId,
      );
      if (!mounted) return;
      final lot = _lots.where((l) => l.id == targetId).firstOrNull;
      setState(() {
        _currentId = targetId;
        _target = '';
        _flash = result.moved
            ? l10n.pltMoved(
                result.parkingLotName.isNotEmpty
                    ? result.parkingLotName
                    : lot?.name ?? '',
              )
            : l10n.pltMoveSame;
      });
      if (lot != null && result.moved) widget.onMoved?.call(lot);
    } catch (failure) {
      if (!mounted) return;
      setState(
        () => _error = parkingLotFailureText(l10n, failure, l10n.pltMoveFailed),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final choices = openParkingLots(
      _lots,
    ).where((lot) => lot.id != _currentId).toList();
    // One lot (or none): nothing to tell apart, nothing to move between.
    if (!asksForParkingLot(_lots)) return const SizedBox.shrink();
    final currentName =
        _lots.where((lot) => lot.id == _currentId).firstOrNull?.name ??
        parkingLotNameOf(widget.car, widget.businessId, _lots);
    final chosen = choices.any((lot) => lot.id == _target)
        ? _target
        : (choices.isEmpty ? '' : choices.first.id);
    return Padding(
      padding: const EdgeInsets.only(top: AppSpacing.xl),
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(AppSpacing.lg),
        decoration: BoxDecoration(
          color: AppColors.paper,
          border: Border.all(color: AppColors.rule),
          borderRadius: BorderRadius.circular(AppSpacing.radiusLg),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            ParkingLotLine(name: currentName),
            const SizedBox(height: AppSpacing.md),
            if (choices.isNotEmpty) ..._moveControls(l10n, choices, chosen),
            if (_flash.isNotEmpty) ...[
              const SizedBox(height: AppSpacing.sm),
              Text(_flash, style: const TextStyle(fontSize: 13)),
            ],
          ],
        ),
      ),
    );
  }

  List<Widget> _moveControls(
    AppLocalizations l10n,
    List<ParkingLot> choices,
    String chosen,
  ) {
    return [
      Text(
        l10n.pltMoveTitle,
        style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800),
      ),
      const SizedBox(height: AppSpacing.xs),
      Text(
        l10n.pltMoveHint,
        style: const TextStyle(fontSize: 12, color: AppColors.muted),
      ),
      const SizedBox(height: AppSpacing.md),
      ParkingLotPicker(
        lots: choices,
        figures: _figures,
        value: chosen,
        enabled: widget.enabled && !_busy,
        onChanged: (id) => setState(() => _target = id),
      ),
      const SizedBox(height: AppSpacing.md),
      SizedBox(
        width: double.infinity,
        child: OutlinedButton.icon(
          key: const ValueKey<String>('parking-lot-move'),
          onPressed: widget.enabled && !_busy ? () => _move(chosen) : null,
          icon: _busy
              ? const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Icon(Icons.swap_horiz, size: 18),
          label: Text(l10n.pltMoveButton),
        ),
      ),
      if (_error.isNotEmpty) ...[
        const SizedBox(height: AppSpacing.sm),
        Text(
          _error,
          key: const ValueKey<String>('parking-lot-move-error'),
          style: const TextStyle(fontSize: 13, color: AppColors.warn),
        ),
      ],
    ];
  }
}

/// The lot a car stands in, as a labelled line on its page. Quiet when the
/// business has fewer than two lots (nothing to tell apart).
class ParkingLotLine extends StatelessWidget {
  const ParkingLotLine({super.key, required this.name});

  final String name;

  @override
  Widget build(BuildContext context) {
    if (name.isEmpty) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context)!;
    return Row(
      children: [
        const Icon(Icons.place_outlined, size: 16, color: AppColors.muted),
        const SizedBox(width: AppSpacing.sm),
        Expanded(
          child: Text(
            l10n.pltLotOfCar(name),
            key: const ValueKey<String>('parking-lot-line'),
            style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700),
          ),
        ),
      ],
    );
  }
}
