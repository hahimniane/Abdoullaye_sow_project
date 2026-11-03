/// The pieces of the customer's "Send a package" form that read prices:
/// quantity steppers, the sort and filter chips, a business's row in the
/// comparison, and the 2-hour window chips. Words only through
/// `AppLocalizations`; the rules are in `package_request_compare.dart`.
library;

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/package_price_list.dart';
import '../services/package_request_compare.dart';
import '../services/package_requests.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import '../utils/date_display.dart';
import 'package_request_widgets.dart';

// ---------------------------------------------------------------------------
// Words.
// ---------------------------------------------------------------------------

/// A "YYYY-MM-DD" key as "Fri, Nov 7" ("ven. 7 nov."), else the key.
String compareDayText(String dayKey, String locale) {
  final day = requestDayFromKey(dayKey);
  return day == null ? dayKey : displayWeekdayMonthDay(day, locale);
}

/// What a row says about its total: "$212.00", "about $212.00",
/// "$120.00 + 2 to quote", or that the business sends a price.
String comparisonTotalText(AppLocalizations l10n, ComparisonRow row) {
  final basket = row.basket;
  return switch (row.priceKind) {
    RowPriceKind.total => formatRequestCents(basket.totalCents ?? 0),
    RowPriceKind.about => l10n.spkRowAbout(
      formatRequestCents(basket.totalCents ?? 0),
    ),
    RowPriceKind.partial => l10n.spkRowPartial(
      formatRequestCents(basket.pricedCents),
      '${basket.unpricedCount}',
    ),
    RowPriceKind.toQuote => l10n.spkRowToQuote,
  };
}

/// "Next flight: Fri, Nov 7" / "Next container: around Nov 22" / "Departure
/// date not confirmed"; null when the business named no departure.
String? departureText(
  AppLocalizations l10n,
  DepartureResult departure,
  String mode,
  String locale,
) {
  if (departure.source == 'unconfirmed') return l10n.spkDepartureUnconfirmed;
  final day = requestDayFromKey(departure.dateKey);
  if (day == null) return null;
  final when = departure.approximate
      ? l10n.spkAroundDate(displayMonthDay(day, locale))
      : displayWeekdayMonthDay(day, locale);
  return mode == 'air' ? l10n.spkNextFlight(when) : l10n.spkNextContainer(when);
}

/// Why a business cannot be chosen, in words.
String unavailableText(AppLocalizations l10n, String reason) =>
    switch (reason) {
      'bring_in_unavailable' => l10n.spkNoDropOff,
      'pickup_out_of_range' => l10n.spkErrPickupOutOfRange,
      'pickup_origin_missing' => l10n.spkErrPickupOrigin,
      _ => l10n.spkNoPickupThere,
    };

String sortLabel(AppLocalizations l10n, String sort) => switch (sort) {
  'price' => l10n.spkSortPrice,
  'rating' => l10n.spkSortRating,
  'soonest' => l10n.spkSortSoonest,
  _ => l10n.spkSortBest,
};

// ---------------------------------------------------------------------------
// Quantity.
// ---------------------------------------------------------------------------

/// "− 2 +": one more, one less.
class RequestQuantityStepper extends StatelessWidget {
  const RequestQuantityStepper({
    super.key,
    required this.quantity,
    required this.onChanged,
    required this.keyPrefix,
    this.max = requestMaxQuantity,
    this.enabled = true,
  });

  final int quantity;
  final ValueChanged<int> onChanged;
  final String keyPrefix;
  final int max;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    Widget button(IconData icon, String tip, String name, VoidCallback? tap) =>
        IconButton(
          key: Key('$keyPrefix:$name'),
          tooltip: tip,
          visualDensity: VisualDensity.compact,
          onPressed: tap,
          icon: Icon(icon, size: 20),
          color: AppColors.cobaltDeep,
          disabledColor: AppColors.rule,
        );
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        button(
          Icons.remove_circle_outline,
          l10n.spkOneLess,
          'minus',
          enabled && quantity > 0 ? () => onChanged(quantity - 1) : null,
        ),
        SizedBox(
          width: 26,
          child: Text(
            '$quantity',
            key: Key('$keyPrefix:qty'),
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 15,
              fontWeight: FontWeight.w700,
              color: quantity > 0 ? AppColors.ink : AppColors.muted,
            ),
          ),
        ),
        button(
          Icons.add_circle_outline,
          l10n.spkOneMore,
          'plus',
          enabled && quantity < max ? () => onChanged(quantity + 1) : null,
        ),
      ],
    );
  }
}

