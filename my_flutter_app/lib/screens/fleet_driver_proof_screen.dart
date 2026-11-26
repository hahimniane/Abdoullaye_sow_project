import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart' show ImageSource;

import '../l10n/app_localizations.dart';
import '../services/fleet.dart';
import '../services/fleet_driver_app.dart';
import '../services/fleet_driver_service.dart';
import '../theme/app_colors.dart';
import '../theme/app_spacing.dart';
import '../widgets/fleet_widgets.dart';
import 'fleet_driver_tabs.dart' show DriverLinkOpener;
import 'package_request_form_screen.dart'
    show RequestPhotoPicker, pickRequestPhoto;

/// "Send my payment screenshot" (docs/FLEET.md section 14): the driver picks
/// the Zelle screenshot, checks the amount, and sends both from the app. The
/// server makes the same report a WhatsApp picture makes; the bill is marked
/// paid only when the deposit shows in the business's bank.
///
/// Select, look, then send: the picture is shown before anything leaves the
/// phone, a failed send keeps it (and the amount) for another try, and Send
/// cannot be tapped twice.
class FleetDriverProofScreen extends StatefulWidget {
  const FleetDriverProofScreen({
    super.key,
    required this.controller,
    required this.fleet,
    required this.home,
    required this.openLink,
    this.picker = pickRequestPhoto,
  });

  final FleetDriverController controller;
  final DriverFleet fleet;
  final DriverHome home;

  /// Opens WhatsApp for a driver who would rather send it there.
  final DriverLinkOpener openLink;

  /// The phone's photo picker; tests hand in their own.
  final RequestPhotoPicker picker;

  @override
  State<FleetDriverProofScreen> createState() => _FleetDriverProofScreenState();
}

class _FleetDriverProofScreenState extends State<FleetDriverProofScreen> {
  late final TextEditingController _amount = TextEditingController(
    text: fleetCentsToInput(widget.fleet.balance.owedCents),
  );
  Uint8List? _picture;
  bool _picking = false;
  bool _sending = false;
  String? _error;
  DriverClaimResult? _result;

  @override
  void dispose() {
    _amount.dispose();
    super.dispose();
  }

  String get _language =>
      Localizations.localeOf(context).languageCode == 'fr' ? 'fr' : 'en';

  Future<void> _pick(ImageSource source) async {
    if (_picking || _sending) return;
    final l10n = AppLocalizations.of(context)!;
    setState(() {
      _picking = true;
      _error = null;
    });
    try {
      final picked = await widget.picker(source);
      if (!mounted || picked == null) return;
      if (picked.bytes.length > driverProofMaxBytes) {
        setState(() => _error = l10n.fdrProofTooBig);
        return;
      }
      setState(() => _picture = picked.bytes);
    } catch (_) {
      // The picker was refused or closed badly: nothing was chosen.
      if (mounted) setState(() => _error = l10n.fltRefusalClaimImage);
    } finally {
      if (mounted) setState(() => _picking = false);
    }
  }

