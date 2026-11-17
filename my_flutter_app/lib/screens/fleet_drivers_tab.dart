import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/fleet.dart';
import '../services/fleet_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../widgets/fleet_widgets.dart';
import 'fleet_driver_sheets.dart';

/// Fleet Drivers: who is active, who owes, who is late, who has credit, who
/// has no plate; search and order. Tap a driver to open their page.
class FleetDriversTab extends StatefulWidget {
  const FleetDriversTab({
    super.key,
    required this.controller,
    required this.onOpenDriver,
  });

  final FleetController controller;
  final ValueChanged<String> onOpenDriver;

  @override
  State<FleetDriversTab> createState() => _FleetDriversTabState();
}

class _FleetDriversTabState extends State<FleetDriversTab> {
  FleetDriverFilter _filter = const FleetDriverFilter();

  // Worked out once per snapshot and filter, not on every build.
  FleetState? _state;
  FleetDriverFilter? _appliedFilter;
  List<FleetDriverRow> _rows = const [];
  FleetDriverCounts? _counts;

  void _recompute(FleetState s) {
    if (identical(_state, s) && _appliedFilter == _filter) return;
    _rows = fleetFilterDriverRows(s.driverRows, _filter);
    _counts = fleetDriverCounts(s.driverRows, _filter.view);
    _state = s;
    _appliedFilter = _filter;
  }

  void _set(FleetDriverFilter f) => setState(() => _filter = f);

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
              final counts = _counts!;
              return CustomScrollView(
                slivers: [
                  SliverPadding(
                    padding: const EdgeInsets.all(AppSpacing.lg),
                    sliver: SliverToBoxAdapter(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          SizedBox(
                            width: double.infinity,
                            child: FilledButton.icon(
                              key: const Key('fleet-add-driver'),
                              onPressed: () => showFleetSheet(
                                context,
                                (_) => FleetDriverFormSheet(
                                  controller: widget.controller,
                                ),
                              ),
                              icon: const Icon(
                                Icons.person_add_alt_1,
                                size: 18,
                              ),
                              label: Text(l10n.fltAddDriver),
                            ),
                          ),
                          const SizedBox(height: AppSpacing.md),
                          FleetSearchField(
                            fieldKey: const Key('fleet-drivers-search'),
                            hint: l10n.fltSearchDrivers,
                            onChanged: (q) => _set(_filter.copyWith(query: q)),
                          ),
                          const SizedBox(height: AppSpacing.sm),
                          Wrap(
                            spacing: 6,
                            children: [
                              for (final (v, label, n) in [
                                (
                                  FleetDriverView.active,
                                  l10n.fltViewActive,
                                  counts.active,
                                ),
                                (
                                  FleetDriverView.left,
                                  l10n.fltViewLeft,
                                  counts.left,
                                ),
                                (
                                  FleetDriverView.all,
                                  l10n.fltViewEveryone,
                                  counts.all,
                                ),
                              ])
                                FleetFilterChip(
                                  label: label,
                                  count: n,
                                  selected: _filter.view == v,
                                  onSelected: () =>
                                      _set(_filter.copyWith(view: v)),
                                ),
                            ],
                          ),
                          Wrap(
                            spacing: 6,
                            children: [
                              if (counts.owes > 0 || _filter.owes)
                                FleetFilterChip(
                                  label: l10n.fltChipOwes,
                                  count: counts.owes,
                                  selected: _filter.owes,
                                  onSelected: () => _set(
                                    _filter.copyWith(owes: !_filter.owes),
                                  ),
                                ),
                              if (counts.late > 0 || _filter.late)
                                FleetFilterChip(
                                  label: l10n.fltChipLate,
                                  count: counts.late,
                                  selected: _filter.late,
                                  onSelected: () => _set(
                                    _filter.copyWith(late: !_filter.late),
                                  ),
                                ),
                              if (counts.credit > 0 || _filter.credit)
                                FleetFilterChip(
                                  label: l10n.fltChipCredit,
                                  count: counts.credit,
                                  selected: _filter.credit,
                                  onSelected: () => _set(
                                    _filter.copyWith(credit: !_filter.credit),
                                  ),
                                ),
                              if (counts.noCar > 0 || _filter.noCar)
                                FleetFilterChip(
                                  label: l10n.fltChipNoPlate,
                                  count: counts.noCar,
                                  selected: _filter.noCar,
                                  onSelected: () => _set(
                                    _filter.copyWith(noCar: !_filter.noCar),
                                  ),
                                ),
                              if (counts.noFee > 0 || _filter.noFee)
                                FleetFilterChip(
                                  label: l10n.fltChipNoFee,
                                  count: counts.noFee,
                                  selected: _filter.noFee,
                                  onSelected: () => _set(
                                    _filter.copyWith(noFee: !_filter.noFee),
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
                                child: DropdownButton<FleetDriverSort>(
                                  key: const Key('fleet-drivers-sort'),
                                  value: _filter.sort,
                                  isExpanded: true,
                                  isDense: true,
                                  underline: const SizedBox.shrink(),
                                  items: [
                                    DropdownMenuItem(
                                      value: FleetDriverSort.name,
                                      child: Text(l10n.fltSortName),
                                    ),
                                    DropdownMenuItem(
                                      value: FleetDriverSort.owed,
                                      child: Text(l10n.fltSortOwed),
                                    ),
                                    DropdownMenuItem(
                                      value: FleetDriverSort.cents,
                                      child: Text(l10n.fltSortZelleCents),
                                    ),
                                  ],
                                  onChanged: (v) =>
                                      _set(_filter.copyWith(sort: v)),
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
                              : s.data.drivers.isEmpty
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
                        itemBuilder: (context, i) => _DriverRowCard(
                          row: _rows[i],
                          onTap: () => widget.onOpenDriver(_rows[i].id),
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

class _DriverRowCard extends StatelessWidget {
  const _DriverRowCard({required this.row, required this.onTap});

  final FleetDriverRow row;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return FleetCard(
      key: Key('fleet-driver-row-${row.id}'),
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
              if (row.owedCents > 0) ...[
                const SizedBox(width: AppSpacing.sm),
                Text(
                  fleetMoney(row.owedCents),
                  style: const TextStyle(
                    fontWeight: FontWeight.w800,
                    color: AppColors.errorRed,
                  ),
                ),
              ],
            ],
          ),
          const SizedBox(height: 4),
          Wrap(
            spacing: 8,
            runSpacing: 4,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              if (row.phone.isNotEmpty)
                Text(row.phone, style: const TextStyle(color: AppColors.muted)),
              if (row.plate.isNotEmpty)
                Text(row.plate, style: const TextStyle(color: AppColors.muted)),
              if (!row.active) FleetChip(label: l10n.fltStatusLeft),
              if (row.lateCents > 0)
                FleetChip(
                  label: l10n.fltLateAmount(fleetMoney(row.lateCents)),
                  tone: FleetTone.bad,
                ),
              if (row.creditCents > 0)
                FleetChip(
                  label: l10n.fltCreditAmount(fleetMoney(row.creditCents)),
                  tone: FleetTone.ok,
                ),
            ],
          ),
        ],
      ),
    );
  }
}
