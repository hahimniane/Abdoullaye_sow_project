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

/// "Was money received?" on the register form: a switch that only works once
/// the package has a price (a payment is always against one), and then how
/// much (the whole price to start with), how it arrived, who took it - chosen,
/// never assumed - and an optional note.
///
/// Pure presentation like [WaitingPackageFields]: the sheet owns the
/// controllers, the choices and the refusals.
class IntakePaymentFields extends StatelessWidget {
  const IntakePaymentFields({
    super.key,
    required this.price,
    required this.received,
    required this.onReceived,
    required this.amount,
    required this.note,
    required this.methodLabel,
    required this.onPickMethod,
    required this.receiverName,
    required this.onPickReceiver,
    required this.onEdited,
    this.enabled = true,
    this.amountError,
    this.methodError,
    this.receiverError,
  });

  /// The price field: the switch follows it as it is typed.
  final TextEditingController price;
  final bool received;
  final ValueChanged<bool> onReceived;
  final TextEditingController amount;
  final TextEditingController note;
  final String methodLabel;
  final VoidCallback onPickMethod;

  /// The chosen person's name; empty until someone is picked.
  final String receiverName;
  final VoidCallback onPickReceiver;
  final VoidCallback onEdited;
  final bool enabled;
  final String? amountError;
  final String? methodError;
  final String? receiverError;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return AnimatedBuilder(
      animation: price,
      builder: (context, _) {
        final priced = readPackagePrice(price.text).cents != null;
        final on = received && priced;
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            SwitchListTile.adaptive(
              key: const Key('wpk-money-received'),
              contentPadding: EdgeInsets.zero,
              dense: true,
              value: on,
              onChanged: enabled && priced ? onReceived : null,
              title: Text(
                l10n.wpkMoneyReceivedNow,
                style: TextStyle(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: priced ? AppColors.ink : AppColors.muted,
                ),
              ),
              subtitle: Text(
                priced
                    ? l10n.wpkMoneyReceivedNote
                    : l10n.wpkMoneyReceivedNeedsPrice,
                key: const Key('wpk-money-received-note'),
                style: const TextStyle(fontSize: 12, color: AppColors.muted),
              ),
            ),
            if (on) ...[
              const SizedBox(height: AppSpacing.sm),
              TextField(
                key: const Key('wpk-money-amount'),
                controller: amount,
                enabled: enabled,
                keyboardType:
                    const TextInputType.numberWithOptions(decimal: true),
                inputFormatters: [_decimal],
                onChanged: (_) => onEdited(),
                decoration: InputDecoration(
                  labelText: l10n.wpkAmountReceived,
                  prefixText: r'$ ',
                  errorText: amountError,
                  errorMaxLines: 3,
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              LotPickerField(
                key: const Key('wpk-money-method'),
                label: l10n.wpkMethod,
                value: methodLabel,
                placeholder: l10n.wpkMethod,
                onTap: enabled ? onPickMethod : () {},
                error: methodError,
              ),
              const SizedBox(height: AppSpacing.md),
              LotPickerField(
                key: const Key('wpk-money-received-by'),
                label: l10n.lotReceivedBy,
                value: receiverName,
                placeholder: l10n.lotReceivedBy,
                onTap: enabled ? onPickReceiver : () {},
                error: receiverError,
              ),
              const SizedBox(height: AppSpacing.md),
              TextField(
                key: const Key('wpk-money-note'),
                controller: note,
                enabled: enabled,
                textCapitalization: TextCapitalization.sentences,
                decoration: InputDecoration(labelText: l10n.wpkNote),
              ),
            ],
          ],
        );
      },
    );
  }

  static final _decimal = FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]'));
}
