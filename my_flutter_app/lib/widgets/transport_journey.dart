import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../models/shipment_tracking_event.dart';
import '../services/shipment_tracking_service.dart';
import '../theme/app_colors.dart';
import '../utils/transport_journey_stages.dart';

/// The four-beat journey bar for a transport job - the same answer to
/// "where is my car" that barrels give for "where is my barrel", so the
/// mobile app and the web console tell one story.
class TransportJourneyBar extends StatelessWidget {
  const TransportJourneyBar({super.key, required this.status});

  /// fulfillmentStatus preferred, status as fallback - the same read the
  /// server's own state machine performs.
  final String status;

  @override
  Widget build(BuildContext context) {
    final index = transportJourneyStageIndex(status);
    if (index < 0) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 9),
        decoration: BoxDecoration(
          color: Colors.red.withValues(alpha: 0.06),
          borderRadius: BorderRadius.circular(10),
        ),
        child: const Text(
          'This transport job was cancelled.',
          style: TextStyle(
            color: Colors.red,
            fontSize: 13,
            fontWeight: FontWeight.w600,
          ),
        ),
      );
    }
    return Row(
      children: [
        for (var i = 0; i < transportJourneyStages.length; i++) ...[
          Expanded(
            child: Column(
              children: [
                Container(
                  height: 22,
                  width: 22,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: i <= index ? AppColors.cobalt : Colors.white,
                    border: Border.all(
                      color: i <= index
                          ? AppColors.cobalt
                          : AppColors.rule,
                      width: 2,
                    ),
                  ),
                  child: i < index
                      ? const Icon(Icons.check, size: 13, color: Colors.white)
                      : null,
                ),
                const SizedBox(height: 5),
                Text(
                  transportJourneyStages[i].label,
                  maxLines: 1,
                  overflow: TextOverflow.visible,
                  softWrap: false,
                  style: TextStyle(
                    fontSize: 10.5,
                    fontWeight: FontWeight.w700,
                    color: i <= index ? AppColors.ink : AppColors.muted,
                  ),
                ),
              ],
            ),
          ),
          if (i < transportJourneyStages.length - 1)
            Expanded(
              child: Container(
                height: 3,
                margin: const EdgeInsets.only(bottom: 18),
                decoration: BoxDecoration(
                  color: i < index
                      ? AppColors.cobalt
                      : AppColors.rule,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
        ],
      ],
    );
  }
}

/// The milestone feed under the journey bar: business-posted updates and
/// carrier events from the shared trackingEvents subcollection.
class TransportTrackingTimeline extends StatelessWidget {
  TransportTrackingTimeline({super.key, required this.requestId});

  final String requestId;
  final _service = ShipmentTrackingService();

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<List<ShipmentTrackingEvent>>(
      stream: _service.eventsForShipment(
        relatedCollection: 'transportRequests',
        relatedId: requestId,
      ),
      builder: (context, snapshot) {
        final events = snapshot.data ?? const <ShipmentTrackingEvent>[];
        if (events.isEmpty) return const SizedBox.shrink();
        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 14),
            for (var i = 0; i < events.length; i++) ...[
              _TimelineRow(event: events[i], latest: i == 0),
              if (i < events.length - 1) const SizedBox(height: 10),
            ],
          ],
        );
      },
    );
  }
}

class _TimelineRow extends StatelessWidget {
  const _TimelineRow({required this.event, required this.latest});

  final ShipmentTrackingEvent event;
  final bool latest;

  @override
  Widget build(BuildContext context) {
    final carrier = event.source == 'carrier_api';
    final detail = [
      event.location,
      event.description,
    ].where((value) => value.trim().isNotEmpty).join(' · ');
    final when = DateFormat.MMMd().add_jm().format(event.timestamp);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(
          carrier ? Icons.directions_boat_outlined : Icons.flag_outlined,
          size: 15,
          color: latest ? AppColors.cobalt : AppColors.muted,
        ),
        const SizedBox(width: 8),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                event.label,
                style: TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: latest ? AppColors.cobalt : AppColors.ink,
                ),
              ),
              if (detail.isNotEmpty)
                Text(
                  detail,
                  style: const TextStyle(
                    fontSize: 12,
                    color: AppColors.muted,
                  ),
                ),
              Text(
                carrier && when.isNotEmpty
                    ? '$when · from the carrier'
                    : when,
                style: const TextStyle(
                  fontSize: 11,
                  color: AppColors.muted,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }
}
