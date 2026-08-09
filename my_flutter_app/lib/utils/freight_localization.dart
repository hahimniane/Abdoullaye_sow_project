import 'package:intl/intl.dart';

import '../l10n/app_localizations.dart';
import '../services/freight_categories.dart';
import '../services/freight_coverage.dart';

/// EN/FR copy for freight categories and loss coverage.
///
/// The decisions live in the pure modules (`services/freight_categories.dart`
/// and `services/freight_coverage.dart`) and the words live here, the same
/// split `business_parking_localization.dart` uses: the server sends a
/// category id and a policy, never a sentence, so a French customer is never
/// shown an English one.

/// Money as this flow writes it everywhere else: US dollars, `$` in front.
///
/// Pinned to en_US on purpose. The freight screen prints rates as `$12.00`
/// from raw string interpolation; a French customer seeing `12,00 $US` beside
/// `$12.00` on the same card would reasonably wonder whether they are the same
/// currency. Cents are dropped for round figures so a ceiling reads as
/// "$2,000" rather than "$2,000.00".
String freightMoney(num amount) {
  final value = amount.toDouble();
  final format = NumberFormat.simpleCurrency(
    locale: 'en_US',
    decimalDigits: value == value.roundToDouble() ? 0 : 2,
  );
  return format.format(value);
}

/// A percent without a pointless decimal: `2%`, but `2.5%` when it matters.
String freightPercent(num value) {
  final rate = value.toDouble();
  return rate == rate.roundToDouble()
      ? '${rate.toStringAsFixed(0)}%'
      : '${rate.toStringAsFixed(1)}%';
}

/// A multiplier the way a customer can act on it: `1.2x`, `2x`.
String freightMultiplierText(double multiplier) {
  return multiplier == multiplier.roundToDouble()
      ? '${multiplier.toStringAsFixed(0)}×'
      : '${multiplier.toStringAsFixed(1)}×';
}

/// The name a customer reads for one category.
///
/// The platform owns the standard rows, so they are translated by id. A
/// business's own row keeps the words the business wrote - translating those
/// would mean guessing at what it meant.
String freightCategoryLabel(AppLocalizations l10n, FreightCategory category) =>
    switch (category.id) {
      'general' => l10n.freightCategoryGeneral,
      'clothing' => l10n.freightCategoryClothing,
      'food' => l10n.freightCategoryFood,
      'documents' => l10n.freightCategoryDocuments,
      'cosmetics' => l10n.freightCategoryCosmetics,
      'electronics' => l10n.freightCategoryElectronics,
      'fragile' => l10n.freightCategoryFragile,
      _ => category.label,
    };

/// The examples under the name, so a customer holding a charger knows which
/// row it belongs to.
String freightCategoryHint(AppLocalizations l10n, FreightCategory category) =>
    switch (category.id) {
      'general' => l10n.freightCategoryGeneralHint,
      'clothing' => l10n.freightCategoryClothingHint,
      'food' => l10n.freightCategoryFoodHint,
      'documents' => l10n.freightCategoryDocumentsHint,
      'cosmetics' => l10n.freightCategoryCosmeticsHint,
      'electronics' => l10n.freightCategoryElectronicsHint,
      'fragile' => l10n.freightCategoryFragileHint,
      _ => category.hint,
    };

/// What choosing this row does to the price, said out loud.
///
/// A row at 1 says so rather than staying silent: "standard rate" is what
/// makes the rows that cost more legible as the exception.
String freightCategoryRateText(
  AppLocalizations l10n,
  FreightCategory category,
) => category.changesPrice
    ? l10n.freightCategoryRateMultiplier(
        freightMultiplierText(category.multiplier),
      )
    : l10n.freightCategoryStandardRate;

/// The one line about coverage on an option card, before a business is
/// chosen: "Covers up to $2,000 · 2%" against "No coverage".
String freightCoverageSummaryText(
  AppLocalizations l10n,
  FreightCoveragePolicy? policy,
) => switch (freightCoverageSummaryOf(policy)) {
  FreightCoverageSummary.notOffered ||
  FreightCoverageSummary.noCoverage => l10n.freightCoverageNone,
  FreightCoverageSummary.coversWithCeiling => l10n.freightCoverageCoversUpTo(
    freightMoney(policy!.maxDeclaredValue),
    freightPercent(policy.ratePct),
  ),
  FreightCoverageSummary.coversNoCeiling => l10n.freightCoverageCoversLoss(
    freightPercent(policy!.ratePct),
  ),
};
