import 'dart:math' as math;

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

import '../models/car.dart';

class FavoriteCarSnapshot {
  const FavoriteCarSnapshot({
    required this.carId,
    required this.title,
    required this.make,
    required this.model,
    required this.year,
    required this.price,
    required this.imageUrl,
    required this.isRebuiltTitle,
    required this.createdAt,
  });

  final String carId;
  final String title;
  final String make;
  final String model;
  final String year;
  final double price;
  final String imageUrl;
  final bool? isRebuiltTitle;
  final DateTime? createdAt;

  factory FavoriteCarSnapshot.fromDoc(DocumentSnapshot doc) {
    final data = doc.data() as Map<String, dynamic>? ?? <String, dynamic>{};
    return FavoriteCarSnapshot(
      carId: (data['carId'] ?? doc.id).toString(),
      title: (data['title'] ?? '').toString(),
      make: (data['make'] ?? '').toString(),
      model: (data['model'] ?? '').toString(),
      year: (data['year'] ?? '').toString(),
      price: (data['price'] is num) ? (data['price'] as num).toDouble() : 0,
      imageUrl: (data['imageUrl'] ?? '').toString(),
      isRebuiltTitle: data['isRebuiltTitle'] is bool
          ? data['isRebuiltTitle'] as bool
          : null,
      createdAt: data['createdAt'] is Timestamp
          ? (data['createdAt'] as Timestamp).toDate()
          : null,
    );
  }
}

class FavoriteCarsService {
  FavoriteCarsService({FirebaseFirestore? firestore, FirebaseAuth? auth})
    : _firestore = firestore ?? FirebaseFirestore.instance,
      _auth = auth ?? FirebaseAuth.instance;

  final FirebaseFirestore _firestore;
  final FirebaseAuth _auth;

  String? get currentUserId => _auth.currentUser?.uid;

  CollectionReference<Map<String, dynamic>> _favoritesRef(String uid) {
    return _firestore.collection('users').doc(uid).collection('favoriteCars');
  }

  Stream<Set<String>> favoriteIdsStream() {
    final uid = currentUserId;
    if (uid == null) return Stream.value(<String>{});
    return _favoritesRef(
      uid,
    ).snapshots().map((snapshot) => snapshot.docs.map((doc) => doc.id).toSet());
  }

  Stream<List<FavoriteCarSnapshot>> favoritesStream() {
    final uid = currentUserId;
    if (uid == null) return Stream.value(const <FavoriteCarSnapshot>[]);
    return _favoritesRef(uid)
        .orderBy('createdAt', descending: true)
        .snapshots()
        .map(
          (snapshot) => snapshot.docs.map(FavoriteCarSnapshot.fromDoc).toList(),
        );
  }

  /// Live car documents for [carIds], keyed by id; ids with no surviving car
  /// are simply absent.
  ///
  /// See [mergeFavoriteWithLiveCar] for how the two are combined.
  ///
  /// The favourite document is a snapshot taken when the car was saved, so a
  /// photo, price, or title added afterwards never reaches it - the card keeps
  /// rendering whatever was true that day, which for a listing saved before it
  /// was finished means a blank card forever. Re-reading the car fixes that.
  ///
  /// Batched with `whereIn` rather than a read per row: a per-tile fetch would
  /// be O(N) network calls per render of the list.
  Future<Map<String, Car>> loadCars(List<String> carIds) async {
    final ids = carIds.where((id) => id.isNotEmpty).toSet().toList();
    if (ids.isEmpty) return <String, Car>{};
    final cars = <String, Car>{};
    // Firestore caps whereIn at 30 values per query.
    for (var start = 0; start < ids.length; start += 30) {
      final chunk = ids.sublist(start, math.min(start + 30, ids.length));
      final snapshot = await _firestore
          .collection('cars')
          .where(FieldPath.documentId, whereIn: chunk)
          .get();
      for (final doc in snapshot.docs) {
        cars[doc.id] = Car.fromFirestore(doc);
      }
    }
    return cars;
  }

  Future<bool> isFavorite(String carId) async {
    final uid = currentUserId;
    if (uid == null) return false;
    final doc = await _favoritesRef(uid).doc(carId).get();
    return doc.exists;
  }

  Future<void> setFavorite(Car car, bool favorite) async {
    final uid = currentUserId;
    if (uid == null) {
      throw StateError('Sign in to save favorite cars.');
    }
    final ref = _favoritesRef(uid).doc(car.id);
    if (!favorite) {
      await ref.delete();
      return;
    }
    await ref.set({
      'carId': car.id,
      'title': car.title,
      'make': car.make,
      'model': car.model,
      'year': car.year,
      'price': car.price,
      'imageUrl': car.imageUrls.isNotEmpty ? car.imageUrls.first : '',
      'businessId': car.businessId,
      'businessName': car.businessName,
      'isRebuiltTitle': car.isRebuiltTitle,
      'createdAt': FieldValue.serverTimestamp(),
    }, SetOptions(merge: true));
  }
}

/// Layers the live car over the snapshot saved when it was favourited.
///
/// The favourite document records the car as it looked that day. Anything the
/// listing gained afterwards - photos, a price, a title - never reaches it, so
/// a car saved before its listing was finished renders as a blank card
/// forever. Live values therefore win.
///
/// Saved values still fill any gap, and are used wholesale when [live] is null,
/// so a delisted car degrades to what was last known about it instead of
/// vanishing from the list or rendering empty.
FavoriteCarSnapshot mergeFavoriteWithLiveCar(
  FavoriteCarSnapshot saved,
  Car? live,
) {
  if (live == null) return saved;
  return FavoriteCarSnapshot(
    carId: saved.carId,
    title: live.title.isNotEmpty ? live.title : saved.title,
    make: live.make.isNotEmpty ? live.make : saved.make,
    model: live.model.isNotEmpty ? live.model : saved.model,
    year: live.year.isNotEmpty ? live.year : saved.year,
    // A live price of 0 means "not priced yet", not "free" - keep whatever was
    // saved rather than showing $0.00.
    price: live.price > 0 ? live.price : saved.price,
    imageUrl: live.imageUrls.isNotEmpty ? live.imageUrls.first : saved.imageUrl,
    isRebuiltTitle: live.isRebuiltTitle ?? saved.isRebuiltTitle,
    createdAt: saved.createdAt,
  );
}
