/// The box sizes as the app shows them (docs/PACKAGE_BOX_SIZES_PAY_NOW.md
/// §4): a picture card per size, the words for a box piece, the sheet that
/// opens the 3D designer, and what a business sees of a box on a request.
library;

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/box_sizes.dart';
import '../services/package_price_list.dart' show boxSizeIds;
import '../services/package_requests.dart' show RequestPiece, RequestSize;
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import 'box_designer/box_designer.dart';
import 'box_designer/box_geometry.dart';

/// "Medium box" / "Boîte moyenne": what a piece of this size is called.
String boxPieceLabel(AppLocalizations l10n, String sizeId) => switch (sizeId) {
  'small' => l10n.boxLabelSmall,
  'medium' => l10n.boxLabelMedium,
  'large' => l10n.boxLabelLarge,
  'xl' => l10n.boxLabelXl,
  _ => sizeId,
};

/// One size as a picture card: the drawing (a sneaker beside the box for
/// scale), its name and what it is about as big as. Tap to choose it.
class BoxSizePictureCard extends StatelessWidget {
  const BoxSizePictureCard({
    super.key,
    required this.sizeId,
    required this.language,
    required this.selected,
    this.onTap,
    this.note,
  });

  final String sizeId;
  final String language;
  final bool selected;
  final VoidCallback? onTap;

  /// A line under the example ("The business will quote this size.").
  final String? note;

