import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/sales_history.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../utils/date_display.dart';

/// The two ends of a custom sales range, each a button that opens a
/// calendar, and in words why a pair of ends cannot be shown. The screen
/// owns the dates and the check; this only draws and reports taps.
class SalesRangeBar extends StatelessWidget {
  const SalesRangeBar({
    super.key,
    required this.from,
    required this.to,
    required this.problem,
    required this.onPickFrom,
    required this.onPickTo,
  });

  /// Wall dates (UTC fields), both ends included.
  final DateTime from;
  final DateTime to;
  final SalesRangeProblem? problem;
  final VoidCallback onPickFrom;
  final VoidCallback onPickTo;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final locale = dateLocaleOf(context);
    Widget end(Key key, String label, DateTime day, VoidCallback onTap) =>
        Expanded(
          child: OutlinedButton(
            key: key,
            onPressed: onTap,
            style: OutlinedButton.styleFrom(
              padding: const EdgeInsets.symmetric(
                horizontal: AppSpacing.sm,
                vertical: AppSpacing.sm,
              ),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  label,
                  style: const TextStyle(fontSize: 11, color: AppColors.muted),
                ),
                Text(
                  displayDate(wallDayAsLocal(day), locale),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
              ],
            ),
          ),
        );
    final error = switch (problem) {
      SalesRangeProblem.backwards => l10n.extHistoryRangeBackwards,
      SalesRangeProblem.tooLong => l10n.extHistoryRangeTooLong(
        salesMaxCustomDays,
      ),
      null => null,
    };
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            end(
              const Key('hist-range-from'),
              l10n.extHistoryRangeFrom,
              from,
              onPickFrom,
            ),
            const SizedBox(width: AppSpacing.sm),
            end(
              const Key('hist-range-to'),
              l10n.extHistoryRangeTo,
              to,
              onPickTo,
            ),
          ],
        ),
        if (error != null)
          Padding(
            padding: const EdgeInsets.only(top: AppSpacing.sm),
            child: Text(
              error,
              key: const Key('hist-range-error'),
              style: const TextStyle(
                color: AppColors.errorRed,
                fontWeight: FontWeight.w600,
                fontSize: 13,
                height: 1.35,
              ),
            ),
          ),
      ],
    );
  }
}
