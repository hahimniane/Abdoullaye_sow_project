import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/fleet.dart';
import '../services/fleet_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../widgets/fleet_widgets.dart';

/// Fleet Payments (docs/FLEET.md section 6) for a phone: the month's tiles, a
/// week / month switcher, and one row per driver with what they paid and what
/// their bills asked for in that period. Tap a driver to open their page.
class FleetPaymentsTab extends StatefulWidget {
  const FleetPaymentsTab({
    super.key,
    required this.controller,
    required this.onOpenDriver,
  });

  final FleetController controller;
  final ValueChanged<String> onOpenDriver;

  @override
  State<FleetPaymentsTab> createState() => _FleetPaymentsTabState();
}

class _FleetPaymentsTabState extends State<FleetPaymentsTab> {
  FleetPeriodKind _kind = FleetPeriodKind.month;
  late FleetPeriod _period;
  FleetPaymentsFilter _filter = const FleetPaymentsFilter();

  // The filtered rows are worked out once per input, not on every build.
  FleetPeriodGrid? _grid;
  List<FleetPeriodRow> _rows = const [];
  FleetState? _rowsState;
  FleetPeriod? _rowsPeriod;
  FleetPaymentsFilter? _rowsFilter;

  @override
  void initState() {
    super.initState();
    _period = fleetPeriodContaining(_kind, widget.controller.state.todayKey);
  }

  void _setKind(FleetPeriodKind kind) {
    setState(() {
      _kind = kind;
      _period = fleetPeriodContaining(kind, widget.controller.state.todayKey);
    });
  }

  void _step(int n) => setState(() => _period = fleetShiftPeriod(_period, n));

  void _recompute(FleetState s) {
    if (identical(_rowsState, s) &&
        _rowsPeriod == _period &&
        _rowsFilter == _filter) {
      return;
    }
    _grid = s.periodGrid(_period);
    _rows = fleetFilterPeriodRows(_grid!.rows, _filter);
    _rowsState = s;
    _rowsPeriod = _period;
    _rowsFilter = _filter;
  }

