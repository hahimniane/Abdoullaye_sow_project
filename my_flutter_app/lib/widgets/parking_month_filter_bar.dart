import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/parking_lots.dart' show ParkingLot;
import '../services/parking_month_table.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';

/// Month end's search box, sort and filter chips (Part paid, Team members,
/// Owes from before, Invoice not delivered) with "Clear filters", as on the
/// website. A chip with nothing behind it hides itself unless it is on (so
/// it can be turned off). The search text lives in [controller], owned by
/// the screen, so scrolling the bar away does not lose it.
class ParkingMonthFilterBar extends StatelessWidget {
  const ParkingMonthFilterBar({
    super.key,
    required this.filter,
    required this.counts,
    required this.onChanged,
    required this.controller,
    this.lots = const [],
  });

  /// The business's parking lots: with two or more, "Which lot" narrows the
  /// list to customers with a car there (docs/PARKING_LOTS.md).
  final List<ParkingLot> lots;

  final MonthTableFilter filter;
  final MonthTableCounts counts;
  final ValueChanged<MonthTableFilter> onChanged;
  final TextEditingController controller;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    Widget chip(
      String keyName,
      String label,
      int count,
      bool on,
      MonthTableFilter Function(bool next) toggle,
    ) {
      if (count <= 0 && !on) return const SizedBox.shrink();
      return FilterChip(
        key: Key('month-end-chip-$keyName'),
        label: Text(l10n.pmeFltChip(label, '$count')),
        selected: on,
        showCheckmark: false,
        onSelected: (next) => onChanged(toggle(next)),
      );
    }

    final chips = [
      chip(
        'part',
        l10n.pmeFltPart,
        counts.part,
        filter.part,
        (v) => filter.copyWith(part: v),
      ),
      chip(
        'team',
        l10n.pmeFltTeam,
        counts.team,
        filter.team,
        (v) => filter.copyWith(team: v),
      ),
      chip(
        'older',
        l10n.pmeFltOlder,
        counts.older,
        filter.older,
        (v) => filter.copyWith(older: v),
      ),
      chip(
        'not-delivered',
        l10n.pmeFltNotDelivered,
        counts.notDelivered,
        filter.notDelivered,
        (v) => filter.copyWith(notDelivered: v),
      ),
    ];
    return Padding(
      key: const Key('month-end-filter-bar'),
      padding: const EdgeInsets.only(bottom: AppSpacing.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            key: const Key('month-end-search'),
            controller: controller,
            textInputAction: TextInputAction.search,
            onChanged: (query) => onChanged(filter.copyWith(query: query)),
            decoration: InputDecoration(
              prefixIcon: const Icon(Icons.search, size: 20),
              labelText: l10n.pmeFltSearchLabel,
              hintText: l10n.pmeFltSearchHint,
              hintMaxLines: 1,
              isDense: true,
            ),
          ),
          if (lots.length >= 2) ...[
            const SizedBox(height: AppSpacing.sm),
            Row(
              children: [
                Text(
                  l10n.pltLotLabel,
                  style: const TextStyle(
                    fontSize: 12.5,
                    color: AppColors.muted,
                  ),
                ),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: DropdownButton<String>(
                    key: const Key('month-end-lot'),
                    // A lot that is gone reads as every lot.
                    value: lots.any((lot) => lot.id == filter.lotId)
                        ? filter.lotId
                        : '',
                    isExpanded: true,
                    isDense: true,
                    underline: const SizedBox.shrink(),
                    items: [
                      DropdownMenuItem(
                        value: '',
                        child: Text(
                          l10n.pltStripAll,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      for (final lot in lots)
                        DropdownMenuItem(
                          value: lot.id,
                          child: Text(
                            lot.name,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                    ],
                    onChanged: (lotId) {
                      if (lotId != null) {
                        onChanged(filter.copyWith(lotId: lotId));
                      }
                    },
                  ),
                ),
              ],
            ),
          ],
          const SizedBox(height: AppSpacing.sm),
          Row(
            children: [
              Text(
                l10n.pmeFltSort,
                style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: DropdownButton<MonthTableSort>(
                  key: const Key('month-end-sort'),
                  value: filter.sort,
                  isExpanded: true,
                  isDense: true,
                  underline: const SizedBox.shrink(),
                  items: [
                    DropdownMenuItem(
                      value: MonthTableSort.owed,
                      child: Text(
                        l10n.pmeFltSortOwed,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    DropdownMenuItem(
                      value: MonthTableSort.name,
                      child: Text(
                        l10n.pmeFltSortName,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                    DropdownMenuItem(
                      value: MonthTableSort.cars,
                      child: Text(
                        l10n.pmeFltSortCars,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ],
                  onChanged: (sort) {
                    if (sort != null) onChanged(filter.copyWith(sort: sort));
                  },
                ),
              ),
            ],
          ),
          if (chips.any((c) => c is! SizedBox) || filter.narrowed) ...[
            const SizedBox(height: AppSpacing.xs),
            Wrap(
              spacing: AppSpacing.sm,
              runSpacing: AppSpacing.xs,
              children: [
                ...chips,
                if (filter.narrowed)
                  TextButton.icon(
                    key: const Key('month-end-clear-filters'),
                    onPressed: () {
                      controller.clear();
                      onChanged(filter.cleared());
                    },
                    icon: const Icon(Icons.close, size: 16),
                    label: Text(l10n.pmeFltClear),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