  Future<void> _send() async {
    if (_sending) return;
    final l10n = AppLocalizations.of(context)!;
    final picture = _picture;
    if (picture == null) {
      setState(() => _error = l10n.fdrProofNeedPicture);
      return;
    }
    final cents = fleetDollarsToCents(_amount.text);
    if (cents == null || cents <= 0) {
      setState(() => _error = l10n.fltRefusalClaimAmount);
      return;
    }
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      final result = await widget.controller.reportPayment(
        businessId: widget.fleet.businessId,
        picture: picture,
        amountCents: cents,
        language: _language,
      );
      if (!mounted) return;
      setState(() {
        _result = result;
        // "Not a payment": nothing was kept, so the driver picks again.
        if (result.outcome == DriverClaimOutcome.notAPayment) _picture = null;
      });
    } on FleetFailure catch (failure) {
      if (mounted) setState(() => _error = fleetRefusalText(l10n, failure));
    } catch (_) {
      if (mounted) setState(() => _error = l10n.fltErrUnknown);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _whatsApp() async {
    final l10n = AppLocalizations.of(context)!;
    final uri = driverProofWhatsAppUri(
      widget.home.proofWhatsApp,
      l10n.fdrProofMessage(widget.fleet.businessName),
    );
    var opened = false;
    if (uri != null) {
      try {
        opened = await widget.openLink(uri);
      } catch (_) {
        opened = false;
      }
    }
    if (!opened && mounted) {
      setState(
        () => _error = l10n.fdrProofNoWhatsApp(
          driverPhoneLabel(widget.home.proofWhatsApp),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final result = _result;
    return Scaffold(
      backgroundColor: AppColors.cream,
      appBar: AppBar(title: Text(l10n.fdrProofButton)),
      body: SafeArea(
        // A short page: everything is built at once (the Send button is
        // always there to scroll to, however tall the picture is).
        child: SingleChildScrollView(
          key: const Key('fleet-driver-proof'),
          padding: const EdgeInsets.fromLTRB(20, 16, 20, 28),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children:
                result != null &&
                    result.outcome != DriverClaimOutcome.notAPayment
                ? _resultView(l10n, result)
                : _form(l10n, result),
          ),
        ),
      ),
    );
  }

  List<Widget> _form(AppLocalizations l10n, DriverClaimResult? result) {
    final theme = Theme.of(context).textTheme;
    final muted = theme.bodyMedium!.copyWith(
      fontSize: 13,
      color: AppColors.muted,
      height: 1.35,
    );
    final picture = _picture;
    return [
      if (result != null) ...[
        FleetCard(
          key: const Key('fleet-driver-proof-not-payment'),
          title: l10n.fdrProofNotPaymentTitle,
          child: Text(l10n.fdrProofNotPaymentBody, style: theme.bodyLarge),
        ),
        const SizedBox(height: AppSpacing.md),
      ],
      FleetCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (picture == null) ...[
              SizedBox(
                height: 50,
                child: FilledButton.icon(
                  key: const Key('fleet-driver-proof-choose'),
                  onPressed: _picking ? null : () => _pick(ImageSource.gallery),
                  icon: const Icon(Icons.photo_library_outlined, size: 20),
                  label: Text(l10n.fdrProofChoose),
                ),
              ),
              const SizedBox(height: AppSpacing.xs),
              TextButton(
                key: const Key('fleet-driver-proof-camera'),
                onPressed: _picking ? null : () => _pick(ImageSource.camera),
                child: Text(l10n.fdrProofCamera),
              ),
            ] else ...[
              ClipRRect(
                borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(maxHeight: 320),
                  child: Image.memory(
                    picture,
                    key: const Key('fleet-driver-proof-preview'),
                    fit: BoxFit.contain,
                    gaplessPlayback: true,
                    // A file the phone cannot draw is still sent: the
                    // server decides whether it is a picture.
                    errorBuilder: (_, _, _) => const SizedBox(
                      height: 120,
                      child: Center(
                        child: Icon(
                          Icons.image_outlined,
                          color: AppColors.muted,
                          size: 40,
                        ),
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: AppSpacing.xs),
              TextButton(
                key: const Key('fleet-driver-proof-replace'),
                onPressed: _picking || _sending
                    ? null
                    : () => _pick(ImageSource.gallery),
                child: Text(l10n.fdrProofReplace),
              ),
            ],
          ],
        ),
      ),
      const SizedBox(height: AppSpacing.md),
      FleetCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              key: const Key('fleet-driver-proof-amount'),
              controller: _amount,
              enabled: !_sending,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              decoration: InputDecoration(labelText: l10n.fdrProofAmountLabel),
              onChanged: (_) {
                if (_error != null) setState(() => _error = null);
              },
            ),
            const SizedBox(height: AppSpacing.sm),
            Text(l10n.fdrProofHint(widget.fleet.businessName), style: muted),
          ],
        ),
      ),
      if (_error != null) ...[
        const SizedBox(height: AppSpacing.md),
        Text(
          _error!,
          key: const Key('fleet-driver-proof-error'),
          style: theme.bodyLarge!.copyWith(color: AppColors.errorRed),
        ),
      ],
      const SizedBox(height: AppSpacing.lg),
      SizedBox(
        height: 50,
        child: FilledButton(
          key: const Key('fleet-driver-proof-send'),
          onPressed: _sending ? null : _send,
          child: _sending
              ? const SizedBox(
                  width: 22,
                  height: 22,
                  child: CircularProgressIndicator(
                    strokeWidth: 2.5,
                    color: Colors.white,
                  ),
                )
              : Text(l10n.fdrProofSend),
        ),
      ),
      const SizedBox(height: AppSpacing.sm),
      TextButton(
        key: const Key('fleet-driver-proof-whatsapp'),
        onPressed: _sending ? null : _whatsApp,
        child: Text(l10n.fdrProofWhatsApp),
      ),
    ];
  }

  List<Widget> _resultView(AppLocalizations l10n, DriverClaimResult result) {
    final theme = Theme.of(context).textTheme;
    final business = widget.fleet.businessName;
    final (title, body, good) = switch (result.outcome) {
      DriverClaimOutcome.duplicate => (
        l10n.fdrProofDuplicateTitle,
        l10n.fdrProofDuplicateBody,
        true,
      ),
      DriverClaimOutcome.alreadyPaid => (
        l10n.fdrProofPaidTitle,
        l10n.fdrProofPaidBody,
        true,
      ),
      DriverClaimOutcome.office => (
        l10n.fdrProofOfficeTitle(business),
        switch (result.reason) {
          'wrong_recipient' => l10n.fdrProofOfficeRecipient,
          'too_old' => l10n.fdrProofOfficeOld,
          _ => l10n.fdrProofOfficeOther,
        },
        false,
      ),
      _ => (
        l10n.fdrProofWaitingTitle,
        l10n.fdrProofWaitingBody(fleetMoney(result.amountCents), business),
        true,
      ),
    };
    return [
      const SizedBox(height: AppSpacing.xl),
      Icon(
        good ? Icons.check_circle_outline : Icons.support_agent_outlined,
        size: 56,
        color: good ? AppColors.sage : AppColors.warn,
      ),
      const SizedBox(height: AppSpacing.md),
      Text(
        title,
        key: const Key('fleet-driver-proof-result'),
        textAlign: TextAlign.center,
        style: theme.displaySmall?.copyWith(color: AppColors.ink),
      ),
      const SizedBox(height: AppSpacing.sm),
      Text(body, textAlign: TextAlign.center, style: theme.bodyLarge),
      const SizedBox(height: AppSpacing.xl),
      SizedBox(
        height: 50,
        child: FilledButton(
          key: const Key('fleet-driver-proof-done'),
          onPressed: () => Navigator.of(context).maybePop(),
          child: Text(l10n.fdrProofDone),
        ),
      ),
    ];
  }
}