  String _periodLabel(BuildContext context) {
    final lang = Localizations.localeOf(context).languageCode;
    return _kind == FleetPeriodKind.week
        ? fleetSpanLabel(_period.from, _period.to)
        : fleetMonthLabel(fleetMonthOf(_period.from), language: lang);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return ListenableBuilder(
      listenable: widget.controller,
      builder: (context, _) {
        final s = widget.controller.state;
        return FleetStateGate(
          controller: widget.controller,
          child: Builder(
            builder: (context) {
              _recompute(s);
              final counts = fleetPeriodCounts(_grid!.rows, _filter.view);
              final atNow = _period == fleetPeriodContaining(_kind, s.todayKey);
              return CustomScrollView(
                slivers: [
                  SliverPadding(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    sliver: SliverToBoxAdapter(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          _Tiles(tiles: s.tiles),
                          const SizedBox(height: AppSpacing.lg),
                          SegmentedButton<FleetPeriodKind>(
                            key: const Key('fleet-period-kind'),
                            showSelectedIcon: false,
                            segments: [
                              ButtonSegment(
                                value: FleetPeriodKind.week,
                                label: Text(l10n.fltPeriodWeek),
                              ),
                              ButtonSegment(
                                value: FleetPeriodKind.month,
                                label: Text(l10n.fltPeriodMonth),
                              ),
                            ],
                            selected: {_kind},
                            onSelectionChanged: (v) => _setKind(v.first),
                          ),
                          const SizedBox(height: AppSpacing.sm),
                          Row(
                            children: [
                              IconButton(
                                key: const Key('fleet-period-prev'),
                                tooltip: l10n.fltPeriodPrevious,
                                icon: const Icon(Icons.chevron_left),
                                onPressed: () => _step(-1),
                              ),
                              Expanded(
                                child: Text(
                                  _periodLabel(context),
                                  key: const Key('fleet-period-label'),
                                  textAlign: TextAlign.center,
                                  style: const TextStyle(
                                    fontSize: 16,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                              ),
                              IconButton(
                                key: const Key('fleet-period-next'),
                                tooltip: l10n.fltPeriodNext,
                                icon: const Icon(Icons.chevron_right),
                                onPressed: atNow ? null : () => _step(1),
                              ),
                            ],
                          ),
                          Text(
                            l10n.fltPeriodTotals(
                              fleetMoney(_grid!.paidCents),
                              fleetMoney(_grid!.dueCents),
                            ),
                            key: const Key('fleet-period-totals'),
                            style: const TextStyle(color: AppColors.muted),
                          ),
                          const SizedBox(height: AppSpacing.md),
                          FleetSearchField(
                            fieldKey: const Key('fleet-payments-search'),
                            hint: l10n.fltSearchDrivers,
                            onChanged: (q) => setState(
                              () => _filter = _filter.copyWith(query: q),
                            ),
                          ),
                          const SizedBox(height: AppSpacing.sm),
                          Wrap(
                            spacing: 6,
                            runSpacing: 0,
                            children: [
                              FleetFilterChip(
                                label: l10n.fltViewActive,
                                count: counts.active,
                                selected:
                                    _filter.view == FleetDriverView.active,
                                onSelected: () => setState(
                                  () => _filter = _filter.copyWith(
                                    view: FleetDriverView.active,
                                  ),
                                ),
                              ),
                              FleetFilterChip(
                                label: l10n.fltViewLeft,
                                count: counts.left,
                                selected: _filter.view == FleetDriverView.left,
                                onSelected: () => setState(
                                  () => _filter = _filter.copyWith(
                                    view: FleetDriverView.left,
                                  ),
                                ),
                              ),
                              FleetFilterChip(
                                label: l10n.fltViewEveryone,
                                count: counts.all,
                                selected: _filter.view == FleetDriverView.all,
                                onSelected: () => setState(
                                  () => _filter = _filter.copyWith(
                                    view: FleetDriverView.all,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          Wrap(
                            spacing: 6,
                            runSpacing: 0,
                            children: [
                              for (final (state, label, count) in [
                                (
                                  FleetCellState.owed,
                                  l10n.fltStateOwes,
                                  counts.owed,
                                ),
                                (
                                  FleetCellState.part,
                                  l10n.fltStatePart,
                                  counts.part,
                                ),
                                (
                                  FleetCellState.full,
                                  l10n.fltStatePaid,
                                  counts.paid,
                                ),
                              ])
                                if (count > 0 || _filter.state == state)
                                  FleetFilterChip(
                                    label: label,
                                    count: count,
                                    selected: _filter.state == state,
                                    onSelected: () => setState(
                                      () => _filter = _filter.state == state
                                          ? _filter.copyWith(clearState: true)
                                          : _filter.copyWith(state: state),
                                    ),
                                  ),
                              if (counts.late > 0 || _filter.late)
                                FleetFilterChip(
                                  label: l10n.fltChipLate,
                                  count: counts.late,
                                  selected: _filter.late,
                                  onSelected: () => setState(
                                    () => _filter = _filter.copyWith(
                                      late: !_filter.late,
                                    ),
                                  ),
                                ),
                            ],
                          ),
                          Row(
                            children: [
                              Text(
                                l10n.fltSortBy,
                                style: const TextStyle(color: AppColors.muted),
                              ),
                              const SizedBox(width: AppSpacing.sm),
                              Expanded(
                                child: DropdownButton<FleetPeriodSort>(
                                  key: const Key('fleet-payments-sort'),
                                  value: _filter.sort,
                                  isExpanded: true,
                                  isDense: true,
                                  underline: const SizedBox.shrink(),
                                  items: [
                                    DropdownMenuItem(
                                      value: FleetPeriodSort.name,
                                      child: Text(l10n.fltSortName),
                                    ),
                                    DropdownMenuItem(
                                      value: FleetPeriodSort.owed,
                                      child: Text(l10n.fltSortOwed),
                                    ),
                                    DropdownMenuItem(
                                      value: FleetPeriodSort.paid,
                                      child: Text(l10n.fltSortPaid),
                                    ),
                                  ],
                                  onChanged: (v) => setState(
                                    () => _filter = _filter.copyWith(sort: v),
                                  ),
                                ),
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
                  ),
                  if (_rows.isEmpty)
                    SliverToBoxAdapter(
                      child: Padding(
                        padding: const EdgeInsets.all(AppSpacing.xl),
                        child: Text(
                          _filter.narrowed
                              ? l10n.fltNoDriverMatches
                              : _grid!.rows.isEmpty
                              ? l10n.fltNoDriversYet
                              : l10n.fltNoDriverInList,
                          textAlign: TextAlign.center,
                          style: const TextStyle(color: AppColors.muted),
                        ),
                      ),
                    )
                  else
                    SliverPadding(
                      padding: const EdgeInsets.fromLTRB(
                        AppSpacing.lg,
                        0,
                        AppSpacing.lg,
                        AppSpacing.xl,
                      ),
                      sliver: SliverList.separated(
                        itemCount: _rows.length,
                        separatorBuilder: (_, _) =>
                            const SizedBox(height: AppSpacing.sm),
                        itemBuilder: (context, i) => _PeriodRowCard(
                          row: _rows[i],
                          onTap: () => widget.onOpenDriver(_rows[i].driverId),
                        ),
                      ),
                    ),
                ],
              );
            },
          ),
        );
      },
    );
  }
}

class _Tiles extends StatelessWidget {
  const _Tiles({required this.tiles});

  final FleetTiles tiles;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return LayoutBuilder(
      builder: (context, c) {
        final w = (c.maxWidth - AppSpacing.sm) / 2;
        Widget tile(
          Key key,
          String label,
          String value,
          String note, {
          Color color = AppColors.ink,
        }) => SizedBox(
          width: w,
          child: FleetCard(
            key: key,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: const TextStyle(fontSize: 12, color: AppColors.muted),
                ),
                const SizedBox(height: 2),
                FittedBox(
                  fit: BoxFit.scaleDown,
                  alignment: Alignment.centerLeft,
                  child: Text(
                    value,
                    style: TextStyle(
                      fontSize: 20,
                      fontWeight: FontWeight.w800,
                      color: color,
                    ),
                  ),
                ),
                Text(
                  note,
                  style: const TextStyle(fontSize: 12, color: AppColors.muted),
                ),
              ],
            ),
          ),
        );
        return Wrap(
          spacing: AppSpacing.sm,
          runSpacing: AppSpacing.sm,
          children: [
            tile(
              const Key('fleet-tile-collected'),
              l10n.fltTileCollected,
              fleetMoney(tiles.collectedCents),
              tiles.plateFeesBilledCents > 0
                  ? _plateFeesLine(l10n, tiles)
                  : l10n.fltTileNothingBilled,
              color: AppColors.sage,
            ),
            tile(
              const Key('fleet-tile-owed'),
              l10n.fltTileOwed,
              fleetMoney(tiles.owedCents),
              l10n.fltTileDriversOwe(tiles.owingDrivers),
              color: tiles.owedCents > 0 ? AppColors.errorRed : AppColors.ink,
            ),
            tile(
              const Key('fleet-tile-late'),
              l10n.fltTileLate,
              '${tiles.lateDrivers}',
              tiles.lateCents > 0
                  ? l10n.fltTilePastDue(fleetMoney(tiles.lateCents))
                  : l10n.fltTileNobodyLate,
              color: tiles.lateDrivers > 0 ? AppColors.errorRed : AppColors.ink,
            ),
          ],
        );
      },
    );
  }
}

/// "79% of this month's plate fees paid ($11,900 of $15,100)": the paid share
/// of this month's plate-fee bills, never collected over billed.
String _plateFeesLine(AppLocalizations l10n, FleetTiles tiles) {
  final share = fleetPlateFeesShare(
    tiles.plateFeesBilledCents,
    tiles.plateFeesPaidCents,
  );
  return l10n.fltTilePlateFeesPaid(
    share.percent,
    fleetMoney(share.paidCents),
    fleetMoney(share.billedCents),
  );
}

class _PeriodRowCard extends StatelessWidget {
  const _PeriodRowCard({required this.row, required this.onTap});

  final FleetPeriodRow row;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final chip = switch (row.state) {
      FleetCellState.full => FleetChip(
        label: l10n.fltStatePaid,
        tone: FleetTone.ok,
      ),
      FleetCellState.part => FleetChip(
        label: l10n.fltStatePart,
        tone: FleetTone.warn,
      ),
      FleetCellState.owed => FleetChip(
        label: l10n.fltStateOwes,
        tone: FleetTone.bad,
      ),
      FleetCellState.none => null,
    };
    return FleetCard(
      key: Key('fleet-payment-row-${row.driverId}'),
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  row.name,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 16,
                    fontWeight: FontWeight.w800,
                    color: AppColors.ink,
                  ),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Text(
                fleetMoney(row.paidCents),
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          Wrap(
            spacing: 6,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              if (row.plate.isNotEmpty)
                Text(row.plate, style: const TextStyle(color: AppColors.muted)),
              if (row.dueCents > 0)
                Text(
                  l10n.fltBilledAmount(fleetMoney(row.dueCents)),
                  style: const TextStyle(color: AppColors.muted),
                ),
              ?chip,
              if (row.extraOwedCents > 0)
                Tooltip(
                  message: l10n.fltFeeOwedHint,
                  child: Text(
                    l10n.fltFeeOwedMarker,
                    key: Key('fleet-fee-owed-${row.driverId}'),
                    style: const TextStyle(
                      color: AppColors.errorRed,
                      fontSize: 12,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              if (row.lateCents > 0)
                FleetChip(
                  label: l10n.fltLateAmount(fleetMoney(row.lateCents)),
                  tone: FleetTone.bad,
                ),
            ],
          ),
        ],
      ),
    );
  }
}