  @override
  Widget build(BuildContext context) {
    final name = boxSizeName(sizeId, language);
    return Semantics(
      button: onTap != null,
      selected: selected,
      label: '$name. ${boxSizeExample(sizeId, language)}',
      child: Material(
        color: selected ? AppColors.mist : AppColors.paper,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          side: BorderSide(
            color: selected ? AppColors.cobalt : AppColors.rule,
            width: selected ? 1.5 : 1,
          ),
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.sm),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                AspectRatio(
                  aspectRatio: 1.35,
                  child: Image.asset(
                    boxSizeAsset(sizeId),
                    fit: BoxFit.contain,
                    excludeFromSemantics: true,
                    errorBuilder: (_, _, _) => const Center(
                      child: Icon(
                        Icons.inventory_2_outlined,
                        size: 40,
                        color: AppColors.muted,
                      ),
                    ),
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w700,
                    color: AppColors.ink,
                  ),
                ),
                Text(
                  boxSizeExample(sizeId, language),
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                    fontSize: 11.5,
                    height: 1.25,
                    color: AppColors.muted,
                  ),
                ),
                if (note != null && note!.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      note!,
                      style: const TextStyle(
                        fontSize: 11.5,
                        height: 1.25,
                        fontWeight: FontWeight.w600,
                        color: AppColors.warn,
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// The four size cards, two by two.
class BoxSizePicker extends StatelessWidget {
  const BoxSizePicker({
    super.key,
    required this.language,
    required this.selected,
    required this.onChanged,
    this.quoteNote,
    this.keyPrefix = 'box-size',
  });

  final String language;
  final String selected;
  final ValueChanged<String> onChanged;

  /// Said under Extra large.
  final String? quoteNote;
  final String keyPrefix;

  @override
  Widget build(BuildContext context) {
    final ids = boxSizeIds;
    Widget card(String id) => Expanded(
      child: BoxSizePictureCard(
        key: Key('$keyPrefix:$id'),
        sizeId: id,
        language: language,
        selected: selected == id,
        note: id == boxSizeXl ? quoteNote : null,
        onTap: () => onChanged(id),
      ),
    );
    return Column(
      children: [
        for (var i = 0; i < ids.length; i += 2) ...[
          if (i > 0) const SizedBox(height: AppSpacing.sm),
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                card(ids[i]),
                const SizedBox(width: AppSpacing.sm),
                if (i + 1 < ids.length) card(ids[i + 1]) else const Spacer(),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

/// The designer in a sheet: the customer sizes the box and taps "Use these
/// inches". Answers the inches, or null when the sheet is dismissed.
Future<BoxDims?> showBoxDesignerSheet(
  BuildContext context, {
  BoxDims? initial,
  BoxBadgePrice badgePrice = BoxBadgePrice.none,
  int? Function(String sizeId)? priceCentsFor,
}) {
  return showModalBottomSheet<BoxDims>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    backgroundColor: AppColors.cream,
    builder: (_) => _BoxDesignerSheet(
      initial: initial ?? BoxDims.start,
      badgePrice: badgePrice,
      priceCentsFor: priceCentsFor,
    ),
  );
}

class _BoxDesignerSheet extends StatefulWidget {
  const _BoxDesignerSheet({
    required this.initial,
    required this.badgePrice,
    required this.priceCentsFor,
  });

  final BoxDims initial;
  final BoxBadgePrice badgePrice;
  final int? Function(String sizeId)? priceCentsFor;

  @override
  State<_BoxDesignerSheet> createState() => _BoxDesignerSheetState();
}

class _BoxDesignerSheetState extends State<_BoxDesignerSheet> {
  late BoxDims _dims = widget.initial;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return SingleChildScrollView(
      padding: EdgeInsets.fromLTRB(
        AppSpacing.lg,
        AppSpacing.md,
        AppSpacing.lg,
        AppSpacing.lg + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            l10n.boxDesignerTitle,
            style: const TextStyle(
              fontSize: 17,
              fontWeight: FontWeight.w700,
              color: AppColors.ink,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          BoxDesigner(
            dims: _dims,
            onChanged: (d) => setState(() => _dims = d),
            badgePrice: widget.badgePrice,
            priceCentsFor: widget.priceCentsFor,
          ),
          const SizedBox(height: AppSpacing.md),
          FilledButton(
            key: const Key('box-designer-use'),
            onPressed: () => Navigator.of(context).pop(_dims),
            child: Text(l10n.boxDesignerUse),
          ),
        ],
      ),
    );
  }
}

/// What staff see of a box piece on a request: its picture, its size, the
/// inches the customer typed and - with inches - the same 3D box, read-only
/// and spinnable, behind a "See the 3D box" toggle.
class BoxPieceDetail extends StatefulWidget {
  const BoxPieceDetail({super.key, required this.piece});

  final RequestPiece piece;

  @override
  State<BoxPieceDetail> createState() => _BoxPieceDetailState();
}

class _BoxPieceDetailState extends State<BoxPieceDetail> {
  bool _open = false;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final language = Localizations.localeOf(context).languageCode;
    final piece = widget.piece;
    final RequestSize? typed = piece.dimsIn;
    final dims = typed == null
        ? null
        : BoxDims.fromMap({'l': typed.l, 'w': typed.w, 'h': typed.h});
    // The size the server stored; the inches say it when it did not.
    final id = piece.boxSize.isNotEmpty
        ? piece.boxSize
        : (dims == null ? '' : boxSizeIdOf(dims) ?? '');
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            SizedBox(
              width: 84,
              child: Image.asset(
                boxSizeAsset(id),
                fit: BoxFit.contain,
                excludeFromSemantics: true,
                errorBuilder: (_, _, _) => const Icon(
                  Icons.inventory_2_outlined,
                  size: 36,
                  color: AppColors.muted,
                ),
              ),
            ),
            const SizedBox(width: AppSpacing.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    (piece.quantity ?? 1) > 1
                        ? l10n.boxQuantityLine(
                            piece.quantity!,
                            boxSizeName(id, language),
                          )
                        : l10n.boxDetailSize(boxSizeName(id, language)),
                    key: const Key('box-detail-size'),
                    style: const TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w700,
                      color: AppColors.ink,
                    ),
                  ),
                  if (dims != null)
                    Text(
                      dims.text,
                      key: const Key('box-detail-inches'),
                      style: const TextStyle(
                        fontSize: 12.5,
                        color: AppColors.muted,
                      ),
                    ),
                ],
              ),
            ),
          ],
        ),
        if (dims != null) ...[
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              key: const Key('box-detail-toggle'),
              onPressed: () => setState(() => _open = !_open),
              icon: Icon(
                _open ? Icons.expand_less : Icons.threed_rotation,
                size: 18,
              ),
              label: Text(_open ? l10n.boxHide3d : l10n.boxSee3d),
            ),
          ),
          if (_open) BoxDesigner(key: const Key('box-detail-3d'), dims: dims),
        ],
      ],
    );
  }
}