/// One thing to add: its name, what its price covers, a stepper.
class RequestCatalogRow extends StatelessWidget {
  const RequestCatalogRow({
    super.key,
    required this.title,
    required this.quantity,
    required this.onChanged,
    required this.keyPrefix,
    this.note,
    this.max = requestMaxQuantity,
  });

  final String title;
  final String? note;
  final int quantity;
  final ValueChanged<int> onChanged;
  final String keyPrefix;
  final int max;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.only(bottom: AppSpacing.sm),
      padding: const EdgeInsets.fromLTRB(AppSpacing.md, 6, 6, 6),
      decoration: BoxDecoration(
        color: quantity > 0 ? AppColors.mist : AppColors.parchment,
        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
        border: Border.all(
          color: quantity > 0 ? AppColors.cobalt : AppColors.rule,
          width: quantity > 0 ? 1.5 : 1,
        ),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
                if (note != null && note!.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      note!,
                      style: const TextStyle(
                        fontSize: 12,
                        height: 1.3,
                        color: AppColors.muted,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          RequestQuantityStepper(
            keyPrefix: keyPrefix,
            quantity: quantity,
            onChanged: onChanged,
            max: max,
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Sort and filters.
// ---------------------------------------------------------------------------

/// A pill the customer taps to switch a sort or a filter.
class RequestPill extends StatelessWidget {
  const RequestPill({
    super.key,
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return PressableScale(
      scale: 0.97,
      onTap: onTap,
      child: AnimatedContainer(
        duration: AppMotion.press,
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: selected ? AppColors.mist : AppColors.parchment,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(
            color: selected ? AppColors.cobalt : AppColors.rule,
            width: selected ? 1.5 : 1,
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            fontSize: 12.5,
            fontWeight: FontWeight.w700,
            color: selected ? AppColors.cobaltDeep : AppColors.ink,
          ),
        ),
      ),
    );
  }
}

/// The four sorts and three filters above the comparison.
class RequestCompareControls extends StatelessWidget {
  const RequestCompareControls({
    super.key,
    required this.sort,
    required this.filters,
    required this.onSort,
    required this.onFilters,
  });

  final String sort;
  final CompareFilters filters;
  final ValueChanged<String> onSort;
  final ValueChanged<CompareFilters> onFilters;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: AppSpacing.sm,
          runSpacing: AppSpacing.sm,
          children: [
            for (final s in priceSorts)
              RequestPill(
                key: Key('request-sort:$s'),
                label: sortLabel(l10n, s),
                selected: sort == s,
                onTap: () => onSort(s),
              ),
          ],
        ),
        const SizedBox(height: AppSpacing.sm),
        Wrap(
          spacing: AppSpacing.sm,
          runSpacing: AppSpacing.sm,
          children: [
            RequestPill(
              key: const Key('request-filter:picksUp'),
              label: l10n.spkFilterPicksUp,
              selected: filters.picksUp,
              onTap: () =>
                  onFilters(filters.copyWith(picksUp: !filters.picksUp)),
            ),
            RequestPill(
              key: const Key('request-filter:paysBack'),
              label: l10n.spkFilterPaysBack,
              selected: filters.paysBack,
              onTap: () =>
                  onFilters(filters.copyWith(paysBack: !filters.paysBack)),
            ),
            RequestPill(
              key: const Key('request-filter:rated'),
              label: l10n.spkFilterRated,
              selected: filters.rated,
              onTap: () => onFilters(filters.copyWith(rated: !filters.rated)),
            ),
          ],
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// A business in the comparison.
// ---------------------------------------------------------------------------

class RequestComparisonCard extends StatelessWidget {
  const RequestComparisonCard({
    super.key,
    required this.row,
    required this.selected,
    required this.onTap,
    required this.locale,
    this.showRadio = true,
  });

  final ComparisonRow row;
  final bool selected;
  final VoidCallback onTap;
  final String locale;
  final bool showRadio;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final option = row.option;
    final departure = departureText(l10n, row.departure, row.mode, locale);
    final fee = row.pickupFeeCents;
    final enabled = row.available;
    final muted = enabled ? AppColors.ink : AppColors.muted;
    return Opacity(
      opacity: enabled ? 1 : 0.6,
      child: PressableScale(
        onTap: enabled ? onTap : null,
        scale: 0.99,
        child: AnimatedContainer(
          duration: AppMotion.press,
          margin: const EdgeInsets.only(bottom: AppSpacing.sm),
          padding: const EdgeInsets.all(AppSpacing.md),
          decoration: BoxDecoration(
            color: selected ? AppColors.mist : AppColors.parchment,
            borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
            border: Border.all(
              color: selected ? AppColors.cobalt : AppColors.rule,
              width: selected ? 1.5 : 1,
            ),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (showRadio) ...[
                    Icon(
                      selected
                          ? Icons.radio_button_checked
                          : Icons.radio_button_off,
                      size: 18,
                      color: selected ? AppColors.cobalt : AppColors.muted,
                    ),
                    const SizedBox(width: AppSpacing.sm),
                  ],
                  Expanded(
                    child: Text(
                      option.businessName,
                      style: TextStyle(
                        fontSize: 14.5,
                        fontWeight: FontWeight.w700,
                        color: muted,
                      ),
                    ),
                  ),
                  if (enabled) ...[
                    const SizedBox(width: AppSpacing.sm),
                    Flexible(
                      child: Text(
                        comparisonTotalText(l10n, row),
                        key: Key('request-row-total:${option.businessId}'),
                        textAlign: TextAlign.end,
                        style: const TextStyle(
                          fontSize: 14.5,
                          fontWeight: FontWeight.w800,
                          color: AppColors.cobaltDeep,
                        ),
                      ),
                    ),
                  ],
                ],
              ),
              if (enabled && (fee != null || row.feePending))
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Align(
                    alignment: Alignment.centerRight,
                    child: Text(
                      fee != null
                          ? l10n.spkPickupIncluded(formatRequestCents(fee))
                          : l10n.spkPickupFeePending,
                      style: const TextStyle(
                        fontSize: 11.5,
                        color: AppColors.muted,
                      ),
                    ),
                  ),
                ),
              const SizedBox(height: 4),
              Text(
                option.hasRating
                    ? l10n.spkRating(
                        option.rating!.toStringAsFixed(1),
                        '${option.reviewCount}',
                      )
                    : l10n.spkNoRating,
                key: Key('request-row-rating:${option.businessId}'),
                style: const TextStyle(fontSize: 12.5, color: AppColors.muted),
              ),
              if (departure != null)
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Text(
                    departure,
                    key: Key('request-row-departure:${option.businessId}'),
                    style: const TextStyle(
                      fontSize: 12.5,
                      color: AppColors.muted,
                    ),
                  ),
                ),
              if (!enabled)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    unavailableText(l10n, row.unavailableReason),
                    key: Key('request-row-unavailable:${option.businessId}'),
                    style: const TextStyle(
                      fontSize: 12.5,
                      fontWeight: FontWeight.w600,
                      color: AppColors.errorRed,
                    ),
                  ),
                )
              else if (option.collectAvailable || option.coversLoss)
                Padding(
                  padding: const EdgeInsets.only(top: 6),
                  child: Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      if (option.collectAvailable)
                        RequestBadge(
                          icon: Icons.local_shipping_outlined,
                          label: l10n.spkFilterPicksUp,
                        ),
                      if (option.coversLoss)
                        RequestBadge(
                          icon: Icons.verified_user_outlined,
                          label: l10n.spkFilterPaysBack,
                          color: AppColors.sage,
                        ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Windows.
// ---------------------------------------------------------------------------

/// The 2-hour windows of a day, one tap each.
class RequestWindowChips extends StatelessWidget {
  const RequestWindowChips({
    super.key,
    required this.windows,
    required this.selected,
    required this.onChanged,
    required this.keyPrefix,
    required this.languageCode,
  });

  final List<RequestTimeWindow> windows;

  /// `requestWindowKey` of the chosen window, or ''.
  final String selected;
  final ValueChanged<RequestTimeWindow> onChanged;
  final String keyPrefix;
  final String languageCode;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: AppSpacing.sm,
      runSpacing: AppSpacing.sm,
      children: [
        for (final w in windows)
          RequestPill(
            key: Key('$keyPrefix:${requestWindowKey(w)}'),
            label:
                requestWindowShortText(w.from, w.to, languageCode) ??
                requestWindowKey(w),
            selected: selected == requestWindowKey(w),
            onTap: () => onChanged(w),
          ),
      ],
    );
  }
}
