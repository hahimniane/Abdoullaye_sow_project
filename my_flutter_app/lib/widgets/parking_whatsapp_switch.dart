import 'dart:async';

import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/parking_whatsapp.dart';
import 'app_snackbars.dart';

/// The text of a refusal or failure from the WhatsApp parking callables, in
/// the reader's language. [fallback] is shown for anything unrecognised.
String parkingWhatsAppErrorText(
  AppLocalizations l10n,
  Object error, {
  required String fallback,
}) => switch (parkingWhatsAppRefusalOf(error)) {
  ParkingWhatsAppRefusal.switchOff => l10n.parkingWaErrSwitchOff,
  ParkingWhatsAppRefusal.welcomeOwnerOnly => l10n.parkingWaErrWelcomeOwnerOnly,
  ParkingWhatsAppRefusal.switchOwnerOnly => l10n.parkingWaErrOwnerOnly,
  null => fallback,
};

/// "Send WhatsApp messages to parking customers" (docs/PARKING_WHATSAPP.md
/// §1): the business's switch, off by default, the owner's (or a platform
/// admin's) alone - everyone else sees nothing at all.
///
/// It saves the moment it is flipped (not with the profile's Save button): the
/// shown value is the server's [enabled] until the call comes back, then
/// follows the business record again. The call always resolves - a timeout
/// puts the switch back and says so.
class ParkingWhatsAppSwitch extends StatefulWidget {
  const ParkingWhatsAppSwitch({
    super.key,
    required this.businessId,
    required this.enabled,
    required this.canEdit,
    this.service,
    this.timeout = const Duration(seconds: 20),
  });

  final String businessId;

  /// What the business record says (`parkingWhatsApp.enabled`).
  final bool enabled;

  /// Owner or platform admin; false hides the switch.
  final bool canEdit;

  /// Injectable so a widget test answers without Firebase.
  final ParkingWhatsAppService? service;
  final Duration timeout;

  @override
  State<ParkingWhatsAppSwitch> createState() => _ParkingWhatsAppSwitchState();
}

class _ParkingWhatsAppSwitchState extends State<ParkingWhatsAppSwitch> {
  /// The value being saved, while a save is in flight.
  bool? _pending;

  /// The value that was just saved, held until the business record catches
  /// up so the switch does not flick back for a moment.
  bool? _saved;

  @override
  void didUpdateWidget(ParkingWhatsAppSwitch oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.enabled != widget.enabled) _saved = null;
  }

  ParkingWhatsAppService get _service =>
      widget.service ?? FirebaseParkingWhatsAppService();

  Future<void> _flip(bool value) async {
    if (_pending != null) return;
    final l10n = AppLocalizations.of(context)!;
    setState(() => _pending = value);
    try {
      await _service
          .setEnabled(businessId: widget.businessId, enabled: value)
          .timeout(widget.timeout);
      _saved = value;
    } catch (error) {
      if (mounted) {
        showErrorSnackBar(
          context,
          parkingWhatsAppErrorText(
            l10n,
            error,
            fallback: l10n.parkingWaSwitchFailed,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _pending = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.canEdit) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context)!;
    return SwitchListTile(
      key: const Key('parking-whatsapp-switch'),
      contentPadding: EdgeInsets.zero,
      value: _pending ?? _saved ?? widget.enabled,
      onChanged: _pending == null ? _flip : null,
      title: Text(l10n.parkingWaSwitchTitle),
      subtitle: Text(l10n.parkingWaSwitchHelp),
    );
  }
}
