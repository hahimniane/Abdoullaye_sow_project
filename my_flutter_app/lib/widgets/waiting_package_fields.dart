import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../l10n/app_localizations.dart';
import '../services/waiting_packages.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import 'lot_sheets.dart';

/// What a package carries beyond the line a container holds: where it is
/// going, its size in inches (with the volume that makes), its price in US
/// dollars and whether it is paid on arrival. The register sheet draws these
/// under the kind-specific fields; they live here so that sheet, already the
/// longest in the app, does not grow another hundred lines.
///
/// Pure presentation: the sheet owns the controllers and the refusals, and
/// hands each error in as the sentence to show.
class WaitingPackageFields extends StatelessWidget {
  const WaitingPackageFields({
    super.key,
    required this.destinationName,
    required this.onPickDestination,
    required this.length,
    required this.width,
    required this.height,
    required this.price,
    required this.payOnArrival,
    required this.onPayOnArrival,
    required this.onEdited,
    this.destinationError,
    this.sizeError,
    this.priceError,
  });

  /// The chosen country's name; empty until one is picked.
  final String destinationName;
  final VoidCallback onPickDestination;
  final TextEditingController length;
  final TextEditingController width;
  final TextEditingController height;
  final TextEditingController price;
  final bool payOnArrival;
  final ValueChanged<bool> onPayOnArrival;

  /// A field was typed in: the sheet clears the refusals that belonged to it.
  final VoidCallback onEdited;
  final String? destinationError;
  final String? sizeError;
  final String? priceError;

  static final _decimal = FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'));

  Widget _side(
    BuildContext context, {
    required Key key,
    required TextEditingController controller,
    required String label,
    required bool invalid,
  }) =>
      Expanded(
        child: TextField(
          key: key,
          controller: controller,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          inputFormatters: [_decimal],
          onChanged: (_) => onEdited(),
          decoration: InputDecoration(
            labelText: label,
            suffixText: 'in',
            errorText: invalid ? '' : null,
          ),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: AppSpacing.lg),
        LotPickerField(
          key: const Key('wpk-destination'),
          label: l10n.ctrDestination,
          value: destinationName,
          placeholder: l10n.ctrChooseDestination,
          onTap: onPickDestination,
          error: destinationError,
        ),
        const SizedBox(height: AppSpacing.lg),
        Text(
          l10n.wpkSizeTitle,
          style: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w700,
            letterSpacing: 0.2,
            color: AppColors.ink,
          ),
        ),
        const SizedBox(height: AppSpacing.sm),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            _side(context,
                key: const Key('wpk-length'),
                controller: length,
                label: l10n.wpkLength,
                invalid: sizeError != null),
            const SizedBox(width: AppSpacing.sm),
            _side(context,
                key: const Key('wpk-width'),
                controller: width,
                label: l10n.wpkWidth,
                invalid: sizeError != null),
            const SizedBox(width: AppSpacing.sm),
            _side(context,
                key: const Key('wpk-height'),
                controller: height,
                label: l10n.wpkHeight,
                invalid: sizeError != null),
          ],
        ),
        // The volume follows the three fields as they are typed; the same
        // length x width x height over 1728 the server and the label use.
        AnimatedBuilder(
          animation: Listenable.merge([length, width, height]),
          builder: (context, _) {
            final volume = volumeCubicFeet(
              readInches(length.text),
              readInches(width.text),
              readInches(height.text),
            );
            return Padding(
              padding: const EdgeInsets.only(top: 6, left: 2),
              child: Text(
                sizeError ??
                    (volume == null
                        ? l10n.wpkSizeHint
                        : '${trimNumber(volume)} ft³'),
                key: const Key('wpk-size-note'),
                style: TextStyle(
                  fontSize: 12,
                  height: 1.35,
                  fontWeight:
                      sizeError != null || volume != null ? FontWeight.w600 : null,
                  color: sizeError != null
                      ? AppColors.errorRed
                      : (volume != null ? AppColors.sage : AppColors.muted),
                ),
              ),
            );
          },
        ),
        const SizedBox(height: AppSpacing.md),
        TextField(
          key: const Key('wpk-price'),
          controller: price,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          onChanged: (_) => onEdited(),
          decoration: InputDecoration(
            labelText: l10n.wpkPrice,
            prefixText: r'$ ',
            helperText: l10n.wpkPriceHint,
            errorText: priceError,
            errorMaxLines: 3,
          ),
        ),
        SwitchListTile.adaptive(
          key: const Key('wpk-pay-on-arrival'),
          contentPadding: EdgeInsets.zero,
          dense: true,
          value: payOnArrival,
          onChanged: onPayOnArrival,
          title: Text(
            l10n.wpkPayOnArrival,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: AppColors.ink,
            ),
          ),
          subtitle: Text(
            l10n.wpkPayOnArrivalNote,
            style: const TextStyle(fontSize: 12, color: AppColors.muted),
          ),
        ),
      ],
    );
  }
}
