import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/fleet.dart';
import '../services/fleet_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../widgets/fleet_widgets.dart';
import 'fleet_car_screen.dart';

/// Fleet Plates and Paperwork: the plates with who has them now, and the same
/// list ordered by the soonest registration / diamond date.
class FleetCarsTab extends StatefulWidget {
  const FleetCarsTab({
    super.key,
    required this.controller,
    required this.onOpenCar,
  });

  final FleetController controller;
  final ValueChanged<String> onOpenCar;

  @override
  State<FleetCarsTab> createState() => _FleetCarsTabState();
}

class _FleetCarsTabState extends State<FleetCarsTab> {
  bool _paperwork = false;
  FleetCarFilter _filter = const FleetCarFilter();

  FleetState? _state;
  FleetCarFilter? _appliedFilter;
  bool? _appliedPaperwork;
  List<FleetCarRow> _rows = const [];
  Map<FleetExpiry, int> _counts = const {};

  void _recompute(FleetState s) {
    if (identical(_state, s) &&
        _appliedFilter == _filter &&
        _appliedPaperwork == _paperwork) {
      return;
    }
    _rows = fleetFilterCarRows(s.carRows, _filter, byExpiry: _paperwork);
    _counts = fleetPaperworkCounts(s.carRows);
    _state = s;
    _appliedFilter = _filter;
    _appliedPaperwork = _paperwork;
  }

  void _set(FleetCarFilter f) => setState(() => _filter = f);

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
                              key: const Key('fleet-add-car'),
                              onPressed: () => showFleetSheet(
                                context,
                                (_) => FleetCarFormSheet(
                                  controller: widget.controller,
                                ),
                              ),
                              icon: const Icon(Icons.add, size: 18),
                              label: Text(l10n.fltAddPlate),
                            ),
                          ),
                          const SizedBox(height: AppSpacing.md),
                          SegmentedButton<bool>(
                            key: const Key('fleet-cars-mode'),
                            showSelectedIcon: false,
                            segments: [
                              ButtonSegment(
                                value: false,
                                label: Text(l10n.fltPlatesMode),
                              ),
                              ButtonSegment(
                                value: true,
                                label: Text(l10n.fltPaperworkMode),
                              ),
                            ],
                            selected: {_paperwork},
                            onSelectionChanged: (v) =>
                                setState(() => _paperwork = v.first),
                          ),
                          const SizedBox(height: AppSpacing.md),
                          FleetSearchField(
                            fieldKey: const Key('fleet-cars-search'),
                            hint: l10n.fltSearchPlates,
                            onChanged: (q) => _set(_filter.copyWith(query: q)),
                          ),
                          const SizedBox(height: AppSpacing.sm),
                          Wrap(
                            spacing: 6,
                            children: [
                              for (final (v, label) in [
                                (FleetCarView.all, l10n.fltCarsAll),
                                (FleetCarView.driver, l10n.fltCarsWithDriver),
                                (FleetCarView.free, l10n.fltCarsFree),
                              ])
                                FleetFilterChip(
                                  label: label,
                                  count: switch (v) {
                                    FleetCarView.all => s.carRows.length,
                                    FleetCarView.driver =>
                                      s.carRows
                                          .where((r) => r.hasDriver)
                                          .length,
                                    FleetCarView.free =>
                                      s.carRows
                                          .where((r) => !r.hasDriver)
                                          .length,
                                  },
                                  selected: _filter.view == v,
                                  onSelected: () =>
                                      _set(_filter.copyWith(view: v)),
                                ),
                            ],
                          ),
                          Wrap(
                            spacing: 6,
                            children: [
                              for (final (e, label) in [
                                (FleetExpiry.expired, l10n.fltExpiryExpired),
                                (FleetExpiry.soon, l10n.fltExpirySoon),
                                (FleetExpiry.missing, l10n.fltExpiryMissing),
                              ])
                                if ((_counts[e] ?? 0) > 0 || _filter.paper == e)
                                  FleetFilterChip(
                                    label: label,
                                    count: _counts[e] ?? 0,
                                    selected: _filter.paper == e,
                                    onSelected: () => _set(
                                      _filter.paper == e
                                          ? _filter.copyWith(clearPaper: true)
                                          : _filter.copyWith(paper: e),
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
                          s.data.cars.isEmpty
                              ? l10n.fltNoPlatesYet
                              : l10n.fltNoPlateMatches,
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
                        itemBuilder: (context, i) => _CarRowCard(
                          row: _rows[i],
                          paperwork: _paperwork,
                          onTap: () => widget.onOpenCar(_rows[i].id),
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

class _CarRowCard extends StatelessWidget {
  const _CarRowCard({
    required this.row,
    required this.paperwork,
    required this.onTap,
  });

  final FleetCarRow row;
  final bool paperwork;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return FleetCard(
      key: Key('fleet-car-row-${row.id}'),
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            row.plate,
            style: const TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w800,
              color: AppColors.ink,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            [
              if (row.company.isNotEmpty) row.company,
              row.hasDriver ? row.driverName : l10n.fltNoDriverNow,
            ].join(' · '),
            style: const TextStyle(color: AppColors.muted),
          ),
          const SizedBox(height: AppSpacing.sm),
          Wrap(
            spacing: 8,
            runSpacing: 6,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Text(
                l10n.fltRegistrationShort,
                style: const TextStyle(fontSize: 12),
              ),
              FleetExpiryChip(state: row.registration),
              if (paperwork && row.registrationExpiry.isNotEmpty)
                Text(
                  fleetDayLabel(row.registrationExpiry),
                  style: const TextStyle(fontSize: 12, color: AppColors.muted),
                ),
              Text(l10n.fltDiamondShort, style: const TextStyle(fontSize: 12)),
              FleetExpiryChip(state: row.diamond),
              if (paperwork && row.diamondExpiry.isNotEmpty)
                Text(
                  fleetDayLabel(row.diamondExpiry),
                  style: const TextStyle(fontSize: 12, color: AppColors.muted),
                ),
            ],
          ),
        ],
      ),
    );
  }
}
