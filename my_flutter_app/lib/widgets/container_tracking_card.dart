import 'package:flutter/material.dart';

import '../l10n/app_localizations.dart';
import '../services/shipment_tracking_service.dart';
import '../theme/app_colors.dart';
import 'async_action_button.dart';

/// Staff-only card for starting Terminal49 automated container tracking on
/// a sea shipment. Shows an input form when no tracking is active yet, or a
/// simple status line once [trackingProvider] is 'carrier_api'. New
/// milestones from the carrier appear on the shared ShipmentTrackingSection
/// timeline via the scheduled pollContainerTracking Cloud Function - this
/// card only handles kicking off the subscription.
class ContainerTrackingCard extends StatefulWidget {
  const ContainerTrackingCard({
    super.key,
    required this.relatedCollection,
    required this.relatedId,
    required this.containerNumber,
    required this.trackingProvider,
    this.trackingService,
  });

  final String relatedCollection;
  final String relatedId;
  final String containerNumber;
  final String trackingProvider;
  final ShipmentTrackingService? trackingService;

  @override
  State<ContainerTrackingCard> createState() => _ContainerTrackingCardState();
}

class _ContainerTrackingCardState extends State<ContainerTrackingCard> {
  final TextEditingController _numberController = TextEditingController();
  final TextEditingController _scacController = TextEditingController();
  String? _error;

  @override
  void dispose() {
    _numberController.dispose();
    _scacController.dispose();
    super.dispose();
  }

  Future<void> _start() async {
    final l10n = AppLocalizations.of(context)!;
    if (_numberController.text.trim().length < 4) {
      setState(() => _error = l10n.containerNumberRequired);
      return;
    }
    setState(() => _error = null);
    final service = widget.trackingService ?? ShipmentTrackingService();
    try {
      await service.startContainerTracking(
        relatedCollection: widget.relatedCollection,
        relatedId: widget.relatedId,
        containerNumber: _numberController.text,
        scac: _scacController.text,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(l10n.containerTrackingStarted)));
    } catch (error) {
      if (!mounted) return;
      setState(() => _error = '$error');
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final active = widget.trackingProvider == 'carrier_api';
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.rule),
      ),
      child: active ? _buildActiveStatus(l10n) : _buildForm(l10n),
    );
  }

  Widget _buildActiveStatus(AppLocalizations l10n) {
    return Row(
      children: [
        const Icon(
          Icons.directions_boat_filled_outlined,
          color: AppColors.cobaltDeep,
        ),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                l10n.automatedTrackingActive,
                style: const TextStyle(
                  fontWeight: FontWeight.w900,
                  color: AppColors.ink,
                ),
              ),
              const SizedBox(height: 2),
              Text(
                widget.containerNumber,
                style: const TextStyle(color: AppColors.muted),
              ),
              const SizedBox(height: 6),
              Text(
                l10n.automatedTrackingUpdatesPending,
                style: const TextStyle(
                  color: AppColors.warn,
                  fontSize: 12,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildForm(AppLocalizations l10n) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          l10n.containerTrackingTitle,
          style: const TextStyle(
            fontWeight: FontWeight.w900,
            fontSize: 15.5,
            color: AppColors.ink,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          l10n.containerTrackingDescription,
          style: const TextStyle(color: AppColors.muted, fontSize: 12.5),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: _numberController,
          textCapitalization: TextCapitalization.characters,
          decoration: InputDecoration(
            labelText: l10n.containerNumberLabel,
            hintText: l10n.containerNumberHint,
          ),
        ),
        const SizedBox(height: 8),
        TextField(
          controller: _scacController,
          textCapitalization: TextCapitalization.characters,
          decoration: InputDecoration(labelText: l10n.carrierCodeOptionalLabel),
        ),
        if (_error != null) ...[
          const SizedBox(height: 8),
          Text(
            _error!,
            style: const TextStyle(color: AppColors.errorRed, fontSize: 12.5),
          ),
        ],
        const SizedBox(height: 12),
        AsyncActionButton.filled(
          onPressed: _start,
          label: l10n.startTrackingButton,
          loadingLabel: l10n.startTrackingButton,
          icon: Icons.satellite_alt_outlined,
        ),
      ],
    );
  }
}
