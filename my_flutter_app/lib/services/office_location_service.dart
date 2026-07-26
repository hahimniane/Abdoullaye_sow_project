import 'package:cloud_firestore/cloud_firestore.dart';

import '../models/office_location.dart';

class OfficeLocationService {
  OfficeLocationService({FirebaseFirestore? firestore})
    : _firestore = firestore ?? FirebaseFirestore.instance;

  final FirebaseFirestore _firestore;

  CollectionReference<Map<String, dynamic>> _collection(String businessId) =>
      _firestore
          .collection('businesses')
          .doc(businessId)
          .collection('officeLocations');

  /// Active locations only, for customers choosing a drop-off point.
  Stream<List<OfficeLocation>> activeLocations(String businessId) {
    if (businessId.isEmpty) return Stream.value(const []);
    return _collection(businessId)
        .where('isActive', isEqualTo: true)
        .snapshots()
        .map(
          (snapshot) => OfficeLocation.sorted(
            snapshot.docs.map(OfficeLocation.fromFirestore).toList(),
          ),
        );
  }

  /// Every location (including paused ones), for the business owner to manage.
  Stream<List<OfficeLocation>> allLocations(String businessId) {
    if (businessId.isEmpty) return Stream.value(const []);
    return _collection(businessId).snapshots().map(
      (snapshot) => OfficeLocation.sorted(
        snapshot.docs.map(OfficeLocation.fromFirestore).toList(),
      ),
    );
  }

  Future<void> saveLocation({
    required String businessId,
    String? locationId,
    required String label,
    required String address,
    required int sortOrder,
  }) {
    final ref = locationId == null || locationId.isEmpty
        ? _collection(businessId).doc()
        : _collection(businessId).doc(locationId);
    return ref.set({
      'businessId': businessId,
      'label': label,
      'address': address,
      'isActive': true,
      'sortOrder': sortOrder,
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }

  Future<void> setActive({
    required String businessId,
    required String locationId,
    required bool isActive,
  }) {
    return _collection(businessId).doc(locationId).set({
      'isActive': isActive,
      'updatedAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }
}
