import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:cloud_functions/cloud_functions.dart';

import '../models/shipment_tracking_event.dart';

class ShipmentTrackingService {
  ShipmentTrackingService({FirebaseFirestore? firestore, FirebaseFunctions? functions})
    : _firestoreOverride = firestore,
      _functionsOverride = functions;

  // Resolved lazily (not in the constructor) so building a
  // ShipmentTrackingService never touches Firebase.instance unless one of
  // the methods below is actually invoked — lets subclasses used in widget
  // tests override both methods without needing Firebase initialized.
  final FirebaseFirestore? _firestoreOverride;
  final FirebaseFunctions? _functionsOverride;

  FirebaseFirestore get _firestore =>
      _firestoreOverride ?? FirebaseFirestore.instance;
  FirebaseFunctions get _functions =>
      _functionsOverride ?? FirebaseFunctions.instance;

  Stream<List<ShipmentTrackingEvent>> eventsForShipment({
    required String relatedCollection,
    required String relatedId,
  }) {
    return _firestore
        .collection(relatedCollection)
        .doc(relatedId)
        .collection('trackingEvents')
        .orderBy('timestamp', descending: true)
        .snapshots()
        .map(
          (snapshot) => snapshot.docs
              .map(ShipmentTrackingEvent.fromFirestore)
              .toList(),
        );
  }

  Future<void> addMilestone({
    required String relatedCollection,
    required String relatedId,
    required String label,
    String description = '',
    String location = '',
  }) {
    return _functions.httpsCallable('addShipmentTrackingMilestone').call({
      'relatedCollection': relatedCollection,
      'relatedId': relatedId,
      'label': label.trim(),
      'description': description.trim(),
      'location': location.trim(),
    });
  }

  // Starts automated carrier tracking for a sea shipment. Terminal49's free
  // tier polls rather than pushes, so new milestones appear on a delay
  // (see the scheduled pollContainerTracking Cloud Function) rather than
  // instantly.
  Future<void> startContainerTracking({
    required String relatedCollection,
    required String relatedId,
    required String containerNumber,
    String scac = '',
  }) {
    return _functions.httpsCallable('subscribeToContainerTracking').call({
      'relatedCollection': relatedCollection,
      'relatedId': relatedId,
      'containerNumber': containerNumber.trim(),
      'scac': scac.trim(),
    });
  }
}
