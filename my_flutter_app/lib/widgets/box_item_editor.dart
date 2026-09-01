import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../utils/freight_contents.dart';

/// The box, one tile per item.
///
/// Adding is a bottom-sheet pick, never an inline dropdown: the customer
/// taps the item and it lands in the box at one. Counting is a - 1 + pill
/// on the tile; minus at one takes the item back out. The keyboard appears
/// only for an item the platform has no name for.

/// One row the picker can offer: an item, in a category, maybe with the
/// business's set price on it.
class BoxPickerSection {
  const BoxPickerSection({
    required this.categoryId,
    required this.label,
    this.items = const [],
    this.allowCustom = false,
  });

  final String categoryId;
  final String label;
  final List<({String itemId, String label, int? priceCents})> items;

  /// Whether "something else" can be named under this category.
  final bool allowCustom;
}

class BoxItemTile extends StatelessWidget {
  const BoxItemTile({
    super.key,
    required this.label,
    this.subtitle,
    required this.quantity,
    required this.enabled,
    required this.onQuantity,
  });

  final String label;
  final String? subtitle;
  final int quantity;
  final bool enabled;

  /// Called with the new count; zero means the item leaves the box.
  final ValueChanged<int> onQuantity;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.fromLTRB(14, 10, 8, 10),
      decoration: BoxDecoration(
        color: theme.colorScheme.surface,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: theme.colorScheme.outlineVariant.withValues(alpha: 0.6),
        ),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: theme.textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
                if ((subtitle ?? '').isNotEmpty) ...[
                  const SizedBox(height: 2),
                  Text(
                    subtitle!,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.hintColor,
                    ),
                  ),
                ],
              ],
            ),
          ),
          const SizedBox(width: 8),
          _QuantityPill(
            quantity: quantity,
            enabled: enabled,
            onQuantity: onQuantity,
          ),
        ],
      ),
    );
  }
}

class _QuantityPill extends StatelessWidget {
  const _QuantityPill({
    required this.quantity,
    required this.enabled,
    required this.onQuantity,
  });

  final int quantity;
  final bool enabled;
  final ValueChanged<int> onQuantity;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          _PillButton(
            icon: quantity <= 1
                ? Icons.delete_outline
                : Icons.remove,
            enabled: enabled,
            onTap: () => onQuantity(quantity - 1),
          ),
          SizedBox(
            width: 26,
            child: Text(
              '$quantity',
              textAlign: TextAlign.center,
              style: theme.textTheme.titleSmall?.copyWith(
                fontWeight: FontWeight.w800,
              ),
            ),
          ),
          _PillButton(
            icon: Icons.add,
            enabled: enabled && quantity < maxItemQuantity,
            onTap: () => onQuantity(quantity + 1),
          ),
        ],
      ),
    );
  }
}

class _PillButton extends StatelessWidget {
  const _PillButton({
    required this.icon,
    required this.enabled,
    required this.onTap,
  });

  final IconData icon;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return InkWell(
      onTap: enabled ? onTap : null,
      borderRadius: BorderRadius.circular(999),
      child: Padding(
        padding: const EdgeInsets.all(9),
        child: Icon(
          icon,
          size: 19,
          color: enabled
              ? theme.colorScheme.onSurface
              : theme.disabledColor,
        ),
      ),
    );
  }
}

/// Full-width entry to the picker, styled like the tiles it adds to.
class AddBoxItemButton extends StatelessWidget {
  const AddBoxItemButton({super.key, required this.enabled, required this.onTap});

  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context)!;
    return OutlinedButton.icon(
      onPressed: enabled ? onTap : null,
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(46),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(14),
        ),
        side: BorderSide(
          color: theme.colorScheme.outlineVariant.withValues(alpha: 0.9),
        ),
      ),
      icon: const Icon(Icons.add, size: 20),
      label: Text(l10n.freightAddAnItem),
    );
  }
}

