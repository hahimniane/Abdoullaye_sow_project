import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/business_home.dart';
import '../theme/app_spacing.dart';
import 'home_destinations.dart';

/// The business home's blocks in the order [parts] gives (see [homeParts]).
///
/// Only the order lives here; every block is built by the caller, from the
/// gates the home already uses. The shop block leads with the business name,
/// the bell and the language switch when it comes first ([shop] is asked for
/// a leading block); when it follows another block those controls are in the
/// [header] instead, and the shop block sits at the end of the services
/// block, under its own label, so it is never lost between a feed's header
/// and its rows.
class BusinessHomeColumn extends StatelessWidget {
  const BusinessHomeColumn({
    super.key,
    required this.parts,
    required this.header,
    required this.shop,
    required this.shipping,
    required this.services,
    this.todayRow,
    this.lead = const [],
    this.foldLabel = '',
  });

  final List<HomePart> parts;

  /// The business name with the bell and the language switch; used whenever
  /// the shop block does not lead (it carries its own header when it does).
  final Widget header;

  /// The shop block; `leading` is true when it comes first and so carries
  /// the header.
  final Widget Function(bool leading) shop;

  /// The simple shipping block.
  final Widget Function() shipping;

  /// The standard services block; [shopBelow] is the shop block (labelled)
  /// when it follows the services, to be drawn at the end of it.
  final Widget Function(Widget? shopBelow) services;

  /// The quiet Today / Fleet rows that sit under the first block's header.
  final Widget? todayRow;

  /// Blocks that head the home before everything else (see [homeLeads]):
  /// Fleet, then Requests, for a plate-leasing business. When given, the
  /// header always comes first and the usual blocks follow, folded under
  /// [foldLabel] (docs/FLEET.md section 17).
  final List<Widget> lead;
  final String foldLabel;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final leads = lead.isNotEmpty;
    final shopLeads =
        !leads && parts.isNotEmpty && parts.first == HomePart.shop;
    final hasServices = parts.contains(HomePart.services);
    final shopFollows = !shopLeads && parts.contains(HomePart.shop);
    final shopBlock = shopFollows
        ? Column(
            key: const Key('home-shop-below'),
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              HomeSectionLabel(l10n.inventoryTitle),
              const SizedBox(height: AppSpacing.sm),
              shop(false),
            ],
          )
        : null;
    final blocks = [
      for (final part in parts)
        switch (part) {
          HomePart.shop =>
            shopLeads || hasServices
                ? const SizedBox.shrink()
                : (shopBlock ?? const SizedBox.shrink()),
          HomePart.shipping => Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              shipping(),
              if (parts.length > 1) const SizedBox(height: AppSpacing.xl),
            ],
          ),
          HomePart.services => services(shopBlock),
        },
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (shopLeads) ...[
          shop(true),
          const SizedBox(height: AppSpacing.xl),
        ] else ...[
          header,
          const SizedBox(height: 16),
        ],
        if (leads) ...[
          for (final block in lead) ...[
            block,
            const SizedBox(height: AppSpacing.lg),
          ],
          ?todayRow,
          if (parts.isNotEmpty)
            HomeFold(
              key: const Key('home-more-fold'),
              label: foldLabel,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: blocks,
              ),
            ),
        ] else ...[
          ?todayRow,
          ...blocks,
        ],
      ],
    );
  }
}
