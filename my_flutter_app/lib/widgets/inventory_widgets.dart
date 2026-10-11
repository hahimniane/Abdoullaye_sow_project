import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../screens/package_payment_sheet.dart' show containerPaymentMethodLabel;
import '../services/inventory.dart';
import '../services/lot_ledger.dart' show LotStaff;
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import 'app_back_button.dart';

/// The words and small pieces the inventory screens share, so a refusal, a
/// stock chip and a payment method read the same on every one of them.

/// The payment method as a person says it (the invoice words).
String inventoryPaymentLabel(AppLocalizations l10n, String method) =>
    containerPaymentMethodLabel(l10n, method);

/// What a failed call says, in the reader's language.
String inventoryFailureText(AppLocalizations l10n, InventoryFailure failure) =>
    switch (failure) {
      InventoryFailure.network => l10n.inventoryNetworkError,
      InventoryFailure.itemArchived => l10n.inventoryFailArchived,
      InventoryFailure.itemNotFound => l10n.inventoryFailNotFound,
      InventoryFailure.saleVoided => l10n.inventoryFailVoided,
      InventoryFailure.noPermission => l10n.inventoryFailNoPermission,
      InventoryFailure.invalid => l10n.inventoryFailInvalid,
      InventoryFailure.unknown => l10n.inventoryFailUnknown,
    };

/// The product form's refusal codes, in words.
String inventoryFieldErrorText(AppLocalizations l10n, String code) =>
    switch (code) {
      'name_required' => l10n.inventoryErrNameRequired,
      'name_too_long' => l10n.inventoryErrNameTooLong,
      'price_invalid' => l10n.inventoryErrPrice,
      'cost_invalid' => l10n.inventoryErrCost,
      'quantity_invalid' => l10n.inventoryErrQuantity,
      'low_stock_invalid' => l10n.inventoryErrLowStock,
      'photo_invalid' => l10n.inventoryErrPhoto,
      _ => l10n.inventoryFailInvalid,
    };

String inventoryMovementLabel(AppLocalizations l10n, String type) =>
    switch (type) {
      'initial' => l10n.inventoryMoveInitial,
      'add' => l10n.inventoryMoveAdd,
      'set' => l10n.inventoryMoveSet,
      'sale' => l10n.inventoryMoveSale,
      'void' => l10n.inventoryMoveVoid,
      _ => type,
    };

/// A person's name from the team list; blank when unknown.
String inventoryStaffName(List<LotStaff> staff, String id) {
  if (id.isEmpty) return '';
  for (final member in staff) {
    if (member.id == id) return member.name;
  }
  return '';
}

/// "+5" / "-2" for a stock change.
String inventoryDeltaText(int delta) => delta > 0 ? '+$delta' : '$delta';

/// The title bar every inventory screen wears: back, title, an optional line
/// under it, and actions at the right.
class InventoryHeader extends StatelessWidget {
  const InventoryHeader({
    super.key,
    required this.title,
    this.subtitle,
    this.actions = const [],
  });

  final String title;
  final String? subtitle;
  final List<Widget> actions;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: AppColors.paper,
        border: Border(
          bottom: BorderSide(color: AppColors.rule.withValues(alpha: 0.8)),
        ),
      ),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(4, 4, AppSpacing.sm, AppSpacing.md),
          child: Row(
            children: [
              const AppBackButton(),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w700,
                        height: 1.1,
                        letterSpacing: -0.4,
                        color: AppColors.ink,
                      ),
                    ),
                    if (subtitle != null && subtitle!.isNotEmpty)
                      Text(
                        subtitle!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: const TextStyle(
                          fontSize: 12,
                          height: 1.3,
                          color: AppColors.muted,
                        ),
                      ),
                  ],
                ),
              ),
              ...actions,
            ],
          ),
        ),
      ),
    );
  }
}

/// A small coloured chip: a word on a tinted background.
class InventoryChip extends StatelessWidget {
  const InventoryChip({super.key, required this.label, required this.color});

  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: 10.5,
          fontWeight: FontWeight.w700,
          letterSpacing: 0.3,
          color: color,
        ),
      ),
    );
  }
}

/// Where a product's count stands: In stock, Low, Out - and "Count was off"
/// and "Archived" when they apply.
class InventoryStatusChips extends StatelessWidget {
  const InventoryStatusChips({super.key, required this.item});

  final InventoryItem item;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Wrap(
      spacing: 6,
      runSpacing: 4,
      children: [
        switch (item.stock) {
          InventoryStock.out => InventoryChip(
              key: const Key('inv-chip-out'),
              label: l10n.inventoryOut,
              color: AppColors.errorRed,
            ),
          InventoryStock.low => InventoryChip(
              key: const Key('inv-chip-low'),
              label: l10n.inventoryLow,
              color: AppColors.warn,
            ),
          InventoryStock.ok => InventoryChip(
              key: const Key('inv-chip-ok'),
              label: l10n.inventoryInStock,
              color: AppColors.sage,
            ),
        },
        if (item.countWasOff)
          InventoryChip(
            key: const Key('inv-chip-count-off'),
            label: l10n.inventoryCountWasOff,
            color: AppColors.warn,
          ),
        if (item.archived)
          InventoryChip(
            key: const Key('inv-chip-archived'),
            label: l10n.inventoryArchivedChip,
            color: AppColors.muted,
          ),
      ],
    );
  }
}

/// A product's photo in a small clipped square; a plain placeholder when it
/// has none or the link does not load.
class InventoryPhoto extends StatelessWidget {
  const InventoryPhoto({super.key, required this.url, this.size = 44});

  final String url;
  final double size;

  @override
  Widget build(BuildContext context) {
    final placeholder = Container(
      width: size,
      height: size,
      color: AppColors.parchment,
      child: Icon(Icons.inventory_2_outlined,
          size: size * 0.5, color: AppColors.muted),
    );
    return ClipRRect(
      borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
      child: SizedBox(
        width: size,
        height: size,
        child: url.isEmpty
            ? placeholder
            : Image.network(
                url,
                width: size,
                height: size,
                fit: BoxFit.cover,
                errorBuilder: (_, _, _) => placeholder,
                loadingBuilder: (context, child, progress) =>
                    progress == null ? child : placeholder,
              ),
      ),
    );
  }
}

/// An inline notice: an error (red) or a heads-up (amber), with an icon.
class InventoryNote extends StatelessWidget {
  const InventoryNote({
    super.key,
    required this.text,
    this.error = true,
    this.trailing,
  });

  final String text;
  final bool error;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final color = error ? AppColors.errorRed : AppColors.warn;
    return Container(
      padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md, vertical: AppSpacing.sm),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(error ? Icons.error_outline : Icons.warning_amber_rounded,
              size: 16, color: color),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              text,
              style: TextStyle(fontSize: 12.5, height: 1.35, color: color),
            ),
          ),
          ?trailing,
        ],
      ),
    );
  }
}

/// A figure with its label underneath, for the summary row.
class InventoryFigure extends StatelessWidget {
  const InventoryFigure({super.key, required this.value, required this.label});

  final String value;
  final String label;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        FittedBox(
          fit: BoxFit.scaleDown,
          alignment: Alignment.centerLeft,
          child: Text(
            value,
            style: const TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w700,
              color: AppColors.ink,
            ),
          ),
        ),
        Text(
          label,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(
              fontSize: 11.5, height: 1.25, color: AppColors.muted),
        ),
      ],
    );
  }
}