/// Bottom-sheet item picker. Resolves to the picked item at count one, or
/// null when dismissed. Naming happens inside the sheet, only for
/// "something else".
Future<ContentsItem?> showBoxItemPicker(
  BuildContext context, {
  required List<BoxPickerSection> sections,
}) {
  return showModalBottomSheet<ContentsItem>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (sheetContext) => _BoxItemPickerSheet(sections: sections),
  );
}

class _BoxItemPickerSheet extends StatefulWidget {
  const _BoxItemPickerSheet({required this.sections});

  final List<BoxPickerSection> sections;

  @override
  State<_BoxItemPickerSheet> createState() => _BoxItemPickerSheetState();
}

class _BoxItemPickerSheetState extends State<_BoxItemPickerSheet> {
  final _nameController = TextEditingController();

  /// Set once "something else" is tapped; the sheet becomes a name field
  /// for exactly that category.
  BoxPickerSection? _namingIn;

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context)!;
    final maxHeight = MediaQuery.of(context).size.height * 0.72;
    final naming = _namingIn;

    return AnimatedPadding(
      duration: const Duration(milliseconds: 150),
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom,
      ),
      child: SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: maxHeight),
          child: naming == null
              ? _pickList(theme, l10n)
              : _nameForm(theme, l10n, naming),
        ),
      ),
    );
  }

  Widget _pickList(ThemeData theme, AppLocalizations l10n) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(20, 0, 20, 6),
          child: Row(
            children: [
              Expanded(
                child: Text(
                  l10n.freightAddAnItem,
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
        ),
        Flexible(
          child: ListView(
            shrinkWrap: true,
            padding: const EdgeInsets.only(bottom: 12),
            children: [
              for (final section in widget.sections) ...[
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 14, 20, 4),
                  child: Text(
                    section.label,
                    style: theme.textTheme.labelLarge?.copyWith(
                      color: theme.hintColor,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                for (final item in section.items)
                  InkWell(
                    onTap: () => Navigator.of(context).pop(
                      ContentsItem(
                        categoryId: section.categoryId,
                        itemId: item.itemId,
                        label: item.label,
                      ),
                    ),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 20,
                        vertical: 12,
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(
                              item.label,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: theme.textTheme.bodyLarge,
                            ),
                          ),
                          if (item.priceCents != null)
                            Text(
                              '\$${(item.priceCents! / 100).toStringAsFixed(2)}',
                              style: theme.textTheme.titleSmall?.copyWith(
                                fontWeight: FontWeight.w800,
                                color: theme.colorScheme.primary,
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                if (section.allowCustom)
                  InkWell(
                    onTap: () => setState(() => _namingIn = section),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: 20,
                        vertical: 12,
                      ),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(
                              l10n.somethingElseInCategory,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: theme.textTheme.bodyLarge?.copyWith(
                                color: theme.hintColor,
                              ),
                            ),
                          ),
                          Icon(
                            Icons.edit_outlined,
                            size: 18,
                            color: theme.hintColor,
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
            ],
          ),
        ),
      ],
    );
  }

  Widget _nameForm(
    ThemeData theme,
    AppLocalizations l10n,
    BoxPickerSection naming,
  ) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 20, 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              IconButton(
                onPressed: () => setState(() => _namingIn = null),
                icon: const Icon(Icons.arrow_back),
              ),
              Expanded(
                child: Text(
                  naming.label,
                  style: theme.textTheme.titleMedium?.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 4),
          TextField(
            controller: _nameController,
            autofocus: true,
            maxLength: maxContentLabelLength,
            textCapitalization: TextCapitalization.sentences,
            onChanged: (_) => setState(() {}),
            onSubmitted: (_) => _submitName(naming),
            decoration: InputDecoration(
              labelText: l10n.freightItemNameLabel,
              counterText: '',
            ),
          ),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: _nameController.text.trim().isEmpty
                ? null
                : () => _submitName(naming),
            child: Text(l10n.add),
          ),
        ],
      ),
    );
  }

  void _submitName(BoxPickerSection naming) {
    final label = _nameController.text.trim();
    if (label.isEmpty) return;
    Navigator.of(context).pop(
      ContentsItem(categoryId: naming.categoryId, label: label),
    );
  }
}
