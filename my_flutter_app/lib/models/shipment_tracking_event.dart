import 'package:cloud_firestore/cloud_firestore.dart';

/// A single milestone in a shipment's tracking timeline. See
/// {barrelShipments,freightShipments}/{shipmentId}/trackingEvents in
/// Firestore. Either staff-entered ('staff') or, once a container is
/// subscribed for tracking, populated automatically ('carrier_api').
class ShipmentTrackingEvent {
  const ShipmentTrackingEvent({
    required this.id,
    required this.label,
    required this.description,
    required this.location,
    required this.timestamp,
    required this.source,
  });

  final String id;
  final String label;
  final String description;
  final String location;
  final DateTime timestamp;
  final String source;

  bool get isFromCarrier => source == 'carrier_api';

  factory ShipmentTrackingEvent.fromFirestore(
    DocumentSnapshot<Map<String, dynamic>> doc,
  ) {
    final d = doc.data() ?? const {};
    final timestamp = d['timestamp'];
    return ShipmentTrackingEvent(
      id: doc.id,
      label: (d['label'] as String?) ?? '',
      description: (d['description'] as String?) ?? '',
      location: (d['location'] as String?) ?? '',
      timestamp: timestamp is Timestamp
          ? timestamp.toDate()
          : DateTime.fromMillisecondsSinceEpoch(0),
      source: (d['source'] as String?) ?? 'staff',
    );
  }
}
