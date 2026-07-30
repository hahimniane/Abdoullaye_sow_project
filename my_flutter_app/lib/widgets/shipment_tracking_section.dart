import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../l10n/app_localizations.dart';
import '../models/shipment_tracking_event.dart';
import '../services/shipment_tracking_service.dart';
import '../theme/app_colors.dart';
import 'async_action_button.dart';

/// Staff-facing milestone timeline for one shipment, shown on both the
/// barrel and freight staff detail screens. Customers see the same events
/// (read-only) via tracking_screen.dart.
class ShipmentTrackingSection extends StatelessWidget {
  const ShipmentTrackingSection({
    super.key,
    required this.relatedCollection,
    required this.relatedId,
    this.canEdit = true,
    this.trackingService,
  });

  final String relatedCollection;
  final String relatedId;
  final bool canEdit;
  final ShipmentTrackingService? trackingService;

  Future<void> _addUpdate(
    BuildContext context,
    ShipmentTrackingService service,
  ) async {
    final l10n = AppLocalizations.of(context)!;
    final draft = await showModalBottomSheet<_MilestoneDraft>(
      context: context,
      isScrollControlled: true,
      builder: (context) => const _MilestoneFormSheet(),
    );
    if (draft == null || !context.mounted) return;
    try {
      await service.addMilestone(
        relatedCollection: relatedCollection,
        relatedId: relatedId,
        label: draft.label,
        description: draft.description,
        location: draft.location,
      );
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text(l10n.trackingUpdateAdded)));
    } catch (error) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(
        context,
      ).showSnackBar(SnackBar(content: Text('$error')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final service = trackingService ?? ShipmentTrackingService();
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.paper,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: AppColors.rule),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.timeline, color: AppColors.cobaltDeep),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  l10n.trackingUpdatesTitle,
                  style: const TextStyle(
                    fontWeight: FontWeight.w900,
                    fontSize: 15.5,
                    color: AppColors.ink,
                  ),
                ),
              ),
              if (canEdit)
                TextButton.icon(
                  onPressed: () => _addUpdate(context, service),
                  icon: const Icon(Icons.add, size: 18),
                  label: Text(l10n.addTrackingUpdate),
                ),
            ],
          ),
          const SizedBox(height: 8),
          StreamBuilder<List<ShipmentTrackingEvent>>(
            stream: service.eventsForShipment(
              relatedCollection: relatedCollection,
              relatedId: relatedId,
            ),
            builder: (context, snapshot) {
              final events = snapshot.data ?? const <ShipmentTrackingEvent>[];
              if (!snapshot.hasData) {
                return const Padding(
                  padding: EdgeInsets.symmetric(vertical: 12),
                  child: Center(
                    child: SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    ),
                  ),
                );
              }
              if (events.isEmpty) {
                return Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Text(
                    l10n.trackingUpdatesEmpty,
                    style: const TextStyle(color: AppColors.muted),
                  ),
                );
              }
              return Column(
                children: [
                  for (final event in events) _TrackingEventRow(event: event),
                ],
              );
            },
          ),
        ],
      ),
    );
  }
}

class _TrackingEventRow extends StatelessWidget {
  const _TrackingEventRow({required this.event});

  final ShipmentTrackingEvent event;

  @override
  Widget build(BuildContext context) {
    final date = DateFormat.yMMMd().add_jm().format(event.timestamp);
    final detail = [
      event.location,
      event.description,
    ].where((s) => s.isNotEmpty).join(' · ');
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            event.isFromCarrier
                ? Icons.directions_boat_filled_outlined
                : Icons.flag_outlined,
            size: 16,
            color: event.isFromCarrier ? AppColors.cobalt : AppColors.sage,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  event.label,
                  style: const TextStyle(
                    fontWeight: FontWeight.w800,
                    color: AppColors.ink,
                  ),
                ),
                if (detail.isNotEmpty)
                  Text(
                    detail,
                    style: const TextStyle(
                      color: AppColors.muted,
                      fontSize: 12.5,
                    ),
                  ),
                Text(
                  date,
                  style: const TextStyle(
                    color: AppColors.muted,
                    fontSize: 11.5,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _MilestoneDraft {
  const _MilestoneDraft({
    required this.label,
    required this.description,
    required this.location,
  });

  final String label;
  final String description;
  final String location;
}

class _MilestoneFormSheet extends StatefulWidget {
  const _MilestoneFormSheet();

  @override
  State<_MilestoneFormSheet> createState() => _MilestoneFormSheetState();
}

class _MilestoneFormSheetState extends State<_MilestoneFormSheet> {
  final TextEditingController _labelController = TextEditingController();
  final TextEditingController _descriptionController =
      TextEditingController();
  final TextEditingController _locationController = TextEditingController();
  String? _labelError;

  @override
  void dispose() {
    _labelController.dispose();
    _descriptionController.dispose();
    _locationController.dispose();
    super.dispose();
  }

  void _submit() {
    final l10n = AppLocalizations.of(context)!;
    final label = _labelController.text.trim();
    setState(() {
      _labelError = label.isEmpty ? l10n.trackingUpdateLabelRequired : null;
    });
    if (label.isEmpty) return;
    Navigator.pop(
      context,
      _MilestoneDraft(
        label: label,
        description: _descriptionController.text.trim(),
        location: _locationController.text.trim(),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    final bottom = MediaQuery.of(context).viewInsets.bottom;
    return Padding(
      padding: EdgeInsets.fromLTRB(20, 12, 20, bottom + 20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Center(
            child: Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppColors.rule,
                borderRadius: BorderRadius.circular(999),
              ),
            ),
          ),
          const SizedBox(height: 18),
          Text(
            l10n.addTrackingUpdate,
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _labelController,
            textInputAction: TextInputAction.next,
            onChanged: (_) {
              if (_labelError != null) setState(() => _labelError = null);
            },
            decoration: InputDecoration(
              labelText: l10n.trackingUpdateLabel,
              hintText: l10n.trackingUpdateLabelHint,
              errorText: _labelError,
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _locationController,
            textInputAction: TextInputAction.next,
            decoration: InputDecoration(
              labelText: l10n.trackingUpdateLocation,
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _descriptionController,
            minLines: 2,
            maxLines: 4,
            decoration: InputDecoration(
              labelText: l10n.trackingUpdateNotes,
              alignLabelWithHint: true,
            ),
          ),
          const SizedBox(height: 16),
          AsyncActionButton.filled(
            onPressed: _submit,
            label: l10n.addTrackingUpdate,
            loadingLabel: l10n.addTrackingUpdate,
            icon: Icons.check,
          ),
        ],
      ),
    );
  }
}
