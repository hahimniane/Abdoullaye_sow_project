import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/parking_whatsapp.dart';
import '../theme/app_spacing.dart';
import 'app_snackbars.dart';
import 'parking_whatsapp_switch.dart' show parkingWhatsAppErrorText;

/// "Payment instructions" in business settings, next to the WhatsApp switch
/// (docs/PARKING_INVOICES.md §1 decision 4): plain text, at most 300
/// characters, printed on each monthly invoice under the balance due and sent
/// as a variable of the message ("Pay at the office, or Zelle ...").
///
/// The owner's (or a platform admin's) alone - everyone else sees nothing. It
/// saves with its own button (like the switch, not the profile's Save): the
/// text shown is the owner's draft until a save succeeds, and follows the
/// business record again whenever the owner has no unsaved edit. The call
/// always resolves - a timeout puts the button back and says so.
class ParkingPaymentInstructionsField extends StatefulWidget {
  const ParkingPaymentInstructionsField({
    super.key,
    required this.businessId,
    required this.saved,
    required this.canEdit,
    this.service,
    this.timeout = const Duration(seconds: 20),
  });

  final String businessId;

  /// What the business record says (`paymentInstructions`).
  final String saved;

  /// Owner or platform admin; false hides the field.
  final bool canEdit;

  /// Injectable so a widget test answers without Firebase.
  final ParkingWhatsAppService? service;
  final Duration timeout;

  @override
  State<ParkingPaymentInstructionsField> createState() =>
      _ParkingPaymentInstructionsFieldState();
}

class _ParkingPaymentInstructionsFieldState
    extends State<ParkingPaymentInstructionsField> {
  late final TextEditingController _controller = TextEditingController(
    text: widget.saved,
  );

  /// The last text the server is known to hold: what the record said, or what
  /// the last save wrote (held until the record catches up).
  late String _baseline = widget.saved.trim();
  bool _saving = false;

  ParkingWhatsAppService get _service =>
      widget.service ?? FirebaseParkingWhatsAppService();

  bool get _dirty => _controller.text.trim() != _baseline;

  @override
  void initState() {
    super.initState();
    _controller.addListener(_changed);
  }

  void _changed() {
    if (mounted) setState(() {});
  }

  @override
  void didUpdateWidget(ParkingPaymentInstructionsField oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.saved == widget.saved) return;
    // The record changed: take it unless the owner is mid-edit.
    final wasDirty = _dirty;
    _baseline = widget.saved.trim();
    if (!wasDirty && !_saving) {
      _controller.value = TextEditingValue(
        text: widget.saved,
        selection: TextSelection.collapsed(offset: widget.saved.length),
      );
    }
  }

  @override
  void dispose() {
    _controller
      ..removeListener(_changed)
      ..dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (_saving || !_dirty) return;
    final l10n = AppLocalizations.of(context)!;
    final text = _controller.text.trim();
    setState(() => _saving = true);
    try {
      await _service
          .setPaymentInstructions(businessId: widget.businessId, text: text)
          .timeout(widget.timeout);
      _baseline = text;
      if (mounted) showSuccessSnackBar(context, l10n.parkingInvPaySaved);
    } catch (error) {
      if (mounted) {
        showErrorSnackBar(
          context,
          parkingWhatsAppErrorText(
            l10n,
            error,
            fallback: l10n.parkingInvPaySaveFailed,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.canEdit) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context)!;
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.only(top: AppSpacing.sm),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            key: const Key('parking-payment-instructions'),
            controller: _controller,
            enabled: !_saving,
            minLines: 2,
            maxLines: 4,
            maxLength: parkingPaymentInstructionsMaxLength,
            keyboardType: TextInputType.multiline,
            textCapitalization: TextCapitalization.sentences,
            decoration: InputDecoration(
              labelText: l10n.parkingInvPayTitle,
              hintText: l10n.parkingInvPayHint,
              helperText: l10n.parkingInvPayHelp,
              helperMaxLines: 4,
              prefixIcon: const Icon(Icons.payments_outlined),
            ),
          ),
          Align(
            alignment: AlignmentDirectional.centerStart,
            child: FilledButton.tonal(
              key: const Key('parking-payment-instructions-save'),
              onPressed: _saving || !_dirty ? null : _save,
              child: _saving
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(
                      l10n.parkingInvPaySave,
                      style: theme.textTheme.labelLarge,
                    ),
            ),
          ),
        ],
      ),
    );
  }
}
