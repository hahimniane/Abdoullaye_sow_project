import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../l10n/app_localizations.dart';
import '../services/business_price_list.dart' show priceLbText;
import '../services/lot_ledger.dart' show formatLotCents;
import '../services/package_price_list.dart' show unitOf;
import '../services/price_list_fill.dart';
import '../theme/app_colors.dart';
import '../theme/app_motion.dart';
import '../theme/app_spacing.dart';
import 'lot_sheets.dart';

/// "From the price list" (docs/SHIPPING_SIMPLE_HOME.md P): the business's own
/// items and by-weight kinds for one destination and ship mode. Picking an
/// item asks how many; picking a by-weight kind asks the weight in the
/// list's unit. Answers the [PriceFill] to type into the piece, or null when
/// dismissed. The arithmetic is `pricePiece` (price_list_fill.dart), never a
/// second calculator here.
Future<PriceFill?> showPriceFillSheet(
  BuildContext context, {
  required Map<String, dynamic> route,
}) => showLotSheet<PriceFill>(context, PriceFillSheet(route: route));

class PriceFillSheet extends StatefulWidget {
  const PriceFillSheet({super.key, required this.route});

  /// The route the business priced for this package's country and mode.
  final Map<String, dynamic> route;

  @override
  State<PriceFillSheet> createState() => _PriceFillSheetState();
}

class _PriceFillSheetState extends State<PriceFillSheet> {
  final _weight = TextEditingController();
  PriceFillChoice? _picked;
  int _quantity = 1;
  String _error = '';

  @override
  void dispose() {
    _weight.dispose();
    super.dispose();
  }

  String get _lang => Localizations.localeOf(context).languageCode;

  String get _unit => unitOf(widget.route);

  PriceFillResult _result() {
    final picked = _picked!;
    return picked.byWeight
        ? fillFromWeight(
            widget.route,
            picked.id,
            _weight.text.trim().replaceAll(',', '.'),
            lang: _lang,
          )
        : fillFromItem(
            widget.route,
            picked.id,
            quantity: _quantity,
            lang: _lang,
          );
  }

  void _pick(PriceFillChoice choice) {
    AppHaptics.selection();
    setState(() {
      _picked = choice;
      _quantity = 1;
      _error = '';
      _weight.clear();
    });
  }

  void _use() {
    final l10n = AppLocalizations.of(context)!;
    final result = _result();
    final fill = result.fill;
    if (fill == null) {
      AppHaptics.refuse();
      setState(
        () => _error = switch (result.error) {
          'weight_kg_invalid' => l10n.spkErrWeightKg,
          'weight_invalid' => l10n.spkErrWeight,
          'quantity_invalid' => l10n.spkErrQuantity,
          _ => l10n.prqErrGeneric,
        },
      );
      return;
    }
    Navigator.of(context).pop(fill);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final picked = _picked;
    return LotSheetShell(
      title: l10n.pcsFromList,
      subtitle: picked?.label,
      footer: picked == null
          ? null
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                LotSheetButton(
                  key: const Key('fill-use'),
                  label: l10n.pcsFromListUse,
                  onTap: _use,
                ),
                TextButton(
                  key: const Key('fill-back'),
                  onPressed: () => setState(() {
                    _picked = null;
                    _error = '';
                  }),
                  child: Text(l10n.pcsFromListBack),
                ),
              ],
            ),
      body: picked == null ? _list(l10n) : _detail(l10n, picked),
    );
  }

  Widget _list(AppLocalizations l10n) {
    final items = priceFillItems(widget.route);
    final kinds = priceFillWeightKinds(widget.route, _lang);
    return Column(
      key: const Key('fill-list'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (items.isNotEmpty) _GroupTitle(l10n.pcsFromListItems),
        for (final item in items)
          _ChoiceRow(
            key: ValueKey('fill-item:${item.id}'),
            title: item.label,
            note: item.includedLb > 0
                ? (_unit == 'kg'
                      ? l10n.spkUpToKgEach(priceLbText(item.includedLb))
                      : l10n.spkUpToLbEach(priceLbText(item.includedLb)))
                : null,
            price: formatLotCents(item.priceCents, language: _lang),
            onTap: () => _pick(item),
          ),
        if (kinds.isNotEmpty) _GroupTitle(l10n.pcsFromListByWeight),
        for (final kind in kinds)
          _ChoiceRow(
            key: ValueKey('fill-weight-kind:${kind.id}'),
            title: kind.label,
            price: '${formatLotCents(kind.priceCents, language: _lang)}/$_unit',
            onTap: () => _pick(kind),
          ),
      ],
    );
  }

  Widget _detail(AppLocalizations l10n, PriceFillChoice picked) {
    final fill = _result().fill;
    return Column(
      key: const Key('fill-detail'),
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (picked.byWeight)
          TextField(
            key: const Key('fill-weight'),
            controller: _weight,
            autofocus: true,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            inputFormatters: [
              FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
              LengthLimitingTextInputFormatter(7),
            ],
            onChanged: (_) => setState(() => _error = ''),
            decoration: InputDecoration(
              labelText: _unit == 'kg' ? l10n.pplWeightKg : l10n.pplWeightLb,
              suffixText: _unit,
            ),
          )
        else
          Row(
            children: [
              Expanded(
                child: Text(
                  l10n.pcsFromListHowMany,
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: AppColors.ink,
                  ),
                ),
              ),
              IconButton(
                key: const Key('fill-qty-less'),
                onPressed: _quantity > 1
                    ? () => setState(() => _quantity--)
                    : null,
                icon: const Icon(Icons.remove_circle_outline),
              ),
              Text(
                '$_quantity',
                key: const Key('fill-qty'),
                style: const TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w800,
                ),
              ),
              IconButton(
                key: const Key('fill-qty-more'),
                onPressed: _quantity < 50
                    ? () => setState(() => _quantity++)
                    : null,
                icon: const Icon(Icons.add_circle_outline),
              ),
            ],
          ),
        const SizedBox(height: AppSpacing.sm),
        if (fill != null)
          Text(
            l10n.pcsFromListPrice(
              formatLotCents(fill.priceCents, language: _lang),
            ),
            key: const Key('fill-price'),
            style: const TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w800,
              color: AppColors.cobaltDeep,
            ),
          ),
        if (_error.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: 6),
            child: Text(
              _error,
              key: const Key('fill-error'),
              style: const TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w600,
                color: AppColors.errorRed,
              ),
            ),
          ),
      ],
    );
  }
}

class _GroupTitle extends StatelessWidget {
  const _GroupTitle(this.text);

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(top: AppSpacing.sm, bottom: 6),
    child: Text(
      text,
      style: const TextStyle(
        fontSize: 13,
        fontWeight: FontWeight.w700,
        letterSpacing: 0.2,
        color: AppColors.muted,
      ),
    ),
  );
}

class _ChoiceRow extends StatelessWidget {
  const _ChoiceRow({
    super.key,
    required this.title,
    required this.price,
    required this.onTap,
    this.note,
  });

  final String title;
  final String? note;
  final String price;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.sm),
      child: PressableScale(
        scale: 0.985,
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(AppSpacing.md),
          decoration: BoxDecoration(
            color: AppColors.paper,
            borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
            border: Border.all(color: AppColors.rule),
          ),
          child: Row(
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(
                        fontSize: 15,
                        fontWeight: FontWeight.w700,
                        color: AppColors.ink,
                      ),
                    ),
                    if (note != null)
                      Text(
                        note!,
                        style: const TextStyle(
                          fontSize: 12.5,
                          color: AppColors.muted,
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              Text(
                price,
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w800,
                  color: AppColors.cobaltDeep,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
